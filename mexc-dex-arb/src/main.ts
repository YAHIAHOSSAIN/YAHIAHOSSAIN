// Entry point. Wires everything together, runs one scan per Ethereum block.
import fs from 'node:fs';
import { loadConfig, secretsOf, validateConfig } from './config.js';
import { log, errMsg, registerSecrets } from './log.js';
import { Db } from './db.js';
import { Risk } from './risk.js';
import { Telegram } from './telegram.js';
import { MexcRest, RateLimitError } from './mexc/rest.js';
import { MexcBookStream } from './mexc/ws.js';
import { Chain } from './dex/chain.js';
import { OneInch, ZeroEx, type Aggregator } from './dex/aggregator.js';
import { buildWatchlist, refreshStatus } from './watchlist.js';
import { paperBalances, snapshot } from './inventory.js';
import { Engine } from './engine.js';
import { TransferEngine } from './transfer.js';
import { formatReport } from './summary.js';
import { recoverExecuting } from './recovery.js';
import { makeUnresolvedCheck, resolveTrade, startHandler, unresolvedLines } from './commands.js';
import { dhakaDay, dhakaHourMinute, usd } from './util.js';

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
  const risk = new Risk(db, cfg.mode, cfg);
  const tg = new Telegram(cfg.telegramToken, cfg.telegramChatId, fetch, cfg.telegramAdminId, {
    get: () => db.getState('telegram_offset'),
    set: (v) => db.setState('telegram_offset', v),
  });
  if (!tg.enabled) log.warn('Telegram not configured: alerts only go to the log and there is no /stop');
  const mexc = new MexcRest(cfg.mexcApiKey, cfg.mexcApiSecret);
  const chain = new Chain(cfg.rpcUrl, cfg.sendRpcUrl, cfg.privateKey, cfg.priorityFeeGwei, {
    get: () => db.getState('unresolved_tx') || undefined,
    set: (v) => db.setState('unresolved_tx', v ?? ''),
  });
  const agg: Aggregator = cfg.aggregator === '0x' ? new ZeroEx(cfg.zeroExApiKey) : new OneInch(cfg.oneInchApiKey);

  // --- Pre-flight checks: fail at startup, not in the middle of the first trade ---
  const chainId = BigInt(await chain.provider.send('eth_chainId', []));
  if (chainId !== 1n) throw new Error(`RPC_URL is chain ${chainId}, expected Ethereum mainnet (1)`);
  if (!cfg.mexcApiKey || !cfg.mexcApiSecret) {
    // Coin/network info (contract addresses, deposit/withdraw status) is a signed MEXC endpoint.
    throw new Error('MEXC_API_KEY/SECRET are required even in paper mode (a read-only key is enough for paper)');
  }
  const skew = await mexc.syncTime();
  if (Math.abs(skew) > 1000) log.warn(`VPS clock is ${skew} ms off MEXC time; corrected, but enable NTP (timedatectl set-ntp true)`);
  // Aggregator key and route smoke test: quote 100 USDC -> WETH.
  await agg.price({
    sellToken: cfg.usdc,
    buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    sellAmount: 100_000_000n,
    taker: chain.wallet?.address ?? '0x000000000000000000000000000000000000dEaD',
    slippageBps: cfg.dexSlippageBps,
  });
  if (cfg.mode === 'live') {
    if (!tg.enabled) throw new Error('Live mode needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (kill switch)');
    if (!cfg.telegramAdminId) throw new Error('Live mode needs TELEGRAM_ADMIN_ID (only this user may send /stop /start)');
    const acc = await mexc.account();
    if (!acc.canTrade) throw new Error('MEXC API key cannot trade');
    const eth = Number(await chain.ethBalance()) / 1e18;
    if (eth < cfg.minEthForGas) throw new Error(`Hot wallet has ${eth} ETH, need at least MIN_ETH_FOR_GAS=${cfg.minEthForGas}`);
    const usdt = Number(acc.balances.find((b) => b.asset === 'USDT')?.free ?? 0);
    log.info(`wallet ${chain.address}: ${eth.toFixed(4)} ETH | MEXC USDT ${usdt.toFixed(2)}`);
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

  if (cfg.strategy === 'transfer') return runTransfer(db, risk, tg, mexc, chain, agg);

  const tokens = await buildWatchlist(mexc, (a) => chain.decimals(a), {
    only: cfg.watchlist,
    max: cfg.watchlistMax,
    minTvlUsd: cfg.minDexTvlUsd,
    minVolumeUsd: cfg.minMexcVolumeUsd,
  });
  if (tokens.length === 0) throw new Error('Watchlist is empty: no token passed the filters');
  log.info(`watchlist: ${tokens.map((t) => `${t.base}(${t.address.slice(0, 8)}…, tvl $${Math.round(t.dexTvlUsd / 1000)}k)`).join(', ')}`);

  const stream = new MexcBookStream(['ETHUSDT', ...tokens.map((t) => t.symbol)]);
  stream.start();
  const book = async (symbol: string) => stream.get(symbol) ?? mexc.depth(symbol, 20);
  const balances =
    cfg.mode === 'live' ? (total?: boolean) => snapshot(chain, mexc, cfg.usdc, tokens, total) : async () => paperBalances(tokens);

  const freshBook = (symbol: string) => mexc.depth(symbol, 20);
  const engine = new Engine({ cfg, mexc, chain, agg, db, risk, tg, book, freshBook, balances, tokens });

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
    '/start': startHandler(risk, statusText, makeUnresolvedCheck(db, chain)),
    '/status': statusText,
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
  chain.provider.on('block', runTick);
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
      const changed = await refreshStatus(mexc, tokens);
      if (changed.length) await tg.send(`ℹ️ MEXC network status changed:\n${changed.join('\n')}`);
    } catch (e) {
      log.warn(`status refresh: ${errMsg(e)}`);
    }
  }, 10 * 60_000);

  // Daily summary at 23:00 Bangladesh time.
  setInterval(async () => {
    const { hour } = dhakaHourMinute();
    const today = dhakaDay();
    if (hour === 23 && db.getState('last_summary_day') !== today) {
      db.setState('last_summary_day', today);
      await tg.send(formatReport(db, cfg.mode, 24, `📊 Daily summary ${today}`));
    }
  }, 30_000);

  installProcessHandlers(tg, () => stream.stop());

  await tg.send(
    `🤖 Bot started. MODE=${cfg.mode.toUpperCase()} via ${agg.name}\nTokens: ${tokens.map((t) => t.base).join(', ')}\n` +
      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
  );
}

/** TRANSFER strategy: scan every MEXC ERC20 token, buy on MEXC, withdraw, sell on DEX. */
async function runTransfer(db: Db, risk: Risk, tg: Telegram, mexc: MexcRest, chain: Chain, agg: Aggregator) {
  const engine = new TransferEngine({ cfg, mexc, chain, agg, db, risk, tg });
  await engine.refreshUniverse(true);
  if (engine.universe.length === 0) throw new Error('No MEXC ERC20 token passed the filters');

  void tg.startPolling({
    '/stop': () => {
      risk.pause('Telegram /stop');
      return '🛑 New trades STOPPED. An open transfer still finishes (selling the tokens already bought is the safe exit). /start to resume.';
    },
    '/start': async (args: string[]) => startHandler(risk, transferStatus, makeUnresolvedCheck(db, chain))(args),
    '/status': async () => transferStatus(),
    '/cancelnonce': () => chain.cancelNonce(),
    '/resolve': ([id, pnl]: string[]) => resolveTrade(db, id, pnl),
    '/sell': ([id]: string[]) => (id ? engine.forceSell(Number(id)) : 'Usage: /sell <transfer id>'),
    '/clear': ([id]: string[]) => (id ? engine.clear(Number(id)) : 'Usage: /clear <transfer id>'),
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
        lines.push(`MEXC ${usd(b.USDT ?? 0)} USDT | wallet ${(Number(eth) / 1e18).toFixed(4)} ETH, ${usd(Number(usdc) / 1e6)} USDC`);
      } catch (e) {
        lines.push(`Balance error: ${errMsg(e)}`);
      }
    }
    return lines.join('\n');
  }

  let busy = false;
  let errors = 0;
  let lastLow = 0;
  const loop = async () => {
    if (busy || rateLimited() || lifecycle.stopping) return;
    busy = lifecycle.busy = true;
    try {
      await engine.tick();
      errors = 0;
      rateLimitOk();
      // MEXC USDT is spent by buys and comes back only when you move USDC from the wallet to MEXC.
      if (cfg.mode === 'live' && Date.now() - lastLow > 6 * 3600_000) {
        const usdt = (await mexc.balances()).USDT ?? 0;
        const eth = Number(await chain.ethBalance()) / 1e18;
        if (usdt < cfg.minTradeUsd || eth < cfg.minEthForGas) {
          lastLow = Date.now();
          await tg.send(`📦 Rebalance needed: MEXC USDT ${usd(usdt)}, wallet ETH ${eth.toFixed(4)}. Move USDC profits from the wallet back to MEXC.`);
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
      `Scanning ${engine.universe.length} MEXC ERC20 tokens (buy MEXC -> withdraw -> sell DEX)\n` +
      (open.length ? `Resuming ${open.length} open transfer(s)\n` : '') +
      (risk.paused ? `⏸ Still paused: ${risk.pauseReason} (send /start)` : '▶️ Trading enabled'),
  );
}

main().catch(async (e) => {
  log.error(`startup failed: ${errMsg(e)}`);
  await new Telegram(cfg.telegramToken, cfg.telegramChatId).send(`❗ Bot failed to start: ${errMsg(e)}`);
  process.exit(1);
});
