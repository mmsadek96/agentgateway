import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { generateApiKey, hashApiKey, authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import { registerAgentOnChain } from '../services/blockchain';

const router = Router();

// Register a new developer
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, companyName } = req.body;

    if (!email || !companyName) {
      res.status(400).json({ success: false, error: 'Email and company name required' });
      return;
    }

    // Check if email already exists
    const existing = await prisma.developer.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, error: 'Email already registered' });
      return;
    }

    // Generate API key
    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);

    // Create developer
    const developer = await prisma.developer.create({
      data: {
        email,
        companyName,
        apiKeyHash
      }
    });

    res.status(201).json({
      success: true,
      data: {
        id: developer.id,
        email: developer.email,
        companyName: developer.companyName,
        plan: developer.plan,
        apiKey, // Only returned once at registration
        createdAt: developer.createdAt
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// Get developer dashboard stats
router.get('/dashboard', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;

    // Get agent stats
    const agents = await prisma.agent.findMany({
      where: { developerId },
      select: {
        id: true,
        externalId: true,
        reputationScore: true,
        totalActions: true,
        successfulActions: true,
        failedActions: true,
        status: true
      }
    });

    // Get recent actions count
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentActions = await prisma.action.count({
      where: {
        agent: { developerId },
        createdAt: { gte: last24Hours }
      }
    });

    // Calculate totals
    const totalAgents = agents.length;
    const activeAgents = agents.filter(a => a.status === 'active').length;
    const totalActions = agents.reduce((sum, a) => sum + a.totalActions, 0);
    const avgReputationScore = totalAgents > 0
      ? Math.round(agents.reduce((sum, a) => sum + a.reputationScore, 0) / totalAgents)
      : 0;

    res.json({
      success: true,
      data: {
        developer: req.developer,
        stats: {
          totalAgents,
          activeAgents,
          totalActions,
          actionsLast24Hours: recentActions,
          averageReputationScore: avgReputationScore
        },
        agents
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, error: 'Failed to load dashboard' });
  }
});

// Register a new agent
router.post('/agents', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;
    const { externalId } = req.body;

    if (!externalId) {
      res.status(400).json({ success: false, error: 'External ID required' });
      return;
    }

    // Check if agent already exists for this developer
    const existing = await prisma.agent.findUnique({
      where: { developerId_externalId: { developerId, externalId } }
    });

    if (existing) {
      res.status(409).json({ success: false, error: 'Agent with this external ID already exists' });
      return;
    }

    // Create agent
    const agent = await prisma.agent.create({
      data: {
        externalId,
        developerId
      }
    });

    // Register on-chain (non-blocking — doesn't fail the API call)
    const txHash = await registerAgentOnChain(agent.id, externalId, req.developer!.email);

    res.status(201).json({
      success: true,
      data: {
        id: agent.id,
        externalId: agent.externalId,
        reputationScore: agent.reputationScore,
        status: agent.status,
        createdAt: agent.createdAt,
        ...(txHash ? { onChainTx: txHash } : {})
      }
    });
  } catch (error) {
    console.error('Agent registration error:', error);
    res.status(500).json({ success: false, error: 'Failed to register agent' });
  }
});

// List all agents for developer
router.get('/agents', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const developerId = req.developer!.id;

    const agents = await prisma.agent.findMany({
      where: { developerId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: agents.map(agent => ({
        id: agent.id,
        externalId: agent.externalId,
        identityVerified: agent.identityVerified,
        reputationScore: agent.reputationScore,
        totalActions: agent.totalActions,
        successfulActions: agent.successfulActions,
        failedActions: agent.failedActions,
        stakeAmount: agent.stakeAmount,
        status: agent.status,
        createdAt: agent.createdAt
      }))
    });
  } catch (error) {
    console.error('List agents error:', error);
    res.status(500).json({ success: false, error: 'Failed to list agents' });
  }
});

export default router;
