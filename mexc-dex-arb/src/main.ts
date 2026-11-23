// Entry point. Wires everything together, runs one scan per block.
import fs from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig, secretsOf, validateConfig } from './config.js';
import { log, errMsg, registerSecrets } from './log.js';
import { Db, publishPublicConfig } from './db.js';
import { Risk } from './risk.js';
import { Telegram, makeModeTag } from './telegram.js';
import { MexcRest, RateLimitError } from './mexc/rest.js';
import { MexcBookStream } from './mexc/ws.js';
import { Chain } from './dex/chain.js';
import { BestOf, Kyber, Limited, OneInch, OpenOcean, TokenBucket, Velora, ZeroEx, type Aggregator } from './dex/aggregator.js';
import { buildWatchlist, provenTokens, refreshStatus } from './watchlist.js';
import { paperBalances, snapshot } from './inventory.js';
import { Engine } from './engine.js';
import { TransferEngine } from './transfer.js';
import { dexPrices } from './scanner.js';
import { formatReport } from './summary.js';
import { recoverExecuting } from './recovery.js';
import { makeUnresolvedCheck, resolveTrade, startHandler, unresolvedLines } from './commands.js';
import { startupAlertDue, recordStartupAlert } from './startup-alert.js';
import { dhakaDay, dhakaHourMinute, usd, walletLine } from './util.js';

const cfg = validateConfig(loadConfig());
registerSecrets(secretsOf(cfg));


/** Backoff after HTTP 429/418 from any API: skip scans for 1, 2, 4 ... up to 15 minutes. */
const rateLimit = { until: 0, level: 0 };
function onScanError(e: unknown): boolean {
  if (e instanceof RateLimitError || /\b(429|418)\b/.test(errMsg(e))) {
    const retryAfter = e instanceof RateLimitError ? e.retryAfterSec * 1000 : 0;
    const wait = Math.max(retryAfter, Math.min(15 * 60_000, 60_000 * 2 ** rateLimit.level++));
    rateLimit.until = Date.now() + wait;
    log.warn(`rate limited, pausing scans for ${wait / 60_000} min`);
    return true;
  }
  return false;
}
function rateLimited(): boolean {
  if (Date.now() < rateLimit.until) return true;
  return false;
}
function rateLimitOk() {
  rateLimit.level = 0;
}

/** Set by shutdown: loops stop starting new ticks. */
export const lifecycle = { stopping: false, busy: false };

/**
 * Crash handlers: exit (pm2 restarts) only on real crashes; a stray rejected promise is logged and alerted.
 * On SIGINT/SIGTERM/crash: stop new ticks and wait for a running trade to finish (up to TX_TIMEOUT_SEC*2+30s).
 */
function installProcessHandlers(tg: Telegram, cleanup: () => void) {
  let shuttingDown = false;
  const shutdown = async (why: string, code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    lifecycle.stopping = true;
    // pm2 sends SIGKILL after kill_timeout (ecosystem.config.cjs: 240 s; pm2's default is only 1.6 s).
    // A running trade can need ~2x TX_TIMEOUT_SEC (swap + cancel) plus lookups and an unwind, so wait for
    // TX_TIMEOUT_SEC*2 + 60 s. validateConfig caps TX_TIMEOUT_SEC at 80, so this always stays below 240 s.
    const deadline = Date.now() + cfg.txTimeoutSec * 2 * 1000 + 60_000;
    if (lifecycle.busy) log.info('shutdown: waiting for the running trade to finish');
    while (lifecycle.busy && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
    await tg.send(`🔌 Bot stopped: ${why}${lifecycle.busy ? ' (a trade was still running: check /status after restart)' : ''}`);
    cleanup();
    tg.stop();
    process.exit(code);
  };
  let lastRejectAlert = 0;
  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('unhandledRejection', (e) => {
    log.error(`unhandled rejection: ${errMsg(e)}`);
    if (Date.now() - lastRejectAlert > 3600_000) {
      lastRejectAlert = Date.now();
      void tg.send(`❗ Unhandled error (bot keeps running): ${errMsg(e)}`);
    }
  });
  process.on('uncaughtException', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));
}

/** Refuse to trade live if .env is readable by other users. */
function checkEnvPermissions(path: string) {
  if (!fs.existsSync(path)) return log.warn(`${path} not found; make sure secrets come from a protected place`);
  const mode = fs.statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`${path} has permissions ${mode.toString(8)}; run: chmod 600 ${path}`);
}

async function main() {
  if (cfg.mode === 'live') checkEnvPermissions(cfg.envPath);

  const db = new Db(cfg.dbPath);
  // Phase 6 (option b): publish the bot's PUBLIC config into the DB so the
  // read-only status dashboard can show aggregators / DEX-ARB / depth floor
  // without reading .env. Public values only, never secrets; a restart with
  // new env rewrites them. A failed write must never kill startup.
  try {
    publishPublicConfig(db, {
      aggregators: cfg.aggregators,
      dexArbEnabled: cfg.dexArbEnabled,
      minPoolLiquidityUsd: cfg.minPoolLiquidityUsd,
      depthMaxImpactBps: cfg.depthMaxImpactBps,
      strategy: cfg.strategy,
    });
  } catch (e) {
    log.warn(`public config publish: ${errMsg(e)}`);
  }
  // Twin setup: the live bot reads paper history from the paper bot's DB (readonly);
  // its own DB holds live trades + risk state. Empty PAPER_DB_PATH = own DB (paper bot itself).
  let paperDb: Db = db;
  if (cfg.paperDbPath) {
    try {
      paperDb = new Db(cfg.paperDbPath, true);
    } catch (e) {
      log.warn(`paper DB ${cfg.paperDbPath} unreadable (${errMsg(e)}): live watchlist will be empty`);
    }
  }
  const risk = new Risk(db, cfg.mode, cfg);
  // Every Telegram message carries the mode + chain on its first line, so
  // paper/live and ethereum/arbitrum can never be confused in the same chat.
  const tag = makeModeTag(cfg.mode, cfg.chain.name);
  const tg = new Telegram(cfg.telegramToken, cfg.telegramChatId, fetch, cfg.telegramAdminId, {
    get: () => db.getState('telegram_offset'),
    set: (v) => db.setState('telegram_offset', v),
  }, tag);
  if (!tg.enabled) log.warn('Telegram not configured: alerts only go to the log and there is no /stop');
  const mexc = new MexcRest(cfg.mexcApiKey, cfg.mexcApiSecret);
  const chain = new Chain(cfg.rpcUrl, cfg.sendRpcUrl, cfg.privateKey, cfg.priorityFeeGwei, {
    get: () => db.getState('unresolved_tx') || undefined,
    set: (v) => db.setState('unresolved_tx', v ?? ''),
  }, cfg.chain.chainId, cfg.unlimitedApproval, cfg.builderTipGwei);
  // Every aggregator gets its own quote budget (token bucket, honours 429 / Retry-After).
  const limited = cfg.aggregators.map((name) => {
    const inner =
      name === '0x'
        ? new ZeroEx(cfg.zeroExApiKey, fetch, cfg.chain.chainId)
        : name === '1inch'
          ? new OneInch(cfg.oneInchApiKey, fetch, cfg.chain.chainId)
          : name === 'velora'
            ? new Velora(cfg.chain.chainId)
            : name === 'openocean'
              ? new OpenOcean(cfg.chain.chainId)
              : new Kyber(cfg.chain.kyberName, cfg.kyberClientId);
    return new Limited(inner, new TokenBucket(cfg.quoteRps[name]));
  });
  const agg: Aggregator = limited.length === 1 ? limited[0] : new BestOf(limited);

  // --- Pre-flight checks: fail at startup, not in the middle of the first trade ---
  const chainId = BigInt(await chain.provider.send('eth_chainId', []));
  if (chainId !== BigInt(cfg.chain.chainId)) {
    throw new Error(`RPC_URL is chain ${chainId}, but CHAIN=${cfg.chain.name} needs ${cfg.chain.chainId}`);
  }
  const sendId = BigInt(await chain.sendProvider.send('eth_chainId', []));
  if (sendId !== BigInt(cfg.chain.chainId)) throw new Error(`SEND_RPC_URL is chain ${sendId}, expected ${cfg.chain.chainId}`);
  const stableDecimals = await chain.decimals(cfg.usdc);
  log.info(`chain ${cfg.chain.name} (${cfg.chain.chainId}), DEX stable ${cfg.chain.stable.symbol} ${cfg.usdc} (${stableDecimals} decimals)`);
  if (!cfg.mexcApiKey || !cfg.mexcApiSecret) {
    // Coin/network info (contract addresses, deposit/withdraw status) is a signed MEXC endpoint.
    throw new Error('MEXC_API_KEY/SECRET are required even in paper mode (a read-only key is enough for paper)');
  }
  const skew = await mexc.syncTime();
  if (Math.abs(skew) > 1000) log.warn(`VPS clock is ${skew} ms off MEXC time; corrected, but enable NTP (timedatectl set-ntp true)`);
  // Aggregator key and route smoke test: quote 100 USDC -> WETH.
  await agg.price({
    sellToken: cfg.usdc,
    buyToken: cfg.chain.wrappedNative,
    sellAmount: 100n * 10n ** BigInt(stableDecimals),
    taker: chain.wallet?.address ?? '0x000000000000000000000000000000000000dEaD',
    slippageBps: cfg.dexSlippageBps,
  });
  if (cfg.mode === 'live') {
    if (!tg.enabled) throw new Error('Live mode needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (kill switch)');
    if (!cfg.telegramAdminId) throw new Error('Live mode needs TELEGRAM_ADMIN_ID (only this user may send /stop /start)');
    const acc = await mexc.account();
    if (!acc.canTrade) throw new Error('MEXC API key cannot trade');
    const nativeSymbol = cfg.chain.nativeMexcSymbol.replace('USDT', ''); // ETH on Ethereum/Arbitrum, BNB on BSC
    const native = Number(await chain.ethBalance()) / 1e18;
    if (native < cfg.minEthForGas) throw new Error(`Hot wallet has ${native} ${nativeSymbol}, need at least MIN_ETH_FOR_GAS=${cfg.minEthForGas}`);
    const usdt = Number(acc.balances.find((b) => b.asset === 'USDT')?.free ?? 0);
    log.info(`wallet ${chain.address}: ${native.toFixed(4)} ${nativeSymbol} | MEXC USDT ${usdt.toFixed(2)}`);
    if (usdt < cfg.minTradeUsd) log.warn(`MEXC USDT ${usdt} < MIN_TRADE_USD: MEXC buys are blocked until you deposit`);
    if (cfg.strategy === 'transfer') {
      await tg.send(
        `🔐 Reminder: STRATEGY=transfer uses MEXC withdrawals. Make sure the API key is IP-bound to this VPS and the MEXC ` +
          `withdrawal address whitelist contains ONLY ${chain.address}.`,
      );
    }
  }

  if (cfg.mode === 'live') {
    // Symbols to sweep for open bot orders: the inventory watchlist (transfer orders use persisted ids).
    const symbols = cfg.strategy === 'inventory' && cfg.watchlist.length ? cfg.watchlist.map((b) => `${b}USDT`) : [];
    await recoverExecuting(db, risk, tg, mexc, (h) => chain.provider.getTransactionReceipt(h), () => chain.checkUnresolved(), { symbols });
  }
  // Keep signed MEXC timestamps inside recvWindow even if the VPS clock drifts.
  setInterval(() => void mexc.syncTime().catch((e) => log.warn(`clock sync: ${errMsg(e)}`)), 10 * 60_000);

  if (cfg.strategy === 'transfer') return runTransfer(db, risk, tg, mexc, chain, agg, stableDecimals);

  const tokens = await buildWatchlist(mexc, (a) => chain.decimals(a), {
    chain: cfg.chain,
    only: cfg.watchlist,
    max: cfg.watchlistMax,
    minTvlUsd: cfg.minDexTvlUsd,
    minVolumeUsd: cfg.minMexcVolumeUsd,
  });
  if (tokens.length === 0) throw new Error('Watchlist is empty: no token passed the filters');
  // Live mode trades only tokens proven profitable in paper trading (paper history
  // lives in this DB). Paper mode is the scout: it keeps the full volume list.
  if (cfg.mode === 'live') {
    const proven = provenTokens(tokens, paperDb.paperTokenStats(), cfg.liveMinPaperTrades, cfg.liveMinPaperPnlUsd, cfg.liveWatchlistMax);
    if (!proven.length) {
      const msg = '⚠️ Live mode: কোনো টোকেন এখনো paper-এ প্রমাণিত হয়নি — live trade হবে না। Paper-এ লাভ করা টোকেন আসলেই watchlist-এ ঢুকবে।';
      log.warn(msg);
      await tg.send(msg).catch(() => {});
      tokens.length = 0;
    } else {
      tokens.splice(0, tokens.length, ...proven);
      const msg = `🎯 Live watchlist — paper-এ লাভ করেছে: ${proven.map((t) => t.base).join(', ')}`;
      log.info(msg);
      await tg.send(msg).catch(() => {});
    }
  }
  log.info(`watchlist: ${tokens.map((t) => `${t.base}(${t.address.slice(0, 8)}…, tvl $${Math.round(t.dexTvlUsd / 1000)}k)`).join(', ')}`);

  const stream = new MexcBookStream([cfg.chain.nativeMexcSymbol, 'USDCUSDT', ...tokens.map((t) => t.symbol)]);
  stream.start();
  const book = async (symbol: string) => stream.get(symbol) ?? mexc.depth(symbol, 20);
  const balances =
    cfg.mode === 'live' ? (total?: boolean) => snapshot(chain, mexc, cfg.usdc, tokens, total, stableDecimals) : async () => paperBalances(tokens);

  const freshBook = (symbol: string) => mexc.depth(symbol, 20);
  const engine = new Engine({ cfg, mexc, chain, agg, db, risk, tg, book, freshBook, balances, tokens, stableDecimals });

  // --- Telegram commands ---
  const statusText = async () => {
    const t = risk.today();
    const lines = [
      `MODE=${cfg.mode} | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, max gas ${cfg.maxGasGwei} gwei (now ${engine.lastGasGwei.toFixed(1)})`,
      `Fail streak: ${risk.consecutiveFails}/${cfg.maxConsecutiveFails}`,
      ...unresolvedLines(db, chain),
    ];
    if (cfg.mode === 'live') {
      try {
        const b = await balances();
        lines.push(`Wallet: ${b.walletEth.toFixed(4)} ETH, ${usd(b.walletUsdc)} USDC | MEXC: ${usd(b.mexc.USDT ?? 0)} USDT`);
        for (const tk of tokens) {
          lines.push(`  ${tk.base}: wallet ${(b.walletToken[tk.base] ?? 0).toFixed(4)} | MEXC ${(b.mexc[tk.base] ?? 0).toFixed(4)}${tk.depositOk && tk.withdrawOk ? '' : ' (suspended)'}`);
        }
      } catch (e) {
        lines.push(`Inventory error: ${errMsg(e)}`);
      }
    }
    return lines.join('\n');
  };
  void tg.startPolling({
    '/stop': () => {
      risk.pause('Telegram /stop');
      return '🛑 Trading STOPPED. Send /start to resume.';
    },
    '/start': startHandler(risk, statusText, makeUnresolvedCheck(db, chain), cfg.chain.explorer),
    '/status': statusText,
    '/tokens': () =>
      `Tokens (${tokens.length}): ${tokens.map((t) => `${t.base} (vol $${Math.round(t.mexcVolumeUsd / 1000)}k, TVL $${Math.round(t.dexTvlUsd / 1000)}k)`).join(', ')}`,
    '/cancelnonce': () => chain.cancelNonce(),
    '/resolve': ([id, pnl]) => resolveTrade(db, id, pnl),
  });

  // --- Main loop: one scan per block ---
  let busy = false;
  let errors = 0;
  let lastTick = Date.now();
  let lastStallAlert = 0;
  const runTick = async () => {
    if (busy || rateLimited() || lifecycle.stopping) return;
    lastTick = Date.now();
    busy = lifecycle.busy = true;
    try {
      await engine.tick();
      errors = 0;
      rateLimitOk();
    } catch (e) {
      if (onScanError(e)) return;
      errors++;
      log.error(`tick: ${errMsg(e)}`);
      if (errors >= 5) await engine.alertThrottled('tick-errors', `❗ Bot errors (${errors} in a row): ${errMsg(e)}`, 3600_000);
    } finally {
      busy = lifecycle.busy = false;
    }
  };
  if (cfg.tickMs > 0) {
    // Fast chains (Base 200 ms blocks): scan on a timer; runTick never overlaps itself (busy flag).
    setInterval(() => void runTick(), cfg.tickMs);
  } else {
    chain.provider.on('block', runTick);
  }
  // Watchdog: if the RPC stops emitting blocks, still scan on a timer, and alert once per hour.
  setInterval(() => {
    const idle = Date.now() - lastTick;
    if (idle > 30_000) void runTick();
    if (idle > 3 * 60_000 && Date.now() - lastStallAlert > 3600_000) {
      lastStallAlert = Date.now();
      void tg.send(`⚠️ No new Ethereum block from RPC for ${Math.round(idle / 60_000)} min: scanning on a timer. Check RPC_URL.`);
    }
  }, 15_000);

  // MEXC deposit/withdraw status every 10 minutes.
  setInterval(async () => {
    try {
      const changed = await refreshStatus(mexc, tokens, cfg.chain);
      if (changed.length) await tg.send(`ℹ️ MEXC network status changed:\n${changed.join('\n')}`);
    } catch (e) {
      log.warn(`status refresh: ${errMsg(e)}`);
    }
  }, 10 * 60_000);

  // Auto token search: re-run the watchlist filters every WATCHLIST_RESCAN_MIN minutes.
  // New tokens that pass are added live (no restart); dropped tokens are only reported
  // (a token with open inventory keeps trading until the next restart).
  log.info(`auto token search: rescan every ${cfg.watchlistRescanMin} min`);
  setInterval(async () => {
    if (lifecycle.stopping) return;
    try {
      const freshRaw = await buildWatchlist(mexc, (a) => chain.decimals(a), {
        chain: cfg.chain,
        only: cfg.watchlist,
        max: cfg.watchlistMax,
        minTvlUsd: cfg.minDexTvlUsd,
        minVolumeUsd: cfg.minMexcVolumeUsd,
      });
      // Live mode: never hot-add a token that paper hasn't proven profitable.
      const fresh = cfg.mode === 'live'
        ? provenTokens(freshRaw, paperDb.paperTokenStats(), cfg.liveMinPaperTrades, cfg.liveMinPaperPnlUsd, cfg.liveWatchlistMax)
        : freshRaw;
      const cur = new Set(tokens.map((t) => t.base));
      const added = fresh.filter((t) => !cur.has(t.base));
      const removed = tokens.filter((t) => !fresh.some((f) => f.base === t.base));
      if (!added.length && !removed.length) {
        log.info(`rescan: no change (${tokens.length} tokens)`);
        return;
      }
      if (lifecycle.stopping) return;
      const fmt = (t: { base: string; mexcVolumeUsd: number; dexTvlUsd: number }) =>
        `${t.base} (vol $${Math.round(t.mexcVolumeUsd / 1000)}k, TVL $${Math.round(t.dexTvlUsd / 1000)}k)`;
      const room = cfg.watchlistMax - tokens.length;
      const toAdd = added.slice(0, Math.max(0, room));
      for (const t of toAdd) tokens.push(t);
      const lines = ['🔍 নতুন টোকেনের খোঁজ:'];
      if (toAdd.length) lines.push(`🆕 নতুন: ${toAdd.map(fmt).join(', ')} — এখন থেকেই scan করছে`);
      if (added.length > toAdd.length) lines.push(`⏳ জায়গা নেই (সর্বোচ্চ ${cfg.watchlistMax}টা): ${added.slice(toAdd.length).map(fmt).join(', ')}`);
      if (removed.length) lines.push(`📤 শর্ত পূরণ করছে না (পরের restart থেকে বাদ): ${removed.map((t) => t.base).join(', ')}`);
      await tg.send(lines.join('\n'));
      log.info(`rescan: +${toAdd.map((t) => t.base).join(',') || '-'} -${removed.map((t) => t.base).join(',') || '-'}`);
    } catch (e) {
      log.warn(`rescan: ${errMsg(e)}`);
    }
  }, cfg.watchlistRescanMin * 60_000);

  // Keep the opportunities log bounded (OPP_RETENTION_DAYS).
  const prune = () => {
    const n = db.pruneOpportunities(Date.now() - cfg.oppRetentionDays * 86_400_000);
    if (n) log.info(`pruned ${n} old opportunity rows`);
  };
  prune();
  setInterval(prune, 6 * 3600_000);

  // Daily summary at 23:00 Bangladesh time.
  setInterval(async () => {
    const { hour } = dhakaHourMinute();
    const today = dhakaDay();
    if (hour === 23 && db.getState('last_summary_day') !== today) {
      db.setState('last_summary_day', today);
      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
    }
  }, 30_000);


  installProcessHandlers(tg, () => { stream.stop(); });

  await tg.send(
    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} via ${agg.name}\nTokens: ${tokens.map((t) => t.base).join(', ')}\n` +
      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
  );
}

/** TRANSFER strategy: scan MEXC ERC20 tokens, buy on MEXC, withdraw, sell on DEX. CEX->DEX only. */
async function runTransfer(db: Db, risk: Risk, tg: Telegram, mexc: MexcRest, chain: Chain, agg: Aggregator, stableDecimals: number) {
  // Live watchlist (owner decision 2026-11-22): 100 tokens by volume — MEXC 24h vol >= $20k
  // and DEX 24h vol >= $20k (MIN_MEXC_VOLUME_USD / MIN_DEX_VOLUME_USD / TRANSFER_UNIVERSE_MAX
  // in ecosystem.live.config.cjs). The old proven-only rule (live trades only paper-proven
  // tokens) is REMOVED for transfer mode: live now trades unproven tokens too.
  const engine = new TransferEngine({ cfg, mexc, chain, agg, db, risk, tg, dexPricesFn: (addrs) => dexPrices(addrs, fetch, cfg.chain.dexScreenerId), stableDecimals });
  await engine.refreshUniverse(true);
  if (engine.universe.length === 0) throw new Error('No MEXC ERC20 token passed the filters');

  void tg.startPolling({
    '/stop': () => {
      risk.pause('Telegram /stop');
      return '🛑 New trades STOPPED. An open transfer still finishes (selling the tokens already bought is the safe exit). /start to resume.';
    },
    '/start': async (args: string[]) => startHandler(risk, transferStatus, makeUnresolvedCheck(db, chain), cfg.chain.explorer)(args),
    '/status': async () => transferStatus(),
    '/cancelnonce': () => chain.cancelNonce(),
    '/resolve': ([id, pnl]: string[]) => resolveTrade(db, id, pnl),
    '/sell': ([id]: string[]) => (id ? engine.forceSell(Number(id)) : 'Usage: /sell <transfer id>'),
    '/clear': ([id]: string[]) => (id ? engine.clear(Number(id)) : 'Usage: /clear <transfer id>'),
    '/recycle': ([id]: string[]) => (!id ? 'Usage: /recycle <transfer id> | /recycle catchup' : id === 'catchup' ? engine.retryCatchUp() : engine.retryRecycle(Number(id))),
  });

  async function transferStatus() {
    const t = risk.today();
    const open = db.openTransfers();
    const lines = [
      `MODE=${cfg.mode} STRATEGY=transfer | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
      `Scanning ${engine.universe.length} MEXC ERC20 tokens every ${cfg.scanIntervalSec}s`,
      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, gas ${engine.lastGasGwei.toFixed(1)}/${cfg.maxGasGwei} gwei`,
      `Top gaps: ${engine.lastTopGaps.map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ') || 'none'}`,
      open.length ? `Open: ${open.map((o) => `#${o.id} ${o.base} ${o.status}`).join(', ')}` : 'Open transfers: none',
      ...unresolvedLines(db, chain),
    ];
    const stuck = db.stuckTransfers();
    if (stuck.length) lines.push(`🚨 Needs you: ${stuck.map((o) => `#${o.id} ${o.base} (${o.note ?? 'stuck'})`).join('; ')} -> /sell <id> or /clear <id>`);
    if (cfg.mode === 'live') {
      try {
        const b = await mexc.balances();
        const eth = await chain.ethBalance();
        const usdc = await chain.tokenBalance(cfg.usdc);
        lines.push(walletLine(b.USDT ?? 0, eth, usdc, cfg.chain, stableDecimals, usd));
      } catch (e) {
        lines.push(`Balance error: ${errMsg(e)}`);
      }
    }
    return lines.join('\n');
  }

  let busy = false;
  let errors = 0;
  let lastLow = 0;
  let lastScanTs = 0;
  const loop = async () => {
    if (busy || rateLimited() || lifecycle.stopping) return;
    busy = lifecycle.busy = true;
    lastScanTs = Date.now();
    try {
      await engine.tick();
      errors = 0;
      rateLimitOk();
      // MEXC USDT is spent by buys and comes back via the Phase 8 recycle loop (USDC proceeds -> MEXC -> USDCUSDT).
      // If it is low anyway, the recycle is probably HELD — the alert says why.
      if (cfg.mode === 'live' && Date.now() - lastLow > 6 * 3600_000) {
        const usdt = (await mexc.balances()).USDT ?? 0;
        const native = Number(await chain.ethBalance()) / 1e18;
        if (usdt < cfg.minTradeUsd || native < cfg.minEthForGas) {
          lastLow = Date.now();
          await tg.send(`📦 Rebalance needed: MEXC USDT ${usd(usdt)}, wallet ${cfg.chain.nativeMexcSymbol.replace('USDT', '')} ${native.toFixed(4)}. The recycle loop normally restores USDT automatically — check for a ♻️ HELD alert if it did not.`);
        }
      }
    } catch (e) {
      if (onScanError(e)) return;
      errors++;
      log.error(`scan: ${errMsg(e)}`);
      if (errors === 5) await tg.send(`❗ Bot errors (5 in a row): ${errMsg(e)}`);
    } finally {
      busy = lifecycle.busy = false;
    }
  };
  setInterval(loop, cfg.scanIntervalSec * 1000);
  void loop();


  setInterval(async () => {
    const today = dhakaDay();
    if (dhakaHourMinute().hour === 23 && db.getState('last_summary_day') !== today) {
      db.setState('last_summary_day', today);
      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
    }
  }, 30_000);

  installProcessHandlers(tg, () => {});

  const open = db.openTransfers();
  await tg.send(
    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} STRATEGY=transfer via ${agg.name}\n` +
      `Scanning ${engine.universe.length} MEXC ERC20 tokens${engine.universe.length ? ` (${engine.universe.map((t) => t.base).join(', ')})` : ''} (buy MEXC -> withdraw -> sell DEX)\n` +
      (open.length ? `Resuming ${open.length} open transfer(s)\n` : '') +
      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
  );
}

main().catch(async (e) => {
  log.error(`startup failed: ${errMsg(e)}`);
  // Throttle: pm2 restarts a failing start up to 1000x, and every attempt
  // would otherwise send a Telegram alert (observed: 2 Arbitrum alerts 12s
  // apart). One alert per 15 min per chain; the stamp survives restarts
  // because the process exits on failure.
  const stamp = `${dirname(cfg.dbPath)}/.startup-alert-${cfg.chain.name}`;
  if (await startupAlertDue(stamp)) {
    await recordStartupAlert(stamp);
    const tag = makeModeTag(cfg.mode, cfg.chain.name);
    await new Telegram(cfg.telegramToken, cfg.telegramChatId, fetch, cfg.telegramAdminId, undefined, tag).send(`❗ Bot failed to start: ${errMsg(e)}`);
  }
  process.exit(1);
});
