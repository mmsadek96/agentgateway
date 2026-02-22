// Mock prisma, blockchain, defi FIRST (jest.mock is auto-hoisted)
const mockPrisma: any = {
  developer: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  agent: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  action: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  vouch: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  reputationEvent: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
  certificate: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  gatewayReport: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
  $connect: jest.fn(),
  $disconnect: jest.fn(),
};
jest.mock('../../db/prisma', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../services/blockchain', () => ({ initBlockchain: jest.fn(), registerAgentOnChain: jest.fn().mockResolvedValue('0xmocktx'), recordActionOnChain: jest.fn().mockResolvedValue(null), uuidToBytes32: jest.fn(() => '0x' + 'a'.repeat(64)), isBlockchainEnabled: jest.fn().mockReturnValue(false) }));
jest.mock('../../services/defi', () => ({ initDefiContracts: jest.fn(), isDefiEnabled: jest.fn().mockReturnValue(true), getTrustStats: jest.fn().mockResolvedValue({ totalSupply: '1000000000', circulatingSupply: '50000000', name: 'Trust Token', symbol: 'TRUST' }), getStakingStats: jest.fn().mockResolvedValue({ totalStaked: '500000', cooldownPeriod: 604800, slashBasisPoints: 1000 }), getMarketStats: jest.fn().mockResolvedValue({ nextMarketId: 3, totalVolume: '50000', activeMarkets: 2 }), getInsuranceStats: jest.fn().mockResolvedValue({ totalCollateral: '100000', totalPremiums: '5000', activePolicies: 3 }), getVouchMarketStats: jest.fn().mockResolvedValue({ totalVouches: 15, activeVouches: 12 }), getDefiOverview: jest.fn().mockResolvedValue({ trustToken: { totalSupply: '1000000000', symbol: 'TRUST' }, staking: { totalStaked: '500000' }, markets: { activeMarkets: 2 }, insurance: { totalCollateral: '100000' }, vouches: { totalVouches: 15 } }), mintTrust: jest.fn().mockResolvedValue('0xmocktx'), stakeForAgent: jest.fn().mockResolvedValue('0xmocktx'), requestUnstake: jest.fn().mockResolvedValue('0xmocktx'), completeUnstake: jest.fn().mockResolvedValue('0xmocktx'), getStakeInfo: jest.fn().mockResolvedValue({ stakedAmount: '1000', unstakeRequestAmount: '0', unstakeRequestTime: null, stakeScore: 10 }), createMarket: jest.fn().mockResolvedValue('0xmocktx'), placeBet: jest.fn().mockResolvedValue('0xmocktx'), settleMarket: jest.fn().mockResolvedValue('0xmocktx'), claimWinnings: jest.fn().mockResolvedValue('0xmocktx'), getMarketInfo: jest.fn().mockResolvedValue({ agentId: '0x' + 'a'.repeat(64), targetScore: 750, expiresAt: Math.floor(Date.now()/1000) + 86400, yesPool: '10000', noPool: '5000', settled: false, outcome: null }), depositInsuranceCollateral: jest.fn().mockResolvedValue('0xmocktx'), buyInsurancePolicy: jest.fn().mockResolvedValue('0xmocktx'), fileInsuranceClaim: jest.fn().mockResolvedValue('0xmocktx'), mintVouchNft: jest.fn().mockResolvedValue('0xmocktx'), getVouchNftInfo: jest.fn().mockResolvedValue({ voucherAgentId: '0x' + 'a'.repeat(64), vouchedAgentId: '0x' + 'b'.repeat(64), voucherScoreAtMint: 85, weight: 3, active: true }), getVouchScore: jest.fn().mockResolvedValue(12), getTrustBalance: jest.fn().mockResolvedValue({ trust: '1000.0', stTrust: '500.0' }) }));

import request from 'supertest';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import app from '../../app';

// Suppress console
beforeAll(() => { console.error = jest.fn(); console.log = jest.fn(); });
beforeEach(() => { jest.clearAllMocks(); });

// Auth helpers
const testApiKey = 'ats_TestDevRouteKey1234ABCDEF00';
const testKeyHash = bcrypt.hashSync(testApiKey, 10);
const testFingerprint = crypto.createHash('sha256').update(testApiKey).digest('hex').slice(0, 16);

const mockDeveloper = {
  id: 'dev-456',
  email: 'dev@example.com',
  companyName: 'DevCo',
  plan: 'starter',
  apiKeyHash: testKeyHash,
  apiKeyFingerprint: testFingerprint,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date(),
};

function authenticatedRequest() {
  mockPrisma.developer.findFirst.mockResolvedValue(mockDeveloper);
}

describe('Developer Routes', () => {
  describe('POST /developers/register', () => {
    it('should register a new developer and return API key', async () => {
      mockPrisma.developer.findUnique.mockResolvedValue(null);
      mockPrisma.developer.create.mockResolvedValue({
        ...mockDeveloper,
        plan: 'free',
      });

      const res = await request(app)
        .post('/developers/register')
        .send({ email: 'newdev@example.com', companyName: 'NewCo' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('apiKey');
      expect(res.body.data.apiKey).toMatch(/^ats_/);
      expect(res.body.data).toHaveProperty('email');
      expect(res.body.data).toHaveProperty('companyName');
    });

    it('should reject registration without email', async () => {
      const res = await request(app)
        .post('/developers/register')
        .send({ companyName: 'NoCo' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject registration without company name', async () => {
      const res = await request(app)
        .post('/developers/register')
        .send({ email: 'solo@example.com' });
      expect(res.status).toBe(400);
    });

    it('should reject duplicate email', async () => {
      mockPrisma.developer.findUnique.mockResolvedValue(mockDeveloper);

      const res = await request(app)
        .post('/developers/register')
        .send({ email: 'dev@example.com', companyName: 'DupCo' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already registered/i);
    });
  });

  describe('GET /developers/dashboard', () => {
    it('should return developer dashboard stats', async () => {
      authenticatedRequest();
      const mockAgents = [
        { id: 'a1', externalId: 'ext-1', reputationScore: 80, totalActions: 50, successfulActions: 45, failedActions: 5, status: 'active' },
        { id: 'a2', externalId: 'ext-2', reputationScore: 60, totalActions: 30, successfulActions: 20, failedActions: 10, status: 'active' },
      ];
      mockPrisma.agent.findMany.mockResolvedValue(mockAgents);
      mockPrisma.action.count.mockResolvedValue(12);

      const res = await request(app)
        .get('/developers/dashboard')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.data.stats).toHaveProperty('totalAgents', 2);
      expect(res.body.data.stats).toHaveProperty('activeAgents', 2);
      expect(res.body.data.stats).toHaveProperty('totalActions', 80);
      expect(res.body.data.stats).toHaveProperty('actionsLast24Hours', 12);
      expect(res.body.data.stats).toHaveProperty('averageReputationScore', 70);
    });

    it('should handle developer with no agents', async () => {
      authenticatedRequest();
      mockPrisma.agent.findMany.mockResolvedValue([]);
      mockPrisma.action.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/developers/dashboard')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.data.stats.totalAgents).toBe(0);
      expect(res.body.data.stats.averageReputationScore).toBe(0);
    });
  });

  describe('POST /developers/agents', () => {
    it('should register a new agent', async () => {
      authenticatedRequest();
      mockPrisma.agent.findUnique.mockResolvedValue(null);
      mockPrisma.agent.create.mockResolvedValue({
        id: 'agent-new',
        externalId: 'my-agent-1',
        developerId: mockDeveloper.id,
        reputationScore: 50,
        status: 'active',
        totalActions: 0,
        successfulActions: 0,
        failedActions: 0,
        identityVerified: false,
        stakeAmount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/developers/agents')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ externalId: 'my-agent-1' });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('externalId', 'my-agent-1');
      expect(res.body.data).toHaveProperty('reputationScore', 50);
    });

    it('should reject agent registration without externalId', async () => {
      authenticatedRequest();
      const res = await request(app)
        .post('/developers/agents')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('should reject duplicate agent externalId', async () => {
      authenticatedRequest();
      mockPrisma.agent.findUnique.mockResolvedValue({ id: 'existing' });

      const res = await request(app)
        .post('/developers/agents')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ externalId: 'existing-agent' });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /developers/agents', () => {
    it('should list agents for developer', async () => {
      authenticatedRequest();
      mockPrisma.agent.findMany.mockResolvedValue([
        {
          id: 'a1', externalId: 'ext-1', identityVerified: false,
          reputationScore: 75, totalActions: 100, successfulActions: 90,
          failedActions: 10, stakeAmount: 500, status: 'active',
          createdAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get('/developers/agents')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toHaveProperty('externalId', 'ext-1');
      expect(res.body.data[0]).toHaveProperty('reputationScore', 75);
    });
  });
});
