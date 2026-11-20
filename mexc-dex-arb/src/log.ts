// Console logger that scrubs secrets (private key, API keys, bot token) from every line.

let secrets: string[] = [];

export function registerSecrets(values: string[]): void {
  secrets = [...new Set(values)].sort((a, b) => b.length - a.length);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

function fmt(args: unknown[]): string {
  return redact(
    args
      .map((a) => (a instanceof Error ? `${a.message}` : typeof a === 'string' ? a : JSON.stringify(a, bigintSafe)))
      .join(' '),
  );
}

export function bigintSafe(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { shortMessage?: string; message?: string };
    return redact(o.shortMessage || o.message || String(e));
  }
  return redact(String(e));
}

const ts = () => new Date().toISOString();
export const log = {
  info: (...a: unknown[]) => console.log(`${ts()} INFO  ${fmt(a)}`),
  warn: (...a: unknown[]) => console.warn(`${ts()} WARN  ${fmt(a)}`),
  error: (...a: unknown[]) => console.error(`${ts()} ERROR ${fmt(a)}`),
};
