import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '../core/translate.pipe';
import { FinAccountsComponent } from './fin-accounts.component';
import { FinJournalsComponent } from './fin-journals.component';
import { FinPeriodsComponent } from './fin-periods.component';
import { FinReportsComponent } from './fin-reports.component';

type Tab = 'journals' | 'accounts' | 'periods' | 'reports';

/** General ledger: journals, chart of accounts, periods and the financial reports. */
@Component({
  selector: 'app-fin-gl',
  standalone: true,
  imports: [CommonModule, TranslatePipe, FinAccountsComponent, FinJournalsComponent, FinPeriodsComponent, FinReportsComponent],
  template: `
    <div class="seg sub">
      <button *ngFor="let t of tabs" [class.on]="tab() === t" (click)="tab.set(t)">{{ 'fin.gl.' + t | translate }}</button>
    </div>
    <app-fin-journals *ngIf="tab() === 'journals'" />
    <app-fin-accounts *ngIf="tab() === 'accounts'" />
    <app-fin-periods *ngIf="tab() === 'periods'" />
    <app-fin-reports *ngIf="tab() === 'reports'" />
  `,
  styles: [`.sub { margin-bottom: 14px; }`]
})
export class FinGlComponent implements OnInit {
  private route = inject(ActivatedRoute);
  tabs: Tab[] = ['journals', 'accounts', 'periods', 'reports'];
  tab = signal<Tab>('journals');
  ngOnInit() {
    const t = this.route.snapshot.queryParamMap.get('tab') as Tab | null;
    if (t && this.tabs.includes(t)) this.tab.set(t);
  }
}
