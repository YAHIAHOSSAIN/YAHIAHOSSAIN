# Arbitrage MEV Bot (Uniswap V2 / SushiSwap)

একই টোকেন জোড়ার (যেমন WETH/USDC) দাম দুইটা DEX-এ আলাদা হলে এই বট সেটা ধরে
**এক ট্রানজ্যাকশনেই** সস্তায় কিনে দামি জায়গায় বেচে দেয়। এখানে **flash swap**
ব্যবহার করা হয়, তাই নিজের কোনো পুঁজি লাগে না, শুধু gas fee লাগে।

## কীভাবে কাজ করে

```
           ① flash swap: USDC ধার নাও           ② USDC বেচে WETH নাও
 Pair A (সস্তা) ─────────────────► Contract ─────────────────► Pair B (দামি)
      ▲                                │
      └────── ③ WETH ফেরত দাও ──────────┘   ④ বাকি WETH = লাভ → owner
```

- লাভ `minProfit`-এর চেয়ে কম হলে **পুরো ট্রানজ্যাকশন revert হয়ে যায়**, তখন শুধু gas খরচ হয়।
- বট প্রতিটা নতুন block-এ reserves পড়ে, ternary search দিয়ে সবচেয়ে লাভজনক trade size বের করে,
  তারপর `staticCall` দিয়ে simulate করে আর gas বাদ দিয়ে হিসাব করে।
- ট্রানজ্যাকশন Flashbots Protect RPC দিয়ে পাঠানো হয়, যাতে অন্য বট দেখে front-run করতে না পারে।

## ফাইল

| ফাইল | কাজ |
|---|---|
| `contracts/FlashArbitrage.sol` | On-chain flash-swap arbitrage contract |
| `src/math.js` | Uniswap V2 সূত্র + সর্বোত্তম পরিমাণ খোঁজা (contract-এর সাথে হুবহু মেলে) |
| `src/bot.js` | Block দেখা, সুযোগ খোঁজা, simulate করা, পাঠানো |
| `test/` | Math unit test + mock pool দিয়ে contract test |

## চালানোর ধাপ

```bash
npm install
npm test                 # সব test চালাও
cp .env.example .env     # RPC_URL, PRIVATE_KEY ইত্যাদি বসাও
npm run deploy           # contract deploy করো → ARB_CONTRACT-এ ঠিকানা বসাও
npm start                # DRY_RUN=true থাকলে শুধু সুযোগগুলো দেখাবে
```

আগে testnet-এ, অথবা Hardhat mainnet fork-এ চালিয়ে দেখো। সব ঠিক থাকলে তবেই `DRY_RUN=false` দাও।

## বাস্তবতা (অবশ্যই পড়ো)

- Uniswap V2 আর SushiSwap-এর মধ্যে সহজ arbitrage-এ **প্রতিযোগিতা প্রচণ্ড**। পেশাদার searcher-রা
  মিলিসেকেন্ডে আর নিজস্ব node দিয়ে কাজ করে। এই বট শেখার জন্য একটা ভালো ভিত্তি, কিন্তু সরাসরি
  টাকা কামানোর নিশ্চয়তা দেয় না।
- উন্নতির পথ: নিজের node, `eth_subscribe` দিয়ে mempool পড়া, Flashbots bundle (`eth_sendBundle`)
  দিয়ে builder-কে tip দেওয়া, Uniswap V3 / Curve / multi-hop route, L2 চেইন (Arbitrum, Base),
  যেখানে প্রতিযোগিতা কম।
- Fee-on-transfer বা rebasing টোকেনে এটা কাজ করবে না।
- `PRIVATE_KEY`-এর জন্য আলাদা একটা wallet রাখো, আর তাতে শুধু gas-এর টাকা রাখো। `.env` কখনো commit করবে না।
- কেউ "এই contract deploy করো, ETH পাঠাও" ধরনের MEV bot কোড দিলে সেটা প্রায় সবসময়ই scam।
