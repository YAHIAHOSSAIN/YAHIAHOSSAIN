I am attaching the full source of my MEXC <-> Ethereum DEX arbitrage bot
(file: mexc-dex-arb-code-for-review.md; CHANGES.md inside lists the latest fixes).

Background:
- TypeScript, Node 20, ethers v6, SQLite, Telegram, pm2, running on an Ubuntu VPS.
- Two strategies: "inventory" (default: hold tokens on MEXC and in a hot wallet,
  trade both legs at once) and "transfer" (buy on MEXC -> withdraw -> sell on DEX;
  off by default, needs ALLOW_WITHDRAWALS=yes).
- DEX prices come from 0x (Swap API v2 AllowanceHolder) or 1inch v6. MEXC prices come
  from its protobuf WebSocket and REST. Txs are sent through a private RPC (MEV Blocker /
  Flashbots).
- Defaults: MODE=paper, MAX_TRADE_USD=50, MIN_PROFIT_USD=2, MIN_PROFIT_PCT=0.5,
  MAX_TRADES_PER_DAY=20, DAILY_LOSS_LIMIT_USD=30.
- It has been through two bug-review rounds (by you and by another AI). All fixes are in.
- Observed live: MEXC vs Ethereum DEX gaps on liquid tokens (LINK, PEPE, UNI, SHIB, LDO)
  are 0.0-1.0%, while mainnet gas is about $3-5 per swap.

THIS IS NOT A BUG REVIEW. I want an UPGRADE PLAN: what to add or change so the bot
actually finds and makes profitable trades, safely, with a small account ($500-2000).

Please answer each section:

1. Chains and economics
   - Mainnet gas makes $50 trades almost impossible. Compare Arbitrum, Base, Optimism,
     BSC, Polygon and Solana for this bot: typical swap gas in USD, DEX liquidity, how many
     MEXC tokens have deposit/withdraw on that network, and typical MEXC-vs-DEX gaps.
   - Recommend a trade size and profit threshold for each chain you recommend.
   - Which one chain should I move to first, and why?

2. Better prices
   - Should I add direct Uniswap v3/v4 quoter calls, other DEXs, or other aggregators
     (1inch, ParaSwap, KyberSwap, Odos, CoW)? Pick the best 1-2 and explain the gain.
   - Is quoting several trade sizes (not just MAX_TRADE_USD) worth it?

3. Other strategies on MEXC (realistic for a small account?)
   - Maker (post-only) orders on MEXC instead of taker, so MEXC fees drop to ~0%.
   - Triangular arbitrage inside MEXC.
   - Spot vs perpetual basis / funding-rate trades on MEXC futures.
   - New listings: MEXC lists tokens early; is the DEX gap at listing time a real,
     safe opportunity?
   For each: expected edge, main risk, and whether it fits this codebase.

4. Speed and execution
   - Is a loop driven by 12 s blocks competitive, or do I need DEX price streaming,
     mempool watching, or a VPS close to MEXC's servers?
   - Anything to make the two legs closer to atomic?

5. Inventory management
   - How to size inventory per token, and how to rebalance between MEXC and the wallet
     safely (without giving the bot MEXC withdrawal rights).

6. Monitoring
   - Which metrics or dashboards tell me whether the bot is worth running: missed
     opportunities, gap distribution per token and per hour, fill price vs quote,
     slippage, gas share of profit, and so on. What should be stored in SQLite?

7. Anything else that would make it more profitable or more robust.

Format for every idea:
- What to build, in one or two lines.
- Expected benefit (estimate it with numbers if you can).
- Risk.
- Effort: small / medium / large.
- Which files in this code it touches.
- Priority: DO FIRST / LATER / SKIP.
End with a ranked top-5 list.

Say clearly which facts you checked against real docs or live data today (give the URL)
and which are your own estimates. Do not invent gas costs, fees or API features.
