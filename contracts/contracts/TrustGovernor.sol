// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorCountingSimpleUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorTimelockControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title TrustGovernor — DAO Governance for AgentTrust
 * @notice $TRUST holders vote on protocol parameters through on-chain proposals.
 *
 * Governed parameters (via timelock-delayed execution):
 * - StakingVault: cooldown period, slash basis points
 * - ReputationMarket: protocol fee
 * - InsurancePool: protocol fee, base risk
 *
 * Governance settings:
 * - Voting delay: 1 day (time before voting starts)
 * - Voting period: 3 days
 * - Proposal threshold: 100,000 TRUST
 * - Quorum: 4% of total supply
 * - Timelock: 1 day execution delay after vote passes
 *
 * Uses OpenZeppelin Governor v5 with TimelockController.
 */
contract TrustGovernor is
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorCountingSimpleUpgradeable,
    GovernorVotesUpgradeable,
    GovernorTimelockControlUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    /// @notice Quorum: 4% of total supply
    uint256 public quorumBps;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the governor.
     * @param _token $TRUST token (must implement IVotes — use ERC20VotesUpgradeable)
     * @param _timelock TimelockController that executes proposals
     */
    function initialize(
        IVotes _token,
        TimelockControllerUpgradeable _timelock
    ) public initializer {
        __Governor_init("TrustGovernor");
        __GovernorSettings_init(
            7200,     // votingDelay: ~1 day (7200 blocks at 12s)
            21600,    // votingPeriod: ~3 days (21600 blocks at 12s)
            100_000 * 10**18  // proposalThreshold: 100k TRUST
        );
        __GovernorCountingSimple_init();
        __GovernorVotes_init(_token);
        __GovernorTimelockControl_init(_timelock);
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        quorumBps = 400; // 4%
    }

    // ─── Quorum ───

    /**
     * @notice Returns the quorum for a given block number (4% of total supply at that block).
     */
    function quorum(uint256 blockNumber) public view override(GovernorUpgradeable) returns (uint256) {
        // Read total supply from the votes token
        uint256 totalSupply = token().getPastTotalSupply(blockNumber);
        return (totalSupply * quorumBps) / 10000;
    }

    /**
     * @notice Update the quorum percentage (basis points). Only via governance.
     * @param _bps New quorum in basis points (e.g., 400 = 4%)
     */
    function setQuorumBps(uint256 _bps) external onlyGovernance {
        quorumBps = _bps;
    }

    // ─── Required Overrides ───
    // OpenZeppelin Governor with multiple extensions requires explicit override resolution.

    function votingDelay()
        public view override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public view override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function proposalThreshold()
        public view override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function state(uint256 proposalId)
        public view override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public view override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal view override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (address)
    {
        return super._executor();
    }

    // ─── UUPS ───

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
