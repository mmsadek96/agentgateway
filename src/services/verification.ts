import { Prisma } from '@prisma/client';
import prisma from '../db/prisma';
import { calculateReputationScore, updateAgentReputation, recordReputationEvent } from './reputation';

interface VerificationResult {
  allowed: boolean;
  score: number;
  reason: string;
  actionId: string;
}

interface VerificationOptions {
  agentId: string;
  actionType: string;
  developerId: string;
  threshold?: number;
  context?: Prisma.InputJsonValue;
}

export async function verifyAgent(options: VerificationOptions): Promise<VerificationResult> {
  const { agentId, actionType, developerId, threshold = 50, context = {} as Prisma.InputJsonValue } = options;

  // Find the agent by external ID for this developer
  const agent = await prisma.agent.findUnique({
    where: { developerId_externalId: { developerId, externalId: agentId } }
  });

  if (!agent) {
    // Return denial without creating a broken action record (FK constraint)
    return {
      allowed: false,
      score: 0,
      reason: 'Agent not registered',
      actionId: 'none'
    };
  }

  // Check if agent is banned or suspended
  if (agent.status === 'banned') {
    const action = await prisma.action.create({
      data: {
        agentId: agent.id,
        actionType,
        decision: 'denied',
        reason: 'Agent is banned',
        metadata: context
      }
    });

    return {
      allowed: false,
      score: agent.reputationScore,
      reason: 'Agent is banned',
      actionId: action.id
    };
  }

  if (agent.status === 'suspended') {
    const action = await prisma.action.create({
      data: {
        agentId: agent.id,
        actionType,
        decision: 'denied',
        reason: 'Agent is suspended',
        metadata: context
      }
    });

    return {
      allowed: false,
      score: agent.reputationScore,
      reason: 'Agent is suspended',
      actionId: action.id
    };
  }

  // Calculate current reputation
  const reputationFactors = await calculateReputationScore(agent.id);
  const score = reputationFactors.totalScore;

  // Determine if allowed based on threshold
  const allowed = score >= threshold;

  // Build reason
  let reason: string;
  if (allowed) {
    reason = `Agent verified with score ${score}`;
    if (agent.identityVerified) reason += ' (identity verified)';
    if (Number(agent.stakeAmount) > 0) reason += ' (has stake)';
  } else {
    reason = `Score ${score} below threshold ${threshold}`;
    if (!agent.identityVerified) reason += ' - consider verifying identity';
    if (Number(agent.stakeAmount) === 0) reason += ' - consider adding stake';
  }

  // Record the action
  const action = await prisma.action.create({
    data: {
      agentId: agent.id,
      actionType,
      decision: allowed ? 'allowed' : 'denied',
      reason,
      metadata: context
    }
  });

  // Update total actions count
  await prisma.agent.update({
    where: { id: agent.id },
    data: { totalActions: { increment: 1 } }
  });

  return {
    allowed,
    score,
    reason,
    actionId: action.id
  };
}

/**
 * Report action outcome.
 *
 * Security considerations:
 * - Self-reported outcomes are weighted lower than gateway-reported outcomes.
 *   Developers reporting their own agents' outcomes get half the score impact.
 * - An action can only have its outcome reported once (idempotency).
 * - Per-agent daily report caps prevent farming: max 50 self-reports per agent per day.
 *
 * @param isGatewayReport If true, the report came from a gateway (trusted). Self-reports
 *                        from developers get reduced weight.
 */
export async function reportOutcome(
  actionId: string,
  developerId: string,
  outcome: 'success' | 'failure',
  isGatewayReport = false
): Promise<{ updated: boolean; newScore: number }> {
  // Find the action and verify it belongs to this developer's agent
  const action = await prisma.action.findUnique({
    where: { id: actionId },
    include: {
      agent: true
    }
  });

  if (!action || action.agentId === 'unknown') {
    throw new Error('Action not found');
  }

  if (action.agent.developerId !== developerId) {
    throw new Error('Action does not belong to your agent');
  }

  // Prevent duplicate outcome reporting — each action can only be reported once.
  // We track this via the metadata JSON field to avoid needing a schema migration.
  const metadata = (action.metadata && typeof action.metadata === 'object') ? action.metadata as Record<string, unknown> : {};
  if (metadata.outcomeReported) {
    throw new Error('Outcome already reported for this action');
  }

  // Per-agent daily self-report cap (prevents farming via mass self-reporting)
  if (!isGatewayReport) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentSelfReports = await prisma.reputationEvent.count({
      where: {
        agentId: action.agentId,
        createdAt: { gte: dayAgo },
        eventType: { in: ['success', 'failure'] }
      }
    });

    if (recentSelfReports >= 50) {
      throw new Error('Daily self-report limit reached (50). Use gateway-reported outcomes for higher throughput.');
    }
  }

  // Self-reports get half the score impact to mitigate gaming.
  // Gateway-reported outcomes (isGatewayReport=true) get full impact.
  const successWeight = isGatewayReport ? 2 : 1;
  const failureWeight = isGatewayReport ? -5 : -3;

  // Update agent stats based on outcome
  if (outcome === 'success') {
    await prisma.agent.update({
      where: { id: action.agentId },
      data: { successfulActions: { increment: 1 } }
    });
    await recordReputationEvent(action.agentId, 'success', successWeight);
  } else {
    await prisma.agent.update({
      where: { id: action.agentId },
      data: { failedActions: { increment: 1 } }
    });
    await recordReputationEvent(action.agentId, 'failure', failureWeight);
  }

  // Mark action as reported to prevent duplicate reporting (stored in metadata JSON)
  await prisma.action.update({
    where: { id: actionId },
    data: {
      metadata: {
        ...metadata,
        outcomeReported: outcome,
        reportedAt: new Date().toISOString(),
        isGatewayReport
      }
    }
  });

  // Recalculate reputation
  const newScore = await updateAgentReputation(action.agentId);

  return { updated: true, newScore };
}
