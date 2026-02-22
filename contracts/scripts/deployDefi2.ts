import { ethers, upgrades } from "hardhat";

/**
 * Continue DeFi deployment — VouchMarket + TrustGovernor + post-deploy wiring.
 * Previous contracts already deployed.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("AgentTrust — DeFi Deployment Continuation");
  console.log("=".repeat(60));
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log("-".repeat(60));

  // Already deployed
  const AGENT_REGISTRY = "0xb880bC6b0634812E85EC635B899cA197429069e8";
  const TRUST_TOKEN = "0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2";
  const TIMELOCK = "0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1";
  const STAKING_VAULT = "0x055a8441F18B07Ae0F4967A2d114dB1D7059FdD0";
  const INSURANCE_POOL = "0x35E74a62D538325F50c635ad518E5ae469527f88";

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
    [TRUST_TOKEN, TIMELOCK],
    { initializer: "initialize", kind: "uups" }
  );
  await trustGovernor.waitForDeployment();
  const trustGovernorAddress = await trustGovernor.getAddress();
  console.log(`  TrustGovernor proxy: ${trustGovernorAddress}`);

  // ─── 8. Post-deploy Wiring ───
  console.log("\n⚙️  Post-deploy wiring...");

  // Set InsurancePool on StakingVault
  const sv = await ethers.getContractAt("StakingVault", STAKING_VAULT);
  const tx1 = await sv.setInsurancePool(INSURANCE_POOL);
  await tx1.wait();
  console.log("  ✅ StakingVault.insurancePool → InsurancePool");

  // Grant PROPOSER_ROLE to Governor on Timelock
  const tc = await ethers.getContractAt("TimelockController", TIMELOCK);
  const PROPOSER_ROLE = await tc.PROPOSER_ROLE();
  const tx2 = await tc.grantRole(PROPOSER_ROLE, trustGovernorAddress);
  await tx2.wait();
  console.log("  ✅ TimelockController.PROPOSER_ROLE → TrustGovernor");

  // Mint initial $TRUST supply to deployer (100M for ecosystem bootstrap)
  const tt = await ethers.getContractAt("TrustToken", TRUST_TOKEN);
  const initialMint = ethers.parseEther("100000000"); // 100M TRUST
  const tx3 = await tt.mint(deployer.address, initialMint);
  await tx3.wait();
  console.log(`  ✅ Minted 100,000,000 $TRUST to deployer`);

  // ─── Summary ───
  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  const gasUsed = balance - balanceAfter;

  console.log("\n" + "=".repeat(60));
  console.log("DEFI DEPLOYMENT COMPLETE ✅");
  console.log("=".repeat(60));
  console.log(`\nAll DeFi Contract Addresses:`);
  console.log(`  TrustToken:         ${TRUST_TOKEN}`);
  console.log(`  TimelockController: ${TIMELOCK}`);
  console.log(`  StakingVault:       ${STAKING_VAULT}`);
  console.log(`  ReputationMarket:   0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD`);
  console.log(`  InsurancePool:      ${INSURANCE_POOL}`);
  console.log(`  VouchMarket:        ${vouchMarketAddress}`);
  console.log(`  TrustGovernor:      ${trustGovernorAddress}`);
  console.log(`\nGas spent: ${ethers.formatEther(gasUsed)} ETH`);
  console.log(`Remaining balance: ${ethers.formatEther(balanceAfter)} ETH`);

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
      TimelockController: TIMELOCK,
      StakingVault: STAKING_VAULT,
      ReputationMarket: "0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD",
      InsurancePool: INSURANCE_POOL,
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
