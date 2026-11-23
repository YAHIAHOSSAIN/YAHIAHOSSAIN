# MEXC ↔ Ethereum DEX Arbitrage Bot

একই token-এর দাম MEXC spot আর Ethereum DEX-এ (Uniswap v2/v3 ইত্যাদি, 0x বা 1inch-এর quote দিয়ে) আলাদা হলে,
**সব খরচ বাদ দিয়েও net লাভ থাকলে** তবেই বট trade করে। অন্য কারো ট্রানজ্যাকশন sandwich, front-run বা back-run করে না।

Stack: Node 20+, TypeScript, ethers v6, MEXC Spot API v3 (REST + protobuf WebSocket), SQLite, Telegram, pm2।

> **ডিফল্ট: `MODE=paper`, `STRATEGY=inventory`, `MAX_TRADE_USD=50`।** অন্তত ৭ দিন paper-এ চালান, তারপর live।
> MEXC API key-তে **শুধু Trade permission** দিন, **Withdraw দেবেন না**, আর key IP-whitelist করুন।

বটে দুইটা strategy আছে (`STRATEGY`):

| | `inventory` (ডিফল্ট, প্রস্তাবিত) | `transfer` (ঝুঁকিপূর্ণ, ডিফল্টে বন্ধ) |
|---|---|---|
| কী করে | দুই জায়গায় আগে থেকে token রাখে, দুই দিকে একসাথে trade করে | MEXC-এর **সব** ERC20 token scan করে, MEXC-তে কেনে, wallet-এ **withdraw** করে, তারপর DEX-এ বেচে |
| গতি | তাৎক্ষণিক | ধীর: withdraw-এর জন্য ৫ থেকে ৬০ মিনিটের বেশি লাগে |
| দাম সরে যাওয়ার ঝুঁকি | খুব কম | আছে: এই পুরো সময় hedge ছাড়া position খোলা থাকে |
| MEXC API key | শুধু Trade | Trade **আর Withdraw**: key ফাঁস হলে account খালি হতে পারে |
| চালু করতে | `STRATEGY=inventory` | `STRATEGY=transfer` **আর** `ALLOW_WITHDRAWALS=yes` (না দিলে চালুই হবে না) |
| কী রাখতে হবে | দুই জায়গাতেই token আর stablecoin | MEXC-তে USDT, wallet-এ gas-এর ETH |

## Transfer strategy (`STRATEGY=transfer`)

1. **Scan (প্রতি `SCAN_INTERVAL_SEC` সেকেন্ডে):** MEXC-এর সব USDT pair থেকে বাছাই করে সেই token-গুলো যেগুলো Ethereum (ERC20)
   token, যেগুলোর deposit আর withdraw দুইটাই খোলা, আর যেগুলোর volume যথেষ্ট। Contract address আসে MEXC-এর নিজের তথ্য থেকে।
   সব token-এর MEXC দাম আসে **একটা call-এ**, আর DEX দাম আসে DexScreener থেকে, একবারে ৩০টা token।
2. যেগুলোর gap `SCAN_MIN_GAP_PCT`-এর বেশি (আর ৫০%-এর কম, কারণ এর বেশি হলে সাধারণত ভুল token বা মরা pool),
   শুধু সেগুলোর জন্য **ঠিক trade size অনুযায়ী** 0x বা 1inch quote নেয়।
3. **Net লাভ** = DEX-এ বিক্রির মূল্য − MEXC-তে কেনার খরচ − MEXC fee − **withdraw fee** − gas (approval + swap) − slippage
   − **দাম সরে যাওয়ার reserve** − safety margin। এটা `max($15, 0.5%)`-এর বেশি হলে তবেই trade করে।
4. **MEXC-তে কেনে** (limit order), তারপর **শুধু বটের নিজের wallet address-এ withdraw করে**। অন্য কোনো address-এ কখনো না।
5. **Token আসার অপেক্ষা:** wallet-এর ব্যালান্স দেখে বোঝে token এসেছে কিনা (withdraw fee কত কাটা হলো তা আন্দাজ করে না)।
   `TRANSFER_TIMEOUT_MIN`-এর বেশি সময় লাগলে alert দেয়। এর মধ্যে নতুন কোনো trade খোলে না।
6. **DEX-এ বেচে:** exact approval দেয়, firm quote নেয়, simulate করে, private RPC দিয়ে পাঠায়। আসল USDC কত এলো সেটা মেপে PnL বের করে।
7. **কিছু ভুল হলে:**
   - withdraw প্রত্যাখ্যাত হলে বা MEXC-এর দিক থেকে fail করলে, token আবার MEXC-তেই market-এ বেচে দেয়।
   - withdraw request timeout হলে **আবার পাঠায় না**। নিজের দেওয়া `withdrawOrderId` দিয়ে history-তে খুঁজে নেয়।
   - token আসার পর দাম `TRANSFER_MAX_LOSS_PCT`-এর বেশি পড়ে গেলে লোকসানে বেচে না, **token ধরে রাখে**। প্রতি ৫ মিনিটে আবার দেখে, আর alert দেয়।
   - DEX-এ বিক্রি fail করলে ২, ১০ আর ৩০ মিনিট পরপর আবার চেষ্টা করে। ৪ বার fail করলে নিজে থেকে আর চেষ্টা করে না,
     তখন `/sell <id>` বা `/clear <id>` দিতে হবে। এতে gas পোড়ার loop হয় না।
   - Tx mine হলো কিনা বোঝা না গেলে কখনো আবার চেষ্টা বা unwind করে না। Trading pause করে আর মানুষকে জানায়।
   - Withdraw `2 × TRANSFER_TIMEOUT_MIN`-এর বেশি আটকে থাকলে নতুন trade আর আটকে রাখে না, তবে wallet-এ নজর রাখতে থাকে।
8. প্রতিটা ধাপ SQLite-এ লেখা থাকে, তাই **restart হলেও** মাঝপথের transfer যেখানে থেমেছিল সেখান থেকে চলবে।
9. লাভ জমা হয় wallet-এ USDC হিসেবে, আর MEXC-এর USDT কমতে থাকে। কমে গেলে বট "rebalance" alert দেবে।
   তখন wallet থেকে USDC নিজে MEXC-তে পাঠাতে হবে। বট নিজে কখনো MEXC-তে টাকা পাঠায় না।

### Transfer strategy-র নিরাপত্তা (চালাতে চাইলে অবশ্যই করবেন; প্রস্তাবিত নয়)
- MEXC API key: **Spot Trade + Withdraw** permission, **IP whitelist করা থাকবে শুধু VPS-এর IP**।
- MEXC settings-এ **Withdrawal Address Whitelist চালু করুন**, আর সেখানে **শুধু বটের hot wallet address** রাখুন।
  তাহলে কেউ key চুরি করলেও টাকা অন্য কোথাও পাঠাতে পারবে না।
- MEXC account-এ শুধু ততটুকু USDT রাখুন যতটুকু বটের জন্য দরকার।

## Inventory strategy (`STRATEGY=inventory`): কীভাবে কাজ করে

1. **Watchlist:** MEXC-তে USDT pair আছে এমন token, যার MEXC-তে 24h volume $500k-এর বেশি আর Ethereum DEX-এ pool TVL
   $200k-এর বেশি (DexScreener দেখে)। Contract address নেওয়া হয় **MEXC-এর নিজের deposit network info থেকে**,
   তাই দুই জায়গায় একই token কিনা নিশ্চিত হওয়া যায়।
2. **দাম:** MEXC order book আসে WebSocket থেকে (top 20 level)। DEX-এর দাম আসে aggregator quote থেকে, ঠিক যে পরিমাণ
   trade হবে সেই পরিমাণের জন্য, প্রতি block-এ।
3. **লাভের হিসাব:** `net = বিক্রির মূল্য − কেনার মূল্য − MEXC taker fee − gas (live baseFee + tip) − দুই দিকের slippage − safety margin`।
   DEX fee aggregator-এর quote-এর ভেতরেই ধরা থাকে। Trade হয় শুধু যদি `net > max($15, size-এর 0.5%)` হয়।
4. **Execution:**
   - প্রয়োজন হলে exact approval দেয় (কখনো MaxUint256 না)।
   - firm quote নেয়, তারপর `eth_call` দিয়ে simulate করে। Simulation fail করলে বা লাভ কমে গেলে trade বাদ দেয়।
   - তারপর **একই সাথে** MEXC-তে limit order (book-এর worst price ধরে) আর DEX tx (private RPC দিয়ে) পাঠায়।
5. **একদিক fill হলে:** খোলা position সাথে সাথে MEXC-তে market order দিয়ে বন্ধ করে, আর Telegram alert পাঠায়।
   Market order-ও fail করলে trading pause করে দেয় আর 🚨 alert পাঠায়।
6. **PnL:** trade-এর আগে আর পরে দুই দিকের ব্যালান্স মিলিয়ে আসল লাভ-ক্ষতি বের করে। সব trade SQLite-এ রাখা হয়।

| দিক | Wallet (DEX) | MEXC |
|---|---|---|
| `DEX_BUY` (MEXC-তে দাম বেশি) | USDC দিয়ে token কেনে | token বেচে USDT নেয় |
| `CEX_BUY` (MEXC-তে দাম কম) | token বেচে USDC নেয় | USDT দিয়ে token কেনে |

## Risk limits (`.env`)

| Setting | Default | কাজ |
|---|---|---|
| `MAX_TRADE_USD` | 200 | একটা trade-এর সর্বোচ্চ আকার |
| `MAX_TRADES_PER_DAY` | 20 | দিনে সর্বোচ্চ কয়টা trade (বাংলাদেশ সময় রাত ১২টায় reset হয়) |
| `DAILY_LOSS_LIMIT_USD` | 30 | দিনে এর বেশি ক্ষতি হলে বট থামে আর alert দেয় |
| `MAX_GAS_GWEI` | 40 | gas এর বেশি হলে অপেক্ষা করে |
| `MAX_CONSECUTIVE_FAILS` | 3 | পরপর এতগুলো trade fail করলে pause করে |

সব state (pause, fail streak, দিনের PnL) SQLite-এ থাকে, তাই pm2 restart করলেও limit reset হয় না।

**Telegram commands** (শুধু `TELEGRAM_ADMIN_ID`-এর user থেকে, আর বটের সাথে **private chat**-এ। group-এ অন্য কেউ দিলে উপেক্ষা করবে):
`/stop` দিলে সাথে সাথে নতুন trade বন্ধ হয়, `/status` দেখায় PnL, inventory, limit আর আটকে থাকা transfer।
`/cancelnonce` আটকে থাকা DEX tx-এর জায়গায় দ্বিগুণ fee দিয়ে একটা cancel পাঠায়। `/resolve <id> <pnl>` হাতে ঠিক করা trade-এর লাভ-ক্ষতি হিসাবে যোগ করে।
`/start` শুধু সাধারণ pause খোলে, যেমন `/stop` বা পরপর fail-এর pause। **Critical pause**-এর ক্ষেত্রে বট আগে খোলা position আর balance দেখায়,
তারপর **`/start confirm`** চায়। Critical pause হয় MEXC order বা DEX tx-এর ফল অজানা থাকলে, unwind fail করলে, বা trade চলার মাঝখানে restart হলে।
Transfer strategy-তে আরও দুইটা command আছে: `/sell <id>` আটকে থাকা বা hold করা token এখনই বেচার চেষ্টা করে (loss floor উপেক্ষা করে), আর
`/clear <id>` হাতে সমাধান করা transfer বন্ধ করে।
বট শুধু `TELEGRAM_CHAT_ID`-এর মেসেজ মানে।
**Alert পাঠায়:** প্রতিটা trade, loss limit hit, একদিক fill, বট stop বা crash, inventory কম, MEXC deposit/withdraw বন্ধ হলে।
প্রতিদিন রাত ১১টায় (বাংলাদেশ সময়) একটা summary পাঠায়।

## Setup (Ubuntu VPS)

### 1. VPS প্রস্তুত করা
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
sudo npm i -g pm2
git clone <this repo> && cd YAHIAHOSSAIN/mexc-dex-arb
npm ci && npm run build && npm test
```

### 2. নতুন hot wallet
- **একদম নতুন** একটা wallet বানান, শুধু এই বটের জন্য। Private key `.env`-এ যাবে।
- `transfer`: wallet-এ শুধু gas-এর জন্য **0.03–0.05 ETH**, আর MEXC-তে **USDT**।
- `inventory`: wallet-এ ETH, **USDC** আর প্রতিটা token কিছু পরিমাণে রাখতে হবে।
- বট নিজে কোনো টাকা transfer বা withdraw করে না।

### 3. MEXC
- USDT আর প্রতিটা token (watchlist-এর) আলাদাভাবে জমা রাখুন।
- **API key বানান:** শুধু **Spot Trading** permission দিন। **Withdrawal কখনো চালু করবেন না।** IP whitelist-এ শুধু VPS-এর IP দিন।

### 4. বাকি key আর `.env`
- 0x API key (https://dashboard.0x.org), অথবা 1inch key (`DEX_AGGREGATOR=1inch`)।
- নিজস্ব Ethereum RPC (Alchemy, Infura বা QuickNode)।
- Telegram: @BotFather থেকে bot বানান, bot-কে একটা মেসেজ দিন, তারপর `getUpdates` থেকে নিজের chat id নিন।
```bash
cp .env.example .env && nano .env
chmod 600 .env      # না দিলে live মোড চালু হবে না
```
`WATCHLIST=LINK,PEPE,...` দিয়ে শুরুতে নিজের পছন্দের কয়েকটা token-এ সীমাবদ্ধ রাখা ভালো।

### 5. চালানো
```bash
npm start                              # ডিফল্ট MODE=paper: কমপক্ষে ৭ দিন দেখুন
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
pm2 logs mexc-dex-arb
```

### 6. ২৪ ঘণ্টা পরের report
```bash
npm run report -- 24 live
```
এটা দেখায় কয়টা trade হয়েছে, মোট net PnL, gas খরচ, কয়টা fail করেছে, আর কোন token-এ লাভ বা ক্ষতি হয়েছে। Telegram-এর দৈনিক summary-তেও একই তথ্য আসে।

## Bot board (arb.alphahelper.online)

- বট চালু করলেই (default) প্রতি ২৫ সেকেন্ডে একটা public-safe snapshot পাঠায় `https://arb.alphahelper.online/api/ingest`-এ — hot wallet address + status, trade, PnL। Key, tx hash বা order id কখনো যায় না।
- Board-এর owner প্রতিটা wallet address-এর আলাদা page আর একটা summary page (মোট user, active user, মোট volume/profit, প্রত্যেকের শেষ trade) দেখতে পায় — owner page-টা key দিয়ে বন্ধ থাকে। Public per-bot page দেখতে bot-এর pairing code লাগে (`/pairing`), আর সেখানে address-এর শুধু ছোট fingerprint দেখায়।
- Address grouping বটের পাঠানো address-এর উপর ভরসা করে — valid pairing code ধরা বট অন্যের address দাবি করতে পারে (private 2-user board-এ মেনে নেওয়া হয়েছে; যাচাইয়ের জন্য snapshot signature লাগবে, এখনো বানানো হয়নি)।
- বন্ধ করতে চাইলে `.env`-এ `INGEST_URL=off` লিখুন (খালি রাখলে default চালু থাকে)। নিজের receiver চালাতে চাইলে `INGEST_URL=http://127.0.0.1:3102/api/ingest`।

## নিরাপত্তা ব্যবস্থা (Muse আর Grok-এর review-এর পর)

- **MEXC order idempotent:** প্রতিটা order-এ নিজের দেওয়া `newClientOrderId` থাকে। timeout বা 5xx হলে আবার পাঠায় না, আগে `origClientOrderId` দিয়ে খুঁজে দেখে।
- **MEXC rule যাচাই হয় DEX tx পাঠানোর আগেই:** পরিমাণের step (`baseAssetPrecision`), ন্যূনতম পরিমাণ (`baseSizePrecision`),
  ন্যূনতম আর সর্বোচ্চ notional, order type, আর `tradeSideType`।
- **DEX tx-এর ফল অজানা হলে:** unwind করে না, critical pause দেয়। নিজস্ব nonce manager-এর কারণে আগের tx-এর মীমাংসা না হওয়া পর্যন্ত নতুন tx পাঠায় না।
- **Crash safety:** legs পাঠানোর আগেই trade `executing` হিসেবে database-এ লেখা হয়, tx-এর hash-ও broadcast-এর আগে লেখা হয়।
  Restart হলে বট সেটা খুঁজে বের করে, MEXC order আর tx receipt দেখে, তারপর `/start confirm` না পাওয়া পর্যন্ত paused থাকে।
  বন্ধ করার সংকেত পেলে চলমান trade শেষ হওয়া পর্যন্ত অপেক্ষা করে।
- **0x:** approve কোন address-এ যাবে সেটা নেওয়া হয় `issues.allowance.spender` বা `allowanceTarget` থেকে, আর সেটা AllowanceHolder address-এর সাথে মিলতে হবে।
  `slippagePpm` ব্যবহার হয়। firm quote-এ `issues.balance` বা `simulationIncomplete` থাকলে trade বাতিল হয়।
- **Loss budget:** কোনো trade-এর worst case (size-এর ৫% আর gas) দিনের বাকি loss budget-এর চেয়ে বেশি হলে সেই trade বাদ দেয়।
  PnL-এ approval gas আর MEXC-এর locked balance-ও ধরা হয়।

### Round 2 review-এর পর আরও যা যোগ হয়েছে
- **লাভের threshold:** ডিফল্ট `MIN_PROFIT_USD=2`। আগের $15 মানে $50 trade-এ প্রায় ৩০% gap লাগত, যা শুধু ভুয়া gap-এ পাওয়া যায়।
  এখন `MIN_PROFIT_USD` যদি `MAX_TRADE_USD`-এর ১০%-এর বেশি হয়, বট চালুই হবে না।
- **Unresolved tx মনে রাখা:** ফল অজানা tx-এর তথ্য database-এ থাকে, তাই restart-এর পরও একই nonce আবার ব্যবহার হয় না।
  RPC স্পষ্টভাবে tx প্রত্যাখ্যান করলে সেটা unresolved ধরা হয় না, nonce আবার ব্যবহার হয়।
  ১০ মিনিট পরেও কোনো RPC tx-টা না চিনলে, সেটা drop হয়ে গেছে ধরা হয়। Cancel পাঠানোর আগে gas-এর দাম নতুন করে পড়া হয়।
- **`/start confirm` আরও কড়া:** কোনো DEX tx pending থাকলে বা কোনো trade `executing` থাকলে resume করে না।
  Critical pause থেকে resume করলেও পরপর fail-এর গণনা শূন্য হয় না।
- **Restart recovery:** দুই দিকই সম্পূর্ণ হয়ে থাকলে trade `ok` হিসেবে চিহ্নিত হয়। Transfer-এর বিক্রির tx hash broadcast-এর আগেই লেখা হয়।
- **Transfer arrival:** token এসেছে ধরা হয় শুধু তখন, যখন MEXC SUCCESS দেখায় **আর** wallet-এ প্রত্যাশিত পরিমাণ আসে।
  আসল `transactionFee` দিয়ে হিসাব হয়। একই token-এর দুইটা transfer কখনো একসাথে চলে না।
- **MEXC order cancel যাচাই:** cancel করার পর order আসলেই বন্ধ হলো কিনা দেখা হয়।
  খোলা থেকে গেলে দ্বিতীয়বার close করে না, critical pause দেয়।
- **দামের সীমা:** aggressive close-এর দাম symbol-এর `PERCENT_PRICE_BY_SIDE` সীমার ভেতরে রাখা হয়। কিছু symbol-এর সীমা মাত্র ২%।
  MARKET order-এর আলাদা notional সীমা মানা হয়।
- **Telegram:** update offset database-এ সংরক্ষিত থাকে। বট চালু হওয়ার আগে পাঠানো command উপেক্ষা করা হয়,
  তাই restart-এর পর পুরনো `/start confirm` আবার চলে না। Error হলে backoff করে।
- **Block watchdog:** RPC থেকে block আসা বন্ধ হলেও বট timer দিয়ে scan চালিয়ে যায়, আর alert দেয়।

**Live চালুর আগে একবার:** `npm run check:0x` চালান। এটা কিছুই sign বা পাঠায় না, শুধু দেখে 0x-এর `transaction.to` আসলেই AllowanceHolder কিনা। বিস্তারিত `CHANGES.md`-এ।

## Running phase 1 in paper for 7 days and reading the report

Phase 1-এর লক্ষ্য **টাকা কামানো না, মাপা**: প্রতিদিন আসলে কতগুলো সত্যিকারের সুযোগ আসে, সেটা দেখা।
বিস্তারিত পরিবর্তনের তালিকা আছে `CHANGES_UPGRADE.md`-এ।

**১. আগে একবার যাচাই করুন (কিছুই trade হয় না):**
```bash
CHAIN=ethereum npm run networks     # কোন chain-এ কয়টা MEXC token deposit আর withdraw করা যায়, আর chain-এর নাম ঠিক মিলছে কিনা
npm run check:0x     # 0x ব্যবহার করলে: transaction.to আসলেই AllowanceHolder কিনা
```

**২. Ethereum-এর জন্য `.env` সেট করুন (বর্তমান run):**
```
MODE=paper
CHAIN=ethereum
RPC_URL=<Ethereum mainnet RPC, যেমন Alchemy-র eth-mainnet>
SEND_RPC_URL=<Ethereum mainnet private RPC, যেমন MEV Blocker>   # MEV Blocker/Flashbots শুধু mainnet-এ চলে
DEX_AGGREGATOR=kyber               # API key লাগে না। 0x key থাকলে "0x,kyber" দিন
WATCHLIST=LINK,PEPE,UNI            # networks-এর ফল থেকে ২–৪টা token বেছে নিন
MAX_TRADE_USD=300                  # Ethereum-এ gas বেশি (~$0.10/swap, spike-এ ~$1), তাই $50 size-এ সুযোগ প্রায় আসে না
```
Ethereum এক ব্লকে একবার scan করে (~১২ সেকেন্ড)। Base-এ চালাতে চাইলে `CHAIN=base`, `MAX_TRADE_USD=200`, আর Base-এর RPC দিন দুই জায়গাতেই (Base ১ সেকেন্ডে scan করে)। এক MEXC অ্যাকাউন্টে একটাই chain চালাবেন — দুই chain এক অ্যাকাউন্টে চালালে দুটোই আলাদা loss limit আর inventory ধরে, একই ব্যালেন্স দুইবার খরচ করতে পারে।

**৩. চালান:**
```bash
npm run build
BOT_CHAINS=ethereum pm2 start ecosystem.config.cjs && pm2 save
```
বট প্রতি ব্লকে (~১২ সেকেন্ডে) scan করে। প্রতিটা সুযোগ, trade হোক বা না হোক, `data/ethereum.sqlite`-এর `opportunities` table-এ লেখা হয়।
Paper trade-এর লাভ হিসাব করা হয় ১ সেকেন্ড পরে আবার quote নিয়ে, প্রথম quote-এর ভিত্তিতে না।

**৪. Report পড়ুন** (প্রতিদিন রাত ১১টায় Telegram-এ আসে, অথবা হাতে চালাতে পারেন):
```bash
CHAIN=ethereum npm run report -- 168 paper          # শেষ ৭ দিন
CHAIN=ethereum npm run report -- 168 paper --csv > ethereum.csv
```
যে সংখ্যাগুলো দেখবেন:
| লাইন | মানে | কী হলে ভালো |
|---|---|---|
| `minutes with gross gap ≥20/35/50 bps` | দিনে কত মিনিট gap ছিল | ৫০ bps-এর ঘরে দিনে কয়েক মিনিট বা তার বেশি |
| `Would-have PnL` | threshold ২০, ৩০, ৪০ বা ৬০ bps হলে কত লাভ হতো | কোনো একটা threshold-এ ধনাত্মক |
| `decisions` | কেন trade হয়নি: `below_hurdle`, `inventory`, `rate_limited` | `rate_limited` বেশি হলে quote budget কম পড়ছে |
| Gap histogram / hour | কোন token-এ আর কোন সময়ে gap আসে | যে token-এ gap আসে না, সেটা বাদ দিন |
| paper `Net PnL` | আবার quote নেওয়ার পরের লাভ | ৭ দিনে ধনাত্মক হলে তবেই live-এর কথা ভাবুন |

**৫. সিদ্ধান্ত:** ৭ দিনে যদি re-quote-এর পরও লাভ ধনাত্মক না আসে, তাহলে live করবেন না। Grok আর Muse দুইজনই একই কথা বলেছে।
লাভ এলে `MODE=live` আর `MAX_TRADE_USD=50` দিয়ে শুরু করুন। Rebalance টিকিট এলে নিজে deposit বা withdraw করবেন। বট নিজে কখনো টাকা সরায় না।

## জরুরি কথা

- **আসল scan-এ দেখা গেছে** (LINK, PEPE, UNI, SHIB, ENA, LDO): MEXC আর DEX-এর gap বেশিরভাগ সময় **০–১%**।
  আর withdraw fee, ~$৪–১০ gas আর ১.৫% drift reserve বাদ দিলে, **লাভ হতে সাধারণত ৫–১০%+ gap লাগে**।
  এত বড় gap সাধারণত ছোট বা নতুন token-এ দেখা যায়, অথবা যখন deposit বা withdraw বন্ধ থাকে। বট ঠিক সেগুলোই বাদ দেয়, কারণ সেগুলো ফাঁদ।
  তাই trade খুব কম হবে। এটা স্বাভাবিক।

- **$200 trade-এ $15 ন্যূনতম লাভ মানে অন্তত ~৭.৫% দামের পার্থক্য লাগবে**, তাও gas আর fee বাদ দেওয়ার পর। LINK বা PEPE-র মতো liquid
  token-এ এত বড় পার্থক্য প্রায় কখনোই থাকে না। এত বড় পার্থক্য দেখা গেলে সাধারণত কিছু একটা গোলমাল থাকে: deposit বন্ধ,
  ভিন্ন token, বা pool প্রায় খালি। তাই প্রথম দিকে trade খুব কম হতে পারে, এমনকি শূন্যও হতে পারে। এটা স্বাভাবিক, আর নিরাপদও।
- USDC আর USDT-কে ১:১ ধরা হয়। depeg হলে হিসাব ভুল হবে।
- Inventory সময়ের সাথে এক দিকে জমে যাবে। বট alert দেবে, কিন্তু ব্যালান্স ঠিক করতে হবে নিজে।
- Fee-on-transfer বা rebasing token-এ সঠিক হিসাব পাওয়া যাবে না। সেগুলো `WATCHLIST`-এ রাখবেন না।
