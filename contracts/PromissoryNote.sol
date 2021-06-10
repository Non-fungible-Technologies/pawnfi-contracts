pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "./interfaces/ILoanCore.sol";
import "./interfaces/IPromissoryNote.sol";

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
contract PromissoryNote is Context, AccessControlEnumerable, ERC721, ERC721Enumerable, ERC721Pausable, IPromissoryNote {
    using Counters for Counters.Counter;

    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    Counters.Counter private _tokenIdTracker;

    mapping (uint256 => uint256) public override loanIdByNoteId;

    /**
     * @dev Creates the borrowor note contract linked to a specific loan core
     * The loan core reference is non-upgradeable
     * See (_setURI).
     * Grants `PAUSER_ROLE`, `MINTER_ROLE`, and `BURNER_ROLE` to the sender
     * contract, provided it is an instance of LoanCore.
     *
     * Grants `DEFAULT_ADMIN_ROLE` to the account that deploys the contract. Admins
  
     */

    constructor(string memory name, string memory symbol) ERC721(name, symbol) {
        _setupRole(BURNER_ROLE, _msgSender());
        _setupRole(MINTER_ROLE, _msgSender());
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
     * - the caller must have the `MINTER_ROLE`.
     */
    function mint(address to, uint256 loanId) external override returns (uint256) {
        require(hasRole(MINTER_ROLE, _msgSender()), "ERC721PresetMinter: sending does have proper role");

        uint256 currentTokenId = _tokenIdTracker.current();
        _mint(to, currentTokenId);
        loanIdByNoteId[currentTokenId] = loanId;

        _tokenIdTracker.increment();

        return currentTokenId;
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
    function burn(uint256 tokenId) external override {
        require(hasRole(BURNER_ROLE, _msgSender()), "PromissoryNote: callers is not owner nor approved");
        _burn(tokenId);
        loanIdByNoteId[tokenId] = 0;
    }

    /**
     * @dev override of supportsInterface for AccessControlEnumerable, ERC721, ERC721Enumerable
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlEnumerable, ERC721, ERC721Enumerable, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev override of supportsInterface for ERC721, ERC721Enumerable, ERC721Pausable
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC721, ERC721Enumerable, ERC721Pausable) {
        super._beforeTokenTransfer(from, to, amount);

        require(!paused(), "ERC20Pausable: token transfer while paused");
    }
}
