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
import app from '../../app';

// Suppress console
beforeAll(() => { console.error = jest.fn(); console.log = jest.fn(); });
beforeEach(() => { jest.clearAllMocks(); });

describe('Dashboard Routes', () => {
  describe('GET /dashboard', () => {
    it('should serve the dashboard HTML page', async () => {
      const res = await request(app).get('/dashboard');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
    });
  });

  describe('GET /dashboard/api/overview', () => {
    it('should return platform overview stats', async () => {
      mockPrisma.developer.count.mockResolvedValue(5);
      mockPrisma.agent.count.mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8) // active
        .mockResolvedValueOnce(1) // suspended
        .mockResolvedValueOnce(1); // banned
      mockPrisma.action.count.mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(25); // last 24h
      mockPrisma.certificate.count.mockResolvedValue(15);
      mockPrisma.gatewayReport.count.mockResolvedValue(7);

      const res = await request(app).get('/dashboard/api/overview');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('developers', 5);
      expect(res.body.data.agents).toHaveProperty('active', 8);
      expect(res.body.data.agents).toHaveProperty('total', 10);
      expect(res.body.data.actions).toHaveProperty('total', 100);
      expect(res.body.data).toHaveProperty('certificates', 15);
      expect(res.body.data).toHaveProperty('gatewayReports', 7);
      expect(res.body.data).toHaveProperty('defi');
    });
  });

  describe('GET /dashboard/api/defi', () => {
    it('should return DeFi ecosystem stats when enabled', async () => {
      const res = await request(app).get('/dashboard/api/defi');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('enabled', true);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.token).toHaveProperty('symbol', 'TRUST');
      expect(res.body.data.token).toHaveProperty('totalSupply');
      expect(res.body.data).toHaveProperty('staking');
      expect(res.body.data.staking).toHaveProperty('totalStaked');
      expect(res.body.data.staking).toHaveProperty('cooldownPeriod');
      expect(res.body.data).toHaveProperty('markets');
      expect(res.body.data.markets).toHaveProperty('activeMarkets');
      expect(res.body.data).toHaveProperty('insurance');
      expect(res.body.data.insurance).toHaveProperty('activePolicies');
      expect(res.body.data).toHaveProperty('vouches');
      expect(res.body.data.vouches).toHaveProperty('totalVouches');
      expect(res.body.data).toHaveProperty('contracts');
      expect(res.body.data).toHaveProperty('network');
    });

    it('should return disabled when DeFi is off', async () => {
      const defi = require('../../services/defi');
      defi.isDefiEnabled.mockReturnValueOnce(false);

      const res = await request(app).get('/dashboard/api/defi');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('enabled', false);
    });

    it('should include contract addresses', async () => {
      const res = await request(app).get('/dashboard/api/defi');
      expect(res.body.data.contracts).toHaveProperty('trustToken');
      expect(res.body.data.contracts).toHaveProperty('stakingVault');
      expect(res.body.data.contracts).toHaveProperty('reputationMarket');
      expect(res.body.data.contracts).toHaveProperty('insurancePool');
      expect(res.body.data.contracts).toHaveProperty('vouchMarket');
      expect(res.body.data.contracts).toHaveProperty('governor');
      expect(res.body.data.contracts).toHaveProperty('timelock');
      // Verify valid Ethereum addresses
      expect(res.body.data.contracts.trustToken).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });

  describe('GET /dashboard/api/agents', () => {
    it('should return agents list', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([
        {
          id: 'agent-1',
          externalId: 'test-agent',
          developer: { companyName: 'TestCo', email: 'test@test.com' },
          status: 'active',
          reputationScore: 85,
          identityVerified: true,
          totalActions: 50,
          successfulActions: 45,
          failedActions: 5,
          stakeAmount: 100.5,
          createdAt: new Date(),
          _count: { actions: 50, certificates: 3, vouchesReceived: 5, vouchesGiven: 2, gatewayReports: 1 },
        },
      ]);

      const res = await request(app).get('/dashboard/api/agents');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toHaveProperty('externalId', 'test-agent');
      expect(res.body.data[0]).toHaveProperty('reputationScore', 85);
      expect(res.body.data[0]).toHaveProperty('successRate', 90);
    });
  });

  describe('GET /dashboard/api/reputation/distribution', () => {
    it('should return score distribution buckets', async () => {
      mockPrisma.agent.findMany.mockResolvedValue([
        { reputationScore: 85 },
        { reputationScore: 72 },
        { reputationScore: 45 },
        { reputationScore: 92 },
      ]);

      const res = await request(app).get('/dashboard/api/reputation/distribution');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('distribution');
      expect(res.body.data).toHaveProperty('totalAgents', 4);
      expect(res.body.data).toHaveProperty('averageScore');
      expect(res.body.data.distribution).toHaveProperty('81-90');
    });
  });

  describe('GET /dashboard/api/activity/timeline', () => {
    it('should return hourly activity data', async () => {
      mockPrisma.action.findMany.mockResolvedValue([]);

      const res = await request(app).get('/dashboard/api/activity/timeline');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      // Should have 24 hourly buckets
      expect(res.body.data.length).toBe(24);
      expect(res.body.data[0]).toHaveProperty('hour');
      expect(res.body.data[0]).toHaveProperty('allowed');
      expect(res.body.data[0]).toHaveProperty('denied');
      expect(res.body.data[0]).toHaveProperty('total');
    });
  });
});
