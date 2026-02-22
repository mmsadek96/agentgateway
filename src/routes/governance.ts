import { Router, Request, Response } from 'express';
import { isDefiEnabled, getDefiOverview } from '../services/defi';

const router = Router();

/**
 * GET /governance/info
 * Public — governance contract info and parameters
 */
router.get('/info', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      enabled: isDefiEnabled(),
      governor: '0x1e548DC82c7B4d362c84084bd92263BCA6ecf17B',
      timelock: '0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1',
      token: '0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2',
      parameters: {
        votingDelay: '7200 blocks (~1 day)',
        votingPeriod: '21600 blocks (~3 days)',
        proposalThreshold: '100,000 TRUST',
        quorum: '4% of total supply',
        timelockDelay: '1 day',
      },
      governedContracts: [
        'StakingVault (cooldown, slash basis points)',
        'ReputationMarket (protocol fee)',
        'InsurancePool (protocol fee, base risk)',
      ],
    }
  });
});

/**
 * GET /governance/overview
 * Public — full DeFi ecosystem overview (for dashboard)
 */
router.get('/overview', async (_req: Request, res: Response) => {
  if (!isDefiEnabled()) {
    res.json({ success: true, data: { enabled: false } });
    return;
  }

  const overview = await getDefiOverview();
  res.json({ success: true, data: { enabled: true, ...overview } });
});

export default router;
