import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '../core/translate.pipe';
import { I18nService } from '../core/i18n.service';
import { AuthService } from '../core/auth.service';
import { PortalApiService } from '../core/portal-api.service';
import { IconComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { defaultWeekend } from '../core/region';
import { CalItem, CalPerson, CalSettings, CalendarService, addDays, pad2, sameDay, startOfDay } from './calendar.service';
import { CalEventDialogComponent } from './cal-event-dialog.component';

type View = 'month' | 'week' | 'agenda';
interface Cell { date: Date; inMonth: boolean; today: boolean; weekend: boolean; items: CalItem[]; }
interface Block { it: CalItem; top: number; height: number; left: number; width: number; }

const firstDay = (): number => { try { const l: any = new (Intl as any).Locale(navigator.language); const w = (l.getWeekInfo?.() ?? l.weekInfo)?.firstDay; return w ? w % 7 : 1; } catch { return 1; } };
const HOUR = 46;

@Component({
  selector: 'app-cal-view',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, IconComponent, CalEventDialogComponent],
  template: `
    <div class="bar">
      <button (click)="move(-1)" class="sm">‹</button><button (click)="goToday()" class="sm">{{ 'cal.today' | translate }}</button><button (click)="move(1)" class="sm">›</button>
      <h2 class="ttl">{{ title() }}</h2><span class="grow"></span>
      <div class="seg"><button *ngFor="let v of views" [class.on]="view() === v" (click)="setView(v)">{{ 'cal.v.' + v | translate }}</button></div>
      <button *ngIf="auth.can('cal.events.manage')" (click)="openNew('event')"><app-icon name="plus" [size]="14"></app-icon> {{ 'cal.kind.event' | translate }}</button>
      <button *ngIf="auth.can('cal.meetings.host')" class="primary" (click)="openNew('meeting')"><app-icon name="video" [size]="14"></app-icon> {{ 'cal.kind.meeting' | translate }}</button>
      <button *ngIf="auth.can('cal.meetings.host')" (click)="instant()">⚡ {{ 'cal.instant' | translate }}</button>
    </div>
    <p class="flash bad" *ngIf="error()">{{ error() }}</p>

    <div class="main">
      <div class="card cal">
        <!-- MONTH -->
        <ng-container *ngIf="view() === 'month'">
          <div class="dow"><span *ngFor="let d of dow()">{{ d }}</span></div>
          <div class="grid">
            <div class="cell" *ngFor="let c of cells()" [class.out]="!c.inMonth" [class.today]="c.today" [class.we]="c.weekend" (click)="openNew('event', c.date)">
              <span class="dn">{{ c.date.getDate() }}</span>
              <button class="ev" *ngFor="let it of c.items | slice:0:3" [class]="it.kind" [class.done]="it.status === 'Done'" (click)="open(it, $event)">{{ time(it) }} {{ it.title }}</button>
              <span class="more" *ngIf="c.items.length > 3" (click)="goDay(c.date, $event)">+{{ c.items.length - 3 }}</span>
            </div>
          </div>
        </ng-container>

        <!-- WEEK -->
        <ng-container *ngIf="view() === 'week'">
          <div class="wk-head"><span class="gut"></span><span *ngFor="let d of weekDays()" [class.today]="isToday(d)" [class.we]="isWeekend(d)">{{ d | date:'EEE d' }}</span></div>
          <div class="wk-body">
            <div class="gut"><span *ngFor="let h of hours" [style.height.px]="hourPx">{{ h }}:00</span></div>
            <div class="wk-col" *ngFor="let d of weekDays(); let i = index" [class.we]="isWeekend(d)" (click)="openNew('event', slotAt(d, $event))">
              <i class="hl" *ngFor="let h of hours" [style.height.px]="hourPx"></i>
              <button class="blk" *ngFor="let b of blocks()[i]" [class]="b.it.kind" [style.top.px]="b.top" [style.height.px]="b.height" [style.left.%]="b.left" [style.width.%]="b.width" (click)="open(b.it, $event)">
                <b>{{ time(b.it) }}</b> {{ b.it.title }}</button>
            </div>
          </div>
        </ng-container>

        <!-- AGENDA -->
        <div class="agenda" *ngIf="view() === 'agenda'">
          <p class="dim pad" *ngIf="!agenda().length">{{ 'cal.empty' | translate }}</p>
          <div *ngFor="let g of agenda()"><div class="ah" [class.today]="isToday(g.date)">{{ g.date | date:'fullDate' }}</div>
            <button class="arow" *ngFor="let it of g.items" (click)="open(it, $event)"><span class="at">{{ time(it) }}</span><i class="dotk" [class]="it.kind"></i><span class="atl">{{ it.title }}<small *ngIf="it.data.location"> · {{ it.data.location }}</small></span>
              <span class="chip info" *ngIf="it.kind === 'meeting'">🎥</span></button></div>
        </div>
      </div>

      <aside class="side">
        <div class="card" *ngIf="nextMeeting() as m"><div class="card-head"><h3>{{ 'cal.nextMeeting' | translate }}</h3></div><div class="card-body">
          <b>{{ m.title }}</b><div class="dim sm">{{ m.start | date:'EEE d MMM, HH:mm' }}</div>
          <button class="primary mt" (click)="joinNow(m)">🎥 {{ 'cal.join' | translate }}</button></div></div>
        <div class="card"><div class="card-head"><h3>{{ 'cal.mytodos' | translate }}</h3><a routerLink="/calendar/todos" class="sm">{{ 'cal.all' | translate }}</a></div><div class="card-body">
          <p class="dim sm" *ngIf="!openTodos().length">{{ 'cal.notodos' | translate }}</p>
          <div class="td" *ngFor="let t of openTodos() | slice:0:6"><button class="ck" (click)="tick(t)" aria-label="done"></button><span>{{ t.title }}<small class="dim" *ngIf="t.start"> · {{ t.start | date:'d MMM' }}</small></span></div></div></div>
        <div class="card"><div class="card-head"><h3>{{ 'cal.wftasks' | translate }}</h3><a routerLink="/tasks" class="sm">{{ 'cal.all' | translate }}</a></div><div class="card-body">
          <p class="dim sm" *ngIf="!wfTasks().length">{{ 'cal.nowf' | translate }}</p>
          <a class="wf" *ngFor="let t of wfTasks() | slice:0:6" routerLink="/tasks">{{ t.nodeName }}<small class="dim"> · {{ t.createdAt | date:'d MMM' }}</small></a></div></div>
      </aside>
    </div>

    <app-cal-event-dialog *ngIf="dlg() as d" [item]="d.item" [preset]="d.preset" [people]="people()" [settings]="settings()" (saved)="dlg.set(null); load()" (closed)="dlg.set(null)"></app-cal-event-dialog>
  `,
  styles: [`
    .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; } .ttl { font-size: 18px; margin: 0 8px; } .grow { flex: 1; } .sm { font-size: 12px; } .dim { color: var(--text-dim); } .mt { margin-top: 10px; } .pad { padding: 16px; }
    .main { display: grid; grid-template-columns: 1fr 280px; gap: 14px; align-items: start; } @media (max-width: 1100px) { .main { grid-template-columns: 1fr; } }
    .side { display: flex; flex-direction: column; gap: 14px; } .cal { overflow: hidden; }
    .dow { display: grid; grid-template-columns: repeat(7, 1fr); background: var(--surface-3); font-size: 12px; font-weight: 600; text-align: center; padding: 8px 0; color: var(--text-2); }
    .grid { display: grid; grid-template-columns: repeat(7, 1fr); } .cell { min-height: 108px; border: 1px solid var(--border); border-width: 1px 1px 0 0; padding: 4px; cursor: pointer; overflow: hidden; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .cell.out { background: var(--surface-3); opacity: .6; } .cell.we { background: color-mix(in srgb, var(--surface-3) 60%, transparent); } .cell.today { box-shadow: inset 0 0 0 2px var(--primary); } .dn { font-size: 12px; font-weight: 600; color: var(--text-2); }
    .ev { text-align: start; border: 0; border-radius: 5px; padding: 2px 6px; font-size: 11.5px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #dbeafe; color: #1e3a8a; }
    .ev.meeting, .blk.meeting { background: #d1fae5; color: #065f46; } .ev.todo, .blk.todo { background: #fef3c7; color: #92400e; } .ev.done { text-decoration: line-through; opacity: .6; } .more { font-size: 11px; color: var(--primary); }
    .wk-head, .wk-body { display: grid; grid-template-columns: 52px repeat(7, 1fr); } .wk-head { background: var(--surface-3); font-size: 12px; font-weight: 600; text-align: center; padding: 8px 0; } .wk-head .today { color: var(--primary); }
    .wk-body { max-height: 620px; overflow: auto; } .gut span { display: block; font-size: 10.5px; color: var(--text-dim); text-align: center; border-top: 1px solid var(--border); box-sizing: border-box; }
    .wk-col { position: relative; border-inline-start: 1px solid var(--border); cursor: pointer; } .wk-col.we { background: color-mix(in srgb, var(--surface-3) 60%, transparent); } .hl { display: block; border-top: 1px solid var(--border); box-sizing: border-box; }
    .blk { position: absolute; border: 1px solid rgba(0,0,0,.08); border-radius: 6px; padding: 2px 5px; font-size: 11.5px; text-align: start; overflow: hidden; cursor: pointer; background: #dbeafe; color: #1e3a8a; box-sizing: border-box; }
    .ah { padding: 8px 16px; background: var(--surface-3); font-weight: 600; font-size: 13px; } .ah.today { color: var(--primary); }
    .arow { display: flex; width: 100%; gap: 12px; align-items: center; padding: 10px 16px; border: 0; border-bottom: 1px solid var(--border); background: none; cursor: pointer; text-align: start; color: var(--text); } .at { width: 90px; color: var(--text-dim); font-variant-numeric: tabular-nums; } .atl { flex: 1; }
    .dotk { width: 9px; height: 9px; border-radius: 50%; background: #3b82f6; } .dotk.meeting { background: #10b981; } .dotk.todo { background: #f59e0b; }
    .td { display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 13px; } .ck { width: 16px; height: 16px; border: 2px solid var(--border-strong, #94a3b8); border-radius: 50%; background: none; cursor: pointer; flex: none; }
    .wf { display: block; padding: 4px 0; font-size: 13px; color: var(--text); }
  `]
})
export class CalViewComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  private api = inject(CalendarService);
  private portal = inject(PortalApiService);
  private i18n = inject(I18nService);
  private router = inject(Router);

  views: View[] = ['month', 'week', 'agenda'];
  view = signal<View>((localStorage.getItem('we.cal.view') as View) || 'month');
  cursor = signal(startOfDay(new Date()));
  items = signal<CalItem[]>([]); todos = signal<CalItem[]>([]); wfTasks = signal<any[]>([]);
  people = signal<CalPerson[]>([]);
  settings = signal<CalSettings>({ jitsiDomain: 'meet.jit.si', workStart: '09:00', workEnd: '17:00' });
  dlg = signal<{ item: CalItem | null; preset: any } | null>(null);
  error = signal('');
  hours = Array.from({ length: 24 }, (_, i) => i); hourPx = HOUR;
  private fd = firstDay(); private we = defaultWeekend();
  private timer?: any;

  // ---- range
  range = computed(() => {
    const c = this.cursor(); const v = this.view();
    if (v === 'month') { const f = new Date(c.getFullYear(), c.getMonth(), 1); const s = addDays(f, -((f.getDay() - this.fd + 7) % 7)); return { from: s, to: addDays(s, 42) }; }
    if (v === 'week') { const s = addDays(c, -((c.getDay() - this.fd + 7) % 7)); return { from: s, to: addDays(s, 7) }; }
    return { from: c, to: addDays(c, 30) };
  });
  title = computed(() => {
    const c = this.cursor(); const loc = this.i18n.locale; const v = this.view();
    if (v === 'month') return new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric', calendar: 'gregory' }).format(c);
    const r = this.range(); const f = (d: Date) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', calendar: 'gregory' }).format(d);
    return `${f(r.from)} – ${f(addDays(r.to, -1))}`;
  });
  dow = computed(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(this.i18n.locale, { weekday: 'short' }).format(new Date(2024, 0, 7 + ((this.fd + i) % 7)))));
  all = computed(() => [...this.items(), ...this.todos().filter(t => t.start)]);
  private forDay(d: Date) { return this.all().filter(it => it.start && sameDay(new Date(it.start), d)).sort((a, b) => +new Date(a.start!) - +new Date(b.start!)); }
  cells = computed<Cell[]>(() => {
    const r = this.range(); const m = this.cursor().getMonth(); const now = new Date(); this.all();
    return Array.from({ length: 42 }, (_, i) => { const d = addDays(r.from, i); return { date: d, inMonth: d.getMonth() === m, today: sameDay(d, now), weekend: this.we.includes(d.getDay()), items: this.forDay(d) }; });
  });
  weekDays = computed(() => Array.from({ length: 7 }, (_, i) => addDays(this.range().from, i)));
  blocks = computed<Block[][]>(() => this.weekDays().map(d => {
    const day = this.forDay(d).filter(it => it.kind !== 'todo' || it.start); const lanes: number[] = []; const out: Block[] = [];
    for (const it of day) {
      const s = new Date(it.start!), e = it.end ? new Date(it.end) : new Date(s.getTime() + 3600000);
      const top = (s.getHours() + s.getMinutes() / 60) * HOUR, h = Math.max(22, ((Math.min(+e, +addDays(d, 1)) - +s) / 3600000) * HOUR);
      let lane = lanes.findIndex(end => end <= top); if (lane < 0) { lane = lanes.length; lanes.push(0); } lanes[lane] = top + h;
      out.push({ it, top, height: h, left: lane, width: 0 });
    }
    const n = Math.max(1, lanes.length); return out.map(b => ({ ...b, left: (b.left / n) * 100, width: 100 / n - 1 }));
  }));
  agenda = computed(() => { const r = this.range(); const out: { date: Date; items: CalItem[] }[] = []; for (let i = 0; i < 30; i++) { const d = addDays(r.from, i); const l = this.forDay(d); if (l.length) out.push({ date: d, items: l }); } return out; });
  openTodos = computed(() => this.todos().filter(t => t.status !== 'Done'));
  nextMeeting = computed(() => { const now = Date.now() - 15 * 60000; return this.items().filter(i => i.kind === 'meeting' && i.status !== 'Cancelled' && i.end && +new Date(i.end) > now).sort((a, b) => +new Date(a.start!) - +new Date(b.start!))[0] ?? null; });

  ngOnInit() {
    this.load();
    this.api.people().subscribe({ next: p => this.people.set(p), error: () => {} });
    this.api.settings().subscribe({ next: s => this.settings.set(s), error: () => {} });
    this.portal.getTasks(false).subscribe({ next: t => this.wfTasks.set(t), error: () => {} });
    this.timer = setInterval(() => this.cursor.update(c => c), 60000);
  }
  ngOnDestroy() { clearInterval(this.timer); }

  load() {
    const r = this.range();
    this.api.events(r.from, r.to).subscribe({ next: l => { this.items.set(l); this.error.set(''); }, error: e => this.error.set(errMsg(e, this.i18n)) });
    this.api.todos().subscribe({ next: l => this.todos.set(l), error: () => {} });
  }
  setView(v: View) { this.view.set(v); try { localStorage.setItem('we.cal.view', v); } catch { /* ignore */ } this.load(); }
  move(n: number) {
    const c = this.cursor(); const v = this.view();
    this.cursor.set(v === 'month' ? new Date(c.getFullYear(), c.getMonth() + n, 1) : addDays(c, v === 'week' ? 7 * n : 30 * n)); this.load();
  }
  goToday() { this.cursor.set(startOfDay(new Date())); this.load(); }
  goDay(d: Date, e: Event) { e.stopPropagation(); this.cursor.set(startOfDay(d)); this.view.set('week'); this.load(); }

  time(it: CalItem) { if (it.data.allDay || !it.start) return ''; return new Intl.DateTimeFormat(this.i18n.locale, { hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' }).format(new Date(it.start)); }
  isToday(d: Date) { return sameDay(d, new Date()); }
  isWeekend(d: Date) { return this.we.includes(d.getDay()); }
  slotAt(d: Date, ev: MouseEvent): Date {
    const col = ev.currentTarget as HTMLElement; const y = ev.clientY - col.getBoundingClientRect().top; const mins = Math.floor((y / HOUR) * 2) * 30;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60);
  }

  openNew(kind: 'event' | 'meeting', date?: Date) {
    let start = date; if (date && date.getHours() === 0 && date.getMinutes() === 0) start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0);
    this.dlg.set({ item: null, preset: { kind: kind === 'event' && !this.auth.can('cal.events.manage') ? 'meeting' : kind, start } });
  }
  open(it: CalItem, e: Event) { e.stopPropagation(); this.dlg.set({ item: it, preset: null }); }
  tick(t: CalItem) { this.api.toggleDone(t.id).subscribe({ next: () => this.load(), error: e => this.error.set(errMsg(e, this.i18n)) }); }
  instant() {
    this.api.instant(this.i18n.t('cal.quick'), []).subscribe({ next: r => { this.load(); void this.router.navigate(['/calendar/room', r.ev.id]); }, error: e => this.error.set(errMsg(e, this.i18n)) });
  }
  joinNow(m: CalItem) { void this.router.navigate(['/calendar/room', m.id]); }
}
