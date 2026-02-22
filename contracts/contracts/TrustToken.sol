// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";

/**
 * @title TrustToken ($TRUST)
 * @notice The native governance and staking token for the AgentTrust ecosystem.
 *
 * Key design:
 * - Capped at 1 billion tokens (18 decimals)
 * - Only owner (AgentTrust wallet) can mint
 * - Approved minters (e.g., StakingVault for rewards) can also mint
 * - Anyone can burn their own tokens
 * - ERC-20 Permit for gasless approvals
 * - ERC-20 Votes for on-chain governance (delegate, getPastVotes)
 * - UUPS upgradeable
 *
 * Democratic design: Agents never need wallets. The AgentTrust API distributes
 * $TRUST on their behalf. The blockchain is invisible infrastructure.
 */
contract TrustToken is
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    ERC20PermitUpgradeable,
    ERC20VotesUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    /// @notice Maximum supply: 1 billion TRUST
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18;

    /// @notice Addresses approved to mint (e.g., StakingVault for staking rewards)
    mapping(address => bool) public minters;

    // ─── Events ───

    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);

    // ─── Errors ───

    error ExceedsMaxSupply(uint256 requested, uint256 remaining);
    error NotMinter(address caller);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __ERC20_init("Trust Token", "TRUST");
        __ERC20Burnable_init();
        __ERC20Permit_init("Trust Token");
        __ERC20Votes_init();
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    // ─── Minting ───

    /**
     * @notice Mint tokens to an address. Only owner or approved minters.
     * @param to Recipient address
     * @param amount Amount to mint (18 decimals)
     */
    function mint(address to, uint256 amount) external {
        if (msg.sender != owner() && !minters[msg.sender]) {
            revert NotMinter(msg.sender);
        }
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert ExceedsMaxSupply(amount, MAX_SUPPLY - totalSupply());
        }
        _mint(to, amount);
    }

    // ─── Minter Management ───

    /**
     * @notice Add an approved minter address.
     * @param minter Address to approve for minting
     */
    function addMinter(address minter) external onlyOwner {
        minters[minter] = true;
        emit MinterAdded(minter);
    }

    /**
     * @notice Remove an approved minter address.
     * @param minter Address to revoke minting from
     */
    function removeMinter(address minter) external onlyOwner {
        minters[minter] = false;
        emit MinterRemoved(minter);
    }

    // ─── View ───

    /**
     * @notice How many tokens can still be minted before hitting max supply.
     */
    function mintableSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

    // ─── Required Overrides (ERC20 + Votes + Permit) ───

    function _update(address from, address to, uint256 value)
        internal override(ERC20Upgradeable, ERC20VotesUpgradeable)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public view override(ERC20PermitUpgradeable, NoncesUpgradeable)
        returns (uint256)
    {
        return super.nonces(owner);
    }

    // ─── UUPS ───

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
