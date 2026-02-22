import { ethers, Contract, Wallet, JsonRpcProvider } from 'ethers';
import { uuidToBytes32, isBlockchainEnabled } from './blockchain';

// ─── DeFi Contract Addresses (Base Mainnet) ───
const TRUST_TOKEN_ADDRESS = '0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2';
const STAKING_VAULT_ADDRESS = '0x055a8441F18B07Ae0F4967A2d114dB1D7059FdD0';
const REPUTATION_MARKET_ADDRESS = '0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD';
const INSURANCE_POOL_ADDRESS = '0x35E74a62D538325F50c635ad518E5ae469527f88';
const VOUCH_MARKET_ADDRESS = '0x19b1606219fA6F3C76d5753A2bc6C779a502bf25';
const TRUST_GOVERNOR_ADDRESS = '0x1e548DC82c7B4d362c84084bd92263BCA6ecf17B';
const TIMELOCK_ADDRESS = '0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1';

// ─── Minimal ABIs ───

const TRUST_TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function mint(address to, uint256 amount)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function mintableSupply() view returns (uint256)',
];

const STAKING_VAULT_ABI = [
  'function stake(bytes32 agentId, uint256 amount)',
  'function requestUnstake(bytes32 agentId, uint256 amount)',
  'function completeUnstake(bytes32 agentId)',
  'function slash(bytes32 agentId, uint256 basisPoints)',
  'function getStake(bytes32 agentId) view returns (uint256 stakedAmount, uint256 unstakeRequestAmount, uint40 unstakeRequestTime, uint40 unlockTime)',
  'function getStakeScore(bytes32 agentId) view returns (uint16)',
  'function totalStaked() view returns (uint256)',
  'function cooldownPeriod() view returns (uint256)',
];

const REPUTATION_MARKET_ABI = [
  'function createMarket(bytes32 agentId, uint16 targetScore, uint40 expiresAt) returns (uint256)',
  'function betYes(uint256 marketId, uint256 amount, address bettor)',
  'function betNo(uint256 marketId, uint256 amount, address bettor)',
  'function settle(uint256 marketId)',
  'function claim(uint256 marketId, address claimant)',
  'function getMarket(uint256 marketId) view returns (tuple(bytes32 agentId, uint16 targetScore, uint40 expiresAt, uint256 yesPool, uint256 noPool, bool settled, bool outcome, uint16 finalScore))',
  'function getPosition(uint256 marketId, address user) view returns (uint256 yesAmount, uint256 noAmount)',
  'function getStats() view returns (uint256 totalMarkets, uint256 totalVolume)',
  'function nextMarketId() view returns (uint256)',
];

const INSURANCE_POOL_ABI = [
  'function depositCollateral(bytes32 agentId, uint256 amount)',
  'function withdrawCollateral(bytes32 agentId, uint256 amount)',
  'function buyPolicy(bytes32 agentId, address insured, uint256 coverageAmount, uint16 triggerScore, uint40 expiresAt) returns (uint256)',
  'function fileClaim(uint256 policyId)',
  'function expirePolicy(uint256 policyId)',
  'function calculatePremium(bytes32 agentId, uint256 coverageAmount, uint16 triggerScore) view returns (uint256)',
  'function getPolicy(uint256 policyId) view returns (tuple(bytes32 agentId, address insured, uint256 coverageAmount, uint256 premiumPaid, uint16 triggerScore, uint40 expiresAt, bool claimed, bool active))',
  'function getCollateral(bytes32 agentId) view returns (uint256)',
  'function getStats() view returns (uint256 totalCollateral, uint256 totalPremiums, uint256 totalPolicies, uint256 totalClaims)',
];

const VOUCH_MARKET_ABI = [
  'function mintVouch(bytes32 voucherAgentId, bytes32 vouchedAgentId, uint8 weight, address recipient) returns (uint256)',
  'function deactivateVouch(uint256 tokenId)',
  'function reactivateVouch(uint256 tokenId)',
  'function getVouchInfo(uint256 tokenId) view returns (tuple(bytes32 voucherAgentId, bytes32 vouchedAgentId, uint16 voucherScoreAtMint, uint8 weight, uint40 mintedAt, bool active))',
  'function getActiveVouchCount(bytes32 agentId) view returns (uint256)',
  'function getVouchScore(bytes32 agentId) view returns (uint16)',
  'function getAgentVouches(bytes32 agentId) view returns (uint256[])',
  'function hasVouch(bytes32 voucherAgentId, bytes32 vouchedAgentId) view returns (bool exists, uint256 tokenId)',
  'function totalVouches() view returns (uint256)',
  'function totalActive() view returns (uint256)',
];

// ─── Singleton Instances ───
let provider: JsonRpcProvider | null = null;
let wallet: Wallet | null = null;
let trustToken: Contract | null = null;
let stakingVault: Contract | null = null;
let reputationMarket: Contract | null = null;
let insurancePool: Contract | null = null;
let vouchMarket: Contract | null = null;
let defiInitialized = false;

/**
 * Initialize DeFi contract instances.
 * Call after initBlockchain() in app startup.
 */
export function initDefiContracts(): boolean {
  const privateKey = process.env.BASE_PRIVATE_KEY;
  if (!privateKey) {
    console.log('[DeFi] No BASE_PRIVATE_KEY — DeFi features disabled');
    return false;
  }

  try {
    provider = new JsonRpcProvider('https://mainnet.base.org');
    wallet = new Wallet(privateKey, provider);
    trustToken = new Contract(TRUST_TOKEN_ADDRESS, TRUST_TOKEN_ABI, wallet);
    stakingVault = new Contract(STAKING_VAULT_ADDRESS, STAKING_VAULT_ABI, wallet);
    reputationMarket = new Contract(REPUTATION_MARKET_ADDRESS, REPUTATION_MARKET_ABI, wallet);
    insurancePool = new Contract(INSURANCE_POOL_ADDRESS, INSURANCE_POOL_ABI, wallet);
    vouchMarket = new Contract(VOUCH_MARKET_ADDRESS, VOUCH_MARKET_ABI, wallet);
    defiInitialized = true;
    console.log('[DeFi] Contracts initialized on Base mainnet');
    return true;
  } catch (err) {
    console.error('[DeFi] Failed to initialize:', err);
    return false;
  }
}

export function isDefiEnabled(): boolean {
  return defiInitialized;
}

// ════════════════════════════════════════════════════
// $TRUST TOKEN OPERATIONS
// ════════════════════════════════════════════════════

export async function getTrustBalance(address: string): Promise<string | null> {
  if (!trustToken) return null;
  try {
    const balance = await trustToken.balanceOf(address);
    return ethers.formatEther(balance);
  } catch (err: any) {
    console.error('[DeFi] getTrustBalance error:', err.message);
    return null;
  }
}

export async function getTrustStats(): Promise<{ totalSupply: string; mintable: string } | null> {
  if (!trustToken) return null;
  try {
    const [total, mintable] = await Promise.all([
      trustToken.totalSupply(),
      trustToken.mintableSupply(),
    ]);
    return {
      totalSupply: ethers.formatEther(total),
      mintable: ethers.formatEther(mintable),
    };
  } catch (err: any) {
    console.error('[DeFi] getTrustStats error:', err.message);
    return null;
  }
}

export async function mintTrust(to: string, amount: string): Promise<string | null> {
  if (!trustToken) return null;
  try {
    const tx = await trustToken.mint(to, ethers.parseEther(amount));
    console.log(`[DeFi] Minted ${amount} TRUST to ${to} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] mintTrust error:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════
// STAKING VAULT OPERATIONS
// ════════════════════════════════════════════════════

export async function stakeForAgent(agentUuid: string, amount: string): Promise<string | null> {
  if (!stakingVault || !trustToken || !wallet) return null;
  try {
    const agentId = uuidToBytes32(agentUuid);
    const amountWei = ethers.parseEther(amount);

    // Approve vault to spend TRUST
    const approveTx = await trustToken.approve(STAKING_VAULT_ADDRESS, amountWei);
    await approveTx.wait();

    // Stake
    const tx = await stakingVault.stake(agentId, amountWei);
    console.log(`[DeFi] Staked ${amount} TRUST for ${agentUuid} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] stakeForAgent error:', err.message);
    return null;
  }
}

export async function requestUnstake(agentUuid: string, amount: string): Promise<string | null> {
  if (!stakingVault) return null;
  try {
    const agentId = uuidToBytes32(agentUuid);
    const tx = await stakingVault.requestUnstake(agentId, ethers.parseEther(amount));
    console.log(`[DeFi] Unstake requested for ${agentUuid}: ${amount} TRUST (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] requestUnstake error:', err.message);
    return null;
  }
}

export async function completeUnstake(agentUuid: string): Promise<string | null> {
  if (!stakingVault) return null;
  try {
    const agentId = uuidToBytes32(agentUuid);
    const tx = await stakingVault.completeUnstake(agentId);
    console.log(`[DeFi] Unstake completed for ${agentUuid} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] completeUnstake error:', err.message);
    return null;
  }
}

export async function getStakeInfo(agentUuid: string): Promise<{
  stakedAmount: string;
  unstakeRequestAmount: string;
  unstakeRequestTime: number;
  unlockTime: number;
  stakeScore: number;
} | null> {
  if (!stakingVault) return null;
  try {
    const agentId = uuidToBytes32(agentUuid);
    const [stake, score] = await Promise.all([
      stakingVault.getStake(agentId),
      stakingVault.getStakeScore(agentId),
    ]);
    return {
      stakedAmount: ethers.formatEther(stake.stakedAmount),
      unstakeRequestAmount: ethers.formatEther(stake.unstakeRequestAmount),
      unstakeRequestTime: Number(stake.unstakeRequestTime),
      unlockTime: Number(stake.unlockTime),
      stakeScore: Number(score),
    };
  } catch (err: any) {
    console.error('[DeFi] getStakeInfo error:', err.message);
    return null;
  }
}

export async function getStakingStats(): Promise<{ totalStaked: string; cooldownPeriod: number } | null> {
  if (!stakingVault) return null;
  try {
    const [total, cooldown] = await Promise.all([
      stakingVault.totalStaked(),
      stakingVault.cooldownPeriod(),
    ]);
    return {
      totalStaked: ethers.formatEther(total),
      cooldownPeriod: Number(cooldown),
    };
  } catch (err: any) {
    console.error('[DeFi] getStakingStats error:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════
// REPUTATION MARKET OPERATIONS
// ════════════════════════════════════════════════════

export async function createMarket(agentUuid: string, targetScore: number, expiresAt: number): Promise<string | null> {
  if (!reputationMarket) return null;
  try {
    const agentId = uuidToBytes32(agentUuid);
    const tx = await reputationMarket.createMarket(agentId, Math.round(targetScore * 10), expiresAt);
    console.log(`[DeFi] Market created for ${agentUuid} target=${targetScore} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] createMarket error:', err.message);
    return null;
  }
}

export async function placeBet(marketId: number, side: 'yes' | 'no', amount: string, bettorAddress: string): Promise<string | null> {
  if (!reputationMarket || !trustToken || !wallet) return null;
  try {
    const amountWei = ethers.parseEther(amount);

    // Approve market to spend TRUST
    const approveTx = await trustToken.approve(REPUTATION_MARKET_ADDRESS, amountWei);
    await approveTx.wait();

    const tx = side === 'yes'
      ? await reputationMarket.betYes(marketId, amountWei, bettorAddress)
      : await reputationMarket.betNo(marketId, amountWei, bettorAddress);

    console.log(`[DeFi] Bet placed: market=${marketId} side=${side} amount=${amount} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] placeBet error:', err.message);
    return null;
  }
}

export async function settleMarket(marketId: number): Promise<string | null> {
  if (!reputationMarket) return null;
  try {
    const tx = await reputationMarket.settle(marketId);
    console.log(`[DeFi] Market settled: ${marketId} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] settleMarket error:', err.message);
    return null;
  }
}

export async function claimWinnings(marketId: number, claimantAddress: string): Promise<string | null> {
  if (!reputationMarket) return null;
  try {
    const tx = await reputationMarket.claim(marketId, claimantAddress);
    console.log(`[DeFi] Winnings claimed: market=${marketId} claimant=${claimantAddress} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] claimWinnings error:', err.message);
    return null;
  }
}

export async function getMarketInfo(marketId: number): Promise<any | null> {
  if (!reputationMarket) return null;
  try {
    const m = await reputationMarket.getMarket(marketId);
    return {
      agentId: m.agentId,
      targetScore: Number(m.targetScore) / 10,
      expiresAt: Number(m.expiresAt),
      yesPool: ethers.formatEther(m.yesPool),
      noPool: ethers.formatEther(m.noPool),
      settled: m.settled,
      outcome: m.outcome,
      finalScore: Number(m.finalScore) / 10,
    };
  } catch (err: any) {
    console.error('[DeFi] getMarketInfo error:', err.message);
    return null;
  }
}

export async function getMarketStats(): Promise<{ totalMarkets: number; totalVolume: string; nextMarketId: number } | null> {
  if (!reputationMarket) return null;
  try {
    const [stats, nextId] = await Promise.all([
      reputationMarket.getStats(),
      reputationMarket.nextMarketId(),
    ]);
    return {
      totalMarkets: Number(stats.totalMarkets),
      totalVolume: ethers.formatEther(stats.totalVolume),
      nextMarketId: Number(nextId),
    };
  } catch (err: any) {
    console.error('[DeFi] getMarketStats error:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════
// INSURANCE POOL OPERATIONS
// ════════════════════════════════════════════════════

export async function depositInsuranceCollateral(agentUuid: string, amount: string): Promise<string | null> {
  if (!insurancePool || !trustToken) return null;
  try {
    const agentId = uuidToBytes32(agentUuid);
    const amountWei = ethers.parseEther(amount);

    const approveTx = await trustToken.approve(INSURANCE_POOL_ADDRESS, amountWei);
    await approveTx.wait();

    const tx = await insurancePool.depositCollateral(agentId, amountWei);
    console.log(`[DeFi] Collateral deposited: ${amount} TRUST for ${agentUuid} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] depositInsuranceCollateral error:', err.message);
    return null;
  }
}

export async function buyInsurancePolicy(
  agentUuid: string,
  insuredAddress: string,
  coverageAmount: string,
  triggerScore: number,
  expiresAt: number
): Promise<string | null> {
  if (!insurancePool || !trustToken) return null;
  try {
    const agentId = uuidToBytes32(agentUuid);
    const coverageWei = ethers.parseEther(coverageAmount);

    // Calculate premium first
    const premium = await insurancePool.calculatePremium(agentId, coverageWei, Math.round(triggerScore * 10));

    // Approve premium amount
    const approveTx = await trustToken.approve(INSURANCE_POOL_ADDRESS, premium);
    await approveTx.wait();

    const tx = await insurancePool.buyPolicy(
      agentId, insuredAddress, coverageWei,
      Math.round(triggerScore * 10), expiresAt
    );
    console.log(`[DeFi] Insurance policy bought for ${agentUuid} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] buyInsurancePolicy error:', err.message);
    return null;
  }
}

export async function fileInsuranceClaim(policyId: number): Promise<string | null> {
  if (!insurancePool) return null;
  try {
    const tx = await insurancePool.fileClaim(policyId);
    console.log(`[DeFi] Insurance claim filed: policy=${policyId} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] fileInsuranceClaim error:', err.message);
    return null;
  }
}

export async function getInsuranceStats(): Promise<{
  totalCollateral: string; totalPremiums: string; totalPolicies: number; totalClaims: number
} | null> {
  if (!insurancePool) return null;
  try {
    const stats = await insurancePool.getStats();
    return {
      totalCollateral: ethers.formatEther(stats.totalCollateral),
      totalPremiums: ethers.formatEther(stats.totalPremiums),
      totalPolicies: Number(stats.totalPolicies),
      totalClaims: Number(stats.totalClaims),
    };
  } catch (err: any) {
    console.error('[DeFi] getInsuranceStats error:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════
// VOUCH MARKET OPERATIONS
// ════════════════════════════════════════════════════

export async function mintVouchNft(
  voucherUuid: string,
  vouchedUuid: string,
  weight: number
): Promise<string | null> {
  if (!vouchMarket || !wallet) return null;
  try {
    const voucherId = uuidToBytes32(voucherUuid);
    const vouchedId = uuidToBytes32(vouchedUuid);
    const tx = await vouchMarket.mintVouch(voucherId, vouchedId, weight, wallet.address);
    console.log(`[DeFi] Vouch NFT minted: ${voucherUuid} → ${vouchedUuid} weight=${weight} (tx: ${tx.hash})`);
    return tx.hash;
  } catch (err: any) {
    console.error('[DeFi] mintVouchNft error:', err.message);
    return null;
  }
}

export async function getVouchNftInfo(tokenId: number): Promise<any | null> {
  if (!vouchMarket) return null;
  try {
    const v = await vouchMarket.getVouchInfo(tokenId);
    return {
      voucherAgentId: v.voucherAgentId,
      vouchedAgentId: v.vouchedAgentId,
      voucherScoreAtMint: Number(v.voucherScoreAtMint) / 10,
      weight: Number(v.weight),
      mintedAt: Number(v.mintedAt),
      active: v.active,
    };
  } catch (err: any) {
    console.error('[DeFi] getVouchNftInfo error:', err.message);
    return null;
  }
}

export async function getVouchMarketStats(): Promise<{ totalVouches: number; totalActive: number } | null> {
  if (!vouchMarket) return null;
  try {
    const [total, active] = await Promise.all([
      vouchMarket.totalVouches(),
      vouchMarket.totalActive(),
    ]);
    return { totalVouches: Number(total), totalActive: Number(active) };
  } catch (err: any) {
    console.error('[DeFi] getVouchMarketStats error:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════
// AGGREGATED DEFI STATS (for dashboard)
// ════════════════════════════════════════════════════

export async function getDefiOverview(): Promise<any> {
  const [trustStats, stakingStats, marketStats, insuranceStats, vouchStats] = await Promise.all([
    getTrustStats().catch(() => null),
    getStakingStats().catch(() => null),
    getMarketStats().catch(() => null),
    getInsuranceStats().catch(() => null),
    getVouchMarketStats().catch(() => null),
  ]);

  return {
    token: trustStats,
    staking: stakingStats,
    markets: marketStats,
    insurance: insuranceStats,
    vouches: vouchStats,
    contracts: {
      TrustToken: TRUST_TOKEN_ADDRESS,
      StakingVault: STAKING_VAULT_ADDRESS,
      ReputationMarket: REPUTATION_MARKET_ADDRESS,
      InsurancePool: INSURANCE_POOL_ADDRESS,
      VouchMarket: VOUCH_MARKET_ADDRESS,
      TrustGovernor: TRUST_GOVERNOR_ADDRESS,
      TimelockController: TIMELOCK_ADDRESS,
    },
  };
}
