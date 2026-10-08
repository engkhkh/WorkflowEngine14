import { Component, Input, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { Employee, HrRecord, LEAVE_STATUSES } from '../core/hr.models';
import { IconComponent, LocalDatePipe } from '../shared/ui';
import { daysBetween, empName, errMsg, findRef, refLabel, todayStr } from './hr-util';

/**
 * Leave & absence. HR (hr.leave.view) sees everyone's requests and balances; people with hr.leave.approve decide them;
 * anyone with hr.self files their own requests, sees their own balance and can cancel a pending request.
 */
@Component({
  selector: 'app-hr-leave',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, LocalDatePipe],
  template: `
    <div class="flash" [class.bad]="flashBad" *ngIf="flashMsg">{{ flashMsg }}</div>

    <div class="bal" *ngIf="me()">
      <div class="b" *ngFor="let b of myBalances()"><span>{{ b.name }}</span><strong>{{ b.left }}</strong><small class="dim">{{ 'hr.lv.usedOf' | translate: { used: b.used, total: b.total } }}</small></div>
    </div>
    <p class="flash bad" *ngIf="selfOnly && meMissing">{{ 'hr.me.notLinked' | translate }}</p>

    <div class="bar">
      <div class="seg" *ngIf="viewAll">
        <button [class.on]="tab() === 'requests'" (click)="tab.set('requests')">{{ 'hr.lv.requests' | translate }}</button>
        <button [class.on]="tab() === 'balances'" (click)="tab.set('balances')">{{ 'hr.lv.balances' | translate }}</button>
      </div>
      <select *ngIf="tab() === 'requests'" [ngModel]="status()" (ngModelChange)="status.set($event)">
        <option value="">{{ 'hr.emp.allStatus' | translate }}</option>
        <option *ngFor="let s of lvStatuses" [value]="s">{{ 'hr.lvst.' + s | translate }}</option>
      </select>
      <span class="grow"></span>
      <button class="primary" (click)="openNew()" *ngIf="canRequest"><app-icon name="plus" [size]="15"></app-icon>{{ 'hr.lv.new' | translate }}</button>
    </div>

    <div class="card" *ngIf="tab() === 'requests'">
      <div class="table-wrap"><table class="data">
        <thead><tr><th *ngIf="viewAll">{{ 'hr.lv.employee' | translate }}</th><th>{{ 'hr.lv.type' | translate }}</th><th>{{ 'hr.lv.period' | translate }}</th>
          <th class="num">{{ 'hr.lv.days' | translate }}</th><th>{{ 'hr.lv.reason' | translate }}</th><th>{{ 'hr.f.status' | translate }}</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let r of shown()">
            <td *ngIf="viewAll"><strong>{{ empLabel(r.empNo) }}</strong><div class="dim mono">{{ r.empNo }}</div></td>
            <td>{{ typeName(r.data['type']) }}</td>
            <td class="dim">{{ r.data['from'] | ldate }} → {{ r.data['to'] | ldate }}</td>
            <td class="num">{{ r.data['days'] }}</td>
            <td class="dim why">{{ r.data['reason'] }}</td>
            <td><span class="chip" [class.warn]="r.status === 'Pending'" [class.ok]="r.status === 'Approved'" [class.high]="r.status === 'Rejected'">{{ 'hr.lvst.' + r.status | translate }}</span>
              <div class="dim sm" *ngIf="r.data['decidedBy']">{{ r.data['decidedBy'] }}</div></td>
            <td class="act">
              <button class="sm success" *ngIf="canApprove && r.status === 'Pending'" (click)="decide(r, 'Approved')">{{ 'hr.lv.approve' | translate }}</button>
              <button class="sm" *ngIf="canApprove && r.status === 'Pending'" (click)="decide(r, 'Rejected')">{{ 'hr.lv.reject' | translate }}</button>
              <button class="sm" *ngIf="!canApprove && r.status === 'Pending'" (click)="decide(r, 'Cancelled')">{{ 'hr.lv.cancel' | translate }}</button>
              <button class="ghost sm danger-i" *ngIf="canApprove" (click)="remove(r)" [title]="'admin.delete' | translate"><app-icon name="trash" [size]="15"></app-icon></button>
            </td>
          </tr>
        </tbody></table></div>
      <div class="empty" *ngIf="!shown().length">{{ 'common.noData' | translate }}</div>
    </div>

    <div class="card" *ngIf="tab() === 'balances'">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'hr.lv.employee' | translate }}</th><th class="num" *ngFor="let t of types()">{{ typeLabel(t) }}</th></tr></thead>
        <tbody><tr *ngFor="let e of activeEmps()"><td><strong>{{ name(e) }}</strong><div class="dim mono">{{ e.empNo }}</div></td>
          <td class="num" *ngFor="let t of types()">{{ left(e.empNo, t) }}</td></tr></tbody></table></div>
      <div class="empty" *ngIf="!activeEmps().length || !types().length">{{ 'hr.lv.noTypes' | translate }}</div>
    </div>

    <div class="modal-scrim" *ngIf="form" (click)="form = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'hr.lv.new' | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div class="full" *ngIf="canApprove"><label class="lbl">{{ 'hr.lv.employee' | translate }}</label>
            <select [(ngModel)]="form.empNo"><option value="">—</option><option *ngFor="let e of activeEmps()" [value]="e.empNo">{{ e.empNo }} · {{ name(e) }}</option></select></div>
          <div class="full"><label class="lbl">{{ 'hr.lv.type' | translate }}</label>
            <select [(ngModel)]="form.type"><option *ngFor="let t of types()" [value]="t.code">{{ typeLabel(t) }}</option></select></div>
          <div><label class="lbl">{{ 'hr.lv.from' | translate }}</label><input type="date" [(ngModel)]="form.from" (ngModelChange)="recalc()" /></div>
          <div><label class="lbl">{{ 'hr.lv.to' | translate }}</label><input type="date" [(ngModel)]="form.to" (ngModelChange)="recalc()" /></div>
          <div><label class="lbl">{{ 'hr.lv.days' | translate }}</label><input type="number" min="0.5" step="0.5" [(ngModel)]="form.days" /></div>
          <div class="full"><label class="lbl">{{ 'hr.lv.reason' | translate }}</label><input [(ngModel)]="form.reason" /></div>
        </div>
        <p class="hint" *ngIf="overBalance()">{{ 'hr.lv.over' | translate }}</p>
        <p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="form = null">{{ 'common.cancel' | translate }}</button>
          <button class="primary" (click)="submit()" [disabled]="saving">{{ 'hr.lv.submit' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .bal { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .b { flex: 1; min-width: 140px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; box-shadow: var(--shadow); }
    .b span { font-size: 12px; color: var(--text-2); } .b strong { font-size: 26px; }
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; } .bar select { width: auto; } .grow { flex: 1; }
    .act { white-space: nowrap; text-align: end; } .danger-i { color: var(--bad); } .why { max-width: 240px; } .sm { font-size: 11.5px; }
    .chip.ok { background: var(--ok-soft); color: var(--ok); }
  `]
})
export class HrLeaveComponent implements OnInit {
  lvStatuses = LEAVE_STATUSES;
  tab = signal<'requests' | 'balances'>('requests');
  status = signal('');
  all = signal<HrRecord[]>([]);
  emps = signal<Employee[]>([]);
  me = signal<Employee | null>(null);
  meMissing = false;
  form: any = null; saving = false; formError = ''; flashMsg = ''; flashBad = false;

  /** true on the self-service page: only my own requests, no approving */
  @Input() mine = false;
  get viewAll() { return !this.mine && this.auth.can('hr.leave.view'); }
  get canApprove() { return !this.mine && this.auth.can('hr.leave.approve'); }
  get selfOnly() { return !this.viewAll && !this.canApprove; }
  get canRequest() { return this.canApprove || (this.auth.can('hr.self') && !!this.me()); }

  types = computed(() => this.hr.ref('leavetype'));
  shown = computed(() => this.all().filter(r => (!this.status() || r.status === this.status()) && (!this.mine || r.empNo === this.me()?.empNo)));
  activeEmps = computed(() => this.emps().filter(e => e.status !== 'Terminated'));

  constructor(public auth: AuthService, private hr: HrService, private i18n: I18nService) {}

  ngOnInit() {
    this.hr.loadRefs(['leavetype']).subscribe();
    this.load();
    if (this.auth.can('hr.self')) this.hr.me().subscribe({ next: e => this.me.set(e), error: () => this.meMissing = true });
    if (!this.mine && (this.auth.can('hr.leave.view') || this.auth.can('hr.leave.approve'))) this.hr.employees().subscribe({ next: l => this.emps.set(l), error: () => {} });
  }
  load() { this.hr.records('leave').subscribe({ next: l => this.all.set(l), error: e => this.flash(errMsg(e, this.i18n), true) }); }

  name(e: Employee) { return empName(e, this.i18n); }
  empLabel(no: string | null | undefined) { const e = this.emps().find(x => x.empNo === no); return e ? this.name(e) : (no ?? ''); }
  typeLabel(t: HrRecord) { return refLabel(t, this.i18n); }
  typeName(code: string) { const t = findRef(this.types(), code); return t ? this.typeLabel(t) : code; }

  private usedDays(empNo: string, type: string) {
    const y = String(new Date().getFullYear());
    return this.all().filter(r => r.empNo === empNo && r.status === 'Approved' && r.data['type'] === type && String(r.data['from']).startsWith(y)).reduce((s, r) => s + Number(r.data['days'] ?? 0), 0);
  }
  left(empNo: string, t: HrRecord) { return Number(t.data['days'] ?? 0) - this.usedDays(empNo, t.code ?? ''); }
  myBalances() { const m = this.me(); return m ? this.types().map(t => ({ name: this.typeLabel(t), total: Number(t.data['days'] ?? 0), used: this.usedDays(m.empNo, t.code ?? ''), left: this.left(m.empNo, t) })) : []; }

  openNew() {
    this.formError = '';
    this.form = { empNo: this.canApprove ? '' : this.me()?.empNo ?? '', type: this.types()[0]?.code ?? '', from: todayStr(), to: todayStr(), days: 1, reason: '' };
    if (!this.canApprove && this.me()) this.form.empNo = this.me()!.empNo;
  }
  recalc() { const f = this.form; if (f.from && f.to) f.days = daysBetween(f.from, f.to) || 1; }
  overBalance() {
    const f = this.form; const t = findRef(this.types(), f?.type);
    return !!(f?.empNo && t && Number(f.days) > this.left(f.empNo, t));
  }

  submit() {
    const f = this.form;
    if (!f.empNo || !f.type || !f.from || !f.to) { this.formError = this.i18n.t('hr.err.required'); return; }
    if (f.to < f.from) { this.formError = this.i18n.t('hr.lv.badDates'); return; }
    this.saving = true; this.formError = '';
    this.hr.createRecord('leave', { empNo: f.empNo, status: 'Pending', data: { type: f.type, from: f.from, to: f.to, days: Number(f.days) || daysBetween(f.from, f.to), reason: f.reason } }).subscribe({
      next: () => { this.saving = false; this.form = null; this.flash(this.i18n.t('hr.lv.sent')); this.load(); },
      error: e => { this.saving = false; this.formError = errMsg(e, this.i18n); }
    });
  }

  decide(r: HrRecord, status: string) {
    this.hr.updateRecord('leave', r.id, { status, empNo: r.empNo, data: r.data }).subscribe({
      next: () => { this.flash(this.i18n.t('hr.saved')); this.load(); },
      error: e => this.flash(errMsg(e, this.i18n), true)
    });
  }
  remove(r: HrRecord) { this.hr.deleteRecord('leave', r.id).subscribe({ next: () => this.load(), error: e => this.flash(errMsg(e, this.i18n), true) }); }
  private flash(m: string, bad = false) { this.flashMsg = m; this.flashBad = bad; setTimeout(() => this.flashMsg = '', 3500); }
}
