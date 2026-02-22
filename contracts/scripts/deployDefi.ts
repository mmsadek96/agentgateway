import { ethers, upgrades } from "hardhat";

/**
 * Deploy the DeFi Derivatives Layer contracts to Base L2.
 *
 * TrustToken already deployed at 0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2
 *
 * Remaining deployment order:
 * 2. TimelockController  — no dependencies (standard OZ)
 * 3. StakingVault        — depends on TrustToken + AgentRegistry
 * 4. ReputationMarket    — depends on TrustToken + AgentRegistry
 * 5. InsurancePool       — depends on TrustToken + AgentRegistry
 * 6. VouchMarket         — depends on AgentRegistry
 * 7. TrustGovernor       — depends on TrustToken + TimelockController
 * 8. Post-deploy wiring  — set insurancePool on StakingVault, grant roles, mint
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("AgentTrust — DeFi Derivatives Layer Deployment (Phase 2)");
  console.log("=".repeat(60));
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log("-".repeat(60));

  // Already deployed
  const AGENT_REGISTRY = "0xb880bC6b0634812E85EC635B899cA197429069e8";
  const TRUST_TOKEN = "0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2";

  console.log(`\n  (Already deployed) TrustToken: ${TRUST_TOKEN}`);
  console.log(`  (Already deployed) AgentRegistry: ${AGENT_REGISTRY}`);

  // ─── 2. TimelockController ───
  console.log("\n[2/7] Deploying TimelockController...");
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const minDelay = 86400; // 1 day
  const proposers: string[] = []; // Will add governor after deployment
  const executors: string[] = [ethers.ZeroAddress]; // Anyone can execute
  const admin = deployer.address;
  const timelock = await TimelockController.deploy(minDelay, proposers, executors, admin);
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  console.log(`  TimelockController: ${timelockAddress}`);

  // ─── 3. StakingVault ───
  console.log("\n[3/7] Deploying StakingVault (stTRUST)...");
  const StakingVault = await ethers.getContractFactory("StakingVault");
  const stakingVault = await upgrades.deployProxy(
    StakingVault,
    [TRUST_TOKEN, AGENT_REGISTRY],
    { initializer: "initialize", kind: "uups" }
  );
  await stakingVault.waitForDeployment();
  const stakingVaultAddress = await stakingVault.getAddress();
  console.log(`  StakingVault proxy: ${stakingVaultAddress}`);

  // ─── 4. ReputationMarket ───
  console.log("\n[4/7] Deploying ReputationMarket...");
  const ReputationMarket = await ethers.getContractFactory("ReputationMarket");
  const reputationMarket = await upgrades.deployProxy(
    ReputationMarket,
    [TRUST_TOKEN, AGENT_REGISTRY],
    { initializer: "initialize", kind: "uups" }
  );
  await reputationMarket.waitForDeployment();
  const reputationMarketAddress = await reputationMarket.getAddress();
  console.log(`  ReputationMarket proxy: ${reputationMarketAddress}`);

  // ─── 5. InsurancePool ───
  console.log("\n[5/7] Deploying InsurancePool...");
  const InsurancePool = await ethers.getContractFactory("InsurancePool");
  const insurancePool = await upgrades.deployProxy(
    InsurancePool,
    [TRUST_TOKEN, AGENT_REGISTRY],
    { initializer: "initialize", kind: "uups" }
  );
  await insurancePool.waitForDeployment();
  const insurancePoolAddress = await insurancePool.getAddress();
  console.log(`  InsurancePool proxy: ${insurancePoolAddress}`);

  // ─── 6. VouchMarket ───
  console.log("\n[6/7] Deploying VouchMarket (VOUCH NFT)...");
  const VouchMarket = await ethers.getContractFactory("VouchMarket");
  const vouchMarket = await upgrades.deployProxy(
    VouchMarket,
    [AGENT_REGISTRY],
    { initializer: "initialize", kind: "uups" }
  );
  await vouchMarket.waitForDeployment();
  const vouchMarketAddress = await vouchMarket.getAddress();
  console.log(`  VouchMarket proxy: ${vouchMarketAddress}`);

  // ─── 7. TrustGovernor ───
  console.log("\n[7/7] Deploying TrustGovernor...");
  const TrustGovernor = await ethers.getContractFactory("TrustGovernor");
  const trustGovernor = await upgrades.deployProxy(
    TrustGovernor,
    [TRUST_TOKEN, timelockAddress],
    { initializer: "initialize", kind: "uups" }
  );
  await trustGovernor.waitForDeployment();
  const trustGovernorAddress = await trustGovernor.getAddress();
  console.log(`  TrustGovernor proxy: ${trustGovernorAddress}`);

  // ─── 8. Post-deploy Wiring ───
  console.log("\n⚙️  Post-deploy wiring...");

  // Set InsurancePool on StakingVault (slashed funds destination)
  const sv = await ethers.getContractAt("StakingVault", stakingVaultAddress);
  await (await sv.setInsurancePool(insurancePoolAddress)).wait();
  console.log("  ✅ StakingVault.insurancePool → InsurancePool");

  // Grant PROPOSER_ROLE to Governor on Timelock
  const tc = await ethers.getContractAt("TimelockController", timelockAddress);
  const PROPOSER_ROLE = await tc.PROPOSER_ROLE();
  await (await tc.grantRole(PROPOSER_ROLE, trustGovernorAddress)).wait();
  console.log("  ✅ TimelockController.PROPOSER_ROLE → TrustGovernor");

  // Mint initial $TRUST supply to deployer (100M for ecosystem bootstrap)
  const tt = await ethers.getContractAt("TrustToken", TRUST_TOKEN);
  const initialMint = ethers.parseEther("100000000"); // 100M TRUST
  await (await tt.mint(deployer.address, initialMint)).wait();
  console.log(`  ✅ Minted 100,000,000 $TRUST to deployer`);

  // ─── Summary ───
  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  const gasUsed = balance - balanceAfter;

  console.log("\n" + "=".repeat(60));
  console.log("DEFI DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`\nContract Addresses:`);
  console.log(`  TrustToken:         ${TRUST_TOKEN}`);
  console.log(`  TimelockController: ${timelockAddress}`);
  console.log(`  StakingVault:       ${stakingVaultAddress}`);
  console.log(`  ReputationMarket:   ${reputationMarketAddress}`);
  console.log(`  InsurancePool:      ${insurancePoolAddress}`);
  console.log(`  VouchMarket:        ${vouchMarketAddress}`);
  console.log(`  TrustGovernor:      ${trustGovernorAddress}`);
  console.log(`\n  (Existing) AgentRegistry: ${AGENT_REGISTRY}`);
  console.log(`\nGas spent: ${ethers.formatEther(gasUsed)} ETH`);
  console.log(`Remaining balance: ${ethers.formatEther(balanceAfter)} ETH`);

  console.log(`\nBaseScan verification:`);
  [
    ["TrustToken", TRUST_TOKEN],
    ["TimelockController", timelockAddress],
    ["StakingVault", stakingVaultAddress],
    ["ReputationMarket", reputationMarketAddress],
    ["InsurancePool", insurancePoolAddress],
    ["VouchMarket", vouchMarketAddress],
    ["TrustGovernor", trustGovernorAddress],
  ].forEach(([name, addr]) => {
    console.log(`  ${name}: https://basescan.org/address/${addr}`);
  });

  // Save deployment info
  const deployment = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    existingContracts: {
      AgentRegistry: AGENT_REGISTRY,
      CertificateRegistry: "0xD3cAf18d292168075653322780EF961BF6394c11",
      ReputationLedger: "0x12181081eec99b541271f1915cD00111dB2f31c6",
    },
    defiContracts: {
      TrustToken: TRUST_TOKEN,
      TimelockController: timelockAddress,
      StakingVault: stakingVaultAddress,
      ReputationMarket: reputationMarketAddress,
      InsurancePool: insurancePoolAddress,
      VouchMarket: vouchMarketAddress,
      TrustGovernor: trustGovernorAddress,
    },
    initialMint: "100000000",
    gasUsed: ethers.formatEther(gasUsed),
  };

  const fs = require("fs");
  fs.writeFileSync(
    "deployment-defi.json",
    JSON.stringify(deployment, null, 2)
  );
  console.log("\nDeployment info saved to deployment-defi.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
