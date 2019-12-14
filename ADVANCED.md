# Advanced

## Introduction

All of the following commands assume you have already defined an environment variable called `CONTRACT_ADDRESS` with the address of a deployed Option contract:

```
export CONTRACT_ADDRESS=<address>
```

## Useful commands

### Check if the option series has already expired

```
npx oz call --to $CONTRACT_ADDRESS --method hasExpired
```

### Check how much of the underlying asset is locked inside the contract

```
npx oz call --to $CONTRACT_ADDRESS --method underlyingBalance
```

### Check how much of the strike asset is locked inside the contract

```
npx oz call --to $CONTRACT_ADDRESS --method strikeBalance
```

## Removing liquidity from Uniswap after series expiration

1. Go to https://uniswap.exchange/remove-liquidity.
2. Paste the deployed contract address.
3. Click "Remove Liquidity" and wait for the transaction confirmation. After that, should receive the ETH and the ohTokens in your address. This step is NOT necessary for removing your assets from the contract, it is only necessary for removing your ETH from Uniswap due to how it works.
4. Now redeem your locked underlying and/or strike assets back from the option contract. Go to https://inspect-contract-dapp.info/.
5. Paste the deployed contract address.
6. Inside the `build/contracts` folder, run the following command:

```
cat Option.json | jq "{abi: .abi | map(select(.name | contains(\"withdraw\"))) }" > withdraw.json
```

7. Load the `withdraw.json` in the inspect-contract-dapp.
8. Run the transaction, wait for the confirmation, and your locked assets will be redeemed.
