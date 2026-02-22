import { ethers } from "hardhat";

/**
 * Transfer ownership of all DeFi contracts to the TimelockController.
 * This gives the DAO (TrustGovernor → Timelock) control over protocol parameters.
 *
 * After this script:
 * - StakingVault.setCooldownPeriod() → requires DAO vote
 * - StakingVault.setSlashBasisPoints() → requires DAO vote
 * - ReputationMarket.setProtocolFeeBps() → requires DAO vote
 * - InsurancePool.setProtocolFeeBps() → requires DAO vote
 * - All slash, stake, market, insurance operations → require DAO vote
 *
 * The deployer wallet retains NO ownership after this script runs.
 */

const TIMELOCK_ADDRESS = "0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1";

const CONTRACTS = [
  { name: "StakingVault", address: "0x055a8441F18B07Ae0F4967A2d114dB1D7059FdD0" },
  { name: "ReputationMarket", address: "0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD" },
  { name: "InsurancePool", address: "0x35E74a62D538325F50c635ad518E5ae469527f88" },
  { name: "VouchMarket", address: "0x19b1606219fA6F3C76d5753A2bc6C779a502bf25" },
];

const OwnableABI = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
];

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Timelock: ${TIMELOCK_ADDRESS}\n`);

  for (const c of CONTRACTS) {
    const contract = new ethers.Contract(c.address, OwnableABI, deployer);

    // Check current owner
    const currentOwner = await contract.owner();
    console.log(`${c.name} (${c.address})`);
    console.log(`  Current owner: ${currentOwner}`);

    if (currentOwner.toLowerCase() === TIMELOCK_ADDRESS.toLowerCase()) {
      console.log(`  ✅ Already owned by Timelock — skipping\n`);
      continue;
    }

    if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
      console.log(`  ⚠️  Not owned by deployer — cannot transfer. Skipping.\n`);
      continue;
    }

    // Transfer ownership
    const tx = await contract.transferOwnership(TIMELOCK_ADDRESS);
    console.log(`  📤 transferOwnership tx: ${tx.hash}`);
    await tx.wait();
    console.log(`  ✅ Ownership transferred to Timelock\n`);

    // Wait between transactions to avoid nonce issues
    await sleep(5000);
  }

  console.log("Done. All transferable contracts are now owned by the Timelock.");
  console.log("Protocol parameters can only be changed via DAO governance proposals.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
