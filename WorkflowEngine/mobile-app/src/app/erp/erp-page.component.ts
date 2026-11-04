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
/** record types an approval rule can govern: module/kind, and the status that needs the approval */
const GOV_TARGETS: { value: string; label: string; trigger: string }[] = [
  { value: 'proc/requisition', label: 'Purchase requisition', trigger: 'Approved' }, { value: 'proc/po', label: 'Purchase order', trigger: 'Approved' },
  { value: 'pay/run', label: 'Payroll run', trigger: 'Approved' }, { value: 'epm/plan', label: 'Budget plan', trigger: 'Approved' }, { value: 'epm/forecast', label: 'Forecast', trigger: 'Approved' },
  { value: 're/lease', label: 'Lease (activation)', trigger: 'Active' }, { value: 'prj/timesheet', label: 'Timesheet', trigger: 'Approved' },
  { value: 'finance/apinvoice', label: 'Supplier invoice', trigger: 'Approved' }, { value: 'finance/journal', label: 'Journal (posting)', trigger: 'Posted' },
];
/** record types that can carry custom fields */
const GOV_FIELD_TARGETS = ['mfg/bom', 'mfg/workorder', 'prj/project', 'prj/task', 'crm/lead', 'crm/account', 'crm/contact', 'crm/opportunity', 'crm/quote', 'proc/requisition', 'proc/po', 'proc/rfq', 'proc/contract',
  'scm/shipment', 'wh/lot', 'wh/pick', 'ast/asset', 'ast/workorder', 'pay/adjustment', 're/property', 're/unit', 're/owner', 're/tenant', 're/lease', 're/sale', 're/request', 'arc/incoming', 'arc/outgoing', 'arc/document'];
/** privileges that mean "may approve" - what an approval step can ask for */
const GOV_APPROVER_PRIVS = ['proc.req.approve', 'proc.po.approve', 'pay.run.approve', 'epm.plans.approve', 'finance.gl.approve', 'finance.ap.approve', 're.leases.approve', 'prj.time.approve', 'wh.count.approve', 'hr.leave.approve', 'arc.outgoing.approve'];

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
        <div class="modal-body"><table class="data"><thead><tr><th>{{ 'mfg.f.component' | translate }}</th><th class="num">{{ 'proc.ordered' | translate }}</th><th class="num">{{ 'proc.received' | translate }}</th><th style="width:110px">{{ 'proc.receiveNow' | translate }}</th><th style="width:120px">{{ 'wh.lot.batch' | translate }}</th><th style="width:140px">{{ 'wh.lot.expiry' | translate }}</th><th>{{ 'wh.lot.serials' | translate }}</th></tr></thead>
          <tbody><tr *ngFor="let l of recv.lines"><td>{{ l.sku }}</td><td class="num">{{ l.ordered | num: 2 }}</td><td class="num">{{ l.received | num: 2 }}</td><td><input type="number" step="any" [(ngModel)]="l.qty" /></td>
            <td><input [(ngModel)]="l.batch" /></td><td><input type="date" [(ngModel)]="l.expiry" /></td><td><input [(ngModel)]="l.serials" [placeholder]="'wh.lot.serialsHint' | translate" /></td></tr></tbody></table>
          <div><label class="lbl">{{ 'erp.f.notes' | translate }}</label><input [(ngModel)]="recv.note" /></div><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="recv = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doRecv()">{{ 'proc.receive' | translate }}</button></div>
      </div>
    </div>
    <div class="modal-scrim" *ngIf="qa" (click)="qa = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ qa.title | translate }} · {{ qa.rec.code }}</h3></div>
        <div class="modal-body">
          <div *ngIf="qa.askTo"><label class="lbl">{{ 'gov.act.to' | translate }}</label>
            <select [(ngModel)]="qa.to"><option value="">—</option><option *ngFor="let o of userOpts()" [value]="o.value">{{ o.label }}</option></select></div>
          <div *ngIf="qa.askNote"><label class="lbl">{{ qa.noteLabel | translate }}<span *ngIf="qa.noteRequired"> *</span></label><input [(ngModel)]="qa.note" /></div>
          <p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="qa = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doQa()">{{ qa.title | translate }}</button></div>
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

    <div class="modal-scrim" *ngIf="arcAct" (click)="arcAct = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ arcAct.title | translate }} · {{ arcAct.rec.code }}</h3></div>
        <div class="modal-body">
          <div *ngIf="arcAct.fields.includes('user')"><label class="lbl">{{ 'arc.m.user' | translate }}</label>
            <select [(ngModel)]="arcAct.user"><option value="">—</option><option *ngFor="let o of userOpts()" [value]="o.value">{{ o.label }}</option></select></div>
          <div *ngIf="arcAct.fields.includes('due')"><label class="lbl">{{ 'erp.f.due' | translate }}</label><input type="date" [(ngModel)]="arcAct.due" /></div>
          <div *ngIf="arcAct.fields.includes('badge')"><label class="lbl">{{ 'arc.f.badge' | translate }}</label><input [(ngModel)]="arcAct.badge" /></div>
          <div *ngIf="arcAct.fields.includes('note')"><label class="lbl">{{ arcAct.noteLabel | translate }}</label><input [(ngModel)]="arcAct.note" /></div>
          <div *ngIf="arcAct.fields.includes('reason')"><label class="lbl">{{ 'arc.m.reason' | translate }}</label><input [(ngModel)]="arcAct.reason" /></div>
          <p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="arcAct = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doArc()">{{ arcAct.title | translate }}</button></div>
      </div>
    </div>
    <div class="modal-scrim" *ngIf="reAct" (click)="reAct = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ reAct.title | translate }} · {{ reAct.rec.code }}</h3></div>
        <div class="modal-body">
          <div *ngIf="reAct.fields.includes('amount')"><label class="lbl">{{ 're.m.amount' | translate }}</label><input type="number" step="0.01" [(ngModel)]="reAct.amount" /></div>
          <div *ngIf="reAct.fields.includes('method')"><label class="lbl">{{ 're.m.method' | translate }}</label>
            <select [(ngModel)]="reAct.method"><option *ngFor="let m of reMethods" [value]="m">{{ m }}</option></select></div>
          <div *ngIf="reAct.fields.includes('percent')"><label class="lbl">{{ 're.m.percent' | translate }}</label><input type="number" step="0.1" [(ngModel)]="reAct.percent" /></div>
          <div *ngIf="reAct.fields.includes('user')"><label class="lbl">{{ 're.m.user' | translate }}</label>
            <select [(ngModel)]="reAct.user"><option value="">—</option><option *ngFor="let o of userOpts()" [value]="o.value">{{ o.label }}</option></select></div>
          <div *ngIf="reAct.fields.includes('cost')"><label class="lbl">{{ 're.f.cost' | translate }}</label><input type="number" step="0.01" [(ngModel)]="reAct.cost" /></div>
          <div *ngIf="reAct.fields.includes('note')"><label class="lbl">{{ reAct.noteLabel | translate }}</label><input [(ngModel)]="reAct.note" /></div>
          <p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="reAct = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doRe()">{{ reAct.title | translate }}</button></div>
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
  recv: { rec: ErpRec; lines: { sku: string; ordered: number; received: number; qty: number; batch: string; expiry: string; serials: string }[]; note: string } | null = null;
  qa: { rec: ErpRec; module: ErpModule; path: string; title: string; noteLabel: string; askNote: boolean; noteRequired: boolean; askTo: boolean; note: string; to: string } | null = null;
  toPo: { rec: ErpRec; vendor: string } | null = null;
  astDone: { rec: ErpRec; cost: number; hours: number; note: string } | null = null;
  arcAct: { rec: ErpRec; op: string; title: string; noteLabel: string; fields: string[]; user: string; due: string; note: string; reason: string; badge: string } | null = null;
  reAct: { rec: ErpRec; op: string; title: string; noteLabel: string; fields: string[]; amount: number | null; method: string; percent: number | null; user: string; cost: number | null; note: string } | null = null;
  reMethods = ['Cash', 'Transfer', 'Cheque', 'Card'];
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
    if (this.module === 're') for (const k of ['property', 'unit', 'owner', 'tenant']) this.erp.refresh('re', k as any, co).subscribe();
    if (this.module === 'arc') { this.erp.refresh('arc', 'category', co).subscribe(); if (this.page === 'outgoing') this.erp.refresh('arc', 'incoming', co).subscribe(); }
  }
  onChanged(kind: ErpKind, l: ErpRec[]) { if (kind === 'allocation') this.allocs.set(l); if (kind === 'customfield') this.erp.clearCustomFields(); }

  // ------------------------------------------------------------------ option helpers
  private st = (list: string[]) => () => list.map(s => ({ value: s, label: this.stl(s) }));
  stl = (s: string) => { const k = 'erp.st.' + s; const t = this.i18n.t(k); return t === k ? s : t; };
  private opts = (list: string[]) => () => list.map(s => ({ value: s, label: this.i18n.t('erp.o.' + s) === 'erp.o.' + s ? s : this.i18n.t('erp.o.' + s) }));
  userOpts = () => this.users().map(u => ({ value: u.username, label: u.displayName || u.username }));
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

  private arcCatOpts = () => this.erp.ref('arc', 'category', this.ctx.company()).filter(c => c.status !== 'Inactive').map(c => ({ value: c.code ?? '', label: `${c.code} · ${c.data['name'] ?? ''}` }));
  private arcInOpts = () => this.erp.ref('arc', 'incoming', this.ctx.company()).map(c => ({ value: c.code ?? '', label: `${c.code} · ${c.data['subject'] ?? ''}` }));
  private me = () => this.auth.currentUser()?.username ?? '';
  private reOpts = (kind: string, nameKey: string) => () => this.erp.ref('re', kind as any, this.ctx.company()).filter(c => c.status !== 'Inactive').map(c => ({ value: c.code ?? '', label: `${c.code} · ${c.data[nameKey] ?? ''}` }));
  private reUnitOpts = () => this.erp.ref('re', 'unit', this.ctx.company()).map(c => ({ value: c.code ?? '', label: `${c.code} · ${c.data['unitNo'] ?? ''} (${c.data['property'] ?? ''}) · ${c.status}` }));
  private openRe(r: ErpRec, op: string, title: string, fields: string[], noteLabel = 'erp.f.notes') {
    this.error = '';
    const bal = Math.max(0, (Number(r.data['amount']) || 0) - (Number(r.data['paid']) || 0));
    this.reAct = { rec: r, op, title, noteLabel, fields, amount: fields.includes('amount') ? bal : null, method: 'Cash', percent: fields.includes('percent') ? 0 : null, user: '', cost: fields.includes('cost') ? (Number(r.data['cost']) || 0) : null, note: '' };
  }
  private quickRe(r: ErpRec, op: string) { this.act(r, `react/${r.kind}/${r.id}/${op}`); }
  doRe() {
    const x = this.reAct!; this.error = '';
    this.erp.action('re', `react/${x.rec.kind}/${x.rec.id}/${x.op}`, { amount: x.amount ?? undefined, method: x.method, percent: x.percent ?? undefined, user: x.user || undefined, cost: x.cost ?? undefined, note: x.note || undefined }).subscribe({ next: () => { this.reAct = null; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  private openArc(r: ErpRec, op: string, title: string, fields: string[], noteLabel = 'erp.f.notes') {
    this.error = ''; this.arcAct = { rec: r, op, title, noteLabel, fields, user: '', due: '', note: '', reason: '', badge: '' };
  }
  private quickArc(r: ErpRec, op: string) { this.act(r, `arcact/${r.kind}/${r.id}/${op}`); }
  doArc() {
    const x = this.arcAct!; this.error = '';
    this.erp.action('arc', `arcact/${x.rec.kind}/${x.rec.id}/${x.op}`, { user: x.user, due: x.due, note: x.note, reason: x.reason, badge: x.badge }).subscribe({ next: () => { this.arcAct = null; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
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
    this.recv = { rec: r, note: '', lines: ((r.data['lines'] ?? []) as any[]).map(l => ({ sku: l.sku, ordered: Number(l.qty) || 0, received: Number(l.received) || 0, qty: Math.max(0, (Number(l.qty) || 0) - (Number(l.received) || 0)), batch: '', expiry: '', serials: '' })) };
  }
  /** a small dialog for the actions that take a note and / or a person: approvals, lot hold / write-off ... */
  private openQa(r: ErpRec, module: ErpModule, path: string, title: string, o: { askNote?: boolean; noteRequired?: boolean; askTo?: boolean; noteLabel?: string } = {}) {
    this.error = ''; this.qa = { rec: r, module, path, title, noteLabel: o.noteLabel ?? 'erp.f.notes', askNote: o.askNote ?? true, noteRequired: !!o.noteRequired, askTo: !!o.askTo, note: '', to: '' };
  }
  doQa() {
    const x = this.qa!; this.error = '';
    if (x.noteRequired && !x.note.trim()) { this.error = this.i18n.t('hr.err.required'); return; }
    if (x.askTo && !x.to) { this.error = this.i18n.t('hr.err.required'); return; }
    this.erp.action(x.module, x.path, { note: x.note || undefined, to: x.to || undefined }).subscribe({ next: () => { this.qa = null; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  private govAct(r: ErpRec, op: string) {
    const t = { approve: 'gov.act.approve', reject: 'gov.act.reject', reassign: 'gov.act.reassign', cancel: 'gov.act.cancel' }[op] as string;
    this.openQa(r, 'gov', `approvals/${r.id}/${op}`, t, { askNote: op !== 'reassign', noteRequired: op === 'reject', askTo: op === 'reassign', noteLabel: op === 'reject' ? 'gov.act.reason' : 'erp.f.notes' });
  }
  private lotAct(r: ErpRec, op: string) {
    this.openQa(r, 'wh', `lots/${r.id}/${op}`, 'wh.lot.' + op, { askNote: op === 'writeoff', noteRequired: op === 'writeoff', noteLabel: 'gov.act.reason' });
  }
  private splitSerials = (s: string) => String(s || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
  doRecv() {
    const x = this.recv!; this.error = '';
    this.erp.action('proc', `pos/${x.rec.id}/receive`, { note: x.note, lines: x.lines.filter(l => l.qty > 0).map(l => ({ sku: l.sku, qty: Number(l.qty), batchNo: l.batch || undefined, expiry: l.expiry || undefined, serials: this.splitSerials(l.serials) })) }).subscribe({ next: () => { this.recv = null; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) });
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

      // ---------------------------------------------------------------- archive & secretary
      case 'arc/incoming': return [{
        kind: 'incoming', canManage: this.can('arc.incoming.manage'), newLabel: 'arc.in.new', emptyKey: 'common.noData', scopeBranch: true,
        statuses: ['Received', 'Assigned', 'InProgress', 'Replied', 'Closed', 'Archived'], editable: r => r.status !== 'Closed' && r.status !== 'Archived',
        actions: [
          { label: 'arc.a.assign', show: r => ['Received', 'Assigned', 'InProgress'].includes(r.status ?? ''), run: r => { this.openArc(r, 'assign', 'arc.a.assign', ['user', 'due']); this.arcAct!.user = String(r.data['assignedTo'] ?? ''); this.arcAct!.due = String(r.data['dueDate'] ?? ''); } },
          { label: 'arc.a.start', show: r => r.status === 'Assigned' && (r.data['assignedTo'] === this.me() || this.can('arc.setup')), run: r => this.quickArc(r, 'start') },
          { label: 'arc.a.reply', show: r => ['Received', 'Assigned', 'InProgress'].includes(r.status ?? '') && this.can('arc.outgoing.manage'), run: r => this.quickArc(r, 'reply') },
          { label: 'arc.a.close', show: r => r.status !== 'Closed' && r.status !== 'Archived', run: r => this.openArc(r, 'close', 'arc.a.close', ['note'], r.status === 'Replied' ? 'erp.f.notes' : 'arc.m.closeNote') },
          { label: 'arc.a.archive', show: r => r.status === 'Closed' && this.can('arc.docs.manage'), run: r => this.openArc(r, 'archive', 'arc.a.archive', ['note'], 'arc.m.folder') }],
        fields: [
          { key: 'code', label: 'arc.f.regNo', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'subject', label: 'arc.f.subject', required: true, table: true },
          { key: 'sender', label: 'arc.f.sender', required: true, table: true }, { key: 'senderRef', label: 'arc.f.senderRef', table: true },
          { key: 'receivedDate', label: 'arc.f.received', type: 'date', required: true, table: true, def: today },
          { key: 'channel', label: 'arc.f.channel', type: 'select', table: true, def: 'Mail', options: this.opts(['Mail', 'Email', 'Fax', 'Hand', 'Courier']) },
          { key: 'priority', label: 'arc.f.priority', type: 'select', table: true, def: 'Normal', options: this.opts(['Normal', 'Urgent', 'Very urgent']) },
          { key: 'confidentiality', label: 'arc.f.confidentiality', type: 'select', def: 'Internal', options: this.opts(['Public', 'Internal', 'Confidential', 'Secret']) },
          { key: 'category', label: 'arc.f.category', type: 'select', options: () => this.arcCatOpts() }, { key: 'dueDate', label: 'erp.f.due', type: 'date', table: true },
          { key: 'assignedTo', label: 'arc.f.assignedTo', table: true, calc: r => this.userName(String(r.data['assignedTo'] ?? '')) },
          { key: 'summary', label: 'arc.f.summary', type: 'textarea' },
          { key: 'status', label: 'erp.f.status', type: 'status', table: true, lockOnEdit: true, def: 'Received', options: this.st(['Received', 'Assigned', 'InProgress', 'Replied', 'Closed', 'Archived']) }]
      }];
      case 'arc/outgoing': return [{
        kind: 'outgoing', canManage: this.can('arc.outgoing.manage'), newLabel: 'arc.out.new', emptyKey: 'common.noData', scopeBranch: true,
        statuses: ['Draft', 'Approved', 'Sent', 'Archived'], editable: r => r.status === 'Draft',
        actions: [
          { label: 'arc.a.approve', show: r => r.status === 'Draft' && this.can('arc.outgoing.approve') && r.createdBy !== this.me(), run: r => this.quickArc(r, 'approve') },
          { label: 'arc.a.send', show: r => r.status === 'Approved', run: r => this.quickArc(r, 'send') },
          { label: 'arc.a.archive', show: r => r.status === 'Sent' && this.can('arc.docs.manage'), run: r => this.openArc(r, 'archive', 'arc.a.archive', ['note'], 'arc.m.folder') }],
        fields: [
          { key: 'code', label: 'arc.f.regNo', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'subject', label: 'arc.f.subject', required: true, table: true },
          { key: 'recipient', label: 'arc.f.recipient', required: true, table: true }, { key: 'date', label: 'erp.f.date', type: 'date', required: true, table: true, def: today },
          { key: 'channel', label: 'arc.f.channel', type: 'select', table: true, def: 'Mail', options: this.opts(['Mail', 'Email', 'Fax', 'Hand', 'Courier']) },
          { key: 'confidentiality', label: 'arc.f.confidentiality', type: 'select', def: 'Internal', options: this.opts(['Public', 'Internal', 'Confidential', 'Secret']) },
          { key: 'category', label: 'arc.f.category', type: 'select', options: () => this.arcCatOpts() },
          { key: 'replyTo', label: 'arc.f.replyTo', type: 'select', table: true, options: () => this.arcInOpts() }, { key: 'body', label: 'arc.f.body', type: 'textarea' },
          { key: 'status', label: 'erp.f.status', type: 'status', table: true, lockOnEdit: true, def: 'Draft', options: this.st(['Draft', 'Approved', 'Sent', 'Archived']) }]
      }];
      case 'arc/documents': return [{
        kind: 'document', canManage: this.can('arc.docs.manage'), newLabel: 'arc.doc.new', emptyKey: 'common.noData', scopeBranch: true,
        statuses: ['Active', 'Hold', 'Destroyed'], editable: r => r.status !== 'Destroyed',
        actions: [
          { label: 'arc.a.hold', show: r => r.status === 'Active', run: r => this.openArc(r, 'hold', 'arc.a.hold', ['reason']) },
          { label: 'arc.a.release', show: r => r.status === 'Hold', run: r => this.quickArc(r, 'release') },
          { label: 'arc.a.dispose', danger: true, show: r => r.status === 'Active' && this.can('arc.dispose') && !!r.data['retentionEnd'] && String(r.data['retentionEnd']) <= today(), run: r => this.openArc(r, 'dispose', 'arc.a.dispose', ['reason']) }],
        fields: [
          { key: 'code', label: 'arc.f.fileNo', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'title', label: 'arc.f.title', required: true, table: true },
          { key: 'category', label: 'arc.f.category', type: 'select', required: true, table: true, options: () => this.arcCatOpts() },
          { key: 'docDate', label: 'arc.f.docDate', type: 'date', required: true, table: true, def: today }, { key: 'refNo', label: 'arc.f.refNo', table: true }, { key: 'folder', label: 'arc.f.folder', table: true },
          { key: 'confidentiality', label: 'arc.f.confidentiality', type: 'select', def: 'Internal', options: this.opts(['Public', 'Internal', 'Confidential', 'Secret']) },
          { key: 'retentionYears', label: 'arc.f.retentionYears', type: 'number', hint: 'arc.f.retentionHint' },
          { key: 'retentionEnd', label: 'arc.f.retentionEnd', table: true, calc: r => r.data['retentionEnd'] || '∞' }, { key: 'tags', label: 'arc.f.tags' },
          { key: 'status', label: 'erp.f.status', type: 'status', table: true, lockOnEdit: true, def: 'Active', options: this.st(['Active', 'Hold', 'Destroyed']) }]
      }];
      case 'arc/appointments': return [{
        kind: 'appointment', canManage: this.can('arc.secretary.manage'), newLabel: 'arc.apt.new', emptyKey: 'common.noData', statuses: ['Scheduled', 'Done', 'Cancelled', 'NoShow'], scopeBranch: true,
        editable: r => r.status === 'Scheduled',
        actions: [
          { label: 'arc.a.complete', show: r => r.status === 'Scheduled', run: r => this.patch(r, 'Done') },
          { label: 'arc.a.noshow', show: r => r.status === 'Scheduled', run: r => this.patch(r, 'NoShow') },
          { label: 'arc.a.cancel', danger: true, show: r => r.status === 'Scheduled', run: r => this.patch(r, 'Cancelled') }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'title', label: 'arc.f.title', required: true, table: true },
          { key: 'with', label: 'arc.f.with', table: true }, { key: 'org', label: 'arc.f.org' }, { key: 'date', label: 'erp.f.date', type: 'date', required: true, table: true, def: today },
          { key: 'startTime', label: 'arc.f.startTime', required: true, table: true, def: '09:00', hint: 'arc.f.timeHint' }, { key: 'endTime', label: 'arc.f.endTime', required: true, table: true, def: '09:30', hint: 'arc.f.timeHint' },
          { key: 'location', label: 'arc.f.location' }, { key: 'owner', label: 'arc.f.owner', type: 'select', table: true, def: () => this.me(), options: () => this.userOpts() },
          { key: 'notes', label: 'erp.f.notes', type: 'textarea' }, this.statusField(['Scheduled', 'Done', 'Cancelled', 'NoShow'], 'Scheduled')]
      }];
      case 'arc/visitors': return [{
        kind: 'visitor', canManage: this.can('arc.secretary.manage'), newLabel: 'arc.vis.new', emptyKey: 'common.noData', statuses: ['Expected', 'In', 'Out', 'Cancelled'], scopeBranch: true,
        editable: r => r.status === 'Expected',
        actions: [
          { label: 'arc.a.checkin', show: r => r.status === 'Expected', run: r => this.openArc(r, 'checkin', 'arc.a.checkin', ['badge']) },
          { label: 'arc.a.checkout', show: r => r.status === 'In', run: r => this.quickArc(r, 'checkout') },
          { label: 'arc.a.cancel', danger: true, show: r => r.status === 'Expected', run: r => this.quickArc(r, 'cancel') }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'company', label: 'arc.f.org', table: true }, { key: 'idNo', label: 'arc.f.idNo' }, { key: 'purpose', label: 'arc.f.purpose', required: true, table: true },
          { key: 'host', label: 'arc.f.host', type: 'select', table: true, options: () => this.userOpts() }, { key: 'date', label: 'erp.f.date', type: 'date', required: true, table: true, def: today },
          { key: 'badge', label: 'arc.f.badge', table: true, calc: r => r.data['badge'] ?? '' },
          { key: 'checkInAt', label: 'arc.f.checkIn', type: 'date', table: true, calc: r => r.data['checkInAt'] ?? '' }, { key: 'checkOutAt', label: 'arc.f.checkOut', type: 'date', table: true, calc: r => r.data['checkOutAt'] ?? '' },
          { key: 'status', label: 'erp.f.status', type: 'status', table: true, lockOnEdit: true, def: 'Expected', options: this.st(['Expected', 'In', 'Out', 'Cancelled']) }]
      }];
      case 'arc/todos': return [{
        kind: 'todo', canManage: this.can('arc.secretary.manage'), newLabel: 'arc.todo.new', emptyKey: 'common.noData', statuses: ['Open', 'InProgress', 'Done', 'Cancelled'],
        actions: [
          { label: 'arc.a.start', show: r => r.status === 'Open', run: r => this.patch(r, 'InProgress') },
          { label: 'arc.a.done', show: r => r.status === 'Open' || r.status === 'InProgress', run: r => this.patch(r, 'Done') }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'title', label: 'arc.f.title', required: true, table: true },
          { key: 'assignedTo', label: 'arc.f.assignedTo', type: 'select', table: true, def: () => this.me(), options: () => this.userOpts() }, { key: 'due', label: 'erp.f.due', type: 'date', table: true },
          { key: 'priority', label: 'arc.f.priority', type: 'select', table: true, def: 'Normal', options: this.opts(['Low', 'Normal', 'High']) }, { key: 'related', label: 'arc.f.related', table: true },
          { key: 'notes', label: 'erp.f.notes', type: 'textarea' }, this.statusField(['Open', 'InProgress', 'Done', 'Cancelled'], 'Open')]
      }];
      case 'arc/categories': return [{
        kind: 'category', canManage: this.can('arc.setup'), newLabel: 'arc.cat.new', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [
          { key: 'code', label: 'erp.f.code', required: true, table: true, lockOnEdit: true }, { key: 'name', label: 'erp.f.name', required: true, table: true }, { key: 'nameAr', label: 'arc.f.nameAr' },
          { key: 'retentionYears', label: 'arc.f.retentionYears', type: 'number', table: true, def: 5, hint: 'arc.f.retentionZero' }, this.statusField(ACTIVE, 'Active')]
      }];

      // ---------------------------------------------------------------- real estate
      case 're/properties': return [{
        kind: 'property', canManage: this.can('re.properties.manage'), newLabel: 're.prop.new', emptyKey: 'common.noData', statuses: ['Active', 'UnderConstruction', 'Inactive', 'Sold'], scopeBranch: true,
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'type', label: 're.f.propType', type: 'select', table: true, def: 'Residential', options: this.opts(['Residential', 'Commercial', 'Mixed', 'Land', 'Industrial']) },
          { key: 'city', label: 're.f.city', table: true }, { key: 'district', label: 're.f.district', table: true }, { key: 'address', label: 're.f.address' },
          { key: 'owner', label: 're.f.owner', type: 'select', table: true, options: this.reOpts('owner', 'name') }, { key: 'floors', label: 're.f.floors', type: 'number', def: 1 },
          { key: 'yearBuilt', label: 're.f.yearBuilt', type: 'number' }, { key: 'deedNo', label: 're.f.deedNo' },
          this.statusField(['Active', 'UnderConstruction', 'Inactive', 'Sold'], 'Active'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 're/units': return [{
        kind: 'unit', canManage: this.can('re.units.manage'), newLabel: 're.unit.new', emptyKey: 'common.noData', statuses: ['Available', 'Reserved', 'Rented', 'Sold', 'Maintenance'], scopeBranch: true,
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'property', label: 're.f.property', type: 'select', required: true, table: true, options: this.reOpts('property', 'name') },
          { key: 'unitNo', label: 're.f.unitNo', required: true, table: true }, { key: 'floor', label: 're.f.floor', type: 'number', def: 0 },
          { key: 'type', label: 're.f.unitType', type: 'select', table: true, def: 'Apartment', options: this.opts(['Apartment', 'Villa', 'Office', 'Shop', 'Warehouse', 'Land', 'Studio', 'Floor']) },
          { key: 'area', label: 're.f.area', type: 'number', required: true, table: true, def: 100 }, { key: 'bedrooms', label: 're.f.bedrooms', type: 'number', def: 0 }, { key: 'bathrooms', label: 're.f.bathrooms', type: 'number', def: 0 },
          { key: 'annualRent', label: 're.f.annualRent', type: 'money', table: true, def: 0 }, { key: 'salePrice', label: 're.f.salePrice', type: 'money', table: true, def: 0 },
          { key: 'furnished', label: 're.f.furnished', type: 'bool' }, this.statusField(['Available', 'Reserved', 'Rented', 'Sold', 'Maintenance'], 'Available'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 're/owners': return [{
        kind: 'owner', canManage: this.can('re.properties.manage'), newLabel: 're.owner.new', emptyKey: 'common.noData', statuses: ACTIVE, scopeBranch: true,
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'phone', label: 're.f.phone', table: true }, { key: 'email', label: 're.f.email' }, { key: 'nationalId', label: 're.f.nationalId' },
          { key: 'commissionPct', label: 're.f.commission', type: 'number', table: true, def: 5 }, { key: 'iban', label: 're.f.iban' }, this.statusField(ACTIVE, 'Active'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 're/tenants': return [{
        kind: 'tenant', canManage: this.can('re.leases.manage'), newLabel: 're.tenant.new', emptyKey: 'common.noData', statuses: ['Active', 'Inactive', 'Blacklisted'], scopeBranch: true,
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'phone', label: 're.f.phone', table: true }, { key: 'email', label: 're.f.email', table: true }, { key: 'nationalId', label: 're.f.nationalId' },
          { key: 'nationality', label: 're.f.nationality' }, { key: 'employer', label: 're.f.employer' }, this.statusField(['Active', 'Inactive', 'Blacklisted'], 'Active'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];
      case 're/leases': return [{
        kind: 'lease', canManage: this.can('re.leases.manage'), newLabel: 're.lease.new', emptyKey: 'common.noData', statuses: ['Draft', 'Active', 'Expired', 'Terminated'], scopeBranch: true,
        editable: r => r.status === 'Draft',
        actions: [
          { label: 're.a.activate', show: r => r.status === 'Draft' && this.can('re.leases.approve'), run: r => this.quickRe(r, 'activate') },
          { label: 're.a.renew', show: r => (r.status === 'Active' || r.status === 'Expired') && !r.data['renewedTo'], run: r => this.openRe(r, 'renew', 're.a.renew', ['percent']) },
          { label: 're.a.terminate', danger: true, show: r => r.status === 'Active' && this.can('re.leases.approve'), run: r => this.openRe(r, 'terminate', 're.a.terminate', ['note'], 're.m.reason') }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'unit', label: 're.f.unit', type: 'select', required: true, table: true, options: () => this.reUnitOpts() },
          { key: 'tenant', label: 're.f.tenant', type: 'select', required: true, table: true, options: this.reOpts('tenant', 'name') },
          { key: 'startDate', label: 're.f.startDate', type: 'date', required: true, table: true, def: today }, { key: 'endDate', label: 're.f.endDate', type: 'date', required: true, table: true },
          { key: 'annualRent', label: 're.f.annualRent', type: 'money', required: true, table: true, def: 0 },
          { key: 'frequency', label: 're.f.frequency', type: 'select', required: true, table: true, def: 'Monthly', options: this.opts(['Monthly', 'Quarterly', 'SemiAnnual', 'Annual']) },
          { key: 'deposit', label: 're.f.deposit', type: 'money', def: 0 }, { key: 'renewedTo', label: 're.f.renewedTo', calc: r => r.data['renewedTo'] ?? '' }, { key: 'notes', label: 'erp.f.notes', type: 'textarea' },
          { key: 'status', label: 'erp.f.status', type: 'status', table: true, lockOnEdit: true, def: 'Draft', options: this.st(['Draft', 'Active', 'Expired', 'Terminated']) }]
      }];
      case 're/installments': return [{
        kind: 'installment', canManage: false, newLabel: 're.ins.new', emptyKey: 'common.noData', statuses: ['Due', 'Partial', 'Paid', 'Cancelled'], scopeBranch: true,
        actions: [{ label: 're.a.collect', show: r => (r.status === 'Due' || r.status === 'Partial') && this.can('re.collect'), run: r => this.openRe(r, 'collect', 're.a.collect', ['amount', 'method', 'note']) }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true }, { key: 'lease', label: 're.f.lease', table: true }, { key: 'unit', label: 're.f.unit', table: true }, { key: 'tenant', label: 're.f.tenant', table: true },
          { key: 'dueDate', label: 'erp.f.due', type: 'date', table: true }, { key: 'amount', label: 're.f.amount', type: 'money', table: true }, { key: 'paid', label: 're.f.paid', type: 'money', table: true },
          { key: 'balance', label: 're.f.balance', type: 'money', table: true, calc: r => Math.max(0, (Number(r.data['amount']) || 0) - (Number(r.data['paid']) || 0)) },
          { key: 'status', label: 'erp.f.status', type: 'status', table: true, lockOnEdit: true, def: 'Due', options: this.st(['Due', 'Partial', 'Paid', 'Cancelled']) }]
      }];
      case 're/sales': return [{
        kind: 'sale', canManage: this.can('re.sales.manage'), newLabel: 're.sale.new', emptyKey: 'common.noData', statuses: ['Reservation', 'Contract', 'Completed', 'Cancelled'], scopeBranch: true,
        editable: r => r.status === 'Reservation',
        actions: [
          { label: 're.a.contract', show: r => r.status === 'Reservation', run: r => this.quickRe(r, 'contract') },
          { label: 're.a.complete', show: r => r.status === 'Contract', run: r => this.quickRe(r, 'complete') },
          { label: 're.a.cancel', danger: true, show: r => r.status === 'Reservation' || r.status === 'Contract', run: r => this.openRe(r, 'cancel', 're.a.cancel', ['note'], 're.m.reason') }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'unit', label: 're.f.unit', type: 'select', required: true, table: true, options: () => this.reUnitOpts() },
          { key: 'buyer', label: 're.f.buyer', required: true, table: true }, { key: 'buyerPhone', label: 're.f.phone' }, { key: 'price', label: 're.f.price', type: 'money', required: true, table: true, def: 0 },
          { key: 'deposit', label: 're.f.deposit', type: 'money', table: true, def: 0 }, { key: 'agent', label: 're.f.agent', type: 'select', options: () => this.userOpts() },
          { key: 'date', label: 'erp.f.date', type: 'date', table: true, def: today }, { key: 'notes', label: 'erp.f.notes', type: 'textarea' },
          { key: 'status', label: 'erp.f.status', type: 'status', table: true, lockOnEdit: true, def: 'Reservation', options: this.st(['Reservation', 'Contract', 'Completed', 'Cancelled']) }]
      }];
      case 're/requests': return [{
        kind: 'request', canManage: this.can('re.maintenance.manage'), newLabel: 're.req.new', emptyKey: 'common.noData', statuses: ['New', 'Assigned', 'InProgress', 'Done', 'Cancelled'], scopeBranch: true,
        editable: r => r.status !== 'Done',
        actions: [
          { label: 're.a.assign', show: r => r.status === 'New' || r.status === 'Assigned', run: r => this.openRe(r, 'assign', 're.a.assign', ['user']) },
          { label: 're.a.start', show: r => r.status === 'New' || r.status === 'Assigned', run: r => this.quickRe(r, 'start') },
          { label: 're.a.finish', show: r => r.status === 'New' || r.status === 'Assigned' || r.status === 'InProgress', run: r => this.openRe(r, 'complete', 're.a.finish', ['cost', 'note'], 're.m.resolution') }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'title', label: 're.f.title', required: true, table: true },
          { key: 'property', label: 're.f.property', type: 'select', table: true, options: this.reOpts('property', 'name') }, { key: 'unit', label: 're.f.unit', type: 'select', table: true, options: () => this.reUnitOpts() },
          { key: 'category', label: 're.f.category', type: 'select', def: 'Plumbing', options: this.opts(['Plumbing', 'Electrical', 'AirConditioning', 'Cleaning', 'Painting', 'Security', 'Other']) },
          { key: 'priority', label: 're.f.priority', type: 'select', table: true, def: 'Normal', options: this.opts(['Low', 'Normal', 'High', 'Urgent']) }, { key: 'reportedBy', label: 're.f.reportedBy' },
          { key: 'assignedTo', label: 're.f.assignedTo', type: 'select', table: true, options: () => this.userOpts() }, { key: 'cost', label: 're.f.cost', type: 'money', table: true, def: 0 },
          this.statusField(['New', 'Assigned', 'InProgress', 'Done', 'Cancelled'], 'New'), { key: 'notes', label: 'erp.f.notes', type: 'textarea' }]
      }];

      // ---------------------------------------------------------------- warehouse: batches, serials, expiry
      case 'wh/lots': return [{
        kind: 'lot', canManage: this.can('wh.lots.manage'), newLabel: 'wh.lot.new', emptyKey: 'wh.lot.none', statuses: ['Active', 'Quarantine', 'Depleted', 'Expired'], scopeBranch: true, editable: r => r.status !== 'Depleted',
        actions: [
          { label: 'wh.lot.quarantine', show: r => r.status === 'Active' && this.can('wh.lots.manage'), run: r => this.lotAct(r, 'quarantine') },
          { label: 'wh.lot.release', show: r => r.status === 'Quarantine' && this.can('wh.lots.manage'), run: r => this.lotAct(r, 'release') },
          { label: 'wh.lot.writeoff', danger: true, show: r => (r.status === 'Active' || r.status === 'Quarantine') && Number(r.data['qty']) > 0 && this.can('wh.count.approve'), run: r => this.lotAct(r, 'writeoff') }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' },
          { key: 'sku', label: 'mfg.f.product', type: 'select', required: true, table: true, lockOnEdit: true, options: () => this.itemOpts() },
          { key: 'batchNo', label: 'wh.lot.batch', required: true, table: true, lockOnEdit: true },
          { key: 'qty', label: 'erp.f.qty', type: 'number', table: true, def: 0 },
          { key: 'expiry', label: 'wh.lot.expiry', type: 'date', table: true }, { key: 'mfgDate', label: 'wh.lot.mfg', type: 'date' },
          { key: 'serialCount', label: 'wh.lot.serials', type: 'number', table: true, calc: r => Array.isArray(r.data['serials']) ? r.data['serials'].length : 0 },
          { key: 'serials', label: 'wh.lot.serialsList', type: 'textarea', hint: 'wh.lot.serialsHint' },
          this.statusField(['Active', 'Quarantine', 'Depleted', 'Expired'], 'Active')]
      }];
      case 'wh/tracking': return [{
        kind: 'trackrule', canManage: this.can('wh.setup'), newLabel: 'wh.track.new', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [
          { key: 'ref', label: 'mfg.f.product', type: 'select', store: 'ref', required: true, table: true, lockOnEdit: true, options: () => this.itemOpts() },
          { key: 'tracking', label: 'wh.track.mode', type: 'select', required: true, table: true, def: 'batch', options: () => [{ value: 'batch', label: this.i18n.t('wh.track.batch') }, { value: 'serial', label: this.i18n.t('wh.track.serial') }] },
          { key: 'shelfLifeDays', label: 'wh.track.shelf', type: 'number', table: true, def: 0, hint: 'wh.track.shelfHint' },
          { key: 'minExpiryDays', label: 'wh.track.minExpiry', type: 'number', table: true, def: 0, hint: 'wh.track.minExpiryHint' },
          { key: 'requireExpiry', label: 'wh.track.requireExpiry', type: 'bool' }, this.statusField(ACTIVE, 'Active')]
      }];

      // ---------------------------------------------------------------- governance
      case 'gov/approvals': return [{
        kind: 'approval', canManage: false, newLabel: 'erp.new', emptyKey: 'gov.appr.none', statuses: ['Pending', 'Approved', 'Rejected', 'Cancelled'], editable: () => false,
        actions: [
          { label: 'gov.act.approve', show: r => r.status === 'Pending' && !!r.data['canAct'], run: r => this.govAct(r, 'approve') },
          { label: 'gov.act.reject', danger: true, show: r => r.status === 'Pending' && !!r.data['canAct'], run: r => this.govAct(r, 'reject') },
          { label: 'gov.act.reassign', show: r => r.status === 'Pending' && !!r.data['canAct'], run: r => this.govAct(r, 'reassign') },
          { label: 'gov.act.cancel', danger: true, show: r => r.status === 'Pending' && (!!r.data['mine'] || this.can('gov.approvals.admin')), run: r => this.govAct(r, 'cancel') }],
        fields: [
          { key: 'code', label: 'erp.f.code', table: true }, { key: 'target', label: 'gov.f.target', table: true, calc: r => r.parent },
          { key: 'recordCode', label: 'gov.f.record', table: true, calc: r => r.data['recordCode'] }, { key: 'trigger', label: 'gov.f.trigger', calc: r => r.data['trigger'] },
          { key: 'amount', label: 'gov.f.amount', type: 'money', table: true, calc: r => r.data['amount'] },
          { key: 'requestedBy', label: 'gov.f.requestedBy', table: true, calc: r => this.userName(r.data['requestedBy']) },
          { key: 'step', label: 'gov.f.step', table: true, calc: r => { const s = (r.data['steps'] ?? []) as any[]; const c = Number(r.data['current']) || 0; return r.status === 'Pending' && s[c] ? `${c + 1}/${s.length} · ${s[c].label || s[c].user || s[c].privilege}${r.data['overdue'] ? ' ⚠' : ''}` : `${s.length}/${s.length}`; } },
          this.statusField(['Pending', 'Approved', 'Rejected', 'Cancelled'], 'Pending')]
      }];
      case 'gov/rules': return [{
        kind: 'rule', canManage: this.can('gov.rules.manage'), newLabel: 'gov.rule.new', emptyKey: 'gov.rule.none', statuses: ACTIVE,
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' }, { key: 'name', label: 'erp.f.name', required: true, table: true },
          { key: 'target', label: 'gov.f.target', type: 'select', required: true, table: true, options: () => GOV_TARGETS.map(t => ({ value: t.value, label: `${t.label} (${t.value})` })),
            onChange: f => { const t = GOV_TARGETS.find(x => x.value === f['target']); if (t) f['trigger'] = t.trigger; } },
          { key: 'trigger', label: 'gov.f.trigger', type: 'select', def: 'Approved', options: () => ['Approved', 'Posted', 'Paid', 'Active', 'Published'].map(v => ({ value: v, label: v })), hint: 'gov.rule.triggerHint' },
          { key: 'minAmount', label: 'gov.f.min', type: 'money', def: 0, table: true }, { key: 'maxAmount', label: 'gov.f.max', type: 'money', def: 0, table: true, hint: 'gov.rule.maxHint' },
          { key: 'amountField', label: 'gov.f.amountField', hint: 'gov.rule.amountFieldHint' },
          { key: 'stepCount', label: 'gov.f.steps', type: 'number', table: true, calc: r => (r.data['steps'] ?? []).length },
          { key: 'steps', label: 'gov.f.steps', type: 'lines', cols: [
            { key: 'label', label: 'gov.f.stepLabel', width: '170px' },
            { key: 'privilege', label: 'gov.f.stepPriv', type: 'select', options: () => GOV_APPROVER_PRIVS.map(p => ({ value: p, label: p })) },
            { key: 'user', label: 'gov.f.stepUser', type: 'select', options: () => this.userOpts() }] },
          { key: 'escalateAfterHours', label: 'gov.f.escHours', type: 'number', def: 0, hint: 'gov.rule.escHint' },
          { key: 'escalateTo', label: 'gov.f.escTo', type: 'select', options: () => this.userOpts() },
          { key: 'allowSelf', label: 'gov.f.allowSelf', type: 'bool' }, this.statusField(ACTIVE, 'Active')]
      }];
      case 'gov/delegation': return [{
        kind: 'delegation', canManage: this.can('gov.delegate'), newLabel: 'gov.dl.new', emptyKey: 'gov.dl.none', statuses: ACTIVE,
        filter: r => this.can('gov.rules.manage') || r.data['from'] === this.me() || r.createdBy === this.me(),
        fields: [
          { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' },
          { key: 'from', label: 'gov.f.from', table: true, calc: r => this.userName(r.data['from']) },
          { key: 'to', label: 'gov.f.to', type: 'select', required: true, table: true, options: () => this.userOpts() },
          { key: 'fromDate', label: 'gov.f.fromDate', type: 'date', required: true, table: true, def: today }, { key: 'toDate', label: 'gov.f.toDate', type: 'date', required: true, table: true, def: today },
          { key: 'scope', label: 'gov.f.scope', type: 'select', options: () => GOV_TARGETS.map(t => ({ value: t.value, label: `${t.label} (${t.value})` })), hint: 'gov.dl.scopeHint' },
          this.statusField(ACTIVE, 'Active')]
      }];
      case 'gov/audit': return [{
        kind: 'audit', canManage: false, newLabel: 'erp.new', emptyKey: 'gov.audit.none', statuses: ['Created', 'Updated', 'StatusChanged', 'Deleted'], editable: () => false,
        fields: [
          { key: 'at', label: 'gov.f.when', table: true, calc: r => r.createdAt ? new Date(r.createdAt.endsWith('Z') ? r.createdAt : r.createdAt + 'Z').toLocaleString() : '' },
          { key: 'record', label: 'gov.f.record', table: true, calc: r => `${r.parent ?? ''} · ${r.code ?? ''}` },
          { key: 'by', label: 'gov.f.by', table: true, calc: r => this.userName(r.createdBy ?? '') },
          { key: 'changes', label: 'gov.f.changes', table: true, calc: r => ((r.data['changes'] ?? []) as any[]).slice(0, 4).map(c => `${c.f}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' · ') },
          this.statusField(['Created', 'Updated', 'StatusChanged', 'Deleted'], 'Created')]
      }];
      case 'gov/fields': return [{
        kind: 'customfield', canManage: this.can('gov.fields.manage'), newLabel: 'gov.cf.new', emptyKey: 'gov.cf.none', statuses: ACTIVE,
        fields: [
          { key: 'target', label: 'gov.f.target', type: 'select', required: true, table: true, lockOnEdit: true, options: () => GOV_FIELD_TARGETS.map(v => ({ value: v, label: v })) },
          { key: 'key', label: 'gov.cf.key', required: true, table: true, lockOnEdit: true, hint: 'gov.cf.keyHint' },
          { key: 'labelEn', label: 'gov.cf.labelEn', required: true, table: true }, { key: 'labelAr', label: 'gov.cf.labelAr', rtl: true },
          { key: 'type', label: 'gov.cf.type', type: 'select', required: true, table: true, def: 'text', options: () => ['text', 'number', 'date', 'select', 'bool'].map(v => ({ value: v, label: this.i18n.t('gov.cf.t.' + v) })) },
          { key: 'options', label: 'gov.cf.options', show: f => f['type'] === 'select', hint: 'gov.cf.optionsHint' },
          { key: 'required', label: 'gov.cf.required', type: 'bool', table: true }, { key: 'order', label: 'gov.cf.order', type: 'number', def: 10 },
          this.statusField(ACTIVE, 'Active')]
      }];
      case 'gov/lock': return [{
        kind: 'setting', canManage: this.can('gov.lock.manage'), newLabel: 'gov.lock.new', emptyKey: 'gov.lock.none',
        fields: [
          { key: 'code', label: 'erp.f.code', required: true, table: true, lockOnEdit: true, def: 'lock', hint: 'gov.lock.codeHint' },
          { key: 'lockedThrough', label: 'gov.lock.through', type: 'date', table: true, hint: 'gov.lock.throughHint' },
          { key: 'useFinancePeriods', label: 'gov.lock.useFin', type: 'bool', def: true, table: true }]
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
