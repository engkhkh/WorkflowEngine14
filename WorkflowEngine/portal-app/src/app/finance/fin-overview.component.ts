import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { LayoutService } from '../core/layout.service';
import { FinCount, FinSummary } from '../core/fin.models';
import { TranslatePipe } from '../core/translate.pipe';
import { LocalDatePipe, NumPipe } from '../shared/ui';
import { KpiCardComponent } from '../shared/erp-widgets';
import { errMsg } from './fin-util';

/** CFO dashboard: profit, cash, receivables / payables ageing, budget use, spend by department, what is due. Needs finance.reports.view. */
@Component({
  selector: 'app-fin-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, NumPipe, LocalDatePipe, KpiCardComponent],
  template: `
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <ng-container *ngIf="s() as d">
      <div class="kpis" *ngIf="!layout.isHidden('finance','kpis')">
        <app-kpi [label]="'fin.ov.revenue' | translate" [value]="fmt(d.revenueYtd)" icon="trending-up" color="#10b981" [hint]="'fin.ov.ytd' | translate"></app-kpi>
        <app-kpi [label]="'fin.ov.expense' | translate" [value]="fmt(d.expenseYtd)" icon="cart" color="#f59e0b" [hint]="'fin.ov.ytd' | translate"></app-kpi>
        <app-kpi [label]="'fin.ov.profit' | translate" [value]="fmt(d.profitYtd)" icon="bar-chart" [color]="d.profitYtd >= 0 ? '#4338ca' : '#ef4444'" [hint]="'fin.ov.ytd' | translate"></app-kpi>
        <app-kpi [label]="'fin.ov.cash' | translate" [value]="fmt(d.cash)" icon="wallet" color="#0ea5e9"></app-kpi>
        <app-kpi [label]="'fin.ov.ar' | translate" [value]="fmt(d.arOutstanding)" icon="book" color="#8b5cf6" [hint]="('fin.ov.overdueN' | translate: { n: fmt(d.arOverdue) })" [clickable]="true" routerLink="/finance/receivables"></app-kpi>
        <app-kpi [label]="'fin.ov.ap' | translate" [value]="fmt(d.apOutstanding)" icon="layers" color="#ec4899" [hint]="('fin.ov.overdueN' | translate: { n: fmt(d.apOverdue) })" [clickable]="true" routerLink="/finance/payables"></app-kpi>
        <app-kpi [label]="'fin.ov.toApprove' | translate" [value]="d.journalsToApprove + d.invoicesToApprove" icon="check-square" color="#ef4444"
          [hint]="('fin.ov.approveSplit' | translate: { j: d.journalsToApprove, i: d.invoicesToApprove })"></app-kpi>
        <app-kpi [label]="'fin.ov.assets' | translate" [value]="fmt(d.assetCost - d.assetAccumulated)" icon="box" color="#64748b" [hint]="('fin.ov.assetN' | translate: { n: d.assetCount })"></app-kpi>
      </div>
      <p class="dim per" *ngIf="d.currentPeriod">{{ 'fin.ov.period' | translate }}: <b>{{ d.currentPeriod }}</b> · {{ 'fin.st.' + (d.currentPeriodStatus || 'Open') | translate }}</p>

      <div class="grid g2">
        <div class="card" *ngIf="!layout.isHidden('finance','pnl')"><div class="card-head"><h3>{{ 'fin.ov.pnl' | translate }}</h3>
          <span class="legend"><i class="a"></i>{{ 'fin.ov.revenue' | translate }} <i class="b"></i>{{ 'fin.ov.expense' | translate }}</span></div>
          <div class="card-body cols"><div class="c" *ngFor="let m of d.monthly"><div class="pair"><div class="f a" [style.height.%]="h(m.a, d)"></div><div class="f b" [style.height.%]="h(m.b, d)"></div></div><span class="l">{{ m.name.slice(5) }}</span></div></div></div>

        <div class="card" *ngIf="!layout.isHidden('finance','cash')"><div class="card-head"><h3>{{ 'fin.ov.cashBy' | translate }}</h3></div>
          <div class="card-body"><ng-container [ngTemplateOutlet]="bars" [ngTemplateOutletContext]="{ list: d.cashByAccount, money: true }"></ng-container></div></div>

        <div class="card" *ngIf="!layout.isHidden('finance','arAging')"><div class="card-head"><h3>{{ 'fin.ov.arAging' | translate }}</h3></div>
          <div class="card-body"><ng-container [ngTemplateOutlet]="bars" [ngTemplateOutletContext]="{ list: d.arAging, money: true, aging: true }"></ng-container></div></div>

        <div class="card" *ngIf="!layout.isHidden('finance','apAging')"><div class="card-head"><h3>{{ 'fin.ov.apAging' | translate }}</h3></div>
          <div class="card-body"><ng-container [ngTemplateOutlet]="bars" [ngTemplateOutletContext]="{ list: d.apAging, money: true, aging: true }"></ng-container></div></div>

        <div class="card" *ngIf="!layout.isHidden('finance','budget')"><div class="card-head"><h3>{{ 'fin.ov.budget' | translate }}</h3>
          <span class="dim">{{ fmt(d.budgetActual) }} / {{ fmt(d.budgetTotal) }}</span></div>
          <div class="card-body">
            <div class="row" *ngFor="let b of d.budgetRows"><span class="n">{{ b.name }}</span>
              <div class="track"><div [style.width.%]="used(b.actual, b.budget)" [class.over]="b.actual > b.budget"></div></div><b>{{ pctUsed(b.actual, b.budget) }}%</b></div>
            <p class="dim" *ngIf="!d.budgetRows.length">{{ 'common.noData' | translate }}</p></div></div>

        <div class="card" *ngIf="!layout.isHidden('finance','deptSpend')"><div class="card-head"><h3>{{ 'fin.ov.dept' | translate }}</h3></div>
          <div class="card-body"><ng-container [ngTemplateOutlet]="bars" [ngTemplateOutletContext]="{ list: d.deptSpend, money: true }"></ng-container></div></div>

        <div class="card wide" *ngIf="!layout.isHidden('finance','apDue')"><div class="card-head"><h3>{{ 'fin.ov.apDue' | translate }}</h3></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>{{ 'fin.f.number' | translate }}</th><th>{{ 'fin.f.vendor' | translate }}</th><th>{{ 'fin.f.dueDate' | translate }}</th><th class="num">{{ 'fin.f.amount' | translate }}</th></tr></thead>
            <tbody><tr *ngFor="let r of d.apDue"><td class="mono">{{ r.code }}</td><td>{{ r.party }}</td><td [class.neg]="r.overdue">{{ r.dueDate | ldate }}</td><td class="num">{{ r.amount | num: 2 }}</td></tr></tbody></table>
            <div class="empty" *ngIf="!d.apDue.length">{{ 'common.noData' | translate }}</div></div></div>
      </div>
    </ng-container>

    <ng-template #bars let-list="list" let-money="money" let-aging="aging">
      <div class="row" *ngFor="let b of list"><span class="n">{{ aging ? (('fin.aging.' + b.name) | translate) : b.name }}</span>
        <div class="track"><div [style.width.%]="pct(b.value, list)"></div></div><b>{{ money ? fmt(b.value) : b.value }}</b></div>
      <p class="dim" *ngIf="!list.length">{{ 'common.noData' | translate }}</p>
    </ng-template>
  `,
  styles: [`
    .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; margin-bottom: 12px; } .per { margin: 0 0 14px; font-size: 13px; }
    .g2 { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); align-items: start; } .wide { grid-column: 1 / -1; } .neg { color: var(--bad); }
    .row { display: grid; grid-template-columns: minmax(90px, 150px) 1fr 80px; align-items: center; gap: 10px; margin-bottom: 9px; font-size: 13px; }
    .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
    .track { height: 9px; background: var(--surface-3); border-radius: 5px; overflow: hidden; } .track div { height: 100%; background: var(--primary); border-radius: 5px; } .track div.over { background: var(--bad); }
    b { text-align: end; font-variant-numeric: tabular-nums; }
    .cols { display: flex; gap: 6px; align-items: flex-end; height: 190px; padding-top: 14px; }
    .c { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 3px; }
    .pair { display: flex; gap: 2px; align-items: flex-end; width: 100%; height: 100%; } .f { flex: 1; border-radius: 3px 3px 0 0; min-height: 2px; } .f.a { background: #10b981; } .f.b { background: #f59e0b; }
    .l { font-size: 10.5px; color: var(--text-dim); } .legend { font-size: 12px; color: var(--text-dim); display: flex; gap: 6px; align-items: center; }
    .legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; } .legend i.a { background: #10b981; } .legend i.b { background: #f59e0b; margin-inline-start: 8px; }
  `]
})
export class FinOverviewComponent implements OnInit {
  layout = inject(LayoutService); private fin = inject(FinService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  s = signal<FinSummary | null>(null);
  error = '';
  ngOnInit() { this.fin.summary(this.ctx.company()).subscribe({ next: d => this.s.set(d), error: e => this.error = errMsg(e, this.i18n) }); }

  fmt(n: number) {
    const v = Number(n) || 0, a = Math.abs(v);
    const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (a / 1e3).toFixed(1) + 'K' : a.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return (v < 0 ? '-' : '') + s + ' ' + this.ctx.companyObj().currency;
  }
  pct(n: number, list: FinCount[]) { const m = Math.max(1, ...list.map(x => Math.abs(x.value))); return Math.round(Math.abs(n) / m * 90 + (n ? 4 : 0)); }
  h(n: number, d: FinSummary) { const m = Math.max(1, ...d.monthly.map(x => Math.max(x.a, x.b))); return Math.round(n / m * 100); }
  pctUsed(a: number, b: number) { return b > 0 ? Math.round(a / b * 100) : 0; }
  used(a: number, b: number) { return Math.min(100, this.pctUsed(a, b)); }
}
