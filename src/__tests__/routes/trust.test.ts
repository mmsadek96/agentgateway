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
const testApiKey = 'ats_TrustTestKey12345ABCDEFGHI';
const testKeyHash = bcrypt.hashSync(testApiKey, 10);
const testFingerprint = crypto.createHash('sha256').update(testApiKey).digest('hex').slice(0, 16);

const mockDeveloper = {
  id: 'dev-trust',
  email: 'trust@example.com',
  companyName: 'TrustCo',
  plan: 'pro',
  apiKeyHash: testKeyHash,
  apiKeyFingerprint: testFingerprint,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function authenticatedRequest() {
  mockPrisma.developer.findFirst.mockResolvedValue(mockDeveloper);
}

describe('Trust & Staking Routes', () => {
  describe('GET /trust/stats', () => {
    it('should return token stats when DeFi is enabled', async () => {
      const res = await request(app).get('/trust/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('enabled', true);
      expect(res.body.data).toHaveProperty('totalSupply');
      expect(res.body.data).toHaveProperty('symbol', 'TRUST');
    });

    it('should return disabled status when DeFi is off', async () => {
      const defi = require('../../services/defi');
      defi.isDefiEnabled.mockReturnValueOnce(false);

      const res = await request(app).get('/trust/stats');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('enabled', false);
    });
  });

  describe('GET /trust/balance/:agentId', () => {
    it('should return agent balance with auth', async () => {
      authenticatedRequest();

      const res = await request(app)
        .get('/trust/balance/agent-123')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('agentId', 'agent-123');
      expect(res.body.data).toHaveProperty('stake');
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/trust/balance/agent-123');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /trust/stake', () => {
    it('should stake $TRUST for an agent', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/trust/stake')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123', amount: '1000' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('txHash');
      expect(res.body.data.txHash).toMatch(/^0x/);
    });

    it('should reject stake without agentId', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/trust/stake')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ amount: '1000' });
      expect(res.status).toBe(400);
    });

    it('should reject stake without amount', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/trust/stake')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123' });
      expect(res.status).toBe(400);
    });

    it('should handle blockchain failure gracefully', async () => {
      authenticatedRequest();
      const defi = require('../../services/defi');
      defi.stakeForAgent.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/trust/stake')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123', amount: '1000' });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/failed|unavailable/i);
    });
  });

  describe('POST /trust/unstake/request', () => {
    it('should request unstake with cooldown', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/trust/unstake/request')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123', amount: '500' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('txHash');
    });

    it('should reject without required fields', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/trust/unstake/request')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /trust/unstake/complete', () => {
    it('should complete unstake after cooldown', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/trust/unstake/complete')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('txHash');
    });

    it('should reject without agentId', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/trust/unstake/complete')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('should handle cooldown not over', async () => {
      authenticatedRequest();
      const defi = require('../../services/defi');
      defi.completeUnstake.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/trust/unstake/complete')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123' });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /trust/stake/:agentId', () => {
    it('should return staking info for agent', async () => {
      authenticatedRequest();

      const res = await request(app)
        .get('/trust/stake/agent-123')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('stakedAmount');
      expect(res.body.data).toHaveProperty('stakeScore');
    });
  });

  describe('GET /trust/staking/stats', () => {
    it('should return overall staking stats (public)', async () => {
      const res = await request(app).get('/trust/staking/stats');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('totalStaked');
      expect(res.body.data).toHaveProperty('cooldownPeriod');
    });
  });
});
