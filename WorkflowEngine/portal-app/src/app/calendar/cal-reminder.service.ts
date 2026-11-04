import { Injectable, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { ToastService } from '../core/toast.service';
import { CalItem, CalendarService } from './calendar.service';

/** Reminds about events, meetings and to-dos while the portal is open: reloads the next day and a half every few minutes and checks every 15 s. */
@Injectable({ providedIn: 'root' })
export class CalReminderService {
  private api = inject(CalendarService); private toast = inject(ToastService); private i18n = inject(I18nService); private auth = inject(AuthService);
  private items: CalItem[] = []; private timers: any[] = []; private fired = new Set<string>();

  start() {
    if (this.timers.length) return;
    this.load(); this.timers.push(setInterval(() => this.load(), 180000), setInterval(() => this.check(), 15000));
  }
  stop() { this.timers.forEach(clearInterval); this.timers = []; }

  private load() {
    if (!this.auth.isLoggedIn() || !this.auth.can('cal.view')) return;
    const from = new Date(Date.now() - 3600000), to = new Date(Date.now() + 36 * 3600000);
    this.api.events(from, to).subscribe({ next: l => { this.items = l; this.check(); }, error: () => {} });
    this.api.todos().subscribe({ next: l => { this.items = [...this.items.filter(i => i.kind !== 'todo'), ...l.filter(t => t.status !== 'Done' && t.start)]; }, error: () => {} });
  }

  private check() {
    const now = Date.now();
    for (const it of this.items) {
      const r = it.data.remind; if (r == null || !it.start || it.status === 'Cancelled' || it.status === 'Done') continue;
      const start = +new Date(it.start); const key = it.id + '|' + it.start;
      if (now >= start - r * 60000 && now < start + 5 * 60000 && !this.fired.has(key)) {
        this.fired.add(key);
        const title = (it.kind === 'meeting' ? '🎥 ' : it.kind === 'todo' ? '☑ ' : '') + it.title;
        const when = new Intl.DateTimeFormat(this.i18n.locale, { hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' }).format(new Date(start));
        const body = (start > now ? this.i18n.t('cal.starts', { t: when }) : this.i18n.t('cal.started'));
        this.toast.add({ title, body, kind: 'meeting', link: it.kind === 'meeting' ? '/calendar/room/' + it.id : '/calendar/view' }, 120000);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { try { new Notification(title, { body, tag: key }); } catch { /* ignore */ } }
      }
    }
  }
}
