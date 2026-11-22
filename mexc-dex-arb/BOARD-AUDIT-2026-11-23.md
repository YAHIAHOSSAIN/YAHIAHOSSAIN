# BOARD AUDIT — MEXC-DEX arb dashboard (arb.alphahelper.online) — 2026-11-23 ~03:00 Dhaka

Independent audit of the board only: `status-server.mjs` (port 3102) + dashboard
pages + API endpoints + the numbers they show. Read-only: no pm2 restart/stop,
no orders/withdrawals, no code or config edits, no commit/push. Nothing was fixed.

## Verdict: NOT CLEAN — 0 Critical, 0 High, 1 Medium, 6 Low

No wrong numbers, no crashes, no secret leaks. Every displayed number checked
matches the live DBs. The one Medium finding is a flagship section that is
structurally empty and misleads about what the depth filter actually did.

## Live verification (VPS, 2026-11-23 ~02:57–03:00 Dhaka)

- Port 3102 LISTEN on 127.0.0.1, pid 172571 (`mexc-dex-arb-status`).
- Local: `/` 200, `/ethereum` 200, `/arbitrum` 200, `/bsc` 200,
  `/api/status?chain=ethereum|arbitrum|bsc` 200, `/api/chains` 200.
- Public: https://arb.alphahelper.online 200 (index + nav), /ethereum 200 —
  all sections present in served HTML (Trade Detail, Gap Chart, Depth Filter,
  per-token, daily, Live, Priority Winners, Live Trade Detail, Live Gap Chart,
  Live Depth Filter). Numbers load via JS (`fetch('/api/status…')`), so the
  text snapshot shows "লোড হচ্ছে…" — expected; the API behind it was verified
  against the DBs below.
- VPS code == repo code: `status-server.mjs` md5 66b61dbe10f9982a74a508fa65178fdb
  on both; `status-ecosystem.config.cjs` md5 c86df1588bead54e14dc51d2b216566d on both.
- pm2: eth-live 172539, arb-live 172551, bsc-live 172563, status 172571 — all
  online; paper (`mexc-dex-arb-ethereum`) stopped, as decided.

## Numbers cross-checked: API vs live DB (all match)

| Check | API | DB ground truth | Match |
|---|---|---|---|
| Eth live hero | 3 trades, +$10.24, 1 win, best ACN +$15.79 | 3 trades (METIS −$2.71, METIS −$2.84, ACN +$15.79), +$10.2449, gas $0.19, fees $1.60 | ✅ |
| Eth live today (2026-11-23) | 1 trade, +$15.79, gas $0.19, fees $0.39 | 1 trade (ACN), +$15.7947 | ✅ |
| Priority Winners | ACN only (1 trade, +$15.79, 1 win) | same query on DB | ✅ |
| Eth paper hero | 26 trades, +$19.92 | 26 trades, +$19.9214 | ✅ |
| Eth paper today | 1 trade, +$2.50 | 1 trade (ACN paper), +$2.5015 | ✅ |
| Arb/BSC live hero | 0 trades, $0 | 0 trades | ✅ |
| Transfers (eth live) | ACN done, METIS failed ×2 | same | ✅ |
| Inventory | BGB $0/$0, NPC $0/$0 | same (latest snapshots) | ✅ |
| Config (all live chains) | kyber, DEX-ARB OFF, floor $150k, max impact 70bps, strategy transfer | `state` cfg:* keys | ✅ |
| Max size display | $300 paper + live | pm2 config LIVE_MAX_TRADE_USD=300; bot MAX_TRADE_USD=300 | ✅ |
| Gap totals (24h) | eth 10420, arb 1278, bsc 9640 | eth 10440, arb 1278, bsc 9660 (few-min drift from live scanning) | ✅ |
| Depth rejects (24h) | 0 everywhere | `depth_rejects` table exists in live DBs, 0 rows ever | ✅ (see M1) |
| /api/chains | eth live 3/+$10.24 online, paper 26/+$19.92 stopped; arb/bsc live 0 online, paper null | matches | ✅ |
| Public safety | no tx hash / order id / wallet address in any /api/status JSON (checked full payloads; whitelist in `mapRecent`) | — | ✅ |

## Findings

### Medium

**M1 — Depth section is structurally empty: the filter's real work is invisible.**
`depth_rejects` has 0 rows in all three live DBs (table exists, never written),
so every chain's Depth section permanently shows "এখনো কোনো depth rejection
রেকর্ড হয়নি". Yet the depth filter demonstrably works: the eth universe fell
96 → 78 tokens after the Phase 1 deploy. Cause (code-verified): the filter
bites at universe-build time (`refreshUniverse` pool floor $150k) and in
`findGaps` (`minTvlUsd`), neither of which records anything; `depth_rejects`
is only written for above-threshold candidates that fail inside `depthSizes` /
`scanExactQuotes` (`transfer.ts:314,326,573` → `flushDepthRejects`, line 555 —
the flush IS wired, the path just almost never fires because candidates already
passed the TVL filters). A reader concludes the filter did nothing. Also the
empty-state text offers "অথবা bot এখনো Phase 6-এর deploy পায়নি" as an
explanation — stale, Phase 6 deployed 2026-11-22. Fix direction (not done):
record universe-build rejections, or reword the section to say where the
filter actually applies.

### Low

**L1 — "Booked" column is always "—" for live trades.** `requoted_net` is NULL
for all 3 live trades (METIS ×2, ACN) — transfer mode never writes it — while
paper trades do carry it (e.g. BGB 0.758). The board renders null faithfully
as "—", but its own note promises Booked = "re-quote করে বুক করা আসল হিসাব",
which can never appear for live trades. Bot data gap surfaced by the board;
`pnl_usd` itself (+$15.79 etc.) is shown correctly.

**L2 — Gap chart shows "সেরা net $0.00" when there is no net.** Live
`opportunities` rows below the hurdle have `net_usd` NULL, so
`readGapStats` returns `bestNet: null` (eth live: bestBps 635, bestNet null)
and `gapHtml` renders `Number(null || 0)` → "$0.00". Should render "—".

**L3 — Gap bar width divides by `log10(total)`: total == 1 renders
`width:Infinity%`.** `gapHtml`: `Math.log10(count+1) / Math.log10(total)`.
`total === 0` is handled by the early return, but `total === 1` gives
`log10(1) === 0` → `Infinity` → `style="width:Infinity%"` (invalid CSS, bar
breaks). Not triggered live (totals are 1278–10440); latent edge case.

**L4 — No live universe/token count is displayed anywhere.** The board shows
"গত ১ ঘণ্টায় টোকেন দেখেছে" for paper only (0 — paper stopped); live has no
equivalent, so the 78-token universe (and the 96 → 78 cut) is invisible.
DB: eth-live 14 distinct tokens in the last hour, arb 3, bsc 22.

**L5 — Recycle outcome is not shown on the board.** Transfer #3's recycle
completed (263.601851 USDC → 263.360648 USDT, order ethereum3r), but the
board's transfer query selects only `ts, base, status, note` — the
`recycle_status` / `recycled_usdt` columns are never read, so the ACN row
still just says "done / swap reverted" with no sign the $263 came back.

**L6 — Cosmetic: /ethereum subtitle is paper-only, and a stale demo file
exists.** The page subtitle reads "আসল টাকা নয়, শুধু paper হিসাব" although
the same page carries the full Live section (which has its own warning line).
Separately, `dashboard-demo.html` (repo root, 2026-11-22) is an unserved demo
with old numbers — dead file, no live impact, but confusing in the repo.

## Tests

- Local full suite: **291/291 pass, 0 fail** (`npm test`, 7.7s).
- VPS full suite: **291/291 pass, 0 fail** (`npm test`, 51.6s).
- Board-specific: `test/status-server.test.ts` — 8 tests (Phase 6 readers +
  Phase 9 winners + PUBLIC SAFETY no-leak block), all passing within the 291.
- `node --check` equivalent: suite typechecks (`tsc --noEmit` clean per
  earlier deploy reports; status-server.mjs is plain JS, imported by the tests).

## Grok package

`~/workspace/board-code-for-grok.zip` (32,387 bytes, 7 files):
`status-server.mjs`, `status-ecosystem.config.cjs`, `status-README.md`,
`status-server.test.ts`, `db.ts`, `depth.ts`, `README-GROK.md` (live numbers +
the 5 open questions above). Secret-scanned on the extracted zip: no `sk-`
keys, API-key values, BOT_TOKEN, PRIVATE_KEY, passwords, mnemonics, GitHub/AWS
tokens, and no 40-hex wallet addresses. The only `.env` hits are comments
stating the server never reads `.env`; the only `0x…` strings in the test file
are the fake fixtures `0xSECRET` / `0xLIVESECRET` / `0xWALLETSECRET` (not real
addresses). No `.env` file or contents included.

## Method note

DB comparisons used read-only queries (`PRAGMA query_only=ON`) against the
VPS DBs; API payloads were fetched from the live server and compared field by
field. Public pages were checked via text fetch (JS-rendered numbers verified
through the API, not the crawler snapshot).
