import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ErpContextService } from '../core/erp-context.service';
import { ErpService } from '../core/erp.service';
import { I18nService } from '../core/i18n.service';
import { ERP_MODULES, ErpKpi, ErpModule, ErpSeries, ErpSummary } from '../core/erp.models';
import { LayoutService } from '../core/layout.service';
import { TranslatePipe } from '../core/translate.pipe';
import { KpiCardComponent } from '../shared/erp-widgets';
import { errMsg } from '../hr/hr-util';

const ICONS: Record<string, string> = { m: 'wallet', p: 'trending-up', n: 'bar-chart' };
const COLORS = ['#4338ca', '#10b981', '#f59e0b', '#0ea5e9', '#8b5cf6', '#ef4444', '#64748b', '#14b8a6'];

/** One dashboard for every module: the server sends numbers (kpis) and breakdowns (lists); labels come from i18n keys `<module>.kpi.<k>` / `<module>.list.<k>`. */
@Component({
  selector: 'app-erp-overview',
  standalone: true,
  imports: [CommonModule, TranslatePipe, KpiCardComponent],
  template: `
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <ng-container *ngIf="s() as d">
      <div class="kpis" *ngIf="!layout.isHidden(module,'kpis')">
        <app-kpi *ngFor="let k of d.kpis; let i = index" [label]="(module + '.kpi.' + k.k) | translate" [value]="fmt(k)" [icon]="icon(k)" [color]="color(i, k)"></app-kpi>
      </div>
      <div class="grid g2" *ngIf="!layout.isHidden(module,'lists')">
        <div class="card" *ngFor="let l of d.lists"><div class="card-head"><h3>{{ (module + '.list.' + l.k) | translate }}</h3></div>
          <div class="card-body"><div class="row" *ngFor="let b of l.rows"><span class="n">{{ label(b.name) }}</span><div class="track"><div [style.width.%]="pct(b.value, l)"></div></div><b>{{ num(b.value) }}</b></div>
            <p class="dim" *ngIf="!l.rows.length">{{ 'common.noData' | translate }}</p></div></div>
      </div>
    </ng-container>
  `,
  styles: [`
    .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .g2 { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); align-items: start; }
    .row { display: grid; grid-template-columns: minmax(90px, 160px) 1fr 100px; align-items: center; gap: 10px; margin-bottom: 9px; font-size: 13px; }
    .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
    .track { height: 9px; background: var(--surface-3); border-radius: 5px; overflow: hidden; } .track div { height: 100%; background: var(--primary); border-radius: 5px; } b { text-align: end; font-variant-numeric: tabular-nums; }
  `]
})
export class ErpOverviewComponent {
  layout = inject(LayoutService); private erp = inject(ErpService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  module = inject(ActivatedRoute).snapshot.data['module'] as ErpModule;
  s = signal<ErpSummary | null>(null); error = '';
  constructor() {
    effect(() => { const c = this.ctx.company(); this.erp.summary(this.module, c).subscribe({ next: d => { this.s.set(d); this.error = ''; }, error: e => this.error = errMsg(e, this.i18n) }); });
  }
  icon(k: ErpKpi) { return ICONS[k.t] ?? 'bar-chart'; }
  color(i: number, k: ErpKpi) { return k.t === 'm' ? '#10b981' : k.t === 'p' ? '#0ea5e9' : COLORS[i % COLORS.length]; }
  num(v: number) { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (a / 1e3).toFixed(1) + 'K' : a.toLocaleString(undefined, { maximumFractionDigits: 2 }); return (v < 0 ? '-' : '') + s; }
  fmt(k: ErpKpi) { return k.t === 'm' ? this.num(k.v) + ' ' + this.ctx.companyObj().currency : k.t === 'p' ? k.v + '%' : this.num(k.v); }
  label(n: string) { const k = 'erp.st.' + n; const t = this.i18n.t(k); return t === k ? n : t; }
  pct(n: number, l: ErpSeries) { const m = Math.max(1, ...l.rows.map(x => Math.abs(x.value))); return Math.round(Math.abs(n) / m * 90 + (n ? 4 : 0)); }
}
