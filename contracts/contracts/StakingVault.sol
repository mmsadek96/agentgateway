// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IAgentRegistry.sol";

/**
 * @title StakingVault (stTRUST — Liquid Staking Derivative)
 * @notice Agents deposit $TRUST tokens to stake. The vault mints stTRUST (liquid receipt)
 * 1:1 on deposit. stTRUST is freely transferable — stake without locking liquidity.
 *
 * Key features:
 * - Deposit $TRUST → receive stTRUST
 * - Request unstake → 7-day cooldown → complete unstake
 * - Slashing: when an agent misbehaves, a portion of their stake is slashed
 * - Slashed funds go to the InsurancePool
 * - getStakeScore() returns reputation bonus (0-15) for the scoring formula
 *
 * Democratic design: Only the owner (AgentTrust wallet) can call stake/unstake/slash.
 * Agents interact through the REST API, never with the blockchain directly.
 */
contract StakingVault is
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── State ───

    IERC20 public trustToken;
    IAgentRegistry public agentRegistry;

    uint256 public cooldownPeriod;       // Default 7 days
    uint256 public slashBasisPoints;     // Default 1000 = 10%
    address public insurancePool;         // Slashed funds destination
    uint256 public totalStaked;

    struct StakeInfo {
        uint256 stakedAmount;             // $TRUST deposited
        uint256 unstakeRequestAmount;     // Pending unstake amount
        uint40 unstakeRequestTime;        // Cooldown start timestamp
    }

    /// @notice Agent stakes indexed by bytes32 agentId
    mapping(bytes32 => StakeInfo) public agentStakes;

    // ─── Events ───

    event Staked(bytes32 indexed agentId, uint256 amount, uint256 totalStake);
    event UnstakeRequested(bytes32 indexed agentId, uint256 amount, uint40 unlockTime);
    event UnstakeCompleted(bytes32 indexed agentId, uint256 amount);
    event Slashed(bytes32 indexed agentId, uint256 amount, address destination);
    event CooldownPeriodUpdated(uint256 oldPeriod, uint256 newPeriod);
    event SlashBasisPointsUpdated(uint256 oldBps, uint256 newBps);
    event InsurancePoolUpdated(address oldPool, address newPool);

    // ─── Errors ───

    error AgentNotActive(bytes32 agentId);
    error InsufficientStake(uint256 requested, uint256 available);
    error CooldownNotComplete(uint40 unlockTime, uint40 currentTime);
    error NoPendingUnstake(bytes32 agentId);
    error InsurancePoolNotSet();
    error ZeroAmount();
    error BpsTooHigh(uint256 bps);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _trustToken,
        address _agentRegistry
    ) public initializer {
        __ERC20_init("Staked Trust", "stTRUST");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        trustToken = IERC20(_trustToken);
        agentRegistry = IAgentRegistry(_agentRegistry);
        cooldownPeriod = 7 days;
        slashBasisPoints = 1000; // 10%
    }

    // ─── Core Staking ───

    /**
     * @notice Stake $TRUST for an agent. Mints stTRUST 1:1.
     * @param agentId The agent's bytes32 identifier
     * @param amount Amount of $TRUST to stake (18 decimals)
     */
    function stake(bytes32 agentId, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!agentRegistry.isActive(agentId)) revert AgentNotActive(agentId);

        // Transfer $TRUST from owner to vault
        trustToken.safeTransferFrom(msg.sender, address(this), amount);

        // Track stake per agent
        agentStakes[agentId].stakedAmount += amount;
        totalStaked += amount;

        // Mint stTRUST to this contract (held on behalf of agents)
        _mint(address(this), amount);

        emit Staked(agentId, amount, agentStakes[agentId].stakedAmount);
    }

    /**
     * @notice Request to unstake. Starts the cooldown period.
     * @param agentId The agent's bytes32 identifier
     * @param amount Amount to unstake
     */
    function requestUnstake(bytes32 agentId, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        StakeInfo storage info = agentStakes[agentId];

        uint256 available = info.stakedAmount - info.unstakeRequestAmount;
        if (amount > available) revert InsufficientStake(amount, available);

        info.unstakeRequestAmount += amount;
        info.unstakeRequestTime = uint40(block.timestamp);

        emit UnstakeRequested(agentId, amount, uint40(block.timestamp + cooldownPeriod));
    }

    /**
     * @notice Complete unstake after cooldown period. Burns stTRUST, returns $TRUST.
     * @param agentId The agent's bytes32 identifier
     */
    function completeUnstake(bytes32 agentId) external onlyOwner nonReentrant {
        StakeInfo storage info = agentStakes[agentId];
        if (info.unstakeRequestAmount == 0) revert NoPendingUnstake(agentId);

        uint40 unlockTime = info.unstakeRequestTime + uint40(cooldownPeriod);
        if (block.timestamp < unlockTime) {
            revert CooldownNotComplete(unlockTime, uint40(block.timestamp));
        }

        uint256 amount = info.unstakeRequestAmount;
        info.stakedAmount -= amount;
        info.unstakeRequestAmount = 0;
        info.unstakeRequestTime = 0;
        totalStaked -= amount;

        // Burn stTRUST held by vault
        _burn(address(this), amount);

        // Return $TRUST to owner (who distributes to agent via API)
        trustToken.safeTransfer(msg.sender, amount);

        emit UnstakeCompleted(agentId, amount);
    }

    // ─── Slashing ───

    /**
     * @notice Slash an agent's stake. Sends slashed amount to insurance pool.
     * @param agentId The agent's bytes32 identifier
     * @param basisPoints Slash percentage in basis points (1000 = 10%)
     */
    function slash(bytes32 agentId, uint256 basisPoints) external onlyOwner {
        if (insurancePool == address(0)) revert InsurancePoolNotSet();

        StakeInfo storage info = agentStakes[agentId];
        uint256 slashAmount = (info.stakedAmount * basisPoints) / 10000;
        if (slashAmount == 0) return;

        info.stakedAmount -= slashAmount;
        totalStaked -= slashAmount;

        // Burn corresponding stTRUST
        _burn(address(this), slashAmount);

        // Send $TRUST to insurance pool
        trustToken.safeTransfer(insurancePool, slashAmount);

        emit Slashed(agentId, slashAmount, insurancePool);
    }

    // ─── View Functions ───

    /**
     * @notice Get stake info for an agent.
     */
    function getStake(bytes32 agentId) external view returns (
        uint256 stakedAmount,
        uint256 unstakeRequestAmount,
        uint40 unstakeRequestTime,
        uint40 unlockTime
    ) {
        StakeInfo storage info = agentStakes[agentId];
        return (
            info.stakedAmount,
            info.unstakeRequestAmount,
            info.unstakeRequestTime,
            info.unstakeRequestTime > 0
                ? info.unstakeRequestTime + uint40(cooldownPeriod)
                : 0
        );
    }

    /**
     * @notice Calculate reputation bonus from staking (0-15 scale, matching existing formula).
     * Mirrors: min(15, 5 + floor(stakeAmount / 100e18))
     * @param agentId The agent's bytes32 identifier
     * @return bonus Reputation bonus points (0-15)
     */
    function getStakeScore(bytes32 agentId) external view returns (uint16 bonus) {
        uint256 staked = agentStakes[agentId].stakedAmount;
        if (staked == 0) return 0;
        uint256 units = staked / (100 * 10**18); // Each 100 TRUST = +1 above base 5
        uint256 score = 5 + units;
        return score > 15 ? 15 : uint16(score);
    }

    // ─── Admin ───

    function setCooldownPeriod(uint256 _period) external onlyOwner {
        uint256 oldPeriod = cooldownPeriod;
        cooldownPeriod = _period;
        emit CooldownPeriodUpdated(oldPeriod, _period);
    }

    function setSlashBasisPoints(uint256 _bps) external onlyOwner {
        if (_bps > 10000) revert BpsTooHigh(_bps);
        uint256 oldBps = slashBasisPoints;
        slashBasisPoints = _bps;
        emit SlashBasisPointsUpdated(oldBps, _bps);
    }

    function setInsurancePool(address _pool) external onlyOwner {
        address oldPool = insurancePool;
        insurancePool = _pool;
        emit InsurancePoolUpdated(oldPool, _pool);
    }

    // ─── UUPS ───

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
