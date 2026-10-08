import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, forkJoin } from 'rxjs';
import { PortalApiService } from '../core/portal-api.service';
import { ErpDataService, ErpDoc } from '../core/erp-data.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { WorkflowTask } from '../core/models';
import { DynamicFormComponent } from '../shared/dynamic-form.component';
import { IconComponent, LocalDatePipe, MoneyPipe, NumPipe } from '../shared/ui';
import { StepperComponent } from '../shared/erp-widgets';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DynamicFormComponent, TranslatePipe, IconComponent, MoneyPipe, NumPipe, LocalDatePipe, StepperComponent],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>{{ 'tasks.title' | translate }}</h1>
        <p>{{ 'tasks.sub' | translate }}</p>
      </div>
      <button *ngIf="checked().size" class="success" (click)="bulkApprove()" [disabled]="busy">
        <app-icon name="check" [size]="15"></app-icon>{{ 'tasks.bulk' | translate }} ({{ checked().size }})
      </button>
      <button (click)="load()"><app-icon name="refresh" [size]="15"></app-icon>{{ 'common.refresh' | translate }}</button>
    </div>

    <div class="layout">
      <section class="card list">
        <div class="list-head">
          <div class="seg">
            <button [class.on]="!highOnly()" (click)="highOnly.set(false)">{{ 'filter.all' | translate }} ({{ data.tasks().length }})</button>
            <button [class.on]="highOnly()" (click)="highOnly.set(true)">{{ 'tasks.highOnly' | translate }}</button>
          </div>
        </div>
        <div class="row" *ngFor="let t of visible()" [class.selected]="t.id === selected?.id" (click)="select(t)">
          <input type="checkbox" *ngIf="canBulk(t)" [checked]="checked().has(t.id)" (click)="$event.stopPropagation()" (change)="toggleCheck(t.id)" />
          <span class="cb-space" *ngIf="!canBulk(t)"></span>
          <div class="row-main">
            <div class="row-top">
              <strong>{{ t.nodeName }}</strong>
              <span class="chip" [class.high]="t.priority === 'High' || t.priority === 'Urgent'">{{ t.priority || 'Normal' }}</span>
              <span class="chip warn" *ngIf="t.isEscalated">{{ 'tasks.escalated' | translate }}</span>
            </div>
            <div class="row-sub">
              <span class="mono">{{ docOf(t)?.number }}</span>
              <span *ngIf="docOf(t)?.party"> · {{ docOf(t)?.party }}</span>
            </div>
          </div>
          <div class="row-end">
            <strong *ngIf="docOf(t)?.total !== null && docOf(t)?.total !== undefined">{{ docOf(t)!.total | money:docOf(t)!.currency }}</strong>
            <small class="dim">{{ ageOf(t) }}</small>
          </div>
        </div>
        <div class="empty" *ngIf="!visible().length">{{ 'tasks.none' | translate }}</div>
      </section>

      <section class="detail" *ngIf="selected as t; else pick">
        <div class="card" *ngIf="docOf(t) as d">
          <div class="card-head">
            <h3>{{ d.docType ? (('doc.' + d.docType.key) | translate) : d.title }} <span class="mono num-tag">{{ d.number }}</span></h3>
            <a [routerLink]="['/documents', d.id]" class="sm-link">{{ 'common.view' | translate }} →</a>
          </div>
          <div class="card-body"><app-stepper [stages]="data.stagesFor(d)" [current]="d.stage" [status]="d.status" [step]="d.step"></app-stepper></div>
          <div class="summary" *ngIf="d.docType">
            <div><span class="k">{{ ('party.' + d.docType.partyKind) | translate }}</span><span class="v">{{ d.party }}</span></div>
            <div><span class="k">{{ 'col.branch' | translate }}</span><span class="v">{{ d.branch }}</span></div>
            <div><span class="k">{{ 'col.by' | translate }}</span><span class="v">{{ d.instance.data['requesterName'] || d.startedBy }}</span></div>
            <div><span class="k">{{ 'form.total' | translate }}</span><span class="v big">{{ d.total | money:d.currency }}</span></div>
          </div>
          <div class="table-wrap" *ngIf="d.lines.length">
            <table class="data">
              <thead><tr><th>{{ 'form.item' | translate }}</th><th class="num">{{ 'form.qty' | translate }}</th><th class="num">{{ 'form.unitPrice' | translate }}</th><th class="num">{{ 'form.amount' | translate }}</th></tr></thead>
              <tbody><tr *ngFor="let l of d.lines"><td>{{ l.item }}</td><td class="num">{{ l.qty | num:2 }} {{ l.unit }}</td><td class="num">{{ l.unitPrice | money:d.currency }}</td><td class="num">{{ l.amount | money:d.currency }}</td></tr></tbody>
            </table>
          </div>
          <div class="card-body notes" *ngIf="d.instance.data['notes']"><span class="k">{{ 'form.notes' | translate }}</span>{{ d.instance.data['notes'] }}</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>{{ 'tasks.stepForm' | translate }}: {{ t.nodeName }}</h3></div>
          <div class="card-body">
            <app-dynamic-form [form]="t.form" [values]="values"></app-dynamic-form>
            <label class="lbl c-lbl">{{ 'tasks.comment' | translate }}</label>
            <textarea rows="2" [(ngModel)]="comment"></textarea>
            <p class="err" *ngIf="error">{{ error }}</p>
            <div class="actions">
              <button *ngFor="let d of t.availableDecisions" [class]="styleFor(d)" (click)="complete(d)" [disabled]="busy">{{ d }}</button>
            </div>
          </div>
        </div>
      </section>
      <ng-template #pick><section class="detail card empty">{{ 'tasks.select' | translate }}</section></ng-template>
    </div>
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 400px 1fr; gap: 18px; align-items: start; }
    .list { overflow: hidden; }
    .list-head { padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .row { display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border); cursor: pointer; border-inline-start: 3px solid transparent; }
    .row:hover { background: var(--surface-2); }
    .row.selected { background: var(--primary-soft); border-inline-start-color: var(--primary); }
    .cb-space, .row input[type=checkbox] { width: 16px; height: 16px; flex-shrink: 0; margin: 0; }
    .row-main { flex: 1; min-width: 0; }
    .row-top { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .row-top strong { font-size: 13px; }
    .row-sub { font-size: 12px; color: var(--text-dim); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-end { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .detail { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
    .num-tag { font-size: 12px; font-weight: 600; color: var(--primary); background: var(--primary-soft); padding: 2px 7px; border-radius: 6px; margin-inline-start: 6px; }
    .sm-link { font-size: 12.5px; font-weight: 600; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 14px 18px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--surface-2); }
    .k { display: block; font-size: 11.5px; color: var(--text-dim); margin-bottom: 2px; }
    .v { font-weight: 600; font-size: 13px; }
    .v.big { font-size: 16px; }
    .notes { font-size: 13px; border-top: 1px solid var(--border); }
    .c-lbl { margin-top: 14px; }
    .actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
    .err { color: var(--bad); font-size: 12.5px; margin: 10px 0 0; }
    @media (max-width: 1050px) { .layout { grid-template-columns: 1fr; } .summary { grid-template-columns: 1fr 1fr; } }
  `]
})
export class TasksComponent implements OnInit, OnDestroy {
  selected: WorkflowTask | null = null;
  values: Record<string, any> = {};
  comment = '';
  error = '';
  busy = false;
  highOnly = signal(false);
  checked = signal<Set<string>>(new Set());
  private sub?: Subscription;
  private wantedTaskId: string | null = null;

  visible = computed(() => {
    const list = [...this.data.tasks()].sort((a, b) => this.prio(b) - this.prio(a) || +new Date(a.createdAt) - +new Date(b.createdAt));
    return this.highOnly() ? list.filter(t => this.prio(t) >= 2) : list;
  });

  constructor(private api: PortalApiService, public data: ErpDataService, private i18n: I18nService, private route: ActivatedRoute) {}

  ngOnInit() {
    this.sub = this.route.queryParamMap.subscribe(p => {
      this.wantedTaskId = p.get('task');
      this.selectWanted();
    });
    this.load();
  }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  load() {
    this.data.refresh().subscribe(() => {
      this.checked.set(new Set([...this.checked()].filter(id => this.data.tasks().some(t => t.id === id))));
      if (this.selected && !this.data.tasks().some(t => t.id === this.selected!.id)) this.selected = null;
      this.selectWanted();
    });
  }

  private selectWanted() {
    if (!this.wantedTaskId) return;
    const t = this.data.tasks().find(x => x.id === this.wantedTaskId);
    if (t) { this.select(t); this.wantedTaskId = null; }
  }

  private prio(t: WorkflowTask) { return ({ Low: 0, Normal: 1, High: 2, Urgent: 3 } as Record<string, number>)[t.priority ?? 'Normal'] ?? 1; }

  docOf(t: WorkflowTask): ErpDoc | undefined { return this.data.docById(t.instanceId); }

  ageOf(t: WorkflowTask) {
    const h = (Date.now() - +new Date(t.createdAt)) / 3_600_000;
    return h < 24 ? `${Math.max(1, Math.round(h))}h` : `${Math.round(h / 24)}d`;
  }

  select(t: WorkflowTask) {
    this.selected = t;
    this.comment = '';
    this.error = '';
    // pre-fill the step's form from data already collected on this document
    const data = this.docOf(t)?.instance.data ?? {};
    this.values = {};
    for (const f of t.form?.fields ?? []) if (data[f.key] !== undefined) this.values[f.key] = data[f.key];
  }

  styleFor(decision: string): string {
    const d = decision.toLowerCase();
    if (/reject|cancel|deny|return|out of stock|write off/.test(d)) return 'danger';
    if (/approve|accept|suitable|success|paid|pay|issued|received|delivered|collected|completed/.test(d)) return 'success';
    return 'primary';
  }

  private isNegative(decision: string) { return this.styleFor(decision) === 'danger'; }

  private missingRequired(t: WorkflowTask, values: Record<string, any>) {
    return (t.form?.fields ?? []).some(f => f.required && !f.readOnly && (values[f.key] === undefined || values[f.key] === null || values[f.key] === ''));
  }

  /** Only steps whose positive outcome needs no extra input can be bulk-approved. */
  canBulk(t: WorkflowTask) {
    return t.availableDecisions.some(d => /^approve/i.test(d)) && !(t.form?.fields ?? []).some(f => f.required && !f.readOnly);
  }

  toggleCheck(id: string) {
    const s = new Set(this.checked());
    s.has(id) ? s.delete(id) : s.add(id);
    this.checked.set(s);
  }

  complete(decision: string) {
    const t = this.selected;
    if (!t) return;
    if (!this.isNegative(decision) && this.missingRequired(t, this.values)) { this.error = this.i18n.t('tasks.missing'); return; }
    this.busy = true;
    this.api.completeTask(t.id, decision, this.onlyEditable(t, this.values), this.comment).subscribe({
      next: () => { this.busy = false; this.selected = null; this.load(); },
      error: err => { this.busy = false; this.error = typeof err?.error === 'string' ? err.error : 'Error'; }
    });
  }

  bulkApprove() {
    const ids = [...this.checked()];
    const calls = ids.map(id => {
      const t = this.data.tasks().find(x => x.id === id)!;
      const dec = t.availableDecisions.find(d => /^approve/i.test(d))!;
      return this.api.completeTask(id, dec, {}, 'Bulk approved');
    });
    if (!calls.length) return;
    this.busy = true;
    forkJoin(calls).subscribe({
      next: () => { this.busy = false; this.checked.set(new Set()); this.selected = null; this.load(); },
      error: () => { this.busy = false; this.load(); }
    });
  }

  /** Send back only the fields this step owns - read-only echoes of earlier data are not re-submitted. */
  private onlyEditable(t: WorkflowTask, values: Record<string, any>) {
    const editable = new Set((t.form?.fields ?? []).filter(f => !f.readOnly).map(f => f.key));
    return Object.fromEntries(Object.entries(values).filter(([k]) => editable.has(k)));
  }
}
