# Handover: mexc-dex-arb (MEXC <-> DEX arbitrage bot)

You are taking over this project from another AI coding agent. Read this file fully before changing anything.
The owner writes in Bengali (sometimes Banglish). Reply to the owner in Bengali, plainly and briefly.

## 1. Where things are

- Repo: `yahiahossain/yahiahossain`. Branch: `claude/sweet-thompson-lg2nam`. Last code commit: `27634d8`; the
  round-3 review prompt was added in `071779a`.
- Project folder: `mexc-dex-arb/`.
  - `arbitrage-bot/` is an older learning project (Uniswap V2 flash swap, MEXC <-> Uniswap V2 JS bot). It is not
    in use.
- Single-file review bundle (all source, numbered lines): `mexc-dex-arb-code-for-review.md`.
  - Regenerate it after every change. The command is in section 7.
- Change logs:
  - `mexc-dex-arb/CHANGES.md`: the Grok round-2 fix list, with file:line.
  - `mexc-dex-arb/CHANGES_UPGRADE.md`: phase-1 upgrade, with file:line.
- Prompts given to external reviewers: `UPGRADE_PROMPT.md`, `REVIEW_PROMPT_R3.md`.

## 2. What the bot does

TypeScript (Node 20, ESM), ethers v6, better-sqlite3, ws, pm2, Telegram.

It trades price gaps for the same token between MEXC spot (USDT pairs) and a DEX on one EVM chain.

**`STRATEGY=inventory` (default).** Tokens and stables are held on both sides, and both legs fire together:
- `DEX_BUY`: buy on the DEX with USDC, sell on MEXC.
- `CEX_BUY`: buy on MEXC, sell on the DEX.

**`STRATEGY=transfer`.** Buy on MEXC, withdraw to the wallet, sell on the DEX.
- Ethereum only.
- Refuses to start unless `ALLOW_WITHDRAWALS=yes`.
- The owner and both reviewers agreed to keep it OFF.

**Defaults:** `MODE=paper`, `STRATEGY=inventory`, `CHAIN=ethereum`, `MAX_TRADE_USD=50`.

**Paper mode** sends no orders and no transactions. It logs what would have happened, re-quoting after
`PAPER_LATENCY_MS` and booking that net.

**Chains:** `CHAIN=ethereum|base|bsc|arbitrum` (`src/chains.ts`).
- Base, BSC and Arbitrum scan on a 1 s timer; Ethereum scans once per block.
- Run one pm2 app per chain: `BOT_CHAINS=base pm2 start ecosystem.config.cjs`. Each chain uses
  `data/<chain>.sqlite`.

**DEX quotes:** `DEX_AGGREGATOR=0x|kyber|1inch`, or a list such as `0x,kyber`.
- With a list, `BestOf` picks the best quote after gas.
- Each aggregator is wrapped in `Limited`, a token bucket that honours 429 Retry-After.

## 3. File map (src/)

| File | Role |
|---|---|
| `main.ts` | Wiring, pre-flight checks, loops, Telegram commands, crash handling, graceful shutdown |
| `config.ts` | Env parsing + `validateConfig` (range checks) + `secretsOf` (redaction list) |
| `chains.ts` | Per-chain profile: id, stable, wrapped native, MEXC native symbol, Kyber/DexScreener names, MEXC network regex, tick |
| `engine.ts` | Inventory strategy. `tick()` → `candidates()` / `evalAt()` (multi-size) → `execute()` (approval, firm quote, simulate, re-check, readyToSend, `executing` row, both legs, unwind, PnL, legs), paper `recordPaper` / `requote`, opportunity logging, skewed hurdle `needFor`, inventory tickets |
| `pricing.ts` | Pure maths: `evaluateDexBuy` / `evaluateCexBuy` / `evaluateTransfer`, `threshold`, `safetyUsd`, `unwindPlan`. All money is in USDT; the DEX stable is converted with `stableInUsdt` |
| `transfer.ts` | Transfer strategy state machine (buying → withdrawing → selling → done / failed / stuck), persisted |
| `scanner.ts` | Transfer-mode universe + DexScreener gap pre-filter |
| `watchlist.ts` | Inventory-mode token list. The contract comes from MEXC's own coin config for the chosen network |
| `inventory.ts` | Balances snapshot, `portfolioUsd`, warnings, `inventoryPlan` (rebalance tickets) |
| `risk.ts` | Limits, soft vs critical pause (`/start confirm`), loss budget |
| `recovery.ts` | Startup: settles `executing` trades, sweeps open bot orders, keeps a critical pause if anything is unknown |
| `commands.ts` | `/start` logic, `/resolve`, `/status` extra lines |
| `db.ts` | SQLite tables: trades, state, transfers, opportunities, legs, rebalance_tickets, inventory_snapshots (migrations inline) |
| `kpi.ts`, `summary.ts`, `report.ts` | Daily summary / `npm run report [hours] [mode] [--csv]` |
| `telegram.ts` | Commands only from `TELEGRAM_ADMIN_ID` in a private chat; persisted offset; ignores commands older than process start |
| `log.ts` | Logger that scrubs secrets |
| `mexc/rest.ts` | Signed MEXC REST client. Errors: `AmbiguousRequestError` (timeout/5xx on writes), `MexcApiError` (code), `RateLimitError` |
| `mexc/ws.ts`, `mexc/proto.ts` | Protobuf WebSocket depth (full 20-level snapshots, verified live) |
| `mexc/rules.ts` | Symbol rules: qty step = baseAssetPrecision, min qty = baseSizePrecision, notional limits, order types, tradeSideType, PERCENT_PRICE_BY_SIDE band, per-symbol fees |
| `dex/aggregator.ts` | ZeroEx, OneInch, Kyber, Limited, TokenBucket, BestOf, `applyZeroExFee`, router allowlist |
| `dex/txsender.ts` | Nonce manager, persisted in-flight/unresolved tx, rejection vs ambiguous classification, cancel, `/cancelnonce` |
| `dex/chain.ts` | ethers providers, ERC20 helpers, exact approvals, simulate, dynamic tip (`pickTip`) |

Scripts:
- `scripts/networks.ts` (`npm run networks`): read-only; counts MEXC tokens per network.
- `scripts/check-0x-quote.ts` (`npm run check:0x`): read-only 0x firm quote, used to check `transaction.to`.

## 4. Safety rules (do NOT break these)

1. Never change the defaults: `MODE=paper`, `STRATEGY=inventory`, `ALLOW_WITHDRAWALS=no`.
2. Never give the bot MEXC withdraw rights. Never let it move funds. Rebalancing is a Telegram ticket for a human.
3. Never print or log keys or RPC URLs. Add any new secret to `secretsOf()`.
4. Approvals are exact amounts, never MaxUint256. — OVERRIDDEN by owner decision 2026-11-21:
   `UNLIMITED_APPROVAL=yes` (default off) approves MaxUint256 once per token per spender, so later
   sales skip the approve tx (~12s saved per sale). Yahia accepted the stated risk (a compromised
   spender could drain the whole token balance). Live twin only; see CHANGES.md "Unlimited approval".
5. `spender` and `tx.to` must be pinned:
   - 0x AllowanceHolder: `0x0000000000001fF3684f28c67538d4D072C22734`
   - 1inch v6: `0x111111125421cA6dc452d289314280a0f8842A65`
   - Kyber MetaAggregationRouterV2: `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`
6. An unknown outcome is never treated as a failure:
   - MEXC timeout/5xx: look the order up by client id; still not found means `UNKNOWN_ORDER_STATE` (critical pause).
   - A DEX tx neither mined nor cancelled is `unknown`: critical pause, no unwind.
7. A trade row is written as `executing` BEFORE the legs fire. Every MEXC client id goes onto the row BEFORE
   its order is placed. The tx hash is persisted BEFORE broadcast.
8. MEXC symbol rules are checked BEFORE the DEX tx is sent.
9. No mempool watching and no front-running or sandwiching.
10. Every change needs unit tests with the existing fakes. `npm run typecheck` and `npm test` must pass
    (currently **112 tests, all passing**).
11. Do not run anything live and do not use real keys.

## 5. Facts already verified (with sources). Do not re-litigate without new evidence

**MEXC Spot v3 docs** (https://mexcdevelop.github.io/apidocs/spot_v3_en/):
- `newClientOrderId` / `origClientOrderId` exist.
- `-2011` "Unknown order sent".
- HTTP 5XX means the outcome is UNKNOWN.
- Withdraw-history status codes 1-10; `transactionFee` field.
- There is **no `timeInForce` parameter**. IMMEDIATE_OR_CANCEL is a documented order type, but **no live symbol
  lists it** in `orderTypes`, so closes use an aggressive LIMIT plus `cancelAndConfirm`.

**MEXC live exchangeInfo** (2026-11-21):
- `status` is "1".
- `baseSizePrecision` is the MIN qty (e.g. ETHUSDT 0.0001 with baseAssetPrecision 5).
- Every symbol has `PERCENT_PRICE_BY_SIDE`: 0.2 is common, some are 0.02, ETH and BTC are 0.005.
- USDT-pair taker fees: 0.08% on 941 pairs, 0.20% on 249, 0.05% on 174; maker fee 0.
- USDCUSDT ≈ 1.0021.

**0x v2 docs:**
- `slippageBps` is deprecated; use `slippagePpm`.
- Approve `issues.allowance.spender` / `allowanceTarget`, never `transaction.to`.
- AllowanceHolder has the same address on Ethereum, Base, BSC and Arbitrum.

**KyberSwap docs + live:**
- `/routes` then POST `/route/build`; `slippageTolerance` is in bps.
- The router above is listed in the docs and was returned live on all four chains.
- Public limit is 3 rps.

**Gas** (live, 2026-11-21): mainnet base fee ≈ 0.15 gwei, swap ≈ $0.10. A fixed 1 gwei tip was most of the cost,
so the bot now uses `pickTip`.

**Economics:**
- Observed MEXC-vs-DEX gaps on liquid tokens are about 0-1%.
- With the current defaults, break-even at $100 is about 0.49% plus gas: a 25 bps floor, 8 bps fee,
  5 bps slippage and 10 bps safety.

## 6. Open items / not verified

- MEXC's exact network names for Base and Arbitrum. The regexes in `src/chains.ts` are patterns, so run
  `npm run networks` with the owner's read-only key.
- Whether 0x `buyAmount` is already net of `zeroExFee`. Currently it is counted as a cost (the conservative
  choice); confirm with `npm run check:0x` plus one simulated swap.
- Whether the MEXC buy fee is charged in the base token or in USDT. The code assumes the token; check
  `commissionAsset` in `legs` after the first live fill.
- 1inch v6 request parameters have not been checked against its docs.
- `legs.l1_fee` is always null: ethers does not expose the OP-stack L1 fee. Balance-based PnL still includes it.
- Phase-2 ideas, only if 7 days of paper data show edge (see `UPGRADE_PROMPT.md` / Grok's plan):
  - pool pre-filter and a faster loop;
  - DEX-first execution on Base;
  - maker (LIMIT_MAKER) mode;
  - perp hedge of inventory;
  - automated wallet→MEXC deposits to an allowlist.
- The round-3 review (`REVIEW_PROMPT_R3.md`) was sent to Grok and Muse. **Muse's round-3 review was delivered
  2026-11-21 ~08:49 (see `mexc-dex-arb-review-round3.md` in the owner's files) and has now been worked:
  every finding was re-verified against the repo code and official docs/live data; the confirmed ones are
  fixed in this branch (see CHANGES.md, "Round-3 review fixes"), the rejected ones are listed there too.
  Grok's round-3 answers have not come back yet.**
  - **L6 was WRONG in Muse's round-3 review:** Kyber's official docs DO state the public Aggregator API
    limit is 3 rps (kyberswap-documentation, `developer-guide/start-here/rate-limits-and-client-id.md`).
    The code's "Kyber public 3 rps" is correct; no change was made. The review file's L6 note is outdated.

## 7. How to work

```bash
cd mexc-dex-arb
npm ci
npm run typecheck && npm test          # must stay green
npm run build
# regenerate the review bundle from the repo root:
cd .. && (cd mexc-dex-arb && { echo "# mexc-dex-arb: full source for review"; echo; for f in package.json tsconfig.json .gitignore .env.example ecosystem.config.cjs CHANGES.md CHANGES_UPGRADE.md src/*.ts src/mexc/*.ts src/dex/*.ts scripts/*.ts test/*.ts; do echo "## \`$f\`"; echo; echo '```'; cat -n "$f"; echo '```'; echo; done; } > ../mexc-dex-arb-code-for-review.md)
```

- Tests use `node:test` via `tsx`.
  - The engine tests (`test/engine.test.ts`) and transfer tests have full fakes for MEXC, the chain and the
    aggregator.
  - Old tests pin the pre-upgrade cost env (`MIN_PROFIT_USD=15`, `MIN_PROFIT_BPS=50`, `SAFETY_MARGIN_USD=2`,
    `CEX_SLIPPAGE_BPS=20`, `MAX_TRADE_USD=200`) so their numbers stay meaningful.
  - New behaviour gets new tests.
- Commit on the same branch, with clear messages. Update the matching CHANGES file with file:line.
- Reviewer findings: check every claim against the code and official docs or live public data before acting.
  Several past claims were wrong (timeInForce, "ETH price moves PnL", "WS is incremental", "0.40% passes at $100").
  Say which claims were right, which were wrong, and why.

## 8. Owner's current step

The owner is about to set up the VPS and run **paper mode on Ethereum for 7 days**. Instructions are in the README
section "Running phase 1 in paper for 7 days and reading the report".
(An earlier plan said Base; the owner's decision 2026-11-21 is Ethereum, `CHAIN=ethereum`.)

They need:
- an Ethereum mainnet RPC (e.g. Alchemy) for both `RPC_URL` and `SEND_RPC_URL` (MEV Blocker / Flashbots
  are mainnet-only; the bot checks the chain id at startup);
- a **read-only** MEXC key;
- Telegram (optional in paper);
- `WATCHLIST` with 2-4 tokens chosen from `CHAIN=ethereum npm run networks`;
- `MAX_TRADE_USD=300` for the paper run (Ethereum gas is ~$0.10/swap, up to ~$1 on spikes, so $50 paper
  size would show almost no trades — that is the math, not a bot fault);
- Ethereum scans once per 12 s block (no TICK_MS).

Paper mode is **not real trading**. Live needs `MODE=live`, a new wallet's key, a trade-only MEXC key, funds on both
sides, and Telegram. Do not suggest live until the 7-day paper report shows positive re-quoted net.
