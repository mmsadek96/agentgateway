import prisma from '../db/prisma';
import { updateAgentReputation, recordReputationEvent } from './reputation';
import { GatewayReportRequest } from '../types';

interface ReportResult {
  // SECURITY (#40): Internal agent UUID removed from report response.
  // Callers already know the agentId they submitted — echoing the internal UUID
  // leaks implementation details. Use externalId for display purposes.
  agentExternalId: string;
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

  // SECURITY (#31): The database now has a @@unique([certificateJti, gatewayId]) constraint,
  // so duplicate reports are caught atomically inside the transaction below.
  // The previous findFirst check had a TOCTOU race condition.

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

  try {
    await prisma.$transaction(async (tx) => {
      // SECURITY (#91): Create action records with correct decision status.
      // Previously all actions were stored as 'allowed' regardless of outcome.
      // Now failures are stored as 'denied' to accurately reflect gateway reports.
      for (const action of actions) {
        await tx.action.create({
          data: {
            agentId,
            actionType: action.actionType,
            decision: action.outcome === 'success' ? 'allowed' : 'denied',
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

      // Save the gateway report summary — unique constraint on [certificateJti, gatewayId]
      // catches duplicates atomically (#31)
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
  } catch (err: unknown) {
    // SECURITY (#31): Handle unique constraint violation from @@unique([certificateJti, gatewayId])
    const prismaErr = err as { code?: string };
    if (prismaErr.code === 'P2002') {
      throw new Error('Report already submitted for this certificate and gateway');
    }
    throw err;
  }

  // Recalculate reputation (outside transaction — includes blockchain sync)
  const newScore = await updateAgentReputation(agentId);

  // SECURITY (#40): Return externalId instead of internal UUID
  return {
    agentExternalId: agent.externalId,
    actionsProcessed: actions.length,
    successCount,
    failureCount,
    newReputationScore: newScore
  };
}
