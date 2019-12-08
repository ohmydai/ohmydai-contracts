#!/usr/bin/env node
require('dotenv').config()
const program = require('commander')
const Web3 = require('web3')
const HDWalletProvider = require('@truffle/hdwallet-provider')
const uniswapFactoryAbi = require('./abis/uniswap-factory')
const uniswapExchangeAbi = require('./abis/uniswap-exchange')
const erc20Abi = require('./abis/erc20')

program
  .option('--network <name>', 'the name of the network', 'rinkeby')
  .requiredOption('--token <address>', 'the deployed token address')
  .requiredOption('--ethAmount <amount>', 'quantity of ETH added to liquidity')
  .requiredOption('--tokenAmount <amount>', 'quantity of tokens added to liquidity')
  .requiredOption('--gas <amount>', 'gas price', '10000000000') // 10 Gwei
  .parse(process.argv)

const provider = new HDWalletProvider(process.env.MNEMONIC, getProviderURL(program.network), process.env.ADDRESS_INDEX)
const web3 = new Web3(provider)

;(async function main () {
  try {
    console.log(`Using network: ${program.network}\n`)

    const tokenContract = new web3.eth.Contract(erc20Abi, program.token)
    const symbol = await tokenContract.methods.symbol().call().then(amendByteString)
    const logBalance = createBalanceLogger(tokenContract)

    await logBalance(process.env.FROM_ADDRESS, 'Owned balance')

    const factoryContract = new web3.eth.Contract(uniswapFactoryAbi, getFactoryAddress())
    let exchangeAddress = await factoryContract.methods.getExchange(program.token).call()

    if (!exchangeExists(exchangeAddress)) {
      console.log("Exchange don't exist yet. Creating...")

      await factoryContract.methods.createExchange(program.token).send({ from: process.env.FROM_ADDRESS })
      exchangeAddress = await factoryContract.methods.getExchange(program.token).call()
    }
    const exchangeContract = new web3.eth.Contract(uniswapExchangeAbi, exchangeAddress)
    console.log(`Exchange address: ${exchangeAddress}`)
    await logBalance(exchangeAddress, 'Exchange balance')

    const ethAdded = web3.utils.toHex(program.ethAmount)
    const tokensAdded = web3.utils.toHex(program.tokenAmount)

    console.log(`Approving usage of ${parseInt(tokensAdded, '16')} ${symbol} ...`)
    await tokenContract.methods.approve(exchangeAddress, tokensAdded).send({ from: process.env.FROM_ADDRESS })
    console.log(`Approved!\n`)

    console.log(`Adding liquidity to Exchange`)
    await exchangeContract.methods
      .addLiquidity(0, tokensAdded, getDeadline())
      .send({
        from: process.env.FROM_ADDRESS,
        value: ethAdded,
        gasLimit: web3.utils.toHex(6000000),
        gasPrice: web3.utils.toHex(parseInt(program.gas))
      })

    console.log(`Liquidity added!\n`)
    await logBalance(exchangeAddress, 'New Exchange balance')

    process.exit(0)
  } catch (e) {
    console.log(e)
    process.exit(1)
  }

})()

function getFactoryAddress () {
  switch(program.network) {
    case 'rinkeby':
      return '0xf5D915570BC477f9B8D6C0E980aA81757A3AaC36'
    case 'mainnet':
      return '0xc0a47dFe034B400B47bDaD5FecDa2621de6c4d95'
    default:
      console.log(`Unknown network: ${program.network}`)
      process.exit(1)
  }
}

function getProviderURL (network) {
  switch(network) {
    case 'rinkeby':
      return process.env.RINKEBY_PROVIDER_URL
    case 'mainnet':
      return process.env.MAINNET_PROVIDER_URL
    default:
      console.log(`Unknown network: ${program.network}`)
      process.exit(1)
  }
}

function exchangeExists (address) {
  return address.toLowerCase() !== '0x0000000000000000000000000000000000000000'
}

function createBalanceLogger (contract) {
  return async (address, prefix) => {
    let [ethBalance, symbol, balance] = await Promise.all([
      web3.eth.getBalance(address),
      contract.methods.symbol().call().then(amendByteString),
      contract.methods.balanceOf(address).call()
    ])

    console.log(`${prefix}\n--------------\nETH: ${ethBalance}\n${symbol}: ${balance}\n`)
  }
}

function getDeadline () {
  // 15 minutes, denominated in seconds
  const DEADLINE_FROM_NOW = 60 * 15

  return Math.ceil(Date.now() / 1000) + DEADLINE_FROM_NOW
}

function amendByteString (symbol) {
  return web3.utils.isHex(symbol) ? web3.utils.hexToUtf8(symbol) : symbol
}
