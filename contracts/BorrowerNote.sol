pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

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
contract BorrowerNote is Context, AccessControlEnumerable, ERC721, ERC721Enumerable, ERC721Pausable {
    using Counters for Counters.Counter;

    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    Counters.Counter private _tokenIdTracker;
    address public loanCore;

    /**
     * @dev Creates the borrowor note contract linked to a specific loan core
     * The loan core reference is non-upgradeable
     * See (_setURI).
     * Grants `MINTER_ROLE` and `BURNER_ROLE` to the specified loanCore-
     * contract, provided it is an instance of LoanCore.
     *
     * Grants `DEFAULT_ADMIN_ROLE` to the account that deploys the contract. Admins
     * can pause the contract if needed.
     *
     */

    constructor(
        address loanCore_,
        string memory name,
        string memory symbol
    ) ERC721(name, symbol) {
        require(loanCore_ != address(0), "loanCore address must be defined");

        //bytes4 loanCoreInterface = type(ILoanCore).interfaceId;

        //require(this.supportsInterface(loanCoreInterface), "loanCore must be an instance of LoanCore");

        _setupRole(BURNER_ROLE, loanCore_);

        loanCore = loanCore_;

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
    function mint(address to) external {
        require(hasRole(MINTER_ROLE, _msgSender()), "ERC721PresetMinter: ");
        _mint(to, _tokenIdTracker.current());
        _tokenIdTracker.increment();

        /*
        require(
            IAssetWrapper(assetWrapper).supportInterface(type(IAssetWrapper)),
            "assetWrapper must support AssetWrapper interface"
        );
        */
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
    function burn(uint256 tokenId) external {
        if (hasRole(BURNER_ROLE, _msgSender())) {
            LoanState status = ILoanCore(loanCore).getLoan(tokenId).state;
            bool loanStatus = status == LoanState.Active;
            require(!loanStatus, "BorrowerNote: LoanCore attempted to burn an active note.");
        } else {
            require(_isApprovedOrOwner(_msgSender(), tokenId), "BorrowerNote: callers is not owner nor approved");
        }

        _burn(tokenId);
    }

    /**
     * @dev override of supportsInterface for AccessControlEnumerable, ERC721, ERC721Enumerable
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlEnumerable, ERC721, ERC721Enumerable)
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
