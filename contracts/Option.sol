pragma solidity 0.5.11;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";


/**
 * Represents a tokenized american put option series for some
 * long/short token pair.
 *
 * It is fungible and it is meant to be freely tradeable until its
 * expiration time, when its transfer functions will be blocked
 * and the only available operation will be for the option writers
 * to unlock their collateral.
 *
 * Let's take an example: there is such an option series where buyers
 * may sell 1 DAI for 1 USDC until Dec 31, 2019.
 *
 * In this case:
 *
 * - Expiration date: Dec 31, 2019
 * - Underlying asset: DAI
 * - Strike asset: USDC
 * - Strike price: 1 USDC
 *
 * USDC holders may call mint() until the expiration date, which in turn:
 *
 * - Will lock their USDC into this contract
 * - Will issue put tokens corresponding to this USDC amount
 * - These put tokens will be freely tradable until the expiration date
 *
 * USDC holders who also hold the option tokens may call burn() until the
 * expiration date, which in turn:
 *
 * - Will unlock their USDC from this contract
 * - Will burn the corresponding amount of put tokens
 *
 * Put token holders may call redeem() until the expiration date, to
 * exercise their option, which in turn:
 *
 * - Will sell 1 DAI for 1 USDC (the strike price) each.
 * - Will burn the corresponding amounty of put tokens.
 */
contract Option is Initializable, ERC20Detailed, ERC20 {

    /**
     * The asset used as the underlying token, e.g. DAI
     */
    IERC20 public underlyingAsset;

    /**
     * How many decimals does the underlying token have? E.g.: 18
     */
    uint8 public underlyingAssetDecimals;

    /**
     * The strike asset for this vault, e.g. USDC
     */
    IERC20 public strikeAsset;

    /**
     * The sell price of each unit of strikeAsset; given in units
     * of strikeAsset, e.g. 0.99 USDC
     */
    uint256 public strikePrice;

    /**
     * This option series is considered expired starting from this block
     * number
     */
    uint256 public expirationBlockNumber;

    /**
     * Tracks how much of the strike token each address has locked
     * inside this contract
     */
    mapping(address => uint256) public lockedBalance;

    /**
     * This flag should signal if this contract was deployed in TESTMODE;
     * this means it is not suposed to be used with real money, and it
     * enables some power user features useful for testing environments.
     *
     * On mainnet this flag should return always false.
     */
    bool public isTestingDeployment;

    /**
     * OZ initializer; sets the option series expiration to (block.number
     * + parameter) block number; useful for tests
     */
    function initializeInTestMode(
        string calldata name,
        string calldata symbol,
        IERC20 _underlyingAsset,
        uint8 _underlyingAssetDecimals,
        IERC20 _strikeAsset,
        uint256 _strikePrice) external initializer
    {
        _initialize(
            name,
            symbol,
            _underlyingAsset,
            _underlyingAssetDecimals,
            _strikeAsset,
            _strikePrice,
            ~uint256(0)
        );
        isTestingDeployment = true;
    }

    /**
     * OZ initializer; sets the option series expiration to an exact
     * block number
     */
    function initialize(
        string calldata name,
        string calldata symbol,
        IERC20 _underlyingAsset,
        uint8 _underlyingAssetDecimals,
        IERC20 _strikeAsset,
        uint256 _strikePrice,
        uint256 _expirationBlockNumber) external initializer
    {
        _initialize(
            name,
            symbol,
            _underlyingAsset,
            _underlyingAssetDecimals,
            _strikeAsset,
            _strikePrice,
            _expirationBlockNumber
        );
    }

    /**
     * IF this contract is deployed in TESTMODE, allows the caller
     * to force the option series expiration in one way only.
     */
    function forceExpiration() external {
        if (!isTestingDeployment) {
            revert("Can't force series expiration on non-testing environments");
        }
        expirationBlockNumber = 0;
    }

    /**
     * Checks if the options series has already expired.
     */
    function hasExpired() external view returns (bool) {
        return _hasExpired();
    }

    /**
     * Maker modifier for functions which are only allowed to be executed
     * BEFORE series expiration.
     */
    modifier beforeExpiration() {
        if (_hasExpired()) {
            revert("Option has expired");
        }
        _;
    }

    /**
     * Maker modifier for functions which are only allowed to be executed
     * AFTER series expiration.
     */
    modifier afterExpiration() {
        if (!_hasExpired()) {
            revert("Option has not expired yet");
        }
        _;
    }

    /**
     * Locks some amount of the strike token and writes option tokens.
     *
     * The issued amount ratio is 1:1, i.e., 1 option token for 1 underlying token.
     *
     * It presumes the caller has already called IERC20.approve() on the
     * strike token contract to move caller funds.
     *
     * This function is meant to be called by strike token holders wanting
     * to write option tokens.
     *
     * Options can only be minted while the series is NOT expired.
     *
     * @param amount The amount option tokens to be issued; this will lock
     * for instance amount * strikePrice units of strikeToken into this
     * contract
     */
    function mint(uint256 amount) external beforeExpiration {
        lockedBalance[msg.sender] = lockedBalance[msg.sender].add(amount);
        _mint(msg.sender, amount.mul(1e18));

        // Locks the strike asset inside this contract
        require(strikeAsset.transferFrom(msg.sender, address(this), amount.mul(strikePrice)), "Couldn't transfer strike tokens from caller");
    }

    /**
     * Unlocks some amount of the strike token by burning option tokens.
     *
     * This mechanism ensures that users can only redeem tokens they've
     * previously lock into this contract.
     *
     * Options can only be burned while the series is NOT expired.
     */
    function burn(uint256 amount) external beforeExpiration {
        require(amount <= lockedBalance[msg.sender], "Not enough underlying balance");

        // Burn option tokens
        lockedBalance[msg.sender] = lockedBalance[msg.sender].sub(amount);
        _burn(msg.sender, amount.mul(1e18));

        // Unlocks the strike token
        require(strikeAsset.transfer(msg.sender, amount.mul(strikePrice)), "Couldn't transfer back strike tokens to caller");
    }

    /**
     * Allow put token holders to use them to sell some amount of units
     * of the underlying token for the amount * strike price units of the
     * strike token.
     *
     * It presumes the caller has already called IERC20.approve() on the
     * underlying token contract to move caller funds.
     *
     * During the process:
     *
     * - The amount * strikePrice of strike tokens are transferred to the
     * caller
     * - The amount of option tokens are burned
     * - The amount of underlying tokens are transferred into
     * this contract as a payment for the strike tokens
     *
     * Options can only be exchanged while the series is NOT expired.
     *
     * @param amount The amount of underlying tokens to be sold for strike
     * tokens
     */
    function exchange(uint256 amount) external beforeExpiration {
        // Gets the payment from the caller by transfering them
        // to this contract
        uint256 underlyingAmount = amount * 10 ** uint256(underlyingAssetDecimals);
        require(underlyingAsset.transferFrom(msg.sender, address(this), underlyingAmount), "Couldn't transfer strike tokens from caller");

        // Transfers the strike tokens back in exchange
        _burn(msg.sender, amount.mul(1e18));
        require(strikeAsset.transfer(msg.sender, amount.mul(strikePrice)), "Couldn't transfer strike tokens to caller");
    }

    /**
     * After series expiration, allow addresses who have locked their strike
     * asset tokens to withdraw them on first-come-first-serve basis.
     *
     * If there is not enough of strike asset because the series have been
     * exercised, the remaining balance is converted into the underlying asset
     * and given to the caller.
     */
    function withdraw() external afterExpiration {
        _redeem(lockedBalance[msg.sender]);
    }

    /**
     * Utility function to check the amount of the underlying tokens
     * locked inside this contract
     */
    function underlyingBalance() external view returns (uint256) {
        return underlyingAsset.balanceOf(address(this));
    }

    /**
     * Utility function to check the amount of the strike tokens locked
     * inside this contract
     */
    function strikeBalance() external view returns (uint256) {
        return strikeAsset.balanceOf(address(this));
    }

    function _hasExpired() internal view returns (bool) {
        return block.number >= expirationBlockNumber;
    }

    function _redeem(uint256 amount) internal {
        // Calculates how many underlying/strike tokens the caller
        // will get back
        uint256 currentStrikeBalance = strikeAsset.balanceOf(address(this));
        uint256 strikeToReceive = amount.mul(strikePrice);
        uint256 underlyingToReceive = 0;
        if (strikeToReceive > currentStrikeBalance) {
            // Ensure integer division and rounding
            uint256 strikeAmount = currentStrikeBalance.div(strikePrice);
            strikeToReceive = strikeAmount.mul(strikePrice);

            uint256 underlyingAmount = amount - strikeAmount;
            underlyingToReceive = underlyingAmount.mul(10 ** uint256(underlyingAssetDecimals));
        }

        // Unlocks the underlying token
        lockedBalance[msg.sender] = lockedBalance[msg.sender].sub(amount);
        if (strikeToReceive > 0) {
            require(strikeAsset.transfer(msg.sender, strikeToReceive), "Couldn't transfer back strike tokens to caller");
        }
        if (underlyingToReceive > 0) {
            require(underlyingAsset.transfer(msg.sender, underlyingToReceive), "Couldn't transfer back underlying tokens to caller");
        }
    }

    /**
     * OZ initializer
     */
    function _initialize(
        string memory name,
        string memory symbol,
        IERC20 _underlyingAsset,
        uint8 _underlyingAssetDecimals,
        IERC20 _strikeAsset,
        uint256 _strikePrice,
        uint256 _expirationBlockNumber) private
    {
        ERC20Detailed.initialize(name, symbol, 18);

        underlyingAsset = _underlyingAsset;
        underlyingAssetDecimals = _underlyingAssetDecimals;
        strikeAsset = _strikeAsset;
        strikePrice = _strikePrice;
        expirationBlockNumber = _expirationBlockNumber;
    }

    uint256[50] private ______gap;

}
