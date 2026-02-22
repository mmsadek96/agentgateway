import prisma from '../db/prisma';
import { Decimal } from '@prisma/client/runtime/library';
import { updateReputationOnChain, logReputationEventOnChain } from './blockchain';

interface ReputationFactors {
  baseScore: number;
  identityBonus: number;
  stakeBonus: number;
  vouchBonus: number;
  successRateBonus: number;
  ageBonus: number;
  failurePenalty: number;
  totalScore: number;
}

export async function calculateReputationScore(agentId: string): Promise<ReputationFactors> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      vouchesReceived: true
    }
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  // Base score for new agents
  const baseScore = 50;

  // Identity verification bonus
  const identityBonus = agent.identityVerified ? 10 : 0;

  // Stake bonus (5-15 based on amount)
  const stakeAmount = Number(agent.stakeAmount);
  let stakeBonus = 0;
  if (stakeAmount > 0) {
    stakeBonus = Math.min(15, 5 + Math.floor(stakeAmount / 100));
  }

  // Vouch bonus (+2 per vouch, max +20)
  const vouchCount = agent.vouchesReceived.length;
  const vouchBonus = Math.min(20, vouchCount * 2);

  // Success rate bonus (up to +20)
  let successRateBonus = 0;
  if (agent.totalActions > 0) {
    const successRate = agent.successfulActions / agent.totalActions;
    successRateBonus = Math.round(successRate * 20);
  }

  // Account age bonus (+1 per month, max +10)
  const monthsOld = Math.floor(
    (Date.now() - agent.createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000)
  );
  const ageBonus = Math.min(10, monthsOld);

  // Failure penalty (-5 per failure)
  const failurePenalty = agent.failedActions * 5;

  // Calculate total
  const totalScore = Math.max(0, Math.min(100,
    baseScore +
    identityBonus +
    stakeBonus +
    vouchBonus +
    successRateBonus +
    ageBonus -
    failurePenalty
  ));

  return {
    baseScore,
    identityBonus,
    stakeBonus,
    vouchBonus,
    successRateBonus,
    ageBonus,
    failurePenalty,
    totalScore
  };
}

export async function updateAgentReputation(agentId: string): Promise<number> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  const oldScore = agent?.reputationScore ?? 50;

  const factors = await calculateReputationScore(agentId);

  await prisma.agent.update({
    where: { id: agentId },
    data: { reputationScore: factors.totalScore }
  });

  // Sync to blockchain (non-blocking)
  if (agent) {
    const successRate = agent.totalActions > 0
      ? agent.successfulActions / agent.totalActions
      : 1;
    updateReputationOnChain(agentId, factors.totalScore, agent.totalActions, successRate).catch(() => {});

    // Log the score change event on-chain
    const eventType = factors.totalScore < oldScore ? 1 : 2; // 1=slash, 2=reward
    logReputationEventOnChain(
      agentId, eventType, oldScore, factors.totalScore,
      `score_update:${agent.totalActions}actions`
    ).catch(() => {});
  }

  return factors.totalScore;
}

export async function recordReputationEvent(
  agentId: string,
  eventType: 'success' | 'failure' | 'vouch_received' | 'stake_added' | 'abuse_reported',
  scoreChange: number
): Promise<void> {
  await prisma.reputationEvent.create({
    data: {
      agentId,
      eventType,
      scoreChange
    }
  });
}

export async function getReputationHistory(agentId: string, limit = 50) {
  return prisma.reputationEvent.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
}
