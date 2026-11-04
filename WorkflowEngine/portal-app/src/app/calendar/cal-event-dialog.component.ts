import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '../core/translate.pipe';
import { I18nService } from '../core/i18n.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { defaultWeekend } from '../core/region';
import { CalItem, CalPerson, CalSettings, CalendarService, addDays, pad2, toLocalInput } from './calendar.service';

/** Create / view / edit one event, meeting or to-do. For meetings it also finds a time that suits everyone invited. */
@Component({
  selector: 'app-cal-event-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
  <div class="modal-scrim" (click)="closed.emit()"><div class="modal wide" (click)="$event.stopPropagation()">
    <div class="modal-head"><h3>{{ (item ? 'cal.edit' : 'cal.new') | translate }}</h3><button class="ghost" (click)="closed.emit()"><app-icon name="x"></app-icon></button></div>
    <div class="modal-body">
      <p class="flash bad" *ngIf="error()">{{ error() }}</p>

      <!-- read-only view for people who were invited -->
      <ng-container *ngIf="readOnly">
        <h2 class="t">{{ item!.title }}</h2>
        <p class="dim">{{ when() }} · {{ 'cal.by' | translate }} {{ name(item!.owner) }}</p>
        <p *ngIf="item!.data.location">📍 {{ item!.data.location }}</p><p *ngIf="item!.data.notes" class="pre">{{ item!.data.notes }}</p>
        <p class="dim sm" *ngIf="item!.data.attendees?.length">{{ 'cal.attendees' | translate }}: {{ names(item!.data.attendees) }}</p>
        <div class="row" *ngIf="isInvited()"><span class="dim">{{ 'cal.rsvp' | translate }}:</span>
          <div class="seg"><button *ngFor="let r of ['yes','maybe','no']" [class.on]="myRsvp() === r" (click)="rsvp(r)">{{ 'cal.rsvp.' + r | translate }}</button></div></div>
      </ng-container>

      <div class="form-grid" *ngIf="!readOnly">
        <div class="full seg" *ngIf="!item">
          <button [class.on]="f.kind === 'event'" (click)="f.kind = 'event'" *ngIf="auth.can('cal.events.manage')">{{ 'cal.kind.event' | translate }}</button>
          <button [class.on]="f.kind === 'meeting'" (click)="f.kind = 'meeting'" *ngIf="auth.can('cal.meetings.host')">🎥 {{ 'cal.kind.meeting' | translate }}</button>
          <button [class.on]="f.kind === 'todo'" (click)="f.kind = 'todo'" *ngIf="auth.can('cal.events.manage')">☑ {{ 'cal.kind.todo' | translate }}</button>
        </div>
        <div class="full"><label class="lbl">{{ 'cal.title' | translate }} *</label><input [(ngModel)]="f.title" autofocus></div>
        <ng-container *ngIf="f.kind !== 'todo'">
          <div><label class="lbl">{{ 'cal.start' | translate }} *</label><input type="datetime-local" [(ngModel)]="f.start" (ngModelChange)="fixEnd()"></div>
          <div><label class="lbl">{{ 'cal.end' | translate }}</label><input type="datetime-local" [(ngModel)]="f.end"></div>
          <div><label class="lbl">{{ 'cal.repeat' | translate }}</label>
            <select [(ngModel)]="f.repeat"><option value="none">{{ 'cal.rep.none' | translate }}</option><option value="daily">{{ 'cal.rep.daily' | translate }}</option><option value="weekly">{{ 'cal.rep.weekly' | translate }}</option><option value="monthly">{{ 'cal.rep.monthly' | translate }}</option></select></div>
          <div *ngIf="f.repeat !== 'none'"><label class="lbl">{{ 'cal.until' | translate }}</label><input type="date" [(ngModel)]="f.until"></div>
        </ng-container>
        <div *ngIf="f.kind === 'todo'"><label class="lbl">{{ 'cal.due' | translate }}</label><input type="datetime-local" [(ngModel)]="f.start"></div>
        <div *ngIf="f.kind === 'todo'"><label class="lbl">{{ 'cal.priority' | translate }}</label>
          <select [(ngModel)]="f.priority"><option value="low">{{ 'cal.p.low' | translate }}</option><option value="normal">{{ 'cal.p.normal' | translate }}</option><option value="high">{{ 'cal.p.high' | translate }}</option></select></div>
        <div><label class="lbl">{{ 'cal.remind' | translate }}</label>
          <select [(ngModel)]="f.remind"><option [ngValue]="null">{{ 'cal.remind.none' | translate }}</option><option *ngFor="let n of [0,5,10,15,30,60,120,1440]" [ngValue]="n">{{ n === 0 ? ('cal.remind.atstart' | translate) : ('cal.remind.before' | translate:{ n: n }) }}</option></select></div>
        <div *ngIf="f.kind !== 'todo'"><label class="lbl">{{ 'cal.location' | translate }}</label><input [(ngModel)]="f.location"></div>
        <div class="full"><label class="lbl">{{ 'cal.notes' | translate }}</label><textarea [(ngModel)]="f.notes"></textarea></div>

        <div class="full" *ngIf="f.kind !== 'todo'">
          <label class="lbl">{{ 'cal.attendees' | translate }}</label>
          <input [placeholder]="'cal.searchPeople' | translate" [(ngModel)]="pq">
          <div class="people"><label *ngFor="let p of filteredPeople()" class="pp"><input type="checkbox" [checked]="f.attendees.includes(p.username)" (change)="togglePerson(p.username)"> {{ p.displayName || p.username }}</label></div>
        </div>
        <div class="full" *ngIf="f.kind === 'meeting'"><label class="lbl">{{ 'cal.guests' | translate }}</label><input [(ngModel)]="f.guests" placeholder="a@example.com, b@example.com"><small class="dim">{{ 'cal.guests.help' | translate }}</small></div>

        <div class="full assist" *ngIf="f.kind !== 'todo' && f.attendees.length">
          <div class="row"><b>{{ 'cal.assistant' | translate }}</b>
            <select [(ngModel)]="dur"><option *ngFor="let n of [15,30,45,60,90,120]" [ngValue]="n">{{ n }} {{ 'cal.min' | translate }}</option></select>
            <button (click)="check()">{{ 'cal.checkTime' | translate }}</button><button (click)="suggest()">{{ 'cal.findTime' | translate }}</button></div>
          <ul class="busy" *ngIf="busyMsg().length"><li *ngFor="let b of busyMsg()" [class.bad]="b.busy">{{ b.name }} — {{ b.busy ? ('cal.busy' | translate) : ('cal.free' | translate) }}</li></ul>
          <div class="row slots" *ngIf="slots().length"><button class="sm" *ngFor="let s of slots()" (click)="pick(s)">{{ s | date:'EEE d MMM, HH:mm' }}</button></div>
          <p class="dim sm" *ngIf="noSlots()">{{ 'cal.noSlots' | translate }}</p>
        </div>
      </div>

      <div class="row mt" *ngIf="item?.kind === 'meeting' && item!.status !== 'Cancelled'">
        <button class="primary" (click)="join()">🎥 {{ 'cal.join' | translate }}</button>
        <button (click)="copyLink()">{{ 'cal.copyLink' | translate }}</button>
        <button (click)="ics()">{{ 'cal.ics' | translate }}</button>
        <span class="dim sm">{{ copied() }}</span>
      </div>
    </div>
    <div class="modal-foot">
      <button class="danger" *ngIf="item && canEdit" (click)="remove()">{{ 'cal.delete' | translate }}</button>
      <span class="grow"></span>
      <button (click)="closed.emit()">{{ 'cal.close' | translate }}</button>
      <button class="primary" *ngIf="!readOnly" [disabled]="busy()" (click)="save()">{{ 'cal.save' | translate }}</button>
    </div>
  </div></div>`,
  styles: [`
    .wide { max-width: 720px; width: 96vw; } .t { margin: 0 0 4px; } .pre { white-space: pre-wrap; } .dim { color: var(--text-dim); } .sm { font-size: 12px; } .mt { margin-top: 14px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .grow { flex: 1; }
    .people { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 4px 10px; max-height: 130px; overflow: auto; margin-top: 6px; border: 1px solid var(--border); border-radius: 8px; padding: 8px; }
    .pp { display: flex; gap: 6px; align-items: center; font-size: 13px; } .assist select { width: auto; } .assist { background: var(--surface-3); border-radius: 10px; padding: 10px 12px; } .slots { margin-top: 8px; }
    .busy { margin: 8px 0 0; padding-inline-start: 18px; font-size: 13px; } .busy li.bad { color: var(--bad); } textarea { width: 100%; min-height: 70px; }
  `]
})
export class CalEventDialogComponent implements OnInit {
  @Input() item: CalItem | null = null;
  @Input() preset: { kind?: 'event' | 'meeting' | 'todo'; start?: Date } | null = null;
  @Input() people: CalPerson[] = [];
  @Input() settings: CalSettings = { jitsiDomain: 'meet.jit.si', workStart: '09:00', workEnd: '17:00' };
  @Output() saved = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private api = inject(CalendarService);
  private i18n = inject(I18nService);
  private router = inject(Router);
  auth = inject(AuthService);
  error = signal(''); busy = signal(false); copied = signal('');
  slots = signal<Date[]>([]); noSlots = signal(false); busyMsg = signal<{ name: string; busy: boolean }[]>([]);
  pq = ''; dur = 30;
  f = { kind: 'event' as 'event' | 'meeting' | 'todo', title: '', start: '', end: '', repeat: 'none', until: '', remind: 10 as number | null, location: '', notes: '', attendees: [] as string[], guests: '', priority: 'normal' };

  get me() { return this.auth.currentUser()?.username ?? ''; }
  get readOnly() { return !!this.item && !this.canEdit; }
  get canEdit() { return !this.item || this.item.owner.toLowerCase() === this.me.toLowerCase() || this.auth.can('cal.settings'); }

  ngOnInit() {
    const it = this.item;
    if (it) {
      const d = it.data;
      this.f = { kind: it.kind, title: it.title, start: it.start ? toLocalInput(new Date(it.start)) : '', end: it.end ? toLocalInput(new Date(it.end)) : '', repeat: d.repeat ?? 'none',
        until: d.repeatUntil ? d.repeatUntil.slice(0, 10) : '', remind: d.remind ?? null, location: d.location ?? '', notes: d.notes ?? '', attendees: [...(d.attendees ?? [])], guests: (d.guests ?? []).join(', '), priority: d.priority ?? 'normal' };
      if (it.occurrence) this.error.set('');
    } else {
      const kind = this.preset?.kind ?? (this.auth.can('cal.events.manage') ? 'event' : 'meeting');
      const s = this.preset?.start ?? (() => { const n = new Date(); n.setMinutes(n.getMinutes() < 30 ? 30 : 60, 0, 0); return n; })();
      this.f.kind = kind; this.f.start = kind === 'todo' && !this.preset?.start ? '' : toLocalInput(s); this.f.end = toLocalInput(new Date(s.getTime() + 3600000));
    }
  }

  name(u: string) { return this.people.find(p => p.username.toLowerCase() === u.toLowerCase())?.displayName || u; }
  names(l?: string[]) { return (l ?? []).map(x => this.name(x)).join(', '); }
  filteredPeople() { const q = this.pq.trim().toLowerCase(); return this.people.filter(p => p.username.toLowerCase() !== this.me.toLowerCase() && (!q || (p.displayName + p.username).toLowerCase().includes(q))); }
  togglePerson(u: string) { const l = this.f.attendees; this.f.attendees = l.includes(u) ? l.filter(x => x !== u) : [...l, u]; }
  fixEnd() { if (!this.f.start) return; const s = new Date(this.f.start); const e = this.f.end ? new Date(this.f.end) : null; if (!e || e <= s) this.f.end = toLocalInput(new Date(s.getTime() + 3600000)); }
  when() { const it = this.item!; return it.start ? new Intl.DateTimeFormat(this.i18n.locale, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(it.start)) : ''; }
  isInvited() { return (this.item?.data.attendees ?? []).some(a => a.toLowerCase() === this.me.toLowerCase()); }
  myRsvp() { return this.item?.data.rsvp?.[this.me] ?? ''; }
  rsvp(r: string) { this.api.rsvp(this.item!.id, r).subscribe({ next: x => { this.item = { ...this.item!, data: x.data }; this.saved.emit(); }, error: e => this.error.set(errMsg(e, this.i18n)) }); }

  private payload() {
    const f = this.f; const iso = (s: string) => (s ? new Date(s).toISOString() : null);
    return {
      kind: f.kind, title: f.title, start: iso(f.start), end: f.kind === 'todo' ? null : iso(f.end), notes: f.notes, location: f.location, attendees: f.kind === 'todo' ? [] : f.attendees,
      guests: f.guests.split(/[,;\s]+/).map(x => x.trim()).filter(x => x), repeat: f.repeat, repeatUntil: f.until ? new Date(f.until + 'T00:00:00').toISOString() : null, remindMinutes: f.remind, priority: f.priority,
    };
  }
  save() {
    this.error.set('');
    if (!this.f.title.trim()) { this.error.set(this.i18n.t('cal.err.title')); return; }
    if (this.f.kind !== 'todo' && !this.f.start) { this.error.set(this.i18n.t('cal.err.start')); return; }
    this.busy.set(true);
    const call = this.item ? this.api.update(this.item.id, this.payload()) : this.api.create(this.payload());
    call.subscribe({ next: () => { this.busy.set(false); this.saved.emit(); }, error: e => { this.busy.set(false); this.error.set(errMsg(e, this.i18n)); } });
  }
  remove() { if (!this.item || !confirm(this.i18n.t('cal.confirmDelete'))) return; this.api.remove(this.item.id).subscribe({ next: () => this.saved.emit(), error: e => this.error.set(errMsg(e, this.i18n)) }); }
  join() { this.api.join(this.item!.id).subscribe({ next: () => { this.closed.emit(); void this.router.navigate(['/calendar/room', this.item!.id]); }, error: e => this.error.set(errMsg(e, this.i18n)) }); }
  copyLink() { this.api.join(this.item!.id).subscribe({ next: r => { try { void navigator.clipboard.writeText(r.url); this.copied.set('✓'); } catch { this.copied.set(r.url); } }, error: e => this.error.set(errMsg(e, this.i18n)) }); }
  ics() { this.api.downloadIcs(this.item!.id).subscribe(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (this.item!.title || 'event') + '.ics'; a.click(); URL.revokeObjectURL(a.href); }); }

  // ---- scheduling assistant: only busy / free blocks of the other people are used - never their titles
  private everyone() { return [this.me, ...this.f.attendees]; }
  check() {
    if (!this.f.start) return; const s = new Date(this.f.start), e = this.f.end ? new Date(this.f.end) : new Date(s.getTime() + this.dur * 60000);
    this.api.freeBusy(this.everyone(), new Date(s.getTime() - 86400000), new Date(e.getTime() + 86400000)).subscribe({
      next: fb => this.busyMsg.set(this.everyone().map(u => ({ name: this.name(u), busy: (fb[u] ?? []).some(b => new Date(b.s) < e && new Date(b.e) > s) }))),
      error: err => this.error.set(errMsg(err, this.i18n)) });
  }
  suggest() {
    const from = new Date(); from.setSeconds(0, 0); const to = addDays(from, 14);
    this.api.freeBusy(this.everyone(), from, to).subscribe({
      next: fb => {
        const [h1, m1] = this.settings.workStart.split(':').map(Number), [h2, m2] = this.settings.workEnd.split(':').map(Number);
        const weekend = defaultWeekend(); const busy = this.everyone().flatMap(u => (fb[u] ?? []).map(b => [new Date(b.s).getTime(), new Date(b.e).getTime()]));
        const out: Date[] = [];
        for (let k = 0; k < 14 && out.length < 8; k++) {
          const day = addDays(from, k); if (weekend.includes(day.getDay())) continue;
          const open = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h1, m1).getTime(), close = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h2, m2).getTime();
          for (let t = Math.max(open, Math.ceil(from.getTime() / 900000) * 900000); t + this.dur * 60000 <= close && out.length < 8; t += 1800000) {
            if (!busy.some(([bs, be]) => bs < t + this.dur * 60000 && be > t)) out.push(new Date(t));
          }
        }
        this.slots.set(out); this.noSlots.set(!out.length);
      }, error: err => this.error.set(errMsg(err, this.i18n)) });
  }
  pick(s: Date) { this.f.start = toLocalInput(s); this.f.end = toLocalInput(new Date(s.getTime() + this.dur * 60000)); this.slots.set([]); this.check(); }
}
