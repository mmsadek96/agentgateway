import prisma from '../db/prisma';
import { updateAgentReputation, recordReputationEvent } from './reputation';

interface VouchResult {
  vouchId: string;
  voucherAgentId: string;
  vouchedAgentId: string;
  vouchedAgentNewScore: number;
}

export async function createVouch(
  voucherExternalId: string,
  vouchedExternalId: string,
  developerId: string,
  weight = 1
): Promise<VouchResult> {
  // Voucher and vouched must be different
  if (voucherExternalId === vouchedExternalId) {
    throw new Error('Agent cannot vouch for itself');
  }

  // Find voucher agent (must belong to the requesting developer)
  const voucherAgent = await prisma.agent.findUnique({
    where: { developerId_externalId: { developerId, externalId: voucherExternalId } }
  });

  if (!voucherAgent) {
    throw new Error('Voucher agent not found');
  }

  // Find vouched agent — lookup across ALL developers (vouching is cross-developer)
  // First try same developer, then search globally by externalId
  let vouchedAgent = await prisma.agent.findUnique({
    where: { developerId_externalId: { developerId, externalId: vouchedExternalId } }
  });

  // If not found for this developer, search globally
  if (!vouchedAgent) {
    vouchedAgent = await prisma.agent.findFirst({
      where: { externalId: vouchedExternalId }
    });
  }

  if (!vouchedAgent) {
    throw new Error('Vouched agent not found');
  }

  // SECURITY: Prevent same-developer agents from vouching each other.
  // This blocks the "sybil vouch" attack where a developer creates multiple agents
  // and has them vouch for each other to inflate reputation scores.
  if (voucherAgent.developerId === vouchedAgent.developerId) {
    throw new Error('Agents belonging to the same developer cannot vouch for each other');
  }

  // Voucher must have good reputation to vouch
  if (voucherAgent.reputationScore < 60) {
    throw new Error('Voucher must have reputation score of at least 60');
  }

  // Check if vouch already exists
  const existingVouch = await prisma.vouch.findUnique({
    where: {
      voucherAgentId_vouchedAgentId: {
        voucherAgentId: voucherAgent.id,
        vouchedAgentId: vouchedAgent.id
      }
    }
  });

  if (existingVouch) {
    throw new Error('Vouch already exists');
  }

  // Create the vouch
  const vouch = await prisma.vouch.create({
    data: {
      voucherAgentId: voucherAgent.id,
      vouchedAgentId: vouchedAgent.id,
      weight: Math.max(1, Math.min(5, weight)) // Clamp weight between 1-5
    }
  });

  // Record reputation event for vouched agent
  await recordReputationEvent(vouchedAgent.id, 'vouch_received', 2);

  // Update vouched agent's reputation
  const newScore = await updateAgentReputation(vouchedAgent.id);

  return {
    vouchId: vouch.id,
    voucherAgentId: voucherExternalId,
    vouchedAgentId: vouchedExternalId,
    vouchedAgentNewScore: newScore
  };
}

export async function revokeVouch(
  voucherExternalId: string,
  vouchedExternalId: string,
  developerId: string
): Promise<{ revoked: boolean; vouchedAgentNewScore: number }> {
  const voucherAgent = await prisma.agent.findUnique({
    where: { developerId_externalId: { developerId, externalId: voucherExternalId } }
  });

  const vouchedAgent = await prisma.agent.findUnique({
    where: { developerId_externalId: { developerId, externalId: vouchedExternalId } }
  });

  if (!voucherAgent || !vouchedAgent) {
    throw new Error('Agent not found');
  }

  const vouch = await prisma.vouch.findUnique({
    where: {
      voucherAgentId_vouchedAgentId: {
        voucherAgentId: voucherAgent.id,
        vouchedAgentId: vouchedAgent.id
      }
    }
  });

  if (!vouch) {
    throw new Error('Vouch not found');
  }

  // Delete the vouch
  await prisma.vouch.delete({
    where: { id: vouch.id }
  });

  // Update vouched agent's reputation
  const newScore = await updateAgentReputation(vouchedAgent.id);

  return {
    revoked: true,
    vouchedAgentNewScore: newScore
  };
}

export async function getVouchesForAgent(agentExternalId: string, developerId: string) {
  const agent = await prisma.agent.findUnique({
    where: { developerId_externalId: { developerId, externalId: agentExternalId } },
    include: {
      vouchesReceived: {
        include: {
          voucherAgent: {
            select: {
              externalId: true,
              reputationScore: true
            }
          }
        }
      },
      vouchesGiven: {
        include: {
          vouchedAgent: {
            select: {
              externalId: true,
              reputationScore: true
            }
          }
        }
      }
    }
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  return {
    agentId: agent.externalId,
    vouchesReceived: agent.vouchesReceived.map(v => ({
      from: v.voucherAgent.externalId,
      fromScore: v.voucherAgent.reputationScore,
      weight: v.weight,
      createdAt: v.createdAt
    })),
    vouchesGiven: agent.vouchesGiven.map(v => ({
      to: v.vouchedAgent.externalId,
      toScore: v.vouchedAgent.reputationScore,
      weight: v.weight,
      createdAt: v.createdAt
    })),
    totalVouchBonus: Math.min(20, agent.vouchesReceived.length * 2)
  };
}
