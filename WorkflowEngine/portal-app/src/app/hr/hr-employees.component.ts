import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { EMP_STATUSES, Employee } from '../core/hr.models';
import { IconComponent, LocalDatePipe } from '../shared/ui';
import { EmployeeFormComponent } from './employee-form.component';
import { EmployeeImportComponent } from './employee-import.component';
import { dateOnly, empName, errMsg, findRef, initials, refLabel } from './hr-util';
import { EMP_FIELDS } from '../core/hr.fields';

const PAGE = 25;

/** Employee master data: search / filter, add on screen, edit, import from Excel or CSV, export. */
@Component({
  selector: 'app-hr-employees',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, IconComponent, LocalDatePipe, EmployeeFormComponent, EmployeeImportComponent],
  template: `
    <div class="flash" [class.bad]="flashBad" *ngIf="flashMsg">{{ flashMsg }}</div>

    <div class="bar">
      <div class="find"><app-icon name="search" [size]="15"></app-icon><input [ngModel]="q()" (ngModelChange)="q.set($event); page.set(0)" [placeholder]="'hr.emp.search' | translate" /></div>
      <select [ngModel]="status()" (ngModelChange)="status.set($event); page.set(0)">
        <option value="">{{ 'hr.emp.allStatus' | translate }}</option>
        <option *ngFor="let s of statuses" [value]="s">{{ 'hr.st.' + s | translate }}</option>
      </select>
      <select [ngModel]="unit()" (ngModelChange)="unit.set($event); page.set(0)">
        <option value="">{{ 'hr.emp.allUnits' | translate }}</option>
        <option *ngFor="let u of units()" [value]="u">{{ unitLabel(u) }}</option>
      </select>
      <span class="spacer"></span>
      <button (click)="exportXlsx()" *ngIf="auth.can('hr.reports.view') || auth.can('hr.employees.view')" [disabled]="!shown().length"><app-icon name="download" [size]="15"></app-icon>{{ 'hr.emp.export' | translate }}</button>
      <button (click)="importing = true" *ngIf="auth.can('hr.employees.import')"><app-icon name="import" [size]="15"></app-icon>{{ 'hr.emp.import' | translate }}</button>
      <button class="primary" (click)="openForm(null)" *ngIf="auth.can('hr.employees.manage')"><app-icon name="plus" [size]="15"></app-icon>{{ 'hr.emp.new' | translate }}</button>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>{{ 'hr.f.empNo' | translate }}</th><th>{{ 'hr.f.fullName' | translate }}</th><th>{{ 'hr.f.unit' | translate }}</th>
            <th>{{ 'hr.f.managerEmpNo' | translate }}</th><th>{{ 'hr.f.location' | translate }}</th><th>{{ 'hr.f.hireDate' | translate }}</th>
            <th class="num" *ngIf="auth.can('hr.employees.salary')">{{ 'hr.f.basicSalary' | translate }}</th>
            <th>{{ 'hr.f.status' | translate }}</th><th></th>
          </tr></thead>
          <tbody>
            <tr *ngFor="let e of pageRows()" class="click" [routerLink]="['/hr/employees', e.id]">
              <td class="mono">{{ e.empNo }}</td>
              <td><div class="who"><span class="av">{{ ini(e.fullName) }}</span>
                <div><strong>{{ name(e) }}</strong><div class="dim">{{ e.position || e.job || '—' }}</div></div></div></td>
              <td>{{ unitLabel(e.unit) || '—' }}</td>
              <td class="dim">{{ managerName(e) }}</td>
              <td class="dim">{{ locLabel(e.location) || '—' }}</td>
              <td class="dim">{{ e.hireDate | ldate }}</td>
              <td class="num" *ngIf="auth.can('hr.employees.salary')">{{ e.basicSalary | number: '1.0-0' }}</td>
              <td><span class="pill" [class]="'st-' + e.status"><i></i>{{ 'hr.st.' + e.status | translate }}</span></td>
              <td class="act" (click)="$event.stopPropagation()">
                <button class="ghost sm" *ngIf="auth.can('hr.employees.manage')" (click)="openForm(e)" [title]="'admin.edit' | translate"><app-icon name="edit" [size]="15"></app-icon></button>
                <button class="ghost sm danger-i" *ngIf="auth.can('hr.employees.manage')" (click)="deleting = e; formError = ''" [title]="'admin.delete' | translate"><app-icon name="trash" [size]="15"></app-icon></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="empty" *ngIf="!shown().length">
        {{ (all().length ? 'common.noData' : 'hr.emp.none') | translate }}
        <div *ngIf="!all().length && auth.can('hr.employees.import')"><button class="primary" style="margin-top:12px" (click)="importing = true">{{ 'hr.emp.import' | translate }}</button></div>
      </div>
      <div class="pager" *ngIf="shown().length > pageSize">
        <span class="dim">{{ 'hr.emp.count' | translate: { from: page() * pageSize + 1, to: Math.min(shown().length, (page() + 1) * pageSize), n: shown().length } }}</span>
        <span class="spacer"></span>
        <button class="sm" (click)="page.set(page() - 1)" [disabled]="page() === 0">‹</button>
        <button class="sm" (click)="page.set(page() + 1)" [disabled]="(page() + 1) * pageSize >= shown().length">›</button>
      </div>
    </div>

    <app-employee-form *ngIf="formOpen" [employee]="editing" [employees]="all()" (closed)="formOpen = false" (saved)="onSaved($event)"></app-employee-form>
    <app-employee-import *ngIf="importing" [existing]="all()" (closed)="importing = false" (finished)="load()"></app-employee-import>

    <div class="modal-scrim" *ngIf="deleting" (click)="deleting = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'admin.delete' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'hr.emp.deleteConfirm' | translate: { name: deleting.fullName } }}</p>
          <p class="hint">{{ 'hr.emp.deleteHint' | translate }}</p>
          <p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="deleting = null">{{ 'common.cancel' | translate }}</button>
          <button class="primary danger-fill" (click)="doDelete()">{{ 'admin.delete' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
    .bar select { width: auto; min-width: 150px; }
    .find { position: relative; flex: 1; min-width: 220px; max-width: 360px; }
    .find app-icon { position: absolute; inset-inline-start: 11px; top: 50%; transform: translateY(-50%); color: var(--text-dim); }
    .find input { padding-inline-start: 34px; }
    .spacer { flex: 1; }
    .who { display: flex; gap: 10px; align-items: center; }
    .av { width: 32px; height: 32px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
    .act { white-space: nowrap; text-align: end; }
    .danger-i { color: var(--bad); }
    .danger-fill { background: var(--bad); border-color: var(--bad); color: #fff; }
    .pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 550; padding: 2px 9px; border-radius: 999px; background: var(--muted-soft); color: var(--muted); }
    .pill i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .pill.st-Active { background: var(--ok-soft); color: var(--ok); }
    .pill.st-Probation { background: var(--info-soft); color: var(--info); }
    .pill.st-OnLeave { background: var(--warn-soft); color: var(--warn); }
    .pill.st-Terminated { background: var(--bad-soft); color: var(--bad); }
    .pager { display: flex; align-items: center; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--border); }
  `]
})
export class HrEmployeesComponent implements OnInit {
  Math = Math;
  statuses = EMP_STATUSES;
  pageSize = PAGE;
  all = signal<Employee[]>([]);
  q = signal('');
  status = signal('');
  unit = signal('');
  page = signal(0);

  units = computed(() => Array.from(new Set(this.all().map(e => (e.unit ?? '').trim()).filter(Boolean))).sort());
  shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.all().filter(e =>
      (!this.status() || e.status === this.status()) && (!this.unit() || (e.unit ?? '').trim() === this.unit()) &&
      (!q || [e.empNo, e.fullName, e.fullNameAr, e.email, e.position, e.unit, e.nationalId, e.phone].some(v => (v ?? '').toLowerCase().includes(q))));
  });
  pageRows = computed(() => this.shown().slice(this.page() * PAGE, (this.page() + 1) * PAGE));

  formOpen = false; editing: Employee | null = null; importing = false; deleting: Employee | null = null;
  flashMsg = ''; flashBad = false; formError = '';

  constructor(public auth: AuthService, private hr: HrService, private i18n: I18nService) {}

  ngOnInit() { this.load(); }
  load() { this.hr.employees().subscribe({ next: l => this.all.set(l), error: e => this.flash(errMsg(e, this.i18n), true) }); this.hr.loadRefs(['unit', 'location']).subscribe(); }

  name(e: Employee) { return empName(e, this.i18n); }
  ini(n: string) { return initials(n); }
  unitLabel(v: string | null | undefined) { return v ? (refLabel(findRef(this.hr.ref('unit'), v), this.i18n) || v) : ''; }
  locLabel(v: string | null | undefined) { return v ? (refLabel(findRef(this.hr.ref('location'), v), this.i18n) || v) : ''; }
  managerName(e: Employee) { const m = this.all().find(x => x.empNo === e.managerEmpNo); return m ? this.name(m) : (e.managerEmpNo ?? '—'); }

  openForm(e: Employee | null) { this.editing = e; this.formOpen = true; }
  onSaved(e: Employee) {
    this.formOpen = false;
    this.flash(this.i18n.t(this.editing ? 'hr.emp.saved' : 'hr.emp.created'));
    this.load();
  }

  doDelete() {
    const e = this.deleting!;
    this.hr.deleteEmployee(e.id).subscribe({
      next: () => { this.deleting = null; this.flash(this.i18n.t('hr.emp.deleted')); this.load(); },
      error: err => this.formError = errMsg(err, this.i18n)
    });
  }

  private flash(msg: string, bad = false) { this.flashMsg = msg; this.flashBad = bad; if (!bad) setTimeout(() => this.flashMsg = '', 3500); }

  async exportXlsx() {
    const { default: writeXlsxFile } = await import('write-excel-file');
    const fields = EMP_FIELDS.filter(f => !f.salary || this.auth.can('hr.employees.salary'));
    const head = fields.map(f => ({ value: String(f.key), fontWeight: 'bold' as const }));
    const rows = this.shown().map(e => fields.map(f => {
      const v = (e as any)[f.key];
      return { value: v === null || v === undefined || v === '' ? null : (f.type === 'number' ? Number(v) : f.type === 'date' ? dateOnly(v) : String(v)), type: f.type === 'number' ? Number : String };
    }));
    await writeXlsxFile([head, ...rows] as any, { fileName: 'employees.xlsx', columns: fields.map(() => ({ width: 18 })) } as any);
  }
}
