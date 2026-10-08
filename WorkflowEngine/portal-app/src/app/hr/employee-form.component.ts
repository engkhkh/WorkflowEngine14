import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { OrgService } from '../core/org.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { EMP_STATUSES, Employee, HrKind } from '../core/hr.models';
import { IconComponent } from '../shared/ui';
import { dateOnly, empName, errMsg, refLabel } from './hr-util';

/** Add / edit one employee on screen (also used to hire a recruitment candidate). */
@Component({
  selector: 'app-employee-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <div class="modal-scrim" (click)="closed.emit()">
      <div class="modal wide" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (employee ? 'hr.emp.edit' : 'hr.emp.new') | translate }}</h3>
          <button class="ghost icon-btn" (click)="closed.emit()"><app-icon name="x"></app-icon></button></div>
        <div class="modal-body">
          <h4 class="sec">{{ 'hr.sec.personal' | translate }}</h4>
          <div class="form-grid">
            <div><label class="lbl">{{ 'hr.f.empNo' | translate }} *</label><input [(ngModel)]="f.empNo" /></div>
            <div><label class="lbl">{{ 'hr.f.status' | translate }}</label>
              <select [(ngModel)]="f.status"><option *ngFor="let s of statuses" [value]="s">{{ 'hr.st.' + s | translate }}</option></select></div>
            <div><label class="lbl">{{ 'hr.f.fullName' | translate }} *</label><input [(ngModel)]="f.fullName" /></div>
            <div><label class="lbl">{{ 'hr.f.fullNameAr' | translate }}</label><input [(ngModel)]="f.fullNameAr" dir="rtl" /></div>
            <div><label class="lbl">{{ 'hr.f.email' | translate }}</label><input type="email" [(ngModel)]="f.email" /></div>
            <div><label class="lbl">{{ 'hr.f.phone' | translate }}</label><input [(ngModel)]="f.phone" dir="ltr" /></div>
            <div><label class="lbl">{{ 'hr.f.gender' | translate }}</label>
              <select [(ngModel)]="f.gender"><option value="">—</option><option value="Male">{{ 'hr.male' | translate }}</option><option value="Female">{{ 'hr.female' | translate }}</option></select></div>
            <div><label class="lbl">{{ 'hr.f.nationality' | translate }}</label><input [(ngModel)]="f.nationality" /></div>
            <div><label class="lbl">{{ 'hr.f.nationalId' | translate }}</label><input [(ngModel)]="f.nationalId" dir="ltr" /></div>
            <div><label class="lbl">{{ 'hr.f.birthDate' | translate }}</label><input type="date" [(ngModel)]="f.birthDate" /></div>
          </div>

          <h4 class="sec">{{ 'hr.sec.employment' | translate }}</h4>
          <div class="form-grid">
            <div><label class="lbl">{{ 'hr.f.hireDate' | translate }}</label><input type="date" [(ngModel)]="f.hireDate" /></div>
            <div><label class="lbl">{{ 'hr.f.terminationDate' | translate }}</label><input type="date" [(ngModel)]="f.terminationDate" /></div>
            <div><label class="lbl">{{ 'hr.f.company' | translate }}</label>
              <select [(ngModel)]="f.company"><option value="">—</option><option *ngFor="let c of org.companies()" [value]="c.code">{{ i18n.nm(c) }}</option></select></div>
            <div><label class="lbl">{{ 'hr.f.branch' | translate }}</label>
              <select [(ngModel)]="f.branch"><option value="">—</option><option *ngFor="let b of branchesOfCompany()" [value]="b.code">{{ i18n.nm(b) }}</option></select></div>
            <div><label class="lbl">{{ 'hr.f.unit' | translate }}</label><input [(ngModel)]="f.unit" list="dl-unit" /></div>
            <div><label class="lbl">{{ 'hr.f.position' | translate }}</label><input [(ngModel)]="f.position" list="dl-position" /></div>
            <div><label class="lbl">{{ 'hr.f.job' | translate }}</label><input [(ngModel)]="f.job" list="dl-job" /></div>
            <div><label class="lbl">{{ 'hr.f.grade' | translate }}</label><input [(ngModel)]="f.grade" list="dl-grade" /></div>
            <div><label class="lbl">{{ 'hr.f.managerEmpNo' | translate }}</label><input [(ngModel)]="f.managerEmpNo" list="dl-manager" /></div>
            <div><label class="lbl">{{ 'hr.f.costCenter' | translate }}</label><input [(ngModel)]="f.costCenter" list="dl-costcenter" /></div>
            <div><label class="lbl">{{ 'hr.f.location' | translate }}</label><input [(ngModel)]="f.location" list="dl-location" /></div>
            <div><label class="lbl">{{ 'hr.f.legalEntity' | translate }}</label><input [(ngModel)]="f.legalEntity" list="dl-entity" /></div>
            <div><label class="lbl">{{ 'hr.f.businessUnit' | translate }}</label><input [(ngModel)]="f.businessUnit" list="dl-bu" /></div>
          </div>

          <ng-container *ngIf="auth.can('hr.employees.salary')">
            <h4 class="sec">{{ 'hr.sec.compensation' | translate }}</h4>
            <div class="form-grid"><div><label class="lbl">{{ 'hr.f.basicSalary' | translate }}</label><input type="number" min="0" [(ngModel)]="f.basicSalary" /></div></div>
          </ng-container>

          <h4 class="sec">{{ 'hr.sec.access' | translate }}</h4>
          <div class="form-grid">
            <div><label class="lbl">{{ 'hr.f.username' | translate }}</label><input [(ngModel)]="f.username" autocomplete="off" dir="ltr" />
              <div class="hint">{{ 'hr.f.usernameHint' | translate }}</div></div>
            <div class="full"><label class="lbl">{{ 'hr.f.notes' | translate }}</label><input [(ngModel)]="f.notes" /></div>
          </div>

          <datalist *ngFor="let k of dlKinds" [id]="'dl-' + k"><option *ngFor="let r of hr.ref(k)" [value]="r.code || ''">{{ label(r) }}</option></datalist>
          <datalist id="dl-manager"><option *ngFor="let e of employees" [value]="e.empNo">{{ name(e) }}</option></datalist>

          <p class="flash bad" *ngIf="error">{{ error }}</p>
        </div>
        <div class="modal-foot">
          <button (click)="closed.emit()">{{ 'common.cancel' | translate }}</button>
          <button class="primary" (click)="save()" [disabled]="saving">{{ (saving ? 'admin.saving' : 'admin.save') | translate }}</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal.wide { width: min(860px, 100%); }
    .sec { margin: 18px 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); }
    .sec:first-child { margin-top: 0; }
    :host-context(html[dir="rtl"]) .sec { text-transform: none; letter-spacing: 0; }
    .form-grid { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
  `]
})
export class EmployeeFormComponent implements OnInit {
  @Input() employee: Employee | null = null;
  /** values to start from when creating (e.g. from a recruitment candidate) */
  @Input() prefill: Partial<Employee> = {};
  @Input() employees: Employee[] = [];
  @Output() saved = new EventEmitter<Employee>();
  @Output() closed = new EventEmitter<void>();

  statuses = EMP_STATUSES;
  dlKinds: HrKind[] = ['unit', 'position', 'job', 'grade', 'costcenter', 'location', 'entity', 'bu'];
  f: any = { status: 'Active' };
  saving = false;
  error = '';

  constructor(public auth: AuthService, public hr: HrService, public org: OrgService, public i18n: I18nService) {}

  ngOnInit() {
    const src = this.employee ?? { status: 'Active', ...this.prefill };
    this.f = { ...src };
    for (const k of ['birthDate', 'hireDate', 'terminationDate']) this.f[k] = dateOnly(this.f[k]);
    if (!this.employee && !this.f.company) this.f.company = this.org.companies()[0]?.code ?? '';
    this.hr.loadRefs(this.dlKinds).subscribe();
  }

  branchesOfCompany() { return this.f.company ? this.org.branchesOf(this.f.company) : this.org.branches(); }
  label(r: any) { return refLabel(r, this.i18n); }
  name(e: Employee) { return empName(e, this.i18n); }

  save() {
    const f = this.f;
    if (!String(f.empNo ?? '').trim() || !String(f.fullName ?? '').trim()) { this.error = this.i18n.t('hr.err.required'); return; }
    this.saving = true; this.error = '';
    const body: any = { ...f };
    for (const k of ['birthDate', 'hireDate', 'terminationDate', 'basicSalary']) if (body[k] === '' || body[k] === undefined) body[k] = null;
    const call = this.employee ? this.hr.updateEmployee(this.employee.id, body) : this.hr.createEmployee(body);
    call.subscribe({
      next: e => { this.saving = false; this.saved.emit(e); },
      error: e => { this.saving = false; this.error = e.status === 409 ? this.i18n.t('hr.err.dupEmp') : errMsg(e, this.i18n); }
    });
  }
}
