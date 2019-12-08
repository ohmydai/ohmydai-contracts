#!/bin/sh
set -e -o pipefail

if [[ -z $MY_ADDRESS ]]; then
    echo "You should export an environment variable containing your ETH address:\n"
    echo "export MY_ADDRESS=\"0x...\""
    exit 1
fi

OZ_FILE="../.openzeppelin/mainnet.json"
rm -f $OZ_FILE

npx oz session --network mainnet --no-interactive
npx oz push

# Token mainnet addresses
DAI_ADDRESS="0x6b175474e89094c44da98b954eedeac495271d0f"
USDC_ADDRESS="0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"

# Estimate block number for Dec 3, 2019 == Nov 19 + 80640 blocks
# 80640 == (14 days * 24 hours * 60 min * 4 blocks/min)
EXPIRATION_BLOCK="9050000"

# Creates the option series
npx oz create Option --init initialize --args "\"ohDAI 1:1 USDC A\",\"OHDAI:USDC:A\",$DAI_ADDRESS,18,$USDC_ADDRESS,1000000,$EXPIRATION_BLOCK" --skip-compile
OPTION_ADDRESS=`cat $OZ_FILE | jq '.proxies["contracts/Option"][0].address' -r`

echo "\n\nSummary:\n"
echo "My address: $MY_ADDRESS"
echo "DAI address: $DAI_ADDRESS"
echo "USDC address: $USDC_ADDRESS"
echo "Option address: $OPTION_ADDRESS"
