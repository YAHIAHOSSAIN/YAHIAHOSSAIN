// Startup-failure alerts are throttled to one per window per chain: pm2
// restarts a failing start up to 1000x, and every attempt would otherwise
// send a Telegram alert (observed 2026-11-22: 2 Arbitrum alerts 12s apart).
// The stamp file survives the process exit, so the throttle holds across
// restarts. (audit 2026-11-22, M5)
import { readFile, writeFile } from 'node:fs/promises';

export const STARTUP_ALERT_WINDOW_MS = 15 * 60_000;

export async function startupAlertDue(
  stampPath: string,
  nowMs: number = Date.now(),
  windowMs: number = STARTUP_ALERT_WINDOW_MS,
): Promise<boolean> {
  const last = Number((await readFile(stampPath, 'utf8').catch(() => '0')) || 0);
  return nowMs - last >= windowMs;
}

export async function recordStartupAlert(stampPath: string, nowMs: number = Date.now()): Promise<void> {
  await writeFile(stampPath, String(nowMs)).catch(() => undefined);
}
