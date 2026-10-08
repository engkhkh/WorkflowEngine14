import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { FinRec } from '../core/fin.models';
import { round2 } from '../core/fin.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';
import { CrudAction, CrudField, FinCrudComponent } from './fin-crud.component';
import { errMsg, recLabel, todayStr } from './fin-util';

type Tab = 'accounts' | 'txns';

/** Cash & bank: bank accounts, statement lines and reconciliation. finance.bank.view / finance.bank.manage. */
@Component({
  selector: 'app-fin-bank',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, NumPipe, FinCrudComponent],
  template: `
    <div class="seg sub">
      <button [class.on]="tab() === 'accounts'" (click)="tab.set('accounts')">{{ 'fin.bank.accounts' | translate }}</button>
      <button [class.on]="tab() === 'txns'" (click)="pickTxns()">{{ 'fin.bank.txns' | translate }}</button>
    </div>
    <p class="flash bad" *ngIf="error">{{ error }}</p>

    <app-fin-crud *ngIf="tab() === 'accounts'" kind="bankaccount" [company]="ctx.company()" [fields]="accFields()" [canManage]="canManage" newLabel="fin.bank.new" emptyKey="fin.bank.none" [autoNew]="true" (changed)="accounts.set($event)" />

    <ng-container *ngIf="tab() === 'txns'">
      <div class="recon">
        <select [ngModel]="acc()" (ngModelChange)="acc.set($event)">
          <option value="">{{ 'fin.bank.allAccounts' | translate }}</option>
          <option *ngFor="let b of accounts()" [value]="b.code!">{{ label(b) }}</option>
        </select>
        <div class="k"><span>{{ 'fin.bank.book' | translate }}</span><strong>{{ book() | num: 2 }}</strong></div>
        <div class="k"><span>{{ 'fin.bank.reconciled' | translate }}</span><strong>{{ reconciled() | num: 2 }}</strong></div>
        <div class="k"><span>{{ 'fin.bank.unreconciled' | translate }}</span><strong [class.neg]="unreconciledCount() > 0">{{ unreconciledCount() }}</strong></div>
      </div>
      <app-fin-crud #txn kind="banktxn" [company]="ctx.company()" [fields]="txnFields()" [canManage]="canManage" newLabel="fin.bank.newTxn" emptyKey="fin.bank.noTxn"
        [filter]="txnFilter" [actions]="actions" (changed)="txns.set($event)" />
    </ng-container>
  `,
  styles: [`.sub { margin-bottom: 14px; } .recon { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; } .recon select { width: auto; }
    .k { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 14px; display: flex; flex-direction: column; }
    .k span { font-size: 12px; color: var(--text-dim); } .k strong { font-size: 17px; font-variant-numeric: tabular-nums; } .neg { color: var(--bad); }`]
})
export class FinBankComponent implements OnInit {
  auth = inject(AuthService); ctx = inject(ErpContextService); private fin = inject(FinService); private i18n = inject(I18nService);
  @ViewChild('txn') txn?: FinCrudComponent;
  tab = signal<Tab>('accounts');
  accounts = signal<FinRec[]>([]); txns = signal<FinRec[]>([]);
  acc = signal('');
  error = '';
  canManage = this.auth.can('finance.bank.manage');

  ngOnInit() { this.fin.records('bankaccount', this.ctx.company()).subscribe(l => this.accounts.set(l)); }
  pickTxns() {
    this.tab.set('txns');
    this.fin.records('bankaccount', this.ctx.company()).subscribe(l => this.accounts.set(l));
  }
  label(r: FinRec) { return recLabel(r, this.i18n); }

  private mine = computed(() => this.txns().filter(t => !this.acc() || t.data['account'] === this.acc()));
  book = computed(() => {
    const opening = this.accounts().filter(a => !this.acc() || a.code === this.acc()).reduce((s, a) => s + (Number(a.data['openingBalance']) || 0), 0);
    return round2(opening + this.mine().reduce((s, t) => s + (Number(t.data['amount']) || 0), 0));
  });
  reconciled = computed(() => {
    const opening = this.accounts().filter(a => !this.acc() || a.code === this.acc()).reduce((s, a) => s + (Number(a.data['openingBalance']) || 0), 0);
    return round2(opening + this.mine().filter(t => t.data['reconciled']).reduce((s, t) => s + (Number(t.data['amount']) || 0), 0));
  });
  unreconciledCount = computed(() => this.mine().filter(t => !t.data['reconciled']).length);

  txnFilter = (r: FinRec) => !this.acc() || r.data['account'] === this.acc();

  actions: CrudAction[] = [
    { label: 'fin.bank.reconcile', show: r => this.canManage && !r.data['reconciled'], run: r => this.mark(r, true) },
    { label: 'fin.bank.unreconcile', show: r => this.canManage && !!r.data['reconciled'], run: r => this.mark(r, false) },
  ];
  mark(r: FinRec, v: boolean) {
    this.fin.update('banktxn', r.id, { status: r.status, data: { ...r.data, reconciled: v } }).subscribe({
      next: () => this.txn?.reload(), error: e => this.error = errMsg(e, this.i18n)
    });
  }

  currencies = () => this.fin.ref('currency').map(c => ({ value: c.code ?? '', label: c.code ?? '' }));
  accFields = (): CrudField[] => [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'bankName', label: 'fin.bank.bankName', table: true },
    { key: 'iban', label: 'fin.bank.iban' },
    { key: 'currency', label: 'fin.f.currency', table: true, def: this.ctx.companyObj().currency },
    { key: 'glAccount', label: 'fin.bank.glAccount', type: 'select', table: true, hint: 'fin.bank.glHint',
      options: () => this.fin.ref('account').filter(a => a.data?.['type'] === 'Asset' && !a.data?.['isHeader']).map(a => ({ value: a.code ?? '', label: this.label(a) })) },
    { key: 'openingBalance', label: 'fin.bank.opening', type: 'number', def: 0, table: true },
    { key: 'status', label: 'fin.f.status', type: 'status', def: 'Active', table: true, options: () => ['Active', 'Inactive'].map(v => ({ value: v, label: this.i18n.t('fin.st.' + v) })) },
  ];
  txnFields = (): CrudField[] => [
    { key: 'account', label: 'fin.bank.account', type: 'select', required: true, table: true, options: () => this.accounts().map(a => ({ value: a.code ?? '', label: this.label(a) })) },
    { key: 'date', label: 'fin.f.date', type: 'date', required: true, table: true, def: todayStr() },
    { key: 'description', label: 'fin.f.memo', table: true },
    { key: 'reference', label: 'fin.f.reference', table: true },
    { key: 'amount', label: 'fin.bank.amountHint', type: 'number', required: true, table: true },
    { key: 'reconciled', label: 'fin.bank.reconciled', type: 'bool', table: true },
  ];
}
