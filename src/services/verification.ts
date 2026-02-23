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

export async function reportOutcome(
  actionId: string,
  developerId: string,
  outcome: 'success' | 'failure'
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

  // Update agent stats based on outcome
  if (outcome === 'success') {
    await prisma.agent.update({
      where: { id: action.agentId },
      data: { successfulActions: { increment: 1 } }
    });
    await recordReputationEvent(action.agentId, 'success', 2);
  } else {
    await prisma.agent.update({
      where: { id: action.agentId },
      data: { failedActions: { increment: 1 } }
    });
    await recordReputationEvent(action.agentId, 'failure', -5);
  }

  // Recalculate reputation
  const newScore = await updateAgentReputation(action.agentId);

  return { updated: true, newScore };
}
