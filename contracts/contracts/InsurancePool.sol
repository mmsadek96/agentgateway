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
 * @title InsurancePool — Agent Performance Insurance (CDS)
 * @notice Agents deposit $TRUST as collateral to back their performance.
 * Websites (via AgentTrust API) buy insurance policies against agent failure.
 * If the agent's score drops below the trigger threshold, the policy pays out.
 *
 * Flow:
 * 1. Agent deposits collateral (backs their reputation)
 * 2. Website buys a policy: "If Agent X drops below score Y, pay me Z $TRUST"
 * 3. Premium auto-calculated based on agent's risk profile
 * 4. If score drops below trigger → fileClaim() pays out from collateral
 *
 * Democratic design: Only the owner (AgentTrust wallet) calls all functions.
 * Agents and websites interact through the REST API.
 */
contract InsurancePool is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── State ───

    IERC20 public trustToken;
    IAgentRegistry public agentRegistry;
    uint256 public protocolFeeBps;         // 250 = 2.5%
    address public feeRecipient;
    uint256 public baseRiskBps;            // Base risk premium: 500 = 5%

    struct Policy {
        bytes32 agentId;                   // Agent being insured against
        address insured;                   // Who bought the policy (tracked by owner)
        uint256 coverageAmount;            // Max payout if claim is valid
        uint256 premiumPaid;               // Cost paid for this insurance
        uint16 triggerScore;               // Score drops below this → claimable (0-1000)
        uint40 expiresAt;                  // Policy expiry
        bool claimed;                      // Already paid out
        bool active;                       // Still in effect
    }

    uint256 public nextPolicyId;
    mapping(uint256 => Policy) public policies;

    /// @notice Collateral deposited by each agent
    mapping(bytes32 => uint256) public agentCollateral;

    /// @notice Reserved collateral per agent (sum of active policy coverage amounts)
    mapping(bytes32 => uint256) public reservedCollateral;

    uint256 public totalCollateral;
    uint256 public totalPremiums;
    uint256 public totalPolicies;
    uint256 public totalClaims;

    /// @notice Maximum policy duration: 365 days
    uint40 public constant MAX_POLICY_DURATION = 365 days;

    // ─── Events ───

    event CollateralDeposited(bytes32 indexed agentId, uint256 amount, uint256 totalCollateral);
    event CollateralWithdrawn(bytes32 indexed agentId, uint256 amount, uint256 totalCollateral);
    event PolicyCreated(
        uint256 indexed policyId,
        bytes32 indexed agentId,
        address insured,
        uint256 coverageAmount,
        uint256 premiumPaid,
        uint16 triggerScore,
        uint40 expiresAt
    );
    event ClaimFiled(uint256 indexed policyId, address indexed insured, uint256 payout, uint16 actualScore, bool underpaid);
    event PolicyExpired(uint256 indexed policyId);
    event ProtocolFeeUpdated(uint256 oldBps, uint256 newBps);
    event BaseRiskUpdated(uint256 oldBps, uint256 newBps);

    // ─── Errors ───

    error ZeroAmount();
    error InsufficientCollateral(uint256 requested, uint256 available);
    error PolicyNotActive(uint256 policyId);
    error PolicyAlreadyClaimed(uint256 policyId);
    error PolicyExpiredError(uint256 policyId);
    error PolicyNotExpired(uint256 policyId);
    error ScoreAboveTrigger(uint16 currentScore, uint16 triggerScore);
    error InvalidExpiry();
    error CoverageExceedsCollateral(uint256 coverage, uint256 collateral);
    error MaxDurationExceeded(uint40 duration, uint40 maxDuration);
    error WithdrawalExceedsAvailable(uint256 requested, uint256 available);
    error FeeBpsTooHigh(uint256 bps);
    error ZeroAddress();
    error CoverageExceedsAvailableCollateral(uint256 coverage, uint256 available);

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
        protocolFeeBps = 250;    // 2.5% protocol fee on premiums
        baseRiskBps = 500;       // 5% base risk premium
        feeRecipient = msg.sender;
    }

    // ─── Collateral Management ───

    /**
     * @notice Agent deposits $TRUST as collateral to back their performance.
     * @param agentId The agent's bytes32 identifier
     * @param amount $TRUST amount to deposit (18 decimals)
     */
    function depositCollateral(bytes32 agentId, uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        trustToken.safeTransferFrom(msg.sender, address(this), amount);
        agentCollateral[agentId] += amount;
        totalCollateral += amount;

        emit CollateralDeposited(agentId, amount, agentCollateral[agentId]);
    }

    /**
     * @notice Withdraw unused collateral. Cannot withdraw below outstanding policy coverage.
     * @param agentId The agent's bytes32 identifier
     * @param amount $TRUST amount to withdraw
     */
    function withdrawCollateral(bytes32 agentId, uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > agentCollateral[agentId]) {
            revert InsufficientCollateral(amount, agentCollateral[agentId]);
        }

        // H-1 fix: Cannot withdraw collateral that is reserved by active policies
        uint256 available = agentCollateral[agentId] - reservedCollateral[agentId];
        if (amount > available) {
            revert WithdrawalExceedsAvailable(amount, available);
        }

        agentCollateral[agentId] -= amount;
        totalCollateral -= amount;

        trustToken.safeTransfer(msg.sender, amount);

        emit CollateralWithdrawn(agentId, amount, agentCollateral[agentId]);
    }

    // ─── Policy Management ───

    /**
     * @notice Buy an insurance policy against an agent's performance drop.
     * @param agentId Agent to insure against
     * @param insured Address that will receive payout (tracked, owner executes)
     * @param coverageAmount Max payout if claim is valid
     * @param triggerScore Score threshold — if agent drops below, policy is claimable (0-1000)
     * @param expiresAt Policy expiry timestamp
     */
    function buyPolicy(
        bytes32 agentId,
        address insured,
        uint256 coverageAmount,
        uint16 triggerScore,
        uint40 expiresAt
    ) external onlyOwner nonReentrant whenNotPaused returns (uint256 policyId) {
        if (coverageAmount == 0) revert ZeroAmount();
        if (expiresAt <= uint40(block.timestamp)) revert InvalidExpiry();
        uint40 duration = expiresAt - uint40(block.timestamp);
        if (duration > MAX_POLICY_DURATION) revert MaxDurationExceeded(duration, MAX_POLICY_DURATION);

        // C-3 fix: Check coverage against AVAILABLE collateral (total - already reserved)
        uint256 available = agentCollateral[agentId] - reservedCollateral[agentId];
        if (coverageAmount > available) {
            revert CoverageExceedsAvailableCollateral(coverageAmount, available);
        }

        // Calculate premium based on risk
        uint256 premium = calculatePremium(agentId, coverageAmount, triggerScore);

        // Collect premium from owner (who collected from buyer via API)
        trustToken.safeTransferFrom(msg.sender, address(this), premium);

        // Protocol fee on premium
        uint256 fee = (premium * protocolFeeBps) / 10000;
        if (fee > 0) {
            trustToken.safeTransfer(feeRecipient, fee);
        }

        // Create policy
        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            agentId: agentId,
            insured: insured,
            coverageAmount: coverageAmount,
            premiumPaid: premium,
            triggerScore: triggerScore,
            expiresAt: expiresAt,
            claimed: false,
            active: true
        });

        // C-3 fix: Reserve collateral for this policy
        reservedCollateral[agentId] += coverageAmount;

        totalPremiums += premium;
        totalPolicies++;

        emit PolicyCreated(policyId, agentId, insured, coverageAmount, premium, triggerScore, expiresAt);
    }

    /**
     * @notice File a claim on an active policy. Pays out if agent score < trigger.
     * @param policyId The policy to claim against
     */
    function fileClaim(uint256 policyId) external onlyOwner nonReentrant {
        Policy storage p = policies[policyId];
        if (!p.active) revert PolicyNotActive(policyId);
        if (p.claimed) revert PolicyAlreadyClaimed(policyId);
        if (block.timestamp > p.expiresAt) revert PolicyExpiredError(policyId);

        // Check agent's current score
        uint16 currentScore = agentRegistry.getReputation(p.agentId);
        if (currentScore >= p.triggerScore) {
            revert ScoreAboveTrigger(currentScore, p.triggerScore);
        }

        // Payout from agent's collateral
        uint256 payout = p.coverageAmount;
        if (payout > agentCollateral[p.agentId]) {
            payout = agentCollateral[p.agentId]; // Cap at available collateral
        }

        p.claimed = true;
        p.active = false;

        // Release reserved collateral for this policy
        reservedCollateral[p.agentId] -= p.coverageAmount;

        agentCollateral[p.agentId] -= payout;
        totalCollateral -= payout;
        totalClaims++;

        // L-4 fix: Track if payout was less than full coverage
        bool underpaid = payout < p.coverageAmount;

        // Pay the insured party (via owner who forwards to them)
        trustToken.safeTransfer(msg.sender, payout);

        emit ClaimFiled(policyId, p.insured, payout, currentScore, underpaid);
    }

    /**
     * @notice Mark an expired policy as inactive. Frees up collateral tracking.
     * @param policyId The policy to expire
     */
    function expirePolicy(uint256 policyId) external onlyOwner {
        Policy storage p = policies[policyId];
        if (!p.active) revert PolicyNotActive(policyId);
        if (block.timestamp <= p.expiresAt) revert PolicyNotExpired(policyId);

        p.active = false;

        // Release reserved collateral
        reservedCollateral[p.agentId] -= p.coverageAmount;

        emit PolicyExpired(policyId);
    }

    // ─── Premium Calculation ───

    /**
     * @notice Calculate the premium for a given coverage.
     * Higher risk (lower agent score, lower trigger) = higher premium.
     * Formula: premium = coverageAmount * riskMultiplier / 10000
     * Risk multiplier = baseRiskBps + (1000 - agentScore) * 5 + max(0, (triggerScore - 500)) * 3
     */
    function calculatePremium(
        bytes32 agentId,
        uint256 coverageAmount,
        uint16 triggerScore
    ) public view returns (uint256) {
        uint16 agentScore = agentRegistry.getReputation(agentId);

        // Base risk + score-based risk + trigger proximity risk
        uint256 risk = baseRiskBps;

        // Lower score = higher premium (each 1 point below 1000 adds 0.05%)
        if (agentScore < 1000) {
            risk += (1000 - uint256(agentScore)) * 5;
        }

        // Higher trigger score = higher premium (easier to trigger)
        if (triggerScore > 500) {
            risk += (uint256(triggerScore) - 500) * 3;
        }

        // Cap risk at 50% of coverage
        if (risk > 5000) risk = 5000;

        return (coverageAmount * risk) / 10000;
    }

    // ─── View Functions ───

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    function getCollateral(bytes32 agentId) external view returns (uint256) {
        return agentCollateral[agentId];
    }

    function getStats() external view returns (
        uint256 _totalCollateral,
        uint256 _totalPremiums,
        uint256 _totalPolicies,
        uint256 _totalClaims
    ) {
        return (totalCollateral, totalPremiums, totalPolicies, totalClaims);
    }

    // ─── Admin ───

    function setProtocolFeeBps(uint256 _bps) external onlyOwner {
        if (_bps > 10000) revert FeeBpsTooHigh(_bps);
        uint256 oldBps = protocolFeeBps;
        protocolFeeBps = _bps;
        emit ProtocolFeeUpdated(oldBps, _bps);
    }

    function setBaseRiskBps(uint256 _bps) external onlyOwner {
        uint256 oldBps = baseRiskBps;
        baseRiskBps = _bps;
        emit BaseRiskUpdated(oldBps, _bps);
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
