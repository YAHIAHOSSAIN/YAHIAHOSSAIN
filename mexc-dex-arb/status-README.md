# MEV Bot — ফোনের স্ট্যাটাস পেজ (paper)

Yahia terminal ছাড়া VPS-এর বটটা দেখতে চেয়েছিল (2026-11-21) — এই পেজটাই তার
উত্তর: ফোনের browser-এ খুললেই বট চলছে কিনা, আজ কয়টা paper ট্রেড, লাভ/লস
কত, শেষ scan কখন — সব এক পাতায়।

## Details dashboard — Premium look (LIVE 2026-11-22 ~14:55 ঢাকা, Yahia-র OK)

- Demo v2 approve করে বসানো: উপরে ৪টা hero stat card (মোট লাভ/লস, ট্রেড +
  জয়ের হার, ২৪ ঘণ্টার সেরা gap, সেরা টোকেন), তার নিচে আজকের strip
- প্রতিটা trade-এর detail: কেনা → বেচা দাম, প্রথম net vs booked net,
  গ্যাস+ফি, লাভ/লস pill (সাম্প্রতিক ১২টা)
- Gap chart: distribution (৬ bucket) + ঘণ্টায় সেরা gap — গত ২৪ ঘণ্টার
  opportunities থেকে; live-এ ডেটা নেই বলে warning দেখায় (transfer mode
  gap save করে না — gap-record fix হলে chart আসবে)
- টোকেন ranking (জয়ের হারের bar-সহ), দিন অনুযায়ী card (৭ দিন), live-এ
  transfer-এর তালিকা + note
- Local test (টেস্ট DB): hero ২৪ ট্রেড +$16.66, ১৩ জয়, NPC সেরা +$19.41;
  live gap bestBps null → warning ঠিকমতো দেখায়; page 200
- VPS verify: paper ২৫ ট্রেড +$17.42, live ২ ট্রেড −$5.55; public
  https://arb.alphahelper.online-এ নতুন section-গুলো দেখা যাচ্ছে

## Gate paper scout section (যোগ হয়েছে 2026-11-23, Yahia-র OK)

- `/gate` পেজ + হোমপেজে **Gate.io** কার্ড: Gate paper scout
  (`mexc-dex-arb-gate-paper`, MODE=paper, CEX=gate, Ethereum) — key ছাড়াই
  public market data দিয়ে scan করে, simulated paper transfer লেখে
- দেখায়: bot-এর অবস্থা (pm2), universe (watchlist — log-এর শেষ
  "scanner universe" লাইন থেকে, টোকেন সংখ্যা + pool floor), শেষ scan,
  paper ট্রেড + PnL, gap chart, কনফিগ (pool floor $50k)
- Gate-এর কোনো live twin নেই — live অংশে "Gate-এ live bot নেই" দেখায়;
  `/api/status?chain=gate` আর `/api/chains`-এ Gate কার্ড আসে
- Deploy: `status-server.mjs` বদলে `pm2 restart mexc-dex-arb-status`,
  তারপর `curl http://127.0.0.1:3102/api/status?chain=gate`-এ `dbOk` দেখো

- পেজের নিচে **🔴 Live — আসল টাকা** অংশ: live twin-এর অবস্থা (pm2
  `mexc-dex-arb-ethereum-live`), আজকের live ট্রেড + আসল net P/L, গত ৭ দিন,
  টোকেন অনুযায়ী P/L, সাম্প্রতিক ১০ live ট্রেড, আর সর্বশেষ ইনভেন্টরি
  (প্রতি টোকেনে Wallet $ / MEXC $)
- Live DB পড়ে `data/ethereum-live.sqlite` (readonly) — env
  `STATUS_LIVE_DB` দিয়ে বদলানো যায়; DB না থাকলে live অংশে শুধু
  "Live DB পাওয়া যায়নি" দেখায়, paper অংশ ঠিক থাকে
- Live ট্রেড গোনা হয় `mode='live'` + শেষ হওয়া status দিয়ে
  (`executing`/`approval` বাদ — ওগুলো চলমান, pnl ০)
- Deploy: আগের ১–৩ ধাপই — ফাইল বদলে `pm2 restart mexc-dex-arb-status`,
  তারপর `curl http://127.0.0.1:3102/api/status`-এ `live.dbOk` দেখো
- Local test (2026-11-21 ~21:49): টেস্ট DB দিয়ে যাচাই — paper ২ ট্রেড
  +$1.50; live ১ ট্রেড +$1.20 (`ok` গোনা হয়েছে, `executing` বাদ),
  ইনভেন্টরি NPC Wallet $25.50 / MEXC $100, BGB $0/$0 — সব মিলেছে
- VPS verify (2026-11-21 ~21:52): paper ১৫ ট্রেড +$14.61, live ০ ট্রেড,
  live pm2 online, ইনভেন্টরি NPC/BGB $0/$0; public
  https://arb.alphahelper.online-এ live section দেখা যাচ্ছে

## কী দেখায়

- বটের অবস্থা (pm2: চলছে/বন্ধ), শেষ scan কতক্ষণ আগে, গত ১ ঘণ্টায় কয়টা
  টোকেন দেখেছে, সেরা gap, খোলা/আটকে থাকা transfer
- আজ (ঢাকা দিন): paper ট্রেড সংখ্যা, লাভ/লসের সংখ্যা, মোট net P/L
  (booked — re-quote-এর পরের net, `pnl_usd`), গ্যাস + MEXC ফি
- গত ৭ দিনের মোট, টোকেন অনুযায়ী আজকের P/L, সাম্প্রতিক ১০ ট্রেড
- ৩০ সেকেন্ডে নিজে আপডেট হয়; কালো + সোনালি, ফোনের জন্য বানানো

## নিরাপত্তা

- শুধু পড়ে: DB খোলে `readonly: true`, কখনো লেখে না
- `.env` পড়ে না — কোনো key/secret/Telegram token/code-এ হাত দেয় না
- শুধু `127.0.0.1`-এ শোনে; বাইরে থেকে আসে শুধু Cloudflare Tunnel দিয়ে
- পেজে যা দেখায় তা শুধু paper হিসাব — কোনো wallet/key/ঠিকানা নেই

## Deploy (Yahia-র OK পেলে, VPS-এ)

1. ফাইল দুটো VPS-এর `~/mexc-dex-arb-repo/mexc-dex-arb/`-এ নাও:
   `status-server.mjs`, `status-ecosystem.config.cjs`
2. `node --check status-server.mjs`
3. `pm2 start status-ecosystem.config.cjs` → `pm2 status`-এ
   `mexc-dex-arb-status` online দেখো; `curl http://127.0.0.1:3102/api/status`
4. পোর্ট ফাঁকা আছে কিনা আগেই দেখো: `ss -ltnp | grep 3102` (3101-এ tracker
   চলে — এটা 3102)
5. Cloudflare Tunnel `payserver`-এর config-এ ingress যোগ করো, tracker-এর
   মতোই (যেমন hostname `arb.alphahelper.online` → `http://localhost:3102`)।
   Tunnel config VPS-এ `~/.cloudflared/`-এ — deploy-এর সময় সেখান থেকে
   আসল hostname/নিয়ম মিলিয়ে নিতে হবে; এখানে বসে যাচাই করা যায়নি।
6. ফোনের browser-এ URL খুলে দেখো — আজকের ৩ ট্রেড (PEPE −$4.37,
   ENA −$1.77, BGB +$0.66; মোট −$5.48) মিললে deploy ঠিক আছে।

## Test (local, এই VM-এ যাচাই করা 2026-11-21 ~16:22 ঢাকা)

- `node --check status-server.mjs` + `status-ecosystem.config.cjs` — পাস
- টেস্ট DB (বটের নিজের `Db` class দিয়ে বানানো, আজকের ৩ আসল ট্রেড +
  ৫০ টোকেনের opportunities) দিয়ে চালিয়ে `/api/status` যাচাই — সব মিলেছে:
  আজ ৩ ট্রেড, net −$5.48, লাভ ১ / লস ২, গ্যাস $2.21 + ফি $0.63;
  টোকেন: BGB +$0.66, ENA −$1.77, PEPE −$4.37; শেষ scan "৪৬ সেকেন্ড আগে";
  গত ১ ঘণ্টায় ৫০ টোকেন; সাম্প্রতিক ট্রেডের ঢাকা সময় ঠিক
- এই VM-এ pm2 নেই বলে status "unknown" এসেছে — VPS-এ pm2 আছে, সেখানে
  "online" আসবে; না এলেও পেজের বাকি সব ঠিক দেখাবে
- DB না থাকলে পেজ ভাঙে না — `{"dbOk":false,"error":"DB পাওয়া যায়নি"}`,
  root 200; সার্ভার চালানোর পরও টেস্ট DB-তে ট্রেড ৩টাই আছে (কিছু লেখেনি)
