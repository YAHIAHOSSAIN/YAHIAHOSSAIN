// Telegram alerts + commands (/stop, /start, /status). Only the configured chat id is obeyed.
import { log, errMsg, redact } from './log.js';
import { sleep } from './util.js';

type Handler = (args: string[]) => Promise<string> | string;
type FetchFn = typeof fetch;

export class Telegram {
  private offset = 0;
  private running = false;

  constructor(private token: string, private chatId: string, private fetchFn: FetchFn = fetch) {}

  get enabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  private async api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
    return j.result;
  }

  /** Never throws: alerts must not crash the bot. */
  async send(text: string): Promise<void> {
    const msg = redact(text);
    log.info(`[telegram] ${msg.replace(/\n/g, ' | ')}`);
    if (!this.enabled) return;
    try {
      await this.api('sendMessage', { chat_id: this.chatId, text: msg.slice(0, 4000), disable_web_page_preview: true });
    } catch (e) {
      log.warn(`telegram send failed: ${errMsg(e)}`);
    }
  }

  /** Dispatch one update; exported for tests. */
  async handle(update: { message?: { chat?: { id: number | string }; text?: string } }, handlers: Record<string, Handler>) {
    const m = update.message;
    if (!m?.text || String(m.chat?.id) !== String(this.chatId)) return; // ignore strangers
    const [first, ...args] = m.text.trim().split(/\s+/);
    const cmd = first.split('@')[0].toLowerCase();
    const h = handlers[cmd];
    const reply = h ? await h(args) : `Commands: ${Object.keys(handlers).join(' ')}`;
    await this.send(reply);
  }

  async startPolling(handlers: Record<string, Handler>): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    while (this.running) {
      try {
        const updates = await this.api<{ update_id: number; message?: { chat?: { id: number }; text?: string } }[]>(
          'getUpdates',
          { offset: this.offset, timeout: 25, allowed_updates: ['message'] },
          35_000,
        );
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handle(u, handlers).catch((e) => log.warn(`telegram handler: ${errMsg(e)}`));
        }
      } catch (e) {
        log.warn(`telegram poll: ${errMsg(e)}`);
        await sleep(5000);
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
