import { Router, Request, Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import {
  getTrustBalance, getTrustStats, mintTrust,
  stakeForAgent, requestUnstake, completeUnstake, getStakeInfo, getStakingStats,
  isDefiEnabled
} from '../services/defi';

const router = Router();

/**
 * GET /trust/stats
 * Public — $TRUST token stats
 */
router.get('/stats', async (_req: Request, res: Response) => {
  if (!isDefiEnabled()) {
    res.json({ success: true, data: { enabled: false } });
    return;
  }

  const stats = await getTrustStats();
  res.json({ success: true, data: { enabled: true, ...stats } });
});

/**
 * GET /trust/balance/:agentId
 * Authenticated — get $TRUST + stTRUST balance for an agent
 */
router.get('/balance/:agentId', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const { agentId } = req.params;
  if (!isDefiEnabled()) {
    res.json({ success: true, data: { enabled: false } });
    return;
  }

  const stakeInfo = await getStakeInfo(agentId);
  res.json({
    success: true,
    data: {
      agentId,
      stake: stakeInfo,
    }
  });
});

/**
 * POST /trust/stake
 * Authenticated — stake $TRUST for an agent
 * Body: { agentId, amount }
 */
router.post('/stake', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const { agentId, amount } = req.body;
  if (!agentId || !amount) {
    res.status(400).json({ success: false, error: 'agentId and amount required' });
    return;
  }

  const txHash = await stakeForAgent(agentId, amount);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Staking failed (blockchain unavailable)' });
    return;
  }

  res.json({ success: true, data: { txHash, agentId, amount } });
});

/**
 * POST /trust/unstake/request
 * Authenticated — request unstake (starts cooldown)
 * Body: { agentId, amount }
 */
router.post('/unstake/request', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const { agentId, amount } = req.body;
  if (!agentId || !amount) {
    res.status(400).json({ success: false, error: 'agentId and amount required' });
    return;
  }

  const txHash = await requestUnstake(agentId, amount);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Unstake request failed' });
    return;
  }

  res.json({ success: true, data: { txHash, agentId, amount } });
});

/**
 * POST /trust/unstake/complete
 * Authenticated — complete unstake after cooldown
 * Body: { agentId }
 */
router.post('/unstake/complete', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const { agentId } = req.body;
  if (!agentId) {
    res.status(400).json({ success: false, error: 'agentId required' });
    return;
  }

  const txHash = await completeUnstake(agentId);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Unstake completion failed (cooldown may not be over)' });
    return;
  }

  res.json({ success: true, data: { txHash, agentId } });
});

/**
 * GET /trust/stake/:agentId
 * Authenticated — staking info for an agent
 */
router.get('/stake/:agentId', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const stakeInfo = await getStakeInfo(req.params.agentId);
  res.json({ success: true, data: stakeInfo });
});

/**
 * GET /trust/staking/stats
 * Public — overall staking stats
 */
router.get('/staking/stats', async (_req: Request, res: Response) => {
  const stats = await getStakingStats();
  res.json({ success: true, data: stats });
});

export default router;
