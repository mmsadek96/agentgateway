/**
 * Shared mock factories for tests.
 * Import the helpers you need in each test file.
 */

export function createMockPrisma(): any {
  const mockPrisma: any = {
    developer: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    agent: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    action: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    vouch: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    reputationEvent: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    certificate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    gatewayReport: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    tokenBalance: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    stakingRecord: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    reputationMarketRecord: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    marketPosition: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    insurancePolicyRecord: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((fn: any) => fn(mockPrisma)),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
  return mockPrisma;
}

export const MOCK_DEFI = {
  initDefiContracts: jest.fn(),
  isDefiEnabled: jest.fn().mockReturnValue(true),
  getTrustBalance: jest.fn().mockResolvedValue({ trust: '1000.0', stTrust: '500.0' }),
  getTrustStats: jest.fn().mockResolvedValue({
    totalSupply: '1000000000',
    circulatingSupply: '50000000',
    name: 'Trust Token',
    symbol: 'TRUST',
  }),
  mintTrust: jest.fn().mockResolvedValue('0xmocktxhash'),
  stakeForAgent: jest.fn().mockResolvedValue('0xmockstaketx'),
  requestUnstake: jest.fn().mockResolvedValue('0xmockunstaketx'),
  completeUnstake: jest.fn().mockResolvedValue('0xmockcompletetx'),
  getStakeInfo: jest.fn().mockResolvedValue({
    stakedAmount: '1000',
    unstakeRequestAmount: '0',
    unstakeRequestTime: null,
    stakeScore: 10,
  }),
  getStakingStats: jest.fn().mockResolvedValue({
    totalStaked: '500000',
    cooldownPeriod: 604800,
    slashBasisPoints: 1000,
  }),
  createMarket: jest.fn().mockResolvedValue('0xmockmarkettx'),
  placeBet: jest.fn().mockResolvedValue('0xmockbettx'),
  settleMarket: jest.fn().mockResolvedValue('0xmocksettletx'),
  claimWinnings: jest.fn().mockResolvedValue('0xmockclaimtx'),
  getMarketInfo: jest.fn().mockResolvedValue({
    agentId: '0x' + 'a'.repeat(64),
    targetScore: 750,
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
    yesPool: '10000',
    noPool: '5000',
    settled: false,
    outcome: null,
  }),
  getMarketStats: jest.fn().mockResolvedValue({
    nextMarketId: 3,
    totalVolume: '50000',
    activeMarkets: 2,
  }),
  depositInsuranceCollateral: jest.fn().mockResolvedValue('0xmockdeposittx'),
  buyInsurancePolicy: jest.fn().mockResolvedValue('0xmockpolicytx'),
  fileInsuranceClaim: jest.fn().mockResolvedValue('0xmockinsclaimtx'),
  getInsuranceStats: jest.fn().mockResolvedValue({
    totalCollateral: '100000',
    totalPremiums: '5000',
    activePolicies: 3,
  }),
  mintVouchNft: jest.fn().mockResolvedValue('0xmockvouchtx'),
  getVouchNftInfo: jest.fn().mockResolvedValue({
    voucherAgentId: '0x' + 'a'.repeat(64),
    vouchedAgentId: '0x' + 'b'.repeat(64),
    voucherScoreAtMint: 85,
    weight: 3,
    active: true,
  }),
  getVouchMarketStats: jest.fn().mockResolvedValue({
    totalVouches: 15,
    activeVouches: 12,
  }),
  getVouchScore: jest.fn().mockResolvedValue(12),
  getDefiOverview: jest.fn().mockResolvedValue({
    trustToken: { totalSupply: '1000000000', symbol: 'TRUST' },
    staking: { totalStaked: '500000' },
    markets: { activeMarkets: 2 },
    insurance: { totalCollateral: '100000' },
    vouches: { totalVouches: 15 },
  }),
};

export const MOCK_BLOCKCHAIN = {
  initBlockchain: jest.fn(),
  registerAgentOnChain: jest.fn().mockResolvedValue('0xmocktxhash'),
  recordActionOnChain: jest.fn().mockResolvedValue(null),
  uuidToBytes32: jest.fn((_uuid: string) => '0x' + 'a'.repeat(64)),
  isBlockchainEnabled: jest.fn().mockReturnValue(false),
};
