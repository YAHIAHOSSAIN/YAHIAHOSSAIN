# Changes for Grok's round-2 fix prompt

Defaults are unchanged: `MODE=paper`, `STRATEGY=inventory`, `ALLOW_WITHDRAWALS=no`, `MAX_TRADE_USD=50`.
Nothing was run live. `tsc --noEmit` passes, and `npm test` passes all 83 tests.

Note: Grok reviewed the 57-test version. Muse's round-2 fixes (commit `04b9c84`) had already covered
part of these items. The lines below are where each item lives now.

| # | Item | Where (file:line) | Tests |
|---|---|---|---|
| 1 | Nonce gap after a failed broadcast | `src/dex/txsender.ts:68` `classifySendError`; `:214` a definite rejection rolls back the nonce and returns `rejected`, never `unknown`; `:151` `readyToSend()` refuses while a tx is unresolved and resets a local nonce that ran ahead of the chain; `src/engine.ts:448` calls `readyToSend()` before the MEXC leg | `test/txsender.test.ts` (rejection keeps nonce 5, 5); `test/grok-r2.test.ts` "1) readyToSend"; `test/engine.test.ts` "nonce not ready: the MEXC leg never fires" |
| 2 | `/start confirm` must not clear a pending tx | `src/commands.ts:55` `makeUnresolvedCheck`: refuses while pending ("outcome still unknown; use /cancelnonce or wait") and resets the nonce when clear; `src/dex/txsender.ts:168` `cancelNonce()` (2x fee, private + public RPC, waits up to 10 min, reports which hash won); `/cancelnonce` registered in `src/main.ts` for both strategies; `src/engine.ts:494` new alert text "Do NOT hedge by hand until the nonce is consumed"; `src/engine.ts:284` `reportResolved` alerts with `executedHash` / `ok` and notes it on the trade row (says so explicitly when there is no receipt) | `test/grok-r2.test.ts` "2) /start confirm is refused while a tx is pending; when clear it resets the nonce" |
| 3 | Save the pending tx and restore it at startup | `src/dex/txsender.ts:207`: every tx is persisted as in flight when it is signed, BEFORE broadcast, and cleared when mined or rejected. The cancel hash is added too. It lives in the SQLite `state` table (`unresolved_tx`), not a separate `pending_tx` table. Only one tx is ever in flight, because sends are blocked while one is unresolved. On restart `checkUnresolved()` runs inside `recoverExecuting` (`src/recovery.ts:28`, called from `src/main.ts:143`). A pending one triggers a critical pause and an alert, and nothing trades until the nonce is used | `test/grok-r2.test.ts` "3) a tx is recorded as in flight BEFORE broadcast"; `test/txsender.test.ts` "restart with a pending tx"; `test/engine.test.ts` "recovery: a pending DEX tx ... keeps the bot critically paused" |
| 4 | MEXC order settled after a cancel | `src/engine.ts:48` `cancelAndConfirm` (the "cancelAndSettle" of the prompt): it cancels and re-reads until the order is FILLED / CANCELED / PARTIALLY_CANCELED, otherwise it throws `OrderStillOpenError`. Used in `cexLeg`, where it becomes `UNKNOWN_ORDER_STATE` (critical pause, no unwind), in `closeAtMarket` (`src/engine.ts:590`), in transfer `finishBuy`, and in the transfer MEXC sell | `test/infra.test.ts` "cancelAndConfirm: never reports a still-open order as closed" (cancel throws and stays NEW; late cancel) |
| 5 | pm2 kill timeout | `ecosystem.config.cjs:15` `kill_timeout: 240000`; `src/main.ts:59` the shutdown waits `TX_TIMEOUT_SEC*2*1000 + 60000`; `src/config.ts:126` caps TX_TIMEOUT_SEC at 80, so the wait (at most 220 s) is always below kill_timeout. SIGINT and SIGTERM are both handled | (config) |
| 6 | Recovery of open MEXC orders and close orders | `src/db.ts:129` `appendCid` (new column `trades.cids`, a JSON array); `src/engine.ts:458` records the entry cid, and `closeAtMarket` records every close cid BEFORE placing it; `src/recovery.ts:28` looks up every cid, cancels and settles any order that is still open, and reports the final status and qty; `src/recovery.ts:95` + `src/mexc/rest.ts:241` `openOrders` sweep the watched symbols for orders with the bot prefix `arb`. The critical pause is kept | `test/grok-r2.test.ts` "6) recovery cancels a close order that is still open and sweeps open bot orders" |
| 7 | Unknown approval and silent stalls | `src/engine.ts:390` "approval outcome UNKNOWN, nonce N, hashes …" (no longer "Approval failed"); `src/engine.ts:223` hourly alert when a tx has been unresolved for more than 10 min, with nonce, hashes and a `/cancelnonce` hint | (covered by the engine paths above) |
| 8 | PERCENT_PRICE_BY_SIDE | `src/mexc/rules.ts`: `priceBand` is parsed from `filters` (default 0.2); `:44` `closePrice` = `min(ask*1.02, ref*(1+0.8*band))` for BUY and `max(bid*0.98, ref*(1-0.8*band))` for SELL, with ref = mid of a fresh book, rounded in the safe direction (with a float epsilon); `:54` `bandProblem`; `src/engine.ts:445` rejects an entry outside the band | `test/grok-r2.test.ts` "8) a 0.5% band clamps the close price", "8) an entry limit outside the band is rejected" |
| 9 | placeSafely "not found" logic | `src/mexc/rest.ts:234`: null ONLY for parsed MEXC code `-2011`, the text regex is removed and every other error is rethrown; `src/engine.ts:84` looks up over 1, 2, 3 and 4 s, and if still not found after an ambiguous error (5xx / timeout) the result is `UNKNOWN_ORDER_STATE`, never "not placed" | `test/grok-r2.test.ts` "9) ... 'currency does not exist' is rethrown", "9) placeSafely: a 5xx followed by 'not found' is UNKNOWN_ORDER_STATE" |
| 10a | PnL | `src/engine.ts:562` `stableBalances`: reads until two consecutive reads match (up to about 15 s), otherwise the note says "pnl approximate" | (engine tests) |
| 10b | Transfer sell without MARKET | `src/transfer.ts:597`: uses the aggressive banded LIMIT plus `cancelAndConfirm` when the symbol has no MARKET | (transfer tests) |
| 10c | Retry-After | `src/mexc/rest.ts:134` `RateLimitError.retryAfterSec` from the header; `src/main.ts:28` backs off for at least that long | (none) |
| 10d | 0x firm-quote check | `scripts/check-0x-quote.ts:1`, run with `npm run check:0x`. It signs and sends nothing, and prints only `transaction.to`, `allowanceTarget` and `issues` | not run (no key in this environment) |
| 10e | Recovery booking | Rows recovered as `one_sided` carry "pnl unknown"; `src/db.ts:142` `unresolvedTrades()`; `/status` lists them; `src/commands.ts:36` `/resolve <id> <pnl>` books the PnL, which then counts in the daily loss budget | `test/grok-r2.test.ts` "10e) /resolve" |

## Deviations from the prompt (and why)
- **Item 3:** the in-flight tx is persisted in the existing `state` table rather than a new `pending_tx`
  table. Sends are serialized (nothing new is sent while a tx is unresolved), so there is at most one nonce
  in flight, and a single record holds all of that nonce's hashes (the tx and its cancels).
- **Item 4 name:** the helper is `cancelAndConfirm`. It was added for Muse's round-2 review and does what the
  prompt calls `cancelAndSettle`.
- **Item 6 sweep:** `openOrders` is swept for the `WATCHLIST` symbols when `STRATEGY=inventory` and
  `WATCHLIST` is set. With auto-discovery, the watchlist is not known yet when recovery runs, so only the
  cids recorded on the trade rows are checked.
- **IOC:** MEXC's docs list `IMMEDIATE_OR_CANCEL` as an order type, and there is no `timeInForce` parameter.
  But no live symbol lists IOC in `orderTypes`, so closes stay LIMIT plus a confirmed cancel.

## Not verified (no keys here)
- Whether 0x `buyAmount` is already net of `zeroExFee`.
- Which asset MEXC charges the buy fee in.
- 1inch v6 request parameters.
- Live `transaction.to`. Run `npm run check:0x` once before going live.
