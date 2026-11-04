import { Component, EventEmitter, OnInit, Output, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { ErpService } from '../core/erp.service';
import { I18nService } from '../core/i18n.service';
import { PortalApiService } from '../core/portal-api.service';
import { FinService } from '../core/fin.service';
import { FinRec } from '../core/fin.models';
import { ERP_MODULES, ErpInsight, ErpModule, ErpRec, ErpSummary, WhStockRow, CRM_STAGES_DEFAULT } from '../core/erp.models';
import { STAGE_PROB } from '../core/erp.calc';
import { BudgetLine, budgetVsActual, postedLines } from '../core/fin.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { catchError, of } from 'rxjs';

const CSS = `.card { margin-bottom: 18px; } .h { margin: 0 0 10px; font-size: 14px; } .neg { color: var(--bad); } .dim { color: var(--text-2); }
  .bar { height: 7px; background: var(--surface-2, rgba(128,128,128,.18)); border-radius: 4px; overflow: hidden; } .bar i { display: block; height: 100%; background: var(--good, #16a34a); }
  .bar i.warn { background: #f59e0b; } .bar i.over { background: var(--bad); } .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; } .grow { flex: 1; }
  .pad { padding: 14px 16px; } code, pre { font-family: ui-monospace, monospace; font-size: 12px; } pre { background: var(--surface-2, rgba(128,128,128,.12)); padding: 10px 12px; border-radius: 8px; overflow: auto; direction: ltr; text-align: left; }`;

/** CRM pipeline board: open opportunities by stage; move between stages, close as won / lost (reason asked for lost). */
@Component({
  selector: 'app-crm-board', standalone: true, imports: [CommonModule, FormsModule, TranslatePipe, NumPipe],
  template: `
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="board">
      <div class="col" *ngFor="let s of stages()">
        <div class="ch"><b>{{ s }}</b><span class="dim">{{ byStage(s).length }} · {{ total(s) | num: 0 }}</span></div>
        <div class="oc" *ngFor="let o of byStage(s)">
          <div class="nm">{{ o.data['name'] }}</div>
          <div class="dim sm">{{ o.data['account'] }} · {{ (+o.data['amount'] || 0) | num: 0 }} · {{ o.data['probability'] }}%</div>
          <div class="acts" *ngIf="canManage">
            <button class="mini" (click)="move(o, -1)" [disabled]="idx(s) === 0">‹</button>
            <button class="mini" (click)="move(o, 1)" [disabled]="idx(s) === stages().length - 1">›</button>
            <button class="mini" (click)="won(o)">{{ 'crm.opp.won' | translate }}</button>
            <button class="mini bad" (click)="lost = o; reason = ''">{{ 'crm.opp.lost' | translate }}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-scrim" *ngIf="lost" (click)="lost = null"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'crm.opp.lost' | translate }} · {{ lost.code }}</h3></div>
      <div class="modal-body"><label class="lbl">{{ 'crm.opp.reason' | translate }}</label><input [(ngModel)]="reason" /></div>
      <div class="modal-foot"><button (click)="lost = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doLost()">{{ 'crm.opp.lost' | translate }}</button></div></div></div>`,
  styles: [CSS, `.board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(230px, 1fr); gap: 12px; overflow-x: auto; margin-bottom: 20px; } .col { background: var(--surface-2, rgba(128,128,128,.08)); border-radius: 10px; padding: 10px; min-height: 120px; }
    .ch { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; } .oc { background: var(--surface, #fff); border: 1px solid var(--border, rgba(128,128,128,.25)); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
    .nm { font-weight: 600; font-size: 13px; } .sm { font-size: 12px; } .acts { display: flex; gap: 4px; margin-top: 6px; } .mini { padding: 2px 8px; font-size: 12px; } .mini.bad { color: var(--bad); }`]
})
export class CrmBoardComponent implements OnInit {
  private erp = inject(ErpService); private ctx = inject(ErpContextService); private i18n = inject(I18nService); private auth = inject(AuthService);
  @Output() changed = new EventEmitter<void>();
  opps = signal<ErpRec[]>([]); error = ''; lost: ErpRec | null = null; reason = '';
  canManage = this.auth.can('crm.opps.manage');
  stages = computed(() => { const s = this.erp.ref('crm', 'setting', this.ctx.company()).find(x => x.code === 'defaults')?.data['stages']; const l = String(s || '').split(',').map((x: string) => x.trim()).filter(Boolean); return l.length ? l : CRM_STAGES_DEFAULT; });
  constructor() { effect(() => { this.erp.refresh('crm', 'setting', this.ctx.company()).subscribe(); this.load(); }); }
  ngOnInit() { }
  load() { this.erp.records('crm', 'opportunity', { company: this.ctx.company(), status: 'Open', take: 1000 }).subscribe({ next: l => this.opps.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  byStage = (s: string) => this.opps().filter(o => (o.data['stage'] || this.stages()[0]) === s);
  total = (s: string) => this.byStage(s).reduce((t, o) => t + (+o.data['amount'] || 0), 0);
  idx = (s: string) => this.stages().indexOf(s);
  move(o: ErpRec, d: number) {
    const i = this.idx(o.data['stage'] || this.stages()[0]) + d; const st = this.stages()[i]; if (!st) return;
    this.erp.update('crm', 'opportunity', o.id, { status: o.status, data: { ...o.data, stage: st, probability: STAGE_PROB[st] ?? o.data['probability'] } }).subscribe({ next: () => { this.load(); this.changed.emit(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  won(o: ErpRec) { this.erp.closeOpportunity(o.id, 'won').subscribe({ next: () => { this.load(); this.changed.emit(); }, error: e => this.error = errMsg(e, this.i18n) }); }
  doLost() { const o = this.lost!; this.erp.closeOpportunity(o.id, 'lost', this.reason).subscribe({ next: () => { this.lost = null; this.load(); this.changed.emit(); }, error: e => this.error = errMsg(e, this.i18n) }); }
}

/** Warehouse stock on hand by branch with value and reorder flag (stock itself lives in the POS stock ledger). */
@Component({
  selector: 'app-wh-stock', standalone: true, imports: [CommonModule, FormsModule, TranslatePipe, NumPipe],
  template: `
    <div class="row"><input class="search" [placeholder]="'common.search' | translate" [(ngModel)]="q" /><span class="grow"></span>
      <label><input type="checkbox" [(ngModel)]="low" /> {{ 'wh.lowOnly' | translate }}</label><b>{{ 'wh.stockValue' | translate }}: {{ value() | num: 2 }}</b></div>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>SKU</th><th>{{ 'erp.f.name' | translate }}</th><th>{{ 'erp.f.branch' | translate }}</th><th class="num">{{ 'erp.f.qty' | translate }}</th><th class="num">{{ 'wh.reorder' | translate }}</th><th class="num">{{ 'wh.unitCost' | translate }}</th><th class="num">{{ 'erp.f.total' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let r of rows()"><td class="mono">{{ r.sku }}</td><td>{{ r.name }}</td><td>{{ r.branch }}</td><td class="num" [class.neg]="r.reorder > 0 && r.qty <= r.reorder">{{ r.qty | num: 2 }}</td><td class="num">{{ r.reorder | num: 0 }}</td><td class="num">{{ r.cost | num: 2 }}</td><td class="num">{{ r.value | num: 2 }}</td></tr></tbody></table>
      <div class="empty" *ngIf="!rows().length">{{ 'common.noData' | translate }}</div></div></div>`,
  styles: [CSS]
})
export class WhStockComponent {
  private erp = inject(ErpService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  all = signal<WhStockRow[]>([]); q = ''; low = false; error = '';
  constructor() { effect(() => this.erp.whStock(this.ctx.company(), this.ctx.branch()).subscribe({ next: l => this.all.set(l), error: e => this.error = errMsg(e, this.i18n) })); }
  rows = () => this.all().filter(r => (!this.low || (r.reorder > 0 && r.qty <= r.reorder)) && (!this.q || (r.sku + r.name).toLowerCase().includes(this.q.toLowerCase())));
  value = () => this.rows().reduce((t, r) => t + r.value, 0);
}

/** Planning: budgets (published from approved plans) against the posted ledger. */
@Component({
  selector: 'app-epm-variance', standalone: true, imports: [CommonModule, TranslatePipe, NumPipe],
  template: `
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'fin.f.year' | translate }}</th><th>{{ 'fin.f.costCenter' | translate }}</th><th>{{ 'fin.f.account' | translate }}</th><th class="num">{{ 'fin.bud.budget' | translate }}</th><th class="num">{{ 'fin.bud.actual' | translate }}</th><th class="num">{{ 'epm.variance' | translate }}</th><th style="width:150px">{{ 'fin.bud.used' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let b of lines()"><td>{{ b.year }}</td><td>{{ b.costCenter || '—' }}</td><td>{{ b.account || '—' }}</td><td class="num">{{ b.budget | num: 2 }}</td><td class="num">{{ b.actual | num: 2 }}</td><td class="num" [class.neg]="b.remaining < 0">{{ b.remaining | num: 2 }}</td>
        <td><div class="bar"><i [style.width.%]="Math.min(100, b.usedPct)" [class.over]="b.usedPct > 100" [class.warn]="b.usedPct > 85 && b.usedPct <= 100"></i></div><small>{{ b.usedPct }}%</small></td></tr></tbody></table>
      <div class="empty" *ngIf="!lines().length">{{ 'epm.variance.none' | translate }}</div></div></div>`,
  styles: [CSS]
})
export class EpmVarianceComponent implements OnInit {
  private fin = inject(FinService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  Math = Math; budgets = signal<FinRec[]>([]); journals = signal<FinRec[]>([]); error = '';
  ngOnInit() {
    const c = this.ctx.company();
    this.fin.records('budget', c).pipe(catchError(() => of([] as FinRec[]))).subscribe(l => this.budgets.set(l));
    this.fin.records('journal', c, 'Posted').pipe(catchError(() => of([] as FinRec[]))).subscribe(l => this.journals.set(l));
    this.fin.loadRefs(['account'], c).subscribe({ error: e => this.error = errMsg(e, this.i18n) });
  }
  private accType = (code: string) => String(this.fin.ref('account').find(a => a.code === code)?.data?.['type'] ?? '');
  lines = computed<BudgetLine[]>(() => budgetVsActual(this.budgets(), postedLines(this.journals(), { company: this.ctx.company() }), this.accType));
}

/** Workflow / BPM monitor: running and finished instances of published workflows, with SLA flag from the process register. */
@Component({
  selector: 'app-bpm-monitor', standalone: true, imports: [CommonModule, TranslatePipe, NumPipe],
  template: `
    <div class="row"><b>{{ 'bpm.running' | translate }}: {{ count('Running') }}</b><span>{{ 'bpm.completed' | translate }}: {{ count('Completed') }}</span><span>{{ 'bpm.terminated' | translate }}: {{ count('Terminated') }}</span><span class="grow"></span>
      <select [value]="st()" (change)="st.set($any($event.target).value)"><option value="">{{ 'erp.allStatus' | translate }}</option><option>Running</option><option>Completed</option><option>Terminated</option></select></div>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'bpm.workflow' | translate }}</th><th>{{ 'erp.f.status' | translate }}</th><th>{{ 'bpm.startedBy' | translate }}</th><th>{{ 'bpm.started' | translate }}</th><th class="num">{{ 'bpm.ageH' | translate }}</th><th>{{ 'bpm.sla' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let i of rows()"><td>{{ i.definitionName }}</td><td>{{ i.status }}</td><td>{{ i.startedBy }}</td><td>{{ i.startedAt | date: 'short' }}</td><td class="num">{{ age(i) | num: 1 }}</td><td [class.neg]="late(i)">{{ late(i) ? ('bpm.breached' | translate) : '—' }}</td></tr></tbody></table>
      <div class="empty" *ngIf="!rows().length">{{ 'common.noData' | translate }}</div></div></div>`,
  styles: [CSS]
})
export class BpmMonitorComponent implements OnInit {
  private api = inject(PortalApiService); private erp = inject(ErpService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  all = signal<any[]>([]); st = signal(''); error = '';
  ngOnInit() {
    this.api.getInstances().subscribe({ next: l => this.all.set(l), error: e => this.error = errMsg(e, this.i18n) });
    this.erp.refresh('bpm', 'process', this.ctx.company()).subscribe();
  }
  rows = () => this.all().filter(i => !this.st() || i.status === this.st());
  count = (s: string) => this.all().filter(i => i.status === s).length;
  age = (i: any) => ((i.completedAt ? new Date(i.completedAt).getTime() : Date.now()) - new Date(i.startedAt).getTime()) / 3600000;
  late = (i: any) => { const p = this.erp.ref('bpm', 'process', this.ctx.company()).find(x => x.data['workflow'] === i.definitionId); const sla = +(p?.data['slaHours'] ?? 0); return !!sla && this.age(i) > sla; };
}

/** Integration: API keys. The secret is shown ONCE when created; only a hash is stored. */
@Component({
  selector: 'app-int-keys', standalone: true, imports: [CommonModule, FormsModule, TranslatePipe],
  template: `
    <div class="row"><span class="grow"></span><button class="primary" *ngIf="canManage" (click)="open = true; name = ''; scopes = {}">{{ 'int.key.new' | translate }}</button></div>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="card pad" *ngIf="secret"><b>{{ 'int.key.copy' | translate }}</b><pre>{{ secret }}</pre><button (click)="secret = ''">{{ 'common.close' | translate }}</button></div>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'erp.f.name' | translate }}</th><th>{{ 'int.key.prefix' | translate }}</th><th>{{ 'int.key.scopes' | translate }}</th><th>{{ 'erp.f.status' | translate }}</th><th></th></tr></thead>
      <tbody><tr *ngFor="let k of keys()"><td>{{ k.data['name'] }}</td><td class="mono">{{ k.data['prefix'] }}…</td><td>{{ k.data['scopes'] }}</td><td>{{ k.status }}</td>
        <td><button *ngIf="canManage && k.status === 'Active'" (click)="revoke(k)">{{ 'int.key.revoke' | translate }}</button></td></tr></tbody></table>
      <div class="empty" *ngIf="!keys().length">{{ 'common.noData' | translate }}</div></div></div>
    <div class="modal-scrim" *ngIf="open" (click)="open = false"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'int.key.new' | translate }}</h3></div>
      <div class="modal-body"><label class="lbl">{{ 'erp.f.name' | translate }}</label><input [(ngModel)]="name" />
        <label class="lbl">{{ 'int.key.scopes' | translate }}</label>
        <label *ngFor="let m of mods"><input type="checkbox" [(ngModel)]="scopes[m]" /> {{ ('module.' + m) | translate }} </label></div>
      <div class="modal-foot"><button (click)="open = false">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="create()">{{ 'int.key.new' | translate }}</button></div></div></div>`,
  styles: [CSS]
})
export class IntKeysComponent implements OnInit {
  private erp = inject(ErpService); private ctx = inject(ErpContextService); private i18n = inject(I18nService); private auth = inject(AuthService);
  canManage = this.auth.can('int.keys.manage'); keys = signal<ErpRec[]>([]); open = false; name = ''; scopes: Record<string, boolean> = {}; secret = ''; error = '';
  mods = (Object.keys(ERP_MODULES) as ErpModule[]).filter(m => m !== 'pay' && m !== 'int');
  ngOnInit() { this.load(); }
  load() { this.erp.records('int', 'apikey', { company: this.ctx.company() }).subscribe({ next: l => this.keys.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  create() {
    if (!this.name.trim()) { this.error = this.i18n.t('erp.required'); return; }
    this.erp.createKey(this.name.trim(), this.mods.filter(m => this.scopes[m])).subscribe({ next: r => { this.open = false; this.secret = r.key; this.error = ''; this.load(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  revoke(k: ErpRec) { this.erp.update('int', 'apikey', k.id, { status: 'Revoked', data: k.data }).subscribe({ next: () => this.load(), error: e => this.error = errMsg(e, this.i18n) }); }
}

/** Integration: how to call the public read-only API and which webhook events exist. */
@Component({
  selector: 'app-int-docs', standalone: true, imports: [CommonModule, TranslatePipe],
  template: `<div class="card pad"><h3 class="h">{{ 'int.docs.api' | translate }}</h3><p class="dim">{{ 'int.docs.apiText' | translate }}</p>
    <pre>GET {{ origin }}/api/integration/v1/{{ '{module}' }}/{{ '{kind}' }}?company=&amp;take=100
X-Api-Key: wfk_…</pre><p class="dim">{{ 'int.docs.modules' | translate }}: {{ mods }}</p></div>
    <div class="card pad"><h3 class="h">{{ 'int.docs.hooks' | translate }}</h3><p class="dim">{{ 'int.docs.hooksText' | translate }}</p>
    <pre>X-Signature: sha256=HMAC_SHA256(secret, body)</pre><ul><li *ngFor="let e of events"><code>{{ e }}</code></li></ul></div>`,
  styles: [CSS]
})
export class IntDocsComponent {
  origin = location.origin; mods = (Object.keys(ERP_MODULES) as string[]).filter(m => m !== 'pay' && m !== 'int').join(', ');
  events = ['workorder.completed', 'project.billed', 'lead.converted', 'opportunity.won', 'po.approved', 'po.received', 'payroll.posted', 'plan.published'];
}

/** BI: AI-style insights computed by rules on the live data - each opens the page it is about. */
@Component({
  selector: 'app-bi-insights', standalone: true, imports: [CommonModule, RouterLink, TranslatePipe, IconComponent],
  template: `
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="card pad" *ngFor="let i of list()" [class.w]="i.level === 'warn'" [class.b]="i.level === 'bad'">
      <div class="row" style="margin:0"><app-icon [name]="i.level === 'info' ? 'sparkles' : 'alert'" [size]="16"></app-icon><span class="grow">{{ text(i) }}</span>
        <a *ngIf="link(i)" [routerLink]="link(i)">{{ 'bi.open' | translate }}</a></div></div>
    <div class="empty" *ngIf="loaded && !list().length">{{ 'bi.noInsights' | translate }}</div>`,
  styles: [CSS, `.w { border-inline-start: 3px solid #f59e0b; } .b { border-inline-start: 3px solid var(--bad); }`]
})
export class BiInsightsComponent {
  private erp = inject(ErpService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  list = signal<ErpInsight[]>([]); error = ''; loaded = false;
  constructor() { effect(() => this.erp.insights(this.ctx.company()).subscribe({ next: l => { this.list.set(l); this.loaded = true; }, error: e => { this.error = errMsg(e, this.i18n); this.loaded = true; } })); }
  text(i: ErpInsight) { return this.i18n.t('bi.ins.' + i.code, { n: i.n, ref: i.ref ?? '' }); }
  link(i: ErpInsight) { const d = ERP_MODULES[i.module]; return d ? [d.route, 'overview'] : null; }
}

/** BI: simple report builder - pick module and record type, filter by status, search, export CSV. */
@Component({
  selector: 'app-bi-reports', standalone: true, imports: [CommonModule, FormsModule, TranslatePipe, NumPipe],
  template: `
    <div class="row">
      <select [(ngModel)]="mod" (ngModelChange)="kind = kinds()[0]">
        <option *ngFor="let m of mods" [value]="m">{{ ('module.' + m) | translate }}</option></select>
      <select [(ngModel)]="kind"><option *ngFor="let k of kinds()" [value]="k">{{ k }}</option></select>
      <input class="search" [placeholder]="'erp.f.status' | translate" [(ngModel)]="status" />
      <button class="primary" (click)="run()">{{ 'bi.run' | translate }}</button><button (click)="csv()" [disabled]="!rows().length">CSV</button></div>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th *ngFor="let c of cols()">{{ c }}</th></tr></thead>
      <tbody><tr *ngFor="let r of rows()"><td *ngFor="let c of cols()">{{ cell(r, c) }}</td></tr></tbody></table>
      <div class="empty" *ngIf="!rows().length">{{ 'common.noData' | translate }}</div></div></div>`,
  styles: [CSS]
})
export class BiReportsComponent {
  private erp = inject(ErpService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  mods = (Object.keys(ERP_MODULES) as ErpModule[]).filter(m => m !== 'pay' && m !== 'int' && m !== 'bi');
  KINDS: Record<string, string[]> = { mfg: ['bom', 'workorder', 'workcenter', 'inspection'], prj: ['project', 'task', 'timesheet', 'cost'], crm: ['lead', 'opportunity', 'account', 'quote'],
    proc: ['requisition', 'po', 'rfq', 'contract'], scm: ['forecast', 'shipment'], wh: ['pick', 'count'], ast: ['asset', 'workorder'], epm: ['plan', 'forecast'], bpm: ['process'] };
  mod: ErpModule = 'crm'; kind = 'lead'; status = ''; rows = signal<ErpRec[]>([]); error = '';
  kinds = () => this.KINDS[this.mod] ?? [];
  cols = () => { const s = new Set<string>(['code', 'status']); this.rows().slice(0, 50).forEach(r => Object.entries(r.data).forEach(([k, v]) => { if (typeof v !== 'object' && s.size < 9) s.add(k); })); return [...s]; };
  cell = (r: ErpRec, c: string) => c === 'code' ? r.code : c === 'status' ? r.status : r.data[c];
  run() { this.erp.records(this.mod, this.kind as any, { company: this.ctx.company(), status: this.status || undefined, take: 2000 }).subscribe({ next: l => { this.rows.set(l); this.error = ''; }, error: e => this.error = errMsg(e, this.i18n) }); }
  csv() {
    const cols = this.cols(); const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const txt = [cols.map(esc).join(','), ...this.rows().map(r => cols.map(c => esc(this.cell(r, c))).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv' })); a.download = `${this.mod}-${this.kind}.csv`; a.click();
  }
}
