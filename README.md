# Installment Loans

This branch serves the purpose of research and development of how installment loans will be implemented in to the LoanCoreV2 contracts. These contracts will be ported over into loans-v2 repository when it has been setup.

## ⏰ Current Status

`LoanTerms` and `LoanData` structs have been updated in the `LoanLibrary` to reflect changes needed for installment loans. The smart contract functions have been updated accordingly to accept these changes.

Second, in V2 the interested rate in the `LoanTerms` is to be entered as a rate. For implementing this, we have decided to start the rate as a total interest period rate. For example, a one year loan with 10% APR, would be entered as (1000) * 10^18. The minimum interest rate allowed is 0.01% or (1) * 10^18.

Interest Rate Formula:
`principal + ((principal * (interest / INTEREST_DENOMINATOR))/BASIS_POINTS_DENOMINATOR));`

where `INTEREST_DENOMINATOR = 1*10**18` and `BASIS_POINTS_DENOMINATOR = 10000`

All tests except ones related to FlashLoans/ FlashRollovers are passing in the bootstrap scripts. Two new test scripts have been added `Installments.ts` and `installmentsRepay.ts`.

🔑 For Installment tests, run `npx hardhat test test/Installments.ts` or `npx hardhat test test/InstallmentsRepay.ts`.

## Deploying

In order to deploy the contracts to a local hardhat instance run the deploy script.

`yarn hardhat run scripts/deploy.ts`

The same can be done for non-local instances like Rinkeby or Mainnet, but a private key for the address to deploy from must be supplied in `hardhat.config.ts`.

## Local Development

In one window, start a node. Wait for it to load. This is a local Ethereum node forked from the current mainnet Ethereum state.

`npx hardhat node`

In another window run the bootstrap script with or without loans created.

`yarn bootstrap-with-loans`
or
`yarn bootstrap-no-loans`

Both will deploy our smart contracts, create a collection of ERC20 and ERC721/ERC1155 NFTs, and distribute them amongst the first 5 signers, skipping the first one since it deploys the smart contract. The second target will also wrap assets, and create loans.

## Testing

Run `yarn test` or `npx hardhat test` to perform all the test scripts in the test folder. Contracts are always compiled prior to testing if changes have been made to them.

For specific test scripts run the following:

```
npx hardhat test test/Installments.ts
npx hardhat test test/LoanCoreV2.ts
npx hardhat test test/AssetWrapper.ts
// etc...
```

### Foundry Notes
Install Rust, Cargo, Foundry: https://book.getfoundry.sh/getting-started/installation.html

Notice new test folder `foundry-tests` here tests are written in solidity and executed against deployed contracts similar to how smart contracts interact in the wild.

Room for Improvement:
The `foundry-tests` folder cannot be in the contracts folder for the `npx hardhat compile` command to run successfully.

In order to run `forge test` or ` forge build` or any forge commands, you must comment out all hardhat console log commands from the other contracts.

Cool out-of-the-box features include deploying from command line, fuzz testing, cheat-codes, and more!
