import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of, switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { FinRec } from '../core/fin.models';
import { assetCalc, depreciationDue, round2, schedule } from '../core/fin.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe, StatusComponent } from '../shared/ui';
import { CrudAction, CrudField, FinCrudComponent } from './fin-crud.component';
import { errMsg, finPill, recLabel, thisMonth, todayStr } from './fin-util';

type Tab = 'register' | 'assets' | 'classes' | 'depr';

/**
 * Fixed assets: classes (life + method), the asset register with net book value, disposal and the monthly depreciation run.
 * The run drafts one journal (Dr depreciation expense / Cr accumulated depreciation) which still needs GL approval.
 * Privileges: finance.assets.view / finance.assets.manage (+ finance.gl.manage to draft the journal).
 */
@Component({
  selector: 'app-fin-assets',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, NumPipe, StatusComponent, FinCrudComponent],
  template: `
    <div class="seg sub">
      <button *ngFor="let t of tabs" [class.on]="tab() === t" (click)="pick(t)">{{ 'fin.asset.tab.' + t | translate }}</button>
    </div>
    <p class="flash good" *ngIf="msg">{{ msg }}</p>
    <p class="flash bad" *ngIf="error">{{ error }}</p>

    <ng-container *ngIf="tab() === 'register'">
      <div class="kpis">
        <div class="k"><span>{{ 'fin.asset.cost' | translate }}</span><strong>{{ totals().cost | num: 2 }}</strong></div>
        <div class="k"><span>{{ 'fin.asset.accum' | translate }}</span><strong>{{ totals().acc | num: 2 }}</strong></div>
        <div class="k"><span>{{ 'fin.asset.nbv' | translate }}</span><strong>{{ totals().nbv | num: 2 }}</strong></div>
      </div>
      <div class="card"><div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'fin.f.code' | translate }}</th><th>{{ 'fin.f.name' | translate }}</th><th>{{ 'fin.asset.class' | translate }}</th>
          <th class="num">{{ 'fin.asset.cost' | translate }}</th><th class="num">{{ 'fin.asset.accum' | translate }}</th><th class="num">{{ 'fin.asset.nbv' | translate }}</th>
          <th class="num">{{ 'fin.asset.monthly' | translate }}</th><th>{{ 'fin.f.status' | translate }}</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let a of assets()">
            <td class="mono">{{ a.code }}</td><td>{{ a.data['name'] }}</td><td>{{ a.data['class'] }}</td>
            <td class="num">{{ calc(a).cost | num: 2 }}</td><td class="num">{{ calc(a).accumulated | num: 2 }}</td><td class="num">{{ calc(a).nbv | num: 2 }}</td>
            <td class="num">{{ a.status === 'Active' ? (calc(a).monthly | num: 2) : '' }}</td>
            <td><app-status [status]="pill(a.status)" [label]="'fin.st.' + a.status | translate"></app-status></td>
            <td class="act"><button class="ghost sm" (click)="sched.set(sched() === a.id ? '' : a.id)">{{ 'fin.asset.schedule' | translate }}</button></td>
          </tr>
          <ng-container *ngIf="schedRows().length">
            <tr class="dh"><td colspan="9">{{ 'fin.asset.schedule' | translate }}</td></tr>
            <tr *ngFor="let s of schedRows()" class="dl"><td>{{ s.period }}</td><td colspan="4"></td><td class="num">{{ s.nbv | num: 2 }}</td><td class="num">{{ s.amount | num: 2 }}</td><td colspan="2"></td></tr>
          </ng-container>
        </tbody></table><div class="empty" *ngIf="!assets().length">{{ 'fin.asset.none' | translate }}</div></div></div>
    </ng-container>

    <app-fin-crud #crud *ngIf="tab() === 'assets'" kind="asset" [company]="ctx.company()" [fields]="assetFields()" [canManage]="canManage" newLabel="fin.asset.new" emptyKey="fin.asset.none"
      [actions]="actions" [autoNew]="true" (changed)="assets.set($event)" />
    <app-fin-crud *ngIf="tab() === 'classes'" kind="assetclass" [fields]="classFields()" [canManage]="canManage" newLabel="fin.asset.newClass" emptyKey="fin.asset.noClass" (changed)="classes.set($event)" />

    <ng-container *ngIf="tab() === 'depr'">
      <div class="bar"><label class="lbl">{{ 'fin.asset.upTo' | translate }}</label><input type="month" [ngModel]="month()" (ngModelChange)="month.set($event)" style="width:auto" /></div>
      <div class="card"><div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'fin.f.code' | translate }}</th><th>{{ 'fin.f.name' | translate }}</th><th class="num">{{ 'fin.asset.months' | translate }}</th><th class="num">{{ 'fin.f.amount' | translate }}</th></tr></thead>
        <tbody>
          <tr *ngFor="let d of due()"><td class="mono">{{ d.rec.code }}</td><td>{{ d.rec.data['name'] }}</td><td class="num">{{ d.months }}</td><td class="num">{{ d.amount | num: 2 }}</td></tr>
          <tr class="tot" *ngIf="due().length"><td colspan="3">{{ 'fin.rep.total' | translate }}</td><td class="num">{{ dueTotal() | num: 2 }}</td></tr>
        </tbody></table><div class="empty" *ngIf="!due().length">{{ 'fin.asset.nothingDue' | translate }}</div></div></div>
      <button class="primary" *ngIf="canManage && canGl && due().length" (click)="run()" [disabled]="running">{{ 'fin.asset.run' | translate }}</button>
      <p class="dim" *ngIf="canManage && !canGl">{{ 'fin.asset.needGl' | translate }}</p>
    </ng-container>

    <div class="modal-scrim" *ngIf="disposing" (click)="disposing = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'fin.asset.dispose' | translate }} · {{ disposing.code }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div><label class="lbl">{{ 'fin.f.date' | translate }}</label><input type="date" [(ngModel)]="disposeDate" /></div>
          <div><label class="lbl">{{ 'fin.asset.proceeds' | translate }}</label><input type="number" step="0.01" [(ngModel)]="proceeds" /></div>
        </div><p class="dim">{{ 'fin.asset.disposeHint' | translate }}</p></div>
        <div class="modal-foot"><button (click)="disposing = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="confirmDispose()">{{ 'fin.confirm' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`.sub { margin-bottom: 14px; } .kpis { display: flex; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; } .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
    .k { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 16px; min-width: 150px; display: flex; flex-direction: column; }
    .k span { font-size: 12px; color: var(--text-dim); } .k strong { font-size: 19px; font-variant-numeric: tabular-nums; }
    .act { text-align: end; } .tot td { font-weight: 700; border-top: 2px solid var(--border); } .card { margin-bottom: 14px; }
    .dh td { font-weight: 600; background: var(--surface-2, rgba(128,128,128,.1)); font-size: 12px; } .dl td { font-size: 12px; }`]
})
export class FinAssetsComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); private fin = inject(FinService); private i18n = inject(I18nService);
  @ViewChild('crud') crud?: FinCrudComponent;
  tabs: Tab[] = ['register', 'assets', 'classes', 'depr'];
  tab = signal<Tab>('register');
  assets = signal<FinRec[]>([]); classes = signal<FinRec[]>([]);
  sched = signal(''); month = signal(thisMonth());
  canManage = this.auth.can('finance.assets.manage'); canGl = this.auth.can('finance.gl.manage');
  disposing: FinRec | null = null; disposeDate = todayStr(); proceeds = 0;
  running = false; error = ''; msg = '';

  constructor() { this.loadAssets(); this.fin.records('assetclass').subscribe(l => this.classes.set(l)); }
  loadAssets() { this.fin.records('asset', this.ctx.company()).subscribe({ next: l => this.assets.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  pick(t: Tab) { this.tab.set(t); this.error = ''; if (t === 'register' || t === 'depr') this.loadAssets(); }

  pill = finPill;
  calc = (a: FinRec) => assetCalc(a.data);
  totals = computed(() => {
    const live = this.assets().filter(a => a.status === 'Active').map(a => assetCalc(a.data));
    return { cost: round2(live.reduce((s, c) => s + c.cost, 0)), acc: round2(live.reduce((s, c) => s + c.accumulated, 0)), nbv: round2(live.reduce((s, c) => s + c.nbv, 0)) };
  });
  schedRows = computed(() => { const a = this.assets().find(x => x.id === this.sched()); return a ? schedule(a.data, 12) : []; });

  due = computed(() => this.assets().filter(a => a.status === 'Active').map(rec => ({ rec, ...depreciationDue(rec.data, this.month()) })).filter(d => d.amount > 0));
  dueTotal = () => round2(this.due().reduce((s, d) => s + d.amount, 0));

  run() {
    const df = this.fin.defaults();
    if (!df.deprExpense || !df.deprAccum) { this.error = this.i18n.t('fin.needDefaults'); return; }
    this.running = true; this.error = '';
    const items = this.due();
    const lines = [
      { account: df.deprExpense, debit: this.dueTotal(), credit: 0, memo: this.month() },
      { account: df.deprAccum, debit: 0, credit: this.dueTotal(), memo: this.month() },
    ];
    const lastDay = new Date(Number(this.month().slice(0, 4)), Number(this.month().slice(5, 7)), 0).getDate();
    this.fin.create('journal', {
      company: this.ctx.company(), status: 'Draft',
      data: { date: `${this.month()}-${String(lastDay).padStart(2, '0')}`, memo: `${this.i18n.t('fin.asset.deprMemo')} ${this.month()}`, reference: 'DEPR-' + this.month(), currency: this.ctx.companyObj().currency, rate: 1, lines }
    }).pipe(
      switchMap(j => forkJoin(items.map(d => this.fin.update('asset', d.rec.id, {
        status: d.rec.status, data: { ...d.rec.data, accumulated: round2((Number(d.rec.data['accumulated']) || 0) + d.amount), lastPeriod: d.lastPeriod }
      }))).pipe(switchMap(() => of(j))))
    ).subscribe({
      next: j => { this.running = false; this.flash(this.i18n.t('fin.asset.runDone', { n: j.code ?? '' })); this.loadAssets(); },
      error: e => { this.running = false; this.error = errMsg(e, this.i18n); }
    });
  }

  actions: CrudAction[] = [{ label: 'fin.asset.dispose', danger: true, show: r => this.canManage && r.status === 'Active', run: r => { this.disposing = r; this.disposeDate = todayStr(); this.proceeds = 0; } }];
  confirmDispose() {
    const a = this.disposing!;
    this.fin.update('asset', a.id, { status: 'Disposed', data: { ...a.data, disposalDate: this.disposeDate, proceeds: Number(this.proceeds) || 0 } }).subscribe({
      next: () => { this.disposing = null; this.flash(this.i18n.t('hr.saved')); this.crud?.reload(); this.loadAssets(); },
      error: e => { this.error = errMsg(e, this.i18n); this.disposing = null; }
    });
  }
  flash(t: string) { this.msg = t; setTimeout(() => this.msg = '', 3500); }

  private methods = () => ['SL', 'DB'].map(v => ({ value: v, label: this.i18n.t('fin.asset.m.' + v) }));
  classFields = (): CrudField[] => [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'nameAr', label: 'fin.f.nameAr', rtl: true },
    { key: 'lifeMonths', label: 'fin.asset.life', type: 'number', def: 60, table: true },
    { key: 'method', label: 'fin.asset.method', type: 'select', def: 'SL', table: true, options: this.methods },
  ];
  assetFields = (): CrudField[] => [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'class', label: 'fin.asset.class', type: 'select', required: true, table: true, options: () => this.classes().map(c => ({ value: c.code ?? '', label: recLabel(c, this.i18n) })) },
    { key: 'cost', label: 'fin.asset.cost', type: 'number', required: true, table: true },
    { key: 'salvage', label: 'fin.asset.salvage', type: 'number', def: 0 },
    { key: 'lifeMonths', label: 'fin.asset.life', type: 'number', def: 60 },
    { key: 'method', label: 'fin.asset.method', type: 'select', def: 'SL', options: this.methods },
    { key: 'inServiceDate', label: 'fin.asset.inService', type: 'date', required: true, table: true, def: todayStr() },
    { key: 'accumulated', label: 'fin.asset.accum', type: 'number', def: 0, hint: 'fin.asset.accumHint' },
    { key: 'location', label: 'fin.asset.location' },
    { key: 'status', label: 'fin.f.status', type: 'status', def: 'Active', table: true, options: () => ['Active', 'Disposed'].map(v => ({ value: v, label: this.i18n.t('fin.st.' + v) })) },
  ];
}
