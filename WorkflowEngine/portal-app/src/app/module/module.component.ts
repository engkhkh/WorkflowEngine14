import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ErpDataService } from '../core/erp-data.service';
import { TranslatePipe } from '../core/translate.pipe';
import { MoneyPipe } from '../core/money.pipe';
import { IconComponent } from '../shared/icon.component';
import { ErpDoc, ErpModule, MODULES, ModuleKey, STAGES, StageKey, definitionsFor } from '../core/erp';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'canceled';

@Component({
  selector: 'app-module',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, MoneyPipe, IconComponent],
  template: `
    <ng-container *ngIf="mod as m">
      <div class="page-head">
        <span class="m-ico" [style.--c]="m.color"><app-icon [name]="m.icon" [size]="22" /></span>
        <div>
          <h1>{{ ('module.' + m.key) | translate }}</h1>
          <p class="sub">{{ ('module.' + m.key + '.sub') | translate }}</p>
        </div>
        <div class="grow"></div>
        <a class="new primary-link" *ngFor="let d of processes" [routerLink]="['/submit']" [queryParams]="{ def: d.id }">
          <app-icon name="plus" [size]="15" /> {{ d.name }}
        </a>
      </div>

      <div class="stats">
        <div class="card stat"><span>{{ 'mod.total' | translate }}</span><b>{{ docs.length }}</b></div>
        <div class="card stat"><span>{{ 'filter.pending' | translate }}</span><b class="amber">{{ count('pending') }}</b></div>
        <div class="card stat"><span>{{ 'filter.approved' | translate }}</span><b class="green">{{ count('approved') }}</b></div>
        <div class="card stat"><span>{{ 'filter.rejected' | translate }}</span><b class="red">{{ count('rejected') }}</b></div>
        <div class="card stat wide"><span>{{ 'mod.value' | translate }}</span><b>{{ value | money }}</b></div>
      </div>

      <div class="card">
        <div class="card-head toolbar">
          <h3>{{ 'mod.documents' | translate }}</h3>
          <div class="seg">
            <button *ngFor="let f of statusFilters" [class.active]="status === f" (click)="status = f">{{ ('filter.' + f) | translate }}</button>
          </div>
          <span class="grow"></span>
          <select [(ngModel)]="stage" class="stage-sel">
            <option value="all">{{ 'mod.filterAll' | translate }}</option>
            <option *ngFor="let s of stages" [value]="s">{{ ('stage.' + s) | translate }}</option>
          </select>
          <input class="filter" [(ngModel)]="q" [placeholder]="'mod.search' | translate" />
        </div>
        <div class="table-wrap">
          <table class="erp-table">
            <thead>
              <tr>
                <th>{{ 'col.doc' | translate }}</th>
                <th>{{ 'col.process' | translate }}</th>
                <th>{{ 'col.party' | translate }}</th>
                <th>{{ 'col.branch' | translate }}</th>
                <th>{{ 'col.stage' | translate }}</th>
                <th>{{ 'col.waitingOn' | translate }}</th>
                <th class="num">{{ 'col.amount' | translate }}</th>
                <th>{{ 'col.date' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              <tr class="clickable" *ngFor="let d of shown" [routerLink]="['/requests', d.id]">
                <td class="mono">{{ d.docNo }}</td>
                <td>{{ d.title }}<div class="dim">{{ d.requester }}</div></td>
                <td>{{ d.party || '—' }}<div class="dim" *ngIf="d.item">{{ d.item }}</div></td>
                <td class="dim">{{ d.branch || '—' }}</td>
                <td>
                  <span class="badge" [class]="d.outcome">
                    <i class="live-dot" *ngIf="d.outcome === 'pending'"></i>
                    {{ (d.outcome === 'pending' ? 'stage.' + d.stage : 'filter.' + d.outcome) | translate }}
                  </span>
                </td>
                <td class="dim">{{ d.currentStep || '—' }}</td>
                <td class="num">{{ d.amount ? (d.amount | money:d.currency) : '—' }}</td>
                <td class="dim">{{ d.startedAt | date:'mediumDate' }}</td>
              </tr>
            </tbody>
          </table>
          <div class="empty" *ngIf="shown.length === 0">{{ 'mod.none' | translate }}</div>
        </div>
      </div>

      <div class="card procs">
        <div class="card-head"><h3>{{ 'mod.processes' | translate }}</h3></div>
        <div class="proc-grid">
          <div class="proc" *ngFor="let d of processes">
            <b>{{ d.name }}</b>
            <p>{{ d.description }}</p>
            <div class="steps">
              <span class="chip" *ngFor="let s of stepsOf(d)">{{ s }}</span>
            </div>
            <a [routerLink]="['/submit']" [queryParams]="{ def: d.id }" class="start">{{ 'submit.start' | translate }} <app-icon name="arrow" [size]="13" class="flip-rtl" /></a>
          </div>
          <div class="empty" *ngIf="processes.length === 0">{{ 'mod.noProcesses' | translate }}</div>
        </div>
      </div>
    </ng-container>
  `,
  styles: [`
    .page-head { align-items: center; }
    .m-ico { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; color: var(--c); background: color-mix(in srgb, var(--c) 13%, transparent); }
    .new { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 8px; background: var(--accent); color: #fff; text-decoration: none; font-size: 13px; font-weight: 600; }
    .new:hover { background: #4338ca; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr) 1.5fr; gap: 12px; margin-bottom: 18px; }
    .stat { padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; }
    .stat span { font-size: 12px; color: var(--text-dim); }
    .stat b { font-size: 20px; }
    .amber { color: var(--amber); } .green { color: var(--green); } .red { color: var(--red); }
    .toolbar { flex-wrap: wrap; }
    .stage-sel { width: auto; }
    .filter { width: 180px; }
    .procs { margin-top: 18px; }
    .proc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; padding: 16px; }
    .proc { border: 1px solid var(--border-soft); border-radius: 10px; padding: 14px; background: var(--panel-2); display: flex; flex-direction: column; gap: 8px; }
    .proc p { margin: 0; font-size: 12.5px; color: var(--text-dim); line-height: 1.5; }
    .steps { display: flex; flex-wrap: wrap; gap: 5px; }
    .start { font-size: 12.5px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; margin-top: auto; }
    @media (max-width: 900px) { .stats { grid-template-columns: repeat(2, 1fr); } .stat.wide { grid-column: 1 / -1; } .filter { width: 100%; } }
  `]
})
export class ModuleComponent implements OnInit {
  mod?: ErpModule;
  status: StatusFilter = 'all';
  stage: StageKey | 'all' = 'all';
  q = '';
  statusFilters: StatusFilter[] = ['all', 'pending', 'approved', 'rejected', 'canceled'];
  stages = STAGES;

  constructor(private route: ActivatedRoute, private router: Router, public erp: ErpDataService) {}

  ngOnInit() {
    this.erp.ensureLoaded();
    this.route.paramMap.subscribe(p => {
      this.mod = MODULES.find(m => m.key === p.get('module'));
      if (!this.mod) this.router.navigate(['/dashboard']);
      this.status = 'all'; this.stage = 'all'; this.q = '';
    });
  }

  get docs(): ErpDoc[] { return this.mod ? this.erp.docsFor(this.mod.key as ModuleKey) : []; }
  get processes() { return this.mod ? definitionsFor(this.mod.key, this.erp.definitions()) : []; }
  get value(): number { return this.docs.filter(d => d.outcome === 'approved' || d.outcome === 'pending').reduce((s, d) => s + d.amountBase, 0); }
  count(o: string): number { return this.docs.filter(d => d.outcome === o).length; }

  get shown(): ErpDoc[] {
    const q = this.q.trim().toLowerCase();
    return this.docs.filter(d =>
      (this.status === 'all' || d.outcome === this.status) &&
      (this.stage === 'all' || d.stage === this.stage) &&
      (!q || [d.docNo, d.title, d.party, d.item, d.requester, d.branch].some(v => v?.toLowerCase().includes(q))));
  }

  stepsOf(d: { nodes?: { type: string; name: string; x: number }[] }): string[] {
    return (d.nodes ?? []).filter(n => n.type === 'FormTask' || n.type === 'ApprovalTask' || n.type === 'Logger')
      .sort((a, b) => a.x - b.x).map(n => n.name);
  }
}
