export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run fn over items in parallel batches of `size` (network-bound work). Results keep input order. */
export async function mapBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

const DHAKA_OFFSET_MS = 6 * 3600 * 1000; // Bangladesh: UTC+6, no DST

/** Calendar day in Bangladesh time, e.g. "2026-11-20". Daily limits reset at Dhaka midnight. */
export function dhakaDay(t = Date.now()): string {
  return new Date(t + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export function dhakaHourMinute(t = Date.now()): { hour: number; minute: number } {
  const d = new Date(t + DHAKA_OFFSET_MS);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** Round down to a multiple of `step` (e.g. MEXC quantity precision) and format without float noise. */
export function floorToStep(x: number, step: number): number {
  if (step <= 0) return x;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  const v = Math.floor(x / step + 1e-9) * step;
  return Number(v.toFixed(decimals));
}

export function decimalsOfStep(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

export const usd = (x: number) => `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(2)}`;

/** Token amount (bigint base units) -> float. Fine for pricing; never used for on-chain amounts. */
export function toFloat(amount: bigint, decimals: number): number {
  const s = amount.toString().padStart(decimals + 1, '0');
  return Number(`${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals) || '0'}`);
}

/** Float -> base units, truncated (never rounded up, so we never ask for more than we hold). */
export function toUnits(x: number, decimals: number): bigint {
  if (!(x > 0) || !Number.isFinite(x)) return 0n;
  // Work on the shortest exact decimal string of the number and CUT it: toFixed() would round
  // (0.1239999999 -> "0.124"), and the full binary expansion is slightly above the intended value.
  const [i, f = ''] = plainDecimal(x).split('.');
  return BigInt(i + f.padEnd(decimals, '0').slice(0, decimals));
}

/** Number -> plain decimal string without exponent ("1.5e-7" -> "0.00000015"). */
function plainDecimal(x: number): string {
  const s = String(x);
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[1] + (m[2] ?? '');
  const point = m[1].length + Number(m[3]);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}
