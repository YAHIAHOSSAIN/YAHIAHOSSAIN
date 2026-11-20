// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title FlashArbitrage
/// @notice Atomic two-pool arbitrage between Uniswap V2-style pairs (Uniswap V2, SushiSwap, ...).
///
/// Flow (everything happens in ONE transaction, so it either earns a profit or reverts):
///   1. Flash-swap `borrowed` of tokenOut from `pairBorrow` (we owe it `amountIn` of tokenIn).
///   2. Sell those tokenOut on `pairSell` for tokenIn.
///   3. Repay `amountIn` of tokenIn to `pairBorrow`.
///   4. Send the remaining tokenIn (the profit) to the owner.
/// If the profit is below `minProfit`, the whole transaction reverts and only gas is lost.
///
/// Not suitable for fee-on-transfer / rebasing tokens.
contract FlashArbitrage {
    address public immutable owner;

    /// @dev Pair we expect the flash-swap callback from; zero outside of `execute`.
    address private activePair;

    error NotOwner();
    error UnauthorizedCallback();
    error InvalidPairs();
    error InsufficientProfit(uint256 received, uint256 required);

    event ArbitrageExecuted(address indexed pairBorrow, address indexed pairSell, address tokenIn, uint256 amountIn, uint256 profit);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @param pairBorrow   Pair where tokenOut is cheap (we "buy" it here via flash swap).
    /// @param pairSell     Pair where tokenOut is expensive (we sell it here).
    /// @param borrowToken1 true = borrow token1 and repay with token0; false = the opposite.
    /// @param amountIn     Amount of tokenIn we pay to pairBorrow (the trade size).
    /// @param minProfit    Minimum profit in tokenIn, otherwise revert.
    function execute(address pairBorrow, address pairSell, bool borrowToken1, uint256 amountIn, uint256 minProfit)
        external
        onlyOwner
    {
        if (pairBorrow == pairSell) revert InvalidPairs();
        IUniswapV2Pair borrowPair = IUniswapV2Pair(pairBorrow);
        IUniswapV2Pair sellPair = IUniswapV2Pair(pairSell);
        if (borrowPair.token0() != sellPair.token0() || borrowPair.token1() != sellPair.token1()) revert InvalidPairs();

        (uint112 r0, uint112 r1,) = borrowPair.getReserves();
        uint256 borrowed = borrowToken1 ? getAmountOut(amountIn, r0, r1) : getAmountOut(amountIn, r1, r0);

        activePair = pairBorrow;
        bytes memory data = abi.encode(pairSell, borrowToken1, amountIn, minProfit);
        if (borrowToken1) {
            borrowPair.swap(0, borrowed, address(this), data);
        } else {
            borrowPair.swap(borrowed, 0, address(this), data);
        }
        activePair = address(0);
    }

    /// @notice Uniswap V2 flash-swap callback. SushiSwap and most forks use the same name.
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external {
        _onFlashSwap(sender, amount0, amount1, data);
    }

    /// @notice PancakeSwap-style forks name the callback differently.
    function pancakeCall(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external {
        _onFlashSwap(sender, amount0, amount1, data);
    }

    function _onFlashSwap(address sender, uint256 amount0, uint256 amount1, bytes calldata data) private {
        // Only the pair we called, and only for a swap we started.
        if (msg.sender != activePair || activePair == address(0) || sender != address(this)) {
            revert UnauthorizedCallback();
        }

        (address pairSell, bool borrowToken1, uint256 amountIn, uint256 minProfit) =
            abi.decode(data, (address, bool, uint256, uint256));

        IUniswapV2Pair sellPair = IUniswapV2Pair(pairSell);
        address token0 = sellPair.token0();
        address token1 = sellPair.token1();
        (address tokenOut, address tokenIn) = borrowToken1 ? (token1, token0) : (token0, token1);
        uint256 borrowed = borrowToken1 ? amount1 : amount0;

        // Sell the borrowed tokens on the second pair.
        (uint112 s0, uint112 s1,) = sellPair.getReserves();
        uint256 received = borrowToken1 ? getAmountOut(borrowed, s1, s0) : getAmountOut(borrowed, s0, s1);
        uint256 required = amountIn + minProfit;
        if (received < required) revert InsufficientProfit(received, required);

        _safeTransfer(tokenOut, pairSell, borrowed);
        if (borrowToken1) {
            sellPair.swap(received, 0, address(this), "");
        } else {
            sellPair.swap(0, received, address(this), "");
        }

        // Repay the flash swap, keep the rest.
        _safeTransfer(tokenIn, msg.sender, amountIn);
        uint256 profit = received - amountIn;
        _safeTransfer(tokenIn, owner, profit);

        emit ArbitrageExecuted(msg.sender, pairSell, tokenIn, amountIn, profit);
    }

    /// @notice Recover tokens accidentally sent to the contract.
    function withdraw(address token, uint256 amount) external onlyOwner {
        _safeTransfer(token, owner, amount);
    }

    /// @dev Uniswap V2 formula with the 0.3% fee.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "TRANSFER_FAILED");
    }
}
