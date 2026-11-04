import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError, of } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { FinRec } from '../core/fin.models';
import { BudgetLine, budgetVsActual, postedLines } from '../core/fin.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { LocalDatePipe, NumPipe } from '../shared/ui';
import { CrudField, FinCrudComponent } from './fin-crud.component';
import { recLabel, thisYear } from './fin-util';

/** Budgets by cost centre / account / year, with budget-vs-actual from the posted ledger and drill-down to the journal lines. */
@Component({
  selector: 'app-fin-budgets',
  standalone: true,
  imports: [CommonModule, TranslatePipe, NumPipe, LocalDatePipe, FinCrudComponent],
  template: `
    <h3 class="h">{{ 'fin.bud.vs' | translate }}</h3>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'fin.f.year' | translate }}</th><th>{{ 'fin.f.costCenter' | translate }}</th><th>{{ 'fin.f.account' | translate }}</th>
        <th class="num">{{ 'fin.bud.budget' | translate }}</th><th class="num">{{ 'fin.bud.actual' | translate }}</th><th class="num">{{ 'fin.bud.remaining' | translate }}</th><th style="width:150px">{{ 'fin.bud.used' | translate }}</th></tr></thead>
      <tbody>
        <tr *ngFor="let b of lines()" class="row" (click)="drill.set(drill() === b.id ? '' : b.id)">
          <td>{{ b.year }}</td><td>{{ b.costCenter || '—' }}</td><td>{{ b.account || '—' }}</td>
          <td class="num">{{ b.budget | num: 2 }}</td><td class="num">{{ b.actual | num: 2 }}</td>
          <td class="num" [class.neg]="b.remaining < 0">{{ b.remaining | num: 2 }}</td>
          <td><div class="bar"><i [style.width.%]="min(b.usedPct)" [class.over]="b.usedPct > 100" [class.warn]="b.usedPct > 85 && b.usedPct <= 100"></i></div><small>{{ b.usedPct }}%</small></td>
        </tr>
        <ng-container *ngIf="drillLines().length">
          <tr class="dh"><td colspan="7">{{ 'fin.bud.drill' | translate }}</td></tr>
          <tr *ngFor="let l of drillLines()" class="dl"><td>{{ l.date | ldate }}</td><td class="mono">{{ l.journal }}</td><td>{{ l.costCenter || '—' }}</td><td>{{ l.account }}</td>
            <td class="num">{{ l.debit | num: 2 }}</td><td class="num">{{ l.credit | num: 2 }}</td><td>{{ l.memo }}</td></tr>
        </ng-container>
      </tbody></table>
      <div class="empty" *ngIf="!lines().length">{{ 'fin.bud.none' | translate }}</div></div></div>

    <h3 class="h">{{ 'fin.nav.budgets' | translate }}</h3>
    <app-fin-crud kind="budget" [company]="ctx.company()" [fields]="fields()" [canManage]="auth.can('finance.budget.manage')" newLabel="fin.bud.new" emptyKey="fin.bud.none" [autoNew]="true" (changed)="budgets.set($event)" />
  `,
  styles: [`.h { margin: 0 0 10px; font-size: 14px; } .card { margin-bottom: 22px; } .row { cursor: pointer; } .neg { color: var(--bad); }
    .bar { height: 7px; background: var(--surface-2, rgba(128,128,128,.18)); border-radius: 4px; overflow: hidden; } .bar i { display: block; height: 100%; background: var(--good, #16a34a); }
    .bar i.warn { background: #f59e0b; } .bar i.over { background: var(--bad); }
    .dh td { font-weight: 600; background: var(--surface-2, rgba(128,128,128,.1)); font-size: 12px; } .dl td { font-size: 12px; }`]
})
export class FinBudgetsComponent implements OnInit {
  auth = inject(AuthService); ctx = inject(ErpContextService); private fin = inject(FinService); private i18n = inject(I18nService);
  budgets = signal<FinRec[]>([]); journals = signal<FinRec[]>([]); drill = signal('');

  ngOnInit() { this.loadJournals(); }
  private loadJournals() {
    this.fin.records('journal', this.ctx.company(), 'Posted').pipe(catchError(() => of([] as FinRec[]))).subscribe(l => this.journals.set(l));
  }
  private accType = (code: string) => String(this.fin.ref('account').find(a => a.code === code)?.data?.['type'] ?? '');
  private posted = computed(() => postedLines(this.journals(), { company: this.ctx.company() }));
  lines = computed<BudgetLine[]>(() => budgetVsActual(this.budgets(), this.posted(), this.accType));
  min = (n: number) => Math.min(100, n);
  drillLines = computed(() => {
    const b = this.lines().find(x => x.id === this.drill());
    if (!b) return [];
    return this.posted().filter(l => l.date.startsWith(String(b.year)) && this.accType(l.account) === 'Expense' && (!b.costCenter || l.costCenter === b.costCenter) && (!b.account || l.account === b.account)).slice(0, 200);
  });

  fields = (): CrudField[] => [
    { key: 'year', label: 'fin.f.year', required: true, def: String(thisYear()), table: true },
    { key: 'costCenter', label: 'fin.f.costCenter', type: 'select', table: true, options: () => this.fin.ref('costcenter').map(c => ({ value: c.code ?? '', label: recLabel(c, this.i18n) })) },
    { key: 'account', label: 'fin.f.account', type: 'select', table: true, options: () => this.fin.ref('account').filter(a => a.data?.['type'] === 'Expense' && !a.data?.['isHeader']).map(a => ({ value: a.code ?? '', label: recLabel(a, this.i18n) })) },
    { key: 'amount', label: 'fin.bud.budget', type: 'number', required: true, table: true },
    { key: 'notes', label: 'fin.f.notes', type: 'textarea' },
  ];
}
