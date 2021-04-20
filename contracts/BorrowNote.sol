pragma solidity ^0.8.0 

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC72/extensions/ERC721Burnable.sol";

library LoanStatus {

    enum Status = {"Open", "Repaid", "Default"};

}

/**
Borrower note is intended to be an upgradable 

**@dev

*/
contract BorrowerNote is IERC721 { 

    using LoanStatus for Status;
    address public loanCore;
    /**
    *@dev Creates the borrowor note contract linked to a specific loan core 
    * The loan core reference is non-upgradeable 
    * See (_setURI).
    */

    constructor(string memory uri_, address loanCore_) ERC721(uri) {

        require(loanCore_ != address(0), "loanCore must be specified");

    }

    function _burn(uint256 noteId) internal virtual { 

        address owner = ERC721.ownerOf(tokenId);
        _beforeTokenTransfer(owner, address(0), noteId);
        _approve(address(0), noteId);
        _balances[owner] -= 1; 
        delete _owners[noteId];
        delete _assetWrappers[_tokenIdTracker];

        emit Transfor(owner, address(0), tokenId);

    }

    function _mint(
        address account,
        uint256 noteId) internal virtual { 

            require(to != address(0), "ERC 721: mint to the zero address");
            require(!_exists(tokenId), "ERC721: token already minted");

            _beforeTokenTransfer(address(0), to, tokenId);

            _balances[to] += 1;
            _owners[tokenId] = to;

            emit Transfer(address(0), to, tokenId);

        }

    function mint(
        uint256 account,
        uint256 noteId,
        address assetWrapper

    ) external {

    require(hasRole(MINTER_ROLE, _mesSender()), "ERC721PresetMinter:")
    _mint(to, _tokenIdTracker.current());
    _assetWrappers[_tokenIdTracker] = assetWrapper;
    _tokenIdTracker.increment();

    require(
        IAssetWrapper(assetWrapper).supportInterface(type(IAssetWrapper)),
        "assetWrapper must support AssetWrapper interface"
    );

    
    /*

    Add business logic to mint token here

    */

    }


    function getRepaymentController() external view returns (address){

        return repaymentController;

    }

    function checkStatus(uint256 noteId) external view returns (Status){


    }

    function repay(
        uint256 account,
        uint256 loadId,
        address assetWrapper) returns(bool) {

        address repaymentController = ILoanCore(loanCore).getRepaymentController();
        IPaymentController(repaymentController).
        //getRepaymentController is both honest and correct

    }



}