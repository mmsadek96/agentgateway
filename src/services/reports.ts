import prisma from '../db/prisma';
import { updateAgentReputation, recordReputationEvent } from './reputation';
import { GatewayReportRequest } from '../types';

interface ReportResult {
  agentId: string;
  actionsProcessed: number;
  successCount: number;
  failureCount: number;
  newReputationScore: number;
}

/**
 * Process a behavior report from a gateway.
 * Creates action records, updates agent stats, and recalculates reputation.
 * Uses a transaction to ensure atomicity — all or nothing.
 */
export async function submitReport(report: GatewayReportRequest & { developerId?: string }): Promise<ReportResult> {
  const { agentId, gatewayId, actions, certificateJti, developerId } = report;

  // Validate the agent exists
  const agent = await prisma.agent.findUnique({
    where: { id: agentId }
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  // Verify the submitting developer owns this agent (prevents cross-developer manipulation)
  if (developerId) {
    if (agent.developerId !== developerId) {
      throw new Error('You can only submit reports for your own agents');
    }
  } else {
    // developerId is required for authenticated requests — reject unauthenticated reports
    throw new Error('Developer authentication required to submit reports');
  }

  // Validate the certificate was real
  const cert = await prisma.certificate.findUnique({
    where: { jti: certificateJti }
  });

  if (!cert) {
    throw new Error('Certificate not found — invalid report');
  }

  if (cert.agentId !== agentId) {
    throw new Error('Certificate does not belong to this agent');
  }

  // Idempotency check — prevent duplicate reports for same certificate + gateway
  const existingReport = await prisma.gatewayReport.findFirst({
    where: { certificateJti, gatewayId }
  });

  if (existingReport) {
    throw new Error('Report already submitted for this certificate and gateway');
  }

  // Process all actions atomically in a transaction
  let successCount = 0;
  let failureCount = 0;

  for (const action of actions) {
    if (action.outcome === 'success') {
      successCount++;
    } else {
      failureCount++;
    }
  }

  await prisma.$transaction(async (tx) => {
    // Create all action records
    for (const action of actions) {
      await tx.action.create({
        data: {
          agentId,
          actionType: action.actionType,
          decision: 'allowed',
          reason: `Gateway ${gatewayId} reported ${action.outcome}`,
          metadata: (action.metadata || {}) as any
        }
      });
    }

    // Update agent stats in a single atomic operation
    await tx.agent.update({
      where: { id: agentId },
      data: {
        totalActions: { increment: actions.length },
        successfulActions: { increment: successCount },
        failedActions: { increment: failureCount }
      }
    });

    // Create reputation events
    for (const action of actions) {
      await tx.reputationEvent.create({
        data: {
          agentId,
          eventType: action.outcome === 'success' ? 'success' : 'failure',
          scoreChange: action.outcome === 'success' ? 2 : -5
        }
      });
    }

    // Save the gateway report summary
    await tx.gatewayReport.create({
      data: {
        agentId,
        gatewayId,
        certificateJti,
        actionsCount: actions.length,
        successCount,
        failureCount
      }
    });
  });

  // Recalculate reputation (outside transaction — includes blockchain sync)
  const newScore = await updateAgentReputation(agentId);

  return {
    agentId,
    actionsProcessed: actions.length,
    successCount,
    failureCount,
    newReputationScore: newScore
  };
}
