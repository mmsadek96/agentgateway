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

// Test API key and its derived values
const testApiKey = 'ats_TestApiKey1234567890ABCDEF';
const testKeyHash = bcrypt.hashSync(testApiKey, 10);
const testFingerprint = crypto.createHash('sha256').update(testApiKey).digest('hex').slice(0, 16);

const mockDeveloper = {
  id: 'dev-123',
  email: 'test@example.com',
  companyName: 'TestCo',
  plan: 'free',
  apiKeyHash: testKeyHash,
  apiKeyFingerprint: testFingerprint,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Authentication Middleware', () => {
  describe('Missing Authorization', () => {
    it('should reject requests without Authorization header', async () => {
      const res = await request(app).get('/developers/dashboard');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toMatch(/missing|invalid/i);
    });

    it('should reject requests with non-Bearer auth', async () => {
      const res = await request(app)
        .get('/developers/dashboard')
        .set('Authorization', 'Basic some-token');
      expect(res.status).toBe(401);
    });

    it('should reject requests with empty Bearer token', async () => {
      const res = await request(app)
        .get('/developers/dashboard')
        .set('Authorization', 'Bearer ');
      expect(res.status).toBe(401);
    });
  });

  describe('Valid API Key (fingerprint match)', () => {
    it('should authenticate with valid API key via fingerprint lookup', async () => {
      mockPrisma.developer.findFirst.mockResolvedValue(mockDeveloper);
      mockPrisma.agent.findMany.mockResolvedValue([]);
      mockPrisma.action.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/developers/dashboard')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('Invalid API Key', () => {
    it('should reject invalid API keys', async () => {
      mockPrisma.developer.findFirst.mockResolvedValue(null);
      mockPrisma.developer.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/developers/dashboard')
        .set('Authorization', 'Bearer ats_InvalidKey12345');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toMatch(/invalid/i);
    });
  });

  describe('Fallback lookup (no fingerprint)', () => {
    it('should fallback to iterating all developers if fingerprint not found', async () => {
      // Fingerprint lookup returns null
      mockPrisma.developer.findFirst.mockResolvedValue(null);
      // Fallback to full list
      mockPrisma.developer.findMany.mockResolvedValue([mockDeveloper]);
      // Backfill update
      mockPrisma.developer.update.mockResolvedValue(mockDeveloper);
      // Dashboard queries
      mockPrisma.agent.findMany.mockResolvedValue([]);
      mockPrisma.action.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/developers/dashboard')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(mockPrisma.developer.findMany).toHaveBeenCalled();
    });
  });
});
