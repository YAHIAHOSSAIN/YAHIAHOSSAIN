// Phase 4: REBALANCE_LOW_X threshold + shortfall warnings in inventoryPlan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryPlan } from '../src/inventory.js';
import type { Token } from '../src/watchlist.js';

const AERO = { base: 'AERO' } as Token;

/** Wallet $wA of AERO, MEXC $mA, both stables $1000 (healthy, no stable noise). */
function plan(wA: number, mA: number, o: { lowX?: number; tradeUsd?: number; perSideX?: number } = {}) {
  return inventoryPlan(
    { walletEth: 0.01, walletUsdc: 1000, walletToken: { AERO: wA }, mexc: { USDT: 1000, AERO: mA } },
    [AERO],
    { AERO: 1 },
    { tradeUsd: o.tradeUsd ?? 100, perSideX: o.perSideX ?? 3, maxTokenSharePct: 100, lowX: o.lowX },
  );
}
const side = (items: ReturnType<typeof plan>, token: string, s: 'wallet' | 'mexc') =>
  items.find((i) => i.kind === 'side' && i.token === token && i.side === s) as Extract<ReturnType<typeof plan>[number], { kind: 'side' }>;
const warnings = (items: ReturnType<typeof plan>) => items.filter((i) => i.kind === 'warning');

test('REBALANCE_LOW_X moves the low threshold: $140 is low at 1.5x, not at 1x or 0.5x', () => {
  assert.equal(side(plan(140, 1000, { lowX: 1.5 }), 'AERO', 'wallet').low, true); // 140 < 1.5 * 100
  assert.equal(side(plan(140, 1000, { lowX: 1 }), 'AERO', 'wallet').low, false); // 140 >= 100
  assert.equal(side(plan(140, 1000, { lowX: 0.5 }), 'AERO', 'wallet').low, false); // 140 >= 50
  assert.equal(side(plan(60, 1000, { lowX: 0.5 }), 'AERO', 'wallet').low, false); // 60 >= 0.5 * 100
  assert.equal(side(plan(40, 1000, { lowX: 0.5 }), 'AERO', 'wallet').low, true); // 40 < 50
});

test('REBALANCE_LOW_X defaults to 1 when not passed (old behaviour)', () => {
  assert.equal(side(plan(60, 1000), 'AERO', 'wallet').low, true); // 60 < 100
  assert.equal(side(plan(100, 1000), 'AERO', 'wallet').low, false); // exactly 1x is not low
});

test('shortfall warning: a low side the other side cannot cover, with the right amounts', () => {
  // Wallet $10, target $300: needs $290 more, MEXC only has $50.
  const items = plan(10, 50);
  const w = warnings(items).find((x) => x.kind === 'warning' && x.key === 'shortfall-AERO-wallet');
  assert.ok(w, JSON.stringify(items));
  assert.equal(
    w.text,
    'AERO wallet needs $290.00 more, but the other side only has $50.00 — deposit fresh funds, moving alone will not cover it',
  );
  // The ticket amount is capped at what the other side holds ($50 of tokens).
  assert.equal(side(items, 'AERO', 'wallet').amount, 50);
});

test('shortfall warning: the mexc side, and the STABLE side', () => {
  const items = plan(1000, 10); // MEXC $10, target $300, wallet has $1000: no shortfall (covers)
  assert.equal(warnings(items).some((x) => x.kind === 'warning' && x.key === 'shortfall-AERO-mexc'), false);
  const short = plan(50, 10); // MEXC $10, wallet only $50: needs $290, other side has $50
  const w = warnings(short).find((x) => x.kind === 'warning' && x.key === 'shortfall-AERO-mexc');
  assert.ok(w);
  assert.match(w.text, /AERO mexc needs \$290\.00 more, but the other side only has \$50\.00/);
  // STABLE: wallet $10 of USDC, MEXC $50 USDT, target $300.
  const stable = inventoryPlan(
    { walletEth: 0.01, walletUsdc: 10, walletToken: { AERO: 1000 }, mexc: { USDT: 50, AERO: 1000 } },
    [AERO],
    { AERO: 1 },
    { tradeUsd: 100, perSideX: 3, maxTokenSharePct: 100 },
  );
  const sw = warnings(stable).find((x) => x.kind === 'warning' && x.key === 'shortfall-STABLE-wallet');
  assert.ok(sw, JSON.stringify(stable));
  assert.match(sw.text, /STABLE wallet needs \$290\.00 more, but the other side only has \$50\.00/);
});

test('no shortfall warning when the other side CAN cover the deficit', () => {
  // Wallet $10, target $300: needs $290, MEXC has $500 — moving covers it.
  const items = plan(10, 500);
  assert.equal(warnings(items).some((x) => x.kind === 'warning' && x.key.startsWith('shortfall-')), false);
  // Exactly covering is enough: needs $290, other side has exactly $290.
  assert.equal(warnings(plan(10, 290)).some((x) => x.kind === 'warning' && x.key.startsWith('shortfall-')), false);
  // A side that is not low never warns, even below target: wallet $150 (not low at 1x),
  // target $300, MEXC $100 (exactly 1x, not low) — the $150 deficit exceeds the $100
  // on the other side, but no ticket is owed for either side, so no warning.
  assert.equal(warnings(plan(150, 100)).some((x) => x.kind === 'warning' && x.key.startsWith('shortfall-')), false);
});
