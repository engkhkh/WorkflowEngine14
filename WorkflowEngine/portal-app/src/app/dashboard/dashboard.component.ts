import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ErpDataService, ErpDoc } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { AuthService } from '../core/auth.service';
import { AssistantService } from '../core/assistant.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { DOC_TYPES, MODULES, StageKey } from '../core/erp.config';
import { IconComponent, LocalDatePipe, MoneyPipe, NumPipe } from '../shared/ui';
import { DocTableComponent, FlowComponent, HBarsComponent, KpiCardComponent, TrendChartComponent } from '../shared/erp-widgets';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, IconComponent, MoneyPipe, NumPipe, LocalDatePipe,
    KpiCardComponent, FlowComponent, TrendChartComponent, DocTableComponent, HBarsComponent],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>{{ 'dash.hello' | translate }}, {{ firstName() }}</h1>
        <p>{{ 'dash.sub' | translate }} · {{ i18n.nm(ctx.companyObj()) }}<span *ngIf="ctx.branchObj() as b"> · {{ i18n.nm(b) }}</span></p>
      </div>
      <button (click)="reload()" [disabled]="data.loading()"><app-icon name="refresh" [size]="15"></app-icon>{{ 'common.refresh' | translate }}</button>
    </div>

    <!-- KPI row -->
    <div class="kpis">
      <app-kpi [label]="'kpi.sales' | translate" [value]="(k().salesMonth | money:cur():true)" icon="trending-up" color="#0ea5e9"
               [hint]="('kpi.pipeline' | translate) + ': ' + (k().pipeline | money:cur():true)" [clickable]="true" routerLink="/m/sales"></app-kpi>
      <app-kpi [label]="'kpi.purchases' | translate" [value]="(k().purchasesMonth | money:cur():true)" icon="cart" color="#8b5cf6"
               [hint]="('kpi.committed' | translate) + ': ' + (k().committed | money:cur():true)" [clickable]="true" routerLink="/m/purchasing"></app-kpi>
      <app-kpi [label]="'kpi.receivables' | translate" [value]="(k().receivables | money:cur():true)" icon="wallet" color="#10b981" [clickable]="true" routerLink="/m/finance"></app-kpi>
      <app-kpi [label]="'kpi.payables' | translate" [value]="(k().payables | money:cur():true)" icon="book" color="#f59e0b"
               [hint]="('kpi.expenses' | translate) + ': ' + (k().expensesMonth | money:cur():true)" [clickable]="true" routerLink="/m/finance"></app-kpi>
      <app-kpi [label]="'kpi.myApprovals' | translate" [value]="k().myApprovals" icon="check-square" color="#ef4444" [clickable]="true" routerLink="/approvals"></app-kpi>
      <app-kpi [label]="'kpi.cycle' | translate" [value]="(k().avgCycleDays | num:1) + ' ' + ('kpi.days' | translate)" icon="clock" color="#64748b"
               [hint]="('kpi.openDocs' | translate) + ': ' + k().openDocs + ' · ' + ('kpi.rejectRate' | translate) + ': ' + ((k().rejectRate * 100) | num) + '%'"></app-kpi>
    </div>

    <!-- End-to-end flow -->
    <section class="card">
      <div class="card-head">
        <h3>{{ 'dash.flow' | translate }} <div class="sub">{{ 'dash.flowSub' | translate }}</div></h3>
      </div>
      <div class="card-body">
        <app-flow [counts]="stageCounts()" [active]="stage()" [currency]="cur()" (pick)="pickStage($event)"></app-flow>
        <div class="stage-list" *ngIf="stage()">
          <app-doc-table [docs]="stageDocs()" [showBranch]="ctx.branch() === 'ALL'"></app-doc-table>
        </div>
      </div>
    </section>

    <div class="two">
      <section class="card">
        <div class="card-head"><h3>{{ 'dash.trend' | translate }}</h3></div>
        <div class="card-body">
          <app-trend-chart [points]="trend()" [labelA]="'module.sales' | translate" [labelB]="'chart.purchases' | translate" [currency]="cur()"></app-trend-chart>
        </div>
      </section>

      <section class="card insight">
        <div class="card-head"><app-icon name="sparkles" [size]="16"></app-icon><h3>{{ 'dash.insight' | translate }}</h3>
          <button class="sm" (click)="ai.open.set(true)">{{ 'nav.assistant' | translate }}</button></div>
        <div class="card-body">
          <p class="insight-text">{{ insight() }}</p>
          <h4 class="mini">{{ 'dash.byModule' | translate }}</h4>
          <app-hbars [rows]="byModule()"></app-hbars>
        </div>
      </section>
    </div>

    <div class="two">
      <section class="card">
        <div class="card-head"><h3>{{ 'dash.myQueue' | translate }}</h3><a routerLink="/approvals" class="sm-link">{{ 'dash.viewAll' | translate }}</a></div>
        <div class="queue">
          <a class="q" *ngFor="let t of data.tasks().slice(0, 6)" [routerLink]="['/approvals']" [queryParams]="{ task: t.id }">
            <span class="chip" [class.high]="t.priority === 'High' || t.priority === 'Urgent'">{{ t.priority || 'Normal' }}</span>
            <span class="q-main">
              <strong>{{ t.nodeName }}</strong>
              <small class="dim">{{ docFor(t.instanceId)?.number }} · {{ docFor(t.instanceId)?.party }}</small>
            </span>
            <span class="q-amt">{{ docFor(t.instanceId)?.total | money:(docFor(t.instanceId)?.currency || 'SAR') }}</span>
          </a>
          <div class="empty" *ngIf="!data.tasks().length">{{ 'tasks.none' | translate }}</div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>{{ 'dash.quick' | translate }}</h3></div>
        <div class="quick">
          <a class="qa" *ngFor="let dt of docTypes" [routerLink]="['/new', dt.key]">
            <span class="qa-ic" [style.color]="moduleColor(dt.module)" [style.background]="moduleColor(dt.module) + '1a'"><app-icon name="plus" [size]="16"></app-icon></span>
            <span><strong>{{ ('doc.' + dt.key) | translate }}</strong><small>{{ ('module.' + dt.module) | translate }}</small></span>
          </a>
          <a class="qa" routerLink="/services">
            <span class="qa-ic" style="color:#ec4899;background:#ec48991a"><app-icon name="send" [size]="16"></app-icon></span>
            <span><strong>{{ 'nav.services' | translate }}</strong><small>{{ 'module.hr' | translate }}</small></span>
          </a>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h3>{{ 'dash.recent' | translate }}</h3><a routerLink="/documents" [queryParams]="{ scope: 'all' }" class="sm-link">{{ 'dash.viewAll' | translate }}</a></div>
      <app-doc-table [docs]="data.docs().slice(0, 8)" [showBranch]="ctx.branch() === 'ALL'"></app-doc-table>
    </section>
  `,
  styles: [`
    .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 14px; margin-bottom: 18px; }
    section.card { margin-bottom: 18px; }
    .two { display: grid; grid-template-columns: 1.5fr 1fr; gap: 18px; }
    .two > .card { margin-bottom: 18px; }
    .stage-list { margin-top: 14px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
    .insight .card-head { color: var(--primary); }
    .insight-text { margin: 0 0 16px; font-size: 13.5px; line-height: 1.6; color: var(--text-2); background: var(--primary-soft); border-radius: 10px; padding: 12px 14px; }
    .mini { font-size: 12px; color: var(--text-dim); font-weight: 600; margin: 4px 0 6px; }
    .sm-link { font-size: 12.5px; font-weight: 600; }
    .queue { display: flex; flex-direction: column; }
    .q { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-bottom: 1px solid var(--border); color: var(--text); }
    .q:last-child { border-bottom: none; }
    .q:hover { background: var(--surface-2); }
    .q-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .q-main strong { font-size: 13px; }
    .q-main small { font-size: 11.5px; }
    .q-amt { font-weight: 600; font-variant-numeric: tabular-nums; font-size: 13px; }
    .quick { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 14px 18px 18px; }
    .qa { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; color: var(--text); }
    .qa:hover { border-color: var(--primary); background: var(--primary-soft); }
    .qa-ic { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; flex-shrink: 0; }
    .qa strong { display: block; font-size: 13px; }
    .qa small { font-size: 11.5px; color: var(--text-dim); }
    @media (max-width: 1000px) { .two { grid-template-columns: 1fr; } }
    @media (max-width: 520px) { .quick { grid-template-columns: 1fr; } }
  `]
})
export class DashboardComponent implements OnInit {
  get docTypes() { return DOC_TYPES.filter(d => this.auth.can(d.module + '.create')); }
  stage = signal<StageKey | null>(null);

  k = computed(() => this.data.kpis());
  cur = computed(() => this.ctx.companyObj().currency);
  stageCounts = computed(() => this.data.stageCounts());
  trend = computed(() => {
    this.data.docs(); // dependency
    return this.data.monthlyTrend(6).map(m => ({ label: m.label, a: m.sales, b: m.purchases }));
  });
  insight = computed(() => { this.data.docs(); this.i18n.lang(); return this.ai.summary(); });
  byModule = computed(() => {
    this.i18n.lang();
    const open = this.data.docs().filter(d => d.status === 'pending');
    return MODULES.map(m => ({ label: this.i18n.t('module.' + m.key), value: open.filter(d => d.module === m.key).length, color: m.color }))
      .filter(r => r.value > 0);
  });
  stageDocs = computed<ErpDoc[]>(() => {
    const s = this.stage();
    if (!s) return [];
    if (s === 'request') {
      const now = new Date();
      return this.data.docs().filter(d => d.date.getMonth() === now.getMonth() && d.date.getFullYear() === now.getFullYear()).slice(0, 10);
    }
    if (s === 'reporting') return this.data.docs().filter(d => d.status === 'approved').slice(0, 10);
    return this.data.docs().filter(d => d.status === 'pending' && d.stage === s).slice(0, 10);
  });

  constructor(public data: ErpDataService, public ctx: ErpContextService, private auth: AuthService,
              public ai: AssistantService, public i18n: I18nService, private router: Router) {}

  ngOnInit() { this.reload(); }
  reload() { this.data.refresh().subscribe(); }

  firstName() { return (this.auth.currentUser()?.displayName ?? '').split(' ')[0]; }
  pickStage(s: StageKey) { this.stage.set(this.stage() === s ? null : s); }
  docFor(instanceId: string) { return this.data.docById(instanceId); }
  moduleColor(m: string) { return MODULES.find(x => x.key === m)?.color ?? '#4338ca'; }
}
