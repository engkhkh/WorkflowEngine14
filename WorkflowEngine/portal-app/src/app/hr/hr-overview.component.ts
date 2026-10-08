import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { HrCount, HrSummary } from '../core/hr.models';
import { KpiCardComponent } from '../shared/erp-widgets';
import { errMsg } from './hr-util';

/** HR dashboard: headcount, hires, turnover, absence, vacancies, performance distribution (needs hr.reports.view). */
@Component({
  selector: 'app-hr-overview',
  standalone: true,
  imports: [CommonModule, TranslatePipe, KpiCardComponent],
  template: `
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <ng-container *ngIf="s() as d">
      <div class="kpis">
        <app-kpi [label]="'hr.ov.total' | translate" [value]="d.total" icon="users" color="#ec4899" [hint]="('hr.ov.activeN' | translate: { n: d.active })"></app-kpi>
        <app-kpi [label]="'hr.ov.hires' | translate" [value]="d.newHires12m" icon="plus" color="#10b981" [hint]="'hr.ov.last12' | translate"></app-kpi>
        <app-kpi [label]="'hr.ov.turnover' | translate" [value]="d.turnoverPct + '%'" icon="refresh" color="#ef4444" [hint]="('hr.ov.leavers' | translate: { n: d.terminations12m })"></app-kpi>
        <app-kpi [label]="'hr.ov.onLeaveToday' | translate" [value]="d.onLeaveToday" icon="clock" color="#f59e0b" [hint]="('hr.ov.pendingLeave' | translate: { n: d.pendingLeave })"></app-kpi>
        <app-kpi [label]="'hr.ov.vacancies' | translate" [value]="d.openVacancies" icon="git-branch" color="#8b5cf6" [hint]="('hr.ov.openings' | translate: { n: d.openPositions, c: d.candidatesInPipeline })"></app-kpi>
        <app-kpi [label]="'hr.ov.tenure' | translate" [value]="d.avgTenureYears" icon="book" color="#0ea5e9" [hint]="'hr.ov.years' | translate"></app-kpi>
        <app-kpi *ngIf="d.monthlyPayroll !== null" [label]="'hr.ov.payroll' | translate" [value]="(d.monthlyPayroll || 0 | number: '1.0-0') || ''" icon="wallet" color="#4338ca" [hint]="'hr.ov.basicMonthly' | translate"></app-kpi>
      </div>

      <div class="grid g2">
        <div class="card"><div class="card-head"><h3>{{ 'hr.ov.hiresTrend' | translate }}</h3></div>
          <div class="card-body cols"><div class="c" *ngFor="let h of d.hires"><span class="v">{{ h.count || '' }}</span><div class="f" [style.height.%]="pct(h.count, d.hires)"></div><span class="l">{{ h.name.slice(5) }}</span></div></div></div>
        <div class="card"><div class="card-head"><h3>{{ 'hr.ov.byUnit' | translate }}</h3></div><div class="card-body" [ngTemplateOutlet]="bars" [ngTemplateOutletContext]="{ list: d.byUnit }"></div></div>
        <div class="card"><div class="card-head"><h3>{{ 'hr.ov.byNationality' | translate }}</h3></div><div class="card-body" [ngTemplateOutlet]="bars" [ngTemplateOutletContext]="{ list: d.byNationality }"></div></div>
        <div class="card"><div class="card-head"><h3>{{ 'hr.ov.byLocation' | translate }}</h3></div><div class="card-body" [ngTemplateOutlet]="bars" [ngTemplateOutletContext]="{ list: d.byLocation }"></div></div>
        <div class="card"><div class="card-head"><h3>{{ 'hr.ov.byGender' | translate }}</h3></div><div class="card-body" [ngTemplateOutlet]="bars" [ngTemplateOutletContext]="{ list: d.byGender, gender: true }"></div></div>
        <div class="card"><div class="card-head"><h3>{{ 'hr.pf.distribution' | translate }}</h3></div>
          <div class="card-body"><ng-container [ngTemplateOutlet]="bars" [ngTemplateOutletContext]="{ list: d.ratings, star: true }"></ng-container>
            <p class="dim" *ngIf="!d.ratings.length">{{ 'common.noData' | translate }}</p></div></div>
      </div>
    </ng-container>

    <ng-template #bars let-list="list" let-star="star" let-gender="gender">
      <div class="row" *ngFor="let b of list"><span class="n">{{ gender ? genderName(b.name) : (star ? b.name + ' ★' : b.name) }}</span>
        <div class="track"><div [style.width.%]="pct(b.count, list)"></div></div><b>{{ b.count }}</b></div>
      <p class="dim" *ngIf="!list.length">{{ 'common.noData' | translate }}</p>
    </ng-template>
  `,
  styles: [`
    .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .g2 { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); align-items: start; }
    .row { display: grid; grid-template-columns: minmax(90px, 150px) 1fr 40px; align-items: center; gap: 10px; margin-bottom: 9px; font-size: 13px; }
    .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
    .track { height: 9px; background: var(--surface-3); border-radius: 5px; overflow: hidden; } .track div { height: 100%; background: var(--primary); border-radius: 5px; }
    b { text-align: end; }
    .cols { display: flex; gap: 6px; align-items: flex-end; height: 170px; padding-top: 22px; }
    .c { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 3px; }
    .f { width: 100%; background: var(--chart-1, var(--primary)); border-radius: 4px 4px 0 0; min-height: 2px; } .v { font-size: 11px; font-weight: 650; min-height: 14px; } .l { font-size: 10.5px; color: var(--text-dim); }
  `]
})
export class HrOverviewComponent implements OnInit {
  s = signal<HrSummary | null>(null);
  error = '';
  constructor(public auth: AuthService, private hr: HrService, private i18n: I18nService) {}
  ngOnInit() { this.hr.summary().subscribe({ next: d => this.s.set(d), error: e => this.error = errMsg(e, this.i18n) }); }
  pct(n: number, list: HrCount[]) { const m = Math.max(1, ...list.map(x => x.count)); return Math.round(n / m * 100 * (list.length ? 0.9 : 1) + (n ? 4 : 0)); }
  genderName(v: string) { return v === 'Male' ? this.i18n.t('hr.male') : v === 'Female' ? this.i18n.t('hr.female') : v; }
}
