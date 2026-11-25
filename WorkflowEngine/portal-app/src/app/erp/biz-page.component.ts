import { Component, OnInit, QueryList, ViewChildren, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { ErpService } from '../core/erp.service';
import { I18nService } from '../core/i18n.service';
import { ErpKind, ErpLookup, ErpModule, ErpRec } from '../core/erp.models';
import { TranslatePipe } from '../core/translate.pipe';
import { errMsg } from '../hr/hr-util';
import { ErpAction, ErpCrudComponent, ErpField } from './erp-crud.component';

interface Section {
  kind: ErpKind; title?: string; fields: ErpField[]; canManage: boolean; newLabel: string; emptyKey: string; statuses?: string[];
  actions?: ErpAction[]; editable?: (r: ErpRec) => boolean; scopeBranch?: boolean; filter?: (r: ErpRec) => boolean;
}
interface Dlg { rec: ErpRec; op: string; title: string; fields: string[]; noteLabel: string; note: string; user: string; amount: number | null; cost: number | null; method: string; lines: { sku: string; name: string; left: number; qty: number }[]; }

const today = () => new Date().toISOString().slice(0, 10);
const ACTIVE = ['Active', 'Inactive'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const PERIODS = ['Monthly', 'Quarterly', 'SemiAnnual', 'Annual'];
const PILL: Record<string, 'approved' | 'rejected' | 'pending' | 'canceled'> = {
  Confirmed: 'approved', PartiallyDelivered: 'pending', Delivered: 'approved', Invoiced: 'approved', Done: 'approved', Returned: 'canceled',
  Assigned: 'pending', InProgress: 'pending', Waiting: 'pending', Resolved: 'approved', Closed: 'canceled', Scheduled: 'pending',
  Expired: 'canceled', Paused: 'canceled', Paid: 'approved', Unpaid: 'pending', Void: 'canceled', Submitted: 'pending', Approved: 'approved', Rejected: 'rejected',
  Passed: 'approved', Failed: 'rejected', Investigating: 'pending', Corrected: 'approved', Open: 'rejected', InService: 'pending', Retired: 'canceled', Logged: 'approved',
};

/**
 * One page component for the six modules added from the Oracle / SAP / Dynamics / Odoo comparison:
 * Sales orders (so), Helpdesk + field service (hd), Subscriptions (sub), Expenses (exp), Quality (qa) and Fleet (flt).
 * Which list a page shows comes from the route (module + page); the server (ModulesController.Biz.cs) enforces every rule and privilege.
 */
@Component({
  selector: 'app-biz-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, ErpCrudComponent],
  template: `
    <p class="flash bad" *ngIf="error && !dlg">{{ error }}</p>
    <ng-container *ngFor="let s of sections; let i = index">
      <h3 class="h" *ngIf="s.title" [class.top]="i > 0">{{ s.title | translate }}</h3>
      <app-erp-crud [module]="module" [kind]="s.kind" [company]="ctx.company()" [fields]="s.fields" [canManage]="s.canManage" [newLabel]="s.newLabel" [emptyKey]="s.emptyKey"
        [statusFilter]="s.statuses || []" [actions]="s.actions || []" [editable]="s.editable || always" [scopeBranch]="!!s.scopeBranch" [filter]="s.filter || always" [pillMap]="pill" [autoNew]="i === 0" />
    </ng-container>

    <div class="modal-scrim" *ngIf="dlg" (click)="dlg = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ dlg.title | translate }} · {{ dlg.rec.code }}</h3></div>
        <div class="modal-body">
          <div *ngIf="dlg.fields.includes('lines')">
            <table class="data"><thead><tr><th>{{ 'biz.f.sku' | translate }}</th><th class="num">{{ 'biz.m.left' | translate }}</th><th style="width:110px">{{ 'biz.m.deliverNow' | translate }}</th></tr></thead>
              <tbody><tr *ngFor="let l of dlg.lines"><td>{{ l.sku }} {{ l.name }}</td><td class="num">{{ l.left }}</td><td><input type="number" step="any" min="0" [max]="l.left" [(ngModel)]="l.qty" /></td></tr></tbody></table>
          </div>
          <div *ngIf="dlg.fields.includes('user')"><label class="lbl">{{ 'biz.m.user' | translate }}</label>
            <select [(ngModel)]="dlg.user"><option value="">—</option><option *ngFor="let o of userOpts()" [value]="o.value">{{ o.label }}</option></select></div>
          <div *ngIf="dlg.fields.includes('amount')"><label class="lbl">{{ 'biz.m.hours' | translate }}</label><input type="number" step="0.25" [(ngModel)]="dlg.amount" /></div>
          <div *ngIf="dlg.fields.includes('cost')"><label class="lbl">{{ 'biz.m.cost' | translate }}</label><input type="number" step="0.01" [(ngModel)]="dlg.cost" /></div>
          <div *ngIf="dlg.fields.includes('method')"><label class="lbl">{{ 'biz.m.method' | translate }}</label>
            <select [(ngModel)]="dlg.method"><option *ngFor="let m of methods" [value]="m">{{ m }}</option></select></div>
          <div *ngIf="dlg.fields.includes('note')"><label class="lbl">{{ dlg.noteLabel | translate }}</label><input [(ngModel)]="dlg.note" /></div>
          <p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="dlg = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="submit()">{{ dlg.title | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`.h { margin: 0 0 10px; font-size: 14px; } .top { margin-top: 24px; }`]
})
export class BizPageComponent implements OnInit {
  auth = inject(AuthService); ctx = inject(ErpContextService); private erp = inject(ErpService); private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  module = this.route.snapshot.data['module'] as ErpModule;
  page = this.route.snapshot.data['page'] as string;
  @ViewChildren(ErpCrudComponent) cruds!: QueryList<ErpCrudComponent>;
  always = () => true;
  pill = PILL;
  methods = ['Cash', 'Transfer', 'Cheque', 'Card'];
  error = '';
  dlg: Dlg | null = null;
  users = signal<{ username: string; displayName: string }[]>([]);
  lk = signal<Record<string, ErpLookup[]>>({});
  sections: Section[] = [];

  ngOnInit() {
    const co = this.ctx.company();
    this.erp.users().subscribe(u => this.users.set(u));
    this.erp.lookup(this.module, 'customers', co).subscribe({ next: l => this.lk.update(x => ({ ...x, customers: l })), error: () => undefined });
    if (this.module === 'so' || this.module === 'qa') this.erp.loadItems(this.module, co).subscribe();
    const refs: Partial<Record<ErpModule, ErpKind[]>> = { so: ['pricelist'], hd: ['contract', 'ticket'], sub: ['plan'], exp: ['category'], qa: ['plan'], flt: ['vehicle', 'driver'] };
    for (const k of refs[this.module] ?? []) this.erp.refresh(this.module, k, co).subscribe();
    this.sections = this.build(`${this.module}/${this.page}`);
  }

  // ------------------------------------------------------------------ helpers
  private can = (p: string) => this.auth.can(p);
  private me = () => this.auth.currentUser()?.username ?? '';
  stl = (s: string) => { const k = 'erp.st.' + s; const t = this.i18n.t(k); return t === k ? s : t; };
  private st = (list: string[]) => () => list.map(s => ({ value: s, label: this.stl(s) }));
  private opts = (list: string[]) => () => list.map(s => ({ value: s, label: this.i18n.t('erp.o.' + s) === 'erp.o.' + s ? s : this.i18n.t('erp.o.' + s) }));
  userOpts = () => this.users().map(u => ({ value: u.username, label: u.displayName || u.username }));
  private userName = (u: any) => this.users().find(x => x.username === u)?.displayName ?? (u ?? '');
  /** hide = the status only moves through the action buttons, so the form doesn't offer it */
  private statusField = (list: string[], def: string, hide = false): ErpField => ({ key: 'status', label: 'erp.f.status', type: 'status', table: true, def, options: this.st(list), ...(hide ? { show: () => false } : {}) });
  private code = (): ErpField => ({ key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' });
  private f = (key: string, extra: Partial<ErpField> = {}): ErpField => ({ key, label: 'biz.f.' + key, ...extra });
  private custOpts = () => (this.lk()['customers'] ?? []).map(c => ({ value: c.code, label: c.name ? `${c.code} · ${c.name}` : c.code }));
  private refOpts = (kind: ErpKind, nameKey: string, activeOnly = true) => () => this.erp.ref(this.module, kind, this.ctx.company())
    .filter(c => !activeOnly || (c.status !== 'Inactive' && c.status !== 'Retired')).map(c => ({ value: c.code ?? '', label: `${c.code} · ${c.data[nameKey] ?? ''}` }));
  private itemOpts = () => this.erp.items().map(i => ({ value: i.sku, label: `${i.sku} · ${i.name}` }));
  private fmtDate = (v: any) => String(v ?? '').slice(0, 16).replace('T', ' ');
  /** customer: a pick-list of the finance customers when there are some, otherwise free text */
  private customerFields = (): ErpField[] => [
    this.f('customer', { type: 'select', required: true, table: true, options: this.custOpts, show: () => this.custOpts().length > 0 }),
    this.f('customer', { required: true, table: true, show: () => this.custOpts().length === 0 }),
  ];

  reload() { this.cruds?.forEach(c => c.reload()); }
  private run(r: ErpRec, op: string, body: any = {}) {
    this.error = '';
    this.erp.action(this.module, `bizact/${r.kind}/${r.id}/${op}`, body).subscribe({ next: () => { this.dlg = null; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  private quick = (r: ErpRec, op: string) => this.run(r, op);
  private ask(r: ErpRec, op: string, title: string, fields: string[], noteLabel = 'biz.m.note') {
    this.error = '';
    const lines = fields.includes('lines') ? ((r.data['lines'] ?? []) as any[]).map(l => { const left = Math.max(0, (Number(l.qty) || 0) - (Number(l.delivered) || 0)); return { sku: String(l.sku ?? ''), name: String(l.name ?? ''), left, qty: left }; }).filter(l => l.left > 0) : [];
    this.dlg = { rec: r, op, title, fields, noteLabel, note: '', user: '', amount: Number(r.data['hours']) || 0, cost: Number(r.data['cost']) || 0, method: 'Transfer', lines };
  }
  submit() {
    const d = this.dlg!;
    const body: any = { note: d.note || undefined, user: d.user || undefined, method: d.method };
    if (d.fields.includes('amount')) body.amount = Number(d.amount) || 0;
    if (d.fields.includes('cost')) body.cost = Number(d.cost) || 0;
    if (d.fields.includes('lines')) body.lines = d.lines.filter(l => Number(l.qty) > 0).map(l => ({ sku: l.sku, qty: Number(l.qty) }));
    this.run(d.rec, d.op, body);
  }
  /** one action button: a title key, who may see it, which statuses show it, and what it asks for (nothing = it just runs) */
  private act(op: string, statuses: string[], perm: string, fields: string[] = [], danger = false, noteLabel = 'biz.m.note', extra: (r: ErpRec) => boolean = () => true): ErpAction {
    return { label: 'biz.a.' + op, danger, show: r => statuses.includes(r.status ?? '') && this.can(perm) && extra(r),
      run: r => fields.length ? this.ask(r, op, 'biz.a.' + op, fields, noteLabel) : this.quick(r, op) };
  }

  // ------------------------------------------------------------------ the pages
  private build(key: string): Section[] {
    const f = this.f; const code = this.code; const notes = () => f('notes', { type: 'textarea' });
    const can = this.can; const draftOnly = (r: ErpRec) => r.status === 'Draft';
    switch (key) {
      // ---------------------------------------------------------------- sales orders
      case 'so/orders': return [{
        kind: 'order', canManage: can('so.orders.manage'), newLabel: 'biz.new.order', emptyKey: 'common.noData', scopeBranch: true,
        statuses: ['Draft', 'Confirmed', 'PartiallyDelivered', 'Delivered', 'Invoiced', 'Cancelled'], editable: draftOnly,
        actions: [this.act('confirm', ['Draft'], 'so.orders.approve'), this.act('deliver', ['Confirmed', 'PartiallyDelivered'], 'so.orders.manage', ['lines', 'note']),
          this.act('invoice', ['Delivered'], 'so.orders.manage', ['note'], false, 'biz.f.invoiceNo'), this.act('cancel', ['Draft', 'Confirmed'], 'so.orders.manage', ['note'], true, 'biz.m.reason')],
        fields: [code(), ...this.customerFields(), f('orderDate', { type: 'date', table: true, def: today() }), f('deliveryDate', { type: 'date' }),
          f('pricelist', { type: 'select', options: this.refOpts('pricelist', 'name') }), f('discountPct', { type: 'number', def: 0 }), f('taxPct', { type: 'number', def: 15 }),
          { key: 'lines', label: 'biz.f.lines', type: 'lines', cols: [
            { key: 'sku', label: 'biz.f.sku', type: 'select', options: this.itemOpts, width: '200px' }, { key: 'name', label: 'erp.f.name' },
            { key: 'qty', label: 'biz.f.qty', type: 'number', def: 1, width: '80px' }, { key: 'price', label: 'biz.f.price', type: 'number', def: 0, width: '100px' },
            { key: 'discountPct', label: 'biz.f.discountPct', type: 'number', def: 0, width: '80px' }],
            onChange: form => { for (const l of (form['lines'] ?? []) as any[]) { const it = this.erp.items().find(i => i.sku === l.sku); if (it) { if (!l.name) l.name = it.name; if (!Number(l.price)) l.price = it.price; } } } },
          { key: 'total', label: 'biz.f.total', type: 'money', table: true, calc: r => Number(r.data['total']) || 0 },
          this.statusField(['Draft', 'Confirmed', 'PartiallyDelivered', 'Delivered', 'Invoiced', 'Cancelled'], 'Draft', true), notes()],
      }];
      case 'so/deliveries': return [{
        kind: 'delivery', canManage: false, newLabel: 'biz.new.delivery', emptyKey: 'common.noData', statuses: ['Done', 'Returned'],
        fields: [code(), { key: 'order', label: 'biz.f.order', table: true, calc: r => r.ref ?? r.data['order'] ?? '' }, { key: 'customer', label: 'biz.f.customer', table: true, calc: r => r.data['customer'] ?? '' },
          { key: 'deliveredAt', label: 'biz.f.deliveredAt', table: true, calc: r => this.fmtDate(r.data['deliveredAt']) }, { key: 'deliveredBy', label: 'biz.f.deliveredBy', table: true, calc: r => this.userName(r.data['deliveredBy']) },
          this.statusField(['Done', 'Returned'], 'Done')],
      }];
      case 'so/pricelists': return [{
        kind: 'pricelist', canManage: can('so.setup'), newLabel: 'biz.new.pricelist', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [code(), f('name', { label: 'erp.f.name', required: true, table: true }), f('currency', { table: true }), f('discountPct', { type: 'number', table: true, def: 0 }),
          f('validFrom', { type: 'date' }), f('validTo', { type: 'date' }), this.statusField(ACTIVE, 'Active'), notes()],
      }];
      // ---------------------------------------------------------------- helpdesk + field service
      case 'hd/tickets': return [{
        kind: 'ticket', canManage: can('hd.tickets.manage'), newLabel: 'biz.new.ticket', emptyKey: 'common.noData', scopeBranch: true,
        statuses: ['New', 'Assigned', 'InProgress', 'Waiting', 'Resolved', 'Closed', 'Cancelled'], editable: r => !['Closed', 'Cancelled'].includes(r.status ?? ''),
        actions: [this.act('assign', ['New', 'Assigned', 'InProgress', 'Waiting'], 'hd.tickets.manage', ['user']), this.act('start', ['New', 'Assigned', 'Waiting'], 'hd.tickets.manage'),
          this.act('wait', ['InProgress'], 'hd.tickets.manage', ['note']), this.act('resolve', ['New', 'Assigned', 'InProgress', 'Waiting'], 'hd.tickets.manage', ['note'], false, 'biz.f.resolution'),
          this.act('close', ['Resolved'], 'hd.tickets.manage'), this.act('reopen', ['Resolved', 'Closed'], 'hd.tickets.manage'),
          this.act('cancel', ['New', 'Assigned', 'Waiting'], 'hd.tickets.manage', ['note'], true, 'biz.m.reason')],
        fields: [code(), f('subject', { required: true, table: true }), f('customer', { table: true }), f('contact'),
          f('priority', { type: 'select', table: true, def: 'Normal', options: this.opts(PRIORITIES) }),
          f('category', { type: 'select', options: this.opts(['Question', 'Incident', 'Request', 'Complaint']) }),
          f('contract', { type: 'select', options: this.refOpts('contract', 'customer') }), f('description', { type: 'textarea' }),
          { key: 'assignedTo', label: 'biz.f.assignedTo', table: true, calc: r => this.userName(r.data['assignedTo']) },
          { key: 'dueAt', label: 'biz.f.dueAt', table: true, calc: r => this.fmtDate(r.data['dueAt']) },
          this.statusField(['New', 'Assigned', 'InProgress', 'Waiting', 'Resolved', 'Closed', 'Cancelled'], 'New', true)],
      }];
      case 'hd/visits': return [{
        kind: 'visit', canManage: can('hd.visits.manage'), newLabel: 'biz.new.visit', emptyKey: 'common.noData', scopeBranch: true, statuses: ['Scheduled', 'InProgress', 'Done', 'Cancelled'], editable: r => r.status === 'Scheduled',
        actions: [this.act('start', ['Scheduled'], 'hd.visits.manage'), this.act('complete', ['InProgress'], 'hd.visits.manage', ['amount', 'cost', 'note'], false, 'biz.f.resolution'),
          this.act('cancel', ['Scheduled', 'InProgress'], 'hd.visits.manage', ['note'], true, 'biz.m.reason')],
        fields: [code(), f('ticket', { type: 'select', table: true, options: this.refOpts('ticket', 'subject', false) }), f('customer', { table: true }),
          f('technician', { type: 'select', required: true, table: true, options: this.userOpts }), f('date', { type: 'date', required: true, table: true, def: today() }),
          f('address'), { key: 'hours', label: 'biz.f.hours', calc: r => r.data['hours'] ?? '' }, { key: 'cost', label: 'biz.f.cost', type: 'money', calc: r => Number(r.data['cost']) || 0 },
          this.statusField(['Scheduled', 'InProgress', 'Done', 'Cancelled'], 'Scheduled', true), notes()],
      }];
      case 'hd/contracts': return [{
        kind: 'contract', canManage: can('hd.contracts.manage'), newLabel: 'biz.new.contract', emptyKey: 'common.noData', statuses: ['Active', 'Expired', 'Cancelled'],
        fields: [code(), ...this.customerFields(), f('startDate', { type: 'date', required: true, table: true, def: today() }), f('endDate', { type: 'date', required: true, table: true }),
          f('value', { type: 'money', table: true, def: 0 }), f('coverage', { type: 'textarea' }), this.statusField(['Active', 'Expired', 'Cancelled'], 'Active')],
      }];
      case 'hd/sla': return [{
        kind: 'sla', canManage: can('hd.setup'), newLabel: 'biz.new.sla', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [code(), f('priority', { type: 'select', required: true, table: true, def: 'Normal', options: this.opts(PRIORITIES) }), f('responseHours', { type: 'number', table: true, def: 4 }),
          f('resolveHours', { type: 'number', table: true, def: 24 }), this.statusField(ACTIVE, 'Active')],
      }];
      // ---------------------------------------------------------------- subscriptions
      case 'sub/subscriptions': return [{
        kind: 'subscription', canManage: can('sub.manage'), newLabel: 'biz.new.subscription', emptyKey: 'common.noData', scopeBranch: true, statuses: ['Draft', 'Active', 'Paused', 'Cancelled'], editable: r => r.status === 'Draft' || r.status === 'Paused',
        actions: [this.act('activate', ['Draft'], 'sub.manage'), this.act('bill', ['Active'], 'sub.billing.manage'), this.act('pause', ['Active'], 'sub.manage'), this.act('resume', ['Paused'], 'sub.manage'),
          this.act('cancel', ['Draft', 'Active', 'Paused'], 'sub.manage', ['note'], true, 'biz.m.reason')],
        fields: [code(), ...this.customerFields(), f('plan', { type: 'select', required: true, table: true, options: this.refOpts('plan', 'name') }),
          f('startDate', { type: 'date', required: true, table: true, def: today() }), f('qty', { type: 'number', def: 1 }), f('price', { type: 'money', def: 0, hint: 'biz.priceHint' }),
          { key: 'nextBillDate', label: 'biz.f.nextBillDate', table: true, calc: r => r.data['nextBillDate'] ?? '' }, { key: 'billedCount', label: 'biz.f.billedCount', calc: r => r.data['billedCount'] ?? 0 },
          this.statusField(['Draft', 'Active', 'Paused', 'Cancelled'], 'Draft', true), notes()],
      }];
      case 'sub/invoices': return [{
        kind: 'invoice', canManage: false, newLabel: 'biz.new.invoice', emptyKey: 'common.noData', statuses: ['Unpaid', 'Paid', 'Void'],
        actions: [this.act('markpaid', ['Unpaid'], 'sub.billing.manage', ['method']), this.act('void', ['Unpaid'], 'sub.billing.manage', ['note'], true, 'biz.m.reason')],
        fields: [code(), { key: 'subscription', label: 'biz.f.subscription', table: true, calc: r => r.ref ?? r.data['subscription'] ?? '' }, { key: 'customer', label: 'biz.f.customer', table: true, calc: r => r.data['customer'] ?? '' },
          { key: 'amount', label: 'biz.f.amount', type: 'money', table: true, calc: r => Number(r.data['amount']) || 0 }, { key: 'periodFrom', label: 'biz.f.periodFrom', table: true, calc: r => r.data['periodFrom'] ?? '' },
          { key: 'dueDate', label: 'biz.f.dueDate', table: true, calc: r => r.data['dueDate'] ?? '' }, this.statusField(['Unpaid', 'Paid', 'Void'], 'Unpaid')],
      }];
      case 'sub/plans': return [{
        kind: 'plan', canManage: can('sub.setup'), newLabel: 'biz.new.plan', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [code(), f('name', { label: 'erp.f.name', required: true, table: true }), f('period', { type: 'select', required: true, table: true, def: 'Monthly', options: this.opts(PERIODS) }),
          f('price', { type: 'money', table: true, def: 0 }), f('trialDays', { type: 'number', def: 0 }), f('description', { type: 'textarea' }), this.statusField(ACTIVE, 'Active')],
      }];
      // ---------------------------------------------------------------- expenses
      case 'exp/claims': return [{
        kind: 'claim', canManage: can('exp.claims.manage'), newLabel: 'biz.new.claim', emptyKey: 'common.noData', scopeBranch: true, statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Paid'], editable: r => r.status === 'Draft' || r.status === 'Rejected',
        actions: [this.act('submit', ['Draft', 'Rejected'], 'exp.claims.manage'), this.act('approve', ['Submitted'], 'exp.approve', [], false, 'biz.m.note', r => r.createdBy !== this.me()),
          this.act('reject', ['Submitted'], 'exp.approve', ['note'], true, 'biz.m.reason'), this.act('pay', ['Approved'], 'exp.pay', ['method'])],
        fields: [code(), f('title', { required: true, table: true }), { key: 'claimant', label: 'biz.f.claimant', table: true, calc: r => this.userName(r.createdBy) },
          { key: 'lines', label: 'biz.f.lines', type: 'lines', cols: [
            { key: 'date', label: 'biz.f.date', type: 'date', def: today(), width: '140px' }, { key: 'category', label: 'biz.f.category', type: 'select', options: this.refOpts('category', 'name'), width: '170px' },
            { key: 'description', label: 'biz.f.description' }, { key: 'amount', label: 'biz.f.amount', type: 'number', def: 0, width: '100px' }, { key: 'receipt', label: 'biz.f.receipt', type: 'bool', width: '70px' }] },
          { key: 'total', label: 'biz.f.total', type: 'money', table: true, calc: r => Number(r.data['total']) || 0 },
          { key: 'rejectReason', label: 'biz.f.rejectReason', calc: r => r.data['rejectReason'] ?? '' },
          this.statusField(['Draft', 'Submitted', 'Approved', 'Rejected', 'Paid'], 'Draft', true), notes()],
      }];
      case 'exp/categories': return [{
        kind: 'category', canManage: can('exp.setup'), newLabel: 'biz.new.category', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [code(), f('name', { label: 'erp.f.name', required: true, table: true }), f('limit', { type: 'money', table: true, def: 0, hint: 'biz.limitHint' }),
          f('requiresReceipt', { type: 'bool', table: true }), this.statusField(ACTIVE, 'Active')],
      }];
      // ---------------------------------------------------------------- quality
      case 'qa/inspections': return [{
        kind: 'inspection', canManage: can('qa.inspections.manage'), newLabel: 'biz.new.inspection', emptyKey: 'common.noData', scopeBranch: true, statuses: ['Pending', 'Passed', 'Failed'], editable: r => r.status === 'Pending',
        actions: [this.act('evaluate', ['Pending'], 'qa.inspections.manage', [], false, 'biz.m.note', r => ((r.data['lines'] ?? []) as any[]).length > 0), this.act('pass', ['Pending'], 'qa.inspections.manage'),
          this.act('fail', ['Pending'], 'qa.inspections.manage', ['note'], true, 'biz.m.reason')],
        fields: [code(), f('plan', { type: 'select', required: true, table: true, options: this.refOpts('plan', 'name') }), f('source', { table: true, hint: 'biz.sourceHint' }), f('lotNo'), f('qty', { type: 'number', def: 1 }),
          { key: 'lines', label: 'biz.f.results', type: 'lines', cols: [{ key: 'check', label: 'biz.f.check' }, { key: 'value', label: 'biz.f.value', type: 'number', def: 0, width: '120px' }] },
          { key: 'failedChecks', label: 'biz.f.failedChecks', table: true, calc: r => r.data['failedChecks'] ?? '' }, { key: 'ncr', label: 'biz.f.ncr', table: true, calc: r => r.data['ncr'] ?? '' },
          this.statusField(['Pending', 'Passed', 'Failed'], 'Pending', true), notes()],
      }];
      case 'qa/ncr': return [{
        kind: 'ncr', canManage: can('qa.ncr.manage'), newLabel: 'biz.new.ncr', emptyKey: 'common.noData', scopeBranch: true, statuses: ['Open', 'Investigating', 'Corrected', 'Closed'], editable: r => r.status !== 'Closed',
        actions: [this.act('investigate', ['Open'], 'qa.ncr.manage', ['user']), this.act('correct', ['Open', 'Investigating'], 'qa.ncr.manage', ['note'], false, 'biz.f.correctiveAction'), this.act('close', ['Corrected'], 'qa.ncr.approve')],
        fields: [code(), f('title', { required: true, table: true }), f('source', { table: true }), f('severity', { type: 'select', table: true, def: 'Minor', options: this.opts(['Minor', 'Major', 'Critical']) }),
          f('description', { type: 'textarea' }), f('cost', { type: 'money', def: 0 }), { key: 'owner', label: 'biz.f.owner', table: true, calc: r => this.userName(r.data['owner']) },
          { key: 'correctiveAction', label: 'biz.f.correctiveAction', calc: r => r.data['correctiveAction'] ?? '' }, this.statusField(['Open', 'Investigating', 'Corrected', 'Closed'], 'Open', true)],
      }];
      case 'qa/plans': return [{
        kind: 'plan', canManage: can('qa.setup'), newLabel: 'biz.new.qplan', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [code(), f('name', { label: 'erp.f.name', required: true, table: true }), f('product', { type: 'select', table: true, options: this.itemOpts }), f('sampleSize', { type: 'number', def: 1 }),
          { key: 'lines', label: 'biz.f.checks', type: 'lines', cols: [{ key: 'name', label: 'erp.f.name' }, { key: 'min', label: 'biz.f.min', type: 'number', width: '100px' }, { key: 'max', label: 'biz.f.max', type: 'number', width: '100px' }, { key: 'unit', label: 'biz.f.unit', width: '90px' }] },
          this.statusField(ACTIVE, 'Active')],
      }];
      // ---------------------------------------------------------------- fleet
      case 'flt/vehicles': return [{
        kind: 'vehicle', canManage: can('flt.vehicles.manage'), newLabel: 'biz.new.vehicle', emptyKey: 'common.noData', scopeBranch: true, statuses: ['Active', 'InService', 'Retired'],
        fields: [code(), f('plate', { required: true, table: true }), f('make', { table: true }), f('model', { table: true }), f('year', { type: 'number' }),
          f('type', { type: 'select', options: this.opts(['Car', 'Van', 'Truck', 'Bus', 'Motorbike', 'Other']) }), f('odometer', { type: 'number', table: true, def: 0 }),
          f('driver', { type: 'select', table: true, options: this.refOpts('driver', 'name') }), f('insuranceExpiry', { type: 'date' }), f('registrationExpiry', { type: 'date' }),
          this.statusField(['Active', 'InService', 'Retired'], 'Active'), notes()],
      }];
      case 'flt/drivers': return [{
        kind: 'driver', canManage: can('flt.drivers.manage'), newLabel: 'biz.new.driver', emptyKey: 'common.noData', statuses: ACTIVE,
        fields: [code(), f('name', { label: 'erp.f.name', required: true, table: true }), f('licenseNo', { table: true }), f('licenseExpiry', { type: 'date', table: true }), f('phone', { table: true }),
          f('user', { type: 'select', options: this.userOpts }), this.statusField(ACTIVE, 'Active')],
      }];
      case 'flt/fuel': return [{
        kind: 'fuel', canManage: can('flt.logs.manage'), newLabel: 'biz.new.fuel', emptyKey: 'common.noData', scopeBranch: true, statuses: [],
        fields: [code(), f('vehicle', { type: 'select', required: true, table: true, options: this.refOpts('vehicle', 'plate') }), f('date', { type: 'date', required: true, table: true, def: today() }),
          f('liters', { type: 'number', required: true, table: true, def: 0 }), f('pricePerLiter', { type: 'money', def: 0 }), f('odometer', { type: 'number', table: true, def: 0 }), f('station'),
          { key: 'cost', label: 'biz.f.cost', type: 'money', table: true, calc: r => Number(r.data['cost']) || 0 }],
      }];
      case 'flt/service': return [{
        kind: 'service', canManage: can('flt.service.manage'), newLabel: 'biz.new.service', emptyKey: 'common.noData', scopeBranch: true, statuses: ['Scheduled', 'InProgress', 'Done', 'Cancelled'], editable: r => r.status === 'Scheduled',
        actions: [this.act('start', ['Scheduled'], 'flt.service.manage'), this.act('complete', ['InProgress'], 'flt.service.manage', ['cost', 'note'], false, 'biz.f.resolution'),
          this.act('cancel', ['Scheduled', 'InProgress'], 'flt.service.manage', ['note'], true, 'biz.m.reason')],
        fields: [code(), f('vehicle', { type: 'select', required: true, table: true, options: this.refOpts('vehicle', 'plate') }),
          f('type', { type: 'select', required: true, table: true, def: 'Oil change', options: this.opts(['Oil change', 'Tires', 'Brakes', 'Inspection', 'Repair', 'Other']) }),
          f('date', { type: 'date', table: true, def: today() }), f('odometer', { type: 'number', def: 0 }), f('vendor'), f('cost', { type: 'money', table: true, def: 0 }), f('nextDueDate', { type: 'date', table: true }),
          this.statusField(['Scheduled', 'InProgress', 'Done', 'Cancelled'], 'Scheduled', true), notes()],
      }];
    }
    return [];
  }
}
