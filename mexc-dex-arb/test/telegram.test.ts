// Telegram mode tag: every message carries 📝 PAPER or 🔴 LIVE on its first line,
// so the two bots sharing one chat can never be confused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Telegram } from '../src/telegram.js';

function capture() {
  const sent: string[] = [];
  const fetchFn = (async (_u: string, o: { body: string }) => {
    sent.push(JSON.parse(o.body).text);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as unknown as typeof fetch;
  return { sent, fetchFn };
}

test('Telegram send() prepends the mode tag as the first line', async () => {
  const { sent, fetchFn } = capture();
  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn, '42', undefined, '🔴 LIVE — আসল টাকা');
  await tg.send('Rebalance ticket: withdraw USDC MEXC→wallet');
  assert.deepEqual(sent, ['🔴 LIVE — আসল টাকা\nRebalance ticket: withdraw USDC MEXC→wallet']);
});

test('Telegram send() does not double a tag the text already starts with', async () => {
  const { sent, fetchFn } = capture();
  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn, '42', undefined, '📝 PAPER');
  await tg.send('📝 PAPER BGB CEX_BUY\nBuy @ 1.55 | Sell @ 1.56');
  assert.deepEqual(sent, ['📝 PAPER BGB CEX_BUY\nBuy @ 1.55 | Sell @ 1.56']);
});

test('Telegram send() without a tag sends the text unchanged', async () => {
  const { sent, fetchFn } = capture();
  const tg = new Telegram('123456:TOKENTOKEN', '777', fetchFn, '42');
  await tg.send('plain message');
  assert.deepEqual(sent, ['plain message']);
});
