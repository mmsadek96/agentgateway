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
const testApiKey = 'ats_MarketTestKey12345ABCDEFGH';
const testKeyHash = bcrypt.hashSync(testApiKey, 10);
const testFingerprint = crypto.createHash('sha256').update(testApiKey).digest('hex').slice(0, 16);

const mockDeveloper = {
  id: 'dev-market',
  email: 'market@example.com',
  companyName: 'MarketCo',
  plan: 'pro',
  apiKeyHash: testKeyHash,
  apiKeyFingerprint: testFingerprint,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function authenticatedRequest() {
  mockPrisma.developer.findFirst.mockResolvedValue(mockDeveloper);
}

describe('Reputation Markets Routes', () => {
  describe('GET /markets/stats', () => {
    it('should return market stats when DeFi enabled', async () => {
      const res = await request(app).get('/markets/stats');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('nextMarketId');
      expect(res.body.data).toHaveProperty('totalVolume');
      expect(res.body.data).toHaveProperty('activeMarkets');
    });

    it('should return disabled when DeFi off', async () => {
      const defi = require('../../services/defi');
      defi.isDefiEnabled.mockReturnValueOnce(false);

      const res = await request(app).get('/markets/stats');
      expect(res.body.data).toHaveProperty('enabled', false);
    });
  });

  describe('GET /markets/:id', () => {
    it('should return market details by ID', async () => {
      const res = await request(app).get('/markets/1');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('targetScore');
      expect(res.body.data).toHaveProperty('yesPool');
      expect(res.body.data).toHaveProperty('noPool');
    });

    it('should return 400 for non-numeric ID', async () => {
      const res = await request(app).get('/markets/abc');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid/i);
    });

    it('should return 404 for nonexistent market', async () => {
      const defi = require('../../services/defi');
      defi.getMarketInfo.mockResolvedValueOnce(null);

      const res = await request(app).get('/markets/999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /markets/create', () => {
    it('should create a new reputation market', async () => {
      authenticatedRequest();
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      const res = await request(app)
        .post('/markets/create')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({
          agentId: 'agent-123',
          targetScore: 75,
          expiresAt: futureDate,
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('txHash');
      expect(res.body.data).toHaveProperty('targetScore', 75);
    });

    it('should reject without required fields', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/markets/create')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123' });
      expect(res.status).toBe(400);
    });

    it('should handle blockchain failure', async () => {
      authenticatedRequest();
      const defi = require('../../services/defi');
      defi.createMarket.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/markets/create')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({
          agentId: 'agent-123',
          targetScore: 75,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /markets/:id/bet', () => {
    it('should place a YES bet', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/markets/1/bet')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ side: 'yes', amount: '100', agentId: 'agent-123' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('txHash');
      expect(res.body.data).toHaveProperty('side', 'yes');
    });

    it('should place a NO bet', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/markets/1/bet')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ side: 'no', amount: '200', agentId: 'agent-456' });

      expect(res.status).toBe(200);
      expect(res.body.data.side).toBe('no');
    });

    it('should reject invalid side', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/markets/1/bet')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ side: 'maybe', amount: '100', agentId: 'agent-123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/side/i);
    });

    it('should reject missing required fields', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/markets/1/bet')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ side: 'yes' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /markets/:id/settle', () => {
    it('should settle an expired market', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/markets/1/settle')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('txHash');
      expect(res.body.data).toHaveProperty('marketId', 1);
    });

    it('should handle settlement failure', async () => {
      authenticatedRequest();
      const defi = require('../../services/defi');
      defi.settleMarket.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/markets/1/settle')
        .set('Authorization', `Bearer ${testApiKey}`);
      expect(res.status).toBe(500);
    });
  });

  describe('POST /markets/:id/claim', () => {
    it('should claim winnings', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/markets/1/claim')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('txHash');
    });
  });
});
