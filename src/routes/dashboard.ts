import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import prisma from '../db/prisma';
import { getDefiOverview, isDefiEnabled } from '../services/defi';

const router = Router();

// ─── Admin key guard for dashboard API ───
function dashboardAuth(req: Request, res: Response, next: NextFunction): void {
  const adminKey = process.env.DASHBOARD_API_KEY;
  // SECURITY (#38): Fail closed in ALL environments — never allow unauthenticated access.
  // Previously, dev/test environments allowed public access when key was not configured.
  if (!adminKey) {
    res.status(401).json({ success: false, error: 'DASHBOARD_API_KEY not configured' });
    return;
  }
  // SECURITY (#37): Only accept admin key via header, NOT query string.
  // Query strings appear in server logs, browser history, and referrer headers.
  const provided = req.headers['x-admin-key'] as string;
  if (provided !== adminKey) {
    res.status(401).json({ success: false, error: 'Dashboard access requires admin key (via X-Admin-Key header)' });
    return;
  }
  next();
}

// ─── Dashboard Page ───

router.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

// ─── Dashboard API Endpoints ───

/**
 * GET /dashboard/api/overview
 * High-level platform stats: total developers, agents, actions, certificates
 */
router.get('/api/overview', dashboardAuth, async (_req: Request, res: Response) => {
  try {
    const [
      totalDevelopers,
      totalAgents,
      activeAgents,
      suspendedAgents,
      bannedAgents,
      totalActions,
      totalCertificates,
      totalReports,
      recentActions
    ] = await Promise.all([
      prisma.developer.count(),
      prisma.agent.count(),
      prisma.agent.count({ where: { status: 'active' } }),
      prisma.agent.count({ where: { status: 'suspended' } }),
      prisma.agent.count({ where: { status: 'banned' } }),
      prisma.action.count(),
      prisma.certificate.count(),
      prisma.gatewayReport.count(),
      prisma.action.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        developers: totalDevelopers,
        agents: {
          total: totalAgents,
          active: activeAgents,
          suspended: suspendedAgents,
          banned: bannedAgents
        },
        actions: {
          total: totalActions,
          last24h: recentActions
        },
        certificates: totalCertificates,
        gatewayReports: totalReports,
        defi: isDefiEnabled() ? await getDefiOverview().catch(() => null) : null,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Dashboard overview error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch overview' });
  }
});

/**
 * GET /dashboard/api/agents
 * List all agents with their reputation scores and stats
 */
router.get('/api/agents', dashboardAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    // Whitelist allowed sort columns to prevent prototype pollution and
    // ordering by sensitive columns (#15)
    const ALLOWED_SORT_COLUMNS = new Set([
      'reputationScore', 'totalActions', 'successfulActions', 'failedActions',
      'stakeAmount', 'createdAt', 'externalId', 'status'
    ]);
    const sortInput = (req.query.sort as string) || 'reputationScore';
    const sortBy = ALLOWED_SORT_COLUMNS.has(sortInput) ? sortInput : 'reputationScore';
    const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';

    const agents = await prisma.agent.findMany({
      take: limit,
      orderBy: { [sortBy]: order },
      include: {
        developer: {
          select: { companyName: true }
        },
        _count: {
          select: {
            actions: true,
            certificates: true,
            vouchesReceived: true,
            vouchesGiven: true,
            gatewayReports: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: agents.map(a => ({
        id: a.id,
        externalId: a.externalId,
        developer: a.developer.companyName,
        status: a.status,
        reputationScore: a.reputationScore,
        identityVerified: a.identityVerified,
        totalActions: a.totalActions,
        successfulActions: a.successfulActions,
        failedActions: a.failedActions,
        successRate: a.totalActions > 0
          ? Math.round((a.successfulActions / a.totalActions) * 100)
          : 0,
        stakeAmount: Number(a.stakeAmount),
        certificates: a._count.certificates,
        vouchesReceived: a._count.vouchesReceived,
        vouchesGiven: a._count.vouchesGiven,
        gatewayReports: a._count.gatewayReports,
        createdAt: a.createdAt
      }))
    });
  } catch (error) {
    console.error('Dashboard agents error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch agents' });
  }
});

/**
 * GET /dashboard/api/actions/recent
 * Most recent actions across all agents
 */
router.get('/api/actions/recent', dashboardAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

    const actions = await prisma.action.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        agent: {
          select: { externalId: true, reputationScore: true, status: true }
        }
      }
    });

    res.json({
      success: true,
      data: actions.map(a => ({
        id: a.id,
        agentExternalId: a.agent.externalId,
        agentScore: a.agent.reputationScore,
        agentStatus: a.agent.status,
        actionType: a.actionType,
        decision: a.decision,
        reason: a.reason,
        metadata: a.metadata,
        createdAt: a.createdAt
      }))
    });
  } catch (error) {
    console.error('Dashboard recent actions error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch actions' });
  }
});

/**
 * GET /dashboard/api/reputation/distribution
 * Distribution of agent reputation scores (for histogram)
 */
router.get('/api/reputation/distribution', dashboardAuth, async (_req: Request, res: Response) => {
  try {
    const agents = await prisma.agent.findMany({
      select: { reputationScore: true }
    });

    // Bucket scores into ranges
    const buckets: Record<string, number> = {
      '0-10': 0, '11-20': 0, '21-30': 0, '31-40': 0, '41-50': 0,
      '51-60': 0, '61-70': 0, '71-80': 0, '81-90': 0, '91-100': 0
    };

    for (const agent of agents) {
      const score = agent.reputationScore;
      if (score <= 10) buckets['0-10']++;
      else if (score <= 20) buckets['11-20']++;
      else if (score <= 30) buckets['21-30']++;
      else if (score <= 40) buckets['31-40']++;
      else if (score <= 50) buckets['41-50']++;
      else if (score <= 60) buckets['51-60']++;
      else if (score <= 70) buckets['61-70']++;
      else if (score <= 80) buckets['71-80']++;
      else if (score <= 90) buckets['81-90']++;
      else buckets['91-100']++;
    }

    res.json({
      success: true,
      data: {
        distribution: buckets,
        totalAgents: agents.length,
        averageScore: agents.length > 0
          ? Math.round(agents.reduce((sum, a) => sum + a.reputationScore, 0) / agents.length)
          : 0
      }
    });
  } catch (error) {
    console.error('Dashboard distribution error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch distribution' });
  }
});

/**
 * GET /dashboard/api/activity/timeline
 * Actions over time (grouped by hour, last 24h)
 */
router.get('/api/activity/timeline', dashboardAuth, async (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const actions = await prisma.action.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, decision: true },
      orderBy: { createdAt: 'asc' }
    });

    // Group by hour
    const hourly: Record<string, { allowed: number; denied: number }> = {};

    for (let h = 0; h < 24; h++) {
      const hourDate = new Date(since.getTime() + h * 60 * 60 * 1000);
      const key = hourDate.toISOString().substring(0, 13); // YYYY-MM-DDTHH
      hourly[key] = { allowed: 0, denied: 0 };
    }

    for (const action of actions) {
      const key = action.createdAt.toISOString().substring(0, 13);
      if (hourly[key]) {
        if (action.decision === 'allowed') hourly[key].allowed++;
        else hourly[key].denied++;
      }
    }

    res.json({
      success: true,
      data: Object.entries(hourly).map(([hour, counts]) => ({
        hour,
        ...counts,
        total: counts.allowed + counts.denied
      }))
    });
  } catch (error) {
    console.error('Dashboard timeline error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch timeline' });
  }
});

/**
 * GET /dashboard/api/certificates/recent
 * Recently issued certificates
 */
router.get('/api/certificates/recent', dashboardAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const certs = await prisma.certificate.findMany({
      take: limit,
      orderBy: { issuedAt: 'desc' },
      include: {
        agent: {
          select: { externalId: true, reputationScore: true }
        }
      }
    });

    res.json({
      success: true,
      data: certs.map(c => ({
        jti: c.jti,
        agentExternalId: c.agent.externalId,
        scoreAtIssuance: c.score,
        currentScore: c.agent.reputationScore,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        revoked: c.revoked,
        expired: c.expiresAt < new Date()
      }))
    });
  } catch (error) {
    console.error('Dashboard certificates error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch certificates' });
  }
});

/**
 * GET /dashboard/api/gateways
 * Gateway report summary (which gateways are reporting)
 */
router.get('/api/gateways', dashboardAuth, async (_req: Request, res: Response) => {
  try {
    const reports = await prisma.gatewayReport.findMany({
      select: {
        gatewayId: true,
        actionsCount: true,
        successCount: true,
        failureCount: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Aggregate by gateway
    const gateways: Record<string, {
      totalReports: number;
      totalActions: number;
      totalSuccess: number;
      totalFailures: number;
      lastReport: Date;
    }> = {};

    for (const r of reports) {
      if (!gateways[r.gatewayId]) {
        gateways[r.gatewayId] = {
          totalReports: 0,
          totalActions: 0,
          totalSuccess: 0,
          totalFailures: 0,
          lastReport: r.createdAt
        };
      }
      gateways[r.gatewayId].totalReports++;
      gateways[r.gatewayId].totalActions += r.actionsCount;
      gateways[r.gatewayId].totalSuccess += r.successCount;
      gateways[r.gatewayId].totalFailures += r.failureCount;
      if (r.createdAt > gateways[r.gatewayId].lastReport) {
        gateways[r.gatewayId].lastReport = r.createdAt;
      }
    }

    res.json({
      success: true,
      data: Object.entries(gateways).map(([id, stats]) => ({
        gatewayId: id,
        ...stats,
        successRate: stats.totalActions > 0
          ? Math.round((stats.totalSuccess / stats.totalActions) * 100)
          : 0
      }))
    });
  } catch (error) {
    console.error('Dashboard gateways error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch gateways' });
  }
});

/**
 * GET /dashboard/api/defi
 * DeFi ecosystem stats: token, staking, markets, insurance, vouches
 */
router.get('/api/defi', dashboardAuth, async (_req: Request, res: Response) => {
  try {
    if (!isDefiEnabled()) {
      return res.json({
        success: true,
        data: { enabled: false }
      });
    }

    const {
      getTrustStats,
      getStakingStats,
      getMarketStats,
      getInsuranceStats,
      getVouchMarketStats
    } = require('../services/defi');

    const [trustStats, stakingStats, marketStats, insuranceStats, vouchStats] =
      await Promise.all([
        getTrustStats().catch(() => null),
        getStakingStats().catch(() => null),
        getMarketStats().catch(() => null),
        getInsuranceStats().catch(() => null),
        getVouchMarketStats().catch(() => null),
      ]);

    res.json({
      success: true,
      data: {
        enabled: true,
        token: trustStats
          ? {
              name: trustStats.name,
              symbol: trustStats.symbol,
              totalSupply: trustStats.totalSupply,
              circulatingSupply: trustStats.circulatingSupply,
            }
          : null,
        staking: stakingStats
          ? {
              totalStaked: stakingStats.totalStaked,
              cooldownPeriod: stakingStats.cooldownPeriod,
              slashBasisPoints: stakingStats.slashBasisPoints,
            }
          : null,
        markets: marketStats
          ? {
              nextMarketId: marketStats.nextMarketId,
              totalVolume: marketStats.totalVolume,
              activeMarkets: marketStats.activeMarkets,
            }
          : null,
        insurance: insuranceStats
          ? {
              totalCollateral: insuranceStats.totalCollateral,
              totalPremiums: insuranceStats.totalPremiums,
              activePolicies: insuranceStats.activePolicies,
            }
          : null,
        vouches: vouchStats
          ? {
              totalVouches: vouchStats.totalVouches,
              activeVouches: vouchStats.activeVouches,
            }
          : null,
        contracts: {
          trustToken: '0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2',
          stakingVault: '0x055a8441F18B07Ae0F4967A2d114dB1D7059FdD0',
          reputationMarket: '0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD',
          insurancePool: '0x35E74a62D538325F50c635ad518E5ae469527f88',
          vouchMarket: '0x19b1606219fA6F3C76d5753A2bc6C779a502bf25',
          governor: '0x1e548DC82c7B4d362c84084bd92263BCA6ecf17B',
          timelock: '0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1',
        },
        network: 'Base (Chain ID: 8453)',
        timestamp: new Date().toISOString(),
      }
    });
  } catch (error) {
    console.error('Dashboard DeFi error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch DeFi stats' });
  }
});

/**
 * GET /dashboard/api/agents/:agentId/momentum
 * Reputation momentum for a specific agent (velocity based on recent events)
 */
router.get('/api/agents/:agentId/momentum', dashboardAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // Get last 20 reputation events with timestamps
    const events = await prisma.reputationEvent.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Calculate momentum (velocity of score changes)
    let momentum = 0;
    let trend: 'improving' | 'declining' | 'stable' = 'stable';

    if (events.length >= 3) {
      let weightedSum = 0;
      let totalWeight = 0;
      for (let i = 0; i < events.length; i++) {
        const weight = events.length - i;
        weightedSum += events[i].scoreChange * weight;
        totalWeight += weight;
      }
      momentum = Math.round((weightedSum / totalWeight) * 100) / 100;

      if (momentum > 0.5) trend = 'improving';
      else if (momentum < -0.5) trend = 'declining';
    }

    // Build time series for charting
    const timeSeries = events.reverse().map(e => ({
      timestamp: e.createdAt.toISOString(),
      type: e.eventType,
      scoreChange: e.scoreChange,
    }));

    res.json({
      success: true,
      data: {
        agentId,
        currentScore: agent.reputationScore,
        momentum,
        trend,
        recentEvents: timeSeries,
        totalEvents: events.length,
      }
    });
  } catch (error) {
    console.error('Dashboard momentum error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch momentum' });
  }
});

export default router;
