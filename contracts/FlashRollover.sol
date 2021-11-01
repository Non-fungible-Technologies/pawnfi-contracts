pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./interfaces/IFlashRollover.sol";
import "./interfaces/external/ILendingPool.sol";
import "./interfaces/ILoanCore.sol";
import "./interfaces/IOriginationController.sol";
import "./interfaces/IRepaymentController.sol";
import "./interfaces/IAssetWrapper.sol";
import "./interfaces/IFeeController.sol";

contract FlashRollover is IFlashRollover {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /**
     * Holds parameters passed through flash loan
     * control flow that dictate terms of the new loan.
     * Contains a signature by lender for same terms.
     * isLegacy determines which loanCore to look for the
     * old loan in.
     */
    struct OperationData {
        bool isLegacy;
        uint256 loanId;
        LoanLibrary.LoanTerms newLoanTerms;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /**
     * Defines the contracts that should be used for a
     * flash loan operation. May change based on if the
     * old loan is on the current loanCore or legacy (in
     * which case it requires migration).
     */
    struct OperationContracts {
        ILoanCore loanCore;
        IERC721 borrowerNote;
        IERC721 lenderNote;
        IFeeController feeController;
        IERC721 assetWrapper;
        IRepaymentController repaymentController;
        IOriginationController originationController;
        ILoanCore newLoanLoanCore;
        IERC721 newLoanBorrowerNote;
    }

    ILendingPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    ILendingPool public immutable LENDING_POOL;

    ILoanCore public immutable LOAN_CORE;
    ILoanCore public immutable LEGACY_LOAN_CORE;
    IOriginationController public immutable ORIGINATION_CONTROLLER;
    IRepaymentController public immutable LEGACY_REPAYMENT_CONTROLLER;
    IRepaymentController public immutable REPAYMENT_CONTROLLER;
    IERC721 public immutable BORROWER_NOTE;
    IERC721 public immutable LENDER_NOTE;
    IERC721 public immutable LEGACY_BORROWER_NOTE;
    IERC721 public immutable LEGACY_LENDER_NOTE;
    IERC721 public immutable ASSET_WRAPPER;
    IFeeController public immutable FEE_CONTROLLER;

    constructor(
        ILendingPoolAddressesProvider provider,
        ILoanCore loanCore,
        ILoanCore legacyLoanCore,
        IOriginationController originationController,
        IRepaymentController repaymentController,
        IRepaymentController legacyRepaymentController,
        IERC721 borrowerNote,
        IERC721 legacyBorrowerNote,
        IERC721 lenderNote,
        IERC721 legacyLenderNote,
        IERC721 assetWrapper,
        IFeeController feeController
    ) {
        ADDRESSES_PROVIDER = provider;
        LENDING_POOL = ILendingPool(provider.getLendingPool());
        LOAN_CORE = loanCore;
        LEGACY_LOAN_CORE = legacyLoanCore;
        ORIGINATION_CONTROLLER = originationController;
        REPAYMENT_CONTROLLER = repaymentController;
        LEGACY_REPAYMENT_CONTROLLER = legacyRepaymentController;
        BORROWER_NOTE = borrowerNote;
        LEGACY_BORROWER_NOTE = legacyBorrowerNote;
        LENDER_NOTE = lenderNote;
        LEGACY_LENDER_NOTE = legacyLenderNote;
        ASSET_WRAPPER = assetWrapper;
        FEE_CONTROLLER = feeController;
    }

    function rolloverLoan(
        bool isLegacy,
        uint256 loanId,
        LoanLibrary.LoanTerms calldata newLoanTerms,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        // Get loan details
        LoanLibrary.LoanData memory loanData;
        if (isLegacy) {
            loanData = LEGACY_LOAN_CORE.getLoan(loanId);
            uint256 borrowerNoteId = loanData.borrowerNoteId;

            address borrower = LEGACY_BORROWER_NOTE.ownerOf(borrowerNoteId);
            require(borrower == msg.sender, "Only borrower can roll over");
        } else {
            loanData = LOAN_CORE.getLoan(loanId);
            uint256 borrowerNoteId = loanData.borrowerNoteId;

            address borrower = BORROWER_NOTE.ownerOf(borrowerNoteId);
            require(borrower == msg.sender, "Only borrower can roll over");
        }

        LoanLibrary.LoanTerms memory terms = loanData.terms;
        uint256 amountDue = terms.principal.add(terms.interest);

        require(newLoanTerms.payableCurrency == terms.payableCurrency, "Currency mismatch");
        require(newLoanTerms.collateralTokenId == terms.collateralTokenId, "Collateral mismatch");

        uint256 startBalance = IERC20(terms.payableCurrency).balanceOf(address(this));

        address[] memory assets = new address[](1);
        assets[0] = terms.payableCurrency;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amountDue;

        uint256[] memory modes = new uint256[](1);
        modes[0] = 0;

        OperationData memory opData = OperationData({
            isLegacy: isLegacy,
            loanId: loanId,
            newLoanTerms: newLoanTerms,
            v: v,
            r: r,
            s: s
        });

        bytes memory params = abi.encode(opData);

        // Flash loan based on principal + interest
        LENDING_POOL.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            0 // TODO: Add referral code?
        );

        // Should not have any funds leftover
        require(
            IERC20(terms.payableCurrency).balanceOf(address(this)) == startBalance,
            "Nonzero balance after flash loan"
        );
    }

    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // TODO: Security check.
        // Can an attacker use this to drain borrower funds? Feels like maybe

        require(msg.sender == address(LENDING_POOL), "Unknown lender");
        require(initiator == address(this), "Not initiator");
        require(IERC20(assets[0]).balanceOf(address(this)) >= amounts[0], "Did not receive loan funds");

        OperationData memory opData = abi.decode(params, (OperationData));

        return _executeOperation(assets, amounts, premiums, opData);
    }

    function _executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        OperationData memory opData
    ) internal returns (bool) {
        OperationContracts memory opContracts = _getContracts(opData.isLegacy);

        // Get loan details
        LoanLibrary.LoanData memory loanData = opContracts.loanCore.getLoan(opData.loanId);
        require(loanData.borrowerNoteId != 0, "Cannot find note");

        address borrower = opContracts.borrowerNote.ownerOf(loanData.borrowerNoteId);
        address lender = opContracts.lenderNote.ownerOf(loanData.lenderNoteId);

        // Do accounting to figure out amount each party needs to receive
        (uint256 flashAmountDue, uint256 needFromBorrower, uint256 leftoverPrincipal) = _ensureFunds(
            amounts[0],
            premiums[0],
            opContracts.feeController.getOriginationFee(),
            opData.newLoanTerms.principal
        );

        _repayLoan(opContracts, loanData);
        _initializeNewLoan(opContracts, borrower, lender, loanData.terms.collateralTokenId, opData);

        if (leftoverPrincipal > 0) {
            IERC20(assets[0]).transfer(borrower, leftoverPrincipal);
        } else if (needFromBorrower > 0) {
            IERC20(assets[0]).transferFrom(borrower, address(this), needFromBorrower);
        }

        // Approve all amounts for flash loan repayment
        IERC20(assets[0]).approve(address(LENDING_POOL), flashAmountDue);

        return true;
    }

    function _ensureFunds(
        uint256 amount,
        uint256 premium,
        uint256 originationFee,
        uint256 newPrincipal
    )
        internal
        pure
        returns (
            uint256 flashAmountDue,
            uint256 needFromBorrower,
            uint256 leftoverPrincipal
        )
    {
        // Make sure new loan, minus pawn fees, can be repaid
        flashAmountDue = amount - premium;
        uint256 willReceive = (newPrincipal - (newPrincipal * originationFee)) / 10_000;

        if (flashAmountDue > willReceive) {
            // Not enough - have borrower pay the difference
            needFromBorrower = flashAmountDue - willReceive;
        } else if (willReceive > flashAmountDue) {
            // Too much - will send extra to borrower
            leftoverPrincipal = willReceive - flashAmountDue;
        }

        // Either leftoverPrincipal or needFromBorrower should be 0
        require(leftoverPrincipal & needFromBorrower == 0, "_ensureFunds computation");
    }

    function _repayLoan(OperationContracts memory contracts, LoanLibrary.LoanData memory loanData) internal {
        address borrower = contracts.borrowerNote.ownerOf(loanData.borrowerNoteId);

        // Take BorrowerNote from borrower
        // Must be approved for withdrawal
        contracts.borrowerNote.transferFrom(borrower, address(this), loanData.borrowerNoteId);

        // Approve repayment
        IERC20(loanData.terms.payableCurrency).approve(
            address(contracts.repaymentController),
            loanData.terms.principal + loanData.terms.interest
        );

        // Repay loan
        contracts.repaymentController.repay(loanData.borrowerNoteId);

        // contract now has asset wrapper but has lost funds
        require(
            contracts.assetWrapper.ownerOf(loanData.terms.collateralTokenId) == address(this),
            "Post-loan: not owner of collateral"
        );
    }

    function _initializeNewLoan(
        OperationContracts memory contracts,
        address borrower,
        address lender,
        uint256 collateralTokenId,
        OperationData memory opData
    ) internal {
        // approve originationController
        contracts.assetWrapper.approve(address(contracts.originationController), collateralTokenId);

        // start new loan
        LoanLibrary.LoanData memory newLoanData = contracts.newLoanLoanCore.getLoan(
            contracts.originationController.initializeLoan(
                opData.newLoanTerms,
                borrower,
                lender,
                opData.v,
                opData.r,
                opData.s
            )
        );

        // Send note to borrower
        contracts.newLoanBorrowerNote.safeTransferFrom(address(this), borrower, newLoanData.borrowerNoteId);
    }

    function _getContracts(bool isLegacy) internal view returns (OperationContracts memory) {
        if (isLegacy) {
            return
                OperationContracts({
                    loanCore: LEGACY_LOAN_CORE,
                    borrowerNote: LEGACY_BORROWER_NOTE,
                    lenderNote: LEGACY_LENDER_NOTE,
                    feeController: FEE_CONTROLLER,
                    assetWrapper: ASSET_WRAPPER,
                    repaymentController: LEGACY_REPAYMENT_CONTROLLER,
                    originationController: ORIGINATION_CONTROLLER,
                    newLoanLoanCore: LOAN_CORE,
                    newLoanBorrowerNote: BORROWER_NOTE
                });
        } else {
            return
                OperationContracts({
                    loanCore: LOAN_CORE,
                    borrowerNote: BORROWER_NOTE,
                    lenderNote: LENDER_NOTE,
                    feeController: FEE_CONTROLLER,
                    assetWrapper: ASSET_WRAPPER,
                    repaymentController: REPAYMENT_CONTROLLER,
                    originationController: ORIGINATION_CONTROLLER,
                    newLoanLoanCore: LOAN_CORE,
                    newLoanBorrowerNote: BORROWER_NOTE
                });
        }
    }
}
