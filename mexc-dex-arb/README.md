# MEXC ↔ Ethereum DEX Arbitrage Bot

একই token-এর দাম MEXC spot আর Ethereum DEX-এ (Uniswap v2/v3 ইত্যাদি, 0x বা 1inch-এর quote দিয়ে) আলাদা হলে,
**সব খরচ বাদ দিয়েও net লাভ থাকলে** তবেই বট trade করে। অন্য কারো ট্রানজ্যাকশন sandwich, front-run বা back-run করে না।

Stack: Node 20+, TypeScript, ethers v6, MEXC Spot API v3 (REST + protobuf WebSocket), SQLite, Telegram, pm2।

## কীভাবে কাজ করে

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
- Wallet-এ রাখুন: gas-এর জন্য **0.03–0.05 ETH**, **USDC** (যেমন $300–500), আর প্রতিটা token কিছু পরিমাণে (যেমন $200–300)।
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

- **$200 trade-এ $15 ন্যূনতম লাভ মানে অন্তত ~৭.৫% দামের পার্থক্য লাগবে**, তাও gas আর fee বাদ দেওয়ার পর। LINK বা PEPE-র মতো liquid
  token-এ এত বড় পার্থক্য প্রায় কখনোই থাকে না। এত বড় পার্থক্য দেখা গেলে সাধারণত কিছু একটা গোলমাল থাকে: deposit বন্ধ,
  ভিন্ন token, বা pool প্রায় খালি। তাই প্রথম দিকে trade খুব কম হতে পারে, এমনকি শূন্যও হতে পারে। এটা স্বাভাবিক, আর নিরাপদও।
- USDC আর USDT-কে ১:১ ধরা হয়। depeg হলে হিসাব ভুল হবে।
- Inventory সময়ের সাথে এক দিকে জমে যাবে। বট alert দেবে, কিন্তু ব্যালান্স ঠিক করতে হবে নিজে।
- Fee-on-transfer বা rebasing token-এ সঠিক হিসাব পাওয়া যাবে না। সেগুলো `WATCHLIST`-এ রাখবেন না।
