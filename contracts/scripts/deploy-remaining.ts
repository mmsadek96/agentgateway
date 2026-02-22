import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("AgentTrust — Deploying Remaining Contracts");
  console.log("=".repeat(60));
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log("-".repeat(60));

  console.log("\nAgentRegistry already deployed: 0xb880bC6b0634812E85EC635B899cA197429069e8");

  // 2. Deploy CertificateRegistry
  console.log("\n[2/3] Deploying CertificateRegistry...");
  const CertificateRegistry = await ethers.getContractFactory("CertificateRegistry");
  const certificateRegistry = await upgrades.deployProxy(CertificateRegistry, [], {
    initializer: "initialize",
    kind: "uups",
  });
  await certificateRegistry.waitForDeployment();
  const certificateRegistryAddress = await certificateRegistry.getAddress();
  console.log(`  CertificateRegistry proxy: ${certificateRegistryAddress}`);

  // Wait a bit for nonce to sync
  console.log("\n  Waiting 5s for nonce sync...");
  await new Promise(r => setTimeout(r, 5000));

  // 3. Deploy ReputationLedger
  console.log("\n[3/3] Deploying ReputationLedger...");
  const ReputationLedger = await ethers.getContractFactory("ReputationLedger");
  const reputationLedger = await upgrades.deployProxy(ReputationLedger, [], {
    initializer: "initialize",
    kind: "uups",
  });
  await reputationLedger.waitForDeployment();
  const reputationLedgerAddress = await reputationLedger.getAddress();
  console.log(`  ReputationLedger proxy: ${reputationLedgerAddress}`);

  // Summary
  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  const gasUsed = balance - balanceAfter;

  console.log("\n" + "=".repeat(60));
  console.log("ALL CONTRACTS DEPLOYED");
  console.log("=".repeat(60));
  console.log(`\nContract Addresses:`);
  console.log(`  AgentRegistry:       0xb880bC6b0634812E85EC635B899cA197429069e8`);
  console.log(`  CertificateRegistry: ${certificateRegistryAddress}`);
  console.log(`  ReputationLedger:    ${reputationLedgerAddress}`);
  console.log(`\nGas spent (this run): ${ethers.formatEther(gasUsed)} ETH`);
  console.log(`Remaining balance: ${ethers.formatEther(balanceAfter)} ETH`);

  // Save full deployment info
  const deployment = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      AgentRegistry: "0xb880bC6b0634812E85EC635B899cA197429069e8",
      CertificateRegistry: certificateRegistryAddress,
      ReputationLedger: reputationLedgerAddress,
    },
    gasUsed: ethers.formatEther(gasUsed),
  };

  const fs = require("fs");
  fs.writeFileSync("deployment.json", JSON.stringify(deployment, null, 2));
  console.log("\nDeployment info saved to deployment.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
