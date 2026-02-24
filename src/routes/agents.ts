import { Router, Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import { calculateReputationScore, getReputationHistory } from '../services/reputation';
import { addStake, withdrawStake, getStakeInfo } from '../services/staking';
import { createVouch, revokeVouch, getVouchesForAgent } from '../services/vouching';
import prisma from '../db/prisma';

const router = Router();

// Get agent reputation details
router.get('/:agentId/reputation', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;
    const { agentId } = req.params;

    const agent = await prisma.agent.findUnique({
      where: { developerId_externalId: { developerId, externalId: agentId } }
    });

    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found' });
      return;
    }

    const factors = await calculateReputationScore(agent.id);
    const history = await getReputationHistory(agent.id, 20);

    res.json({
      success: true,
      data: {
        agentId,
        currentScore: factors.totalScore,
        factors: {
          base: factors.baseScore,
          identityVerified: factors.identityBonus,
          stake: factors.stakeBonus,
          vouches: factors.vouchBonus,
          successRate: factors.successRateBonus,
          accountAge: factors.ageBonus,
          failurePenalty: -factors.failurePenalty,
          momentum: factors.momentumAdjustment
        },
        recentHistory: history
      }
    });
  } catch (error) {
    console.error('Reputation error:', error);
    res.status(500).json({ success: false, error: 'Failed to get reputation' });
  }
});

// Add stake
router.post('/:agentId/stake', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;
    const { agentId } = req.params;
    const { amount } = req.body;

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Valid positive amount required' });
      return;
    }

    const result = await addStake(agentId, developerId, amount);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add stake';
    res.status(400).json({ success: false, error: message });
  }
});

// Withdraw stake
router.post('/:agentId/stake/withdraw', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;
    const { agentId } = req.params;
    const { amount } = req.body;

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Valid positive amount required' });
      return;
    }

    const result = await withdrawStake(agentId, developerId, amount);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to withdraw stake';
    res.status(400).json({ success: false, error: message });
  }
});

// Get stake info
router.get('/:agentId/stake', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;
    const { agentId } = req.params;

    const result = await getStakeInfo(agentId, developerId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get stake info';
    res.status(400).json({ success: false, error: message });
  }
});

// Create a vouch
router.post('/:agentId/vouch', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;
    const { agentId } = req.params; // This is the voucher
    const { targetAgentId, weight } = req.body; // This is who they're vouching for

    if (!targetAgentId) {
      res.status(400).json({ success: false, error: 'targetAgentId required' });
      return;
    }

    const result = await createVouch(agentId, targetAgentId, developerId, weight);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create vouch';
    res.status(400).json({ success: false, error: message });
  }
});

// Revoke a vouch
router.delete('/:agentId/vouch/:targetAgentId', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;
    const { agentId, targetAgentId } = req.params;

    const result = await revokeVouch(agentId, targetAgentId, developerId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to revoke vouch';
    res.status(400).json({ success: false, error: message });
  }
});

// Get vouches for an agent
router.get('/:agentId/vouches', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;
    const { agentId } = req.params;

    const result = await getVouchesForAgent(agentId, developerId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get vouches';
    res.status(400).json({ success: false, error: message });
  }
});

/**
 * Verify agent identity.
 *
 * Security: Requires the ADMIN_API_KEY header to prevent developers from
 * self-verifying their own agents for a free +10 reputation score.
 * In production, identity verification should be triggered by an admin
 * after reviewing the agent's documentation, domain ownership, etc.
 */
router.post('/:agentId/verify-identity', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Require admin authorization — self-service verification is a score inflation vector
    const adminKey = process.env.ADMIN_API_KEY;
    const providedAdminKey = req.headers['x-admin-key'] as string | undefined;

    if (!adminKey || !providedAdminKey) {
      res.status(403).json({
        success: false,
        error: 'Identity verification requires admin authorization. Contact the AgentTrust team.'
      });
      return;
    }

    // Timing-safe comparison to prevent brute-force
    const adminBuf = Buffer.from(adminKey);
    const providedBuf = Buffer.from(providedAdminKey);
    if (adminBuf.length !== providedBuf.length ||
        !require('crypto').timingSafeEqual(adminBuf, providedBuf)) {
      res.status(403).json({ success: false, error: 'Invalid admin credentials' });
      return;
    }

    const developerId = req.developer!.id;
    const { agentId } = req.params;

    const agent = await prisma.agent.findUnique({
      where: { developerId_externalId: { developerId, externalId: agentId } }
    });

    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found' });
      return;
    }

    if (agent.identityVerified) {
      res.status(409).json({ success: false, error: 'Agent identity already verified' });
      return;
    }

    await prisma.agent.update({
      where: { id: agent.id },
      data: { identityVerified: true }
    });

    // Recalculate reputation
    const factors = await calculateReputationScore(agent.id);
    await prisma.agent.update({
      where: { id: agent.id },
      data: { reputationScore: factors.totalScore }
    });

    res.json({
      success: true,
      data: {
        agentId,
        identityVerified: true,
        newReputationScore: factors.totalScore
      }
    });
  } catch (error) {
    console.error('Verify identity error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify identity' });
  }
});

export default router;
