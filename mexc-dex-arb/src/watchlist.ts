// Builds the token list: on MEXC (USDT pair) AND on Ethereum, with the SAME contract address
// (taken from MEXC's own deposit network info), enough DEX TVL and MEXC volume.
import type { CoinConfig, MexcRest } from './mexc/rest.js';
import { log, errMsg } from './log.js';
import { type SymbolRules, rulesFrom } from './mexc/rules.js';

/** exchangeInfo status: live API returns "1"; the docs example shows "ENABLED". Accept both. */
export const isOnline = (status: unknown) => String(status) === '1' || String(status).toUpperCase() === 'ENABLED';

export interface Token {
  base: string; // e.g. LINK
  symbol: string; // MEXC symbol, e.g. LINKUSDT
  address: string; // Ethereum contract (lowercase)
  decimals: number;
  qtyStep: number; // MEXC quantity step (from baseAssetPrecision)
  priceDecimals: number; // MEXC price precision
  rules: SymbolRules;
  dexTvlUsd: number;
  mexcVolumeUsd: number;
  depositOk: boolean;
  withdrawOk: boolean;
}

const SKIP = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'BUSD', 'ETH', 'WETH', 'STETH', 'WBTC']);

/** MEXC's Ethereum network entry for a coin (network names vary: "ERC20", "Ethereum(ERC20)", netWork "ETH"). */
export function ethNetwork(cfg: CoinConfig) {
  return cfg.networkList.find(
    (n) => n.netWork === 'ETH' || /ERC20/i.test(n.network) || /^ethereum$/i.test(n.network),
  );
}

type FetchFn = typeof fetch;

/** Highest liquidity (USD) of any Ethereum pool for the token, from DexScreener. */
export async function dexTvl(address: string, fetchFn: FetchFn = fetch): Promise<number> {
  const res = await fetchFn(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  const j = (await res.json()) as { pairs?: { chainId: string; liquidity?: { usd?: number } }[] | null };
  return Math.max(0, ...(j.pairs ?? []).filter((p) => p.chainId === 'ethereum').map((p) => p.liquidity?.usd ?? 0));
}

export async function buildWatchlist(
  mexc: MexcRest,
  decimalsOf: (address: string) => Promise<number>,
  opts: { only: string[]; max: number; minTvlUsd: number; minVolumeUsd: number },
): Promise<Token[]> {
  const [symbols, tickers, coins] = await Promise.all([mexc.exchangeInfo(), mexc.tickers24h(), mexc.coinConfigs()]);
  const volume = new Map(tickers.map((t) => [t.symbol, Number(t.quoteVolume)]));
  const coinBy = new Map(coins.map((c) => [c.coin.toUpperCase(), c]));

  const candidates = symbols
    .filter((s) => s.quoteAsset === 'USDT' && s.isSpotTradingAllowed && isOnline(s.status))
    .filter((s) => !SKIP.has(s.baseAsset.toUpperCase()))
    .filter((s) => opts.only.length === 0 || opts.only.includes(s.baseAsset.toUpperCase()))
    .filter((s) => (volume.get(s.symbol) ?? 0) >= opts.minVolumeUsd)
    .sort((a, b) => (volume.get(b.symbol) ?? 0) - (volume.get(a.symbol) ?? 0));

  // Check candidates 8 at a time (each DexScreener call can take seconds), stop once we have enough.
  const out: Token[] = [];
  const check = async (s: (typeof candidates)[number]): Promise<Token | null> => {
    const coin = coinBy.get(s.baseAsset.toUpperCase());
    const net = coin && ethNetwork(coin);
    if (!net?.contract || !/^0x[0-9a-fA-F]{40}$/.test(net.contract)) return null; // not an Ethereum token on MEXC
    const address = net.contract.toLowerCase();
    try {
      const tvl = await dexTvl(address);
      if (tvl < opts.minTvlUsd) {
        log.info(`watchlist: skip ${s.baseAsset}, DEX TVL $${Math.round(tvl)}`);
        return null;
      }
      const rules = rulesFrom(s);
      return {
        base: s.baseAsset.toUpperCase(),
        symbol: s.symbol,
        address,
        decimals: await decimalsOf(address),
        qtyStep: rules.qtyStep,
        priceDecimals: s.quotePrecision,
        rules,
        dexTvlUsd: tvl,
        mexcVolumeUsd: volume.get(s.symbol) ?? 0,
        depositOk: net.depositEnable,
        withdrawOk: net.withdrawEnable,
      };
    } catch (e) {
      log.warn(`watchlist: ${s.baseAsset} check failed: ${errMsg(e)}`);
      return null;
    }
  };
  for (let i = 0; i < candidates.length && out.length < opts.max; i += 8) {
    const batch = await Promise.all(candidates.slice(i, i + 8).map(check));
    for (const t of batch) if (t && out.length < opts.max) out.push(t);
  }
  return out;
}

/** Refresh deposit/withdraw flags (tokens with either suspended are skipped). */
export async function refreshStatus(mexc: MexcRest, tokens: Token[]): Promise<string[]> {
  const coins = new Map((await mexc.coinConfigs()).map((c) => [c.coin.toUpperCase(), c]));
  const changed: string[] = [];
  for (const t of tokens) {
    const net = coins.get(t.base) && ethNetwork(coins.get(t.base)!);
    const dep = Boolean(net?.depositEnable && net.contract?.toLowerCase() === t.address);
    const wd = Boolean(net?.withdrawEnable);
    if (dep !== t.depositOk || wd !== t.withdrawOk) changed.push(`${t.base}: deposit ${dep ? 'on' : 'OFF'}, withdraw ${wd ? 'on' : 'OFF'}`);
    t.depositOk = dep;
    t.withdrawOk = wd;
  }
  return changed;
}
