import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ErpDataService, DocStatus } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { MODULES, ModuleKey } from '../core/erp.config';
import { IconComponent } from '../shared/ui';
import { DocTableComponent } from '../shared/erp-widgets';

type Filter = 'all' | DocStatus;

@Component({
  selector: 'app-requests',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, DocTableComponent],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>{{ 'docs.title' | translate }}</h1>
        <p>{{ 'docs.sub' | translate }}</p>
      </div>
      <button (click)="exportCsv()"><app-icon name="download" [size]="15"></app-icon>{{ 'rep.export' | translate }}</button>
    </div>

    <section class="card">
      <div class="toolbar">
        <div class="seg">
          <button [class.on]="scope() === 'mine'" (click)="setScope('mine')">{{ 'docs.mine' | translate }}</button>
          <button [class.on]="scope() === 'all'" (click)="setScope('all')">{{ 'docs.everyone' | translate }}</button>
        </div>
        <div class="seg">
          <button *ngFor="let f of filterList" [class.on]="filter() === f" (click)="filter.set(f)">{{ ('filter.' + f) | translate }}</button>
        </div>
        <select class="mod" [ngModel]="module()" (ngModelChange)="module.set($event)">
          <option value="">{{ 'col.module' | translate }}: {{ 'filter.all' | translate }}</option>
          <option *ngFor="let m of modules" [value]="m.key">{{ ('module.' + m.key) | translate }}</option>
        </select>
        <div class="search">
          <app-icon name="search" [size]="15"></app-icon>
          <input [ngModel]="q()" (ngModelChange)="q.set($event)" [placeholder]="'top.search' | translate" />
        </div>
      </div>
      <app-doc-table [docs]="shown()" [showBranch]="ctx.branch() === 'ALL'"></app-doc-table>
    </section>
  `,
  styles: [`
    .toolbar { display: flex; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; align-items: center; }
    .mod { width: auto; }
    .search { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; flex: 1; min-width: 200px; color: var(--text-dim); background: var(--surface); }
    .search input { border: none; box-shadow: none; padding: 7px 0; }
  `]
})
export class RequestsComponent implements OnInit, OnDestroy {
  modules = MODULES;
  filterList: Filter[] = ['all', 'pending', 'approved', 'rejected', 'canceled'];
  scope = signal<'mine' | 'all'>('mine');
  filter = signal<Filter>('all');
  module = signal<ModuleKey | ''>('');
  q = signal('');
  private sub?: Subscription;

  shown = computed(() => {
    let list = this.scope() === 'mine' ? this.data.myDocs() : this.data.docs();
    if (this.filter() !== 'all') list = list.filter(d => d.status === this.filter());
    if (this.module()) list = list.filter(d => d.module === this.module());
    const q = this.q().trim().toLowerCase();
    if (q) list = list.filter(d => [d.number, d.party, d.title, d.step, d.startedBy, d.branch ?? ''].some(x => x.toLowerCase().includes(q)));
    return list;
  });

  constructor(public data: ErpDataService, public ctx: ErpContextService, private i18n: I18nService, private route: ActivatedRoute, private router: Router) {}

  ngOnInit() {
    this.sub = this.route.queryParamMap.subscribe(p => {
      if (p.get('q') !== null) this.q.set(p.get('q') ?? '');
      if (p.get('scope') === 'all') this.scope.set('all');
    });
    this.data.refresh().subscribe();
  }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  setScope(s: 'mine' | 'all') { this.scope.set(s); }

  exportCsv() {
    const rows = [['Number', 'Type', 'Module', 'Party', 'Date', 'Branch', 'Stage', 'Step', 'Status', 'Currency', 'Total', 'RaisedBy']];
    for (const d of this.shown()) {
      rows.push([d.number, d.docType ? this.i18n.t('doc.' + d.docType.key) : d.title, d.module, d.party, d.date.toISOString().slice(0, 10),
        d.branch ?? '', d.stage, d.step, d.status, d.currency, d.total?.toFixed(2) ?? '', d.startedBy]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `documents-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
