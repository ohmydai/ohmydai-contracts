const { TestHelper } = require("@openzeppelin/cli");
const { Contracts, ZWeb3 } = require("@openzeppelin/upgrades");

ZWeb3.initialize(web3.currentProvider);

const Option = Contracts.getFromLocal("Option");
const StandaloneERC20 = Contracts.getFromNodeModules(
  "@openzeppelin/contracts-ethereum-package",
  "StandaloneERC20"
);

require("chai").should();

contract("Option", function(accounts) {
  let mockUSDC;
  let mockDAI;
  let option;

  let usdcHolder;
  let anotherUsdcHolder;
  let daiHolder;

  beforeEach(async function() {
    this.project = await TestHelper();

    usdcHolder = accounts[0];
    daiHolder = accounts[1];
    anotherUsdcHolder = accounts[2];

    mockUSDC = await this.project.createProxy(StandaloneERC20, {
      initMethod: "initialize",
      initArgs: ["Fake USDC", "USDC", 6, (100e6).toString(), usdcHolder, [], []]
    });

    mockDAI = await this.project.createProxy(StandaloneERC20, {
      initMethod: "initialize",
      initArgs: ["Fake DAI", "DAI", 18, (100e18).toString(), daiHolder, [], []]
    });

    option = await this.project.createProxy(Option, {
      initMethod: "initializeInTestMode",
      initArgs: [
        "oh DAI:USDC",
        "OH:DAI:USDC",
        mockDAI.address,
        18,
        mockUSDC.address,
        "1000001"
      ]
    });
  });

  async function checkBalances(account, options, usdc, dai) {
    if (options !== null) {
      const optionsBalance = await option.methods.balanceOf(account).call();
      optionsBalance.should.be.equal(options);
    }

    if (usdc !== null) {
      const usdcBalance = await mockUSDC.methods.balanceOf(account).call();
      usdcBalance.should.be.equal(usdc);
    }

    if (dai !== null) {
      const daiBalance = await mockDAI.methods.balanceOf(account).call();
      daiBalance.should.be.equal(dai);
    }
  }

  async function mintOptionsAndCheck(
    account,
    mintAmount,
    expectedStrikeAllowance,
    expectedOptions,
    expectedUsdc
  ) {
    await mockUSDC.methods
      .approve(option.address, expectedStrikeAllowance)
      .send({ from: account });

    await checkBalances(account, expectedOptions[0], expectedUsdc[0], null);
    await option.methods.mint(mintAmount).send({ from: account });
    await checkBalances(account, expectedOptions[1], expectedUsdc[1], null);
  }

  async function mintOptions() {
    await mockUSDC.methods
      .approve(option.address, "1000001")
      .send({ from: usdcHolder });

    await checkBalances(usdcHolder, "0", "100000000", "0");
    await checkBalances(daiHolder, "0", "0", "100000000000000000000");

    await option.methods.mint("1").send({ from: usdcHolder });

    await checkBalances(usdcHolder, "1000000000000000000", "98999999", "0");
    await checkBalances(daiHolder, "0", "0", "100000000000000000000");
  }

  describe("general checks", function() {
    it("should have 18 fixed decimals", async function() {
      const decimals = await option.methods.decimals().call();
      decimals.should.be.equals("18");
    });
  });

  describe("before expiration", function() {
    afterEach(async function() {
      const expired = await option.methods.hasExpired().call();
      expired.should.be.false;
    });

    describe("can mint options by locking strike tokens", function() {
      it("should fail if not allowed to spend strike tokens", async function() {
        let failed = false;
        try {
          await option.methods.mint("1").send({ from: usdcHolder });
        } catch (err) {
          failed = true;
        }
        failed.should.be.true;
      });

      it("should mint if allowed to spend underlying tokens", async function() {
        await mintOptions();
      });

      it("should be some locked strike asset after exchange", async function() {
        await mintOptions();

        // Check locked balances
        const strikeBalance = await option.methods.strikeBalance().call();
        strikeBalance.should.be.equal("1000001");
      });
    });

    describe("can burn options to get back my assets", function() {
      /**
       * - USDC holder has 100 USDC
       * - USDC holder mints 1 DAI:USDC for 1.000001 USDC: 1 DAI:USDC/98.999999 USDC
       * - USDC holder burns 1 DAI_USDC for 1.000001 USDC back: 0 DAI:USDC/100 USDC
       */
      it("should be able to burn all my options for all my locked assets", async function() {
        await mintOptions();

        await option.methods.burn("1").send({ from: usdcHolder });

        await checkBalances(usdcHolder, "0", "100000000", "0");
        await checkBalances(daiHolder, "0", "0", "100000000000000000000");
      });

      /**
       * - USDC holder has 100 USDC
       * - USDC holder mints 1 DAI:USDC for 1.000001 USDC: 1 DAI:USDC/98.999999 USDC
       * - USDC holder gives 1.000001 USDC to another holder: 1 DAI:USDC/97.999998 USDC
       * - Another holder mints 1 DAI:USDC and send back to USDC holder: 2 DAI:USDC/97.999998 USDC
       * - USDC holder tries to burn 2 DAI:USDC and fails because he has only 1.000001 USDC locked inside the contract
       */
      it("should not be able to burn more options than the amount of my locked tokens", async function() {
        await mintOptions();

        // Give 1 unit of USDC to another holder and mint 1 option from there
        await mockUSDC.methods
          .transfer(anotherUsdcHolder, "1000001")
          .send({ from: usdcHolder });
        await mintOptionsAndCheck(
          anotherUsdcHolder,
          "1",
          "1000001",
          ["0", "1000000000000000000"],
          ["1000001", "0"]
        );

        // Send 1 option back to USDC holder and try to burn everything
        await option.methods
          .transfer(usdcHolder, "1000000000000000000")
          .send({ from: anotherUsdcHolder });
        await checkBalances(usdcHolder, "2000000000000000000", "97999998", "0");

        let failed = false;
        try {
          await option.methods.burn("2").send({ from: usdcHolder });
        } catch (err) {
          failed = true;
        }
        failed.should.be.true;
      });
    });

    describe("can sell my underlying tokens for the strike tokens at the strike price", function() {
      async function exchangeOptions() {
        await mintOptions();

        // Transfer 1 option to DAI holder
        await option.methods
          .transfer(daiHolder, "1000000000000000000")
          .send({ from: usdcHolder });
        await checkBalances(usdcHolder, "0", "98999999", "0");
        await checkBalances(
          daiHolder,
          "1000000000000000000",
          "0",
          "100000000000000000000"
        );

        // Exercise the option
        await mockDAI.methods
          .approve(option.address, "1000000000000000000")
          .send({ from: daiHolder });
        await option.methods.exchange("1").send({ from: daiHolder });
        await checkBalances(usdcHolder, "0", "98999999", "0");
        await checkBalances(daiHolder, "0", "1000001", "99000000000000000000");
      }

      it("should be able to exchange my options", async function() {
        await exchangeOptions();
      });

      it("should be some locked underlying asset after exchange", async function() {
        await exchangeOptions();

        const underlyingBalance = await option.methods
          .underlyingBalance()
          .call();
        underlyingBalance.should.be.equal("1000000000000000000");
      });
    });

    it("can't withdraw", async function() {
      let failed = false;
      try {
        await option.methods.withdraw().send({ from: usdcHolder });
      } catch (err) {
        failed = true;
      }
      failed.should.be.true;
    });
  });

  describe("after expiration", function() {
    /**
     * Utility function to force the series expiration for these tests
     */
    async function forceExpiration() {
      await option.methods.forceExpiration().send({ from: usdcHolder });
      const expired = await option.methods.hasExpired().call();
      expired.should.be.true;
    }

    describe("can't mint, burn or exchange options anymore", function() {
      it("should not allow mint()", async function() {
        await mockUSDC.methods
          .approve(option.address, "1000001")
          .send({ from: usdcHolder });

        await checkBalances(usdcHolder, "0", "100000000", "0");
        await checkBalances(daiHolder, "0", "0", "100000000000000000000");

        await forceExpiration();
        let failed = false;
        try {
          await option.methods.mint("1").send({ from: usdcHolder });
        } catch (err) {
          failed = true;
        }
        failed.should.be.true;
      });
    });

    describe("must allow transfers because of how uniswap liquidity pools work", function() {
      it("should allow transfer()", async function() {
        await mintOptions();
        await forceExpiration();

        await option.methods
          .transfer(anotherUsdcHolder, "1000000000000000000")
          .send({ from: usdcHolder });
      });

      it("should allow transferFrom()", async function() {
        await mintOptions();
        await forceExpiration();

        await option.methods
          .approve(daiHolder, "1000000000000000000")
          .send({ from: usdcHolder });

        await option.methods
          .transferFrom(usdcHolder, anotherUsdcHolder, "1000000000000000000")
          .send({ from: daiHolder });
      });
    });

    describe("should allow withdraw", function() {
      it("should allow withdraw with no balance", async function() {
        await forceExpiration();
        await option.methods.withdraw().send({ from: usdcHolder });
        await checkBalances(usdcHolder, "0", "100000000", "0");
      });

      it("should allow withdraw locked asset with no holding options", async function() {
        await mintOptions();
        await option.methods
          .transfer(anotherUsdcHolder, "1000000000000000000")
          .send({ from: usdcHolder });
        await forceExpiration();

        await checkBalances(usdcHolder, "0", "98999999", "0");
        await option.methods.withdraw().send({ from: usdcHolder });
        await checkBalances(usdcHolder, "0", "100000000", "0");
      });

      it("should allow withdraw locked asset with was exercised by another user", async function() {
        await mintOptions();

        // Transfer 1 option to DAI holder
        await option.methods
          .transfer(daiHolder, "1000000000000000000")
          .send({ from: usdcHolder });
        await checkBalances(usdcHolder, "0", "98999999", "0");
        await checkBalances(
          daiHolder,
          "1000000000000000000",
          "0",
          "100000000000000000000"
        );

        // Exercise the option
        await mockDAI.methods
          .approve(option.address, "1000000000000000000")
          .send({ from: daiHolder });
        await option.methods.exchange("1").send({ from: daiHolder });
        await checkBalances(usdcHolder, "0", "98999999", "0");
        await checkBalances(daiHolder, "0", "1000001", "99000000000000000000");

        await forceExpiration();

        await option.methods.withdraw().send({ from: usdcHolder });
        await checkBalances(usdcHolder, "0", "98999999", "1000000000000000000");
      });
    });

    it("should allow withdraw a mix of locked strike asset and asset with was exercised by another user", async function() {
      // Mint 3 options
      await mockUSDC.methods
        .approve(option.address, "3000003")
        .send({ from: usdcHolder });

      await checkBalances(usdcHolder, "0", "100000000", "0");
      await checkBalances(daiHolder, "0", "0", "100000000000000000000");

      await option.methods.mint("3").send({ from: usdcHolder });

      await checkBalances(usdcHolder, "3000000000000000000", "96999997", "0");
      await checkBalances(daiHolder, "0", "0", "100000000000000000000");

      // Transfer 1 option to DAI holder
      await option.methods
        .transfer(daiHolder, "1000000000000000000")
        .send({ from: usdcHolder });
      await checkBalances(usdcHolder, "2000000000000000000", "96999997", "0");
      await checkBalances(
        daiHolder,
        "1000000000000000000",
        "0",
        "100000000000000000000"
      );

      // Exercise the option
      await mockDAI.methods
        .approve(option.address, "1000000000000000000")
        .send({ from: daiHolder });
      await option.methods.exchange("1").send({ from: daiHolder });
      await checkBalances(usdcHolder, "2000000000000000000", "96999997", "0");
      await checkBalances(daiHolder, "0", "1000001", "99000000000000000000");

      await forceExpiration();

      await option.methods.withdraw().send({ from: usdcHolder });
      await checkBalances(
        usdcHolder,
        "2000000000000000000",
        "98999999",
        "1000000000000000000"
      );
    });
  });
});
