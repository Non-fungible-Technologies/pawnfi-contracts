// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "./utils/LoanMetadata.sol";
import "./interfaces/ILoanCore.sol";

/**
 * Built off Openzeppelin's ERC721PresetMinterPauserAutoId.
 * 
 * @dev {ERC721} token, including:
 *
 *  - ability for holders to burn (destroy) their tokens
 *  - a minter role that allows for token minting (creation)
 *  - token ID and URI autogeneration
 *
 * This contract uses {AccessControl} to lock permissioned functions using the
 * different roles - head to its documentation for details.
 *
 * The account that deploys the contract will be granted the minter and pauser
 * roles, as well as the default admin role, which will let it grant both minter
 * and pauser roles to other accounts.
 */
contract LenderNote is Context, AccessControlEnumerable, ERC721, ERC721Enumerable, ERC721Pausable {
    using Counters for Counters.Counter;
    using LoanMetadata for *;

    bytes32 public constant LOAN_CORE_ROLE = keccak256("LOAN_CORE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    Counters.Counter private _tokenIdTracker;

    address public loanCore;

    /**
     * @dev Grants `LOAN_CORE_ROLE` to the specified loanCore-
     * contract, provided it is an instance of LoanCore.
     * 
     * Grants `DEFAULT_ADMIN_ROLE` to the account that deploys the contract. Admins
     * can pause the contract if needed.
     * 
     */
    constructor(string memory name, string memory symbol, address loanCore_) ERC721(name, symbol) {
        require(loanCore_ != address(0), "loanCore address must be defined");
        
        bytes4 loanCoreInterface = type(ILoanCore).interfaceId;
        require(IERC165(loanCore_).supportsInterface(loanCoreInterface), "loanCore must be an instance of LoanCore");

        _setupRole(LOAN_CORE_ROLE, loanCore_);
        loanCore = loanCore_;

        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        // TODO: This pause might be good for alpha. Should we remove for mainnet?
        _setupRole(PAUSER_ROLE, _msgSender());
    }

    /**
     * @dev Creates a new token for `to`. Its token ID will be automatically
     * assigned (and available on the emitted {IERC721-Transfer} event), and the token
     * URI autogenerated based on the base URI passed at construction.
     *
     * See {ERC721-_mint}.
     *
     * Requirements:
     *
     * - the caller must have the `LOAN_CORE_ROLE`.
     */
    function mint(address to) public virtual {
        require(hasRole(LOAN_CORE_ROLE, _msgSender()), "LenderNote: only LoanCore contract can mint");

        // We cannot just use balanceOf to create the new tokenId because tokens
        // can be burned (destroyed), so we need a separate counter.
        _mint(to, _tokenIdTracker.current());
        _tokenIdTracker.increment();
    }

    /**
     * @dev Burns `tokenId`. See {ERC721-_burn}.
     *
     * Requirements:
     *
     * - The caller must own `tokenId` or be an approved operator.
     * The loan core contract can only burn a loan that is finished:
     * either repaid or claimed.
     *
     * 
     */
    function burn(uint256 tokenId) public virtual {
        if (hasRole(LOAN_CORE_ROLE, _msgSender())) {
            require(!this.isActive(tokenId), "LenderNote: LoanCore attempted to burn an active note.");
        } else {
            require(_isApprovedOrOwner(_msgSender(), tokenId), "LenderNote: caller is not owner nor approved");
        }

        _burn(tokenId);
    }

    /**
     * @dev Pauses all token transfers.
     *
     * See {ERC721Pausable} and {Pausable-_pause}.
     *
     * Requirements:
     *
     * - the caller must have the `PAUSER_ROLE`.
     *
     * TODO: Figure out if we should remove the ability to pause.
     */
    function pause() public virtual {
        require(hasRole(PAUSER_ROLE, _msgSender()), "LenderNote: must have pauser role to pause");
        _pause();
    }

    /**
     * @dev Unpauses all token transfers.
     *
     * See {ERC721Pausable} and {Pausable-_unpause}.
     *
     * Requirements:
     *
     * - the caller must have the `PAUSER_ROLE`.
     *
     * TODO: Figure out if we should remove the ability to pause.
     */
    function unpause() public virtual {
        require(hasRole(PAUSER_ROLE, _msgSender()), "LenderNote: must have pauser role to unpause");
        _unpause();
    }

    function _beforeTokenTransfer(address from, address to, uint256 tokenId) internal virtual override(ERC721, ERC721Enumerable, ERC721Pausable) {
        super._beforeTokenTransfer(from, to, tokenId);
        
        // Do not allow transfer if the loan is not active.
        if (to != address(0)) {
            require(this.isActive(tokenId), "LenderNote: cannot transfer an inactive note. Can only burn.");
        }
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControlEnumerable, ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev See the current status of the loan this note is attached to.
     *
     * This is a convenienc function that gives a wallet or contract interacting
     * the ability 
     */
    function checkStatus(uint256 tokenId) public view returns (LoanMetadata.Status status) {
        require(_exists(tokenId), "LenderNote: loan does not exist");

        return ILoanCore(loanCore).getLoanByLenderNote(tokenId).status;
    }

    /**
     * @dev See the current status of the loan this note is attached to.
     */
    function checkTerms(uint256 tokenId) public view returns (LoanMetadata.Terms memory terms) {
        require(_exists(tokenId), "LenderNote: loan does not exist");

        return ILoanCore(loanCore).getLoanByLenderNote(tokenId).terms;
    }

    /**
     * @dev Use checkStatus to see if the loan is currently active. Used
     * for safety checks during transfer and burn.
     */
    function isActive(uint256 tokenId) public view returns (bool) {
        require(_exists(tokenId), "LenderNote: loan does not exist");

        LoanMetadata.Status status = ILoanCore(loanCore).getLoanByLenderNote(tokenId).status;

        return status == LoanMetadata.Status.OPEN || status == LoanMetadata.Status.DEFAULT;
    }
}