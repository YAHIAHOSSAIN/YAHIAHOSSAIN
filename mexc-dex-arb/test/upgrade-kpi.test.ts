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
