import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ErpDataService, ErpDoc, DocStatus } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { PortalApiService } from '../core/portal-api.service';
import { AuthService } from '../core/auth.service';
import { DOC_TYPES, MODULES, ModuleKey, StageKey, moduleForWorkflowName } from '../core/erp.config';
import { IconComponent, LocalDatePipe, MoneyPipe, NumPipe } from '../shared/ui';
import { DocTableComponent, FlowComponent, KpiCardComponent } from '../shared/erp-widgets';

@Component({
  selector: 'app-module',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, IconComponent, MoneyPipe, NumPipe, LocalDatePipe, KpiCardComponent, FlowComponent, DocTableComponent],
  template: `
    <div class="crumb"><a routerLink="/dashboard">{{ 'nav.dashboard' | translate }}</a><span>/</span><span>{{ 'nav.modules' | translate }}</span></div>
    <div class="page-head">
      <div class="mod-ic" [style.color]="mod().color" [style.background]="mod().color + '1a'"><app-icon [name]="mod().icon" [size]="22"></app-icon></div>
      <div class="titles">
        <h1>{{ ('module.' + key()) | translate }}</h1>
        <p>{{ ('module.' + key() + '.desc') | translate }}</p>
      </div>
      <a class="btn primary" *ngFor="let dt of moduleDocTypes()" [routerLink]="['/new', dt.key]">
        <app-icon name="plus" [size]="15"></app-icon>{{ ('doc.' + dt.key) | translate }}
      </a>
      <a class="btn" *ngIf="!moduleDocTypes().length" routerLink="/services"><app-icon name="send" [size]="15"></app-icon>{{ 'nav.services' | translate }}</a>
    </div>

    <div class="kpis">
      <app-kpi *ngFor="let c of cards()" [label]="c.label" [value]="c.value" [icon]="c.icon" [color]="mod().color" [hint]="c.hint"></app-kpi>
    </div>

    <section class="card" *ngIf="moduleDocTypes().length">
      <div class="card-head"><h3>{{ 'dash.flow' | translate }}</h3></div>
      <div class="card-body">
        <app-flow [stages]="flowStages()" [counts]="stageCounts()" [active]="stage()" [currency]="cur()" (pick)="stage.set(stage() === $event ? null : $event)"></app-flow>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h3>{{ 'mod.documents' | translate }} <span class="sub">({{ shown().length }})</span></h3>
        <div class="seg">
          <button *ngFor="let f of filters" [class.on]="status() === f" (click)="status.set(f)">{{ ('filter.' + f) | translate }}</button>
        </div>
      </div>
      <app-doc-table [docs]="shown()" [showBranch]="ctx.branch() === 'ALL'"></app-doc-table>
    </section>

    <!-- Inventory: item movement -->
    <section class="card" *ngIf="key() === 'inventory' || key() === 'purchasing' || key() === 'sales'">
      <div class="card-head"><h3>{{ 'mod.stock' | translate }}</h3></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>{{ 'col.item' | translate }}</th><th class="num">{{ 'mod.in' | translate }}</th><th class="num">{{ 'mod.out' | translate }}</th><th class="num">{{ 'mod.net' | translate }}</th></tr></thead>
          <tbody>
            <tr *ngFor="let m of movement()"><td>{{ m.item }}</td><td class="num">{{ m.inQty | num }}</td><td class="num">{{ m.outQty | num }}</td>
              <td class="num" [class.neg]="m.inQty - m.outQty < 0"><strong>{{ (m.inQty - m.outQty) | num }}</strong></td></tr>
          </tbody>
        </table>
        <div class="empty" *ngIf="!movement().length">{{ 'common.noData' | translate }}</div>
      </div>
    </section>

    <!-- Finance: GL postings written by the workflows -->
    <section class="card" *ngIf="key() === 'finance'">
      <div class="card-head"><h3>{{ 'mod.ledger' | translate }}</h3></div>
      <div class="ledger">
        <div class="gl" *ngFor="let e of ledger()">
          <span class="dim">{{ e.date | ldate:'datetime' }}</span>
          <a [routerLink]="['/documents', e.doc.id]" class="mono">{{ e.doc.number }}</a>
          <span class="mono gl-text">{{ e.text }}</span>
        </div>
        <div class="empty" *ngIf="!ledger().length">{{ 'common.noData' | translate }}</div>
      </div>
    </section>

    <!-- Other (non-ERP) workflows that belong to this module -->
    <section class="card" *ngIf="otherFlows().length">
      <div class="card-head"><h3>{{ 'mod.otherFlows' | translate }}</h3></div>
      <div class="flows">
        <a class="flow-card" *ngFor="let f of otherFlows()" routerLink="/services" [queryParams]="{ start: f.id }">
          <strong>{{ f.name }}</strong><small>{{ f.description }}</small>
        </a>
      </div>
    </section>
  `,
  styles: [`
    .mod-ic { width: 48px; height: 48px; border-radius: 13px; display: grid; place-items: center; align-self: center; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(205px, 1fr)); gap: 14px; margin-bottom: 18px; }
    section.card { margin-bottom: 18px; }
    .neg { color: var(--bad); }
    .ledger { max-height: 360px; overflow-y: auto; }
    .gl { display: grid; grid-template-columns: 170px 130px 1fr; gap: 12px; padding: 10px 18px; border-bottom: 1px solid var(--border); font-size: 12.5px; align-items: baseline; }
    .gl-text { color: var(--text-2); direction: ltr; text-align: start; }
    .flows { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; padding: 16px 18px; }
    .flow-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; color: var(--text); display: flex; flex-direction: column; gap: 4px; }
    .flow-card:hover { border-color: var(--primary); background: var(--primary-soft); }
    .flow-card small { color: var(--text-dim); font-size: 12px; line-height: 1.45; }
    @media (max-width: 700px) { .gl { grid-template-columns: 1fr; gap: 2px; } }
  `]
})
export class ModuleComponent implements OnInit, OnDestroy {
  filters: ('all' | DocStatus)[] = ['all', 'pending', 'approved', 'rejected', 'canceled'];
  key = signal<ModuleKey>('sales');
  status = signal<'all' | DocStatus>('all');
  stage = signal<StageKey | null>(null);
  private sub?: Subscription;

  mod = computed(() => MODULES.find(m => m.key === this.key()) ?? MODULES[0]);
  cur = computed(() => this.ctx.companyObj().currency);
  moduleDocTypes = computed(() => DOC_TYPES.filter(d => d.module === this.key() && this.auth.can(d.module + '.create')));
  moduleDocs = computed<ErpDoc[]>(() => this.data.docs().filter(d => d.module === this.key()));
  flowStages = computed<StageKey[]>(() => {
    const set = new Set<StageKey>();
    this.moduleDocTypes().forEach(dt => dt.stages.forEach(s => set.add(s)));
    return ['request', 'approval', 'purchase', 'inventory', 'accounting', 'reporting'].filter(s => set.has(s as StageKey)) as StageKey[];
  });
  stageCounts = computed(() => this.data.stageCounts(this.moduleDocs()));
  shown = computed(() => {
    let list = this.moduleDocs();
    const st = this.status();
    if (st !== 'all') list = list.filter(d => d.status === st);
    const sg = this.stage();
    if (sg) list = sg === 'reporting' ? list.filter(d => d.status === 'approved') : list.filter(d => d.status === 'pending' && d.stage === sg);
    return list;
  });
  movement = computed(() => { this.data.docs(); return this.data.itemMovement(); });
  ledger = computed(() => { this.data.docs(); return this.data.ledgerEntries().slice(0, 50); });
  otherFlows = computed(() => {
    const erpNames = new Set(DOC_TYPES.map(d => d.workflowName));
    return this.data.definitions().filter(d => d.isPublished && !erpNames.has(d.name) && moduleForWorkflowName(d.name) === this.key());
  });

  cards = computed(() => {
    this.i18n.lang();
    const k = this.data.kpis();
    const docs = this.moduleDocs();
    const c = this.cur();
    const fmt = (v: number) => new Intl.NumberFormat(this.i18n.locale, { style: 'currency', currency: c, notation: 'compact', maximumFractionDigits: 1 }).format(v);
    const open = docs.filter(d => d.status === 'pending');
    const base = [
      { label: this.i18n.t('kpi.openDocs'), value: String(open.length), icon: 'file', hint: fmt(open.reduce((s, d) => s + (d.total ?? 0), 0)) },
      { label: this.i18n.t('kpi.completed'), value: String(docs.filter(d => d.status === 'approved' && d.completedAt && d.completedAt.getMonth() === new Date().getMonth()).length), icon: 'check', hint: '' },
    ];
    switch (this.key()) {
      case 'sales': return [{ label: this.i18n.t('kpi.sales'), value: fmt(k.salesMonth), icon: 'trending-up', hint: '' }, { label: this.i18n.t('kpi.pipeline'), value: fmt(k.pipeline), icon: 'clock', hint: '' }, { label: this.i18n.t('kpi.receivables'), value: fmt(k.receivables), icon: 'wallet', hint: '' }, ...base];
      case 'purchasing': return [{ label: this.i18n.t('kpi.purchases'), value: fmt(k.purchasesMonth), icon: 'cart', hint: '' }, { label: this.i18n.t('kpi.committed'), value: fmt(k.committed), icon: 'clock', hint: '' }, { label: this.i18n.t('kpi.payables'), value: fmt(k.payables), icon: 'book', hint: '' }, ...base];
      case 'inventory': return [{ label: this.i18n.t('kpi.inTransit'), value: fmt(k.inTransit), icon: 'box', hint: '' }, ...base];
      case 'finance': return [{ label: this.i18n.t('kpi.expenses'), value: fmt(k.expensesMonth), icon: 'wallet', hint: '' }, { label: this.i18n.t('kpi.payables'), value: fmt(k.payables), icon: 'book', hint: '' }, { label: this.i18n.t('kpi.receivables'), value: fmt(k.receivables), icon: 'trending-up', hint: '' }, ...base];
      default: return base;
    }
  });

  constructor(private route: ActivatedRoute, public data: ErpDataService, public ctx: ErpContextService,
              public i18n: I18nService, private api: PortalApiService, private router: Router, private auth: AuthService) {}

  ngOnInit() {
    this.sub = this.route.paramMap.subscribe(p => {
      const m = p.get('module') as ModuleKey;
      if (!MODULES.some(x => x.key === m)) { this.router.navigate(['/dashboard']); return; }
      this.key.set(m);
      this.status.set('all');
      this.stage.set(null);
    });
    this.data.refresh().subscribe();
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }
}
