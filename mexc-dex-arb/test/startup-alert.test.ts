// Startup-failure alerts are throttled to one per 15 min per chain (audit 2026-11-22, M5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STARTUP_ALERT_WINDOW_MS, recordStartupAlert, startupAlertDue } from '../src/startup-alert.js';

test('startup alert: due on first failure, throttled for 15 min, due again after', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'startup-alert-'));
  try {
    const stamp = join(dir, '.startup-alert-arbitrum');
    const t0 = 1_700_000_000_000; // a realistic "now" (epoch 0 would make even a missing stamp look fresh)
    assert.equal(await startupAlertDue(stamp, t0), true); // no stamp yet
    await recordStartupAlert(stamp, t0);
    assert.equal(await startupAlertDue(stamp, t0 + 1000), false); // 1s later: throttled
    assert.equal(await startupAlertDue(stamp, t0 + STARTUP_ALERT_WINDOW_MS - 1), false);
    assert.equal(await startupAlertDue(stamp, t0 + STARTUP_ALERT_WINDOW_MS), true); // window passed
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
