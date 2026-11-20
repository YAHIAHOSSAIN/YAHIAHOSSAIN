# MEXC ↔ Ethereum DEX Arbitrage Bot

একই token-এর দাম MEXC spot আর Ethereum DEX-এ (Uniswap v2/v3 ইত্যাদি, 0x বা 1inch-এর quote দিয়ে) আলাদা হলে,
**সব খরচ বাদ দিয়েও net লাভ থাকলে** তবেই বট trade করে। অন্য কারো ট্রানজ্যাকশন sandwich, front-run বা back-run করে না।

Stack: Node 20+, TypeScript, ethers v6, MEXC Spot API v3 (REST + protobuf WebSocket), SQLite, Telegram, pm2।

বটে দুইটা strategy আছে (`STRATEGY`):

| | `transfer` (ডিফল্ট) | `inventory` |
|---|---|---|
| কী করে | MEXC-এর **সব** ERC20 token সারাক্ষণ scan করে। যে token MEXC-তে সস্তা, সেটা MEXC-তে কেনে, wallet-এ withdraw করে, তারপর DEX-এ বেচে | দুই জায়গায় আগে থেকে token রাখে, দুই দিকে একসাথে trade করে |
| গতি | ধীর: withdraw-এর জন্য মিনিট থেকে ঘণ্টা লাগে | তাৎক্ষণিক |
| দাম সরে যাওয়ার ঝুঁকি | আছে (অপেক্ষার সময়ে), `TRANSFER_DRIFT_BPS` দিয়ে ধরা হয় | খুব কম |
| MEXC API key | Trade **আর** Withdraw permission লাগে | শুধু Trade |
| কী রাখতে হবে | MEXC-তে USDT, wallet-এ gas-এর ETH | দুই জায়গাতেই token আর stablecoin |

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
   - DEX-এ ৩ বার বেচতে না পারলে 🚨 alert দেয়, তারপরও প্রতিবার scan-এর সময় আবার চেষ্টা করে।
8. প্রতিটা ধাপ SQLite-এ লেখা থাকে, তাই **restart হলেও** মাঝপথের transfer যেখানে থেমেছিল সেখান থেকে চলবে।
9. লাভ জমা হয় wallet-এ USDC হিসেবে, আর MEXC-এর USDT কমতে থাকে। কমে গেলে বট "rebalance" alert দেবে।
   তখন wallet থেকে USDC নিজে MEXC-তে পাঠাতে হবে। বট নিজে কখনো MEXC-তে টাকা পাঠায় না।

### Transfer strategy-র নিরাপত্তা (অবশ্যই করবেন)
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

**Telegram commands:** `/stop` দিলে সাথে সাথে সব trading বন্ধ হয়, `/start` দিলে আবার চালু হয়, `/status` দেখায় PnL, inventory আর limit।
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
MODE=paper npm start                   # (পরামর্শ) আগে paper মোডে এক দিন দেখুন
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
pm2 logs mexc-dex-arb
```

### 6. ২৪ ঘণ্টা পরের report
```bash
npm run report -- 24 live
```
এটা দেখায় কয়টা trade হয়েছে, মোট net PnL, gas খরচ, কয়টা fail করেছে, আর কোন token-এ লাভ বা ক্ষতি হয়েছে। Telegram-এর দৈনিক summary-তেও একই তথ্য আসে।

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
