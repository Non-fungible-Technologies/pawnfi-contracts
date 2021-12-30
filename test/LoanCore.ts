import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";

import { LoanCore, FeeController, PromissoryNote, MockERC20, MockERC721 } from "../typechain";
import { mint as mintERC721 } from "./utils/erc721";
import { BlockchainTime } from "./utils/time";
import { LoanTerms, LoanState } from "./utils/types";
import { deploy } from "./utils/contracts";

const ORIGINATOR_ROLE = "0x59abfac6520ec36a6556b2a4dd949cc40007459bcd5cd2507f1e5cc77b6bc97e";
const REPAYER_ROLE = "0x9c60024347074fd9de2c1e36003080d22dbc76a41ef87444d21e361bcb39118e";
const CLAIM_FEES_ROLE = "0x8dd046eb6fe22791cf064df41dbfc76ef240a563550f519aac88255bd8c2d3bb";

const ZERO = hre.ethers.utils.parseUnits("0", 18);

interface TestContext {
  loanCore: LoanCore;
  mockERC20: MockERC20;
  mockBorrowerNote: PromissoryNote;
  mockLenderNote: PromissoryNote;
  mockAssetWrapper: MockERC721;
  user: Signer;
  other: Signer;
  signers: Signer[];
}

describe("LoanCore", () => {
  const blockchainTime = new BlockchainTime();

  /**
   * Sets up a test context, deploying new contracts and returning them for use in a test
   */
  const setupTestContext = async (): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();

    const mockAssetWrapper = <MockERC721>await deploy("MockERC721", signers[0], ["Mock AssetWrapper", "MA"]);
    const feeController = <FeeController>await deploy("FeeController", signers[0], []);
    const originator = signers[0];
    const repayer = signers[0];
    const loanCore = <LoanCore>await deploy("LoanCore", signers[0], [mockAssetWrapper.address, feeController.address]);

    await loanCore.connect(signers[0]).grantRole(ORIGINATOR_ROLE, await originator.getAddress());
    await loanCore.connect(signers[0]).grantRole(REPAYER_ROLE, await repayer.getAddress());

    const borrowerNoteAddress = await loanCore.borrowerNote();
    const mockBorrowerNote = <PromissoryNote>(
      (await ethers.getContractFactory("PromissoryNote")).attach(borrowerNoteAddress)
    );

    const lenderNoteAddress = await loanCore.lenderNote();
    const mockLenderNote = <PromissoryNote>(
      (await ethers.getContractFactory("PromissoryNote")).attach(lenderNoteAddress)
    );

    const mockERC20 = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);

    return {
      loanCore,
      mockBorrowerNote,
      mockLenderNote,
      mockAssetWrapper,
      mockERC20,
      user: signers[0],
      other: signers[1],
      signers: signers.slice(2),
    };
  };

  /**
   * Create a LoanTerms object using the given parameters, or defaults
   */
  const createLoanTerms = (
    payableCurrency: string,
    {
      durationSecs = 360000,
      principal = hre.ethers.utils.parseEther("100"),
      interest = hre.ethers.utils.parseEther("1"),
      collateralTokenId = BigNumber.from(1),
    }: Partial<LoanTerms> = {},
  ): LoanTerms => {
    return {
      durationSecs,
      principal,
      interest,
      collateralTokenId,
      payableCurrency,
    };
  };

  /**
   * Initialize a new loan, returning the loanId
   */
  const createLoan = async (loanCore: LoanCore, user: Signer, terms: LoanTerms): Promise<BigNumber> => {
    const tx = await loanCore.connect(user).createLoan(terms);
    const receipt = await tx.wait();

    if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
      return receipt.events[0].args.loanId;
    } else {
      throw new Error("Unable to initialize loan");
    }
  };

  /**
   * Assert equality between two LoanTerms objects
   */
  const assertTermsEquality = (actual: LoanTerms, expected: LoanTerms) => {
    expect(actual.durationSecs).to.equal(expected.durationSecs);
    expect(actual.principal).to.equal(expected.principal);
    expect(actual.interest).to.equal(expected.interest);
    expect(actual.collateralTokenId).to.equal(expected.collateralTokenId);
    expect(actual.payableCurrency).to.equal(expected.payableCurrency);
  };

  describe("Create Loan", function () {
    it("should successfully create a loan", async () => {
      const { loanCore, mockERC20, mockAssetWrapper, user } = await setupTestContext();
      const collateralTokenId = await mintERC721(mockAssetWrapper, user);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId });

      const loanId = await createLoan(loanCore, user, terms);
      expect(loanId.gte(ZERO)).to.be.true;

      const storedLoanData = await loanCore.getLoan(loanId);
      expect(storedLoanData.borrowerNoteId).to.equal(BigNumber.from(0));
      expect(storedLoanData.lenderNoteId).to.equal(BigNumber.from(0));
      expect(storedLoanData.state).to.equal(LoanState.Created);
      assertTermsEquality(storedLoanData.terms, terms);
    });

    it("should emit the LoanCreated event", async () => {
      const { loanCore, mockERC20, mockAssetWrapper, user } = await setupTestContext();
      const collateralTokenId = await mintERC721(mockAssetWrapper, user);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId });

      await expect(loanCore.connect(user).createLoan(terms)).to.emit(loanCore, "LoanCreated");
    });

    it("should successfully create a bunch of loans with different loanIds", async () => {
      const { loanCore, mockERC20, mockAssetWrapper, user } = await setupTestContext();

      const loanIds = new Set();
      for (let i = 0; i < 10; i++) {
        const collateralTokenId = await mintERC721(mockAssetWrapper, user);
        const terms = createLoanTerms(mockERC20.address, { collateralTokenId });

        const loanId = await createLoan(loanCore, user, terms);
        expect(loanIds.has(loanId)).to.be.false;
        loanIds.add(loanId);
      }
    });

    it("rejects calls from non-originator", async () => {
      const { loanCore, mockERC20, mockAssetWrapper, user, other } = await setupTestContext();
      const collateralTokenId = await mintERC721(mockAssetWrapper, user);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId });
      await expect(loanCore.connect(other).createLoan(terms)).to.be.revertedWith(
        `AccessControl: account ${(await other.getAddress()).toLowerCase()} is missing role ${ORIGINATOR_ROLE}`,
      );
    });

    it("should update originator and accept new one", async () => {
      const { loanCore, mockERC20, mockAssetWrapper, user, other } = await setupTestContext();
      const collateralTokenId = await mintERC721(mockAssetWrapper, user);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId });
      await loanCore.connect(user).grantRole(ORIGINATOR_ROLE, await other.getAddress());
      await expect(loanCore.connect(other).createLoan(terms)).to.emit(loanCore, "LoanCreated");
    });

    it("should fail to create a loan with passed due date", async () => {
      const { loanCore, mockERC20, mockAssetWrapper, user } = await setupTestContext();
      const collateralTokenId = await mintERC721(mockAssetWrapper, user);
      const terms = createLoanTerms(mockERC20.address, {
        collateralTokenId,
        durationSecs: 0,
      });

      await expect(createLoan(loanCore, user, terms)).to.be.revertedWith("LoanCore::create: Loan is already expired");
    });

    it("should fail to create a loan with reused collateral", async () => {
      const { loanCore, mockERC20, mockAssetWrapper, user } = await setupTestContext();
      const collateralTokenId = await mintERC721(mockAssetWrapper, user);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId });

      await createLoan(loanCore, user, terms);

      await expect(createLoan(loanCore, user, terms)).to.be.revertedWith(
        "LoanCore::create: Collateral token already in use",
      );
    });

    it("should fail when paused", async () => {
      const { loanCore, mockERC20, mockAssetWrapper, user } = await setupTestContext();
      const collateralTokenId = await mintERC721(mockAssetWrapper, user);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId });

      await loanCore.connect(user).pause();

      await expect(loanCore.connect(user).createLoan(terms)).to.be.revertedWith("Pausable: paused");
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const { loanCore, mockERC20, mockAssetWrapper, user } = await setupTestContext();
      const collateralTokenId = await mintERC721(mockAssetWrapper, user);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId });

      const tx = await loanCore.connect(user).createLoan(terms);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("197208");
    });
  });

  describe("Start Loan", function () {
    interface StartLoanState extends TestContext {
      loanId: BigNumber;
      terms: LoanTerms;
      borrower: Signer;
      lender: Signer;
    }

    const setupLoan = async (context?: TestContext, inputTerms?: Partial<LoanTerms>): Promise<StartLoanState> => {
      context = context || (await setupTestContext());

      const { mockAssetWrapper, mockERC20, loanCore, user: borrower, other: lender } = context;
      const collateralTokenId = await mintERC721(mockAssetWrapper, borrower);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId, ...inputTerms });
      const loanId = await createLoan(loanCore, borrower, terms);
      return { ...context, loanId, terms, borrower, lender };
    };

    it("should successfully start a loan", async () => {
      const {
        mockLenderNote,
        mockBorrowerNote,
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan();
      const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
      const loanCoreBalanceBefore = await mockERC20.balanceOf(loanCore.address);

      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());

      const fee = principal.mul(3).div(100);
      const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
      expect(borrowerBalanceAfter.sub(borrowerBalanceBefore)).to.equal(principal.sub(fee));
      const loanCoreBalanceAfter = await mockERC20.balanceOf(loanCore.address);
      expect(loanCoreBalanceAfter.sub(loanCoreBalanceBefore)).to.equal(fee);

      const storedLoanData = await loanCore.getLoan(loanId);
      expect(storedLoanData.state).to.equal(LoanState.Active);
      expect(await mockLenderNote.ownerOf(storedLoanData.lenderNoteId)).to.equal(await lender.getAddress());
      expect(await mockBorrowerNote.ownerOf(storedLoanData.borrowerNoteId)).to.equal(await borrower.getAddress());
    });

    it("should successfully set fee controller and use new fee", async () => {
      const {
        mockLenderNote,
        mockBorrowerNote,
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan();
      const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
      const loanCoreBalanceBefore = await mockERC20.balanceOf(loanCore.address);
      const feeController = <FeeController>await deploy("FeeController", borrower, []);
      // set the fee to 1%
      await feeController.connect(borrower).setOriginationFee(100);
      await loanCore.setFeeController(feeController.address);

      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());

      // ensure the 1% fee was used
      const fee = principal.mul(1).div(100);
      const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
      expect(borrowerBalanceAfter.sub(borrowerBalanceBefore)).to.equal(principal.sub(fee));
      const loanCoreBalanceAfter = await mockERC20.balanceOf(loanCore.address);
      expect(loanCoreBalanceAfter.sub(loanCoreBalanceBefore)).to.equal(fee);

      const storedLoanData = await loanCore.getLoan(loanId);
      expect(storedLoanData.state).to.equal(LoanState.Active);
      expect(await mockLenderNote.ownerOf(storedLoanData.lenderNoteId)).to.equal(await lender.getAddress());
      expect(await mockBorrowerNote.ownerOf(storedLoanData.borrowerNoteId)).to.equal(await borrower.getAddress());
    });

    it("should successfully start two loans back to back", async () => {
      const context = await setupTestContext();
      const { mockAssetWrapper, loanCore, mockERC20 } = context;
      let {
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan(context);

      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());

      ({
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan(context));

      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());
    });

    it("should fail to start two loans where principal for both is paid at once", async () => {
      const context = await setupTestContext();
      const { mockAssetWrapper, loanCore, mockERC20 } = context;
      let {
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan(context);

      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());

      ({
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan(context));
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      // fails because the full input from the first loan was factored into the stored contract balance
      await expect(
        loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId),
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("rejects calls from non-originator", async () => {
      const { loanCore, user: borrower, other: lender } = await setupLoan();
      const loanId = BigNumber.from("123412341324");
      await expect(
        loanCore.connect(lender).startLoan(await borrower.getAddress(), await lender.getAddress(), loanId),
      ).to.be.revertedWith(
        `AccessControl: account ${(await lender.getAddress()).toLowerCase()} is missing role ${ORIGINATOR_ROLE}`,
      );
    });

    it("should fail to start a loan that is not created", async () => {
      const { loanCore, user: borrower, other: lender } = await setupLoan();
      const loanId = BigNumber.from("123412341324");
      await expect(
        loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId),
      ).to.be.revertedWith("LoanCore::start: Invalid loan state");
    });

    it("should fail to start a loan that is already started", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan();

      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId);
      await expect(
        loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId),
      ).to.be.revertedWith("LoanCore::start: Invalid loan state");
    });

    it("should fail to start a loan that is repaid", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, interest, principal },
        borrower,
        lender,
      } = await setupLoan();
      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId);
      await mockERC20.connect(borrower).mint(await borrower.getAddress(), principal.add(interest));
      await mockERC20.connect(borrower).approve(loanCore.address, principal.add(interest));

      await loanCore.connect(borrower).repay(loanId);

      await expect(
        loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId),
      ).to.be.revertedWith("LoanCore::start: Invalid loan state");
    });

    it("should fail to start a loan that is already claimed", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, interest, principal },
        borrower,
        lender,
      } = await setupLoan(undefined, { durationSecs: 1000 });
      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId);
      await mockERC20.connect(borrower).mint(loanCore.address, principal.add(interest));

      await blockchainTime.increaseTime(1001);

      await loanCore.connect(borrower).claim(loanId);
      await expect(
        loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId),
      ).to.be.revertedWith("LoanCore::start: Invalid loan state");
    });

    it("should fail to start a loan if collateral has not been sent", async () => {
      const { loanCore, loanId, borrower, lender } = await setupLoan();
      await expect(
        loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId),
      ).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");
    });

    it("should fail to start a loan if lender did not deposit", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        loanId,
        terms: { collateralTokenId },
        borrower,
        lender,
      } = await setupLoan();
      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await expect(
        loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId),
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should fail to start a loan if lender did not deposit enough", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan();
      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal.sub(1));
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await expect(
        loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId),
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should fail when paused", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan();

      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), loanCore.address, collateralTokenId);
      await mockERC20.connect(lender).mint(loanCore.address, principal);

      await loanCore.connect(borrower).pause();
      await expect(
        loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId),
      ).to.be.revertedWith("Pausable: paused");
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan();

      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      const tx = await loanCore
        .connect(borrower)
        .startLoan(await lender.getAddress(), await borrower.getAddress(), loanId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("469292");
    });
  });

  describe("Repay Loan", function () {
    interface RepayLoanState extends TestContext {
      loanId: BigNumber;
      terms: LoanTerms;
      borrower: Signer;
      lender: Signer;
    }

    const setupLoan = async (context?: TestContext, inputTerms?: Partial<LoanTerms>): Promise<RepayLoanState> => {
      context = context || (await setupTestContext());

      const { mockAssetWrapper, mockERC20, loanCore, user: borrower, other: lender } = context;
      const collateralTokenId = await mintERC721(mockAssetWrapper, borrower);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId, ...inputTerms });
      const loanId = await createLoan(loanCore, borrower, terms);
      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), terms.principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), terms.principal);
      await mockERC20.connect(borrower).approve(loanCore.address, terms.principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());

      return { ...context, loanId, terms, borrower, lender };
    };

    it("should successfully repay loan", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(await borrower.getAddress(), terms.principal.add(terms.interest));
      await mockERC20.connect(borrower).approve(loanCore.address, terms.principal.add(terms.interest));
      await expect(loanCore.connect(borrower).repay(loanId)).to.emit(loanCore, "LoanRepaid").withArgs(loanId);
    });

    it("rejects calls from non-repayer", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, other, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.add(terms.interest));

      await expect(loanCore.connect(other).repay(loanId)).to.be.revertedWith(
        `AccessControl: account ${(await other.getAddress()).toLowerCase()} is missing role ${REPAYER_ROLE}`,
      );
    });

    it("should update repayer address and work with new one", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, other, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(await borrower.getAddress(), terms.principal.add(terms.interest));
      await mockERC20.connect(borrower).transfer(await other.getAddress(), terms.principal.add(terms.interest));
      await mockERC20.connect(other).approve(loanCore.address, terms.principal.add(terms.interest));
      await loanCore.grantRole(REPAYER_ROLE, await other.getAddress());
      await expect(loanCore.connect(other).repay(loanId)).to.emit(loanCore, "LoanRepaid").withArgs(loanId);
    });

    it("should fail if the loan does not exist", async () => {
      const { loanCore, user: borrower } = await setupLoan();
      const loanId = BigNumber.from("123412341324");
      await expect(loanCore.connect(borrower).repay(loanId)).to.be.revertedWith("LoanCore::repay: Invalid loan state");
    });

    it("should fail if the loan is not active", async () => {
      const { mockAssetWrapper, loanCore, user: borrower, terms } = await setupLoan();
      const collateralTokenId = await mintERC721(mockAssetWrapper, borrower);
      terms.collateralTokenId = collateralTokenId;
      const loanId = await createLoan(loanCore, borrower, terms);
      await expect(loanCore.connect(borrower).repay(loanId)).to.be.revertedWith("LoanCore::repay: Invalid loan state");
    });

    it("should fail if the loan is already repaid", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(await borrower.getAddress(), terms.principal.add(terms.interest));
      await mockERC20.connect(borrower).approve(loanCore.address, terms.principal.add(terms.interest));

      await loanCore.connect(borrower).repay(loanId);
      await expect(loanCore.connect(borrower).repay(loanId)).to.be.revertedWith("LoanCore::repay: Invalid loan state");
    });

    it("should fail if the loan is already claimed", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan(undefined, {
        durationSecs: 1000,
      });
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.add(terms.interest));

      await blockchainTime.increaseTime(1001);

      await loanCore.connect(borrower).claim(loanId);
      await expect(loanCore.connect(borrower).repay(loanId)).to.be.revertedWith("LoanCore::repay: Invalid loan state");
    });

    it("should fail if the debt was not repaid", async () => {
      const { loanId, loanCore, user: borrower } = await setupLoan();

      await expect(loanCore.connect(borrower).repay(loanId)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance",
      );
    });

    it("should fail if the debt was not repaid in full", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.sub(1));

      await expect(loanCore.connect(borrower).repay(loanId)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance",
      );
    });

    it("should fail if the interest was not paid in full", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.add(terms.interest).sub(1));

      await expect(loanCore.connect(borrower).repay(loanId)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance",
      );
    });

    it("should still work when paused", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(await borrower.getAddress(), terms.principal.add(terms.interest));
      await mockERC20.connect(borrower).approve(loanCore.address, terms.principal.add(terms.interest));
      await expect(loanCore.connect(borrower).repay(loanId)).to.emit(loanCore, "LoanRepaid").withArgs(loanId);
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(await borrower.getAddress(), terms.principal.add(terms.interest));
      await mockERC20.connect(borrower).approve(loanCore.address, terms.principal.add(terms.interest));
      const tx = await loanCore.connect(borrower).repay(loanId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("130339");
    });
  });

  describe("Claim Loan", async function () {
    interface RepayLoanState extends TestContext {
      loanId: BigNumber;
      terms: LoanTerms;
      borrower: Signer;
      lender: Signer;
    }

    const setupLoan = async (context?: TestContext, inputTerms?: Partial<LoanTerms>): Promise<RepayLoanState> => {
      context = context || (await setupTestContext());

      const { mockAssetWrapper, mockERC20, loanCore, user: borrower, other: lender } = context;
      const collateralTokenId = await mintERC721(mockAssetWrapper, borrower);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId, ...inputTerms });
      const loanId = await createLoan(loanCore, borrower, terms);
      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), terms.principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), terms.principal);
      await mockERC20.connect(borrower).approve(loanCore.address, terms.principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());

      return { ...context, loanId, terms, borrower, lender };
    };

    it("should successfully claim loan", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan(undefined, {
        durationSecs: 1000,
      });
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.add(terms.interest));

      await blockchainTime.increaseTime(1001);

      await expect(loanCore.connect(borrower).claim(loanId)).to.emit(loanCore, "LoanClaimed").withArgs(loanId);
    });

    it("Rejects calls from non-repayer", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, other, terms } = await setupLoan(undefined, {
        durationSecs: 1000,
      });
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.add(terms.interest));
      await blockchainTime.increaseTime(1001);

      await expect(loanCore.connect(other).claim(loanId)).to.be.revertedWith(
        `AccessControl: account ${(await other.getAddress()).toLowerCase()} is missing role ${REPAYER_ROLE}`,
      );
    });

    it("should fail if loan doesnt exist", async () => {
      const { loanCore, user: borrower } = await setupLoan();
      const loanId = BigNumber.from("123412341324");
      await expect(loanCore.connect(borrower).claim(loanId)).to.be.revertedWith("LoanCore::claim: Invalid loan state");
    });

    it("should fail if the loan is not active", async () => {
      const { mockAssetWrapper, loanCore, user: borrower, terms } = await setupLoan();
      const collateralTokenId = await mintERC721(mockAssetWrapper, borrower);
      terms.collateralTokenId = collateralTokenId;
      const loanId = await createLoan(loanCore, borrower, terms);
      await expect(loanCore.connect(borrower).claim(loanId)).to.be.revertedWith("LoanCore::claim: Invalid loan state");
    });

    it("should fail if the loan is already repaid", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(await borrower.getAddress(), terms.principal.add(terms.interest));
      await mockERC20.connect(borrower).approve(loanCore.address, terms.principal.add(terms.interest));

      await loanCore.connect(borrower).repay(loanId);
      await expect(loanCore.connect(borrower).claim(loanId)).to.be.revertedWith("LoanCore::claim: Invalid loan state");
    });

    it("should fail if the loan is already claimed", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan(undefined, {
        durationSecs: 1000,
      });
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.add(terms.interest));

      await blockchainTime.increaseTime(1001);

      await loanCore.connect(borrower).claim(loanId);
      await expect(loanCore.connect(borrower).claim(loanId)).to.be.revertedWith("LoanCore::claim: Invalid loan state");
    });

    it("should fail if the loan is not expired", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan();
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.add(terms.interest));

      await expect(loanCore.connect(borrower).claim(loanId)).to.be.revertedWith("LoanCore::claim: Loan not expired");
    });

    it("should fail when paused", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan(undefined, {
        durationSecs: 1000,
      });
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.add(terms.interest));

      await blockchainTime.increaseTime(1001);

      await loanCore.connect(borrower).pause();
      await expect(loanCore.connect(borrower).claim(loanId)).to.be.revertedWith("Pausable: paused");
    });

    it("gas [ @skip-on-coverage ]", async () => {
      const { mockERC20, loanId, loanCore, user: borrower, terms } = await setupLoan(undefined, {
        durationSecs: 1000,
      });
      await mockERC20.connect(borrower).mint(loanCore.address, terms.principal.add(terms.interest));

      await blockchainTime.increaseTime(1001);

      const tx = await loanCore.connect(borrower).claim(loanId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      expect(gasUsed.toString()).to.equal("105236");
    });
  });

  describe("Claim fees", async () => {
    interface StartLoanState extends TestContext {
      loanId: BigNumber;
      terms: LoanTerms;
      borrower: Signer;
      lender: Signer;
    }

    const setupLoan = async (context?: TestContext, inputTerms?: Partial<LoanTerms>): Promise<StartLoanState> => {
      context = context || (await setupTestContext());

      const { mockAssetWrapper, mockERC20, loanCore, user: borrower, other: lender } = context;
      const collateralTokenId = await mintERC721(mockAssetWrapper, borrower);
      const terms = createLoanTerms(mockERC20.address, { collateralTokenId, ...inputTerms });
      const loanId = await createLoan(loanCore, borrower, terms);
      return { ...context, loanId, terms, borrower, lender };
    };

    it("should successfully claim fees", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan();

      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());

      const fee = principal.mul(3).div(100);
      expect(await mockERC20.balanceOf(loanCore.address)).to.equal(fee);
      await expect(loanCore.connect(borrower).claimFees(mockERC20.address))
        .to.emit(loanCore, "FeesClaimed")
        .withArgs(mockERC20.address, await borrower.getAddress(), fee);
      expect(await mockERC20.balanceOf(loanCore.address)).to.equal(0);
    });

    it("should fail for anyone other than the admin", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan();

      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());

      const fee = principal.mul(3).div(100);
      expect(await mockERC20.balanceOf(loanCore.address)).to.equal(fee);
      await expect(loanCore.connect(lender).claimFees(mockERC20.address)).to.be.revertedWith(
        `AccessControl: account ${(await lender.getAddress()).toLowerCase()} is missing role ${CLAIM_FEES_ROLE}`,
      );
    });

    it("only fee claimer should be able to change fee claimer", async () => {
      const {
        mockAssetWrapper,
        loanCore,
        mockERC20,
        loanId,
        terms: { collateralTokenId, principal },
        borrower,
        lender,
      } = await setupLoan();

      // run originator controller logic inline then invoke loanCore
      // borrower is originator with originator role
      await mockAssetWrapper
        .connect(borrower)
        .transferFrom(await borrower.getAddress(), await borrower.getAddress(), collateralTokenId);
      await mockAssetWrapper.connect(borrower).approve(loanCore.address, collateralTokenId);

      await mockERC20.connect(lender).mint(await lender.getAddress(), principal);
      await mockERC20.connect(lender).transfer(await borrower.getAddress(), principal);
      await mockERC20.connect(borrower).approve(loanCore.address, principal);

      await expect(loanCore.connect(borrower).startLoan(await lender.getAddress(), await borrower.getAddress(), loanId))
        .to.emit(loanCore, "LoanStarted")
        .withArgs(loanId, await lender.getAddress(), await borrower.getAddress());

      await loanCore.connect(borrower).grantRole(CLAIM_FEES_ROLE, await lender.getAddress());
      await loanCore.connect(borrower).revokeRole(CLAIM_FEES_ROLE, await borrower.getAddress());
      await expect(
        loanCore.connect(borrower).grantRole(CLAIM_FEES_ROLE, await borrower.getAddress()),
      ).to.be.revertedWith(
        `AccessControl: account ${(await borrower.getAddress()).toLowerCase()} is missing role ${CLAIM_FEES_ROLE}`,
      );
    });
  });
});
