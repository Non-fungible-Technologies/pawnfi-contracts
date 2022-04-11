// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./interfaces/IPromissoryNote.sol";
import "./interfaces/IAssetWrapper.sol";
import "./interfaces/IFeeController.sol";
import "./interfaces/ILoanCoreV2.sol";

import "./PromissoryNote.sol";

// * * * * testing only * * * *
//import "hardhat/console.sol";

/**
 * @dev - Core contract for creating, repaying, and claiming collateral for PawnFi intallment loans
 * Loans with numInstallments set to 0 in the loan terms indicates a legacy loan type where there are no installments.
 * Loan terms with numInstallments greater than 1, indicates the repayPart function is used to repay loans not
 * the standard repay function.
 */
contract LoanCoreV2 is ILoanCoreV2, AccessControl, Pausable {
    using Counters for Counters.Counter;
    using SafeERC20 for IERC20;

    bytes32 public constant ORIGINATOR_ROLE = keccak256("ORIGINATOR_ROLE");
    bytes32 public constant REPAYER_ROLE = keccak256("REPAYER_ROLE");
    bytes32 public constant FEE_CLAIMER_ROLE = keccak256("FEE_CLAIMER_ROLE");

    //interest rate parameters
    uint256 public constant INTEREST_DENOMINATOR = 1 * 10**18;
    uint256 public constant BASIS_POINTS_DENOMINATOR = 10000;

    Counters.Counter private loanIdTracker;
    mapping(uint256 => LoanLibraryV2.LoanData) private loans;
    mapping(uint256 => bool) private collateralInUse;
    IPromissoryNote public override borrowerNote;
    IPromissoryNote public override lenderNote;
    IERC721 public override collateralToken;
    IFeeController public override feeController;

    uint256 private constant BPS_DENOMINATOR = 10_000; // 10k bps per whole

    constructor(IERC721 _collateralToken, IFeeController _feeController) {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(FEE_CLAIMER_ROLE, _msgSender());
        // only those with FEE_CLAIMER_ROLE can update or grant FEE_CLAIMER_ROLE
        _setRoleAdmin(FEE_CLAIMER_ROLE, FEE_CLAIMER_ROLE);

        feeController = _feeController;
        collateralToken = _collateralToken;

        borrowerNote = new PromissoryNote("PawnFi Borrower Note", "pBN");
        lenderNote = new PromissoryNote("PawnFi Lender Note", "pLN");

        // Avoid having loanId = 0
        loanIdTracker.increment();

        emit Initialized(address(collateralToken), address(borrowerNote), address(lenderNote));
    }

    // --------------------- Legacy Loans ----------------------------

    /**
     * @inheritdoc ILoanCoreV2
     */
    function getLoan(uint256 loanId) external view override returns (LoanLibraryV2.LoanData memory loanData) {
        return loans[loanId];
    }

    /**
     * @inheritdoc ILoanCoreV2
     */
    function createLoan(LoanLibraryV2.LoanTerms calldata terms)
        external
        override
        whenNotPaused
        onlyRole(ORIGINATOR_ROLE)
        returns (uint256 loanId)
    {
        require(terms.durationSecs > 0, "LoanCoreV2::create: Loan is already expired");
        require(!collateralInUse[terms.collateralTokenId], "LoanCoreV2::create: Collateral token already in use");

        // interest rate must be entered as 10**18
        require(terms.interest / 10**18 >= 1, "LoanCoreV2::create: Interest must be greater than 0.01%");

        // number of installments must be an even number
        require(terms.numInstallments % 2 == 0, "LoanCoreV2::create: Number of installments must be an even number");

        loanId = loanIdTracker.current();
        loanIdTracker.increment();

        loans[loanId] = LoanLibraryV2.LoanData(
            0,
            0,
            terms,
            LoanLibraryV2.LoanState.Created,
            block.timestamp + terms.durationSecs,
            terms.principal,
            0,
            0,
            0,
            0
        );
        collateralInUse[terms.collateralTokenId] = true;
        emit LoanCreated(terms, loanId);
    }

    /**
     * @inheritdoc ILoanCoreV2
     */
    function startLoan(
        address lender,
        address borrower,
        uint256 loanId
    ) external override whenNotPaused onlyRole(ORIGINATOR_ROLE) {
        LoanLibraryV2.LoanData memory data = loans[loanId];
        // Ensure valid initial loan state
        require(data.state == LoanLibraryV2.LoanState.Created, "LoanCoreV2::start: Invalid loan state");
        // Pull collateral token and principal
        collateralToken.transferFrom(_msgSender(), address(this), data.terms.collateralTokenId);

        // _msgSender() is the OriginationController. The temporary holder of the collateral token
        IERC20(data.terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), data.terms.principal);

        // Distribute notes and principal
        loans[loanId].state = LoanLibraryV2.LoanState.Active;
        uint256 borrowerNoteId = borrowerNote.mint(borrower, loanId);
        uint256 lenderNoteId = lenderNote.mint(lender, loanId);

        loans[loanId] = LoanLibraryV2.LoanData(
            borrowerNoteId,
            lenderNoteId,
            data.terms,
            LoanLibraryV2.LoanState.Active,
            data.dueDate,
            data.balance,
            data.balancePaid,
            data.lateFeesAccrued,
            data.numMissedPayments,
            data.numInstallmentsPaid
        );

        IERC20(data.terms.payableCurrency).safeTransfer(borrower, getPrincipalLessFees(data.terms.principal));
        emit LoanStarted(loanId, lender, borrower);
    }

    /**
     * @inheritdoc ILoanCoreV2
     */
    function repay(uint256 loanId) external override onlyRole(REPAYER_ROLE) {
        LoanLibraryV2.LoanData memory data = loans[loanId];
        // Ensure valid initial loan state
        require(data.state == LoanLibraryV2.LoanState.Active, "LoanCoreV2::repay: Invalid loan state");

        // calc total repayment amount (principal + interest)
        uint256 returnAmount = data.terms.principal +
            ((data.terms.principal * (data.terms.interest / INTEREST_DENOMINATOR)) / BASIS_POINTS_DENOMINATOR);
        //console.log("LoanCore Calc: ", returnAmount);
        // transfer funds
        IERC20(data.terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), returnAmount);

        address lender = lenderNote.ownerOf(data.lenderNoteId);
        address borrower = borrowerNote.ownerOf(data.borrowerNoteId);

        // state changes and cleanup
        // NOTE: these must be performed before assets are released to prevent reentrance
        loans[loanId].state = LoanLibraryV2.LoanState.Repaid;
        collateralInUse[data.terms.collateralTokenId] = false;

        lenderNote.burn(data.lenderNoteId);
        borrowerNote.burn(data.borrowerNoteId);

        // asset and collateral redistribution
        IERC20(data.terms.payableCurrency).safeTransfer(lender, returnAmount);
        collateralToken.transferFrom(address(this), borrower, data.terms.collateralTokenId);

        emit LoanRepaid(loanId);
    }

    /**
     * @inheritdoc ILoanCoreV2
     */
    function claim(uint256 loanId) external override whenNotPaused onlyRole(REPAYER_ROLE) {
        LoanLibraryV2.LoanData memory data = loans[loanId];

        // Ensure valid initial loan state
        require(data.state == LoanLibraryV2.LoanState.Active, "LoanCoreV2::claim: Invalid loan state");
        require(data.dueDate < block.timestamp, "LoanCoreV2::claim: Loan not expired");

        address lender = lenderNote.ownerOf(data.lenderNoteId);

        // NOTE: these must be performed before assets are released to prevent reentrance
        loans[loanId].state = LoanLibraryV2.LoanState.Defaulted;
        collateralInUse[data.terms.collateralTokenId] = false;

        lenderNote.burn(data.lenderNoteId);
        borrowerNote.burn(data.borrowerNoteId);

        // collateral redistribution
        collateralToken.transferFrom(address(this), lender, data.terms.collateralTokenId);

        emit LoanClaimed(loanId);
    }

    /**
     * Take a principal value and return the amount less protocol fees
     */
    function getPrincipalLessFees(uint256 principal) internal view returns (uint256) {
        return principal - ((principal * (feeController.getOriginationFee())) / BPS_DENOMINATOR);
    }

    // --------------------- Installment Specific ----------------------------

    /**
     * @dev Called from RepaymentController when paying back installment loan.
     * Function takes in the loanId and amount repaid to RepaymentController.
     * This amount is then transferred to the lender and loan data is updated accordingly.
     */
    function repayPart(
        uint256 _loanId,
        uint256 _repaidAmount, // amount paid to principal
        uint256 _numMissedPayments, // number of missed payments (number of payments since the last payment)
        uint256 _lateFeesAccrued // any minimum payments to interest and or late fees
    ) external override {
        LoanLibraryV2.LoanData storage data = loans[_loanId];
        // Ensure valid initial loan state
        require(data.state == LoanLibraryV2.LoanState.Active, "LoanCoreV2::repay: Invalid loan state");
        // transfer funds to LoanCoreV2
        uint256 paymentTotal = _repaidAmount + _lateFeesAccrued;
        //console.log("TOTAL PAID FROM BORROWER: ", paymentTotal);
        IERC20(data.terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), paymentTotal);

        // update LoanData
        address lender = lenderNote.ownerOf(data.lenderNoteId);
        address borrower = borrowerNote.ownerOf(data.borrowerNoteId);
        // if last payment and extra sent
        if(_repaidAmount > data.balance) {
            // set the loan state to repaid
            // NOTE: these must be performed before assets are released to prevent reentrance
            data.state = LoanLibraryV2.LoanState.Repaid;
            collateralInUse[data.terms.collateralTokenId] = false;
            // return the difference to borrower
            uint256 diffAmount = _repaidAmount - data.balance;
            IERC20(data.terms.payableCurrency).safeTransfer(borrower, diffAmount);
            // state changes and cleanup
            lenderNote.burn(data.lenderNoteId);
            borrowerNote.burn(data.borrowerNoteId);
            // Loan is fully repaid, redistribute asset and collateral.
            IERC20(data.terms.payableCurrency).safeTransfer(lender, paymentTotal);
            collateralToken.transferFrom(address(this), borrower, data.terms.collateralTokenId);
            // update state
            data.balance = 0;
            data.balancePaid = data.balancePaid + paymentTotal;
            data.numMissedPayments = data.numMissedPayments + _numMissedPayments;
            data.lateFeesAccrued = data.lateFeesAccrued + _lateFeesAccrued;
            data.numInstallmentsPaid = data.numInstallmentsPaid + _numMissedPayments + 1;

            emit LoanRepaid(_loanId);
        }
        // if last payment and exact amount sent
        else if(_repaidAmount == data.balance) {
            // set the loan state to repaid
            // NOTE: these must be performed before assets are released to prevent reentrance
            data.state = LoanLibraryV2.LoanState.Repaid;
            collateralInUse[data.terms.collateralTokenId] = false;
            // state changes and cleanup
            lenderNote.burn(data.lenderNoteId);
            borrowerNote.burn(data.borrowerNoteId);
            // Loan is fully repaid, redistribute asset and collateral.
            IERC20(data.terms.payableCurrency).safeTransfer(lender, paymentTotal);
            collateralToken.transferFrom(address(this), borrower, data.terms.collateralTokenId);

            // update state
            data.balance = 0;
            data.balancePaid = data.balancePaid + paymentTotal;
            data.numMissedPayments = data.numMissedPayments + _numMissedPayments;
            data.lateFeesAccrued = data.lateFeesAccrued + _lateFeesAccrued;
            data.numInstallmentsPaid = data.numInstallmentsPaid + _numMissedPayments + 1;

            emit LoanRepaid(_loanId);
        }
        // else, (mid loan payment)
        else {
            // update state
            data.balance = data.balance - _repaidAmount;
            data.balancePaid = data.balancePaid + paymentTotal;
            data.numMissedPayments = data.numMissedPayments + _numMissedPayments;
            data.lateFeesAccrued = data.lateFeesAccrued + _lateFeesAccrued;
            data.numInstallmentsPaid = data.numInstallmentsPaid + _numMissedPayments + 1;
        }
    }

    // --------------------- Admin Functions ----------------------------

    /**
     * @dev Set the fee controller to a new value
     *
     * Requirements:
     *
     * - Must be called by the owner of this contract
     */
    function setFeeController(IFeeController _newController) external onlyRole(FEE_CLAIMER_ROLE) {
        feeController = _newController;
    }

    /**
     * @dev Claim the protocol fees for the given token
     *
     * @param token The address of the ERC20 token to claim fees for
     *
     * Requirements:
     *
     * - Must be called by the owner of this contract
     */
    function claimFees(IERC20 token) external onlyRole(FEE_CLAIMER_ROLE) {
        // any token balances remaining on this contract are fees owned by the protocol
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(_msgSender(), amount);
        emit FeesClaimed(address(token), _msgSender(), amount);
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
