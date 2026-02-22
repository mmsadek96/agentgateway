# AgentTrust Security Audit Preparation

**Version:** 1.0.0
**Date:** February 2026
**Scope:** 10 Smart Contracts on Base L2 (Chain ID: 8453)
**Compiler:** Solidity 0.8.27 (Optimizer: 200 runs, EVM: Cancun)

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Contract Inventory](#contract-inventory)
4. [Deployment Details](#deployment-details)
5. [Access Control Matrix](#access-control-matrix)
6. [Risk Assessment](#risk-assessment)
7. [Known Issues & Mitigations](#known-issues--mitigations)
8. [Cross-Contract Dependencies](#cross-contract-dependencies)
9. [Testing Coverage](#testing-coverage)
10. [Audit Scope Recommendations](#audit-scope-recommendations)

---

## System Overview

AgentTrust is a trust and reputation layer for the AI agent economy. It provides:

- **Agent Registration & Scoring:** On-chain reputation for AI agents (0-100 scale)
- **Financial Derivatives:** DeFi primitives built on reputation infrastructure
- **Democratic Design:** Only the AgentTrust backend wallet executes blockchain transactions; agents never need wallets

The system consists of 10 smart contracts: 3 core registry contracts (Phase 1) and 7 DeFi contracts (Phase 2).

---

## Architecture

```
CORE CONTRACTS (Phase 1)                  DEFI CONTRACTS (Phase 2)
+-----------------------+                 +-----------------------+
| AgentRegistry         |<---reads--------| StakingVault          |
| (scores, status)      |<---reads--------| ReputationMarket      |
+-----------------------+<---reads--------| InsurancePool         |
| CertificateRegistry   |                 +-----------------------+
| (JWT certificates)    |                 | VouchMarket (ERC-721) |
+-----------------------+                 +-----------------------+
| ReputationLedger      |
| (event history)       |                 +-----------------------+
+-----------------------+                 | TrustToken (ERC-20)   |
                                          +-----------------------+
                                          | TrustGovernor (DAO)   |
                                          | TimelockController    |
                                          +-----------------------+

Ownership: All DeFi contracts owned by TimelockController (DAO governance).
```

---

## Contract Inventory

| # | Contract | Type | Proxy | Lines | Dependencies |
|---|----------|------|-------|-------|-------------|
| 1 | TrustToken | ERC-20 + Votes | UUPS | 131 | OZ ERC20, Permit, Votes |
| 2 | StakingVault | Staking/stTRUST | UUPS | ~280 | TrustToken, AgentRegistry |
| 3 | ReputationMarket | Binary Options | UUPS | ~260 | TrustToken, AgentRegistry |
| 4 | InsurancePool | Insurance/CDS | UUPS | ~280 | TrustToken, AgentRegistry |
| 5 | VouchMarket | ERC-721 NFTs | UUPS | ~300 | AgentRegistry |
| 6 | TrustGovernor | DAO Governance | UUPS | ~120 | TrustToken (IVotes) |
| 7 | TimelockController | Timelock | Standard | OZ | - |
| 8 | AgentRegistry | Registry | UUPS | ~200 | - |
| 9 | CertificateRegistry | Certificates | UUPS | ~180 | AgentRegistry |
| 10 | ReputationLedger | Event Log | UUPS | ~150 | AgentRegistry |

**Total Solidity lines (approx):** ~2,100 (excluding interfaces and imports)

---

## Deployment Details

**Network:** Base Mainnet (Chain ID: 8453)
**RPC:** https://mainnet.base.org
**Block Explorer:** https://basescan.org

| Contract | Address | Verified |
|----------|---------|----------|
| AgentRegistry | `0xb880bC6b0634812E85EC635B899cA197429069e8` | Yes |
| CertificateRegistry | `0xD3cAf18d292168075653322780EF961BF6394c11` | Yes |
| ReputationLedger | `0x12181081eec99b541271f1915cD00111dB2f31c6` | Yes |
| TrustToken | `0x70A9fc13bA469b8D0CD0d50c1137c26327CAB0F2` | Yes |
| StakingVault | `0x055a8441F18B07Ae0F4967A2d114dB1D7059FdD0` | Yes |
| ReputationMarket | `0x75b023F18daF98B8AFE0F92d69BFe5bF82730adD` | Yes |
| InsurancePool | `0x35E74a62D538325F50c635ad518E5ae469527f88` | Yes |
| VouchMarket | `0x19b1606219fA6F3C76d5753A2bc6C779a502bf25` | Yes |
| TrustGovernor | `0x1e548DC82c7B4d362c84084bd92263BCA6ecf17B` | Yes |
| TimelockController | `0xEF561b4b7b9aaCB265f582Ab75971ae18E0487b1` | Yes |

**Deployer wallet:** `0x5F3B19B9AB09f10cd176a401618c883473006E6A`

---

## Access Control Matrix

All DeFi contracts use `onlyOwner` modifier. Ownership has been transferred from the deployer to the TimelockController for DAO governance.

| Function | Contract | Caller | Notes |
|----------|----------|--------|-------|
| `mint()` | TrustToken | Owner OR minters[] | Dual-path minting |
| `addMinter()` / `removeMinter()` | TrustToken | Owner (Timelock) | Minter management |
| `stake()` | StakingVault | Owner (Timelock) | Deposit TRUST |
| `requestUnstake()` / `completeUnstake()` | StakingVault | Owner (Timelock) | Unstaking flow |
| `slash()` | StakingVault | Owner (Timelock) | Deduct from agent stake |
| `createMarket()` | ReputationMarket | Owner (Timelock) | New binary options market |
| `betYes()` / `betNo()` | ReputationMarket | Owner (Timelock) | Place bets |
| `settle()` / `claim()` | ReputationMarket | Owner (Timelock) | Settlement and payout |
| `depositCollateral()` | InsurancePool | Owner (Timelock) | Deposit collateral |
| `buyPolicy()` / `fileClaim()` | InsurancePool | Owner (Timelock) | Policy lifecycle |
| `mintVouch()` | VouchMarket | Owner (Timelock) | Mint vouch NFT |
| `deactivateVouch()` / `reactivateVouch()` | VouchMarket | Owner (Timelock) | Vouch management |
| `registerAgent()` / `updateReputation()` | AgentRegistry | Owner (Timelock) | Agent management |

**Governance Parameters:**
- Voting Delay: 7,200 blocks (~1 day)
- Voting Period: 21,600 blocks (~3 days)
- Proposal Threshold: 100,000 TRUST
- Quorum: 4% of total supply
- Timelock Delay: 86,400 seconds (1 day)

---

## Risk Assessment

> **All issues below have been FIXED** as of February 2026. Upgrade deployment script: `contracts/scripts/upgradeSecurityFixes.ts`

### Critical Severity — ✅ ALL FIXED

| ID | Contract | Issue | Fix |
|----|----------|-------|-----|
| C-1 | AgentRegistry | No validation on reputationScore range in `updateReputation()` | ✅ Added `require(newScore <= 1000)` and `require(newSuccessRate <= 1000)` in both `updateReputation()` and `batchUpdateReputation()` |
| C-2 | ReputationMarket | Division by zero in `claim()` if winnerPool = 0 | ✅ Added `if (winnerPool == 0) revert WinnerPoolEmpty(marketId)` guard before division |
| C-3 | InsurancePool | Multiple policies can have combined coverage exceeding agent collateral | ✅ Added `reservedCollateral` mapping per agent, tracking sum of active policy coverage. `buyPolicy()` now checks against available (unreserved) collateral |

### High Severity — ✅ ALL FIXED

| ID | Contract | Issue | Fix |
|----|----------|-------|-----|
| H-1 | InsurancePool | `withdrawCollateral()` doesn't check outstanding policy coverage | ✅ `withdrawCollateral()` now checks `amount <= agentCollateral - reservedCollateral`. Reserved collateral released on `fileClaim()` and `expirePolicy()` |
| H-2 | StakingVault | No upper bound validation on `slashBasisPoints` | ✅ Added `if (_bps > 10000) revert BpsTooHigh(_bps)` in `setSlashBasisPoints()` |
| H-3 | ReputationMarket | Protocol fee could be set >10000 bps | ✅ Added `if (_bps > 10000) revert FeeBpsTooHigh(_bps)` in `setProtocolFeeBps()` |
| H-4 | TrustGovernor | No verification of timelock minimum delay at initialization | ✅ `initialize()` now verifies `_timelock.getMinDelay() >= MIN_TIMELOCK_DELAY (1 hour)` |

### Medium Severity — ✅ ALL FIXED

| ID | Contract | Issue | Fix |
|----|----------|-------|-----|
| M-1 | AgentRegistry | Status transitions not validated (allows any uint8) | ✅ Added `require(newStatus <= 3, "Invalid status (0-3)")` in `changeStatus()` |
| M-2 | ReputationMarket | No maximum market duration | ✅ Added `MAX_MARKET_DURATION = 365 days` constant and validation in `createMarket()` |
| M-3 | InsurancePool | No maximum policy duration | ✅ Added `MAX_POLICY_DURATION = 365 days` constant and validation in `buyPolicy()` |
| M-4 | VouchMarket | Weight-based score calculation iterates unbounded array | ✅ Added `MAX_VOUCH_ITERATION = 100` cap in `getActiveVouchCount()` and `getVouchScore()` |
| M-5 | TrustToken | No minter allowance tracking | ✅ Added `minterAllowance` and `minterMinted` mappings. `addMinter()` now takes allowance param. `mint()` enforces per-minter limits |

### Low Severity — ✅ ALL FIXED (except L-2)

| ID | Contract | Issue | Fix |
|----|----------|-------|-----|
| L-1 | All contracts | Some events emitted before state changes | ✅ Reordered events in StakingVault, InsurancePool, AgentRegistry to emit after state changes |
| L-2 | VouchMarket | Custom base64 encoding instead of OZ utility | ⚠️ Accepted risk — custom encoding works correctly and changing it would alter tokenURI output |
| L-3 | ReputationMarket/InsurancePool | Missing `feeRecipient != address(0)` validation | ✅ Added `if (_recipient == address(0)) revert ZeroAddress()` in both contracts |
| L-4 | InsurancePool | No event for underpayment in `ClaimFiled` | ✅ Added `bool underpaid` parameter to `ClaimFiled` event |

---

## Known Issues & Mitigations

### Oracle Centralization

All DeFi contracts read reputation scores from `AgentRegistry.getReputation()`. This is a centralized oracle controlled by the AgentTrust backend wallet (now Timelock). If the registry is compromised, all downstream operations (market settlement, insurance claims, vouch scoring) are affected.

**Mitigation:** Ownership transferred to TimelockController with 1-day delay. Any registry update requires a DAO vote + 1-day timelock.

### Single Wallet Architecture

The system is designed for single-wallet operation (the AgentTrust API wallet). All `onlyOwner` functions are called by one wallet. This is by design ("democratic design - agents never need wallets") but concentrates risk.

**Mitigation:** Ownership transferred to TimelockController governed by TrustGovernor DAO. Multi-sig could be added as an additional signer requirement.

### Token Supply

100M TRUST was minted to the deployer at deployment. The MAX_SUPPLY is 1 billion. The deployer (or future governance) could mint up to 900M additional tokens.

**Mitigation:** TrustToken ownership is controlled by TimelockController. Any minting requires DAO vote + 1-day delay.

---

## Cross-Contract Dependencies

```
TrustToken (ERC-20)
  |
  +-- StakingVault (holds TRUST, mints stTRUST)
  |     +-- reads AgentRegistry (agent status)
  |     +-- sends slashed funds to InsurancePool
  |
  +-- ReputationMarket (holds TRUST in pools)
  |     +-- reads AgentRegistry (reputation for settlement)
  |
  +-- InsurancePool (holds TRUST as collateral/premiums)
  |     +-- reads AgentRegistry (reputation for claims)
  |
  +-- TrustGovernor (uses TRUST for voting)
        +-- controls TimelockController
              +-- owns all DeFi contracts
```

### Critical Dependency: AgentRegistry

If AgentRegistry returns incorrect data:
- **StakingVault:** `stake()` might accept stakes for inactive agents
- **ReputationMarket:** `settle()` would set wrong market outcomes
- **InsurancePool:** `fileClaim()` could trigger false claims
- **VouchMarket:** `mintVouch()` could allow low-score agents to vouch

---

## Testing Coverage

### API Integration Tests (Jest + Supertest)

| Test Suite | Tests | Coverage |
|-----------|-------|----------|
| Health & Basic Routes | 4 | 200 OK, 404, landing page |
| Authentication Middleware | 6 | Missing auth, Bearer validation, fingerprint lookup |
| Developer Routes | 10 | Registration, dashboard, agent CRUD |
| Verification Routes | 8 | Agent verification, outcome reporting |
| Trust & Staking Routes | 15 | Token stats, balance, staking, unstaking |
| Markets Routes | 15 | Market stats, details, creation, betting, settlement |
| Insurance Routes | 12 | Insurance stats, collateral, policies, claims |
| Vouch NFT Routes | 10 | NFT stats, minting, metadata |
| Governance Routes | 5 | Governance info, contract addresses, overview |
| Dashboard Routes | 8 | Dashboard page, API endpoints, DeFi stats |
| **Total** | **93** | |

### Smart Contract Tests

Contract tests can be run with:
```bash
cd contracts && npx hardhat test
```

---

## Audit Scope Recommendations

### Priority 1 (Must Audit)

1. **AgentRegistry.sol** - Central oracle for all DeFi contracts. Input validation, data integrity.
2. **StakingVault.sol** - Holds user funds. Slash mechanics, cooldown bypass, reentrancy.
3. **ReputationMarket.sol** - Handles bets and payouts. Division by zero, rounding errors, fee extraction.
4. **InsurancePool.sol** - Complex collateral accounting. Multi-policy coverage, premium calculation.

### Priority 2 (Should Audit)

5. **TrustToken.sol** - ERC-20 with minting and voting. Supply cap enforcement, permit integration.
6. **VouchMarket.sol** - ERC-721 with custom metadata. Score calculation, gas limits on iteration.
7. **TrustGovernor.sol** - DAO governance. Quorum manipulation, timelock integration.

### Priority 3 (Nice to Audit)

8. **CertificateRegistry.sol** - Certificate issuance and revocation. Expiry handling.
9. **ReputationLedger.sol** - Event logging. No funds at risk.
10. **TimelockController** - OpenZeppelin standard. Low custom code.

### Specific Areas of Focus

1. **Reentrancy in token operations** (StakingVault, ReputationMarket, InsurancePool)
2. **Integer overflow/underflow** in score calculations and basis point math
3. **Access control after ownership transfer** to TimelockController
4. **Cross-contract state consistency** (slash + policy + market interactions)
5. **UUPS upgrade authorization** across all upgradeable contracts
6. **ERC-20/ERC-721 standard compliance** (TrustToken, stTRUST, VouchMarket)

---

## Environment Variables Required

| Variable | Purpose | Required |
|----------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Certificate signing key | Yes |
| `BASE_PRIVATE_KEY` | Wallet private key for blockchain operations | For DeFi |
| `BASESCAN_API_KEY` | BaseScan verification | For deployment |

---

## Build & Verify

```bash
# API
npm ci
npx prisma generate
npm run build
npm test

# Contracts
cd contracts
npm ci
npx hardhat compile
npx hardhat test
```

---

## Contact

- **Repository:** https://github.com/mmsadek96/agentgateway
- **NPM:** @agent-trust/sdk, @agent-trust/gateway
- **API:** https://agenttrust-api-e8712855858d.herokuapp.com
- **Dashboard:** https://agenttrust-api-e8712855858d.herokuapp.com/dashboard
