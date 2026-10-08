import { Component, Input, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { Employee, HrKind, HrRecord } from '../core/hr.models';
import { IconComponent } from '../shared/ui';
import { empName, errMsg } from './hr-util';

type Tab = 'goals' | 'reviews' | 'distribution';
const STAGES = ['MidYear', 'Final', 'Calibrated'];

/** Performance: goals & KPIs, reviews (mid-year / final / calibrated), rating distribution. Changing data needs hr.performance.manage. */
@Component({
  selector: 'app-hr-performance',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <div class="flash" [class.bad]="flashBad" *ngIf="flashMsg">{{ flashMsg }}</div>
    <div class="bar">
      <div class="seg">
        <button [class.on]="tab() === 'goals'" (click)="tab.set('goals')">{{ 'hr.pf.goals' | translate }}</button>
        <button [class.on]="tab() === 'reviews'" (click)="tab.set('reviews')">{{ 'hr.pf.reviews' | translate }}</button>
        <button *ngIf="viewAll" [class.on]="tab() === 'distribution'" (click)="tab.set('distribution')">{{ 'hr.pf.distribution' | translate }}</button>
      </div>
      <label class="cyc">{{ 'hr.pf.cycle' | translate }} <input [ngModel]="cycle()" (ngModelChange)="cycle.set($event)" list="cycles" /></label>
      <datalist id="cycles"><option *ngFor="let c of cycles()" [value]="c"></option></datalist>
      <span class="grow"></span>
      <button class="primary" *ngIf="canManage && tab() !== 'distribution'" (click)="open(null)"><app-icon name="plus" [size]="15"></app-icon>{{ (tab() === 'goals' ? 'hr.pf.newGoal' : 'hr.pf.newReview') | translate }}</button>
    </div>

    <div class="card" *ngIf="tab() === 'goals'">
      <div class="table-wrap"><table class="data">
        <thead><tr><th *ngIf="viewAll">{{ 'hr.lv.employee' | translate }}</th><th>{{ 'hr.pf.goal' | translate }}</th><th class="num">{{ 'hr.pf.weight' | translate }}</th>
          <th class="num">{{ 'hr.pf.target' | translate }}</th><th class="num">{{ 'hr.pf.actual' | translate }}</th><th>{{ 'hr.pf.progress' | translate }}</th><th></th></tr></thead>
        <tbody><tr *ngFor="let g of goals()">
          <td *ngIf="viewAll"><strong>{{ empLabel(g.empNo) }}</strong><div class="dim mono">{{ g.empNo }}</div></td>
          <td><strong>{{ g.data['title'] }}</strong><div class="dim">{{ g.data['kpi'] }}</div></td>
          <td class="num">{{ g.data['weight'] }}%</td><td class="num">{{ g.data['target'] }}</td><td class="num">{{ g.data['actual'] }}</td>
          <td><div class="barp"><div [style.width.%]="pct(g)" [class.ok]="pct(g) >= 100"></div></div><span class="dim">{{ pct(g) }}%</span></td>
          <td class="act"><ng-container *ngIf="canManage"><button class="ghost sm" (click)="open(g)"><app-icon name="edit" [size]="15"></app-icon></button>
            <button class="ghost sm danger-i" (click)="remove('goal', g)"><app-icon name="trash" [size]="15"></app-icon></button></ng-container></td>
        </tr></tbody></table></div>
      <div class="empty" *ngIf="!goals().length">{{ 'common.noData' | translate }}</div>
    </div>

    <div class="card" *ngIf="tab() === 'reviews'">
      <div class="table-wrap"><table class="data">
        <thead><tr><th *ngIf="viewAll">{{ 'hr.lv.employee' | translate }}</th><th>{{ 'hr.pf.stage' | translate }}</th><th>{{ 'hr.pf.rating' | translate }}</th><th>{{ 'hr.pf.comments' | translate }}</th><th>{{ 'hr.pf.reviewer' | translate }}</th><th></th></tr></thead>
        <tbody><tr *ngFor="let r of reviews()">
          <td *ngIf="viewAll"><strong>{{ empLabel(r.empNo) }}</strong><div class="dim mono">{{ r.empNo }}</div></td>
          <td><span class="chip">{{ 'hr.pf.st.' + (r.data['stage'] || 'Final') | translate }}</span></td>
          <td><span class="stars">{{ stars(r.data['rating']) }}</span> <span class="dim">{{ r.data['rating'] }}/5</span></td>
          <td class="dim why">{{ r.data['comments'] }}</td><td class="dim">{{ r.data['reviewer'] }}</td>
          <td class="act"><ng-container *ngIf="canManage"><button class="ghost sm" (click)="open(r)"><app-icon name="edit" [size]="15"></app-icon></button>
            <button class="ghost sm danger-i" (click)="remove('review', r)"><app-icon name="trash" [size]="15"></app-icon></button></ng-container></td>
        </tr></tbody></table></div>
      <div class="empty" *ngIf="!reviews().length">{{ 'common.noData' | translate }}</div>
    </div>

    <div class="grid two" *ngIf="tab() === 'distribution'">
      <div class="card"><div class="card-head"><h3>{{ 'hr.pf.distribution' | translate }}</h3><span class="sub">{{ 'hr.pf.avg' | translate }}: <b>{{ avg() }}</b></span></div>
        <div class="card-body hist">
          <div class="col" *ngFor="let h of histogram()"><div class="val">{{ h.count }}</div><div class="fill" [style.height.%]="h.pct"></div><div class="lab">{{ h.rating }} ★</div></div>
        </div><div class="empty" *ngIf="!ratedCount()">{{ 'common.noData' | translate }}</div></div>
      <div class="card"><div class="card-head"><h3>{{ 'hr.pf.attain' | translate }}</h3></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>{{ 'hr.lv.employee' | translate }}</th><th class="num">{{ 'hr.pf.goalsN' | translate }}</th><th class="num">{{ 'hr.pf.attainPct' | translate }}</th></tr></thead>
          <tbody><tr *ngFor="let a of attainment()"><td>{{ empLabel(a.empNo) }}</td><td class="num">{{ a.n }}</td><td class="num"><b>{{ a.pct }}%</b></td></tr></tbody></table></div>
        <div class="empty" *ngIf="!attainment().length">{{ 'common.noData' | translate }}</div></div>
    </div>

    <div class="modal-scrim" *ngIf="form" (click)="form = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (tab() === 'goals' ? 'hr.pf.goal' : 'hr.pf.review') | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div class="full"><label class="lbl">{{ 'hr.lv.employee' | translate }}</label>
            <select [(ngModel)]="form.empNo"><option value="">—</option><option *ngFor="let e of activeEmps()" [value]="e.empNo">{{ e.empNo }} · {{ name(e) }}</option></select></div>
          <div><label class="lbl">{{ 'hr.pf.cycle' | translate }}</label><input [(ngModel)]="form.cycle" /></div>
          <ng-container *ngIf="tab() === 'goals'">
            <div><label class="lbl">{{ 'hr.pf.weight' | translate }} (%)</label><input type="number" min="0" max="100" [(ngModel)]="form.weight" /></div>
            <div class="full"><label class="lbl">{{ 'hr.pf.goal' | translate }}</label><input [(ngModel)]="form.title" /></div>
            <div class="full"><label class="lbl">KPI</label><input [(ngModel)]="form.kpi" /></div>
            <div><label class="lbl">{{ 'hr.pf.target' | translate }}</label><input type="number" [(ngModel)]="form.target" /></div>
            <div><label class="lbl">{{ 'hr.pf.actual' | translate }}</label><input type="number" [(ngModel)]="form.actual" /></div>
          </ng-container>
          <ng-container *ngIf="tab() === 'reviews'">
            <div><label class="lbl">{{ 'hr.pf.stage' | translate }}</label><select [(ngModel)]="form.stage"><option *ngFor="let s of stagesList" [value]="s">{{ 'hr.pf.st.' + s | translate }}</option></select></div>
            <div><label class="lbl">{{ 'hr.pf.rating' | translate }} (1-5)</label><select [(ngModel)]="form.rating"><option *ngFor="let n of [1,2,3,4,5]" [ngValue]="n">{{ n }}</option></select></div>
            <div class="full"><label class="lbl">{{ 'hr.pf.comments' | translate }}</label><input [(ngModel)]="form.comments" /></div>
          </ng-container>
        </div><p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="form = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="save()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; } .grow { flex: 1; }
    .cyc { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-2); } .cyc input { width: 110px; }
    .act { white-space: nowrap; text-align: end; } .danger-i { color: var(--bad); } .why { max-width: 280px; }
    .barp { width: 120px; height: 7px; background: var(--surface-3); border-radius: 4px; overflow: hidden; display: inline-block; vertical-align: middle; margin-inline-end: 8px; }
    .barp div { height: 100%; background: var(--primary); } .barp div.ok { background: var(--ok); }
    .stars { color: #f5a623; letter-spacing: 1px; }
    .two { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); align-items: start; }
    .hist { display: flex; gap: 14px; align-items: flex-end; height: 200px; padding-top: 24px; }
    .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 4px; }
    .fill { width: 100%; max-width: 54px; background: var(--primary); border-radius: 6px 6px 0 0; min-height: 3px; } .val { font-size: 13px; font-weight: 650; } .lab { font-size: 12px; color: var(--text-dim); }
  `]
})
export class HrPerformanceComponent implements OnInit {
  stagesList = STAGES;
  tab = signal<Tab>('goals');
  cycle = signal(String(new Date().getFullYear()));
  allGoals = signal<HrRecord[]>([]);
  allReviews = signal<HrRecord[]>([]);
  emps = signal<Employee[]>([]);
  form: any = null; saving = false; formError = ''; flashMsg = ''; flashBad = false; editId = '';

  /** true on the self-service page: only my own goals and reviews, read-only */
  @Input() mine = false;
  me = signal<Employee | null>(null);
  get viewAll() { return !this.mine && this.auth.can('hr.performance.view'); }
  get canManage() { return !this.mine && this.auth.can('hr.performance.manage'); }

  private own = (r: HrRecord) => !this.mine || r.empNo === this.me()?.empNo;
  goals = computed(() => this.allGoals().filter(g => this.own(g) && (!this.cycle() || g.data['cycle'] === this.cycle())));
  reviews = computed(() => this.allReviews().filter(g => this.own(g) && (!this.cycle() || g.data['cycle'] === this.cycle())));
  cycles = computed(() => Array.from(new Set([...this.allGoals(), ...this.allReviews()].map(r => String(r.data['cycle'] ?? '')).filter(Boolean))));
  activeEmps = computed(() => this.emps().filter(e => e.status !== 'Terminated'));
  rated = computed(() => this.reviews().filter(r => Number(r.data['rating']) > 0));
  ratedCount = computed(() => this.rated().length);
  avg = computed(() => { const l = this.rated(); return l.length ? (l.reduce((s, r) => s + Number(r.data['rating']), 0) / l.length).toFixed(2) : '—'; });
  histogram = computed(() => {
    const counts = [1, 2, 3, 4, 5].map(n => ({ rating: n, count: this.rated().filter(r => Number(r.data['rating']) === n).length }));
    const max = Math.max(1, ...counts.map(c => c.count));
    return counts.map(c => ({ ...c, pct: c.count / max * 78 }));
  });
  attainment = computed(() => {
    const by = new Map<string, HrRecord[]>();
    for (const g of this.goals()) by.set(g.empNo ?? '', [...(by.get(g.empNo ?? '') ?? []), g]);
    return Array.from(by.entries()).map(([empNo, gs]) => {
      const w = gs.reduce((s, g) => s + Number(g.data['weight'] ?? 0), 0) || gs.length;
      const score = gs.reduce((s, g) => s + (Number(g.data['weight'] ?? 0) || 1) * Math.min(1.2, this.ratio(g)), 0);
      return { empNo, n: gs.length, pct: Math.round(score / w * 100) };
    }).sort((a, b) => b.pct - a.pct);
  });

  constructor(public auth: AuthService, private hr: HrService, private i18n: I18nService) {}

  ngOnInit() {
    this.load();
    if (this.mine) this.hr.me().subscribe({ next: e => this.me.set(e), error: () => {} });
    else if (this.viewAll || this.canManage) this.hr.employees().subscribe({ next: l => this.emps.set(l), error: () => {} });
  }
  load() {
    this.hr.records('goal').subscribe({ next: l => this.allGoals.set(l), error: e => this.flash(errMsg(e, this.i18n), true) });
    this.hr.records('review').subscribe({ next: l => this.allReviews.set(l), error: () => {} });
  }

  name(e: Employee) { return empName(e, this.i18n); }
  empLabel(no: string | null | undefined) { const e = this.emps().find(x => x.empNo === no); return e ? this.name(e) : (no ?? ''); }
  ratio(g: HrRecord) { const t = Number(g.data['target']), a = Number(g.data['actual']); return t > 0 ? a / t : 0; }
  pct(g: HrRecord) { return Math.min(100, Math.round(this.ratio(g) * 100)); }
  stars(n: number) { return '★'.repeat(Math.max(0, Math.min(5, Number(n) || 0))) + '☆'.repeat(5 - Math.max(0, Math.min(5, Number(n) || 0))); }

  open(rec: HrRecord | null) {
    this.formError = ''; this.editId = rec?.id ?? '';
    this.form = rec ? { empNo: rec.empNo, ...rec.data } : this.tab() === 'goals'
      ? { empNo: '', cycle: this.cycle(), title: '', kpi: '', weight: 20, target: 100, actual: 0 }
      : { empNo: '', cycle: this.cycle(), stage: 'Final', rating: 3, comments: '' };
  }
  save() {
    const f = this.form; const kind: HrKind = this.tab() === 'goals' ? 'goal' : 'review';
    if (!f.empNo || (kind === 'goal' && !String(f.title ?? '').trim())) { this.formError = this.i18n.t('hr.err.required'); return; }
    const { empNo, ...data } = f;
    if (kind === 'review') data.reviewer = data.reviewer ?? this.auth.currentUser()?.displayName;
    this.saving = true; this.formError = '';
    const body = { empNo, status: kind === 'goal' ? 'Active' : 'Final', data };
    (this.editId ? this.hr.updateRecord(kind, this.editId, body) : this.hr.createRecord(kind, body)).subscribe({
      next: () => { this.saving = false; this.form = null; this.flash(this.i18n.t('hr.saved')); this.load(); },
      error: e => { this.saving = false; this.formError = errMsg(e, this.i18n); }
    });
  }
  remove(kind: HrKind, r: HrRecord) { this.hr.deleteRecord(kind, r.id).subscribe({ next: () => this.load(), error: e => this.flash(errMsg(e, this.i18n), true) }); }
  private flash(m: string, bad = false) { this.flashMsg = m; this.flashBad = bad; setTimeout(() => this.flashMsg = '', 3500); }
}
