import 'dotenv/config';
import { chainProfile, stableSymbolFor } from './chains.js';

export type Mode = 'live' | 'paper';
export type AggregatorName = '0x' | '1inch' | 'kyber' | 'velora' | 'openocean';

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
  for (const a of aggregators) if (!['0x', '1inch', 'kyber', 'velora', 'openocean'].includes(a)) throw new Error(`DEX_AGGREGATOR: unknown "${a}" (use 0x, 1inch, kyber, velora, openocean)`);
  const aggregator = aggregators[0];

  const strategy = str('STRATEGY', 'inventory').toLowerCase();
  if (strategy !== 'transfer' && strategy !== 'inventory') throw new Error('STRATEGY must be transfer or inventory');
  // Transfer mode needs a MEXC key that can WITHDRAW. That is off unless explicitly allowed.
  const chain = chainProfile(str('CHAIN', 'ethereum'));
  // Transfer mode was built + tested on Ethereum first; the DEX price lookup,
  // withdraw network and explorer links are chain-aware now (2026-11-22), so
  // Arbitrum + BSC are allowed too. Base stays blocked (its L1-fee accounting
  // + Base-specific withdraw path are not verified for transfer).
  if (strategy === 'transfer' && !['ethereum', 'arbitrum', 'bsc'].includes(chain.name)) throw new Error('STRATEGY=transfer is only supported on CHAIN=ethereum/arbitrum/bsc');
  if (strategy === 'transfer' && str('ALLOW_WITHDRAWALS', 'no').toLowerCase() !== 'yes') {
    throw new Error('STRATEGY=transfer needs MEXC withdrawals; set ALLOW_WITHDRAWALS=yes only if you accept that risk');
  }

  // The DEX-side stable (USDC on Ethereum/Base/Arbitrum, USDT on BSC). STABLE_ADDRESS overrides the chain default.
  // stableIsUsdt follows the OVERRIDDEN address, not the chain default: pointing STABLE_ADDRESS at a USDT
  // token on a USDC chain (or vice versa) used to keep the wrong stable rate (round-3 review, L7c).
  // An address that is none of the four chains' stables falls back to the chain default.
  const stableAddress = str('STABLE_ADDRESS', str('USDC_ADDRESS', chain.stable.address)).toLowerCase();

  return {
    mode,
    // transfer  = scan all MEXC ERC20 tokens, buy on MEXC, withdraw to wallet, sell on DEX
    // inventory = hold tokens on both sides and trade both legs at the same moment
    strategy: strategy as 'transfer' | 'inventory',
    // --- Ethereum ---
    rpcUrl: str('RPC_URL'),
    // Private RPC for sending: never the public mempool.
    sendRpcUrl: str('SEND_RPC_URL', 'https://rpc.mevblocker.io'),
    // Paper never signs a transaction, so it must not hold the hot wallet's
    // private key in memory (audit 2026-11-22, L3): the chain profile already
    // carries the wallet address, and the key is only needed to sign live sends.
    privateKey: mode === 'live' ? str('PRIVATE_KEY') : '',
    chain,
    // The DEX-side stable (USDC on Ethereum/Base/Arbitrum, USDT on BSC). STABLE_ADDRESS overrides the chain default.
    usdc: stableAddress,
    stableIsUsdt: (stableSymbolFor(stableAddress) ?? chain.stable.symbol) === 'USDT',
    tickMs: num('TICK_MS', chain.tickMs ?? 0),
    // --- DEX aggregator ---
    aggregator,
    aggregators,
    kyberClientId: str('KYBER_CLIENT_ID', 'mexc-dex-arb'),
    // Our own quote budget per aggregator (calls per second). 0x Standard ~5 rps; Kyber public 3 rps
    // (docs.kyberswap.com rate limits); 1inch free 1 rps. Velora free tier is 1 rps / 5,000 req/day
    // (docs.velora.xyz pro-api-accounts), so its default is 1, not 2; OpenOcean public is 2 rps.
    quoteRps: {
      '0x': num('QUOTE_RPS_0X', 4),
      kyber: num('QUOTE_RPS_KYBER', 3),
      '1inch': num('QUOTE_RPS_1INCH', 1),
      velora: num('QUOTE_RPS_VELORA', 1),
      openocean: num('QUOTE_RPS_OPENOCEAN', 2),
    },
    // Multi-size quoting: base size = BASE_TRADE_USD (default MAX_TRADE_USD/2); 0.5x and 2x are tried when the
    // base-size gross gap reaches MULTISIZE_TRIGGER of the hurdle.
    baseTradeUsd: num('BASE_TRADE_USD', 0),
    multiSizeTrigger: num('MULTISIZE_TRIGGER', 0.7),
    // Quote-saving pre-filter: only request a DEX quote when the rough MEXC-vs-DexScreener gap
    // is at least this many bps (0 = off). Tradeable gaps are ~35+ bps at these sizes, so 30 keeps all of them.
    prefilterBps: num('PREFILTER_BPS', 30),
    // --- Monitoring ---
    oppRetentionDays: num('OPP_RETENTION_DAYS', 7),
    // Paper mode re-quotes both legs after this delay and books THAT net (the first quote overstates profit).
    paperLatencyMs: num('PAPER_LATENCY_MS', 1000),
    // --- Inventory ---
    inventoryPerSideX: num('INVENTORY_PER_SIDE_X', 3), // hold ~3x the trade size per token per side
    maxTokenSharePct: num('MAX_TOKEN_SHARE_PCT', 50), // token holdings above this % of the portfolio: warn
    skewK: num('SKEW_K', 0.75), // hurdle *= 1 + SKEW_K * (how much a trade worsens the wallet/MEXC balance)
    rebalanceAfterMin: num('REBALANCE_AFTER_MIN', 30), // a side below REBALANCE_LOW_X x trade size this long: one rebalance ticket
    rebalanceLowX: num('REBALANCE_LOW_X', 1), // a side counts as "low" below this multiple of the trade size
    // --- DEX-DEX detection (Phase 4) ---
    // Detection ONLY: when yes, each inventory tick also prices stable->token and token->stable
    // through BestOf and logs any cross-pool spread. It NEVER trades, sends or approves anything.
    dexArbEnabled: str('DEX_ARB_ENABLED', 'no').toLowerCase() === 'yes',
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
    watchlistRescanMin: num('WATCHLIST_RESCAN_MIN', 60),
    minDexTvlUsd: num('MIN_DEX_TVL_USD', 200_000),
    minMexcVolumeUsd: num('MIN_MEXC_VOLUME_USD', 500_000),
    // Live mode only trades tokens proven profitable in paper (see provenTokens in watchlist.ts).
    liveMinPaperTrades: num('LIVE_MIN_PAPER_TRADES', 2),
    liveMinPaperPnlUsd: num('LIVE_MIN_PAPER_PNL_USD', 0),
    liveWatchlistMax: num('LIVE_WATCHLIST_MAX', 10),
    // --- Costs & thresholds ---
    // Must be small relative to MAX_TRADE_USD: $15 on a $50 trade would need a ~30% gap = only fake gaps pass.
    // need = max(MIN_PROFIT_USD, MIN_PROFIT_BPS of the size): mostly a percentage, with a small dollar floor.
    minProfitUsd: num('MIN_PROFIT_USD', 0.25),
    minProfitBps: num('MIN_PROFIT_BPS', 20),
    // Phase 5 — dynamic hurdle: Ethereum gas is $4+ per trade, L2 gas is
    // cents, so one hurdle fits neither. When > 0, Ethereum uses this bps
    // instead of MIN_PROFIT_BPS; Arbitrum/BSC/Base always use MIN_PROFIT_BPS.
    // 0 = off (default: current behaviour everywhere until the owner sets it,
    // e.g. MIN_PROFIT_BPS_ETH=50 on the Ethereum twin only).
    minProfitBpsEth: num('MIN_PROFIT_BPS_ETH', 0),
    dexSlippageBps: num('DEX_SLIPPAGE_BPS', 30),
    // The MEXC book walk already uses the worst price reached; this is only a small extra cushion.
    cexSlippageBps: num('CEX_SLIPPAGE_BPS', 5),
    // safety = max(SAFETY_MARGIN_USD, SAFETY_MARGIN_BPS of the size)
    safetyMarginUsd: num('SAFETY_MARGIN_USD', 0),
    safetyMarginBps: num('SAFETY_MARGIN_BPS', 10),
    // CAP on the priority fee. The tip actually used is the median of recent blocks' tips (eth_feeHistory).
    priorityFeeGwei: num('PRIORITY_FEE_GWEI', 1),
    // Phase 5 — optional extra tip (gwei) paid on top of the median tip, e.g.
    // to bid for builder inclusion through a private RPC. 0 = off (default:
    // the gas path is exactly the median-tip path from before).
    builderTipGwei: num('BUILDER_TIP_GWEI', 0),
    // OP-stack L1 data fee reserve (USD) added to every gas estimate (round-3 review, M1).
    // 0 on Ethereum/Arbitrum. On Base, set it to a typical legs.l1_fee from a past trade (usually a few cents):
    // receipts now record l1_fee, so the value can be measured instead of guessed.
    l1FeeUsd: num('L1_FEE_USD', 0),
    // --- Risk limits ---
    maxTradeUsd: num('MAX_TRADE_USD', 50),
    minTradeUsd: num('MIN_TRADE_USD', 25),
    maxTradesPerDay: num('MAX_TRADES_PER_DAY', 20),
    dailyLossLimitUsd: num('DAILY_LOSS_LIMIT_USD', 30),
    // Skip a trade if losing this % of its size (+ gas) would break the remaining daily loss budget.
    worstCaseLossPct: num('WORST_CASE_LOSS_PCT', 5),
    maxGasGwei: num('MAX_GAS_GWEI', 40),
    // Unlimited token approval (MaxUint256) instead of exact-amount approval: the first sale of a
    // token approves once, later sales skip the approve tx (~12s saved per sale). Risk: a compromised
    // spender contract could drain the whole token balance from the wallet. Default off (exact
    // approvals); owner turned it ON for the live twin only on 2026-11-21, after the warning.
    unlimitedApproval: str('UNLIMITED_APPROVAL', 'no').toLowerCase() === 'yes',
    maxConsecutiveFails: num('MAX_CONSECUTIVE_FAILS', 3),
    minEthForGas: num('MIN_ETH_FOR_GAS', 0.01),
    txTimeoutSec: num('TX_TIMEOUT_SEC', 60),
    // Transfer-universe volume rules (live twin, owner decision 2026-11-22): MEXC 24h volume
    // + DEX 24h volume floors, and a cap on universe size. Defaults keep the old behaviour
    // (MEXC volume only, no DEX filter, no cap); the live twin sets all three.
    minDexVolumeUsd: num('MIN_DEX_VOLUME_USD', 0),
    transferUniverseMax: num('TRANSFER_UNIVERSE_MAX', 0),
    // --- Depth filter (Phase 1) ---
    // Skip a token whose best DEX pool is thinner than this, or whose trade
    // size would move the pool more than DEPTH_MAX_IMPACT_BPS. A pool with
    // UNKNOWN liquidity (tvl 0 / no DexScreener data) is fail-open: the exact
    // quote still gates the trade. DEPTH_MAX_SIZE_PCT caps the size as a %
    // of the pool; it only binds when the impact bps are raised (at the
    // 0.7% default the impact check already caps size at 0.35% of the pool).
    minPoolLiquidityUsd: num('MIN_POOL_LIQUIDITY_USD', 150_000),
    depthMaxImpactBps: num('DEPTH_MAX_IMPACT_BPS', 70),
    depthMaxSizePct: num('DEPTH_MAX_SIZE_PCT', 1),
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
    // --- Pairing-code dashboard ---
    // The central receiver that serves the multi-user dashboard. Empty = the
    // bot never pushes (its code still exists for /pairing, but no snapshot
    // leaves this VPS). Yahia's VPS: http://127.0.0.1:3102/api/ingest (same
    // machine as the status server). A friend's VPS: https://arb.alphahelper.online/api/ingest.
    ingestUrl: str('INGEST_URL', ''),
    ingestIntervalSec: num('INGEST_INTERVAL_SEC', 25),
    dbPath: str('DB_PATH', `data/${chain.name}.sqlite`), // one database per chain
    paperDbPath: str('PAPER_DB_PATH', ''), // live twin: read paper history from the paper bot's DB (empty = own DB)
    envPath: str('ENV_PATH', '.env'),
  };
}

export type Config = ReturnType<typeof loadConfig>;

/**
 * Phase 5 — dynamic hurdle (bps): Ethereum uses MIN_PROFIT_BPS_ETH when it
 * is set (> 0); every other chain uses MIN_PROFIT_BPS. The dollar floor
 * (MIN_PROFIT_USD) is the same everywhere — only the bps leg is chain-aware.
 */
export function hurdleBps(cfg: Config): number {
  return cfg.chain.name === 'ethereum' && cfg.minProfitBpsEth > 0 ? cfg.minProfitBpsEth : cfg.minProfitBps;
}

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
  range('MIN_PROFIT_BPS_ETH', c.minProfitBpsEth, 0, 10_000);
  range('BUILDER_TIP_GWEI', c.builderTipGwei, 0, 100);
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
  range('L1_FEE_USD', c.l1FeeUsd, 0, 100);
  range('MAX_CONSECUTIVE_FAILS', c.maxConsecutiveFails, 1, 100);
  // Upper bound keeps the graceful-shutdown wait (2x this + 60 s) below pm2's kill_timeout (240 s).
  range('TX_TIMEOUT_SEC', c.txTimeoutSec, 12, 80);
  range('SCAN_INTERVAL_SEC', c.scanIntervalSec, 5, 3600);
  range('INGEST_INTERVAL_SEC', c.ingestIntervalSec, 10, 300);
  range('QUOTE_RPS_VELORA', c.quoteRps.velora, 0, 100);
  range('QUOTE_RPS_OPENOCEAN', c.quoteRps.openocean, 0, 100);
  range('MIN_DEX_VOLUME_USD', c.minDexVolumeUsd, 0, 1e7);
  range('TRANSFER_UNIVERSE_MAX', c.transferUniverseMax, 0, 1000);
  range('MIN_POOL_LIQUIDITY_USD', c.minPoolLiquidityUsd, 0, 1e9);
  range('DEPTH_MAX_IMPACT_BPS', c.depthMaxImpactBps, 0, 5000);
  range('DEPTH_MAX_SIZE_PCT', c.depthMaxSizePct, 0, 100);
  range('REBALANCE_LOW_X', c.rebalanceLowX, 0.1, 10);
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
