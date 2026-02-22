import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("AgentTrust — Smart Contract Deployment");
  console.log("=".repeat(60));
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log("-".repeat(60));

  // 1. Deploy AgentRegistry
  console.log("\n[1/3] Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await upgrades.deployProxy(AgentRegistry, [], {
    initializer: "initialize",
    kind: "uups",
  });
  await agentRegistry.waitForDeployment();
  const agentRegistryAddress = await agentRegistry.getAddress();
  console.log(`  AgentRegistry proxy: ${agentRegistryAddress}`);

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
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`\nContract Addresses:`);
  console.log(`  AgentRegistry:       ${agentRegistryAddress}`);
  console.log(`  CertificateRegistry: ${certificateRegistryAddress}`);
  console.log(`  ReputationLedger:    ${reputationLedgerAddress}`);
  console.log(`\nGas spent: ${ethers.formatEther(gasUsed)} ETH`);
  console.log(`Remaining balance: ${ethers.formatEther(balanceAfter)} ETH`);
  console.log(`\nBaseScan verification:`);
  console.log(`  https://basescan.org/address/${agentRegistryAddress}`);
  console.log(`  https://basescan.org/address/${certificateRegistryAddress}`);
  console.log(`  https://basescan.org/address/${reputationLedgerAddress}`);

  // Save deployment info
  const deployment = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      AgentRegistry: agentRegistryAddress,
      CertificateRegistry: certificateRegistryAddress,
      ReputationLedger: reputationLedgerAddress,
    },
    gasUsed: ethers.formatEther(gasUsed),
  };

  const fs = require("fs");
  fs.writeFileSync(
    "deployment.json",
    JSON.stringify(deployment, null, 2)
  );
  console.log("\nDeployment info saved to deployment.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
