# AgentTrust — Blockchain Architecture (Base L2)

> Technical design document for on-chain trust infrastructure.
> **Status: DEPLOYED TO BASE MAINNET**
> Version: 1.0 — 2026-02-22

---

## Overview

AgentTrust uses Base L2 (Coinbase's Ethereum Layer 2) as the immutable trust layer for AI agent certificates and reputation. The blockchain replaces our centralized server as the certificate authority, making every certificate and reputation score independently verifiable by anyone without trusting AgentTrust.

**Core principle:** The blockchain is invisible to users. Agents interact through REST APIs. Websites interact through npm packages. Only AgentTrust's operational wallet writes to the chain. Everyone else reads for free.

---

## Smart Contracts

Three contracts deployed on Base mainnet. All are upgradeable via OpenZeppelin's UUPS proxy pattern so we can ship fixes without redeploying.

### Deployed Addresses (Base Mainnet)

| Contract | Proxy Address |
|----------|---------------|
| **AgentRegistry** | [`0xb880bC6b0634812E85EC635B899cA197429069e8`](https://basescan.org/address/0xb880bC6b0634812E85EC635B899cA197429069e8) |
| **CertificateRegistry** | [`0xD3cAf18d292168075653322780EF961BF6394c11`](https://basescan.org/address/0xD3cAf18d292168075653322780EF961BF6394c11) |
| **ReputationLedger** | [`0x12181081eec99b541271f1915cD00111dB2f31c6`](https://basescan.org/address/0x12181081eec99b541271f1915cD00111dB2f31c6) |
| **Deployer/Owner** | `0x5F3B19B9AB09f10cd176a401618c883473006E6A` |

### Contract 1: AgentRegistry

Stores all registered agents and their current reputation.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract AgentRegistry is UUPSUpgradeable, OwnableUpgradeable {

    struct Agent {
        bytes32 externalId;       // keccak256 hash of agent's external ID
        uint16 reputationScore;   // 0-1000 (stored as 10x for one decimal precision)
        uint32 totalActions;      // lifetime action count
        uint16 successRate;       // 0-1000 (percentage * 10)
        uint8 status;             // 0=inactive, 1=active, 2=suspended, 3=banned
        uint40 registeredAt;      // unix timestamp
        uint40 lastUpdated;       // unix timestamp
        bytes32 metadataHash;     // IPFS hash or hash of off-chain metadata
    }

    // agentId (bytes32) => Agent
    mapping(bytes32 => Agent) public agents;

    // track all agent IDs for enumeration
    bytes32[] public agentIds;

    // total counts
    uint256 public totalAgents;
    uint256 public activeAgents;

    event AgentRegistered(bytes32 indexed agentId, bytes32 externalId, uint40 registeredAt);
    event ReputationUpdated(bytes32 indexed agentId, uint16 oldScore, uint16 newScore, uint40 timestamp);
    event StatusChanged(bytes32 indexed agentId, uint8 oldStatus, uint8 newStatus, string reason);
    event AgentSlashed(bytes32 indexed agentId, uint16 scorePenalty, string reason, uint40 timestamp);

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function registerAgent(
        bytes32 agentId,
        bytes32 externalId,
        bytes32 metadataHash
    ) external onlyOwner {
        require(agents[agentId].registeredAt == 0, "Agent already registered");

        agents[agentId] = Agent({
            externalId: externalId,
            reputationScore: 500,  // start at 50.0
            totalActions: 0,
            successRate: 1000,     // 100% initially
            status: 1,            // active
            registeredAt: uint40(block.timestamp),
            lastUpdated: uint40(block.timestamp),
            metadataHash: metadataHash
        });

        agentIds.push(agentId);
        totalAgents++;
        activeAgents++;

        emit AgentRegistered(agentId, externalId, uint40(block.timestamp));
    }

    function updateReputation(
        bytes32 agentId,
        uint16 newScore,
        uint32 newTotalActions,
        uint16 newSuccessRate
    ) external onlyOwner {
        Agent storage agent = agents[agentId];
        require(agent.registeredAt != 0, "Agent not found");

        uint16 oldScore = agent.reputationScore;
        agent.reputationScore = newScore;
        agent.totalActions = newTotalActions;
        agent.successRate = newSuccessRate;
        agent.lastUpdated = uint40(block.timestamp);

        emit ReputationUpdated(agentId, oldScore, newScore, uint40(block.timestamp));
    }

    // Batch update multiple agents in one transaction (saves gas)
    function batchUpdateReputation(
        bytes32[] calldata _agentIds,
        uint16[] calldata newScores,
        uint32[] calldata newTotalActions,
        uint16[] calldata newSuccessRates
    ) external onlyOwner {
        require(
            _agentIds.length == newScores.length &&
            _agentIds.length == newTotalActions.length &&
            _agentIds.length == newSuccessRates.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < _agentIds.length; i++) {
            Agent storage agent = agents[_agentIds[i]];
            if (agent.registeredAt == 0) continue;

            uint16 oldScore = agent.reputationScore;
            agent.reputationScore = newScores[i];
            agent.totalActions = newTotalActions[i];
            agent.successRate = newSuccessRates[i];
            agent.lastUpdated = uint40(block.timestamp);

            emit ReputationUpdated(_agentIds[i], oldScore, newScores[i], uint40(block.timestamp));
        }
    }

    function changeStatus(
        bytes32 agentId,
        uint8 newStatus,
        string calldata reason
    ) external onlyOwner {
        Agent storage agent = agents[agentId];
        require(agent.registeredAt != 0, "Agent not found");

        uint8 oldStatus = agent.status;

        // track active count
        if (oldStatus == 1 && newStatus != 1) activeAgents--;
        if (oldStatus != 1 && newStatus == 1) activeAgents++;

        agent.status = newStatus;
        agent.lastUpdated = uint40(block.timestamp);

        emit StatusChanged(agentId, oldStatus, newStatus, reason);
    }

    function slashAgent(
        bytes32 agentId,
        uint16 scorePenalty,
        string calldata reason
    ) external onlyOwner {
        Agent storage agent = agents[agentId];
        require(agent.registeredAt != 0, "Agent not found");

        uint16 oldScore = agent.reputationScore;
        if (agent.reputationScore > scorePenalty) {
            agent.reputationScore -= scorePenalty;
        } else {
            agent.reputationScore = 0;
        }
        agent.lastUpdated = uint40(block.timestamp);

        emit AgentSlashed(agentId, scorePenalty, reason, uint40(block.timestamp));
        emit ReputationUpdated(agentId, oldScore, agent.reputationScore, uint40(block.timestamp));
    }

    // --- Read functions (FREE for anyone) ---

    function getAgent(bytes32 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    function getReputation(bytes32 agentId) external view returns (uint16) {
        return agents[agentId].reputationScore;
    }

    function getStatus(bytes32 agentId) external view returns (uint8) {
        return agents[agentId].status;
    }

    function isActive(bytes32 agentId) external view returns (bool) {
        return agents[agentId].status == 1;
    }

    function getAgentCount() external view returns (uint256 total, uint256 active) {
        return (totalAgents, activeAgents);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

### Contract 2: CertificateRegistry

Stores all issued certificates. This is the core trust artifact.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract CertificateRegistry is UUPSUpgradeable, OwnableUpgradeable {

    struct Certificate {
        bytes32 agentId;          // reference to AgentRegistry
        uint16 scoreAtIssuance;   // reputation score when cert was issued
        bytes32 scopeHash;        // keccak256 of the scope manifest JSON
        uint8 status;             // 0=valid, 1=expired, 2=revoked
        uint40 issuedAt;          // unix timestamp
        uint40 expiresAt;         // unix timestamp
        uint40 revokedAt;         // 0 if not revoked
        string revokeReason;      // empty if not revoked
    }

    // certId (bytes32) => Certificate
    mapping(bytes32 => Certificate) public certificates;

    // agentId => array of cert IDs (history)
    mapping(bytes32 => bytes32[]) public agentCertificates;

    // agentId => current active cert ID
    mapping(bytes32 => bytes32) public activeCertificate;

    uint256 public totalCertificates;
    uint256 public activeCertificateCount;

    event CertificateIssued(
        bytes32 indexed certId,
        bytes32 indexed agentId,
        uint16 scoreAtIssuance,
        bytes32 scopeHash,
        uint40 issuedAt,
        uint40 expiresAt
    );

    event CertificateRevoked(
        bytes32 indexed certId,
        bytes32 indexed agentId,
        string reason,
        uint40 revokedAt
    );

    event CertificateExpired(
        bytes32 indexed certId,
        bytes32 indexed agentId,
        uint40 expiredAt
    );

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function issueCertificate(
        bytes32 certId,
        bytes32 agentId,
        uint16 scoreAtIssuance,
        bytes32 scopeHash,
        uint40 expiresAt
    ) external onlyOwner {
        require(certificates[certId].issuedAt == 0, "Certificate ID already exists");
        require(expiresAt > block.timestamp, "Expiry must be in the future");

        certificates[certId] = Certificate({
            agentId: agentId,
            scoreAtIssuance: scoreAtIssuance,
            scopeHash: scopeHash,
            status: 0,           // valid
            issuedAt: uint40(block.timestamp),
            expiresAt: expiresAt,
            revokedAt: 0,
            revokeReason: ""
        });

        agentCertificates[agentId].push(certId);

        // deactivate previous active cert
        bytes32 prevCert = activeCertificate[agentId];
        if (prevCert != bytes32(0) && certificates[prevCert].status == 0) {
            certificates[prevCert].status = 1; // mark as expired
            activeCertificateCount--;
            emit CertificateExpired(prevCert, agentId, uint40(block.timestamp));
        }

        activeCertificate[agentId] = certId;
        totalCertificates++;
        activeCertificateCount++;

        emit CertificateIssued(certId, agentId, scoreAtIssuance, scopeHash, uint40(block.timestamp), expiresAt);
    }

    function revokeCertificate(
        bytes32 certId,
        string calldata reason
    ) external onlyOwner {
        Certificate storage cert = certificates[certId];
        require(cert.issuedAt != 0, "Certificate not found");
        require(cert.status == 0, "Certificate not active");

        cert.status = 2;       // revoked
        cert.revokedAt = uint40(block.timestamp);
        cert.revokeReason = reason;

        // clear active cert for this agent
        if (activeCertificate[cert.agentId] == certId) {
            activeCertificate[cert.agentId] = bytes32(0);
        }
        activeCertificateCount--;

        emit CertificateRevoked(certId, cert.agentId, reason, uint40(block.timestamp));
    }

    // Batch issue certificates in one transaction
    function batchIssueCertificates(
        bytes32[] calldata certIds,
        bytes32[] calldata _agentIds,
        uint16[] calldata scores,
        bytes32[] calldata scopeHashes,
        uint40[] calldata expiries
    ) external onlyOwner {
        require(
            certIds.length == _agentIds.length &&
            certIds.length == scores.length &&
            certIds.length == scopeHashes.length &&
            certIds.length == expiries.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < certIds.length; i++) {
            if (certificates[certIds[i]].issuedAt != 0) continue;
            if (expiries[i] <= block.timestamp) continue;

            certificates[certIds[i]] = Certificate({
                agentId: _agentIds[i],
                scoreAtIssuance: scores[i],
                scopeHash: scopeHashes[i],
                status: 0,
                issuedAt: uint40(block.timestamp),
                expiresAt: expiries[i],
                revokedAt: 0,
                revokeReason: ""
            });

            agentCertificates[_agentIds[i]].push(certIds[i]);
            activeCertificate[_agentIds[i]] = certIds[i];
            totalCertificates++;
            activeCertificateCount++;

            emit CertificateIssued(
                certIds[i], _agentIds[i], scores[i], scopeHashes[i],
                uint40(block.timestamp), expiries[i]
            );
        }
    }

    // --- Read functions (FREE for anyone) ---

    function getCertificate(bytes32 certId) external view returns (Certificate memory) {
        return certificates[certId];
    }

    function verifyCertificate(bytes32 certId) external view returns (
        bool isValid,
        bytes32 agentId,
        uint16 score,
        bytes32 scopeHash
    ) {
        Certificate memory cert = certificates[certId];
        bool valid = cert.issuedAt != 0 &&
                     cert.status == 0 &&
                     block.timestamp < cert.expiresAt;
        return (valid, cert.agentId, cert.scoreAtIssuance, cert.scopeHash);
    }

    function getActiveCertificate(bytes32 agentId) external view returns (bytes32) {
        return activeCertificate[agentId];
    }

    function getAgentCertificateHistory(bytes32 agentId) external view returns (bytes32[] memory) {
        return agentCertificates[agentId];
    }

    function getStats() external view returns (uint256 total, uint256 active) {
        return (totalCertificates, activeCertificateCount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

### Contract 3: ReputationLedger

Immutable log of all reputation changes. This is the audit trail.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract ReputationLedger is UUPSUpgradeable, OwnableUpgradeable {

    struct ReputationEvent {
        bytes32 agentId;
        uint8 eventType;          // 0=score_update, 1=slash, 2=reward, 3=status_change
        uint16 scoreBefore;
        uint16 scoreAfter;
        bytes32 evidenceHash;     // hash of off-chain evidence (behavioral report, etc.)
        uint40 timestamp;
    }

    // sequential event log
    ReputationEvent[] public events;

    // agentId => indices into events array
    mapping(bytes32 => uint256[]) public agentEvents;

    // global stats
    uint256 public totalEvents;
    uint256 public totalSlashes;
    uint256 public totalRewards;

    event ReputationEventLogged(
        uint256 indexed eventIndex,
        bytes32 indexed agentId,
        uint8 eventType,
        uint16 scoreBefore,
        uint16 scoreAfter,
        bytes32 evidenceHash,
        uint40 timestamp
    );

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function logEvent(
        bytes32 agentId,
        uint8 eventType,
        uint16 scoreBefore,
        uint16 scoreAfter,
        bytes32 evidenceHash
    ) external onlyOwner {
        uint256 index = events.length;

        events.push(ReputationEvent({
            agentId: agentId,
            eventType: eventType,
            scoreBefore: scoreBefore,
            scoreAfter: scoreAfter,
            evidenceHash: evidenceHash,
            timestamp: uint40(block.timestamp)
        }));

        agentEvents[agentId].push(index);
        totalEvents++;

        if (eventType == 1) totalSlashes++;
        if (eventType == 2) totalRewards++;

        emit ReputationEventLogged(
            index, agentId, eventType, scoreBefore, scoreAfter,
            evidenceHash, uint40(block.timestamp)
        );
    }

    // Batch log events in one transaction
    function batchLogEvents(
        bytes32[] calldata _agentIds,
        uint8[] calldata eventTypes,
        uint16[] calldata scoresBefore,
        uint16[] calldata scoresAfter,
        bytes32[] calldata evidenceHashes
    ) external onlyOwner {
        require(
            _agentIds.length == eventTypes.length &&
            _agentIds.length == scoresBefore.length &&
            _agentIds.length == scoresAfter.length &&
            _agentIds.length == evidenceHashes.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < _agentIds.length; i++) {
            uint256 index = events.length;

            events.push(ReputationEvent({
                agentId: _agentIds[i],
                eventType: eventTypes[i],
                scoreBefore: scoresBefore[i],
                scoreAfter: scoresAfter[i],
                evidenceHash: evidenceHashes[i],
                timestamp: uint40(block.timestamp)
            }));

            agentEvents[_agentIds[i]].push(index);
            totalEvents++;

            if (eventTypes[i] == 1) totalSlashes++;
            if (eventTypes[i] == 2) totalRewards++;

            emit ReputationEventLogged(
                index, _agentIds[i], eventTypes[i], scoresBefore[i], scoresAfter[i],
                evidenceHashes[i], uint40(block.timestamp)
            );
        }
    }

    // --- Read functions (FREE for anyone) ---

    function getEvent(uint256 index) external view returns (ReputationEvent memory) {
        require(index < events.length, "Index out of bounds");
        return events[index];
    }

    function getAgentHistory(bytes32 agentId) external view returns (uint256[] memory) {
        return agentEvents[agentId];
    }

    function getAgentEventCount(bytes32 agentId) external view returns (uint256) {
        return agentEvents[agentId].length;
    }

    function getRecentEvents(uint256 count) external view returns (ReputationEvent[] memory) {
        uint256 total = events.length;
        if (count > total) count = total;

        ReputationEvent[] memory recent = new ReputationEvent[](count);
        for (uint256 i = 0; i < count; i++) {
            recent[i] = events[total - count + i];
        }
        return recent;
    }

    function getStats() external view returns (
        uint256 _totalEvents,
        uint256 _totalSlashes,
        uint256 _totalRewards
    ) {
        return (totalEvents, totalSlashes, totalRewards);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

---

## Integration Flow

### How an Agent Gets a Certificate (no wallet needed)

```
1. Agent calls POST /api/agents/register
   Body: { name: "my-agent", developer: "acme-corp" }

2. Our API:
   a. Creates agent record in our database
   b. Generates a bytes32 agentId (keccak256 of UUID)
   c. Calls AgentRegistry.registerAgent(agentId, ...) on Base
   d. Returns API key + agentId to the agent

3. Agent behaves on websites, builds reputation off-chain

4. Periodically (every hour or on threshold):
   a. Our API batches reputation updates
   b. Calls AgentRegistry.batchUpdateReputation(...)
   c. One transaction updates dozens of agents

5. Agent requests certificate:
   POST /api/certificates/request
   Body: { scope: ["search", "view_product"] }

6. Our API:
   a. Checks agent's current reputation
   b. Generates certId (keccak256 of UUID)
   c. Computes scopeHash (keccak256 of scope JSON)
   d. Calls CertificateRegistry.issueCertificate(...)
   e. Returns certId + scope + on-chain tx hash to agent

7. Agent presents certId to any website
```

### How a Website Verifies (no wallet needed, FREE)

```
1. Website has @agent-trust/gateway installed

2. Agent makes request with certId in header:
   X-Agent-Certificate: 0xabc123...

3. Gateway middleware:
   a. Calls CertificateRegistry.verifyCertificate(certId)
      This is a READ call — completely free, no gas
   b. Gets back: isValid, agentId, score, scopeHash
   c. If invalid: reject request (401)
   d. If valid: check score against action threshold
   e. Verify scope: hash the requested action's scope
      and compare against on-chain scopeHash
   f. Allow or deny the request

4. Gateway monitors behavior in real-time (off-chain)

5. If agent misbehaves, gateway reports to our API
   Our API slashes the agent on-chain
```

### How Anyone Verifies Independently

```
Go to BaseScan
Find the CertificateRegistry contract
Call verifyCertificate(certId)
See: isValid, agentId, score, scopeHash

Or call AgentRegistry.getAgent(agentId)
See: full reputation profile, action count, status
```

---

## Off-Chain to On-Chain Sync Strategy

We don't write to the chain on every single action (that would be expensive and slow). Instead we use a batched sync approach.

### Real-Time (off-chain)
Every action goes through the gateway middleware in real-time with millisecond latency. Behavioral scoring, ML detection, and access control all happen off-chain. This is the fast path.

### Periodic Sync (on-chain)
Every hour (configurable), our sync service:
1. Collects all reputation changes since last sync
2. Batches them into one batchUpdateReputation transaction
3. Collects all new certificates to issue
4. Batches them into one batchIssueCertificates transaction
5. Logs reputation events into ReputationLedger

### Immediate Sync (on-chain)
Some events trigger immediate on-chain writes:
1. Agent banned (must reflect immediately)
2. Certificate revoked (security critical)
3. Major slash event (score drops below threshold)

### Sync Cost Estimate

| Scenario | Agents | Sync Frequency | Monthly Txns | Monthly Cost |
|----------|--------|---------------|--------------|-------------|
| Early stage | 50 | Hourly | ~750 | ~$0.75 |
| Growing | 500 | Hourly | ~7,500 | ~$7.50 |
| Scale | 5,000 | Hourly | ~75,000 | ~$75.00 |
| Large scale | 50,000 | Every 6 hours | ~125,000 | ~$125.00 |

$120 initial budget covers us well past 5,000 agents.

---

## Tech Stack for Contracts

| Component | Choice | Why |
|-----------|--------|-----|
| Language | Solidity ^0.8.24 | Required by OpenZeppelin v5 contracts |
| Framework | Hardhat | Best debugging, testing, deployment tooling |
| Testing | Hardhat + Chai | Unit tests for every contract function |
| Deployment | Hardhat Ignition | Reproducible deployments |
| Proxy pattern | OpenZeppelin UUPS | Upgradeability without redeploying |
| Client library | ethers.js v6 | Standard, works with our existing TypeScript |
| Network (test) | Base Sepolia | Free testnet ETH from Coinbase faucet |
| Network (prod) | Base Mainnet | Our MetaMask wallet funds operations |
| Verification | BaseScan | Auto-verify source code on deployment |

---

## Project Structure

```
contracts/
  contracts/
    AgentRegistry.sol
    CertificateRegistry.sol
    ReputationLedger.sol
  scripts/
    deploy.ts              // Deploy all 3 contracts as UUPS proxies
  .openzeppelin/
    base.json              // Proxy deployment records (DO NOT DELETE)
  hardhat.config.ts
  package.json
  .env                     // PRIVATE_KEY (gitignored)
  deployment.json          // Deployed addresses (gitignored)
```

---

## Security Considerations

### Access Control
Only the AgentTrust operational wallet (owner) can write to contracts. All write functions have the onlyOwner modifier. This wallet's private key is stored securely, never in code.

### Upgradeability
UUPS proxies allow us to fix bugs without redeploying. The upgrade function is restricted to owner. In the future we can transfer ownership to a multisig or DAO.

### Data Integrity
Every reputation change emits an event. Events are immutable and indexed. Anyone can reconstruct the full history from events alone. Evidence hashes link to off-chain proof stored on IPFS.

### Attack Vectors Addressed

**Sybil attacks:** Agent registration is controlled by us (onlyOwner). Bad actors can't mass-register agents on-chain.

**Reputation manipulation:** Only our API can update scores. The scoring algorithm runs off-chain with 6 detection algorithms. Manipulation attempts are caught by behavioral tracking before they reach the chain.

**Certificate forgery:** Certificates are on-chain records. You can't forge what doesn't exist in the contract. Anyone verifies by reading the contract directly.

**Replay attacks:** Each certificate has a unique certId, an issuedAt timestamp, and an expiresAt. Expired or revoked certificates fail verifyCertificate.

**Our wallet compromise:** Worst case scenario. Mitigated by: all events are logged immutably (can reconstruct correct state), move to multisig after launch, implement time-locks on critical operations in v2.

---

## Deployment Status

All three contracts are **live on Base mainnet** and integrated with the AgentTrust API.

### What's Deployed ✅
1. All 3 UUPS proxy contracts deployed to Base mainnet
2. Operational wallet funded on Base
3. Contracts verified on BaseScan
4. API dual-writes to both PostgreSQL and Base L2 (non-blocking)
5. Agent registration, certificate issuance, and reputation events all record on-chain
6. Gas costs monitored — ~$0.001 per write

### Production Hardening (Next)
1. Implement batch sync service (cron job) for periodic bulk updates
2. Add gas price monitoring and alerts
3. Implement emergency pause mechanism
4. Migrate contract ownership to multisig
5. Community contract audit
6. Verify contract source code on BaseScan (needs BASESCAN_API_KEY)
