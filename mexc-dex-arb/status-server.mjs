// MEXC-DEX arb bot — phone status page (read-only).
// Serves one dark, Bengali, mobile-friendly page + /api/status JSON from the
// bots' own SQLite DBs. It never writes to a DB, never reads .env secrets,
// and never places or touches trades. Run it on the VPS next to the bots:
//
//   pm2 start status-ecosystem.config.cjs
//   # then add a Cloudflare Tunnel 'payserver' ingress route to localhost:3102
//
// Env (all optional, no secrets):
//   STATUS_PORT  default 3102
//   STATUS_HOST  default 127.0.0.1 (tunnel reaches it locally; never expose directly)
//   STATUS_DB    default data/<CHAIN>.sqlite (paper DB the paper bot writes)
//   STATUS_LIVE_DB default data/ethereum-live.sqlite (live twin's DB)
//   CHAIN        default ethereum
//   MODE         default paper (display only)
//   MAX_TRADE_USD default 300 (display only, paper)
//   LIVE_MAX_TRADE_USD default 50 (display only, live)
//   WATCHLIST_MAX default 50 (display only)
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const PORT = Number(process.env.STATUS_PORT || 3102);
const HOST = process.env.STATUS_HOST || '127.0.0.1';
const CHAIN = process.env.CHAIN || 'ethereum';
const MODE = (process.env.MODE || 'paper').toLowerCase();
const MAX_TRADE_USD = Number(process.env.MAX_TRADE_USD || 300);
const LIVE_MAX_TRADE_USD = Number(process.env.LIVE_MAX_TRADE_USD || 50);
const WATCHLIST_MAX = Number(process.env.WATCHLIST_MAX || 50);
const DB_PATH = process.env.STATUS_DB || process.env.DB_PATH || `data/${CHAIN}.sqlite`;
const LIVE_DB_PATH = process.env.STATUS_LIVE_DB || process.env.LIVE_DB_PATH || 'data/ethereum-live.sqlite';

// Bangladesh day, e.g. "2026-11-21". UTC+6, no DST.
function dhakaDay(ts = Date.now()) {
  return new Date(ts + 6 * 3600 * 1000).toISOString().slice(0, 10);
}
function dhakaTime(ts) {
  return new Date(ts + 6 * 3600 * 1000).toISOString().slice(11, 16); // HH:MM
}
function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} সেকেন্ড আগে`;
  if (s < 3600) return `${Math.floor(s / 60)} মিনিট আগে`;
  return `${(s / 3600).toFixed(1)} ঘণ্টা আগে`;
}
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const signed = (n) => `${Number(n || 0) >= 0 ? '+' : ''}$${Number(n || 0).toFixed(2)}`;

function pm2Status(appName) {
  return new Promise((resolve) => {
    execFile('pm2', ['jlist'], { timeout: 5000 }, (err, out) => {
      if (err) return resolve({ state: 'unknown', uptime: null });
      try {
        const apps = JSON.parse(out);
        const app = apps.find((a) => a.name === appName);
        if (!app) return resolve({ state: 'not-found', uptime: null });
        resolve({
          state: app.pm2_env?.status || 'unknown',
          uptime: app.pm2_env?.pm_uptime ? Date.now() - app.pm2_env.pm_uptime : null,
        });
      } catch {
        resolve({ state: 'unknown', uptime: null });
      }
    });
  });
}

// Shared trade stats for one DB + mode. statusSql filters to finished trades:
// paper books status='paper'; live finishes as 'ok'/'one_sided'/failures —
// exclude in-flight ('executing'/'approval') rows, whose pnl is 0 anyway.
function readTradeStats(db, mode, statusSql) {
  const today = dhakaDay();
  const day7Ago = Date.now() - 7 * 24 * 3600 * 1000;
  const todayRow = db
    .prepare(
      `SELECT COUNT(*) c, COALESCE(SUM(pnl_usd),0) pnl, COALESCE(SUM(gas_usd),0) gas,
              COALESCE(SUM(cex_fee_usd),0) fees,
              SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) wins,
              SUM(CASE WHEN pnl_usd <= 0 THEN 1 ELSE 0 END) losses
       FROM trades WHERE day = ? AND mode = ? AND ${statusSql}`,
    )
    .get(today, mode);
  const weekRow = db
    .prepare(
      `SELECT COUNT(*) c, COALESCE(SUM(pnl_usd),0) pnl
       FROM trades WHERE ts >= ? AND mode = ? AND ${statusSql}`,
    )
    .get(day7Ago, mode);
  const perToken = db
    .prepare(
      `SELECT symbol, COUNT(*) trades, COALESCE(SUM(pnl_usd),0) pnl
       FROM trades WHERE day = ? AND mode = ? AND ${statusSql}
       GROUP BY symbol ORDER BY pnl DESC`,
    )
    .all(today, mode);
  const recent = db
    .prepare(
      `SELECT ts, symbol, direction, size_usd, pnl_usd, expected_net, gas_usd
       FROM trades WHERE mode = ? AND ${statusSql} ORDER BY ts DESC LIMIT 10`,
    )
    .all(mode);
  return {
    today: { day: today, trades: todayRow.c, pnl: todayRow.pnl, gas: todayRow.gas, fees: todayRow.fees, wins: todayRow.wins || 0, losses: todayRow.losses || 0 },
    week7d: { trades: weekRow.c, pnl: weekRow.pnl },
    perToken,
    recent,
  };
}

function readStatus() {
  if (!fs.existsSync(DB_PATH)) return { dbOk: false, error: 'DB পাওয়া যায়নি' };
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
    const hourAgo = Date.now() - 3600 * 1000;
    const stats = readTradeStats(db, MODE, `status = 'paper'`);
    const scan = db.prepare(`SELECT MAX(ts) t FROM opportunities`).get();
    const tokensHour = db
      .prepare(`SELECT COUNT(DISTINCT token) c FROM opportunities WHERE ts >= ?`)
      .get(hourAgo);
    const bestHour = db
      .prepare(
        `SELECT token, MAX(net_usd) net FROM opportunities WHERE ts >= ? AND decision = 'below_hurdle'`,
      )
      .get(hourAgo);
    const openTransfers = db
      .prepare(`SELECT COUNT(*) c FROM transfers WHERE status IN ('buying','withdrawing','selling')`)
      .get();
    const stuck = db.prepare(`SELECT COUNT(*) c FROM transfers WHERE status = 'stuck'`).get();
    db.close();
    return {
      dbOk: true,
      chain: CHAIN,
      mode: MODE,
      maxTradeUsd: MAX_TRADE_USD,
      watchlistMax: WATCHLIST_MAX,
      ...stats,
      lastScanTs: scan?.t || null,
      tokensLastHour: tokensHour.c,
      bestGapLastHour: bestHour?.net != null ? { token: bestHour.token, net: bestHour.net } : null,
      openTransfers: openTransfers.c,
      stuckTransfers: stuck.c,
      updatedTs: Date.now(),
    };
  } catch (e) {
    try { db?.close(); } catch { /* ignore */ }
    return { dbOk: false, error: `DB পড়া যায়নি: ${String(e.message || e).slice(0, 120)}` };
  }
}

function readLive() {
  if (!fs.existsSync(LIVE_DB_PATH)) return { dbOk: false, error: 'Live DB পাওয়া যায়নি' };
  let db;
  try {
    db = new Database(LIVE_DB_PATH, { readonly: true });
    const stats = readTradeStats(db, 'live', `status NOT IN ('executing','approval','paper')`);
    const inventory = db
      .prepare(
        `SELECT token, wallet_usd, mexc_usd FROM inventory_snapshots s
         WHERE ts = (SELECT MAX(ts) FROM inventory_snapshots WHERE token = s.token)
         ORDER BY token`,
      )
      .all();
    const openTransfers = db
      .prepare(`SELECT COUNT(*) c FROM transfers WHERE status IN ('buying','withdrawing','selling')`)
      .get();
    const stuck = db.prepare(`SELECT COUNT(*) c FROM transfers WHERE status = 'stuck'`).get();
    db.close();
    return {
      dbOk: true,
      maxTradeUsd: LIVE_MAX_TRADE_USD,
      ...stats,
      inventory,
      openTransfers: openTransfers.c,
      stuckTransfers: stuck.c,
      updatedTs: Date.now(),
    };
  } catch (e) {
    try { db?.close(); } catch { /* ignore */ }
    return { dbOk: false, error: `Live DB পড়া যায়নি: ${String(e.message || e).slice(0, 120)}` };
  }
}

const PAGE = `<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MEV Bot — Paper + Live</title>
<style>
body{background:#000;color:#eee;font-family:system-ui,sans-serif;margin:0;padding:14px}
h1{font-size:19px;color:#d4af37;margin:2px 0 2px}.sub{color:#999;font-size:13px;margin-bottom:12px}
h2{font-size:17px;color:#ff6b6b;margin:14px 0 2px}.sub2{color:#999;font-size:13px;margin-bottom:12px}
.card{background:#111;border:1px solid #333;border-radius:12px;padding:12px;margin-bottom:10px}
.card.live{border-color:#5a2020}
.big{font-size:28px;font-weight:700}.green{color:#3ddc84}.red{color:#ff6b6b}.gold{color:#d4af37}
.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #222;font-size:14px}
.row:last-child{border-bottom:0}.muted{color:#999;font-size:12px}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:12px;background:#1d2b1d;color:#3ddc84}
.badge.off{background:#2b1d1d;color:#ff6b6b}.badge.paper{background:#221d00;color:#d4af37}
.badge.live{background:#2b1d1d;color:#ff6b6b}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:5px 2px;border-bottom:1px solid #222;text-align:left}
button{background:#d4af37;color:#000;border:0;border-radius:8px;padding:8px 14px;font-weight:700}
</style></head><body>
<h1>🤖 MEV Bot — Paper</h1>
<div class="sub">MEXC ↔ Ethereum DEX · আসল টাকা নয়, শুধু paper হিসাব</div>
<div class="card" id="status">লোড হচ্ছে…</div>
<div class="card" id="today"></div>
<div class="card" id="tokens"></div>
<div class="card" id="recent"></div>
<h2>🔴 Live — আসল টাকা</h2>
<div class="sub2">এই অংশের লাভ/লস সত্যিকারের — আসল wallet আর MEXC দিয়ে ট্রেড হয়</div>
<div class="card live" id="live-status">লোড হচ্ছে…</div>
<div class="card live" id="live-today"></div>
<div class="card live" id="live-inventory"></div>
<div class="card live" id="live-tokens"></div>
<div class="card live" id="live-recent"></div>
<div class="muted" id="foot"></div>
<p><button onclick="load()">↻ এখনই দেখো</button></p>
<script>
function badgeFor(state){
  if(state === 'online') return '<span class="badge">● চলছে</span>';
  if(state === 'unknown') return '<span class="badge off">● অবস্থা জানা যায়নি</span>';
  return '<span class="badge off">● বন্ধ ('+state+')</span>';
}
function tradesTable(list){
  return '<table>' + (list.length ? list.map(r=>'<tr><td>'+r.time+'</td><td>'+r.symbol+'</td><td>'+r.direction+'</td><td>$'+r.size+'</td><td class="'+(r.pnl>=0?'green':'red')+'">'+(r.pnl>=0?'+':'')+'$'+r.pnl.toFixed(2)+'</td></tr>').join('') : '<tr><td class="muted">কোনো ট্রেড নেই</td></tr>') + '</table>';
}
async function load(){
  try{
    const r = await fetch('/api/status'); const d = await r.json();
    if(!d.dbOk){ document.getElementById('status').innerHTML = '<b>⚠️ '+d.error+'</b>'; }
    else {
    document.getElementById('status').innerHTML =
      badgeFor(d.pm2.state) + ' <span class="badge paper">PAPER · '+d.chain.toUpperCase()+'</span>' +
      '<div class="row"><span>শেষ scan</span><b>'+d.lastScanAgo+'</b></div>' +
      '<div class="row"><span>গত ১ ঘণ্টায় টোকেন দেখেছে</span><b>'+d.tokensLastHour+' টা</b></div>' +
      '<div class="row"><span>সেরা gap (১ ঘণ্টা)</span><b>'+(d.bestGapLastHour ? d.bestGapLastHour.token+' '+d.bestGapLastHour.net : '—')+'</b></div>' +
      '<div class="row"><span>খোলা transfer / আটকে</span><b>'+d.openTransfers+' / '+d.stuckTransfers+'</b></div>' +
      '<div class="row"><span>Max size</span><b>$'+d.maxTradeUsd+'</b></div>';
    const t = d.today;
    document.getElementById('today').innerHTML =
      '<div class="muted">আজ ('+t.day+') — paper</div>' +
      '<div class="big '+(t.pnl>=0?'green':'red')+'">'+(t.pnl>=0?'+':'')+'$'+t.pnl.toFixed(2)+'</div>' +
      '<div class="row"><span>ট্রেড</span><b>'+t.trades+' টা ('+t.wins+' লাভ, '+t.losses+' লস)</b></div>' +
      '<div class="row"><span>গ্যাস + ফি</span><b>$'+t.gas.toFixed(2)+' + $'+t.fees.toFixed(2)+'</b></div>' +
      '<div class="row"><span>গত ৭ দিন</span><b>'+d.week7d.trades+' ট্রেড, '+(d.week7d.pnl>=0?'+':'')+'$'+d.week7d.pnl.toFixed(2)+'</b></div>';
    document.getElementById('tokens').innerHTML = '<b>আজ টোকেন অনুযায়ী</b>' +
      (d.perToken.length ? d.perToken.map(p=>'<div class="row"><span>'+p.symbol+'</span><b class="'+(p.pnl>=0?'green':'red')+'">'+(p.pnl>=0?'+':'')+'$'+p.pnl.toFixed(2)+' ('+p.trades+')</b></div>').join('') : '<div class="muted">আজ এখনো কোনো ট্রেড হয়নি</div>');
    document.getElementById('recent').innerHTML = '<b>সাম্প্রতিক ট্রেড</b>' + tradesTable(d.recent);
    document.getElementById('foot').textContent = 'আপডেট: ' + d.updatedDhaka + ' ঢাকা · ৩০ সেকেন্ডে নিজে আপডেট হয়';
    }
    const L = d.live;
    if(!L || !L.dbOk){
      document.getElementById('live-status').innerHTML = '<b>⚠️ '+(L ? L.error : 'Live তথ্য পাওয়া যায়নি')+'</b>';
      ['live-today','live-inventory','live-tokens','live-recent'].forEach(id=>{ document.getElementById(id).innerHTML=''; });
    } else {
      document.getElementById('live-status').innerHTML =
        badgeFor(L.pm2.state) + ' <span class="badge live">LIVE · '+d.chain.toUpperCase()+'</span>' +
        '<div class="row"><span>খোলা transfer / আটকে</span><b>'+L.openTransfers+' / '+L.stuckTransfers+'</b></div>' +
        '<div class="row"><span>Max size</span><b>$'+L.maxTradeUsd+'</b></div>';
      const t = L.today;
      document.getElementById('live-today').innerHTML =
        '<div class="muted">আজ ('+t.day+') — live, আসল টাকা</div>' +
        '<div class="big '+(t.pnl>=0?'green':'red')+'">'+(t.pnl>=0?'+':'')+'$'+t.pnl.toFixed(2)+'</div>' +
        '<div class="row"><span>ট্রেড</span><b>'+t.trades+' টা ('+t.wins+' লাভ, '+t.losses+' লস)</b></div>' +
        '<div class="row"><span>গ্যাস + ফি</span><b>$'+t.gas.toFixed(2)+' + $'+t.fees.toFixed(2)+'</b></div>' +
        '<div class="row"><span>গত ৭ দিন</span><b>'+L.week7d.trades+' ট্রেড, '+(L.week7d.pnl>=0?'+':'')+'$'+L.week7d.pnl.toFixed(2)+'</b></div>';
      document.getElementById('live-inventory').innerHTML = '<b>ইনভেন্টরি (সর্বশেষ হিসাব)</b>' +
        (L.inventory.length ? L.inventory.map(v=>'<div class="row"><span>'+v.token+'</span><b>Wallet $'+Number(v.wallet_usd||0).toFixed(2)+' · MEXC $'+Number(v.mexc_usd||0).toFixed(2)+'</b></div>').join('') : '<div class="muted">ইনভেন্টরি তথ্য নেই</div>');
      document.getElementById('live-tokens').innerHTML = '<b>আজ টোকেন অনুযায়ী — live</b>' +
        (L.perToken.length ? L.perToken.map(p=>'<div class="row"><span>'+p.symbol+'</span><b class="'+(p.pnl>=0?'green':'red')+'">'+(p.pnl>=0?'+':'')+'$'+p.pnl.toFixed(2)+' ('+p.trades+')</b></div>').join('') : '<div class="muted">আজ এখনো কোনো live ট্রেড হয়নি</div>');
      document.getElementById('live-recent').innerHTML = '<b>সাম্প্রতিক live ট্রেড</b>' + tradesTable(L.recent);
    }
  }catch(e){ document.getElementById('status').innerHTML = '<b>⚠️ লোড হয়নি — আবার চেষ্টা করো</b>'; }
}
load(); setInterval(load, 30000);
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/status') {
      const [pm2, livePm2] = await Promise.all([
        pm2Status(`mexc-dex-arb-${CHAIN}`),
        pm2Status(`mexc-dex-arb-${CHAIN}-live`),
      ]);
      const s = readStatus();
      const live = readLive();
      const mapRecent = (list) => list.map((r) => ({ ...r, time: dhakaTime(r.ts), pnl: Number(r.pnl_usd.toFixed(2)), size: Math.round(r.size_usd) }));
      const out = {
        ...s,
        pm2,
        lastScanAgo: s.dbOk ? ago(s.lastScanTs) : null,
        updatedDhaka: s.dbOk ? dhakaTime(s.updatedTs) : null,
        recent: s.dbOk ? mapRecent(s.recent) : [],
        live: live.dbOk
          ? { ...live, pm2: livePm2, recent: mapRecent(live.recent) }
          : { ...live, pm2: livePm2 },
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  } catch (e) {
    res.writeHead(500);
    res.end(`error: ${String(e.message || e).slice(0, 200)}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`arb status page on http://${HOST}:${PORT} (db: ${DB_PATH}, live db: ${LIVE_DB_PATH}, mode: ${MODE})`);
});
