import { expect } from "chai";
import hre from "hardhat";
import { BigNumber, BigNumberish, Signer} from "ethers";
import { MockLoanCore, MockERC721, BorrowerNote } from "../typechain";
import { ZERO_ADDRESS } from "./utils/erc20";
import { deploy } from "./utils/contracts";

interface TestContext {
  borrowerNote: BorrowerNote;
  loanCore: MockLoanCore;
  mockAssetWrapper: MockERC721;
  user: Signer;
  other: Signer;
  signers: Signer[];
}

interface LoanTerms {
  dueDate: BigNumberish;
  principal: BigNumber;
  interest: BigNumber;
  collateralTokenId: BigNumber;
  payableCurrency: string;
}

describe("BorrowerNote", () => {

  const createLoanTerms = (
    payableCurrency: string,
    {
      dueDate = new Date(new Date().getTime() + 3600000).getTime(),
      principal = hre.ethers.utils.parseEther("100"),
      interest = hre.ethers.utils.parseEther("1"),
      collateralTokenId = BigNumber.from(1),
    }: Partial<LoanTerms> = {},
  ): LoanTerms => {
    return {
      dueDate,
      principal,
      interest,
      collateralTokenId,
      payableCurrency,
    };
  };

  const setupTestContext = async (): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();
    const mockAssetWrapper = <MockERC721>await deploy("MockERC721", signers[0], ["Mock AssetWrapper", "MA"]);
    const loanCore = <MockLoanCore>await deploy("MockLoanCore", signers[0], []);
    const borrowerNote = <BorrowerNote>(
      await deploy("BorrowerNote", signers[0], [loanCore.address, "BorrowerNote", "BN"])
    );

    return {
      borrowerNote,
      loanCore,
      mockAssetWrapper,
      user: signers[0],
      other: signers[1],
      signers: signers.slice(2),
    };
  };

  const createLoan = async (loanCore: MockLoanCore, user: Signer, terms: LoanTerms): Promise<BigNumber> => {
    const transaction = await loanCore.connect(user).createLoan(terms);
    const receipt = await transaction.wait();

    if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
      return receipt.events[0].args.loanId;
    } else {
      throw new Error("Unable to initialize loan");
    }
  };

  const mintBorrowerNote = async (borrowerNote: BorrowerNote, user: Signer): Promise<BigNumber> => {
    const transaction = await borrowerNote.mint(await user.getAddress());
    const receipt = await transaction.wait();

    if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
      return receipt.events[0].args.tokenId;
    } else {
      throw new Error("Unable to mint borrower note");
    }
  };

  describe("constructor", () => {
    it("Reverts if loanCore_ address is not provided", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();
      await expect(deploy("BorrowerNote", signers[0], ["BorrowerNote", "BN"])).to.be.reverted;
    });

    it("Reverts if loanCore_ address does not support loanCore interface", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();
      await expect(deploy("BorrowerNote", signers[0], [ZERO_ADDRESS, "BorrowerNote", "BN"])).to.be.reverted;
    });

    it("Creates a BorrowerNote", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();
      
      const loanCore = <MockLoanCore>(
        await deploy("MockLoanCore", signers[0], [])
      );

      const borrowerNote = <BorrowerNote>(
        await deploy("BorrowerNote", signers[0], [loanCore.address, "BorrowerNote", "BN"])
      );

      expect(borrowerNote).exist;
    });
  });

  describe("mint", () => {
    it("Reverts if sender is not loanCore", async () => {
      const { borrowerNote} = await setupTestContext();
      const transaction = borrowerNote.connect(ZERO_ADDRESS).mint(ZERO_ADDRESS);
      await expect(transaction).to.be.reverted;
    });

    it("Assigns a BorrowerNote NFT to the recipient", async () => {
      const { borrowerNote, user, other } = await setupTestContext();
      const transaction = await borrowerNote.connect(user).mint(await other.getAddress());
      const receipt = await transaction.wait();

      if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
        return expect(receipt.events[0]).exist;
      } else {
        throw new Error("Unable to mint borrower note");
      }
    });
  });

  describe("burn", () => {
    it("Reverts if loanCore attempts to burn active note", async () => {
      const { borrowerNote, loanCore, mockAssetWrapper, user } = await setupTestContext();
      const loanTerms = createLoanTerms(mockAssetWrapper.address);
      const loanId = await createLoan(loanCore, user, loanTerms);
      await expect(borrowerNote.burn(loanId)).to.be.reverted;
    });

    it("Reverts if sender does not own the note", async () => {
      const { borrowerNote, loanCore, mockAssetWrapper, user, other } = await setupTestContext();
      const loanTerms = createLoanTerms(mockAssetWrapper.address);
      await createLoan(loanCore, user, loanTerms);
      await expect(borrowerNote.connect(other).burn(ZERO_ADDRESS)).to.be.reverted;
    });

    it("Burns a LenderNote NFT", async () => {
      const { borrowerNote, loanCore, mockAssetWrapper, user} = await setupTestContext();
      const borrowerNoteId = await mintBorrowerNote(borrowerNote, user);
      const loanTerms = createLoanTerms(mockAssetWrapper.address);
      await createLoan(loanCore, user, loanTerms);
      expect(borrowerNote.connect(user).burn(borrowerNoteId));
    });
  });
});
