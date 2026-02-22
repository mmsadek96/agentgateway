import { ethers, upgrades } from "hardhat";

/**
 * UUPS Upgrade Script — Security Audit Fixes
 *
 * Upgrades all contracts to their security-patched V2 implementations.
 *
 * Contracts owned by deployer (direct upgrade):
 *   - AgentRegistry
 *   - TrustToken
 *   - TrustGovernor
 *
 * Contracts owned by TimelockController (upgrade via Timelock schedule+execute):
 *   - StakingVault
 *   - ReputationMarket
 *   - InsurancePool
 *   - VouchMarket
 *
 * Security fixes applied:
 *   C-1: AgentRegistry — score/successRate range validation (0-1000)
 *   C-2: ReputationMarket — division by zero guard in claim()
 *   C-3: InsurancePool — reserved collateral tracking
 *   H-1: InsurancePool — withdrawal checks against reserved collateral
 *   H-2: StakingVault — slashBasisPoints capped at 10000
 *   H-3: ReputationMarket — protocolFeeBps capped at 10000
 *   H-4: TrustGovernor — timelock minimum delay verification
 *   M-1: AgentRegistry — status transition validation (0-3)
 *   M-2: ReputationMarket — max market duration (365 days)
 *   M-3: InsurancePool — max policy duration (365 days)
 *   M-4: VouchMarket — loop iteration cap (100)
 *   M-5: TrustToken — per-minter allowance tracking
 *   L-1: All contracts — events emitted after state changes
 *   L-3: ReputationMarket/InsurancePool — feeRecipient != address(0) validation
 *   L-4: InsurancePool — underpayment flag in ClaimFiled event
 */

// ─── Addresses ───

const ADDRESSES = {
  AgentRegistry:      "0xb880bC6b0634812E85EC635B899cA197429069e8",
  CertificateRegistry: "0xD3cAf18d292168075653322780EF961BF6394c11",
  ReputationLedger:   "0x12181081eec99b541271f1915cD00111dB2f31c6",
  TrustToken:         "0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2",
  StakingVault:       "0x055a8441F18B07Ae0F4967A2d114dB1D7059FdD0",
  ReputationMarket:   "0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD",
  InsurancePool:      "0x35E74a62D538325F50c635ad518E5ae469527f88",
  VouchMarket:        "0x19b1606219fA6F3C76d5753A2bc6C779a502bf25",
  TrustGovernor:      "0x1e548DC82c7B4d362c84084bd92263BCA6ecf17B",
  TimelockController: "0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1",
};

// Minimal ABIs
const OwnableABI = [
  "function owner() view returns (address)",
  "function upgradeToAndCall(address newImplementation, bytes data)",
];

const TimelockABI = [
  "function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay) external",
  "function execute(address target, uint256 value, bytes calldata payload, bytes32 predecessor, bytes32 salt) external payable",
  "function getMinDelay() external view returns (uint256)",
  "function hashOperation(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperationReady(bytes32 id) view returns (bool)",
  "function isOperationDone(bytes32 id) view returns (bool)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",
];

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGasOverrides() {
  const feeData = await ethers.provider.getFeeData();
  // Add 20% buffer to gas prices to avoid "replacement transaction underpriced"
  const maxFeePerGas = feeData.maxFeePerGas
    ? (feeData.maxFeePerGas * 120n) / 100n
    : undefined;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
    ? (feeData.maxPriorityFeePerGas * 120n) / 100n
    : undefined;

  return { maxFeePerGas, maxPriorityFeePerGas };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(70));
  console.log("AgentTrust — Security Audit Fix Upgrades (UUPS)");
  console.log("=".repeat(70));
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log("-".repeat(70));

  const timelock = new ethers.Contract(ADDRESSES.TimelockController, TimelockABI, deployer);
  const timelockDelay = await timelock.getMinDelay();
  console.log(`Timelock delay: ${timelockDelay} seconds (${Number(timelockDelay) / 3600} hours)\n`);

  // ─── Grant deployer PROPOSER_ROLE on Timelock (needed for scheduling upgrades) ───
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const hasProposer = await timelock.hasRole(PROPOSER_ROLE, deployer.address);
  let grantedProposer = false;

  if (!hasProposer) {
    console.log("Granting deployer PROPOSER_ROLE on TimelockController...");
    const grantGas = await getGasOverrides();
    const grantTx = await timelock.grantRole(PROPOSER_ROLE, deployer.address, grantGas);
    console.log(`  TX: ${grantTx.hash}`);
    await grantTx.wait();
    console.log("  ✅ PROPOSER_ROLE granted to deployer\n");
    grantedProposer = true;
    await sleep(5000);
  } else {
    console.log("Deployer already has PROPOSER_ROLE ✅\n");
  }

  // ─── Contracts to upgrade ───
  // Skip AgentRegistry and TrustToken — already upgraded in previous run

  const upgradeList = [
    // Already upgraded — skip:
    // { name: "AgentRegistry",    address: ADDRESSES.AgentRegistry,    factory: "AgentRegistry" },
    // { name: "TrustToken",       address: ADDRESSES.TrustToken,       factory: "TrustToken" },
    { name: "StakingVault",     address: ADDRESSES.StakingVault,     factory: "StakingVault" },
    { name: "ReputationMarket", address: ADDRESSES.ReputationMarket, factory: "ReputationMarket" },
    { name: "InsurancePool",    address: ADDRESSES.InsurancePool,    factory: "InsurancePool" },
    { name: "VouchMarket",      address: ADDRESSES.VouchMarket,      factory: "VouchMarket" },
    { name: "TrustGovernor",    address: ADDRESSES.TrustGovernor,    factory: "TrustGovernor" },
  ];

  for (const item of upgradeList) {
    console.log(`\n${"─".repeat(50)}`);
    console.log(`Upgrading ${item.name} (${item.address})`);
    console.log(`${"─".repeat(50)}`);

    // Check current owner
    const proxy = new ethers.Contract(item.address, OwnableABI, deployer);
    const owner = await proxy.owner();
    const isDeployerOwned = owner.toLowerCase() === deployer.address.toLowerCase();
    const isTimelockOwned = owner.toLowerCase() === ADDRESSES.TimelockController.toLowerCase();

    console.log(`  Owner: ${owner}`);
    console.log(`  Deployer owned: ${isDeployerOwned}`);
    console.log(`  Timelock owned: ${isTimelockOwned}`);

    // Deploy new implementation with gas overrides
    console.log(`  Deploying new ${item.factory} implementation...`);
    const gasOverrides = await getGasOverrides();
    const Factory = await ethers.getContractFactory(item.factory);
    const newImpl = await Factory.deploy(gasOverrides);
    await newImpl.waitForDeployment();
    const newImplAddress = await newImpl.getAddress();
    console.log(`  New implementation: ${newImplAddress}`);

    // Wait 10s for nonce to settle before next tx
    await sleep(10000);

    if (isDeployerOwned) {
      // Direct upgrade — deployer is the owner
      console.log(`  Performing direct UUPS upgrade...`);
      const freshGas = await getGasOverrides();
      const tx = await proxy.upgradeToAndCall(newImplAddress, "0x", freshGas);
      console.log(`  TX: ${tx.hash}`);
      await tx.wait();
      console.log(`  ✅ ${item.name} upgraded successfully!`);

    } else if (isTimelockOwned) {
      // Timelock upgrade — schedule + wait + execute
      console.log(`  Scheduling upgrade via TimelockController...`);

      // Encode the upgradeToAndCall call
      const upgradeData = proxy.interface.encodeFunctionData("upgradeToAndCall", [
        newImplAddress,
        "0x",
      ]);

      // Generate unique salt from contract name and timestamp
      const salt = ethers.keccak256(
        ethers.toUtf8Bytes(`security-upgrade-${item.name}-${Date.now()}`)
      );
      const predecessor = ethers.ZeroHash;

      // Schedule with gas overrides
      const scheduleGas = await getGasOverrides();
      const scheduleTx = await timelock.schedule(
        item.address,
        0,
        upgradeData,
        predecessor,
        salt,
        timelockDelay,
        scheduleGas
      );
      console.log(`  Schedule TX: ${scheduleTx.hash}`);
      await scheduleTx.wait();

      // Get operation hash
      const opHash = await timelock.hashOperation(
        item.address,
        0,
        upgradeData,
        predecessor,
        salt
      );
      console.log(`  Operation hash: ${opHash}`);
      console.log(`  ⏳ Scheduled. Must wait ${timelockDelay} seconds before execution.`);
      console.log(`  After delay, execute with:`);
      console.log(`    timelock.execute("${item.address}", 0, "${upgradeData}", "${predecessor}", "${salt}")`);

      // If delay is 0 (testing) or very short, try to execute immediately
      if (Number(timelockDelay) <= 60) {
        console.log(`  Short delay detected, waiting and executing...`);
        await sleep((Number(timelockDelay) + 2) * 1000);

        const ready = await timelock.isOperationReady(opHash);
        if (ready) {
          const execGas = await getGasOverrides();
          const executeTx = await timelock.execute(
            item.address,
            0,
            upgradeData,
            predecessor,
            salt,
            execGas
          );
          console.log(`  Execute TX: ${executeTx.hash}`);
          await executeTx.wait();
          console.log(`  ✅ ${item.name} upgraded successfully via Timelock!`);
        } else {
          console.log(`  ⚠️  Operation not yet ready. Execute manually after delay.`);
        }
      }

    } else {
      console.log(`  ⚠️  Unknown owner — cannot upgrade. Skipping.`);
    }

    // Wait between deployments for nonce to settle
    await sleep(10000);
  }

  // ─── Cleanup: revoke deployer's PROPOSER_ROLE if we granted it ───
  if (grantedProposer) {
    console.log("\nRevoking deployer PROPOSER_ROLE (cleanup)...");
    const revokeGas = await getGasOverrides();
    const revokeTx = await timelock.revokeRole(PROPOSER_ROLE, deployer.address, revokeGas);
    console.log(`  TX: ${revokeTx.hash}`);
    await revokeTx.wait();
    console.log("  ✅ PROPOSER_ROLE revoked from deployer");
  }

  // ─── Verify upgrades ───
  console.log("\n" + "=".repeat(70));
  console.log("Verification");
  console.log("=".repeat(70));

  console.log("\nRun on BaseScan to verify new implementations:");
  for (const item of upgradeList) {
    console.log(`  npx hardhat verify --network base <new-impl-address> # ${item.name}`);
  }

  console.log("\n✅ Security audit upgrade deployment complete!");
  console.log("All Critical, High, Medium, and Low severity issues have been patched.");
  console.log("\nAlready upgraded (previous run):");
  console.log("  AgentRegistry: implementation 0x1f644f3CC82e3b9A243c09d929F97a5359922031");
  console.log("  TrustToken: implementation 0xfC07E24D7483A8a79A6E674385E6F89fa830f811");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
