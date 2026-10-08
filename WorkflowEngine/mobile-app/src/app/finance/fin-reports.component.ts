import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { OrgService } from '../core/org.service';
import { FinRec } from '../core/fin.models';
import { PostedLine, TbRow, balanceSheet, incomeStatement, postedLines, round2, trialBalance } from '../core/fin.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe } from '../shared/ui';
import { errMsg, recName, startOfYear, todayStr } from './fin-util';

type Tab = 'tb' | 'is' | 'bs' | 'ledger' | 'group';

/**
 * Financial reports built from posted journals: trial balance, income statement, balance sheet, account ledger (drill-down) and
 * the multi-company view with intercompany elimination and currency conversion to a group currency.
 * Needs finance.gl.view.
 */
@Component({
  selector: 'app-fin-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, NumPipe, LocalDatePipe],
  template: `
    <div class="ctrl">
      <div class="seg">
        <button *ngFor="let t of tabs" [class.on]="tab() === t" (click)="pickTab(t)">{{ 'fin.rep.' + t | translate }}</button>
      </div>
      <span class="grow"></span>
      <label class="lbl inl">{{ 'fin.rep.from' | translate }}<input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)" /></label>
      <label class="lbl inl">{{ 'fin.rep.to' | translate }}<input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      <select *ngIf="tab() !== 'group' && companies().length > 1" [ngModel]="scope()" (ngModelChange)="setScope($event)">
        <option value="THIS">{{ i18n.nm(ctx.companyObj()) }}</option><option value="ALL">{{ 'fin.rep.allCompanies' | translate }}</option>
      </select>
      <label class="chk" *ngIf="consolidated()"><input type="checkbox" [ngModel]="elim()" (ngModelChange)="elim.set($event)" /> {{ 'fin.rep.eliminate' | translate }}</label>
      <select *ngIf="consolidated()" [ngModel]="groupCur()" (ngModelChange)="groupCur.set($event)" [title]="'fin.rep.groupCur' | translate">
        <option *ngFor="let c of currencyCodes()" [value]="c">{{ c }}</option></select>
      <button (click)="exportCsv()"><app-icon name="download" [size]="15"></app-icon>{{ 'fin.rep.export' | translate }}</button>
    </div>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <p class="dim note" *ngIf="consolidated()">{{ 'fin.rep.groupNote' | translate: { c: groupCur() } }}</p>
    <p class="dim note" *ngIf="!tb().length && !error">{{ 'fin.rep.noPosted' | translate }}</p>

    <!-- trial balance -->
    <div class="card" *ngIf="tab() === 'tb' && tb().length"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'fin.f.account' | translate }}</th><th>{{ 'fin.f.type' | translate }}</th><th class="num">{{ 'fin.jv.debit' | translate }}</th><th class="num">{{ 'fin.jv.credit' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let r of tb()"><td><span class="mono">{{ r.account }}</span> {{ r.name }}</td><td class="dim">{{ r.type ? ('fin.type.' + r.type | translate) : '' }}</td>
        <td class="num">{{ r.debit | num: 2 }}</td><td class="num">{{ r.credit | num: 2 }}</td></tr></tbody>
      <tfoot><tr><td colspan="2"><strong>{{ 'fin.rep.total' | translate }}</strong></td><td class="num"><strong>{{ tbTotals().d | num: 2 }}</strong></td><td class="num"><strong>{{ tbTotals().c | num: 2 }}</strong></td></tr></tfoot>
    </table></div></div>

    <!-- income statement -->
    <div class="card" *ngIf="tab() === 'is' && tb().length"><div class="table-wrap"><table class="data">
      <tbody>
        <tr class="sec"><td colspan="2">{{ 'fin.type.Revenue' | translate }}</td></tr>
        <tr *ngFor="let r of inc().revenue"><td><span class="mono">{{ r.account }}</span> {{ r.name }}</td><td class="num">{{ r.balance | num: 2 }}</td></tr>
        <tr class="sub"><td>{{ 'fin.rep.totalRevenue' | translate }}</td><td class="num">{{ inc().totalRevenue | num: 2 }}</td></tr>
        <tr class="sec"><td colspan="2">{{ 'fin.type.Expense' | translate }}</td></tr>
        <tr *ngFor="let r of inc().expense"><td><span class="mono">{{ r.account }}</span> {{ r.name }}</td><td class="num">{{ r.balance | num: 2 }}</td></tr>
        <tr class="sub"><td>{{ 'fin.rep.totalExpense' | translate }}</td><td class="num">{{ inc().totalExpense | num: 2 }}</td></tr>
        <tr class="net"><td>{{ 'fin.rep.netIncome' | translate }}</td><td class="num" [class.neg]="inc().net < 0">{{ inc().net | num: 2 }}</td></tr>
      </tbody></table></div></div>

    <!-- balance sheet -->
    <div class="card" *ngIf="tab() === 'bs' && tb().length"><div class="table-wrap"><table class="data">
      <tbody>
        <tr class="sec"><td colspan="2">{{ 'fin.type.Asset' | translate }}</td></tr>
        <tr *ngFor="let r of bs().assets"><td><span class="mono">{{ r.account }}</span> {{ r.name }}</td><td class="num">{{ r.balance | num: 2 }}</td></tr>
        <tr class="sub"><td>{{ 'fin.rep.totalAssets' | translate }}</td><td class="num">{{ bs().totalAssets | num: 2 }}</td></tr>
        <tr class="sec"><td colspan="2">{{ 'fin.type.Liability' | translate }}</td></tr>
        <tr *ngFor="let r of bs().liabilities"><td><span class="mono">{{ r.account }}</span> {{ r.name }}</td><td class="num">{{ r.balance | num: 2 }}</td></tr>
        <tr class="sub"><td>{{ 'fin.rep.totalLiabilities' | translate }}</td><td class="num">{{ bs().totalLiabilities | num: 2 }}</td></tr>
        <tr class="sec"><td colspan="2">{{ 'fin.type.Equity' | translate }}</td></tr>
        <tr *ngFor="let r of bs().equity"><td><span class="mono">{{ r.account }}</span> {{ r.name }}</td><td class="num">{{ r.balance | num: 2 }}</td></tr>
        <tr><td>{{ 'fin.rep.netIncome' | translate }}</td><td class="num">{{ bs().netIncome | num: 2 }}</td></tr>
        <tr class="sub"><td>{{ 'fin.rep.totalEquity' | translate }}</td><td class="num">{{ bs().totalEquity | num: 2 }}</td></tr>
        <tr class="net"><td>{{ 'fin.rep.check' | translate }}</td><td class="num" [class.neg]="bs().check !== 0">{{ bs().check | num: 2 }}</td></tr>
      </tbody></table></div></div>

    <!-- account ledger -->
    <ng-container *ngIf="tab() === 'ledger'">
      <div class="ctrl"><select [ngModel]="ledgerAcc()" (ngModelChange)="ledgerAcc.set($event)">
        <option value="">{{ 'fin.rep.pickAccount' | translate }}</option>
        <option *ngFor="let a of accountsList()" [value]="a.code!">{{ a.code }} · {{ nm(a) }}</option></select></div>
      <div class="card" *ngIf="ledgerAcc()"><div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'fin.f.date' | translate }}</th><th>{{ 'fin.f.number' | translate }}</th><th>{{ 'fin.f.memo' | translate }}</th><th>{{ 'fin.f.costCenter' | translate }}</th><th class="num">{{ 'fin.jv.debit' | translate }}</th><th class="num">{{ 'fin.jv.credit' | translate }}</th><th class="num">{{ 'fin.rep.running' | translate }}</th></tr></thead>
        <tbody><tr *ngFor="let l of ledgerRows()"><td>{{ l.date | ldate }}</td><td class="mono">{{ l.journal }}</td><td>{{ l.memo }}</td><td class="mono">{{ l.costCenter }}</td>
          <td class="num">{{ l.debit | num: 2 }}</td><td class="num">{{ l.credit | num: 2 }}</td><td class="num">{{ l.run | num: 2 }}</td></tr></tbody>
      </table><div class="empty" *ngIf="!ledgerRows().length">{{ 'common.noData' | translate }}</div></div></div>
    </ng-container>

    <!-- group / consolidation -->
    <div class="card" *ngIf="tab() === 'group' && groupRows().length"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'fin.f.account' | translate }}</th><th *ngFor="let c of companies()" class="num">{{ c.code }}</th><th class="num">{{ 'fin.rep.consolidated' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let r of groupRows()"><td><span class="mono">{{ r.account }}</span> {{ r.name }}</td>
        <td *ngFor="let v of r.cols" class="num">{{ v | num: 2 }}</td><td class="num"><strong>{{ r.total | num: 2 }}</strong></td></tr></tbody>
    </table></div></div>
  `,
  styles: [`
    .ctrl { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; } .grow { flex: 1; }
    .ctrl select { width: auto; } .inl { display: inline-flex; gap: 6px; align-items: center; margin: 0; } .inl input { width: auto; }
    .chk { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; } .chk input { width: auto; }
    .note { font-size: 12.5px; margin: 0 0 10px; }
    tr.sec td { background: var(--surface-2); font-weight: 650; color: var(--text-2); }
    tr.sub td { font-weight: 650; border-top: 1px solid var(--border); }
    tr.net td { font-weight: 700; font-size: 14px; background: var(--primary-soft); } .neg { color: var(--bad); }
    tfoot td { background: var(--surface-2); }
  `]
})
export class FinReportsComponent implements OnInit {
  ctx = inject(ErpContextService); i18n = inject(I18nService); private fin = inject(FinService); private org = inject(OrgService);

  tabs: Tab[] = ['tb', 'is', 'bs', 'ledger', 'group'];
  tab = signal<Tab>('tb');
  from = signal(startOfYear()); to = signal(todayStr());
  scope = signal<'THIS' | 'ALL'>('THIS');
  elim = signal(true);
  groupCur = signal('');
  ledgerAcc = signal('');
  journals = signal<FinRec[]>([]);
  error = '';

  companies = computed(() => this.org.companies());
  consolidated = computed(() => this.tab() === 'group' || this.scope() === 'ALL');
  accountsList = computed(() => this.fin.ref('account').filter(a => !a.data?.['isHeader']).sort((x, y) => (x.code ?? '').localeCompare(y.code ?? '')));
  currencyCodes = computed(() => {
    const s = new Set<string>([...this.companies().map(c => c.currency), ...this.fin.ref('currency').map(c => c.code ?? '')].filter(Boolean));
    return [...s];
  });

  ngOnInit() {
    this.groupCur.set(this.ctx.companyObj().currency);
    this.load();
  }

  nm(a: FinRec) { return recName(a, this.i18n); }
  setScope(s: 'THIS' | 'ALL') { this.scope.set(s); this.load(); }
  pickTab(t: Tab) { this.tab.set(t); this.load(); }

  load() {
    this.fin.records('journal', this.consolidated() || this.tab() === 'group' ? 'ALL' : this.ctx.company(), 'Posted').subscribe({
      next: l => this.journals.set(l), error: e => this.error = errMsg(e, this.i18n)
    });
  }

  /** value of 1 unit of each company's currency in the group currency (from the currency list; 1 when unknown) */
  private groupRates = computed(() => {
    const rate = (code: string) => Number(this.fin.ref('currency').find(c => c.code === code)?.data?.['rate']) || 1;
    const g = rate(this.groupCur());
    const out: Record<string, number> = {};
    for (const c of this.companies()) out[c.code] = c.currency === this.groupCur() ? 1 : rate(c.currency) / g;
    return out;
  });

  private lines = computed<PostedLine[]>(() => {
    const cons = this.consolidated();
    return postedLines(this.journals(), {
      company: cons ? 'ALL' : this.ctx.company(), from: this.from(), to: this.to(),
      eliminateIc: cons && this.elim(), groupRates: cons ? this.groupRates() : undefined
    });
  });

  tb = computed<TbRow[]>(() => trialBalance(this.lines(), this.fin.ref('account'), a => recName(a, this.i18n)));
  tbTotals = computed(() => ({ d: round2(this.tb().reduce((s, r) => s + r.debit, 0)), c: round2(this.tb().reduce((s, r) => s + r.credit, 0)) }));
  inc = computed(() => incomeStatement(this.tb()));
  bs = computed(() => balanceSheet(this.tb()));

  ledgerRows = computed(() => {
    const acc = this.ledgerAcc();
    if (!acc) return [];
    const type = String(this.fin.ref('account').find(a => a.code === acc)?.data?.['type'] ?? '');
    const sign = type === 'Asset' || type === 'Expense' ? 1 : -1;
    let run = 0;
    return this.lines().filter(l => l.account === acc).sort((a, b) => a.date.localeCompare(b.date) || a.journal.localeCompare(b.journal))
      .map(l => { run = round2(run + sign * (l.debit - l.credit)); return { ...l, run }; });
  });

  groupRows = computed(() => {
    const cs = this.companies().map(c => c.code);
    const all = this.lines();
    const per = cs.map(c => trialBalance(all.filter(l => l.company === c || (!l.company && c === cs[0])), this.fin.ref('account'), a => recName(a, this.i18n)));
    const accounts = new Map<string, { name: string; type: string }>();
    per.forEach(tb => tb.forEach(r => accounts.set(r.account, { name: r.name, type: r.type })));
    return [...accounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([account, info]) => {
      const cols = per.map(tb => tb.find(r => r.account === account)?.balance ?? 0);
      return { account, name: info.name, cols, total: round2(cols.reduce((s, v) => s + v, 0)) };
    });
  });

  exportCsv() {
    const rows: (string | number)[][] = [];
    const t = this.tab();
    if (t === 'group') { rows.push(['Account', 'Name', ...this.companies().map(c => c.code), 'Consolidated']); this.groupRows().forEach(r => rows.push([r.account, r.name, ...r.cols, r.total])); }
    else if (t === 'ledger') { rows.push(['Date', 'Journal', 'Memo', 'CostCenter', 'Debit', 'Credit', 'Balance']); this.ledgerRows().forEach(l => rows.push([l.date, l.journal, l.memo, l.costCenter, l.debit, l.credit, l.run])); }
    else { rows.push(['Account', 'Name', 'Type', 'Debit', 'Credit', 'Balance']); this.tb().forEach(r => rows.push([r.account, r.name, r.type, r.debit, r.credit, r.balance])); }
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `finance-${t}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
}
