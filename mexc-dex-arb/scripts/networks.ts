// Read-only: per MEXC network, how many USDT-listed tokens have deposit AND withdraw enabled and a contract.
// Also shows which raw MEXC network names each CHAIN profile matches (src/chains.ts), so you can check
// the matcher before trading a new chain. It NEVER trades. Usage: npm run networks
import 'dotenv/config';
import { MexcRest } from '../src/mexc/rest.js';
import { CHAINS, networkFor } from '../src/chains.js';
import { isOnline } from '../src/watchlist.js';

const key = process.env.MEXC_API_KEY;
const secret = process.env.MEXC_API_SECRET;
if (!key || !secret) throw new Error('MEXC_API_KEY / MEXC_API_SECRET needed (a read-only key is enough)');

const mexc = new MexcRest(key, secret);
await mexc.syncTime();
const [symbols, coins] = await Promise.all([mexc.exchangeInfo(), mexc.coinConfigs()]);
const usdtBases = new Set(symbols.filter((s) => s.quoteAsset === 'USDT' && s.isSpotTradingAllowed && isOnline(s.status)).map((s) => s.baseAsset.toUpperCase()));
const listed = coins.filter((c) => usdtBases.has(c.coin.toUpperCase()));

const ok = (n: { depositEnable: boolean; withdrawEnable: boolean; contract?: string }) =>
  n.depositEnable && n.withdrawEnable && Boolean(n.contract && /^0x[0-9a-fA-F]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(n.contract));

// 1) Raw MEXC network names
const raw = new Map<string, number>();
for (const c of listed) for (const n of c.networkList) if (ok(n)) raw.set(`${n.netWork ?? '-'} | ${n.network}`, (raw.get(`${n.netWork ?? '-'} | ${n.network}`) ?? 0) + 1);
console.log(`USDT-listed coins: ${listed.length}\n\nTop MEXC networks (netWork | network): tokens with deposit+withdraw+contract`);
for (const [k, v] of [...raw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(4)}  ${k}`);

// 2) What each CHAIN profile matches
console.log('\nPer CHAIN profile (src/chains.ts matcher):');
for (const chain of Object.values(CHAINS)) {
  const names = new Set<string>();
  let n = 0;
  for (const c of listed) {
    const net = networkFor(chain, c.networkList);
    if (net && ok(net)) {
      n++;
      names.add(`${net.netWork ?? '-'} | ${net.network}`);
    }
  }
  console.log(`  ${chain.name.padEnd(9)} ${String(n).padStart(4)} tokens   matched names: ${[...names].join('; ') || '(none)'}`);
}
console.log('\nIf a chain matched the wrong name (or nothing), fix mexcNetwork in src/chains.ts before trading it.');
