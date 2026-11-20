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

  /** Critical pauses mean money may be in an unknown state; only `/start confirm` clears them. */
  get critical(): boolean {
    return this.db.getState('pause_critical') === '1';
  }

  pause(reason: string, critical = false): void {
    // Never downgrade: a soft pause on top of a critical one keeps it critical.
    const keepCritical = this.paused && this.critical && !critical;
    this.db.setState('paused', '1');
    if (!keepCritical) this.db.setState('pause_reason', reason);
    this.db.setState('pause_critical', critical || keepCritical ? '1' : '0');
  }

  /** Returns false (and stays paused) if a critical pause is not confirmed. */
  resume(confirm = false): boolean {
    if (this.paused && this.critical && !confirm) return false;
    this.db.setState('paused', '0');
    this.db.setState('pause_reason', '');
    this.db.setState('pause_critical', '0');
    this.db.setState('consecutive_fails', '0');
    return true;
  }

  /** Remaining daily loss budget (USD) before the limit is hit. */
  remainingLossBudget(): number {
    return this.limits.dailyLossLimitUsd + this.today().pnl;
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
