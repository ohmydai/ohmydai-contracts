#!/bin/sh
set -e -o pipefail

if [[ -z $MY_ADDRESS ]]; then
    echo "You should export an environment variable containing your ETH address:\n"
    echo "export MY_ADDRESS=\"0x...\""
    exit 1
fi

TESTNET_NAME=$1
if [[ -z $TESTNET_NAME ]]; then
    echo "Usage:\n"
    echo "$0 <testnet name>"
    exit 1
fi

OZ_FILE="../.openzeppelin/$TESTNET_NAME.json"
rm -f $OZ_FILE

npx oz session --network $TESTNET_NAME --no-interactive
npx oz push

# Creates a fake DAI and assign 1000 units to my address
npx oz create @openzeppelin/contracts-ethereum-package/StandaloneERC20 --init initialize --args "\"Fake DAI\",DAI,18,1000000000000000000000,$MY_ADDRESS,[],[]"
DAI_ADDRESS=`cat $OZ_FILE | jq '.proxies["@openzeppelin/contracts-ethereum-package/StandaloneERC20"][0].address' -r`

# Creates a fake USDC and assign 1000 units to my address
npx oz create @openzeppelin/contracts-ethereum-package/StandaloneERC20 --init initialize --args "\"Fake USDC\",USDC,6,1000000000,$MY_ADDRESS,[],[]"
USDC_ADDRESS=`cat $OZ_FILE | jq '.proxies["@openzeppelin/contracts-ethereum-package/StandaloneERC20"][1].address' -r`

# Creates the option series
npx oz create Option --init initializeInTestMode --args "\"ohDAI 1:1 USDC A\",\"OHDAI:USDC:A\",$USDC_ADDRESS,6,$DAI_ADDRESS,1000000000000000000" --skip-compile
OPTION_ADDRESS=`cat $OZ_FILE | jq '.proxies["contracts/Option"][0].address' -r`

echo "\n\nSummary:\n"
echo "My address: $MY_ADDRESS"
echo "DAI address: $DAI_ADDRESS"
echo "USDC address: $USDC_ADDRESS"
echo "Option address: $OPTION_ADDRESS"
