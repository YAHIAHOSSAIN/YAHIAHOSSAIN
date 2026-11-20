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
    scanExactQuotes: num('SCAN_EXACT_QUOTES', 5), // max exact DEX quotes per scan
    transferDriftBps: num('TRANSFER_DRIFT_BPS', 150), // price-move reserve while withdrawing
    transferTimeoutMin: num('TRANSFER_TIMEOUT_MIN', 90),
    maxOpenTransfers: num('MAX_OPEN_TRANSFERS', 1),
    // --- Misc ---
    dbPath: str('DB_PATH', 'data/bot.sqlite'),
    envPath: str('ENV_PATH', '.env'),
  };
}

export type Config = ReturnType<typeof loadConfig>;

/** Every secret value, so the logger can scrub them from any output. */
export function secretsOf(cfg: Config): string[] {
  return [cfg.privateKey, cfg.mexcApiKey, cfg.mexcApiSecret, cfg.zeroExApiKey, cfg.oneInchApiKey, cfg.telegramToken]
    .filter((s) => s && s.length >= 8)
    .flatMap((s) => [s, s.replace(/^0x/, '')]);
}
