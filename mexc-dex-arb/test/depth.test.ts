// Phase 1 depth filter: estimated impact, passesDepth, maxSafeSize, depthRejectReason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depthRejectReason, depthSafeSize, estimatedImpact, maxSafeSize, passesDepth, topDepthRejects } from '../src/dex/depth.js';

// Float math: 350 into a $100k pool is 0.7000000000000001%, not exactly 0.7%.
const approx = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);

test('estimatedImpact: size against half the pool', () => {
  approx(estimatedImpact(300, 1_000_000), 0.06); // 300 / 500k
  approx(estimatedImpact(300, 100_000), 0.6); // 300 / 50k
  approx(estimatedImpact(350, 100_000), 0.7); // exactly the default cap
  assert.equal(estimatedImpact(0, 1_000_000), 0);
  assert.equal(estimatedImpact(100, 0), 10_000); // no liquidity: impact is capped by the /2 floor of $1
  assert.equal(estimatedImpact(100, 1), 10_000); // $1 pool: half is $0.50, floored to $1
  assert.equal(estimatedImpact(1, 2), 100); // $1 into a $2 pool = the whole half
});

test('passesDepth boundaries: liq exactly $100k, impact exactly 0.7%', () => {
  assert.equal(passesDepth(350, 100_000), true); // impact exactly 0.7%, liq exactly $100k
  assert.equal(passesDepth(351, 100_000), false); // impact 0.702% > 0.7%
  assert.equal(passesDepth(349, 100_000), true);
  assert.equal(passesDepth(100, 99_999), false); // $1 under the liquidity floor
  assert.equal(passesDepth(100, 100_000), true);
  assert.equal(passesDepth(0, 100_000), true); // zero size: no impact
  assert.equal(passesDepth(100, 0), false); // unknown liquidity fails passesDepth itself (callers fail-open)
  assert.equal(passesDepth(350, 100_000, 0.5), false); // tighter cap: 0.7% > 0.5%
  assert.equal(passesDepth(250, 100_000, 0.5), true); // 0.5% <= 0.5%
});

test('maxSafeSize: the largest size at the impact cap', () => {
  approx(maxSafeSize(1_000_000), 3500); // 0.7% of the $500k half
  approx(maxSafeSize(100_000), 350);
  assert.equal(maxSafeSize(0), 0);
  approx(maxSafeSize(1_000_000, 1), 5000); // 1% cap
  assert.equal(maxSafeSize(1_000_000, 0), 0);
  // Round-trip: the max safe size itself just passes the impact check.
  assert.equal(passesDepth(maxSafeSize(1_000_000), 1_000_000), true);
  assert.equal(passesDepth(maxSafeSize(1_000_000) + 1, 1_000_000), false);
});

test('depthRejectReason: null when it may proceed, a reason when it must not', () => {
  assert.equal(depthRejectReason(200, 1_000_000), null); // deep pool, 0.04% impact
  assert.equal(depthRejectReason(200, 0), null); // unknown liquidity: fail-open
  assert.equal(depthRejectReason(200, -5), null);
  assert.match(depthRejectReason(200, 42_000)!, /pool \$42k < \$100k/); // known-thin pool
  assert.match(
    depthRejectReason(200, 150_000, { minLiqUsd: 150_000, maxImpactPct: 0.1 })!,
    /impact 0\.27% > 0\.10%/,
  ); // passes the floor, fails the impact cap
  assert.match(
    depthRejectReason(15_000, 1_000_000, { maxImpactPct: 5, maxSizePct: 1 })!,
    /size \$15000 is 1\.50% of pool \$1000k > 1%/,
  ); // impact 3% passes, size-as-%-of-pool fails
  assert.equal(depthRejectReason(10_000, 1_000_000, { maxImpactPct: 5, maxSizePct: 1 }), null); // exactly 1% of the pool
});

test('depthRejectReason honours the live knobs (floor $150k, 70 bps)', () => {
  const live = { maxImpactPct: 70 / 100, minLiqUsd: 150_000, maxSizePct: 1 };
  assert.match(depthRejectReason(300, 42_000, live)!, /pool \$42k < \$150k/); // WKC-style thin pool
  assert.equal(depthRejectReason(300, 150_000, live), null); // 0.40% impact, at the floor: passes
  assert.equal(depthRejectReason(300, 200_000, live), null);
});

test('depthSafeSize: impact cap binds at the defaults, size cap binds when impact is raised', () => {
  approx(depthSafeSize(1_000_000), 3500); // 0.7% of the $500k half
  approx(depthSafeSize(100_000), 350);
  assert.equal(depthSafeSize(0), 0);
  approx(depthSafeSize(1_000_000, { maxImpactPct: 5, maxSizePct: 1 }), 10_000); // 5% impact -> $25k, capped to 1% of the pool
  approx(depthSafeSize(1_000_000, { maxImpactPct: 1, maxSizePct: 1 }), 5000); // 1% impact -> $5k, under the 1% size cap
  approx(depthSafeSize(160_000), 560); // the Phase-2 transfer ladder pool
});

// ---------------- Phase 6: top-10 summary detail ----------------
test('topDepthRejects: highest impact first, capped at 10', () => {
  const mk = (token: string, impact: number) => ({ token, liq_usd: 42_000, impact_pct: impact, reason: `impact ${impact}% > 0.70%` });
  const details = Array.from({ length: 12 }, (_, i) => mk(`T${i}`, i + 1)); // impacts 1..12
  const top = topDepthRejects(details);
  assert.equal(top.length, 10);
  assert.deepEqual(top.map((d) => d.token), ['T11', 'T10', 'T9', 'T8', 'T7', 'T6', 'T5', 'T4', 'T3', 'T2']);
  assert.equal(topDepthRejects(details, 3).length, 3);
  assert.deepEqual(topDepthRejects([]), []);
});
