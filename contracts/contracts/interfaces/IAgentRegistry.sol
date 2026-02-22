// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAgentRegistry
 * @notice Read-only interface for the AgentRegistry contract.
 * Used by DeFi contracts (StakingVault, ReputationMarket, InsurancePool, VouchMarket)
 * to verify agent existence, status, and reputation scores.
 */
interface IAgentRegistry {
    struct Agent {
        bytes32 externalId;
        uint16 reputationScore;   // 0-1000 (10x scale: 500 = 50.0)
        uint32 totalActions;
        uint16 successRate;       // 0-1000 (percentage * 10)
        uint8 status;             // 0=inactive, 1=active, 2=suspended, 3=banned
        uint40 registeredAt;
        uint40 lastUpdated;
        bytes32 metadataHash;
    }

    function getAgent(bytes32 agentId) external view returns (Agent memory);
    function getReputation(bytes32 agentId) external view returns (uint16);
    function getStatus(bytes32 agentId) external view returns (uint8);
    function isActive(bytes32 agentId) external view returns (bool);
    function getAgentCount() external view returns (uint256 total, uint256 active);
}
