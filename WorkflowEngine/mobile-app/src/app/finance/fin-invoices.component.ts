import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { FinPostingService } from '../core/fin-posting.service';
import { I18nService } from '../core/i18n.service';
import { FinRec } from '../core/fin.models';
import { invoiceOutstanding, invoiceTotal, matchInvoice, round2 } from '../core/fin.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe, StatusComponent } from '../shared/ui';
import { FinHistoryComponent } from './fin-audit.component';
import { errMsg, finPill, recLabel, recName, todayStr } from './fin-util';

type Side = 'ap' | 'ar';
interface IForm {
  id: string; code: string; status: string; party: string; invoiceNo: string; date: string; dueDate: string; currency: string; rate: number;
  net: number; taxCode: string; taxAmount: number; account: string; costCenter: string; project: string; notes: string;
  poNo: string; poAmount: number; receivedAmount: number; matchOverride: boolean; paid: number; glJournal: string;
}

/**
 * Supplier invoices (payables, side 'ap') and customer invoices (receivables, side 'ar').
 * AP: draft -> submitted -> approved -> paid, with PO / goods-received / invoice matching, duplicate detection, hold and reject.
 * AR: draft -> issued -> paid (receipts, part-payments), with a credit-limit check.
 * Approved / issued invoices and payments become DRAFT journals (they still need GL approval).
 * Privileges: finance.ap.view/manage/approve, finance.ar.view/manage (+ finance.gl.manage, finance.bank.manage to create the postings).
 */
@Component({
  selector: 'app-fin-invoices',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, NumPipe, LocalDatePipe, StatusComponent, FinHistoryComponent],
  template: `
    <div class="bar">
      <input class="search" [placeholder]="'common.search' | translate" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <select [ngModel]="status()" (ngModelChange)="status.set($event)">
        <option value="">{{ 'fin.allStatus' | translate }}</option>
        <option *ngFor="let s of statuses()" [value]="s">{{ 'fin.st.' + s | translate }}</option>
      </select>
      <span class="grow"></span>
      <button class="primary" *ngIf="canManage" (click)="openNew()"><app-icon name="plus" [size]="15"></app-icon>{{ (side === 'ap' ? 'fin.ap.new' : 'fin.ar.new') | translate }}</button>
    </div>
    <p class="flash good" *ngIf="msg">{{ msg }}</p>
    <p class="flash bad" *ngIf="error && !form && !dialog">{{ error }}</p>

    <div class="kpis">
      <div class="k"><span>{{ 'fin.inv.outstanding' | translate }}</span><strong>{{ outstanding() | num: 2 }}</strong><small class="dim">{{ base() }}</small></div>
      <div class="k"><span>{{ 'fin.inv.overdue' | translate }}</span><strong [class.neg]="overdue() > 0">{{ overdue() | num: 2 }}</strong><small class="dim">{{ base() }}</small></div>
      <div class="k" *ngIf="side === 'ap'"><span>{{ 'fin.inv.toApprove' | translate }}</span><strong>{{ countStatus('Submitted') }}</strong></div>
      <div class="k" *ngIf="side === 'ap'"><span>{{ 'fin.ap.mismatch' | translate }}</span><strong [class.neg]="mismatches() > 0">{{ mismatches() }}</strong></div>
      <div class="k" *ngIf="side === 'ar'"><span>{{ 'fin.ar.draftN' | translate }}</span><strong>{{ countStatus('Draft') }}</strong></div>
    </div>

    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr>
        <th>{{ 'fin.f.number' | translate }}</th><th>{{ (side === 'ap' ? 'fin.f.vendor' : 'fin.f.customer') | translate }}</th>
        <th *ngIf="side === 'ap'">{{ 'fin.ap.invNo' | translate }}</th><th>{{ 'fin.f.date' | translate }}</th><th>{{ 'fin.f.dueDate' | translate }}</th>
        <th class="num">{{ 'fin.f.total' | translate }}</th><th class="num" *ngIf="side === 'ar'">{{ 'fin.ar.balance' | translate }}</th>
        <th *ngIf="side === 'ap'">{{ 'fin.ap.match' | translate }}</th><th>{{ 'fin.f.status' | translate }}</th><th></th></tr></thead>
      <tbody>
        <tr *ngFor="let r of shown()">
          <td class="mono"><a class="lnk" (click)="open(r)">{{ r.code }}</a></td>
          <td>{{ partyName(r) }}</td>
          <td class="mono" *ngIf="side === 'ap'">{{ r.data['invoiceNo'] }}</td>
          <td>{{ r.data['date'] | ldate }}</td>
          <td [class.neg]="isLate(r)">{{ r.data['dueDate'] | ldate }}</td>
          <td class="num">{{ total(r) | num: 2 }} <small class="dim">{{ r.data['currency'] || base() }}</small></td>
          <td class="num" *ngIf="side === 'ar'">{{ bal(r) | num: 2 }}</td>
          <td *ngIf="side === 'ap'"><app-status [status]="pill(r.data['matchStatus'])" [label]="matchLabel(r.data['matchStatus'])"></app-status></td>
          <td><app-status [status]="pill(r.status)" [label]="stLabel(r.status)"></app-status></td>
          <td class="act">
            <ng-container *ngIf="side === 'ap'">
              <button class="sm" *ngIf="canApprove && r.status === 'Submitted'" (click)="setStatus(r, 'Approved')">{{ 'fin.ap.approve' | translate }}</button>
              <button class="ghost sm" *ngIf="canApprove && r.status === 'Submitted'" (click)="setStatus(r, 'Held')">{{ 'fin.ap.hold' | translate }}</button>
              <button class="ghost sm danger-i" *ngIf="canApprove && (r.status === 'Submitted' || r.status === 'Held')" (click)="setStatus(r, 'Rejected')">{{ 'fin.jv.reject' | translate }}</button>
              <button class="ghost sm" *ngIf="canManage && r.status === 'Held'" (click)="setStatus(r, 'Submitted')">{{ 'fin.ap.release' | translate }}</button>
              <button class="sm" *ngIf="canApprove && r.status === 'Approved'" (click)="startPay(r)">{{ 'fin.ap.pay' | translate }}</button>
            </ng-container>
            <ng-container *ngIf="side === 'ar'">
              <button class="sm" *ngIf="canManage && r.status === 'Issued'" (click)="startPay(r)">{{ 'fin.ar.receive' | translate }}</button>
              <button class="ghost sm danger-i" *ngIf="canManage && (r.status === 'Draft' || (r.status === 'Issued' && !r.data['paid']))" (click)="setStatus(r, 'Cancelled')">{{ 'fin.ar.cancel' | translate }}</button>
            </ng-container>
            <button class="ghost sm" *ngIf="canGl && postable(r)" (click)="postGl(r)" [title]="'fin.inv.toGl' | translate">GL</button>
            <button class="ghost sm" *ngIf="canAudit" (click)="history = r" [title]="'fin.audit.history' | translate"><app-icon name="clock" [size]="15"></app-icon></button>
            <button class="ghost sm" *ngIf="canManage && editable(r)" (click)="open(r)" [title]="'admin.edit' | translate"><app-icon name="edit" [size]="15"></app-icon></button>
            <button class="ghost sm danger-i" *ngIf="canManage && deletable(r)" (click)="deleting = r; error = ''" [title]="'admin.delete' | translate"><app-icon name="trash" [size]="15"></app-icon></button>
          </td>
        </tr>
      </tbody>
    </table><div class="empty" *ngIf="!shown().length">{{ (side === 'ap' ? 'fin.ap.none' : 'fin.ar.none') | translate }}</div></div></div>

    <!-- editor -->
    <div class="modal-scrim" *ngIf="form" (click)="form = null">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ form.code || ((side === 'ap' ? 'fin.ap.new' : 'fin.ar.new') | translate) }}
          <app-status *ngIf="form.id" [status]="pill(form.status)" [label]="stLabel(form.status)"></app-status></h3></div>
        <div class="modal-body">
          <div class="form-grid">
            <div><label class="lbl">{{ (side === 'ap' ? 'fin.f.vendor' : 'fin.f.customer') | translate }} *</label>
              <select [ngModel]="form.party" (ngModelChange)="pickParty($event)" [disabled]="ro()"><option value="">—</option><option *ngFor="let p of parties()" [value]="p.code!">{{ label(p) }}</option></select></div>
            <div *ngIf="side === 'ap'"><label class="lbl">{{ 'fin.ap.invNo' | translate }} *</label><input [(ngModel)]="form.invoiceNo" [disabled]="ro()" /></div>
            <div><label class="lbl">{{ 'fin.f.date' | translate }} *</label><input type="date" [(ngModel)]="form.date" (ngModelChange)="pickParty(form.party, true)" [disabled]="ro()" /></div>
            <div><label class="lbl">{{ 'fin.f.dueDate' | translate }}</label><input type="date" [(ngModel)]="form.dueDate" [disabled]="ro()" /></div>
            <div><label class="lbl">{{ 'fin.f.currency' | translate }}</label>
              <select [(ngModel)]="form.currency" [disabled]="ro()"><option [value]="base()">{{ base() }}</option><option *ngFor="let c of currencies()" [value]="c.code!">{{ c.code }}</option></select></div>
            <div><label class="lbl">{{ 'fin.f.rate' | translate }}</label><input type="number" step="0.0001" [(ngModel)]="form.rate" [disabled]="ro() || form.currency === base()" /></div>
            <div><label class="lbl">{{ 'fin.f.net' | translate }} *</label><input type="number" step="0.01" [(ngModel)]="form.net" (ngModelChange)="recalcTax()" [disabled]="ro()" /></div>
            <div><label class="lbl">{{ 'fin.f.taxCode' | translate }}</label>
              <select [(ngModel)]="form.taxCode" (ngModelChange)="recalcTax()" [disabled]="ro()"><option value="">—</option><option *ngFor="let t of taxCodes()" [value]="t.code!">{{ t.code }} · {{ t.data['rate'] }}%</option></select></div>
            <div><label class="lbl">{{ 'fin.f.taxAmount' | translate }}</label><input type="number" step="0.01" [(ngModel)]="form.taxAmount" [disabled]="ro()" /></div>
            <div><label class="lbl">{{ 'fin.f.total' | translate }}</label><input [value]="(formTotal() | num: 2)" disabled /></div>
            <div><label class="lbl">{{ (side === 'ap' ? 'fin.f.expenseAccount' : 'fin.f.revenueAccount') | translate }}</label>
              <select [(ngModel)]="form.account" [disabled]="ro()"><option value="">{{ 'fin.useDefault' | translate }}</option><option *ngFor="let a of accounts()" [value]="a.code!">{{ label(a) }}</option></select></div>
            <div><label class="lbl">{{ 'fin.f.costCenter' | translate }}</label>
              <select [(ngModel)]="form.costCenter" [disabled]="ro()"><option value="">—</option><option *ngFor="let c of costCenters()" [value]="c.code!">{{ label(c) }}</option></select></div>
            <div><label class="lbl">{{ 'fin.f.project' | translate }}</label>
              <select [(ngModel)]="form.project" [disabled]="ro()"><option value="">—</option><option *ngFor="let p of projects()" [value]="p.code!">{{ label(p) }}</option></select></div>
            <div class="full"><label class="lbl">{{ 'fin.f.notes' | translate }}</label><input [(ngModel)]="form.notes" [disabled]="ro()" /></div>
          </div>

          <div class="three" *ngIf="side === 'ap'">
            <h4>{{ 'fin.ap.threeWay' | translate }}</h4>
            <div class="form-grid g3">
              <div><label class="lbl">{{ 'fin.ap.poNo' | translate }}</label><input [(ngModel)]="form.poNo" [disabled]="ro()" /></div>
              <div><label class="lbl">{{ 'fin.ap.poAmount' | translate }}</label><input type="number" step="0.01" [(ngModel)]="form.poAmount" [disabled]="ro()" /></div>
              <div><label class="lbl">{{ 'fin.ap.received' | translate }}</label><input type="number" step="0.01" [(ngModel)]="form.receivedAmount" [disabled]="ro()" /></div>
            </div>
            <p class="match" [class.ok]="match().state === 'Matched'" [class.bad]="match().state === 'Mismatch'">
              <app-status [status]="pill(match().state)" [label]="matchLabel(match().state)"></app-status>
              <span *ngIf="match().state === 'Mismatch'">{{ match().reason === 'noReceipt' ? ('fin.ap.noReceipt' | translate) : ('fin.ap.over' | translate: { inv: (formTotal() | num: 2), lim: (match().limit | num: 2) }) }}</span>
              <span *ngIf="match().state === 'NoPO'" class="dim">{{ 'fin.ap.noPoHint' | translate }}</span>
            </p>
            <label class="chk" *ngIf="match().state === 'Mismatch' && canApprove"><input type="checkbox" [(ngModel)]="form.matchOverride" [disabled]="ro()" /> {{ 'fin.ap.override' | translate }}</label>
          </div>
          <p class="flash bad" *ngIf="creditWarn()">{{ 'fin.ar.creditOver' | translate: { limit: (creditLimit() | num: 2), now: (creditUsed() | num: 2) } }}</p>
          <p class="flash bad" *ngIf="error">{{ error }}</p>
        </div>
        <div class="modal-foot">
          <button (click)="form = null">{{ 'hr.imp.close' | translate }}</button>
          <ng-container *ngIf="!ro()">
            <button (click)="save('Draft')" [disabled]="saving">{{ 'fin.jv.saveDraft' | translate }}</button>
            <button class="primary" (click)="save(side === 'ap' ? 'Submitted' : 'Issued')" [disabled]="saving">{{ (side === 'ap' ? 'fin.jv.submit' : 'fin.ar.issue') | translate }}</button>
          </ng-container>
        </div>
      </div>
    </div>

    <!-- pay / receive -->
    <div class="modal-scrim" *ngIf="dialog" (click)="dialog = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (side === 'ap' ? 'fin.ap.pay' : 'fin.ar.receive') | translate }} · {{ dialog.inv.code }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div *ngIf="side === 'ar'"><label class="lbl">{{ 'fin.f.amount' | translate }}</label><input type="number" step="0.01" [(ngModel)]="dialog.amount" /></div>
          <div><label class="lbl">{{ 'fin.f.date' | translate }}</label><input type="date" [(ngModel)]="dialog.date" /></div>
          <div class="full"><label class="lbl">{{ 'fin.bank.account' | translate }}</label>
            <select [(ngModel)]="dialog.bank"><option value="">—</option><option *ngFor="let b of banks()" [value]="b.code!">{{ label(b) }}</option></select></div>
        </div><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="dialog = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="confirmPay()" [disabled]="saving">{{ 'fin.confirm' | translate }}</button></div>
      </div>
    </div>

    <div class="modal-scrim" *ngIf="deleting" (click)="deleting = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'admin.delete' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'fin.deleteConfirm' | translate: { name: deleting.code || '' } }}</p><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="deleting = null">{{ 'common.cancel' | translate }}</button><button class="primary danger-fill" (click)="doDelete()">{{ 'admin.delete' | translate }}</button></div>
      </div>
    </div>
    <app-fin-history *ngIf="history" [kind]="kind" [recordId]="history.id" [title]="history.code || ''" (closed)="history = null"></app-fin-history>
  `,
  styles: [`
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; } .search { max-width: 260px; } .bar select { width: auto; } .grow { flex: 1; }
    .kpis { display: flex; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .k { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 16px; min-width: 150px; display: flex; flex-direction: column; gap: 2px; }
    .k span { font-size: 12px; color: var(--text-dim); } .k strong { font-size: 19px; font-variant-numeric: tabular-nums; } .neg { color: var(--bad); }
    .lnk { cursor: pointer; color: var(--primary); } .act { white-space: nowrap; text-align: end; }
    .danger-i { color: var(--bad); } .danger-fill { background: var(--bad); border-color: var(--bad); color: #fff; }
    .full { grid-column: 1 / -1; } .three { margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--border); } .three h4 { margin: 0 0 8px; font-size: 13px; }
    .g3 { grid-template-columns: repeat(3, 1fr); } .match { display: flex; gap: 10px; align-items: center; margin: 10px 0 4px; font-size: 13px; }
    .chk { display: flex; gap: 8px; align-items: center; font-size: 13px; } .chk input { width: auto; }
  `]
})
export class FinInvoicesComponent implements OnInit {
  @Input({ required: true }) side!: Side;

  auth = inject(AuthService); ctx = inject(ErpContextService); private fin = inject(FinService); private i18n = inject(I18nService);
  private posting = inject(FinPostingService); private route = inject(ActivatedRoute); private router = inject(Router);

  all = signal<FinRec[]>([]);
  q = signal(''); status = signal('');
  form: IForm | null = null; deleting: FinRec | null = null; history: FinRec | null = null;
  dialog: { inv: FinRec; amount: number; date: string; bank: string } | null = null;
  saving = false; error = ''; msg = '';

  get kind(): 'apinvoice' | 'arinvoice' { return this.side === 'ap' ? 'apinvoice' : 'arinvoice'; }
  canManage = false; canApprove = false; canGl = false; canBank = false; canAudit = false;

  base = computed(() => this.ctx.companyObj().currency);
  parties = computed(() => this.fin.ref(this.side === 'ap' ? 'vendor' : 'customer').filter(p => p.status !== 'Inactive'));
  accounts = computed(() => this.fin.ref('account').filter(a => !a.data?.['isHeader'] && a.status !== 'Inactive').sort((x, y) => (x.code ?? '').localeCompare(y.code ?? '')));
  costCenters = computed(() => this.fin.ref('costcenter').filter(c => c.status !== 'Inactive'));
  projects = computed(() => this.fin.ref('project').filter(c => c.status !== 'Closed' && c.status !== 'Inactive'));
  currencies = computed(() => this.fin.ref('currency').filter(c => c.code !== this.base()));
  taxCodes = computed(() => this.fin.ref('taxcode').filter(t => t.status !== 'Inactive'));
  banks = signal<FinRec[]>([]);

  statuses = () => this.side === 'ap' ? ['Draft', 'Submitted', 'Approved', 'Paid', 'Held', 'Rejected'] : ['Draft', 'Issued', 'Paid', 'Cancelled'];
  openStatuses = () => this.side === 'ap' ? ['Submitted', 'Approved', 'Held'] : ['Issued'];

  shown = () => {
    const q = this.q().toLowerCase().trim(), st = this.status();
    return this.all().filter(r => (!st || r.status === st) && (!q || `${r.code} ${r.data['vendor']} ${r.data['customer']} ${r.data['invoiceNo']} ${r.data['poNo']}`.toLowerCase().includes(q)));
  };
  open_ = () => this.all().filter(r => this.openStatuses().includes(r.status ?? ''));
  outstanding = () => round2(this.open_().reduce((s, r) => s + invoiceOutstanding(r), 0));
  overdue = () => round2(this.open_().filter(r => this.isLate(r)).reduce((s, r) => s + invoiceOutstanding(r), 0));
  mismatches = () => this.all().filter(r => r.data['matchStatus'] === 'Mismatch' && ['Draft', 'Submitted', 'Held'].includes(r.status ?? '')).length;
  countStatus = (s: string) => this.all().filter(r => r.status === s).length;

  ngOnInit() {
    this.canManage = this.auth.can(this.side === 'ap' ? 'finance.ap.manage' : 'finance.ar.manage');
    this.canApprove = this.side === 'ap' ? this.auth.can('finance.ap.approve') : this.canManage;
    this.canGl = this.auth.can('finance.gl.manage');
    this.canBank = this.auth.can('finance.bank.manage');
    this.canAudit = this.auth.can('finance.audit.view');
    this.fin.loadRefs(['bankaccount'], this.ctx.company()).subscribe(() => this.banks.set(this.fin.ref('bankaccount')));
    this.load(true);
  }

  load(first = false) {
    this.fin.records(this.kind, this.ctx.company()).subscribe({
      next: l => {
        this.all.set(l);
        if (first) {
          const qp = this.route.snapshot.queryParamMap;
          if (qp.get('new') && this.canManage) this.openNew();
          if (qp.keys.length) this.router.navigate([], { queryParams: {}, replaceUrl: true });
        }
      },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  // ---- display helpers
  label(r: FinRec) { return recLabel(r, this.i18n); }
  partyName(r: FinRec) { const code = r.data[this.side === 'ap' ? 'vendor' : 'customer']; return recName(this.fin.ref(this.side === 'ap' ? 'vendor' : 'customer').find(p => p.code === code), this.i18n) || code; }
  pill(s: string | null | undefined) { return finPill(s); }
  stLabel(s: string | null | undefined) { return this.i18n.t('fin.st.' + s); }
  matchLabel(s: string | null | undefined) { return s ? this.i18n.t('fin.match.' + s) : '—'; }
  total(r: FinRec) { return invoiceTotal(r.data); }
  bal(r: FinRec) { return round2(invoiceTotal(r.data) - (Number(r.data['paid']) || 0)); }
  isLate(r: FinRec) { return this.openStatuses().includes(r.status ?? '') && String(r.data['dueDate'] ?? '') !== '' && String(r.data['dueDate']).slice(0, 10) < todayStr(); }
  editable(r: FinRec) { return r.status === 'Draft' || (this.side === 'ap' && (r.status === 'Rejected' || r.status === 'Held')); }
  deletable(r: FinRec) { return this.side === 'ap' ? ['Draft', 'Rejected', 'Held'].includes(r.status ?? '') : ['Draft', 'Cancelled'].includes(r.status ?? ''); }
  postable(r: FinRec) { return !r.data['glJournal'] && (this.side === 'ap' ? ['Approved', 'Paid'].includes(r.status ?? '') : ['Issued', 'Paid'].includes(r.status ?? '')); }
  ro() { return !this.canManage || (!!this.form && this.form.id !== '' && !['Draft', 'Rejected', 'Held'].includes(this.form.status)); }

  // ---- editor
  formTotal = () => round2((Number(this.form?.net) || 0) + (Number(this.form?.taxAmount) || 0));
  match = () => this.matchOf();
  creditLimit = () => Number(this.fin.ref('customer').find(c => c.code === this.form?.party)?.data?.['creditLimit']) || 0;
  creditUsed = () => round2(this.all().filter(r => r.status === 'Issued' && r.data['customer'] === this.form?.party && r.id !== this.form?.id).reduce((s, r) => s + invoiceOutstanding(r), 0) + this.formTotal());
  creditWarn = () => this.side === 'ar' && !!this.form && this.creditLimit() > 0 && this.creditUsed() > this.creditLimit();

  blank(): IForm {
    return { id: '', code: '', status: '', party: '', invoiceNo: '', date: todayStr(), dueDate: '', currency: this.base(), rate: 1, net: 0, taxCode: '', taxAmount: 0,
      account: '', costCenter: '', project: '', notes: '', poNo: '', poAmount: 0, receivedAmount: 0, matchOverride: false, paid: 0, glJournal: '' };
  }
  openNew() { this.error = ''; this.form = this.blank(); }
  open(r: FinRec) {
    this.error = '';
    const d = r.data ?? {};
    this.form = { ...this.blank(), id: r.id, code: r.code ?? '', status: r.status ?? 'Draft', party: d[this.side === 'ap' ? 'vendor' : 'customer'] ?? '', invoiceNo: d['invoiceNo'] ?? '',
      date: String(d['date'] ?? '').slice(0, 10), dueDate: String(d['dueDate'] ?? '').slice(0, 10), currency: d['currency'] || this.base(), rate: Number(d['rate']) || 1,
      net: Number(d['amount']) || 0, taxCode: d['taxCode'] ?? '', taxAmount: Number(d['taxAmount']) || 0, account: d['account'] ?? '', costCenter: d['costCenter'] ?? '', project: d['project'] ?? '',
      notes: d['notes'] ?? '', poNo: d['poNo'] ?? '', poAmount: Number(d['poAmount']) || 0, receivedAmount: Number(d['receivedAmount']) || 0, matchOverride: !!d['matchOverride'],
      paid: Number(d['paid']) || 0, glJournal: d['glJournal'] ?? '' };
  }
  pickParty(code: string, dateOnly = false) {
    const f = this.form!;
    if (!dateOnly) f.party = code;
    const p = this.fin.ref(this.side === 'ap' ? 'vendor' : 'customer').find(x => x.code === f.party);
    const days = Number(p?.data?.['termsDays']);
    if (p && days >= 0 && f.date && (!f.dueDate || dateOnly || !this.form?.id)) {
      const d = new Date(f.date); d.setDate(d.getDate() + (days || 0)); f.dueDate = d.toISOString().slice(0, 10);
    }
  }
  recalcTax() {
    const f = this.form!;
    const t = this.fin.ref('taxcode').find(x => x.code === f.taxCode);
    if (t) f.taxAmount = round2((Number(f.net) || 0) * (Number(t.data?.['rate']) || 0) / 100);
  }
  matchOf() {
    const f = this.form;
    if (!f) return { state: 'NoPO' as const, limit: 0, reason: undefined };
    return matchInvoice({ poNo: f.poNo, poAmount: f.poAmount, receivedAmount: f.receivedAmount, total: this.formTotal() }, Number(this.fin.controls().matchTolerancePct ?? 2));
  }

  private payload(status: string) {
    const f = this.form!;
    const data: Record<string, any> = {
      [this.side === 'ap' ? 'vendor' : 'customer']: f.party, date: f.date, dueDate: f.dueDate || f.date, currency: f.currency, rate: f.currency === this.base() ? 1 : Number(f.rate) || 1,
      amount: round2(Number(f.net) || 0), taxCode: f.taxCode, taxAmount: round2(Number(f.taxAmount) || 0), total: this.formTotal(),
      account: f.account, costCenter: f.costCenter, project: f.project, notes: f.notes, paid: f.paid || 0, glJournal: f.glJournal || ''
    };
    if (this.side === 'ap') Object.assign(data, { invoiceNo: f.invoiceNo, poNo: f.poNo, poAmount: Number(f.poAmount) || 0, receivedAmount: Number(f.receivedAmount) || 0, matchOverride: f.matchOverride });
    return { company: this.ctx.company(), status, data };
  }

  save(status: 'Draft' | 'Submitted' | 'Issued') {
    const f = this.form!;
    this.error = '';
    if (!f.party || !f.date || !(Number(f.net) > 0) || (this.side === 'ap' && !f.invoiceNo.trim())) { this.error = this.i18n.t('hr.err.required'); return; }
    if (status === 'Issued' && this.creditWarn()) { this.error = this.i18n.t('fin.ar.creditBlock'); return; }
    this.saving = true;
    const body = this.payload(status);
    const req = f.id ? this.fin.update(this.kind, f.id, body) : this.fin.create(this.kind, body);
    req.subscribe({
      next: rec => {
        this.saving = false; this.form = null; this.flash(this.i18n.t('hr.saved')); this.load();
        if (status === 'Issued') this.postAfter(rec);
      },
      error: e => { this.saving = false; this.error = errMsg(e, this.i18n); }
    });
  }

  setStatus(r: FinRec, status: string) {
    this.error = '';
    this.fin.update(this.kind, r.id, { status, data: r.data }).subscribe({
      next: rec => { this.flash(this.i18n.t('hr.saved')); this.load(); if (status === 'Approved') this.postAfter(rec); },
      error: e => { this.error = errMsg(e, this.i18n); }
    });
  }

  /** after approving / issuing: draft the GL journal when this user is allowed to */
  private postAfter(rec: FinRec) { if (this.canGl) this.postGl(rec, true); }

  postGl(r: FinRec, quiet = false) {
    const call: Observable<FinRec> = this.side === 'ap' ? this.posting.apInvoice(r) : this.posting.arInvoice(r);
    call.pipe(switchMap(j => this.fin.update(this.kind, r.id, { status: r.status, data: { ...r.data, glJournal: j.code } }).pipe(map(() => j)))).subscribe({
      next: j => { this.flash(this.i18n.t('fin.inv.glDone', { n: j.code ?? '' })); this.load(); },
      error: e => { if (!quiet || (e as Error)?.message !== 'fin.needDefaults') this.error = (e as Error)?.message === 'fin.needDefaults' ? this.i18n.t('fin.needDefaults') : errMsg(e, this.i18n); }
    });
  }

  // ---- payment / receipt
  startPay(r: FinRec) {
    this.error = '';
    this.dialog = { inv: r, amount: this.bal(r), date: todayStr(), bank: this.banks()[0]?.code ?? '' };
  }
  confirmPay() {
    const d = this.dialog!;
    const r = d.inv;
    this.error = '';
    if (!d.date || (this.side === 'ar' && !(Number(d.amount) > 0))) { this.error = this.i18n.t('hr.err.required'); return; }
    this.saving = true;
    const total = invoiceTotal(r.data);
    const amount = this.side === 'ap' ? total : Math.min(Number(d.amount), this.bal(r));
    const paid = round2((Number(r.data['paid']) || 0) + amount);
    const full = paid >= total - 0.005;
    const data = { ...r.data, paid, paidDate: d.date, bankAccount: d.bank };
    const status = this.side === 'ap' ? 'Paid' : (full ? 'Paid' : 'Issued');

    this.fin.update(this.kind, r.id, { status, data }).pipe(
      switchMap(rec => this.fin.create('banktxn', {
        company: this.ctx.company(), status: 'Active',
        data: { account: d.bank, date: d.date, amount: this.side === 'ap' ? -amount : amount, description: `${this.side === 'ap' ? 'Payment' : 'Receipt'} ${r.code}`, reference: r.code, reconciled: false }
      }).pipe(catchError(() => of(null)), map(() => rec))),
      switchMap(rec => {
        if (!this.canGl) return of(rec);
        const j$ = this.side === 'ap' ? this.posting.apPayment(rec, d.bank, d.date) : this.posting.arReceipt(rec, d.bank, d.date, amount);
        return j$.pipe(catchError(() => of(null)), map(() => rec));
      }),
      switchMap(rec => this.side === 'ar'
        ? this.fin.create('receipt', { company: this.ctx.company(), status: 'Active', data: { invoice: r.code, customer: r.data['customer'], amount, date: d.date, bank: d.bank } }).pipe(catchError(() => of(null)), map(() => rec))
        : of(rec))
    ).subscribe({
      next: () => { this.saving = false; this.dialog = null; this.flash(this.i18n.t(this.side === 'ap' ? 'fin.ap.paidOk' : 'fin.ar.receivedOk')); this.load(); },
      error: e => { this.saving = false; this.error = errMsg(e, this.i18n); }
    });
  }

  doDelete() {
    const d = this.deleting!;
    this.fin.remove(this.kind, d.id).subscribe({
      next: () => { this.deleting = null; this.flash(this.i18n.t('hr.deleted')); this.load(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }
  flash(t: string) { this.msg = t; setTimeout(() => this.msg = '', 3000); }
}
