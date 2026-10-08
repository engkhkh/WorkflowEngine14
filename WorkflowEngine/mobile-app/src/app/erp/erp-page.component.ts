import { Component, OnInit, QueryList, ViewChildren, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { ErpService } from '../core/erp.service';
import { PortalApiService } from '../core/portal-api.service';
import { I18nService } from '../core/i18n.service';
import { ErpKind, ErpLookup, ErpModule, ErpRec, CRM_SOURCES_DEFAULT } from '../core/erp.models';
import { STAGE_PROB, quoteTotals, utilization } from '../core/erp.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { ErpAction, ErpCrudComponent, ErpField } from './erp-crud.component';
import { CrmBoardComponent } from './erp-extras.component';

interface Section {
  kind: ErpKind; title?: string; fields: ErpField[]; canManage: boolean; newLabel: string; emptyKey: string; statuses?: string[];
  actions?: ErpAction[]; editable?: (r: ErpRec) => boolean; scopeBranch?: boolean; filter?: (r: ErpRec) => boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const ACTIVE = ['Active', 'Inactive'];

/**
 * Every plain list page of Manufacturing, Projects and CRM (BOMs, work centres, quality, maintenance, projects, tasks, resources,
 * timesheets, costs, milestones, leads, accounts, contacts, activities, quotes, campaigns) is the same component with a different
 * field configuration - which page it is comes from the route. Privileges decide who can add / edit; the server re-checks.
 */
@Component({
  selector: 'app-erp-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, NumPipe, ErpCrudComponent, CrmBoardComponent],
  template: `
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <app-crm-board *ngIf="page === 'opportunities'" (changed)="reload()" />
    <ng-container *ngFor="let s of sections; let i = index">
      <h3 class="h" *ngIf="s.title" [class.top]="i > 0">{{ s.title | translate }}</h3>
      <app-erp-crud [module]="module" [kind]="s.kind" [company]="ctx.company()" [fields]="s.fields" [canManage]="s.canManage" [newLabel]="s.newLabel" [emptyKey]="s.emptyKey"
        [statusFilter]="s.statuses || []" [actions]="s.actions || []" [editable]="s.editable || always" [scopeBranch]="!!s.scopeBranch" [filter]="s.filter || always" [autoNew]="i === 0"
        (changed)="onChanged(s.kind, $event)" />
    </ng-container>

    <ng-container *ngIf="page === 'resources'">
      <h3 class="h top">{{ 'prj.res.util' | translate }}</h3>
      <div class="card"><div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'prj.f.employee' | translate }}</th><th class="num">{{ 'prj.res.alloc' | translate }}</th><th style="width:220px"></th></tr></thead>
        <tbody><tr *ngFor="let u of util()"><td>{{ u.name }}</td><td class="num" [class.neg]="u.pct > 100">{{ u.pct | num: 0 }}%</td>
          <td><div class="bar"><i [style.width.%]="min(u.pct)" [class.over]="u.pct > 100" [class.warn]="u.pct > 85 && u.pct <= 100"></i></div></td></tr></tbody></table>
        <div class="empty" *ngIf="!util().length">{{ 'common.noData' | translate }}</div></div></div>
    </ng-container>

    <div class="modal-scrim" *ngIf="recv" (click)="recv = null">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'proc.receive' | translate }} · {{ recv.rec.code }}</h3></div>
        <div class="modal-body"><table class="data"><thead><tr><th>{{ 'mfg.f.component' | translate }}</th><th class="num">{{ 'proc.ordered' | translate }}</th><th class="num">{{ 'proc.received' | translate }}</th><th style="width:130px">{{ 'proc.receiveNow' | translate }}</th></tr></thead>
          <tbody><tr *ngFor="let l of recv.lines"><td>{{ l.sku }}</td><td class="num">{{ l.ordered | num: 2 }}</td><td class="num">{{ l.received | num: 2 }}</td><td><input type="number" step="any" [(ngModel)]="l.qty" /></td></tr></tbody></table>
          <div><label class="lbl">{{ 'erp.f.notes' | translate }}</label><input [(ngModel)]="recv.note" /></div><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="recv = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doRecv()">{{ 'proc.receive' | translate }}</button></div>
      </div>
    </div>
    <div class="modal-scrim" *ngIf="toPo" (click)="toPo = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'proc.toPo' | translate }} · {{ toPo.rec.code }}</h3></div>
        <div class="modal-body"><label class="lbl">{{ 'proc.f.vendor' | translate }}</label>
          <select [(ngModel)]="toPo.vendor"><option value="">—</option><option *ngFor="let o of vendorOpts()" [value]="o.value">{{ o.label }}</option></select><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="toPo = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doToPo()">{{ 'proc.toPo' | translate }}</button></div>
      </div>
    </div>
    <div class="modal-scrim" *ngIf="astDone" (click)="astDone = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'mfg.wo.complete' | translate }} · {{ astDone.rec.code }}</h3></div>
        <div class="modal-body"><div class="form-grid"><div><label class="lbl">{{ 'mfg.f.mtCost' | translate }}</label><input type="number" step="0.01" [(ngModel)]="astDone.cost" /></div>
          <div><label class="lbl">{{ 'mfg.wo.hours' | translate }}</label><input type="number" step="0.01" [(ngModel)]="astDone.hours" /></div></div>
          <div><label class="lbl">{{ 'erp.f.notes' | translate }}</label><input [(ngModel)]="astDone.note" /></div><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="astDone = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doAstDone()">{{ 'mfg.wo.complete' | translate }}</button></div>
      </div>
    </div>

    <div class="modal-scrim" *ngIf="convert" (click)="convert = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'crm.convert' | translate }}</h3></div>
        <div class="modal-body"><p class="dim">{{ 'crm.convertHint' | translate }}</p>
          <label class="chk"><input type="checkbox" [(ngModel)]="convOpp" /> {{ 'crm.convertOpp' | translate }}</label>
          <div *ngIf="convOpp"><label class="lbl">{{ 'crm.f.amount' | translate }}</label><input type="number" step="0.01" [(ngModel)]="convAmount" /></div>
          <p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="convert = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doConvert()">{{ 'crm.convert' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .h { margin: 0 0 10px; font-size: 14px; } .top { margin-top: 24px; } .neg { color: var(--bad); } .chk { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; } .chk input { width: auto; }
    .bar { height: 7px; background: var(--surface-3); border-radius: 4px; overflow: hidden; } .bar i { display: block; height: 100%; background: var(--good, #16a34a); } .bar i.warn { background: #f59e0b; } .bar i.over { background: var(--bad); }
  `]
})
export class ErpPageComponent implements OnInit {
  auth = inject(AuthService); ctx = inject(ErpContextService); private erp = inject(ErpService); private api = inject(PortalApiService); private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  module = this.route.snapshot.data['module'] as ErpModule;
  page = this.route.snapshot.data['page'] as string;
  @ViewChildren(ErpCrudComponent) cruds!: QueryList<ErpCrudComponent>;
  always = () => true;

  users = signal<{ username: string; displayName: string }[]>([]);
  allocs = signal<ErpRec[]>([]);
  lk = signal<Record<string, ErpLookup[]>>({});
  defs = signal<{ value: string; label: string }[]>([]);
  planLines = signal<ErpRec[]>([]);
  recv: { rec: ErpRec; lines: { sku: string; ordered: number; received: number; qty: number }[]; note: string } | null = null;
  toPo: { rec: ErpRec; vendor: string } | null = null;
  astDone: { rec: ErpRec; cost: number; hours: number; note: string } | null = null;
  error = '';
  convert: ErpRec | null = null; convOpp = true; convAmount = 0;

  ngOnInit() {
    this.erp.users().subscribe(u => this.users.set(u));
    this.erp.loadItems(this.module, this.ctx.company()).subscribe();
    if (this.page === 'timesheets') this.erp.records('prj', 'allocation', { company: this.ctx.company() }).subscribe({ next: l => this.allocs.set(l), error: () => undefined });
    const co = this.ctx.company();
    const lk = (m: ErpModule, w: any) => this.erp.lookup(m, w, co).subscribe(l => this.lk.update(x => ({ ...x, [w]: l })));
    if (this.module === 'prj' || this.module === 'crm') lk(this.module, 'customers');
    if (this.module === 'proc') { lk('proc', 'vendors'); }
    if (this.module === 'scm') { lk('scm', 'vendors'); }
    if (this.module === 'pay') lk('pay', 'employees');
    if (this.module === 'epm') { lk('epm', 'costcenters'); lk('epm', 'accounts'); }
    if (this.module === 'bpm') this.api.getPublishedDefinitions().subscribe({ next: l => this.defs.set(l.map(d => ({ value: d.id, label: d.name }))), error: () => undefined });
    if (this.page === 'plans' && this.module === 'epm') this.erp.records('epm', 'line', { company: co, take: 5000 }).subscribe({ next: l => this.planLines.set(l), error: () => undefined });
    if (['ast', 'proc', 'scm', 'wh', 'epm', 'pay', 'bpm', 'crm'].includes(this.module)) this.erp.refresh(this.module, 'setting', co).subscribe();
  }
  onChanged(kind: ErpKind, l: ErpRec[]) { if (kind === 'allocation') this.allocs.set(l); }

  // ------------------------------------------------------------------ option helpers
  private st = (list: string[]) => () => list.map(s => ({ value: s, label: this.stl(s) }));
  stl = (s: string) => { const k = 'erp.st.' + s; const t = this.i18n.t(k); return t === k ? s : t; };
  private opts = (list: string[]) => () => list.map(s => ({ value: s, label: this.i18n.t('erp.o.' + s) === 'erp.o.' + s ? s : this.i18n.t('erp.o.' + s) }));
  private userOpts = () => this.users().map(u => ({ value: u.username, label: u.displayName || u.username }));
  private itemOpts = () => this.erp.items().map(i => ({ value: i.sku, label: `${i.sku} · ${i.name}` }));
  private projectOpts = () => this.erp.ref('prj', 'project', this.ctx.company()).map(p => ({ value: p.code ?? '', label: `${p.code} · ${p.data['name'] ?? ''}` }));
  private stages = (): string[] => { const v = this.erp.ref('crm', 'setting', this.ctx.company()).find(x => x.code === 'defaults')?.data['stages']; const l = String(v || '').split(',').map((x: string) => x.trim()).filter(Boolean); return l.length ? l : ['Qualified', 'Proposal', 'Negotiation']; };
  private accountOpts = () => this.erp.ref('crm', 'account', this.ctx.company()).map(p => ({ value: p.code ?? '', label: `${p.code} · ${p.data['name'] ?? ''}` }));
  private lkOpts = (w: string) => () => (this.lk()[w] ?? []).map(c => ({ value: c.code, label: c.name ? `${c.code} · ${c.name}` : c.code }));
  private customerOpts = this.lkOpts('customers');
  vendorOpts = this.lkOpts('vendors');
  private assetOpts = () => this.erp.ref('ast', 'asset', this.ctx.company()).map(a => ({ value: a.code ?? '', label: `${a.code} · ${a.data['name'] ?? ''}` }));
  private locOpts = () => this.erp.ref('wh', 'location', this.ctx.company()).map(a => ({ value: a.code ?? '', label: `${a.code} · ${a.data['name'] ?? ''}` }));
  private planOpts = () => this.erp.ref('epm', 'plan', this.ctx.company()).map(a => ({ value: a.code ?? '', label: `${a.code} · ${a.data['name'] ?? ''}` }));
  private elementOpts = () => this.erp.ref('pay', 'element', this.ctx.company()).map(a => ({ value: a.code ?? '', label: `${a.code} · ${a.data['name'] ?? ''}` }));
  private carrierOpts = () => this.erp.ref('scm', 'carrier', this.ctx.company()).map(a => ({ value: a.code ?? '', label: `${a.code} · ${a.data['name'] ?? ''}` }));
  private catOpts = () => { const c = this.erp.ref('ast', 'setting', this.ctx.company()).find(x => x.code === 'defaults')?.data['categories']; return String(c || 'Vehicle, Machinery, IT, Furniture, Building').split(',').map(x => x.trim()).filter(Boolean).map(x => ({ value: x, label: x })); };
  private wcOpts = () => this.erp.ref('mfg', 'workcenter', this.ctx.company()).map(w => ({ value: w.code ?? '', label: `${w.code} · ${w.data['name'] ?? ''}` }));
  private machineOpts = () => this.erp.ref('mfg', 'machine', this.ctx.company()).map(w => ({ value: w.code ?? '', label: `${w.code} · ${w.data['name'] ?? ''}` }));
  private woOpts = () => this.erp.ref('mfg', 'workorder', this.ctx.company()).map(w => ({ value: w.code ?? '', label: `${w.code} · ${w.data['sku'] ?? ''}` }));
  private oppOpts = () => this.erp.ref('crm', 'opportunity', this.ctx.company()).map(w => ({ value: w.code ?? '', label: `${w.code} · ${w.data['name'] ?? ''}` }));
  private sourceOpts = () => { const s = this.erp.ref('crm', 'setting', this.ctx.company()).find(x => x.code === 'defaults')?.data['sources']; return (typeof s === 'string' && s.trim() ? s.split(',').map(x => x.trim()).filter(Boolean) : CRM_SOURCES_DEFAULT).map(x => ({ value: x, label: x })); };
  private userName = (u: string) => this.users().find(x => x.username === u)?.displayName ?? u;

  private statusField = (list: string[], def: string): ErpField => ({ key: 'status', label: 'erp.f.status', type: 'status', table: true, def, options: this.st(list) });
  private can = (p: string) => this.auth.can(p);

  min = (n: number) => Math.min(100, n);
  util = computed(() => {
    const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10); const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const names = [...new Set(this.allocs().map(a => String(a.data['employee'] ?? '')).filter(Boolean))];
    return names.map(e => ({ name: this.userName(e), pct: utilization(this.allocs(), e, from, to) })).sort((a, b) => b.pct - a.pct);
  });

  reload() { this.cruds?.forEach(c => c.reload()); }
  private patch(r: ErpRec, status: string, extra: Record<string, any> = {}) {
    this.error = '';
    this.erp.update(this.module, r.kind, r.id, { status, data: { ...r.data, ...extra } }).subscribe({ next: () => this.reload(), error: e => this.error = errMsg(e, this.i18n) });
  }
  private act(r: ErpRec, path: string, body: any = {}) {
    this.error = '';
    this.erp.action(this.module, path, body).subscribe({ next: () => { this.reload(); if (this.module === 'proc') this.erp.refresh('proc', 'po', this.ctx.company()).subscribe(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  openRecv(r: ErpRec) {
    this.error = '';
    this.recv = { rec: r, note: '', lines: ((r.data['lines'] ?? []) as any[]).map(l => ({ sku: l.sku, ordered: Number(l.qty) || 0, received: Number(l.received) || 0, qty: Math.max(0, (Number(l.qty) || 0) - (Number(l.received) || 0)) })) };
  }
  doRecv() {
    const x = this.recv!; this.error = '';
    this.erp.action('proc', `pos/${x.rec.id}/receive`, { note: x.note, lines: x.lines.filter(l => l.qty > 0).map(l => ({ sku: l.sku, qty: Number(l.qty) })) }).subscribe({ next: () => { this.recv = null; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  doToPo() {
    const x = this.toPo!; this.error = '';
    this.erp.action('proc', `requisitions/${x.rec.id}/topo`, { vendor: x.vendor }).subscribe({ next: () => { this.toPo = null; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  doAstDone() {
    const x = this.astDone!; this.error = '';
    this.erp.action('ast', `aworkorders/${x.rec.id}/complete`, { cost: Number(x.cost) || 0, hours: Number(x.hours) || 0, note: x.note }).subscribe({ next: () => { this.astDone = null; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  printSlip(r: ErpRec) {
    const d = r.data; const cur = this.ctx.companyObj().currency; const f = (v: any) => (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const t = (k: string) => this.i18n.t(k);
    const rows = (l: any[]) => (l ?? []).map(x => `<tr><td>${x.name || x.code || ''}</td><td style="text-align:end">${f(x.amount)}</td></tr>`).join('');
    const w = window.open('', '_blank', 'width=720,height=900'); if (!w) return;
    w.document.write(`<html dir="${document.documentElement.dir || 'ltr'}"><head><title>${r.code}</title><style>body{font:14px system-ui;padding:32px}table{width:100%;border-collapse:collapse;margin:8px 0 18px}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:start}h2{margin:0}small{color:#666}</style></head><body>
      <h2>${this.i18n.nm(this.ctx.companyObj())}</h2><small>${t('pay.slip.title')} · ${d['period']}</small><p><b>${d['name']}</b> (${d['empNo']})</p>
      <table><tr><th>${t('pay.slip.earnings')}</th><th style="text-align:end">${cur}</th></tr><tr><td>${t('pay.slip.basic')}</td><td style="text-align:end">${f(d['basic'])}</td></tr>${rows(d['earnings'])}</table>
      <table><tr><th>${t('pay.slip.deductions')}</th><th style="text-align:end">${cur}</th></tr>${rows(d['deductions'])}</table>
      <table><tr><td>${t('pay.slip.gross')}</td><td style="text-align:end">${f(d['gross'])}</td></tr><tr><td>${t('pay.slip.totalDed')}</td><td style="text-align:end">${f(d['totalDeductions'])}</td></tr><tr><th>${t('pay.slip.net')}</th><th style="text-align:end">${f(d['net'])} ${cur}</th></tr></table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }
  doConvert() {
    const r = this.convert!; this.error = '';
    this.erp.convertLead(r.id, { createOpportunity: this.convOpp, amount: Number(this.convAmount) || 0 }).subscribe({ next: () => { this.convert = null; this.erp.refresh('crm', 'account', this.ctx.company()).subscribe(); this.reload(); }, error: e => this.error = errMsg(e, this.i18n) });
  }

  // ------------------------------------------------------------------ page definitions
  sections: Section[] = [];
  constructor() { this.sections = this.build(); }

  private build(): Section[] {
    const co = this.ctx.company();
    switch (`${this.module}/${this.page}`) {
      // ---------------------------------------------------------------- manufacturing
      case 'mfg/bom': return [{
        kind: 'bom', canManage: this.can('mfg.bom.manage'), newLabel: 'mfg.bom.new', emptyKey: 'mfg.bom.none', statuses: ACTIVE,
        fields: [
          { key: 'code', label: 'mfg.f.product', type: 'select', required: true, table: true, lockOnEdit: true, options: () => this.itemOpts() },
          { key: 'name', label: 'erp.f.name', table: true },
          { key: 'qty', label: 'mfg.f.outQty', type: 'number', def: 1, table: true, required: true, hint: 'mfg.f.outQtyHint' },
          { key: 'workCenter', label: 'mfg.f.workCenter', type: 'select', options: () => this.wcOpts(), table: true },
          { key: 'routingMinutes', label: 'mfg.f.routing', type: 'number', def: 0, hint: 'mfg.f.routingHint' },
          { key: 'components', label: 'mfg.f.components', calc: r => (r.data['lines'] ?? []).length, table: true, type: 'number' },
          this.statusField(ACTIVE, 'Active'),
          { key: 'lines', label: 'mfg.f.components', type: 'lines', cols: [
            { key: 'sku', label: 'mfg.f.component', type: 'select', options: () => this.itemOpts() },
            { key: 'qty', label: 'mfg.f.qtyPer', type: 'number', def: 1, width: '120px' },
            { key: 'scrapPct', label: 'mfg.f.scrapPct', type: 'number', def: 0, width: '110px' }] },
        ]
      }];
      case 'mfg/workcenters': return [
        { kind: 'workcenter', title: 'mfg.nav.workcenters', canManage: this.can('mfg.bom.manage'), newLabel: 'mfg.wc.new', emptyKey: 'common.noData', fields: [
          { key: 'code', label: 'erp.f.code', required: true, table: true, lockOnEdit: true }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'costPerHour', label: 'mfg.f.costHour', type: 'money', table: true, def: 0 }, { key: 'capacityHours', label: 'mfg.f.capacity', type: 'number', table: true, def: 8, hint: 'mfg.f.capacityHint' },
          this.statusField(ACTIVE, 'Active')] },
        { kind: 'machine', title: 'mfg.machines', canManage: this.can('mfg.bom.manage'), newLabel: 'mfg.machine.new', emptyKey: 'common.noData', fields: [
          { key: 'code', label: 'erp.f.code', required: true, table: true, lockOnEdit: true }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'workCenter', label: 'mfg.f.workCenter', type: 'select', table: true, options: () => this.wcOpts() }, { key: 'serial', label: 'mfg.f.serial' },
          { key: 'purchaseDate', label: 'mfg.f.purchased', type: 'date' }, { key: 'purchaseCost', label: 'mfg.f.purchaseCost', type: 'money' },
          this.statusField(['Active', 'Down', 'Inactive'], 'Active')] },
      ];
      case 'mfg/quality': return [{
        kind: 'inspection', canManage: this.can('mfg.quality.manage'), newLabel: 'mfg.qc.new', emptyKey: 'mfg.qc.none', statuses: ['Pending', 'Passed', 'Failed'],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' },
          { key: 'type', label: 'mfg.f.qcType', type: 'select', table: true, def: 'Final', options: this.opts(['Incoming', 'In-process', 'Final']) },
          { key: 'ref', label: 'mfg.f.workOrder', type: 'select', table: true, options: () => this.woOpts() },
          { key: 'sku', label: 'mfg.f.product', type: 'select', table: true, options: () => this.itemOpts() },
          { key: 'qty', label: 'erp.f.qty', type: 'number', def: 1 }, { key: 'sample', label: 'mfg.f.sample', type: 'number', def: 0 },
          { key: 'defects', label: 'mfg.f.defects', type: 'number', table: true, def: 0 }, { key: 'inspector', label: 'mfg.f.inspector', type: 'select', options: () => this.userOpts() },
          { key: 'date', label: 'erp.f.date', type: 'date', table: true, def: today },
          this.statusField(['Pending', 'Passed', 'Failed'], 'Pending'),
          { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'mfg/maintenance': return [{
        kind: 'maintenance', canManage: this.can('mfg.maintenance.manage'), newLabel: 'mfg.mt.new', emptyKey: 'mfg.mt.none', statuses: ['Open', 'InProgress', 'Done'],
        actions: [{ label: 'erp.done', show: r => r.status !== 'Done', run: r => this.patch(r, 'Done', { doneAt: today() }) }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' },
          { key: 'machine', label: 'mfg.f.machine', type: 'select', required: true, table: true, options: () => this.machineOpts() },
          { key: 'type', label: 'mfg.f.mtType', type: 'select', table: true, def: 'Preventive', options: this.opts(['Preventive', 'Corrective']) },
          { key: 'due', label: 'erp.f.due', type: 'date', table: true, def: today }, { key: 'technician', label: 'mfg.f.technician', type: 'select', options: () => this.userOpts() },
          { key: 'cost', label: 'mfg.f.mtCost', type: 'money', table: true, def: 0 }, { key: 'parts', label: 'mfg.f.parts' },
          this.statusField(['Open', 'InProgress', 'Done'], 'Open'), { key: 'description', label: 'erp.f.notes', type: 'textarea' }]
      }];

      // ---------------------------------------------------------------- projects
      case 'prj/projects': return [{
        kind: 'project', canManage: this.can('prj.manage'), newLabel: 'prj.new', emptyKey: 'prj.none', statuses: ['Planning', 'Active', 'OnHold', 'Completed', 'Cancelled'],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'customer', label: 'prj.f.customer', type: 'select', table: true, options: () => this.customerOpts() }, { key: 'manager', label: 'prj.f.manager', type: 'select', options: () => this.userOpts() },
          { key: 'start', label: 'erp.f.start', type: 'date', def: today }, { key: 'end', label: 'erp.f.end', type: 'date' },
          { key: 'billingModel', label: 'prj.f.billing', type: 'select', table: true, def: 'tm', options: () => ['tm', 'fixed', 'milestone'].map(v => ({ value: v, label: this.i18n.t('prj.bm.' + v) })) },
          { key: 'contractValue', label: 'prj.f.contract', type: 'money', def: 0 },
          { key: 'budget', label: 'prj.f.budget', type: 'money', table: true, calc: r => (r.data['lines'] ?? []).reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0) },
          this.statusField(['Planning', 'Active', 'OnHold', 'Completed', 'Cancelled'], 'Planning'),
          { key: 'lines', label: 'prj.f.budgetLines', type: 'lines', cols: [
            { key: 'category', label: 'prj.f.category', type: 'select', options: this.opts(['Labor', 'Material', 'Subcontractor', 'Equipment', 'Travel', 'Other']) },
            { key: 'amount', label: 'erp.f.amount', type: 'number', def: 0, width: '160px' }] },
          { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'prj/tasks': return [{
        kind: 'task', canManage: this.can('prj.tasks.manage'), newLabel: 'prj.task.new', emptyKey: 'common.noData', statuses: ['Todo', 'Doing', 'Done'],
        actions: [{ label: 'erp.done', show: r => r.status !== 'Done', run: r => this.patch(r, 'Done', { doneAt: today() }) }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'ref', label: 'prj.f.project', type: 'select', required: true, table: true, options: () => this.projectOpts() },
          { key: 'name', label: 'erp.f.name', required: true, table: true }, { key: 'assignee', label: 'prj.f.assignee', type: 'select', table: true, options: () => this.userOpts() },
          { key: 'start', label: 'erp.f.start', type: 'date' }, { key: 'due', label: 'erp.f.due', type: 'date', table: true }, { key: 'estimate', label: 'prj.f.estimate', type: 'number', def: 0 },
          this.statusField(['Todo', 'Doing', 'Done'], 'Todo'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'prj/resources': return [{
        kind: 'allocation', canManage: this.can('prj.resources.manage'), newLabel: 'prj.res.new', emptyKey: 'common.noData',
        fields: [
          { key: 'ref', label: 'prj.f.project', type: 'select', required: true, table: true, options: () => this.projectOpts() },
          { key: 'employee', label: 'prj.f.employee', type: 'select', required: true, table: true, options: () => this.userOpts() },
          { key: 'role', label: 'prj.f.role', table: true }, { key: 'pct', label: 'prj.res.alloc', type: 'number', table: true, def: 100, required: true, hint: 'prj.res.allocHint' },
          { key: 'from', label: 'erp.f.start', type: 'date', table: true, def: today }, { key: 'to', label: 'erp.f.end', type: 'date', table: true },
          { key: 'costRate', label: 'prj.f.costRate', type: 'money', def: 0, hint: 'prj.f.costRateHint' }, { key: 'billRate', label: 'prj.f.billRate', type: 'money', def: 0 },
          this.statusField(ACTIVE, 'Active')]
      }];
      case 'prj/timesheets': {
        const fill = (f: Record<string, any>) => {   // pick up the rates of the person's allocation on that project
          const a = this.allocs().find(x => x.ref === f['ref'] && x.data['employee'] === f['employee']);
          if (a) { f['costRate'] = a.data['costRate'] ?? f['costRate']; f['rate'] = a.data['billRate'] ?? f['rate']; }
        };
        const mine = (r: ErpRec) => r.createdBy === this.auth.currentUser()?.username;
        const approve = this.can('prj.time.approve');
        return [{
          kind: 'timesheet', canManage: this.can('prj.time.log') || approve, newLabel: 'prj.ts.new', emptyKey: 'common.noData', statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Billed'],
          editable: r => r.status !== 'Billed' && (r.status === 'Draft' || r.status === 'Rejected' ? (mine(r) || approve) : approve),
          actions: [
            { label: 'prj.ts.submit', show: r => (r.status === 'Draft' || r.status === 'Rejected') && (mine(r) || approve), run: r => this.patch(r, 'Submitted') },
            { label: 'prj.ts.approve', show: r => approve && r.status === 'Submitted', run: r => this.patch(r, 'Approved', { approvedBy: this.auth.currentUser()?.username }) },
            { label: 'prj.ts.reject', show: r => approve && r.status === 'Submitted', danger: true, run: r => this.patch(r, 'Rejected') },
          ],
          fields: [
            { key: 'date', label: 'erp.f.date', type: 'date', required: true, table: true, def: today },
            { key: 'ref', label: 'prj.f.project', type: 'select', required: true, table: true, options: () => this.projectOpts(), onChange: fill },
            { key: 'employee', label: 'prj.f.employee', type: 'select', required: true, table: true, def: () => this.auth.currentUser()?.username ?? '', options: () => this.userOpts(), onChange: fill },
            { key: 'task', label: 'prj.f.task' }, { key: 'hours', label: 'prj.f.hours', type: 'number', required: true, table: true, def: 8 },
            { key: 'billable', label: 'prj.f.billable', type: 'bool', table: true, def: true },
            { key: 'rate', label: 'prj.f.billRate', type: 'money', def: 0 }, { key: 'costRate', label: 'prj.f.costRate', type: 'money', def: 0 },
            this.statusField(['Draft', 'Submitted', 'Approved', 'Rejected', 'Billed'], 'Draft'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
        }];
      }
      case 'prj/costs': return [{
        kind: 'cost', canManage: this.can('prj.costs.manage'), newLabel: 'prj.cost.new', emptyKey: 'common.noData', statuses: ['Open', 'Billed'], editable: r => r.status !== 'Billed',
        fields: [
          { key: 'date', label: 'erp.f.date', type: 'date', required: true, table: true, def: today }, { key: 'ref', label: 'prj.f.project', type: 'select', required: true, table: true, options: () => this.projectOpts() },
          { key: 'type', label: 'prj.f.category', type: 'select', table: true, def: 'Material', options: this.opts(['Material', 'Subcontractor', 'Equipment', 'Travel', 'Other']) },
          { key: 'description', label: 'erp.f.description', table: true }, { key: 'vendor', label: 'prj.f.vendor' },
          { key: 'amount', label: 'erp.f.amount', type: 'money', required: true, table: true }, { key: 'billable', label: 'prj.f.billable', type: 'bool', table: true, def: true },
          { key: 'markupPct', label: 'prj.f.markup', type: 'number', def: 0 }, this.statusField(['Open', 'Billed'], 'Open')]
      }];
      case 'prj/milestones': return [{
        kind: 'milestone', canManage: this.can('prj.manage'), newLabel: 'prj.ms.new', emptyKey: 'common.noData', statuses: ['Pending', 'Achieved', 'Billed'], editable: r => r.status !== 'Billed',
        actions: [{ label: 'prj.ms.achieve', show: r => r.status === 'Pending', run: r => this.patch(r, 'Achieved', { achievedAt: today() }) }],
        fields: [
          { key: 'ref', label: 'prj.f.project', type: 'select', required: true, table: true, options: () => this.projectOpts() }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'due', label: 'erp.f.due', type: 'date', table: true }, { key: 'pct', label: 'prj.ms.pct', type: 'number', def: 0 }, { key: 'amount', label: 'erp.f.amount', type: 'money', required: true, table: true },
          this.statusField(['Pending', 'Achieved', 'Billed'], 'Pending')]
      }];

      // ---------------------------------------------------------------- CRM
      case 'crm/opportunities': return [{
        kind: 'opportunity', canManage: this.can('crm.opps.manage'), newLabel: 'crm.opp.new', emptyKey: 'common.noData', statuses: ['Open', 'Won', 'Lost'], editable: r => r.status === 'Open',
        actions: [
          { label: 'crm.opp.won', show: r => r.status === 'Open' && this.can('crm.opps.manage'), run: r => this.erp.closeOpportunity(r.id, 'won').subscribe({ next: () => this.reload(), error: e => this.error = errMsg(e, this.i18n) }) },
          { label: 'crm.opp.reopen', show: r => r.status !== 'Open' && this.can('crm.opps.manage'), run: r => this.erp.closeOpportunity(r.id, 'reopen').subscribe({ next: () => this.reload(), error: e => this.error = errMsg(e, this.i18n) }) }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'ref', label: 'crm.f.account', type: 'select', table: true, options: () => this.accountOpts() }, { key: 'amount', label: 'erp.f.amount', type: 'money', table: true, def: 0 },
          { key: 'stage', label: 'crm.f.stage', type: 'select', table: true, def: () => this.stages()[0], options: () => this.stages().map(x => ({ value: x, label: x })),
            onChange: f => { f['probability'] = STAGE_PROB[f['stage']] ?? f['probability']; } },
          { key: 'probability', label: 'crm.f.probability', type: 'number', def: 25 }, { key: 'closeDate', label: 'crm.f.closeDate', type: 'date', table: true },
          { key: 'owner', label: 'crm.f.owner', type: 'select', options: () => this.userOpts() }, this.statusField(['Open', 'Won', 'Lost'], 'Open'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'crm/leads': return [{
        kind: 'lead', canManage: this.can('crm.leads.manage'), newLabel: 'crm.lead.new', emptyKey: 'crm.lead.none', statuses: ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted'], editable: r => r.status !== 'Converted',
        actions: [{ label: 'crm.convert', show: r => r.status !== 'Converted' && this.can('crm.accounts.manage'), run: r => { this.convert = r; this.convOpp = true; this.convAmount = Number(r.data['value']) || 0; this.error = ''; } }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'company', label: 'crm.f.company', table: true }, { key: 'email', label: 'erp.f.email', table: true }, { key: 'phone', label: 'erp.f.phone' },
          { key: 'source', label: 'crm.f.source', type: 'select', table: true, options: () => this.sourceOpts() }, { key: 'industry', label: 'crm.f.industry' },
          { key: 'value', label: 'crm.f.estValue', type: 'money', def: 0 }, { key: 'owner', label: 'crm.f.owner', type: 'select', table: true, def: () => this.auth.currentUser()?.username ?? '', options: () => this.userOpts() },
          this.statusField(['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted'], 'New'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'crm/accounts': return [{
        kind: 'account', canManage: this.can('crm.accounts.manage'), newLabel: 'crm.acc.new', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'industry', label: 'crm.f.industry', table: true }, { key: 'phone', label: 'erp.f.phone', table: true }, { key: 'email', label: 'erp.f.email' }, { key: 'website', label: 'crm.f.website' },
          { key: 'city', label: 'crm.f.city' }, { key: 'address', label: 'erp.f.address' }, { key: 'owner', label: 'crm.f.owner', type: 'select', table: true, options: () => this.userOpts() },
          { key: 'taxNo', label: 'crm.f.taxNo' }, this.statusField(ACTIVE, 'Active'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'crm/contacts': return [{
        kind: 'contact', canManage: this.can('crm.accounts.manage'), newLabel: 'crm.ct.new', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'ref', label: 'crm.f.account', type: 'select', table: true, options: () => this.accountOpts() }, { key: 'title', label: 'crm.f.title', table: true },
          { key: 'email', label: 'erp.f.email', table: true }, { key: 'phone', label: 'erp.f.phone', table: true }, this.statusField(ACTIVE, 'Active')]
      }];
      case 'crm/activities': return [{
        kind: 'activity', canManage: this.can('crm.activities.manage'), newLabel: 'crm.act.new', emptyKey: 'common.noData', statuses: ['Open', 'Done'],
        actions: [{ label: 'erp.done', show: r => r.status !== 'Done', run: r => this.patch(r, 'Done', { doneAt: today() }) }],
        fields: [
          { key: 'type', label: 'crm.f.actType', type: 'select', table: true, def: 'Call', options: this.opts(['Call', 'Meeting', 'Email', 'Task']) }, { key: 'subject', label: 'crm.f.subject', required: true, table: true },
          { key: 'ref', label: 'crm.f.account', type: 'select', table: true, options: () => this.accountOpts() }, { key: 'opportunity', label: 'crm.f.opportunity', type: 'select', options: () => this.oppOpts() },
          { key: 'due', label: 'erp.f.due', type: 'date', table: true, def: today }, { key: 'owner', label: 'crm.f.owner', type: 'select', table: true, def: () => this.auth.currentUser()?.username ?? '', options: () => this.userOpts() },
          this.statusField(['Open', 'Done'], 'Open'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'crm/quotes': return [{
        kind: 'quote', canManage: this.can('crm.quotes.manage'), newLabel: 'crm.q.new', emptyKey: 'common.noData', statuses: ['Draft', 'Sent', 'Accepted', 'Rejected'],
        actions: [{ label: 'crm.q.send', show: r => r.status === 'Draft', run: r => this.patch(r, 'Sent') }, { label: 'crm.q.accept', show: r => r.status === 'Sent', run: r => this.patch(r, 'Accepted') }],
        editable: r => r.status === 'Draft' || r.status === 'Sent',
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'ref', label: 'crm.f.account', type: 'select', required: true, table: true, options: () => this.accountOpts() },
          { key: 'opportunity', label: 'crm.f.opportunity', type: 'select', options: () => this.oppOpts() }, { key: 'date', label: 'erp.f.date', type: 'date', table: true, def: today }, { key: 'validUntil', label: 'crm.q.valid', type: 'date' },
          { key: 'taxPct', label: 'crm.q.tax', type: 'number', def: 15 }, { key: 'discountPct', label: 'crm.q.discount', type: 'number', def: 0 },
          { key: 'total', label: 'erp.f.total', type: 'money', table: true, calc: r => quoteTotals(r.data['lines'] ?? [], Number(r.data['taxPct']) || 0, Number(r.data['discountPct']) || 0).total },
          this.statusField(['Draft', 'Sent', 'Accepted', 'Rejected'], 'Draft'),
          { key: 'lines', label: 'crm.q.lines', type: 'lines', cols: [
            { key: 'desc', label: 'erp.f.description' }, { key: 'qty', label: 'erp.f.qty', type: 'number', def: 1, width: '90px' },
            { key: 'price', label: 'erp.f.price', type: 'number', def: 0, width: '110px' }, { key: 'discountPct', label: 'crm.q.discount', type: 'number', def: 0, width: '90px' }] },
          { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'crm/campaigns': return [{
        kind: 'campaign', canManage: this.can('crm.campaigns.manage'), newLabel: 'crm.cmp.new', emptyKey: 'common.noData', statuses: ['Planned', 'Active', 'Completed'],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'type', label: 'crm.f.cmpType', type: 'select', table: true, options: this.opts(['Email', 'Event', 'Social', 'Print', 'Other']) }, { key: 'start', label: 'erp.f.start', type: 'date', table: true }, { key: 'end', label: 'erp.f.end', type: 'date' },
          { key: 'budget', label: 'prj.f.budget', type: 'money', table: true, def: 0 }, { key: 'spent', label: 'crm.f.spent', type: 'money', table: true, def: 0 },
          this.statusField(['Planned', 'Active', 'Completed'], 'Planned'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];

      // ---------------------------------------------------------------- procurement
      case 'proc/requisitions': {
        const approve = this.can('proc.req.approve');
        return [{
          kind: 'requisition', canManage: this.can('proc.req.manage'), newLabel: 'proc.req.new', emptyKey: 'common.noData', statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Ordered'], scopeBranch: true,
          editable: r => r.status === 'Draft' || r.status === 'Rejected',
          actions: [
            { label: 'prj.ts.submit', show: r => r.status === 'Draft' || r.status === 'Rejected', run: r => this.patch(r, 'Submitted') },
            { label: 'prj.ts.approve', show: r => approve && r.status === 'Submitted', run: r => this.patch(r, 'Approved', { approvedBy: this.auth.currentUser()?.username }) },
            { label: 'prj.ts.reject', danger: true, show: r => approve && r.status === 'Submitted', run: r => this.patch(r, 'Rejected') },
            { label: 'proc.toPo', show: r => r.status === 'Approved' && this.can('proc.po.manage'), run: r => { this.toPo = { rec: r, vendor: String(r.data['vendor'] ?? '') }; this.error = ''; } },
          ],
          fields: [
            { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' },
            { key: 'department', label: 'proc.f.department', table: true }, { key: 'needBy', label: 'proc.f.needBy', type: 'date', table: true },
            { key: 'vendor', label: 'proc.f.vendor', type: 'select', options: this.vendorOpts }, { key: 'requester', label: 'proc.f.requester', type: 'select', def: () => this.auth.currentUser()?.username ?? '', options: () => this.userOpts() },
            { key: 'items', label: 'proc.f.items', calc: r => (r.data['lines'] ?? []).length, type: 'number', table: true },
            this.statusField(['Draft', 'Submitted', 'Approved', 'Rejected', 'Ordered'], 'Draft'),
            { key: 'reason', label: 'proc.f.reason', type: 'textarea' },
            { key: 'lines', label: 'proc.f.items', type: 'lines', cols: [
              { key: 'sku', label: 'mfg.f.component', type: 'select', options: () => this.itemOpts() }, { key: 'desc', label: 'erp.f.description' },
              { key: 'qty', label: 'erp.f.qty', type: 'number', def: 1, width: '90px' }, { key: 'price', label: 'erp.f.price', type: 'number', def: 0, width: '110px' }] }]
        }];
      }
      case 'proc/orders': {
        const approve = this.can('proc.po.approve');
        return [{
          kind: 'po', canManage: this.can('proc.po.manage'), newLabel: 'proc.po.new', emptyKey: 'proc.po.none', statuses: ['Draft', 'Approved', 'Sent', 'PartiallyReceived', 'Received', 'Invoiced', 'Cancelled'], scopeBranch: true,
          editable: r => r.status === 'Draft',
          actions: [
            { label: 'prj.ts.approve', show: r => approve && r.status === 'Draft', run: r => this.act(r, `pos/${r.id}/approve`) },
            { label: 'proc.send', show: r => r.status === 'Approved' && this.can('proc.po.manage'), run: r => this.act(r, `pos/${r.id}/send`) },
            { label: 'proc.receive', show: r => ['Approved', 'Sent', 'PartiallyReceived'].includes(r.status ?? '') && this.can('proc.receive'), run: r => this.openRecv(r) },
            { label: 'proc.invoice', show: r => r.status === 'Received' && this.can('proc.invoice'), run: r => this.act(r, `pos/${r.id}/invoice`) },
            { label: 'mfg.wo.cancel', danger: true, show: r => ['Draft', 'Approved', 'Sent'].includes(r.status ?? '') && this.can('proc.po.manage'), run: r => this.act(r, `pos/${r.id}/cancel`) },
          ],
          fields: [
            { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' },
            { key: 'vendor', label: 'proc.f.vendor', type: 'select', required: true, table: true, options: this.vendorOpts },
            { key: 'date', label: 'erp.f.date', type: 'date', table: true, def: today }, { key: 'expected', label: 'proc.f.expected', type: 'date', table: true },
            { key: 'taxPct', label: 'crm.q.tax', type: 'number', def: 15 },
            { key: 'total', label: 'erp.f.total', type: 'money', table: true, calc: r => r.data['total'] ?? '' },
            this.statusField(['Draft', 'Approved', 'Sent', 'PartiallyReceived', 'Received', 'Invoiced', 'Cancelled'], 'Draft'),
            { key: 'notes', label: 'erp.f.notes', type: 'textarea' },
            { key: 'lines', label: 'proc.f.items', type: 'lines', cols: [
              { key: 'sku', label: 'mfg.f.component', type: 'select', options: () => this.itemOpts() }, { key: 'desc', label: 'erp.f.description' },
              { key: 'qty', label: 'erp.f.qty', type: 'number', def: 1, width: '90px' }, { key: 'price', label: 'erp.f.price', type: 'number', def: 0, width: '110px' }, { key: 'discountPct', label: 'crm.q.discount', type: 'number', def: 0, width: '90px' }] }]
        }];
      }
      case 'proc/rfq': return [{
        kind: 'rfq', canManage: this.can('proc.rfq.manage'), newLabel: 'proc.rfq.new', emptyKey: 'common.noData', statuses: ['Draft', 'Sent', 'Awarded', 'Closed'],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'title', label: 'erp.f.name', required: true, table: true },
          { key: 'due', label: 'erp.f.due', type: 'date', table: true }, { key: 'awarded', label: 'proc.rfq.awarded', type: 'select', table: true, options: this.vendorOpts },
          this.statusField(['Draft', 'Sent', 'Awarded', 'Closed'], 'Draft'),
          { key: 'lines', label: 'proc.f.items', type: 'lines', cols: [{ key: 'sku', label: 'mfg.f.component', type: 'select', options: () => this.itemOpts() }, { key: 'qty', label: 'erp.f.qty', type: 'number', def: 1, width: '90px' }, { key: 'target', label: 'proc.rfq.target', type: 'number', def: 0, width: '110px' }] },
          { key: 'quotes', label: 'proc.rfq.quotes', type: 'lines', cols: [{ key: 'vendor', label: 'proc.f.vendor', type: 'select', options: this.vendorOpts }, { key: 'amount', label: 'erp.f.amount', type: 'number', def: 0, width: '130px' }, { key: 'leadDays', label: 'proc.rfq.lead', type: 'number', def: 0, width: '90px' }, { key: 'note', label: 'erp.f.notes' }] },
          { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'proc/contracts': return [{
        kind: 'contract', canManage: this.can('proc.contracts.manage'), newLabel: 'proc.con.new', emptyKey: 'common.noData', statuses: ['Active', 'Expired', 'Terminated'],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'title', label: 'erp.f.name', required: true, table: true },
          { key: 'vendor', label: 'proc.f.vendor', type: 'select', required: true, table: true, options: this.vendorOpts }, { key: 'start', label: 'erp.f.start', type: 'date', table: true }, { key: 'end', label: 'erp.f.end', type: 'date', table: true },
          { key: 'value', label: 'erp.f.amount', type: 'money', table: true, def: 0 }, this.statusField(['Active', 'Expired', 'Terminated'], 'Active'), { key: 'terms', label: 'proc.con.terms', type: 'textarea' }]
      }];
      case 'proc/evaluations': return [{
        kind: 'evaluation', canManage: this.can('proc.suppliers.manage'), newLabel: 'proc.ev.new', emptyKey: 'common.noData',
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'vendor', label: 'proc.f.vendor', type: 'select', required: true, table: true, options: this.vendorOpts },
          { key: 'period', label: 'proc.ev.period', table: true, def: () => new Date().toISOString().slice(0, 7) },
          { key: 'quality', label: 'proc.ev.quality', type: 'number', def: 80 }, { key: 'delivery', label: 'proc.ev.delivery', type: 'number', def: 80 }, { key: 'price', label: 'proc.ev.price', type: 'number', def: 80 }, { key: 'service', label: 'proc.ev.service', type: 'number', def: 80 },
          { key: 'overall', label: 'proc.ev.overall', type: 'number', table: true, calc: r => Math.round(((Number(r.data['quality']) || 0) + (Number(r.data['delivery']) || 0) + (Number(r.data['price']) || 0) + (Number(r.data['service']) || 0)) / 4) },
          { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];

      // ---------------------------------------------------------------- supply chain
      case 'scm/forecast': return [{
        kind: 'forecast', canManage: this.can('scm.planning'), newLabel: 'scm.fc.new', emptyKey: 'common.noData', statuses: ['Active', 'Cancelled'],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'sku', label: 'mfg.f.product', type: 'select', required: true, table: true, options: () => this.itemOpts() },
          { key: 'period', label: 'proc.ev.period', required: true, table: true, def: () => new Date().toISOString().slice(0, 7) }, { key: 'qty', label: 'erp.f.qty', type: 'number', required: true, table: true },
          { key: 'method', label: 'scm.fc.method', type: 'select', table: true, def: 'Manual', options: this.opts(['Manual', 'MovingAverage', 'Seasonal']) }, this.statusField(['Active', 'Cancelled'], 'Active'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'scm/shipments': return [{
        kind: 'shipment', canManage: this.can('scm.shipments.manage'), newLabel: 'scm.sh.new', emptyKey: 'common.noData', statuses: ['Planned', 'Dispatched', 'InTransit', 'Delayed', 'Delivered', 'Cancelled'],
        actions: [{ label: 'scm.sh.deliver', show: r => ['Dispatched', 'InTransit', 'Delayed'].includes(r.status ?? ''), run: r => this.patch(r, 'Delivered', { delivered: today() }) }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'type', label: 'scm.sh.type', type: 'select', table: true, def: 'Inbound', options: this.opts(['Inbound', 'Outbound']) },
          { key: 'ref', label: 'scm.sh.reference', table: true }, { key: 'carrier', label: 'scm.sh.carrier', type: 'select', table: true, options: () => this.carrierOpts() },
          { key: 'origin', label: 'scm.sh.origin' }, { key: 'destination', label: 'scm.sh.destination', table: true },
          { key: 'dispatched', label: 'scm.sh.dispatched', type: 'date' }, { key: 'eta', label: 'scm.sh.eta', type: 'date', table: true }, { key: 'delivered', label: 'scm.sh.delivered', type: 'date' },
          { key: 'tracking', label: 'scm.sh.tracking' }, { key: 'cost', label: 'mfg.f.mtCost', type: 'money', def: 0 }, this.statusField(['Planned', 'Dispatched', 'InTransit', 'Delayed', 'Delivered', 'Cancelled'], 'Planned')]
      }];
      case 'scm/carriers': return [{
        kind: 'carrier', canManage: this.can('scm.setup'), newLabel: 'scm.car.new', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [
          { key: 'code', label: 'erp.f.code', required: true, table: true, lockOnEdit: true }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'mode', label: 'scm.car.mode', type: 'select', table: true, options: this.opts(['Road', 'Air', 'Sea', 'Rail']) }, { key: 'phone', label: 'erp.f.phone', table: true }, { key: 'email', label: 'erp.f.email' },
          { key: 'rating', label: 'scm.car.rating', type: 'number', def: 80 }, this.statusField(ACTIVE, 'Active')]
      }];

      // ---------------------------------------------------------------- warehouse
      case 'wh/picks': return [{
        kind: 'pick', canManage: this.can('wh.pick.manage'), newLabel: 'wh.pick.new', emptyKey: 'common.noData', statuses: ['Open', 'Picked'], scopeBranch: true, editable: r => r.status === 'Open',
        actions: [{ label: 'wh.pick.confirm', show: r => r.status === 'Open' && this.can('wh.pick.manage'), run: r => this.act(r, `picks/${r.id}/confirm`) }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'reference', label: 'scm.sh.reference', table: true }, { key: 'due', label: 'erp.f.due', type: 'date', table: true, def: today },
          { key: 'picker', label: 'wh.pick.picker', type: 'select', options: () => this.userOpts() }, { key: 'lines', label: 'proc.f.items', type: 'lines', cols: [
            { key: 'sku', label: 'mfg.f.component', type: 'select', options: () => this.itemOpts() }, { key: 'qty', label: 'erp.f.qty', type: 'number', def: 1, width: '90px' }, { key: 'location', label: 'wh.loc', type: 'select', options: () => this.locOpts() }] },
          this.statusField(['Open', 'Picked'], 'Open')]
      }];
      case 'wh/counts': return [{
        kind: 'count', canManage: this.can('wh.count.manage'), newLabel: 'wh.count.new', emptyKey: 'common.noData', statuses: ['Draft', 'Posted'], scopeBranch: true, editable: r => r.status === 'Draft',
        actions: [{ label: 'wh.count.post', show: r => r.status === 'Draft' && this.can('wh.count.approve'), run: r => this.act(r, `counts/${r.id}/post`) }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'date', label: 'erp.f.date', type: 'date', table: true, def: today },
          { key: 'varianceQty', label: 'wh.count.varQty', type: 'number', table: true, calc: r => r.data['varianceQty'] ?? '' }, { key: 'varianceValue', label: 'wh.count.varValue', type: 'money', table: true, calc: r => r.data['varianceValue'] ?? '' },
          this.statusField(['Draft', 'Posted'], 'Draft'),
          { key: 'lines', label: 'proc.f.items', type: 'lines', cols: [
            { key: 'sku', label: 'mfg.f.component', type: 'select', options: () => this.itemOpts() }, { key: 'counted', label: 'wh.count.counted', type: 'number', def: 0, width: '110px' },
            { key: 'system', label: 'wh.count.system', type: 'number', def: 0, width: '100px' }, { key: 'variance', label: 'wh.count.variance', type: 'number', def: 0, width: '100px' }, { key: 'location', label: 'wh.loc', type: 'select', options: () => this.locOpts() }] }]
      }];
      case 'wh/locations': return [{
        kind: 'location', canManage: this.can('wh.setup'), newLabel: 'wh.loc.new', emptyKey: 'common.noData', statuses: ACTIVE, scopeBranch: true,
        fields: [
          { key: 'code', label: 'erp.f.code', required: true, table: true, lockOnEdit: true }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'type', label: 'scm.sh.type', type: 'select', table: true, def: 'Bin', options: this.opts(['Warehouse', 'Zone', 'Bin']) }, { key: 'parent', label: 'wh.loc.parent', type: 'select', table: true, options: () => this.locOpts() },
          { key: 'capacity', label: 'mfg.f.capacity', type: 'number' }, this.statusField(ACTIVE, 'Active')]
      }];

      // ---------------------------------------------------------------- assets
      case 'ast/assets': return [{
        kind: 'asset', canManage: this.can('ast.assets.manage'), newLabel: 'ast.asset.new', emptyKey: 'common.noData', statuses: ['Active', 'Down', 'Maintenance', 'Retired'], scopeBranch: true,
        fields: [
          { key: 'code', label: 'ast.f.tag', required: true, table: true, lockOnEdit: true }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'category', label: 'prj.f.category', type: 'select', table: true, options: () => this.catOpts() }, { key: 'location', label: 'ast.f.location', table: true }, { key: 'serial', label: 'mfg.f.serial' },
          { key: 'purchaseDate', label: 'mfg.f.purchased', type: 'date' }, { key: 'cost', label: 'mfg.f.purchaseCost', type: 'money', table: true, def: 0 },
          { key: 'criticality', label: 'ast.f.criticality', type: 'select', def: 'Medium', options: this.opts(['Low', 'Medium', 'High']) }, { key: 'owner', label: 'crm.f.owner', type: 'select', options: () => this.userOpts() },
          { key: 'finAsset', label: 'ast.f.finAsset', hint: 'ast.f.finAssetHint' }, { key: 'lastService', label: 'ast.f.lastService', type: 'date', table: true },
          this.statusField(['Active', 'Down', 'Maintenance', 'Retired'], 'Active'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 'ast/plans': return [{
        kind: 'plan', canManage: this.can('ast.plans.manage'), newLabel: 'ast.plan.new', emptyKey: 'common.noData', statuses: ACTIVE,
        actions: [{ label: 'ast.plan.generate', show: r => r.status === 'Active' && this.can('ast.orders.manage'), run: r => this.act(r, `plans/${r.id}/generate`) }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'ref', label: 'ast.f.asset', type: 'select', required: true, table: true, options: () => this.assetOpts() },
          { key: 'name', label: 'erp.f.name', required: true, table: true }, { key: 'frequencyDays', label: 'ast.plan.frequency', type: 'number', table: true, def: 30, required: true },
          { key: 'nextDue', label: 'ast.plan.nextDue', type: 'date', table: true, def: today }, { key: 'assignee', label: 'prj.f.assignee', type: 'select', options: () => this.userOpts() },
          this.statusField(ACTIVE, 'Active'), { key: 'task', label: 'ast.plan.task', type: 'textarea' }]
      }];
      case 'ast/orders': return [{
        kind: 'workorder', canManage: this.can('ast.orders.manage'), newLabel: 'ast.wo.new', emptyKey: 'common.noData', statuses: ['Open', 'InProgress', 'Completed', 'Cancelled'], scopeBranch: true, editable: r => r.status === 'Open' || r.status === 'InProgress',
        actions: [
          { label: 'mfg.wo.start', show: r => r.status === 'Open', run: r => this.act(r, `aworkorders/${r.id}/start`) },
          { label: 'mfg.wo.complete', show: r => r.status === 'Open' || r.status === 'InProgress', run: r => { this.astDone = { rec: r, cost: 0, hours: 0, note: '' }; this.error = ''; } },
          { label: 'mfg.wo.cancel', danger: true, show: r => r.status === 'Open' || r.status === 'InProgress', run: r => this.act(r, `aworkorders/${r.id}/cancel`) }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'ref', label: 'ast.f.asset', type: 'select', required: true, table: true, options: () => this.assetOpts() },
          { key: 'type', label: 'scm.sh.type', type: 'select', table: true, def: 'Corrective', options: this.opts(['Preventive', 'Corrective', 'Inspection']) },
          { key: 'description', label: 'erp.f.description', table: true }, { key: 'due', label: 'erp.f.due', type: 'date', table: true, def: today },
          { key: 'priority', label: 'mfg.wo.priority', type: 'select', def: 'Normal', options: this.opts(['Low', 'Normal', 'High', 'Urgent']) }, { key: 'assignee', label: 'prj.f.assignee', type: 'select', options: () => this.userOpts() },
          { key: 'actualCost', label: 'mfg.wo.actual', type: 'money', table: true, calc: r => r.data['actualCost'] ?? '' }, this.statusField(['Open', 'InProgress', 'Completed', 'Cancelled'], 'Open')]
      }];
      case 'ast/meters': return [{
        kind: 'meter', canManage: this.can('ast.orders.manage'), newLabel: 'ast.meter.new', emptyKey: 'common.noData',
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'ref', label: 'ast.f.asset', type: 'select', required: true, table: true, options: () => this.assetOpts() },
          { key: 'date', label: 'erp.f.date', type: 'date', table: true, def: today }, { key: 'meter', label: 'ast.meter.type', type: 'select', table: true, def: 'Hours', options: this.opts(['Hours', 'Km', 'Cycles']) },
          { key: 'value', label: 'ast.meter.value', type: 'number', required: true, table: true }, { key: 'notes', label: 'erp.f.notes' }]
      }];

      // ---------------------------------------------------------------- payroll
      case 'pay/elements': return [{
        kind: 'element', canManage: this.can('pay.setup'), newLabel: 'pay.el.new', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [
          { key: 'code', label: 'erp.f.code', required: true, table: true, lockOnEdit: true }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'type', label: 'scm.sh.type', type: 'select', table: true, def: 'earning', options: () => ['earning', 'deduction'].map(v => ({ value: v, label: this.i18n.t('pay.type.' + v) })) },
          { key: 'calc', label: 'pay.el.calc', type: 'select', table: true, def: 'fixed', options: () => ['fixed', 'pctBasic'].map(v => ({ value: v, label: this.i18n.t('pay.calc.' + v) })) },
          { key: 'value', label: 'pay.el.value', type: 'number', table: true, def: 0, hint: 'pay.el.valueHint' }, this.statusField(ACTIVE, 'Active')]
      }];
      case 'pay/adjustments': return [{
        kind: 'adjustment', canManage: this.can('pay.run.manage'), newLabel: 'pay.adj.new', emptyKey: 'common.noData', statuses: ['Active', 'Cancelled'],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'period', label: 'proc.ev.period', required: true, table: true, def: () => new Date().toISOString().slice(0, 7) },
          { key: 'empNo', label: 'pay.f.employee', type: 'select', required: true, table: true, options: () => (this.lk()['employees'] ?? []).map(e => ({ value: e.code, label: `${e.code} · ${e.name}` })) },
          { key: 'element', label: 'pay.f.element', type: 'select', table: true, options: () => this.elementOpts() }, { key: 'amount', label: 'erp.f.amount', type: 'money', required: true, table: true },
          { key: 'type', label: 'scm.sh.type', type: 'select', def: 'earning', options: () => ['earning', 'deduction'].map(v => ({ value: v, label: this.i18n.t('pay.type.' + v) })) }, { key: 'note', label: 'erp.f.notes', table: true },
          this.statusField(['Active', 'Cancelled'], 'Active')]
      }];
      case 'pay/runs': {
        return [{
          kind: 'run', canManage: this.can('pay.run.manage'), newLabel: 'pay.run.new', emptyKey: 'pay.run.none', statuses: ['Draft', 'Calculated', 'Approved', 'Posted'], editable: r => r.status === 'Draft' || r.status === 'Calculated',
          actions: [
            { label: 'pay.run.calculate', show: r => (r.status === 'Draft' || r.status === 'Calculated') && this.can('pay.run.manage'), run: r => this.act(r, `runs/${r.id}/calculate`) },
            { label: 'prj.ts.approve', show: r => r.status === 'Calculated' && this.can('pay.run.approve'), run: r => this.act(r, `runs/${r.id}/approve`) },
            { label: 'pay.run.post', show: r => r.status === 'Approved' && this.can('pay.post'), run: r => this.act(r, `runs/${r.id}/post`) }],
          fields: [
            { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'period', label: 'proc.ev.period', required: true, table: true, def: () => new Date().toISOString().slice(0, 7) }, { key: 'name', label: 'erp.f.name', table: true },
            { key: 'count', label: 'pay.run.employees', type: 'number', table: true, calc: r => r.data['count'] ?? '' }, { key: 'gross', label: 'pay.slip.gross', type: 'money', table: true, calc: r => r.data['gross'] ?? '' },
            { key: 'deductions', label: 'pay.slip.deductions', type: 'money', table: true, calc: r => r.data['deductions'] ?? '' }, { key: 'net', label: 'pay.slip.net', type: 'money', table: true, calc: r => r.data['net'] ?? '' },
            this.statusField(['Draft', 'Calculated', 'Approved', 'Posted'], 'Draft')]
        }];
      }
      case 'pay/payslips': return [{
        kind: 'payslip', canManage: false, newLabel: 'erp.new', emptyKey: 'pay.slip.none', statuses: ['Calculated', 'Approved', 'Posted'], editable: () => false,
        actions: [{ label: 'pay.slip.print', show: () => true, run: r => this.printSlip(r) }],
        fields: [
          { key: 'period', label: 'proc.ev.period', table: true, calc: r => r.data['period'] }, { key: 'empNo', label: 'pay.f.employee', table: true, calc: r => r.data['empNo'] }, { key: 'name', label: 'erp.f.name', table: true, calc: r => r.data['name'] },
          { key: 'basic', label: 'pay.slip.basic', type: 'money', calc: r => r.data['basic'] }, { key: 'gross', label: 'pay.slip.gross', type: 'money', table: true, calc: r => r.data['gross'] },
          { key: 'totalDeductions', label: 'pay.slip.totalDed', type: 'money', table: true, calc: r => r.data['totalDeductions'] }, { key: 'net', label: 'pay.slip.net', type: 'money', table: true, calc: r => r.data['net'] },
          this.statusField(['Calculated', 'Approved', 'Posted'], 'Calculated')]
      }];

      // ---------------------------------------------------------------- EPM
      case 'epm/plans': {
        const sum = (code: string | null | undefined) => this.planLines().filter(l => l.ref === code).reduce((t, l) => t + (Number(l.data['amount']) || 0), 0);
        return [{
          kind: 'plan', canManage: this.can('epm.plans.manage'), newLabel: 'epm.plan.new', emptyKey: 'common.noData', statuses: ['Draft', 'Approved', 'Published'], editable: r => r.status === 'Draft',
          actions: [
            { label: 'prj.ts.approve', show: r => r.status === 'Draft' && this.can('epm.plans.approve'), run: r => this.act(r, `plans/${r.id}/approve`) },
            { label: 'epm.publish', show: r => r.status === 'Approved' && this.can('epm.publish'), run: r => this.act(r, `plans/${r.id}/publish`) }],
          fields: [
            { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
            { key: 'year', label: 'fin.f.year', required: true, table: true, def: () => String(new Date().getFullYear()) }, { key: 'scenario', label: 'epm.scenario', type: 'select', table: true, def: 'Base', options: this.opts(['Base', 'Optimistic', 'Pessimistic']) },
            { key: 'version', label: 'epm.version', def: 'v1' }, { key: 'total', label: 'erp.f.total', type: 'money', table: true, calc: r => sum(r.code) },
            this.statusField(['Draft', 'Approved', 'Published'], 'Draft'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
        }, {
          kind: 'line', title: 'epm.lines', canManage: this.can('epm.plans.manage'), newLabel: 'epm.line.new', emptyKey: 'common.noData',
          fields: [
            { key: 'ref', label: 'epm.plan', type: 'select', required: true, table: true, options: () => this.planOpts() }, { key: 'costCenter', label: 'fin.f.costCenter', type: 'select', table: true, options: this.lkOpts('costcenters') },
            { key: 'account', label: 'fin.f.account', type: 'select', table: true, options: this.lkOpts('accounts') }, { key: 'amount', label: 'erp.f.amount', type: 'money', required: true, table: true }, { key: 'note', label: 'erp.f.notes', table: true }]
        }];
      }
      case 'epm/forecast': return [{
        kind: 'forecast', canManage: this.can('epm.forecast.manage'), newLabel: 'epm.fc.new', emptyKey: 'common.noData', statuses: ['Draft', 'Approved'],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'period', label: 'proc.ev.period', required: true, table: true, def: () => new Date().toISOString().slice(0, 7) },
          { key: 'costCenter', label: 'fin.f.costCenter', type: 'select', table: true, options: this.lkOpts('costcenters') }, { key: 'account', label: 'fin.f.account', type: 'select', table: true, options: this.lkOpts('accounts') },
          { key: 'amount', label: 'erp.f.amount', type: 'money', required: true, table: true }, { key: 'basis', label: 'epm.basis', table: true }, this.statusField(['Draft', 'Approved'], 'Draft')]
      }];

      // ---------------------------------------------------------------- BPM / integration
      case 'bpm/processes': return [{
        kind: 'process', canManage: this.can('bpm.manage'), newLabel: 'bpm.proc.new', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'category', label: 'prj.f.category', table: true }, { key: 'owner', label: 'crm.f.owner', type: 'select', table: true, options: () => this.userOpts() },
          { key: 'slaHours', label: 'bpm.sla', type: 'number', table: true, def: 24 }, { key: 'workflow', label: 'bpm.workflow', type: 'select', table: true, options: () => this.defs() },
          this.statusField(ACTIVE, 'Active'), { key: 'description', label: 'erp.f.description', type: 'textarea' }]
      }];
      case 'int/webhooks': return [{
        kind: 'webhook', canManage: this.can('int.hooks.manage'), newLabel: 'int.hook.new', emptyKey: 'common.noData', statuses: ACTIVE,
        actions: [{ label: 'int.hook.test', show: () => this.can('int.hooks.manage'), run: r => { this.error = ''; this.erp.action<any>('int', `webhooks/${r.id}/test`).subscribe({ next: x => { this.error = x.ok ? '' : `${x.status} ${x.message}`; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) }); } }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'url', label: 'int.hook.url', required: true, table: true }, { key: 'events', label: 'int.hook.events', table: true, def: '*', hint: 'int.hook.eventsHint' }, { key: 'secret', label: 'int.hook.secret', hint: 'int.hook.secretHint' },
          this.statusField(ACTIVE, 'Active')]
      }];
      case 'int/logs': return [{
        kind: 'log', canManage: false, newLabel: 'erp.new', emptyKey: 'common.noData', statuses: ['Success', 'Failed'], editable: () => false,
        fields: [
          { key: 'at', label: 'erp.f.date', type: 'date', table: true, calc: r => r.createdAt }, { key: 'code', label: 'int.hook', table: true },
          { key: 'event', label: 'int.log.event', table: true, calc: r => r.data['event'] }, { key: 'httpStatus', label: 'int.log.http', table: true, calc: r => r.data['httpStatus'] },
          { key: 'message', label: 'int.log.message', table: true, calc: r => r.data['message'] }, this.statusField(['Success', 'Failed'], 'Success')]
      }];
    }
    return [];
  }
}
