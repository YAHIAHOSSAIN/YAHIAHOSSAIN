import 'dotenv/config';
import { chainProfile } from './chains.js';

export type Mode = 'live' | 'paper';
export type AggregatorName = '0x' | '1inch' | 'kyber';

function str(name: string, def?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (def === undefined) throw new Error(`Missing required env var ${name} (see .env.example)`);
    return def;
  }
  return v.trim();
}
function num(name: string, def: number): number {
  const v = Number(str(name, String(def)));
  if (!Number.isFinite(v)) throw new Error(`Env var ${name} must be a number`);
  return v;
}

export function loadConfig() {
  const mode = str('MODE', 'paper').toLowerCase() as Mode;
  if (mode !== 'live' && mode !== 'paper') throw new Error('MODE must be live or paper');
  // One or several, e.g. "0x,kyber": all are asked, the best quote after gas is used.
  const aggregators = str('DEX_AGGREGATOR', '0x')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean) as AggregatorName[];
  for (const a of aggregators) if (!['0x', '1inch', 'kyber'].includes(a)) throw new Error(`DEX_AGGREGATOR: unknown "${a}" (use 0x, 1inch, kyber)`);
  const aggregator = aggregators[0];

  const strategy = str('STRATEGY', 'inventory').toLowerCase();
  if (strategy !== 'transfer' && strategy !== 'inventory') throw new Error('STRATEGY must be transfer or inventory');
  // Transfer mode needs a MEXC key that can WITHDRAW. That is off unless explicitly allowed.
  const chain = chainProfile(str('CHAIN', 'ethereum'));
  if (strategy === 'transfer' && chain.name !== 'ethereum') throw new Error('STRATEGY=transfer is only supported on CHAIN=ethereum');
  if (strategy === 'transfer' && str('ALLOW_WITHDRAWALS', 'no').toLowerCase() !== 'yes') {
    throw new Error('STRATEGY=transfer needs MEXC withdrawals; set ALLOW_WITHDRAWALS=yes only if you accept that risk');
  }

  return {
    mode,
    // transfer  = scan all MEXC ERC20 tokens, buy on MEXC, withdraw to wallet, sell on DEX
    // inventory = hold tokens on both sides and trade both legs at the same moment
    strategy: strategy as 'transfer' | 'inventory',
    // --- Ethereum ---
    rpcUrl: str('RPC_URL'),
    // Private RPC for sending: never the public mempool.
    sendRpcUrl: str('SEND_RPC_URL', 'https://rpc.mevblocker.io'),
    privateKey: mode === 'live' ? str('PRIVATE_KEY') : str('PRIVATE_KEY', ''),
    chain,
    // The DEX-side stable (USDC on Ethereum/Base/Arbitrum, USDT on BSC). STABLE_ADDRESS overrides the chain default.
    usdc: str('STABLE_ADDRESS', str('USDC_ADDRESS', chain.stable.address)).toLowerCase(),
    stableIsUsdt: chain.stable.symbol === 'USDT',
    tickMs: num('TICK_MS', chain.tickMs ?? 0),
    // --- DEX aggregator ---
    aggregator,
    aggregators,
    kyberClientId: str('KYBER_CLIENT_ID', 'mexc-dex-arb'),
    // Our own quote budget per aggregator (calls per second). 0x Standard ~5 rps; Kyber public 3 rps
    // (docs.kyberswap.com rate limits); 1inch free 1 rps.
    quoteRps: { '0x': num('QUOTE_RPS_0X', 4), kyber: num('QUOTE_RPS_KYBER', 3), '1inch': num('QUOTE_RPS_1INCH', 1) },
    // Multi-size quoting: base size = BASE_TRADE_USD (default MAX_TRADE_USD/2); 0.5x and 2x are tried when the
    // base-size gross gap reaches MULTISIZE_TRIGGER of the hurdle.
    baseTradeUsd: num('BASE_TRADE_USD', 0),
    multiSizeTrigger: num('MULTISIZE_TRIGGER', 0.7),
    // --- Monitoring ---
    oppRetentionDays: num('OPP_RETENTION_DAYS', 30),
    // Paper mode re-quotes both legs after this delay and books THAT net (the first quote overstates profit).
    paperLatencyMs: num('PAPER_LATENCY_MS', 1000),
    // --- Inventory ---
    inventoryPerSideX: num('INVENTORY_PER_SIDE_X', 3), // hold ~3x the trade size per token per side
    maxTokenSharePct: num('MAX_TOKEN_SHARE_PCT', 50), // token holdings above this % of the portfolio: warn
    skewK: num('SKEW_K', 0.75), // hurdle *= 1 + SKEW_K * (how much a trade worsens the wallet/MEXC balance)
    rebalanceAfterMin: num('REBALANCE_AFTER_MIN', 30), // a side below 1x trade size this long: one rebalance ticket
    zeroExApiKey: str('ZEROX_API_KEY', ''),
    oneInchApiKey: str('ONEINCH_API_KEY', ''),
    // --- MEXC ---
    mexcApiKey: mode === 'live' ? str('MEXC_API_KEY') : str('MEXC_API_KEY', ''),
    mexcApiSecret: mode === 'live' ? str('MEXC_API_SECRET') : str('MEXC_API_SECRET', ''),
    // Override / floor only: the bot uses max(this, the symbol's own takerCommission from exchangeInfo).
    mexcTakerFee: num('MEXC_TAKER_FEE', 0.0005),
    // USDCUSDT book older than this, or a rate outside 0.99-1.01: no trading.
    stableRateMaxAgeMs: num('STABLE_RATE_MAX_AGE_MS', 30_000),
    // --- Telegram ---
    telegramToken: str('TELEGRAM_BOT_TOKEN', ''),
    telegramChatId: str('TELEGRAM_CHAT_ID', ''),
    // Only this Telegram user may send commands (in a private chat with the bot).
    telegramAdminId: str('TELEGRAM_ADMIN_ID', ''),
    // --- Watchlist ---
    watchlist: str('WATCHLIST', '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    watchlistMax: num('WATCHLIST_MAX', 8),
    minDexTvlUsd: num('MIN_DEX_TVL_USD', 200_000),
    minMexcVolumeUsd: num('MIN_MEXC_VOLUME_USD', 500_000),
    // --- Costs & thresholds ---
    // Must be small relative to MAX_TRADE_USD: $15 on a $50 trade would need a ~30% gap = only fake gaps pass.
    // need = max(MIN_PROFIT_USD, MIN_PROFIT_BPS of the size): mostly a percentage, with a small dollar floor.
    minProfitUsd: num('MIN_PROFIT_USD', 0.25),
    minProfitBps: num('MIN_PROFIT_BPS', 20),
    dexSlippageBps: num('DEX_SLIPPAGE_BPS', 30),
    // The MEXC book walk already uses the worst price reached; this is only a small extra cushion.
    cexSlippageBps: num('CEX_SLIPPAGE_BPS', 5),
    // safety = max(SAFETY_MARGIN_USD, SAFETY_MARGIN_BPS of the size)
    safetyMarginUsd: num('SAFETY_MARGIN_USD', 0),
    safetyMarginBps: num('SAFETY_MARGIN_BPS', 10),
    // CAP on the priority fee. The tip actually used is the median of recent blocks' tips (eth_feeHistory).
    priorityFeeGwei: num('PRIORITY_FEE_GWEI', 1),
    // --- Risk limits ---
    maxTradeUsd: num('MAX_TRADE_USD', 50),
    minTradeUsd: num('MIN_TRADE_USD', 25),
    maxTradesPerDay: num('MAX_TRADES_PER_DAY', 20),
    dailyLossLimitUsd: num('DAILY_LOSS_LIMIT_USD', 30),
    // Skip a trade if losing this % of its size (+ gas) would break the remaining daily loss budget.
    worstCaseLossPct: num('WORST_CASE_LOSS_PCT', 5),
    maxGasGwei: num('MAX_GAS_GWEI', 40),
    maxConsecutiveFails: num('MAX_CONSECUTIVE_FAILS', 3),
    minEthForGas: num('MIN_ETH_FOR_GAS', 0.01),
    txTimeoutSec: num('TX_TIMEOUT_SEC', 60),
    // --- Transfer strategy (scanner) ---
    scanIntervalSec: num('SCAN_INTERVAL_SEC', 20),
    scanMinGapPct: num('SCAN_MIN_GAP_PCT', 3), // cheap pre-filter before exact quotes
    scanMaxGapPct: num('SCAN_MAX_GAP_PCT', 30), // bigger gaps are almost always a wrong token / dead pool
    scanExactQuotes: num('SCAN_EXACT_QUOTES', 5), // max exact DEX quotes per scan
    transferDriftBps: num('TRANSFER_DRIFT_BPS', 150), // price-move reserve while withdrawing
    transferTimeoutMin: num('TRANSFER_TIMEOUT_MIN', 90),
    maxOpenTransfers: num('MAX_OPEN_TRANSFERS', 1),
    // After arrival, do not sell automatically if it would lose more than this % of the cost: hold + alert.
    transferMaxLossPct: num('TRANSFER_MAX_LOSS_PCT', 3),
    // --- Misc ---
    dbPath: str('DB_PATH', `data/${chain.name}.sqlite`), // one database per chain
    envPath: str('ENV_PATH', '.env'),
  };
}

export type Config = ReturnType<typeof loadConfig>;

/** Reject settings that would make the bot trade backwards or without limits. */
export function validateConfig(c: Config): Config {
  const errs: string[] = [];
  const range = (name: string, v: number, min: number, max: number) => {
    if (!(v >= min && v <= max)) errs.push(`${name}=${v} must be between ${min} and ${max}`);
  };
  range('MIN_PROFIT_USD', c.minProfitUsd, 0, 1e6);
  // A floor above 10% of the trade size means only absurd (fake / dead-pool) gaps could ever pass.
  if (c.minProfitUsd > c.maxTradeUsd * 0.1) {
    errs.push(`MIN_PROFIT_USD=${c.minProfitUsd} is more than 10% of MAX_TRADE_USD=${c.maxTradeUsd}: only fake gaps could pass`);
  }
  range('MIN_PROFIT_BPS', c.minProfitBps, 0, 10_000);
  range('SAFETY_MARGIN_BPS', c.safetyMarginBps, 0, 1_000);
  range('TICK_MS', c.tickMs, 0, 60_000);
  range('DEX_SLIPPAGE_BPS', c.dexSlippageBps, 1, 500);
  range('CEX_SLIPPAGE_BPS', c.cexSlippageBps, 0, 500);
  range('SAFETY_MARGIN_USD', c.safetyMarginUsd, 0, 1e6);
  range('MEXC_TAKER_FEE', c.mexcTakerFee, 0, 0.01);
  range('MAX_TRADE_USD', c.maxTradeUsd, 1, 1e7);
  range('MIN_TRADE_USD', c.minTradeUsd, 1, c.maxTradeUsd);
  range('MAX_TRADES_PER_DAY', c.maxTradesPerDay, 1, 10_000);
  range('DAILY_LOSS_LIMIT_USD', c.dailyLossLimitUsd, 0.01, 1e7);
  range('WORST_CASE_LOSS_PCT', c.worstCaseLossPct, 0, 100);
  range('MAX_GAS_GWEI', c.maxGasGwei, 0.01, 1000);
  range('MAX_CONSECUTIVE_FAILS', c.maxConsecutiveFails, 1, 100);
  // Upper bound keeps the graceful-shutdown wait (2x this + 60 s) below pm2's kill_timeout (240 s).
  range('TX_TIMEOUT_SEC', c.txTimeoutSec, 12, 80);
  range('SCAN_INTERVAL_SEC', c.scanIntervalSec, 5, 3600);
  range('SCAN_MIN_GAP_PCT', c.scanMinGapPct, 0, c.scanMaxGapPct);
  range('SCAN_MAX_GAP_PCT', c.scanMaxGapPct, c.scanMinGapPct, 100);
  range('TRANSFER_DRIFT_BPS', c.transferDriftBps, 0, 5000);
  range('TRANSFER_TIMEOUT_MIN', c.transferTimeoutMin, 5, 24 * 60);
  range('TRANSFER_MAX_LOSS_PCT', c.transferMaxLossPct, 0, 100);
  range('MAX_OPEN_TRANSFERS', c.maxOpenTransfers, 1, 10);
  if (errs.length) throw new Error(`Invalid config:\n  ${errs.join('\n  ')}`);
  return c;
}

/** Every secret value, so the logger can scrub them from any output. */
export function secretsOf(cfg: Config): string[] {
  // RPC URLs usually embed a provider API key (Alchemy/Infura), so they are secrets too.
  return [cfg.privateKey, cfg.mexcApiKey, cfg.mexcApiSecret, cfg.zeroExApiKey, cfg.oneInchApiKey, cfg.telegramToken, cfg.rpcUrl, cfg.sendRpcUrl]
    .filter((s) => s && s.length >= 8)
    .flatMap((s) => [s, s.replace(/^0x/, '')]);
}
