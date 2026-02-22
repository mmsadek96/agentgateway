// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title ReputationLedger
 * @notice Immutable audit trail of all reputation changes for AI agents on Base L2.
 * @dev Every score update, slash, and reward is permanently recorded on-chain.
 *      Anyone can reconstruct the full reputation history of any agent.
 *      Evidence hashes link to off-chain behavioral reports stored on IPFS.
 */
contract ReputationLedger is UUPSUpgradeable, OwnableUpgradeable {

    struct ReputationEvent {
        bytes32 agentId;
        uint8 eventType;          // 0=score_update, 1=slash, 2=reward, 3=status_change
        uint16 scoreBefore;
        uint16 scoreAfter;
        bytes32 evidenceHash;     // keccak256 of off-chain evidence
        uint40 timestamp;
    }

    ReputationEvent[] public events;
    mapping(bytes32 => uint256[]) public agentEvents;

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

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
            "Length mismatch"
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

    // --- Free read functions ---

    function getEvent(uint256 index) external view returns (ReputationEvent memory) {
        require(index < events.length, "Out of bounds");
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

    function getTotalEvents() external view returns (uint256) {
        return events.length;
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
