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
const testApiKey = 'ats_InsurTestKey12345ABCDEFGHI';
const testKeyHash = bcrypt.hashSync(testApiKey, 10);
const testFingerprint = crypto.createHash('sha256').update(testApiKey).digest('hex').slice(0, 16);

const mockDeveloper = {
  id: 'dev-insur',
  email: 'insur@example.com',
  companyName: 'InsurCo',
  plan: 'pro',
  apiKeyHash: testKeyHash,
  apiKeyFingerprint: testFingerprint,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function authenticatedRequest() {
  mockPrisma.developer.findFirst.mockResolvedValue(mockDeveloper);
}

describe('Insurance Routes', () => {
  describe('GET /insurance/stats', () => {
    it('should return insurance pool stats', async () => {
      const res = await request(app).get('/insurance/stats');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('totalCollateral');
      expect(res.body.data).toHaveProperty('totalPremiums');
      expect(res.body.data).toHaveProperty('activePolicies');
    });

    it('should return disabled when DeFi off', async () => {
      const defi = require('../../services/defi');
      defi.isDefiEnabled.mockReturnValueOnce(false);

      const res = await request(app).get('/insurance/stats');
      expect(res.body.data).toHaveProperty('enabled', false);
    });
  });

  describe('POST /insurance/collateral/deposit', () => {
    it('should deposit collateral for an agent', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/insurance/collateral/deposit')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123', amount: '5000' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('txHash');
    });

    it('should reject without agentId', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/insurance/collateral/deposit')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ amount: '5000' });
      expect(res.status).toBe(400);
    });

    it('should reject without amount', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/insurance/collateral/deposit')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123' });
      expect(res.status).toBe(400);
    });

    it('should handle deposit failure', async () => {
      authenticatedRequest();
      const defi = require('../../services/defi');
      defi.depositInsuranceCollateral.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/insurance/collateral/deposit')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123', amount: '5000' });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /insurance/buy', () => {
    it('should buy an insurance policy', async () => {
      authenticatedRequest();
      const futureDate = new Date(Date.now() + 30 * 86400000).toISOString();

      const res = await request(app)
        .post('/insurance/buy')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({
          agentId: 'agent-123',
          coverageAmount: '10000',
          triggerScore: 40,
          expiresAt: futureDate,
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('txHash');
      expect(res.body.data).toHaveProperty('coverageAmount', '10000');
      expect(res.body.data).toHaveProperty('triggerScore', 40);
    });

    it('should reject without all required fields', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/insurance/buy')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'agent-123', coverageAmount: '10000' });
      expect(res.status).toBe(400);
    });

    it('should handle policy purchase failure', async () => {
      authenticatedRequest();
      const defi = require('../../services/defi');
      defi.buyInsurancePolicy.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/insurance/buy')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({
          agentId: 'agent-123',
          coverageAmount: '10000',
          triggerScore: 40,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /insurance/:id/claim', () => {
    it('should file a claim', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/insurance/1/claim')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('txHash');
      expect(res.body.data).toHaveProperty('policyId', 1);
    });

    it('should reject non-numeric policy ID', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/insurance/abc/claim')
        .set('Authorization', `Bearer ${testApiKey}`);
      expect(res.status).toBe(400);
    });

    it('should handle claim failure', async () => {
      authenticatedRequest();
      const defi = require('../../services/defi');
      defi.fileInsuranceClaim.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/insurance/2/claim')
        .set('Authorization', `Bearer ${testApiKey}`);
      expect(res.status).toBe(500);
    });
  });
});
