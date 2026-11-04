import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../core/translate.pipe';
import { I18nService } from '../core/i18n.service';
import { AuthService } from '../core/auth.service';
import { errMsg } from '../hr/hr-util';
import { CalItem, CalendarService } from './calendar.service';

@Component({
  selector: 'app-cal-todos',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  template: `
    <div class="card">
      <div class="card-head"><h3>{{ 'cal.nav.todos' | translate }}</h3>
        <div class="seg"><button [class.on]="f() === 'open'" (click)="f.set('open')">{{ 'cal.t.open' | translate }}</button><button [class.on]="f() === 'done'" (click)="f.set('done')">{{ 'cal.t.done' | translate }}</button></div></div>
      <div class="card-body">
        <form class="add" (ngSubmit)="add()" *ngIf="auth.can('cal.events.manage')">
          <input name="t" [(ngModel)]="title" [placeholder]="'cal.t.add' | translate" required>
          <input name="d" type="datetime-local" [(ngModel)]="due">
          <select name="p" [(ngModel)]="prio"><option value="low">{{ 'cal.p.low' | translate }}</option><option value="normal">{{ 'cal.p.normal' | translate }}</option><option value="high">{{ 'cal.p.high' | translate }}</option></select>
          <button class="primary" [disabled]="!title.trim()">{{ 'cal.t.addbtn' | translate }}</button>
        </form>
        <p class="flash bad" *ngIf="error()">{{ error() }}</p>
        <p class="dim" *ngIf="!shown().length">{{ 'cal.notodos' | translate }}</p>
        <div class="td" *ngFor="let t of shown()" [class.done]="t.status === 'Done'">
          <button class="ck" [class.on]="t.status === 'Done'" (click)="tick(t)">{{ t.status === 'Done' ? '✓' : '' }}</button>
          <span class="tt">{{ t.title }}<small class="dim" *ngIf="t.data.notes"> — {{ t.data.notes }}</small></span>
          <span class="chip" [class.bad]="late(t)" *ngIf="t.start">{{ t.start | date:'d MMM HH:mm' }}</span>
          <span class="chip warn" *ngIf="t.data.priority === 'high'">!</span>
          <button class="ghost" (click)="del(t)">✕</button>
        </div>
      </div>
    </div>`,
  styles: [`
    .add { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; } .add input[name=t] { flex: 1; min-width: 200px; }
    .td { display: flex; gap: 10px; align-items: center; padding: 10px 4px; border-bottom: 1px solid var(--border); } .td.done .tt { text-decoration: line-through; opacity: .6; } .tt { flex: 1; }
    .ck { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border-strong, #94a3b8); background: none; cursor: pointer; font-size: 12px; line-height: 1; } .ck.on { background: var(--ok); border-color: var(--ok); color: #fff; }
    .dim { color: var(--text-dim); } .chip.bad { background: var(--bad-soft); color: var(--bad); } .chip.warn { background: var(--warn-soft); color: var(--warn); }
  `]
})
export class CalTodosComponent implements OnInit {
  auth = inject(AuthService); private api = inject(CalendarService); private i18n = inject(I18nService);
  items = signal<CalItem[]>([]); f = signal<'open' | 'done'>('open'); error = signal('');
  title = ''; due = ''; prio = 'normal';
  shown = computed(() => this.items().filter(t => (this.f() === 'done') === (t.status === 'Done')));
  ngOnInit() { this.load(); }
  load() { this.api.todos().subscribe({ next: l => this.items.set(l), error: e => this.error.set(errMsg(e, this.i18n)) }); }
  late(t: CalItem) { return t.status !== 'Done' && !!t.start && new Date(t.start) < new Date(); }
  add() { if (!this.title.trim()) return; this.api.create({ kind: 'todo', title: this.title, start: this.due ? new Date(this.due).toISOString() : null, priority: this.prio, remindMinutes: this.due ? 0 : null }).subscribe({ next: () => { this.title = ''; this.due = ''; this.load(); }, error: e => this.error.set(errMsg(e, this.i18n)) }); }
  tick(t: CalItem) { this.api.toggleDone(t.id).subscribe({ next: () => this.load(), error: e => this.error.set(errMsg(e, this.i18n)) }); }
  del(t: CalItem) { this.api.remove(t.id).subscribe({ next: () => this.load(), error: e => this.error.set(errMsg(e, this.i18n)) }); }
}
