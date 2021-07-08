# Solidity Template

My favourite setup for writing Solidity smart contracts.

- [Hardhat](https://github.com/nomiclabs/hardhat): compile and run the smart contracts on a local development network
- [TypeChain](https://github.com/ethereum-ts/TypeChain): generate TypeScript types for smart contracts
- [Ethers](https://github.com/ethers-io/ethers.js/): renowned Ethereum library and wallet implementation
- [Waffle](https://github.com/EthWorks/Waffle): tooling for writing comprehensive smart contract tests
- [Solhint](https://github.com/protofire/solhint): linter
- [Solcover](https://github.com/sc-forks/solidity-coverage) code coverage
- [Prettier Plugin Solidity](https://github.com/prettier-solidity/prettier-plugin-solidity): code formatter

This is a GitHub template, which means you can reuse it as many times as you want. You can do that by clicking the "Use this
template" button at the top of the page.

## Usage

### Pre Requisites

Before running any command, make sure to install dependencies:

```sh
$ yarn install
```

### Compile

Compile the smart contracts with Hardhat:

```sh
$ yarn compile
```

### TypeChain

Compile the smart contracts and generate TypeChain artifacts:

```sh
$ yarn typechain
```

### Lint Solidity

Lint the Solidity code:

```sh
$ yarn lint:sol
```

### Lint TypeScript

Lint the TypeScript code:

```sh
$ yarn lint:ts
```

### Test

Run the Mocha tests:

```sh
$ yarn test
```

### Coverage

Generate the code coverage report:

```sh
$ yarn coverage
```

### Report Gas

See the gas usage per unit test and average gas per method call:

```sh
$ REPORT_GAS=true yarn test
```

### Clean

Delete the smart contract artifacts, the coverage reports and the Hardhat cache:

```sh
$ yarn clean
```

## Syntax Highlighting

If you use VSCode, you can enjoy syntax highlighting for your Solidity code via the
[vscode-solidity](https://github.com/juanfranblanco/vscode-solidity) extension. The recommended approach to set the
compiler version is to add the following fields to your VSCode user settings:

```json
{
  "solidity.compileUsingRemoteVersion": "v0.8.3+commit.8d00100c",
  "solidity.defaultCompiler": "remote"
}
```

Where of course `v0.8.3+commit.8d00100c` can be replaced with any other version.

## Solidity Coverage Reporting

Solidity Coverage tracks which lines are hit during a test run by instrumenting your contracts and detecting their execution in a coverage-enabled EVM. Coverage reports are produced under ./coverage and configuration lives in .solcover.js.
[Solcover](https://github.com/sc-forks/solidity-coverage)

Run Coverage instrumentation:

```sh
$ yarn coverage
```

## Deploy

In order to deploy the contracts to a local hardhat instance, run `yarn hardhat run scripts/deploy.ts`.

The same can be done for non-local instances like Ropsten or Mainnet, but a private key for the address to deploy from must be supplied in `hardhat.config.ts` as specified in https://hardhat.org/config/.

## Local Development

1. In one window, run `npx hardhat node`. Wait for it to load
1. In another window run either `yarn bootstrap-no-loans` or `yarn bootstrap-with-loans`. Both will deploy our smart contracts, create a collection of ERC20 and ERC721/ERC1155 NFTs, and distribute them amongst the first 5 signers, skipping the first one since it deploys the smart contract. The second target will also wrap assets, and create loans.
