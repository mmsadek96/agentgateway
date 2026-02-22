import { ethers } from "hardhat";

/**
 * Post-deploy wiring — set insurancePool, grant roles, mint initial supply.
 * Run after all contracts are deployed.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=".repeat(60));
  console.log("AgentTrust — DeFi Post-Deploy Wiring");
  console.log("=".repeat(60));
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  const TRUST_TOKEN = "0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2";
  const TIMELOCK = "0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1";
  const STAKING_VAULT = "0x055a8441F18B07Ae0F4967A2d114dB1D7059FdD0";
  const INSURANCE_POOL = "0x35E74a62D538325F50c635ad518E5ae469527f88";
  const TRUST_GOVERNOR = "0x1e548DC82c7B4d362c84084bd92263BCA6ecf17B";

  // 1. Set InsurancePool on StakingVault
  console.log("[1/3] Setting InsurancePool on StakingVault...");
  const sv = await ethers.getContractAt("StakingVault", STAKING_VAULT);
  const tx1 = await sv.setInsurancePool(INSURANCE_POOL);
  console.log(`  tx: ${tx1.hash}`);
  await tx1.wait();
  console.log("  ✅ StakingVault.insurancePool → InsurancePool");

  // 2. Grant PROPOSER_ROLE to Governor on Timelock
  console.log("\n[2/3] Granting PROPOSER_ROLE to TrustGovernor...");
  const tc = await ethers.getContractAt("TimelockController", TIMELOCK);
  const PROPOSER_ROLE = await tc.PROPOSER_ROLE();
  const tx2 = await tc.grantRole(PROPOSER_ROLE, TRUST_GOVERNOR);
  console.log(`  tx: ${tx2.hash}`);
  await tx2.wait();
  console.log("  ✅ TimelockController.PROPOSER_ROLE → TrustGovernor");

  // 3. Mint initial $TRUST
  console.log("\n[3/3] Minting initial $TRUST supply...");
  const tt = await ethers.getContractAt("TrustToken", TRUST_TOKEN);
  const initialMint = ethers.parseEther("100000000"); // 100M
  const tx3 = await tt.mint(deployer.address, initialMint);
  console.log(`  tx: ${tx3.hash}`);
  await tx3.wait();
  console.log("  ✅ Minted 100,000,000 $TRUST to deployer");

  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  console.log(`\nGas spent: ${ethers.formatEther(balance - balanceAfter)} ETH`);
  console.log(`Remaining: ${ethers.formatEther(balanceAfter)} ETH`);

  // Save complete deployment
  const deployment = {
    network: "base",
    chainId: 8453,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    existingContracts: {
      AgentRegistry: "0xb880bC6b0634812E85EC635B899cA197429069e8",
      CertificateRegistry: "0xD3cAf18d292168075653322780EF961BF6394c11",
      ReputationLedger: "0x12181081eec99b541271f1915cD00111dB2f31c6",
    },
    defiContracts: {
      TrustToken: TRUST_TOKEN,
      TimelockController: TIMELOCK,
      StakingVault: STAKING_VAULT,
      ReputationMarket: "0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD",
      InsurancePool: INSURANCE_POOL,
      VouchMarket: "0x19b1606219fA6F3C76d5753A2bc6C779a502bf25",
      TrustGovernor: TRUST_GOVERNOR,
    },
    initialMint: "100000000",
  };

  const fs = require("fs");
  fs.writeFileSync("deployment-defi.json", JSON.stringify(deployment, null, 2));
  console.log("\n✅ Complete deployment saved to deployment-defi.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
