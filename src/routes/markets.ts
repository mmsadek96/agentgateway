import { Router, Request, Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest, verifyAgentOwnership } from '../middleware/auth';
import {
  createMarket, placeBet, settleMarket, claimWinnings,
  getMarketInfo, getMarketStats, isDefiEnabled
} from '../services/defi';

const router = Router();

/**
 * GET /markets/stats
 * Public — overall market stats
 */
router.get('/stats', async (_req: Request, res: Response) => {
  if (!isDefiEnabled()) {
    res.json({ success: true, data: { enabled: false } });
    return;
  }

  const stats = await getMarketStats();
  res.json({ success: true, data: stats });
});

/**
 * GET /markets/:id
 * Public — market details
 */
router.get('/:id', async (req: Request, res: Response) => {
  const marketId = parseInt(req.params.id);
  if (isNaN(marketId)) {
    res.status(400).json({ success: false, error: 'Invalid market ID' });
    return;
  }

  const market = await getMarketInfo(marketId);
  if (!market) {
    res.status(404).json({ success: false, error: 'Market not found' });
    return;
  }

  res.json({ success: true, data: market });
});

/**
 * POST /markets/create
 * Authenticated — create a new reputation market
 * Body: { agentId, targetScore, expiresAt }
 */
router.post('/create', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const { agentId, targetScore, expiresAt } = req.body;
  if (!agentId || targetScore === undefined || !expiresAt) {
    res.status(400).json({ success: false, error: 'agentId, targetScore, and expiresAt required' });
    return;
  }
  if (!await verifyAgentOwnership(req.developer!.id, agentId, res)) return;

  const txHash = await createMarket(agentId, targetScore, expiresAt);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Market creation failed' });
    return;
  }

  res.json({ success: true, data: { txHash, agentId, targetScore, expiresAt } });
});

/**
 * POST /markets/:id/bet
 * Authenticated — place a bet
 * Body: { side: "yes"|"no", amount, agentId }
 */
router.post('/:id/bet', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const marketId = parseInt(req.params.id);
  const { side, amount, agentId } = req.body;

  if (isNaN(marketId) || !side || !amount || !agentId) {
    res.status(400).json({ success: false, error: 'marketId, side, amount, agentId required' });
    return;
  }
  if (!await verifyAgentOwnership(req.developer!.id, agentId, res)) return;

  if (side !== 'yes' && side !== 'no') {
    res.status(400).json({ success: false, error: 'side must be "yes" or "no"' });
    return;
  }

  // In democratic design, we use the deployer wallet address since agents don't have wallets
  const bettorAddress = process.env.DEPLOYER_ADDRESS || '0x5F3B19B9AB09f10cd176a401618c883473006E6A';
  const txHash = await placeBet(marketId, side, amount, bettorAddress);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Bet placement failed' });
    return;
  }

  res.json({ success: true, data: { txHash, marketId, side, amount } });
});

/**
 * POST /markets/:id/settle
 * Authenticated — settle an expired market
 */
router.post('/:id/settle', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const marketId = parseInt(req.params.id);
  const txHash = await settleMarket(marketId);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Settlement failed' });
    return;
  }

  res.json({ success: true, data: { txHash, marketId } });
});

/**
 * POST /markets/:id/claim
 * Authenticated — claim winnings
 * Body: { agentId }
 */
router.post('/:id/claim', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const marketId = parseInt(req.params.id);
  const { agentId } = req.body;
  if (!agentId) {
    res.status(400).json({ success: false, error: 'agentId required' });
    return;
  }
  if (!await verifyAgentOwnership(req.developer!.id, agentId, res)) return;

  const claimantAddress = process.env.DEPLOYER_ADDRESS || '0x5F3B19B9AB09f10cd176a401618c883473006E6A';
  const txHash = await claimWinnings(marketId, claimantAddress);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Claim failed' });
    return;
  }

  res.json({ success: true, data: { txHash, marketId, agentId } });
});

export default router;
