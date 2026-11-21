# Phase-1 upgrade (Grok's UPGRADE_PROMPT): what changed, file:line

Hard rules kept:
- Defaults unchanged: `MODE=paper`, `STRATEGY=inventory`, `ALLOW_WITHDRAWALS=no`.
- No MEXC withdrawal rights. The bot never moves funds; rebalancing is a ticket for a human.
- Nothing was run live. No mempool watching, no front-running.
- Keys and RPC URLs are redacted.

Results: `npm run typecheck` passes and `npm test` passes **112 tests** (16 new test cases in 4 new test files, plus new cases in `test/engine.test.ts`).

Verified live today (read-only, public endpoints):
- MEXC `USDCUSDT` = 1.0021.
- 1,368 USDT pairs: taker fee 0.08% on 941, 0.20% on 249, 0.05% on 174.
- KyberSwap `/routes` on ethereum, base, bsc and arbitrum returned router `0x6131…37b5`, the address listed in Kyber's docs.
- A read-only Kyber price + build on Base succeeded through the new `Kyber` class.

## 1) Cost model and thresholds

| What | Where |
|---|---|
| Per-symbol `takerCommission` / `makerCommission` from exchangeInfo into `SymbolRules` | `src/mexc/rules.ts:24` |
| `max(MEXC_TAKER_FEE override, symbol fee)`, used everywhere (planCexBuy, unwindPlan, transfer) | `src/mexc/rules.ts:41` `takerFeeFor`; `src/engine.ts:199` `fee()`; `src/transfer.ts:118` |
| USDC ≠ USDT: live USDCUSDT mid; no trading if the book is older than 30 s or the rate is outside 0.99–1.01; rate 1 on BSC (USDT) | `src/engine.ts:219` `refreshStableRate`; transfer: the USDCUSDT ticker check in `tick()` |
| The rate is applied in `evaluateDexBuy`, `evaluateCexBuy`, `evaluateTransfer` and `portfolioUsd` | `src/pricing.ts:24` `stableInUsdt`; `src/inventory.ts:41` |
| Hurdles in bps: `MIN_PROFIT_BPS=20`, `SAFETY_MARGIN_BPS=10`, with `MIN_PROFIT_USD=0.25` / `SAFETY_MARGIN_USD=0` as floors; need = max(USD, bps × size) | `src/pricing.ts:28` `safetyUsd`, `:80` `threshold`; `src/config.ts:102-108` |
| `CEX_SLIPPAGE_BPS` default 5 | `src/config.ts:105` |
| Priority fee = median of the p50 tips of the last 20 blocks (eth_feeHistory), capped by `PRIORITY_FEE_GWEI`, floor 0.001 gwei | `src/dex/chain.ts:19` `pickTip`, `:132` |

Tests (`test/upgrade-cost.test.ts`):
- A $100, 8 bps fee trade: a 0.50% gross gap passes and a 0.20% gap fails.
- A fake +22 bps DEX_BUY disappears at the 1.0022 rate.
- A 0.002 symbol fee beats the 0.0005 override.
- Tip selection.
- Engine: a stale or out-of-range USDC/USDT rate means no trading.

**Note: the prompt's "0.40% passes" does not hold with its own defaults.** At $100 the break-even is about 0.49% plus gas:
- the $0.25 floor = 25 bps
- MEXC fee: 8 bps
- slippage: 5 bps
- safety: 10 bps

The test asserts the real numbers, and it also checks that 0.40% fails.

## 2) Opportunity and execution logging, KPIs, realistic paper fills

| What | Where |
|---|---|
| `opportunities` table, with indexes on (token, ts) and (decision, ts) | `src/db.ts:75` (row type), `:154` (DDL) |
| Batched insert and pruning (`OPP_RETENTION_DAYS`, runs every 6 h) | `src/db.ts:212`, `:219`; `src/main.ts:268` |
| Written for EVERY evaluated candidate, paper and live. Decisions: trade, below_hurdle, inventory, rule, gas, rate_limited, paused. Paused and gas rows: at most one per token per minute | `src/engine.ts:463` `evalAt`, `:340` flush, `:356` `logBlocked` |
| `legs` table: quoted vs filled price, slippage_bps, DEX min/real out, gas used/price, MEXC executed qty, average price, fee and fee asset (`/api/v3/myTrades`), latency for quote / sign / inclusion / MEXC ack | `src/db.ts:98`; `src/engine.ts:948` `recordLegs`; `src/mexc/rest.ts:243` `myTrades`; `src/dex/txsender.ts:37` |
| Paper realism: re-quote both legs after `PAPER_LATENCY_MS` (default 1000) and book `requoted_net`; `expected_net` is kept | `src/engine.ts:904` `recordPaper`, `:925` `requote` |
| KPIs: opportunities per token, minutes per day with gross ≥ 20/35/50 bps, gap histogram per token and per Dhaka hour, would-have PnL at 20/30/40/60 bps hurdles (one trade per token, direction and minute), realized − expected, gas share, one-sided rate, inventory skew | `src/kpi.ts:25` `computeKpis`, `:89` `formatKpis`; `src/summary.ts:20` (23:00 summary) |
| `npm run report -- <hours> <mode> --csv` | `src/report.ts:1`; `src/kpi.ts:118` |

Tests: `test/engine.test.ts` covers:
- every candidate is logged;
- trade and paused decisions;
- legs rows;
- paper booked at the re-quote.

`test/upgrade-kpi.test.ts` covers minutes-above, would-have PnL, the hourly breakdown and the CSV.

**Not done:** `l1_fee` is stored as null. ethers' receipt does not expose the OP-stack L1 fee, so on Base the gas cost of a trade is slightly understated in `legs`. The balance-based PnL still includes it.

## 3) Configurable chain, Base first

| What | Where |
|---|---|
| `CHAIN=ethereum\|base\|bsc\|arbitrum` (default ethereum). Each profile holds the chain id, stable address, wrapped native, MEXC native symbol, Kyber and DexScreener names, MEXC network matcher and tick cadence | `src/chains.ts:32`; `src/config.ts:35` |
| Hard-coded mainnet values removed: provider chain id and `chainId` in sign (`src/dex/chain.ts:43`, `:58`); the mainnet USDC default; `'ETHUSDT'` (`src/engine.ts:287`); `ethNetwork` → `networkFor` (`src/chains.ts:86`, `src/watchlist.ts:65`); the DexScreener chain filter (`src/watchlist.ts:37`); the WETH smoke test | (as listed) |
| Both RPCs are checked against the chain id at startup. Stable decimals are read on-chain (BSC USDT has 18) and used in the engine and balance snapshots | `src/main.ts:122`; `src/inventory.ts:14` |
| Spender allowlist per chain: 0x AllowanceHolder, 1inch v6 and Kyber MetaAggregationRouterV2 have the same address on all four chains | `src/dex/aggregator.ts:43` |
| Timer ticks on fast chains (`TICK_MS`, default 1000 on Base, BSC and Arbitrum); never overlapping | `src/main.ts:241` |
| `npm run networks` (read-only): per network, the count of USDT-listed tokens with deposit + withdraw + contract, and what each CHAIN profile matches | `scripts/networks.ts:1` |
| One pm2 app per chain (`BOT_CHAINS=base`) with its own `data/<chain>.sqlite` | `ecosystem.config.cjs:2`; default `DB_PATH` per chain in `src/config.ts` |
| Transfer strategy is restricted to `CHAIN=ethereum` | `src/config.ts` |

Tests (`test/upgrade-chain.test.ts`):
- defaults are unchanged;
- Base and BSC profiles;
- unknown chain refused, transfer on an L2 refused;
- `networkFor` per chain;
- DexScreener chain filter;
- same AllowanceHolder.

**Not verified:** MEXC's exact network names for Base and Arbitrum. The matchers are patterns, so run `npm run networks` before trading a new chain.

## 4) Better prices with rate limits

| What | Where |
|---|---|
| `Kyber` aggregator: GET `/{chain}/api/v1/routes`, then POST `/route/build` (`slippageTolerance` in bps, `sender` = `recipient` = our wallet, deadline +120 s). `routerAddress` is pinned to MetaAggregationRouterV2 | `src/dex/aggregator.ts:221`, `:43` |
| `DEX_AGGREGATOR` can be a list (`0x,kyber`). `BestOf` prices with all of them and executes with the best firm quote **after gas**: the engine converts gas into output-token units every tick | `src/config.ts:25`; `src/main.ts:104`; `src/dex/aggregator.ts:335`; `src/engine.ts:311`, `:372` |
| `fees.zeroExFee` is counted as a cost (buy-token or sell-token fee), because no real response proves `buyAmount` is already net | `src/dex/aggregator.ts:64` |
| Token bucket per aggregator (0x 4 rps, Kyber 3 rps (public limit per Kyber's docs), 1inch 1 rps); a 429 blocks for Retry-After; over-budget scans are logged as `rate_limited` | `src/dex/aggregator.ts:279`, `:306` |
| Multi-size: base size = `BASE_TRADE_USD` (default MAX/2). When its gross gap is ≥ `MULTISIZE_TRIGGER` (0.7) × the hurdle, 0.5× and 2× are tried too (within inventory and MAX_TRADE_USD). The highest net wins | `src/engine.ts:427` `candidates`, `:447` |

Tests:
- `test/upgrade-quotes.test.ts`: Kyber price and build parsing, router pin, slippage in bps and recipient; 0x fee; token bucket and 429 blocking; best-after-gas; all-limited → `QuoteBudgetError`.
- `test/engine.test.ts`: the multi-size quotes are $100, $50 and $200, and the $200 size wins.

**Deviation:** Kyber's documented public limit is 3 rps, so the Kyber default is 3, not the prompt's 4.

## 5) Inventory sizing, skewed thresholds, rebalance tickets

| What | Where |
|---|---|
| `INVENTORY_PER_SIDE_X` (3) target per side; a side below 1× the trade size is "low"; warning when token holdings exceed `MAX_TOKEN_SHARE_PCT` (50%) of the portfolio | `src/inventory.ts:91` `inventoryPlan`; `src/config.ts:72` |
| Skewed hurdle: `need × (1 + SKEW_K × worsening)`; a trade that restores balance gets `need × 0.8`, never below the floor | `src/engine.ts:394` `needFor` |
| Rebalance tickets: a side low for `REBALANCE_AFTER_MIN` (30) gets ONE Telegram ticket (asset, amount, "deposit wallet→MEXC" or "withdraw MEXC→wallet <address> (in the MEXC app)"), logged in `rebalance_tickets`, shown in `/status`, closed when the side recovers. The bot moves no funds | `src/engine.ts:555`; `src/db.ts:168`, `:228`; `src/commands.ts:50` |
| Hourly `inventory_snapshots` (feeds the skew KPI) | `src/engine.ts:555` |

Tests:
- `test/engine.test.ts`: skewed hurdle (×1.075 vs ×0.8); one ticket and one alert.
- `test/upgrade-kpi.test.ts`: plan sides and token-share warning.
