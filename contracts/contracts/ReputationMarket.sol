// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IAgentRegistry.sol";

/**
 * @title ReputationMarket — Binary Options on Agent Reputation
 * @notice "Will Agent X have score >= Y by time Z?"
 *
 * Users (via AgentTrust API) deposit $TRUST to take YES or NO positions.
 * On expiry, the contract reads AgentRegistry to settle the outcome.
 * Winners split the pool (minus protocol fee).
 *
 * Oracle: The AgentTrust owner calls settle() which reads the on-chain
 * AgentRegistry score. No external oracle needed.
 */
contract ReputationMarket is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── State ───

    IERC20 public trustToken;
    IAgentRegistry public agentRegistry;
    uint256 public protocolFeeBps;     // 250 = 2.5%
    address public feeRecipient;

    struct Market {
        bytes32 agentId;
        uint16 targetScore;            // 0-1000 (10x scale)
        uint40 expiresAt;
        uint256 yesPool;               // Total $TRUST bet on YES
        uint256 noPool;                // Total $TRUST bet on NO
        bool settled;
        bool outcome;                  // true = YES wins (score >= target)
        uint16 finalScore;             // Actual score at settlement
    }

    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public yesPositions;
    mapping(uint256 => mapping(address => uint256)) public noPositions;

    uint256 public totalMarkets;
    uint256 public totalVolume;

    /// @notice Maximum market duration: 365 days
    uint40 public constant MAX_MARKET_DURATION = 365 days;

    // ─── Events ───

    event MarketCreated(uint256 indexed marketId, bytes32 indexed agentId, uint16 targetScore, uint40 expiresAt);
    event BetPlaced(uint256 indexed marketId, address indexed bettor, bool isYes, uint256 amount);
    event MarketSettled(uint256 indexed marketId, bool outcome, uint16 finalScore, uint256 yesPool, uint256 noPool);
    event Claimed(uint256 indexed marketId, address indexed claimant, uint256 payout, uint256 fee);
    event ProtocolFeeUpdated(uint256 oldBps, uint256 newBps);

    // ─── Errors ───

    error MarketNotExpired(uint256 marketId, uint40 expiresAt);
    error MarketAlreadySettled(uint256 marketId);
    error MarketNotSettled(uint256 marketId);
    error MarketExpired(uint256 marketId);
    error NoPosition(uint256 marketId, address claimant);
    error AlreadyClaimed(uint256 marketId, address claimant);
    error ZeroAmount();
    error InvalidExpiry();
    error MaxDurationExceeded(uint40 duration, uint40 maxDuration);
    error WinnerPoolEmpty(uint256 marketId);
    error FeeBpsTooHigh(uint256 bps);
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _trustToken,
        address _agentRegistry
    ) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        trustToken = IERC20(_trustToken);
        agentRegistry = IAgentRegistry(_agentRegistry);
        protocolFeeBps = 250; // 2.5%
        feeRecipient = msg.sender;
    }

    // ─── Market Creation ───

    /**
     * @notice Create a new binary options market.
     * @param agentId Agent to bet on
     * @param targetScore Score threshold (0-1000 scale). YES wins if score >= target.
     * @param expiresAt Unix timestamp when market can be settled
     */
    function createMarket(
        bytes32 agentId,
        uint16 targetScore,
        uint40 expiresAt
    ) external onlyOwner whenNotPaused returns (uint256 marketId) {
        if (expiresAt <= uint40(block.timestamp)) revert InvalidExpiry();
        uint40 duration = expiresAt - uint40(block.timestamp);
        if (duration > MAX_MARKET_DURATION) revert MaxDurationExceeded(duration, MAX_MARKET_DURATION);

        marketId = nextMarketId++;
        markets[marketId] = Market({
            agentId: agentId,
            targetScore: targetScore,
            expiresAt: expiresAt,
            yesPool: 0,
            noPool: 0,
            settled: false,
            outcome: false,
            finalScore: 0
        });

        totalMarkets++;
        emit MarketCreated(marketId, agentId, targetScore, expiresAt);
    }

    // ─── Betting ───

    /**
     * @notice Place a YES bet (agent WILL reach target score).
     * @param marketId Market to bet on
     * @param amount $TRUST amount to bet
     * @param bettor Address that owns the position
     */
    function betYes(uint256 marketId, uint256 amount, address bettor) external onlyOwner nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Market storage m = markets[marketId];
        if (m.settled) revert MarketAlreadySettled(marketId);
        if (block.timestamp >= m.expiresAt) revert MarketExpired(marketId);

        trustToken.safeTransferFrom(msg.sender, address(this), amount);
        m.yesPool += amount;
        yesPositions[marketId][bettor] += amount;
        totalVolume += amount;

        emit BetPlaced(marketId, bettor, true, amount);
    }

    /**
     * @notice Place a NO bet (agent will NOT reach target score).
     */
    function betNo(uint256 marketId, uint256 amount, address bettor) external onlyOwner nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        Market storage m = markets[marketId];
        if (m.settled) revert MarketAlreadySettled(marketId);
        if (block.timestamp >= m.expiresAt) revert MarketExpired(marketId);

        trustToken.safeTransferFrom(msg.sender, address(this), amount);
        m.noPool += amount;
        noPositions[marketId][bettor] += amount;
        totalVolume += amount;

        emit BetPlaced(marketId, bettor, false, amount);
    }

    // ─── Settlement ───

    /**
     * @notice Settle a market after expiry. Reads agent score from AgentRegistry.
     * @param marketId Market to settle
     */
    function settle(uint256 marketId) external onlyOwner {
        Market storage m = markets[marketId];
        if (m.settled) revert MarketAlreadySettled(marketId);
        if (block.timestamp < m.expiresAt) revert MarketNotExpired(marketId, m.expiresAt);

        // Read current score from AgentRegistry (the oracle)
        uint16 currentScore = agentRegistry.getReputation(m.agentId);

        m.finalScore = currentScore;
        m.outcome = currentScore >= m.targetScore;
        m.settled = true;

        emit MarketSettled(marketId, m.outcome, currentScore, m.yesPool, m.noPool);
    }

    // ─── Claims ───

    /**
     * @notice Claim winnings from a settled market.
     * @param marketId Market to claim from
     * @param claimant Address that owns the winning position
     */
    function claim(uint256 marketId, address claimant) external onlyOwner nonReentrant {
        Market storage m = markets[marketId];
        if (!m.settled) revert MarketNotSettled(marketId);

        uint256 position;
        uint256 winnerPool;
        uint256 loserPool;

        if (m.outcome) {
            // YES won
            position = yesPositions[marketId][claimant];
            if (position == 0) revert NoPosition(marketId, claimant);
            yesPositions[marketId][claimant] = 0;
            winnerPool = m.yesPool;
            loserPool = m.noPool;
        } else {
            // NO won
            position = noPositions[marketId][claimant];
            if (position == 0) revert NoPosition(marketId, claimant);
            noPositions[marketId][claimant] = 0;
            winnerPool = m.noPool;
            loserPool = m.yesPool;
        }

        // Guard against division by zero (C-2 fix)
        if (winnerPool == 0) revert WinnerPoolEmpty(marketId);

        // Pro-rata share of the loser pool
        uint256 winnings = (position * loserPool) / winnerPool;
        uint256 fee = (winnings * protocolFeeBps) / 10000;
        uint256 payout = position + winnings - fee;

        // Pay protocol fee
        if (fee > 0 && feeRecipient != address(0)) {
            trustToken.safeTransfer(feeRecipient, fee);
        }

        // Pay winner
        trustToken.safeTransfer(msg.sender, payout);

        emit Claimed(marketId, claimant, payout, fee);
    }

    // ─── View ───

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getPosition(uint256 marketId, address user) external view returns (
        uint256 yesAmount,
        uint256 noAmount
    ) {
        return (yesPositions[marketId][user], noPositions[marketId][user]);
    }

    function getStats() external view returns (
        uint256 _totalMarkets,
        uint256 _totalVolume
    ) {
        return (totalMarkets, totalVolume);
    }

    // ─── Admin ───

    function setProtocolFeeBps(uint256 _bps) external onlyOwner {
        if (_bps > 10000) revert FeeBpsTooHigh(_bps);
        uint256 oldBps = protocolFeeBps;
        protocolFeeBps = _bps;
        emit ProtocolFeeUpdated(oldBps, _bps);
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        if (_recipient == address(0)) revert ZeroAddress();
        feeRecipient = _recipient;
    }

    // ─── Emergency Pause (#87) ───

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── UUPS ───

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
