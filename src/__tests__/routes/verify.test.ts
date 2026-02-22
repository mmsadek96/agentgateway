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
jest.mock('../../services/verification', () => ({
  verifyAgent: jest.fn().mockResolvedValue({
    allowed: true,
    agentId: 'ext-1',
    reputationScore: 78,
    threshold: 50,
    actionId: 'action-123',
    factors: { base: 50, stake: 10, vouches: 5, successRate: 8, age: 5 },
  }),
  reportOutcome: jest.fn().mockResolvedValue({
    actionId: 'action-123',
    outcome: 'success',
    reputationDelta: 2,
    newScore: 80,
  }),
}));

import request from 'supertest';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import app from '../../app';

// Suppress console
beforeAll(() => { console.error = jest.fn(); console.log = jest.fn(); });
beforeEach(() => { jest.clearAllMocks(); });

// Auth helpers
const testApiKey = 'ats_VerifyTestKey12345ABCDEFGH';
const testKeyHash = bcrypt.hashSync(testApiKey, 10);
const testFingerprint = crypto.createHash('sha256').update(testApiKey).digest('hex').slice(0, 16);

const mockDeveloper = {
  id: 'dev-verify',
  email: 'verify@example.com',
  companyName: 'VerifyCo',
  plan: 'pro',
  apiKeyHash: testKeyHash,
  apiKeyFingerprint: testFingerprint,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function authenticatedRequest() {
  mockPrisma.developer.findFirst.mockResolvedValue(mockDeveloper);
}

describe('Verify Routes', () => {
  describe('POST /verify', () => {
    it('should verify an agent action', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/verify')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({
          agentId: 'ext-1',
          actionType: 'form_submit',
          threshold: 50,
          context: { url: 'https://example.com' },
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('allowed', true);
      expect(res.body.data).toHaveProperty('reputationScore');
      expect(res.body.data).toHaveProperty('actionId');
    });

    it('should reject verification without agentId', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/verify')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ actionType: 'form_submit' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/agentId/i);
    });

    it('should reject verification without actionType', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/verify')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ agentId: 'ext-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/actionType/i);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/verify')
        .send({ agentId: 'ext-1', actionType: 'test' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /report', () => {
    it('should report action outcome', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/report')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ actionId: 'action-123', outcome: 'success' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('outcome', 'success');
    });

    it('should reject report without actionId', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/report')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ outcome: 'success' });
      expect(res.status).toBe(400);
    });

    it('should reject invalid outcome', async () => {
      authenticatedRequest();

      const res = await request(app)
        .post('/report')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ actionId: 'action-123', outcome: 'maybe' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/outcome/i);
    });

    it('should accept "failure" outcome', async () => {
      authenticatedRequest();
      const { reportOutcome } = require('../../services/verification');
      reportOutcome.mockResolvedValue({
        actionId: 'action-456',
        outcome: 'failure',
        reputationDelta: -5,
        newScore: 73,
      });

      const res = await request(app)
        .post('/report')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ actionId: 'action-456', outcome: 'failure' });

      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('failure');
    });
  });
});
