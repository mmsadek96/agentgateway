import { ethers } from "hardhat";

/**
 * Execute the timelock-scheduled UUPS upgrades after the 24-hour delay.
 * Run this script at least 24 hours after upgradeSecurityFixes.ts.
 *
 * Scheduled operations:
 *   1. StakingVault upgrade
 *   2. ReputationMarket upgrade
 *   3. InsurancePool upgrade
 *   4. VouchMarket upgrade
 */

const TIMELOCK = "0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1";

const TimelockABI = [
  "function execute(address target, uint256 value, bytes calldata payload, bytes32 predecessor, bytes32 salt) external payable",
  "function hashOperation(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperationReady(bytes32 id) view returns (bool)",
  "function isOperationDone(bytes32 id) view returns (bool)",
];

const predecessor = "0x0000000000000000000000000000000000000000000000000000000000000000";

// These values were output by the schedule step
const operations = [
  {
    name: "StakingVault",
    target: "0x055a8441F18B07Ae0F4967A2d114dB1D7059FdD0",
    data: "0x4f1ef2860000000000000000000000002aafadd4f97f742a6ec8a3af05f2442bd6583b1700000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000",
    salt: "0x48bd86d64926362865a95ec61f0c66e1d6e3f7a0cd7d8ff45e619970998ff824",
  },
  {
    name: "ReputationMarket",
    target: "0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD",
    data: "0x4f1ef286000000000000000000000000b990433effa2301ebc1af780d16a418098c9295a00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000",
    salt: "0x87b97dcb59b3b2e4cfa70e932fe809352d4dbac63fc3d1ce23bdda67a1a8bd5f",
  },
  {
    name: "InsurancePool",
    target: "0x35E74a62D538325F50c635ad518E5ae469527f88",
    data: "0x4f1ef28600000000000000000000000027e4fb453382977df3b883b429244601eebbeeb300000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000",
    salt: "0xf6fe6d87c49f802a239c1f3803dae4a7b7ccebdbc1c31f84406626b7cc5a6214",
  },
  {
    name: "VouchMarket",
    target: "0x19b1606219fA6F3C76d5753A2bc6C779a502bf25",
    data: "0x4f1ef286000000000000000000000000e983fe8bbacb2ff0481b6b5d0a59e823a25e589400000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000",
    salt: "0x7c8f1e446090b6ac6b15fbaefd81085aec802c0d0ea8f35946154e49f7f37040",
  },
];

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=".repeat(70));
  console.log("AgentTrust — Execute Timelock Upgrades");
  console.log("=".repeat(70));
  console.log(`Deployer: ${deployer.address}\n`);

  const timelock = new ethers.Contract(TIMELOCK, TimelockABI, deployer);

  for (const op of operations) {
    console.log(`\n${op.name}:`);

    const opHash = await timelock.hashOperation(
      op.target, 0, op.data, predecessor, op.salt
    );

    const isDone = await timelock.isOperationDone(opHash);
    if (isDone) {
      console.log("  ✅ Already executed — skipping");
      continue;
    }

    const isReady = await timelock.isOperationReady(opHash);
    if (!isReady) {
      console.log("  ⏳ Not yet ready (timelock delay not elapsed). Try again later.");
      continue;
    }

    console.log("  Executing upgrade...");
    const tx = await timelock.execute(
      op.target, 0, op.data, predecessor, op.salt
    );
    console.log(`  TX: ${tx.hash}`);
    await tx.wait();
    console.log(`  ✅ ${op.name} upgraded!`);

    await sleep(5000);
  }

  console.log("\n✅ All timelock upgrades executed!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
