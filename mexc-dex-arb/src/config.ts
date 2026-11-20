import 'dotenv/config';

export type Mode = 'live' | 'paper';
export type AggregatorName = '0x' | '1inch';

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
  const mode = str('MODE', 'live').toLowerCase() as Mode;
  if (mode !== 'live' && mode !== 'paper') throw new Error('MODE must be live or paper');
  const aggregator = str('DEX_AGGREGATOR', '0x') as AggregatorName;
  if (aggregator !== '0x' && aggregator !== '1inch') throw new Error('DEX_AGGREGATOR must be 0x or 1inch');

  const strategy = str('STRATEGY', 'transfer').toLowerCase();
  if (strategy !== 'transfer' && strategy !== 'inventory') throw new Error('STRATEGY must be transfer or inventory');

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
    usdc: str('USDC_ADDRESS', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48').toLowerCase(),
    // --- DEX aggregator ---
    aggregator,
    zeroExApiKey: str('ZEROX_API_KEY', ''),
    oneInchApiKey: str('ONEINCH_API_KEY', ''),
    // --- MEXC ---
    mexcApiKey: mode === 'live' ? str('MEXC_API_KEY') : str('MEXC_API_KEY', ''),
    mexcApiSecret: mode === 'live' ? str('MEXC_API_SECRET') : str('MEXC_API_SECRET', ''),
    mexcTakerFee: num('MEXC_TAKER_FEE', 0.0005),
    // --- Telegram ---
    telegramToken: str('TELEGRAM_BOT_TOKEN', ''),
    telegramChatId: str('TELEGRAM_CHAT_ID', ''),
    // --- Watchlist ---
    watchlist: str('WATCHLIST', '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    watchlistMax: num('WATCHLIST_MAX', 8),
    minDexTvlUsd: num('MIN_DEX_TVL_USD', 200_000),
    minMexcVolumeUsd: num('MIN_MEXC_VOLUME_USD', 500_000),
    // --- Costs & thresholds ---
    minProfitUsd: num('MIN_PROFIT_USD', 15),
    minProfitPct: num('MIN_PROFIT_PCT', 0.5), // percent of trade size
    dexSlippageBps: num('DEX_SLIPPAGE_BPS', 30),
    cexSlippageBps: num('CEX_SLIPPAGE_BPS', 20),
    safetyMarginUsd: num('SAFETY_MARGIN_USD', 2),
    priorityFeeGwei: num('PRIORITY_FEE_GWEI', 1),
    // --- Risk limits ---
    maxTradeUsd: num('MAX_TRADE_USD', 200),
    minTradeUsd: num('MIN_TRADE_USD', 25),
    maxTradesPerDay: num('MAX_TRADES_PER_DAY', 20),
    dailyLossLimitUsd: num('DAILY_LOSS_LIMIT_USD', 30),
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
    dbPath: str('DB_PATH', 'data/bot.sqlite'),
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
  range('MIN_PROFIT_PCT', c.minProfitPct, 0, 100);
  range('DEX_SLIPPAGE_BPS', c.dexSlippageBps, 1, 500);
  range('CEX_SLIPPAGE_BPS', c.cexSlippageBps, 0, 500);
  range('SAFETY_MARGIN_USD', c.safetyMarginUsd, 0, 1e6);
  range('MEXC_TAKER_FEE', c.mexcTakerFee, 0, 0.01);
  range('MAX_TRADE_USD', c.maxTradeUsd, 1, 1e7);
  range('MIN_TRADE_USD', c.minTradeUsd, 1, c.maxTradeUsd);
  range('MAX_TRADES_PER_DAY', c.maxTradesPerDay, 1, 10_000);
  range('DAILY_LOSS_LIMIT_USD', c.dailyLossLimitUsd, 0.01, 1e7);
  range('MAX_GAS_GWEI', c.maxGasGwei, 0.01, 1000);
  range('MAX_CONSECUTIVE_FAILS', c.maxConsecutiveFails, 1, 100);
  range('TX_TIMEOUT_SEC', c.txTimeoutSec, 12, 600);
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
  return [cfg.privateKey, cfg.mexcApiKey, cfg.mexcApiSecret, cfg.zeroExApiKey, cfg.oneInchApiKey, cfg.telegramToken]
    .filter((s) => s && s.length >= 8)
    .flatMap((s) => [s, s.replace(/^0x/, '')]);
}
