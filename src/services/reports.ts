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
  if (developerId && agent.developerId !== developerId) {
    throw new Error('You can only submit reports for your own agents');
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

  // Process each action
  let successCount = 0;
  let failureCount = 0;

  for (const action of actions) {
    // Create the action record
    await prisma.action.create({
      data: {
        agentId,
        actionType: action.actionType,
        decision: 'allowed', // It was allowed by the gateway
        reason: `Gateway ${gatewayId} reported ${action.outcome}`,
        metadata: (action.metadata || {}) as any
      }
    });

    // Update agent stats
    if (action.outcome === 'success') {
      successCount++;
      await prisma.agent.update({
        where: { id: agentId },
        data: {
          totalActions: { increment: 1 },
          successfulActions: { increment: 1 }
        }
      });
      await recordReputationEvent(agentId, 'success', 0);
    } else {
      failureCount++;
      await prisma.agent.update({
        where: { id: agentId },
        data: {
          totalActions: { increment: 1 },
          failedActions: { increment: 1 }
        }
      });
      await recordReputationEvent(agentId, 'failure', -5);
    }
  }

  // Save the gateway report summary
  await prisma.gatewayReport.create({
    data: {
      agentId,
      gatewayId,
      certificateJti,
      actionsCount: actions.length,
      successCount,
      failureCount
    }
  });

  // Recalculate reputation
  const newScore = await updateAgentReputation(agentId);

  return {
    agentId,
    actionsProcessed: actions.length,
    successCount,
    failureCount,
    newReputationScore: newScore
  };
}
