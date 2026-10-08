import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError, of } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { FinRec } from '../core/fin.models';
import { postedLines, projectResults } from '../core/fin.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';
import { CrudField, FinCrudComponent } from './fin-crud.component';

/** Project accounting: projects (a journal-line dimension) with revenue, cost and margin from the posted ledger. */
@Component({
  selector: 'app-fin-projects',
  standalone: true,
  imports: [CommonModule, TranslatePipe, NumPipe, FinCrudComponent],
  template: `
    <h3 class="h">{{ 'fin.prj.profit' | translate }}</h3>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'fin.f.code' | translate }}</th><th>{{ 'fin.f.name' | translate }}</th><th class="num">{{ 'fin.prj.revenue' | translate }}</th><th class="num">{{ 'fin.prj.cost' | translate }}</th>
        <th class="num">{{ 'fin.prj.result' | translate }}</th><th class="num">{{ 'fin.prj.margin' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let r of results()"><td class="mono">{{ r.code }}</td><td>{{ nameOf(r.code) }}</td><td class="num">{{ r.revenue | num: 2 }}</td><td class="num">{{ r.cost | num: 2 }}</td>
        <td class="num" [class.neg]="r.profit < 0">{{ r.profit | num: 2 }}</td><td class="num">{{ r.marginPct }}%</td></tr></tbody></table>
      <div class="empty" *ngIf="!results().length">{{ 'fin.prj.none' | translate }}</div></div></div>
    <p class="dim hint">{{ 'fin.prj.hint' | translate }}</p>
    <app-fin-crud kind="project" [fields]="fields()" [canManage]="auth.can('finance.projects.manage')" newLabel="fin.prj.new" emptyKey="fin.prj.none" [autoNew]="true" (changed)="projects.set($event)" />
  `,
  styles: [`.h { margin: 0 0 10px; font-size: 14px; } .card { margin-bottom: 8px; } .neg { color: var(--bad); } .hint { font-size: 12px; margin: 0 0 18px; }`]
})
export class FinProjectsComponent implements OnInit {
  auth = inject(AuthService); private ctx = inject(ErpContextService); private fin = inject(FinService); private i18n = inject(I18nService);
  projects = signal<FinRec[]>([]); journals = signal<FinRec[]>([]);
  ngOnInit() { this.fin.records('journal', this.ctx.company(), 'Posted').pipe(catchError(() => of([] as FinRec[]))).subscribe(l => this.journals.set(l)); }
  private accType = (code: string) => String(this.fin.ref('account').find(a => a.code === code)?.data?.['type'] ?? '');
  results = computed(() => projectResults(this.projects(), postedLines(this.journals(), { company: this.ctx.company() }), this.accType));
  nameOf(code: string) { const p = this.projects().find(x => x.code === code); return (this.i18n.lang() === 'ar' && p?.data['nameAr']) || p?.data['name'] || ''; }

  fields = (): CrudField[] => [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'nameAr', label: 'fin.f.nameAr', rtl: true },
    { key: 'customer', label: 'fin.f.customer', table: true },
    { key: 'budget', label: 'fin.bud.budget', type: 'number', def: 0, table: true },
    { key: 'startDate', label: 'fin.prj.start', type: 'date' },
    { key: 'endDate', label: 'fin.prj.end', type: 'date' },
    { key: 'status', label: 'fin.f.status', type: 'status', def: 'Active', table: true, options: () => ['Active', 'Closed'].map(v => ({ value: v, label: this.i18n.t('fin.st.' + v) })) },
  ];
}
