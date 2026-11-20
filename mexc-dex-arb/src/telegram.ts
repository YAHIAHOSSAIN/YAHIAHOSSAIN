// Telegram alerts + commands (/stop, /start, /status, ...).
// Commands are obeyed only from the admin user, in a private chat with the bot.
import { log, errMsg, redact } from './log.js';
import { sleep } from './util.js';

type Handler = (args: string[]) => Promise<string> | string;
type FetchFn = typeof fetch;
type Update = {
  message?: { chat?: { id: number | string; type?: string }; from?: { id: number | string }; text?: string; date?: number };
};

export class Telegram {
  private offset = 0;
  private running = false;

  /** Commands sent before this moment are never executed (a restart must not replay an old /start confirm). */
  private readonly startedAt = Math.floor(Date.now() / 1000);

  constructor(
    private token: string,
    private chatId: string,
    private fetchFn: FetchFn = fetch,
    private adminId = '',
    /** Persists the update offset across restarts. */
    private offsetStore?: { get(): string | undefined; set(v: string): void },
  ) {}

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
  async handle(update: Update, handlers: Record<string, Handler>) {
    const m = update.message;
    if (!m?.text || String(m.chat?.id) !== String(this.chatId)) return; // other chats
    if (m.date !== undefined && m.date < this.startedAt) {
      log.warn(`telegram: ignored command sent before this start (${m.text.split(/\s/)[0]})`);
      return;
    }
    // In a group anyone could type /start: require the admin user in a private chat.
    if (!this.adminId || String(m.from?.id) !== String(this.adminId) || m.chat?.type !== 'private') {
      log.warn(`telegram: ignored command from user ${m.from?.id} in ${m.chat?.type ?? '?'} chat`);
      return;
    }
    const [first, ...args] = m.text.trim().split(/\s+/);
    const cmd = first.split('@')[0].toLowerCase();
    const h = handlers[cmd];
    const reply = h ? await h(args) : `Commands: ${Object.keys(handlers).join(' ')}`;
    await this.send(reply);
  }

  async startPolling(handlers: Record<string, Handler>): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    this.offset = Number(this.offsetStore?.get() ?? 0) || 0;
    let backoff = 5000;
    while (this.running) {
      try {
        const updates = await this.api<({ update_id: number } & Update)[]>(
          'getUpdates',
          { offset: this.offset, timeout: 25, allowed_updates: ['message'] },
          35_000,
        );
        for (const u of updates) {
          this.offset = u.update_id + 1;
          this.offsetStore?.set(String(this.offset)); // acknowledged before handling: never handled twice
          await this.handle(u, handlers).catch((e) => log.warn(`telegram handler: ${errMsg(e)}`));
        }
        backoff = 5000;
      } catch (e) {
        log.warn(`telegram poll: ${errMsg(e)} (retry in ${backoff / 1000}s)`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 5 * 60_000); // e.g. a bad token: do not hammer the API
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
