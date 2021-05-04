pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";

import "../interfaces/ILoanCore.sol";
import "./LoanMetadata.sol";

contract LoanNoteUtilities is Context, ERC721, ERC721Enumerable, ERC721Pausable {
    address public loanCore;

    constructor() public ERC721() {}

    function isActive(uint256 tokenId) public view returns (bool) {
        require(_exists(tokenId), "BorrowerNote: loan does not exist");

        LoanMetadata.Status status = ILoanCore(loanCore).getLoanByLenderNote(tokenId).status;

        return status == LoanMetadata.Status.OPEN || status == LoanMetadata.Status.DEFAULT;
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
     * @dev Hook that is called before any token transfer
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal virtual override(ERC721, ERC721Enumerable, ERC721Pausable) {
        super._beforeTokenTransfer(from, to, tokenId);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}