import { Router, Request, Response } from 'express';
import path from 'path';
import prisma from '../db/prisma';
import { getDefiOverview, isDefiEnabled } from '../services/defi';

const router = Router();

// ─── Dashboard Page ───

router.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

// ─── Dashboard API Endpoints ───

/**
 * GET /dashboard/api/overview
 * High-level platform stats: total developers, agents, actions, certificates
 */
router.get('/api/overview', async (_req: Request, res: Response) => {
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
router.get('/api/agents', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const sortBy = (req.query.sort as string) || 'reputationScore';
    const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';

    const agents = await prisma.agent.findMany({
      take: limit,
      orderBy: { [sortBy]: order },
      include: {
        developer: {
          select: { companyName: true, email: true }
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
router.get('/api/actions/recent', async (req: Request, res: Response) => {
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
router.get('/api/reputation/distribution', async (_req: Request, res: Response) => {
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
router.get('/api/activity/timeline', async (_req: Request, res: Response) => {
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
router.get('/api/certificates/recent', async (req: Request, res: Response) => {
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
router.get('/api/gateways', async (_req: Request, res: Response) => {
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
 * GET /dashboard/api/agents/:agentId/momentum
 * Reputation momentum for a specific agent (velocity based on recent events)
 */
router.get('/api/agents/:agentId/momentum', async (req: Request, res: Response) => {
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
