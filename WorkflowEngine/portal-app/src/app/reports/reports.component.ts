import { Component, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ErpDataService, ErpDoc } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { MODULES, STAGES } from '../core/erp.config';
import { OrgService } from '../core/org.service';
import { IconComponent, MoneyPipe, NumPipe } from '../shared/ui';
import { HBarsComponent, TrendChartComponent } from '../shared/erp-widgets';

interface Row { key: string; label: string; count: number; value: number; pending: number; approved: number; rejected: number; avgDays: number; }

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent, MoneyPipe, NumPipe, HBarsComponent, TrendChartComponent],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>{{ 'rep.title' | translate }}</h1>
        <p>{{ 'rep.sub' | translate }}</p>
      </div>
      <button (click)="exportCsv()"><app-icon name="download" [size]="15"></app-icon>{{ 'rep.export' | translate }}</button>
    </div>

    <section class="card">
      <div class="card-head"><h3>{{ 'rep.byModule' | translate }}</h3></div>
      <ng-container *ngTemplateOutlet="tbl; context: { rows: byModule() }"></ng-container>
    </section>

    <div class="two">
      <section class="card">
        <div class="card-head"><h3>{{ 'dash.trend' | translate }}</h3></div>
        <div class="card-body"><app-trend-chart [points]="trend()" [labelA]="'module.sales' | translate" [labelB]="'chart.purchases' | translate" [currency]="cur()"></app-trend-chart></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>{{ 'rep.bottleneck' | translate }}</h3></div>
        <div class="card-body"><app-hbars [rows]="bottleneck()"></app-hbars></div>
      </section>
    </div>

    <div class="two">
      <section class="card">
        <div class="card-head"><h3>{{ 'rep.turnaround' | translate }}</h3></div>
        <div class="card-body"><app-hbars [rows]="turnaround()"></app-hbars></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>{{ 'rep.topParties' | translate }}</h3></div>
        <div class="card-body">
          <h4 class="mini">{{ 'party.customer' | translate }}</h4>
          <app-hbars [rows]="topCustomers()"></app-hbars>
          <h4 class="mini">{{ 'party.vendor' | translate }}</h4>
          <app-hbars [rows]="topVendors()"></app-hbars>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h3>{{ 'rep.byBranch' | translate }}</h3></div>
      <ng-container *ngTemplateOutlet="tbl; context: { rows: byBranch() }"></ng-container>
    </section>

    <ng-template #tbl let-rows="rows">
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th></th><th class="num">{{ 'col.count' | translate }}</th><th class="num">{{ 'filter.pending' | translate }}</th>
            <th class="num">{{ 'filter.approved' | translate }}</th><th class="num">{{ 'filter.rejected' | translate }}</th>
            <th class="num">{{ 'col.avgDays' | translate }}</th><th class="num">{{ 'col.value' | translate }}</th>
          </tr></thead>
          <tbody>
            <tr *ngFor="let r of rows"><td><strong>{{ r.label }}</strong></td><td class="num">{{ r.count }}</td><td class="num">{{ r.pending }}</td>
              <td class="num ok">{{ r.approved }}</td><td class="num bad">{{ r.rejected }}</td><td class="num">{{ r.avgDays | num:1 }}</td><td class="num"><strong>{{ r.value | money:cur() }}</strong></td></tr>
          </tbody>
        </table>
        <div class="empty" *ngIf="!rows.length">{{ 'common.noData' | translate }}</div>
      </div>
    </ng-template>
  `,
  styles: [`
    section.card { margin-bottom: 18px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .mini { font-size: 12px; color: var(--text-dim); font-weight: 600; margin: 4px 0 4px; }
    .ok { color: var(--ok); } .bad { color: var(--bad); }
    @media (max-width: 1000px) { .two { grid-template-columns: 1fr; } }
  `]
})
export class ReportsComponent implements OnInit {
  cur = computed(() => this.ctx.companyObj().currency);

  byModule = computed(() => { this.i18n.lang(); return MODULES.map(m => this.row(m.key, this.i18n.t('module.' + m.key), this.data.docs().filter(d => d.module === m.key))).filter(r => r.count); });
  byBranch = computed(() => {
    this.i18n.lang();
    const docs = this.data.docs();
    const rows = this.org.branchesOf(this.ctx.company())
      .map(b => this.row(b.code, this.i18n.nm(b), docs.filter(d => d.branch === b.code)));
    const none = docs.filter(d => !d.branch);
    if (none.length) rows.push(this.row('-', '—', none));
    return rows.filter(r => r.count);
  });
  trend = computed(() => { this.data.docs(); return this.data.monthlyTrend(6).map(m => ({ label: m.label, a: m.sales, b: m.purchases })); });
  bottleneck = computed(() => {
    this.i18n.lang();
    const open = this.data.docs().filter(d => d.status === 'pending');
    const m = new Map<string, number>();
    open.forEach(d => m.set(d.step, (m.get(d.step) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  });
  turnaround = computed(() => {
    this.data.docs(); this.i18n.lang();
    const hrs = this.i18n.t('rep.hours');
    return this.data.stepTurnaround().slice(0, 10).map(s => ({ label: `${s.step} (${s.count})`, value: s.avgHours, display: `${s.avgHours.toFixed(1)} ${hrs}`, color: s.avgHours > 24 ? 'var(--bad)' : s.avgHours > 8 ? 'var(--warn)' : 'var(--ok)' }));
  });
  topCustomers = computed(() => { this.data.docs(); return this.data.topParties(['SO']).map(p => ({ label: p.party, value: p.value, display: this.fmt(p.value), color: 'var(--chart-1)' })); });
  topVendors = computed(() => { this.data.docs(); return this.data.topParties(['PR', 'PV']).map(p => ({ label: p.party, value: p.value, display: this.fmt(p.value), color: 'var(--chart-2)' })); });

  constructor(public data: ErpDataService, private ctx: ErpContextService, private i18n: I18nService, private org: OrgService) {}

  ngOnInit() { this.data.refresh().subscribe(); }

  private fmt(v: number) {
    return new Intl.NumberFormat(this.i18n.locale, { style: 'currency', currency: this.cur(), notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }

  private row(key: string, label: string, docs: ErpDoc[]): Row {
    const done = docs.filter(d => d.status === 'approved');
    return {
      key, label, count: docs.length,
      value: docs.filter(d => d.status !== 'canceled' && d.status !== 'rejected').reduce((s, d) => s + (d.total ?? 0), 0),
      pending: docs.filter(d => d.status === 'pending').length,
      approved: done.length,
      rejected: docs.filter(d => d.status === 'rejected').length,
      avgDays: done.length ? done.reduce((s, d) => s + d.ageDays, 0) / done.length : 0,
    };
  }

  exportCsv() {
    const rows = [['Module', 'Count', 'InProgress', 'Completed', 'Rejected', 'AvgDays', 'Value']];
    this.byModule().forEach(r => rows.push([r.label, String(r.count), String(r.pending), String(r.approved), String(r.rejected), r.avgDays.toFixed(1), r.value.toFixed(2)]));
    rows.push([]);
    rows.push(['Branch', 'Count', 'InProgress', 'Completed', 'Rejected', 'AvgDays', 'Value']);
    this.byBranch().forEach(r => rows.push([r.label, String(r.count), String(r.pending), String(r.approved), String(r.rejected), r.avgDays.toFixed(1), r.value.toFixed(2)]));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `erp-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
