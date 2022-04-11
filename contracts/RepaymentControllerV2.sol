// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/** Legacy V1 Notes
 * see https://github.com/Non-fungible-Technologies/pawnfi-contracts main branch
 */

/** V2 Notes
 * interest input as a APR value.
 *
 * calcInstallment - function which returns the current balanceDue(uint256),
 * defaulted(bool), and payableCurrency(address)
 *
 * repayPartMinimum - function for repaying installment payments. The minimum amount payable. Interest and any fees only.
 *
 * repayPart - function for repaying installment payments. The amount must be higher than the minimum amount payable.
 */
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";

import "./libraries/LoanLibraryV2.sol";
import "./interfaces/IPromissoryNote.sol";
import "./interfaces/ILoanCoreV2.sol";
import "./interfaces/IRepaymentControllerV2.sol";

// * * * * testing only * * * *
//import "hardhat/console.sol";

contract RepaymentControllerV2 is IRepaymentControllerV2, Context {
    using SafeERC20 for IERC20;

    ILoanCoreV2 private loanCoreV2;
    IPromissoryNote private borrowerNote;
    IPromissoryNote private lenderNote;

    //interest rate parameters
    uint256 public constant INTEREST_DENOMINATOR = 1 * 10**18;
    uint256 public constant BASIS_POINTS_DENOMINATOR = 10000;

    // Installment LoanState
    uint256 public constant GRACE_PERIOD = 604800; // 60*60*24*7 // 1 week
    uint256 public constant LATE_FEE = 50; // 50/BASIS_POINTS_DENOMINATOR = 0.5%

    constructor(
        ILoanCoreV2 _loanCoreV2,
        IPromissoryNote _borrowerNote,
        IPromissoryNote _lenderNote
    ) {
        loanCoreV2 = _loanCoreV2;
        borrowerNote = _borrowerNote;
        lenderNote = _lenderNote;
    }

    /**
     * @dev interest and principal must be entered as base 10**18
     */
    function getInterestNoInstallments(
        uint256 principal,
        uint256 interest,
        address collateralTokenAddr
    ) internal returns (uint256) {
        //interest to be greater than or equal to 1 ETH
        require(interest / 10**18 >= 1, "Interest must be greater than 0.01%.");
        //console.log("Interest Amount: ", ((principal * (interest / INTEREST_DENOMINATOR))/BASIS_POINTS_DENOMINATOR));

        //principal must be greater than 10000 wei, this is a require statement in createLoan function in LoanCoreV2
        //console.log("Principal+interest", principal + ((principal * (interest / INTEREST_DENOMINATOR))/BASIS_POINTS_DENOMINATOR));
        uint256 total = principal + ((principal * (interest / INTEREST_DENOMINATOR)) / BASIS_POINTS_DENOMINATOR);
        return total;
    }

    /**
     * @inheritdoc IRepaymentControllerV2
     */
    function repay(uint256 borrowerNoteId) external override {
        // get loan from borrower note
        uint256 loanId = borrowerNote.loanIdByNoteId(borrowerNoteId);
        require(loanId != 0, "RepaymentControllerV2: repay could not dereference loan");

        LoanLibraryV2.LoanTerms memory terms = loanCoreV2.getLoan(loanId).terms;

        // withdraw principal plus interest from borrower and send to loan core
        uint256 total = getInterestNoInstallments(terms.principal, terms.interest, terms.payableCurrency);
        require(total > 0, "No payment due.");

        IERC20(terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), total);
        IERC20(terms.payableCurrency).approve(address(loanCoreV2), total);

        // call repay function in loan core
        loanCoreV2.repay(loanId);
    }

    /**
     * @inheritdoc IRepaymentControllerV2
     */
    function claim(uint256 lenderNoteId) external override {
        // make sure that caller owns lender note
        address lender = lenderNote.ownerOf(lenderNoteId);
        require(lender == _msgSender(), "RepaymentControllerV2: not owner of lender note");

        // get loan from lender note
        uint256 loanId = lenderNote.loanIdByNoteId(lenderNoteId);
        require(loanId != 0, "RepaymentControllerV2: claim could not dereference loan");

        // call claim function in loan core
        loanCoreV2.claim(loanId);
    }

    // --------------------- Installment Specific ----------------------------

    /**
     * @dev - Get current installment using the startDate, duration, and current time.
     * DurationSecs must be greater than 10 seconds (10%10 = 0).
     */
    function installmentWizard(
        uint256 startDate,
        uint256 durationSecs,
        uint256 numInstallments
    ) internal returns (uint256) {
        // *** Local State
        uint256 _currentTime = block.timestamp;
        uint256 _installmentPeriod = 1;
        uint256 _relativeTimeInLoan = 0;
        uint256 _multiplier = 10**20; // inital value

        // *** Get Timestamp Mulitpier
        //console.log(36000 % 10000) = 6000 // 10000 is the first value that does not return 36000;
        for (uint256 i = 10**18; i >= 10; i = i / 10) {
            if (durationSecs % i != durationSecs) {
                //console.log(i);
                if (_multiplier == 10**20) {
                    _multiplier = ((1 * 10**18) / i);
                }
            }
        }

        // *** Time Per Installment
        uint256 _timePerInstallment = durationSecs / numInstallments;

        // *** Relative Time In Loan
        _relativeTimeInLoan = (_currentTime - startDate) * _multiplier;

        // console.log("_multiplier: ", _multiplier);
        // console.log("currentTi: ", _currentTime);
        // console.log("startDate: ", startDate);
        //console.log("DELTA TIME: ", (_currentTime - startDate));
        //console.log(
        //     "_relativeTimeInLoan/ _timePerInstallment: ",
        //     _relativeTimeInLoan,
        //     _timePerInstallment * _multiplier
        // );

        // *** Check to see when _timePerInstallment * i is greater than _relativeTimeInLoan
        // Used to determine the current installment period. (j+1 to account for the current period)
        uint256 j = 1;
        while ((_timePerInstallment * j) * _multiplier <= _relativeTimeInLoan) {
            //console.log((_timePerInstallment * j) * _multiplier);
            //console.log(_relativeTimeInLoan);
            _installmentPeriod = j+1;
            j++;
        }

        //console.log("Current Installment Period: ", _installmentPeriod);
        // *** Return
        return (_installmentPeriod);
    }

    /**
     * @dev - Get minimum installment payment due, any late fees accrued, and
     * the number of missed payments since last installment payment.
     *
     * 1. Calculate relative time values.
     * 2. Determine if payment is late.
     *      Y. Calculate minimum balance due with late fees.
     *      N. Return only interest rate payment
     */
    function calcInstallment(
        LoanLibraryV2.LoanData memory data,
        uint256 numInstallments,
        uint256 interest
    )
        internal
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        // *** Local Variables
        uint256 _bal = data.balance;

        // *** Installment Values
        (uint256 _installmentPeriod) = installmentWizard(
            data.terms.startDate,
            data.terms.durationSecs,
            numInstallments
        );
        uint256 _installmentsMissed = _installmentPeriod - (data.numInstallmentsPaid + 1); // +1 for the current installment period payment

        // Interest per installment - using mulitpier of 1 million. There should not be loan with more than 1 million installment periods
        uint256 _interestPerInstallment = ((interest / INTEREST_DENOMINATOR) * 1000000) / numInstallments; // still need to divide by BASIS_POINTS_DENOMINATOR for rate value
        //console.log("_interestPerInstallment (/1000000 for BPS): ", _interestPerInstallment);

        // *** Determine if late fees are added and if so, how much? ***
        // Calulate number of payments missed based on _latePayment, _pastDueDate
        // * If payment on time...
        //console.log(_latePayment, _pastDueDate);
        //console.log("numInstallmentsPaid", data.numInstallmentsPaid);
        if (_installmentsMissed == 0) {
            // Minimum balance due calculation. Based on interest per installment period
            uint256 minBalDue = ((_bal * _interestPerInstallment) / 1000000) / BASIS_POINTS_DENOMINATOR;
            //console.log(" _bal: ", _bal);
            //console.log(" --- TOTAL MIN AMOUNT DUE:: ", minBalDue);

            return (minBalDue, 0, 0);
        }
        // * If payment is late, or past the loan duration...
        else {
            uint256 minBalDue = 0;
            uint256 currentBal = _bal;
            uint256 lateFees = 0;
            // late fees compound on any installment periods missed. late fees of first installment numMissedPayments
            // add to the principal of the next late fees calculation
            for (uint256 i = 0; i < _installmentsMissed; i++) {
                minBalDue = minBalDue + (((currentBal * _interestPerInstallment ) / 1000000) / BASIS_POINTS_DENOMINATOR);
                currentBal = currentBal + minBalDue;
                lateFees = lateFees + ((currentBal * LATE_FEE) / BASIS_POINTS_DENOMINATOR);
                //console.log("currentBal: ", currentBal);
                //console.log("  lateFees: ", lateFees);
            }

            //console.log(" minBalDue: ", minBalDue);
            //console.log("  lateFees: ", lateFees);
            //console.log("_installmentsMissed: ", _installmentsMissed);
            //console.log(" --- TOTAL MIN AMOUNT DUE::", minBalDue + lateFees);

            return (minBalDue, lateFees, _installmentsMissed);
        }
    }

    /**
     * @dev - Crafts the LoanLibrary data to be passed to calcInstallment and returns installment data.
     */
    function getInstallmentMinPayment(uint256 borrowerNoteId)
        public
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        // get loan from borrower note
        uint256 loanId = borrowerNote.loanIdByNoteId(borrowerNoteId);
        require(loanId != 0, "RepaymentControllerV2: repay could not dereference loan");
        // load terms from loanId
        LoanLibraryV2.LoanData memory data = loanCoreV2.getLoan(loanId);

        // local variables
        uint256 startDate = data.terms.startDate;
        require(startDate < block.timestamp, "Loan has not started yet.");
        uint256 installments = data.terms.numInstallments;
        address payableCurrency = data.terms.payableCurrency;
        require(installments > 0, "This loan type does not have any installments.");

        // Get the current minimum balance due for the installment.
        (uint256 minBalanceDue, uint256 lateFees, uint256 numMissedPayments) = calcInstallment(
            data,
            data.terms.numInstallments,
            data.terms.interest
        );

        return (minBalanceDue, lateFees, numMissedPayments);
    }

    /**
     * @dev - Called when paying back installment loan with the minimum amount due.
     * Do not call for single payment loan types.
     */
    function repayPartMinimum(uint256 borrowerNoteId) public {
        // get loan from borrower note
        uint256 loanId = borrowerNote.loanIdByNoteId(borrowerNoteId);
        require(loanId != 0, "RepaymentControllerV2: repay could not dereference loan");
        // load terms from loanId
        LoanLibraryV2.LoanData memory data = loanCoreV2.getLoan(loanId);

        // local variables
        uint256 startDate = data.terms.startDate;
        require(startDate < block.timestamp, "Loan has not started yet.");
        uint256 installments = data.terms.numInstallments;
        address payableCurrency = data.terms.payableCurrency;
        require(installments > 0, "This loan type does not have any installments.");

        // Get the current minimum balance due for the installment.
        (uint256 minBalanceDue, uint256 lateFees, uint256 numMissedPayments) = calcInstallment(
            data,
            data.terms.numInstallments,
            data.terms.interest
        );
        require(minBalanceDue > 0, "No interest or late fees due.");

        uint256 _amount = minBalanceDue + lateFees;
        // Gather  minimum payment from _msgSender()
        IERC20(payableCurrency).safeTransferFrom(_msgSender(), address(this), _amount);
        // approve loanCoreV2 to take minBalanceDue
        IERC20(payableCurrency).approve(address(loanCoreV2), _amount);
        // Call repayPart function in loanCoreV2.
        loanCoreV2.repayPart(loanId, 0, numMissedPayments, _amount);
    }

    /**
     * @dev Called when paying back installment loan with an amount greater than
     * the minimum amount due. Do not call for single payment loan types.
     */
    function repayPart(uint256 borrowerNoteId, uint256 amount) public {
        // get loan from borrower note
        uint256 loanId = borrowerNote.loanIdByNoteId(borrowerNoteId);
        require(loanId != 0, "RepaymentControllerV2: repay could not dereference loan");
        // load data from loanId
        LoanLibraryV2.LoanData memory data = loanCoreV2.getLoan(loanId);

        // local variables
        uint256 startDate = data.terms.startDate;
        require(startDate < block.timestamp, "Loan has not started yet.");
        uint256 installments = data.terms.numInstallments;
        address payableCurrency = data.terms.payableCurrency;
        require(installments > 0, "This loan type does not have any installments.");

        // Get the current minimum balance due for the installment.
        (uint256 minBalanceDue, uint256 lateFees, uint256 numMissedPayments) = calcInstallment(
            data,
            data.terms.numInstallments,
            data.terms.interest
        );
        // Require amount to be taken from the _msgSender() to be larger than or equal to minimum amount due
        require(amount >= minBalanceDue, "Amount sent is less than the minimum amount due.");
        uint256 _principalAmount = amount - (minBalanceDue + lateFees);
        // gather amount specified in function call params from _msgSender()
        IERC20(payableCurrency).safeTransferFrom(_msgSender(), address(this), amount);
        // approve loanCoreV2 to take minBalanceDue
        IERC20(payableCurrency).approve(address(loanCoreV2), amount);
        // Call repayPart function in loanCoreV2.
        loanCoreV2.repayPart(loanId, _principalAmount, numMissedPayments, minBalanceDue + lateFees);
    }
}
