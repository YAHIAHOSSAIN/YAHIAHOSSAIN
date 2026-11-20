const chai = require('chai');
chai.use(require('chai-as-promised'));
const { expect } = chai;
const { ethers } = require('hardhat');

const E = 10n ** 18n;

describe('FlashArbitrage', function () {
  let owner, other, weth, usdc, cheap, expensive, arb;

  async function makePair(wethAmt, usdcAmt) {
    const pair = await ethers.deployContract('MockPair', [await weth.getAddress(), await usdc.getAddress()]);
    await weth.mint(await pair.getAddress(), wethAmt);
    await usdc.mint(await pair.getAddress(), usdcAmt);
    await pair.sync();
    return pair;
  }

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    weth = await ethers.deployContract('MockERC20');
    usdc = await ethers.deployContract('MockERC20');
    cheap = await makePair(100n * E, 300000n * E); // USDC cheap here (more USDC per WETH)
    expensive = await makePair(100n * E, 290000n * E);
    arb = await ethers.deployContract('FlashArbitrage');
  });

  async function wethIsToken0() {
    return (await cheap.token0()) === (await weth.getAddress());
  }

  it('makes a profit in WETH with zero starting capital', async function () {
    const { findOptimalAmount, orient } = await import('../src/math.js');
    const w0 = await wethIsToken0();
    const [c0, c1] = await cheap.getReserves();
    const [x0, x1] = await expensive.getReserves();
    const opp = findOptimalAmount(orient(c0, c1, w0), orient(x0, x1, w0));
    expect(opp.profit > 0n).to.equal(true);

    await arb.execute(await cheap.getAddress(), await expensive.getAddress(), w0, opp.amountIn, 0n);

    // Bot's off-chain estimate equals the real on-chain profit.
    expect(await weth.balanceOf(owner.address)).to.equal(opp.profit);
    expect(await weth.balanceOf(await arb.getAddress())).to.equal(0n);
  });

  it('reverts when profit is below minProfit', async function () {
    const w0 = await wethIsToken0();
    const err = await arb
      .execute(await cheap.getAddress(), await expensive.getAddress(), w0, 1n * E, 100n * E)
      .catch((e) => e);
    expect(err).to.be.instanceOf(Error);
    expect(arb.interface.parseError(err.data).name).to.equal('InsufficientProfit');
  });

  it('reverts in the losing direction', async function () {
    const w0 = await wethIsToken0();
    await expect(arb.execute(await expensive.getAddress(), await cheap.getAddress(), w0, 1n * E, 0n)).to.be.rejected;
  });

  it('only the owner can execute', async function () {
    const w0 = await wethIsToken0();
    await expect(arb.connect(other).execute(await cheap.getAddress(), await expensive.getAddress(), w0, E, 0n)).to.be
      .rejected;
  });

  it('rejects callbacks it did not start', async function () {
    await expect(arb.uniswapV2Call(await arb.getAddress(), 0n, 1n, '0x')).to.be.rejected;
  });
});
