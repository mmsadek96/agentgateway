import prisma from '../db/prisma';
import { Decimal } from '@prisma/client/runtime/library';
import { updateReputationOnChain, logReputationEventOnChain } from './blockchain';
import { isDefiEnabled, getStakeInfo, getVouchScore } from './defi';

interface ReputationFactors {
  baseScore: number;
  identityBonus: number;
  stakeBonus: number;
  vouchBonus: number;
  successRateBonus: number;
  ageBonus: number;
  failurePenalty: number;
  momentumAdjustment: number;
  totalScore: number;
}

/**
 * Calculate reputation score for an agent.
 * Accepts an optional Prisma client/transaction to ensure transactional consistency
 * when called from within a $transaction block.
 */
export async function calculateReputationScore(agentId: string, db: typeof prisma = prisma): Promise<ReputationFactors> {
  const agent = await db.agent.findUnique({
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

  // Stake bonus — read from on-chain StakingVault if DeFi is enabled, else fall back to Postgres
  let stakeBonus = 0;
  if (isDefiEnabled()) {
    try {
      const onChainStake = await getStakeInfo(agentId);
      if (onChainStake && onChainStake.stakeScore > 0) {
        // stakeScore is 0-15, already calculated by the StakingVault contract
        stakeBonus = onChainStake.stakeScore;
      }
    } catch {
      // Fallback to Postgres if on-chain read fails
      const stakeAmount = Number(agent.stakeAmount);
      if (stakeAmount > 0) {
        stakeBonus = Math.min(15, 5 + Math.floor(stakeAmount / 100));
      }
    }
  } else {
    const stakeAmount = Number(agent.stakeAmount);
    if (stakeAmount > 0) {
      stakeBonus = Math.min(15, 5 + Math.floor(stakeAmount / 100));
    }
  }

  // Vouch bonus — read from on-chain VouchMarket if DeFi is enabled, else fall back to Postgres
  let vouchBonus = 0;
  const vouchCount = agent.vouchesReceived.length;
  if (isDefiEnabled()) {
    try {
      const onChainVouchScore = await getVouchScore(agentId);
      if (onChainVouchScore !== null && onChainVouchScore > 0) {
        // VouchMarket.getVouchScore() returns 0-20, weighted by voucher reputation
        vouchBonus = onChainVouchScore;
      } else {
        // No on-chain vouches yet — use Postgres count
        vouchBonus = Math.min(20, vouchCount * 2);
      }
    } catch {
      vouchBonus = Math.min(20, vouchCount * 2);
    }
  } else {
    vouchBonus = Math.min(20, vouchCount * 2);
  }

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

  // Failure penalty — capped at 50 so agents can recover
  // Uses a decay: recent failures count full, older ones count less
  const failurePenalty = Math.min(50, agent.failedActions * 5);

  // Momentum adjustment — recent behavior velocity
  // Looks at last 10 reputation events to compute momentum
  // Rapid recent failures create negative momentum; consistent successes create positive
  let momentumAdjustment = 0;
  const recentEvents = await db.reputationEvent.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  if (recentEvents.length >= 3) {
    // Calculate weighted average of recent score changes (more recent = heavier weight)
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < recentEvents.length; i++) {
      const weight = recentEvents.length - i; // Most recent gets highest weight
      weightedSum += recentEvents[i].scoreChange * weight;
      totalWeight += weight;
    }
    const avgChange = weightedSum / totalWeight;

    // Time factor: events clustered in time amplify momentum
    const oldest = recentEvents[recentEvents.length - 1].createdAt.getTime();
    const newest = recentEvents[0].createdAt.getTime();
    const spanHours = Math.max(0.1, (newest - oldest) / (1000 * 60 * 60));

    // Velocity = weighted average change per event, scaled by time density
    const velocity = avgChange * Math.min(3, 1 / spanHours); // Compress to max 3x amplifier

    // Cap momentum adjustment to [-10, +5] (punish fast, reward slow)
    momentumAdjustment = Math.max(-10, Math.min(5, Math.round(velocity)));
  }

  // Calculate total
  const totalScore = Math.max(0, Math.min(100,
    baseScore +
    identityBonus +
    stakeBonus +
    vouchBonus +
    successRateBonus +
    ageBonus +
    momentumAdjustment -
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
    momentumAdjustment,
    totalScore
  };
}

export async function updateAgentReputation(agentId: string): Promise<number> {
  // Use serializable transaction to prevent race conditions on concurrent updates
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new Error('Agent not found');

    const oldScore = agent.reputationScore;
    // Pass the transaction client to ensure consistent reads within the transaction
    const factors = await calculateReputationScore(agentId, tx as unknown as typeof prisma);

    await tx.agent.update({
      where: { id: agentId },
      data: { reputationScore: factors.totalScore }
    });

    return { agent, oldScore, factors };
  });

  const { agent, oldScore, factors } = result;

  // Sync to blockchain (non-blocking, outside transaction)
  const successRate = agent.totalActions > 0
    ? agent.successfulActions / agent.totalActions
    : 1;
  updateReputationOnChain(agentId, factors.totalScore, agent.totalActions, successRate)
    .catch((err) => console.error('[Blockchain] Failed to sync reputation on-chain:', err.message));

  // Log the score change event on-chain (includes momentum metadata)
  const eventType = factors.totalScore < oldScore ? 1 : 2; // 1=slash, 2=reward
  const momentumTag = factors.momentumAdjustment !== 0
    ? `:momentum=${factors.momentumAdjustment > 0 ? '+' : ''}${factors.momentumAdjustment}`
    : '';
  logReputationEventOnChain(
    agentId, eventType, oldScore, factors.totalScore,
    `score_update:${agent.totalActions}actions${momentumTag}`
  ).catch((err) => console.error('[Blockchain] Failed to log reputation event on-chain:', err.message));

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
