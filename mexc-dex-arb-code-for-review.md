# mexc-dex-arb: full source for review

## `package.json`

```
     1	{
     2	  "name": "mexc-dex-arb",
     3	  "version": "1.0.0",
     4	  "private": true,
     5	  "description": "MEXC spot <-> Ethereum DEX (0x / 1inch) inventory arbitrage bot",
     6	  "type": "module",
     7	  "engines": {
     8	    "node": ">=20"
     9	  },
    10	  "scripts": {
    11	    "build": "tsc -p tsconfig.json",
    12	    "start": "node dist/main.js",
    13	    "dev": "tsx src/main.ts",
    14	    "report": "node dist/report.js",
    15	    "test": "tsx --test test/*.test.ts",
    16	    "typecheck": "tsc -p tsconfig.json --noEmit",
    17	    "check:0x": "tsx scripts/check-0x-quote.ts",
    18	    "networks": "tsx scripts/networks.ts"
    19	  },
    20	  "dependencies": {
    21	    "better-sqlite3": "^12.0.0",
    22	    "dotenv": "^16.6.1",
    23	    "ethers": "6.17.0",
    24	    "ws": "^8.18.3"
    25	  },
    26	  "devDependencies": {
    27	    "@types/better-sqlite3": "^7.6.13",
    28	    "@types/node": "^20.19.0",
    29	    "@types/ws": "^8.18.1",
    30	    "tsx": "^4.20.0",
    31	    "typescript": "^5.9.0"
    32	  }
    33	}
```

## `tsconfig.json`

```
     1	{
     2	  "compilerOptions": {
     3	    "target": "ES2022",
     4	    "module": "NodeNext",
     5	    "moduleResolution": "NodeNext",
     6	    "outDir": "dist",
     7	    "rootDir": "src",
     8	    "strict": true,
     9	    "esModuleInterop": true,
    10	    "skipLibCheck": true,
    11	    "sourceMap": true
    12	  },
    13	  "include": ["src"]
    14	}
```

## `.gitignore`

```
     1	node_modules/
     2	dist/
     3	data/
     4	logs/
     5	.env
```

## `.env.example`

```
     1	# Copy to .env, fill in, then: chmod 600 .env
     2	# The bot refuses to start in live mode if .env is readable by other users.
     3	
     4	# paper (default: no orders, no transactions) | live (real money)
     5	# Run paper for at least 7 days first, then live with MAX_TRADE_USD=50.
     6	MODE=paper
     7	
     8	# inventory = hold tokens on both sides, trade both legs at the same moment (default, NO withdrawals)
     9	# transfer  = buy on MEXC -> WITHDRAW to wallet -> sell on DEX. Needs a withdraw-enabled MEXC key and
    10	#             an unhedged position for 5-60+ min. Refuses to start unless ALLOW_WITHDRAWALS=yes.
    11	STRATEGY=inventory
    12	
    13	# ethereum | base | bsc | arbitrum  (one chain per process; pm2: BOT_CHAINS=base pm2 start ecosystem.config.cjs)
    14	# Run `npm run networks` first: it shows which MEXC tokens can be deposited/withdrawn on each chain.
    15	# One MEXC account = one chain: two chains on the same account share balances but keep separate
    16	# loss limits and inventory caps, so each can spend the full daily budget (round-3, M2).
    17	CHAIN=ethereum
    18	# Optional: override the chain's default DEX stable (USDC on Ethereum/Base/Arbitrum, USDT on BSC).
    19	# STABLE_ADDRESS=
    20	# Fast chains scan on a timer (Base/BSC/Arbitrum default 1000 ms); Ethereum scans once per block.
    21	# TICK_MS=1000
    22	ALLOW_WITHDRAWALS=no
    23	
    24	# Unlimited token approval (MaxUint256) instead of exact-amount approval: the first sale of a
    25	# token approves once, later sales skip the approve tx (~12s saved per sale). Risk: a compromised
    26	# spender contract could drain the whole token balance from the wallet. Default no (exact approvals).
    27	UNLIMITED_APPROVAL=no
    28	
    29	# ---------- Ethereum ----------
    30	# Your own RPC (Alchemy / Infura / QuickNode). Used for reading and simulation.
    31	# Must be the same chain as CHAIN (the bot checks the chain id at startup).
    32	RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
    33	# Private RPC for sending (never the public mempool): MEV Blocker or Flashbots Protect.
    34	# These are Ethereum mainnet only: on Base/BSC/Arbitrum point SEND_RPC_URL at a private RPC for
    35	# THAT chain (or the chain's own RPC). The bot fails loudly at startup if the chain id mismatches.
    36	SEND_RPC_URL=https://rpc.mevblocker.io
    37	# SEND_RPC_URL=https://rpc.flashbots.net/fast
    38	# NEW hot wallet used only by this bot. Keep only the trading inventory in it.
    39	PRIVATE_KEY=
    40	
    41	# ---------- DEX aggregator ----------
    42	# 0x (https://dashboard.0x.org) or 1inch (https://portal.1inch.dev)
    43	# One or several: 0x, kyber, 1inch. With several (e.g. 0x,kyber) the best quote AFTER gas is used.
    44	# Kyber needs no API key. Each aggregator has its own quote budget (calls per second):
    45	DEX_AGGREGATOR=0x
    46	KYBER_CLIENT_ID=mexc-dex-arb
    47	QUOTE_RPS_0X=4
    48	QUOTE_RPS_KYBER=3
    49	QUOTE_RPS_1INCH=1
    50	ZEROX_API_KEY=
    51	ONEINCH_API_KEY=
    52	
    53	# ---------- MEXC ----------
    54	# API key: Spot TRADE permission ONLY. NO withdraw permission. IP-whitelisted to your VPS.
    55	# (Only for STRATEGY=transfer + ALLOW_WITHDRAWALS=yes would withdraw be needed - not recommended.)
    56	MEXC_API_KEY=
    57	MEXC_API_SECRET=
    58	MEXC_TAKER_FEE=0.0005
    59	
    60	# ---------- Telegram ----------
    61	# Create a bot with @BotFather, send it any message, then get your chat id from
    62	# https://api.telegram.org/bot<TOKEN>/getUpdates  (message.chat.id)
    63	TELEGRAM_BOT_TOKEN=
    64	TELEGRAM_CHAT_ID=
    65	# Your own Telegram user id (message.from.id). Commands are obeyed only from this user, in a private chat.
    66	TELEGRAM_ADMIN_ID=
    67	
    68	# ---------- Watchlist ----------
    69	# Optional: only these tokens (MEXC base symbols). Empty = auto-discover by volume.
    70	WATCHLIST=
    71	WATCHLIST_MAX=8
    72	MIN_DEX_TVL_USD=200000
    73	MIN_MEXC_VOLUME_USD=500000
    74	
    75	# ---------- Profit rules ----------
    76	# Trade only if net > max(MIN_PROFIT_USD, MIN_PROFIT_BPS of size). net already subtracts the per-symbol
    77	# MEXC taker fee (exchangeInfo), DEX fees, gas, CEX slippage and the safety margin.
    78	MIN_PROFIT_USD=0.25
    79	MIN_PROFIT_BPS=20
    80	DEX_SLIPPAGE_BPS=30
    81	CEX_SLIPPAGE_BPS=5
    82	# safety margin = max(SAFETY_MARGIN_USD, SAFETY_MARGIN_BPS of size)
    83	SAFETY_MARGIN_USD=0
    84	SAFETY_MARGIN_BPS=10
    85	# A CAP: the tip used is the median of recent blocks' tips (eth_feeHistory), at most this.
    86	PRIORITY_FEE_GWEI=1
    87	# OP-stack L1 data fee reserve (USD) added to every gas estimate. 0 on Ethereum/Arbitrum.
    88	# On Base, set it to a typical legs.l1_fee from a past trade (usually a few cents).
    89	L1_FEE_USD=0
    90	# Floor for the MEXC taker fee; the bot uses max(this, the symbol's own fee: most pairs 0.08%, some 0.20%).
    91	# MEXC_TAKER_FEE=0.0005
    92	
    93	# ---------- Risk limits ----------
    94	MAX_TRADE_USD=50
    95	# Multi-size quoting: base size (default MAX_TRADE_USD/2); 0.5x and 2x are also tried when the base size's
    96	# gross gap reaches MULTISIZE_TRIGGER x the hurdle.
    97	# BASE_TRADE_USD=25
    98	MULTISIZE_TRIGGER=0.7
    99	MIN_TRADE_USD=25
   100	MAX_TRADES_PER_DAY=20
   101	DAILY_LOSS_LIMIT_USD=30
   102	# Skip a trade if losing this % of its size (+ gas) would break what is left of the daily loss budget
   103	WORST_CASE_LOSS_PCT=5
   104	MAX_GAS_GWEI=40
   105	MAX_CONSECUTIVE_FAILS=3
   106	MIN_ETH_FOR_GAS=0.01
   107	TX_TIMEOUT_SEC=60
   108	
   109	# ---------- Transfer strategy ----------
   110	SCAN_INTERVAL_SEC=20
   111	# Cheap pre-filter (MEXC ask vs DexScreener price) before exact quotes
   112	SCAN_MIN_GAP_PCT=3
   113	# Bigger "gaps" are almost always a wrong token or a dead pool
   114	SCAN_MAX_GAP_PCT=30
   115	SCAN_EXACT_QUOTES=5
   116	# Price-move reserve while the withdrawal travels (150 = 1.5%)
   117	TRANSFER_DRIFT_BPS=150
   118	TRANSFER_TIMEOUT_MIN=90
   119	MAX_OPEN_TRANSFERS=1
   120	# On arrival, do not auto-sell at more than this % loss vs the MEXC cost: hold + alert (/sell <id> forces)
   121	TRANSFER_MAX_LOSS_PCT=3
   122	
   123	# ---------- Monitoring and inventory (phase 1) ----------
   124	# Fast chains log every evaluation (100k+ rows/day on Base): keep 7 days, not 30 (~1-2 GB at 30).
   125	# The report only looks back 7 days. Pruning runs at startup and every 6 h.
   126	OPP_RETENTION_DAYS=7
   127	# Paper mode books the net after this delay + a re-quote (not the first quote)
   128	PAPER_LATENCY_MS=1000
   129	INVENTORY_PER_SIDE_X=3
   130	MAX_TOKEN_SHARE_PCT=50
   131	SKEW_K=0.75
   132	REBALANCE_AFTER_MIN=30
   133	
   134	# Default: data/<CHAIN>.sqlite (one database per chain)
   135	# DB_PATH=data/ethereum.sqlite
```

## `ecosystem.config.cjs`

```
     1	// pm2 start ecosystem.config.cjs
     2	// One pm2 app per chain, each with its own database. Choose the chains with BOT_CHAINS, e.g.
     3	//   BOT_CHAINS=base pm2 start ecosystem.config.cjs
     4	//   BOT_CHAINS=ethereum,base pm2 start ecosystem.config.cjs
     5	// Each app reads the same .env; CHAIN and DB_PATH are set per app here (they override .env).
     6	//
     7	// WARNING (round-3 review, M2): two chains on ONE MEXC account share the same balances and hot
     8	// wallet, but each keeps its own risk state (daily loss limit, trade count, fail streak, inventory
     9	// caps). Both processes can commit the same inventory and each can spend the full daily loss
    10	// budget. Run one chain per MEXC account, or accept that the limits are per-process, not shared.
    11	const chains = (process.env.BOT_CHAINS || 'ethereum')
    12	  .split(',')
    13	  .map((c) => c.trim())
    14	  .filter(Boolean);
    15	
    16	module.exports = {
    17	  apps: chains.map((chain) => ({
    18	    name: `mexc-dex-arb-${chain}`,
    19	    script: 'dist/main.js',
    20	    cwd: __dirname,
    21	    env: { CHAIN: chain, DB_PATH: `data/${chain}.sqlite` },
    22	    autorestart: true,
    23	    // Keep restarting (with growing delay) instead of giving up silently after a few crashes.
    24	    max_restarts: 1000,
    25	    min_uptime: '60s',
    26	    exp_backoff_restart_delay: 5000,
    27	    // pm2 sends SIGKILL 1.6 s after SIGINT by default, which would kill the bot halfway through a trade.
    28	    // The bot waits up to TX_TIMEOUT_SEC*2+60 s (max 220 s) for a running trade, so give it 240 s.
    29	    kill_timeout: 240000,
    30	    time: true,
    31	    out_file: `logs/${chain}.out.log`,
    32	    error_file: `logs/${chain}.error.log`,
    33	  })),
    34	};
```

## `CHANGES.md`

```
     1	# Unlimited approval (owner decision, Muse, 2026-11-21)
     2	
     3	Yahia asked for unlimited token approval so sales no longer wait for an approve tx (~12s per
     4	sale). Every sale used to approve exactly the sell amount, so the allowance was spent and the
     5	next sale needed a fresh approve transaction. Now `UNLIMITED_APPROVAL=yes` approves MaxUint256
     6	once per token per spender; later sales skip the approve tx entirely (the allowance check in
     7	`approveExact` already returns early when the allowance covers the amount).
     8	
     9	Risk, stated to Yahia before he said yes: a compromised spender contract could drain the whole
    10	token balance from the wallet — exact approvals capped the exposure at one trade's amount. This
    11	overrides HANDOVER §4 rule "Approvals are exact amounts, never MaxUint256" by explicit owner
    12	decision (same pattern as the v4.68 AI-gate removal). Default stays off (exact approvals);
    13	only the live twin's `ecosystem.live.config.cjs` sets `UNLIMITED_APPROVAL: 'yes'`. The paper
    14	bot is unaffected (paper never sends real approvals).
    15	
    16	| Item | Where (file:line) | Tests |
    17	|---|---|---|
    18	| `UNLIMITED_APPROVAL` flag (default `no`) | `src/config.ts` `unlimitedApproval` (after `maxGasGwei`); `src/main.ts:112` passes `cfg.unlimitedApproval` into `new Chain(...)`; `.env.example` documents it with the risk warning | `test/infra.test.ts` "UNLIMITED_APPROVAL defaults to off (exact approvals); yes turns it on" |
    19	| Approval policy | `src/dex/chain.ts` `MAX_UINT256` + pure `approvalAmount(unlimited, amount)`; `approveExact` approves that target (the reset-to-zero step for USDT-style tokens is unchanged); `approvalGasNeeded` needs no change (allowance >= amount already returns 0) | `test/chain.test.ts` (new): exact by default, MaxUint256 when on; MAX_UINT256 is 2^256 - 1. Full suite 138 tests pass (135 + 3 new). |
    20	| Live twin turns it on | `ecosystem.live.config.cjs` `UNLIMITED_APPROVAL: 'yes'` (pm2 env wins over `.env`, which has no such key so the default `no` applies elsewhere) | (config; running-process env to be verified after the restart) |
    21	
    22	# Live twin -> transfer mode, CEX->DEX only (Muse, 2026-11-21)
    23	
    24	Yahia asked for the live twin to buy on MEXC, withdraw to the hot wallet, and sell on the DEX —
    25	transfer mode, CEX->DEX only. Two things were already true and needed no change: transfer mode is
    26	CEX->DEX only by design (`src/transfer.ts:1-3` header: buy cheaper on MEXC -> withdraw -> sell on
    27	Ethereum DEX; there is no DEX->CEX direction), and the MEXC withdraw fee is already paid from the
    28	bought token (`src/transfer.ts` `evaluate()`: `arriving = plan.tokensToSell - withdrawFee`; the
    29	arrival check uses the fee MEXC actually charged from its history). What was missing: transfer
    30	mode scanned EVERY MEXC ERC20 token, ignoring the live proven-only rule (NPC + BGB). Fixed below.
    31	Defaults are unchanged (`MODE=paper`, `STRATEGY=inventory`, `ALLOW_WITHDRAWALS=no`); only the live
    32	twin's `ecosystem.live.config.cjs` switches to `STRATEGY=transfer` + `ALLOW_WITHDRAWALS=yes`.
    33	`tsc --noEmit` passes, `npm test` passes all 132 tests (128 before + 4 new). NOT restarted live
    34	yet: the MEXC API key still needs Withdraw permission + withdrawal-address whitelist = hot wallet
    35	only, which only Yahia can enable on MEXC. Restarting before that would buy on MEXC, fail the
    36	withdraw, and sell back at a small loss per cycle.
    37	
    38	| Item | Where (file:line) | Tests |
    39	|---|---|---|
    40	| Transfer universe honours the live proven-only rule | `src/transfer.ts:82` optional `provenFilter` dep; `:155` applied in `refreshUniverse()` on every rescan (newly proven tokens join live without a restart); `src/main.ts:368` wires it for live mode from `paperDb.paperTokenStats()` with the same `LIVE_MIN_PAPER_TRADES` / `LIVE_MIN_PAPER_PNL_USD` / `LIVE_WATCHLIST_MAX` knobs as inventory live; `src/watchlist.ts:72` `provenTokens` generalised to `{ base: string }[]` so it works for both `Token[]` and `ScanToken[]` | `test/transfer.test.ts` "provenFilter restricts the transfer universe to proven tokens only" (XYZ kept, ABC dropped); "no provenFilter scans every token that passes the base filters"; "provenFilter re-applies on rescan, so newly proven tokens join live" |
    41	| Empty proven list waits instead of crash-looping | `src/transfer.ts:101` `provenFilteredEmpty` flag (`:157` set when the filter empties a non-empty universe; `:158` throttled warning); `src/main.ts:374` startup warns on Telegram and keeps running instead of throwing when only the proven list is empty (a truly empty universe still throws) | `test/transfer.test.ts` "provenFilter empty waits instead of trading (provenFilteredEmpty)" (`tick()` with an empty universe does not throw or trade) |
    42	| Live twin config -> transfer | `ecosystem.live.config.cjs:17` `STRATEGY: 'transfer'`; `:18` `ALLOW_WITHDRAWALS: 'yes'` (pm2 env wins over the shared `.env`, which still says `STRATEGY=inventory` / `ALLOW_WITHDRAWALS=no` — same precedence as `MODE=live` already proven by the running live twin); `src/main.ts` "Bot started" message now lists the scanned tokens | (config; running-process env to be verified after the restart) |
    43	| Telegram mode tag: every message starts with 📝 PAPER or 🔴 LIVE — আসল টাকা | `src/telegram.ts` optional `tag` constructor param; `send()` prepends it as the first line (a text that already starts with the tag is not doubled, so the existing `📝 PAPER …` trade lines stay as they are); `src/main.ts` passes `🔴 LIVE — আসল টাকা` for live and `📝 PAPER` for paper, including the startup-failure message | `test/telegram.test.ts` (new): tag prepended as first line; no doubling when already present; no tag = unchanged. Full suite 135 tests pass. |
    44	
    45	# Round-3 review fixes (Muse, 2026-11-21)
    46	
    47	Muse's round-3 review (`REVIEW_PROMPT_R3.md`, delivered 2026-11-21 ~08:49) was re-verified against the
    48	repo code and official docs / live public data. Every finding below was checked; the confirmed ones are
    49	fixed here, the rejected ones are listed at the bottom. Defaults are unchanged: `MODE=paper`,
    50	`STRATEGY=inventory`, `ALLOW_WITHDRAWALS=no`, `MAX_TRADE_USD=50`. Nothing was run live.
    51	`tsc --noEmit` passes, and `npm test` passes all 126 tests (112 before + 14 new).
    52	
    53	| # | Item | Where (file:line) | Tests |
    54	|---|---|---|---|
    55	| M1 | Base L1 data fee was missing from all gas math | `src/dex/txsender.ts:58` `rawReceipt?` on TxBackend; `:270` `result()` adds the raw receipt's `l1Fee` to `gasCostWei` and reports `l1FeeWei` (`:39`); `src/dex/chain.ts:57` implements `rawReceipt` via `eth_getTransactionReceipt` (ethers has no l1Fee field); `src/engine.ts:980` legs now store `l1_fee` instead of null; `src/config.ts:120` `L1_FEE_USD` reserve (default 0, `:174` range-checked) added to every gas estimate via `src/engine.ts:374` `estGasUsd` (`:380` gasValuer, `:498` / `:531` evalAt, `:675` execute re-check, `:940` requote) and `src/transfer.ts:272`; `.env.example:84` documents how to measure it from `legs.l1_fee` | `test/txsender.test.ts` "mined tx on an OP chain" (gas 1200n incl. L1 1000n) + "raw receipt failure" (L1 = 0, still ok); `test/engine.test.ts` "L1_FEE_USD reserve lowers the estimated net" (net drops exactly $2); `test/infra.test.ts` "L1_FEE_USD defaults to 0" |
    56	| M2 | Two chains on one MEXC account share balances/wallet but keep separate risk state | Docs only: `ecosystem.config.cjs:7` warning; `.env.example:15` one-account-one-chain note; `README.md` "Running phase 1" section | (docs) |
    57	| M3 | Transfer sell checked the loss floor on the first quote only, not the firm quote after approval | `src/transfer.ts:493` `holdIfBelowFloor` helper; `:542` first-quote check; `:552` firm-quote re-check (approval gas booked on hold, `:553`) | `test/transfer.test.ts` "sell holds when the FIRM quote falls below the loss floor" (no send, still selling, $1.20 approval gas booked). Fails on the old code (verified by stashing the fix). |
    58	| M4 | Would-have PnL took MAX(net) and MAX(size) from different rows | `src/kpi.ts:53` window function: the best-net row's own size (ties: bigger size first, conservative) | `test/upgrade-kpi.test.ts` "would-have PnL uses the best row's own size". Fails on the old code. |
    59	| M5 | Opportunities table grows ~115-275k rows/day; 30-day retention ~1-2 GB | `src/config.ts:74` default 30 -> 7; `src/db.ts:162` `(ts)` index; `.env.example:121` | `test/infra.test.ts` "OPP_RETENTION_DAYS defaults to 7"; `test/upgrade-kpi.test.ts` "opportunities has a (ts) index" |
    60	| L1 | gasShareOfGross mixed populations (gas over all non-approval trades, gross over ok/paper only) | `src/kpi.ts:67` gas sum now filtered to ok/paper like gross | `test/upgrade-kpi.test.ts` "gasShareOfGross counts gas only on ok/paper trades". Fails on the old code. |
    61	| L2 | STABLE rebalance ticket named the wrong asset/direction on USDC chains | `src/inventory.ts:95` `stableSymbol` option; `:104` wallet side names the chain stable, MEXC side says "swap to USDT on MEXC" when the wallet stable is not USDT; wallet-side amount converted to stable units; `src/engine.ts:585` caller passes `cfg.chain.stable.symbol` | `test/upgrade-kpi.test.ts` "inventory plan STABLE ticket names the chain stable" (USDC + BSC cases) |
    62	| L3 | Stored expected_net excluded the approval gas already spent | `src/engine.ts:717` `expectedNet = opp.net - approval gas actually paid`; `:719` stored on the trade row; `:816` the Telegram message shows the same number | `test/engine.test.ts` "expected_net subtracts the approval gas already spent" (two identical runs, $1.20 apart). Fails on the old code. |
    63	| L4 | Hardcoded etherscan.io link in the live-trade alert | `src/chains.ts:29` `explorer` per chain (`:44` etherscan.io, `:56` basescan.org, `:68` bscscan.com, `:80` arbiscan.io); `:98` `explorerTxUrl`; `src/engine.ts:817` uses it (transfer.ts links stay etherscan.io: transfer is ethereum-only) | `test/upgrade-chain.test.ts` "explorerTxUrl uses the chain's own explorer"; `test/engine.test.ts` profitable-gap test asserts the etherscan link |
    64	| L5 | SEND_RPC_URL default is Ethereum-mainnet-only (MEV Blocker / Flashbots) | Docs only: `.env.example:29` note (other chains need their own private RPC; startup fails loudly on chain-id mismatch) | (docs) |
    65	| L7c | STABLE_ADDRESS override did not update stableIsUsdt | `src/chains.ts:92` `stableSymbolFor` (known-address lookup, falls back to the chain default); `src/config.ts:54` derives `stableIsUsdt` from the resolved address | `test/upgrade-chain.test.ts` "STABLE_ADDRESS override also flips stableIsUsdt" (both directions + unknown-address fallback) |
    66	| L7f | BestOf gasInOutput was never set in transfer mode | `src/transfer.ts:169` set in `tick()` after the stable rate is known (buy token is always the stable) | `test/transfer.test.ts` "transfer mode sets BestOf gasInOutput" (wiring + $3.00 for 150k gas at 10 gwei / $2000 ETH) |
    67	
    68	## Rejected (verified, no change)
    69	
    70	- **L6 — Kyber "public limit 3 rps": CORRECT, no change.** Muse's round-3 review had called this unverified;
    71	  re-checking found it in Kyber's official docs (kyberswap-documentation,
    72	  `developer-guide/start-here/rate-limits-and-client-id.md`: "Public rate limits are 3 rps for the
    73	  Aggregator API"). The code's comment and CHANGES_UPGRADE.md were right.
    74	- **L7a** (multi-size trigger at 0.7x the net hurdle fires often), **L7b** (pickTip falls back to the CAP
    75	  when eth_feeHistory fails), **L7d** (no opportunity rows while the stable rate is stale), **L7e**
    76	  (lowSince is in-memory, a restart restarts the rebalance clock): by design, no change. Tickets
    77	  themselves are DB-persisted, and the pickTip fallback is fail-safe.
    78	- **M1 scope note:** the L1-fee estimate side is a reserve knob (`L1_FEE_USD`, default 0), not a live
    79	  oracle read: at estimate time there is no tx yet to feed `GasPriceOracle.getL1Fee`. The receipt side
    80	  now measures the real fee, so the reserve can be set from observed `legs.l1_fee` values.
    81	
    82	# Changes for Grok's round-2 fix prompt
    83	
    84	Defaults are unchanged: `MODE=paper`, `STRATEGY=inventory`, `ALLOW_WITHDRAWALS=no`, `MAX_TRADE_USD=50`.
    85	Nothing was run live. `tsc --noEmit` passes, and `npm test` passes all 83 tests.
    86	
    87	Note: Grok reviewed the 57-test version. Muse's round-2 fixes (commit `04b9c84`) had already covered
    88	part of these items. The lines below are where each item lives now.
    89	
    90	| # | Item | Where (file:line) | Tests |
    91	|---|---|---|---|
    92	| 1 | Nonce gap after a failed broadcast | `src/dex/txsender.ts:68` `classifySendError`; `:214` a definite rejection rolls back the nonce and returns `rejected`, never `unknown`; `:151` `readyToSend()` refuses while a tx is unresolved and resets a local nonce that ran ahead of the chain; `src/engine.ts:448` calls `readyToSend()` before the MEXC leg | `test/txsender.test.ts` (rejection keeps nonce 5, 5); `test/grok-r2.test.ts` "1) readyToSend"; `test/engine.test.ts` "nonce not ready: the MEXC leg never fires" |
    93	| 2 | `/start confirm` must not clear a pending tx | `src/commands.ts:55` `makeUnresolvedCheck`: refuses while pending ("outcome still unknown; use /cancelnonce or wait") and resets the nonce when clear; `src/dex/txsender.ts:168` `cancelNonce()` (2x fee, private + public RPC, waits up to 10 min, reports which hash won); `/cancelnonce` registered in `src/main.ts` for both strategies; `src/engine.ts:494` new alert text "Do NOT hedge by hand until the nonce is consumed"; `src/engine.ts:284` `reportResolved` alerts with `executedHash` / `ok` and notes it on the trade row (says so explicitly when there is no receipt) | `test/grok-r2.test.ts` "2) /start confirm is refused while a tx is pending; when clear it resets the nonce" |
    94	| 3 | Save the pending tx and restore it at startup | `src/dex/txsender.ts:207`: every tx is persisted as in flight when it is signed, BEFORE broadcast, and cleared when mined or rejected. The cancel hash is added too. It lives in the SQLite `state` table (`unresolved_tx`), not a separate `pending_tx` table. Only one tx is ever in flight, because sends are blocked while one is unresolved. On restart `checkUnresolved()` runs inside `recoverExecuting` (`src/recovery.ts:28`, called from `src/main.ts:143`). A pending one triggers a critical pause and an alert, and nothing trades until the nonce is used | `test/grok-r2.test.ts` "3) a tx is recorded as in flight BEFORE broadcast"; `test/txsender.test.ts` "restart with a pending tx"; `test/engine.test.ts` "recovery: a pending DEX tx ... keeps the bot critically paused" |
    95	| 4 | MEXC order settled after a cancel | `src/engine.ts:48` `cancelAndConfirm` (the "cancelAndSettle" of the prompt): it cancels and re-reads until the order is FILLED / CANCELED / PARTIALLY_CANCELED, otherwise it throws `OrderStillOpenError`. Used in `cexLeg`, where it becomes `UNKNOWN_ORDER_STATE` (critical pause, no unwind), in `closeAtMarket` (`src/engine.ts:590`), in transfer `finishBuy`, and in the transfer MEXC sell | `test/infra.test.ts` "cancelAndConfirm: never reports a still-open order as closed" (cancel throws and stays NEW; late cancel) |
    96	| 5 | pm2 kill timeout | `ecosystem.config.cjs:15` `kill_timeout: 240000`; `src/main.ts:59` the shutdown waits `TX_TIMEOUT_SEC*2*1000 + 60000`; `src/config.ts:126` caps TX_TIMEOUT_SEC at 80, so the wait (at most 220 s) is always below kill_timeout. SIGINT and SIGTERM are both handled | (config) |
    97	| 6 | Recovery of open MEXC orders and close orders | `src/db.ts:129` `appendCid` (new column `trades.cids`, a JSON array); `src/engine.ts:458` records the entry cid, and `closeAtMarket` records every close cid BEFORE placing it; `src/recovery.ts:28` looks up every cid, cancels and settles any order that is still open, and reports the final status and qty; `src/recovery.ts:95` + `src/mexc/rest.ts:241` `openOrders` sweep the watched symbols for orders with the bot prefix `arb`. The critical pause is kept | `test/grok-r2.test.ts` "6) recovery cancels a close order that is still open and sweeps open bot orders" |
    98	| 7 | Unknown approval and silent stalls | `src/engine.ts:390` "approval outcome UNKNOWN, nonce N, hashes …" (no longer "Approval failed"); `src/engine.ts:223` hourly alert when a tx has been unresolved for more than 10 min, with nonce, hashes and a `/cancelnonce` hint | (covered by the engine paths above) |
    99	| 8 | PERCENT_PRICE_BY_SIDE | `src/mexc/rules.ts`: `priceBand` is parsed from `filters` (default 0.2); `:44` `closePrice` = `min(ask*1.02, ref*(1+0.8*band))` for BUY and `max(bid*0.98, ref*(1-0.8*band))` for SELL, with ref = mid of a fresh book, rounded in the safe direction (with a float epsilon); `:54` `bandProblem`; `src/engine.ts:445` rejects an entry outside the band | `test/grok-r2.test.ts` "8) a 0.5% band clamps the close price", "8) an entry limit outside the band is rejected" |
   100	| 9 | placeSafely "not found" logic | `src/mexc/rest.ts:234`: null ONLY for parsed MEXC code `-2011`, the text regex is removed and every other error is rethrown; `src/engine.ts:84` looks up over 1, 2, 3 and 4 s, and if still not found after an ambiguous error (5xx / timeout) the result is `UNKNOWN_ORDER_STATE`, never "not placed" | `test/grok-r2.test.ts` "9) ... 'currency does not exist' is rethrown", "9) placeSafely: a 5xx followed by 'not found' is UNKNOWN_ORDER_STATE" |
   101	| 10a | PnL | `src/engine.ts:562` `stableBalances`: reads until two consecutive reads match (up to about 15 s), otherwise the note says "pnl approximate" | (engine tests) |
   102	| 10b | Transfer sell without MARKET | `src/transfer.ts:597`: uses the aggressive banded LIMIT plus `cancelAndConfirm` when the symbol has no MARKET | (transfer tests) |
   103	| 10c | Retry-After | `src/mexc/rest.ts:134` `RateLimitError.retryAfterSec` from the header; `src/main.ts:28` backs off for at least that long | (none) |
   104	| 10d | 0x firm-quote check | `scripts/check-0x-quote.ts:1`, run with `npm run check:0x`. It signs and sends nothing, and prints only `transaction.to`, `allowanceTarget` and `issues` | not run (no key in this environment) |
   105	| 10e | Recovery booking | Rows recovered as `one_sided` carry "pnl unknown"; `src/db.ts:142` `unresolvedTrades()`; `/status` lists them; `src/commands.ts:36` `/resolve <id> <pnl>` books the PnL, which then counts in the daily loss budget | `test/grok-r2.test.ts` "10e) /resolve" |
   106	
   107	## Deviations from the prompt (and why)
   108	- **Item 3:** the in-flight tx is persisted in the existing `state` table rather than a new `pending_tx`
   109	  table. Sends are serialized (nothing new is sent while a tx is unresolved), so there is at most one nonce
   110	  in flight, and a single record holds all of that nonce's hashes (the tx and its cancels).
   111	- **Item 4 name:** the helper is `cancelAndConfirm`. It was added for Muse's round-2 review and does what the
   112	  prompt calls `cancelAndSettle`.
   113	- **Item 6 sweep:** `openOrders` is swept for the `WATCHLIST` symbols when `STRATEGY=inventory` and
   114	  `WATCHLIST` is set. With auto-discovery, the watchlist is not known yet when recovery runs, so only the
   115	  cids recorded on the trade rows are checked.
   116	- **IOC:** MEXC's docs list `IMMEDIATE_OR_CANCEL` as an order type, and there is no `timeInForce` parameter.
   117	  But no live symbol lists IOC in `orderTypes`, so closes stay LIMIT plus a confirmed cancel.
   118	
   119	## Not verified (no keys here)
   120	- Whether 0x `buyAmount` is already net of `zeroExFee`.
   121	- Which asset MEXC charges the buy fee in.
   122	- 1inch v6 request parameters.
   123	- Live `transaction.to`. Run `npm run check:0x` once before going live.
```

## `CHANGES_UPGRADE.md`

```
     1	# Phase-1 upgrade (Grok's UPGRADE_PROMPT): what changed, file:line
     2	
     3	Hard rules kept:
     4	- Defaults unchanged: `MODE=paper`, `STRATEGY=inventory`, `ALLOW_WITHDRAWALS=no`.
     5	- No MEXC withdrawal rights. The bot never moves funds; rebalancing is a ticket for a human.
     6	- Nothing was run live. No mempool watching, no front-running.
     7	- Keys and RPC URLs are redacted.
     8	
     9	Results: `npm run typecheck` passes and `npm test` passes **112 tests** (16 new test cases in 4 new test files, plus new cases in `test/engine.test.ts`).
    10	
    11	Verified live today (read-only, public endpoints):
    12	- MEXC `USDCUSDT` = 1.0021.
    13	- 1,368 USDT pairs: taker fee 0.08% on 941, 0.20% on 249, 0.05% on 174.
    14	- KyberSwap `/routes` on ethereum, base, bsc and arbitrum returned router `0x6131…37b5`, the address listed in Kyber's docs.
    15	- A read-only Kyber price + build on Base succeeded through the new `Kyber` class.
    16	
    17	## 1) Cost model and thresholds
    18	
    19	| What | Where |
    20	|---|---|
    21	| Per-symbol `takerCommission` / `makerCommission` from exchangeInfo into `SymbolRules` | `src/mexc/rules.ts:24` |
    22	| `max(MEXC_TAKER_FEE override, symbol fee)`, used everywhere (planCexBuy, unwindPlan, transfer) | `src/mexc/rules.ts:41` `takerFeeFor`; `src/engine.ts:199` `fee()`; `src/transfer.ts:118` |
    23	| USDC ≠ USDT: live USDCUSDT mid; no trading if the book is older than 30 s or the rate is outside 0.99–1.01; rate 1 on BSC (USDT) | `src/engine.ts:219` `refreshStableRate`; transfer: the USDCUSDT ticker check in `tick()` |
    24	| The rate is applied in `evaluateDexBuy`, `evaluateCexBuy`, `evaluateTransfer` and `portfolioUsd` | `src/pricing.ts:24` `stableInUsdt`; `src/inventory.ts:41` |
    25	| Hurdles in bps: `MIN_PROFIT_BPS=20`, `SAFETY_MARGIN_BPS=10`, with `MIN_PROFIT_USD=0.25` / `SAFETY_MARGIN_USD=0` as floors; need = max(USD, bps × size) | `src/pricing.ts:28` `safetyUsd`, `:80` `threshold`; `src/config.ts:102-108` |
    26	| `CEX_SLIPPAGE_BPS` default 5 | `src/config.ts:105` |
    27	| Priority fee = median of the p50 tips of the last 20 blocks (eth_feeHistory), capped by `PRIORITY_FEE_GWEI`, floor 0.001 gwei | `src/dex/chain.ts:19` `pickTip`, `:132` |
    28	
    29	Tests (`test/upgrade-cost.test.ts`):
    30	- A $100, 8 bps fee trade: a 0.50% gross gap passes and a 0.20% gap fails.
    31	- A fake +22 bps DEX_BUY disappears at the 1.0022 rate.
    32	- A 0.002 symbol fee beats the 0.0005 override.
    33	- Tip selection.
    34	- Engine: a stale or out-of-range USDC/USDT rate means no trading.
    35	
    36	**Note: the prompt's "0.40% passes" does not hold with its own defaults.** At $100 the break-even is about 0.49% plus gas:
    37	- the $0.25 floor = 25 bps
    38	- MEXC fee: 8 bps
    39	- slippage: 5 bps
    40	- safety: 10 bps
    41	
    42	The test asserts the real numbers, and it also checks that 0.40% fails.
    43	
    44	## 2) Opportunity and execution logging, KPIs, realistic paper fills
    45	
    46	| What | Where |
    47	|---|---|
    48	| `opportunities` table, with indexes on (token, ts) and (decision, ts) | `src/db.ts:75` (row type), `:154` (DDL) |
    49	| Batched insert and pruning (`OPP_RETENTION_DAYS`, runs every 6 h) | `src/db.ts:212`, `:219`; `src/main.ts:268` |
    50	| Written for EVERY evaluated candidate, paper and live. Decisions: trade, below_hurdle, inventory, rule, gas, rate_limited, paused. Paused and gas rows: at most one per token per minute | `src/engine.ts:463` `evalAt`, `:340` flush, `:356` `logBlocked` |
    51	| `legs` table: quoted vs filled price, slippage_bps, DEX min/real out, gas used/price, MEXC executed qty, average price, fee and fee asset (`/api/v3/myTrades`), latency for quote / sign / inclusion / MEXC ack | `src/db.ts:98`; `src/engine.ts:948` `recordLegs`; `src/mexc/rest.ts:243` `myTrades`; `src/dex/txsender.ts:37` |
    52	| Paper realism: re-quote both legs after `PAPER_LATENCY_MS` (default 1000) and book `requoted_net`; `expected_net` is kept | `src/engine.ts:904` `recordPaper`, `:925` `requote` |
    53	| KPIs: opportunities per token, minutes per day with gross ≥ 20/35/50 bps, gap histogram per token and per Dhaka hour, would-have PnL at 20/30/40/60 bps hurdles (one trade per token, direction and minute), realized − expected, gas share, one-sided rate, inventory skew | `src/kpi.ts:25` `computeKpis`, `:89` `formatKpis`; `src/summary.ts:20` (23:00 summary) |
    54	| `npm run report -- <hours> <mode> --csv` | `src/report.ts:1`; `src/kpi.ts:118` |
    55	
    56	Tests: `test/engine.test.ts` covers:
    57	- every candidate is logged;
    58	- trade and paused decisions;
    59	- legs rows;
    60	- paper booked at the re-quote.
    61	
    62	`test/upgrade-kpi.test.ts` covers minutes-above, would-have PnL, the hourly breakdown and the CSV.
    63	
    64	**Not done:** `l1_fee` is stored as null. ethers' receipt does not expose the OP-stack L1 fee, so on Base the gas cost of a trade is slightly understated in `legs`. The balance-based PnL still includes it.
    65	
    66	## 3) Configurable chain, Base first
    67	
    68	| What | Where |
    69	|---|---|
    70	| `CHAIN=ethereum\|base\|bsc\|arbitrum` (default ethereum). Each profile holds the chain id, stable address, wrapped native, MEXC native symbol, Kyber and DexScreener names, MEXC network matcher and tick cadence | `src/chains.ts:32`; `src/config.ts:35` |
    71	| Hard-coded mainnet values removed: provider chain id and `chainId` in sign (`src/dex/chain.ts:43`, `:58`); the mainnet USDC default; `'ETHUSDT'` (`src/engine.ts:287`); `ethNetwork` → `networkFor` (`src/chains.ts:86`, `src/watchlist.ts:65`); the DexScreener chain filter (`src/watchlist.ts:37`); the WETH smoke test | (as listed) |
    72	| Both RPCs are checked against the chain id at startup. Stable decimals are read on-chain (BSC USDT has 18) and used in the engine and balance snapshots | `src/main.ts:122`; `src/inventory.ts:14` |
    73	| Spender allowlist per chain: 0x AllowanceHolder, 1inch v6 and Kyber MetaAggregationRouterV2 have the same address on all four chains | `src/dex/aggregator.ts:43` |
    74	| Timer ticks on fast chains (`TICK_MS`, default 1000 on Base, BSC and Arbitrum); never overlapping | `src/main.ts:241` |
    75	| `npm run networks` (read-only): per network, the count of USDT-listed tokens with deposit + withdraw + contract, and what each CHAIN profile matches | `scripts/networks.ts:1` |
    76	| One pm2 app per chain (`BOT_CHAINS=base`) with its own `data/<chain>.sqlite` | `ecosystem.config.cjs:2`; default `DB_PATH` per chain in `src/config.ts` |
    77	| Transfer strategy is restricted to `CHAIN=ethereum` | `src/config.ts` |
    78	
    79	Tests (`test/upgrade-chain.test.ts`):
    80	- defaults are unchanged;
    81	- Base and BSC profiles;
    82	- unknown chain refused, transfer on an L2 refused;
    83	- `networkFor` per chain;
    84	- DexScreener chain filter;
    85	- same AllowanceHolder.
    86	
    87	**Not verified:** MEXC's exact network names for Base and Arbitrum. The matchers are patterns, so run `npm run networks` before trading a new chain.
    88	
    89	## 4) Better prices with rate limits
    90	
    91	| What | Where |
    92	|---|---|
    93	| `Kyber` aggregator: GET `/{chain}/api/v1/routes`, then POST `/route/build` (`slippageTolerance` in bps, `sender` = `recipient` = our wallet, deadline +120 s). `routerAddress` is pinned to MetaAggregationRouterV2 | `src/dex/aggregator.ts:221`, `:43` |
    94	| `DEX_AGGREGATOR` can be a list (`0x,kyber`). `BestOf` prices with all of them and executes with the best firm quote **after gas**: the engine converts gas into output-token units every tick | `src/config.ts:25`; `src/main.ts:104`; `src/dex/aggregator.ts:335`; `src/engine.ts:311`, `:372` |
    95	| `fees.zeroExFee` is counted as a cost (buy-token or sell-token fee), because no real response proves `buyAmount` is already net | `src/dex/aggregator.ts:64` |
    96	| Token bucket per aggregator (0x 4 rps, Kyber 3 rps (public limit per Kyber's docs), 1inch 1 rps); a 429 blocks for Retry-After; over-budget scans are logged as `rate_limited` | `src/dex/aggregator.ts:279`, `:306` |
    97	| Multi-size: base size = `BASE_TRADE_USD` (default MAX/2). When its gross gap is ≥ `MULTISIZE_TRIGGER` (0.7) × the hurdle, 0.5× and 2× are tried too (within inventory and MAX_TRADE_USD). The highest net wins | `src/engine.ts:427` `candidates`, `:447` |
    98	
    99	Tests:
   100	- `test/upgrade-quotes.test.ts`: Kyber price and build parsing, router pin, slippage in bps and recipient; 0x fee; token bucket and 429 blocking; best-after-gas; all-limited → `QuoteBudgetError`.
   101	- `test/engine.test.ts`: the multi-size quotes are $100, $50 and $200, and the $200 size wins.
   102	
   103	**Deviation:** Kyber's documented public limit is 3 rps, so the Kyber default is 3, not the prompt's 4.
   104	
   105	## 5) Inventory sizing, skewed thresholds, rebalance tickets
   106	
   107	| What | Where |
   108	|---|---|
   109	| `INVENTORY_PER_SIDE_X` (3) target per side; a side below 1× the trade size is "low"; warning when token holdings exceed `MAX_TOKEN_SHARE_PCT` (50%) of the portfolio | `src/inventory.ts:91` `inventoryPlan`; `src/config.ts:72` |
   110	| Skewed hurdle: `need × (1 + SKEW_K × worsening)`; a trade that restores balance gets `need × 0.8`, never below the floor | `src/engine.ts:394` `needFor` |
   111	| Rebalance tickets: a side low for `REBALANCE_AFTER_MIN` (30) gets ONE Telegram ticket (asset, amount, "deposit wallet→MEXC" or "withdraw MEXC→wallet <address> (in the MEXC app)"), logged in `rebalance_tickets`, shown in `/status`, closed when the side recovers. The bot moves no funds | `src/engine.ts:555`; `src/db.ts:168`, `:228`; `src/commands.ts:50` |
   112	| Hourly `inventory_snapshots` (feeds the skew KPI) | `src/engine.ts:555` |
   113	
   114	Tests:
   115	- `test/engine.test.ts`: skewed hurdle (×1.075 vs ×0.8); one ticket and one alert.
   116	- `test/upgrade-kpi.test.ts`: plan sides and token-share warning.
```

## `src/chains.ts`

```
     1	// Per-chain settings. One bot process trades one chain (one pm2 app per chain, each with its own DB_PATH).
     2	//
     3	// Verified 2026-11-21:
     4	//  - Stable and wrapped-native addresses: live KyberSwap /routes quotes succeeded for each pair below.
     5	//  - 0x AllowanceHolder 0x0000000000001fF3684f28c67538d4D072C22734 is the same on all of these chains
     6	//    (https://docs.0x.org/docs/core-concepts/contracts).
     7	//  - KyberSwap MetaAggregationRouterV2 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5 is the same on all of them
     8	//    (https://docs.kyberswap.com/developer-guide/aggregator-api/contracts), and live /routes returned it on all four.
     9	// NOT verified: MEXC's exact network names per chain. `mexcNetwork` is a pattern; check the real names
    10	// with `npm run networks` before trading a new chain.
    11	
    12	export type ChainName = 'ethereum' | 'base' | 'bsc' | 'arbitrum';
    13	
    14	export interface ChainProfile {
    15	  name: ChainName;
    16	  chainId: number;
    17	  /** The stable the bot trades on the DEX. Its decimals are read on-chain at startup. */
    18	  stable: { address: string; symbol: 'USDC' | 'USDT' };
    19	  /** Wrapped native token, used for the startup aggregator smoke test. */
    20	  wrappedNative: string;
    21	  /** MEXC symbol pricing the gas token in USDT. */
    22	  nativeMexcSymbol: 'ETHUSDT' | 'BNBUSDT';
    23	  /** KyberSwap / DexScreener chain identifiers. */
    24	  kyberName: string;
    25	  dexScreenerId: string;
    26	  /** Matches MEXC coinConfig networkList entries (network / netWork) for this chain. */
    27	  mexcNetwork: RegExp;
    28	  /** Block explorer host for transaction links (no https:// prefix). */
    29	  explorer: string;
    30	  /** null = one scan per new block (12 s chains); otherwise scan on a timer (ms). */
    31	  tickMs: number | null;
    32	}
    33	
    34	export const CHAINS: Record<ChainName, ChainProfile> = {
    35	  ethereum: {
    36	    name: 'ethereum',
    37	    chainId: 1,
    38	    stable: { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC' },
    39	    wrappedNative: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    40	    nativeMexcSymbol: 'ETHUSDT',
    41	    kyberName: 'ethereum',
    42	    dexScreenerId: 'ethereum',
    43	    mexcNetwork: /^ETH$|ERC20|^Ethereum$/i,
    44	    explorer: 'etherscan.io',
    45	    tickMs: null,
    46	  },
    47	  base: {
    48	    name: 'base',
    49	    chainId: 8453,
    50	    stable: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC' },
    51	    wrappedNative: '0x4200000000000000000000000000000000000006',
    52	    nativeMexcSymbol: 'ETHUSDT',
    53	    kyberName: 'base',
    54	    dexScreenerId: 'base',
    55	    mexcNetwork: /^BASE$|^Base\b/i,
    56	    explorer: 'basescan.org',
    57	    tickMs: 1000, // 200 ms blocks: a timer, not block events
    58	  },
    59	  bsc: {
    60	    name: 'bsc',
    61	    chainId: 56,
    62	    stable: { address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT' }, // 18 decimals on BSC
    63	    wrappedNative: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    64	    nativeMexcSymbol: 'BNBUSDT',
    65	    kyberName: 'bsc',
    66	    dexScreenerId: 'bsc',
    67	    mexcNetwork: /^BSC$|BEP20|BNB Smart Chain/i,
    68	    explorer: 'bscscan.com',
    69	    tickMs: 1000,
    70	  },
    71	  arbitrum: {
    72	    name: 'arbitrum',
    73	    chainId: 42161,
    74	    stable: { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC' }, // native USDC
    75	    wrappedNative: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    76	    nativeMexcSymbol: 'ETHUSDT',
    77	    kyberName: 'arbitrum',
    78	    dexScreenerId: 'arbitrum',
    79	    mexcNetwork: /^ARB$|Arbitrum One|^ARBITRUM$/i,
    80	    explorer: 'arbiscan.io',
    81	    tickMs: 1000,
    82	  },
    83	};
    84	
    85	export function chainProfile(name: string): ChainProfile {
    86	  const c = CHAINS[name.toLowerCase() as ChainName];
    87	  if (!c) throw new Error(`CHAIN must be one of ${Object.keys(CHAINS).join(', ')}`);
    88	  return c;
    89	}
    90	
    91	/** Symbol of a known DEX stable address, if it is one of the four chains' stables. */
    92	export function stableSymbolFor(address: string): 'USDC' | 'USDT' | undefined {
    93	  const found = Object.values(CHAINS).find((c) => c.stable.address.toLowerCase() === address.toLowerCase());
    94	  return found?.stable.symbol;
    95	}
    96	
    97	/** Transaction URL on the chain's own explorer (round-3 review, L4: no hardcoded etherscan.io). */
    98	export function explorerTxUrl(chain: ChainProfile, hash: string): string {
    99	  return `https://${chain.explorer}/tx/${hash}`;
   100	}
   101	
   102	/** The coin's MEXC network entry for this chain, if any. */
   103	export function networkFor<N extends { network: string; netWork?: string }>(chain: ChainProfile, list: N[]): N | undefined {
   104	  return list.find((n) => chain.mexcNetwork.test(n.netWork ?? '') || chain.mexcNetwork.test(n.network));
   105	}
```

## `src/commands.ts`

```
     1	// Telegram command logic shared by both strategies (kept out of main.ts so it can be unit tested).
     2	import type { Db } from './db.js';
     3	import type { Risk } from './risk.js';
     4	import { usd } from './util.js';
     5	
     6	export interface ChainLike {
     7	  readonly unresolved: { nonce: number; hashes: string[]; unknown?: boolean } | null;
     8	  checkUnresolved(): Promise<{ state: 'clear' | 'pending' }>;
     9	  resetNonce(): void;
    10	}
    11	
    12	/**
    13	 * /start handler shared by both strategies: critical pauses need "/start confirm", and even then
    14	 * the bot re-checks that nothing is still unresolved (pending DEX tx, executing trade) before resuming.
    15	 */
    16	export function startHandler(risk: Risk, statusText: () => Promise<string>, stillUnresolved: () => Promise<string | null>) {
    17	  return async (args: string[]) => {
    18	    const confirm = args[0]?.toLowerCase() === 'confirm';
    19	    if (risk.paused && risk.critical && !confirm) {
    20	      return `⚠️ Critical pause: ${risk.pauseReason}\nCheck these positions and balances first:\n\n${await statusText()}\n\nThen send: /start confirm`;
    21	    }
    22	    if (risk.paused && risk.critical) {
    23	      const open = await stillUnresolved();
    24	      if (open) return `⛔ Not resuming: ${open}\nResolve it first (check etherscan / MEXC), then /start confirm again.`;
    25	    }
    26	    risk.resume(confirm);
    27	    const block = risk.blockReason();
    28	    return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
    29	  };
    30	}
    31	
    32	/**
    33	 * /resolve <trade id> <pnl>: book the real PnL of a trade that ended one-sided / unknown (after you fixed it by hand),
    34	 * so the daily loss budget sees it.
    35	 */
    36	export function resolveTrade(db: Db, id: string | undefined, pnl: string | undefined): string {
    37	  const n = Number(pnl);
    38	  if (!id || pnl === undefined || !Number.isFinite(n)) return 'Usage: /resolve <trade id> <pnl in USD, e.g. -3.20>';
    39	  const open = db.unresolvedTrades().find((t) => t.id === Number(id));
    40	  if (!open) return `Trade #${id} is not waiting for a PnL.`;
    41	  db.updateTrade(open.id, { pnl_usd: n, note: `${open.note ?? ''}; pnl set by hand: ${n}; pnl resolved` });
    42	  return `Trade #${id}: PnL ${usd(n)} booked.`;
    43	}
    44	
    45	export function unresolvedLines(db: Db, chain: ChainLike): string[] {
    46	  const out: string[] = [];
    47	  const u = chain.unresolved;
    48	  if (u) out.push(`⏳ DEX tx at nonce ${u.nonce} ${u.unknown ? 'UNKNOWN' : 'in flight'}: ${u.hashes.join(', ')} (/cancelnonce)`);
    49	  const tickets = db.openTickets();
    50	  if (tickets.length) out.push(`🎫 Rebalance tickets: ${tickets.map((k) => `#${k.id} ${k.direction}: ${k.amount.toFixed(4)} ${k.asset} (${k.token} ${k.side} low)`).join('; ')}`);
    51	  const t = db.unresolvedTrades();
    52	  if (t.length) out.push(`🧾 PnL unknown: ${t.map((r) => `#${r.id} ${r.symbol}`).join(', ')} -> /resolve <id> <pnl>`);
    53	  return out;
    54	}
    55	
    56	/** What still blocks a critical resume, or null. */
    57	export function makeUnresolvedCheck(db: Db, chain: ChainLike) {
    58	  return async (): Promise<string | null> => {
    59	    const u = await chain.checkUnresolved();
    60	    if (u.state === 'pending') {
    61	      return `DEX tx ${chain.unresolved?.hashes.join(' / ')} (nonce ${chain.unresolved?.nonce}): outcome still unknown; use /cancelnonce or wait`;
    62	    }
    63	    const ex = db.executingTrades();
    64	    if (ex.length) return `${ex.length} trade(s) still marked executing (#${ex.map((t) => t.id).join(', #')})`;
    65	    chain.resetNonce(); // clear: re-read the next nonce from the chain
    66	    return null;
    67	  };
    68	}
    69	
```

## `src/config.ts`

```
     1	import 'dotenv/config';
     2	import { chainProfile, stableSymbolFor } from './chains.js';
     3	
     4	export type Mode = 'live' | 'paper';
     5	export type AggregatorName = '0x' | '1inch' | 'kyber';
     6	
     7	function str(name: string, def?: string): string {
     8	  const v = process.env[name];
     9	  if (v === undefined || v === '') {
    10	    if (def === undefined) throw new Error(`Missing required env var ${name} (see .env.example)`);
    11	    return def;
    12	  }
    13	  return v.trim();
    14	}
    15	function num(name: string, def: number): number {
    16	  const v = Number(str(name, String(def)));
    17	  if (!Number.isFinite(v)) throw new Error(`Env var ${name} must be a number`);
    18	  return v;
    19	}
    20	
    21	export function loadConfig() {
    22	  const mode = str('MODE', 'paper').toLowerCase() as Mode;
    23	  if (mode !== 'live' && mode !== 'paper') throw new Error('MODE must be live or paper');
    24	  // One or several, e.g. "0x,kyber": all are asked, the best quote after gas is used.
    25	  const aggregators = str('DEX_AGGREGATOR', '0x')
    26	    .split(',')
    27	    .map((a) => a.trim().toLowerCase())
    28	    .filter(Boolean) as AggregatorName[];
    29	  for (const a of aggregators) if (!['0x', '1inch', 'kyber'].includes(a)) throw new Error(`DEX_AGGREGATOR: unknown "${a}" (use 0x, 1inch, kyber)`);
    30	  const aggregator = aggregators[0];
    31	
    32	  const strategy = str('STRATEGY', 'inventory').toLowerCase();
    33	  if (strategy !== 'transfer' && strategy !== 'inventory') throw new Error('STRATEGY must be transfer or inventory');
    34	  // Transfer mode needs a MEXC key that can WITHDRAW. That is off unless explicitly allowed.
    35	  const chain = chainProfile(str('CHAIN', 'ethereum'));
    36	  if (strategy === 'transfer' && chain.name !== 'ethereum') throw new Error('STRATEGY=transfer is only supported on CHAIN=ethereum');
    37	  if (strategy === 'transfer' && str('ALLOW_WITHDRAWALS', 'no').toLowerCase() !== 'yes') {
    38	    throw new Error('STRATEGY=transfer needs MEXC withdrawals; set ALLOW_WITHDRAWALS=yes only if you accept that risk');
    39	  }
    40	
    41	  // The DEX-side stable (USDC on Ethereum/Base/Arbitrum, USDT on BSC). STABLE_ADDRESS overrides the chain default.
    42	  // stableIsUsdt follows the OVERRIDDEN address, not the chain default: pointing STABLE_ADDRESS at a USDT
    43	  // token on a USDC chain (or vice versa) used to keep the wrong stable rate (round-3 review, L7c).
    44	  // An address that is none of the four chains' stables falls back to the chain default.
    45	  const stableAddress = str('STABLE_ADDRESS', str('USDC_ADDRESS', chain.stable.address)).toLowerCase();
    46	
    47	  return {
    48	    mode,
    49	    // transfer  = scan all MEXC ERC20 tokens, buy on MEXC, withdraw to wallet, sell on DEX
    50	    // inventory = hold tokens on both sides and trade both legs at the same moment
    51	    strategy: strategy as 'transfer' | 'inventory',
    52	    // --- Ethereum ---
    53	    rpcUrl: str('RPC_URL'),
    54	    // Private RPC for sending: never the public mempool.
    55	    sendRpcUrl: str('SEND_RPC_URL', 'https://rpc.mevblocker.io'),
    56	    privateKey: mode === 'live' ? str('PRIVATE_KEY') : str('PRIVATE_KEY', ''),
    57	    chain,
    58	    // The DEX-side stable (USDC on Ethereum/Base/Arbitrum, USDT on BSC). STABLE_ADDRESS overrides the chain default.
    59	    usdc: stableAddress,
    60	    stableIsUsdt: (stableSymbolFor(stableAddress) ?? chain.stable.symbol) === 'USDT',
    61	    tickMs: num('TICK_MS', chain.tickMs ?? 0),
    62	    // --- DEX aggregator ---
    63	    aggregator,
    64	    aggregators,
    65	    kyberClientId: str('KYBER_CLIENT_ID', 'mexc-dex-arb'),
    66	    // Our own quote budget per aggregator (calls per second). 0x Standard ~5 rps; Kyber public 3 rps
    67	    // (docs.kyberswap.com rate limits); 1inch free 1 rps.
    68	    quoteRps: { '0x': num('QUOTE_RPS_0X', 4), kyber: num('QUOTE_RPS_KYBER', 3), '1inch': num('QUOTE_RPS_1INCH', 1) },
    69	    // Multi-size quoting: base size = BASE_TRADE_USD (default MAX_TRADE_USD/2); 0.5x and 2x are tried when the
    70	    // base-size gross gap reaches MULTISIZE_TRIGGER of the hurdle.
    71	    baseTradeUsd: num('BASE_TRADE_USD', 0),
    72	    multiSizeTrigger: num('MULTISIZE_TRIGGER', 0.7),
    73	    // Quote-saving pre-filter: only request a DEX quote when the rough MEXC-vs-DexScreener gap
    74	    // is at least this many bps (0 = off). Tradeable gaps are ~35+ bps at these sizes, so 30 keeps all of them.
    75	    prefilterBps: num('PREFILTER_BPS', 30),
    76	    // --- Monitoring ---
    77	    oppRetentionDays: num('OPP_RETENTION_DAYS', 7),
    78	    // Paper mode re-quotes both legs after this delay and books THAT net (the first quote overstates profit).
    79	    paperLatencyMs: num('PAPER_LATENCY_MS', 1000),
    80	    // --- Inventory ---
    81	    inventoryPerSideX: num('INVENTORY_PER_SIDE_X', 3), // hold ~3x the trade size per token per side
    82	    maxTokenSharePct: num('MAX_TOKEN_SHARE_PCT', 50), // token holdings above this % of the portfolio: warn
    83	    skewK: num('SKEW_K', 0.75), // hurdle *= 1 + SKEW_K * (how much a trade worsens the wallet/MEXC balance)
    84	    rebalanceAfterMin: num('REBALANCE_AFTER_MIN', 30), // a side below 1x trade size this long: one rebalance ticket
    85	    zeroExApiKey: str('ZEROX_API_KEY', ''),
    86	    oneInchApiKey: str('ONEINCH_API_KEY', ''),
    87	    // --- MEXC ---
    88	    mexcApiKey: mode === 'live' ? str('MEXC_API_KEY') : str('MEXC_API_KEY', ''),
    89	    mexcApiSecret: mode === 'live' ? str('MEXC_API_SECRET') : str('MEXC_API_SECRET', ''),
    90	    // Override / floor only: the bot uses max(this, the symbol's own takerCommission from exchangeInfo).
    91	    mexcTakerFee: num('MEXC_TAKER_FEE', 0.0005),
    92	    // USDCUSDT book older than this, or a rate outside 0.99-1.01: no trading.
    93	    stableRateMaxAgeMs: num('STABLE_RATE_MAX_AGE_MS', 30_000),
    94	    // --- Telegram ---
    95	    telegramToken: str('TELEGRAM_BOT_TOKEN', ''),
    96	    telegramChatId: str('TELEGRAM_CHAT_ID', ''),
    97	    // Only this Telegram user may send commands (in a private chat with the bot).
    98	    telegramAdminId: str('TELEGRAM_ADMIN_ID', ''),
    99	    // --- Watchlist ---
   100	    watchlist: str('WATCHLIST', '')
   101	      .split(',')
   102	      .map((s) => s.trim().toUpperCase())
   103	      .filter(Boolean),
   104	    watchlistMax: num('WATCHLIST_MAX', 8),
   105	    watchlistRescanMin: num('WATCHLIST_RESCAN_MIN', 60),
   106	    minDexTvlUsd: num('MIN_DEX_TVL_USD', 200_000),
   107	    minMexcVolumeUsd: num('MIN_MEXC_VOLUME_USD', 500_000),
   108	    // Live mode only trades tokens proven profitable in paper (see provenTokens in watchlist.ts).
   109	    liveMinPaperTrades: num('LIVE_MIN_PAPER_TRADES', 2),
   110	    liveMinPaperPnlUsd: num('LIVE_MIN_PAPER_PNL_USD', 0),
   111	    liveWatchlistMax: num('LIVE_WATCHLIST_MAX', 10),
   112	    // --- Costs & thresholds ---
   113	    // Must be small relative to MAX_TRADE_USD: $15 on a $50 trade would need a ~30% gap = only fake gaps pass.
   114	    // need = max(MIN_PROFIT_USD, MIN_PROFIT_BPS of the size): mostly a percentage, with a small dollar floor.
   115	    minProfitUsd: num('MIN_PROFIT_USD', 0.25),
   116	    minProfitBps: num('MIN_PROFIT_BPS', 20),
   117	    dexSlippageBps: num('DEX_SLIPPAGE_BPS', 30),
   118	    // The MEXC book walk already uses the worst price reached; this is only a small extra cushion.
   119	    cexSlippageBps: num('CEX_SLIPPAGE_BPS', 5),
   120	    // safety = max(SAFETY_MARGIN_USD, SAFETY_MARGIN_BPS of the size)
   121	    safetyMarginUsd: num('SAFETY_MARGIN_USD', 0),
   122	    safetyMarginBps: num('SAFETY_MARGIN_BPS', 10),
   123	    // CAP on the priority fee. The tip actually used is the median of recent blocks' tips (eth_feeHistory).
   124	    priorityFeeGwei: num('PRIORITY_FEE_GWEI', 1),
   125	    // OP-stack L1 data fee reserve (USD) added to every gas estimate (round-3 review, M1).
   126	    // 0 on Ethereum/Arbitrum. On Base, set it to a typical legs.l1_fee from a past trade (usually a few cents):
   127	    // receipts now record l1_fee, so the value can be measured instead of guessed.
   128	    l1FeeUsd: num('L1_FEE_USD', 0),
   129	    // --- Risk limits ---
   130	    maxTradeUsd: num('MAX_TRADE_USD', 50),
   131	    minTradeUsd: num('MIN_TRADE_USD', 25),
   132	    maxTradesPerDay: num('MAX_TRADES_PER_DAY', 20),
   133	    dailyLossLimitUsd: num('DAILY_LOSS_LIMIT_USD', 30),
   134	    // Skip a trade if losing this % of its size (+ gas) would break the remaining daily loss budget.
   135	    worstCaseLossPct: num('WORST_CASE_LOSS_PCT', 5),
   136	    maxGasGwei: num('MAX_GAS_GWEI', 40),
   137	    // Unlimited token approval (MaxUint256) instead of exact-amount approval: the first sale of a
   138	    // token approves once, later sales skip the approve tx (~12s saved per sale). Risk: a compromised
   139	    // spender contract could drain the whole token balance from the wallet. Default off (exact
   140	    // approvals); owner turned it ON for the live twin only on 2026-11-21, after the warning.
   141	    unlimitedApproval: str('UNLIMITED_APPROVAL', 'no').toLowerCase() === 'yes',
   142	    maxConsecutiveFails: num('MAX_CONSECUTIVE_FAILS', 3),
   143	    minEthForGas: num('MIN_ETH_FOR_GAS', 0.01),
   144	    txTimeoutSec: num('TX_TIMEOUT_SEC', 60),
   145	    // --- Transfer strategy (scanner) ---
   146	    scanIntervalSec: num('SCAN_INTERVAL_SEC', 20),
   147	    scanMinGapPct: num('SCAN_MIN_GAP_PCT', 3), // cheap pre-filter before exact quotes
   148	    scanMaxGapPct: num('SCAN_MAX_GAP_PCT', 30), // bigger gaps are almost always a wrong token / dead pool
   149	    scanExactQuotes: num('SCAN_EXACT_QUOTES', 5), // max exact DEX quotes per scan
   150	    transferDriftBps: num('TRANSFER_DRIFT_BPS', 150), // price-move reserve while withdrawing
   151	    transferTimeoutMin: num('TRANSFER_TIMEOUT_MIN', 90),
   152	    maxOpenTransfers: num('MAX_OPEN_TRANSFERS', 1),
   153	    // After arrival, do not sell automatically if it would lose more than this % of the cost: hold + alert.
   154	    transferMaxLossPct: num('TRANSFER_MAX_LOSS_PCT', 3),
   155	    // --- Misc ---
   156	    dbPath: str('DB_PATH', `data/${chain.name}.sqlite`), // one database per chain
   157	    paperDbPath: str('PAPER_DB_PATH', ''), // live twin: read paper history from the paper bot's DB (empty = own DB)
   158	    envPath: str('ENV_PATH', '.env'),
   159	  };
   160	}
   161	
   162	export type Config = ReturnType<typeof loadConfig>;
   163	
   164	/** Reject settings that would make the bot trade backwards or without limits. */
   165	export function validateConfig(c: Config): Config {
   166	  const errs: string[] = [];
   167	  const range = (name: string, v: number, min: number, max: number) => {
   168	    if (!(v >= min && v <= max)) errs.push(`${name}=${v} must be between ${min} and ${max}`);
   169	  };
   170	  range('MIN_PROFIT_USD', c.minProfitUsd, 0, 1e6);
   171	  // A floor above 10% of the trade size means only absurd (fake / dead-pool) gaps could ever pass.
   172	  if (c.minProfitUsd > c.maxTradeUsd * 0.1) {
   173	    errs.push(`MIN_PROFIT_USD=${c.minProfitUsd} is more than 10% of MAX_TRADE_USD=${c.maxTradeUsd}: only fake gaps could pass`);
   174	  }
   175	  range('MIN_PROFIT_BPS', c.minProfitBps, 0, 10_000);
   176	  range('SAFETY_MARGIN_BPS', c.safetyMarginBps, 0, 1_000);
   177	  range('TICK_MS', c.tickMs, 0, 60_000);
   178	  range('DEX_SLIPPAGE_BPS', c.dexSlippageBps, 1, 500);
   179	  range('CEX_SLIPPAGE_BPS', c.cexSlippageBps, 0, 500);
   180	  range('SAFETY_MARGIN_USD', c.safetyMarginUsd, 0, 1e6);
   181	  range('MEXC_TAKER_FEE', c.mexcTakerFee, 0, 0.01);
   182	  range('MAX_TRADE_USD', c.maxTradeUsd, 1, 1e7);
   183	  range('MIN_TRADE_USD', c.minTradeUsd, 1, c.maxTradeUsd);
   184	  range('MAX_TRADES_PER_DAY', c.maxTradesPerDay, 1, 10_000);
   185	  range('DAILY_LOSS_LIMIT_USD', c.dailyLossLimitUsd, 0.01, 1e7);
   186	  range('WORST_CASE_LOSS_PCT', c.worstCaseLossPct, 0, 100);
   187	  range('MAX_GAS_GWEI', c.maxGasGwei, 0.01, 1000);
   188	  range('L1_FEE_USD', c.l1FeeUsd, 0, 100);
   189	  range('MAX_CONSECUTIVE_FAILS', c.maxConsecutiveFails, 1, 100);
   190	  // Upper bound keeps the graceful-shutdown wait (2x this + 60 s) below pm2's kill_timeout (240 s).
   191	  range('TX_TIMEOUT_SEC', c.txTimeoutSec, 12, 80);
   192	  range('SCAN_INTERVAL_SEC', c.scanIntervalSec, 5, 3600);
   193	  range('SCAN_MIN_GAP_PCT', c.scanMinGapPct, 0, c.scanMaxGapPct);
   194	  range('SCAN_MAX_GAP_PCT', c.scanMaxGapPct, c.scanMinGapPct, 100);
   195	  range('TRANSFER_DRIFT_BPS', c.transferDriftBps, 0, 5000);
   196	  range('TRANSFER_TIMEOUT_MIN', c.transferTimeoutMin, 5, 24 * 60);
   197	  range('TRANSFER_MAX_LOSS_PCT', c.transferMaxLossPct, 0, 100);
   198	  range('MAX_OPEN_TRANSFERS', c.maxOpenTransfers, 1, 10);
   199	  if (errs.length) throw new Error(`Invalid config:\n  ${errs.join('\n  ')}`);
   200	  return c;
   201	}
   202	
   203	/** Every secret value, so the logger can scrub them from any output. */
   204	export function secretsOf(cfg: Config): string[] {
   205	  // RPC URLs usually embed a provider API key (Alchemy/Infura), so they are secrets too.
   206	  return [cfg.privateKey, cfg.mexcApiKey, cfg.mexcApiSecret, cfg.zeroExApiKey, cfg.oneInchApiKey, cfg.telegramToken, cfg.rpcUrl, cfg.sendRpcUrl]
   207	    .filter((s) => s && s.length >= 8)
   208	    .flatMap((s) => [s, s.replace(/^0x/, '')]);
   209	}
```

## `src/db.ts`

```
     1	// SQLite storage: trades and persistent bot state (pause flag, failure streak, ...).
     2	import Database from 'better-sqlite3';
     3	import fs from 'node:fs';
     4	import path from 'node:path';
     5	
     6	// 'approval' = gas spent on an approval for a trade that was then skipped (a real cost, not a trade).
     7	// 'executing' = written BEFORE the legs fire; if the bot dies mid-trade, startup finds it and stays paused.
     8	export type TradeStatus = 'ok' | 'one_sided' | 'dex_failed' | 'cex_failed' | 'paper' | 'approval' | 'executing';
     9	
    10	export interface TradeRow {
    11	  ts: number;
    12	  day: string; // Bangladesh day
    13	  mode: string;
    14	  symbol: string;
    15	  direction: string;
    16	  size_usd: number;
    17	  qty: number;
    18	  buy_price: number;
    19	  sell_price: number;
    20	  expected_net: number;
    21	  cex_fee_usd: number;
    22	  gas_usd: number;
    23	  pnl_usd: number;
    24	  status: TradeStatus;
    25	  dex_tx: string | null;
    26	  cex_order_id: string | null;
    27	  note: string | null;
    28	  requoted_net?: number | null;
    29	}
    30	
    31	// One buy -> withdraw -> sell cycle. Persisted so a restart resumes it where it stopped.
    32	export type TransferStatus = 'buying' | 'withdrawing' | 'selling' | 'done' | 'failed' | 'stuck';
    33	export interface TransferRow {
    34	  id?: number;
    35	  ts: number;
    36	  updated: number;
    37	  base: string;
    38	  symbol: string;
    39	  address: string;
    40	  decimals: number;
    41	  net_work: string;
    42	  qty_step: number;
    43	  price_decimals: number;
    44	  status: TransferStatus;
    45	  buy_qty: number;
    46	  cost_usd: number;
    47	  buy_order_id: string | null;
    48	  withdraw_amount: string | null;
    49	  withdraw_id: string | null;
    50	  wallet_before: string | null; // token balance (base units) before the withdrawal
    51	  received: string | null; // base units that arrived
    52	  usdc_out: number | null;
    53	  gas_usd: number;
    54	  expected_net: number;
    55	  pnl: number | null;
    56	  sell_attempts: number;
    57	  alerted_timeout: number; // 0 none, 1 slow alert sent, 2 given up waiting (no longer blocks new trades)
    58	  note: string | null;
    59	  withdraw_fee: number; // tokens, fixed at decision time
    60	  next_try: number; // ms timestamp: no sell attempt before this (backoff)
    61	  force_sell: number; // 1 = /sell command: sell even below the loss floor
    62	  hold_alerted: number;
    63	  sell_tx: string | null; // DEX sale tx hash, written before broadcast (crash safety)
    64	}
    65	
    66	const TRANSFER_MIGRATIONS = [
    67	  'ALTER TABLE transfers ADD COLUMN withdraw_fee REAL NOT NULL DEFAULT 0',
    68	  'ALTER TABLE transfers ADD COLUMN next_try INTEGER NOT NULL DEFAULT 0',
    69	  'ALTER TABLE transfers ADD COLUMN force_sell INTEGER NOT NULL DEFAULT 0',
    70	  'ALTER TABLE transfers ADD COLUMN hold_alerted INTEGER NOT NULL DEFAULT 0',
    71	  'ALTER TABLE transfers ADD COLUMN sell_tx TEXT',
    72	];
    73	
    74	/** One evaluated candidate (paper and live), written for EVERY candidate, traded or not. */
    75	export interface OpportunityRow {
    76	  ts: number;
    77	  chain: string;
    78	  token: string;
    79	  direction: string;
    80	  size_usd: number | null;
    81	  mexc_bid: number | null;
    82	  mexc_ask: number | null;
    83	  book_age_ms: number | null;
    84	  aggregator: string | null;
    85	  dex_out: number | null;
    86	  dex_min_out: number | null;
    87	  usdc_usdt: number | null;
    88	  gross_bps: number | null;
    89	  fee_bps: number | null;
    90	  gas_usd: number | null;
    91	  net_usd: number | null;
    92	  hurdle_usd: number | null;
    93	  decision: 'trade' | 'below_hurdle' | 'inventory' | 'rule' | 'gas' | 'rate_limited' | 'paused';
    94	  reason: string | null;
    95	}
    96	
    97	/** One executed leg of a live trade. */
    98	export interface LegRow {
    99	  trade_id: number;
   100	  leg: 'dex' | 'mexc' | 'unwind';
   101	  quoted_price: number | null;
   102	  filled_price: number | null;
   103	  slippage_bps: number | null;
   104	  min_out: number | null;
   105	  real_out: number | null;
   106	  gas_used: string | null;
   107	  gas_price: string | null;
   108	  l1_fee: string | null;
   109	  executed_qty: number | null;
   110	  avg_price: number | null;
   111	  fee: number | null;
   112	  fee_asset: string | null;
   113	  latency_quote_ms: number | null;
   114	  latency_sign_ms: number | null;
   115	  latency_inclusion_ms: number | null;
   116	  latency_mexc_ack_ms: number | null;
   117	}
   118	
   119	export class Db {
   120	  private db: Database.Database;
   121	
   122	  // Twin setup: the live bot opens the paper bot's DB readonly to read paper history
   123	  // (its own DB holds live trades + risk state). WAL lets a reader run beside the writer.
   124	  constructor(file: string, readonly = false) {
   125	    if (!readonly && file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
   126	    this.db = new Database(file, readonly ? { readonly: true } : {});
   127	    if (readonly) return;
   128	    this.db.pragma('journal_mode = WAL');
   129	    this.db.exec(`
   130	      CREATE TABLE IF NOT EXISTS trades (
   131	        id INTEGER PRIMARY KEY AUTOINCREMENT,
   132	        ts INTEGER NOT NULL, day TEXT NOT NULL, mode TEXT NOT NULL,
   133	        symbol TEXT NOT NULL, direction TEXT NOT NULL,
   134	        size_usd REAL, qty REAL, buy_price REAL, sell_price REAL,
   135	        expected_net REAL, cex_fee_usd REAL, gas_usd REAL, pnl_usd REAL,
   136	        status TEXT NOT NULL, dex_tx TEXT, cex_order_id TEXT, note TEXT
   137	      );
   138	      CREATE INDEX IF NOT EXISTS trades_day ON trades(day, mode);
   139	      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   140	      CREATE TABLE IF NOT EXISTS transfers (
   141	        id INTEGER PRIMARY KEY AUTOINCREMENT,
   142	        ts INTEGER NOT NULL, updated INTEGER NOT NULL,
   143	        base TEXT NOT NULL, symbol TEXT NOT NULL, address TEXT NOT NULL, decimals INTEGER NOT NULL,
   144	        net_work TEXT NOT NULL, qty_step REAL NOT NULL, price_decimals INTEGER NOT NULL,
   145	        status TEXT NOT NULL, buy_qty REAL, cost_usd REAL, buy_order_id TEXT,
   146	        withdraw_amount TEXT, withdraw_id TEXT, wallet_before TEXT, received TEXT,
   147	        usdc_out REAL, gas_usd REAL NOT NULL DEFAULT 0, expected_net REAL, pnl REAL,
   148	        sell_attempts INTEGER NOT NULL DEFAULT 0, alerted_timeout INTEGER NOT NULL DEFAULT 0, note TEXT
   149	      );
   150	    `);
   151	    // trades.cids: JSON array of every MEXC client order id used by the trade (entry, closes), written BEFORE placing.
   152	    const tcols = new Set((this.db.prepare('PRAGMA table_info(trades)').all() as { name: string }[]).map((c) => c.name));
   153	    if (!tcols.has('cids')) this.db.exec('ALTER TABLE trades ADD COLUMN cids TEXT');
   154	    // trades.requoted_net: paper mode books the net after a simulated latency + re-quote, not the first quote.
   155	    if (!tcols.has('requoted_net')) this.db.exec('ALTER TABLE trades ADD COLUMN requoted_net REAL');
   156	    this.db.exec(`
   157	      CREATE TABLE IF NOT EXISTS opportunities (
   158	        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, chain TEXT, token TEXT NOT NULL, direction TEXT,
   159	        size_usd REAL, mexc_bid REAL, mexc_ask REAL, book_age_ms INTEGER, aggregator TEXT, dex_out REAL, dex_min_out REAL,
   160	        usdc_usdt REAL, gross_bps REAL, fee_bps REAL, gas_usd REAL, net_usd REAL, hurdle_usd REAL,
   161	        decision TEXT NOT NULL, reason TEXT
   162	      );
   163	      CREATE INDEX IF NOT EXISTS opp_token_ts ON opportunities(token, ts);
   164	      CREATE INDEX IF NOT EXISTS opp_decision_ts ON opportunities(decision, ts);
   165	      CREATE INDEX IF NOT EXISTS opp_ts ON opportunities(ts);
   166	      CREATE TABLE IF NOT EXISTS legs (
   167	        id INTEGER PRIMARY KEY AUTOINCREMENT, trade_id INTEGER NOT NULL, leg TEXT NOT NULL,
   168	        quoted_price REAL, filled_price REAL, slippage_bps REAL, min_out REAL, real_out REAL,
   169	        gas_used TEXT, gas_price TEXT, l1_fee TEXT, executed_qty REAL, avg_price REAL, fee REAL, fee_asset TEXT,
   170	        latency_quote_ms INTEGER, latency_sign_ms INTEGER, latency_inclusion_ms INTEGER, latency_mexc_ack_ms INTEGER
   171	      );
   172	      CREATE TABLE IF NOT EXISTS rebalance_tickets (
   173	        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, token TEXT NOT NULL, side TEXT NOT NULL,
   174	        asset TEXT NOT NULL, amount REAL NOT NULL, direction TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', closed_ts INTEGER
   175	      );
   176	      CREATE TABLE IF NOT EXISTS inventory_snapshots (
   177	        ts INTEGER NOT NULL, token TEXT NOT NULL, wallet_usd REAL, mexc_usd REAL
   178	      );
   179	    `);
   180	    const cols = new Set((this.db.prepare('PRAGMA table_info(transfers)').all() as { name: string }[]).map((c) => c.name));
   181	    for (const m of TRANSFER_MIGRATIONS) {
   182	      const col = m.split(' ')[5];
   183	      if (!cols.has(col)) this.db.exec(m);
   184	    }
   185	  }
   186	
   187	  insertTrade(t: TradeRow): number {
   188	    return Number(this.db
   189	      .prepare(
   190	        `INSERT INTO trades (ts, day, mode, symbol, direction, size_usd, qty, buy_price, sell_price, expected_net,
   191	          cex_fee_usd, gas_usd, pnl_usd, status, dex_tx, cex_order_id, note)
   192	         VALUES (@ts, @day, @mode, @symbol, @direction, @size_usd, @qty, @buy_price, @sell_price, @expected_net,
   193	          @cex_fee_usd, @gas_usd, @pnl_usd, @status, @dex_tx, @cex_order_id, @note)`,
   194	      )
   195	      .run(t).lastInsertRowid);
   196	  }
   197	
   198	  updateTrade(id: number, fields: Partial<TradeRow>): void {
   199	    const cols = Object.keys(fields);
   200	    if (!cols.length) return;
   201	    this.db.prepare(`UPDATE trades SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
   202	  }
   203	
   204	  appendCid(tradeId: number, cid: string): void {
   205	    const row = this.db.prepare('SELECT cids FROM trades WHERE id = ?').get(tradeId) as { cids: string | null } | undefined;
   206	    const list = row?.cids ? (JSON.parse(row.cids) as string[]) : [];
   207	    list.push(cid);
   208	    this.db.prepare('UPDATE trades SET cids = ? WHERE id = ?').run(JSON.stringify(list), tradeId);
   209	  }
   210	
   211	  cidsOf(tradeId: number): string[] {
   212	    const row = this.db.prepare('SELECT cids FROM trades WHERE id = ?').get(tradeId) as { cids: string | null } | undefined;
   213	    return row?.cids ? (JSON.parse(row.cids) as string[]) : [];
   214	  }
   215	
   216	  /** Per-token booked paper P&L: { symbol (base), trades, wins, pnl }. */
   217	  paperTokenStats(): { symbol: string; trades: number; wins: number; pnl: number }[] {
   218	    return this.db.prepare(
   219	      `SELECT symbol, COUNT(*) AS trades, SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, COALESCE(SUM(pnl_usd), 0) AS pnl
   220	       FROM trades WHERE mode = 'paper' GROUP BY symbol`,
   221	    ).all() as { symbol: string; trades: number; wins: number; pnl: number }[];
   222	  }
   223	
   224	  insertOpportunities(rows: OpportunityRow[]): void {
   225	    if (!rows.length) return;
   226	    const cols = Object.keys(rows[0]);
   227	    const stmt = this.db.prepare(`INSERT INTO opportunities (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`);
   228	    this.db.transaction((rs: OpportunityRow[]) => rs.forEach((r) => stmt.run(r)))(rows);
   229	  }
   230	
   231	  pruneOpportunities(olderThanTs: number): number {
   232	    return Number(this.db.prepare('DELETE FROM opportunities WHERE ts < ?').run(olderThanTs).changes);
   233	  }
   234	
   235	  insertLeg(r: LegRow): void {
   236	    const cols = Object.keys(r);
   237	    this.db.prepare(`INSERT INTO legs (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(r);
   238	  }
   239	
   240	  openTicket(t: { token: string; side: string; asset: string; amount: number; direction: string }): number {
   241	    return Number(
   242	      this.db
   243	        .prepare(`INSERT INTO rebalance_tickets (ts, token, side, asset, amount, direction) VALUES (?, ?, ?, ?, ?, ?)`)
   244	        .run(Date.now(), t.token, t.side, t.asset, t.amount, t.direction).lastInsertRowid,
   245	    );
   246	  }
   247	
   248	  openTickets(): { id: number; ts: number; token: string; side: string; asset: string; amount: number; direction: string }[] {
   249	    return this.db.prepare(`SELECT id, ts, token, side, asset, amount, direction FROM rebalance_tickets WHERE status = 'open' ORDER BY id`).all() as never;
   250	  }
   251	
   252	  closeTickets(token: string, side: string): void {
   253	    this.db.prepare(`UPDATE rebalance_tickets SET status = 'closed', closed_ts = ? WHERE token = ? AND side = ? AND status = 'open'`).run(Date.now(), token, side);
   254	  }
   255	
   256	  insertInventorySnapshot(rows: { ts: number; token: string; wallet_usd: number; mexc_usd: number }[]): void {
   257	    const stmt = this.db.prepare('INSERT INTO inventory_snapshots (ts, token, wallet_usd, mexc_usd) VALUES (@ts, @token, @wallet_usd, @mexc_usd)');
   258	    this.db.transaction((rs: typeof rows) => rs.forEach((r) => stmt.run(r)))(rows);
   259	  }
   260	
   261	  /** Raw access for read-only reports. */
   262	  all<T>(sql: string, ...args: unknown[]): T[] {
   263	    return this.db.prepare(sql).all(...args) as T[];
   264	  }
   265	
   266	  /** Trades whose real PnL is unknown (one-sided / recovered) and not yet set with /resolve. */
   267	  unresolvedTrades(): (TradeRow & { id: number })[] {
   268	    return this.db
   269	      .prepare(`SELECT * FROM trades WHERE status = 'one_sided' AND (note IS NULL OR note NOT LIKE '%pnl resolved%') AND note LIKE '%pnl unknown%' ORDER BY id`)
   270	      .all() as (TradeRow & { id: number })[];
   271	  }
   272	
   273	  tradeByDexTx(hash: string): (TradeRow & { id: number }) | undefined {
   274	    return this.db.prepare('SELECT * FROM trades WHERE dex_tx = ? ORDER BY id DESC LIMIT 1').get(hash) as (TradeRow & { id: number }) | undefined;
   275	  }
   276	
   277	  /** Trades that were in flight when the bot stopped. */
   278	  executingTrades(): (TradeRow & { id: number })[] {
   279	    return this.db.prepare(`SELECT * FROM trades WHERE status = 'executing' ORDER BY id`).all() as (TradeRow & { id: number })[];
   280	  }
   281	
   282	  dayStats(day: string, mode: string): { trades: number; pnl: number; gas: number; failed: number } {
   283	    const r = this.db
   284	      .prepare(
   285	        `SELECT SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades,
   286	                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
   287	                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
   288	         FROM trades WHERE day = ? AND mode = ?`,
   289	      )
   290	      .get(day, mode) as { trades: number | null; pnl: number; gas: number; failed: number | null };
   291	    return { trades: r.trades ?? 0, pnl: r.pnl, gas: r.gas, failed: r.failed ?? 0 };
   292	  }
   293	
   294	  /** Stats since a timestamp, overall and per symbol. */
   295	  statsSince(sinceTs: number, mode?: string) {
   296	    const where = mode ? 'ts >= ? AND mode = ?' : 'ts >= ?';
   297	    const args = mode ? [sinceTs, mode] : [sinceTs];
   298	    const total = this.db
   299	      .prepare(
   300	        `SELECT COALESCE(SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END),0) trades,
   301	                COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
   302	                COALESCE(SUM(cex_fee_usd),0) fees,
   303	                COALESCE(SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END),0) failed
   304	         FROM trades WHERE ${where}`,
   305	      )
   306	      .get(...args) as { trades: number; pnl: number; gas: number; fees: number; failed: number };
   307	    const bySymbol = this.db
   308	      .prepare(
   309	        `SELECT symbol, SUM(CASE WHEN status != 'approval' THEN 1 ELSE 0 END) trades, SUM(pnl_usd) pnl, SUM(gas_usd) gas,
   310	                SUM(CASE WHEN status IN ('one_sided','dex_failed','cex_failed') THEN 1 ELSE 0 END) failed
   311	         FROM trades WHERE ${where} GROUP BY symbol ORDER BY pnl DESC`,
   312	      )
   313	      .all(...args) as { symbol: string; trades: number; pnl: number; gas: number; failed: number }[];
   314	    return { total, bySymbol };
   315	  }
   316	
   317	  insertTransfer(t: TransferRow): number {
   318	    const cols = Object.keys(t).filter((k) => k !== 'id');
   319	    const r = this.db
   320	      .prepare(`INSERT INTO transfers (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
   321	      .run(t);
   322	    return Number(r.lastInsertRowid);
   323	  }
   324	
   325	  updateTransfer(id: number, fields: Partial<TransferRow>): void {
   326	    const f = { ...fields, updated: Date.now() };
   327	    const cols = Object.keys(f).filter((k) => k !== 'id');
   328	    this.db.prepare(`UPDATE transfers SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...f, id });
   329	  }
   330	
   331	  /** Transfers the bot still works on automatically ('stuck' waits for a human: /sell or /clear). */
   332	  openTransfers(): TransferRow[] {
   333	    return this.db.prepare(`SELECT * FROM transfers WHERE status IN ('buying','withdrawing','selling') ORDER BY id`).all() as TransferRow[];
   334	  }
   335	
   336	  /** Transfers that hold back new trades (open, and not given up on). */
   337	  blockingTransfers(): TransferRow[] {
   338	    return this.openTransfers().filter((t) => t.alerted_timeout < 2);
   339	  }
   340	
   341	  stuckTransfers(): TransferRow[] {
   342	    return this.db.prepare(`SELECT * FROM transfers WHERE status = 'stuck' ORDER BY id`).all() as TransferRow[];
   343	  }
   344	
   345	  getTransfer(id: number): TransferRow | undefined {
   346	    return this.db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) as TransferRow | undefined;
   347	  }
   348	
   349	  getState(key: string): string | undefined {
   350	    return (this.db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined)?.value;
   351	  }
   352	
   353	  setState(key: string, value: string): void {
   354	    this.db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
   355	  }
   356	
   357	  close(): void {
   358	    this.db.close();
   359	  }
   360	}
```

## `src/engine.ts`

```
     1	// The trading loop: find the best opportunity each block, confirm it, trade both legs, clean up, account.
     2	import type { Config } from './config.js';
     3	import { explorerTxUrl } from './chains.js';
     4	import { BestOf, QuoteBudgetError, type Aggregator, type Quote, type QuoteRequest } from './dex/aggregator.js';
     5	import type { GasInfo, TxResult } from './dex/chain.js';
     6	import type { Book, Order, Side } from './mexc/rest.js';
     7	import type { Db, OpportunityRow, TradeStatus } from './db.js';
     8	import type { Risk, RiskEvent } from './risk.js';
     9	import type { Token } from './watchlist.js';
    10	import { type Balances, inventoryPlan, inventoryWarnings, portfolioUsd } from './inventory.js';
    11	import {
    12	  type Opportunity,
    13	  evaluateCexBuy,
    14	  evaluateDexBuy,
    15	  gasUsd,
    16	  planCexBuy,
    17	  planCexBuyQty,
    18	  threshold,
    19	  unwindPlan,
    20	} from './pricing.js';
    21	import { log, errMsg } from './log.js';
    22	import { AmbiguousRequestError } from './mexc/rest.js';
    23	import { bandProblem, closePrice, orderProblem, takerFeeFor } from './mexc/rules.js';
    24	import crypto from 'node:crypto';
    25	
    26	/** A close/unwind that only partly filled: `remaining` is what is still open. */
    27	export class PartialCloseError extends Error {
    28	  constructor(msg: string, readonly remaining: number) {
    29	    super(msg);
    30	  }
    31	}
    32	
    33	/** Unique id we give MEXC orders, so an order can be found even if the request timed out. */
    34	export const clientId = (tag: string) => `arb${tag}${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 32);
    35	
    36	const FINAL_ORDER = new Set(['FILLED', 'CANCELED', 'PARTIALLY_CANCELED']);
    37	
    38	/** A cancel could not be confirmed: the order may still be live on MEXC. Never place a second close for it. */
    39	export class OrderStillOpenError extends Error {
    40	  constructor(readonly orderId: string, status: string) {
    41	    super(`MEXC order ${orderId} still ${status} after cancel attempts: it may still fill`);
    42	  }
    43	}
    44	
    45	/**
    46	 * Cancel an order and keep checking until MEXC reports a final status (FILLED / CANCELED / PARTIALLY_CANCELED).
    47	 * Throws OrderStillOpenError if that cannot be confirmed within ~10s.
    48	 */
    49	export async function cancelAndConfirm(
    50	  mexc: Pick<CexApi, 'getOrder' | 'cancelOrder'>,
    51	  symbol: string,
    52	  orderId: string,
    53	  sleep: (ms: number) => Promise<void>,
    54	): Promise<Order> {
    55	  let last = '?';
    56	  for (let i = 0; i < 6; i++) {
    57	    const o = await mexc.getOrder(symbol, orderId).catch(() => null);
    58	    if (o) {
    59	      if (FINAL_ORDER.has(o.status)) return o;
    60	      last = o.status;
    61	    }
    62	    await mexc.cancelOrder(symbol, orderId).catch((e) => log.warn(`cancel ${orderId}: ${errMsg(e)}`));
    63	    await sleep(500 * (i + 1));
    64	  }
    65	  const o = await mexc.getOrder(symbol, orderId).catch(() => null);
    66	  if (o && FINAL_ORDER.has(o.status)) return o;
    67	  throw new OrderStillOpenError(orderId, o?.status ?? last);
    68	}
    69	
    70	/**
    71	 * Place an order; if the request is ambiguous (timeout / 5xx) look it up by client id
    72	 * instead of assuming it was not placed. Throws UNKNOWN_ORDER_STATE if that is impossible.
    73	 */
    74	export async function placeSafely(
    75	  mexc: Pick<CexApi, 'getOrderByClientId'>,
    76	  symbol: string,
    77	  cid: string,
    78	  place: () => Promise<{ orderId: string }>,
    79	  sleep: (ms: number) => Promise<void>,
    80	): Promise<{ orderId: string }> {
    81	  try {
    82	    return await place();
    83	  } catch (e) {
    84	    if (!(e instanceof AmbiguousRequestError)) throw e; // clearly rejected: nothing was placed
    85	    // MEXC may take a few seconds to index a just-placed order: look for ~10s (1, 2, 3, 4 s).
    86	    // MEXC docs: after a 5xx "the execution status is UNKNOWN". So if it is still not found, the state is
    87	    // UNKNOWN (critical pause, no unwind) - never "not placed", which could double the exposure.
    88	    for (const wait of [1000, 2000, 3000, 4000]) {
    89	      await sleep(wait);
    90	      try {
    91	        const o = await mexc.getOrderByClientId(symbol, cid);
    92	        if (o) return { orderId: o.orderId }; // it WAS placed
    93	      } catch {
    94	        // lookup failed: try again
    95	      }
    96	    }
    97	    throw new Error(`UNKNOWN_ORDER_STATE client id ${cid}: ${errMsg(e)}`);
    98	  }
    99	}
   100	import { decimalsOfStep, dhakaDay, mapBatches, sleep as realSleep, toFloat, toUnits, usd } from './util.js';
   101	import { dexPrices } from './watchlist.js';
   102	
   103	export const USDC_DECIMALS = 6;
   104	export { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
   105	import { ZEROX_ALLOWANCE_HOLDER } from './dex/aggregator.js';
   106	const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';
   107	
   108	// Narrow interfaces so tests can plug in fakes.
   109	export interface CexApi {
   110	  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }>;
   111	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
   112	  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
   113	  myTrades?(symbol: string, orderId: string): Promise<{ price: string; qty: string; quoteQty: string; commission: string; commissionAsset: string }[]>;
   114	  getOrder(symbol: string, orderId: string): Promise<Order>;
   115	  cancelOrder(symbol: string, orderId: string): Promise<Order>;
   116	}
   117	export interface ChainApi {
   118	  readonly address: string;
   119	  gas(): Promise<GasInfo>;
   120	  approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint>;
   121	  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
   122	  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
   123	  send(
   124	    tx: { to: string; data: string; value?: bigint },
   125	    gasLimit: bigint,
   126	    gas: GasInfo,
   127	    timeoutSec: number,
   128	    onSigned?: (hash: string, nonce: number) => void,
   129	  ): Promise<TxResult>;
   130	  /** Unresolved earlier tx (outcome unknown): no new trades until it is 'clear'. */
   131	  checkUnresolved?(): Promise<{ state: 'clear' | 'pending'; dropped?: boolean; executedHash?: string; ok?: boolean }>;
   132	  /** ok only if nothing is unresolved and our next nonce equals the chain's (no gap). */
   133	  readyToSend?(): Promise<{ ok: boolean; reason?: string }>;
   134	  readonly unresolved?: { nonce: number; hashes: string[]; since: number; unknown?: boolean } | null;
   135	}
   136	export interface Notifier {
   137	  send(text: string): Promise<void>;
   138	}
   139	
   140	export interface EngineDeps {
   141	  cfg: Config;
   142	  mexc: CexApi;
   143	  chain: ChainApi;
   144	  agg: Aggregator;
   145	  db: Db;
   146	  risk: Risk;
   147	  tg: Notifier;
   148	  book: (symbol: string) => Promise<Book>;
   149	  /** Authoritative book (REST) used for the final check right before trading; defaults to `book`. */
   150	  freshBook?: (symbol: string) => Promise<Book>;
   151	  /** total=true: free + locked MEXC balances (for exact PnL); default free (for sizing). */
   152	  balances: (total?: boolean) => Promise<Balances>;
   153	  tokens: Token[];
   154	  sleep?: (ms: number) => Promise<void>;
   155	  /** Decimals of the DEX stable (read on-chain at startup; 6 for USDC, 18 for BSC USDT). */
   156	  stableDecimals?: number;
   157	}
   158	
   159	export interface Candidate {
   160	  token: Token;
   161	  opp: Opportunity;
   162	  req: QuoteRequest;
   163	  spender: string;
   164	  approvalGas: bigint;
   165	  tokenUsd: number;
   166	  /** What gets logged to `opportunities` (decision filled in by tick). */
   167	  row?: OpportunityRow;
   168	  /** Hurdle for this candidate (base hurdle, skewed by inventory balance). */
   169	  need?: number;
   170	}
   171	
   172	const mid = (b: Book) => (b.bids[0][0] + b.asks[0][0]) / 2;
   173	
   174	export class Engine {
   175	  /** Trade row being executed: every MEXC client id is recorded on it before the order is placed. */
   176	  private currentTradeId: number | null = null;
   177	  private lastNote = new Map<string, string>();
   178	  private lastAlert = new Map<string, number>();
   179	  private sleep: (ms: number) => Promise<void>;
   180	  lastGasGwei = 0;
   181	
   182	  constructor(private d: EngineDeps) {
   183	    this.sleep = d.sleep ?? realSleep;
   184	  }
   185	
   186	  private get cfg() {
   187	    return this.d.cfg;
   188	  }
   189	  private get live() {
   190	    return this.cfg.mode === 'live';
   191	  }
   192	  private get taker() {
   193	    return this.live ? this.d.chain.address : PAPER_TAKER;
   194	  }
   195	  /** USDT per 1 DEX stable (USDC). 1 on chains whose DEX stable is USDT. Refreshed every tick. */
   196	  stableRate = 1;
   197	  private get stableDec() {
   198	    return this.d.stableDecimals ?? USDC_DECIMALS;
   199	  }
   200	  /** Per-symbol taker fee (exchangeInfo), never below the MEXC_TAKER_FEE override. */
   201	  private fee(t: Token) {
   202	    return takerFeeFor(t.rules, this.cfg.mexcTakerFee);
   203	  }
   204	  private costs(t: Token) {
   205	    return {
   206	      takerFee: this.fee(t),
   207	      cexSlippageBps: this.cfg.cexSlippageBps,
   208	      safetyMarginUsd: this.cfg.safetyMarginUsd,
   209	      safetyMarginBps: this.cfg.safetyMarginBps,
   210	      stableInUsdt: this.stableRate,
   211	    };
   212	  }
   213	  private need(sizeUsd: number) {
   214	    return threshold(sizeUsd, this.cfg.minProfitUsd, this.cfg.minProfitBps);
   215	  }
   216	
   217	  /**
   218	   * USDC is not USDT (MEXC USDCUSDT was ~1.0021). Read the live rate; refuse to trade on a stale or
   219	   * unreasonable one. Returns an error string, or null when the rate is usable.
   220	   */
   221	  async refreshStableRate(): Promise<string | null> {
   222	    if (this.cfg.stableIsUsdt) {
   223	      this.stableRate = 1;
   224	      return null;
   225	    }
   226	    const b = await this.d.book('USDCUSDT');
   227	    if (!b.bids.length || !b.asks.length) return 'USDCUSDT book empty';
   228	    if (Date.now() - b.ts > this.cfg.stableRateMaxAgeMs) return `USDCUSDT book is ${Math.round((Date.now() - b.ts) / 1000)}s old`;
   229	    const r = mid(b);
   230	    if (!(r >= 0.99 && r <= 1.01)) return `USDC/USDT rate ${r} outside 0.99-1.01`;
   231	    this.stableRate = r;
   232	    return null;
   233	  }
   234	
   235	  /** Log a status line only when it changes (avoids spamming every block). */
   236	  private note(key: string, msg: string) {
   237	    if (this.lastNote.get(key) !== msg) {
   238	      this.lastNote.set(key, msg);
   239	      log.info(msg);
   240	    }
   241	  }
   242	
   243	  async alertThrottled(key: string, text: string, everyMs = 6 * 3600_000) {
   244	    const last = this.lastAlert.get(key) ?? 0;
   245	    if (Date.now() - last < everyMs) return;
   246	    this.lastAlert.set(key, Date.now());
   247	    await this.d.tg.send(text);
   248	  }
   249	
   250	  /** One scan; executes at most one trade. */
   251	  async tick(): Promise<void> {
   252	    const block = this.d.risk.blockReason();
   253	    if (block) {
   254	      this.logBlocked('paused', block);
   255	      return this.note('block', `trading blocked: ${block}`);
   256	    }
   257	    this.note('block', 'trading enabled');
   258	
   259	    if (this.d.chain.checkUnresolved) {
   260	      const pending = this.d.chain.unresolved;
   261	      const u = await this.d.chain.checkUnresolved();
   262	      if (u.state === 'clear' && pending) await this.reportResolved(pending, u);
   263	      if (u.state === 'pending') {
   264	        const p = this.d.chain.unresolved;
   265	        if (p && Date.now() - p.since > 10 * 60_000) {
   266	          await this.alertThrottled(
   267	            'unresolved',
   268	            `⏳ DEX tx at nonce ${p.nonce} still unresolved after ${Math.round((Date.now() - p.since) / 60_000)} min (${p.hashes.join(', ')}). ` +
   269	              `No new trades. Send /cancelnonce to replace it with a cancel, or wait.`,
   270	            3600_000,
   271	          );
   272	        }
   273	        return this.note('unresolved', 'an earlier DEX tx is still unresolved: no new trades until it is mined or dropped');
   274	      }
   275	    }
   276	    this.note('unresolved', 'no unresolved tx');
   277	
   278	    const gas = await this.d.chain.gas();
   279	    this.lastGasGwei = Number(gas.effective) / 1e9;
   280	    if (this.lastGasGwei > this.cfg.maxGasGwei) {
   281	      this.logBlocked('gas', `gas ${this.lastGasGwei.toFixed(2)} gwei > ${this.cfg.maxGasGwei}`);
   282	      return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > MAX_GAS_GWEI ${this.cfg.maxGasGwei}, waiting`);
   283	    }
   284	    this.note('gas', 'gas ok');
   285	
   286	    const rateProblem = await this.refreshStableRate();
   287	    if (rateProblem) return this.note('stable', `no trading: ${rateProblem}`);
   288	    this.note('stable', 'stable rate ok');
   289	    const ethUsd = mid(await this.d.book(this.cfg.chain.nativeMexcSymbol));
   290	    const bal = await this.d.balances();
   291	    const books = new Map<string, Book>();
   292	    const prices: Record<string, number> = {};
   293	    // MEXC books are independent: fetch in parallel batches (sequential = ~0.3 s/token).
   294	    await mapBatches(this.d.tokens, 8, async (t) => {
   295	      try {
   296	        const b = await this.d.book(t.symbol);
   297	        if (b.bids.length && b.asks.length) {
   298	          books.set(t.symbol, b);
   299	          prices[t.base] = mid(b);
   300	        }
   301	      } catch (e) {
   302	        log.warn(`${t.symbol} book: ${errMsg(e)}`);
   303	      }
   304	    });
   305	
   306	    if (this.live) {
   307	      for (const w of inventoryWarnings(bal, this.d.tokens, prices, this.cfg.minTradeUsd, this.cfg.minEthForGas)) {
   308	        await this.alertThrottled(`inv-${w.key}`, `📦 Inventory: ${w.text}`);
   309	      }
   310	    }
   311	
   312	    this.inventoryHousekeeping(bal, prices);
   313	    // BestOf compares aggregators after gas: tell it what gas costs in each output token right now.
   314	    if (this.d.agg instanceof BestOf) this.d.agg.gasInOutput = this.gasValuer(gas, ethUsd, prices);
   315	
   316	    const rows: OpportunityRow[] = [];
   317	    let best: Candidate | null = null;
   318	    // Quote-saving pre-filter: only spend a (rate-limited) DEX quote when the rough
   319	    // MEXC-vs-DexScreener gap is big enough to ever trade. On any fetch failure,
   320	    // quote everything (same as before).
   321	    let toQuote = this.d.tokens;
   322	    if (this.cfg.prefilterBps > 0) {
   323	      try {
   324	        const dex = await dexPrices(this.d.tokens.filter((t) => books.has(t.symbol)).map((t) => t.address));
   325	        const kept: Token[] = [];
   326	        for (const t of this.d.tokens) {
   327	          const b = books.get(t.symbol);
   328	          const px = dex.get(t.address.toLowerCase());
   329	          if (!b || px === undefined) { kept.push(t); continue; }
   330	          const gapBps = (Math.abs(px - prices[t.base]) / prices[t.base]) * 10_000;
   331	          if (gapBps >= this.cfg.prefilterBps) kept.push(t);
   332	          else rows.push(this.blankRow(t, 'rule', `prefilter: rough gap ${gapBps.toFixed(0)} bps < ${this.cfg.prefilterBps} bps`));
   333	        }
   334	        log.info(`prefilter: quoting ${kept.length}/${this.d.tokens.length} tokens`);
   335	        toQuote = kept;
   336	      } catch (e) {
   337	        log.warn(`prefilter: ${errMsg(e)} (quoting all)`);
   338	      }
   339	    }
   340	    const batchSize = 3;
   341	    const batchGapMs = 2000; // 3 tokens x 2 quotes per 2 s = Kyber 3 quotes/s
   342	    const perToken: Candidate[][] = [];
   343	    for (let i = 0; i < toQuote.length; i += batchSize) {
   344	      const started = Date.now();
   345	      const results = await Promise.all(toQuote.slice(i, i + batchSize).map(async (t) => {
   346	        const b = books.get(t.symbol);
   347	        if (!b) return [] as Candidate[];
   348	        if (!t.depositOk || !t.withdrawOk) {
   349	          this.note(`susp-${t.base}`, `${t.base}: MEXC deposit/withdraw suspended, skipping`);
   350	          return [] as Candidate[];
   351	        }
   352	        this.note(`susp-${t.base}`, `${t.base}: active`);
   353	        try {
   354	          return await this.candidates(t, b, bal, gas, ethUsd, rows);
   355	        } catch (e) {
   356	          if (e instanceof QuoteBudgetError) rows.push(this.blankRow(t, 'rate_limited', errMsg(e)));
   357	          else log.warn(`${t.base} quote: ${errMsg(e)}`);
   358	          return [] as Candidate[];
   359	        }
   360	      }));
   361	      perToken.push(...results);
   362	      const elapsed = Date.now() - started;
   363	      if (i + batchSize < toQuote.length && elapsed < batchGapMs) await this.sleep(batchGapMs - elapsed);
   364	    }
   365	    for (const [i, list] of perToken.entries()) {
   366	      const t = toQuote[i];
   367	      for (const c of list) {
   368	        const need = c.need ?? this.need(c.opp.sizeUsd);
   369	        log.info(`${t.base} ${c.opp.direction} size ${usd(c.opp.sizeUsd)} net ${usd(c.opp.net)} (need ${usd(need)})`);
   370	        const passes = c.opp.net > need;
   371	        if (c.row) {
   372	          c.row.decision = passes ? 'trade' : 'below_hurdle';
   373	          c.row.reason = passes ? null : `net ${c.opp.net.toFixed(4)} <= need ${need.toFixed(4)}`;
   374	        }
   375	        if (passes && (!best || c.opp.net > best.opp.net)) best = c;
   376	      }
   377	    }
   378	    for (const r of rows) if (r.decision === 'trade' && best?.row !== r) r.reason = 'passed, but another candidate was better this tick';
   379	    this.flushRows(rows);
   380	    if (best) await this.execute(best, gas, ethUsd);
   381	  }
   382	
   383	  // ---------- opportunity logging ----------
   384	  private lastBlockedLog = new Map<string, number>();
   385	
   386	  private blankRow(t: Token, decision: OpportunityRow['decision'], reason: string | null, direction = '-'): OpportunityRow {
   387	    return {
   388	      ts: Date.now(), chain: this.cfg.chain.name, token: t.base, direction, size_usd: null, mexc_bid: null, mexc_ask: null,
   389	      book_age_ms: null, aggregator: null, dex_out: null, dex_min_out: null, usdc_usdt: this.stableRate, gross_bps: null,
   390	      fee_bps: this.fee(t) * 10_000, gas_usd: null, net_usd: null, hurdle_usd: null, decision, reason,
   391	    };
   392	  }
   393	
   394	  /** Paused / gas too high: one row per token, at most once a minute (so the report shows WHY nothing traded). */
   395	  private logBlocked(decision: 'paused' | 'gas', reason: string) {
   396	    const last = this.lastBlockedLog.get(decision) ?? 0;
   397	    if (Date.now() - last < 60_000) return;
   398	    this.lastBlockedLog.set(decision, Date.now());
   399	    this.flushRows(this.d.tokens.map((t) => this.blankRow(t, decision, reason)));
   400	  }
   401	
   402	  private flushRows(rows: OpportunityRow[]) {
   403	    try {
   404	      this.d.db.insertOpportunities(rows);
   405	    } catch (e) {
   406	      log.warn(`opportunity log: ${errMsg(e)}`);
   407	    }
   408	  }
   409	
   410	  /** Gas units -> output-token base units, so BestOf can compare aggregators after gas. */
   411	  /** Gas estimate in USD, including the OP-stack L1 data fee reserve (0 on Ethereum/Arbitrum). */
   412	  private estGasUsd(units: bigint, gas: GasInfo, ethUsd: number): number {
   413	    return gasUsd(units, gas.effective, ethUsd) + this.cfg.l1FeeUsd;
   414	  }
   415	
   416	  private gasValuer(gas: GasInfo, ethUsd: number, prices: Record<string, number>) {
   417	    return (units: bigint, buyToken: string): bigint => {
   418	      const usdCost = this.estGasUsd(units, gas, ethUsd);
   419	      if (buyToken.toLowerCase() === this.cfg.usdc) return toUnits(usdCost / this.stableRate, this.stableDec);
   420	      const t = this.d.tokens.find((x) => x.address === buyToken.toLowerCase());
   421	      const px = t ? prices[t.base] : undefined;
   422	      return t && px ? toUnits(usdCost / px, t.decimals) : 0n;
   423	    };
   424	  }
   425	
   426	  // ---------- inventory (item 5) ----------
   427	  /** Wallet share of a token's inventory (0..1), or null if there is none. */
   428	  private walletShare(t: Token, bal: Balances, px: number, dWallet = 0, dMexc = 0): number | null {
   429	    const w = Math.max(0, (bal.walletToken[t.base] ?? 0) * px + dWallet);
   430	    const m = Math.max(0, (bal.mexc[t.base] ?? 0) * px + dMexc);
   431	    return w + m > 0 ? w / (w + m) : null;
   432	  }
   433	
   434	  /**
   435	   * Skewed hurdle: trades that push a token's inventory further from 50/50 wallet/MEXC need more profit,
   436	   * trades that restore it need less (x0.8), never below the plain cost-and-safety hurdle's floor.
   437	   */
   438	  needFor(t: Token, direction: 'DEX_BUY' | 'CEX_BUY', sizeUsd: number, bal: Balances, px: number): number {
   439	    const base = this.need(sizeUsd);
   440	    if (!this.live) return base; // paper balances are synthetic
   441	    const before = this.walletShare(t, bal, px);
   442	    const after = direction === 'DEX_BUY' ? this.walletShare(t, bal, px, sizeUsd, -sizeUsd) : this.walletShare(t, bal, px, -sizeUsd, sizeUsd);
   443	    if (before === null || after === null) return base;
   444	    const worsening = Math.abs(after - 0.5) - Math.abs(before - 0.5);
   445	    if (worsening > 0) return base * (1 + this.cfg.skewK * worsening);
   446	    if (worsening < 0) return Math.max(base * 0.8, this.cfg.minProfitUsd * 0.8);
   447	    return base;
   448	  }
   449	
   450	  /** An unresolved tx got its outcome: tell the human which tx won, and note it on the trade row. */
   451	  private async reportResolved(
   452	    p: { nonce: number; hashes: string[] },
   453	    u: { executedHash?: string; ok?: boolean; dropped?: boolean },
   454	  ) {
   455	    const what = u.executedHash
   456	      ? `${u.executedHash} was mined (${u.ok ? 'SUCCESS' : 'REVERTED'})${u.executedHash === p.hashes[0] ? ': the ORIGINAL tx executed' : ': the cancel won, the original did NOT execute'}`
   457	      : u.dropped
   458	        ? 'no RPC knows the tx any more: it was dropped and never executed'
   459	        : 'the nonce was used, but no receipt was found for our hashes: check etherscan';
   460	    await this.d.tg.send(`ℹ️ Nonce ${p.nonce} resolved: ${what}. You may now fix any position by hand, then /start confirm.`);
   461	    const row = this.d.db.tradeByDexTx(p.hashes[0]);
   462	    if (row) this.d.db.updateTrade(row.id, { note: `${row.note ?? ''}; dex resolved: ${what}` });
   463	  }
   464	
   465	  /**
   466	   * Indicative opportunities in both directions for one token, at several sizes:
   467	   * the base size first; if its gross gap reaches MULTISIZE_TRIGGER of the hurdle, also 0.5x and 2x
   468	   * (within inventory and MAX_TRADE_USD). The best net per direction is returned. Every evaluation is
   469	   * added to `rows` (the opportunities log).
   470	   */
   471	  async candidates(t: Token, b: Book, bal: Balances, gas: GasInfo, ethUsd: number, rows: OpportunityRow[] = []): Promise<Candidate[]> {
   472	    const out: Candidate[] = [];
   473	    const bestBid = b.bids[0][0];
   474	    const tokenUsd = mid(b);
   475	    const cexTok = bal.mexc[t.base] ?? 0;
   476	    const walTok = bal.walletToken[t.base] ?? 0;
   477	    const base = this.cfg.baseTradeUsd > 0 ? this.cfg.baseTradeUsd : this.cfg.maxTradeUsd / 2;
   478	
   479	    const capA = Math.min(this.cfg.maxTradeUsd, bal.walletUsdc * 0.99, cexTok * bestBid * 0.99);
   480	    const capB = Math.min(this.cfg.maxTradeUsd, (bal.mexc.USDT ?? 0) * 0.99, walTok * bestBid * 0.99);
   481	
   482	    for (const [dir, cap] of [['DEX_BUY', capA], ['CEX_BUY', capB]] as const) {
   483	      if (cap < this.cfg.minTradeUsd) {
   484	        rows.push(this.blankRow(t, 'inventory', `max size ${usd(cap)} < MIN_TRADE_USD (not enough ${dir === 'DEX_BUY' ? 'wallet stable / MEXC token' : 'MEXC USDT / wallet token'})`, dir));
   485	        continue;
   486	      }
   487	      const sizes = [Math.max(this.cfg.minTradeUsd, Math.min(base, cap))];
   488	      const results: Candidate[] = [];
   489	      const first = await this.evalAt(t, b, bal, gas, ethUsd, dir, sizes[0], rows);
   490	      if (first) results.push(first);
   491	      // Multi-size: only worth the extra quotes when the base size is already close to the hurdle.
   492	      if (first && first.opp.grossUsd >= this.cfg.multiSizeTrigger * (first.need ?? this.need(first.opp.sizeUsd))) {
   493	        for (const k of [0.5, 2]) {
   494	          const size = Math.floor(Math.min(sizes[0] * k, cap) * 100) / 100;
   495	          if (size < this.cfg.minTradeUsd || sizes.includes(size)) continue;
   496	          sizes.push(size);
   497	          const c = await this.evalAt(t, b, bal, gas, ethUsd, dir, size, rows);
   498	          if (c) results.push(c);
   499	        }
   500	      }
   501	      if (results.length) out.push(results.reduce((x, y) => (y.opp.net > x.opp.net ? y : x)));
   502	    }
   503	    return out;
   504	  }
   505	
   506	  /** One direction at one size: DEX quote + MEXC book walk -> Candidate (or null), plus its opportunities row. */
   507	  private async evalAt(
   508	    t: Token,
   509	    b: Book,
   510	    bal: Balances,
   511	    gas: GasInfo,
   512	    ethUsd: number,
   513	    dir: 'DEX_BUY' | 'CEX_BUY',
   514	    size: number,
   515	    rows: OpportunityRow[],
   516	  ): Promise<Candidate | null> {
   517	    const slippageBps = this.cfg.dexSlippageBps;
   518	    const tokenUsd = mid(b);
   519	    const row = this.blankRow(t, 'below_hurdle', null, dir);
   520	    Object.assign(row, { size_usd: size, mexc_bid: b.bids[0][0], mexc_ask: b.asks[0][0], book_age_ms: Date.now() - b.ts });
   521	    rows.push(row);
   522	
   523	    let c: Candidate | null = null;
   524	    if (dir === 'DEX_BUY') {
   525	      // USDC -> token on DEX, token -> USDT on MEXC.
   526	      const req = { sellToken: this.cfg.usdc, buyToken: t.address, sellAmount: toUnits(size, this.stableDec), taker: this.taker, slippageBps };
   527	      const q = await this.d.agg.price(req);
   528	      const spender = this.spenderOf(q);
   529	      const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
   530	      const opp = evaluateDexBuy({
   531	        sizeUsd: size,
   532	        tokensOut: toFloat(q.buyAmount, t.decimals),
   533	        tokensMin: toFloat(q.minBuyAmount, t.decimals),
   534	        bids: b.bids,
   535	        qtyStep: t.qtyStep,
   536	        gasUsd: this.estGasUsd(q.gas + approvalGas, gas, ethUsd),
   537	        costs: this.costs(t),
   538	      });
   539	      Object.assign(row, { aggregator: q.source ?? this.d.agg.name, dex_out: toFloat(q.buyAmount, t.decimals), dex_min_out: toFloat(q.minBuyAmount, t.decimals) });
   540	      if (!opp) {
   541	        row.decision = 'inventory';
   542	        row.reason = 'MEXC book too thin for this size';
   543	        return null;
   544	      }
   545	      const problem = orderProblem(t.rules, 'SELL', opp.cexQty, opp.cexLimitPrice);
   546	      if (problem || opp.cexQty > (bal.mexc[t.base] ?? 0)) {
   547	        row.decision = problem ? 'rule' : 'inventory';
   548	        row.reason = problem ?? 'not enough token on MEXC';
   549	        this.fillRow(row, opp, size);
   550	        return null;
   551	      }
   552	      c = { token: t, opp, req, spender, approvalGas, tokenUsd };
   553	    } else {
   554	      // USDT -> token on MEXC, token -> USDC on DEX.
   555	      const plan = planCexBuy({ sizeUsd: size, asks: b.asks, qtyStep: t.qtyStep, takerFee: this.fee(t) });
   556	      if (!plan || plan.tokensToSell > (bal.walletToken[t.base] ?? 0)) {
   557	        row.decision = 'inventory';
   558	        row.reason = plan ? 'not enough token in the wallet' : 'MEXC book too thin for this size';
   559	        return null;
   560	      }
   561	      const req = { sellToken: t.address, buyToken: this.cfg.usdc, sellAmount: toUnits(plan.tokensToSell, t.decimals), taker: this.taker, slippageBps };
   562	      const q = await this.d.agg.price(req);
   563	      const spender = this.spenderOf(q);
   564	      const approvalGas = this.live ? await this.d.chain.approvalGasNeeded(req.sellToken, spender, req.sellAmount) : 0n;
   565	      const opp = evaluateCexBuy({
   566	        plan,
   567	        usdcOut: toFloat(q.buyAmount, this.stableDec),
   568	        usdcMin: toFloat(q.minBuyAmount, this.stableDec),
   569	        gasUsd: this.estGasUsd(q.gas + approvalGas, gas, ethUsd),
   570	        costs: this.costs(t),
   571	      });
   572	      Object.assign(row, { aggregator: q.source ?? this.d.agg.name, dex_out: toFloat(q.buyAmount, this.stableDec), dex_min_out: toFloat(q.minBuyAmount, this.stableDec) });
   573	      const problem = orderProblem(t.rules, 'BUY', opp.cexQty, opp.cexLimitPrice);
   574	      if (problem) {
   575	        Object.assign(row, { decision: 'rule', reason: problem });
   576	        this.fillRow(row, opp, size);
   577	        return null;
   578	      }
   579	      c = { token: t, opp, req, spender, approvalGas, tokenUsd };
   580	    }
   581	    c.need = this.needFor(t, dir, size, bal, tokenUsd);
   582	    c.row = row;
   583	    this.fillRow(row, c.opp, size, c.need);
   584	    return c;
   585	  }
   586	
   587	  private fillRow(row: OpportunityRow, opp: Opportunity, size: number, need?: number) {
   588	    Object.assign(row, {
   589	      gross_bps: (opp.grossUsd / size) * 10_000,
   590	      gas_usd: opp.gasUsd,
   591	      net_usd: opp.net,
   592	      hurdle_usd: need ?? this.need(size),
   593	    });
   594	  }
   595	
   596	  /** Hourly inventory snapshot + per-side warnings + rebalance tickets (live only). */
   597	  private lastSnapshot = 0;
   598	  private lowSince = new Map<string, number>();
   599	  private inventoryHousekeeping(bal: Balances, prices: Record<string, number>) {
   600	    if (!this.live) return;
   601	    const now = Date.now();
   602	    if (now - this.lastSnapshot > 3600_000) {
   603	      this.lastSnapshot = now;
   604	      try {
   605	        this.d.db.insertInventorySnapshot(
   606	          this.d.tokens.filter((t) => prices[t.base]).map((t) => ({
   607	            ts: now,
   608	            token: t.base,
   609	            wallet_usd: (bal.walletToken[t.base] ?? 0) * prices[t.base],
   610	            mexc_usd: (bal.mexc[t.base] ?? 0) * prices[t.base],
   611	          })),
   612	        );
   613	      } catch (e) {
   614	        log.warn(`inventory snapshot: ${errMsg(e)}`);
   615	      }
   616	    }
   617	    const trade = this.cfg.baseTradeUsd > 0 ? this.cfg.baseTradeUsd : this.cfg.maxTradeUsd / 2;
   618	    for (const w of inventoryPlan(bal, this.d.tokens, prices, {
   619	      tradeUsd: trade,
   620	      perSideX: this.cfg.inventoryPerSideX,
   621	      maxTokenSharePct: this.cfg.maxTokenSharePct,
   622	      stableInUsdt: this.stableRate,
   623	      stableSymbol: this.cfg.chain.stable.symbol,
   624	      walletAddress: this.d.chain.address,
   625	    })) {
   626	      if (w.kind === 'warning') {
   627	        void this.alertThrottled(`invplan-${w.key}`, `📦 Inventory: ${w.text}`);
   628	        continue;
   629	      }
   630	      // A side below 1x the trade size for REBALANCE_AFTER_MIN -> ONE ticket (the bot never moves funds).
   631	      const key = `${w.token}:${w.side}`;
   632	      if (!w.low) {
   633	        this.lowSince.delete(key);
   634	        this.d.db.closeTickets(w.token, w.side);
   635	        continue;
   636	      }
   637	      const since = this.lowSince.get(key) ?? now;
   638	      this.lowSince.set(key, since);
   639	      const already = this.d.db.openTickets().some((x) => x.token === w.token && x.side === w.side);
   640	      if (!already && now - since >= this.cfg.rebalanceAfterMin * 60_000) {
   641	        this.d.db.openTicket({ token: w.token, side: w.side, asset: w.asset, amount: w.amount, direction: w.direction });
   642	        void this.d.tg.send(`🎫 Rebalance ticket: ${w.direction}: ${w.amount.toFixed(4)} ${w.asset}. (${w.side} side of ${w.token} has been low for ${this.cfg.rebalanceAfterMin} min.) The bot never moves funds itself.`);
   643	      }
   644	    }
   645	  }
   646	
   647	  private spenderOf(q: Quote): string {
   648	    if (q.spender) return q.spender;
   649	    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
   650	    throw new Error('aggregator did not return a spender');
   651	  }
   652	
   653	  /** Re-check with a firm quote + simulation, then trade both legs at once. */
   654	  async execute(c: Candidate, gas: GasInfo, ethUsd: number): Promise<void> {
   655	    const { token: t } = c;
   656	    this.currentTradeId = null;
   657	    if (!this.live) return this.recordPaper(c, gas, ethUsd);
   658	
   659	    let approvalCostWei = 0n;
   660	    const skip = async (why: string) => {
   661	      log.info(`${t.base} skip: ${why}`);
   662	      if (approvalCostWei > 0n) {
   663	        // The approval gas was really spent; book it so PnL and the loss limit stay honest.
   664	        const g = (Number(approvalCostWei) / 1e18) * ethUsd;
   665	        this.record(c, 'approval', { pnl: -g, gas: g, note: `approval, then skipped: ${why}` });
   666	      }
   667	    };
   668	
   669	    // 0) Worst case must fit in what is left of today's loss budget.
   670	    const worst = (c.opp.sizeUsd * this.cfg.worstCaseLossPct) / 100 + c.opp.gasUsd;
   671	    const budget = this.d.risk.remainingLossBudget();
   672	    if (worst > budget) return skip(`worst case ${usd(worst)} > remaining daily loss budget ${usd(budget)}`);
   673	
   674	    // Snapshot BEFORE the approval, so approval gas is part of the measured PnL.
   675	    const before = await this.d.balances(true);
   676	
   677	    // 1) Exact approval (never unlimited).
   678	    if (c.approvalGas > 0n) {
   679	      const r = await this.d.chain.approveExact(c.req.sellToken, c.spender, c.req.sellAmount, gas);
   680	      approvalCostWei = r.gasCostWei;
   681	      if (r.unknown) {
   682	        const u = this.d.chain.unresolved;
   683	        await skip('approval outcome unknown');
   684	        await this.d.tg.send(
   685	          `⚠️ ${t.base}: approval outcome UNKNOWN (nonce ${u?.nonce ?? '?'}, ${u?.hashes.join(', ') ?? r.hash}). No trade was made. ` +
   686	            `New txs wait until it resolves; /cancelnonce replaces it.`,
   687	        );
   688	        return;
   689	      }
   690	      if (!r.ok) {
   691	        await skip(`approval failed (${r.reason})`);
   692	        await this.d.tg.send(`⚠️ Approval failed for ${t.base}: ${r.reason} ${r.hash ?? ''}`);
   693	        return;
   694	      }
   695	    }
   696	
   697	    // 2) Firm quote + simulation (eth_call). Abort on any doubt.
   698	    let firm: Quote;
   699	    let gasEst: bigint;
   700	    const tQuote = Date.now();
   701	    try {
   702	      firm = await this.d.agg.quote(c.req);
   703	      if (!firm.tx) return skip('firm quote has no transaction');
   704	      gasEst = await this.d.chain.simulate(firm.tx);
   705	    } catch (e) {
   706	      return skip(`simulation/quote failed: ${errMsg(e)}`);
   707	    }
   708	    const tx = firm.tx;
   709	    const quoteMs = Date.now() - tQuote;
   710	
   711	    // 3) Re-evaluate with a fresh REST book, firm amounts and simulated gas.
   712	    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
   713	    const g = this.estGasUsd(gasEst, gas, ethUsd);
   714	    let opp: Opportunity | null;
   715	    if (c.opp.direction === 'DEX_BUY') {
   716	      opp = evaluateDexBuy({
   717	        sizeUsd: c.opp.sizeUsd,
   718	        tokensOut: toFloat(firm.buyAmount, t.decimals),
   719	        tokensMin: toFloat(firm.minBuyAmount, t.decimals),
   720	        bids: b.bids,
   721	        qtyStep: t.qtyStep,
   722	        gasUsd: g,
   723	        costs: this.costs(t),
   724	      });
   725	    } else {
   726	      // Same quantity as quoted on the DEX, priced against the fresh MEXC book.
   727	      const plan = planCexBuyQty(b.asks, c.opp.cexQty, this.fee(t));
   728	      opp = plan
   729	        ? evaluateCexBuy({
   730	            plan,
   731	            usdcOut: toFloat(firm.buyAmount, this.stableDec),
   732	            usdcMin: toFloat(firm.minBuyAmount, this.stableDec),
   733	            gasUsd: g,
   734	            costs: this.costs(t),
   735	          })
   736	        : null;
   737	    }
   738	    const need = c.need ?? this.need(c.opp.sizeUsd); // the inventory-skewed hurdle from the scan
   739	    if (!opp || opp.net <= need) return skip(`profit fell to ${usd(opp?.net ?? 0)} after firm quote (need ${usd(need)})`);
   740	    // MEXC symbol rules on the FINAL numbers, before anything is sent: a rejected MEXC leg after a sent DEX tx = one-sided.
   741	    const side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
   742	    const problem = orderProblem(t.rules, side, opp.cexQty, opp.cexLimitPrice) ?? bandProblem(t.rules, side, opp.cexLimitPrice, mid(b));
   743	    if (problem) return skip(`MEXC would reject the order: ${problem}`);
   744	
   745	    // The CEX leg must never fire if the DEX tx cannot get the next valid nonce.
   746	    if (this.d.chain.readyToSend) {
   747	      const ready = await this.d.chain.readyToSend();
   748	      if (!ready.ok) return skip(`DEX side not ready to send: ${ready.reason}`);
   749	    }
   750	
   751	    // 4) Persist the trade as 'executing' BEFORE anything is sent: if the bot dies now, startup sees it.
   752	    // The approval gas was already spent (and sits inside the balance-based PnL below), so the stored
   753	    // expectation must not promise it back: expected = re-checked net minus approval gas actually paid.
   754	    // (Round-3 review, L3: otherwise realized-minus-expected shows a drag equal to the approval gas.)
   755	    const expectedNet = opp.net - (Number(approvalCostWei) / 1e18) * ethUsd;
   756	    const cid = clientId('t');
   757	    const tradeId = this.record({ ...c, opp: { ...opp, net: expectedNet } }, 'executing', { pnl: 0, gas: 0, orderId: cid, note: `client order id ${cid}` });
   758	    this.currentTradeId = tradeId;
   759	    this.d.db.appendCid(tradeId, cid);
   760	
   761	    // Both legs are sent together. They do NOT complete together: the MEXC order fills in ~1.5s,
   762	    // the DEX tx needs 12-60s to be mined. If the DEX side fails in between, step 5 unwinds on MEXC.
   763	    log.info(`${t.base} EXECUTE ${opp.direction} size ${usd(opp.sizeUsd)} expected ${usd(opp.net)}`);
   764	    const tLegs = Date.now();
   765	    let signMs: number | null = null;
   766	    const [cexR, dexR] = await Promise.allSettled([
   767	      this.cexLeg(t, opp, cid),
   768	      this.d.chain.send(tx, (gasEst * 13n) / 10n, gas, this.cfg.txTimeoutSec, (hash, nonce) => {
   769	        signMs = Date.now() - tLegs;
   770	        this.d.db.updateTrade(tradeId, { dex_tx: hash, note: `client order id ${cid}; nonce ${nonce}` });
   771	      }),
   772	    ]);
   773	
   774	    const dex: TxResult = dexR.status === 'fulfilled' ? dexR.value : { ok: false, gasCostWei: 0n, reason: errMsg(dexR.reason) };
   775	    let cexFilled = 0;
   776	    let orderId: string | null = null;
   777	    let cexUnknown = false;
   778	    if (cexR.status === 'fulfilled') {
   779	      cexFilled = cexR.value.filled;
   780	      orderId = cexR.value.orderId;
   781	    } else if (String((cexR.reason as Error)?.message ?? '').startsWith('UNKNOWN_ORDER_STATE')) {
   782	      cexUnknown = true;
   783	      this.d.risk.pause('MEXC order state unknown', true);
   784	      await this.d.tg.send(`🚨 ${t.base}: MEXC order state unknown after placing. Trading PAUSED. Check MEXC manually.\n${errMsg(cexR.reason)}`);
   785	    } else {
   786	      log.warn(`${t.base} MEXC leg failed: ${errMsg(cexR.reason)}`);
   787	    }
   788	
   789	    // 5) One-sided? Close the open position at market right away.
   790	    let status: TradeStatus = 'ok';
   791	    const notes: string[] = [];
   792	    if (!dex.ok) notes.push(`DEX: ${dex.reason}`);
   793	    if (dex.unknown) {
   794	      // We cannot tell if the swap executed. Unwinding could DOUBLE the position. Stop and ask a human.
   795	      this.d.risk.pause(`DEX tx unknown ${dex.hash}`, true);
   796	      await this.d.tg.send(
   797	        `🚨 ${t.base}: DEX tx ${dex.hash} outcome UNKNOWN (not mined, cancel not confirmed). MEXC filled ${cexFilled}/${opp.cexQty}.\n` +
   798	          `NOT unwinding automatically. Trading PAUSED.\nDo NOT hedge by hand until the nonce is consumed - the bot will alert you. (/cancelnonce replaces it.)`,
   799	      );
   800	    }
   801	    const unwind = cexUnknown || dex.unknown ? null : unwindPlan(opp.direction, dex.ok, opp.cexQty, cexFilled, this.fee(t), t.qtyStep);
   802	    if (cexUnknown || dex.unknown) {
   803	      status = 'one_sided';
   804	      notes.push('pnl unknown'); // the measured balance change may not include the final outcome yet
   805	    } else if (unwind) {
   806	      status = 'one_sided';
   807	      const qty = unwind.qty.toFixed(decimalsOfStep(t.qtyStep));
   808	      try {
   809	        const r = await this.closeAtMarket(t, unwind.side, qty);
   810	        if (r.dust) {
   811	          notes.push(`unwind ${unwind.side} ${qty} not sent: ${r.dust}`);
   812	          await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base}: leftover ${unwind.side} ${qty} is below MEXC minimums (${r.dust}). Left as dust; fix inventory by hand.`);
   813	        } else {
   814	          notes.push(`unwind ${unwind.side} ${qty} (${r.orderId}, filled ${r.filled})`);
   815	          await this.d.tg.send(`⚠️ ONE-SIDED FILL ${t.base} ${opp.direction}\n${unwind.reason}\nClosed: MEXC ${unwind.side} ${r.filled} ${t.base}`);
   816	        }
   817	      } catch (e) {
   818	        const remaining = e instanceof PartialCloseError ? e.remaining : Number(qty);
   819	        if (e instanceof OrderStillOpenError) notes.push(`close order ${e.orderId} may still be live on MEXC: cancel it by hand`);
   820	        this.d.risk.pause(`unwind failed for ${t.base}`, true);
   821	        notes.push(`UNWIND FAILED: ${errMsg(e)}`);
   822	        await this.d.tg.send(
   823	          `🚨 ONE-SIDED FILL ${t.base} and the market close FAILED: ${errMsg(e)}\n` +
   824	            `Still open: MEXC ${unwind.side} ${remaining} ${t.base} needed.\nTrading PAUSED. Close it manually, then /start confirm.`,
   825	        );
   826	      }
   827	    } else if (!dex.ok) {
   828	      status = 'dex_failed'; // nothing filled on either side
   829	    }
   830	
   831	    // 6) Exact PnL = change in total value of everything the trade touched, at pre-trade prices.
   832	    //    Orders are closed (filled/cancelled) by now; free + locked balances avoid counting held funds as lost.
   833	    const { balances: after, stable } = await this.stableBalances(t, c.tokenUsd, ethUsd);
   834	    if (!stable) notes.push('pnl approximate (balances still changing after 15 s)');
   835	    const pnl = portfolioUsd(after, t, c.tokenUsd, ethUsd, this.stableRate) - portfolioUsd(before, t, c.tokenUsd, ethUsd, this.stableRate);
   836	    const gasPaid = (Number(dex.gasCostWei + approvalCostWei) / 1e18) * ethUsd;
   837	    this.d.db.updateTrade(tradeId, {
   838	      status,
   839	      pnl_usd: pnl,
   840	      gas_usd: gasPaid,
   841	      dex_tx: dex.hash ?? null,
   842	      cex_order_id: orderId ?? cid,
   843	      note: [`client order id ${cid}`, ...notes].join('; '),
   844	    });
   845	
   846	    const dexIsBuy = opp.direction === 'DEX_BUY';
   847	    await this.d.tg.send(
   848	      [
   849	        `${status === 'ok' ? '✅' : '⚠️'} LIVE ${t.base} ${opp.direction} [${status}]`,
   850	        `Buy  ${dexIsBuy ? 'DEX ' : 'MEXC'} @ ${opp.buyPrice.toPrecision(6)}`,
   851	        `Sell ${dexIsBuy ? 'MEXC' : 'DEX '} @ ${opp.sellPrice.toPrecision(6)}`,
   852	        `Qty ${opp.cexQty} ${t.base} | size ${usd(opp.sizeUsd)}`,
   853	        `MEXC fee ${usd(opp.cexFeeUsd)} | Gas ${usd(gasPaid)}`,
   854	        `Expected ${usd(expectedNet)} | Net PnL ${usd(pnl)}`,
   855	        dex.hash ? explorerTxUrl(this.cfg.chain, dex.hash) : '',
   856	        notes.length ? `Notes: ${notes.join('; ')}` : '',
   857	      ]
   858	        .filter(Boolean)
   859	        .join('\n'),
   860	    );
   861	    await this.recordLegs(tradeId, t, opp, firm, before, after, dex, cexR.status === 'fulfilled' ? cexR.value : null, {
   862	      quoteMs,
   863	      signMs,
   864	    }).catch((e) => log.warn(`legs: ${errMsg(e)}`));
   865	    this.currentTradeId = null;
   866	    await this.handleRisk(this.d.risk.afterTrade(status));
   867	  }
   868	
   869	  /** Read balances until two reads in a row give the same value (settled), for at most ~15 s. */
   870	  private async stableBalances(t: Token, tokenUsd: number, ethUsd: number): Promise<{ balances: Balances; stable: boolean }> {
   871	    let prev = await this.d.balances(true);
   872	    for (let i = 0; i < 6; i++) {
   873	      await this.sleep(2500);
   874	      const cur = await this.d.balances(true);
   875	      if (Math.abs(portfolioUsd(cur, t, tokenUsd, ethUsd, this.stableRate) - portfolioUsd(prev, t, tokenUsd, ethUsd, this.stableRate)) < 1e-6) return { balances: cur, stable: true };
   876	      prev = cur;
   877	    }
   878	    return { balances: prev, stable: false };
   879	  }
   880	
   881	  /**
   882	   * Close a position on MEXC now with an aggressive LIMIT 2% through the book, for BOTH sides.
   883	   * (No MEXC spot symbol offers IMMEDIATE_OR_CANCEL, and some have no MARKET; LIMIT works everywhere.)
   884	   * Reads the order back and never assumes it filled. Below MEXC minimums -> returns `dust`, sends nothing.
   885	   */
   886	  async closeAtMarket(t: Token, side: Side, qty: string): Promise<{ orderId: string; filled: number; dust?: string }> {
   887	    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
   888	    // 2% through the book, but inside the symbol's PERCENT_PRICE_BY_SIDE band (some are 0.5% - 2%).
   889	    const pxNum = closePrice({ ...t.rules, priceDecimals: t.priceDecimals }, side, { bid: b.bids[0][0], ask: b.asks[0][0] });
   890	    const dust = orderProblem(t.rules, side, Number(qty), pxNum);
   891	    if (dust) return { orderId: '', filled: 0, dust };
   892	    const px = pxNum.toFixed(t.priceDecimals);
   893	    const cid = clientId('c');
   894	    if (this.currentTradeId !== null) this.d.db.appendCid(this.currentTradeId, cid); // before placing (crash safety)
   895	    const { orderId } = await placeSafely(this.d.mexc, t.symbol, cid, () => this.d.mexc.limitOrder(t.symbol, side, qty, px, cid), this.sleep);
   896	    await this.sleep(1500);
   897	    let o = await this.d.mexc.getOrder(t.symbol, orderId);
   898	    if (o.status !== 'FILLED') o = await cancelAndConfirm(this.d.mexc, t.symbol, orderId, this.sleep);
   899	    const filled = Number(o.executedQty);
   900	    if (filled < Number(qty) * 0.999) {
   901	      const remaining = Number((Number(qty) - filled).toFixed(decimalsOfStep(t.qtyStep)));
   902	      throw new PartialCloseError(`close ${side} only filled ${filled}/${qty}, ${remaining} remaining`, remaining);
   903	    }
   904	    return { orderId, filled };
   905	  }
   906	
   907	  /** MEXC marketable limit order; cancels any unfilled rest. Returns filled quantity. */
   908	  async cexLeg(t: Token, opp: Opportunity, cid = clientId('t')): Promise<{ orderId: string; filled: number; ackMs: number }> {
   909	    const side: Side = opp.direction === 'DEX_BUY' ? 'SELL' : 'BUY';
   910	    const qty = opp.cexQty.toFixed(decimalsOfStep(t.qtyStep));
   911	    const f = 10 ** t.priceDecimals;
   912	    const px = side === 'SELL' ? Math.floor(opp.cexLimitPrice * f) / f : Math.ceil(opp.cexLimitPrice * f) / f;
   913	    const tPlace = Date.now();
   914	    const { orderId } = await placeSafely(
   915	      this.d.mexc,
   916	      t.symbol,
   917	      cid,
   918	      () => this.d.mexc.limitOrder(t.symbol, side, qty, px.toFixed(t.priceDecimals), cid),
   919	      this.sleep,
   920	    );
   921	    const ackMs = Date.now() - tPlace;
   922	    log.info(`MEXC ${side} ${qty} ${t.symbol} @ ${px} id=${orderId}`);
   923	    await this.sleep(1500);
   924	
   925	    const read = async (): Promise<Order> => {
   926	      for (let i = 0; i < 3; i++) {
   927	        try {
   928	          return await this.d.mexc.getOrder(t.symbol, orderId);
   929	        } catch (e) {
   930	          log.warn(`getOrder retry: ${errMsg(e)}`);
   931	          await this.sleep(1000);
   932	        }
   933	      }
   934	      throw new Error(`UNKNOWN_ORDER_STATE ${orderId}`);
   935	    };
   936	    let o = await read();
   937	    if (o.status !== 'FILLED') {
   938	      try {
   939	        o = await cancelAndConfirm(this.d.mexc, t.symbol, orderId, this.sleep);
   940	      } catch (e) {
   941	        // The order may still fill later: its state is unknown, so no unwind may be based on it.
   942	        if (e instanceof OrderStillOpenError) throw new Error(`UNKNOWN_ORDER_STATE ${e.message}`);
   943	        throw e;
   944	      }
   945	    }
   946	    return { orderId, filled: Number(o.executedQty), ackMs };
   947	  }
   948	
   949	  /**
   950	   * Paper realism: wait PAPER_LATENCY_MS, re-quote the DEX and re-read the MEXC book, and book THAT net.
   951	   * The first quote overstates profit (in live trading, prices move while both legs are sent).
   952	   */
   953	  private async recordPaper(c: Candidate, gas: GasInfo, ethUsd: number) {
   954	    const { token: t, opp } = c;
   955	    await this.sleep(this.cfg.paperLatencyMs);
   956	    let requoted: number;
   957	    try {
   958	      requoted = (await this.requote(c, gas, ethUsd)) ?? -opp.gasUsd;
   959	    } catch (e) {
   960	      log.warn(`paper re-quote ${t.base}: ${errMsg(e)}`);
   961	      requoted = -opp.gasUsd; // cannot re-quote: assume the worst sensible case (gas spent, nothing earned)
   962	    }
   963	    const id = this.record(c, 'paper', { pnl: requoted, gas: opp.gasUsd });
   964	    this.d.db.updateTrade(id, { requoted_net: requoted });
   965	    await this.d.tg.send(
   966	      `📝 PAPER ${t.base} ${opp.direction}\nBuy @ ${opp.buyPrice.toPrecision(6)} | Sell @ ${opp.sellPrice.toPrecision(6)}\n` +
   967	        `Qty ${opp.cexQty} | size ${usd(opp.sizeUsd)} | fee ${usd(opp.cexFeeUsd)} | gas ${usd(opp.gasUsd)}\n` +
   968	        `Net ${usd(opp.net)} at first quote, ${usd(requoted)} after ${this.cfg.paperLatencyMs} ms re-quote (booked)`,
   969	    );
   970	    await this.handleRisk(this.d.risk.afterTrade('paper'));
   971	  }
   972	
   973	  /** Same trade, fresh prices: DEX re-quote + fresh MEXC book. Returns the new net (null if it no longer fills). */
   974	  private async requote(c: Candidate, gas: GasInfo, ethUsd: number): Promise<number | null> {
   975	    const t = c.token;
   976	    const b = await (this.d.freshBook ?? this.d.book)(t.symbol);
   977	    const q = await this.d.agg.price(c.req);
   978	    const g = this.estGasUsd(q.gas + c.approvalGas, gas, ethUsd);
   979	    if (c.opp.direction === 'DEX_BUY') {
   980	      const o = evaluateDexBuy({
   981	        sizeUsd: c.opp.sizeUsd,
   982	        tokensOut: toFloat(q.buyAmount, t.decimals),
   983	        tokensMin: toFloat(q.minBuyAmount, t.decimals),
   984	        bids: b.bids,
   985	        qtyStep: t.qtyStep,
   986	        gasUsd: g,
   987	        costs: this.costs(t),
   988	      });
   989	      return o?.net ?? null;
   990	    }
   991	    const plan = planCexBuyQty(b.asks, c.opp.cexQty, this.fee(t));
   992	    if (!plan) return null;
   993	    return evaluateCexBuy({ plan, usdcOut: toFloat(q.buyAmount, this.stableDec), usdcMin: toFloat(q.minBuyAmount, this.stableDec), gasUsd: g, costs: this.costs(t) }).net;
   994	  }
   995	
   996	  /** One `legs` row per leg: quoted vs filled price, gas, MEXC fills and fee (myTrades), latency per stage. */
   997	  private async recordLegs(
   998	    tradeId: number,
   999	    t: Token,
  1000	    opp: Opportunity,
  1001	    firm: Quote,
  1002	    before: Balances,
  1003	    after: Balances,
  1004	    dex: TxResult,
  1005	    cex: { orderId: string; filled: number; ackMs: number } | null,
  1006	    lat: { quoteMs: number; signMs: number | null },
  1007	  ) {
  1008	    const dexBuy = opp.direction === 'DEX_BUY';
  1009	    const tokDelta = (after.walletToken[t.base] ?? 0) - (before.walletToken[t.base] ?? 0);
  1010	    const stableDelta = (after.walletUsdc - before.walletUsdc) * this.stableRate;
  1011	    // DEX: buy = USDT-value spent per token received; sell = USDT-value received per token sold.
  1012	    const dexQuoted = dexBuy ? opp.buyPrice : opp.sellPrice;
  1013	    const dexFilled = dex.ok && tokDelta !== 0 ? Math.abs(stableDelta / tokDelta) : null;
  1014	    const slip = (q: number, f: number | null, buy: boolean) => (f === null || !q ? null : ((buy ? f - q : q - f) / q) * 10_000);
  1015	    this.d.db.insertLeg({
  1016	      trade_id: tradeId, leg: 'dex', quoted_price: dexQuoted, filled_price: dexFilled, slippage_bps: slip(dexQuoted, dexFilled, dexBuy),
  1017	      min_out: toFloat(firm.minBuyAmount, dexBuy ? t.decimals : this.stableDec), real_out: dexBuy ? tokDelta : after.walletUsdc - before.walletUsdc,
  1018	      gas_used: dex.gasUsed?.toString() ?? null, gas_price: dex.gasPrice?.toString() ?? null, l1_fee: dex.l1FeeWei?.toString() ?? null,
  1019	      executed_qty: null, avg_price: null, fee: null, fee_asset: null,
  1020	      latency_quote_ms: lat.quoteMs, latency_sign_ms: lat.signMs, latency_inclusion_ms: dex.inclusionMs ?? null, latency_mexc_ack_ms: null,
  1021	    });
  1022	    if (!cex) return;
  1023	    let qty = cex.filled;
  1024	    let avg: number | null = null;
  1025	    let fee: number | null = null;
  1026	    let feeAsset: string | null = null;
  1027	    if (this.d.mexc.myTrades && cex.filled > 0) {
  1028	      const fills = await this.d.mexc.myTrades(t.symbol, cex.orderId);
  1029	      qty = fills.reduce((a, f) => a + Number(f.qty), 0);
  1030	      const quote = fills.reduce((a, f) => a + Number(f.quoteQty), 0);
  1031	      avg = qty > 0 ? quote / qty : null;
  1032	      fee = fills.reduce((a, f) => a + Number(f.commission), 0);
  1033	      feeAsset = fills[0]?.commissionAsset ?? null;
  1034	    }
  1035	    const cexQuoted = dexBuy ? opp.sellPrice : opp.buyPrice;
  1036	    this.d.db.insertLeg({
  1037	      trade_id: tradeId, leg: 'mexc', quoted_price: cexQuoted, filled_price: avg, slippage_bps: slip(cexQuoted, avg, !dexBuy),
  1038	      min_out: null, real_out: null, gas_used: null, gas_price: null, l1_fee: null,
  1039	      executed_qty: qty, avg_price: avg, fee, fee_asset: feeAsset,
  1040	      latency_quote_ms: null, latency_sign_ms: null, latency_inclusion_ms: null, latency_mexc_ack_ms: cex.ackMs,
  1041	    });
  1042	  }
  1043	
  1044	  private record(
  1045	    c: Candidate,
  1046	    status: TradeStatus,
  1047	    r: { pnl: number; gas: number; dexTx?: string; orderId?: string | null; note?: string | null },
  1048	  ): number {
  1049	    const now = Date.now();
  1050	    return this.d.db.insertTrade({
  1051	      ts: now,
  1052	      day: dhakaDay(now),
  1053	      mode: this.cfg.mode,
  1054	      symbol: c.token.base,
  1055	      direction: c.opp.direction,
  1056	      size_usd: c.opp.sizeUsd,
  1057	      qty: c.opp.cexQty,
  1058	      buy_price: c.opp.buyPrice,
  1059	      sell_price: c.opp.sellPrice,
  1060	      expected_net: c.opp.net,
  1061	      cex_fee_usd: status === 'approval' ? 0 : c.opp.cexFeeUsd,
  1062	      gas_usd: r.gas,
  1063	      pnl_usd: r.pnl,
  1064	      status,
  1065	      dex_tx: r.dexTx ?? null,
  1066	      cex_order_id: r.orderId ?? null,
  1067	      note: r.note ?? null,
  1068	    });
  1069	  }
  1070	
  1071	  private async handleRisk(events: RiskEvent[]) {
  1072	    for (const e of events) {
  1073	      if (e.kind === 'loss_limit') await this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). Trading STOPPED. Send /start to resume.`);
  1074	      if (e.kind === 'fail_streak') await this.d.tg.send(`🛑 ${e.count} failed trades in a row. Trading PAUSED. Check logs, then /start.`);
  1075	      if (e.kind === 'trade_limit') await this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}). Resumes tomorrow (Dhaka time).`);
  1076	    }
  1077	  }
  1078	}
```

## `src/inventory.ts`

```
     1	// Balances on both sides and rebalancing alerts. The bot never moves funds itself.
     2	import type { Chain } from './dex/chain.js';
     3	import type { MexcRest } from './mexc/rest.js';
     4	import type { Token } from './watchlist.js';
     5	import { toFloat } from './util.js';
     6	
     7	export interface Balances {
     8	  walletEth: number;
     9	  walletUsdc: number;
    10	  walletToken: Record<string, number>; // by token base symbol
    11	  mexc: Record<string, number>; // free balance by asset
    12	}
    13	
    14	export async function snapshot(chain: Chain, mexc: MexcRest, usdc: string, tokens: Token[], total = false, stableDecimals = 6): Promise<Balances> {
    15	  const [eth, usdcBal, mexcBal, ...toks] = await Promise.all([
    16	    chain.ethBalance(),
    17	    chain.tokenBalance(usdc),
    18	    mexc.balances(total),
    19	    ...tokens.map((t) => chain.tokenBalance(t.address)),
    20	  ]);
    21	  return {
    22	    walletEth: toFloat(eth, 18),
    23	    walletUsdc: toFloat(usdcBal, stableDecimals), // 6 for USDC, 18 for BSC USDT
    24	    walletToken: Object.fromEntries(tokens.map((t, i) => [t.base, toFloat(toks[i], t.decimals)])),
    25	    mexc: mexcBal,
    26	  };
    27	}
    28	
    29	/** Paper mode: unlimited fake balances, so only MAX_TRADE_USD limits the size. */
    30	export function paperBalances(tokens: Token[]): Balances {
    31	  const big = 1e12;
    32	  return {
    33	    walletEth: 1,
    34	    walletUsdc: big,
    35	    walletToken: Object.fromEntries(tokens.map((t) => [t.base, big])),
    36	    mexc: { USDT: big, ...Object.fromEntries(tokens.map((t) => [t.base, big])) },
    37	  };
    38	}
    39	
    40	/** USD value of the assets a trade in `token` can touch (used for exact PnL). */
    41	export function portfolioUsd(b: Balances, token: Token, tokenUsd: number, ethUsd: number, stableInUsdt = 1): number {
    42	  return (
    43	    b.walletUsdc * stableInUsdt + // wallet stable (USDC) valued in USDT
    44	    (b.mexc.USDT ?? 0) +
    45	    ((b.walletToken[token.base] ?? 0) + (b.mexc[token.base] ?? 0)) * tokenUsd +
    46	    b.walletEth * ethUsd
    47	  );
    48	}
    49	
    50	/** Human-readable warnings for low or one-sided inventory. */
    51	export function inventoryWarnings(
    52	  b: Balances,
    53	  tokens: Token[],
    54	  prices: Record<string, number>,
    55	  minTradeUsd: number,
    56	  minEth: number,
    57	): { key: string; text: string }[] {
    58	  const w: { key: string; text: string }[] = [];
    59	  if (b.walletEth < minEth) w.push({ key: 'eth', text: `Wallet ETH for gas is low: ${b.walletEth.toFixed(4)} ETH` });
    60	  if (b.walletUsdc < minTradeUsd) w.push({ key: 'usdc', text: `Wallet USDC low: $${b.walletUsdc.toFixed(2)} (DEX buys blocked)` });
    61	  if ((b.mexc.USDT ?? 0) < minTradeUsd) w.push({ key: 'usdt', text: `MEXC USDT low: $${(b.mexc.USDT ?? 0).toFixed(2)} (MEXC buys blocked)` });
    62	  for (const t of tokens) {
    63	    const p = prices[t.base];
    64	    if (!p) continue;
    65	    const wal = (b.walletToken[t.base] ?? 0) * p;
    66	    const cex = (b.mexc[t.base] ?? 0) * p;
    67	    if (wal < minTradeUsd) w.push({ key: `w-${t.base}`, text: `Wallet ${t.base} low: $${wal.toFixed(2)} (DEX sells blocked)` });
    68	    if (cex < minTradeUsd) w.push({ key: `m-${t.base}`, text: `MEXC ${t.base} low: $${cex.toFixed(2)} (MEXC sells blocked)` });
    69	    const total = wal + cex;
    70	    if (total > 0 && Math.min(wal, cex) / total < 0.2 && total >= 2 * minTradeUsd) {
    71	      w.push({
    72	        key: `r-${t.base}`,
    73	        text: `${t.base} needs rebalancing: wallet $${wal.toFixed(0)} / MEXC $${cex.toFixed(0)}`,
    74	      });
    75	    }
    76	  }
    77	  return w;
    78	}
    79	
    80	export type PlanItem =
    81	  | { kind: 'warning'; key: string; text: string }
    82	  | { kind: 'side'; token: string; side: 'wallet' | 'mexc'; low: boolean; asset: string; amount: number; direction: string };
    83	
    84	/**
    85	 * Inventory sizing (phase 1, item 5):
    86	 *  - target per token per side = INVENTORY_PER_SIDE_X x the trade size;
    87	 *  - a side below 1x the trade size is "low" (the engine turns a long-lasting low side into ONE ticket);
    88	 *  - token holdings above MAX_TOKEN_SHARE_PCT of the portfolio -> warning.
    89	 * The bot never moves funds: tickets tell a human what to deposit or withdraw.
    90	 */
    91	export function inventoryPlan(
    92	  b: Balances,
    93	  tokens: Token[],
    94	  prices: Record<string, number>,
    95	  o: { tradeUsd: number; perSideX: number; maxTokenSharePct: number; stableInUsdt?: number; walletAddress?: string; stableSymbol?: string },
    96	): PlanItem[] {
    97	  const out: PlanItem[] = [];
    98	  const target = o.tradeUsd * o.perSideX;
    99	  const toWallet = `withdraw MEXC→wallet${o.walletAddress ? ` ${o.walletAddress}` : ''} (in the MEXC app)`;
   100	  const toMexc = 'deposit wallet→MEXC';
   101	  // The DEX-side stable (USDC on Ethereum/Base/Arbitrum, USDT on BSC). The wallet side needs
   102	  // that stable, not MEXC's USDT: withdrawing USDT to the wallet does not give it USDC, and
   103	  // topping up MEXC from a USDC wallet needs a swap to USDT on MEXC (round-3 review, L2).
   104	  const stable = o.stableSymbol;
   105	  const toWalletStable = stable ? `withdraw ${stable} MEXC→wallet${o.walletAddress ? ` ${o.walletAddress}` : ''} (in the MEXC app)` : toWallet;
   106	  const toMexcStable = stable && stable !== 'USDT' ? `deposit ${stable} wallet→MEXC (swap to USDT on MEXC)` : toMexc;
   107	  let tokenUsd = 0;
   108	  for (const t of tokens) {
   109	    const px = prices[t.base];
   110	    if (!px) continue;
   111	    const w = (b.walletToken[t.base] ?? 0) * px;
   112	    const m = (b.mexc[t.base] ?? 0) * px;
   113	    tokenUsd += w + m;
   114	    out.push({ kind: 'side', token: t.base, side: 'wallet', low: w < o.tradeUsd, asset: t.base, amount: Math.max(0, Math.min(target - w, m)) / px, direction: toWallet });
   115	    out.push({ kind: 'side', token: t.base, side: 'mexc', low: m < o.tradeUsd, asset: t.base, amount: Math.max(0, Math.min(target - m, w)) / px, direction: toMexc });
   116	  }
   117	  const walletStable = b.walletUsdc * (o.stableInUsdt ?? 1);
   118	  const mexcStable = b.mexc.USDT ?? 0;
   119	  // Wallet-side amount is in stable units (USDT amount / the USDC-USDT rate); MEXC side is USDT.
   120	  out.push({ kind: 'side', token: 'STABLE', side: 'wallet', low: walletStable < o.tradeUsd, asset: stable ?? 'USDC/USDT', amount: Math.max(0, Math.min(target - walletStable, mexcStable)) / (o.stableInUsdt ?? 1), direction: toWalletStable });
   121	  out.push({ kind: 'side', token: 'STABLE', side: 'mexc', low: mexcStable < o.tradeUsd, asset: 'USDT', amount: Math.max(0, Math.min(target - mexcStable, walletStable)), direction: toMexcStable });
   122	
   123	  const total = tokenUsd + walletStable + mexcStable;
   124	  if (total > 0 && (tokenUsd / total) * 100 > o.maxTokenSharePct) {
   125	    out.push({ kind: 'warning', key: 'token-share', text: `tokens are ${((tokenUsd / total) * 100).toFixed(0)}% of the portfolio (max ${o.maxTokenSharePct}%): token price moves now dominate PnL` });
   126	  }
   127	  return out;
   128	}
```

## `src/kpi.ts`

```
     1	// Phase-1 KPIs from the `opportunities`, `trades` and `inventory_snapshots` tables.
     2	// Answers "is this worth running?" with the bot's own data (daily Telegram summary and `npm run report`).
     3	import type { Db } from './db.js';
     4	import { usd } from './util.js';
     5	
     6	const DHAKA_H = 6; // Asia/Dhaka = UTC+6
     7	
     8	export interface Kpis {
     9	  opportunitiesPerToken: { token: string; n: number; best_gross_bps: number | null }[];
    10	  decisions: { decision: string; n: number }[];
    11	  minutesAbove: { bps: number; minutes: number }[];
    12	  histogram: { token: string; bucket: string; n: number }[];
    13	  byHourDhaka: { hour: number; minutes_above_20: number }[];
    14	  wouldHave: { hurdle_bps: number; trades: number; pnl: number }[];
    15	  realizedMinusExpected: number | null;
    16	  gasShareOfGross: number | null;
    17	  oneSidedRate: number | null;
    18	  inventorySkew: { token: string; wallet_share: number }[];
    19	}
    20	
    21	const BUCKETS = ['<0', '0-10', '10-20', '20-35', '35-50', '50+'];
    22	const bucketSql = `CASE WHEN gross_bps < 0 THEN '<0' WHEN gross_bps < 10 THEN '0-10' WHEN gross_bps < 20 THEN '10-20'
    23	  WHEN gross_bps < 35 THEN '20-35' WHEN gross_bps < 50 THEN '35-50' ELSE '50+' END`;
    24	
    25	export function computeKpis(db: Db, sinceTs: number, mode: string): Kpis {
    26	  const q = <T>(sql: string, ...a: unknown[]) => db.all<T>(sql, ...a);
    27	  const opportunitiesPerToken = q<{ token: string; n: number; best_gross_bps: number | null }>(
    28	    `SELECT token, COUNT(*) n, MAX(gross_bps) best_gross_bps FROM opportunities WHERE ts >= ? AND gross_bps IS NOT NULL GROUP BY token ORDER BY n DESC`,
    29	    sinceTs,
    30	  );
    31	  const decisions = q<{ decision: string; n: number }>(`SELECT decision, COUNT(*) n FROM opportunities WHERE ts >= ? GROUP BY decision ORDER BY n DESC`, sinceTs);
    32	  const minutesAbove = [20, 35, 50].map((bps) => ({
    33	    bps,
    34	    minutes: q<{ m: number }>(`SELECT COUNT(DISTINCT ts / 60000) m FROM opportunities WHERE ts >= ? AND gross_bps >= ?`, sinceTs, bps)[0]?.m ?? 0,
    35	  }));
    36	  const histogram = q<{ token: string; bucket: string; n: number }>(
    37	    `SELECT token, ${bucketSql} bucket, COUNT(*) n FROM opportunities WHERE ts >= ? AND gross_bps IS NOT NULL GROUP BY token, bucket`,
    38	    sinceTs,
    39	  );
    40	  const byHourDhaka = q<{ hour: number; minutes_above_20: number }>(
    41	    `SELECT ((ts / 3600000) + ${DHAKA_H}) % 24 hour, COUNT(DISTINCT ts / 60000) minutes_above_20
    42	     FROM opportunities WHERE ts >= ? AND gross_bps >= 20 GROUP BY hour ORDER BY hour`,
    43	    sinceTs,
    44	  );
    45	  // Would-have PnL: at most one trade per token+direction per minute (the best net in that minute),
    46	  // traded if its net (already after fee, gas, slippage and safety) beats the hurdle.
    47	  // The hurdle uses the BEST row's own size: MAX(net) and MAX(size) from different rows would
    48	  // make the hurdle stricter than the chosen trade's own (round-3 review, M4).
    49	  const wouldHave = [20, 30, 40, 60].map((h) => {
    50	    const r = q<{ trades: number; pnl: number | null }>(
    51	      `SELECT COUNT(*) trades, SUM(best) pnl FROM (
    52	         SELECT net_usd best, size_usd size FROM (
    53	           SELECT net_usd, size_usd, ROW_NUMBER() OVER (
    54	             PARTITION BY token, direction, ts / 60000 ORDER BY net_usd DESC, size_usd DESC
    55	           ) rn FROM opportunities
    56	           WHERE ts >= ? AND net_usd IS NOT NULL AND size_usd > 0
    57	         ) WHERE rn = 1
    58	       ) WHERE best >= size * ? / 10000.0`,
    59	      sinceTs,
    60	      h,
    61	    )[0];
    62	    return { hurdle_bps: h, trades: r?.trades ?? 0, pnl: r?.pnl ?? 0 };
    63	  });
    64	  const t = q<{ n: number; diff: number | null; gas: number | null; gross: number | null; one_sided: number | null }>(
    65	    `SELECT COUNT(*) n,
    66	            AVG(CASE WHEN status IN ('ok','paper') THEN pnl_usd - expected_net END) diff,
    67	            SUM(CASE WHEN status IN ('ok','paper') THEN gas_usd ELSE 0 END) gas,
    68	            SUM(CASE WHEN status IN ('ok','paper') THEN pnl_usd + gas_usd + cex_fee_usd END) gross,
    69	            SUM(CASE WHEN status = 'one_sided' THEN 1 ELSE 0 END) one_sided
    70	     FROM trades WHERE ts >= ? AND mode = ? AND status != 'approval'`,
    71	    sinceTs,
    72	    mode,
    73	  )[0];
    74	  const inventorySkew = q<{ token: string; wallet_share: number }>(
    75	    `SELECT token, wallet_usd / NULLIF(wallet_usd + mexc_usd, 0) wallet_share FROM inventory_snapshots s
    76	     WHERE ts = (SELECT MAX(ts) FROM inventory_snapshots WHERE token = s.token)`,
    77	  );
    78	  return {
    79	    opportunitiesPerToken,
    80	    decisions,
    81	    minutesAbove,
    82	    histogram,
    83	    byHourDhaka,
    84	    wouldHave,
    85	    realizedMinusExpected: t?.n ? t.diff : null,
    86	    gasShareOfGross: t?.gross ? (t.gas ?? 0) / t.gross : null,
    87	    oneSidedRate: t?.n ? (t.one_sided ?? 0) / t.n : null,
    88	    inventorySkew,
    89	  };
    90	}
    91	
    92	const bar = (n: number, max: number) => '█'.repeat(max > 0 ? Math.max(n > 0 ? 1 : 0, Math.round((n / max) * 12)) : 0);
    93	
    94	export function formatKpis(k: Kpis): string {
    95	  const lines: string[] = ['— Opportunities —'];
    96	  if (!k.opportunitiesPerToken.length) lines.push('  none logged yet');
    97	  for (const o of k.opportunitiesPerToken) lines.push(`  ${o.token}: ${o.n} quotes, best gross ${o.best_gross_bps?.toFixed(1) ?? '-'} bps`);
    98	  lines.push(`  decisions: ${k.decisions.map((d) => `${d.decision} ${d.n}`).join(', ') || '-'}`);
    99	  lines.push(`  minutes with gross gap ≥20/35/50 bps: ${k.minutesAbove.map((m) => m.minutes).join(' / ')}`);
   100	  const tokens = [...new Set(k.histogram.map((h) => h.token))];
   101	  if (tokens.length) lines.push('— Gross gap histogram (bps) —');
   102	  for (const tok of tokens) {
   103	    const rows = BUCKETS.map((b) => k.histogram.find((h) => h.token === tok && h.bucket === b)?.n ?? 0);
   104	    const max = Math.max(...rows);
   105	    lines.push(`  ${tok}: ${BUCKETS.map((b, i) => `${b}:${rows[i]}${bar(rows[i], max)}`).join(' ')}`);
   106	  }
   107	  if (k.byHourDhaka.length) {
   108	    lines.push(`— Minutes ≥20 bps by hour (Dhaka) — ${k.byHourDhaka.map((h) => `${String(h.hour).padStart(2, '0')}h:${h.minutes_above_20}`).join(' ')}`);
   109	  }
   110	  lines.push(`— Would-have PnL — ${k.wouldHave.map((w) => `${w.hurdle_bps}bps: ${w.trades} trades ${usd(w.pnl)}`).join(' | ')}`);
   111	  lines.push(
   112	    `— Execution — realized−expected ${k.realizedMinusExpected === null ? '-' : usd(k.realizedMinusExpected)} per trade, ` +
   113	      `gas share ${k.gasShareOfGross === null ? '-' : `${(k.gasShareOfGross * 100).toFixed(0)}%`}, ` +
   114	      `one-sided ${k.oneSidedRate === null ? '-' : `${(k.oneSidedRate * 100).toFixed(0)}%`}`,
   115	  );
   116	  if (k.inventorySkew.length) {
   117	    lines.push(`— Inventory (wallet share) — ${k.inventorySkew.map((s) => `${s.token} ${(s.wallet_share * 100).toFixed(0)}%`).join(', ')}`);
   118	  }
   119	  return lines.join('\n');
   120	}
   121	
   122	/** CSV of opportunities per token and Dhaka hour, for spreadsheets. */
   123	export function opportunitiesCsv(db: Db, sinceTs: number): string {
   124	  const rows = db.all<{ token: string; hour: number; n: number; max_gross_bps: number | null; minutes_above_20: number }>(
   125	    `SELECT token, ((ts / 3600000) + ${DHAKA_H}) % 24 hour, COUNT(*) n, MAX(gross_bps) max_gross_bps,
   126	            COUNT(DISTINCT CASE WHEN gross_bps >= 20 THEN ts / 60000 END) minutes_above_20
   127	     FROM opportunities WHERE ts >= ? GROUP BY token, hour ORDER BY token, hour`,
   128	    sinceTs,
   129	  );
   130	  return ['token,hour_dhaka,quotes,max_gross_bps,minutes_above_20', ...rows.map((r) => `${r.token},${r.hour},${r.n},${r.max_gross_bps ?? ''},${r.minutes_above_20}`)].join('\n');
   131	}
```

## `src/log.ts`

```
     1	// Console logger that scrubs secrets (private key, API keys, bot token) from every line.
     2	
     3	let secrets: string[] = [];
     4	
     5	export function registerSecrets(values: string[]): void {
     6	  secrets = [...new Set(values)].sort((a, b) => b.length - a.length);
     7	}
     8	
     9	export function redact(text: string): string {
    10	  let out = text;
    11	  for (const s of secrets) out = out.split(s).join('***');
    12	  return out;
    13	}
    14	
    15	function fmt(args: unknown[]): string {
    16	  return redact(
    17	    args
    18	      .map((a) => (a instanceof Error ? `${a.message}` : typeof a === 'string' ? a : JSON.stringify(a, bigintSafe)))
    19	      .join(' '),
    20	  );
    21	}
    22	
    23	export function bigintSafe(_k: string, v: unknown): unknown {
    24	  return typeof v === 'bigint' ? v.toString() : v;
    25	}
    26	
    27	export function errMsg(e: unknown): string {
    28	  if (e && typeof e === 'object') {
    29	    const o = e as { shortMessage?: string; message?: string };
    30	    return redact(o.shortMessage || o.message || String(e));
    31	  }
    32	  return redact(String(e));
    33	}
    34	
    35	const ts = () => new Date().toISOString();
    36	export const log = {
    37	  info: (...a: unknown[]) => console.log(`${ts()} INFO  ${fmt(a)}`),
    38	  warn: (...a: unknown[]) => console.warn(`${ts()} WARN  ${fmt(a)}`),
    39	  error: (...a: unknown[]) => console.error(`${ts()} ERROR ${fmt(a)}`),
    40	};
```

## `src/main.ts`

```
     1	// Entry point. Wires everything together, runs one scan per Ethereum block.
     2	import fs from 'node:fs';
     3	import { loadConfig, secretsOf, validateConfig } from './config.js';
     4	import { log, errMsg, registerSecrets } from './log.js';
     5	import { Db } from './db.js';
     6	import { Risk } from './risk.js';
     7	import { Telegram } from './telegram.js';
     8	import { MexcRest, RateLimitError } from './mexc/rest.js';
     9	import { MexcBookStream } from './mexc/ws.js';
    10	import { Chain } from './dex/chain.js';
    11	import { BestOf, Kyber, Limited, OneInch, TokenBucket, ZeroEx, type Aggregator } from './dex/aggregator.js';
    12	import { buildWatchlist, provenTokens, refreshStatus } from './watchlist.js';
    13	import { paperBalances, snapshot } from './inventory.js';
    14	import { Engine } from './engine.js';
    15	import { TransferEngine } from './transfer.js';
    16	import { formatReport } from './summary.js';
    17	import { recoverExecuting } from './recovery.js';
    18	import { makeUnresolvedCheck, resolveTrade, startHandler, unresolvedLines } from './commands.js';
    19	import { dhakaDay, dhakaHourMinute, usd } from './util.js';
    20	
    21	const cfg = validateConfig(loadConfig());
    22	registerSecrets(secretsOf(cfg));
    23	
    24	/** Backoff after HTTP 429/418 from any API: skip scans for 1, 2, 4 ... up to 15 minutes. */
    25	const rateLimit = { until: 0, level: 0 };
    26	function onScanError(e: unknown): boolean {
    27	  if (e instanceof RateLimitError || /\b(429|418)\b/.test(errMsg(e))) {
    28	    const retryAfter = e instanceof RateLimitError ? e.retryAfterSec * 1000 : 0;
    29	    const wait = Math.max(retryAfter, Math.min(15 * 60_000, 60_000 * 2 ** rateLimit.level++));
    30	    rateLimit.until = Date.now() + wait;
    31	    log.warn(`rate limited, pausing scans for ${wait / 60_000} min`);
    32	    return true;
    33	  }
    34	  return false;
    35	}
    36	function rateLimited(): boolean {
    37	  if (Date.now() < rateLimit.until) return true;
    38	  return false;
    39	}
    40	function rateLimitOk() {
    41	  rateLimit.level = 0;
    42	}
    43	
    44	/** Set by shutdown: loops stop starting new ticks. */
    45	export const lifecycle = { stopping: false, busy: false };
    46	
    47	/**
    48	 * Crash handlers: exit (pm2 restarts) only on real crashes; a stray rejected promise is logged and alerted.
    49	 * On SIGINT/SIGTERM/crash: stop new ticks and wait for a running trade to finish (up to TX_TIMEOUT_SEC*2+30s).
    50	 */
    51	function installProcessHandlers(tg: Telegram, cleanup: () => void) {
    52	  let shuttingDown = false;
    53	  const shutdown = async (why: string, code: number) => {
    54	    if (shuttingDown) return;
    55	    shuttingDown = true;
    56	    lifecycle.stopping = true;
    57	    // pm2 sends SIGKILL after kill_timeout (ecosystem.config.cjs: 240 s; pm2's default is only 1.6 s).
    58	    // A running trade can need ~2x TX_TIMEOUT_SEC (swap + cancel) plus lookups and an unwind, so wait for
    59	    // TX_TIMEOUT_SEC*2 + 60 s. validateConfig caps TX_TIMEOUT_SEC at 80, so this always stays below 240 s.
    60	    const deadline = Date.now() + cfg.txTimeoutSec * 2 * 1000 + 60_000;
    61	    if (lifecycle.busy) log.info('shutdown: waiting for the running trade to finish');
    62	    while (lifecycle.busy && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
    63	    await tg.send(`🔌 Bot stopped: ${why}${lifecycle.busy ? ' (a trade was still running: check /status after restart)' : ''}`);
    64	    cleanup();
    65	    tg.stop();
    66	    process.exit(code);
    67	  };
    68	  let lastRejectAlert = 0;
    69	  process.on('SIGINT', () => void shutdown('SIGINT', 0));
    70	  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
    71	  process.on('unhandledRejection', (e) => {
    72	    log.error(`unhandled rejection: ${errMsg(e)}`);
    73	    if (Date.now() - lastRejectAlert > 3600_000) {
    74	      lastRejectAlert = Date.now();
    75	      void tg.send(`❗ Unhandled error (bot keeps running): ${errMsg(e)}`);
    76	    }
    77	  });
    78	  process.on('uncaughtException', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));
    79	}
    80	
    81	/** Refuse to trade live if .env is readable by other users. */
    82	function checkEnvPermissions(path: string) {
    83	  if (!fs.existsSync(path)) return log.warn(`${path} not found; make sure secrets come from a protected place`);
    84	  const mode = fs.statSync(path).mode & 0o777;
    85	  if (mode & 0o077) throw new Error(`${path} has permissions ${mode.toString(8)}; run: chmod 600 ${path}`);
    86	}
    87	
    88	async function main() {
    89	  if (cfg.mode === 'live') checkEnvPermissions(cfg.envPath);
    90	
    91	  const db = new Db(cfg.dbPath);
    92	  // Twin setup: the live bot reads paper history from the paper bot's DB (readonly);
    93	  // its own DB holds live trades + risk state. Empty PAPER_DB_PATH = own DB (paper bot itself).
    94	  let paperDb: Db = db;
    95	  if (cfg.paperDbPath) {
    96	    try {
    97	      paperDb = new Db(cfg.paperDbPath, true);
    98	    } catch (e) {
    99	      log.warn(`paper DB ${cfg.paperDbPath} unreadable (${errMsg(e)}): live watchlist will be empty`);
   100	    }
   101	  }
   102	  const risk = new Risk(db, cfg.mode, cfg);
   103	  // Every Telegram message carries the mode on its first line, so paper and live
   104	  // can never be confused in the same chat: 📝 PAPER vs 🔴 LIVE — আসল টাকা.
   105	  const modeTag = cfg.mode === 'live' ? '🔴 LIVE — আসল টাকা' : '📝 PAPER';
   106	  const tg = new Telegram(cfg.telegramToken, cfg.telegramChatId, fetch, cfg.telegramAdminId, {
   107	    get: () => db.getState('telegram_offset'),
   108	    set: (v) => db.setState('telegram_offset', v),
   109	  }, modeTag);
   110	  if (!tg.enabled) log.warn('Telegram not configured: alerts only go to the log and there is no /stop');
   111	  const mexc = new MexcRest(cfg.mexcApiKey, cfg.mexcApiSecret);
   112	  const chain = new Chain(cfg.rpcUrl, cfg.sendRpcUrl, cfg.privateKey, cfg.priorityFeeGwei, {
   113	    get: () => db.getState('unresolved_tx') || undefined,
   114	    set: (v) => db.setState('unresolved_tx', v ?? ''),
   115	  }, cfg.chain.chainId, cfg.unlimitedApproval);
   116	  // Every aggregator gets its own quote budget (token bucket, honours 429 / Retry-After).
   117	  const limited = cfg.aggregators.map((name) => {
   118	    const inner =
   119	      name === '0x'
   120	        ? new ZeroEx(cfg.zeroExApiKey, fetch, cfg.chain.chainId)
   121	        : name === '1inch'
   122	          ? new OneInch(cfg.oneInchApiKey, fetch, cfg.chain.chainId)
   123	          : new Kyber(cfg.chain.kyberName, cfg.kyberClientId);
   124	    return new Limited(inner, new TokenBucket(cfg.quoteRps[name]));
   125	  });
   126	  const agg: Aggregator = limited.length === 1 ? limited[0] : new BestOf(limited);
   127	
   128	  // --- Pre-flight checks: fail at startup, not in the middle of the first trade ---
   129	  const chainId = BigInt(await chain.provider.send('eth_chainId', []));
   130	  if (chainId !== BigInt(cfg.chain.chainId)) {
   131	    throw new Error(`RPC_URL is chain ${chainId}, but CHAIN=${cfg.chain.name} needs ${cfg.chain.chainId}`);
   132	  }
   133	  const sendId = BigInt(await chain.sendProvider.send('eth_chainId', []));
   134	  if (sendId !== BigInt(cfg.chain.chainId)) throw new Error(`SEND_RPC_URL is chain ${sendId}, expected ${cfg.chain.chainId}`);
   135	  const stableDecimals = await chain.decimals(cfg.usdc);
   136	  log.info(`chain ${cfg.chain.name} (${cfg.chain.chainId}), DEX stable ${cfg.chain.stable.symbol} ${cfg.usdc} (${stableDecimals} decimals)`);
   137	  if (!cfg.mexcApiKey || !cfg.mexcApiSecret) {
   138	    // Coin/network info (contract addresses, deposit/withdraw status) is a signed MEXC endpoint.
   139	    throw new Error('MEXC_API_KEY/SECRET are required even in paper mode (a read-only key is enough for paper)');
   140	  }
   141	  const skew = await mexc.syncTime();
   142	  if (Math.abs(skew) > 1000) log.warn(`VPS clock is ${skew} ms off MEXC time; corrected, but enable NTP (timedatectl set-ntp true)`);
   143	  // Aggregator key and route smoke test: quote 100 USDC -> WETH.
   144	  await agg.price({
   145	    sellToken: cfg.usdc,
   146	    buyToken: cfg.chain.wrappedNative,
   147	    sellAmount: 100n * 10n ** BigInt(stableDecimals),
   148	    taker: chain.wallet?.address ?? '0x000000000000000000000000000000000000dEaD',
   149	    slippageBps: cfg.dexSlippageBps,
   150	  });
   151	  if (cfg.mode === 'live') {
   152	    if (!tg.enabled) throw new Error('Live mode needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (kill switch)');
   153	    if (!cfg.telegramAdminId) throw new Error('Live mode needs TELEGRAM_ADMIN_ID (only this user may send /stop /start)');
   154	    const acc = await mexc.account();
   155	    if (!acc.canTrade) throw new Error('MEXC API key cannot trade');
   156	    const eth = Number(await chain.ethBalance()) / 1e18;
   157	    if (eth < cfg.minEthForGas) throw new Error(`Hot wallet has ${eth} ETH, need at least MIN_ETH_FOR_GAS=${cfg.minEthForGas}`);
   158	    const usdt = Number(acc.balances.find((b) => b.asset === 'USDT')?.free ?? 0);
   159	    log.info(`wallet ${chain.address}: ${eth.toFixed(4)} ETH | MEXC USDT ${usdt.toFixed(2)}`);
   160	    if (usdt < cfg.minTradeUsd) log.warn(`MEXC USDT ${usdt} < MIN_TRADE_USD: MEXC buys are blocked until you deposit`);
   161	    if (cfg.strategy === 'transfer') {
   162	      await tg.send(
   163	        `🔐 Reminder: STRATEGY=transfer uses MEXC withdrawals. Make sure the API key is IP-bound to this VPS and the MEXC ` +
   164	          `withdrawal address whitelist contains ONLY ${chain.address}.`,
   165	      );
   166	    }
   167	  }
   168	
   169	  if (cfg.mode === 'live') {
   170	    // Symbols to sweep for open bot orders: the inventory watchlist (transfer orders use persisted ids).
   171	    const symbols = cfg.strategy === 'inventory' && cfg.watchlist.length ? cfg.watchlist.map((b) => `${b}USDT`) : [];
   172	    await recoverExecuting(db, risk, tg, mexc, (h) => chain.provider.getTransactionReceipt(h), () => chain.checkUnresolved(), { symbols });
   173	  }
   174	  // Keep signed MEXC timestamps inside recvWindow even if the VPS clock drifts.
   175	  setInterval(() => void mexc.syncTime().catch((e) => log.warn(`clock sync: ${errMsg(e)}`)), 10 * 60_000);
   176	
   177	  if (cfg.strategy === 'transfer') return runTransfer(db, risk, tg, mexc, chain, agg, paperDb);
   178	
   179	  const tokens = await buildWatchlist(mexc, (a) => chain.decimals(a), {
   180	    chain: cfg.chain,
   181	    only: cfg.watchlist,
   182	    max: cfg.watchlistMax,
   183	    minTvlUsd: cfg.minDexTvlUsd,
   184	    minVolumeUsd: cfg.minMexcVolumeUsd,
   185	  });
   186	  if (tokens.length === 0) throw new Error('Watchlist is empty: no token passed the filters');
   187	  // Live mode trades only tokens proven profitable in paper trading (paper history
   188	  // lives in this DB). Paper mode is the scout: it keeps the full volume list.
   189	  if (cfg.mode === 'live') {
   190	    const proven = provenTokens(tokens, paperDb.paperTokenStats(), cfg.liveMinPaperTrades, cfg.liveMinPaperPnlUsd, cfg.liveWatchlistMax);
   191	    if (!proven.length) {
   192	      const msg = '⚠️ Live mode: কোনো টোকেন এখনো paper-এ প্রমাণিত হয়নি — live trade হবে না। Paper-এ লাভ করা টোকেন আসলেই watchlist-এ ঢুকবে।';
   193	      log.warn(msg);
   194	      await tg.send(msg).catch(() => {});
   195	      tokens.length = 0;
   196	    } else {
   197	      tokens.splice(0, tokens.length, ...proven);
   198	      const msg = `🎯 Live watchlist — paper-এ লাভ করেছে: ${proven.map((t) => t.base).join(', ')}`;
   199	      log.info(msg);
   200	      await tg.send(msg).catch(() => {});
   201	    }
   202	  }
   203	  log.info(`watchlist: ${tokens.map((t) => `${t.base}(${t.address.slice(0, 8)}…, tvl $${Math.round(t.dexTvlUsd / 1000)}k)`).join(', ')}`);
   204	
   205	  const stream = new MexcBookStream([cfg.chain.nativeMexcSymbol, 'USDCUSDT', ...tokens.map((t) => t.symbol)]);
   206	  stream.start();
   207	  const book = async (symbol: string) => stream.get(symbol) ?? mexc.depth(symbol, 20);
   208	  const balances =
   209	    cfg.mode === 'live' ? (total?: boolean) => snapshot(chain, mexc, cfg.usdc, tokens, total, stableDecimals) : async () => paperBalances(tokens);
   210	
   211	  const freshBook = (symbol: string) => mexc.depth(symbol, 20);
   212	  const engine = new Engine({ cfg, mexc, chain, agg, db, risk, tg, book, freshBook, balances, tokens, stableDecimals });
   213	
   214	  // --- Telegram commands ---
   215	  const statusText = async () => {
   216	    const t = risk.today();
   217	    const lines = [
   218	      `MODE=${cfg.mode} | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
   219	      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
   220	      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, max gas ${cfg.maxGasGwei} gwei (now ${engine.lastGasGwei.toFixed(1)})`,
   221	      `Fail streak: ${risk.consecutiveFails}/${cfg.maxConsecutiveFails}`,
   222	      ...unresolvedLines(db, chain),
   223	    ];
   224	    if (cfg.mode === 'live') {
   225	      try {
   226	        const b = await balances();
   227	        lines.push(`Wallet: ${b.walletEth.toFixed(4)} ETH, ${usd(b.walletUsdc)} USDC | MEXC: ${usd(b.mexc.USDT ?? 0)} USDT`);
   228	        for (const tk of tokens) {
   229	          lines.push(`  ${tk.base}: wallet ${(b.walletToken[tk.base] ?? 0).toFixed(4)} | MEXC ${(b.mexc[tk.base] ?? 0).toFixed(4)}${tk.depositOk && tk.withdrawOk ? '' : ' (suspended)'}`);
   230	        }
   231	      } catch (e) {
   232	        lines.push(`Inventory error: ${errMsg(e)}`);
   233	      }
   234	    }
   235	    return lines.join('\n');
   236	  };
   237	  void tg.startPolling({
   238	    '/stop': () => {
   239	      risk.pause('Telegram /stop');
   240	      return '🛑 Trading STOPPED. Send /start to resume.';
   241	    },
   242	    '/start': startHandler(risk, statusText, makeUnresolvedCheck(db, chain)),
   243	    '/status': statusText,
   244	    '/tokens': () =>
   245	      `Tokens (${tokens.length}): ${tokens.map((t) => `${t.base} (vol $${Math.round(t.mexcVolumeUsd / 1000)}k, TVL $${Math.round(t.dexTvlUsd / 1000)}k)`).join(', ')}`,
   246	    '/cancelnonce': () => chain.cancelNonce(),
   247	    '/resolve': ([id, pnl]) => resolveTrade(db, id, pnl),
   248	  });
   249	
   250	  // --- Main loop: one scan per block ---
   251	  let busy = false;
   252	  let errors = 0;
   253	  let lastTick = Date.now();
   254	  let lastStallAlert = 0;
   255	  const runTick = async () => {
   256	    if (busy || rateLimited() || lifecycle.stopping) return;
   257	    lastTick = Date.now();
   258	    busy = lifecycle.busy = true;
   259	    try {
   260	      await engine.tick();
   261	      errors = 0;
   262	      rateLimitOk();
   263	    } catch (e) {
   264	      if (onScanError(e)) return;
   265	      errors++;
   266	      log.error(`tick: ${errMsg(e)}`);
   267	      if (errors >= 5) await engine.alertThrottled('tick-errors', `❗ Bot errors (${errors} in a row): ${errMsg(e)}`, 3600_000);
   268	    } finally {
   269	      busy = lifecycle.busy = false;
   270	    }
   271	  };
   272	  if (cfg.tickMs > 0) {
   273	    // Fast chains (Base 200 ms blocks): scan on a timer; runTick never overlaps itself (busy flag).
   274	    setInterval(() => void runTick(), cfg.tickMs);
   275	  } else {
   276	    chain.provider.on('block', runTick);
   277	  }
   278	  // Watchdog: if the RPC stops emitting blocks, still scan on a timer, and alert once per hour.
   279	  setInterval(() => {
   280	    const idle = Date.now() - lastTick;
   281	    if (idle > 30_000) void runTick();
   282	    if (idle > 3 * 60_000 && Date.now() - lastStallAlert > 3600_000) {
   283	      lastStallAlert = Date.now();
   284	      void tg.send(`⚠️ No new Ethereum block from RPC for ${Math.round(idle / 60_000)} min: scanning on a timer. Check RPC_URL.`);
   285	    }
   286	  }, 15_000);
   287	
   288	  // MEXC deposit/withdraw status every 10 minutes.
   289	  setInterval(async () => {
   290	    try {
   291	      const changed = await refreshStatus(mexc, tokens, cfg.chain);
   292	      if (changed.length) await tg.send(`ℹ️ MEXC network status changed:\n${changed.join('\n')}`);
   293	    } catch (e) {
   294	      log.warn(`status refresh: ${errMsg(e)}`);
   295	    }
   296	  }, 10 * 60_000);
   297	
   298	  // Auto token search: re-run the watchlist filters every WATCHLIST_RESCAN_MIN minutes.
   299	  // New tokens that pass are added live (no restart); dropped tokens are only reported
   300	  // (a token with open inventory keeps trading until the next restart).
   301	  log.info(`auto token search: rescan every ${cfg.watchlistRescanMin} min`);
   302	  setInterval(async () => {
   303	    if (lifecycle.stopping) return;
   304	    try {
   305	      const freshRaw = await buildWatchlist(mexc, (a) => chain.decimals(a), {
   306	        chain: cfg.chain,
   307	        only: cfg.watchlist,
   308	        max: cfg.watchlistMax,
   309	        minTvlUsd: cfg.minDexTvlUsd,
   310	        minVolumeUsd: cfg.minMexcVolumeUsd,
   311	      });
   312	      // Live mode: never hot-add a token that paper hasn't proven profitable.
   313	      const fresh = cfg.mode === 'live'
   314	        ? provenTokens(freshRaw, paperDb.paperTokenStats(), cfg.liveMinPaperTrades, cfg.liveMinPaperPnlUsd, cfg.liveWatchlistMax)
   315	        : freshRaw;
   316	      const cur = new Set(tokens.map((t) => t.base));
   317	      const added = fresh.filter((t) => !cur.has(t.base));
   318	      const removed = tokens.filter((t) => !fresh.some((f) => f.base === t.base));
   319	      if (!added.length && !removed.length) {
   320	        log.info(`rescan: no change (${tokens.length} tokens)`);
   321	        return;
   322	      }
   323	      if (lifecycle.stopping) return;
   324	      const fmt = (t: { base: string; mexcVolumeUsd: number; dexTvlUsd: number }) =>
   325	        `${t.base} (vol $${Math.round(t.mexcVolumeUsd / 1000)}k, TVL $${Math.round(t.dexTvlUsd / 1000)}k)`;
   326	      const room = cfg.watchlistMax - tokens.length;
   327	      const toAdd = added.slice(0, Math.max(0, room));
   328	      for (const t of toAdd) tokens.push(t);
   329	      const lines = ['🔍 নতুন টোকেনের খোঁজ:'];
   330	      if (toAdd.length) lines.push(`🆕 নতুন: ${toAdd.map(fmt).join(', ')} — এখন থেকেই scan করছে`);
   331	      if (added.length > toAdd.length) lines.push(`⏳ জায়গা নেই (সর্বোচ্চ ${cfg.watchlistMax}টা): ${added.slice(toAdd.length).map(fmt).join(', ')}`);
   332	      if (removed.length) lines.push(`📤 শর্ত পূরণ করছে না (পরের restart থেকে বাদ): ${removed.map((t) => t.base).join(', ')}`);
   333	      await tg.send(lines.join('\n'));
   334	      log.info(`rescan: +${toAdd.map((t) => t.base).join(',') || '-'} -${removed.map((t) => t.base).join(',') || '-'}`);
   335	    } catch (e) {
   336	      log.warn(`rescan: ${errMsg(e)}`);
   337	    }
   338	  }, cfg.watchlistRescanMin * 60_000);
   339	
   340	  // Keep the opportunities log bounded (OPP_RETENTION_DAYS).
   341	  const prune = () => {
   342	    const n = db.pruneOpportunities(Date.now() - cfg.oppRetentionDays * 86_400_000);
   343	    if (n) log.info(`pruned ${n} old opportunity rows`);
   344	  };
   345	  prune();
   346	  setInterval(prune, 6 * 3600_000);
   347	
   348	  // Daily summary at 23:00 Bangladesh time.
   349	  setInterval(async () => {
   350	    const { hour } = dhakaHourMinute();
   351	    const today = dhakaDay();
   352	    if (hour === 23 && db.getState('last_summary_day') !== today) {
   353	      db.setState('last_summary_day', today);
   354	      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
   355	    }
   356	  }, 30_000);
   357	
   358	  installProcessHandlers(tg, () => stream.stop());
   359	
   360	  await tg.send(
   361	    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} via ${agg.name}\nTokens: ${tokens.map((t) => t.base).join(', ')}\n` +
   362	      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
   363	  );
   364	}
   365	
   366	/** TRANSFER strategy: scan MEXC ERC20 tokens, buy on MEXC, withdraw, sell on DEX. CEX->DEX only. */
   367	async function runTransfer(db: Db, risk: Risk, tg: Telegram, mexc: MexcRest, chain: Chain, agg: Aggregator, paperDb: Db) {
   368	  const engine = new TransferEngine({ cfg, mexc, chain, agg, db, risk, tg,
   369	    // Live mode trades only tokens proven profitable in paper (same rule as the
   370	    // inventory live watchlist). Paper mode is the scout: it scans everything.
   371	    provenFilter: cfg.mode === 'live'
   372	      ? (tokens) => provenTokens(tokens, paperDb.paperTokenStats(), cfg.liveMinPaperTrades, cfg.liveMinPaperPnlUsd, cfg.liveWatchlistMax)
   373	      : undefined,
   374	  });
   375	  await engine.refreshUniverse(true);
   376	  if (engine.universe.length === 0) {
   377	    if (engine.provenFilteredEmpty) {
   378	      const msg = '⚠️ Live transfer: কোনো টোকেন এখনো paper-এ প্রমাণিত হয়নি — live trade হবে না। Paper-এ লাভ করা টোকেন আসলেই scan শুরু হবে।';
   379	      log.warn(msg);
   380	      await tg.send(msg).catch(() => {});
   381	    } else {
   382	      throw new Error('No MEXC ERC20 token passed the filters');
   383	    }
   384	  }
   385	
   386	  void tg.startPolling({
   387	    '/stop': () => {
   388	      risk.pause('Telegram /stop');
   389	      return '🛑 New trades STOPPED. An open transfer still finishes (selling the tokens already bought is the safe exit). /start to resume.';
   390	    },
   391	    '/start': async (args: string[]) => startHandler(risk, transferStatus, makeUnresolvedCheck(db, chain))(args),
   392	    '/status': async () => transferStatus(),
   393	    '/cancelnonce': () => chain.cancelNonce(),
   394	    '/resolve': ([id, pnl]: string[]) => resolveTrade(db, id, pnl),
   395	    '/sell': ([id]: string[]) => (id ? engine.forceSell(Number(id)) : 'Usage: /sell <transfer id>'),
   396	    '/clear': ([id]: string[]) => (id ? engine.clear(Number(id)) : 'Usage: /clear <transfer id>'),
   397	  });
   398	
   399	  async function transferStatus() {
   400	    const t = risk.today();
   401	    const open = db.openTransfers();
   402	    const lines = [
   403	      `MODE=${cfg.mode} STRATEGY=transfer | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
   404	      `Scanning ${engine.universe.length} MEXC ERC20 tokens every ${cfg.scanIntervalSec}s`,
   405	      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
   406	      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, gas ${engine.lastGasGwei.toFixed(1)}/${cfg.maxGasGwei} gwei`,
   407	      `Top gaps: ${engine.lastTopGaps.map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ') || 'none'}`,
   408	      open.length ? `Open: ${open.map((o) => `#${o.id} ${o.base} ${o.status}`).join(', ')}` : 'Open transfers: none',
   409	      ...unresolvedLines(db, chain),
   410	    ];
   411	    const stuck = db.stuckTransfers();
   412	    if (stuck.length) lines.push(`🚨 Needs you: ${stuck.map((o) => `#${o.id} ${o.base} (${o.note ?? 'stuck'})`).join('; ')} -> /sell <id> or /clear <id>`);
   413	    if (cfg.mode === 'live') {
   414	      try {
   415	        const b = await mexc.balances();
   416	        const eth = await chain.ethBalance();
   417	        const usdc = await chain.tokenBalance(cfg.usdc);
   418	        lines.push(`MEXC ${usd(b.USDT ?? 0)} USDT | wallet ${(Number(eth) / 1e18).toFixed(4)} ETH, ${usd(Number(usdc) / 1e6)} USDC`);
   419	      } catch (e) {
   420	        lines.push(`Balance error: ${errMsg(e)}`);
   421	      }
   422	    }
   423	    return lines.join('\n');
   424	  }
   425	
   426	  let busy = false;
   427	  let errors = 0;
   428	  let lastLow = 0;
   429	  const loop = async () => {
   430	    if (busy || rateLimited() || lifecycle.stopping) return;
   431	    busy = lifecycle.busy = true;
   432	    try {
   433	      await engine.tick();
   434	      errors = 0;
   435	      rateLimitOk();
   436	      // MEXC USDT is spent by buys and comes back only when you move USDC from the wallet to MEXC.
   437	      if (cfg.mode === 'live' && Date.now() - lastLow > 6 * 3600_000) {
   438	        const usdt = (await mexc.balances()).USDT ?? 0;
   439	        const eth = Number(await chain.ethBalance()) / 1e18;
   440	        if (usdt < cfg.minTradeUsd || eth < cfg.minEthForGas) {
   441	          lastLow = Date.now();
   442	          await tg.send(`📦 Rebalance needed: MEXC USDT ${usd(usdt)}, wallet ETH ${eth.toFixed(4)}. Move USDC profits from the wallet back to MEXC.`);
   443	        }
   444	      }
   445	    } catch (e) {
   446	      if (onScanError(e)) return;
   447	      errors++;
   448	      log.error(`scan: ${errMsg(e)}`);
   449	      if (errors === 5) await tg.send(`❗ Bot errors (5 in a row): ${errMsg(e)}`);
   450	    } finally {
   451	      busy = lifecycle.busy = false;
   452	    }
   453	  };
   454	  setInterval(loop, cfg.scanIntervalSec * 1000);
   455	  void loop();
   456	
   457	  setInterval(async () => {
   458	    const today = dhakaDay();
   459	    if (dhakaHourMinute().hour === 23 && db.getState('last_summary_day') !== today) {
   460	      db.setState('last_summary_day', today);
   461	      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
   462	    }
   463	  }, 30_000);
   464	
   465	  installProcessHandlers(tg, () => {});
   466	
   467	  const open = db.openTransfers();
   468	  await tg.send(
   469	    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} STRATEGY=transfer via ${agg.name}\n` +
   470	      `Scanning ${engine.universe.length} MEXC ERC20 tokens${engine.universe.length ? ` (${engine.universe.map((t) => t.base).join(', ')})` : ''} (buy MEXC -> withdraw -> sell DEX)\n` +
   471	      (open.length ? `Resuming ${open.length} open transfer(s)\n` : '') +
   472	      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
   473	  );
   474	}
   475	
   476	main().catch(async (e) => {
   477	  log.error(`startup failed: ${errMsg(e)}`);
   478	  const modeTag = cfg.mode === 'live' ? '🔴 LIVE — আসল টাকা' : '📝 PAPER';
   479	  await new Telegram(cfg.telegramToken, cfg.telegramChatId, fetch, cfg.telegramAdminId, undefined, modeTag).send(`❗ Bot failed to start: ${errMsg(e)}`);
   480	  process.exit(1);
   481	});
```

## `src/pricing.ts`

```
     1	// Pure profit math. No I/O, so it is fully unit tested.
     2	//
     3	// net = sell value - buy value - MEXC taker fee - gas - slippage (both sides) - safety margin
     4	// DEX fees are already inside the aggregator's buyAmount.
     5	//
     6	// All money is measured in USDT (MEXC's quote asset). The DEX side trades a stable (USDC on most
     7	// chains): its amounts are converted with `stableInUsdt` (USDT per 1 DEX stable, e.g. 1.0021 for USDC).
     8	// Treating USDC as exactly 1 USDT made every DEX_BUY look ~20 bps better than it really was.
     9	import type { Level } from './mexc/rest.js';
    10	import { floorToStep } from './util.js';
    11	
    12	export type Direction = 'DEX_BUY' | 'CEX_BUY';
    13	// DEX_BUY: buy token on DEX with USDC, sell token on MEXC for USDT.
    14	// CEX_BUY: buy token on MEXC with USDT, sell token on DEX for USDC.
    15	
    16	export interface CostParams {
    17	  takerFee: number; // per-symbol MEXC taker fee, 0.0008 = 0.08%
    18	  cexSlippageBps: number;
    19	  /** Floor of the safety margin in USD. */
    20	  safetyMarginUsd: number;
    21	  /** Safety margin as a share of the trade size (bps). The larger of the two is used. */
    22	  safetyMarginBps?: number;
    23	  /** USDT per 1 unit of the DEX stable (USDC ~1.002). 1 on chains whose DEX stable is USDT. */
    24	  stableInUsdt?: number;
    25	}
    26	
    27	/** Safety margin for a trade of `sizeUsd`: max(floor in USD, bps of size). */
    28	export function safetyUsd(c: CostParams, sizeUsd: number): number {
    29	  return Math.max(c.safetyMarginUsd, (sizeUsd * (c.safetyMarginBps ?? 0)) / 10_000);
    30	}
    31	const rate = (c: CostParams) => c.stableInUsdt ?? 1;
    32	
    33	export interface Opportunity {
    34	  direction: Direction;
    35	  sizeUsd: number; // amount put into the buy leg (DEX stable units for DEX_BUY, USDT for CEX_BUY)
    36	  cexQty: number; // token quantity for the MEXC order
    37	  cexLimitPrice: number; // worst acceptable MEXC price (book walk + slippage)
    38	  dexTokens: number; // tokens bought (DEX_BUY) or sold (CEX_BUY) on the DEX
    39	  buyPrice: number; // effective USD per token paid
    40	  sellPrice: number; // effective USD per token received
    41	  cexFeeUsd: number;
    42	  gasUsd: number;
    43	  slippageUsd: number;
    44	  /** Value out minus value in, before MEXC fee, gas, slippage reserve and safety margin (USDT). */
    45	  grossUsd: number;
    46	  net: number;
    47	}
    48	
    49	/** Sell `qty` base into bids. */
    50	export function fillBase(levels: Level[], qty: number): { quote: number; worst: number } | null {
    51	  let left = qty;
    52	  let quote = 0;
    53	  let worst = 0;
    54	  for (const [price, size] of levels) {
    55	    if (left <= 1e-12) break;
    56	    const take = Math.min(left, size);
    57	    quote += take * price;
    58	    worst = price;
    59	    left -= take;
    60	  }
    61	  return left <= 1e-9 * Math.max(1, qty) ? { quote, worst } : null;
    62	}
    63	
    64	/** Spend `quoteAmount` on asks; returns base quantity bought. */
    65	export function fillQuote(levels: Level[], quoteAmount: number): { qty: number; worst: number } | null {
    66	  let left = quoteAmount;
    67	  let qty = 0;
    68	  let worst = 0;
    69	  for (const [price, size] of levels) {
    70	    if (left <= 1e-9) break;
    71	    const cost = Math.min(left, size * price);
    72	    qty += cost / price;
    73	    worst = price;
    74	    left -= cost;
    75	  }
    76	  return left <= 1e-6 ? { qty, worst } : null;
    77	}
    78	
    79	/** Required net profit: max(small USD floor, MIN_PROFIT_BPS of the size). */
    80	export function threshold(sizeUsd: number, minProfitUsd: number, minProfitBps: number): number {
    81	  return Math.max(minProfitUsd, (sizeUsd * minProfitBps) / 10_000);
    82	}
    83	
    84	/**
    85	 * DEX_BUY: we spent `sizeUsd` USDC on the DEX for `tokensOut` (floor `tokensMin`) and sell them on MEXC bids.
    86	 */
    87	export function evaluateDexBuy(p: {
    88	  sizeUsd: number;
    89	  tokensOut: number;
    90	  tokensMin: number;
    91	  bids: Level[];
    92	  qtyStep: number;
    93	  gasUsd: number;
    94	  costs: CostParams;
    95	}): Opportunity | null {
    96	  // Sell on MEXC only what the DEX GUARANTEES (minBuyAmount), so we never sell tokens we may not get.
    97	  const qty = floorToStep(p.tokensMin, p.qtyStep);
    98	  if (qty <= 0) return null;
    99	  const fill = fillBase(p.bids, qty);
   100	  if (!fill) return null;
   101	  const sellPrice = fill.quote / qty;
   102	  const cexFeeUsd = fill.quote * p.costs.takerFee;
   103	  const cexSlip = (fill.quote * p.costs.cexSlippageBps) / 10_000;
   104	  // DEX slippage is covered by sizing from tokensMin; reported for information only.
   105	  const slippageUsd = cexSlip + Math.max(0, p.tokensOut - p.tokensMin) * sellPrice;
   106	  // Worst case we receive exactly tokensMin; the part below the MEXC step stays as inventory.
   107	  const dustUsd = (p.tokensMin - qty) * sellPrice;
   108	  const costUsdt = p.sizeUsd * rate(p.costs); // the DEX stable we spend, in USDT
   109	  const net = fill.quote - cexFeeUsd - (costUsdt - dustUsd) - p.gasUsd - cexSlip - safetyUsd(p.costs, costUsdt);
   110	  return {
   111	    direction: 'DEX_BUY',
   112	    sizeUsd: p.sizeUsd,
   113	    cexQty: qty,
   114	    cexLimitPrice: fill.worst * (1 - p.costs.cexSlippageBps / 10_000),
   115	    dexTokens: p.tokensOut,
   116	    buyPrice: costUsdt / p.tokensOut,
   117	    sellPrice,
   118	    cexFeeUsd,
   119	    gasUsd: p.gasUsd,
   120	    slippageUsd,
   121	    grossUsd: fill.quote - (costUsdt - dustUsd),
   122	    net,
   123	  };
   124	}
   125	
   126	/**
   127	 * CEX_BUY step 1: how many tokens `sizeUsd` USDT buys on MEXC asks.
   128	 * MEXC charges the buy fee in the token, so we only sell qty * (1 - fee) on the DEX.
   129	 */
   130	export function planCexBuy(p: { sizeUsd: number; asks: Level[]; qtyStep: number; takerFee: number }) {
   131	  const f = fillQuote(p.asks, p.sizeUsd);
   132	  if (!f) return null;
   133	  const qty = floorToStep(f.qty, p.qtyStep);
   134	  if (qty <= 0) return null;
   135	  const fill = fillBase(p.asks, qty);
   136	  if (!fill) return null;
   137	  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - p.takerFee) };
   138	}
   139	
   140	/** CEX_BUY plan for an exact quantity (used when re-checking a trade with a fresh book). */
   141	export function planCexBuyQty(asks: Level[], qty: number, takerFee: number) {
   142	  const fill = fillBase(asks, qty);
   143	  if (!fill) return null;
   144	  return { qty, costUsd: fill.quote, worst: fill.worst, tokensToSell: qty * (1 - takerFee) };
   145	}
   146	
   147	/** CEX_BUY step 2: given the DEX quote for selling those tokens, compute net. */
   148	export function evaluateCexBuy(p: {
   149	  plan: NonNullable<ReturnType<typeof planCexBuy>>;
   150	  usdcOut: number;
   151	  usdcMin: number;
   152	  gasUsd: number;
   153	  costs: CostParams;
   154	}): Opportunity {
   155	  const { plan } = p;
   156	  const buyPrice = plan.costUsd / plan.qty;
   157	  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
   158	  const cexSlip = (plan.costUsd * p.costs.cexSlippageBps) / 10_000;
   159	  const outUsdt = p.usdcOut * rate(p.costs);
   160	  const dexSlip = Math.max(0, p.usdcOut - p.usdcMin) * rate(p.costs);
   161	  const slippageUsd = cexSlip + dexSlip;
   162	  // cost already includes the token fee implicitly: we paid for qty but only sell qty*(1-fee).
   163	  const net = outUsdt - plan.costUsd - p.gasUsd - slippageUsd - safetyUsd(p.costs, plan.costUsd);
   164	  return {
   165	    direction: 'CEX_BUY',
   166	    sizeUsd: plan.costUsd,
   167	    cexQty: plan.qty,
   168	    cexLimitPrice: plan.worst * (1 + p.costs.cexSlippageBps / 10_000),
   169	    dexTokens: plan.tokensToSell,
   170	    buyPrice,
   171	    sellPrice: outUsdt / plan.tokensToSell,
   172	    cexFeeUsd,
   173	    gasUsd: p.gasUsd,
   174	    slippageUsd,
   175	    grossUsd: outUsdt + cexFeeUsd - plan.costUsd, // the token fee is added back: gross is before fees
   176	    net,
   177	  };
   178	}
   179	
   180	/** Gas cost in USD for `gasUnits` at `weiPerGas`. */
   181	export function gasUsd(gasUnits: bigint, weiPerGas: bigint, ethUsd: number): number {
   182	  return (Number(gasUnits * weiPerGas) / 1e18) * ethUsd;
   183	}
   184	
   185	/**
   186	 * What to do after both legs ran. Returns the MEXC market order needed to get flat again (or null).
   187	 * cexFilled is the MEXC executed quantity.
   188	 */
   189	export function unwindPlan(
   190	  direction: Direction,
   191	  dexOk: boolean,
   192	  cexQty: number,
   193	  cexFilled: number,
   194	  takerFee: number,
   195	  qtyStep: number,
   196	): { side: 'BUY' | 'SELL'; qty: number; reason: string } | null {
   197	  const mk = (side: 'BUY' | 'SELL', q: number, reason: string) => {
   198	    const qty = floorToStep(q, qtyStep);
   199	    return qty > 0 ? { side, qty, reason } : null;
   200	  };
   201	  if (direction === 'DEX_BUY') {
   202	    // Wanted: +tokens in wallet (DEX), -tokens on MEXC (sell).
   203	    if (!dexOk) return mk('BUY', cexFilled, 'DEX leg failed: buy back what was sold on MEXC');
   204	    return mk('SELL', cexQty - cexFilled, 'MEXC sell only partly filled: sell the rest at market');
   205	  }
   206	  // CEX_BUY wanted: +tokens on MEXC (buy), -tokens in wallet (DEX sell).
   207	  if (!dexOk) return mk('SELL', cexFilled * (1 - takerFee), 'DEX leg failed: sell what was bought on MEXC');
   208	  return mk('BUY', cexQty - cexFilled, 'MEXC buy only partly filled: buy the rest at market');
   209	}
   210	
   211	/**
   212	 * TRANSFER: buy on MEXC -> withdraw to wallet -> sell on DEX. Not atomic: the price can move
   213	 * while the withdrawal is on its way, so `driftBps` of the sale value is reserved as extra risk cost.
   214	 */
   215	export function evaluateTransfer(p: {
   216	  plan: NonNullable<ReturnType<typeof planCexBuy>>;
   217	  withdrawFeeTokens: number; // MEXC withdraw fee, paid in the token
   218	  usdcOut: number; // DEX quote for selling the tokens that arrive
   219	  usdcMin: number;
   220	  gasUsd: number; // approval + swap
   221	  driftBps: number;
   222	  costs: CostParams;
   223	}) {
   224	  const { plan } = p;
   225	  const arriving = plan.tokensToSell - p.withdrawFeeTokens;
   226	  const buyPrice = plan.costUsd / plan.qty;
   227	  const cexFeeUsd = plan.qty * p.costs.takerFee * buyPrice;
   228	  const withdrawFeeUsd = p.withdrawFeeTokens * buyPrice;
   229	  const outUsdt = p.usdcOut * rate(p.costs);
   230	  const slippageUsd = (plan.costUsd * p.costs.cexSlippageBps) / 10_000 + Math.max(0, p.usdcOut - p.usdcMin) * rate(p.costs);
   231	  const driftUsd = (outUsdt * p.driftBps) / 10_000;
   232	  const net = outUsdt - plan.costUsd - p.gasUsd - slippageUsd - driftUsd - safetyUsd(p.costs, plan.costUsd);
   233	  return {
   234	    arriving,
   235	    buyPrice,
   236	    sellPrice: arriving > 0 ? outUsdt / arriving : 0,
   237	    cexFeeUsd,
   238	    withdrawFeeUsd,
   239	    slippageUsd,
   240	    driftUsd,
   241	    gasUsd: p.gasUsd,
   242	    costUsd: plan.costUsd,
   243	    net,
   244	  };
   245	}
```

## `src/recovery.ts`

```
     1	// Startup recovery after a crash/restart in the middle of a trade.
     2	import type { Db } from './db.js';
     3	import type { Risk } from './risk.js';
     4	import type { Order } from './mexc/rest.js';
     5	import type { Notifier } from './engine.js';
     6	import { cancelAndConfirm } from './engine.js';
     7	import { errMsg } from './log.js';
     8	
     9	const OPEN = new Set(['NEW', 'PARTIALLY_FILLED']);
    10	const BOT_PREFIX = 'arb';
    11	
    12	export interface RecoveryMexc {
    13	  getOrderByClientId(symbol: string, cid: string): Promise<Order | null>;
    14	  getOrder?(symbol: string, orderId: string): Promise<Order>;
    15	  cancelOrder?(symbol: string, orderId: string): Promise<Order>;
    16	  openOrders?(symbol: string): Promise<(Order & { clientOrderId?: string })[]>;
    17	}
    18	
    19	/**
    20	 * Startup recovery (live mode, before anything trades):
    21	 *  - every trade row still 'executing' (the bot died mid-trade): look up EVERY MEXC client id recorded on it
    22	 *    (entry + closes). Orders still open are cancelled and settled. Both legs complete -> 'ok'
    23	 *    (PnL not measured); anything else -> 'one_sided' with "pnl unknown" (book it later with /resolve).
    24	 *  - open orders with the bot's client-id prefix on the watched symbols are cancelled and reported.
    25	 *  - an unresolved DEX tx from before the restart (persisted) keeps the bot paused.
    26	 * Anything not cleanly complete -> CRITICAL pause until a human sends /start confirm.
    27	 */
    28	export async function recoverExecuting(
    29	  db: Db,
    30	  risk: Risk,
    31	  tg: Notifier,
    32	  mexc: RecoveryMexc,
    33	  receipt: (hash: string) => Promise<{ status: number | null } | null>,
    34	  checkUnresolved?: () => Promise<{ state: 'clear' | 'pending' }>,
    35	  opts: { symbols?: string[]; sleep?: (ms: number) => Promise<void> } = {},
    36	) {
    37	  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    38	  const lines: string[] = [];
    39	  let incomplete = 0;
    40	
    41	  const settle = async (symbol: string, o: Order): Promise<string> => {
    42	    if (!OPEN.has(o.status) || !mexc.getOrder || !mexc.cancelOrder) return `${o.status}, filled ${o.executedQty}`;
    43	    try {
    44	      const f = await cancelAndConfirm({ getOrder: mexc.getOrder, cancelOrder: mexc.cancelOrder }, symbol, o.orderId, sleep);
    45	      return `was open -> cancelled: ${f.status}, filled ${f.executedQty}`;
    46	    } catch (e) {
    47	      incomplete++;
    48	      return `STILL OPEN (${errMsg(e)}): cancel it on MEXC by hand`;
    49	    }
    50	  };
    51	
    52	  for (const r of db.executingTrades()) {
    53	    const symbol = `${r.symbol}USDT`;
    54	    const noteCid = /client order id (\S+?)(;|$)/.exec(r.note ?? '')?.[1];
    55	    const cids = [...new Set([...(noteCid ? [noteCid] : []), ...db.cidsOf(r.id)])];
    56	    const cexLines: string[] = [];
    57	    let entryDone = false;
    58	    for (const [i, cid] of cids.entries()) {
    59	      try {
    60	        const o = await mexc.getOrderByClientId(symbol, cid);
    61	        if (!o) {
    62	          cexLines.push(`MEXC ${cid}: never placed`);
    63	          continue;
    64	        }
    65	        const state = await settle(symbol, o);
    66	        cexLines.push(`MEXC ${cid} (order ${o.orderId}): ${state}`);
    67	        if (i === 0) entryDone = o.status === 'FILLED' && Number(o.executedQty) >= r.qty * 0.999;
    68	      } catch (e) {
    69	        cexLines.push(`MEXC ${cid}: lookup failed (${errMsg(e)})`);
    70	      }
    71	    }
    72	    let dex = 'DEX tx: none signed';
    73	    let dexDone = false;
    74	    if (r.dex_tx) {
    75	      const rc = await receipt(r.dex_tx).catch(() => null);
    76	      dex = rc ? `DEX tx ${r.dex_tx}: ${rc.status === 1 ? 'SUCCESS' : 'REVERTED'}` : `DEX tx ${r.dex_tx}: NOT MINED (may still be pending)`;
    77	      dexDone = rc?.status === 1;
    78	    }
    79	    // Clean only if the entry filled, the swap succeeded and NO close/unwind order was involved.
    80	    const complete = entryDone && dexDone && cids.length === 1;
    81	    if (!complete) incomplete++;
    82	    db.updateTrade(r.id, {
    83	      status: complete ? 'ok' : 'one_sided',
    84	      note: `${r.note ?? ''}; recovered at startup: ${cexLines.join(' | ')}; ${dex}; ${complete ? 'both legs done, PnL not measured' : 'pnl unknown'}`,
    85	    });
    86	    lines.push(`${complete ? '✅' : '⚠️'} #${r.id} ${r.symbol} ${r.direction} qty ${r.qty}\n  ${cexLines.join('\n  ') || 'MEXC: no client id recorded'}\n  ${dex}`);
    87	  }
    88	
    89	  // Orders the bot placed that are still resting on MEXC (e.g. a close placed right before a crash).
    90	  if (mexc.openOrders && opts.symbols?.length) {
    91	    for (const symbol of opts.symbols) {
    92	      try {
    93	        for (const o of await mexc.openOrders(symbol)) {
    94	          if (!o.clientOrderId?.startsWith(BOT_PREFIX)) continue;
    95	          lines.push(`⚠️ open bot order ${symbol} ${o.side} ${o.origQty} (cid ${o.clientOrderId}): ${await settle(symbol, o)}`);
    96	          incomplete++;
    97	        }
    98	      } catch (e) {
    99	        lines.push(`⚠️ could not list open orders for ${symbol}: ${errMsg(e)}`);
   100	        incomplete++;
   101	      }
   102	    }
   103	  }
   104	
   105	  const pendingTx = checkUnresolved ? (await checkUnresolved().catch(() => ({ state: 'pending' as const }))).state === 'pending' : false;
   106	  if (pendingTx) {
   107	    incomplete++;
   108	    lines.push('⚠️ A DEX tx sent before the restart is still unresolved (pending, not mined). Do NOT hedge by hand until it resolves.');
   109	  }
   110	  if (!lines.length) return;
   111	
   112	  if (incomplete) risk.pause('bot restarted during a trade', true);
   113	  await tg.send(
   114	    `${incomplete ? '🚨' : 'ℹ️'} Bot restarted while trade(s) were running:\n${lines.join('\n')}\n` +
   115	      (incomplete
   116	        ? `Trading PAUSED. Check balances (/status), fix any open position by hand, book its PnL with /resolve <id> <pnl>, then /start confirm.`
   117	        : `All legs completed; no action needed (PnL of these trades was not measured).`),
   118	  );
   119	}
```

## `src/report.ts`

```
     1	// npm run report -- [hours] [mode] [--csv]   e.g. `npm run report -- 168 paper`
     2	// With --csv: opportunities per token and Dhaka hour, as CSV (for a spreadsheet).
     3	import 'dotenv/config';
     4	import { Db } from './db.js';
     5	import { formatReport } from './summary.js';
     6	import { opportunitiesCsv } from './kpi.js';
     7	
     8	const args = process.argv.slice(2).filter((a) => a !== '--csv');
     9	const csv = process.argv.includes('--csv');
    10	const hours = Number(args[0] ?? 24);
    11	const mode = args[1] ?? process.env.MODE ?? 'paper';
    12	const db = new Db(process.env.DB_PATH || `data/${process.env.CHAIN || 'ethereum'}.sqlite`);
    13	console.log(csv ? opportunitiesCsv(db, Date.now() - hours * 3600_000) : formatReport(db, mode, hours, 'Report'));
    14	db.close();
```

## `src/risk.ts`

```
     1	// Risk limits: daily trade count, daily loss limit, failure streak, manual kill switch.
     2	// All state lives in SQLite, so a restart (pm2) never resets the limits.
     3	import type { Db, TradeStatus } from './db.js';
     4	import { dhakaDay } from './util.js';
     5	
     6	export interface RiskLimits {
     7	  maxTradesPerDay: number;
     8	  dailyLossLimitUsd: number;
     9	  maxConsecutiveFails: number;
    10	}
    11	
    12	export type RiskEvent =
    13	  | { kind: 'loss_limit'; pnl: number }
    14	  | { kind: 'fail_streak'; count: number }
    15	  | { kind: 'trade_limit'; trades: number };
    16	
    17	export class Risk {
    18	  constructor(private db: Db, private mode: string, private limits: RiskLimits, private now = () => Date.now()) {}
    19	
    20	  get paused(): boolean {
    21	    return this.db.getState('paused') === '1';
    22	  }
    23	  get pauseReason(): string {
    24	    return this.db.getState('pause_reason') ?? '';
    25	  }
    26	  get consecutiveFails(): number {
    27	    return Number(this.db.getState('consecutive_fails') ?? '0');
    28	  }
    29	
    30	  /** Critical pauses mean money may be in an unknown state; only `/start confirm` clears them. */
    31	  get critical(): boolean {
    32	    return this.db.getState('pause_critical') === '1';
    33	  }
    34	
    35	  pause(reason: string, critical = false): void {
    36	    // Never downgrade: a soft pause on top of a critical one keeps it critical.
    37	    const keepCritical = this.paused && this.critical && !critical;
    38	    this.db.setState('paused', '1');
    39	    if (!keepCritical) this.db.setState('pause_reason', reason);
    40	    this.db.setState('pause_critical', critical || keepCritical ? '1' : '0');
    41	  }
    42	
    43	  /** Returns false (and stays paused) if a critical pause is not confirmed. */
    44	  resume(confirm = false): boolean {
    45	    if (this.paused && this.critical && !confirm) return false;
    46	    // After a critical incident the failure streak is NOT forgiven: the bot does not get a fresh budget.
    47	    if (!this.critical) this.db.setState('consecutive_fails', '0');
    48	    this.db.setState('paused', '0');
    49	    this.db.setState('pause_reason', '');
    50	    this.db.setState('pause_critical', '0');
    51	    return true;
    52	  }
    53	
    54	  /** Remaining daily loss budget (USD) before the limit is hit. */
    55	  remainingLossBudget(): number {
    56	    return this.limits.dailyLossLimitUsd + this.today().pnl;
    57	  }
    58	
    59	  today() {
    60	    return this.db.dayStats(dhakaDay(this.now()), this.mode);
    61	  }
    62	
    63	  /** null = allowed, otherwise the reason trading is blocked right now. */
    64	  blockReason(): string | null {
    65	    if (this.paused) return `paused: ${this.pauseReason}`;
    66	    const t = this.today();
    67	    if (t.trades >= this.limits.maxTradesPerDay) return `daily trade limit reached (${t.trades})`;
    68	    if (t.pnl <= -this.limits.dailyLossLimitUsd) return `daily loss limit reached (${t.pnl.toFixed(2)})`;
    69	    return null;
    70	  }
    71	
    72	  /** Update streaks after a trade; returns events that need an alert. */
    73	  afterTrade(status: TradeStatus): RiskEvent[] {
    74	    const events: RiskEvent[] = [];
    75	    if (status === 'ok' || status === 'paper') {
    76	      this.db.setState('consecutive_fails', '0');
    77	    } else {
    78	      const n = this.consecutiveFails + 1;
    79	      this.db.setState('consecutive_fails', String(n));
    80	      if (n >= this.limits.maxConsecutiveFails) {
    81	        this.pause(`${n} failed trades in a row`);
    82	        events.push({ kind: 'fail_streak', count: n });
    83	      }
    84	    }
    85	    const t = this.today();
    86	    if (t.pnl <= -this.limits.dailyLossLimitUsd) {
    87	      this.pause(`daily loss limit hit (${t.pnl.toFixed(2)} USD)`);
    88	      events.push({ kind: 'loss_limit', pnl: t.pnl });
    89	    }
    90	    if (t.trades >= this.limits.maxTradesPerDay) events.push({ kind: 'trade_limit', trades: t.trades });
    91	    return events;
    92	  }
    93	}
```

## `src/scanner.ts`

```
     1	// Continuously scans EVERY MEXC USDT pair whose coin is an Ethereum (ERC20) token,
     2	// and finds tokens that are cheaper on MEXC than on Ethereum DEXs.
     3	//
     4	// Cheap first pass (2 + N/30 HTTP calls per scan):
     5	//   MEXC bookTicker (all symbols, one call)  vs  DexScreener price (30 tokens per call)
     6	// Only the biggest gaps then get an exact, size-specific aggregator quote (see transfer.ts).
     7	import type { MexcRest } from './mexc/rest.js';
     8	import { ethNetwork, isOnline } from './watchlist.js';
     9	import { type SymbolRules, rulesFrom } from './mexc/rules.js';
    10	
    11	export interface ScanToken {
    12	  base: string;
    13	  symbol: string;
    14	  address: string; // lowercase, from MEXC's own deposit info -> same token as on-chain
    15	  netWork: string; // MEXC network id for withdrawals
    16	  withdrawFee: number; // tokens
    17	  withdrawMin: number;
    18	  qtyStep: number;
    19	  priceDecimals: number;
    20	  rules: SymbolRules;
    21	  volumeUsd: number;
    22	}
    23	
    24	export interface Gap {
    25	  token: ScanToken;
    26	  ask: number; // MEXC best ask
    27	  dexPrice: number; // DexScreener price of the deepest Ethereum pool
    28	  tvlUsd: number;
    29	  gapPct: number; // (dexPrice / ask - 1) * 100, positive = MEXC cheaper
    30	}
    31	
    32	const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH']);
    33	
    34	/** All tradable MEXC/USDT ERC20 tokens with deposits AND withdrawals open and enough volume. */
    35	export async function loadUniverse(
    36	  mexc: Pick<MexcRest, 'exchangeInfo' | 'tickers24h' | 'coinConfigs'>,
    37	  opts: { minVolumeUsd: number; only: string[] },
    38	): Promise<ScanToken[]> {
    39	  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
    40	  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
    41	  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));
    42	  const out: ScanToken[] = [];
    43	  for (const s of symbols) {
    44	    const base = s.baseAsset.toUpperCase();
    45	    if (s.quoteAsset !== 'USDT' || !s.isSpotTradingAllowed || !isOnline(s.status) || SKIP.has(base)) continue;
    46	    if ((s.tradeSideType ?? 1) !== 1) continue; // transfer needs to buy and (for exits) sell
    47	    if (opts.only.length && !opts.only.includes(base)) continue;
    48	    const vol = volume.get(s.symbol) ?? 0;
    49	    if (vol < opts.minVolumeUsd) continue;
    50	    const coin = coinBy.get(base);
    51	    const net = coin && ethNetwork(coin);
    52	    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) continue;
    53	    if (!net.depositEnable || !net.withdrawEnable) continue; // suspended -> skip
    54	    out.push({
    55	      base,
    56	      symbol: s.symbol,
    57	      address: net.contract.toLowerCase(),
    58	      netWork: net.netWork ?? net.network,
    59	      withdrawFee: Number(net.withdrawFee ?? 0),
    60	      withdrawMin: Number(net.withdrawMin ?? 0),
    61	      qtyStep: rulesFrom(s).qtyStep,
    62	      priceDecimals: s.quotePrecision,
    63	      rules: rulesFrom(s),
    64	      volumeUsd: vol,
    65	    });
    66	  }
    67	  return out;
    68	}
    69	
    70	type FetchFn = typeof fetch;
    71	
    72	/** DexScreener prices for many tokens (30 per request). Uses each token's deepest Ethereum pool. */
    73	export async function dexPrices(addresses: string[], fetchFn: FetchFn = fetch): Promise<Map<string, { price: number; tvl: number }>> {
    74	  const out = new Map<string, { price: number; tvl: number }>();
    75	  for (let i = 0; i < addresses.length; i += 30) {
    76	    const chunk = addresses.slice(i, i + 30);
    77	    const res = await fetchFn(`https://api.dexscreener.com/tokens/v1/ethereum/${chunk.join(',')}`, { signal: AbortSignal.timeout(10_000) });
    78	    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    79	    const pairs = (await res.json()) as { chainId: string; priceUsd?: string; liquidity?: { usd?: number }; baseToken: { address: string } }[];
    80	    for (const p of pairs) {
    81	      if (p.chainId !== 'ethereum' || !p.priceUsd) continue;
    82	      const addr = p.baseToken.address.toLowerCase(); // priceUsd is the price of baseToken
    83	      const tvl = p.liquidity?.usd ?? 0;
    84	      if (!out.has(addr) || tvl > out.get(addr)!.tvl) out.set(addr, { price: Number(p.priceUsd), tvl });
    85	    }
    86	  }
    87	  return out;
    88	}
    89	
    90	/** Tokens cheaper on MEXC than on DEX by at least minGapPct, biggest gap first. */
    91	export function findGaps(
    92	  tokens: ScanToken[],
    93	  tickers: Map<string, { bid: number; ask: number }>,
    94	  dex: Map<string, { price: number; tvl: number }>,
    95	  opts: { minTvlUsd: number; minGapPct: number; maxGapPct?: number },
    96	): Gap[] {
    97	  const gaps: Gap[] = [];
    98	  for (const token of tokens) {
    99	    const t = tickers.get(token.symbol);
   100	    const d = dex.get(token.address);
   101	    if (!t || !d || t.ask <= 0 || d.price <= 0 || d.tvl < opts.minTvlUsd) continue;
   102	    const gapPct = (d.price / t.ask - 1) * 100;
   103	    // Huge gaps usually mean a different/broken token or a dead pool, not an opportunity.
   104	    if (gapPct >= opts.minGapPct && gapPct < (opts.maxGapPct ?? 30)) gaps.push({ token, ask: t.ask, dexPrice: d.price, tvlUsd: d.tvl, gapPct });
   105	  }
   106	  return gaps.sort((a, b) => b.gapPct - a.gapPct);
   107	}
```

## `src/summary.ts`

```
     1	import type { Db } from './db.js';
     2	import { usd } from './util.js';
     3	import { computeKpis, formatKpis } from './kpi.js';
     4	
     5	/** Text report for the last `hours` (used by the 23:00 summary and `npm run report`). */
     6	export function formatReport(db: Db, mode: string, hours: number, title: string): string {
     7	  const { total, bySymbol } = db.statsSince(Date.now() - hours * 3600_000, mode);
     8	  const lines = [
     9	    `${title} (${mode}, last ${hours}h)`,
    10	    `Trades: ${total.trades} | Failed/one-sided: ${total.failed}`,
    11	    `Net PnL: ${usd(total.pnl)} | Gas spent: ${usd(total.gas)} | MEXC fees: ${usd(total.fees)}`,
    12	  ];
    13	  if (bySymbol.length) {
    14	    lines.push('Per token:');
    15	    for (const s of bySymbol) {
    16	      lines.push(`  ${s.pnl >= 0 ? '🟢' : '🔴'} ${s.symbol}: ${usd(s.pnl)} (${s.trades} trades, ${s.failed} failed, gas ${usd(s.gas)})`);
    17	    }
    18	  }
    19	  try {
    20	    lines.push(formatKpis(computeKpis(db, Date.now() - hours * 3600_000, mode)));
    21	  } catch {
    22	    // KPI tables missing in a very old database: the trade summary above still stands
    23	  }
    24	  return lines.join('\n');
    25	}
```

## `src/telegram.ts`

```
     1	// Telegram alerts + commands (/stop, /start, /status, ...).
     2	// Commands are obeyed only from the admin user, in a private chat with the bot.
     3	import { log, errMsg, redact } from './log.js';
     4	import { sleep } from './util.js';
     5	
     6	type Handler = (args: string[]) => Promise<string> | string;
     7	type FetchFn = typeof fetch;
     8	type Update = {
     9	  message?: { chat?: { id: number | string; type?: string }; from?: { id: number | string }; text?: string; date?: number };
    10	};
    11	
    12	export class Telegram {
    13	  private offset = 0;
    14	  private running = false;
    15	
    16	  /** Commands sent before this moment are never executed (a restart must not replay an old /start confirm). */
    17	  private readonly startedAt = Math.floor(Date.now() / 1000);
    18	
    19	  constructor(
    20	    private token: string,
    21	    private chatId: string,
    22	    private fetchFn: FetchFn = fetch,
    23	    private adminId = '',
    24	    /** Persists the update offset across restarts. */
    25	    private offsetStore?: { get(): string | undefined; set(v: string): void },
    26	    /** First line prepended to every message (e.g. the bot's mode tag). Empty = no tag. */
    27	    private tag = '',
    28	  ) {}
    29	
    30	  get enabled(): boolean {
    31	    return Boolean(this.token && this.chatId);
    32	  }
    33	
    34	  private async api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    35	    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
    36	      method: 'POST',
    37	      headers: { 'Content-Type': 'application/json' },
    38	      body: JSON.stringify(body),
    39	      signal: AbortSignal.timeout(timeoutMs),
    40	    });
    41	    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    42	    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    43	    return j.result;
    44	  }
    45	
    46	  /** Never throws: alerts must not crash the bot. */
    47	  async send(text: string): Promise<void> {
    48	    // One unmistakable first line on every message, so paper and live are never
    49	    // confused in the same chat. A text that already starts with the tag is not doubled.
    50	    const tagged = this.tag && !text.startsWith(this.tag) ? `${this.tag}\n${text}` : text;
    51	    const msg = redact(tagged);
    52	    log.info(`[telegram] ${msg.replace(/\n/g, ' | ')}`);
    53	    if (!this.enabled) return;
    54	    try {
    55	      await this.api('sendMessage', { chat_id: this.chatId, text: msg.slice(0, 4000), disable_web_page_preview: true });
    56	    } catch (e) {
    57	      log.warn(`telegram send failed: ${errMsg(e)}`);
    58	    }
    59	  }
    60	
    61	  /** Dispatch one update; exported for tests. */
    62	  async handle(update: Update, handlers: Record<string, Handler>) {
    63	    const m = update.message;
    64	    if (!m?.text || String(m.chat?.id) !== String(this.chatId)) return; // other chats
    65	    if (m.date !== undefined && m.date < this.startedAt) {
    66	      log.warn(`telegram: ignored command sent before this start (${m.text.split(/\s/)[0]})`);
    67	      return;
    68	    }
    69	    // In a group anyone could type /start: require the admin user in a private chat.
    70	    if (!this.adminId || String(m.from?.id) !== String(this.adminId) || m.chat?.type !== 'private') {
    71	      log.warn(`telegram: ignored command from user ${m.from?.id} in ${m.chat?.type ?? '?'} chat`);
    72	      return;
    73	    }
    74	    const [first, ...args] = m.text.trim().split(/\s+/);
    75	    const cmd = first.split('@')[0].toLowerCase();
    76	    const h = handlers[cmd];
    77	    const reply = h ? await h(args) : `Commands: ${Object.keys(handlers).join(' ')}`;
    78	    await this.send(reply);
    79	  }
    80	
    81	  async startPolling(handlers: Record<string, Handler>): Promise<void> {
    82	    if (!this.enabled || this.running) return;
    83	    this.running = true;
    84	    this.offset = Number(this.offsetStore?.get() ?? 0) || 0;
    85	    let backoff = 5000;
    86	    while (this.running) {
    87	      try {
    88	        const updates = await this.api<({ update_id: number } & Update)[]>(
    89	          'getUpdates',
    90	          { offset: this.offset, timeout: 25, allowed_updates: ['message'] },
    91	          35_000,
    92	        );
    93	        for (const u of updates) {
    94	          this.offset = u.update_id + 1;
    95	          this.offsetStore?.set(String(this.offset)); // acknowledged before handling: never handled twice
    96	          await this.handle(u, handlers).catch((e) => log.warn(`telegram handler: ${errMsg(e)}`));
    97	        }
    98	        backoff = 5000;
    99	      } catch (e) {
   100	        log.warn(`telegram poll: ${errMsg(e)} (retry in ${backoff / 1000}s)`);
   101	        await sleep(backoff);
   102	        backoff = Math.min(backoff * 2, 5 * 60_000); // e.g. a bad token: do not hammer the API
   103	      }
   104	    }
   105	  }
   106	
   107	  stop(): void {
   108	    this.running = false;
   109	  }
   110	}
```

## `src/transfer.ts`

```
     1	// TRANSFER strategy: scan all MEXC ERC20 tokens -> buy the one that is cheaper on MEXC ->
     2	// withdraw it to the hot wallet -> sell it on an Ethereum DEX.
     3	//
     4	// Each cycle is a persisted state machine (buying -> withdrawing -> selling -> done),
     5	// so a crash or pm2 restart continues where it stopped.
     6	//
     7	// Safety rules:
     8	//  - Orders and withdrawals carry our own client id; an ambiguous request (timeout) is looked up,
     9	//    never blindly repeated.
    10	//  - A withdrawal is only ever sent to our own hot wallet, and never re-sent automatically.
    11	//  - Failed DEX sales back off (2m, 10m, 30m) and then wait for a human (/sell <id>, /clear <id>).
    12	//  - If arrival-time price would lose more than TRANSFER_MAX_LOSS_PCT, the tokens are held (alert).
    13	//  - An unknown on-chain outcome pauses trading instead of retrying.
    14	import type { Config } from './config.js';
    15	import { BestOf, ZEROX_ALLOWANCE_HOLDER, type Aggregator, type Quote } from './dex/aggregator.js';
    16	import type { GasInfo, TxResult } from './dex/chain.js';
    17	import type { Book, CoinConfig, Order, SymbolInfo, WithdrawRecord } from './mexc/rest.js';
    18	import { AmbiguousRequestError } from './mexc/rest.js';
    19	import type { Db, TransferRow } from './db.js';
    20	import type { Risk } from './risk.js';
    21	import type { Notifier } from './engine.js';
    22	import { USDC_DECIMALS, cancelAndConfirm, clientId, placeSafely } from './engine.js';
    23	import { closePrice, orderProblem, takerFeeFor } from './mexc/rules.js';
    24	import { type Gap, type ScanToken, dexPrices, findGaps, loadUniverse } from './scanner.js';
    25	import { evaluateTransfer, gasUsd, planCexBuy, threshold } from './pricing.js';
    26	import { log, errMsg } from './log.js';
    27	import { decimalsOfStep, dhakaDay, floorToStep, sleep as realSleep, toFloat, toUnits, usd } from './util.js';
    28	
    29	const APPROVE_GAS = 60_000n;
    30	const PAPER_TAKER = '0x000000000000000000000000000000000000dEaD';
    31	const SELL_BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000]; // after attempt 1, 2, 3; attempt 4 -> stuck
    32	const MAX_SELL_ATTEMPTS = 4;
    33	const FALSE_GAP_COOLDOWN_MS = 10 * 60_000;
    34	
    35	export interface TransferMexc {
    36	  exchangeInfo(): Promise<SymbolInfo[]>;
    37	  tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]>;
    38	  coinConfigs(): Promise<CoinConfig[]>;
    39	  bookTickers(): Promise<Map<string, { bid: number; ask: number }>>;
    40	  depth(symbol: string, limit?: number): Promise<Book>;
    41	  balances(): Promise<Record<string, number>>;
    42	  limitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }>;
    43	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }>;
    44	  getOrder(symbol: string, orderId: string): Promise<Order>;
    45	  getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null>;
    46	  cancelOrder(symbol: string, orderId: string): Promise<Order>;
    47	  withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string>;
    48	  findWithdraw(coin: string, sinceTs: number, ref: { id?: string | null; withdrawOrderId?: string }): Promise<WithdrawRecord | null>;
    49	}
    50	export interface TransferChain {
    51	  readonly address: string;
    52	  gas(): Promise<GasInfo>;
    53	  decimals(token: string): Promise<number>;
    54	  tokenBalance(token: string): Promise<bigint>;
    55	  approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult>;
    56	  simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint>;
    57	  send(
    58	    tx: { to: string; data: string; value?: bigint },
    59	    gasLimit: bigint,
    60	    gas: GasInfo,
    61	    timeoutSec: number,
    62	    onSigned?: (hash: string, nonce: number) => void,
    63	  ): Promise<TxResult>;
    64	  checkUnresolved?(): Promise<{ state: 'clear' | 'pending'; dropped?: boolean }>;
    65	  receipt?(hash: string): Promise<{ status: number | null } | null>;
    66	}
    67	
    68	export interface TransferDeps {
    69	  cfg: Config;
    70	  mexc: TransferMexc;
    71	  chain: TransferChain;
    72	  agg: Aggregator;
    73	  db: Db;
    74	  risk: Risk;
    75	  tg: Notifier;
    76	  dexPricesFn?: typeof dexPrices;
    77	  sleep?: (ms: number) => Promise<void>;
    78	  now?: () => number;
    79	  // Live mode: restrict the universe to tokens proven profitable in paper
    80	  // (same rule as the inventory live watchlist). When set, refreshUniverse
    81	  // re-applies it on every rescan, so newly proven tokens join live.
    82	  provenFilter?: (tokens: ScanToken[]) => ScanToken[];
    83	}
    84	
    85	interface Candidate {
    86	  gap: Gap;
    87	  plan: NonNullable<ReturnType<typeof planCexBuy>>;
    88	  ev: ReturnType<typeof evaluateTransfer>;
    89	  decimals: number;
    90	}
    91	
    92	const WITHDRAW_FAILED = new Set([8, 9]); // FAILED, CANCEL
    93	const WITHDRAW_MANUAL = 10;
    94	const buyCid = (id: number) => `arb${id}b`;
    95	const withdrawCid = (id: number) => `arb${id}w`;
    96	
    97	export class TransferEngine {
    98	  universe: ScanToken[] = [];
    99	  // True when the proven filter emptied a non-empty universe: live has nothing
   100	  // proven yet, so the bot waits instead of failing startup.
   101	  provenFilteredEmpty = false;
   102	  private universeTs = 0;
   103	  private lastNote = new Map<string, string>();
   104	  private cooldown = new Map<string, number>(); // token -> skip exact quotes until
   105	  private alerted = new Set<string>();
   106	  private sleep: (ms: number) => Promise<void>;
   107	  private now: () => number;
   108	  lastGasGwei = 0;
   109	  lastTopGaps: Gap[] = [];
   110	
   111	  constructor(private d: TransferDeps) {
   112	    this.sleep = d.sleep ?? realSleep;
   113	    this.now = d.now ?? Date.now;
   114	  }
   115	
   116	  private get cfg() {
   117	    return this.d.cfg;
   118	  }
   119	  private get live() {
   120	    return this.cfg.mode === 'live';
   121	  }
   122	  /** USDT per USDC, from MEXC USDCUSDT (refreshed every tick). */
   123	  stableRate = 1;
   124	  private fee(base: string) {
   125	    return takerFeeFor(this.universe.find((t) => t.base === base)?.rules, this.cfg.mexcTakerFee);
   126	  }
   127	  private costs(base: string) {
   128	    return {
   129	      takerFee: this.fee(base),
   130	      cexSlippageBps: this.cfg.cexSlippageBps,
   131	      safetyMarginUsd: this.cfg.safetyMarginUsd,
   132	      safetyMarginBps: this.cfg.safetyMarginBps,
   133	      stableInUsdt: this.stableRate,
   134	    };
   135	  }
   136	  private note(key: string, msg: string) {
   137	    if (this.lastNote.get(key) !== msg) {
   138	      this.lastNote.set(key, msg);
   139	      log.info(msg);
   140	    }
   141	  }
   142	  /** Telegram once per key (per process). */
   143	  private async alertOnce(key: string, text: string) {
   144	    if (this.alerted.has(key)) return;
   145	    this.alerted.add(key);
   146	    await this.d.tg.send(text);
   147	  }
   148	  private reload(row: TransferRow): TransferRow {
   149	    return this.d.db.getTransfer(row.id!)!;
   150	  }
   151	
   152	  async refreshUniverse(force = false): Promise<void> {
   153	    if (!force && this.now() - this.universeTs < 10 * 60_000) return;
   154	    const all = await loadUniverse(this.d.mexc, { minVolumeUsd: this.cfg.minMexcVolumeUsd, only: this.cfg.watchlist });
   155	    this.universe = this.d.provenFilter ? this.d.provenFilter(all) : all;
   156	    this.universeTs = this.now();
   157	    this.provenFilteredEmpty = !!this.d.provenFilter && all.length > 0 && this.universe.length === 0;
   158	    if (this.provenFilteredEmpty) this.note('proven-empty', 'live transfer: কোনো টোকেন এখনো paper-এ প্রমাণিত হয়নি — paper-এ লাভ করা টোকেন আসলেই scan শুরু হবে');
   159	    log.info(`scanner universe: ${this.universe.length} MEXC ERC20 tokens (deposit+withdraw open, volume >= $${this.cfg.minMexcVolumeUsd})${this.d.provenFilter ? ' [proven-only]' : ''}`);
   160	  }
   161	
   162	  /** One scan cycle. Always advances open transfers first. */
   163	  async tick(): Promise<void> {
   164	    const gas = await this.d.chain.gas();
   165	    this.lastGasGwei = Number(gas.effective) / 1e9;
   166	    const tickers = await this.d.mexc.bookTickers();
   167	    const eth = tickers.get('ETHUSDT');
   168	    if (!eth) throw new Error('no ETHUSDT ticker');
   169	    const ethUsd = (eth.bid + eth.ask) / 2;
   170	    const st = tickers.get('USDCUSDT');
   171	    const rate = st ? (st.bid + st.ask) / 2 : NaN;
   172	    if (!(rate >= 0.99 && rate <= 1.01)) return this.note('stable', `no trading: USDC/USDT rate ${rate} unusable`);
   173	    this.stableRate = rate;
   174	
   175	    // BestOf must compare quotes AFTER gas, like the inventory engine does (round-3, L7f).
   176	    // The transfer's buy token is always the stable, so gas converts straight to stable units.
   177	    if (this.d.agg instanceof BestOf) {
   178	      const dec = await this.d.chain.decimals(this.cfg.usdc);
   179	      this.d.agg.gasInOutput = (units) => toUnits(gasUsd(units, gas.effective, ethUsd) / this.stableRate, dec);
   180	    }
   181	
   182	    // An earlier DEX tx with unknown outcome blocks every new send (same nonce rule as the inventory engine).
   183	    let txBlocked = false;
   184	    if (this.d.chain.checkUnresolved) {
   185	      const u = await this.d.chain.checkUnresolved();
   186	      if (u.dropped) await this.d.tg.send('ℹ️ An unresolved DEX tx was dropped by every RPC (never mined); its nonce is free again.');
   187	      txBlocked = u.state === 'pending';
   188	      if (txBlocked) await this.alertOnce('unresolved-tx', '⏳ An earlier DEX tx is still unresolved: no DEX sales or new trades until it is mined or dropped.');
   189	      else this.alerted.delete('unresolved-tx');
   190	    }
   191	
   192	    for (const row of this.d.db.openTransfers()) {
   193	      if (txBlocked && row.status === 'selling') continue; // would only be refused
   194	      try {
   195	        await this.advance(row, gas, ethUsd);
   196	      } catch (e) {
   197	        log.error(`transfer #${row.id} ${row.base}: ${errMsg(e)}`);
   198	      }
   199	    }
   200	
   201	    await this.refreshUniverse();
   202	    const dex = await (this.d.dexPricesFn ?? dexPrices)(this.universe.map((t) => t.address));
   203	    const now = this.now();
   204	    const gaps = findGaps(this.universe, tickers, dex, {
   205	      minTvlUsd: this.cfg.minDexTvlUsd,
   206	      minGapPct: this.cfg.scanMinGapPct,
   207	      maxGapPct: this.cfg.scanMaxGapPct,
   208	    });
   209	    this.lastTopGaps = gaps.slice(0, 5);
   210	    this.note(
   211	      'gaps',
   212	      gaps.length
   213	        ? `scan: ${gaps.length} gaps >= ${this.cfg.scanMinGapPct}%: ${gaps.slice(0, 5).map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ')}`
   214	        : `scan: ${this.universe.length} tokens, no gap >= ${this.cfg.scanMinGapPct}%`,
   215	    );
   216	
   217	    const block = this.d.risk.blockReason();
   218	    if (block) return this.note('block', `new trades blocked: ${block}`);
   219	    this.note('block', 'new trades enabled');
   220	    if (txBlocked) return;
   221	    if (this.d.db.blockingTransfers().length >= this.cfg.maxOpenTransfers) return this.note('open', 'waiting for open transfer to finish');
   222	    this.note('open', 'no open transfer');
   223	    if (this.lastGasGwei > this.cfg.maxGasGwei) return this.note('gas', `gas ${this.lastGasGwei.toFixed(1)} gwei > ${this.cfg.maxGasGwei}, no new trades`);
   224	    this.note('gas', 'gas ok');
   225	
   226	    // Skip tokens whose exact quote recently showed the gap was not real, so they cannot starve the rest.
   227	    // Never two transfers of the same token at once (they would share one wallet balance), even after
   228	    // an old one stopped blocking because of a long withdrawal.
   229	    const busyTokens = new Set([...this.d.db.openTransfers(), ...this.d.db.stuckTransfers()].map((t) => t.base));
   230	    const fresh = gaps.filter((g) => (this.cooldown.get(g.token.base) ?? 0) <= now && !busyTokens.has(g.token.base));
   231	    if (!fresh.length) return;
   232	
   233	    const usdt = this.live ? ((await this.d.mexc.balances()).USDT ?? 0) : 1e12;
   234	    let best: Candidate | null = null;
   235	    for (const g of fresh.slice(0, this.cfg.scanExactQuotes)) {
   236	      try {
   237	        const c = await this.evaluate(g, gas, ethUsd, usdt);
   238	        if (!c) {
   239	          this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
   240	          continue;
   241	        }
   242	        const need = threshold(c.ev.costUsd, this.cfg.minProfitUsd, this.cfg.minProfitBps);
   243	        log.info(`${g.token.base}: gap ${g.gapPct.toFixed(2)}%, size ${usd(c.ev.costUsd)}, exact net ${usd(c.ev.net)} (need ${usd(need)})`);
   244	        if (c.ev.net <= need) this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
   245	        else if (!best || c.ev.net > best.ev.net) best = c;
   246	      } catch (e) {
   247	        log.warn(`${g.token.base} evaluate: ${errMsg(e)}`);
   248	        this.cooldown.set(g.token.base, now + FALSE_GAP_COOLDOWN_MS);
   249	      }
   250	    }
   251	    if (!best) return;
   252	    if (!this.live) return this.recordPaper(best);
   253	    await this.start(best, gas, ethUsd);
   254	  }
   255	
   256	  /** Exact, size-specific numbers: MEXC depth walk + withdraw fee + aggregator quote + gas + drift reserve. */
   257	  async evaluate(g: Gap, gas: GasInfo, ethUsd: number, usdt: number): Promise<Candidate | null> {
   258	    const size = Math.min(this.cfg.maxTradeUsd, usdt * 0.99);
   259	    if (size < this.cfg.minTradeUsd) {
   260	      this.note('usdt', `MEXC USDT too low for a trade (${usd(usdt)})`);
   261	      return null;
   262	    }
   263	    const t = g.token;
   264	    const book = await this.d.mexc.depth(t.symbol, 20);
   265	    const plan = planCexBuy({ sizeUsd: size, asks: book.asks, qtyStep: t.qtyStep, takerFee: this.fee(t.base) });
   266	    if (!plan || plan.tokensToSell < t.withdrawMin) return null;
   267	    const arriving = plan.tokensToSell - t.withdrawFee;
   268	    if (arriving <= 0) return null;
   269	    const decimals = await this.d.chain.decimals(t.address);
   270	    const q = await this.d.agg.price({
   271	      sellToken: t.address,
   272	      buyToken: this.cfg.usdc,
   273	      sellAmount: toUnits(arriving, decimals),
   274	      taker: this.live ? this.d.chain.address : PAPER_TAKER,
   275	      slippageBps: this.cfg.dexSlippageBps,
   276	    });
   277	    const ev = evaluateTransfer({
   278	      plan,
   279	      withdrawFeeTokens: t.withdrawFee,
   280	      usdcOut: toFloat(q.buyAmount, USDC_DECIMALS),
   281	      usdcMin: toFloat(q.minBuyAmount, USDC_DECIMALS),
   282	      gasUsd: gasUsd(q.gas + APPROVE_GAS, gas.effective, ethUsd) + this.cfg.l1FeeUsd,
   283	      driftBps: this.cfg.transferDriftBps,
   284	      costs: this.costs(t.base),
   285	    });
   286	    return { gap: g, plan, ev, decimals };
   287	  }
   288	
   289	  private async recordPaper(c: Candidate) {
   290	    const t = c.gap.token;
   291	    const now = this.now();
   292	    this.d.db.insertTrade({
   293	      ts: now, day: dhakaDay(now), mode: 'paper', symbol: t.base, direction: 'TRANSFER',
   294	      size_usd: c.ev.costUsd, qty: c.plan.qty, buy_price: c.ev.buyPrice, sell_price: c.ev.sellPrice,
   295	      expected_net: c.ev.net, cex_fee_usd: c.ev.cexFeeUsd + c.ev.withdrawFeeUsd, gas_usd: c.ev.gasUsd,
   296	      pnl_usd: c.ev.net, status: 'paper', dex_tx: null, cex_order_id: null, note: `gap ${c.gap.gapPct.toFixed(2)}%`,
   297	    });
   298	    await this.d.tg.send(
   299	      `📝 PAPER TRANSFER ${t.base}: buy MEXC @ ${c.ev.buyPrice.toPrecision(6)} -> sell DEX @ ${c.ev.sellPrice.toPrecision(6)}\n` +
   300	        `Size ${usd(c.ev.costUsd)} | fees ${usd(c.ev.cexFeeUsd + c.ev.withdrawFeeUsd)} | gas ${usd(c.ev.gasUsd)} | drift reserve ${usd(c.ev.driftUsd)}\nNet ${usd(c.ev.net)}`,
   301	    );
   302	    this.d.risk.afterTrade('paper');
   303	    this.cooldown.set(t.base, this.now() + FALSE_GAP_COOLDOWN_MS); // one paper trade per gap
   304	  }
   305	
   306	  /** Create the persisted transfer and run its first steps right away. */
   307	  private async start(c: Candidate, gas: GasInfo, ethUsd: number) {
   308	    const t = c.gap.token;
   309	    const now = this.now();
   310	    const id = this.d.db.insertTransfer({
   311	      ts: now, updated: now, base: t.base, symbol: t.symbol, address: t.address, decimals: c.decimals,
   312	      net_work: t.netWork, qty_step: t.qtyStep, price_decimals: t.priceDecimals, status: 'buying',
   313	      buy_qty: c.plan.qty, cost_usd: c.ev.costUsd, buy_order_id: null, withdraw_amount: null, withdraw_id: null,
   314	      wallet_before: null, received: null, usdc_out: null, gas_usd: 0, expected_net: c.ev.net, pnl: null,
   315	      sell_attempts: 0, alerted_timeout: 0, note: null, withdraw_fee: t.withdrawFee, next_try: 0, force_sell: 0, hold_alerted: 0, sell_tx: null,
   316	    });
   317	    log.info(`transfer #${id} ${t.base}: START gap ${c.gap.gapPct.toFixed(2)}% expected ${usd(c.ev.net)}`);
   318	    const row = this.d.db.getTransfer(id)!;
   319	    try {
   320	      await this.buy(row, c.plan.worst * (1 + this.cfg.cexSlippageBps / 10_000));
   321	    } catch (e) {
   322	      if (String((e as Error).message).startsWith('UNKNOWN_ORDER_STATE')) {
   323	        this.d.risk.pause(`MEXC buy state unknown for transfer #${id}`, true);
   324	        await this.d.tg.send(`🚨 TRANSFER #${id} ${t.base}: MEXC buy state unknown (${errMsg(e)}). Trading PAUSED; the bot keeps looking for the order.`);
   325	        return;
   326	      }
   327	      const now2 = this.reload(row);
   328	      if (now2.buy_order_id) {
   329	        log.warn(`transfer #${id}: error after the buy was placed (${errMsg(e)}); continuing next scan`);
   330	        return;
   331	      }
   332	      return this.fail(now2, `MEXC buy rejected: ${errMsg(e)}`, 0, false);
   333	    }
   334	    const next = this.d.db.getTransfer(id)!;
   335	    if (next.status === 'withdrawing') await this.advance(next, gas, ethUsd);
   336	  }
   337	
   338	  /** Move one transfer forward as far as it can go right now. */
   339	  async advance(row: TransferRow, gas: GasInfo, ethUsd: number): Promise<void> {
   340	    if (row.status === 'buying') {
   341	      if (!row.buy_order_id) {
   342	        // Crashed or timed out while placing: find the order by our client id, never guess.
   343	        const o = await this.d.mexc.getOrderByClientId(row.symbol, buyCid(row.id!));
   344	        if (!o) return this.fail(row, 'MEXC buy was never placed', 0, false);
   345	        this.d.db.updateTransfer(row.id!, { buy_order_id: o.orderId });
   346	        row = this.reload(row);
   347	      }
   348	      await this.finishBuy(row);
   349	      row = this.reload(row);
   350	      if (row.status !== 'withdrawing') return;
   351	    }
   352	    if (row.status === 'withdrawing') return this.withdrawStep(row, gas, ethUsd);
   353	    if (row.status === 'selling') return this.sellStep(row, gas, ethUsd);
   354	  }
   355	
   356	  private async buy(row: TransferRow, limitPrice: number) {
   357	    const f = 10 ** row.price_decimals;
   358	    const px = (Math.ceil(limitPrice * f) / f).toFixed(row.price_decimals);
   359	    const qty = row.buy_qty.toFixed(decimalsOfStep(row.qty_step));
   360	    const cid = buyCid(row.id!);
   361	    const { orderId } = await placeSafely(this.d.mexc, row.symbol, cid, () => this.d.mexc.limitOrder(row.symbol, 'BUY', qty, px, cid), this.sleep);
   362	    this.d.db.updateTransfer(row.id!, { buy_order_id: orderId });
   363	    log.info(`transfer #${row.id} MEXC BUY ${qty} ${row.base} @ ${px} id=${orderId}`);
   364	    await this.sleep(1500);
   365	    await this.finishBuy(this.reload(row));
   366	  }
   367	
   368	  private async finishBuy(row: TransferRow) {
   369	    let o = await this.d.mexc.getOrder(row.symbol, row.buy_order_id!);
   370	    if (o.status !== 'FILLED') {
   371	      try {
   372	        o = await cancelAndConfirm(this.d.mexc, row.symbol, row.buy_order_id!, this.sleep);
   373	      } catch (e) {
   374	        log.warn(`transfer #${row.id}: ${errMsg(e)}; checking again next scan`);
   375	        return; // still 'buying': the order is re-read next tick, never assumed
   376	      }
   377	    }
   378	    const filled = Number(o.executedQty);
   379	    const cost = Number(o.cummulativeQuoteQty);
   380	    if (filled <= 0) return this.fail(row, 'MEXC buy did not fill (price moved)', 0, false);
   381	    this.d.db.updateTransfer(row.id!, { status: 'withdrawing', buy_qty: filled, cost_usd: cost });
   382	  }
   383	
   384	  private async withdrawStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
   385	    const since = row.ts - 60_000;
   386	
   387	    if (!row.withdraw_id) {
   388	      if (row.withdraw_amount) {
   389	        // A request was sent before but its result was lost (timeout / restart). Look it up; NEVER resend.
   390	        const rec = await this.d.mexc.findWithdraw(row.base, since, { withdrawOrderId: withdrawCid(row.id!) });
   391	        if (rec) {
   392	          this.d.db.updateTransfer(row.id!, { withdraw_id: rec.id });
   393	          return;
   394	        }
   395	        if (this.now() - row.updated > 10 * 60_000) {
   396	          this.d.db.updateTransfer(row.id!, { status: 'stuck', note: 'withdraw request outcome unknown' });
   397	          await this.d.tg.send(
   398	            `🚨 TRANSFER #${row.id} ${row.base}: withdraw request was sent but MEXC shows no record after 10 min.\n` +
   399	              `Check MEXC withdraw history. If nothing went out: /sell ${row.id} is NOT right (tokens are on MEXC), sell them on MEXC by hand, then /clear ${row.id}.`,
   400	          );
   401	        }
   402	        return;
   403	      }
   404	
   405	      const free = (await this.d.mexc.balances())[row.base] ?? 0;
   406	      const amount = floorToStep(Math.min(free, row.buy_qty * (1 - this.fee(row.base))), row.qty_step);
   407	      const amountStr = amount.toFixed(decimalsOfStep(row.qty_step));
   408	      const min = this.universe.find((t) => t.base === row.base)?.withdrawMin ?? 0;
   409	      if (amount <= 0 || amount < min) {
   410	        const proceeds = amount > 0 ? await this.sellOnMexc(row, amountStr) : 0;
   411	        return this.fail(row, `amount ${amountStr} below MEXC withdraw minimum ${min}; sold back on MEXC`, proceeds - row.cost_usd);
   412	      }
   413	      const before = await this.d.chain.tokenBalance(row.address);
   414	      // Persist BEFORE sending, so a crash during the request can never cause a second withdrawal.
   415	      this.d.db.updateTransfer(row.id!, { withdraw_amount: amountStr, wallet_before: before.toString() });
   416	      try {
   417	        const id = await this.d.mexc.withdraw({
   418	          coin: row.base,
   419	          netWork: row.net_work,
   420	          address: this.d.chain.address, // ONLY ever our own hot wallet
   421	          amount: amountStr,
   422	          contractAddress: row.address,
   423	          withdrawOrderId: withdrawCid(row.id!),
   424	        });
   425	        this.d.db.updateTransfer(row.id!, { withdraw_id: id });
   426	        await this.d.tg.send(`📤 TRANSFER #${row.id} ${row.base}: bought ${row.buy_qty} on MEXC for ${usd(row.cost_usd)}, withdrawing ${amountStr} to wallet`);
   427	      } catch (e) {
   428	        if (e instanceof AmbiguousRequestError) {
   429	          log.warn(`transfer #${row.id} withdraw request ambiguous, will look it up: ${errMsg(e)}`);
   430	          return; // next tick: findWithdraw by withdrawOrderId
   431	        }
   432	        // Clearly rejected: nothing left MEXC. Close the position there instead.
   433	        this.d.db.updateTransfer(row.id!, { withdraw_amount: null });
   434	        const proceeds = await this.sellOnMexc(row, amountStr);
   435	        return this.fail(this.reload(row), `withdraw rejected: ${errMsg(e)}; sold back on MEXC`, proceeds - row.cost_usd);
   436	      }
   437	      return;
   438	    }
   439	
   440	    const rec = await this.d.mexc.findWithdraw(row.base, since, { id: row.withdraw_id, withdrawOrderId: withdrawCid(row.id!) }).catch(() => undefined);
   441	    const bal = await this.d.chain.tokenBalance(row.address);
   442	    const diff = bal - BigInt(row.wallet_before ?? '0');
   443	    // Fee actually charged by MEXC (history) beats the configured one.
   444	    const fee = rec?.transactionFee !== undefined && rec.transactionFee !== '' ? Number(rec.transactionFee) : row.withdraw_fee;
   445	    const expected = toUnits(Math.max(0, Number(row.withdraw_amount) - fee), row.decimals);
   446	
   447	    // Arrival needs BOTH: MEXC says SUCCESS and the wallet grew by (almost) the expected amount.
   448	    // A balance change alone could be an unrelated deposit / airdrop.
   449	    if (rec?.status === 7 && diff > 0n && diff * 100n < expected * 98n) {
   450	      await this.alertOnce(
   451	        `wshort-${row.id}`,
   452	        `⚠️ TRANSFER #${row.id} ${row.base}: MEXC says SUCCESS but the wallet only grew by ${toFloat(diff, row.decimals)} (expected ~${toFloat(expected, row.decimals)}). Waiting; check the wallet.`,
   453	      );
   454	    }
   455	    if (rec?.status === 7 && diff > 0n && diff * 100n >= expected * 98n) {
   456	      // Sell what was withdrawn, never more (extra balance may belong to something else).
   457	      const received = diff > (expected * 102n) / 100n ? expected : diff;
   458	      this.d.db.updateTransfer(row.id!, { status: 'selling', received: received.toString() });
   459	      log.info(`transfer #${row.id} ${row.base}: ${toFloat(received, row.decimals)} arrived in wallet`);
   460	      return this.sellStep(this.reload(row), gas, ethUsd);
   461	    }
   462	    if (rec && WITHDRAW_FAILED.has(rec.status) && diff <= 0n) {
   463	      // Funds go back to the MEXC account; sell there once they are visible.
   464	      const free = (await this.d.mexc.balances())[row.base] ?? 0;
   465	      if (free < Number(row.withdraw_amount) * 0.99) {
   466	        return this.alertOnce(`wfail-${row.id}`, `⚠️ TRANSFER #${row.id} ${row.base}: MEXC withdrawal ${rec.status === 8 ? 'FAILED' : 'CANCELLED'}; waiting for the tokens to return to MEXC`);
   467	      }
   468	      await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base}: withdrawal ${rec.status === 8 ? 'FAILED' : 'CANCELLED'}, selling back on MEXC`);
   469	      // Sell what is actually free on MEXC, never more than was withdrawn.
   470	      const qty = floorToStep(Math.min(free, Number(row.withdraw_amount)), row.qty_step).toFixed(decimalsOfStep(row.qty_step));
   471	      const proceeds = await this.sellOnMexc(row, qty);
   472	      return this.fail(row, `withdraw status ${rec.status}`, proceeds - row.cost_usd);
   473	    }
   474	    if (rec?.status === WITHDRAW_MANUAL) {
   475	      await this.alertOnce(`wmanual-${row.id}`, `⏳ TRANSFER #${row.id} ${row.base}: MEXC put the withdrawal under MANUAL review. Waiting.`);
   476	    }
   477	    if (rec === null) {
   478	      await this.alertOnce(`wmissing-${row.id}`, `⚠️ TRANSFER #${row.id} ${row.base}: withdrawal ${row.withdraw_id} not found in MEXC history. Still watching the wallet.`);
   479	    }
   480	
   481	    const ageMin = (this.now() - row.ts) / 60_000;
   482	    if (ageMin > this.cfg.transferTimeoutMin && row.alerted_timeout < 1) {
   483	      this.d.db.updateTransfer(row.id!, { alerted_timeout: 1 });
   484	      await this.d.tg.send(
   485	        `⏳ TRANSFER #${row.id} ${row.base}: not in wallet after ${Math.round(ageMin)} min (MEXC status ${rec?.status ?? '?'}). Still waiting.`,
   486	      );
   487	    } else if (ageMin > 2 * this.cfg.transferTimeoutMin && row.alerted_timeout < 2) {
   488	      // Give up blocking: new trades may start, this one is still watched every scan (read-only, no gas).
   489	      this.d.db.updateTransfer(row.id!, { alerted_timeout: 2 });
   490	      await this.d.tg.send(
   491	        `⏳ TRANSFER #${row.id} ${row.base}: still not in wallet after ${Math.round(ageMin)} min. It no longer blocks new trades; ` +
   492	          `the bot keeps watching and sells when it arrives. Check MEXC support if it stays missing.`,
   493	      );
   494	    }
   495	  }
   496	
   497	  /**
   498	   * Loss floor: if the DEX would pay less than cost minus TRANSFER_MAX_LOSS_PCT, hold the tokens
   499	   * (alert once) instead of locking in a big loss. Returns true when held.
   500	   * Called on the first quote AND on the firm quote after the approval, because the price may
   501	   * have moved during the approval window (round-3 review, M3).
   502	   */
   503	  private async holdIfBelowFloor(row: TransferRow, minBuyAmount: bigint, qty: number): Promise<boolean> {
   504	    const worstOut = toFloat(minBuyAmount, USDC_DECIMALS) * this.stableRate; // in USDT, like the cost
   505	    const floor = row.cost_usd * (1 - this.cfg.transferMaxLossPct / 100);
   506	    if (worstOut >= floor && row.hold_alerted) this.d.db.updateTransfer(row.id!, { hold_alerted: 0 }); // recovered: alert again if it falls
   507	    if (worstOut < floor && !row.force_sell) {
   508	      this.d.db.updateTransfer(row.id!, { next_try: this.now() + 5 * 60_000 });
   509	      if (!row.hold_alerted) {
   510	        this.d.db.updateTransfer(row.id!, { hold_alerted: 1 });
   511	        await this.d.tg.send(
   512	          `✋ TRANSFER #${row.id} ${row.base}: DEX would pay only ${usd(worstOut)} for tokens that cost ${usd(row.cost_usd)} ` +
   513	            `(more than ${this.cfg.transferMaxLossPct}% loss). HOLDING ${qty} ${row.base} in the wallet and re-checking every 5 min.\n` +
   514	            `Send /sell ${row.id} to sell anyway.`,
   515	        );
   516	      }
   517	      return true;
   518	    }
   519	    return false;
   520	  }
   521	
   522	  private async sellStep(row: TransferRow, gas: GasInfo, ethUsd: number) {
   523	    if (row.next_try > this.now()) return;
   524	    if (Number(gas.effective) / 1e9 > this.cfg.maxGasGwei) return this.note(`sell-${row.id}`, `transfer #${row.id}: gas too high, sale waits`);
   525	
   526	    // Crash safety: a sale tx was signed before (hash persisted). Did it already execute?
   527	    if (row.sell_tx && this.d.chain.receipt) {
   528	      const rc = await this.d.chain.receipt(row.sell_tx).catch(() => null);
   529	      if (rc?.status === 1) {
   530	        this.d.db.updateTransfer(row.id!, { status: 'done', note: 'sale completed before a restart; PnL not measured' });
   531	        this.recordTrade(row, 'ok', 0, row.gas_usd, row.sell_tx, 'sale completed before a restart; PnL not measured');
   532	        await this.d.tg.send(`✅ TRANSFER #${row.id} ${row.base}: the DEX sale ${row.sell_tx} had already executed before the restart. Marked done (PnL not measured).`);
   533	        return;
   534	      }
   535	    }
   536	    // Never sell more than is really in the wallet now.
   537	    const balance = await this.d.chain.tokenBalance(row.address);
   538	    const amount = balance < BigInt(row.received!) ? balance : BigInt(row.received!);
   539	    if (amount * 100n < BigInt(row.received!)) {
   540	      this.d.db.updateTransfer(row.id!, { status: 'stuck', note: 'tokens no longer in the wallet' });
   541	      await this.d.tg.send(
   542	        `🚨 TRANSFER #${row.id} ${row.base}: the tokens are no longer in the wallet (sold before a restart, or moved). Check etherscan, then /clear ${row.id}.`,
   543	      );
   544	      return;
   545	    }
   546	    const qty = toFloat(amount, row.decimals);
   547	    const req = { sellToken: row.address, buyToken: this.cfg.usdc, sellAmount: amount, taker: this.d.chain.address, slippageBps: this.cfg.dexSlippageBps };
   548	    let gasWei = 0n;
   549	    let txHash: string | undefined;
   550	    try {
   551	      const first = await this.d.agg.quote(req);
   552	      if (await this.holdIfBelowFloor(row, first.minBuyAmount, qty)) return;
   553	
   554	      const ap = await this.d.chain.approveExact(row.address, this.spenderOf(first), amount, gas);
   555	      gasWei += ap.gasCostWei;
   556	      if (ap.unknown) return this.unknownOutcome(row, `approval ${ap.hash}`, gasWei, ethUsd);
   557	      if (!ap.ok) throw new Error(`approval failed: ${ap.reason}`);
   558	      const firm = await this.d.agg.quote(req); // fresh after the approval
   559	      if (!firm.tx) throw new Error('quote without transaction');
   560	      // The price may have moved during the approval (up to ~60 s on mainnet): re-check the floor
   561	      // on the FIRM quote before sending, or the loss floor does not protect the actual sale (round-3, M3).
   562	      if (await this.holdIfBelowFloor(row, firm.minBuyAmount, qty)) {
   563	        // The approval gas was really spent; book it so the row's gas stays honest.
   564	        this.d.db.updateTransfer(row.id!, { gas_usd: row.gas_usd + (Number(gasWei) / 1e18) * ethUsd });
   565	        return;
   566	      }
   567	      const est = await this.d.chain.simulate(firm.tx);
   568	      const usdcBefore = await this.d.chain.tokenBalance(this.cfg.usdc);
   569	      const r = await this.d.chain.send(firm.tx, (est * 13n) / 10n, gas, this.cfg.txTimeoutSec, (hash) =>
   570	        this.d.db.updateTransfer(row.id!, { sell_tx: hash }),
   571	      );
   572	      if (r.refused) return; // an earlier tx is unresolved: not an attempt, try again later
   573	      gasWei += r.gasCostWei;
   574	      txHash = r.hash;
   575	      if (r.unknown) return this.unknownOutcome(row, `swap ${r.hash}`, gasWei, ethUsd);
   576	      if (!r.ok) throw new Error(`swap ${r.reason}`);
   577	      const usdcOut = toFloat((await this.d.chain.tokenBalance(this.cfg.usdc)) - usdcBefore, USDC_DECIMALS) * this.stableRate; // USDT
   578	      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
   579	      const pnl = usdcOut - row.cost_usd - gasTotal;
   580	      this.d.db.updateTransfer(row.id!, { status: 'done', usdc_out: usdcOut, gas_usd: gasTotal, pnl });
   581	      this.recordTrade(row, 'ok', pnl, gasTotal, txHash, `sold ${qty} for ${usd(usdcOut)}`, usdcOut / qty);
   582	      await this.d.tg.send(
   583	        [
   584	          `${pnl >= 0 ? '✅' : '🔻'} TRANSFER #${row.id} ${row.base} done`,
   585	          `Buy MEXC: ${row.buy_qty} for ${usd(row.cost_usd)} (@ ${(row.cost_usd / row.buy_qty).toPrecision(6)})`,
   586	          `Sell DEX: ${qty} for ${usd(usdcOut)} (@ ${(usdcOut / qty).toPrecision(6)})`,
   587	          `Withdraw fee ${row.withdraw_fee} ${row.base} | Gas ${usd(gasTotal)}`,
   588	          `Expected ${usd(row.expected_net)} | Net PnL ${usd(pnl)}`,
   589	          `https://etherscan.io/tx/${txHash}`,
   590	        ].join('\n'),
   591	      );
   592	      this.afterRisk('ok');
   593	    } catch (e) {
   594	      const attempts = row.sell_attempts + 1;
   595	      const gasTotal = row.gas_usd + (Number(gasWei) / 1e18) * ethUsd;
   596	      const stuck = attempts >= MAX_SELL_ATTEMPTS;
   597	      const wait = SELL_BACKOFF_MS[Math.min(attempts - 1, SELL_BACKOFF_MS.length - 1)];
   598	      this.d.db.updateTransfer(row.id!, {
   599	        sell_attempts: attempts,
   600	        gas_usd: gasTotal,
   601	        status: stuck ? 'stuck' : 'selling',
   602	        next_try: this.now() + wait,
   603	        note: errMsg(e),
   604	      });
   605	      log.warn(`transfer #${row.id} ${row.base} sell attempt ${attempts} failed: ${errMsg(e)}${stuck ? '' : `; retry in ${wait / 60_000} min`}`);
   606	      if (stuck) {
   607	        await this.d.tg.send(
   608	          `🚨 TRANSFER #${row.id} ${row.base}: DEX sale failed ${attempts} times (${errMsg(e)}). Automatic retries STOPPED.\n` +
   609	            `${qty} ${row.base} are in the hot wallet. Send /sell ${row.id} to try again, or sell by hand and send /clear ${row.id}.`,
   610	        );
   611	        this.afterRisk('one_sided');
   612	      }
   613	    }
   614	  }
   615	
   616	  /** On-chain outcome unknown: do not retry (could double-sell). Pause and hand over to a human. */
   617	  private async unknownOutcome(row: TransferRow, what: string, gasWei: bigint, ethUsd: number) {
   618	    this.d.db.updateTransfer(row.id!, {
   619	      status: 'stuck',
   620	      gas_usd: row.gas_usd + (Number(gasWei) / 1e18) * ethUsd,
   621	      note: `${what} outcome unknown`,
   622	    });
   623	    this.d.risk.pause(`transfer #${row.id}: ${what} outcome unknown`, true);
   624	    await this.d.tg.send(
   625	      `🚨 TRANSFER #${row.id} ${row.base}: ${what} was not mined and its cancel was not confirmed. Outcome UNKNOWN.\n` +
   626	        `Trading PAUSED. Check the wallet on etherscan. Then /sell ${row.id} (if the tokens are still there) or /clear ${row.id}, and /start.`,
   627	    );
   628	  }
   629	
   630	  private spenderOf(q: Quote): string {
   631	    if (q.spender) return q.spender;
   632	    if (this.d.agg.name === '0x') return ZEROX_ALLOWANCE_HOLDER;
   633	    throw new Error('aggregator did not return a spender');
   634	  }
   635	
   636	  /**
   637	   * Market-sell on MEXC; returns the net USDT received.
   638	   * MEXC's docs do not say whether the fee is inside cummulativeQuoteQty, so we measure the
   639	   * real USDT balance change instead of assuming.
   640	   */
   641	  private async sellOnMexc(row: TransferRow, qty: string): Promise<number> {
   642	    const rules = this.universe.find((t) => t.base === row.base)?.rules;
   643	    const px = row.cost_usd / (row.buy_qty || 1);
   644	    // Some symbols have no MARKET order type: use an aggressive LIMIT inside the price band instead.
   645	    const useLimit = Boolean(rules && !rules.orderTypes.includes('MARKET'));
   646	    const problem = rules && orderProblem(rules, 'SELL', Number(qty), px, useLimit ? 'LIMIT' : 'MARKET');
   647	    if (problem) {
   648	      this.d.risk.pause(`cannot sell ${row.base} on MEXC: ${problem}`, true);
   649	      await this.d.tg.send(`🚨 ${row.base}: cannot market-sell ${qty} on MEXC (${problem}). Trading PAUSED: sell it by hand, then /start confirm.`);
   650	      return 0;
   651	    }
   652	    try {
   653	      const usdtBefore = (await this.d.mexc.balances()).USDT ?? 0;
   654	      const cid = clientId(`${row.id}s`);
   655	      let place = () => this.d.mexc.marketSell(row.symbol, qty, cid);
   656	      if (useLimit && rules) {
   657	        const b = await this.d.mexc.depth(row.symbol, 5);
   658	        const limit = closePrice(rules, 'SELL', { bid: b.bids[0][0], ask: b.asks[0][0] }).toFixed(rules.priceDecimals);
   659	        place = () => this.d.mexc.limitOrder(row.symbol, 'SELL', qty, limit, cid);
   660	      }
   661	      const { orderId } = await placeSafely(this.d.mexc, row.symbol, cid, place, this.sleep);
   662	      await this.sleep(1000);
   663	      let o = await this.d.mexc.getOrder(row.symbol, orderId);
   664	      if (o.status !== 'FILLED') o = await cancelAndConfirm(this.d.mexc, row.symbol, orderId, this.sleep);
   665	      const filled = Number(o.executedQty);
   666	      if (filled < Number(qty) * 0.999) {
   667	        this.d.risk.pause(`MEXC sell of ${row.base} only partly filled`, true);
   668	        await this.d.tg.send(
   669	          `🚨 ${row.base}: MEXC market sell filled only ${filled}/${qty}. The rest is still on MEXC. Trading PAUSED: sell it by hand, then /start.`,
   670	        );
   671	      }
   672	      await this.sleep(1500);
   673	      const received = ((await this.d.mexc.balances()).USDT ?? 0) - usdtBefore;
   674	      // Fallback only if the balance read is clearly off (e.g. a concurrent deposit/withdrawal).
   675	      return received > 0 ? received : Number(o.cummulativeQuoteQty) * (1 - this.fee(row.base));
   676	    } catch (e) {
   677	      this.d.risk.pause(`could not close ${row.base} on MEXC`, true);
   678	      await this.d.tg.send(`🚨 ${row.base}: MEXC market sell of ${qty} FAILED (${errMsg(e)}). Trading PAUSED. Close it manually, then /start.`);
   679	      return 0;
   680	    }
   681	  }
   682	
   683	  private async fail(row: TransferRow, why: string, pnl: number, countAsFailure = true) {
   684	    this.d.db.updateTransfer(row.id!, { status: 'failed', pnl, note: why });
   685	    log.warn(`transfer #${row.id} ${row.base} failed: ${why}`);
   686	    if (!countAsFailure) return; // e.g. buy simply did not fill: no money moved
   687	    this.recordTrade(row, 'one_sided', pnl, row.gas_usd, undefined, why);
   688	    await this.d.tg.send(`⚠️ TRANSFER #${row.id} ${row.base} failed: ${why}\nPnL ${usd(pnl)}`);
   689	    this.afterRisk('one_sided');
   690	  }
   691	
   692	  /** Telegram /sell <id>: retry a stuck or held sale now (even below the loss floor). */
   693	  forceSell(id: number): string {
   694	    const t = this.d.db.getTransfer(id);
   695	    if (!t) return `No transfer #${id}`;
   696	    if (!t.received) return `Transfer #${id} has no tokens in the wallet yet (status ${t.status})`;
   697	    if (t.status !== 'stuck' && t.status !== 'selling') return `Transfer #${id} is ${t.status}`;
   698	    this.d.db.updateTransfer(id, { status: 'selling', force_sell: 1, next_try: 0, sell_attempts: 0 });
   699	    return `Transfer #${id}: selling on the next scan (loss floor ignored).`;
   700	  }
   701	
   702	  /** Telegram /clear <id>: you resolved it by hand; close the record. */
   703	  clear(id: number): string {
   704	    const t = this.d.db.getTransfer(id);
   705	    if (!t) return `No transfer #${id}`;
   706	    if (t.status === 'done' || t.status === 'failed') return `Transfer #${id} is already ${t.status}`;
   707	    this.d.db.updateTransfer(id, { status: 'failed', note: 'cleared manually via /clear' });
   708	    // Gas already burned on this transfer is a real cost: book it so the daily loss limit sees it.
   709	    if (t.gas_usd > 0) this.recordTrade(t, 'one_sided', -t.gas_usd, t.gas_usd, undefined, 'cleared manually; gas spent');
   710	    return `Transfer #${id} closed manually. Gas spent (${usd(t.gas_usd)}) is booked; the token result is not, check balances yourself.`;
   711	  }
   712	
   713	  private recordTrade(row: TransferRow, status: 'ok' | 'one_sided', pnl: number, gas: number, tx: string | undefined, note: string, sellPrice = 0) {
   714	    const now = this.now();
   715	    const buyPrice = row.cost_usd / (row.buy_qty || 1);
   716	    this.d.db.insertTrade({
   717	      ts: now, day: dhakaDay(now), mode: this.cfg.mode, symbol: row.base, direction: 'TRANSFER',
   718	      size_usd: row.cost_usd, qty: row.buy_qty, buy_price: buyPrice, sell_price: sellPrice, expected_net: row.expected_net,
   719	      // informational only: PnL is measured from real balances and already includes every fee
   720	      cex_fee_usd: row.cost_usd * this.fee(row.base) + row.withdraw_fee * buyPrice,
   721	      gas_usd: gas, pnl_usd: pnl, status, dex_tx: tx ?? null, cex_order_id: row.buy_order_id, note,
   722	    });
   723	  }
   724	
   725	  private afterRisk(status: 'ok' | 'one_sided') {
   726	    for (const e of this.d.risk.afterTrade(status)) {
   727	      if (e.kind === 'loss_limit') void this.d.tg.send(`🛑 Daily loss limit hit (${usd(e.pnl)}). New trades STOPPED. Send /start to resume.`);
   728	      if (e.kind === 'fail_streak') void this.d.tg.send(`🛑 ${e.count} failed trades in a row. New trades PAUSED. /start to resume.`);
   729	      if (e.kind === 'trade_limit') void this.d.tg.send(`ℹ️ Daily trade limit reached (${e.trades}).`);
   730	    }
   731	  }
   732	}
```

## `src/util.ts`

```
     1	export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
     2	
     3	/** Run fn over items in parallel batches of `size` (network-bound work). Results keep input order. */
     4	export async function mapBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
     5	  const out: R[] = [];
     6	  for (let i = 0; i < items.length; i += size) {
     7	    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
     8	  }
     9	  return out;
    10	}
    11	
    12	const DHAKA_OFFSET_MS = 6 * 3600 * 1000; // Bangladesh: UTC+6, no DST
    13	
    14	/** Calendar day in Bangladesh time, e.g. "2026-11-20". Daily limits reset at Dhaka midnight. */
    15	export function dhakaDay(t = Date.now()): string {
    16	  return new Date(t + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
    17	}
    18	
    19	export function dhakaHourMinute(t = Date.now()): { hour: number; minute: number } {
    20	  const d = new Date(t + DHAKA_OFFSET_MS);
    21	  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
    22	}
    23	
    24	/** Round down to a multiple of `step` (e.g. MEXC quantity precision) and format without float noise. */
    25	export function floorToStep(x: number, step: number): number {
    26	  if (step <= 0) return x;
    27	  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    28	  const v = Math.floor(x / step + 1e-9) * step;
    29	  return Number(v.toFixed(decimals));
    30	}
    31	
    32	export function decimalsOfStep(step: number): number {
    33	  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    34	}
    35	
    36	export const usd = (x: number) => `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(2)}`;
    37	
    38	/** Token amount (bigint base units) -> float. Fine for pricing; never used for on-chain amounts. */
    39	export function toFloat(amount: bigint, decimals: number): number {
    40	  const s = amount.toString().padStart(decimals + 1, '0');
    41	  return Number(`${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals) || '0'}`);
    42	}
    43	
    44	/** Float -> base units, truncated (never rounded up, so we never ask for more than we hold). */
    45	export function toUnits(x: number, decimals: number): bigint {
    46	  if (!(x > 0) || !Number.isFinite(x)) return 0n;
    47	  // Work on the shortest exact decimal string of the number and CUT it: toFixed() would round
    48	  // (0.1239999999 -> "0.124"), and the full binary expansion is slightly above the intended value.
    49	  const [i, f = ''] = plainDecimal(x).split('.');
    50	  return BigInt(i + f.padEnd(decimals, '0').slice(0, decimals));
    51	}
    52	
    53	/** Number -> plain decimal string without exponent ("1.5e-7" -> "0.00000015"). */
    54	function plainDecimal(x: number): string {
    55	  const s = String(x);
    56	  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
    57	  if (!m) return s;
    58	  const digits = m[1] + (m[2] ?? '');
    59	  const point = m[1].length + Number(m[3]);
    60	  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
    61	  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
    62	  return `${digits.slice(0, point)}.${digits.slice(point)}`;
    63	}
```

## `src/watchlist.ts`

```
     1	// Builds the token list: on MEXC (USDT pair) AND on Ethereum, with the SAME contract address
     2	// (taken from MEXC's own deposit network info), enough DEX TVL and MEXC volume.
     3	import type { CoinConfig, MexcRest } from './mexc/rest.js';
     4	import { log, errMsg } from './log.js';
     5	import { type ChainProfile, networkFor } from './chains.js';
     6	import { type SymbolRules, rulesFrom } from './mexc/rules.js';
     7	
     8	/** exchangeInfo status: live API returns "1"; the docs example shows "ENABLED". Accept both. */
     9	export const isOnline = (status: unknown) => String(status) === '1' || String(status).toUpperCase() === 'ENABLED';
    10	
    11	export interface Token {
    12	  base: string; // e.g. LINK
    13	  symbol: string; // MEXC symbol, e.g. LINKUSDT
    14	  address: string; // Ethereum contract (lowercase)
    15	  decimals: number;
    16	  qtyStep: number; // MEXC quantity step (from baseAssetPrecision)
    17	  priceDecimals: number; // MEXC price precision
    18	  rules: SymbolRules;
    19	  dexTvlUsd: number;
    20	  mexcVolumeUsd: number;
    21	  depositOk: boolean;
    22	  withdrawOk: boolean;
    23	}
    24	
    25	const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH', 'WBTC']);
    26	
    27	/** MEXC's Ethereum network entry for a coin (network names vary: "ERC20", "Ethereum(ERC20)", netWork "ETH"). */
    28	export function ethNetwork(cfg: CoinConfig) {
    29	  return cfg.networkList.find(
    30	    (n) => n.netWork === 'ETH' || /ERC20/i.test(n.network) || /^ethereum$/i.test(n.network),
    31	  );
    32	}
    33	
    34	type FetchFn = typeof fetch;
    35	
    36	/** Highest liquidity (USD) of any Ethereum pool for the token, from DexScreener. */
    37	export async function dexTvl(address: string, fetchFn: FetchFn = fetch, dexScreenerChain = 'ethereum'): Promise<number> {
    38	  const res = await fetchFn(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(8000) });
    39	  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    40	  const j = (await res.json()) as { pairs?: { chainId: string; liquidity?: { usd?: number } }[] | null };
    41	  return Math.max(0, ...(j.pairs ?? []).filter((p) => p.chainId === dexScreenerChain).map((p) => p.liquidity?.usd ?? 0));
    42	}
    43	
    44	/** Rough USD price per token from DexScreener (highest-liquidity Ethereum pair). Batched, 25 addresses per call. */
    45	export async function dexPrices(addresses: string[], fetchFn: FetchFn = fetch, dexScreenerChain = 'ethereum'): Promise<Map<string, number>> {
    46	  const best = new Map<string, { price: number; liq: number }>();
    47	  for (let i = 0; i < addresses.length; i += 25) {
    48	    const chunk = addresses.slice(i, i + 25);
    49	    const res = await fetchFn(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`, { signal: AbortSignal.timeout(8000) });
    50	    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    51	    const j = (await res.json()) as { pairs?: { chainId: string; baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } }[] | null };
    52	    for (const p of j.pairs ?? []) {
    53	      if (p.chainId !== dexScreenerChain || !p.baseToken?.address || p.priceUsd === undefined) continue;
    54	      const price = Number(p.priceUsd);
    55	      if (!Number.isFinite(price) || price <= 0) continue;
    56	      const key = p.baseToken.address.toLowerCase();
    57	      const liq = p.liquidity?.usd ?? 0;
    58	      const cur = best.get(key);
    59	      if (!cur || liq > cur.liq) best.set(key, { price, liq });
    60	    }
    61	  }
    62	  return new Map([...best.entries()].map(([k, v]) => [k, v.price]));
    63	}
    64	
    65	export interface PaperTokenStat { symbol: string; trades: number; wins: number; pnl: number }
    66	
    67	/**
    68	 * Live mode: keep only tokens proven profitable in paper trading, best paper P&L first.
    69	 * `stats` come from Db.paperTokenStats() (trades.symbol is the base symbol, e.g. NPC).
    70	 * Tokens with no paper history never qualify — paper mode is the scout that earns history.
    71	 */
    72	export function provenTokens<T extends { base: string }>(tokens: T[], stats: PaperTokenStat[], minTrades: number, minPnlUsd: number, max: number): T[] {
    73	  const byBase = new Map(stats.map((s) => [s.symbol, s]));
    74	  return tokens
    75	    .filter((t) => {
    76	      const s = byBase.get(t.base);
    77	      return !!s && s.trades >= minTrades && s.pnl > minPnlUsd;
    78	    })
    79	    .sort((a, b) => (byBase.get(b.base)?.pnl ?? 0) - (byBase.get(a.base)?.pnl ?? 0))
    80	    .slice(0, max);
    81	}
    82	
    83	export async function buildWatchlist(
    84	  mexc: MexcRest,
    85	  decimalsOf: (address: string) => Promise<number>,
    86	  opts: { only: string[]; max: number; minTvlUsd: number; minVolumeUsd: number; chain?: ChainProfile },
    87	): Promise<Token[]> {
    88	  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
    89	  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
    90	  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));
    91	
    92	  const candidates = symbols
    93	    .filter((s) => s.quoteAsset === 'USDT' && s.isSpotTradingAllowed && isOnline(s.status))
    94	    .filter((s) => !SKIP.has(s.baseAsset.toUpperCase()))
    95	    .filter((s) => opts.only.length === 0 || opts.only.includes(s.baseAsset.toUpperCase()))
    96	    .filter((s) => (volume.get(s.symbol) ?? 0) >= opts.minVolumeUsd)
    97	    .sort((a, b) => (volume.get(b.symbol) ?? 0) - (volume.get(a.symbol) ?? 0));
    98	
    99	  // Check candidates 8 at a time (each DexScreener call can take seconds), stop once we have enough.
   100	  const out: Token[] = [];
   101	  const check = async (s: (typeof candidates)[number]): Promise<Token | null> => {
   102	    const coin = coinBy.get(s.baseAsset.toUpperCase());
   103	    // The token's contract on THIS chain, as MEXC lists it for deposits on this network (same token for sure).
   104	    const net = coin && (opts.chain ? networkFor(opts.chain, coin.networkList) : ethNetwork(coin));
   105	    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) return null; // not on this chain at MEXC
   106	    const address = net.contract.toLowerCase();
   107	    try {
   108	      const tvl = await dexTvl(address, fetch, opts.chain?.dexScreenerId ?? 'ethereum');
   109	      if (tvl < opts.minTvlUsd) {
   110	        log.info(`watchlist: skip ${s.baseAsset}, DEX TVL $${Math.round(tvl)}`);
   111	        return null;
   112	      }
   113	      const rules = rulesFrom(s);
   114	      return {
   115	        base: s.baseAsset.toUpperCase(),
   116	        symbol: s.symbol,
   117	        address,
   118	        decimals: await decimalsOf(address),
   119	        qtyStep: rules.qtyStep,
   120	        priceDecimals: s.quotePrecision,
   121	        rules,
   122	        dexTvlUsd: tvl,
   123	        mexcVolumeUsd: volume.get(s.symbol) ?? 0,
   124	        depositOk: net.depositEnable,
   125	        withdrawOk: net.withdrawEnable,
   126	      };
   127	    } catch (e) {
   128	      log.warn(`watchlist: ${s.baseAsset} check failed: ${errMsg(e)}`);
   129	      return null;
   130	    }
   131	  };
   132	  for (let i = 0; i < candidates.length && out.length < opts.max; i += 8) {
   133	    const batch = await Promise.all(candidates.slice(i, i + 8).map(check));
   134	    for (const t of batch) if (t && out.length < opts.max) out.push(t);
   135	  }
   136	  return out;
   137	}
   138	
   139	/** Refresh deposit/withdraw flags (tokens with either suspended are skipped). */
   140	export async function refreshStatus(mexc: MexcRest, tokens: Token[], chain?: ChainProfile): Promise<string[]> {
   141	  const coins = new Map((await mexc.coinConfigs()).map((c) => [c.coin.toUpperCase(), c]));
   142	  const changed: string[] = [];
   143	  for (const t of tokens) {
   144	    const coin = coins.get(t.base);
   145	    const net = coin && (chain ? networkFor(chain, coin.networkList) : ethNetwork(coin));
   146	    const dep = Boolean(net?.depositEnable && net.contract?.toLowerCase() === t.address);
   147	    const wd = Boolean(net?.withdrawEnable);
   148	    if (dep !== t.depositOk || wd !== t.withdrawOk) changed.push(`${t.base}: deposit ${dep ? 'on' : 'OFF'}, withdraw ${wd ? 'on' : 'OFF'}`);
   149	    t.depositOk = dep;
   150	    t.withdrawOk = wd;
   151	  }
   152	  return changed;
   153	}
```

## `src/mexc/proto.ts`

```
     1	// Minimal protobuf decoder for MEXC WebSocket pushes (wss://wbs-api.mexc.com/ws).
     2	// MEXC sends PushDataV3ApiWrapper messages:
     3	//   1: channel (string), 3: symbol (string), 6: sendTime (int64),
     4	//   303: publicLimitDepths { 1: asks[], 2: bids[], 3: eventType, 4: version }
     5	//   each level: { 1: price (string), 2: quantity (string) }
     6	// Only the fields we use are decoded; everything else is skipped by wire type.
     7	
     8	type Field = { num: number; wire: number; value: number | Uint8Array };
     9	
    10	function readVarint(buf: Uint8Array, pos: number): [number, number] {
    11	  let result = 0;
    12	  let shift = 0;
    13	  for (;;) {
    14	    if (pos >= buf.length) throw new Error('truncated varint');
    15	    const b = buf[pos++];
    16	    result += (b & 0x7f) * 2 ** shift; // avoid 32-bit overflow of <<
    17	    if ((b & 0x80) === 0) return [result, pos];
    18	    shift += 7;
    19	  }
    20	}
    21	
    22	export function decodeFields(buf: Uint8Array): Field[] {
    23	  const out: Field[] = [];
    24	  let pos = 0;
    25	  while (pos < buf.length) {
    26	    let key: number;
    27	    [key, pos] = readVarint(buf, pos);
    28	    const num = Math.floor(key / 8);
    29	    const wire = key & 7;
    30	    if (wire === 0) {
    31	      let v: number;
    32	      [v, pos] = readVarint(buf, pos);
    33	      out.push({ num, wire, value: v });
    34	    } else if (wire === 2) {
    35	      let len: number;
    36	      [len, pos] = readVarint(buf, pos);
    37	      if (pos + len > buf.length) throw new Error('truncated field');
    38	      out.push({ num, wire, value: buf.subarray(pos, pos + len) });
    39	      pos += len;
    40	    } else if (wire === 1) {
    41	      pos += 8;
    42	    } else if (wire === 5) {
    43	      pos += 4;
    44	    } else {
    45	      throw new Error(`unsupported wire type ${wire}`);
    46	    }
    47	  }
    48	  return out;
    49	}
    50	
    51	const text = new TextDecoder();
    52	const str = (v: Field['value'] | string) => (v instanceof Uint8Array ? text.decode(v) : String(v));
    53	
    54	function levels(fields: Field[], num: number): [number, number][] {
    55	  return fields
    56	    .filter((f) => f.num === num && f.value instanceof Uint8Array)
    57	    .map((f) => {
    58	      const lv = decodeFields(f.value as Uint8Array);
    59	      const price = Number(str(lv.find((x) => x.num === 1)?.value ?? '0'));
    60	      const qty = Number(str(lv.find((x) => x.num === 2)?.value ?? '0'));
    61	      return [price, qty] as [number, number];
    62	    });
    63	}
    64	
    65	export interface DepthPush {
    66	  channel: string;
    67	  symbol: string;
    68	  asks: [number, number][];
    69	  bids: [number, number][];
    70	}
    71	
    72	/** Decode a limit-depth push; returns null for other message types. */
    73	export function decodeDepthPush(buf: Uint8Array): DepthPush | null {
    74	  const top = decodeFields(buf);
    75	  const depth = top.find((f) => f.num === 303 && f.value instanceof Uint8Array);
    76	  if (!depth) return null;
    77	  const inner = decodeFields(depth.value as Uint8Array);
    78	  return {
    79	    channel: str(top.find((f) => f.num === 1)?.value ?? ''),
    80	    symbol: str(top.find((f) => f.num === 3)?.value ?? ''),
    81	    asks: levels(inner, 1).sort((a, b) => a[0] - b[0]),
    82	    bids: levels(inner, 2).sort((a, b) => b[0] - a[0]),
    83	  };
    84	}
```

## `src/mexc/rest.ts`

```
     1	// MEXC Spot API v3 REST client. https://mexcdevelop.github.io/apidocs/spot_v3_en/
     2	import crypto from 'node:crypto';
     3	import { redact } from '../log.js';
     4	
     5	export type Side = 'BUY' | 'SELL';
     6	export type Level = [price: number, qty: number];
     7	export interface Book {
     8	  bids: Level[];
     9	  asks: Level[];
    10	  ts: number;
    11	}
    12	export interface SymbolInfo {
    13	  symbol: string;
    14	  baseAsset: string;
    15	  quoteAsset: string;
    16	  status: string;
    17	  isSpotTradingAllowed: boolean;
    18	  baseSizePrecision: string; // quantity step, e.g. "0.01" ("0" = use baseAssetPrecision)
    19	  baseAssetPrecision?: number;
    20	  quotePrecision: number;
    21	  orderTypes: string[];
    22	  quoteAmountPrecision?: string; // minimum order value (USDT)
    23	  maxQuoteAmount?: string;
    24	  quoteAmountPrecisionMarket?: string;
    25	  maxQuoteAmountMarket?: string;
    26	  filters?: { filterType: string; bidMultiplierUp?: string; askMultiplierDown?: string }[];
    27	  tradeSideType?: number; // 1 all, 2 buy only, 3 sell only, 4 close only
    28	  takerCommission?: string; // per-symbol default fee, e.g. "0.0008"
    29	  makerCommission?: string;
    30	}
    31	export interface CoinNetwork {
    32	  coin: string;
    33	  network: string;
    34	  netWork?: string;
    35	  contract?: string;
    36	  depositEnable: boolean;
    37	  withdrawEnable: boolean;
    38	  withdrawFee?: string; // in the coin itself
    39	  withdrawMin?: string;
    40	  withdrawMax?: string;
    41	}
    42	export interface CoinConfig {
    43	  coin: string;
    44	  networkList: CoinNetwork[];
    45	}
    46	export interface Order {
    47	  orderId: string;
    48	  status: string; // NEW, FILLED, PARTIALLY_FILLED, CANCELED, PARTIALLY_CANCELED
    49	  executedQty: string;
    50	  cummulativeQuoteQty: string;
    51	  origQty: string;
    52	  price: string;
    53	  side: Side;
    54	}
    55	
    56	type FetchFn = typeof fetch;
    57	
    58	/** HTTP 429/418 from any API: callers back off instead of hammering, at least `retryAfterSec`. */
    59	export class RateLimitError extends Error {
    60	  constructor(msg: string, readonly retryAfterSec = 0) {
    61	    super(msg);
    62	  }
    63	}
    64	
    65	/**
    66	 * The request may or may not have reached MEXC (timeout / connection reset on a POST).
    67	 * Never assume "not placed": look the order / withdrawal up by our own client id.
    68	 */
    69	export class AmbiguousRequestError extends Error {}
    70	
    71	/** MEXC answered with an error body; `code` is MEXC's error code when present (e.g. -2011 "Unknown order sent"). */
    72	export class MexcApiError extends Error {
    73	  constructor(msg: string, readonly status: number, readonly code?: number) {
    74	    super(msg);
    75	  }
    76	}
    77	
    78	export interface WithdrawRecord {
    79	  id: string;
    80	  status: number;
    81	  amount: string;
    82	  /** Fee MEXC actually charged (withdraw history `transactionFee`). */
    83	  transactionFee?: string;
    84	  txId?: string;
    85	  withdrawOrderId?: string;
    86	}
    87	
    88	export class MexcRest {
    89	  /** serverTime - localTime, so signed timestamps stay inside recvWindow even if the VPS clock drifts. */
    90	  timeOffsetMs = 0;
    91	
    92	  constructor(
    93	    private apiKey = '',
    94	    private apiSecret = '',
    95	    private baseUrl = 'https://api.mexc.com',
    96	    private fetchFn: FetchFn = fetch,
    97	  ) {}
    98	
    99	  sign(query: string): string {
   100	    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
   101	  }
   102	
   103	  async request<T>(method: string, path: string, params: Record<string, string | number> = {}, signed = false): Promise<T> {
   104	    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
   105	    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
   106	    if (signed) {
   107	      if (!this.apiKey || !this.apiSecret) throw new Error('MEXC API key/secret not configured');
   108	      qs.set('timestamp', String(Date.now() + this.timeOffsetMs));
   109	      qs.set('recvWindow', '5000');
   110	      qs.set('signature', this.sign(qs.toString()));
   111	      headers['X-MEXC-APIKEY'] = this.apiKey;
   112	    }
   113	    const q = qs.toString();
   114	    let res: Response;
   115	    let text: string;
   116	    try {
   117	      res = await this.fetchFn(`${this.baseUrl}${path}${q ? `?${q}` : ''}`, {
   118	        method,
   119	        headers,
   120	        signal: AbortSignal.timeout(10_000),
   121	      });
   122	      text = await res.text();
   123	    } catch (e) {
   124	      const msg = redact(`MEXC ${method} ${path}: ${(e as Error).message}`);
   125	      // A write that timed out may still have been executed by MEXC.
   126	      if (method !== 'GET') throw new AmbiguousRequestError(msg);
   127	      throw new Error(msg);
   128	    }
   129	    let body: unknown;
   130	    try {
   131	      body = JSON.parse(text);
   132	    } catch {
   133	      body = text;
   134	    }
   135	    const err = redact(`MEXC ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
   136	    // MEXC docs: "A Retry-After header is sent with a 418 or 429 responses".
   137	    if (res.status === 429 || res.status === 418) throw new RateLimitError(err, Number(res.headers.get('retry-after')) || 0);
   138	    if (res.status >= 500 && method !== 'GET') throw new AmbiguousRequestError(err);
   139	    if (!res.ok) {
   140	      const code = body && typeof body === 'object' && 'code' in body ? Number((body as { code: unknown }).code) : undefined;
   141	      throw new MexcApiError(err, res.status, Number.isFinite(code) ? code : undefined);
   142	    }
   143	    return body as T;
   144	  }
   145	
   146	  /** Measure clock skew against MEXC; returns the offset in ms. */
   147	  async syncTime(): Promise<number> {
   148	    const t0 = Date.now();
   149	    const r = await this.request<{ serverTime: number }>('GET', '/api/v3/time');
   150	    const t1 = Date.now();
   151	    this.timeOffsetMs = Math.round(r.serverTime - (t0 + t1) / 2);
   152	    return this.timeOffsetMs;
   153	  }
   154	
   155	  async depth(symbol: string, limit = 20): Promise<Book> {
   156	    const d = await this.request<{ bids: [string, string][]; asks: [string, string][] }>('GET', '/api/v3/depth', { symbol, limit });
   157	    const conv = (l: [string, string][]): Level[] => l.map(([p, q]) => [Number(p), Number(q)]);
   158	    return { bids: conv(d.bids), asks: conv(d.asks), ts: Date.now() };
   159	  }
   160	
   161	  async exchangeInfo(): Promise<SymbolInfo[]> {
   162	    const r = await this.request<{ symbols: SymbolInfo[] }>('GET', '/api/v3/exchangeInfo');
   163	    return r.symbols;
   164	  }
   165	
   166	  async tickers24h(): Promise<{ symbol: string; quoteVolume: string; lastPrice: string }[]> {
   167	    return this.request('GET', '/api/v3/ticker/24hr');
   168	  }
   169	
   170	  async price(symbol: string): Promise<number> {
   171	    const r = await this.request<{ price: string }>('GET', '/api/v3/ticker/price', { symbol });
   172	    return Number(r.price);
   173	  }
   174	
   175	  /** Deposit/withdraw status and contract address per network (signed). */
   176	  async coinConfigs(): Promise<CoinConfig[]> {
   177	    return this.request('GET', '/api/v3/capital/config/getall', {}, true);
   178	  }
   179	
   180	  async account(): Promise<{ canTrade: boolean; balances: { asset: string; free: string; locked: string }[] }> {
   181	    return this.request('GET', '/api/v3/account', {}, true);
   182	  }
   183	
   184	  /** Free balances (what can be traded now); includeLocked adds funds held in open orders. */
   185	  async balances(includeLocked = false): Promise<Record<string, number>> {
   186	    const a = await this.account();
   187	    return Object.fromEntries(a.balances.map((b) => [b.asset, Number(b.free) + (includeLocked ? Number(b.locked) : 0)]));
   188	  }
   189	
   190	  /** Best bid/ask for every symbol in one call. */
   191	  async bookTickers(): Promise<Map<string, { bid: number; ask: number }>> {
   192	    const r = await this.request<{ symbol: string; bidPrice: string; askPrice: string }[]>('GET', '/api/v3/ticker/bookTicker');
   193	    return new Map(r.map((t) => [t.symbol, { bid: Number(t.bidPrice), ask: Number(t.askPrice) }]));
   194	  }
   195	
   196	  /** Withdraw (new endpoint). Requires an API key with withdraw permission. Returns the withdraw id. */
   197	  async withdraw(p: { coin: string; netWork: string; address: string; amount: string; contractAddress?: string; withdrawOrderId?: string }): Promise<string> {
   198	    const params: Record<string, string> = { coin: p.coin, netWork: p.netWork, address: p.address, amount: p.amount };
   199	    if (p.contractAddress) params.contractAddress = p.contractAddress;
   200	    if (p.withdrawOrderId) params.withdrawOrderId = p.withdrawOrderId;
   201	    const r = await this.request<{ id: string }>('POST', '/api/v3/capital/withdraw', params, true);
   202	    return r.id;
   203	  }
   204	
   205	  /** Recent withdrawals of a coin (status: 1 APPLY .. 6 WAIT_CONFIRM, 7 SUCCESS, 8 FAILED, 9 CANCEL, 10 MANUAL). */
   206	  async withdrawHistory(coin: string, sinceTs: number): Promise<WithdrawRecord[]> {
   207	    const r = await this.request<{ id: string; status: number | string; amount: string; transactionFee?: string; txId?: string; withdrawOrderId?: string }[]>(
   208	      'GET',
   209	      '/api/v3/capital/withdraw/history',
   210	      { coin, startTime: Math.max(0, Math.floor(sinceTs)), limit: 1000 },
   211	      true,
   212	    );
   213	    return r.map((w) => ({ id: w.id, status: Number(w.status), amount: w.amount, transactionFee: w.transactionFee, txId: w.txId, withdrawOrderId: w.withdrawOrderId }));
   214	  }
   215	
   216	  /** Find a withdrawal by MEXC id or by our own withdrawOrderId. null = not in history. */
   217	  async findWithdraw(coin: string, sinceTs: number, ref: { id?: string | null; withdrawOrderId?: string }): Promise<WithdrawRecord | null> {
   218	    const h = await this.withdrawHistory(coin, sinceTs);
   219	    return h.find((w) => (ref.id && w.id === ref.id) || (ref.withdrawOrderId && w.withdrawOrderId === ref.withdrawOrderId)) ?? null;
   220	  }
   221	
   222	  /** `clientOrderId` makes the order findable even if this request times out. */
   223	  limitOrder(symbol: string, side: Side, quantity: string, price: string, clientOrderId?: string): Promise<{ orderId: string }> {
   224	    const p: Record<string, string> = { symbol, side, type: 'LIMIT', quantity, price };
   225	    if (clientOrderId) p.newClientOrderId = clientOrderId;
   226	    return this.request('POST', '/api/v3/order', p, true);
   227	  }
   228	
   229	  /** Look an order up by our own client id; null if MEXC has no such order. */
   230	  async getOrderByClientId(symbol: string, clientOrderId: string): Promise<Order | null> {
   231	    try {
   232	      return await this.request<Order>('GET', '/api/v3/order', { symbol, origClientOrderId: clientOrderId }, true);
   233	    } catch (e) {
   234	      // ONLY MEXC's documented -2011 "Unknown order sent" means "no such order". Any other error
   235	      // (e.g. 10232 "currency does not exist", rate limits, 5xx) is rethrown: never guess "not placed".
   236	      if (e instanceof MexcApiError && e.code === -2011) return null;
   237	      throw e;
   238	    }
   239	  }
   240	
   241	  /** MARKET SELL by base quantity (documented). For buys use an aggressive LIMIT instead. */
   242	  /** Fills of one order (GET /api/v3/myTrades): real price, quantity and the fee actually charged. */
   243	  myTrades(symbol: string, orderId: string): Promise<{ price: string; qty: string; quoteQty: string; commission: string; commissionAsset: string }[]> {
   244	    return this.request('GET', '/api/v3/myTrades', { symbol, orderId }, true);
   245	  }
   246	
   247	  /** Open orders of one symbol (GET /api/v3/openOrders). */
   248	  openOrders(symbol: string): Promise<(Order & { clientOrderId?: string })[]> {
   249	    return this.request('GET', '/api/v3/openOrders', { symbol }, true);
   250	  }
   251	
   252	  marketSell(symbol: string, quantity: string, clientOrderId?: string): Promise<{ orderId: string }> {
   253	    const p: Record<string, string> = { symbol, side: 'SELL', type: 'MARKET', quantity };
   254	    if (clientOrderId) p.newClientOrderId = clientOrderId;
   255	    return this.request('POST', '/api/v3/order', p, true);
   256	  }
   257	
   258	  getOrder(symbol: string, orderId: string): Promise<Order> {
   259	    return this.request('GET', '/api/v3/order', { symbol, orderId }, true);
   260	  }
   261	
   262	  cancelOrder(symbol: string, orderId: string): Promise<Order> {
   263	    return this.request('DELETE', '/api/v3/order', { symbol, orderId }, true);
   264	  }
   265	}
```

## `src/mexc/rules.ts`

```
     1	// MEXC symbol trading rules, taken from GET /api/v3/exchangeInfo, checked BEFORE either leg is sent.
     2	// Field meanings (verified against live exchangeInfo, e.g. ETHUSDT: baseAssetPrecision 5, baseSizePrecision "0.0001"):
     3	//   baseAssetPrecision   -> quantity decimals (step = 10^-n)
     4	//   baseSizePrecision    -> MINIMUM order quantity ("0" = none)
     5	//   quotePrecision       -> price decimals
     6	//   quoteAmountPrecision -> minimum order value in USDT
     7	//   maxQuoteAmount       -> maximum order value in USDT
     8	//   orderTypes           -> allowed types. The docs define IMMEDIATE_OR_CANCEL / FILL_OR_KILL as order types
     9	//                           (there is no timeInForce parameter), but no live symbol lists them, and some
    10	//                           have no MARKET. So closes use LIMIT + a confirmed cancel.
    11	//   tradeSideType        -> 1 all, 2 buy only, 3 sell only, 4 close only
    12	//   filters PERCENT_PRICE_BY_SIDE -> price band (live exchangeInfo only, not in the docs; 0.02 .. 0.5)
    13	import type { Side, SymbolInfo } from './rest.js';
    14	
    15	export interface SymbolRules {
    16	  qtyStep: number;
    17	  priceDecimals: number;
    18	  minQty: number;
    19	  minNotional: number;
    20	  maxNotional: number;
    21	  orderTypes: string[];
    22	  tradeSideType: number;
    23	  /** Per-symbol fees from exchangeInfo (most USDT pairs: taker 0.08%, some 0.20%, maker 0). */
    24	  takerFee?: number;
    25	  makerFee?: number;
    26	  minNotionalMarket?: number;
    27	  maxNotionalMarket?: number;
    28	  /**
    29	   * PERCENT_PRICE_BY_SIDE band (live exchangeInfo, not in the docs): a limit price more than this fraction
    30	   * away from the market is rejected. Most symbols 0.2, some only 0.02.
    31	   */
    32	  priceBand?: number;
    33	}
    34	
    35	/** How far through the book an aggressive close may go: 2%, but stay well inside the symbol's price band. */
    36	export function aggressiveOffset(r: SymbolRules): number {
    37	  return r.priceBand ? Math.min(0.02, r.priceBand * 0.5) : 0.02;
    38	}
    39	
    40	/** Taker fee to assume: the symbol's own fee, never below the configured override (MEXC_TAKER_FEE). */
    41	export function takerFeeFor(r: { takerFee?: number } | undefined, override: number): number {
    42	  return Math.max(override, r?.takerFee ?? 0);
    43	}
    44	
    45	/** Band used when exchangeInfo has no PERCENT_PRICE_BY_SIDE filter. */
    46	export const DEFAULT_BAND = 0.2;
    47	
    48	/**
    49	 * Aggressive close price: 2% through the book, clamped to 80% of the symbol's band around the reference
    50	 * (mid of a fresh book), rounded to the price step in the safe direction.
    51	 */
    52	export function closePrice(r: SymbolRules, side: Side, book: { bid: number; ask: number }): number {
    53	  const f = 10 ** r.priceDecimals;
    54	  const ref = (book.bid + book.ask) / 2;
    55	  const band = r.priceBand ?? DEFAULT_BAND;
    56	  // Small epsilon: 100.1 * 1.02 is 102.10199999... in floating point and must still round to 102.102.
    57	  if (side === 'BUY') return Math.floor(Math.min(book.ask * 1.02, ref * (1 + 0.8 * band)) * f + 1e-6) / f;
    58	  return Math.ceil(Math.max(book.bid * 0.98, ref * (1 - 0.8 * band)) * f - 1e-6) / f;
    59	}
    60	
    61	/** Is a limit price inside the symbol's band around the reference price? */
    62	export function bandProblem(r: SymbolRules, side: Side, price: number, ref: number): string | null {
    63	  const band = r.priceBand ?? DEFAULT_BAND;
    64	  if (side === 'BUY' && price > ref * (1 + band)) return `buy price ${price} above the ${band * 100}% band around ${ref}`;
    65	  if (side === 'SELL' && price < ref * (1 - band)) return `sell price ${price} below the ${band * 100}% band around ${ref}`;
    66	  return null;
    67	}
    68	
    69	export function rulesFrom(s: SymbolInfo): SymbolRules {
    70	  const qtyDecimals = s.baseAssetPrecision ?? Math.max(0, Math.round(-Math.log10(Number(s.baseSizePrecision) || 1)));
    71	  return {
    72	    qtyStep: 1 / 10 ** qtyDecimals, // exact (10 ** -5 is 0.000009999…)
    73	    priceDecimals: s.quotePrecision,
    74	    minQty: Number(s.baseSizePrecision) || 0,
    75	    minNotional: Number(s.quoteAmountPrecision) || 0,
    76	    maxNotional: Number(s.maxQuoteAmount) || Number.POSITIVE_INFINITY,
    77	    orderTypes: s.orderTypes ?? ['LIMIT'],
    78	    tradeSideType: Number(s.tradeSideType ?? 1),
    79	    takerFee: s.takerCommission !== undefined ? Number(s.takerCommission) : undefined,
    80	    makerFee: s.makerCommission !== undefined ? Number(s.makerCommission) : undefined,
    81	    minNotionalMarket: s.quoteAmountPrecisionMarket !== undefined ? Number(s.quoteAmountPrecisionMarket) : undefined,
    82	    maxNotionalMarket: s.maxQuoteAmountMarket !== undefined ? Number(s.maxQuoteAmountMarket) : undefined,
    83	    priceBand: band(s),
    84	  };
    85	}
    86	
    87	function band(s: SymbolInfo): number | undefined {
    88	  const f = s.filters?.find((x) => x.filterType === 'PERCENT_PRICE_BY_SIDE');
    89	  if (!f) return undefined;
    90	  const v = [Number(f.bidMultiplierUp), Number(f.askMultiplierDown)].filter((x) => Number.isFinite(x) && x > 0);
    91	  return v.length ? Math.min(...v) : undefined;
    92	}
    93	
    94	/** null = the order is allowed; otherwise why MEXC would reject it. */
    95	export function orderProblem(r: SymbolRules, side: Side, qty: number, price: number, type = 'LIMIT'): string | null {
    96	  if (!r.orderTypes.includes(type)) return `order type ${type} not allowed (${r.orderTypes.join(',')})`;
    97	  if (r.tradeSideType === 4) return 'symbol is close-only';
    98	  if (r.tradeSideType === 2 && side === 'SELL') return 'symbol is buy-only';
    99	  if (r.tradeSideType === 3 && side === 'BUY') return 'symbol is sell-only';
   100	  if (!(qty > 0)) return 'quantity is zero';
   101	  if (qty < r.minQty) return `quantity ${qty} < minimum ${r.minQty}`;
   102	  const notional = qty * price;
   103	  // MARKET orders have their own limits in exchangeInfo.
   104	  const min = type === 'MARKET' ? (r.minNotionalMarket ?? r.minNotional) : r.minNotional;
   105	  const max = type === 'MARKET' ? (r.maxNotionalMarket ?? r.maxNotional) : r.maxNotional;
   106	  if (notional < min) return `order value ${notional.toFixed(4)} < minimum ${min} USDT`;
   107	  if (notional > max) return `order value ${notional.toFixed(2)} > maximum ${max} USDT`;
   108	  return null;
   109	}
```

## `src/mexc/ws.ts`

```
     1	// MEXC public WebSocket: keeps a live top-20 order book per symbol.
     2	import WebSocket from 'ws';
     3	import { decodeDepthPush } from './proto.js';
     4	import type { Book } from './rest.js';
     5	import { log, errMsg } from '../log.js';
     6	
     7	const URL = 'wss://wbs-api.mexc.com/ws';
     8	const MAX_SUBS_PER_CONN = 30; // MEXC limit per connection
     9	
    10	export class MexcBookStream {
    11	  private books = new Map<string, Book>();
    12	  private sockets: WebSocket[] = [];
    13	  private stopped = false;
    14	
    15	  constructor(private symbols: string[]) {}
    16	
    17	  start(): void {
    18	    for (let i = 0; i < this.symbols.length; i += MAX_SUBS_PER_CONN) {
    19	      this.connect(this.symbols.slice(i, i + MAX_SUBS_PER_CONN), 0);
    20	    }
    21	  }
    22	
    23	  stop(): void {
    24	    this.stopped = true;
    25	    for (const s of this.sockets) s.terminate();
    26	  }
    27	
    28	  /** Latest book, or undefined if missing / older than maxAgeMs. */
    29	  get(symbol: string, maxAgeMs = 5000): Book | undefined {
    30	    const b = this.books.get(symbol);
    31	    return b && Date.now() - b.ts <= maxAgeMs ? b : undefined;
    32	  }
    33	
    34	  private connect(symbols: string[], attempt: number): void {
    35	    if (this.stopped) return;
    36	    const ws = new WebSocket(URL);
    37	    this.sockets.push(ws);
    38	    let ping: NodeJS.Timeout | undefined;
    39	    let lastData = Date.now();
    40	    // MEXC drops idle subscriptions; if no data arrives for 60s, reconnect.
    41	    const watchdog = setInterval(() => {
    42	      if (Date.now() - lastData > 60_000) {
    43	        log.warn(`MEXC WS: no data for 60s on ${symbols.length} symbols, reconnecting`);
    44	        ws.terminate();
    45	      }
    46	    }, 15_000);
    47	
    48	    ws.on('open', () => {
    49	      lastData = Date.now();
    50	      const params = symbols.map((s) => `spot@public.limit.depth.v3.api.pb@${s}@20`);
    51	      ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params }));
    52	      ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ method: 'PING' })), 20_000);
    53	      log.info(`MEXC WS subscribed: ${symbols.join(',')}`);
    54	    });
    55	
    56	    ws.on('message', (data: Buffer, isBinary: boolean) => {
    57	      if (!isBinary) {
    58	        const msg = data.toString();
    59	        if (msg.includes('Blocked') || msg.includes('Not Subscribed')) log.warn(`MEXC WS: ${msg}`);
    60	        return;
    61	      }
    62	      lastData = Date.now();
    63	      attempt = 0; // reset backoff only once data really flows (a bad subscription closes right after open)
    64	      try {
    65	        const push = decodeDepthPush(data);
    66	        // Sanity check: ignore empty or crossed books instead of trading on them.
    67	        if (push && push.symbol && push.bids.length && push.asks.length && push.bids[0][0] < push.asks[0][0]) {
    68	          this.books.set(push.symbol, { bids: push.bids, asks: push.asks, ts: Date.now() });
    69	        }
    70	      } catch (e) {
    71	        log.warn(`MEXC WS decode error: ${errMsg(e)}`);
    72	      }
    73	    });
    74	
    75	    const reconnect = () => {
    76	      if (ping) clearInterval(ping);
    77	      clearInterval(watchdog);
    78	      this.sockets = this.sockets.filter((s) => s !== ws);
    79	      if (this.stopped) return;
    80	      const delay = Math.min(30_000, 1000 * 2 ** attempt);
    81	      log.warn(`MEXC WS closed, reconnecting in ${delay}ms`);
    82	      setTimeout(() => this.connect(symbols, attempt + 1), delay);
    83	    };
    84	    ws.on('close', reconnect);
    85	    ws.on('error', (e) => {
    86	      log.warn(`MEXC WS error: ${errMsg(e)}`);
    87	      ws.terminate();
    88	    });
    89	  }
    90	}
```

## `src/dex/aggregator.ts`

```
     1	// DEX quotes from 0x (Swap API v2, AllowanceHolder), 1inch (Swap API v6) and KyberSwap (Aggregator API v1).
     2	// All route across many DEXs; DEX pool fees are already in the output amount.
     3	// BestOf queries several of them and uses the best quote after gas; Limited wraps each in a rate limiter.
     4	import { log, redact } from '../log.js';
     5	import { RateLimitError } from '../mexc/rest.js';
     6	
     7	export interface QuoteRequest {
     8	  sellToken: string;
     9	  buyToken: string;
    10	  sellAmount: bigint;
    11	  taker: string;
    12	  slippageBps: number;
    13	}
    14	export interface Quote {
    15	  buyAmount: bigint; // expected output
    16	  minBuyAmount: bigint; // output floor enforced on-chain
    17	  gas: bigint; // estimated gas units
    18	  spender: string; // address that needs an ERC20 allowance on sellToken
    19	  tx?: { to: string; data: string; value: bigint }; // only for firm quotes
    20	  /** Which aggregator produced it. */
    21	  source?: string;
    22	}
    23	
    24	/** Our own quote budget for this aggregator is used up: not an error, a "rate_limited" decision. */
    25	export class QuoteBudgetError extends Error {}
    26	
    27	export interface Aggregator {
    28	  name: string;
    29	  /** Indicative price, cheap; no transaction. */
    30	  price(req: QuoteRequest): Promise<Quote>;
    31	  /** Firm quote with calldata ready to sign. */
    32	  quote(req: QuoteRequest): Promise<Quote>;
    33	}
    34	
    35	type FetchFn = typeof fetch;
    36	
    37	// Allowlist: we only ever approve / send to these contracts. Each is the same address on Ethereum,
    38	// Base, BSC and Arbitrum. A wrong or compromised API response pointing anywhere else is rejected.
    39	export const ZEROX_ALLOWANCE_HOLDER = '0x0000000000001ff3684f28c67538d4d072c22734';
    40	export const ONEINCH_ROUTER_V6 = '0x111111125421ca6dc452d289314280a0f8842a65';
    41	// KyberSwap MetaAggregationRouterV2: docs.kyberswap.com/developer-guide/aggregator-api/contracts
    42	// ("deployed at the same address across all supported chains"); live /routes returned it on all four chains.
    43	export const KYBER_ROUTER_V2 = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
    44	
    45	function requireAddress(kind: string, got: string | undefined, allowed: string): string {
    46	  if (!got || got.toLowerCase() !== allowed) throw new Error(`${kind} ${got} is not the allowlisted contract ${allowed}`);
    47	  return allowed;
    48	}
    49	
    50	async function getJson<T>(fetchFn: FetchFn, url: string, headers: Record<string, string>, init: RequestInit = {}): Promise<T> {
    51	  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(8000), ...init });
    52	  const text = await res.text();
    53	  const msg = redact(`${new URL(url).host} ${res.status}: ${text.slice(0, 300)}`);
    54	  if (res.status === 429) throw new RateLimitError(msg, Number(res.headers.get('retry-after')) || 0);
    55	  if (!res.ok) throw new Error(msg);
    56	  return JSON.parse(text) as T;
    57	}
    58	
    59	/**
    60	 * 0x may charge a fee (0.15% on select pairs on the Standard plan). The docs do not settle whether
    61	 * buyAmount is already net of it, so it is treated as an extra cost: the conservative choice
    62	 * (worst case a few trades are skipped; never a loss counted as profit).
    63	 */
    64	export function applyZeroExFee(
    65	  q: { buyAmount: bigint; minBuyAmount: bigint },
    66	  fee: { amount: string; token: string } | null | undefined,
    67	  r: { sellToken: string; buyToken: string; sellAmount: bigint },
    68	): { buyAmount: bigint; minBuyAmount: bigint } {
    69	  if (!fee) return q;
    70	  const amount = BigInt(fee.amount);
    71	  const token = fee.token.toLowerCase();
    72	  if (token === r.buyToken.toLowerCase()) {
    73	    const sub = (x: bigint) => (x > amount ? x - amount : 0n);
    74	    return { buyAmount: sub(q.buyAmount), minBuyAmount: sub(q.minBuyAmount) };
    75	  }
    76	  if (token === r.sellToken.toLowerCase() && r.sellAmount > 0n) {
    77	    const scale = (x: bigint) => (x * (r.sellAmount - amount)) / r.sellAmount;
    78	    return { buyAmount: scale(q.buyAmount), minBuyAmount: scale(q.minBuyAmount) };
    79	  }
    80	  return q;
    81	}
    82	
    83	interface ZeroExResponse {
    84	  liquidityAvailable: boolean;
    85	  buyAmount: string;
    86	  minBuyAmount: string;
    87	  gas?: string | null;
    88	  allowanceTarget?: string | null;
    89	  fees?: { zeroExFee?: { amount: string; token: string } | null } | null;
    90	  issues?: { allowance?: { spender: string } | null; balance?: unknown; simulationIncomplete?: boolean };
    91	  transaction?: { to: string; data: string; gas: string; value: string };
    92	}
    93	
    94	export class ZeroEx implements Aggregator {
    95	  name = '0x';
    96	  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, private chainId = 1) {
    97	    if (!apiKey) throw new Error('ZEROX_API_KEY is required for DEX_AGGREGATOR=0x');
    98	  }
    99	
   100	  private url(kind: 'price' | 'quote', r: QuoteRequest): string {
   101	    const q = new URLSearchParams({
   102	      chainId: String(this.chainId),
   103	      sellToken: r.sellToken,
   104	      buyToken: r.buyToken,
   105	      sellAmount: r.sellAmount.toString(),
   106	      taker: r.taker,
   107	      slippagePpm: String(r.slippageBps * 100), // slippageBps is deprecated in v2
   108	    });
   109	    return `https://api.0x.org/swap/allowance-holder/${kind}?${q}`;
   110	  }
   111	
   112	  private async call(kind: 'price' | 'quote', r: QuoteRequest): Promise<Quote> {
   113	    const d = await getJson<ZeroExResponse>(this.fetchFn, this.url(kind, r), { '0x-api-key': this.apiKey, '0x-version': 'v2' });
   114	    if (!d.liquidityAvailable) throw new Error('0x: no liquidity');
   115	    if (kind === 'quote') {
   116	      // A firm quote we would actually send: refuse if 0x itself could not validate it.
   117	      if (d.issues?.balance) throw new Error('0x: taker balance too low for this quote');
   118	      if (d.issues?.simulationIncomplete) throw new Error('0x: simulation incomplete');
   119	      if (d.fees?.zeroExFee) log.info(`0x fee: ${d.fees.zeroExFee.amount} of ${d.fees.zeroExFee.token}`);
   120	    }
   121	    const gas = BigInt(d.transaction?.gas ?? d.gas ?? '300000');
   122	    // With the AllowanceHolder flow, both the spender and tx.to are the AllowanceHolder contract.
   123	    // Never transaction.to for allowances (0x docs): issues.allowance.spender or allowanceTarget, pinned.
   124	    const spender = requireAddress(
   125	      '0x spender',
   126	      d.issues?.allowance?.spender ?? d.allowanceTarget ?? ZEROX_ALLOWANCE_HOLDER,
   127	      ZEROX_ALLOWANCE_HOLDER,
   128	    );
   129	    if (d.transaction) requireAddress('0x tx.to', d.transaction.to, ZEROX_ALLOWANCE_HOLDER);
   130	    const net = applyZeroExFee({ buyAmount: BigInt(d.buyAmount), minBuyAmount: BigInt(d.minBuyAmount) }, d.fees?.zeroExFee, r);
   131	    return {
   132	      ...net,
   133	      source: '0x',
   134	      gas,
   135	      spender,
   136	      tx: d.transaction ? { to: d.transaction.to, data: d.transaction.data, value: BigInt(d.transaction.value || '0') } : undefined,
   137	    };
   138	  }
   139	
   140	  price(r: QuoteRequest) {
   141	    return this.call('price', r);
   142	  }
   143	  quote(r: QuoteRequest) {
   144	    return this.call('quote', r);
   145	  }
   146	}
   147	
   148	export class OneInch implements Aggregator {
   149	  name = '1inch';
   150	  private spender?: string;
   151	  private base: string;
   152	  constructor(private apiKey: string, private fetchFn: FetchFn = fetch, chainId = 1) {
   153	    if (!apiKey) throw new Error('ONEINCH_API_KEY is required for DEX_AGGREGATOR=1inch');
   154	    this.base = `https://api.1inch.dev/swap/v6.0/${chainId}`;
   155	  }
   156	  private get headers() {
   157	    return { Authorization: `Bearer ${this.apiKey}`, accept: 'application/json' };
   158	  }
   159	  private async getSpender(): Promise<string> {
   160	    if (!this.spender) {
   161	      const a = (await getJson<{ address: string }>(this.fetchFn, `${this.base}/approve/spender`, this.headers)).address;
   162	      this.spender = requireAddress('1inch spender', a, ONEINCH_ROUTER_V6);
   163	      setTimeout(() => (this.spender = undefined), 24 * 3600_000).unref?.(); // re-check daily
   164	    }
   165	    return this.spender;
   166	  }
   167	  private minOut(amount: bigint, bps: number) {
   168	    return (amount * BigInt(10_000 - bps)) / 10_000n;
   169	  }
   170	
   171	  async price(r: QuoteRequest): Promise<Quote> {
   172	    const q = new URLSearchParams({ src: r.sellToken, dst: r.buyToken, amount: r.sellAmount.toString(), includeGas: 'true' });
   173	    const d = await getJson<{ dstAmount: string; gas?: number }>(this.fetchFn, `${this.base}/quote?${q}`, this.headers);
   174	    const buy = BigInt(d.dstAmount);
   175	    return { buyAmount: buy, minBuyAmount: this.minOut(buy, r.slippageBps), gas: BigInt(d.gas ?? 300_000), spender: await this.getSpender() };
   176	  }
   177	
   178	  async quote(r: QuoteRequest): Promise<Quote> {
   179	    const q = new URLSearchParams({
   180	      src: r.sellToken,
   181	      dst: r.buyToken,
   182	      amount: r.sellAmount.toString(),
   183	      from: r.taker,
   184	      origin: r.taker,
   185	      slippage: String(r.slippageBps / 100), // percent
   186	      disableEstimate: 'true', // we simulate ourselves with eth_call
   187	      includeGas: 'true',
   188	    });
   189	    const d = await getJson<{ dstAmount: string; tx: { to: string; data: string; value: string; gas: number } }>(
   190	      this.fetchFn,
   191	      `${this.base}/swap?${q}`,
   192	      this.headers,
   193	    );
   194	    const buy = BigInt(d.dstAmount);
   195	    requireAddress('1inch tx.to', d.tx.to, ONEINCH_ROUTER_V6);
   196	    return {
   197	      buyAmount: buy,
   198	      minBuyAmount: this.minOut(buy, r.slippageBps),
   199	      gas: BigInt(d.tx.gas || 300_000),
   200	      spender: await this.getSpender(),
   201	      tx: { to: d.tx.to, data: d.tx.data, value: BigInt(d.tx.value || '0') },
   202	    };
   203	  }
   204	}
   205	
   206	interface KyberRoutes {
   207	  code: number;
   208	  message?: string;
   209	  data?: { routeSummary: { amountOut: string; gas: string } & Record<string, unknown>; routerAddress: string };
   210	}
   211	interface KyberBuild {
   212	  code: number;
   213	  message?: string;
   214	  data?: { amountOut: string; gas: string; data: string; routerAddress: string; transactionValue: string };
   215	}
   216	
   217	/**
   218	 * KyberSwap Aggregator API v1 (docs.kyberswap.com, evm-swaps): GET /{chain}/api/v1/routes, then
   219	 * POST /{chain}/api/v1/route/build. slippageTolerance is in bps. No API key; x-client-id identifies us.
   220	 */
   221	export class Kyber implements Aggregator {
   222	  name = 'kyber';
   223	  private base: string;
   224	  constructor(
   225	    chain: string,
   226	    private clientId = 'mexc-dex-arb',
   227	    private fetchFn: FetchFn = fetch,
   228	  ) {
   229	    this.base = `https://aggregator-api.kyberswap.com/${chain}/api/v1`;
   230	  }
   231	  private get headers() {
   232	    return { 'x-client-id': this.clientId, accept: 'application/json' };
   233	  }
   234	  private minOut(amount: bigint, bps: number) {
   235	    return (amount * BigInt(10_000 - bps)) / 10_000n;
   236	  }
   237	  private async routes(r: QuoteRequest) {
   238	    const q = new URLSearchParams({ tokenIn: r.sellToken, tokenOut: r.buyToken, amountIn: r.sellAmount.toString() });
   239	    const d = await getJson<KyberRoutes>(this.fetchFn, `${this.base}/routes?${q}`, this.headers);
   240	    if (d.code !== 0 || !d.data) throw new Error(`kyber routes: ${d.code} ${d.message ?? ''}`);
   241	    requireAddress('kyber router', d.data.routerAddress, KYBER_ROUTER_V2);
   242	    return d.data;
   243	  }
   244	
   245	  async price(r: QuoteRequest): Promise<Quote> {
   246	    const d = await this.routes(r);
   247	    const buy = BigInt(d.routeSummary.amountOut);
   248	    return { buyAmount: buy, minBuyAmount: this.minOut(buy, r.slippageBps), gas: BigInt(d.routeSummary.gas || '300000'), spender: KYBER_ROUTER_V2, source: 'kyber' };
   249	  }
   250	
   251	  async quote(r: QuoteRequest): Promise<Quote> {
   252	    const d = await this.routes(r);
   253	    const body = {
   254	      routeSummary: d.routeSummary,
   255	      sender: r.taker,
   256	      recipient: r.taker, // output always to our own wallet
   257	      slippageTolerance: r.slippageBps,
   258	      deadline: Math.floor(Date.now() / 1000) + 120,
   259	    };
   260	    const b = await getJson<KyberBuild>(this.fetchFn, `${this.base}/route/build`, { ...this.headers, 'content-type': 'application/json' }, {
   261	      method: 'POST',
   262	      body: JSON.stringify(body),
   263	    });
   264	    if (b.code !== 0 || !b.data) throw new Error(`kyber build: ${b.code} ${b.message ?? ''}`);
   265	    const to = requireAddress('kyber tx.to', b.data.routerAddress, KYBER_ROUTER_V2);
   266	    const buy = BigInt(b.data.amountOut);
   267	    return {
   268	      buyAmount: buy,
   269	      minBuyAmount: this.minOut(buy, r.slippageBps),
   270	      gas: BigInt(b.data.gas || d.routeSummary.gas || '300000'),
   271	      spender: KYBER_ROUTER_V2,
   272	      source: 'kyber',
   273	      tx: { to, data: b.data.data, value: BigInt(b.data.transactionValue || '0') },
   274	    };
   275	  }
   276	}
   277	
   278	/** Token bucket: `rps` calls per second on average, bursts up to `rps`. */
   279	export class TokenBucket {
   280	  private tokens: number;
   281	  private last: number;
   282	  blockedUntil = 0;
   283	  constructor(
   284	    private rps: number,
   285	    private now: () => number = Date.now,
   286	  ) {
   287	    this.tokens = rps;
   288	    this.last = now();
   289	  }
   290	  take(): boolean {
   291	    const t = this.now();
   292	    if (t < this.blockedUntil) return false;
   293	    this.tokens = Math.min(this.rps, this.tokens + ((t - this.last) / 1000) * this.rps);
   294	    this.last = t;
   295	    if (this.tokens < 1) return false;
   296	    this.tokens -= 1;
   297	    return true;
   298	  }
   299	  /** After a 429: no calls for Retry-After seconds (at least 1 s). */
   300	  block(seconds: number) {
   301	    this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.max(1, seconds) * 1000);
   302	  }
   303	}
   304	
   305	/** Wraps an aggregator in its own quote budget; honours 429 / Retry-After. */
   306	export class Limited implements Aggregator {
   307	  readonly name: string;
   308	  constructor(
   309	    private inner: Aggregator,
   310	    readonly bucket: TokenBucket,
   311	  ) {
   312	    this.name = inner.name;
   313	  }
   314	  private async run(fn: () => Promise<Quote>): Promise<Quote> {
   315	    if (!this.bucket.take()) throw new QuoteBudgetError(`${this.name}: quote budget used up`);
   316	    try {
   317	      return await fn();
   318	    } catch (e) {
   319	      if (e instanceof RateLimitError) this.bucket.block(e.retryAfterSec || 5);
   320	      throw e;
   321	    }
   322	  }
   323	  price(r: QuoteRequest) {
   324	    return this.run(() => this.inner.price(r));
   325	  }
   326	  quote(r: QuoteRequest) {
   327	    return this.run(() => this.inner.quote(r));
   328	  }
   329	}
   330	
   331	/**
   332	 * Asks every aggregator and returns the best quote AFTER gas: output minus the gas cost converted into the
   333	 * output token (set by the engine each tick through `gasInOutput`). Without it, the highest output wins.
   334	 */
   335	export class BestOf implements Aggregator {
   336	  readonly name: string;
   337	  gasInOutput?: (gasUnits: bigint, buyToken: string) => bigint;
   338	  constructor(private aggs: Aggregator[]) {
   339	    this.name = aggs.map((a) => a.name).join('+');
   340	  }
   341	  private score(q: Quote, r: QuoteRequest) {
   342	    return q.buyAmount - (this.gasInOutput?.(q.gas, r.buyToken) ?? 0n);
   343	  }
   344	  private async best(r: QuoteRequest, kind: 'price' | 'quote'): Promise<Quote> {
   345	    const res = await Promise.allSettled(this.aggs.map((a) => a[kind](r)));
   346	    const ok = res.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
   347	    if (!ok.length) {
   348	      const errs = res.map((x) => (x as PromiseRejectedResult).reason);
   349	      throw errs.every((e) => e instanceof QuoteBudgetError || e instanceof RateLimitError) ? new QuoteBudgetError('all aggregators rate limited') : errs[0];
   350	    }
   351	    return ok.reduce((a, b) => (this.score(b, r) > this.score(a, r) ? b : a));
   352	  }
   353	  price(r: QuoteRequest) {
   354	    return this.best(r, 'price');
   355	  }
   356	  quote(r: QuoteRequest) {
   357	    return this.best(r, 'quote');
   358	  }
   359	}
```

## `src/dex/chain.ts`

```
     1	// Ethereum side: balances, gas, exact approvals, simulation and private sending.
     2	import { ethers } from 'ethers';
     3	import { log, errMsg } from '../log.js';
     4	import { sleep } from '../util.js';
     5	
     6	const ERC20_ABI = [
     7	  'function decimals() view returns (uint8)',
     8	  'function symbol() view returns (string)',
     9	  'function balanceOf(address) view returns (uint256)',
    10	  'function allowance(address,address) view returns (uint256)',
    11	  'function approve(address,uint256) returns (bool)',
    12	];
    13	const APPROVE_GAS = 60_000n;
    14	
    15	/** MaxUint256: the unlimited-approval amount. Only used when UNLIMITED_APPROVAL=yes. */
    16	export const MAX_UINT256 = (1n << 256n) - 1n;
    17	
    18	/**
    19	 * Amount actually approved: the exact amount, or MaxUint256 when unlimited approval is on.
    20	 * Unlimited skips the approve tx on every later sale of the same token (allowance stays huge),
    21	 * saving ~12s per sale — but a compromised spender could then drain the whole token balance.
    22	 * Owner decision 2026-11-21: unlimited ON for the live twin only (default off everywhere else).
    23	 */
    24	export function approvalAmount(unlimited: boolean, amount: bigint): bigint {
    25	  return unlimited ? MAX_UINT256 : amount;
    26	}
    27	
    28	export type { GasInfo, TxResult } from './txsender.js';
    29	import { type GasInfo, type KeyValue, type TxResult, TxSender } from './txsender.js';
    30	
    31	/** Median of recent per-block p50 tips, capped; at least 0.001 gwei so a builder still includes the tx. */
    32	export function pickTip(rewards: bigint[], cap: bigint): bigint {
    33	  const floor = 1_000_000n; // 0.001 gwei
    34	  if (!rewards.length) return cap;
    35	  const sorted = [...rewards].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    36	  const median = sorted[Math.floor(sorted.length / 2)];
    37	  const t = median < floor ? floor : median;
    38	  return t > cap ? cap : t;
    39	}
    40	
    41	export class Chain {
    42	  readonly provider: ethers.JsonRpcProvider;
    43	  readonly sendProvider: ethers.JsonRpcProvider;
    44	  readonly wallet?: ethers.Wallet;
    45	  private decimalsCache = new Map<string, number>();
    46	
    47	  readonly tx: TxSender;
    48	
    49	  /** `unresolvedStore` persists the unresolved-tx record (SQLite state) so a restart does not forget it. */
    50	  constructor(
    51	    rpcUrl: string,
    52	    sendRpcUrl: string,
    53	    privateKey: string,
    54	    private priorityFeeGwei: number,
    55	    unresolvedStore?: KeyValue,
    56	    readonly chainId = 1,
    57	    readonly unlimitedApproval = false,
    58	  ) {
    59	    this.provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    60	    this.sendProvider = new ethers.JsonRpcProvider(sendRpcUrl, chainId, { staticNetwork: true });
    61	    if (privateKey) this.wallet = new ethers.Wallet(privateKey, this.provider);
    62	    const chain = this; // eslint-disable-line @typescript-eslint/no-this-alias
    63	    this.tx = new TxSender(
    64	      {
    65	        get address() {
    66	          return chain.address;
    67	        },
    68	        confirmedNonce: () => this.provider.getTransactionCount(this.address, 'latest'),
    69	        receipt: (h) => this.provider.getTransactionReceipt(h),
    70	        // Raw receipt for the OP-stack L1 fee (ethers' receipt type has no l1Fee field).
    71	        rawReceipt: async (h) => {
    72	          const raw = (await this.provider.send('eth_getTransactionReceipt', [h]).catch(() => null)) as { l1Fee?: string } | null;
    73	          return raw?.l1Fee ? { l1Fee: BigInt(raw.l1Fee) } : null;
    74	        },
    75	        knowsTx: async (h) => Boolean((await this.provider.getTransaction(h).catch(() => null)) ?? (await this.sendProvider.getTransaction(h).catch(() => null))),
    76	        sign: async (t) => {
    77	          const raw = await this.wallet!.signTransaction({ chainId: BigInt(chainId), type: 2, ...t });
    78	          return { raw, hash: ethers.keccak256(raw) };
    79	        },
    80	        broadcast: async (raw) => {
    81	          await this.sendProvider.send('eth_sendRawTransaction', [raw]);
    82	        },
    83	        broadcastPublic: async (raw) => {
    84	          await this.provider.send('eth_sendRawTransaction', [raw]);
    85	        },
    86	        gas: () => this.gas(),
    87	      },
    88	      unresolvedStore,
    89	    );
    90	  }
    91	
    92	  get unresolved() {
    93	    return this.tx.unresolved;
    94	  }
    95	  checkUnresolved() {
    96	    return this.tx.checkUnresolved();
    97	  }
    98	  receipt(hash: string) {
    99	    return this.provider.getTransactionReceipt(hash);
   100	  }
   101	  readyToSend() {
   102	    return this.tx.readyToSend();
   103	  }
   104	  cancelNonce() {
   105	    return this.tx.cancelNonce();
   106	  }
   107	  resetNonce() {
   108	    this.tx.resetNonce();
   109	  }
   110	  send(
   111	    tx: { to: string; data: string; value?: bigint },
   112	    gasLimit: bigint,
   113	    gas: GasInfo,
   114	    timeoutSec: number,
   115	    onSigned?: (hash: string, nonce: number) => void,
   116	  ): Promise<TxResult> {
   117	    return this.tx.send(tx, gasLimit, gas, timeoutSec, onSigned);
   118	  }
   119	
   120	  get address(): string {
   121	    if (!this.wallet) throw new Error('PRIVATE_KEY not set');
   122	    return this.wallet.address;
   123	  }
   124	
   125	  erc20(token: string) {
   126	    return new ethers.Contract(token, ERC20_ABI, this.wallet ?? this.provider);
   127	  }
   128	
   129	  async decimals(token: string): Promise<number> {
   130	    const key = token.toLowerCase();
   131	    if (!this.decimalsCache.has(key)) this.decimalsCache.set(key, Number(await this.erc20(token).decimals()));
   132	    return this.decimalsCache.get(key)!;
   133	  }
   134	
   135	  async tokenBalance(token: string, owner = this.address): Promise<bigint> {
   136	    return this.erc20(token).balanceOf(owner);
   137	  }
   138	
   139	  async ethBalance(owner = this.address): Promise<bigint> {
   140	    return this.provider.getBalance(owner);
   141	  }
   142	
   143	  async gas(): Promise<GasInfo> {
   144	    const block = await this.provider.getBlock('latest');
   145	    const baseFee = block?.baseFeePerGas ?? 0n;
   146	    const cap = ethers.parseUnits(String(this.priorityFeeGwei), 'gwei');
   147	    // Tip = median (p50) of the last 20 blocks' tips, capped by PRIORITY_FEE_GWEI. A fixed 1 gwei was
   148	    // 2-7x the whole base fee on mainnet (base fee ~0.15 gwei), i.e. most of the gas cost.
   149	    let tip = cap;
   150	    try {
   151	      const h = (await this.provider.send('eth_feeHistory', ['0x14', 'latest', [50]])) as { reward?: string[][] };
   152	      tip = pickTip((h.reward ?? []).map((r) => BigInt(r[0])), cap);
   153	    } catch {
   154	      // keep the cap
   155	    }
   156	    return { baseFee, tip, effective: baseFee + tip, maxFee: baseFee * 2n + tip };
   157	  }
   158	
   159	  /** Gas units needed for an approval before the swap (0 if allowance already covers it). */
   160	  async approvalGasNeeded(token: string, spender: string, amount: bigint): Promise<bigint> {
   161	    if (!this.wallet) return 0n;
   162	    const allowance: bigint = await this.erc20(token).allowance(this.address, spender);
   163	    if (allowance >= amount) return 0n;
   164	    return allowance > 0n ? APPROVE_GAS * 2n : APPROVE_GAS; // USDT-style tokens need approve(0) first
   165	  }
   166	
   167	  /** Approve the sell amount (exact by default; MaxUint256 when UNLIMITED_APPROVAL=yes). Sent through the private RPC. */
   168	  async approveExact(token: string, spender: string, amount: bigint, gas: GasInfo): Promise<TxResult> {
   169	    const c = this.erc20(token);
   170	    let cost = 0n;
   171	    const current: bigint = await c.allowance(this.address, spender);
   172	    if (current >= amount) return { ok: true, gasCostWei: 0n };
   173	    if (current > 0n) {
   174	      const data0 = c.interface.encodeFunctionData('approve', [spender, 0n]);
   175	      const r = await this.send({ to: token, data: data0 }, await this.approveGasLimit(token, data0), gas, 60);
   176	      cost += r.gasCostWei;
   177	      if (!r.ok) return { ...r, gasCostWei: cost };
   178	    }
   179	    const target = approvalAmount(this.unlimitedApproval, amount);
   180	    const data = c.interface.encodeFunctionData('approve', [spender, target]);
   181	    const r = await this.send({ to: token, data }, await this.approveGasLimit(token, data), gas, 60);
   182	    return { ...r, gasCostWei: cost + r.gasCostWei };
   183	  }
   184	
   185	  /** Some tokens need more than 60k gas for approve: estimate, +30%, never below 60k. */
   186	  private async approveGasLimit(token: string, data: string): Promise<bigint> {
   187	    try {
   188	      const est = await this.provider.estimateGas({ from: this.address, to: token, data });
   189	      const limit = (est * 13n) / 10n;
   190	      return limit > APPROVE_GAS ? limit : APPROVE_GAS;
   191	    } catch {
   192	      return APPROVE_GAS * 2n;
   193	    }
   194	  }
   195	
   196	  /** eth_call + estimateGas. Returns the gas estimate, or throws with the revert reason. */
   197	  async simulate(tx: { to: string; data: string; value: bigint }): Promise<bigint> {
   198	    const req = { from: this.address, to: tx.to, data: tx.data, value: tx.value };
   199	    await this.provider.call(req);
   200	    return this.provider.estimateGas(req);
   201	  }
   202	}
```

## `src/dex/txsender.ts`

```
     1	// Transaction sending with a local nonce manager and persisted "unresolved" state.
     2	//
     3	// Our txs go through a PRIVATE RPC, so the public RPC's 'pending' count does not see them.
     4	// Rules:
     5	//  - Nonces are tracked locally, starting from the confirmed ('latest') count.
     6	//  - A tx whose outcome we do not know (broadcast error that may still have been accepted, or not mined
     7	//    and its cancel not mined either) is "unresolved". While one exists, no new tx is sent, so a nonce is
     8	//    never reused by accident. The unresolved record is PERSISTED, so a restart does not forget it.
     9	//  - A clear RPC rejection (insufficient funds, nonce too low, underpriced, any JSON-RPC error answer)
    10	//    is NOT unresolved: nothing was broadcast, the nonce is rolled back.
    11	//  - An unresolved tx that no RPC knows any more after DROP_AFTER_MS is treated as dropped.
    12	import { errMsg, log } from '../log.js';
    13	
    14	export interface GasInfo {
    15	  baseFee: bigint;
    16	  tip: bigint;
    17	  /** What we expect to actually pay per gas (baseFee + tip). */
    18	  effective: bigint;
    19	  /** maxFeePerGas to set on the tx (headroom for base fee rises). */
    20	  maxFee: bigint;
    21	}
    22	
    23	export interface TxResult {
    24	  ok: boolean;
    25	  hash?: string;
    26	  gasCostWei: bigint;
    27	  reason?: string;
    28	  /** We do NOT know whether it executed: never unwind or retry; pause for a human. */
    29	  unknown?: boolean;
    30	  /** The RPC clearly refused it: nothing was broadcast, nothing to wait for. */
    31	  rejected?: boolean;
    32	  /** Not even attempted, because an earlier tx is still unresolved. Not a failed attempt. */
    33	  refused?: boolean;
    34	  gasUsed?: bigint;
    35	  gasPrice?: bigint;
    36	  /** ms from signing to the receipt (inclusion latency). */
    37	  inclusionMs?: number;
    38	  /** OP-stack L1 data fee (wei), when the raw receipt carries one (Base/Optimism). */
    39	  l1FeeWei?: bigint;
    40	}
    41	
    42	export interface Unresolved {
    43	  nonce: number;
    44	  hashes: string[];
    45	  since: number;
    46	  /** Highest maxFeePerGas / tip used at this nonce (a replacement must outbid them). */
    47	  maxFee?: string;
    48	  tip?: string;
    49	  /** false while we are still waiting normally (in flight); true once the outcome is unknown. */
    50	  unknown?: boolean;
    51	}
    52	
    53	export interface TxBackend {
    54	  address: string;
    55	  confirmedNonce(): Promise<number>;
    56	  receipt(hash: string): Promise<{ status: number | null; gasUsed: bigint; gasPrice: bigint } | null>;
    57	  /** Optional raw receipt (ethers does not expose the OP-stack L1 fee): only l1Fee is read. */
    58	  rawReceipt?(hash: string): Promise<{ l1Fee?: bigint } | null>;
    59	  /** true if the public or the private RPC still knows this tx (pending or mined). */
    60	  knowsTx(hash: string): Promise<boolean>;
    61	  sign(tx: { nonce: number; to: string; data: string; value: bigint; gasLimit: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }): Promise<{ raw: string; hash: string }>;
    62	  broadcast(raw: string): Promise<void>;
    63	  /** Optional second route (public RPC) for /cancelnonce. */
    64	  broadcastPublic?(raw: string): Promise<void>;
    65	  gas(): Promise<GasInfo>;
    66	}
    67	
    68	export interface KeyValue {
    69	  get(): string | undefined;
    70	  set(v: string | null): void;
    71	}
    72	
    73	export const DROP_AFTER_MS = 10 * 60_000;
    74	
    75	/** What a broadcast error means. */
    76	export function classifySendError(e: unknown): 'accepted' | 'rejected' | 'ambiguous' {
    77	  const o = (e ?? {}) as { code?: unknown; error?: { code?: unknown }; info?: { error?: { code?: unknown } } };
    78	  const msg = errMsg(e);
    79	  if (/already known|known transaction|already imported|already in mempool/i.test(msg)) return 'accepted';
    80	  if (['INSUFFICIENT_FUNDS', 'NONCE_EXPIRED', 'REPLACEMENT_UNDERPRICED'].includes(String(o.code))) return 'rejected';
    81	  if (/nonce too low|insufficient funds|underpriced|intrinsic gas too low|exceeds block gas limit|invalid sender|max fee per gas less than/i.test(msg)) {
    82	    return 'rejected';
    83	  }
    84	  // The server answered with a JSON-RPC error object: it explicitly refused the tx.
    85	  if (typeof o.error?.code === 'number' || typeof o.info?.error?.code === 'number') return 'rejected';
    86	  return 'ambiguous'; // timeout, connection reset, 5xx, no answer: it may have been accepted
    87	}
    88	
    89	export class TxSender {
    90	  private nextNonce: number | null = null;
    91	
    92	  constructor(
    93	    private b: TxBackend,
    94	    private store?: KeyValue,
    95	    private now: () => number = Date.now,
    96	    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    97	  ) {}
    98	
    99	  get unresolved(): Unresolved | null {
   100	    const v = this.store?.get() ?? this.mem;
   101	    return v ? (JSON.parse(v) as Unresolved) : null;
   102	  }
   103	  private mem: string | undefined;
   104	  private setUnresolved(u: Unresolved | null) {
   105	    const v = u ? JSON.stringify(u) : null;
   106	    if (this.store) this.store.set(v);
   107	    else this.mem = v ?? undefined;
   108	  }
   109	
   110	  private async takeNonce(): Promise<number> {
   111	    const confirmed = await this.b.confirmedNonce();
   112	    if (this.nextNonce === null || this.nextNonce < confirmed) this.nextNonce = confirmed;
   113	    return this.nextNonce;
   114	  }
   115	
   116	  /**
   117	   * Re-check an unresolved tx. 'clear' once its nonce is consumed on-chain (by it or its cancel),
   118	   * or once no RPC knows it any more after DROP_AFTER_MS (`dropped`). 'pending' otherwise.
   119	   */
   120	  async checkUnresolved(): Promise<{ state: 'clear' | 'pending'; executedHash?: string; ok?: boolean; dropped?: boolean }> {
   121	    const u = this.unresolved;
   122	    if (!u) return { state: 'clear' };
   123	    for (const h of u.hashes) {
   124	      const r = await this.b.receipt(h).catch(() => null);
   125	      if (r) {
   126	        this.setUnresolved(null);
   127	        this.nextNonce = Math.max(this.nextNonce ?? 0, u.nonce + 1);
   128	        return { state: 'clear', executedHash: h, ok: r.status === 1 };
   129	      }
   130	    }
   131	    const confirmed = await this.b.confirmedNonce().catch(() => -1);
   132	    if (confirmed > u.nonce) {
   133	      // Nonce consumed by something we have no receipt for yet (RPC lag).
   134	      this.setUnresolved(null);
   135	      this.nextNonce = Math.max(this.nextNonce ?? 0, confirmed);
   136	      return { state: 'clear' };
   137	    }
   138	    if (this.now() - u.since > DROP_AFTER_MS) {
   139	      const known = await Promise.all(u.hashes.map((h) => this.b.knowsTx(h).catch(() => true)));
   140	      if (!known.some(Boolean)) {
   141	        // Never accepted or dropped by every mempool: the nonce is free again.
   142	        this.setUnresolved(null);
   143	        this.nextNonce = null;
   144	        return { state: 'clear', dropped: true };
   145	      }
   146	    }
   147	    return { state: 'pending' };
   148	  }
   149	
   150	  /** Re-read the nonce from the chain on the next send (after /start confirm). */
   151	  resetNonce(): void {
   152	    this.nextNonce = null;
   153	  }
   154	
   155	  /**
   156	   * Safe to send now? Only if nothing is unresolved AND our next nonce is exactly the chain's next nonce
   157	   * (a gap would make the tx unminable, so the MEXC leg must not fire).
   158	   */
   159	  async readyToSend(): Promise<{ ok: boolean; reason?: string }> {
   160	    if (this.unresolved && (await this.checkUnresolved()).state === 'pending') {
   161	      const u = this.unresolved!;
   162	      return { ok: false, reason: `tx at nonce ${u.nonce} unresolved (${u.hashes.join(', ')})` };
   163	    }
   164	    const latest = await this.b.confirmedNonce();
   165	    if (this.nextNonce !== null && this.nextNonce !== latest) {
   166	      log.warn(`nonce gap: local ${this.nextNonce}, chain ${latest}; resetting to the chain value`);
   167	      this.nextNonce = latest;
   168	    }
   169	    return { ok: true };
   170	  }
   171	
   172	  /**
   173	   * /cancelnonce: replace the unresolved tx with a 0-value self-transfer at the same nonce, at least 2x the
   174	   * highest fee used so far, through the private AND the public RPC. Waits up to `timeoutMs` for the nonce to be used.
   175	   */
   176	  async cancelNonce(timeoutMs = 10 * 60_000): Promise<string> {
   177	    const u = this.unresolved;
   178	    if (!u) return 'Nothing unresolved.';
   179	    const g = await this.b.gas();
   180	    const twice = (x: bigint | undefined) => (x ?? 0n) * 2n;
   181	    const max = (...xs: bigint[]) => xs.reduce((a, c) => (c > a ? c : a));
   182	    const maxFee = max(twice(u.maxFee ? BigInt(u.maxFee) : undefined), g.maxFee * 2n);
   183	    const tip = max(twice(u.tip ? BigInt(u.tip) : undefined), g.tip * 2n);
   184	    const c = await this.b.sign({ nonce: u.nonce, to: this.b.address, data: '0x', value: 0n, gasLimit: 21_000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
   185	    this.setUnresolved({ ...u, hashes: [...u.hashes, c.hash], maxFee: maxFee.toString(), tip: tip.toString() });
   186	    await Promise.allSettled([this.b.broadcast(c.raw), this.b.broadcastPublic?.(c.raw)]);
   187	    const deadline = this.now() + timeoutMs;
   188	    while (this.now() < deadline) {
   189	      const r = await this.checkUnresolved();
   190	      if (r.state === 'clear') {
   191	        if (r.executedHash) return `Nonce ${u.nonce} used by ${r.executedHash} (${r.executedHash === c.hash ? 'the cancel' : 'an earlier tx'}, ${r.ok ? 'success' : 'reverted'}).`;
   192	        return `Nonce ${u.nonce} is used${r.dropped ? ' (all txs were dropped)' : ''}, but no receipt was found for our hashes: check etherscan.`;
   193	      }
   194	      await this.sleep(5000);
   195	    }
   196	    return `Nonce ${u.nonce} still not used after ${Math.round(timeoutMs / 60_000)} min (cancel ${c.hash}). Try /cancelnonce again later.`;
   197	  }
   198	
   199	  async send(
   200	    tx: { to: string; data: string; value?: bigint },
   201	    gasLimit: bigint,
   202	    gas: GasInfo,
   203	    timeoutSec: number,
   204	    onSigned?: (hash: string, nonce: number) => void,
   205	  ): Promise<TxResult> {
   206	    if (this.unresolved && (await this.checkUnresolved()).state === 'pending') {
   207	      return { ok: false, refused: true, gasCostWei: 0n, reason: `earlier tx ${this.unresolved!.hashes[0]} still unresolved` };
   208	    }
   209	    const nonce = await this.takeNonce();
   210	    const { raw, hash } = await this.b.sign({
   211	      nonce, to: tx.to, data: tx.data, value: tx.value ?? 0n, gasLimit, maxFeePerGas: gas.maxFee, maxPriorityFeePerGas: gas.tip,
   212	    });
   213	    this.nextNonce = nonce + 1;
   214	    this.signedAt = this.now();
   215	    onSigned?.(hash, nonce); // persisted before broadcast, so a crash cannot lose the hash
   216	    // In flight from now on, and PERSISTED: if the bot dies while waiting, a restart still knows this nonce is taken.
   217	    const fees = { maxFee: gas.maxFee.toString(), tip: gas.tip.toString() };
   218	    this.setUnresolved({ nonce, hashes: [hash], since: this.now(), ...fees, unknown: false });
   219	    try {
   220	      await this.b.broadcast(raw);
   221	    } catch (e) {
   222	      const kind = classifySendError(e);
   223	      if (kind === 'rejected') {
   224	        this.nextNonce = nonce; // nothing was broadcast: reuse the nonce
   225	        this.setUnresolved(null);
   226	        return { ok: false, rejected: true, hash, gasCostWei: 0n, reason: `RPC rejected the tx: ${errMsg(e)}` };
   227	      }
   228	      if (kind === 'ambiguous') {
   229	        this.setUnresolved({ nonce, hashes: [hash], since: this.now(), ...fees, unknown: true });
   230	        return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `send error, outcome unknown: ${errMsg(e)}` };
   231	      }
   232	      // 'accepted': already in the mempool, just wait for it below.
   233	    }
   234	    log.info(`tx sent ${hash} (nonce ${nonce})`);
   235	
   236	    let receipt = await this.waitReceipt(hash, timeoutSec);
   237	    if (receipt) {
   238	      this.setUnresolved(null);
   239	      return this.result(hash, receipt);
   240	    }
   241	
   242	    log.warn(`tx ${hash} not mined in ${timeoutSec}s, sending cancel`);
   243	    // Re-read gas: if the base fee spiked while we waited, a cancel priced from the old fee would not mine either.
   244	    const fresh = await this.b.gas().catch(() => gas);
   245	    const bump = (x: bigint) => (x * 13n) / 10n; // +30% to replace
   246	    const maxFee = [bump(gas.maxFee), bump(fresh.maxFee)].reduce((a, c) => (c > a ? c : a));
   247	    const tip = [bump(gas.tip), bump(fresh.tip)].reduce((a, c) => (c > a ? c : a));
   248	    const cancel = await this.b.sign({ nonce, to: this.b.address, data: '0x', value: 0n, gasLimit: 21_000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
   249	    this.setUnresolved({ nonce, hashes: [hash, cancel.hash], since: this.now(), maxFee: maxFee.toString(), tip: tip.toString(), unknown: false }); // before broadcasting the cancel
   250	    await this.b.broadcast(cancel.raw).catch((e) => log.warn(`cancel send failed: ${errMsg(e)}`));
   251	    const deadline = this.now() + timeoutSec * 1000;
   252	    while (this.now() < deadline) {
   253	      receipt = await this.b.receipt(hash).catch(() => null);
   254	      if (receipt) {
   255	        this.setUnresolved(null);
   256	        return this.result(hash, receipt);
   257	      }
   258	      const c = await this.b.receipt(cancel.hash).catch(() => null);
   259	      if (c) {
   260	        this.setUnresolved(null);
   261	        return { ok: false, hash, gasCostWei: c.gasUsed * c.gasPrice, reason: 'not mined, cancelled' };
   262	      }
   263	      await this.sleep(3000);
   264	    }
   265	    this.setUnresolved({ ...this.unresolved!, unknown: true });
   266	    return { ok: false, unknown: true, hash, gasCostWei: 0n, reason: `not mined and cancel ${cancel.hash} not confirmed: outcome UNKNOWN` };
   267	  }
   268	
   269	  private signedAt = 0;
   270	  private async result(hash: string, r: { status: number | null; gasUsed: bigint; gasPrice: bigint }): Promise<TxResult> {
   271	    // OP-stack chains (Base/Optimism) charge an L1 data fee on top of the L2 gas: it lives in the
   272	    // raw receipt's l1Fee field, which ethers does not expose. Without it the recorded gas
   273	    // understates the true cost (round-3 review, M1). On other chains the field is absent.
   274	    const l1 = (await this.b.rawReceipt?.(hash).catch(() => null))?.l1Fee ?? 0n;
   275	    const cost = r.gasUsed * r.gasPrice + l1;
   276	    const extra = { gasUsed: r.gasUsed, gasPrice: r.gasPrice, inclusionMs: this.now() - this.signedAt, ...(l1 > 0n ? { l1FeeWei: l1 } : {}) };
   277	    return r.status === 1 ? { ok: true, hash, gasCostWei: cost, ...extra } : { ok: false, hash, gasCostWei: cost, reason: 'reverted', ...extra };
   278	  }
   279	
   280	  private async waitReceipt(hash: string, timeoutSec: number) {
   281	    const deadline = this.now() + timeoutSec * 1000;
   282	    while (this.now() < deadline) {
   283	      const r = await this.b.receipt(hash).catch(() => null);
   284	      if (r) return r;
   285	      await this.sleep(2000);
   286	    }
   287	    return null;
   288	  }
   289	}
```

## `scripts/check-0x-quote.ts`

```
     1	// One read-only firm 0x quote, to confirm before going live that transaction.to is the AllowanceHolder.
     2	// It NEVER signs or sends anything, and prints only transaction.to, allowanceTarget and issues.
     3	// Usage: npx tsx scripts/check-0x-quote.ts   (reads ZEROX_API_KEY and PRIVATE_KEY -> address from .env)
     4	import 'dotenv/config';
     5	import { ethers } from 'ethers';
     6	
     7	const AH = '0x0000000000001fF3684f28c67538d4D072C22734';
     8	const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
     9	const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    10	
    11	const key = process.env.ZEROX_API_KEY;
    12	const pk = process.env.PRIVATE_KEY;
    13	if (!key || !pk) throw new Error('ZEROX_API_KEY and PRIVATE_KEY are needed in .env (the key is only used to derive the address)');
    14	const taker = new ethers.Wallet(pk).address;
    15	
    16	const q = new URLSearchParams({ chainId: '1', sellToken: USDC, buyToken: WETH, sellAmount: '10000000', taker, slippagePpm: '3000' });
    17	const res = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${q}`, { headers: { '0x-api-key': key, '0x-version': 'v2' } });
    18	const d = (await res.json()) as { transaction?: { to?: string }; allowanceTarget?: string; issues?: unknown };
    19	console.log(JSON.stringify({ http: res.status, transactionTo: d.transaction?.to, allowanceTarget: d.allowanceTarget, issues: d.issues }, null, 2));
    20	const ok = d.transaction?.to?.toLowerCase() === AH.toLowerCase();
    21	console.log(ok ? `OK: transaction.to is the AllowanceHolder ${AH}` : `MISMATCH: expected ${AH}. The bot would reject every quote; do not go live.`);
```

## `scripts/networks.ts`

```
     1	// Read-only: per MEXC network, how many USDT-listed tokens have deposit AND withdraw enabled and a contract.
     2	// Also shows which raw MEXC network names each CHAIN profile matches (src/chains.ts), so you can check
     3	// the matcher before trading a new chain. It NEVER trades. Usage: npm run networks
     4	import 'dotenv/config';
     5	import { MexcRest } from '../src/mexc/rest.js';
     6	import { CHAINS, networkFor } from '../src/chains.js';
     7	import { isOnline } from '../src/watchlist.js';
     8	
     9	const key = process.env.MEXC_API_KEY;
    10	const secret = process.env.MEXC_API_SECRET;
    11	if (!key || !secret) throw new Error('MEXC_API_KEY / MEXC_API_SECRET needed (a read-only key is enough)');
    12	
    13	const mexc = new MexcRest(key, secret);
    14	await mexc.syncTime();
    15	const [symbols, coins] = await Promise.all([mexc.exchangeInfo(), mexc.coinConfigs()]);
    16	const usdtBases = new Set(symbols.filter((s) => s.quoteAsset === 'USDT' && s.isSpotTradingAllowed && isOnline(s.status)).map((s) => s.baseAsset.toUpperCase()));
    17	const listed = coins.filter((c) => usdtBases.has(c.coin.toUpperCase()));
    18	
    19	const ok = (n: { depositEnable: boolean; withdrawEnable: boolean; contract?: string }) =>
    20	  n.depositEnable && n.withdrawEnable && Boolean(n.contract && /^0x[0-9a-fA-F]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(n.contract));
    21	
    22	// 1) Raw MEXC network names
    23	const raw = new Map<string, number>();
    24	for (const c of listed) for (const n of c.networkList) if (ok(n)) raw.set(`${n.netWork ?? '-'} | ${n.network}`, (raw.get(`${n.netWork ?? '-'} | ${n.network}`) ?? 0) + 1);
    25	console.log(`USDT-listed coins: ${listed.length}\n\nTop MEXC networks (netWork | network): tokens with deposit+withdraw+contract`);
    26	for (const [k, v] of [...raw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(4)}  ${k}`);
    27	
    28	// 2) What each CHAIN profile matches
    29	console.log('\nPer CHAIN profile (src/chains.ts matcher):');
    30	for (const chain of Object.values(CHAINS)) {
    31	  const names = new Set<string>();
    32	  let n = 0;
    33	  for (const c of listed) {
    34	    const net = networkFor(chain, c.networkList);
    35	    if (net && ok(net)) {
    36	      n++;
    37	      names.add(`${net.netWork ?? '-'} | ${net.network}`);
    38	    }
    39	  }
    40	  console.log(`  ${chain.name.padEnd(9)} ${String(n).padStart(4)} tokens   matched names: ${[...names].join('; ') || '(none)'}`);
    41	}
    42	console.log('\nIf a chain matched the wrong name (or nothing), fix mexcNetwork in src/chains.ts before trading it.');
```

## `test/chain.test.ts`

```
     1	import { test } from 'node:test';
     2	import assert from 'node:assert/strict';
     3	import { approvalAmount, MAX_UINT256 } from '../src/dex/chain.js';
     4	
     5	test('approvalAmount: exact by default, MaxUint256 when unlimited is on', () => {
     6	  const amount = 123_456n;
     7	  assert.equal(approvalAmount(false, amount), amount);
     8	  assert.equal(approvalAmount(true, amount), MAX_UINT256);
     9	  assert.equal(approvalAmount(true, 0n), MAX_UINT256);
    10	});
    11	
    12	test('MAX_UINT256 is 2^256 - 1', () => {
    13	  assert.equal(MAX_UINT256, (1n << 256n) - 1n);
    14	});
```

## `test/engine.test.ts`

```
     1	// End-to-end tests of the trading engine with fake MEXC, chain and aggregator.
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { loadConfig } from '../src/config.js';
     5	import { Db } from '../src/db.js';
     6	import { Risk } from '../src/risk.js';
     7	import { Engine } from '../src/engine.js';
     8	import type { Balances } from '../src/inventory.js';
     9	import type { Token } from '../src/watchlist.js';
    10	import type { Quote, QuoteRequest } from '../src/dex/aggregator.js';
    11	import type { TxResult } from '../src/dex/chain.js';
    12	import { AmbiguousRequestError, type Book, type Order } from '../src/mexc/rest.js';
    13	
    14	const GWEI = 1_000_000_000n;
    15	const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    16	const LINK: Token = {
    17	  base: 'LINK', symbol: 'LINKUSDT', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18,
    18	  qtyStep: 0.01, priceDecimals: 3, dexTvlUsd: 1e6, mexcVolumeUsd: 1e7, depositOk: true, withdrawOk: true,
    19	  rules: { qtyStep: 0.01, priceDecimals: 3, minQty: 0.01, minNotional: 1, maxNotional: 2e6, orderTypes: ['LIMIT', 'MARKET', 'LIMIT_MAKER'], tradeSideType: 1 },
    20	};
    21	
    22	function setup(opts: {
    23	  mode?: 'live' | 'paper';
    24	  bid?: number;
    25	  gasGwei?: bigint;
    26	  dexOk?: boolean;
    27	  simulateThrows?: boolean;
    28	  approvalNeeded?: boolean;
    29	  mexcFillRatio?: number;
    30	  closeFillRatio?: number;
    31	  dexUnknown?: boolean;
    32	  placeAmbiguous?: boolean;
    33	  minNotional?: number;
    34	  unresolved?: boolean;
    35	  notReady?: boolean;
    36	  usdcUsdt?: number;
    37	}) {
    38	  process.env.MODE = opts.mode ?? 'live';
    39	  process.env.RPC_URL = 'http://localhost';
    40	  process.env.MAX_TRADE_USD = '200'; // tests use $200 trades (default is 50)
    41	  process.env.MIN_PROFIT_USD = '15';
    42	  // These older tests keep the pre-upgrade cost settings, so their numbers stay meaningful.
    43	  process.env.MIN_PROFIT_BPS = '50';
    44	  process.env.SAFETY_MARGIN_USD = '2';
    45	  process.env.SAFETY_MARGIN_BPS = '0';
    46	  process.env.CEX_SLIPPAGE_BPS = '20';
    47	  process.env.PRIVATE_KEY = '0x' + '11'.repeat(32);
    48	  process.env.MEXC_API_KEY = 'k'.repeat(10);
    49	  process.env.MEXC_API_SECRET = 's'.repeat(10);
    50	  const cfg = loadConfig();
    51	  const db = new Db(':memory:');
    52	  const risk = new Risk(db, cfg.mode, cfg);
    53	  const alerts: string[] = [];
    54	  const calls: string[] = [];
    55	
    56	  const fee = cfg.mexcTakerFee;
    57	  const bid = opts.bid ?? 11.2;
    58	  // Real-ish balances that the fakes update, so PnL is computed from balance changes.
    59	  const bal: Balances = { walletEth: 1, walletUsdc: 1000, walletToken: { LINK: 100 }, mexc: { USDT: 1000, LINK: 100 } };
    60	  const ethUsd = 2000;
    61	
    62	  const books: Record<string, Book> = {
    63	    ETHUSDT: { bids: [[ethUsd, 100]], asks: [[ethUsd, 100]], ts: Date.now() },
    64	    USDCUSDT: { bids: [[opts.usdcUsdt ?? 1, 1e6]], asks: [[opts.usdcUsdt ?? 1, 1e6]], ts: Date.now() },
    65	    LINKUSDT: { bids: [[bid, 1000]], asks: [[bid + 0.01, 1000]], ts: Date.now() },
    66	  };
    67	
    68	  // DEX price = 10 USDC per LINK, 0.1% minOut buffer.
    69	  const dexQuote = (r: QuoteRequest, firm: boolean): Quote => {
    70	    const buyingToken = r.sellToken === USDC;
    71	    const out = buyingToken ? (r.sellAmount * 10n ** 12n) / 10n : (r.sellAmount * 10n) / 10n ** 12n;
    72	    return {
    73	      buyAmount: out,
    74	      minBuyAmount: (out * 999n) / 1000n,
    75	      gas: 150_000n,
    76	      spender: '0xspender',
    77	      tx: firm ? { to: '0xrouter', data: '0xdead', value: 0n } : undefined,
    78	    };
    79	  };
    80	  let lastFirm: QuoteRequest | null = null;
    81	
    82	  const priced: bigint[] = []; // sellAmount of every indicative DEX quote
    83	  const orders = new Map<string, Order>();
    84	  const byCid = new Map<string, string>();
    85	  let nextId = 1;
    86	  const fill = (side: 'BUY' | 'SELL', qty: number, price: number) => {
    87	    if (side === 'SELL') {
    88	      bal.mexc.LINK -= qty;
    89	      bal.mexc.USDT += qty * price * (1 - fee);
    90	    } else {
    91	      bal.mexc.LINK += qty * (1 - fee);
    92	      bal.mexc.USDT -= qty * price;
    93	    }
    94	  };
    95	
    96	  const token = { ...LINK, rules: { ...LINK.rules, minNotional: opts.minNotional ?? 1 } };
    97	  const engine = new Engine({
    98	    cfg,
    99	    db,
   100	    risk,
   101	    tokens: [token],
   102	    sleep: async () => {},
   103	    tg: { send: async (t) => void alerts.push(t) },
   104	    book: async (s) => books[s],
   105	    balances: async () => structuredClone(bal),
   106	    agg: {
   107	      name: '0x',
   108	      price: async (r) => (priced.push(r.sellAmount), dexQuote(r, false)),
   109	      quote: async (r) => ((lastFirm = r), dexQuote(r, true)),
   110	    },
   111	    chain: {
   112	      address: '0xme',
   113	      gas: async () => {
   114	        const base = (opts.gasGwei ?? 9n) * GWEI;
   115	        return { baseFee: base, tip: GWEI, effective: base + GWEI, maxFee: base * 2n + GWEI };
   116	      },
   117	      approvalGasNeeded: async () => (opts.approvalNeeded ? 60_000n : 0n),
   118	      approveExact: async (_t, _s, amount) => {
   119	        calls.push(`approve ${amount}`);
   120	        bal.walletEth -= 0.0006;
   121	        return { ok: true, gasCostWei: 600_000n * GWEI };
   122	      },
   123	      checkUnresolved: async () => ({ state: opts.unresolved ? 'pending' : 'clear' }),
   124	      readyToSend: async () => (opts.notReady ? { ok: false, reason: 'nonce gap' } : { ok: true }),
   125	      simulate: async () => {
   126	        calls.push('simulate');
   127	        if (opts.simulateThrows) throw new Error('execution reverted');
   128	        return 150_000n;
   129	      },
   130	      send: async (): Promise<TxResult> => {
   131	        calls.push('send');
   132	        const gasWei = 150_000n * 10n * GWEI;
   133	        bal.walletEth -= 0.0015;
   134	        if (opts.dexUnknown) return { ok: false, unknown: true, hash: '0xtx', gasCostWei: 0n, reason: 'unknown' };
   135	        if (opts.dexOk === false) return { ok: false, hash: '0xtx', gasCostWei: gasWei, reason: 'reverted' };
   136	        const r = lastFirm!;
   137	        if (r.sellToken === USDC) {
   138	          bal.walletUsdc -= Number(r.sellAmount) / 1e6;
   139	          bal.walletToken.LINK += (Number(r.sellAmount) / 1e6) / 10;
   140	        } else {
   141	          const tokens = Number(r.sellAmount) / 1e18;
   142	          bal.walletToken.LINK -= tokens;
   143	          bal.walletUsdc += tokens * 10;
   144	        }
   145	        return { ok: true, hash: '0xtx', gasCostWei: gasWei };
   146	      },
   147	    },
   148	    mexc: {
   149	      limitOrder: async (_s, side, q, p, cid) => {
   150	        calls.push(`limit ${side} ${q} @ ${p}`);
   151	        const id = String(nextId++);
   152	        const first = id === '1';
   153	        const filled = Number(q) * ((first ? opts.mexcFillRatio : opts.closeFillRatio) ?? 1);
   154	        fill(side, filled, Number(p));
   155	        orders.set(id, { orderId: id, status: filled === Number(q) ? 'FILLED' : 'PARTIALLY_FILLED', executedQty: String(filled), cummulativeQuoteQty: '0', origQty: q, price: p, side });
   156	        if (cid) byCid.set(cid, id);
   157	        // MEXC executed it, but our HTTP request timed out / got a 5xx:
   158	        if (first && opts.placeAmbiguous) throw new AmbiguousRequestError('MEXC POST /api/v3/order -> 503');
   159	        return { orderId: id };
   160	      },
   161	      marketSell: async (_s, q) => {
   162	        calls.push(`market SELL ${q}`);
   163	        const filled = Number(q) * (opts.marketFillRatio ?? 1);
   164	        fill('SELL', filled, bid);
   165	        orders.set('m', { orderId: 'm', status: 'FILLED', executedQty: String(filled), cummulativeQuoteQty: String(filled * bid), origQty: q, price: '0', side: 'SELL' });
   166	        return { orderId: 'm' };
   167	      },
   168	      getOrderByClientId: async (_s, cid) => (byCid.has(cid) ? orders.get(byCid.get(cid)!)! : null),
   169	      getOrder: async (_s, id) => orders.get(id)!,
   170	      cancelOrder: async (_s, id) => {
   171	        calls.push(`cancel ${id}`);
   172	        const o = orders.get(id)!;
   173	        o.status = 'PARTIALLY_CANCELED';
   174	        return o;
   175	      },
   176	    },
   177	  });
   178	  return { engine, db, risk, alerts, calls, bal, cfg, priced };
   179	}
   180	
   181	const trades = (db: Db) => db.statsSince(0);
   182	
   183	test('profitable gap: both legs trade, PnL comes from real balance changes', async () => {
   184	  const { engine, db, alerts, calls } = setup({});
   185	  await engine.tick();
   186	  // MEXC sell 20 LINK (bought 20 on DEX for $200), limit = 11.2 * (1 - 0.2%) rounded down.
   187	  // MEXC sells what the DEX guarantees (minBuyAmount 19.98), not the expected 20.
   188	  assert.deepEqual(calls, ['simulate', 'limit SELL 19.98 @ 11.177', 'send']);
   189	  const s = trades(db);
   190	  assert.equal(s.total.trades, 1);
   191	  assert.equal(s.total.failed, 0);
   192	  // +20 LINK in wallet, -19.98 on MEXC (0.02 kept, valued at mid 11.205); -$200 USDC; USDT in; -0.0015 ETH gas
   193	  const expected = -200 + 19.98 * 11.177 * 0.9995 + 0.02 * 11.205 - 0.0015 * 2000;
   194	  assert.ok(Math.abs(s.total.pnl - expected) < 1e-6, `${s.total.pnl} vs ${expected}`);
   195	  assert.ok(Math.abs(s.total.gas - 3) < 1e-9);
   196	  assert.ok(alerts.some((a) => a.includes('✅ LIVE LINK DEX_BUY [ok]') && a.includes('Net PnL')));
   197	  assert.ok(alerts.some((a) => a.includes('https://etherscan.io/tx/0xtx'))); // chain explorer, not a hardcoded host (round-3 L4)
   198	});
   199	
   200	test('no trade when the gap is below max($15, 0.5%)', async () => {
   201	  const { engine, db, calls } = setup({ bid: 10.9 });
   202	  await engine.tick();
   203	  assert.deepEqual(calls, []);
   204	  assert.equal(trades(db).total.trades, 0);
   205	});
   206	
   207	test('DEX leg fails after MEXC sold: buys back at market, alerts one-sided', async () => {
   208	  const { engine, db, alerts, calls, bal } = setup({ dexOk: false });
   209	  await engine.tick();
   210	  // close: 2% over ask 11.21 = 11.4342, rounded DOWN (stays inside the price band)
   211	  assert.ok(calls.includes('limit BUY 19.98 @ 11.434'));
   212	  const row = trades(db);
   213	  assert.equal(row.total.failed, 1);
   214	  assert.ok(alerts.some((a) => a.startsWith('⚠️ ONE-SIDED FILL LINK')));
   215	  assert.ok(Math.abs(bal.walletToken.LINK - 100) < 1e-9); // wallet untouched
   216	  assert.ok(Math.abs(bal.mexc.LINK - 100 + 19.98 * 0.0005) < 1e-9); // flat again except the fee
   217	});
   218	
   219	test('MEXC partial fill: rest is cancelled and closed at market', async () => {
   220	  const { engine, calls } = setup({ mexcFillRatio: 0.5 });
   221	  await engine.tick();
   222	  assert.ok(calls.includes('cancel 1'));
   223	  assert.ok(calls.includes('limit SELL 9.99 @ 10.976')); // rest closed with an aggressive limit 2% under the bid
   224	});
   225	
   226	test('simulation failure: nothing is sent, approval gas is still booked', async () => {
   227	  const { engine, db, calls } = setup({ simulateThrows: true, approvalNeeded: true });
   228	  await engine.tick();
   229	  assert.ok(calls[0].startsWith('approve 200000000')); // exact amount: 200 USDC, never MaxUint256
   230	  assert.ok(!calls.some((c) => c.startsWith('limit') || c === 'send'));
   231	  const s = trades(db);
   232	  assert.equal(s.total.trades, 0); // approval rows are not trades
   233	  assert.ok(s.total.pnl < 0 && s.total.gas > 0);
   234	});
   235	
   236	test('gas above MAX_GAS_GWEI: no quotes at all', async () => {
   237	  const { engine, calls } = setup({ gasGwei: 50n });
   238	  await engine.tick();
   239	  assert.deepEqual(calls, []);
   240	});
   241	
   242	test('kill switch: paused bot does nothing', async () => {
   243	  const { engine, risk, calls } = setup({});
   244	  risk.pause('Telegram /stop');
   245	  await engine.tick();
   246	  assert.deepEqual(calls, []);
   247	});
   248	
   249	test('3 failed trades in a row pause trading', async () => {
   250	  const { engine, risk, alerts } = setup({ dexOk: false });
   251	  await engine.tick();
   252	  await engine.tick();
   253	  await engine.tick();
   254	  assert.equal(risk.paused, true);
   255	  assert.ok(alerts.some((a) => a.includes('3 failed trades in a row')));
   256	  const before = alerts.length;
   257	  await engine.tick();
   258	  assert.equal(alerts.length, before); // stays stopped
   259	});
   260	
   261	test('paper mode: records the trade, sends nothing real', async () => {
   262	  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
   263	  await engine.tick();
   264	  assert.deepEqual(calls, []);
   265	  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
   266	  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER LINK')));
   267	});
   268	
   269	test('DEX outcome unknown: NO automatic unwind, trading paused', async () => {
   270	  const { engine, risk, calls, alerts } = setup({ dexUnknown: true });
   271	  await engine.tick();
   272	  assert.ok(!calls.some((c) => c.startsWith('market') || c.startsWith('limit BUY')));
   273	  assert.equal(risk.paused, true);
   274	  assert.ok(alerts.some((a) => a.includes('outcome UNKNOWN')));
   275	});
   276	
   277	test('unwind SELL that only partly fills is detected (not assumed flat)', async () => {
   278	  const { engine, risk, calls, alerts } = setup({ mexcFillRatio: 0.5, closeFillRatio: 0.5 });
   279	  await engine.tick();
   280	  assert.ok(calls.includes('limit SELL 9.99 @ 10.976'));
   281	  assert.equal(risk.paused, true);
   282	  assert.equal(risk.critical, true);
   283	  // reports what is REALLY still open (half of 9.99), not the full quantity
   284	  assert.ok(alerts.some((a) => a.includes('market close FAILED') && a.includes('Still open: MEXC SELL 5 LINK')));
   285	});
   286	
   287	test('MEXC 5xx on order placement: found by clientOrderId, no double sell', async () => {
   288	  const { engine, db, calls } = setup({ placeAmbiguous: true });
   289	  await engine.tick();
   290	  assert.equal(calls.filter((c) => c.startsWith('limit SELL')).length, 1); // never re-sent, never "unwound"
   291	  assert.ok(!calls.some((c) => c.startsWith('limit BUY')));
   292	  assert.equal(trades(db).total.failed, 0);
   293	});
   294	
   295	test('order below MEXC minNotional: rejected BEFORE any DEX tx', async () => {
   296	  const { engine, calls } = setup({ minNotional: 1000 });
   297	  await engine.tick();
   298	  assert.deepEqual(calls, []); // no simulate, no send, no MEXC order
   299	});
   300	
   301	test('unresolved earlier DEX tx: no new trades', async () => {
   302	  const { engine, calls } = setup({ unresolved: true });
   303	  await engine.tick();
   304	  assert.deepEqual(calls, []);
   305	});
   306	
   307	test('critical pause needs /start confirm; soft pause does not', () => {
   308	  const { risk } = setup({});
   309	  risk.pause('Telegram /stop');
   310	  assert.equal(risk.resume(), true);
   311	  risk.pause('DEX tx unknown 0xabc', true);
   312	  risk.pause('Telegram /stop'); // a later soft pause must not downgrade it
   313	  assert.equal(risk.critical, true);
   314	  assert.equal(risk.resume(), false);
   315	  assert.equal(risk.paused, true);
   316	  assert.equal(risk.resume(true), true);
   317	  assert.equal(risk.paused, false);
   318	});
   319	
   320	test('worst case beyond the remaining daily loss budget: skipped before any order', async () => {
   321	  const { engine, db, calls } = setup({});
   322	  db.insertTrade({ ts: Date.now(), day: (await import('../src/util.js')).dhakaDay(), mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 1, qty: 1, buy_price: 1, sell_price: 1, expected_net: 0, cex_fee_usd: 0, gas_usd: 0, pnl_usd: -25, status: 'ok', dex_tx: null, cex_order_id: null, note: null });
   323	  await engine.tick(); // budget left $5 < 5% of $200 + gas
   324	  assert.deepEqual(calls, []);
   325	});
   326	
   327	test('restart with an executing row: looked up, reported, paused until /start confirm', async () => {
   328	  const { db, risk } = setup({});
   329	  const { recoverExecuting } = await import('../src/recovery.js');
   330	  db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 200, qty: 19.98, buy_price: 10, sell_price: 11, expected_net: 18, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'executing', dex_tx: '0xpending', cex_order_id: 'cidX', note: 'client order id cidX; nonce 7' });
   331	  const alerts: string[] = [];
   332	  await recoverExecuting(
   333	    db, risk, { send: async (t) => void alerts.push(t) },
   334	    { getOrderByClientId: async () => ({ orderId: '9', status: 'FILLED', executedQty: '19.98' }) as Order },
   335	    async () => null,
   336	  );
   337	  assert.equal(risk.paused, true);
   338	  assert.equal(risk.critical, true);
   339	  assert.equal(risk.resume(), false);
   340	  assert.equal(db.executingTrades().length, 0);
   341	  assert.ok(alerts[0].includes('MEXC cidX (order 9): FILLED, filled 19.98') && alerts[0].includes('NOT MINED'));
   342	});
   343	
   344	test('recovery: both legs done -> trade marked ok, no critical pause', async () => {
   345	  const { db, risk } = setup({});
   346	  const { recoverExecuting } = await import('../src/recovery.js');
   347	  db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 200, qty: 19.98, buy_price: 10, sell_price: 11, expected_net: 18, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'executing', dex_tx: '0xdone', cex_order_id: 'cidY', note: 'client order id cidY; nonce 8' });
   348	  const alerts: string[] = [];
   349	  await recoverExecuting(
   350	    db, risk, { send: async (t) => void alerts.push(t) },
   351	    { getOrderByClientId: async () => ({ orderId: '9', status: 'FILLED', executedQty: '19.98' }) as Order },
   352	    async () => ({ status: 1 }),
   353	    async () => ({ state: 'clear' }),
   354	  );
   355	  assert.equal(risk.paused, false);
   356	  assert.equal(db.statsSince(0, 'live').total.failed, 0);
   357	  assert.ok(alerts[0].includes('All legs completed'));
   358	});
   359	
   360	test('recovery: a pending DEX tx from before the restart keeps the bot critically paused', async () => {
   361	  const { db, risk } = setup({});
   362	  const { recoverExecuting } = await import('../src/recovery.js');
   363	  await recoverExecuting(db, risk, { send: async () => {} }, { getOrderByClientId: async () => null }, async () => null, async () => ({ state: 'pending' }));
   364	  assert.equal(risk.critical, true);
   365	});
   366	
   367	test('critical resume does not reset the failure streak', () => {
   368	  const { risk, db } = setup({});
   369	  db.setState('consecutive_fails', '2');
   370	  risk.pause('DEX tx unknown', true);
   371	  risk.resume(true);
   372	  assert.equal(risk.consecutiveFails, 2);
   373	});
   374	
   375	test('nonce not ready (gap / unresolved): the MEXC leg never fires', async () => {
   376	  const { engine, calls } = setup({ notReady: true });
   377	  await engine.tick();
   378	  assert.ok(calls.includes('simulate')); // got as far as the final checks
   379	  assert.ok(!calls.some((c) => c.startsWith('limit') || c === 'send'));
   380	});
   381	
   382	test('stale or unreasonable USDC/USDT rate: no trading', async () => {
   383	  const off = setup({ usdcUsdt: 1.05 });
   384	  await off.engine.tick();
   385	  assert.deepEqual(off.calls, []);
   386	});
   387	
   388	// ---------------- Phase-1 upgrade: items 2, 4e, 5 ----------------
   389	const opps = (db: Db) => db.all<{ token: string; direction: string; size_usd: number | null; decision: string; net_usd: number | null; gross_bps: number | null }>('SELECT * FROM opportunities');
   390	
   391	test('every evaluated candidate is logged to opportunities, with its decision', async () => {
   392	  const { engine, db } = setup({ bid: 10.9 }); // below the hurdle
   393	  await engine.tick();
   394	  const rows = opps(db);
   395	  assert.ok(rows.length >= 2); // both directions
   396	  assert.ok(rows.every((r) => r.token === 'LINK'));
   397	  assert.ok(rows.some((r) => r.decision === 'below_hurdle' && r.gross_bps !== null && r.net_usd !== null));
   398	});
   399	
   400	test('a traded candidate is logged as trade; paused ticks are logged as paused', async () => {
   401	  const s1 = setup({});
   402	  await s1.engine.tick();
   403	  assert.ok(opps(s1.db).some((r) => r.decision === 'trade'));
   404	  const s2 = setup({});
   405	  s2.risk.pause('Telegram /stop');
   406	  await s2.engine.tick();
   407	  assert.ok(opps(s2.db).every((r) => r.decision === 'paused'));
   408	});
   409	
   410	test('multi-size: near the hurdle, 0.5x and 2x of the base size are quoted and the best net is used', async () => {
   411	  const { engine, priced, calls } = setup({});
   412	  await engine.tick();
   413	  // DEX_BUY quotes in USDC base units: base = MAX_TRADE_USD/2 = 100, then 50 and 200
   414	  const usdc = priced.filter((x) => x % 1_000_000n === 0n && x <= 1_000_000_000n).map((x) => Number(x / 1_000_000n));
   415	  assert.ok(usdc.includes(100) && usdc.includes(50) && usdc.includes(200), String(usdc));
   416	  assert.ok(calls.includes('limit SELL 19.98 @ 11.177')); // the $200 size won (largest net)
   417	});
   418	
   419	test('legs: a live trade writes one dex and one mexc leg with latency', async () => {
   420	  const { engine, db } = setup({});
   421	  await engine.tick();
   422	  const legs = db.all<{ leg: string; quoted_price: number; executed_qty: number | null; latency_quote_ms: number | null; latency_mexc_ack_ms: number | null }>('SELECT * FROM legs');
   423	  assert.deepEqual(legs.map((l) => l.leg).sort(), ['dex', 'mexc']);
   424	  assert.ok(legs.find((l) => l.leg === 'dex')!.latency_quote_ms !== null);
   425	  assert.equal(legs.find((l) => l.leg === 'mexc')!.executed_qty, 19.98);
   426	});
   427	
   428	test('paper: the trade is booked at the re-quoted net, not the first quote', async () => {
   429	  const { engine, db } = setup({ mode: 'paper' });
   430	  await engine.tick();
   431	  const t = db.all<{ pnl_usd: number; expected_net: number; requoted_net: number | null }>("SELECT * FROM trades WHERE mode = 'paper'")[0];
   432	  assert.ok(t.requoted_net !== null);
   433	  assert.equal(t.pnl_usd, t.requoted_net);
   434	});
   435	
   436	test('skewed hurdle: a trade that worsens the wallet/MEXC balance needs more, one that restores it needs less', () => {
   437	  const { engine, bal } = setup({});
   438	  const tok = { ...LINK, rules: { ...LINK.rules } };
   439	  const plain = 15; // need without skew: max(MIN_PROFIT_USD 15, 50 bps of $200)
   440	  const lopsided = { ...bal, walletToken: { LINK: 150 }, mexc: { ...bal.mexc, LINK: 50 } }; // 75% in the wallet
   441	  const worse = engine.needFor(tok, 'DEX_BUY', 200, lopsided, 10); // 75% -> 85% wallet: worse by 0.10
   442	  const better = engine.needFor(tok, 'CEX_BUY', 200, lopsided, 10); // 75% -> 65%: restores
   443	  assert.ok(Math.abs(worse - plain * (1 + 0.75 * 0.1)) < 1e-9, String(worse)); // SKEW_K 0.75
   444	  assert.ok(Math.abs(better - plain * 0.8) < 1e-9, String(better));
   445	});
   446	
   447	test('rebalance ticket: a side low for REBALANCE_AFTER_MIN opens ONE ticket and alerts once', async () => {
   448	  process.env.REBALANCE_AFTER_MIN = '0';
   449	  try {
   450	    const { engine, db, alerts, bal } = setup({});
   451	    bal.mexc.LINK = 0.5; // MEXC side of LINK far below 1x the trade size
   452	    await engine.tick();
   453	    await engine.tick();
   454	    const open = db.openTickets().filter((k) => k.token === 'LINK' && k.side === 'mexc');
   455	    assert.equal(open.length, 1);
   456	    assert.match(open[0].direction, /deposit wallet→MEXC/);
   457	    assert.equal(alerts.filter((a) => a.startsWith('🎫 Rebalance ticket') && a.includes('LINK')).length, 1);
   458	  } finally {
   459	    delete process.env.REBALANCE_AFTER_MIN;
   460	  }
   461	});
   462	
   463	test('expected_net subtracts the approval gas already spent (round-3 L3)', async () => {
   464	  const readExpected = (db: Db) =>
   465	    db.all<{ expected_net: number }>(`SELECT expected_net FROM trades WHERE status = 'ok'`).map((r) => r.expected_net);
   466	  const a = setup({});
   467	  await a.engine.tick();
   468	  const b = setup({ approvalNeeded: true });
   469	  await b.engine.tick();
   470	  assert.equal(readExpected(a.db).length, 1);
   471	  assert.equal(readExpected(b.db).length, 1);
   472	  // Same quotes, same books: the re-checked net is identical; only the approval gas ($1.20) differs.
   473	  // The approval gas sits inside the balance-based PnL, so the stored expectation must not promise it back.
   474	  assert.ok(Math.abs((readExpected(a.db)[0] - readExpected(b.db)[0]) - 1.2) < 1e-9,
   475	    `${readExpected(a.db)[0]} vs ${readExpected(b.db)[0]}`);
   476	});
   477	
   478	test('L1_FEE_USD reserve lowers the estimated net (round-3 M1)', async () => {
   479	  const saved = { ...process.env };
   480	  try {
   481	    const run = async () => {
   482	      const { engine, db } = setup({ mode: 'paper' });
   483	      await engine.tick();
   484	      return db.all<{ expected_net: number }>(`SELECT expected_net FROM trades WHERE status = 'paper'`).map((r) => r.expected_net);
   485	    };
   486	    delete process.env.L1_FEE_USD;
   487	    const base = await run();
   488	    process.env.L1_FEE_USD = '2';
   489	    const withReserve = await run();
   490	    assert.equal(base.length, 1);
   491	    assert.equal(withReserve.length, 1);
   492	    assert.ok(Math.abs((base[0] - withReserve[0]) - 2) < 1e-9, `${base[0]} vs ${withReserve[0]}`);
   493	  } finally {
   494	    process.env = saved;
   495	  }
   496	});
```

## `test/grok-r2.test.ts`

```
     1	// Tests for Grok's round-2 fix prompt (items 1-10).
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { TxSender, type TxBackend, type GasInfo } from '../src/dex/txsender.js';
     5	import { Db } from '../src/db.js';
     6	import { Risk } from '../src/risk.js';
     7	import { makeUnresolvedCheck, resolveTrade, startHandler } from '../src/commands.js';
     8	import { MexcApiError, MexcRest, AmbiguousRequestError } from '../src/mexc/rest.js';
     9	import { placeSafely } from '../src/engine.js';
    10	import { bandProblem, closePrice, rulesFrom } from '../src/mexc/rules.js';
    11	import { recoverExecuting } from '../src/recovery.js';
    12	
    13	const gas: GasInfo = { baseFee: 10n, tip: 1n, effective: 11n, maxFee: 21n };
    14	const limits = { maxTradesPerDay: 20, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 };
    15	
    16	function backend(state: { confirmed: number; receipts: Map<string, number>; signed: number[]; store?: () => string | undefined; seenDuringBroadcast?: string }) {
    17	  const b: TxBackend = {
    18	    address: '0xme',
    19	    confirmedNonce: async () => state.confirmed,
    20	    receipt: async (h) => (state.receipts.has(h) ? { status: state.receipts.get(h)!, gasUsed: 1n, gasPrice: 1n } : null),
    21	    knowsTx: async () => true,
    22	    sign: async (t) => {
    23	      state.signed.push(t.nonce);
    24	      return { raw: `raw${state.signed.length}`, hash: `0xh${state.signed.length}` };
    25	    },
    26	    broadcast: async (raw) => {
    27	      state.seenDuringBroadcast = state.store?.();
    28	      state.receipts.set(`0xh${raw.slice(3)}`, 1);
    29	    },
    30	    gas: async () => gas,
    31	  };
    32	  return b;
    33	}
    34	const memStore = () => {
    35	  let v: string | undefined;
    36	  return { get: () => v, set: (x: string | null) => (v = x ?? undefined) };
    37	};
    38	
    39	// ---- 1) nonce gap ----
    40	test('1) readyToSend: resets a local nonce that ran ahead of the chain, refuses while a tx is unresolved', async () => {
    41	  const st = { confirmed: 5, receipts: new Map<string, number>(), signed: [] as number[] };
    42	  const s = new TxSender(backend(st), memStore(), Date.now, async () => {});
    43	  await s.send({ to: '0xr', data: '0x' }, 1n, gas, 5); // nonce 5, mined -> local next = 6
    44	  // ...but the chain says 5 (e.g. that tx was replaced / dropped): a send at 6 could never be mined.
    45	  assert.deepEqual(await s.readyToSend(), { ok: true });
    46	  await s.send({ to: '0xr', data: '0x' }, 1n, gas, 5);
    47	  assert.deepEqual(st.signed, [5, 5]); // reset to the chain's nonce, no gap
    48	
    49	  const store = memStore();
    50	  store.set(JSON.stringify({ nonce: 7, hashes: ['0xold'], since: Date.now(), unknown: true }));
    51	  const s2 = new TxSender(backend({ confirmed: 7, receipts: new Map(), signed: [] }), store, Date.now, async () => {});
    52	  const r = await s2.readyToSend();
    53	  assert.equal(r.ok, false);
    54	  assert.match(r.reason!, /nonce 7 unresolved/);
    55	});
    56	
    57	// ---- 3) in-flight tx persisted before broadcast ----
    58	test('3) a tx is recorded as in flight BEFORE broadcast, and cleared once mined', async () => {
    59	  const store = memStore();
    60	  const st = { confirmed: 3, receipts: new Map<string, number>(), signed: [] as number[], store: store.get };
    61	  const s = new TxSender(backend(st), store, Date.now, async () => {});
    62	  await s.send({ to: '0xr', data: '0x' }, 1n, gas, 5);
    63	  assert.equal(JSON.parse(st.seenDuringBroadcast!).nonce, 3); // a crash during broadcast would leave this behind
    64	  assert.equal(s.unresolved, null); // mined -> cleared
    65	});
    66	
    67	// ---- 2) /start confirm ----
    68	test('2) /start confirm is refused while a tx is pending; when clear it resets the nonce', async () => {
    69	  const db = new Db(':memory:');
    70	  const risk = new Risk(db, 'live', limits);
    71	  let pending = true;
    72	  let resets = 0;
    73	  const chain = {
    74	    get unresolved() {
    75	      return pending ? { nonce: 9, hashes: ['0xa', '0xb'] } : null;
    76	    },
    77	    checkUnresolved: async () => ({ state: pending ? ('pending' as const) : ('clear' as const) }),
    78	    resetNonce: () => void resets++,
    79	  };
    80	  const start = startHandler(risk, async () => 'status', makeUnresolvedCheck(db, chain));
    81	  risk.pause('DEX tx unknown 0xa', true);
    82	  assert.match(await start(['confirm']), /Not resuming.*nonce 9.*\/cancelnonce/s);
    83	  assert.equal(risk.paused, true);
    84	  pending = false;
    85	  assert.match(await start(['confirm']), /resumed/i);
    86	  assert.equal(risk.paused, false);
    87	  assert.equal(resets, 1);
    88	});
    89	
    90	// ---- 9) not-found logic ----
    91	test('9) getOrderByClientId: only MEXC code -2011 means "no such order"; "currency does not exist" is rethrown', async () => {
    92	  const mk = (status: number, body: object) =>
    93	    new MexcRest('k', 's', 'https://x', (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch);
    94	  assert.equal(await mk(400, { code: -2011, msg: 'Unknown order sent.' }).getOrderByClientId('X', 'c'), null);
    95	  await assert.rejects(mk(400, { code: 10232, msg: 'currency does not exist' }).getOrderByClientId('X', 'c'), (e) => e instanceof MexcApiError && e.code === 10232);
    96	});
    97	
    98	test('9) placeSafely: a 5xx followed by "not found" is UNKNOWN_ORDER_STATE, never "not placed"', async () => {
    99	  const sleep = async () => {};
   100	  await assert.rejects(
   101	    placeSafely({ getOrderByClientId: async () => null }, 'X', 'cid', async () => { throw new AmbiguousRequestError('503'); }, sleep),
   102	    /UNKNOWN_ORDER_STATE/,
   103	  );
   104	});
   105	
   106	// ---- 8) price band ----
   107	const sym = (band: string) =>
   108	  rulesFrom({ symbol: 'X', baseAsset: 'X', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0', baseAssetPrecision: 2, quotePrecision: 4, orderTypes: ['LIMIT'], filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: band, askMultiplierDown: band }] });
   109	
   110	test('8) a 0.5% band clamps the close price; with a wide band the 2% close is used', () => {
   111	  const book = { bid: 99.9, ask: 100.1 }; // ref 100
   112	  assert.equal(closePrice(sym('0.005'), 'BUY', book), 100.4); // 100 * (1 + 0.8 * 0.005), not 102.1
   113	  assert.equal(closePrice(sym('0.005'), 'SELL', book), 99.6);
   114	  assert.equal(closePrice(sym('0.2'), 'BUY', book), 102.102); // ask * 1.02
   115	});
   116	
   117	test('8) an entry limit outside the band is rejected', () => {
   118	  assert.match(bandProblem(sym('0.02'), 'BUY', 103, 100)!, /above/);
   119	  assert.equal(bandProblem(sym('0.02'), 'BUY', 101.5, 100), null);
   120	  assert.match(bandProblem(sym('0.02'), 'SELL', 97, 100)!, /below/);
   121	});
   122	
   123	// ---- 6) recovery: open orders and close orders ----
   124	test('6) recovery cancels a close order that is still open and sweeps open bot orders', async () => {
   125	  const db = new Db(':memory:');
   126	  const risk = new Risk(db, 'live', limits);
   127	  const id = db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 50, qty: 5, buy_price: 10, sell_price: 11, expected_net: 2, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'executing', dex_tx: null, cex_order_id: 'arbt1', note: 'client order id arbt1' });
   128	  db.appendCid(id, 'arbt1');
   129	  db.appendCid(id, 'arbc2'); // an unwind close placed just before the crash
   130	  const status: Record<string, string> = { '1': 'FILLED', '2': 'NEW', '3': 'NEW' };
   131	  const cancelled: string[] = [];
   132	  const alerts: string[] = [];
   133	  await recoverExecuting(
   134	    db, risk, { send: async (t) => void alerts.push(t) },
   135	    {
   136	      getOrderByClientId: async (_s, cid) => ({ orderId: cid === 'arbt1' ? '1' : '2', status: status[cid === 'arbt1' ? '1' : '2'], executedQty: cid === 'arbt1' ? '5' : '0' }) as never,
   137	      getOrder: async (_s, oid) => ({ orderId: oid, status: status[oid], executedQty: '0' }) as never,
   138	      cancelOrder: async (_s, oid) => ((cancelled.push(oid), (status[oid] = 'CANCELED')), {} as never),
   139	      openOrders: async () => [{ orderId: '3', status: 'NEW', executedQty: '0', clientOrderId: 'arbc9', side: 'SELL', origQty: '1' }] as never,
   140	    },
   141	    async () => null,
   142	    async () => ({ state: 'clear' }),
   143	    { symbols: ['LINKUSDT'], sleep: async () => {} },
   144	  );
   145	  assert.deepEqual(cancelled.sort(), ['2', '3']);
   146	  assert.equal(risk.critical, true);
   147	  assert.ok(alerts[0].includes('was open -> cancelled'));
   148	  assert.equal(db.unresolvedTrades().length, 1); // pnl unknown until /resolve
   149	});
   150	
   151	// ---- 10e) /resolve ----
   152	test('10e) /resolve books the PnL of a one-sided trade and removes it from the list', () => {
   153	  const db = new Db(':memory:');
   154	  const id = db.insertTrade({ ts: Date.now(), day: '2026-11-20', mode: 'live', symbol: 'LINK', direction: 'DEX_BUY', size_usd: 50, qty: 5, buy_price: 10, sell_price: 11, expected_net: 2, cex_fee_usd: 0, gas_usd: 0, pnl_usd: 0, status: 'one_sided', dex_tx: null, cex_order_id: null, note: 'x; pnl unknown' });
   155	  assert.match(resolveTrade(db, undefined, undefined), /Usage/);
   156	  assert.match(resolveTrade(db, String(id), '-3.2'), /booked/);
   157	  assert.equal(db.unresolvedTrades().length, 0);
   158	  assert.equal(db.statsSince(0, 'live').total.pnl, -3.2);
   159	});
```

## `test/infra.test.ts`

```
     1	import { test } from 'node:test';
     2	import assert from 'node:assert/strict';
     3	import crypto from 'node:crypto';
     4	import { decodeDepthPush } from '../src/mexc/proto.js';
     5	import { MexcRest } from '../src/mexc/rest.js';
     6	import { ZeroEx, ZEROX_ALLOWANCE_HOLDER } from '../src/dex/aggregator.js';
     7	import { AmbiguousRequestError } from '../src/mexc/rest.js';
     8	import { placeSafely } from '../src/engine.js';
     9	import { loadConfig, secretsOf, validateConfig } from '../src/config.js';
    10	import { Telegram } from '../src/telegram.js';
    11	import { redact, registerSecrets } from '../src/log.js';
    12	import { Db } from '../src/db.js';
    13	import { Risk } from '../src/risk.js';
    14	import { ethNetwork, provenTokens, type Token } from '../src/watchlist.js';
    15	import fs from 'node:fs';
    16	import os from 'node:os';
    17	import path from 'node:path';
    18	
    19	// --- tiny protobuf encoder for building test messages ---
    20	const varint = (n: number) => {
    21	  const out: number[] = [];
    22	  while (n > 127) {
    23	    out.push((n & 0x7f) | 0x80);
    24	    n = Math.floor(n / 128);
    25	  }
    26	  out.push(n);
    27	  return out;
    28	};
    29	const field = (num: number, bytes: Uint8Array | number[]) => [...varint(num * 8 + 2), ...varint(bytes.length), ...bytes];
    30	const s = (x: string) => [...Buffer.from(x)];
    31	const level = (p: string, q: string) => [...field(1, s(p)), ...field(2, s(q))];
    32	
    33	test('provenTokens keeps only paper-profitable tokens, best P&L first', () => {
    34	  const tok = (base: string): Token => ({
    35	    base, symbol: `${base}USDT`, address: `0x${base}`, decimals: 18, qtyStep: 0.001, priceDecimals: 4,
    36	    rules: {} as Token['rules'], dexTvlUsd: 1_000_000, mexcVolumeUsd: 100_000, depositOk: true, withdrawOk: true,
    37	  });
    38	  const tokens = ['NPC', 'BGB', 'METAON', 'FET', 'PEPE'].map(tok);
    39	  const stats = [
    40	    { symbol: 'NPC', trades: 2, wins: 2, pnl: 19.41 },
    41	    { symbol: 'BGB', trades: 4, wins: 4, pnl: 7.11 },
    42	    { symbol: 'METAON', trades: 1, wins: 1, pnl: 1.38 },
    43	    { symbol: 'FET', trades: 3, wins: 0, pnl: -1.95 },
    44	  ];
    45	  assert.deepEqual(provenTokens(tokens, stats, 2, 0, 10).map((t) => t.base), ['NPC', 'BGB']);
    46	  assert.deepEqual(provenTokens(tokens, stats, 2, 0, 1).map((t) => t.base), ['NPC']);
    47	  assert.deepEqual(provenTokens(tokens, [], 2, 0, 10), []);
    48	});
    49	
    50	test('twin: live bot reads paper history from the paper bot DB (readonly)', () => {
    51	  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avh-twin-'));
    52	  const file = path.join(dir, 'paper.sqlite');
    53	  const paper = new Db(file);
    54	  const row = (symbol: string, pnl: number) => paper.insertTrade({ ts: Date.now(), day: '2026-11-21', mode: 'paper', symbol, direction: 'CEX_BUY', size_usd: 300, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 0, pnl_usd: pnl, status: 'paper', dex_tx: null, cex_order_id: null, note: null });
    55	  row('NPC', 10);
    56	  row('NPC', 9.41);
    57	  row('BGB', -1);
    58	  const twin = new Db(file, true);
    59	  const stats = twin.paperTokenStats().sort((a, b) => a.symbol.localeCompare(b.symbol));
    60	  assert.deepEqual(stats, [
    61	    { symbol: 'BGB', trades: 1, wins: 0, pnl: -1 },
    62	    { symbol: 'NPC', trades: 2, wins: 2, pnl: 19.41 },
    63	  ]);
    64	  twin.close();
    65	  paper.close();
    66	  fs.rmSync(dir, { recursive: true, force: true });
    67	});
    68	
    69	test('decodes a MEXC limit-depth protobuf push', () => {
    70	  const depth = [
    71	    ...field(1, level('101.5', '2')),
    72	    ...field(1, level('101.0', '1')),
    73	    ...field(2, level('100.0', '3')),
    74	    ...field(2, level('100.5', '4')),
    75	    ...field(3, s('spot@public.limit.depth.v3.api.pb')),
    76	  ];
    77	  const msg = Uint8Array.from([
    78	    ...field(1, s('spot@public.limit.depth.v3.api.pb@LINKUSDT@20')),
    79	    ...field(3, s('LINKUSDT')),
    80	    ...varint(6 * 8), ...varint(1_795_193_165_568), // sendTime int64
    81	    ...field(303, depth),
    82	  ]);
    83	  const d = decodeDepthPush(msg)!;
    84	  assert.equal(d.symbol, 'LINKUSDT');
    85	  assert.deepEqual(d.asks, [[101, 1], [101.5, 2]]); // sorted best first
    86	  assert.deepEqual(d.bids, [[100.5, 4], [100, 3]]);
    87	  assert.equal(decodeDepthPush(Uint8Array.from(field(1, s('x')))), null);
    88	});
    89	
    90	test('MEXC signed request: HMAC over the exact query + API key header', async () => {
    91	  let url = '';
    92	  let headers: Record<string, string> = {};
    93	  const fetchFn = (async (u: string, o: { headers: Record<string, string> }) => {
    94	    url = u;
    95	    headers = o.headers;
    96	    return new Response(JSON.stringify({ orderId: '42' }), { status: 200 });
    97	  }) as unknown as typeof fetch;
    98	  const m = new MexcRest('KEY', 'SECRET', 'https://api.mexc.com', fetchFn);
    99	  await m.limitOrder('LINKUSDT', 'SELL', '1.50', '10.123');
   100	  const u = new URL(url);
   101	  const sig = u.searchParams.get('signature');
   102	  u.searchParams.delete('signature');
   103	  assert.equal(sig, crypto.createHmac('sha256', 'SECRET').update(u.searchParams.toString()).digest('hex'));
   104	  assert.equal(headers['X-MEXC-APIKEY'], 'KEY');
   105	  assert.equal(u.searchParams.get('type'), 'LIMIT');
   106	});
   107	
   108	test('MEXC errors never contain the secret', async () => {
   109	  registerSecrets(['SUPERSECRETVALUE']);
   110	  const fetchFn = (async () => new Response('bad SUPERSECRETVALUE', { status: 400 })) as unknown as typeof fetch;
   111	  await assert.rejects(new MexcRest('k', 'SUPERSECRETVALUE', 'https://x', fetchFn).balances(), (e: Error) => !e.message.includes('SUPERSECRETVALUE'));
   112	  assert.equal(redact('key=SUPERSECRETVALUE'), 'key=***');
   113	});
   114	
   115	const AH = '0x0000000000001fF3684f28c67538d4D072C22734'; // 0x AllowanceHolder (mixed case like the API)
   116	const zeroExWith = (body: object) =>
   117	  new ZeroEx('k', (async (_u: string, o: { headers: Record<string, string> }) => {
   118	    assert.equal(o.headers['0x-version'], 'v2');
   119	    return new Response(JSON.stringify({ liquidityAvailable: true, buyAmount: '1000', minBuyAmount: '990', ...body }));
   120	  }) as unknown as typeof fetch);
   121	const req = { sellToken: '0xa', buyToken: '0xb', sellAmount: 5n, taker: '0xt', slippageBps: 30 };
   122	
   123	test('0x quote parsing: amounts, gas, spender, tx', async () => {
   124	  const q = await zeroExWith({
   125	    issues: { allowance: { spender: AH } },
   126	    transaction: { to: AH, data: '0xabc', gas: '150000', value: '0' },
   127	  }).quote(req);
   128	  assert.equal(q.buyAmount, 1000n);
   129	  assert.equal(q.minBuyAmount, 990n);
   130	  assert.equal(q.gas, 150000n);
   131	  assert.equal(q.spender, ZEROX_ALLOWANCE_HOLDER);
   132	  assert.equal(q.tx?.data, '0xabc');
   133	  // no allowance issue -> spender is still the AllowanceHolder, never tx.to blindly
   134	  const p = await zeroExWith({ transaction: { to: AH, data: '0x', gas: '1', value: '0' } }).quote(req);
   135	  assert.equal(p.spender, ZEROX_ALLOWANCE_HOLDER);
   136	});
   137	
   138	test('0x response pointing at an unknown contract is rejected (allowlist)', async () => {
   139	  await assert.rejects(
   140	    zeroExWith({ transaction: { to: '0x000000000000000000000000000000000000bad1', data: '0x', gas: '1', value: '0' } }).quote(req),
   141	    /not the allowlisted contract/,
   142	  );
   143	  await assert.rejects(zeroExWith({ issues: { allowance: { spender: '0x000000000000000000000000000000000000bad2' } } }).price(req), /allowlisted/);
   144	});
   145	
   146	test('placeSafely: a timed-out order that WAS placed is found by client id; one that was not is reported', async () => {
   147	  const sleep = async () => {};
   148	  const ambiguous = async (): Promise<{ orderId: string }> => {
   149	    throw new AmbiguousRequestError('timeout');
   150	  };
   151	  const found = await placeSafely({ getOrderByClientId: async () => ({ orderId: '77' }) as never }, 'X', 'cid', ambiguous, sleep);
   152	  assert.equal(found.orderId, '77');
   153	  await assert.rejects(placeSafely({ getOrderByClientId: async () => null }, 'X', 'cid', ambiguous, sleep), /timeout/);
   154	  await assert.rejects(
   155	    placeSafely({ getOrderByClientId: async () => { throw new Error('down'); } }, 'X', 'cid', ambiguous, sleep),
   156	    /UNKNOWN_ORDER_STATE/,
   157	  );
   158	  // a clear rejection is not looked up at all
   159	  let looked = false;
   160	  await assert.rejects(
   161	    placeSafely({ getOrderByClientId: async () => ((looked = true), null) }, 'X', 'cid', async () => { throw new Error('insufficient balance'); }, sleep),
   162	    /insufficient/,
   163	  );
   164	  assert.equal(looked, false);
   165	});
   166	
   167	test('config validation rejects dangerous values', () => {
   168	  process.env.RPC_URL = 'http://x';
   169	  process.env.MODE = 'paper';
   170	  const ok = loadConfig();
   171	  assert.doesNotThrow(() => validateConfig(ok));
   172	  assert.throws(() => validateConfig({ ...ok, minProfitBps: -1 }), /MIN_PROFIT_BPS/);
   173	  assert.throws(() => validateConfig({ ...ok, dexSlippageBps: 20_000 }), /DEX_SLIPPAGE_BPS/);
   174	  assert.throws(() => validateConfig({ ...ok, minTradeUsd: 500, maxTradeUsd: 200 }), /MIN_TRADE_USD/);
   175	});
   176	
   177	test('Telegram only obeys the admin user in a private chat', async () => {
   178	  const sent: string[] = [];
   179	  const fetchFn = (async (_u: string, o: { body: string }) => {
   180	    sent.push(JSON.parse(o.body).text);
   181	    return new Response(JSON.stringify({ ok: true, result: {} }));
   182	  }) as unknown as typeof fetch;
   183	  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn, '42');
   184	  let stopped = 0;
   185	  const handlers = { '/stop': () => (stopped++, 'stopped') };
   186	  await tg.handle({ message: { chat: { id: 999, type: 'private' }, from: { id: 42 }, text: '/stop' } }, handlers); // other chat
   187	  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 13 }, text: '/stop' } }, handlers); // wrong user
   188	  await tg.handle({ message: { chat: { id: 777, type: 'group' }, from: { id: 42 }, text: '/stop' } }, handlers); // group
   189	  assert.equal(stopped, 0);
   190	  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 42 }, text: '/stop@MyBot' } }, handlers);
   191	  assert.equal(stopped, 1);
   192	  assert.deepEqual(sent, ['stopped']);
   193	});
   194	
   195	test('MEXC rules: step from baseAssetPrecision, min qty from baseSizePrecision, notional and side checks', async () => {
   196	  const { rulesFrom, orderProblem } = await import('../src/mexc/rules.js');
   197	  // real ETHUSDT values from exchangeInfo
   198	  const r = rulesFrom({ symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0.0001', baseAssetPrecision: 5, quotePrecision: 2, orderTypes: ['LIMIT', 'MARKET', 'LIMIT_MAKER'], quoteAmountPrecision: '1', maxQuoteAmount: '4000000', tradeSideType: 1 });
   199	  assert.equal(r.qtyStep, 1e-5);
   200	  assert.equal(r.minQty, 0.0001);
   201	  assert.equal(orderProblem(r, 'BUY', 0.01, 1600), null);
   202	  assert.match(orderProblem(r, 'BUY', 0.00005, 1600)!, /minimum 0.0001/);
   203	  assert.match(orderProblem(r, 'BUY', 0.0005, 1600)!, /< minimum 1 USDT/);
   204	  assert.match(orderProblem(r, 'BUY', 0.01, 1600, 'IMMEDIATE_OR_CANCEL')!, /not allowed/);
   205	  assert.match(orderProblem({ ...r, tradeSideType: 3 }, 'BUY', 0.01, 1600)!, /sell-only/);
   206	  assert.match(orderProblem({ ...r, tradeSideType: 2 }, 'SELL', 0.01, 1600)!, /buy-only/);
   207	});
   208	
   209	test('toUnits truncates, never rounds up', async () => {
   210	  const { toUnits } = await import('../src/util.js');
   211	  assert.equal(toUnits(0.1239999999, 3), 123n);
   212	  assert.equal(toUnits(1.9999999, 6), 1999999n);
   213	  assert.equal(toUnits(0, 6), 0n);
   214	});
   215	
   216	test('0x requests use slippagePpm (slippageBps is deprecated) and refuse unsafe firm quotes', async () => {
   217	  let url = '';
   218	  const z = (body: object) =>
   219	    new ZeroEx('k', (async (u: string) => {
   220	      url = u;
   221	      return new Response(JSON.stringify({ liquidityAvailable: true, buyAmount: '1', minBuyAmount: '1', transaction: { to: AH, data: '0x', gas: '1', value: '0' }, ...body }));
   222	    }) as unknown as typeof fetch);
   223	  await z({}).quote(req);
   224	  assert.match(url, /slippagePpm=3000/);
   225	  assert.doesNotMatch(url, /slippageBps/);
   226	  await assert.rejects(z({ issues: { balance: { actual: '0' } } }).quote(req), /balance/);
   227	  await assert.rejects(z({ issues: { simulationIncomplete: true } }).quote(req), /simulation incomplete/);
   228	});
   229	
   230	test('Risk: loss limit, fail streak, trade limit, kill switch', () => {
   231	  const db = new Db(':memory:');
   232	  const now = Date.UTC(2026, 10, 20, 6);
   233	  const risk = new Risk(db, 'live', { maxTradesPerDay: 3, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
   234	  const row = (pnl: number, status: 'ok' | 'one_sided') =>
   235	    db.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: pnl, status, dex_tx: null, cex_order_id: null, note: null });
   236	
   237	  assert.equal(risk.blockReason(), null);
   238	  row(-10, 'one_sided');
   239	  assert.deepEqual(risk.afterTrade('one_sided'), []);
   240	  row(-10, 'one_sided');
   241	  risk.afterTrade('one_sided');
   242	  row(-5, 'one_sided');
   243	  const ev = risk.afterTrade('one_sided');
   244	  assert.ok(ev.some((e) => e.kind === 'fail_streak'));
   245	  assert.match(risk.blockReason()!, /paused/);
   246	
   247	  risk.resume();
   248	  assert.match(risk.blockReason()!, /trade limit/); // 3 trades today
   249	
   250	  const db2 = new Db(':memory:');
   251	  const r2 = new Risk(db2, 'live', { maxTradesPerDay: 20, dailyLossLimitUsd: 30, maxConsecutiveFails: 3 }, () => now);
   252	  db2.insertTrade({ ts: now, day: '2026-11-20', mode: 'live', symbol: 'X', direction: 'DEX_BUY', size_usd: 100, qty: 1, buy_price: 1, sell_price: 1, expected_net: 1, cex_fee_usd: 0, gas_usd: 1, pnl_usd: -31, status: 'ok', dex_tx: null, cex_order_id: null, note: null });
   253	  assert.ok(r2.afterTrade('ok').some((e) => e.kind === 'loss_limit'));
   254	  assert.match(r2.blockReason()!, /loss limit/);
   255	  r2.resume();
   256	  assert.match(r2.blockReason()!, /daily loss limit/); // /start cannot override today's loss limit
   257	
   258	  r2.pause('Telegram /stop');
   259	  assert.match(r2.blockReason()!, /Telegram \/stop/);
   260	});
   261	
   262	test('ethNetwork finds the Ethereum entry in MEXC coin config', () => {
   263	  const n = ethNetwork({
   264	    coin: 'LINK',
   265	    networkList: [
   266	      { coin: 'LINK', network: 'BNB Smart Chain(BEP20)', netWork: 'BSC', contract: '0xbsc', depositEnable: true, withdrawEnable: true },
   267	      { coin: 'LINK', network: 'Ethereum(ERC20)', netWork: 'ETH', contract: '0xeth', depositEnable: true, withdrawEnable: false },
   268	    ],
   269	  });
   270	  assert.equal(n?.contract, '0xeth');
   271	});
   272	
   273	test('transfer strategy refuses to start without ALLOW_WITHDRAWALS=yes; safe defaults', () => {
   274	  const saved = { ...process.env };
   275	  try {
   276	    for (const k of ['MODE', 'STRATEGY', 'ALLOW_WITHDRAWALS', 'MAX_TRADE_USD']) delete process.env[k];
   277	    process.env.RPC_URL = 'http://x';
   278	    const d = loadConfig();
   279	    assert.equal(d.mode, 'paper');
   280	    assert.equal(d.strategy, 'inventory');
   281	    assert.equal(d.maxTradeUsd, 50);
   282	    process.env.STRATEGY = 'transfer';
   283	    assert.throws(() => loadConfig(), /ALLOW_WITHDRAWALS=yes/);
   284	    process.env.ALLOW_WITHDRAWALS = 'yes';
   285	    assert.equal(loadConfig().strategy, 'transfer');
   286	  } finally {
   287	    process.env = saved;
   288	  }
   289	});
   290	
   291	test('UNLIMITED_APPROVAL defaults to off (exact approvals); yes turns it on', () => {
   292	  const saved = { ...process.env };
   293	  try {
   294	    delete process.env.UNLIMITED_APPROVAL;
   295	    process.env.RPC_URL = 'http://x';
   296	    process.env.MODE = 'paper';
   297	    assert.equal(loadConfig().unlimitedApproval, false);
   298	    process.env.UNLIMITED_APPROVAL = 'yes';
   299	    assert.equal(loadConfig().unlimitedApproval, true);
   300	    process.env.UNLIMITED_APPROVAL = 'no';
   301	    assert.equal(loadConfig().unlimitedApproval, false);
   302	  } finally {
   303	    process.env = saved;
   304	  }
   305	});
   306	
   307	test('RPC URLs (they contain provider keys) are redacted', () => {
   308	  process.env.RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/SECRETKEY123';
   309	  process.env.MODE = 'paper';
   310	  delete process.env.STRATEGY;
   311	  const c = loadConfig();
   312	  registerSecrets(secretsOf(c));
   313	  assert.equal(redact('rpc https://eth-mainnet.g.alchemy.com/v2/SECRETKEY123 failed'), 'rpc *** failed');
   314	});
   315	
   316	test('default economics: profit floor is small vs trade size; $15 on $50 is rejected', () => {
   317	  const saved = { ...process.env };
   318	  try {
   319	    for (const k of ['MIN_PROFIT_USD', 'MAX_TRADE_USD', 'MODE', 'STRATEGY']) delete process.env[k];
   320	    process.env.RPC_URL = 'http://x';
   321	    const d = validateConfig(loadConfig());
   322	    assert.ok(d.minProfitUsd <= d.maxTradeUsd * 0.1, `${d.minProfitUsd} vs ${d.maxTradeUsd}`);
   323	    assert.throws(() => validateConfig({ ...d, minProfitUsd: 15, maxTradeUsd: 50 }), /only fake gaps/);
   324	  } finally {
   325	    process.env = saved;
   326	  }
   327	});
   328	
   329	test('Telegram: a command sent before this start (replayed after restart) is ignored', async () => {
   330	  const tg = new Telegram('123456:TOKENTOKEN', '777', (async () => new Response(JSON.stringify({ ok: true, result: {} }))) as unknown as typeof fetch, '42');
   331	  let n = 0;
   332	  const handlers = { '/start': () => (n++, 'ok') };
   333	  const old = Math.floor(Date.now() / 1000) - 3600;
   334	  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 42 }, text: '/start confirm', date: old } }, handlers);
   335	  assert.equal(n, 0);
   336	  await tg.handle({ message: { chat: { id: 777, type: 'private' }, from: { id: 42 }, text: '/start confirm', date: Math.floor(Date.now() / 1000) + 1 } }, handlers);
   337	  assert.equal(n, 1);
   338	});
   339	
   340	test('aggressive close offset stays inside a tight PERCENT_PRICE_BY_SIDE band', async () => {
   341	  const { aggressiveOffset, rulesFrom } = await import('../src/mexc/rules.js');
   342	  const base = { symbol: 'X', baseAsset: 'X', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0', quotePrecision: 4, orderTypes: ['LIMIT'] };
   343	  assert.equal(aggressiveOffset(rulesFrom({ ...base, filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: '0.2', askMultiplierDown: '0.2' }] })), 0.02);
   344	  assert.equal(aggressiveOffset(rulesFrom({ ...base, filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: '0.02', askMultiplierDown: '0.02' }] })), 0.01);
   345	});
   346	
   347	test('MARKET orders use the market notional limits', async () => {
   348	  const { orderProblem } = await import('../src/mexc/rules.js');
   349	  const r = { qtyStep: 0.01, priceDecimals: 2, minQty: 0, minNotional: 1, maxNotional: 1e6, orderTypes: ['LIMIT', 'MARKET'], tradeSideType: 1, minNotionalMarket: 5 };
   350	  assert.equal(orderProblem(r, 'SELL', 1, 2, 'LIMIT'), null);
   351	  assert.match(orderProblem(r, 'SELL', 1, 2, 'MARKET')!, /minimum 5/);
   352	});
   353	
   354	test('cancelAndConfirm: never reports a still-open order as closed', async () => {
   355	  const { cancelAndConfirm, OrderStillOpenError } = await import('../src/engine.js');
   356	  const open = { getOrder: async () => ({ orderId: '1', status: 'NEW', executedQty: '0' }) as never, cancelOrder: async () => { throw new Error('timeout'); } };
   357	  await assert.rejects(cancelAndConfirm(open, 'X', '1', async () => {}), (e: unknown) => e instanceof OrderStillOpenError);
   358	  let st = 'NEW';
   359	  const ok = { getOrder: async () => ({ orderId: '1', status: st, executedQty: '0' }) as never, cancelOrder: async () => ((st = 'CANCELED'), {} as never) };
   360	  assert.equal((await cancelAndConfirm(ok, 'X', '1', async () => {})).status, 'CANCELED');
   361	});
   362	
   363	test('OPP_RETENTION_DAYS defaults to 7 (round-3 M5)', () => {
   364	  const saved = { ...process.env };
   365	  try {
   366	    delete process.env.OPP_RETENTION_DAYS;
   367	    process.env.RPC_URL = 'http://x';
   368	    assert.equal(loadConfig().oppRetentionDays, 7);
   369	  } finally {
   370	    process.env = saved;
   371	  }
   372	});
   373	
   374	test('L1_FEE_USD defaults to 0 (round-3 M1)', () => {
   375	  const saved = { ...process.env };
   376	  try {
   377	    delete process.env.L1_FEE_USD;
   378	    process.env.RPC_URL = 'http://x';
   379	    assert.equal(loadConfig().l1FeeUsd, 0);
   380	  } finally {
   381	    process.env = saved;
   382	  }
   383	});
```

## `test/pricing.test.ts`

```
     1	import { test } from 'node:test';
     2	import assert from 'node:assert/strict';
     3	import {
     4	  evaluateCexBuy,
     5	  evaluateDexBuy,
     6	  fillBase,
     7	  fillQuote,
     8	  gasUsd,
     9	  planCexBuy,
    10	  planCexBuyQty,
    11	  threshold,
    12	  unwindPlan,
    13	} from '../src/pricing.js';
    14	import { floorToStep, toFloat, toUnits, dhakaDay } from '../src/util.js';
    15	
    16	const costs = { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 };
    17	const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
    18	
    19	test('fillBase / fillQuote walk the book', () => {
    20	  const asks: [number, number][] = [[10, 5], [11, 5]];
    21	  assert.deepEqual(fillBase(asks, 7), { quote: 72, worst: 11 });
    22	  assert.equal(fillBase(asks, 11), null);
    23	  const q = fillQuote(asks, 72)!;
    24	  close(q.qty, 7);
    25	  assert.equal(q.worst, 11);
    26	  assert.equal(fillQuote(asks, 1000), null);
    27	});
    28	
    29	test('threshold = max(USD floor, bps of size)', () => {
    30	  assert.equal(threshold(200, 15, 50), 15);
    31	  assert.equal(threshold(10_000, 15, 50), 50);
    32	  assert.equal(threshold(100, 0.25, 20), 0.25);
    33	  assert.equal(threshold(500, 0.25, 20), 1);
    34	});
    35	
    36	test('evaluateDexBuy: sells only what the DEX guarantees, every cost subtracted', () => {
    37	  // $200 on DEX buys 20 tokens expected, 19.9 guaranteed; MEXC bid 11 -> sell 19.9 for $218.90.
    38	  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.9, bids: [[11, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
    39	  const proceeds = 19.9 * 11;
    40	  close(o.net, proceeds - proceeds * 0.0005 - 200 - 3 - proceeds * 0.002 - 2);
    41	  assert.equal(o.cexQty, 19.9);
    42	  close(o.cexLimitPrice, 11 * 0.998);
    43	  close(o.buyPrice, 10);
    44	  close(o.sellPrice, 11);
    45	});
    46	
    47	test('evaluateDexBuy: dust below the MEXC step is kept as inventory, not counted as profit', () => {
    48	  const o = evaluateDexBuy({ sizeUsd: 100, tokensOut: 10.005, tokensMin: 10.005, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 0, costs: { ...costs, takerFee: 0, cexSlippageBps: 0, safetyMarginUsd: 0 } })!;
    49	  assert.equal(o.cexQty, 10);
    50	  close(o.net, 0.05, 1e-9); // 100 proceeds - (100 - 0.05 dust value)
    51	});
    52	
    53	test('planCexBuy + evaluateCexBuy: fee is paid in tokens, so fewer tokens are sold on DEX', () => {
    54	  const plan = planCexBuy({ sizeUsd: 200, asks: [[10, 100]], qtyStep: 0.01, takerFee: 0.0005 })!;
    55	  assert.equal(plan.qty, 20);
    56	  close(plan.costUsd, 200);
    57	  close(plan.tokensToSell, 20 * 0.9995);
    58	  const o = evaluateCexBuy({ plan, usdcOut: 230, usdcMin: 229, gasUsd: 3, costs });
    59	  close(o.net, 230 - 200 - 3 - (200 * 0.002 + 1) - 2);
    60	  assert.deepEqual(planCexBuyQty([[10, 100]], 20, 0.0005), plan);
    61	});
    62	
    63	test('no opportunity when prices are equal', () => {
    64	  const o = evaluateDexBuy({ sizeUsd: 200, tokensOut: 20, tokensMin: 19.94, bids: [[10, 100]], qtyStep: 0.01, gasUsd: 3, costs })!;
    65	  assert.ok(o.net < 0);
    66	});
    67	
    68	test('gasUsd', () => {
    69	  close(gasUsd(200_000n, 20_000_000_000n, 2000), 8); // 200k gas * 20 gwei = 0.004 ETH
    70	});
    71	
    72	test('unwindPlan covers every one-sided case', () => {
    73	  assert.equal(unwindPlan('DEX_BUY', true, 10, 10, 0.0005, 0.01), null); // both filled
    74	  assert.deepEqual(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.side, 'SELL');
    75	  assert.equal(unwindPlan('DEX_BUY', true, 10, 4, 0.0005, 0.01)?.qty, 6);
    76	  assert.deepEqual(unwindPlan('DEX_BUY', false, 10, 10, 0.0005, 0.01)?.side, 'BUY');
    77	  assert.equal(unwindPlan('DEX_BUY', false, 10, 0, 0.0005, 0.01), null); // nothing happened
    78	  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.qty, 3);
    79	  assert.equal(unwindPlan('CEX_BUY', true, 10, 7, 0.0005, 0.01)?.side, 'BUY');
    80	  const u = unwindPlan('CEX_BUY', false, 10, 10, 0.0005, 0.01)!;
    81	  assert.equal(u.side, 'SELL');
    82	  assert.equal(u.qty, 9.99); // sell only what we received after the fee
    83	});
    84	
    85	test('util conversions', () => {
    86	  assert.equal(floorToStep(1.23456, 0.01), 1.23);
    87	  assert.equal(floorToStep(0.3, 0.1), 0.3);
    88	  assert.equal(toUnits(123.456789, 6), 123456789n);
    89	  assert.equal(toUnits(1.5e-7, 18), 150000000000n);
    90	  assert.equal(toUnits(0.1, 18), 100000000000000000n); // exactly, not 100000000000000005
    91	  assert.equal(toUnits(1, 18), 10n ** 18n);
    92	  assert.equal(toFloat(1_500_000n, 6), 1.5);
    93	  assert.equal(toFloat(5n, 18), 5e-18);
    94	  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 18, 30)), '2026-01-02'); // 00:30 in Dhaka
    95	  assert.equal(dhakaDay(Date.UTC(2026, 0, 1, 17, 59)), '2026-01-01');
    96	});
```

## `test/telegram.test.ts`

```
     1	// Telegram mode tag: every message carries 📝 PAPER or 🔴 LIVE on its first line,
     2	// so the two bots sharing one chat can never be confused.
     3	import { test } from 'node:test';
     4	import assert from 'node:assert/strict';
     5	import { Telegram } from '../src/telegram.js';
     6	
     7	function capture() {
     8	  const sent: string[] = [];
     9	  const fetchFn = (async (_u: string, o: { body: string }) => {
    10	    sent.push(JSON.parse(o.body).text);
    11	    return new Response(JSON.stringify({ ok: true, result: {} }));
    12	  }) as unknown as typeof fetch;
    13	  return { sent, fetchFn };
    14	}
    15	
    16	test('Telegram send() prepends the mode tag as the first line', async () => {
    17	  const { sent, fetchFn } = capture();
    18	  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn, '42', undefined, '🔴 LIVE — আসল টাকা');
    19	  await tg.send('Rebalance ticket: withdraw USDC MEXC→wallet');
    20	  assert.deepEqual(sent, ['🔴 LIVE — আসল টাকা\nRebalance ticket: withdraw USDC MEXC→wallet']);
    21	});
    22	
    23	test('Telegram send() does not double a tag the text already starts with', async () => {
    24	  const { sent, fetchFn } = capture();
    25	  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn, '42', undefined, '📝 PAPER');
    26	  await tg.send('📝 PAPER BGB CEX_BUY\nBuy @ 1.55 | Sell @ 1.56');
    27	  assert.deepEqual(sent, ['📝 PAPER BGB CEX_BUY\nBuy @ 1.55 | Sell @ 1.56']);
    28	});
    29	
    30	test('Telegram send() without a tag sends the text unchanged', async () => {
    31	  const { sent, fetchFn } = capture();
    32	  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn, '42');
    33	  await tg.send('plain message');
    34	  assert.deepEqual(sent, ['plain message']);
    35	});
```

## `test/transfer.test.ts`

```
     1	// Transfer strategy: scan -> buy MEXC -> withdraw -> wait -> sell DEX, with fakes.
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { loadConfig } from '../src/config.js';
     5	import { Db } from '../src/db.js';
     6	import { Risk } from '../src/risk.js';
     7	import { TransferEngine, type TransferMexc, type TransferChain } from '../src/transfer.js';
     8	import { findGaps, loadUniverse, type ScanToken } from '../src/scanner.js';
     9	import { evaluateTransfer, planCexBuy } from '../src/pricing.js';
    10	import type { Quote, QuoteRequest } from '../src/dex/aggregator.js';
    11	import { BestOf, type Aggregator } from '../src/dex/aggregator.js';
    12	import { AmbiguousRequestError, type Order } from '../src/mexc/rest.js';
    13	
    14	const GWEI = 1_000_000_000n;
    15	const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    16	const XYZ = '0x1111111111111111111111111111111111111111';
    17	
    18	const symbolInfo = (base: string) => ({
    19	  symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true,
    20	  baseSizePrecision: '0.01', quotePrecision: 4, orderTypes: ['LIMIT', 'MARKET'],
    21	});
    22	const coin = (base: string, contract: string, dep = true, wd = true) => ({
    23	  coin: base,
    24	  networkList: [{ coin: base, network: 'Ethereum(ERC20)', netWork: 'ETH', contract, depositEnable: dep, withdrawEnable: wd, withdrawFee: '1', withdrawMin: '10' }],
    25	});
    26	
    27	function setup(
    28	  o: {
    29	    dexPrice?: number;
    30	    withdrawThrows?: boolean;
    31	    withdrawAmbiguous?: boolean;
    32	    withdrawStatus?: number;
    33	    db?: Db;
    34	    mode?: 'live' | 'paper';
    35	    sendFails?: boolean;
    36	    sendUnknown?: boolean;
    37	    firmDexPrice?: number; // price the FIRM quote (after approval) sees; first quote uses dexPrice
    38	    agg?: Aggregator; // override the fake aggregator (e.g. a BestOf of two fakes)
    39	    now?: () => number;
    40	    extraTokens?: { base: string; contract: string }[]; // extra ERC20 tokens that pass the base filters
    41	    provenFilter?: (tokens: ScanToken[]) => ScanToken[]; // live proven-only filter
    42	  } = {},
    43	) {
    44	  process.env.MODE = o.mode ?? 'live';
    45	  process.env.STRATEGY = 'transfer';
    46	  process.env.ALLOW_WITHDRAWALS = 'yes';
    47	  process.env.RPC_URL = 'http://localhost';
    48	  process.env.MAX_TRADE_USD = '200'; // tests use $200 trades (default is 50)
    49	  process.env.MIN_PROFIT_USD = '15';
    50	  // These older tests keep the pre-upgrade cost settings, so their numbers stay meaningful.
    51	  process.env.MIN_PROFIT_BPS = '50';
    52	  process.env.SAFETY_MARGIN_USD = '2';
    53	  process.env.SAFETY_MARGIN_BPS = '0';
    54	  process.env.CEX_SLIPPAGE_BPS = '20';
    55	  process.env.PRIVATE_KEY = '0x' + '22'.repeat(32);
    56	  process.env.MEXC_API_KEY = 'k'.repeat(10);
    57	  process.env.MEXC_API_SECRET = 's'.repeat(10);
    58	  const cfg = loadConfig();
    59	  const db = o.db ?? new Db(':memory:');
    60	  const risk = new Risk(db, cfg.mode, cfg);
    61	  const alerts: string[] = [];
    62	  const calls: string[] = [];
    63	  const dexPrice = o.dexPrice ?? 1.15;
    64	  const state = {
    65	    mexc: { USDT: 1000, XYZ: 0 } as Record<string, number>,
    66	    wallet: { [XYZ]: 0n, [USDC]: 0n } as Record<string, bigint>,
    67	    withdrawStatus: o.withdrawStatus ?? 4,
    68	    dexPrice,
    69	    withdrawals: [] as { id: string; status: number; amount: string; withdrawOrderId?: string }[],
    70	  };
    71	  const orders = new Map<string, Order>();
    72	  let lastQuote: QuoteRequest | null = null;
    73	
    74	  const extra = o.extraTokens ?? [];
    75	  const mexc: TransferMexc = {
    76	    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('BAD'), ...extra.map((t) => symbolInfo(t.base))],
    77	    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9000000', lastPrice: '1' }, { symbol: 'BADUSDT', quoteVolume: '9000000', lastPrice: '1' }, ...extra.map((t) => ({ symbol: `${t.base}USDT`, quoteVolume: '9000000', lastPrice: '1' }))],
    78	    coinConfigs: async () => [coin('XYZ', XYZ), coin('BAD', '0x2222222222222222222222222222222222222222', true, false), ...extra.map((t) => coin(t.base, t.contract))],
    79	    bookTickers: async () => new Map([['XYZUSDT', { bid: 0.999, ask: 1.0 }], ['ETHUSDT', { bid: 2000, ask: 2000 }], ['USDCUSDT', { bid: 1, ask: 1 }]]),
    80	    depth: async () => ({ bids: [[0.999, 1e6]], asks: [[1.0, 1e6]], ts: Date.now() }),
    81	    balances: async () => ({ ...state.mexc }),
    82	    limitOrder: async (_s, side, q, p) => {
    83	      calls.push(`limit ${side} ${q} @ ${p}`);
    84	      const qty = Number(q);
    85	      state.mexc.USDT -= qty * 1.0;
    86	      state.mexc.XYZ += qty * (1 - cfg.mexcTakerFee);
    87	      orders.set('b1', { orderId: 'b1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(qty * 1.0), origQty: q, price: p, side });
    88	      return { orderId: 'b1' };
    89	    },
    90	    marketSell: async (_s, q) => {
    91	      calls.push(`market SELL ${q}`);
    92	      state.mexc.XYZ -= Number(q);
    93	      orders.set('s1', { orderId: 's1', status: 'FILLED', executedQty: q, cummulativeQuoteQty: String(Number(q) * 0.999), origQty: q, price: '0', side: 'SELL' });
    94	      return { orderId: 's1' };
    95	    },
    96	    getOrder: async (_s, id) => orders.get(id)!,
    97	    getOrderByClientId: async () => null,
    98	    cancelOrder: async (_s, id) => orders.get(id)!,
    99	    withdraw: async (p) => {
   100	      calls.push(`withdraw ${p.amount} ${p.coin} ${p.netWork} -> ${p.address}`);
   101	      if (o.withdrawThrows) throw new Error('no withdraw permission');
   102	      state.mexc.XYZ -= Number(p.amount);
   103	      state.withdrawals.push({ id: 'w1', status: 4, amount: p.amount, withdrawOrderId: p.withdrawOrderId });
   104	      if (o.withdrawAmbiguous) throw new AmbiguousRequestError('timeout');
   105	      return 'w1';
   106	    },
   107	    findWithdraw: async (_c, _since, ref) => {
   108	      const w = state.withdrawals.find((x) => (ref.id && x.id === ref.id) || (ref.withdrawOrderId && x.withdrawOrderId === ref.withdrawOrderId));
   109	      return w ? { ...w, status: state.withdrawStatus } : null;
   110	    },
   111	  };
   112	
   113	  let firmCalls = 0;
   114	  const quote = (r: QuoteRequest, firm: boolean): Quote => {
   115	    // The firm quote after the approval may see a different price (round-3 M3 test).
   116	    const px = firm && firmCalls++ > 0 && o.firmDexPrice !== undefined ? o.firmDexPrice : state.dexPrice;
   117	    const out = (r.sellAmount * BigInt(Math.round(px * 1e6))) / 10n ** 18n; // token(18) -> USDC(6)
   118	    return { buyAmount: out, minBuyAmount: (out * 999n) / 1000n, gas: 150_000n, spender: '0xspender', tx: firm ? { to: '0xah', data: '0x01', value: 0n } : undefined };
   119	  };
   120	
   121	  const chain: TransferChain = {
   122	    address: '0xMyWallet',
   123	    gas: async () => ({ baseFee: 9n * GWEI, tip: GWEI, effective: 10n * GWEI, maxFee: 19n * GWEI }),
   124	    decimals: async () => 18,
   125	    tokenBalance: async (t) => state.wallet[t] ?? 0n,
   126	    approveExact: async (_t, s, amount) => {
   127	      calls.push(`approve ${s} ${amount}`);
   128	      return { ok: true, gasCostWei: 60_000n * 10n * GWEI };
   129	    },
   130	    simulate: async () => (calls.push('simulate'), 150_000n),
   131	    send: async () => {
   132	      calls.push('send');
   133	      if (o.sendUnknown) return { ok: false, unknown: true, hash: '0xhash', gasCostWei: 0n, reason: 'unknown' };
   134	      if (o.sendFails) return { ok: false, hash: '0xhash', gasCostWei: 0n, reason: 'reverted' };
   135	      const r = lastQuote!;
   136	      state.wallet[XYZ] -= r.sellAmount;
   137	      state.wallet[USDC] += quote(r, true).buyAmount;
   138	      return { ok: true, hash: '0xhash', gasCostWei: 150_000n * 10n * GWEI };
   139	    },
   140	  };
   141	
   142	  const engine = new TransferEngine({
   143	    cfg, mexc, chain, db, risk,
   144	    tg: { send: async (t) => void alerts.push(t) },
   145	    agg: o.agg ?? { name: '0x', price: async (r) => quote(r, false), quote: async (r) => ((lastQuote = r), quote(r, true)) },
   146	    dexPricesFn: async () => new Map([[XYZ, { price: dexPrice, tvl: 1e6 }]]),
   147	    sleep: async () => {},
   148	    now: o.now,
   149	    provenFilter: o.provenFilter,
   150	  });
   151	  // The withdrawal lands: MEXC reports SUCCESS (7) and the wallet balance grows.
   152	  const arrive = (tokens: number) => {
   153	    state.withdrawStatus = 7;
   154	    state.wallet[XYZ] += BigInt(Math.round(tokens * 1e6)) * 10n ** 12n;
   155	  };
   156	  return { engine, db, risk, alerts, calls, state, arrive, cfg };
   157	}
   158	
   159	test('loadUniverse keeps only ERC20 tokens with deposit AND withdraw open', async () => {
   160	  const { engine } = setup();
   161	  await engine.refreshUniverse(true);
   162	  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']); // BAD has withdrawals suspended
   163	  assert.equal(engine.universe[0].address, XYZ);
   164	  assert.equal(engine.universe[0].netWork, 'ETH');
   165	  assert.equal(engine.universe[0].withdrawFee, 1);
   166	});
   167	
   168	test('findGaps: filters TVL, too-small and absurd gaps, sorts biggest first', () => {
   169	  const rules = { qtyStep: 0.01, priceDecimals: 4, minQty: 0, minNotional: 1, maxNotional: 1e6, orderTypes: ['LIMIT'], tradeSideType: 1 };
   170	  const tok = (base: string, address: string): ScanToken => ({ base, symbol: `${base}USDT`, address, netWork: 'ETH', withdrawFee: 0, withdrawMin: 0, qtyStep: 0.01, priceDecimals: 4, volumeUsd: 1e6, rules });
   171	  const tokens = [tok('A', '0xa'), tok('B', '0xb'), tok('C', '0xc'), tok('D', '0xd'), tok('E', '0xe')];
   172	  const tickers = new Map(['A', 'B', 'C', 'D', 'E'].map((b) => [`${b}USDT`, { bid: 0.99, ask: 1 }]));
   173	  const dex = new Map([
   174	    ['0xa', { price: 1.05, tvl: 1e6 }], // 5%
   175	    ['0xb', { price: 1.1, tvl: 1e6 }], // 10%
   176	    ['0xc', { price: 1.1, tvl: 1000 }], // thin pool
   177	    ['0xd', { price: 1.01, tvl: 1e6 }], // 1% < min
   178	    ['0xe', { price: 3, tvl: 1e6 }], // 200%: broken / different token
   179	  ]);
   180	  const g = findGaps(tokens, tickers, dex, { minTvlUsd: 200_000, minGapPct: 3 });
   181	  assert.deepEqual(g.map((x) => x.token.base), ['B', 'A']);
   182	});
   183	
   184	test('evaluateTransfer subtracts withdraw fee, drift reserve and all costs', () => {
   185	  const plan = planCexBuy({ sizeUsd: 200, asks: [[1, 1e6]], qtyStep: 0.01, takerFee: 0.0005 })!;
   186	  const ev = evaluateTransfer({ plan, withdrawFeeTokens: 1, usdcOut: 228.7, usdcMin: 228.5, gasUsd: 4, driftBps: 150, costs: { takerFee: 0.0005, cexSlippageBps: 20, safetyMarginUsd: 2 } });
   187	  assert.ok(Math.abs(ev.arriving - (200 * 0.9995 - 1)) < 1e-9);
   188	  const expected = 228.7 - 200 - 4 - (0.4 + 0.2) - 228.7 * 0.015 - 2;
   189	  assert.ok(Math.abs(ev.net - expected) < 1e-9);
   190	});
   191	
   192	test('full cycle: buy on MEXC -> withdraw to own wallet -> wait -> sell on DEX -> PnL', async () => {
   193	  const { engine, db, calls, alerts, arrive } = setup();
   194	  await engine.tick(); // finds gap, buys, withdraws
   195	  assert.equal(calls[0], 'limit BUY 200.00 @ 1.0020');
   196	  assert.equal(calls[1], 'withdraw 199.90 XYZ ETH -> 0xMyWallet'); // only ever our own wallet
   197	  assert.equal(db.openTransfers()[0].status, 'withdrawing');
   198	  assert.ok(alerts.some((a) => a.startsWith('📤 TRANSFER #1 XYZ')));
   199	
   200	  await engine.tick(); // still on its way: nothing new is bought meanwhile
   201	  assert.equal(calls.filter((c) => c.startsWith('limit')).length, 1);
   202	
   203	  arrive(198.9); // 199.9 - 1 withdraw fee
   204	  await engine.tick();
   205	  assert.ok(calls.includes('approve 0xspender 198900000000000000000')); // exact amount
   206	  assert.ok(calls.includes('simulate') && calls.includes('send'));
   207	  assert.ok(!db.openTransfers().some((t) => t.id === 1)); // #1 done (a new one may start: gap still open)
   208	
   209	  const s = db.statsSince(0, 'live');
   210	  assert.equal(s.total.trades, 1);
   211	  assert.equal(s.total.failed, 0);
   212	  const usdcOut = Math.floor(198.9 * 1.15 * 1e6) / 1e6;
   213	  const gas = (0.0006 + 0.0015) * 2000;
   214	  assert.ok(Math.abs(s.total.pnl - (usdcOut - 200 - gas)) < 1e-6, String(s.total.pnl));
   215	  assert.ok(alerts.some((a) => a.includes('TRANSFER #1 XYZ done') && a.includes('Net PnL')));
   216	});
   217	
   218	test('restart while withdrawing: a new engine resumes the same transfer', async () => {
   219	  const first = setup();
   220	  await first.engine.tick();
   221	  // "restart": new engine, same database and balances
   222	  const second = setup({ db: first.db });
   223	  Object.assign(second.state, first.state);
   224	  second.state.wallet[XYZ] = BigInt(198.9e6) * 10n ** 12n;
   225	  second.state.withdrawStatus = 7; // MEXC reports SUCCESS
   226	  await second.engine.tick();
   227	  assert.ok(!first.db.openTransfers().some((t) => t.id === 1));
   228	  assert.equal(first.db.statsSince(0, 'live').total.trades, 1);
   229	});
   230	
   231	test('withdraw request times out: never re-sent, found later by withdrawOrderId', async () => {
   232	  const { engine, db, calls, arrive } = setup({ withdrawAmbiguous: true });
   233	  await engine.tick();
   234	  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
   235	  await engine.tick(); // looks it up instead of withdrawing again
   236	  assert.equal(calls.filter((c) => c.startsWith('withdraw')).length, 1);
   237	  assert.equal(db.getTransfer(1)!.withdraw_id, 'w1');
   238	  arrive(198.9);
   239	  await engine.tick();
   240	  assert.equal(db.getTransfer(1)!.status, 'done');
   241	});
   242	
   243	test('price fell during the withdrawal: holds instead of selling at a big loss; /sell overrides', async () => {
   244	  let t = Date.UTC(2026, 10, 20, 6);
   245	  const { engine, db, calls, alerts, arrive, state } = setup({ now: () => t });
   246	  await engine.tick();
   247	  state.dexPrice = 0.9; // 10% below the MEXC buy price
   248	  arrive(198.9);
   249	  await engine.tick();
   250	  assert.ok(!calls.includes('send'));
   251	  assert.equal(db.getTransfer(1)!.status, 'selling');
   252	  assert.ok(alerts.some((a) => a.startsWith('✋ TRANSFER #1 XYZ') && a.includes('/sell 1')));
   253	  t += 6 * 60_000;
   254	  await engine.tick();
   255	  assert.ok(!calls.includes('send')); // still holding
   256	  assert.match(engine.forceSell(1), /selling on the next scan/);
   257	  await engine.tick();
   258	  assert.ok(calls.includes('send'));
   259	  assert.equal(db.getTransfer(1)!.status, 'done');
   260	});
   261	
   262	test('failed DEX sales back off, then stop retrying (no gas burn loop)', async () => {
   263	  let t = Date.UTC(2026, 10, 20, 6);
   264	  const { engine, db, calls, alerts, arrive } = setup({ sendFails: true, now: () => t });
   265	  await engine.tick();
   266	  arrive(198.9);
   267	  await engine.tick(); // attempt 1
   268	  await engine.tick(); // inside backoff: no attempt
   269	  assert.equal(calls.filter((c) => c === 'send').length, 1);
   270	  for (const wait of [2, 10, 30]) {
   271	    t += wait * 60_000 + 1;
   272	    await engine.tick();
   273	  }
   274	  assert.equal(calls.filter((c) => c === 'send').length, 4);
   275	  assert.equal(db.getTransfer(1)!.status, 'stuck');
   276	  t += 24 * 3600_000;
   277	  await engine.tick();
   278	  assert.equal(calls.filter((c) => c === 'send').length, 4); // no more automatic tries
   279	  assert.ok(alerts.some((a) => a.includes('Automatic retries STOPPED')));
   280	  assert.match(engine.clear(1), /closed manually/);
   281	});
   282	
   283	test('swap outcome unknown: stuck + paused, never retried automatically', async () => {
   284	  const { engine, db, risk, calls, arrive } = setup({ sendUnknown: true });
   285	  await engine.tick();
   286	  arrive(198.9);
   287	  await engine.tick();
   288	  assert.equal(db.getTransfer(1)!.status, 'stuck');
   289	  assert.equal(risk.paused, true);
   290	  await engine.tick();
   291	  assert.equal(calls.filter((c) => c === 'send').length, 1);
   292	});
   293	
   294	test('withdrawal never arrives: after 2x timeout it stops blocking, but never a 2nd transfer of the same token', async () => {
   295	  let t = Date.UTC(2026, 10, 20, 6);
   296	  const { engine, db, calls, alerts, cfg } = setup({ now: () => t });
   297	  await engine.tick();
   298	  t += (cfg.transferTimeoutMin + 1) * 60_000;
   299	  await engine.tick();
   300	  assert.ok(alerts.some((a) => a.includes('not in wallet after')));
   301	  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 1); // still blocking
   302	  t += cfg.transferTimeoutMin * 60_000;
   303	  await engine.tick(); // gives up blocking
   304	  assert.equal(db.getTransfer(1)!.alerted_timeout, 2);
   305	  assert.equal(db.getTransfer(1)!.status, 'withdrawing'); // still watched
   306	  await engine.tick();
   307	  // It no longer blocks by COUNT, but a second transfer of the SAME token must never start while
   308	  // the first is still out (they would share one wallet balance).
   309	  assert.equal(calls.filter((c) => c.startsWith('limit BUY')).length, 1);
   310	  assert.equal(db.blockingTransfers().length, 0);
   311	});
   312	
   313	test('withdraw rejected: sells the tokens back on MEXC and records a failure', async () => {
   314	  const { engine, db, calls, alerts } = setup({ withdrawThrows: true });
   315	  await engine.tick();
   316	  assert.ok(calls.includes('market SELL 199.90'));
   317	  assert.equal(db.openTransfers().length, 0);
   318	  assert.equal(db.statsSince(0, 'live').total.failed, 1);
   319	  assert.ok(alerts.some((a) => a.includes('withdraw rejected')));
   320	});
   321	
   322	test('withdrawal FAILED on MEXC side: sells back on MEXC', async () => {
   323	  const { engine, db, calls, state } = setup();
   324	  await engine.tick();
   325	  state.withdrawStatus = 8;
   326	  state.mexc.XYZ += 199.9; // funds returned to the MEXC account
   327	  await engine.tick();
   328	  assert.ok(calls.includes('market SELL 199.90'));
   329	  assert.ok(!db.openTransfers().some((t) => t.id === 1));
   330	});
   331	
   332	test('gap too small after exact costs: nothing happens', async () => {
   333	  const { engine, calls } = setup({ dexPrice: 1.05 }); // 5% gap, but drift+gas+fees+min $15 eat it
   334	  await engine.tick();
   335	  assert.deepEqual(calls, []);
   336	});
   337	
   338	test('paused bot does not open new transfers', async () => {
   339	  const { engine, risk, calls } = setup();
   340	  risk.pause('Telegram /stop');
   341	  await engine.tick();
   342	  assert.deepEqual(calls, []);
   343	});
   344	
   345	test('paper mode records the opportunity without orders or withdrawals', async () => {
   346	  const { engine, db, calls, alerts } = setup({ mode: 'paper' });
   347	  await engine.tick();
   348	  assert.deepEqual(calls, []);
   349	  assert.equal(db.statsSince(0, 'paper').total.trades, 1);
   350	  assert.ok(alerts.some((a) => a.startsWith('📝 PAPER TRANSFER XYZ')));
   351	});
   352	
   353	test('loadUniverse respects WATCHLIST', async () => {
   354	  const fake = {
   355	    exchangeInfo: async () => [symbolInfo('XYZ'), symbolInfo('ABC')],
   356	    tickers24h: async () => [{ symbol: 'XYZUSDT', quoteVolume: '9e6', lastPrice: '1' }, { symbol: 'ABCUSDT', quoteVolume: '9e6', lastPrice: '1' }],
   357	    coinConfigs: async () => [coin('XYZ', XYZ), coin('ABC', '0x3333333333333333333333333333333333333333')],
   358	  };
   359	  const u = await loadUniverse(fake as never, { minVolumeUsd: 1, only: ['ABC'] });
   360	  assert.deepEqual(u.map((t) => t.base), ['ABC']);
   361	});
   362	
   363	test('a dust deposit during the withdrawal is NOT taken as arrival', async () => {
   364	  const { engine, db, alerts, state } = setup();
   365	  await engine.tick();
   366	  state.wallet[XYZ] += 10n ** 15n; // 0.001 XYZ airdrop, MEXC still PROCESSING
   367	  await engine.tick();
   368	  assert.equal(db.getTransfer(1)!.status, 'withdrawing');
   369	  state.withdrawStatus = 7; // MEXC says SUCCESS but only dust arrived
   370	  await engine.tick();
   371	  assert.equal(db.getTransfer(1)!.status, 'withdrawing');
   372	  assert.ok(alerts.some((a) => a.includes('only grew by')));
   373	});
   374	
   375	test('sell holds when the FIRM quote falls below the loss floor (round-3 M3)', async () => {
   376	  const { engine, db, calls, alerts, arrive } = setup({ firmDexPrice: 0.9 });
   377	  await engine.tick(); // finds gap, buys, withdraws
   378	  arrive(198.9); // 199.9 - 1 withdraw fee
   379	  await engine.tick(); // first quote ok (1.15), approval, firm quote 0.9 -> below floor -> hold
   380	  assert.ok(calls.includes('approve 0xspender 198900000000000000000')); // exact amount
   381	  assert.ok(!calls.includes('send')); // nothing sent on a below-floor firm quote
   382	  const row = db.openTransfers().find((t) => t.id === 1)!;
   383	  assert.equal(row.status, 'selling'); // still selling, retried later
   384	  assert.ok(alerts.some((a) => a.includes('HOLDING 198.9 XYZ')));
   385	  // The approval gas was really spent: $1.20 booked on the row.
   386	  assert.ok(Math.abs((row.gas_usd ?? 0) - 1.2) < 1e-9, String(row.gas_usd));
   387	});
   388	
   389	test('transfer mode sets BestOf gasInOutput so gas is compared (round-3 L7f)', async () => {
   390	  const mkAgg = (name: '0x' | 'kyber', out: bigint, gas: bigint): Aggregator => ({
   391	    name,
   392	    price: async () => ({ buyAmount: out, minBuyAmount: out, gas }),
   393	    quote: async () => ({ buyAmount: out, minBuyAmount: out, gas, tx: { to: '0xah', data: '0x01', value: 0n } }),
   394	  });
   395	  const bestOf = new BestOf([mkAgg('0x', 1000n, 500_000n), mkAgg('kyber', 990n, 100_000n)]);
   396	  const { engine } = setup({ mode: 'paper', agg: bestOf });
   397	  await engine.tick();
   398	  assert.equal(typeof bestOf.gasInOutput, 'function');
   399	  // 150k gas x 10 gwei effective x $2000 ETH = $3.00; fake chain decimals() is 18.
   400	  assert.equal(bestOf.gasInOutput!(150_000n, USDC), 3_000_000_000_000_000_000n);
   401	});
   402	
   403	test('provenFilter restricts the transfer universe to proven tokens only', async () => {
   404	  const ABC = '0x3333333333333333333333333333333333333333';
   405	  const { engine } = setup({
   406	    extraTokens: [{ base: 'ABC', contract: ABC }],
   407	    provenFilter: (t) => t.filter((x) => x.base === 'XYZ'),
   408	  });
   409	  await engine.refreshUniverse(true);
   410	  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']);
   411	  assert.equal(engine.provenFilteredEmpty, false);
   412	});
   413	
   414	test('no provenFilter scans every token that passes the base filters', async () => {
   415	  const ABC = '0x3333333333333333333333333333333333333333';
   416	  const { engine } = setup({ extraTokens: [{ base: 'ABC', contract: ABC }] });
   417	  await engine.refreshUniverse(true);
   418	  assert.deepEqual(engine.universe.map((t) => t.base).sort(), ['ABC', 'XYZ']);
   419	});
   420	
   421	test('provenFilter empty waits instead of trading (provenFilteredEmpty)', async () => {
   422	  const { engine } = setup({ provenFilter: () => [] });
   423	  await engine.refreshUniverse(true);
   424	  assert.deepEqual(engine.universe, []);
   425	  assert.equal(engine.provenFilteredEmpty, true);
   426	  await engine.tick(); // must not throw or trade with an empty universe
   427	  assert.deepEqual(engine.universe, []);
   428	});
   429	
   430	test('provenFilter re-applies on rescan, so newly proven tokens join live', async () => {
   431	  const ABC = '0x3333333333333333333333333333333333333333';
   432	  let proven = ['XYZ'];
   433	  const { engine } = setup({
   434	    extraTokens: [{ base: 'ABC', contract: ABC }],
   435	    provenFilter: (t) => t.filter((x) => proven.includes(x.base)),
   436	  });
   437	  await engine.refreshUniverse(true);
   438	  assert.deepEqual(engine.universe.map((t) => t.base), ['XYZ']);
   439	  proven = ['XYZ', 'ABC'];
   440	  await engine.refreshUniverse(true);
   441	  assert.deepEqual(engine.universe.map((t) => t.base).sort(), ['ABC', 'XYZ']);
   442	});
```

## `test/txsender.test.ts`

```
     1	// Nonce manager + unresolved-tx handling (round 2 review: R2-P0-2, R2-P0-3, R2-P2-8).
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { DROP_AFTER_MS, TxSender, classifySendError, type TxBackend, type GasInfo } from '../src/dex/txsender.js';
     5	
     6	const gas: GasInfo = { baseFee: 10n, tip: 1n, effective: 11n, maxFee: 21n };
     7	const tx = { to: '0xrouter', data: '0x01' };
     8	
     9	function backend(o: { broadcastError?: unknown; mined?: boolean; confirmed?: number; knows?: boolean; l1Fee?: bigint; rawReceiptThrows?: boolean } = {}) {
    10	  const state = { confirmed: o.confirmed ?? 5, signed: [] as { nonce: number; to: string; maxFeePerGas: bigint }[], receipts: new Map<string, number>(), gasReads: 0 };
    11	  const b: TxBackend = {
    12	    address: '0xme',
    13	    confirmedNonce: async () => state.confirmed,
    14	    receipt: async (h) => (state.receipts.has(h) ? { status: state.receipts.get(h)!, gasUsed: 100n, gasPrice: 2n } : null),
    15	    rawReceipt: async () => {
    16	      if (o.rawReceiptThrows) throw new Error('rpc down');
    17	      return o.l1Fee !== undefined ? { l1Fee: o.l1Fee } : null;
    18	    },
    19	    knowsTx: async () => o.knows ?? true,
    20	    sign: async (t) => {
    21	      state.signed.push({ nonce: t.nonce, to: t.to, maxFeePerGas: t.maxFeePerGas });
    22	      const hash = `0xh${state.signed.length}`;
    23	      return { raw: `raw-${hash}`, hash };
    24	    },
    25	    broadcast: async (raw) => {
    26	      if (o.broadcastError && raw === 'raw-0xh1') throw o.broadcastError;
    27	      if (o.mined) state.receipts.set(raw.slice(4), 1);
    28	    },
    29	    gas: async () => {
    30	      state.gasReads++;
    31	      return { ...gas, maxFee: 1000n, tip: 50n }; // base fee spiked while we waited
    32	    },
    33	  };
    34	  return { b, state };
    35	}
    36	
    37	const memStore = () => {
    38	  let v: string | undefined;
    39	  return { get: () => v, set: (x: string | null) => (v = x ?? undefined) };
    40	};
    41	
    42	test('classifySendError: clear rejections vs ambiguous vs already-known', () => {
    43	  assert.equal(classifySendError(Object.assign(new Error('insufficient funds for gas * price + value'), { code: 'INSUFFICIENT_FUNDS' })), 'rejected');
    44	  assert.equal(classifySendError(new Error('nonce too low')), 'rejected');
    45	  assert.equal(classifySendError(Object.assign(new Error('rpc error'), { error: { code: -32000, message: 'x' } })), 'rejected');
    46	  assert.equal(classifySendError(Object.assign(new Error('request timeout'), { code: 'TIMEOUT' })), 'ambiguous');
    47	  assert.equal(classifySendError(new Error('socket hang up')), 'ambiguous');
    48	  assert.equal(classifySendError(new Error('already known')), 'accepted');
    49	});
    50	
    51	test('mined tx: ok, nonce counts up locally', async () => {
    52	  const { b, state } = backend({ mined: true });
    53	  const s = new TxSender(b, memStore(), Date.now, async () => {});
    54	  assert.equal((await s.send(tx, 100n, gas, 10)).ok, true);
    55	  assert.equal((await s.send(tx, 100n, gas, 10)).ok, true);
    56	  assert.deepEqual(state.signed.map((x) => x.nonce), [5, 6]); // public RPC still says 5: local counter wins
    57	});
    58	
    59	test('RPC rejection: NOT unresolved, nonce reused, next send allowed', async () => {
    60	  const { b, state } = backend({ broadcastError: new Error('insufficient funds for gas'), mined: true });
    61	  const s = new TxSender(b, memStore(), Date.now, async () => {});
    62	  const r = await s.send(tx, 100n, gas, 10);
    63	  assert.equal(r.rejected, true);
    64	  assert.equal(r.unknown, undefined);
    65	  assert.equal(s.unresolved, null);
    66	  assert.equal((await s.send(tx, 100n, gas, 10)).ok, true);
    67	  assert.deepEqual(state.signed.map((x) => x.nonce), [5, 5]);
    68	});
    69	
    70	test('ambiguous send error: unresolved, next send refused (not counted as an attempt)', async () => {
    71	  const { b } = backend({ broadcastError: Object.assign(new Error('timeout'), { code: 'TIMEOUT' }) });
    72	  const s = new TxSender(b, memStore(), Date.now, async () => {});
    73	  const r = await s.send(tx, 100n, gas, 10);
    74	  assert.equal(r.unknown, true);
    75	  assert.equal(s.unresolved?.nonce, 5);
    76	  const r2 = await s.send(tx, 100n, gas, 10);
    77	  assert.equal(r2.refused, true);
    78	});
    79	
    80	test('restart with a pending tx: the persisted record still blocks sends', async () => {
    81	  const store = memStore();
    82	  const first = backend({ broadcastError: new Error('ECONNRESET') });
    83	  await new TxSender(first.b, store, Date.now, async () => {}).send(tx, 100n, gas, 10);
    84	  // "restart": a brand new sender, same store
    85	  const again = backend({ mined: true });
    86	  const s2 = new TxSender(again.b, store, Date.now, async () => {});
    87	  assert.equal(s2.unresolved?.nonce, 5);
    88	  assert.equal((await s2.send(tx, 100n, gas, 10)).refused, true);
    89	  assert.equal(again.state.signed.length, 0); // the pending nonce was NOT reused
    90	});
    91	
    92	test('unresolved clears when mined, when the nonce is consumed, or when every RPC dropped it', async () => {
    93	  let t = 1_000_000;
    94	  const store = memStore();
    95	  const { b, state } = backend({ broadcastError: new Error('ECONNRESET'), knows: false });
    96	  const s = new TxSender(b, store, () => t, async (ms) => void (t += ms)); // fake clock advances on sleep
    97	  await s.send(tx, 100n, gas, 10);
    98	  assert.equal((await s.checkUnresolved()).state, 'pending'); // too early to call it dropped
    99	  t += DROP_AFTER_MS + 1;
   100	  const c = await s.checkUnresolved();
   101	  assert.equal(c.state, 'clear');
   102	  assert.equal(c.dropped, true);
   103	
   104	  await s.send(tx, 100n, gas, 10).catch(() => {});
   105	  state.confirmed = 99; // someone mined that nonce
   106	  assert.equal((await s.checkUnresolved()).state, 'clear');
   107	});
   108	
   109	test('not mined in time: cancel is priced from FRESH gas, outcome unknown if neither mines', async () => {
   110	  let t = 0;
   111	  const { b, state } = backend();
   112	  const s = new TxSender(b, memStore(), () => t, async (ms) => void (t += ms));
   113	  const r = await s.send(tx, 100n, gas, 10);
   114	  assert.equal(r.unknown, true);
   115	  assert.equal(state.signed[1].to, '0xme'); // the cancel: 0-value self transfer, same nonce
   116	  assert.equal(state.signed[1].nonce, 5);
   117	  assert.ok(state.signed[1].maxFeePerGas >= 1300n); // 1.3 x the spiked fee, not the stale one
   118	  assert.equal(s.unresolved?.hashes.length, 2);
   119	});
   120	
   121	test('mined tx on an OP chain: L1 fee is in gasCostWei and reported (round-3 M1)', async () => {
   122	  const { b } = backend({ mined: true, l1Fee: 1000n });
   123	  const s = new TxSender(b, memStore(), Date.now, async () => {});
   124	  const r = await s.send(tx, 100n, gas, 10);
   125	  assert.equal(r.ok, true);
   126	  assert.equal(r.gasCostWei, 100n * 2n + 1000n); // receipt gas 100 x price 2 + L1 1000
   127	  assert.equal(r.l1FeeWei, 1000n);
   128	});
   129	
   130	test('raw receipt failure: L1 fee treated as 0, tx still ok (round-3 M1)', async () => {
   131	  const { b } = backend({ mined: true, rawReceiptThrows: true });
   132	  const s = new TxSender(b, memStore(), Date.now, async () => {});
   133	  const r = await s.send(tx, 100n, gas, 10);
   134	  assert.equal(r.ok, true);
   135	  assert.equal(r.gasCostWei, 200n);
   136	  assert.equal(r.l1FeeWei, undefined);
   137	});
```

## `test/upgrade-chain.test.ts`

```
     1	// Phase-1 upgrade, item 3: configurable chain.
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { CHAINS, chainProfile, explorerTxUrl, networkFor } from '../src/chains.js';
     5	import { loadConfig } from '../src/config.js';
     6	import { dexTvl } from '../src/watchlist.js';
     7	import { ZEROX_ALLOWANCE_HOLDER } from '../src/dex/aggregator.js';
     8	
     9	function cfgFor(env: Record<string, string>) {
    10	  const saved = { ...process.env };
    11	  for (const k of ['CHAIN', 'STRATEGY', 'ALLOW_WITHDRAWALS', 'MODE', 'STABLE_ADDRESS', 'USDC_ADDRESS', 'TICK_MS']) delete process.env[k];
    12	  Object.assign(process.env, { RPC_URL: 'http://x' }, env);
    13	  try {
    14	    return loadConfig();
    15	  } finally {
    16	    process.env = saved;
    17	  }
    18	}
    19	
    20	test('CHAIN defaults to ethereum: behaviour unchanged (USDC, block-driven)', () => {
    21	  const c = cfgFor({});
    22	  assert.equal(c.chain.chainId, 1);
    23	  assert.equal(c.usdc, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    24	  assert.equal(c.tickMs, 0);
    25	  assert.equal(c.stableIsUsdt, false);
    26	});
    27	
    28	test('CHAIN=base: chain id 8453, Base USDC, 1 s timer ticks', () => {
    29	  const c = cfgFor({ CHAIN: 'base' });
    30	  assert.equal(c.chain.chainId, 8453);
    31	  assert.equal(c.usdc, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    32	  assert.equal(c.tickMs, 1000);
    33	  assert.equal(c.chain.nativeMexcSymbol, 'ETHUSDT');
    34	});
    35	
    36	test('CHAIN=bsc: the DEX stable is USDT (no USDC conversion) and gas is priced in BNB', () => {
    37	  const c = cfgFor({ CHAIN: 'bsc' });
    38	  assert.equal(c.chain.chainId, 56);
    39	  assert.equal(c.stableIsUsdt, true);
    40	  assert.equal(c.chain.nativeMexcSymbol, 'BNBUSDT');
    41	});
    42	
    43	test('unknown chain and transfer-on-L2 are refused', () => {
    44	  assert.throws(() => chainProfile('solana'), /CHAIN must be one of/);
    45	  assert.throws(() => cfgFor({ CHAIN: 'base', STRATEGY: 'transfer', ALLOW_WITHDRAWALS: 'yes' }), /only supported on CHAIN=ethereum/);
    46	});
    47	
    48	test('networkFor picks the right MEXC network entry per chain', () => {
    49	  const list = [
    50	    { network: 'Ethereum(ERC20)', netWork: 'ETH', contract: '0xeth' },
    51	    { network: 'BNB Smart Chain(BEP20)', netWork: 'BSC', contract: '0xbsc' },
    52	    { network: 'Arbitrum One(ARB)', netWork: 'ARB', contract: '0xarb' },
    53	    { network: 'Base', netWork: 'BASE', contract: '0xbase' },
    54	  ];
    55	  assert.equal(networkFor(CHAINS.ethereum, list)?.contract, '0xeth');
    56	  assert.equal(networkFor(CHAINS.bsc, list)?.contract, '0xbsc');
    57	  assert.equal(networkFor(CHAINS.arbitrum, list)?.contract, '0xarb');
    58	  assert.equal(networkFor(CHAINS.base, list)?.contract, '0xbase');
    59	  assert.equal(networkFor(CHAINS.base, list.slice(0, 2)), undefined); // not on Base at MEXC
    60	});
    61	
    62	test('DexScreener TVL counts only pools on the selected chain', async () => {
    63	  const fetchFn = (async () =>
    64	    new Response(JSON.stringify({ pairs: [{ chainId: 'ethereum', liquidity: { usd: 5e6 } }, { chainId: 'base', liquidity: { usd: 3e5 } }] }))) as unknown as typeof fetch;
    65	  assert.equal(await dexTvl('0xa', fetchFn, 'base'), 3e5);
    66	  assert.equal(await dexTvl('0xa', fetchFn, 'ethereum'), 5e6);
    67	});
    68	
    69	test('every chain shares the same pinned 0x AllowanceHolder', () => {
    70	  // docs.0x.org/docs/core-concepts/contracts: same address on Ethereum, Base, Arbitrum, BSC, ...
    71	  assert.equal(ZEROX_ALLOWANCE_HOLDER, '0x0000000000001ff3684f28c67538d4d072c22734');
    72	  for (const c of Object.values(CHAINS)) assert.match(c.stable.address, /^0x[0-9a-f]{40}$/);
    73	});
    74	
    75	test('explorerTxUrl uses the chain\'s own explorer (round-3 L4)', () => {
    76	  assert.equal(explorerTxUrl(CHAINS.ethereum, '0xabc'), 'https://etherscan.io/tx/0xabc');
    77	  assert.equal(explorerTxUrl(CHAINS.base, '0xabc'), 'https://basescan.org/tx/0xabc');
    78	  assert.equal(explorerTxUrl(CHAINS.bsc, '0xabc'), 'https://bscscan.com/tx/0xabc');
    79	  assert.equal(explorerTxUrl(CHAINS.arbitrum, '0xabc'), 'https://arbiscan.io/tx/0xabc');
    80	});
    81	
    82	test('STABLE_ADDRESS override also flips stableIsUsdt (round-3 L7c)', () => {
    83	  // Point Ethereum at BSC's USDT: the stable rate must follow the address, not the chain default.
    84	  const c = cfgFor({ STABLE_ADDRESS: '0x55d398326f99059ff775485246999027b3197955' });
    85	  assert.equal(c.usdc, '0x55d398326f99059ff775485246999027b3197955');
    86	  assert.equal(c.stableIsUsdt, true);
    87	  // And the other way: BSC at Ethereum USDC.
    88	  const d = cfgFor({ CHAIN: 'bsc', STABLE_ADDRESS: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' });
    89	  assert.equal(d.stableIsUsdt, false);
    90	  // An unknown address falls back to the chain default.
    91	  const e = cfgFor({ STABLE_ADDRESS: '0x0000000000000000000000000000000000000001' });
    92	  assert.equal(e.stableIsUsdt, false);
    93	});
```

## `test/upgrade-cost.test.ts`

```
     1	// Phase-1 upgrade, item 1: cost model (per-symbol fee, USDC != USDT, bps hurdles, dynamic tip).
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { evaluateDexBuy, threshold } from '../src/pricing.js';
     5	import { takerFeeFor, rulesFrom } from '../src/mexc/rules.js';
     6	import { pickTip } from '../src/dex/chain.js';
     7	import { loadConfig, validateConfig } from '../src/config.js';
     8	
     9	const GWEI = 1_000_000_000n;
    10	
    11	/** New defaults: fee per symbol, 5 bps CEX slippage, safety 10 bps, need = max($0.25, 20 bps). */
    12	function defaults() {
    13	  const saved = { ...process.env };
    14	  for (const k of ['MIN_PROFIT_USD', 'MIN_PROFIT_BPS', 'SAFETY_MARGIN_USD', 'SAFETY_MARGIN_BPS', 'CEX_SLIPPAGE_BPS', 'MAX_TRADE_USD', 'CHAIN', 'STRATEGY', 'MODE']) delete process.env[k];
    15	  process.env.RPC_URL = 'http://x';
    16	  const c = validateConfig(loadConfig());
    17	  process.env = saved;
    18	  return c;
    19	}
    20	
    21	/** $100 DEX_BUY at DEX price 10, MEXC bid = 10 * (1 + gapBps), gas $0.01, fee 8 bps. */
    22	function dexBuyNet(gapBps: number, stableInUsdt = 1, override?: Partial<ReturnType<typeof defaults>>) {
    23	  const c = { ...defaults(), ...override };
    24	  const o = evaluateDexBuy({
    25	    sizeUsd: 100,
    26	    tokensOut: 10,
    27	    tokensMin: 10,
    28	    bids: [[10 * (1 + gapBps / 10_000), 1e6]],
    29	    qtyStep: 0.01,
    30	    gasUsd: 0.01,
    31	    costs: { takerFee: 0.0008, cexSlippageBps: c.cexSlippageBps, safetyMarginUsd: c.safetyMarginUsd, safetyMarginBps: c.safetyMarginBps, stableInUsdt },
    32	  })!;
    33	  return { net: o.net, need: threshold(100, c.minProfitUsd, c.minProfitBps) };
    34	}
    35	
    36	test('defaults: need = max($0.25, 20 bps), safety 10 bps, CEX slippage 5 bps', () => {
    37	  const c = defaults();
    38	  assert.equal(c.minProfitUsd, 0.25);
    39	  assert.equal(c.minProfitBps, 20);
    40	  assert.equal(c.safetyMarginUsd, 0);
    41	  assert.equal(c.safetyMarginBps, 10);
    42	  assert.equal(c.cexSlippageBps, 5);
    43	  assert.equal(c.chain.name, 'ethereum');
    44	});
    45	
    46	test('$100 trade, 8 bps fee: a 0.50% gap passes, a 0.20% gap fails', () => {
    47	  const pass = dexBuyNet(50);
    48	  assert.ok(pass.net > pass.need, `${pass.net} vs ${pass.need}`);
    49	  const fail = dexBuyNet(20);
    50	  assert.ok(fail.net < fail.need);
    51	  // Note: with these defaults the break-even at $100 is ~0.49% (25 bps floor + 8 fee + 5 slip + 10 safety + gas),
    52	  // so a 0.40% gap does NOT pass at $100. It passes from ~$200 up only if the gap is ~0.45%+.
    53	  const p40 = dexBuyNet(40);
    54	  assert.ok(p40.net < p40.need);
    55	});
    56	
    57	test('USDC != USDT: a fake +22 bps DEX_BUY edge disappears at the real 1.0022 rate', () => {
    58	  const zero = { cexSlippageBps: 0, safetyMarginUsd: 0, safetyMarginBps: 0 };
    59	  const noFee = (gap: number, rate: number) => {
    60	    const o = evaluateDexBuy({
    61	      sizeUsd: 100, tokensOut: 10, tokensMin: 10, bids: [[10 * (1 + gap / 10_000), 1e6]], qtyStep: 0.01, gasUsd: 0,
    62	      costs: { takerFee: 0, ...zero, stableInUsdt: rate },
    63	    })!;
    64	    return o.net;
    65	  };
    66	  assert.ok(noFee(22, 1) > 0.2); // treating USDC as 1 USDT: looks like +$0.22
    67	  assert.ok(Math.abs(noFee(22, 1.0022)) < 1e-9); // real rate: nothing there
    68	  assert.ok(dexBuyNet(22, 1.0022).net < 0); // with fees: a loss
    69	});
    70	
    71	test('per-symbol taker fee: 0.002 wins over the 0.0005 override; the override is a floor', () => {
    72	  assert.equal(takerFeeFor({ takerFee: 0.002 }, 0.0005), 0.002);
    73	  assert.equal(takerFeeFor({ takerFee: 0.0002 }, 0.0005), 0.0005);
    74	  assert.equal(takerFeeFor(undefined, 0.0005), 0.0005);
    75	  const r = rulesFrom({ symbol: 'X', baseAsset: 'X', quoteAsset: 'USDT', status: '1', isSpotTradingAllowed: true, baseSizePrecision: '0', quotePrecision: 4, orderTypes: ['LIMIT'], takerCommission: '0.002', makerCommission: '0' });
    76	  assert.equal(r.takerFee, 0.002);
    77	  assert.equal(r.makerFee, 0);
    78	});
    79	
    80	test('dynamic tip: median of recent tips, capped, with a tiny floor', () => {
    81	  const cap = 1n * GWEI;
    82	  assert.equal(pickTip([10_000_000n, 20_000_000n, 30_000_000n], cap), 20_000_000n); // 0.02 gwei, not 1 gwei
    83	  assert.equal(pickTip([5n * GWEI, 6n * GWEI, 7n * GWEI], cap), cap); // spike: capped
    84	  assert.equal(pickTip([0n, 0n, 1n], cap), 1_000_000n); // never 0
    85	  assert.equal(pickTip([], cap), cap); // no data: the cap
    86	});
```

## `test/upgrade-kpi.test.ts`

```
     1	// Phase-1 upgrade, items 2d and 5a: KPIs and inventory plan.
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import { Db, type OpportunityRow } from '../src/db.js';
     5	import { computeKpis, formatKpis, opportunitiesCsv } from '../src/kpi.js';
     6	import { inventoryPlan } from '../src/inventory.js';
     7	import type { Token } from '../src/watchlist.js';
     8	
     9	const row = (o: Partial<OpportunityRow>): OpportunityRow => ({
    10	  ts: Date.UTC(2026, 10, 21, 3, 0), chain: 'base', token: 'AERO', direction: 'DEX_BUY', size_usd: 100, mexc_bid: 1, mexc_ask: 1,
    11	  book_age_ms: 10, aggregator: 'kyber', dex_out: 1, dex_min_out: 1, usdc_usdt: 1.002, gross_bps: 10, fee_bps: 8, gas_usd: 0.01,
    12	  net_usd: -0.1, hurdle_usd: 0.25, decision: 'below_hurdle', reason: null, ...o,
    13	});
    14	
    15	test('KPIs: minutes above 20/35/50 bps, would-have PnL per hurdle (one trade per token+direction per minute)', () => {
    16	  const db = new Db(':memory:');
    17	  const t0 = Date.UTC(2026, 10, 21, 3, 0); // 09:00 Dhaka
    18	  db.insertOpportunities([
    19	    row({ ts: t0, gross_bps: 40, net_usd: 0.3 }),
    20	    row({ ts: t0 + 5_000, gross_bps: 45, net_usd: 0.35 }), // same minute: only the best counts
    21	    row({ ts: t0 + 60_000, gross_bps: 60, net_usd: 0.5 }),
    22	    row({ ts: t0 + 120_000, gross_bps: 5, net_usd: -0.2 }),
    23	  ]);
    24	  const k = computeKpis(db, 0, 'paper');
    25	  assert.deepEqual(k.minutesAbove, [
    26	    { bps: 20, minutes: 2 },
    27	    { bps: 35, minutes: 2 },
    28	    { bps: 50, minutes: 1 },
    29	  ]);
    30	  const at30 = k.wouldHave.find((w) => w.hurdle_bps === 30)!; // need net >= $0.30 on $100
    31	  assert.equal(at30.trades, 2);
    32	  assert.ok(Math.abs(at30.pnl - 0.85) < 1e-9);
    33	  assert.equal(k.wouldHave.find((w) => w.hurdle_bps === 60)!.trades, 0);
    34	  assert.deepEqual(k.byHourDhaka, [{ hour: 9, minutes_above_20: 2 }]);
    35	  const text = formatKpis(k);
    36	  assert.match(text, /minutes with gross gap ≥20\/35\/50 bps: 2 \/ 2 \/ 1/);
    37	  assert.match(opportunitiesCsv(db, 0), /^token,hour_dhaka,quotes,max_gross_bps,minutes_above_20\nAERO,9,4,60,2$/);
    38	});
    39	
    40	test('inventory plan: low sides and a token-share warning', () => {
    41	  const tok = { base: 'AERO' } as Token;
    42	  const items = inventoryPlan(
    43	    { walletEth: 0.01, walletUsdc: 50, walletToken: { AERO: 900 }, mexc: { USDT: 50, AERO: 10 } },
    44	    [tok],
    45	    { AERO: 1 },
    46	    { tradeUsd: 100, perSideX: 3, maxTokenSharePct: 50, walletAddress: '0xme' },
    47	  );
    48	  const side = (token: string, s: string) => items.find((i) => i.kind === 'side' && i.token === token && i.side === s) as Extract<(typeof items)[number], { kind: 'side' }>;
    49	  assert.equal(side('AERO', 'mexc').low, true); // $10 on MEXC < 1x trade
    50	  assert.equal(side('AERO', 'mexc').direction, 'deposit wallet→MEXC');
    51	  assert.equal(side('AERO', 'mexc').amount, 290); // up to 3x = $300, minus the $10 there
    52	  assert.equal(side('AERO', 'wallet').low, false);
    53	  assert.match(side('STABLE', 'wallet').direction, /withdraw MEXC→wallet 0xme/);
    54	  assert.ok(items.some((i) => i.kind === 'warning' && /tokens are 9\d% of the portfolio/.test(i.text)));
    55	});
    56	
    57	test('would-have PnL uses the best row\'s own size (round-3 M4)', () => {
    58	  const db = new Db(':memory:');
    59	  const t0 = Date.UTC(2026, 10, 21, 3, 0);
    60	  db.insertOpportunities([
    61	    row({ ts: t0, net_usd: 0.5, size_usd: 100, gross_bps: 50 }), // best net, small size
    62	    row({ ts: t0 + 5_000, net_usd: 0.3, size_usd: 200, gross_bps: 15 }), // same minute, bigger size
    63	  ]);
    64	  const k = computeKpis(db, 0, 'paper');
    65	  const at30 = k.wouldHave.find((w) => w.hurdle_bps === 30)!;
    66	  // Best net 0.5 on its own size $100: hurdle 30 bps = $0.30 -> trades.
    67	  // (Old code took size $200 from the other row: 0.5 < $0.60 -> 0 trades.)
    68	  assert.equal(at30.trades, 1);
    69	  assert.ok(Math.abs(at30.pnl - 0.5) < 1e-9);
    70	  assert.equal(k.wouldHave.find((w) => w.hurdle_bps === 60)!.trades, 0); // 0.5 < $0.60 on $100
    71	});
    72	
    73	test('gasShareOfGross counts gas only on ok/paper trades, like gross (round-3 L1)', () => {
    74	  const db = new Db(':memory:');
    75	  const t0 = Date.UTC(2026, 10, 21, 3, 0);
    76	  const trade = (o: object) => ({
    77	    ts: t0, day: '2026-11-21', mode: 'paper', symbol: 'AERO', direction: 'DEX_BUY', size_usd: 100, qty: 10,
    78	    buy_price: 10, sell_price: 11, expected_net: 1, cex_fee_usd: 0.5, gas_usd: 1, pnl_usd: 10,
    79	    status: 'ok' as const, dex_tx: null, cex_order_id: null, note: null, ...o,
    80	  });
    81	  db.insertTrade(trade({}));
    82	  db.insertTrade(trade({ status: 'paper', pnl_usd: 5, gas_usd: 2 }));
    83	  db.insertTrade(trade({ status: 'one_sided', pnl_usd: -5, gas_usd: 4, cex_fee_usd: 0 }));
    84	  db.insertTrade(trade({ status: 'dex_failed', pnl_usd: 0, gas_usd: 3, cex_fee_usd: 0 }));
    85	  const k = computeKpis(db, 0, 'paper');
    86	  // gas on ok/paper only: 1 + 2 = 3; gross on ok/paper only: (10+1+0.5) + (5+2+0.5) = 19.
    87	  assert.ok(k.gasShareOfGross !== null && Math.abs(k.gasShareOfGross - 3 / 19) < 1e-9, String(k.gasShareOfGross));
    88	});
    89	
    90	test('inventory plan STABLE ticket names the chain stable (round-3 L2)', () => {
    91	  const tok = { base: 'AERO' } as Token;
    92	  const bal = { walletEth: 0.01, walletUsdc: 50, walletToken: { AERO: 900 }, mexc: { USDT: 50, AERO: 10 } };
    93	  const items = inventoryPlan(bal, [tok], { AERO: 1 },
    94	    { tradeUsd: 100, perSideX: 3, maxTokenSharePct: 50, walletAddress: '0xme', stableSymbol: 'USDC' });
    95	  const side = (token: string, s: string) =>
    96	    items.find((i) => i.kind === 'side' && i.token === token && i.side === s) as Extract<(typeof items)[number], { kind: 'side' }>;
    97	  assert.equal(side('STABLE', 'wallet').asset, 'USDC');
    98	  assert.match(side('STABLE', 'wallet').direction, /withdraw USDC MEXC→wallet 0xme/);
    99	  assert.equal(side('STABLE', 'mexc').asset, 'USDT');
   100	  assert.match(side('STABLE', 'mexc').direction, /deposit USDC wallet→MEXC \(swap to USDT on MEXC\)/);
   101	  // BSC (stable USDT): both sides plain USDT, no swap note.
   102	  const bsc = inventoryPlan(bal, [tok], { AERO: 1 },
   103	    { tradeUsd: 100, perSideX: 3, maxTokenSharePct: 50, walletAddress: '0xme', stableSymbol: 'USDT' });
   104	  const bside = (token: string, s: string) =>
   105	    bsc.find((i) => i.kind === 'side' && i.token === token && i.side === s) as Extract<(typeof bsc)[number], { kind: 'side' }>;
   106	  assert.equal(bside('STABLE', 'wallet').asset, 'USDT');
   107	  assert.equal(bside('STABLE', 'mexc').direction, 'deposit wallet→MEXC');
   108	});
   109	
   110	test('opportunities has a (ts) index for long report windows (round-3 M5)', () => {
   111	  const db = new Db(':memory:');
   112	  const idx = db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'opp_ts'`);
   113	  assert.equal(idx.length, 1);
   114	});
```

## `test/upgrade-quotes.test.ts`

```
     1	// Phase-1 upgrade, item 4: KyberSwap, best-of quotes, 0x fee, rate limiter.
     2	import { test } from 'node:test';
     3	import assert from 'node:assert/strict';
     4	import {
     5	  BestOf,
     6	  KYBER_ROUTER_V2,
     7	  Kyber,
     8	  Limited,
     9	  QuoteBudgetError,
    10	  TokenBucket,
    11	  applyZeroExFee,
    12	  type Aggregator,
    13	  type Quote,
    14	  type QuoteRequest,
    15	} from '../src/dex/aggregator.js';
    16	import { RateLimitError } from '../src/mexc/rest.js';
    17	
    18	const req: QuoteRequest = { sellToken: '0xSELL', buyToken: '0xBUY', sellAmount: 1000n, taker: '0xme', slippageBps: 30 };
    19	const ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'; // as the API returns it (mixed case)
    20	
    21	function kyberWith(router = ROUTER) {
    22	  const calls: { url: string; body?: unknown; headers: Record<string, string> }[] = [];
    23	  const fetchFn = (async (u: string, o: { headers: Record<string, string>; method?: string; body?: string }) => {
    24	    calls.push({ url: u, body: o.body ? JSON.parse(o.body) : undefined, headers: o.headers });
    25	    if (u.includes('/routes')) {
    26	      return new Response(JSON.stringify({ code: 0, data: { routerAddress: router, routeSummary: { amountOut: '5000', gas: '250000', routeID: 'r1' } } }));
    27	    }
    28	    return new Response(JSON.stringify({ code: 0, data: { amountOut: '4990', gas: '260000', data: '0xcalldata', routerAddress: router, transactionValue: '0' } }));
    29	  }) as unknown as typeof fetch;
    30	  return { k: new Kyber('base', 'mexc-dex-arb', fetchFn), calls };
    31	}
    32	
    33	test('Kyber price: routes on the right chain path, x-client-id header, router pinned', async () => {
    34	  const { k, calls } = kyberWith();
    35	  const q = await k.price(req);
    36	  assert.match(calls[0].url, /aggregator-api\.kyberswap\.com\/base\/api\/v1\/routes\?tokenIn=0xSELL&tokenOut=0xBUY&amountIn=1000/);
    37	  assert.equal(calls[0].headers['x-client-id'], 'mexc-dex-arb');
    38	  assert.equal(q.buyAmount, 5000n);
    39	  assert.equal(q.minBuyAmount, 4985n); // 30 bps
    40	  assert.equal(q.spender, KYBER_ROUTER_V2);
    41	  assert.equal(q.source, 'kyber');
    42	});
    43	
    44	test('Kyber quote: build with slippage in bps, output to our own wallet, tx.to pinned', async () => {
    45	  const { k, calls } = kyberWith();
    46	  const q = await k.quote(req);
    47	  const body = calls[1].body as { slippageTolerance: number; sender: string; recipient: string; routeSummary: { routeID: string } };
    48	  assert.equal(body.slippageTolerance, 30);
    49	  assert.equal(body.sender, '0xme');
    50	  assert.equal(body.recipient, '0xme');
    51	  assert.equal(body.routeSummary.routeID, 'r1');
    52	  assert.equal(q.tx?.to, KYBER_ROUTER_V2);
    53	  assert.equal(q.tx?.data, '0xcalldata');
    54	  assert.equal(q.buyAmount, 4990n);
    55	});
    56	
    57	test('Kyber response with an unknown router is rejected', async () => {
    58	  const { k } = kyberWith('0x000000000000000000000000000000000000bad1');
    59	  await assert.rejects(k.price(req), /not the allowlisted contract/);
    60	});
    61	
    62	test('0x fee is treated as a cost (until proven already net)', () => {
    63	  const base = { buyAmount: 1000n, minBuyAmount: 990n };
    64	  assert.deepEqual(applyZeroExFee(base, { amount: '15', token: '0xbuy' }, req), { buyAmount: 985n, minBuyAmount: 975n });
    65	  // fee in the sell token: the output shrinks in proportion (sold 1000, 15 of it was fee)
    66	  assert.deepEqual(applyZeroExFee(base, { amount: '15', token: '0xSELL' }, req), { buyAmount: 985n, minBuyAmount: 975n });
    67	  assert.deepEqual(applyZeroExFee(base, null, req), base);
    68	});
    69	
    70	test('token bucket: at most `rps` calls per second; a 429 blocks for Retry-After', async () => {
    71	  let t = 0;
    72	  const b = new TokenBucket(2, () => t);
    73	  assert.equal(b.take(), true);
    74	  assert.equal(b.take(), true);
    75	  assert.equal(b.take(), false); // budget used
    76	  t += 500;
    77	  assert.equal(b.take(), true); // refilled one
    78	  b.block(10);
    79	  t += 5_000;
    80	  assert.equal(b.take(), false);
    81	  t += 6_000;
    82	  assert.equal(b.take(), true);
    83	});
    84	
    85	test('Limited: over budget -> QuoteBudgetError; a 429 blocks the aggregator', async () => {
    86	  let calls = 0;
    87	  const inner: Aggregator = {
    88	    name: 'x',
    89	    price: async () => {
    90	      calls++;
    91	      throw new RateLimitError('429', 30);
    92	    },
    93	    quote: async () => ({}) as Quote,
    94	  };
    95	  let t = 0;
    96	  const l = new Limited(inner, new TokenBucket(5, () => t));
    97	  await assert.rejects(l.price(req), (e) => e instanceof RateLimitError);
    98	  await assert.rejects(l.price(req), (e) => e instanceof QuoteBudgetError); // blocked for 30 s, not called
    99	  assert.equal(calls, 1);
   100	});
   101	
   102	test('BestOf: best output AFTER gas wins; all rate-limited -> QuoteBudgetError', async () => {
   103	  const mk = (name: string, buy: bigint, gas: bigint): Aggregator => ({
   104	    name,
   105	    price: async () => ({ buyAmount: buy, minBuyAmount: buy, gas, spender: '0x', source: name }),
   106	    quote: async () => ({ buyAmount: buy, minBuyAmount: buy, gas, spender: '0x', source: name }),
   107	  });
   108	  const b = new BestOf([mk('0x', 1000n, 100n), mk('kyber', 1010n, 500n)]);
   109	  assert.equal((await b.price(req)).source, 'kyber'); // more output, gas not valued
   110	  b.gasInOutput = (g) => g / 10n; // gas worth 10 vs 50 output units
   111	  assert.equal((await b.price(req)).source, '0x'); // 1000-10 > 1010-50
   112	  const limited: Aggregator = { name: 'z', price: async () => { throw new QuoteBudgetError('x'); }, quote: async () => { throw new QuoteBudgetError('x'); } };
   113	  await assert.rejects(new BestOf([limited, limited]).price(req), (e) => e instanceof QuoteBudgetError);
   114	});
```

