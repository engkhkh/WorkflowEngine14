import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { Employee, HrRecord } from '../core/hr.models';
import { IconComponent, LocalDatePipe } from '../shared/ui';
import { EmployeeFormComponent } from './employee-form.component';
import { daysBetween, empName, findRef, initials, refLabel } from './hr-util';

/** One employee: organization details, direct reports, leave balance + history, goals and reviews. */
@Component({
  selector: 'app-hr-profile',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, IconComponent, LocalDatePipe, EmployeeFormComponent],
  template: `
    <div class="crumb"><a routerLink="/hr/employees">{{ 'hr.nav.employees' | translate }}</a><span>/</span><span>{{ emp() ? name(emp()!) : '…' }}</span></div>
    <ng-container *ngIf="emp() as e">
      <div class="card head">
        <span class="big">{{ ini(e.fullName) }}</span>
        <div class="who">
          <h2>{{ name(e) }}</h2>
          <div class="dim">{{ e.position || e.job || '—' }} · {{ lbl('unit', e.unit) || '—' }}</div>
          <div class="chips"><span class="chip mono">{{ e.empNo }}</span><span class="chip" [class.warn]="e.status === 'OnLeave'" [class.high]="e.status === 'Terminated'">{{ 'hr.st.' + e.status | translate }}</span>
            <span class="chip" *ngIf="e.grade">{{ 'hr.f.grade' | translate }} {{ e.grade }}</span></div>
        </div>
        <button class="primary" *ngIf="auth.can('hr.employees.manage')" (click)="editing = true"><app-icon name="edit" [size]="15"></app-icon>{{ 'admin.edit' | translate }}</button>
      </div>

      <div class="grid cols">
        <div class="card"><div class="card-head"><h3>{{ 'hr.sec.personal' | translate }}</h3></div><div class="card-body kv">
          <div><span>{{ 'hr.f.email' | translate }}</span><b>{{ e.email || '—' }}</b></div>
          <div><span>{{ 'hr.f.phone' | translate }}</span><b dir="ltr">{{ e.phone || '—' }}</b></div>
          <div><span>{{ 'hr.f.nationality' | translate }}</span><b>{{ e.nationality || '—' }}</b></div>
          <div><span>{{ 'hr.f.gender' | translate }}</span><b>{{ e.gender ? ('hr.' + e.gender.toLowerCase() | translate) : '—' }}</b></div>
          <div><span>{{ 'hr.f.nationalId' | translate }}</span><b dir="ltr">{{ e.nationalId || '—' }}</b></div>
          <div><span>{{ 'hr.f.birthDate' | translate }}</span><b>{{ e.birthDate | ldate }}</b></div>
        </div></div>

        <div class="card"><div class="card-head"><h3>{{ 'hr.sec.employment' | translate }}</h3></div><div class="card-body kv">
          <div><span>{{ 'hr.f.hireDate' | translate }}</span><b>{{ e.hireDate | ldate }}</b></div>
          <div><span>{{ 'hr.prof.tenure' | translate }}</span><b>{{ tenure(e) }}</b></div>
          <div><span>{{ 'hr.f.managerEmpNo' | translate }}</span><b><a *ngIf="manager() as m" [routerLink]="['/hr/employees', m.id]">{{ name(m) }}</a><span *ngIf="!manager()">{{ e.managerEmpNo || '—' }}</span></b></div>
          <div><span>{{ 'hr.f.company' | translate }}</span><b>{{ e.company || '—' }} {{ e.branch ? '· ' + e.branch : '' }}</b></div>
          <div><span>{{ 'hr.f.job' | translate }}</span><b>{{ lbl('job', e.job) || '—' }}</b></div>
          <div><span>{{ 'hr.f.costCenter' | translate }}</span><b>{{ lbl('costcenter', e.costCenter) || '—' }}</b></div>
          <div><span>{{ 'hr.f.location' | translate }}</span><b>{{ lbl('location', e.location) || '—' }}</b></div>
          <div><span>{{ 'hr.f.legalEntity' | translate }}</span><b>{{ lbl('entity', e.legalEntity) || '—' }}</b></div>
          <div><span>{{ 'hr.f.businessUnit' | translate }}</span><b>{{ lbl('bu', e.businessUnit) || '—' }}</b></div>
          <div *ngIf="auth.can('hr.employees.salary')"><span>{{ 'hr.f.basicSalary' | translate }}</span><b>{{ e.basicSalary | number: '1.0-0' }}</b></div>
          <div *ngIf="e.terminationDate"><span>{{ 'hr.f.terminationDate' | translate }}</span><b>{{ e.terminationDate | ldate }}</b></div>
        </div></div>
      </div>

      <div class="grid cols">
        <div class="card" *ngIf="reports().length"><div class="card-head"><h3>{{ 'hr.prof.reports' | translate }} <span class="chip">{{ reports().length }}</span></h3></div>
          <div class="card-body list"><a *ngFor="let r of reports()" [routerLink]="['/hr/employees', r.id]"><span class="av">{{ ini(r.fullName) }}</span>{{ name(r) }}<small class="dim">{{ r.position }}</small></a></div></div>

        <div class="card" *ngIf="canLeave"><div class="card-head"><h3>{{ 'hr.nav.leave' | translate }}</h3></div>
          <div class="card-body">
            <div class="bal"><div *ngFor="let b of balances()"><b>{{ b.left }}</b><span>{{ b.name }}</span><small class="dim">{{ b.used }} / {{ b.total }}</small></div></div>
            <table class="data" *ngIf="leave().length"><tbody><tr *ngFor="let l of leave()">
              <td>{{ leaveName(l.data['type']) }}</td><td class="dim">{{ l.data['from'] | ldate }} → {{ l.data['to'] | ldate }}</td>
              <td class="num">{{ l.data['days'] }}</td><td><span class="chip" [class.warn]="l.status === 'Pending'" [class.high]="l.status === 'Rejected'">{{ 'hr.lvst.' + l.status | translate }}</span></td></tr></tbody></table>
            <p class="empty" *ngIf="!leave().length">{{ 'common.noData' | translate }}</p>
          </div></div>

        <div class="card" *ngIf="canPerf"><div class="card-head"><h3>{{ 'hr.nav.performance' | translate }}</h3></div>
          <div class="card-body">
            <table class="data" *ngIf="goals().length || reviews().length"><tbody>
              <tr *ngFor="let g of goals()"><td><strong>{{ g.data['title'] }}</strong><div class="dim">{{ g.data['cycle'] }} · {{ 'hr.pf.weight' | translate }} {{ g.data['weight'] }}%</div></td>
                <td class="num">{{ progress(g) }}%</td></tr>
              <tr *ngFor="let r of reviews()"><td><strong>{{ 'hr.pf.review' | translate }} {{ r.data['cycle'] }}</strong><div class="dim">{{ r.data['comments'] }}</div></td>
                <td class="num"><span class="chip">{{ r.data['rating'] || '—' }} / 5</span></td></tr></tbody></table>
            <p class="empty" *ngIf="!goals().length && !reviews().length">{{ 'common.noData' | translate }}</p>
          </div></div>
      </div>

      <app-employee-form *ngIf="editing" [employee]="e" [employees]="all()" (closed)="editing = false" (saved)="editing = false; load()"></app-employee-form>
    </ng-container>
    <p class="empty" *ngIf="notFound">{{ 'hr.prof.notFound' | translate }}</p>
  `,
  styles: [`
    .head { display: flex; align-items: center; gap: 16px; padding: 18px 20px; margin-bottom: 16px; flex-wrap: wrap; }
    .big { width: 62px; height: 62px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-size: 22px; font-weight: 700; }
    .who { flex: 1; min-width: 200px; } .who h2 { font-size: 20px; margin-bottom: 2px; }
    .chips { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .cols { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); margin-bottom: 16px; align-items: start; }
    .kv { display: flex; flex-direction: column; gap: 9px; }
    .kv div { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
    .kv span { color: var(--text-dim); } .kv b { font-weight: 550; text-align: end; }
    .list { display: flex; flex-direction: column; gap: 8px; } .list a { display: flex; align-items: center; gap: 10px; color: var(--text); }
    .list small { margin-inline-start: auto; }
    .av { width: 28px; height: 28px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-size: 11px; font-weight: 700; }
    .bal { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .bal div { flex: 1; min-width: 100px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; display: flex; flex-direction: column; }
    .bal b { font-size: 22px; } .bal span { font-size: 12px; color: var(--text-2); }
  `]
})
export class HrProfileComponent implements OnInit {
  emp = signal<Employee | null>(null);
  all = signal<Employee[]>([]);
  leave = signal<HrRecord[]>([]);
  goals = signal<HrRecord[]>([]);
  reviews = signal<HrRecord[]>([]);
  editing = false; notFound = false;

  canLeave = this.auth.canAny('hr.leave.view');
  canPerf = this.auth.canAny('hr.performance.view');

  constructor(private route: ActivatedRoute, public auth: AuthService, private hr: HrService, private i18n: I18nService) {}

  ngOnInit() { this.route.paramMap.subscribe(() => this.load()); }

  load() {
    const id = this.route.snapshot.paramMap.get('id');
    this.hr.employees().subscribe(list => {
      this.all.set(list);
      const e = list.find(x => x.id === id) ?? null;
      this.emp.set(e); this.notFound = !e;
      if (!e) return;
      if (this.canLeave) this.hr.records('leave', e.empNo).subscribe(l => this.leave.set(l));
      if (this.canPerf) {
        this.hr.records('goal', e.empNo).subscribe(l => this.goals.set(l));
        this.hr.records('review', e.empNo).subscribe(l => this.reviews.set(l));
      }
    });
  }

  name(e: Employee) { return empName(e, this.i18n); }
  ini(n: string) { return initials(n); }
  lbl(kind: any, v: string | null | undefined) { return v ? (refLabel(findRef(this.hr.ref(kind), v), this.i18n) || v) : ''; }
  manager() { const e = this.emp(); return this.all().find(x => x.empNo === e?.managerEmpNo) ?? null; }
  reports() { const e = this.emp(); return e ? this.all().filter(x => x.managerEmpNo === e.empNo && x.status !== 'Terminated') : []; }
  tenure(e: Employee) {
    if (!e.hireDate) return '—';
    const end = e.terminationDate ? new Date(e.terminationDate) : new Date();
    const months = Math.max(0, (end.getFullYear() - new Date(e.hireDate).getFullYear()) * 12 + end.getMonth() - new Date(e.hireDate).getMonth());
    return this.i18n.t('hr.prof.ym', { y: Math.floor(months / 12), m: months % 12 });
  }
  leaveName(code: string) { const t = findRef(this.hr.ref('leavetype'), code); return t ? refLabel(t, this.i18n) : code; }
  balances() {
    const year = new Date().getFullYear();
    return this.hr.ref('leavetype').map(t => {
      const total = Number(t.data['days'] ?? 0);
      const used = this.leave().filter(l => l.status === 'Approved' && l.data['type'] === t.code && String(l.data['from']).startsWith(String(year))).reduce((s, l) => s + Number(l.data['days'] ?? daysBetween(l.data['from'], l.data['to'])), 0);
      return { name: refLabel(t, this.i18n), total, used, left: total - used };
    });
  }
  progress(g: HrRecord) { const t = Number(g.data['target']), a = Number(g.data['actual']); return t > 0 ? Math.min(100, Math.round(a / t * 100)) : 0; }
}
