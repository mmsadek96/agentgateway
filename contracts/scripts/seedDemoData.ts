import { ethers } from "hardhat";

/**
 * Seed demo data on-chain for the AgentTrust DeFi ecosystem.
 *
 * Since all contracts are owned by the TimelockController, this script:
 * 1. Uses the deployer's DEFAULT_ADMIN_ROLE to schedule + execute operations
 * 2. Seeds: stake $TRUST, create reputation market, deposit insurance collateral,
 *    mint vouch NFT
 *
 * Pre-requisites:
 * - Deployer wallet has 100M $TRUST tokens
 * - Deployer has DEFAULT_ADMIN_ROLE on TimelockController
 * - All contracts deployed and wired
 *
 * Run: npx hardhat run scripts/seedDemoData.ts --network base
 */

// ─── Contract Addresses ───
const TRUST_TOKEN = "0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2";
const STAKING_VAULT = "0x055a8441F18B07Ae0F4967A2d114dB1D7059FdD0";
const REPUTATION_MARKET = "0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD";
const INSURANCE_POOL = "0x35E74a62D538325F50c635ad518E5ae469527f88";
const VOUCH_MARKET = "0x19b1606219fA6F3C76d5753A2bc6C779a502bf25";
const TIMELOCK = "0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1";

// Demo agent IDs (keccak256 of UUID strings)
const DEMO_AGENT_1 = ethers.keccak256(ethers.toUtf8Bytes("demo-agent-alpha"));
const DEMO_AGENT_2 = ethers.keccak256(ethers.toUtf8Bytes("demo-agent-beta"));
const DEMO_AGENT_3 = ethers.keccak256(ethers.toUtf8Bytes("demo-agent-gamma"));

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scheduleAndExecute(
  timelock: any,
  target: string,
  value: bigint,
  data: string,
  description: string,
  deployer: any,
  minDelay: bigint
) {
  const salt = ethers.keccak256(ethers.toUtf8Bytes(description));
  const predecessor = ethers.ZeroHash;

  console.log(`  Scheduling: ${description}`);
  const scheduleTx = await timelock.schedule(
    target, value, data, predecessor, salt, minDelay
  );
  await scheduleTx.wait();
  console.log(`    scheduled (tx: ${scheduleTx.hash})`);

  // Wait for min delay if needed
  if (minDelay > 0n) {
    const delaySec = Number(minDelay);
    console.log(`    waiting ${delaySec}s for timelock delay...`);
    await sleep((delaySec + 2) * 1000);
  }

  console.log(`  Executing: ${description}`);
  const executeTx = await timelock.execute(
    target, value, data, predecessor, salt
  );
  await executeTx.wait();
  console.log(`    executed (tx: ${executeTx.hash})`);

  return executeTx.hash;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=".repeat(60));
  console.log("AgentTrust — Seed Demo Data On-Chain");
  console.log("=".repeat(60));
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`ETH Balance: ${ethers.formatEther(balance)} ETH`);

  // Get contract instances
  const trustToken = new ethers.Contract(TRUST_TOKEN, [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function transfer(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)",
  ], deployer);

  const timelockABI = [
    "function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay)",
    "function execute(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt)",
    "function getMinDelay() view returns (uint256)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function PROPOSER_ROLE() view returns (bytes32)",
    "function EXECUTOR_ROLE() view returns (bytes32)",
    "function grantRole(bytes32 role, address account)",
    "function updateDelay(uint256 newDelay)",
  ];
  const timelock = new ethers.Contract(TIMELOCK, timelockABI, deployer);

  // Check roles
  const adminRole = await timelock.DEFAULT_ADMIN_ROLE();
  const proposerRole = await timelock.PROPOSER_ROLE();
  const hasAdmin = await timelock.hasRole(adminRole, deployer.address);
  const hasProposer = await timelock.hasRole(proposerRole, deployer.address);
  const minDelay = await timelock.getMinDelay();

  console.log(`\nTimelock min delay: ${minDelay}s (${Number(minDelay) / 86400} days)`);
  console.log(`Deployer has DEFAULT_ADMIN_ROLE: ${hasAdmin}`);
  console.log(`Deployer has PROPOSER_ROLE: ${hasProposer}`);

  if (!hasAdmin) {
    console.error("ERROR: Deployer does not have DEFAULT_ADMIN_ROLE on Timelock. Cannot seed.");
    process.exit(1);
  }

  // Grant PROPOSER_ROLE to deployer if needed
  if (!hasProposer) {
    console.log("\n[Setup] Granting PROPOSER_ROLE to deployer...");
    const tx = await timelock.grantRole(proposerRole, deployer.address);
    await tx.wait();
    console.log("  PROPOSER_ROLE granted");
    await sleep(3000);
  }

  // Check TRUST balance
  const trustBalance = await trustToken.balanceOf(deployer.address);
  console.log(`\n$TRUST Balance: ${ethers.formatEther(trustBalance)} TRUST\n`);

  // ─── Phase 1: Transfer $TRUST to Timelock (it needs tokens to execute operations) ───
  console.log("[1/5] Transferring $TRUST to Timelock for operations...");
  const seedAmount = ethers.parseEther("1000000"); // 1M TRUST for all seed ops

  // First approve the Timelock to spend deployer's TRUST (for approvals later)
  const approveTx = await trustToken.approve(TIMELOCK, seedAmount);
  await approveTx.wait();
  console.log(`  Approved Timelock to spend 1M TRUST`);

  // Transfer TRUST to the Timelock address so it can execute operations
  const transferTx = await trustToken.transfer(TIMELOCK, seedAmount);
  await transferTx.wait();
  console.log(`  Transferred 1M TRUST to Timelock`);
  await sleep(3000);

  // ─── Phase 2: Approve contracts via Timelock ───
  console.log("\n[2/5] Approving contracts to spend Timelock's TRUST...");

  // Encode approve calls
  const trustIface = new ethers.Interface([
    "function approve(address spender, uint256 amount) returns (bool)",
  ]);

  // Approve StakingVault
  await scheduleAndExecute(
    timelock,
    TRUST_TOKEN,
    0n,
    trustIface.encodeFunctionData("approve", [STAKING_VAULT, ethers.parseEther("500000")]),
    "approve-staking-vault-seed",
    deployer,
    minDelay
  );
  await sleep(3000);

  // Approve ReputationMarket
  await scheduleAndExecute(
    timelock,
    TRUST_TOKEN,
    0n,
    trustIface.encodeFunctionData("approve", [REPUTATION_MARKET, ethers.parseEther("200000")]),
    "approve-reputation-market-seed",
    deployer,
    minDelay
  );
  await sleep(3000);

  // Approve InsurancePool
  await scheduleAndExecute(
    timelock,
    TRUST_TOKEN,
    0n,
    trustIface.encodeFunctionData("approve", [INSURANCE_POOL, ethers.parseEther("300000")]),
    "approve-insurance-pool-seed",
    deployer,
    minDelay
  );
  await sleep(3000);

  // ─── Phase 3: Stake TRUST for demo agents ───
  console.log("\n[3/5] Staking $TRUST for demo agents...");

  const stakingIface = new ethers.Interface([
    "function stake(bytes32 agentId, uint256 amount)",
  ]);

  // Stake 100K for Agent Alpha
  await scheduleAndExecute(
    timelock,
    STAKING_VAULT,
    0n,
    stakingIface.encodeFunctionData("stake", [DEMO_AGENT_1, ethers.parseEther("100000")]),
    "stake-agent-alpha-seed",
    deployer,
    minDelay
  );
  console.log("  Staked 100,000 TRUST for demo-agent-alpha");
  await sleep(3000);

  // Stake 75K for Agent Beta
  await scheduleAndExecute(
    timelock,
    STAKING_VAULT,
    0n,
    stakingIface.encodeFunctionData("stake", [DEMO_AGENT_2, ethers.parseEther("75000")]),
    "stake-agent-beta-seed",
    deployer,
    minDelay
  );
  console.log("  Staked 75,000 TRUST for demo-agent-beta");
  await sleep(3000);

  // ─── Phase 4: Create reputation market ───
  console.log("\n[4/5] Creating reputation market...");

  const marketIface = new ethers.Interface([
    "function createMarket(bytes32 agentId, uint16 targetScore, uint40 expiresAt) returns (uint256)",
  ]);

  // Market: "Will Agent Alpha reach score >= 80 in 30 days?"
  const thirtyDaysFromNow = Math.floor(Date.now() / 1000) + 30 * 86400;
  await scheduleAndExecute(
    timelock,
    REPUTATION_MARKET,
    0n,
    marketIface.encodeFunctionData("createMarket", [
      DEMO_AGENT_1,
      800, // targetScore = 80.0 (10x scale)
      thirtyDaysFromNow,
    ]),
    "create-market-alpha-seed",
    deployer,
    minDelay
  );
  console.log("  Created market: Agent Alpha >= 80 score in 30 days");
  await sleep(3000);

  // Place a YES bet on the market
  const marketBetIface = new ethers.Interface([
    "function betYes(uint256 marketId, uint256 amount, address bettor)",
    "function betNo(uint256 marketId, uint256 amount, address bettor)",
  ]);

  await scheduleAndExecute(
    timelock,
    REPUTATION_MARKET,
    0n,
    marketBetIface.encodeFunctionData("betYes", [
      0, // First market (ID 0)
      ethers.parseEther("10000"),
      TIMELOCK, // Bettor is the Timelock
    ]),
    "bet-yes-market-0-seed",
    deployer,
    minDelay
  );
  console.log("  Placed 10,000 TRUST YES bet on market #0");
  await sleep(3000);

  // Place a NO bet
  await scheduleAndExecute(
    timelock,
    REPUTATION_MARKET,
    0n,
    marketBetIface.encodeFunctionData("betNo", [
      0,
      ethers.parseEther("5000"),
      TIMELOCK,
    ]),
    "bet-no-market-0-seed",
    deployer,
    minDelay
  );
  console.log("  Placed 5,000 TRUST NO bet on market #0");
  await sleep(3000);

  // ─── Phase 5: Mint vouch NFTs ───
  console.log("\n[5/5] Minting vouch NFTs...");

  const vouchIface = new ethers.Interface([
    "function mintVouch(bytes32 voucherAgentId, bytes32 vouchedAgentId, uint8 weight, address recipient) returns (uint256)",
  ]);

  // Agent Alpha vouches for Agent Beta (weight 4)
  await scheduleAndExecute(
    timelock,
    VOUCH_MARKET,
    0n,
    vouchIface.encodeFunctionData("mintVouch", [
      DEMO_AGENT_1,
      DEMO_AGENT_2,
      4,
      deployer.address,
    ]),
    "vouch-alpha-to-beta-seed",
    deployer,
    minDelay
  );
  console.log("  Minted Vouch NFT: Agent Alpha -> Agent Beta (weight 4)");
  await sleep(3000);

  // Agent Beta vouches for Agent Gamma (weight 3)
  await scheduleAndExecute(
    timelock,
    VOUCH_MARKET,
    0n,
    vouchIface.encodeFunctionData("mintVouch", [
      DEMO_AGENT_2,
      DEMO_AGENT_3,
      3,
      deployer.address,
    ]),
    "vouch-beta-to-gamma-seed",
    deployer,
    minDelay
  );
  console.log("  Minted Vouch NFT: Agent Beta -> Agent Gamma (weight 3)");
  await sleep(3000);

  // Agent Gamma vouches for Agent Alpha (weight 5)
  await scheduleAndExecute(
    timelock,
    VOUCH_MARKET,
    0n,
    vouchIface.encodeFunctionData("mintVouch", [
      DEMO_AGENT_3,
      DEMO_AGENT_1,
      5,
      deployer.address,
    ]),
    "vouch-gamma-to-alpha-seed",
    deployer,
    minDelay
  );
  console.log("  Minted Vouch NFT: Agent Gamma -> Agent Alpha (weight 5)");

  // ─── Summary ───
  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  const gasSpent = balance - balanceAfter;

  console.log("\n" + "=".repeat(60));
  console.log("Seed Demo Data — Complete!");
  console.log("=".repeat(60));
  console.log(`\nSeeded data:`);
  console.log(`  - Staked 100,000 TRUST for demo-agent-alpha`);
  console.log(`  - Staked 75,000 TRUST for demo-agent-beta`);
  console.log(`  - Created reputation market: Agent Alpha >= 80 (30d)`);
  console.log(`  - Placed 10,000 YES + 5,000 NO bets on market #0`);
  console.log(`  - Minted 3 Vouch NFTs (Alpha->Beta, Beta->Gamma, Gamma->Alpha)`);
  console.log(`\nGas spent: ${ethers.formatEther(gasSpent)} ETH`);
  console.log(`Remaining: ${ethers.formatEther(balanceAfter)} ETH`);

  console.log(`\nDemo agent IDs:`);
  console.log(`  Agent Alpha: ${DEMO_AGENT_1}`);
  console.log(`  Agent Beta:  ${DEMO_AGENT_2}`);
  console.log(`  Agent Gamma: ${DEMO_AGENT_3}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSeed script failed:", error);
    process.exit(1);
  });
