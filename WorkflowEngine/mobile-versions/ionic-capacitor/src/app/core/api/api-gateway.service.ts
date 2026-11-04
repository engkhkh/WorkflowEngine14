import { Injectable, computed, signal } from '@angular/core';

export type ApiNoticeKind = 'session' | 'forbidden' | 'offline' | 'server';
export interface ApiNotice { kind: ApiNoticeKind; at: number; }

/**
 * State of the API layer: how many calls are in flight (drives the top progress bar) and the last problem worth telling the
 * user about (session expired, no permission for an action, offline, server error). Written by the HTTP interceptor, read by <app-api-status>.
 */
@Injectable({ providedIn: 'root' })
export class ApiGateway {
  private count = signal(0);
  readonly busy = computed(() => this.count() > 0);
  readonly notice = signal<ApiNotice | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  begin() { this.count.update(n => n + 1); }
  end() { this.count.update(n => Math.max(0, n - 1)); }

  /** show a notice for a few seconds (the same kind within 4 s is not repeated, so a burst of failures shows once) */
  raise(kind: ApiNoticeKind) {
    const cur = this.notice();
    if (cur && cur.kind === kind && Date.now() - cur.at < 4000) return;
    this.notice.set({ kind, at: Date.now() });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.notice.set(null), kind === 'session' ? 8000 : 5000);
  }
  dismiss() { this.notice.set(null); }
}
