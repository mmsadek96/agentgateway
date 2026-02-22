import { Router, Request, Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import {
  mintVouchNft, getVouchNftInfo, getVouchMarketStats, isDefiEnabled
} from '../services/defi';

const router = Router();

/**
 * GET /vouches/nft/stats
 * Public — vouch NFT market stats
 */
router.get('/stats', async (_req: Request, res: Response) => {
  if (!isDefiEnabled()) {
    res.json({ success: true, data: { enabled: false } });
    return;
  }

  const stats = await getVouchMarketStats();
  res.json({ success: true, data: stats });
});

/**
 * POST /vouches/nft/mint
 * Authenticated — mint a vouch NFT
 * Body: { voucherAgentId, vouchedAgentId, weight }
 */
router.post('/mint', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const { voucherAgentId, vouchedAgentId, weight } = req.body;
  if (!voucherAgentId || !vouchedAgentId) {
    res.status(400).json({ success: false, error: 'voucherAgentId and vouchedAgentId required' });
    return;
  }

  const txHash = await mintVouchNft(voucherAgentId, vouchedAgentId, weight || 1);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Vouch NFT minting failed' });
    return;
  }

  res.json({ success: true, data: { txHash, voucherAgentId, vouchedAgentId, weight: weight || 1 } });
});

/**
 * GET /vouches/nft/:tokenId
 * Public — get vouch NFT metadata
 */
router.get('/:tokenId', async (req: Request, res: Response) => {
  const tokenId = parseInt(req.params.tokenId);
  if (isNaN(tokenId)) {
    res.status(400).json({ success: false, error: 'Invalid token ID' });
    return;
  }

  const info = await getVouchNftInfo(tokenId);
  if (!info) {
    res.status(404).json({ success: false, error: 'Vouch NFT not found' });
    return;
  }

  res.json({ success: true, data: info });
});

export default router;
