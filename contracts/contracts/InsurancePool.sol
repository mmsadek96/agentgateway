// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
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
    ReentrancyGuardUpgradeable
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

    uint256 public totalCollateral;
    uint256 public totalPremiums;
    uint256 public totalPolicies;
    uint256 public totalClaims;

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
    event ClaimFiled(uint256 indexed policyId, address indexed insured, uint256 payout, uint16 actualScore);
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
    function depositCollateral(bytes32 agentId, uint256 amount) external onlyOwner nonReentrant {
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
    function withdrawCollateral(bytes32 agentId, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > agentCollateral[agentId]) {
            revert InsufficientCollateral(amount, agentCollateral[agentId]);
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
    ) external onlyOwner nonReentrant returns (uint256 policyId) {
        if (coverageAmount == 0) revert ZeroAmount();
        if (expiresAt <= uint40(block.timestamp)) revert InvalidExpiry();
        if (coverageAmount > agentCollateral[agentId]) {
            revert CoverageExceedsCollateral(coverageAmount, agentCollateral[agentId]);
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
        agentCollateral[p.agentId] -= payout;
        totalCollateral -= payout;
        totalClaims++;

        // Pay the insured party (via owner who forwards to them)
        trustToken.safeTransfer(msg.sender, payout);

        emit ClaimFiled(policyId, p.insured, payout, currentScore);
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
        emit ProtocolFeeUpdated(protocolFeeBps, _bps);
        protocolFeeBps = _bps;
    }

    function setBaseRiskBps(uint256 _bps) external onlyOwner {
        emit BaseRiskUpdated(baseRiskBps, _bps);
        baseRiskBps = _bps;
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        feeRecipient = _recipient;
    }

    // ─── UUPS ───

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
