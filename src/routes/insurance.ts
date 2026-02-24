import { Router, Request, Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest, verifyAgentOwnership } from '../middleware/auth';
import {
  depositInsuranceCollateral, buyInsurancePolicy, fileInsuranceClaim,
  getInsuranceStats, isDefiEnabled
} from '../services/defi';

const router = Router();

/**
 * GET /insurance/stats
 * Public — overall insurance pool stats
 */
router.get('/stats', async (_req: Request, res: Response) => {
  if (!isDefiEnabled()) {
    res.json({ success: true, data: { enabled: false } });
    return;
  }

  const stats = await getInsuranceStats();
  res.json({ success: true, data: stats });
});

/**
 * POST /insurance/collateral/deposit
 * Authenticated — deposit $TRUST as collateral for an agent
 * Body: { agentId, amount }
 */
router.post('/collateral/deposit', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const { agentId, amount } = req.body;
  if (!agentId || !amount) {
    res.status(400).json({ success: false, error: 'agentId and amount required' });
    return;
  }
  if (!await verifyAgentOwnership(req.developer!.id, agentId, res)) return;

  const txHash = await depositInsuranceCollateral(agentId, amount);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Collateral deposit failed' });
    return;
  }

  res.json({ success: true, data: { txHash, agentId, amount } });
});

/**
 * POST /insurance/buy
 * Authenticated — buy insurance policy against agent performance drop
 * Body: { agentId, coverageAmount, triggerScore, expiresAt }
 */
router.post('/buy', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const { agentId, coverageAmount, triggerScore, expiresAt } = req.body;
  if (!agentId || !coverageAmount || triggerScore === undefined || !expiresAt) {
    res.status(400).json({
      success: false,
      error: 'agentId, coverageAmount, triggerScore, and expiresAt required'
    });
    return;
  }
  if (!await verifyAgentOwnership(req.developer!.id, agentId, res)) return;

  const insuredAddress = process.env.DEPLOYER_ADDRESS;
  if (!insuredAddress) {
    res.status(503).json({ success: false, error: 'DEPLOYER_ADDRESS not configured. DeFi operations unavailable.' });
    return;
  }
  const txHash = await buyInsurancePolicy(agentId, insuredAddress, coverageAmount, triggerScore, expiresAt);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Policy purchase failed' });
    return;
  }

  res.json({ success: true, data: { txHash, agentId, coverageAmount, triggerScore } });
});

/**
 * POST /insurance/:id/claim
 * Authenticated — file a claim against a policy
 * Body: { agentId }
 */
router.post('/:id/claim', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  const policyId = parseInt(req.params.id);
  if (isNaN(policyId)) {
    res.status(400).json({ success: false, error: 'Invalid policy ID' });
    return;
  }
  const { agentId } = req.body;
  if (!agentId) {
    res.status(400).json({ success: false, error: 'agentId required' });
    return;
  }
  if (!await verifyAgentOwnership(req.developer!.id, agentId, res)) return;

  const txHash = await fileInsuranceClaim(policyId);
  if (!txHash) {
    res.status(500).json({ success: false, error: 'Claim failed (score may be above trigger)' });
    return;
  }

  res.json({ success: true, data: { txHash, policyId, agentId } });
});

export default router;
