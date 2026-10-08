import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { PosService } from '../core/pos.service';
import { PosSummary } from '../core/pos.models';
import { LayoutService } from '../core/layout.service';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';
import { KpiCardComponent } from '../shared/erp-widgets';
import { errMsg } from '../hr/hr-util';

/** Store manager dashboard: today's takings, 14-day trend, payment mix, best sellers, branches, low stock, cash variance. Needs pos.reports.view. */
@Component({
  selector: 'app-pos-overview',
  standalone: true,
  imports: [CommonModule, TranslatePipe, NumPipe, KpiCardComponent],
  template: `
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <ng-container *ngIf="s() as d">
      <div class="kpis" *ngIf="!layout.isHidden('pos','kpis')">
        <app-kpi [label]="'pos.ov.today' | translate" [value]="fmt(d.salesToday)" icon="trending-up" color="#10b981" [hint]="('pos.ov.tickets' | translate: { n: d.countToday })"></app-kpi>
        <app-kpi [label]="'pos.ov.basket' | translate" [value]="fmt(d.avgBasket)" icon="cart" color="#0ea5e9"></app-kpi>
        <app-kpi [label]="'pos.ov.returns' | translate" [value]="fmt(d.returnsToday)" icon="refresh" color="#f59e0b"></app-kpi>
        <app-kpi [label]="'pos.ov.period' | translate" [value]="fmt(d.salesPeriod)" icon="bar-chart" color="#4338ca" [hint]="('pos.ov.net' | translate: { n: fmt(d.salesPeriod - d.returnsPeriod) })"></app-kpi>
        <app-kpi [label]="'pos.ov.shifts' | translate" [value]="d.openShifts" icon="clock" color="#8b5cf6"></app-kpi>
        <app-kpi [label]="'pos.ov.variance' | translate" [value]="fmt(d.cashVariance)" icon="wallet" [color]="d.cashVariance === 0 ? '#64748b' : '#ef4444'"></app-kpi>
        <app-kpi [label]="'pos.ov.stockValue' | translate" [value]="fmt(d.stockValue)" icon="box" color="#64748b"></app-kpi>
      </div>
      <div class="grid g2">
        <div class="card" *ngIf="!layout.isHidden('pos','trend')"><div class="card-head"><h3>{{ 'pos.ov.trend' | translate }}</h3>
          <span class="legend"><i class="a"></i>{{ 'pos.rc.receipt' | translate }} <i class="b"></i>{{ 'pos.rc.return' | translate }}</span></div>
          <div class="card-body cols"><div class="c" *ngFor="let m of d.daily"><div class="pair"><div class="f a" [style.height.%]="h(m.a, d)"></div><div class="f b" [style.height.%]="h(m.b, d)"></div></div><span class="l">{{ m.name.slice(3) }}</span></div></div></div>
        <div class="card" *ngIf="!layout.isHidden('pos','payments')"><div class="card-head"><h3>{{ 'pos.ov.payments' | translate }}</h3></div>
          <div class="card-body"><div class="row" *ngFor="let b of d.payments"><span class="n">{{ 'pos.pay.' + b.name | translate }}</span><div class="track"><div [style.width.%]="pct(b.value, d.payments)"></div></div><b>{{ fmt(b.value) }}</b></div>
            <p class="dim" *ngIf="!d.payments.length">{{ 'common.noData' | translate }}</p></div></div>
        <div class="card" *ngIf="!layout.isHidden('pos','top')"><div class="card-head"><h3>{{ 'pos.ov.top' | translate }}</h3></div>
          <div class="card-body"><div class="row" *ngFor="let b of d.topProducts"><span class="n">{{ b.name }}</span><div class="track"><div [style.width.%]="pct(b.value, d.topProducts)"></div></div><b>{{ fmt(b.value) }}</b></div>
            <p class="dim" *ngIf="!d.topProducts.length">{{ 'common.noData' | translate }}</p></div></div>
        <div class="card" *ngIf="!layout.isHidden('pos','branches') && d.byBranch.length > 1"><div class="card-head"><h3>{{ 'pos.ov.byBranch' | translate }}</h3></div>
          <div class="card-body"><div class="row" *ngFor="let b of d.byBranch"><span class="n">{{ b.name || '—' }}</span><div class="track"><div [style.width.%]="pct(b.value, d.byBranch)"></div></div><b>{{ fmt(b.value) }}</b></div></div></div>
        <div class="card wide" *ngIf="!layout.isHidden('pos','low')"><div class="card-head"><h3>{{ 'pos.ov.low' | translate }}</h3></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>{{ 'pos.sku' | translate }}</th><th>{{ 'pos.name' | translate }}</th><th>{{ 'pos.branch' | translate }}</th><th class="num">{{ 'pos.stock.qty' | translate }}</th></tr></thead>
            <tbody><tr *ngFor="let r of d.lowStock"><td class="mono">{{ r.sku }}</td><td>{{ r.name }}</td><td>{{ r.branch || '—' }}</td><td class="num neg">{{ r.qty | num: 2 }}</td></tr></tbody></table>
            <div class="empty" *ngIf="!d.lowStock.length">{{ 'common.noData' | translate }}</div></div></div>
      </div>
    </ng-container>
  `,
  styles: [`
    .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .g2 { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); align-items: start; } .wide { grid-column: 1 / -1; } .neg { color: var(--bad); }
    .row { display: grid; grid-template-columns: minmax(90px, 150px) 1fr 90px; align-items: center; gap: 10px; margin-bottom: 9px; font-size: 13px; }
    .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
    .track { height: 9px; background: var(--surface-3); border-radius: 5px; overflow: hidden; } .track div { height: 100%; background: var(--primary); border-radius: 5px; } b { text-align: end; font-variant-numeric: tabular-nums; }
    .cols { display: flex; gap: 4px; align-items: flex-end; height: 190px; padding-top: 14px; } .c { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 3px; }
    .pair { display: flex; gap: 2px; align-items: flex-end; width: 100%; height: 100%; } .f { flex: 1; border-radius: 3px 3px 0 0; min-height: 2px; } .f.a { background: #10b981; } .f.b { background: #f59e0b; }
    .l { font-size: 10px; color: var(--text-dim); } .legend { font-size: 12px; color: var(--text-dim); display: flex; gap: 6px; align-items: center; }
    .legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; } .legend i.a { background: #10b981; } .legend i.b { background: #f59e0b; margin-inline-start: 8px; }
  `]
})
export class PosOverviewComponent {
  layout = inject(LayoutService); private pos = inject(PosService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  s = signal<PosSummary | null>(null); error = '';
  constructor() {
    effect(() => {
      const c = this.ctx.company(), b = this.ctx.branch();
      this.pos.summary(c, b).subscribe({ next: d => { this.s.set(d); this.error = ''; }, error: e => this.error = errMsg(e, this.i18n) });
    });
  }
  fmt(n: number) {
    const v = Number(n) || 0, a = Math.abs(v);
    const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (a / 1e3).toFixed(1) + 'K' : a.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return (v < 0 ? '-' : '') + s + ' ' + this.ctx.companyObj().currency;
  }
  pct(n: number, list: { value: number }[]) { const m = Math.max(1, ...list.map(x => Math.abs(x.value))); return Math.round(Math.abs(n) / m * 90 + (n ? 4 : 0)); }
  h(n: number, d: PosSummary) { const m = Math.max(1, ...d.daily.map(x => Math.max(x.a, x.b))); return Math.round(n / m * 100); }
}
