// Entry point. Wires everything together, runs one scan per Ethereum block.
import fs from 'node:fs';
import { loadConfig, secretsOf } from './config.js';
import { log, errMsg, registerSecrets } from './log.js';
import { Db } from './db.js';
import { Risk } from './risk.js';
import { Telegram } from './telegram.js';
import { MexcRest } from './mexc/rest.js';
import { MexcBookStream } from './mexc/ws.js';
import { Chain } from './dex/chain.js';
import { OneInch, ZeroEx, type Aggregator } from './dex/aggregator.js';
import { buildWatchlist, refreshStatus } from './watchlist.js';
import { paperBalances, snapshot } from './inventory.js';
import { Engine } from './engine.js';
import { TransferEngine } from './transfer.js';
import { formatReport } from './summary.js';
import { dhakaDay, dhakaHourMinute, usd } from './util.js';

const cfg = loadConfig();
registerSecrets(secretsOf(cfg));

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
  const tg = new Telegram(cfg.telegramToken, cfg.telegramChatId);
  if (!tg.enabled) log.warn('Telegram not configured: alerts only go to the log and there is no /stop');
  const mexc = new MexcRest(cfg.mexcApiKey, cfg.mexcApiSecret);
  const chain = new Chain(cfg.rpcUrl, cfg.sendRpcUrl, cfg.privateKey, cfg.priorityFeeGwei);
  const agg: Aggregator = cfg.aggregator === '0x' ? new ZeroEx(cfg.zeroExApiKey) : new OneInch(cfg.oneInchApiKey);

  // --- Pre-flight checks ---
  const chainId = BigInt(await chain.provider.send('eth_chainId', []));
  if (chainId !== 1n) throw new Error(`RPC_URL is chain ${chainId}, expected Ethereum mainnet (1)`);
  if (cfg.mode === 'live') {
    if (!tg.enabled) throw new Error('Live mode needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (kill switch)');
    const acc = await mexc.account();
    if (!acc.canTrade) throw new Error('MEXC API key cannot trade');
    log.info(`wallet ${chain.address}`);
  }

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
  const balances = cfg.mode === 'live' ? () => snapshot(chain, mexc, cfg.usdc, tokens) : async () => paperBalances(tokens);

  const engine = new Engine({ cfg, mexc, chain, agg, db, risk, tg, book, balances, tokens });

  // --- Telegram commands ---
  const statusText = async () => {
    const t = risk.today();
    const lines = [
      `MODE=${cfg.mode} | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
      `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
      `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, max gas ${cfg.maxGasGwei} gwei (now ${engine.lastGasGwei.toFixed(1)})`,
      `Fail streak: ${risk.consecutiveFails}/${cfg.maxConsecutiveFails}`,
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
    '/start': () => {
      risk.resume();
      const block = risk.blockReason();
      return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
    },
    '/status': statusText,
  });

  // --- Main loop: one scan per block ---
  let busy = false;
  let errors = 0;
  chain.provider.on('block', async () => {
    if (busy) return;
    busy = true;
    try {
      await engine.tick();
      errors = 0;
    } catch (e) {
      errors++;
      log.error(`tick: ${errMsg(e)}`);
      if (errors >= 5) await engine.alertThrottled('tick-errors', `❗ Bot errors (${errors} in a row): ${errMsg(e)}`, 3600_000);
    } finally {
      busy = false;
    }
  });

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

  const shutdown = async (why: string, code: number) => {
    await tg.send(`🔌 Bot stopped: ${why}`);
    stream.stop();
    tg.stop();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('unhandledRejection', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));
  process.on('uncaughtException', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));

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
    '/start': () => {
      risk.resume();
      const block = risk.blockReason();
      return block ? `Resumed, but still blocked: ${block}` : '▶️ Trading resumed.';
    },
    '/status': async () => {
      const t = risk.today();
      const open = db.openTransfers();
      const lines = [
        `MODE=${cfg.mode} STRATEGY=transfer | ${risk.paused ? `⏸ PAUSED (${risk.pauseReason})` : '▶️ running'}`,
        `Scanning ${engine.universe.length} MEXC ERC20 tokens every ${cfg.scanIntervalSec}s`,
        `Today (${dhakaDay()}): ${t.trades}/${cfg.maxTradesPerDay} trades, PnL ${usd(t.pnl)}, gas ${usd(t.gas)}, failed ${t.failed}`,
        `Limits: max trade ${usd(cfg.maxTradeUsd)}, daily loss ${usd(cfg.dailyLossLimitUsd)}, gas ${engine.lastGasGwei.toFixed(1)}/${cfg.maxGasGwei} gwei`,
        `Top gaps: ${engine.lastTopGaps.map((g) => `${g.token.base} ${g.gapPct.toFixed(1)}%`).join(', ') || 'none'}`,
        open.length ? `Open: ${open.map((o) => `#${o.id} ${o.base} ${o.status}`).join(', ')}` : 'Open transfers: none',
      ];
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
    },
  });

  let busy = false;
  let errors = 0;
  let lastLow = 0;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try {
      await engine.tick();
      errors = 0;
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
      errors++;
      log.error(`scan: ${errMsg(e)}`);
      if (errors === 5) await tg.send(`❗ Bot errors (5 in a row): ${errMsg(e)}`);
    } finally {
      busy = false;
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

  const shutdown = async (why: string, code: number) => {
    await tg.send(`🔌 Bot stopped: ${why}`);
    tg.stop();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('unhandledRejection', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));
  process.on('uncaughtException', (e) => void shutdown(`crashed: ${errMsg(e)}`, 1));

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
