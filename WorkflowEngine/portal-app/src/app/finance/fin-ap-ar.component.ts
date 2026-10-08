import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { FinRec } from '../core/fin.models';
import { agingByParty } from '../core/fin.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';
import { CrudField, FinCrudComponent } from './fin-crud.component';
import { FinInvoicesComponent } from './fin-invoices.component';
import { recName, todayStr } from './fin-util';

type Tab = 'invoices' | 'parties' | 'aging';

/** Payables (suppliers) and receivables (customers): invoices, the party list and the ageing report. */
@Component({
  selector: 'app-fin-ap-ar',
  standalone: true,
  imports: [CommonModule, TranslatePipe, NumPipe, FinCrudComponent, FinInvoicesComponent],
  template: `
    <div class="seg sub">
      <button *ngFor="let t of tabs" [class.on]="tab() === t" (click)="pick(t)">{{ 'fin.sub.' + t | translate }}</button>
    </div>
    <app-fin-invoices *ngIf="tab() === 'invoices'" [side]="side" />
    <app-fin-crud *ngIf="tab() === 'parties'" [kind]="side === 'ap' ? 'vendor' : 'customer'" [fields]="fields()" [canManage]="canManageParties()"
      [newLabel]="side === 'ap' ? 'fin.vendor.new' : 'fin.customer.new'" emptyKey="fin.party.none" (changed)="refresh()" />
    <div class="card" *ngIf="tab() === 'aging'">
      <div class="table-wrap"><table class="data">
        <thead><tr><th>{{ (side === 'ap' ? 'fin.f.vendor' : 'fin.f.customer') | translate }}</th>
          <th class="num" *ngFor="let b of buckets">{{ 'fin.aging.' + b | translate }}</th><th class="num">{{ 'fin.f.total' | translate }}</th></tr></thead>
        <tbody>
          <tr *ngFor="let p of aging().parties"><td>{{ partyName(p.party) }}</td><td class="num" *ngFor="let v of p.buckets">{{ v | num: 2 }}</td><td class="num"><strong>{{ p.total | num: 2 }}</strong></td></tr>
          <tr class="tot" *ngIf="aging().parties.length"><td>{{ 'fin.rep.total' | translate }}</td><td class="num" *ngFor="let v of aging().totals">{{ v | num: 2 }}</td><td class="num">{{ grand() | num: 2 }}</td></tr>
        </tbody></table>
        <div class="empty" *ngIf="!aging().parties.length">{{ 'fin.aging.none' | translate }}</div></div>
    </div>
  `,
  styles: [`.sub { margin-bottom: 14px; } .tot td { font-weight: 700; border-top: 2px solid var(--border); }`]
})
export class FinApArComponent implements OnInit {
  @Input() side: 'ap' | 'ar' = 'ap';
  private auth = inject(AuthService); private fin = inject(FinService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  tabs: Tab[] = ['invoices', 'parties', 'aging'];
  tab = signal<Tab>('invoices');
  invoices = signal<FinRec[]>([]);
  buckets = ['current', '1-30', '31-60', '61-90', '90+'];

  ngOnInit() {
    const t = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (t && this.tabs.includes(t)) this.tab.set(t);
  }
  pick(t: Tab) {
    this.tab.set(t);
    if (t === 'aging') this.fin.records(this.side === 'ap' ? 'apinvoice' : 'arinvoice', this.ctx.company()).subscribe(l => this.invoices.set(l));
  }
  canManageParties = () => this.auth.can(this.side === 'ap' ? 'finance.ap.manage' : 'finance.ar.manage');
  refresh() { this.fin.loadRefs([this.side === 'ap' ? 'vendor' : 'customer']).subscribe(); }
  aging = () => agingByParty(this.invoices(), this.side === 'ap' ? 'vendor' : 'customer', this.side === 'ap' ? ['Submitted', 'Approved', 'Held'] : ['Issued'], todayStr());
  grand = () => this.aging().totals.reduce((s, v) => s + v, 0);
  partyName(code: string) { return recName(this.fin.ref(this.side === 'ap' ? 'vendor' : 'customer').find(p => p.code === code), this.i18n) || code; }

  fields = (): CrudField[] => [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'nameAr', label: 'fin.f.nameAr', rtl: true },
    { key: 'email', label: 'fin.f.email', table: true },
    { key: 'phone', label: 'fin.f.phone' },
    { key: 'taxNo', label: 'fin.f.taxNo' },
    { key: 'termsDays', label: 'fin.f.termsDays', type: 'number', def: 30, table: true },
    ...(this.side === 'ar' ? [{ key: 'creditLimit', label: 'fin.f.creditLimit', type: 'number' as const, def: 0, table: true }] : []),
    { key: 'status', label: 'fin.f.status', type: 'status', def: 'Active', table: true, options: () => ['Active', 'Inactive'].map(v => ({ value: v, label: this.i18n.t('fin.st.' + v) })) },
  ];
}

@Component({ selector: 'app-fin-payables', standalone: true, imports: [FinApArComponent], template: `<app-fin-ap-ar side="ap" />` })
export class FinPayablesComponent {}

@Component({ selector: 'app-fin-receivables', standalone: true, imports: [FinApArComponent], template: `<app-fin-ap-ar side="ar" />` })
export class FinReceivablesComponent {}
