// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title AgentRegistry
 * @notice Stores all registered AI agents and their current reputation scores on Base L2.
 * @dev Only the AgentTrust operational wallet (owner) can write. Anyone can read for free.
 *      Agents and developers never need a wallet — the blockchain is invisible infrastructure.
 */
contract AgentRegistry is UUPSUpgradeable, OwnableUpgradeable {

    struct Agent {
        bytes32 externalId;       // keccak256 hash of agent's human-readable ID
        uint16 reputationScore;   // 0-1000 (stored as 10x for one decimal: 500 = 50.0)
        uint32 totalActions;      // lifetime action count
        uint16 successRate;       // 0-1000 (percentage * 10: 985 = 98.5%)
        uint8 status;             // 0=inactive, 1=active, 2=suspended, 3=banned
        uint40 registeredAt;      // unix timestamp
        uint40 lastUpdated;       // unix timestamp
        bytes32 metadataHash;     // IPFS hash or keccak256 of off-chain metadata
    }

    mapping(bytes32 => Agent) public agents;
    bytes32[] public agentIds;
    uint256 public totalAgents;
    uint256 public activeAgents;

    event AgentRegistered(bytes32 indexed agentId, bytes32 externalId, uint40 registeredAt);
    event ReputationUpdated(bytes32 indexed agentId, uint16 oldScore, uint16 newScore, uint40 timestamp);
    event StatusChanged(bytes32 indexed agentId, uint8 oldStatus, uint8 newStatus, string reason);
    event AgentSlashed(bytes32 indexed agentId, uint16 scorePenalty, string reason, uint40 timestamp);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function registerAgent(
        bytes32 agentId,
        bytes32 externalId,
        bytes32 metadataHash
    ) external onlyOwner {
        require(agents[agentId].registeredAt == 0, "Already registered");

        agents[agentId] = Agent({
            externalId: externalId,
            reputationScore: 500,
            totalActions: 0,
            successRate: 1000,
            status: 1,
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
        require(agent.registeredAt != 0, "Not found");
        require(newScore <= 1000, "Score exceeds max 1000");
        require(newSuccessRate <= 1000, "Success rate exceeds max 1000");

        uint16 oldScore = agent.reputationScore;
        agent.reputationScore = newScore;
        agent.totalActions = newTotalActions;
        agent.successRate = newSuccessRate;
        agent.lastUpdated = uint40(block.timestamp);

        emit ReputationUpdated(agentId, oldScore, newScore, uint40(block.timestamp));
    }

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
            "Length mismatch"
        );

        for (uint256 i = 0; i < _agentIds.length; i++) {
            Agent storage agent = agents[_agentIds[i]];
            if (agent.registeredAt == 0) continue;
            require(newScores[i] <= 1000, "Score exceeds max 1000");
            require(newSuccessRates[i] <= 1000, "Success rate exceeds max 1000");

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
        require(agent.registeredAt != 0, "Not found");
        require(newStatus <= 3, "Invalid status (0-3)");

        uint8 oldStatus = agent.status;
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
        require(agent.registeredAt != 0, "Not found");

        uint16 oldScore = agent.reputationScore;
        if (agent.reputationScore > scorePenalty) {
            agent.reputationScore -= scorePenalty;
        } else {
            agent.reputationScore = 0;
        }
        agent.lastUpdated = uint40(block.timestamp);

        uint16 newScore = agent.reputationScore;
        emit ReputationUpdated(agentId, oldScore, newScore, uint40(block.timestamp));
        emit AgentSlashed(agentId, scorePenalty, reason, uint40(block.timestamp));
    }

    // --- Free read functions ---

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

    function getAgentIdAtIndex(uint256 index) external view returns (bytes32) {
        require(index < agentIds.length, "Out of bounds");
        return agentIds[index];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /**
     * SECURITY (#86): Storage gap for future upgrades.
     * Reserves 50 storage slots to prevent storage layout collisions when
     * adding new state variables in future implementations.
     */
    uint256[50] private __gap;
}
