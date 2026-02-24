import prisma from '../db/prisma';
import { updateAgentReputation, recordReputationEvent } from './reputation';
import { Decimal } from '@prisma/client/runtime/library';

interface StakeResult {
  agentId: string;
  previousStake: number;
  newStake: number;
  newReputationScore: number;
}

const MAX_STAKE_AMOUNT = 1_000_000; // Max $1M stake per operation
const MAX_TOTAL_STAKE = 10_000_000; // Max $10M total stake per agent

export async function addStake(
  agentExternalId: string,
  developerId: string,
  amount: number
): Promise<StakeResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Stake amount must be a positive number');
  }
  if (amount > MAX_STAKE_AMOUNT) {
    throw new Error(`Stake amount cannot exceed ${MAX_STAKE_AMOUNT}`);
  }

  // Use a transaction with atomic increment to prevent TOCTOU race conditions.
  // Two concurrent addStake calls both succeed and both amounts are applied.
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({
      where: { developerId_externalId: { developerId, externalId: agentExternalId } }
    });

    if (!agent) {
      throw new Error('Agent not found');
    }

    const previousStake = Number(agent.stakeAmount);

    if (previousStake + amount > MAX_TOTAL_STAKE) {
      throw new Error(`Total stake cannot exceed ${MAX_TOTAL_STAKE}`);
    }

    // Atomic increment avoids lost-update on concurrent requests
    const updated = await tx.agent.update({
      where: { id: agent.id },
      data: { stakeAmount: { increment: new Decimal(amount) } }
    });

    return {
      agentId: agent.externalId,
      agentDbId: agent.id,
      previousStake,
      newStake: Number(updated.stakeAmount),
    };
  });

  // Record the event (outside transaction — non-critical)
  const stakeBonus = Math.min(15, 5 + Math.floor(result.newStake / 100)) -
                     Math.min(15, 5 + Math.floor(result.previousStake / 100));
  await recordReputationEvent(result.agentDbId, 'stake_added', stakeBonus);

  // Recalculate reputation
  const newReputationScore = await updateAgentReputation(result.agentDbId);

  return {
    agentId: result.agentId,
    previousStake: result.previousStake,
    newStake: result.newStake,
    newReputationScore
  };
}

export async function withdrawStake(
  agentExternalId: string,
  developerId: string,
  amount: number
): Promise<StakeResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Withdrawal amount must be a positive number');
  }

  // Use a transaction with atomic decrement to prevent TOCTOU race conditions.
  const result = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({
      where: { developerId_externalId: { developerId, externalId: agentExternalId } }
    });

    if (!agent) {
      throw new Error('Agent not found');
    }

    const previousStake = Number(agent.stakeAmount);

    if (amount > previousStake) {
      throw new Error('Insufficient stake balance');
    }

    // Atomic decrement avoids lost-update on concurrent requests
    const updated = await tx.agent.update({
      where: { id: agent.id },
      data: { stakeAmount: { decrement: new Decimal(amount) } }
    });

    return {
      agentId: agent.externalId,
      agentDbId: agent.id,
      previousStake,
      newStake: Number(updated.stakeAmount),
    };
  });

  // Recalculate reputation
  const newReputationScore = await updateAgentReputation(result.agentDbId);

  return {
    agentId: result.agentId,
    previousStake: result.previousStake,
    newStake: result.newStake,
    newReputationScore
  };
}

export async function getStakeInfo(agentExternalId: string, developerId: string) {
  const agent = await prisma.agent.findUnique({
    where: { developerId_externalId: { developerId, externalId: agentExternalId } }
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  const stakeAmount = Number(agent.stakeAmount);
  const stakeBonus = stakeAmount > 0 ? Math.min(15, 5 + Math.floor(stakeAmount / 100)) : 0;

  return {
    agentId: agent.externalId,
    stakeAmount,
    stakeBonus,
    reputationScore: agent.reputationScore
  };
}
