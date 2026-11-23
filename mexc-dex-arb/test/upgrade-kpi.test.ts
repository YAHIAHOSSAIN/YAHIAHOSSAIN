// Phase-1 upgrade, items 2d and 5a: KPIs and inventory plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db, type OpportunityRow } from '../src/db.js';
import { computeKpis, formatKpis, opportunitiesCsv } from '../src/kpi.js';
import { inventoryPlan } from '../src/inventory.js';
import type { Token } from '../src/watchlist.js';

const row = (o: Partial<OpportunityRow>): OpportunityRow => ({
  ts: Date.UTC(2026, 10, 21, 3, 0), chain: 'base', token: 'AERO', direction: 'DEX_BUY', size_usd: 100, mexc_bid: 1, mexc_ask: 1,
  book_age_ms: 10, aggregator: 'kyber', dex_out: 1, dex_min_out: 1, usdc_usdt: 1.002, gross_bps: 10, fee_bps: 8, gas_usd: 0.01,
  net_usd: -0.1, hurdle_usd: 0.25, decision: 'below_hurdle', reason: null, ...o,
});

test('KPIs: minutes above 20/35/50 bps, would-have PnL per hurdle (one trade per token+direction per minute)', () => {
  const db = new Db(':memory:');
  const t0 = Date.UTC(2026, 10, 21, 3, 0); // 09:00 Dhaka
  db.insertOpportunities([
    row({ ts: t0, gross_bps: 40, net_usd: 0.3 }),
    row({ ts: t0 + 5_000, gross_bps: 45, net_usd: 0.35 }), // same minute: only the best counts
    row({ ts: t0 + 60_000, gross_bps: 60, net_usd: 0.5 }),
    row({ ts: t0 + 120_000, gross_bps: 5, net_usd: -0.2 }),
  ]);
  const k = computeKpis(db, 0, 'paper');
  assert.deepEqual(k.minutesAbove, [
    { bps: 20, minutes: 2 },
    { bps: 35, minutes: 2 },
    { bps: 50, minutes: 1 },
  ]);
  const at30 = k.wouldHave.find((w) => w.hurdle_bps === 30)!; // need net >= $0.30 on $100
  assert.equal(at30.trades, 2);
  assert.ok(Math.abs(at30.pnl - 0.85) < 1e-9);
  assert.equal(k.wouldHave.find((w) => w.hurdle_bps === 60)!.trades, 0);
  assert.deepEqual(k.byHourDhaka, [{ hour: 9, minutes_above_20: 2 }]);
  const text = formatKpis(k);
  assert.match(text, /minutes with gross gap ≥20\/35\/50 bps: 2 \/ 2 \/ 1/);
  assert.match(opportunitiesCsv(db, 0), /^token,hour_dhaka,quotes,max_gross_bps,minutes_above_20\nAERO,9,4,60,2$/);
});

test('inventory plan: low sides and a token-share warning', () => {
  const tok = { base: 'AERO' } as Token;
  const items = inventoryPlan(
    { walletEth: 0.01, walletUsdc: 50, walletToken: { AERO: 900 }, mexc: { USDT: 50, AERO: 10 } },
    [tok],
    { AERO: 1 },
    { tradeUsd: 100, perSideX: 3, maxTokenSharePct: 50, walletAddress: '0xme' },
  );
  const side = (token: string, s: string) => items.find((i) => i.kind === 'side' && i.token === token && i.side === s) as Extract<(typeof items)[number], { kind: 'side' }>;
  assert.equal(side('AERO', 'mexc').low, true); // $10 on MEXC < 1x trade
  assert.equal(side('AERO', 'mexc').direction, 'deposit wallet→MEXC');
  assert.equal(side('AERO', 'mexc').amount, 290); // up to 3x = $300, minus the $10 there
  assert.equal(side('AERO', 'wallet').low, false);
  assert.match(side('STABLE', 'wallet').direction, /withdraw MEXC→wallet 0xme/);
  assert.ok(items.some((i) => i.kind === 'warning' && /tokens are 9\d% of the portfolio/.test(i.text)));
});

test('would-have PnL uses the best row\'s own size (round-3 M4)', () => {
  const db = new Db(':memory:');
  const t0 = Date.UTC(2026, 10, 21, 3, 0);
  db.insertOpportunities([
    row({ ts: t0, net_usd: 0.5, size_usd: 100, gross_bps: 50 }), // best net, small size
    row({ ts: t0 + 5_000, net_usd: 0.3, size_usd: 200, gross_bps: 15 }), // same minute, bigger size
  ]);
  const k = computeKpis(db, 0, 'paper');
  const at30 = k.wouldHave.find((w) => w.hurdle_bps === 30)!;
  // Best net 0.5 on its own size $100: hurdle 30 bps = $0.30 -> trades.
  // (Old code took size $200 from the other row: 0.5 < $0.60 -> 0 trades.)
  assert.equal(at30.trades, 1);
  assert.ok(Math.abs(at30.pnl - 0.5) < 1e-9);
  assert.equal(k.wouldHave.find((w) => w.hurdle_bps === 60)!.trades, 0); // 0.5 < $0.60 on $100
});

test('KPIs ignore DEX_ARB rows: detection-only spreads never count as tradeable gaps', () => {
  const db = new Db(':memory:');
  const t0 = Date.UTC(2026, 10, 21, 3, 0); // 09:00 Dhaka
  db.insertOpportunities([
    row({ ts: t0, gross_bps: 40, net_usd: 0.3 }),
    row({ ts: t0 + 60_000, gross_bps: 60, net_usd: 0.5 }),
    // DEX-ARB rows with bigger numbers must change NOTHING below.
    row({ ts: t0, token: 'LINK', direction: 'DEX_ARB', gross_bps: 1500, net_usd: 24, size_usd: 200, decision: 'trade' }),
    row({ ts: t0 + 60_000, token: 'LINK', direction: 'DEX_ARB', gross_bps: 1200, net_usd: 20, size_usd: 200, decision: 'trade' }),
  ]);
  const k = computeKpis(db, 0, 'paper');
  assert.deepEqual(k.minutesAbove, [
    { bps: 20, minutes: 2 },
    { bps: 35, minutes: 2 },
    { bps: 50, minutes: 1 },
  ]);
  const at30 = k.wouldHave.find((w) => w.hurdle_bps === 30)!;
  assert.equal(at30.trades, 2);
  assert.ok(Math.abs(at30.pnl - 0.8) < 1e-9); // 0.3 + 0.5, not +24/+20
  assert.deepEqual(k.byHourDhaka, [{ hour: 9, minutes_above_20: 2 }]);
  assert.deepEqual(k.decisions, [{ decision: 'below_hurdle', n: 2 }]);
  assert.deepEqual(k.opportunitiesPerToken, [{ token: 'AERO', n: 2, best_gross_bps: 60 }]);
  assert.deepEqual(k.histogram, [
    { token: 'AERO', bucket: '35-50', n: 1 },
    { token: 'AERO', bucket: '50+', n: 1 },
  ]);
  assert.match(opportunitiesCsv(db, 0), /^token,hour_dhaka,quotes,max_gross_bps,minutes_above_20\nAERO,9,2,60,2$/);
});

test('gasShareOfGross counts gas only on ok/paper trades, like gross (round-3 L1)', () => {
  const db = new Db(':memory:');
  const t0 = Date.UTC(2026, 10, 21, 3, 0);
  const trade = (o: object) => ({
    ts: t0, day: '2026-11-21', mode: 'paper', symbol: 'AERO', direction: 'DEX_BUY', size_usd: 100, qty: 10,
    buy_price: 10, sell_price: 11, expected_net: 1, cex_fee_usd: 0.5, gas_usd: 1, pnl_usd: 10,
    status: 'ok' as const, dex_tx: null, cex_order_id: null, note: null, ...o,
  });
  db.insertTrade(trade({}));
  db.insertTrade(trade({ status: 'paper', pnl_usd: 5, gas_usd: 2 }));
  db.insertTrade(trade({ status: 'one_sided', pnl_usd: -5, gas_usd: 4, cex_fee_usd: 0 }));
  db.insertTrade(trade({ status: 'dex_failed', pnl_usd: 0, gas_usd: 3, cex_fee_usd: 0 }));
  const k = computeKpis(db, 0, 'paper');
  // gas on ok/paper only: 1 + 2 = 3; gross on ok/paper only: (10+1+0.5) + (5+2+0.5) = 19.
  assert.ok(k.gasShareOfGross !== null && Math.abs(k.gasShareOfGross - 3 / 19) < 1e-9, String(k.gasShareOfGross));
});

test('inventory plan STABLE ticket names the chain stable (round-3 L2)', () => {
  const tok = { base: 'AERO' } as Token;
  const bal = { walletEth: 0.01, walletUsdc: 50, walletToken: { AERO: 900 }, mexc: { USDT: 50, AERO: 10 } };
  const items = inventoryPlan(bal, [tok], { AERO: 1 },
    { tradeUsd: 100, perSideX: 3, maxTokenSharePct: 50, walletAddress: '0xme', stableSymbol: 'USDC' });
  const side = (token: string, s: string) =>
    items.find((i) => i.kind === 'side' && i.token === token && i.side === s) as Extract<(typeof items)[number], { kind: 'side' }>;
  assert.equal(side('STABLE', 'wallet').asset, 'USDC');
  assert.match(side('STABLE', 'wallet').direction, /withdraw USDC MEXC→wallet 0xme/);
  assert.equal(side('STABLE', 'mexc').asset, 'USDT');
  assert.match(side('STABLE', 'mexc').direction, /deposit USDC wallet→MEXC \(swap to USDT on MEXC\)/);
  // BSC (stable USDT): both sides plain USDT, no swap note.
  const bsc = inventoryPlan(bal, [tok], { AERO: 1 },
    { tradeUsd: 100, perSideX: 3, maxTokenSharePct: 50, walletAddress: '0xme', stableSymbol: 'USDT' });
  const bside = (token: string, s: string) =>
    bsc.find((i) => i.kind === 'side' && i.token === token && i.side === s) as Extract<(typeof bsc)[number], { kind: 'side' }>;
  assert.equal(bside('STABLE', 'wallet').asset, 'USDT');
  assert.equal(bside('STABLE', 'mexc').direction, 'deposit wallet→MEXC');
});

test('opportunities has a (ts) index for long report windows (round-3 M5)', () => {
  const db = new Db(':memory:');
  const idx = db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'opp_ts'`);
  assert.equal(idx.length, 1);
});
