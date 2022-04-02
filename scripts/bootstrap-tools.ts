import { ethers } from "hardhat";
import { LoanTerms } from "../test/utils/types";
import { createLoanTermsSignature } from "../test/utils/eip712";
import { Contract } from "ethers";
import { MockERC1155Metadata, MockERC20, MockERC721Metadata } from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

export const SECTION_SEPARATOR = "\n" + "=".repeat(80) + "\n";
export const SUBSECTION_SEPARATOR = "-".repeat(10);

export async function getBalance(asset: Contract, addr: string): Promise<string> {
    return (await asset.balanceOf(addr)).toString();
}

async function getBalanceERC1155(asset: Contract, id: number, addr: string): Promise<string> {
    return (await asset.balanceOf(addr, id)).toString();
}

export async function mintTokens(
    target: string,
    [wethAmount, pawnAmount, usdAmount]: [number, number, number],
    weth: MockERC20,
    pawnToken: MockERC20,
    usd: MockERC20,
): Promise<void> {
    await weth.mint(target, ethers.utils.parseEther(wethAmount.toString()));
    await pawnToken.mint(target, ethers.utils.parseEther(pawnAmount.toString()));
    await usd.mint(target, ethers.utils.parseUnits(usdAmount.toString(), 6));
}

export async function mintNFTs(
    target: string,
    [numPunks, numArts, numBeats0, numBeats1]: [number, number, number, number],
    punks: MockERC721Metadata,
    art: MockERC721Metadata,
    beats: MockERC1155Metadata,
): Promise<void> {
    let j = 1;

    for (let i = 0; i < numPunks; i++) {
        await punks["mint(address,string)"](
            target,
            `https://s3.amazonaws.com/images.pawn.fi/test-nft-metadata/PawnFiPunks/nft-${j++}.json`,
        );
    }

    for (let i = 0; i < numArts; i++) {
        await art["mint(address,string)"](
            target,
            `https://s3.amazonaws.com/images.pawn.fi/test-nft-metadata/PawnArtIo/nft-${j++}.json`,
        );
    }

    const uris = [
        `https://s3.amazonaws.com/images.pawn.fi/test-nft-metadata/PawnBeats/nft-${j++}.json`,
        `https://s3.amazonaws.com/images.pawn.fi/test-nft-metadata/PawnBeats/nft-${j++}.json`,
    ];

    for (let i = 0; i < numBeats0; i++) {
      const mod = i % 2;
      if (mod === 0) {
        console.log(`Sending 2 tokens to ${target}`);
        // Always send 2 at once.
        await beats["mint(address,uint256,string)"](
          target,
          2,
          `https://s3.amazonaws.com/images.pawn.fi/test-nft-metadata/PawnBeats/nft-${j++}.json`,
        );
      } else {
        // Send only 1.
        console.log(`Sending 1 token to ${target}`);
        await beats["mint(address,uint256,string)"](
          target,
          1,
          `https://s3.amazonaws.com/images.pawn.fi/test-nft-metadata/PawnBeats/nft-${j++}.json`,
        );
      }
    }

    await beats.mintBatch(target, [0, 1], [numBeats0, numBeats1], uris, "0x00")
}

export async function mintAndDistribute(
    signers: SignerWithAddress[],
    weth: MockERC20,
    pawnToken: MockERC20,
    usd: MockERC20,
    punks: MockERC721Metadata,
    art: MockERC721Metadata,
    beats: MockERC1155Metadata,
    mockLendingPoolAddress: string,
): Promise<void> {
    // Give a bunch of everything to signer[0]
    await mintTokens(signers[0].address, [1000, 500000, 2000000], weth, pawnToken, usd);
    await mintNFTs(signers[0].address, [20, 20, 20, 20], punks, art, beats);

    // Give a mix to signers[1] through signers[5]
    await mintTokens(signers[1].address, [0, 2000, 10000], weth, pawnToken, usd);
    await mintNFTs(signers[1].address, [5, 0, 2, 1], punks, art, beats);
    // Give some tokens to the MockLendingPool for rollovers
    await mintTokens(mockLendingPoolAddress, [5, 10000, 0], weth, pawnToken, usd);
    await mintTokens(signers[2].address, [450, 350.5, 5000], weth, pawnToken, usd);
    await mintNFTs(signers[2].address, [0, 0, 1, 0], punks, art, beats);

    await mintTokens(signers[3].address, [2, 50000, 7777], weth, pawnToken, usd);
    await mintNFTs(signers[3].address, [10, 3, 7, 0], punks, art, beats);

    await mintTokens(signers[4].address, [50, 2222.2, 12.1], weth, pawnToken, usd);
    await mintNFTs(signers[4].address, [1, 12, 1, 6], punks, art, beats);

    console.log("Initial balances:");
    for (const i in signers) {
        const signer = signers[i];
        const { address: signerAddr } = signer;

        console.log(SUBSECTION_SEPARATOR);
        console.log(`Signer ${i}: ${signerAddr}`);
        console.log("PawnPunks balance:", await getBalance(punks, signerAddr));
        console.log("PawnArt balance:", await getBalance(art, signerAddr));
        console.log("PawnBeats Edition 0 balance:", await getBalanceERC1155(beats, 0, signerAddr));
        console.log("PawnBeats Edition 1 balance:", await getBalanceERC1155(beats, 1, signerAddr));
        console.log("ETH balance:", (await signer.getBalance()).toString());
        console.log("WETH balance:", await getBalance(weth, signerAddr));
        console.log("PAWN balance:", await getBalance(pawnToken, signerAddr));
        console.log("PUSD balance:", await getBalance(usd, signerAddr));
    }
    console.log(SUBSECTION_SEPARATOR);
    console.log("MockLendingPool WETH balance: ", await getBalance(weth, mockLendingPoolAddress));
    console.log("MockLendingPool PAWN balance: ", await getBalance(pawnToken, mockLendingPoolAddress));
}

interface DeployedNFT {
    punks: MockERC721Metadata;
    art: MockERC721Metadata;
    beats: MockERC1155Metadata;
    weth: MockERC20;
    pawnToken: MockERC20;
    usd: MockERC20;
}

export async function deployNFTs(): Promise<DeployedNFT> {
    console.log("Deploying NFTs...\n");
    const erc721Factory = await ethers.getContractFactory("MockERC721Metadata");
    const erc1155Factory = await ethers.getContractFactory("MockERC1155Metadata");

    const punks = <MockERC721Metadata>await erc721Factory.deploy("PawnFiPunks", "PFPUNKS");
    console.log("(ERC721) PawnFiPunks deployed to:", punks.address);

    const art = <MockERC721Metadata>await erc721Factory.deploy("PawnArt.io", "PWART");
    console.log("(ERC721) PawnArt.io deployed to:", art.address);

    const beats = <MockERC1155Metadata>await erc1155Factory.deploy();
    console.log("(ERC1155) PawnBeats deployed to:", beats.address);

    // Deploy some ERC20s
    console.log(SECTION_SEPARATOR);
    console.log("Deploying Tokens...\n");
    const erc20Factory = await ethers.getContractFactory("ERC20PresetMinterPauser");
    const erc20WithDecimalsFactory = await ethers.getContractFactory("MockERC20WithDecimals");

    const weth = <MockERC20>await erc20Factory.deploy("Wrapped Ether", "WETH");
    console.log("(ERC20) WETH deployed to:", weth.address);

    const pawnToken = <MockERC20>await erc20Factory.deploy("PawnToken", "PAWN");
    console.log("(ERC20) PAWN deployed to:", pawnToken.address);

    const usd = <MockERC20>await erc20WithDecimalsFactory.deploy("USD Stablecoin", "PUSD", 6);
    console.log("(ERC20) PUSD deployed to:", usd.address);

    return { punks, art, beats, weth, pawnToken, usd };
}

export async function wrapAssetsAndMakeLoans(
    signers: SignerWithAddress[],
    assetWrapper: Contract,
    originationController: Contract,
    borrowerNote: Contract,
    repaymentController: Contract,
    punks: MockERC721Metadata,
    usd: MockERC20,
    beats: MockERC1155Metadata,
    weth: MockERC20,
    art: MockERC721Metadata,
    pawnToken: MockERC20,
): Promise<void> {
    const signer1 = signers[1];
    const aw1 = await assetWrapper.connect(signer1);

    // Deposit 1 punk and 1000 usd for bundle 1
    await aw1.initializeBundle(signer1.address);
    const aw1Bundle1Id = await aw1.tokenOfOwnerByIndex(signer1.address, 0);
    const aw1Punk1Id = await punks.tokenOfOwnerByIndex(signer1.address, 0);

    await punks.connect(signer1).approve(aw1.address, aw1Punk1Id);
    await aw1.depositERC721(punks.address, aw1Punk1Id, aw1Bundle1Id);

    await usd.connect(signer1).approve(aw1.address, ethers.utils.parseUnits("1000", 6));
    await aw1.depositERC20(usd.address, ethers.utils.parseUnits("1000", 6), aw1Bundle1Id);
    console.log(`(Bundle 1) Signer ${signer1.address} created a bundle with 1 PawnFiPunk and 1000 PUSD`);

    // Deposit 1 punk and 2 beats edition 0 for bundle 2
    await aw1.initializeBundle(signer1.address);
    const aw1Bundle2Id = await aw1.tokenOfOwnerByIndex(signer1.address, 1);
    const aw1Punk2Id = await punks.tokenOfOwnerByIndex(signer1.address, 1);

    await punks.connect(signer1).approve(aw1.address, aw1Punk2Id);
    await aw1.depositERC721(punks.address, aw1Punk2Id, aw1Bundle2Id);

    await beats.connect(signer1).setApprovalForAll(aw1.address, true);
    await aw1.depositERC1155(beats.address, 0, 2, aw1Bundle2Id);
    console.log(`(Bundle 2) Signer ${signer1.address} created a bundle with 1 PawnFiPunk ands 2 PawnBeats Edition 0`);

    const signer3 = signers[3];
    const aw3 = await assetWrapper.connect(signer3);

    // Deposit 2 punks and 1 weth for bundle 1
    await aw3.initializeBundle(signer3.address);
    const aw3Bundle1Id = await aw3.tokenOfOwnerByIndex(signer3.address, 0);
    const aw3Punk1Id = await punks.tokenOfOwnerByIndex(signer3.address, 0);
    const aw3Punk2Id = await punks.tokenOfOwnerByIndex(signer3.address, 1);

    await punks.connect(signer3).approve(aw3.address, aw3Punk1Id);
    await punks.connect(signer3).approve(aw3.address, aw3Punk2Id);
    await aw3.depositERC721(punks.address, aw3Punk1Id, aw3Bundle1Id);
    await aw3.depositERC721(punks.address, aw3Punk2Id, aw3Bundle1Id);

    await weth.connect(signer3).approve(aw3.address, ethers.utils.parseEther("1"));
    await aw3.depositERC20(weth.address, ethers.utils.parseEther("1"), aw3Bundle1Id);
    console.log(`(Bundle 3) Signer ${signer3.address} created a bundle with 2 PawnFiPunks and 1 WETH`);

    // Deposit 1 punk for bundle 2
    await aw3.initializeBundle(signer3.address);
    const aw3Bundle2Id = await aw3.tokenOfOwnerByIndex(signer3.address, 1);
    const aw3Punk3Id = await punks.tokenOfOwnerByIndex(signer3.address, 2);

    await punks.connect(signer3).approve(aw3.address, aw3Punk3Id);
    await aw3.depositERC721(punks.address, aw3Punk3Id, aw3Bundle2Id);
    console.log(`(Bundle 4) Signer ${signer3.address} created a bundle with 1 PawnFiPunk`);

    // Deposit 1 art, 4 beats edition 0, and 2000 usd for bundle 3
    await aw3.initializeBundle(signer3.address);
    const aw3Bundle3Id = await aw3.tokenOfOwnerByIndex(signer3.address, 2);
    const aw3Art1Id = await art.tokenOfOwnerByIndex(signer3.address, 0);

    await art.connect(signer3).approve(aw3.address, aw3Art1Id);
    await aw3.depositERC721(art.address, aw3Art1Id, aw3Bundle3Id);

    await beats.connect(signer3).setApprovalForAll(aw3.address, true);
    await aw3.depositERC1155(beats.address, 0, 4, aw3Bundle3Id);

    await usd.connect(signer3).approve(aw3.address, ethers.utils.parseUnits("2000", 6));
    await aw3.depositERC20(usd.address, ethers.utils.parseUnits("2000", 6), aw3Bundle3Id);
    console.log(
        `(Bundle 5) Signer ${signer3.address} created a bundle with 1 PawnArt, 4 PawnBeats Edition 0, and 2000 PUSD`,
    );

    const signer4 = signers[4];
    const aw4 = await assetWrapper.connect(signer4);

    // Deposit 3 arts and 1000 pawn for bundle 1
    await aw4.initializeBundle(signer4.address);
    const aw4Bundle1Id = await aw4.tokenOfOwnerByIndex(signer4.address, 0);
    const aw4Art1Id = await art.tokenOfOwnerByIndex(signer4.address, 0);
    const aw4Art2Id = await art.tokenOfOwnerByIndex(signer4.address, 1);
    const aw4Art3Id = await art.tokenOfOwnerByIndex(signer4.address, 2);

    await art.connect(signer4).approve(aw4.address, aw4Art1Id);
    await art.connect(signer4).approve(aw4.address, aw4Art2Id);
    await art.connect(signer4).approve(aw4.address, aw4Art3Id);
    await aw4.depositERC721(art.address, aw4Art1Id, aw4Bundle1Id);
    await aw4.depositERC721(art.address, aw4Art2Id, aw4Bundle1Id);
    await aw4.depositERC721(art.address, aw4Art3Id, aw4Bundle1Id);

    await pawnToken.connect(signer4).approve(aw4.address, ethers.utils.parseEther("1000"));
    await aw4.depositERC20(pawnToken.address, ethers.utils.parseEther("1000"), aw4Bundle1Id);
    console.log(`(Bundle 6) Signer ${signer4.address} created a bundle with 4 PawnArts and 1000 PAWN`);

    // Deposit 1 punk and 1 beats edition 1 for bundle 2
    await aw4.initializeBundle(signer4.address);
    const aw4Bundle2Id = await aw3.tokenOfOwnerByIndex(signer4.address, 1);
    const aw4Punk1Id = await punks.tokenOfOwnerByIndex(signer4.address, 0);

    await punks.connect(signer4).approve(aw4.address, aw4Punk1Id);
    await aw4.depositERC721(punks.address, aw4Punk1Id, aw4Bundle2Id);

    await beats.connect(signer4).setApprovalForAll(aw4.address, true);
    await aw4.depositERC1155(beats.address, 1, 1, aw4Bundle2Id);
    console.log(`(Bundle 7) Signer ${signer4.address} created a bundle with 1 PawnFiPunk and 1 PawnBeats Edition 1`);

    console.log(SECTION_SEPARATOR);
    console.log("Initializing loans...\n");

    // Start some loans
    const signer2 = signers[2];
    const oneDayMs = 1000 * 60 * 60 * 24;
    const oneWeekMs = oneDayMs * 7;
    const oneMonthMs = oneDayMs * 30;

    const relSecondsFromMs = (msToAdd: number) => Math.floor(msToAdd / 1000);

    // 1 will borrow from 2
    const loan1Terms: LoanTerms = {
        durationSecs: relSecondsFromMs(oneWeekMs),
        principal: ethers.utils.parseEther("10"),
        interest: ethers.utils.parseEther("1.5"),
        collateralTokenId: aw1Bundle1Id,
        payableCurrency: weth.address,
    };

    const {
        v: loan1V,
        r: loan1R,
        s: loan1S,
    } = await createLoanTermsSignature(originationController.address, "OriginationController", loan1Terms, signer1);

    await weth.connect(signer2).approve(originationController.address, ethers.utils.parseEther("10"));
    await assetWrapper.connect(signer1).approve(originationController.address, aw1Bundle1Id);

    // Borrower signed, so lender will initialize
    await originationController
        .connect(signer2)
        .initializeLoan(loan1Terms, signer1.address, signer2.address, loan1V, loan1R, loan1S);

    console.log(
        `(Loan 1) Signer ${signer1.address} borrowed 10 WETH at 15% interest from ${signer2.address} against Bundle 1`,
    );

    // 1 will borrow from 3
    const loan2Terms: LoanTerms = {
        durationSecs: relSecondsFromMs(oneWeekMs) - 10,
        principal: ethers.utils.parseEther("10000"),
        interest: ethers.utils.parseEther("500"),
        collateralTokenId: aw1Bundle2Id,
        payableCurrency: pawnToken.address,
    };

    const {
        v: loan2V,
        r: loan2R,
        s: loan2S,
    } = await createLoanTermsSignature(originationController.address, "OriginationController", loan2Terms, signer1);

    await pawnToken.connect(signer3).approve(originationController.address, ethers.utils.parseEther("10000"));
    await assetWrapper.connect(signer1).approve(originationController.address, aw1Bundle2Id);

    // Borrower signed, so lender will initialize
    await originationController
        .connect(signer3)
        .initializeLoan(loan2Terms, signer1.address, signer3.address, loan2V, loan2R, loan2S);

    console.log(
        `(Loan 2) Signer ${signer1.address} borrowed 10000 PAWN at 5% interest from ${signer3.address} against Bundle 2`,
    );

    // 3 will borrow from 2
    const loan3Terms: LoanTerms = {
        durationSecs: relSecondsFromMs(oneDayMs) - 10,
        principal: ethers.utils.parseUnits("1000", 6),
        interest: ethers.utils.parseUnits("80", 6),
        collateralTokenId: aw3Bundle1Id,
        payableCurrency: usd.address,
    };

    const {
        v: loan3V,
        r: loan3R,
        s: loan3S,
    } = await createLoanTermsSignature(originationController.address, "OriginationController", loan3Terms, signer3);

    await usd.connect(signer2).approve(originationController.address, ethers.utils.parseUnits("1000", 6));
    await assetWrapper.connect(signer3).approve(originationController.address, aw3Bundle1Id);

    // Borrower signed, so lender will initialize
    await originationController
        .connect(signer2)
        .initializeLoan(loan3Terms, signer3.address, signer2.address, loan3V, loan3R, loan3S);

    console.log(
        `(Loan 3) Signer ${signer3.address} borrowed 1000 PUSD at 8% interest from ${signer2.address} against Bundle 3`,
    );

    // 3 will open a second loan from 2
    const loan4Terms: LoanTerms = {
        durationSecs: relSecondsFromMs(oneMonthMs),
        principal: ethers.utils.parseUnits("1000", 6),
        interest: ethers.utils.parseUnits("140", 6),
        collateralTokenId: aw3Bundle2Id,
        payableCurrency: usd.address,
    };

    const {
        v: loan4V,
        r: loan4R,
        s: loan4S,
    } = await createLoanTermsSignature(originationController.address, "OriginationController", loan4Terms, signer3);

    await usd.connect(signer2).approve(originationController.address, ethers.utils.parseUnits("1000", 6));
    await assetWrapper.connect(signer3).approve(originationController.address, aw3Bundle2Id);

    // Borrower signed, so lender will initialize
    await originationController
        .connect(signer2)
        .initializeLoan(loan4Terms, signer3.address, signer2.address, loan4V, loan4R, loan4S);

    console.log(
        `(Loan 4) Signer ${signer3.address} borrowed 1000 PUSD at 14% interest from ${signer2.address} against Bundle 4`,
    );

    // 3 will also borrow from 4
    const loan5Terms: LoanTerms = {
        durationSecs: relSecondsFromMs(900000),
        principal: ethers.utils.parseEther("20"),
        interest: ethers.utils.parseEther("0.4"),
        collateralTokenId: aw3Bundle3Id,
        payableCurrency: weth.address,
    };

    const {
        v: loan5V,
        r: loan5R,
        s: loan5S,
    } = await createLoanTermsSignature(originationController.address, "OriginationController", loan5Terms, signer3);

    await weth.connect(signer4).approve(originationController.address, ethers.utils.parseEther("20"));
    await assetWrapper.connect(signer3).approve(originationController.address, aw3Bundle3Id);

    // Borrower signed, so lender will initialize
    await originationController
        .connect(signer4)
        .initializeLoan(loan5Terms, signer3.address, signer4.address, loan5V, loan5R, loan5S);

    console.log(
        `(Loan 5) Signer ${signer3.address} borrowed 20 WETH at 2% interest from ${signer4.address} against Bundle 5`,
    );

    // 4 will borrow from 2
    const loan6Terms: LoanTerms = {
        durationSecs: relSecondsFromMs(oneWeekMs),
        principal: ethers.utils.parseEther("300.33"),
        interest: ethers.utils.parseEther("18.0198"),
        collateralTokenId: aw4Bundle1Id,
        payableCurrency: pawnToken.address,
    };

    const {
        v: loan6V,
        r: loan6R,
        s: loan6S,
    } = await createLoanTermsSignature(originationController.address, "OriginationController", loan6Terms, signer4);

    await pawnToken.connect(signer2).approve(originationController.address, ethers.utils.parseEther("300.33"));
    await assetWrapper.connect(signer4).approve(originationController.address, aw4Bundle1Id);

    // Borrower signed, so lender will initialize
    await originationController
        .connect(signer2)
        .initializeLoan(loan6Terms, signer4.address, signer2.address, loan6V, loan6R, loan6S);

    console.log(
        `(Loan 6) Signer ${signer4.address} borrowed 300.33 PAWN at 6% interest from ${signer2.address} against Bundle 6`,
    );

    // Payoff a couple loans (not all)
    // Not setting up any claims because of timing issues.
    console.log(SECTION_SEPARATOR);
    console.log("Repaying (some) loans...\n");

    // 1 will pay off loan from 3
    const loan1BorrowerNoteId = await borrowerNote.tokenOfOwnerByIndex(signer1.address, 1);
    await pawnToken.connect(signer1).approve(repaymentController.address, ethers.utils.parseEther("10500"));
    await repaymentController.connect(signer1).repay(loan1BorrowerNoteId);

    console.log(`(Loan 2) Borrower ${signer1.address} repaid 10500 PAWN to ${signer3.address}`);

    // 3 will pay off one loan from 2
    const loan4BorrowerNoteId = await borrowerNote.tokenOfOwnerByIndex(signer3.address, 1);
    await usd.connect(signer3).approve(repaymentController.address, ethers.utils.parseUnits("1140", 6));
    await repaymentController.connect(signer3).repay(loan4BorrowerNoteId);

    console.log(`(Loan 4) Borrower ${signer3.address} repaid 1140 PUSD to ${signer2.address}`);

    console.log(SECTION_SEPARATOR);
    console.log("Reusing a bundle..\n");

    // 3 will open a new loan from 2, reusing the bundle
    const loan7Terms: LoanTerms = {
        durationSecs: relSecondsFromMs(oneMonthMs),
        principal: ethers.utils.parseUnits("500", 6),
        interest: ethers.utils.parseUnits("5", 6),
        collateralTokenId: aw3Bundle2Id,
        payableCurrency: usd.address,
    };

    const {
        v: loan7V,
        r: loan7R,
        s: loan7S,
    } = await createLoanTermsSignature(originationController.address, "OriginationController", loan7Terms, signer3);

    await usd.connect(signer2).approve(originationController.address, ethers.utils.parseUnits("1000", 6));
    await assetWrapper.connect(signer3).approve(originationController.address, aw3Bundle2Id);

    // Borrower signed, so lender will initialize
    await originationController
        .connect(signer2)
        .initializeLoan(loan7Terms, signer3.address, signer2.address, loan7V, loan7R, loan7S);

    console.log(
        `(Loan 7) Signer ${signer3.address} re-borrowed 500 PUSD at 5% interest from ${signer2.address} against Bundle 4`,
    );

    console.log(SECTION_SEPARATOR);
    console.log("Bootstrapping complete!");
    console.log(SECTION_SEPARATOR);
}
