// One read-only firm 0x quote, to confirm before going live that transaction.to is the AllowanceHolder.
// It NEVER signs or sends anything, and prints only transaction.to, allowanceTarget and issues.
// Usage: npx tsx scripts/check-0x-quote.ts   (reads ZEROX_API_KEY and PRIVATE_KEY -> address from .env)
import 'dotenv/config';
import { ethers } from 'ethers';

const AH = '0x0000000000001fF3684f28c67538d4D072C22734';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const key = process.env.ZEROX_API_KEY;
const pk = process.env.PRIVATE_KEY;
if (!key || !pk) throw new Error('ZEROX_API_KEY and PRIVATE_KEY are needed in .env (the key is only used to derive the address)');
const taker = new ethers.Wallet(pk).address;

const q = new URLSearchParams({ chainId: '1', sellToken: USDC, buyToken: WETH, sellAmount: '10000000', taker, slippagePpm: '3000' });
const res = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${q}`, { headers: { '0x-api-key': key, '0x-version': 'v2' } });
const d = (await res.json()) as { transaction?: { to?: string }; allowanceTarget?: string; issues?: unknown };
console.log(JSON.stringify({ http: res.status, transactionTo: d.transaction?.to, allowanceTarget: d.allowanceTarget, issues: d.issues }, null, 2));
const ok = d.transaction?.to?.toLowerCase() === AH.toLowerCase();
console.log(ok ? `OK: transaction.to is the AllowanceHolder ${AH}` : `MISMATCH: expected ${AH}. The bot would reject every quote; do not go live.`);
