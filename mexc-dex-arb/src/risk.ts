// Risk limits: daily trade count, daily loss limit, failure streak, manual kill switch.
// All state lives in SQLite, so a restart (pm2) never resets the limits.
import type { Db, TradeStatus } from './db.js';
import { dhakaDay } from './util.js';

export interface RiskLimits {
  maxTradesPerDay: number;
  dailyLossLimitUsd: number;
  maxConsecutiveFails: number;
}

export type RiskEvent =
  | { kind: 'loss_limit'; pnl: number }
  | { kind: 'fail_streak'; count: number }
  | { kind: 'trade_limit'; trades: number };

export class Risk {
  constructor(private db: Db, private mode: string, private limits: RiskLimits, private now = () => Date.now()) {}

  get paused(): boolean {
    return this.db.getState('paused') === '1';
  }
  get pauseReason(): string {
    return this.db.getState('pause_reason') ?? '';
  }
  get consecutiveFails(): number {
    return Number(this.db.getState('consecutive_fails') ?? '0');
  }

  pause(reason: string): void {
    this.db.setState('paused', '1');
    this.db.setState('pause_reason', reason);
  }

  resume(): void {
    this.db.setState('paused', '0');
    this.db.setState('pause_reason', '');
    this.db.setState('consecutive_fails', '0');
  }

  today() {
    return this.db.dayStats(dhakaDay(this.now()), this.mode);
  }

  /** null = allowed, otherwise the reason trading is blocked right now. */
  blockReason(): string | null {
    if (this.paused) return `paused: ${this.pauseReason}`;
    const t = this.today();
    if (t.trades >= this.limits.maxTradesPerDay) return `daily trade limit reached (${t.trades})`;
    if (t.pnl <= -this.limits.dailyLossLimitUsd) return `daily loss limit reached (${t.pnl.toFixed(2)})`;
    return null;
  }

  /** Update streaks after a trade; returns events that need an alert. */
  afterTrade(status: TradeStatus): RiskEvent[] {
    const events: RiskEvent[] = [];
    if (status === 'ok' || status === 'paper') {
      this.db.setState('consecutive_fails', '0');
    } else {
      const n = this.consecutiveFails + 1;
      this.db.setState('consecutive_fails', String(n));
      if (n >= this.limits.maxConsecutiveFails) {
        this.pause(`${n} failed trades in a row`);
        events.push({ kind: 'fail_streak', count: n });
      }
    }
    const t = this.today();
    if (t.pnl <= -this.limits.dailyLossLimitUsd) {
      this.pause(`daily loss limit hit (${t.pnl.toFixed(2)} USD)`);
      events.push({ kind: 'loss_limit', pnl: t.pnl });
    }
    if (t.trades >= this.limits.maxTradesPerDay) events.push({ kind: 'trade_limit', trades: t.trades });
    return events;
  }
}
