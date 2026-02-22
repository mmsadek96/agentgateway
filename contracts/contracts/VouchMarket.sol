// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IAgentRegistry.sol";

/**
 * @title VouchMarket — Tradable Vouch NFTs (ERC-721)
 * @notice Vouches become tradable NFTs. When an agent vouches for another,
 * the voucher's reputation score at mint time is frozen into the NFT.
 * The current owner of the vouch NFT determines the reputation bonus.
 *
 * This transforms social capital into financial capital — a vouch from
 * a high-reputation agent is a valuable, tradable asset.
 *
 * Key design:
 * - Each vouch is an ERC-721 token with on-chain metadata
 * - Voucher's score is frozen at mint time (snapshot)
 * - Weight (1-5) determines reputation boost strength
 * - One vouch per (voucher → vouchee) pair
 * - Freely transferable on any NFT marketplace
 * - Deactivation by owner (AgentTrust wallet) without burning
 *
 * Democratic design: Only the owner (AgentTrust wallet) can mint/deactivate.
 * Agents interact through the REST API.
 */
contract VouchMarket is
    ERC721Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    IAgentRegistry public agentRegistry;

    struct VouchData {
        bytes32 voucherAgentId;            // Who created the vouch
        bytes32 vouchedAgentId;            // Who benefits from the vouch
        uint16 voucherScoreAtMint;         // Frozen reputation of voucher (0-1000)
        uint8 weight;                      // 1-5 (boost strength)
        uint40 mintedAt;                   // Timestamp
        bool active;                       // Can be deactivated without burning
    }

    uint256 public nextTokenId;

    /// @notice Vouch data for each token
    mapping(uint256 => VouchData) public vouchData;

    /// @notice All vouch tokenIds received by an agent
    mapping(bytes32 => uint256[]) public agentVouches;

    /// @notice Uniqueness: one vouch per (voucher → vouchee) pair
    mapping(bytes32 => mapping(bytes32 => uint256)) public vouchPair;

    uint256 public totalVouches;
    uint256 public totalActive;

    // ─── Events ───

    event VouchMinted(
        uint256 indexed tokenId,
        bytes32 indexed voucherAgentId,
        bytes32 indexed vouchedAgentId,
        uint8 weight,
        uint16 voucherScore
    );
    event VouchDeactivated(uint256 indexed tokenId);
    event VouchReactivated(uint256 indexed tokenId);

    // ─── Errors ───

    error VouchAlreadyExists(bytes32 voucherAgentId, bytes32 vouchedAgentId);
    error VoucherScoreTooLow(bytes32 agentId, uint16 score);
    error CannotVouchSelf(bytes32 agentId);
    error InvalidWeight(uint8 weight);
    error VouchNotActive(uint256 tokenId);
    error VouchAlreadyActive(uint256 tokenId);
    error VouchNotFound(uint256 tokenId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _agentRegistry
    ) public initializer {
        __ERC721_init("AgentTrust Vouch", "VOUCH");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // ─── Minting ───

    /**
     * @notice Mint a vouch NFT. Voucher must have score >= 600 (60.0 in UI).
     * @param voucherAgentId The agent creating the vouch
     * @param vouchedAgentId The agent receiving the vouch
     * @param weight Vouch strength (1-5)
     * @param recipient Address to receive the NFT (usually the owner wallet)
     */
    function mintVouch(
        bytes32 voucherAgentId,
        bytes32 vouchedAgentId,
        uint8 weight,
        address recipient
    ) external onlyOwner returns (uint256 tokenId) {
        // Validation
        if (voucherAgentId == vouchedAgentId) revert CannotVouchSelf(voucherAgentId);
        if (weight == 0 || weight > 5) revert InvalidWeight(weight);
        if (vouchPair[voucherAgentId][vouchedAgentId] != 0) {
            revert VouchAlreadyExists(voucherAgentId, vouchedAgentId);
        }

        // Check voucher's reputation (>= 600 on 0-1000 scale = 60 on UI scale)
        uint16 voucherScore = agentRegistry.getReputation(voucherAgentId);
        if (voucherScore < 600) revert VoucherScoreTooLow(voucherAgentId, voucherScore);

        // Mint NFT
        tokenId = ++nextTokenId; // Start from 1 (0 is reserved for "no vouch")
        _safeMint(recipient, tokenId);

        // Store vouch data
        vouchData[tokenId] = VouchData({
            voucherAgentId: voucherAgentId,
            vouchedAgentId: vouchedAgentId,
            voucherScoreAtMint: voucherScore,
            weight: weight,
            mintedAt: uint40(block.timestamp),
            active: true
        });

        // Track relationships
        agentVouches[vouchedAgentId].push(tokenId);
        vouchPair[voucherAgentId][vouchedAgentId] = tokenId;

        totalVouches++;
        totalActive++;

        emit VouchMinted(tokenId, voucherAgentId, vouchedAgentId, weight, voucherScore);
    }

    // ─── Lifecycle ───

    /**
     * @notice Deactivate a vouch (e.g., agent misbehaved). Doesn't burn the NFT.
     * @param tokenId Token to deactivate
     */
    function deactivateVouch(uint256 tokenId) external onlyOwner {
        VouchData storage v = vouchData[tokenId];
        if (v.mintedAt == 0) revert VouchNotFound(tokenId);
        if (!v.active) revert VouchNotActive(tokenId);

        v.active = false;
        totalActive--;

        emit VouchDeactivated(tokenId);
    }

    /**
     * @notice Reactivate a previously deactivated vouch.
     * @param tokenId Token to reactivate
     */
    function reactivateVouch(uint256 tokenId) external onlyOwner {
        VouchData storage v = vouchData[tokenId];
        if (v.mintedAt == 0) revert VouchNotFound(tokenId);
        if (v.active) revert VouchAlreadyActive(tokenId);

        v.active = true;
        totalActive++;

        emit VouchReactivated(tokenId);
    }

    // ─── View Functions ───

    /**
     * @notice Get vouch data for a token.
     */
    function getVouchInfo(uint256 tokenId) external view returns (VouchData memory) {
        return vouchData[tokenId];
    }

    /**
     * @notice Count active vouches for an agent (for reputation calculation).
     * @param agentId The agent to count vouches for
     * @return count Number of active vouches
     */
    function getActiveVouchCount(bytes32 agentId) external view returns (uint256 count) {
        uint256[] storage tokenIds = agentVouches[agentId];
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (vouchData[tokenIds[i]].active) {
                count++;
            }
        }
    }

    /**
     * @notice Get all vouch token IDs for an agent.
     * @param agentId The agent to query
     * @return tokenIds Array of token IDs
     */
    function getAgentVouches(bytes32 agentId) external view returns (uint256[] memory) {
        return agentVouches[agentId];
    }

    /**
     * @notice Calculate total weighted vouch score for reputation formula.
     * Mirrors existing: min(20, vouchCount * 2) but now weight-aware.
     * @param agentId The agent to score
     * @return bonus Reputation bonus (0-20)
     */
    function getVouchScore(bytes32 agentId) external view returns (uint16 bonus) {
        uint256[] storage tokenIds = agentVouches[agentId];
        uint256 weightedCount = 0;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            VouchData storage v = vouchData[tokenIds[i]];
            if (v.active) {
                // Weight contributes: a weight-5 vouch from a 900-score agent > weight-1 from 600-score
                weightedCount += uint256(v.weight);
            }
        }

        // min(20, weightedCount * 2)
        uint256 score = weightedCount * 2;
        return score > 20 ? 20 : uint16(score);
    }

    /**
     * @notice Get frozen voucher score from mint time.
     * @param tokenId Token to query
     * @return score Voucher's reputation at mint time (0-1000)
     */
    function getVoucherScore(uint256 tokenId) external view returns (uint16 score) {
        return vouchData[tokenId].voucherScoreAtMint;
    }

    /**
     * @notice Check if a specific vouch pair exists.
     * @param voucherAgentId The vouching agent
     * @param vouchedAgentId The vouched agent
     * @return exists Whether the vouch exists
     * @return tokenId The token ID if it exists (0 if not)
     */
    function hasVouch(
        bytes32 voucherAgentId,
        bytes32 vouchedAgentId
    ) external view returns (bool exists, uint256 tokenId) {
        tokenId = vouchPair[voucherAgentId][vouchedAgentId];
        exists = tokenId != 0;
    }

    /**
     * @notice On-chain metadata for NFT marketplaces.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        VouchData storage v = vouchData[tokenId];

        // Build on-chain JSON metadata
        string memory json = string(abi.encodePacked(
            '{"name":"AgentTrust Vouch #', _toString(tokenId),
            '","description":"A verifiable vouch from one AI agent to another, with frozen reputation score.',
            '","attributes":[',
            '{"trait_type":"Weight","value":', _toString(uint256(v.weight)), '},',
            '{"trait_type":"Voucher Score at Mint","value":', _toString(uint256(v.voucherScoreAtMint)), '},',
            '{"trait_type":"Active","value":"', v.active ? 'true' : 'false', '"},',
            '{"trait_type":"Minted At","display_type":"date","value":', _toString(uint256(v.mintedAt)),
            '}]}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            _base64Encode(bytes(json))
        ));
    }

    // ─── Internal Helpers ───

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _base64Encode(bytes memory data) internal pure returns (string memory) {
        bytes memory TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 len = data.length;
        if (len == 0) return "";

        uint256 encodedLen = 4 * ((len + 2) / 3);
        bytes memory result = new bytes(encodedLen + 32);

        bytes memory table = TABLE;
        assembly {
            let tablePtr := add(table, 1)
            let resultPtr := add(result, 32)
            for { let i := 0 } lt(i, len) {} {
                i := add(i, 3)
                let input := and(mload(add(data, i)), 0xffffff)
                let out := mload(add(tablePtr, and(shr(18, input), 0x3F)))
                out := shl(8, out)
                out := add(out, and(mload(add(tablePtr, and(shr(12, input), 0x3F))), 0xFF))
                out := shl(8, out)
                out := add(out, and(mload(add(tablePtr, and(shr(6, input), 0x3F))), 0xFF))
                out := shl(8, out)
                out := add(out, and(mload(add(tablePtr, and(input, 0x3F))), 0xFF))
                mstore(resultPtr, shl(224, out))
                resultPtr := add(resultPtr, 4)
            }
            switch mod(len, 3)
            case 1 { mstore(sub(resultPtr, 2), shl(240, 0x3d3d)) }
            case 2 { mstore(sub(resultPtr, 1), shl(248, 0x3d)) }
            mstore(result, encodedLen)
        }
        return string(result);
    }

    // ─── UUPS ───

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
