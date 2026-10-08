import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpService } from '../core/erp.service';
import { ErpKind, ErpModule, ErpRec } from '../core/erp.models';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe, StatusComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { ChatterComponent } from '../shared/chatter.component';
import { SavedViewsComponent } from '../shared/saved-views.component';
import { ReportColumn, ReportDesignerComponent } from '../shared/report-designer.component';
import { CollabService } from '../core/collab.service';

export interface LineCol { key: string; label: string; type?: 'text' | 'number' | 'select'; options?: () => { value: string; label: string }[]; def?: any; width?: string; }
export interface ErpField {
  key: string;
  label: string;                                   // i18n key
  type?: 'text' | 'number' | 'date' | 'select' | 'bool' | 'textarea' | 'status' | 'lines' | 'money';
  store?: 'code' | 'status' | 'ref' | 'data';      // where the value lives (default: data, or code/status/ref for those keys)
  required?: boolean;
  table?: boolean;                                 // show as a column
  options?: () => { value: string; label: string }[];
  def?: any;
  lockOnEdit?: boolean;
  hint?: string;
  rtl?: boolean;
  cols?: LineCol[];                                // type 'lines'
  onChange?: (form: Record<string, any>) => void; // e.g. fill defaults when a product is picked
  show?: (form: Record<string, any>) => boolean;
  calc?: (r: ErpRec) => any;                       // table-only computed column
}
export interface ErpAction { label: string; show: (r: ErpRec) => boolean; run: (r: ErpRec) => void; danger?: boolean; }

/**
 * Reusable list + add/edit dialog for the Manufacturing / Projects / CRM records. Which fields exist and which are columns is configured
 * by the host page; a field of type 'lines' is an editable table (BOM components, budget lines, quote lines ...).
 * Privileges: the host passes canManage; the server re-checks every call.
 */
@Component({
  selector: 'app-erp-crud',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, NumPipe, LocalDatePipe, StatusComponent, ChatterComponent, SavedViewsComponent, ReportDesignerComponent],
  template: `
    <div class="bar">
      <input class="search" [placeholder]="'common.search' | translate" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <select class="stsel" *ngIf="statusFilter.length" [ngModel]="st()" (ngModelChange)="st.set($event)">
        <option value="">{{ 'erp.allStatus' | translate }}</option>
        <option *ngFor="let s of statusFilter" [value]="s">{{ stLabel(s) }}</option>
      </select>
      <app-saved-views [view]="module + ':' + kind" [state]="filterState" (apply)="applyFilter($event)"></app-saved-views>
      <span class="grow"></span>
      <ng-content select="[bar]"></ng-content>
      <button class="ghost" type="button" (click)="reportOpen = true" [title]="'collab.reportDesigner' | translate"><app-icon name="printer" [size]="15"></app-icon></button>
      <button class="primary" *ngIf="canManage" (click)="openForm(null)"><app-icon name="plus" [size]="15"></app-icon>{{ newLabel | translate }}</button>
    </div>
    <p class="flash good" *ngIf="msg">{{ msg }}</p>
    <p class="flash bad" *ngIf="error && !form">{{ error }}</p>

    <div class="card"><div class="table-wrap">
      <table class="data">
        <thead><tr><th *ngFor="let f of cols()" [class.num]="f.type === 'number' || f.type === 'money'">{{ f.label | translate }}</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let r of shown()">
            <td *ngFor="let f of cols()" [class.num]="f.type === 'number' || f.type === 'money'">
              <ng-container [ngSwitch]="f.type">
                <app-status *ngSwitchCase="'status'" [status]="pill(r.status)" [label]="stLabel(r.status)"></app-status>
                <span *ngSwitchCase="'bool'">{{ val(r, f) ? '✓' : '' }}</span>
                <span *ngSwitchCase="'number'">{{ val(r, f) | num: 2 }}</span>
                <span *ngSwitchCase="'money'">{{ val(r, f) | num: 2 }}</span>
                <span *ngSwitchCase="'date'">{{ val(r, f) | ldate }}</span>
                <span *ngSwitchCase="'select'">{{ optLabel(f, val(r, f)) }}</span>
                <span *ngSwitchCase="'lines'">{{ (val(r, f) || []).length }}</span>
                <span *ngSwitchDefault [class.mono]="f.key === 'code'">{{ val(r, f) }}</span>
              </ng-container>
            </td>
            <td class="act">
              <ng-container *ngFor="let a of actions"><button class="ghost sm" *ngIf="a.show(r)" [class.danger-i]="a.danger" (click)="a.run(r)">{{ a.label | translate }}</button></ng-container>
              <button class="ghost sm" *ngIf="canManage && editable(r)" (click)="openForm(r)" [title]="'admin.edit' | translate"><app-icon name="edit" [size]="15"></app-icon></button>
              <button class="ghost sm" *ngIf="!(canManage && editable(r))" (click)="openForm(r, true)" [title]="'common.view' | translate"><app-icon name="search" [size]="15"></app-icon></button>
              <button class="ghost sm danger-i" *ngIf="canManage && editable(r)" (click)="deleting = r; error = ''" [title]="'admin.delete' | translate"><app-icon name="trash" [size]="15"></app-icon></button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="empty" *ngIf="!shown().length">{{ emptyKey | translate }}</div>
    </div></div>

    <div class="modal-scrim" *ngIf="form" (click)="form = null">
      <div class="modal" [class.wide]="hasLines" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (readOnly ? 'common.view' : editing ? 'admin.edit' : newLabel) | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <ng-container *ngFor="let f of fields">
          <div *ngIf="!f.show || f.show(form)" [class.full]="f.type === 'textarea' || f.type === 'lines'">
            <label class="lbl" *ngIf="f.type !== 'bool'">{{ f.label | translate }}<span *ngIf="f.required"> *</span></label>
            <ng-container [ngSwitch]="f.type">
              <select *ngSwitchCase="'select'" [(ngModel)]="form[f.key]" (ngModelChange)="f.onChange?.(form)" [disabled]="readOnly || !!(f.lockOnEdit && editing)"><option value="">—</option><option *ngFor="let o of f.options!()" [value]="o.value">{{ o.label }}</option></select>
              <input *ngSwitchCase="'number'" type="number" step="any" [(ngModel)]="form[f.key]" (ngModelChange)="f.onChange?.(form)" [disabled]="readOnly" />
              <input *ngSwitchCase="'money'" type="number" step="0.01" [(ngModel)]="form[f.key]" (ngModelChange)="f.onChange?.(form)" [disabled]="readOnly" />
              <input *ngSwitchCase="'date'" type="date" [(ngModel)]="form[f.key]" [disabled]="readOnly" />
              <textarea *ngSwitchCase="'textarea'" rows="2" [(ngModel)]="form[f.key]" [disabled]="readOnly"></textarea>
              <label class="chk" *ngSwitchCase="'bool'"><input type="checkbox" [(ngModel)]="form[f.key]" [disabled]="readOnly" /> {{ f.label | translate }}</label>
              <select *ngSwitchCase="'status'" [(ngModel)]="form[f.key]" [disabled]="readOnly"><option *ngFor="let o of f.options!()" [value]="o.value">{{ o.label }}</option></select>
              <div *ngSwitchCase="'lines'" class="lines">
                <table class="data"><thead><tr><th *ngFor="let c of f.cols">{{ c.label | translate }}</th><th></th></tr></thead>
                  <tbody><tr *ngFor="let l of form[f.key]; let i = index">
                    <td *ngFor="let c of f.cols" [style.width]="c.width">
                      <select *ngIf="c.type === 'select'" [(ngModel)]="l[c.key]" (ngModelChange)="f.onChange?.(form)" [disabled]="readOnly"><option value="">—</option><option *ngFor="let o of c.options!()" [value]="o.value">{{ o.label }}</option></select>
                      <input *ngIf="c.type === 'number'" type="number" step="any" [(ngModel)]="l[c.key]" (ngModelChange)="f.onChange?.(form)" [disabled]="readOnly" />
                      <input *ngIf="!c.type || c.type === 'text'" [(ngModel)]="l[c.key]" [disabled]="readOnly" />
                    </td>
                    <td><button class="ghost sm danger-i" type="button" *ngIf="!readOnly" (click)="form[f.key].splice(i, 1); f.onChange?.(form)"><app-icon name="x" [size]="14"></app-icon></button></td></tr></tbody></table>
                <button class="sm" type="button" *ngIf="!readOnly" (click)="addLine(f)"><app-icon name="plus" [size]="13"></app-icon>{{ 'erp.addLine' | translate }}</button>
              </div>
              <input *ngSwitchDefault [(ngModel)]="form[f.key]" (ngModelChange)="f.onChange?.(form)" [disabled]="readOnly || !!(f.lockOnEdit && editing)" [attr.dir]="f.rtl ? 'rtl' : null" />
            </ng-container>
            <small class="dim" *ngIf="f.hint">{{ f.hint | translate }}</small>
          </div></ng-container>
        </div>
        <app-chatter *ngIf="editing" [module]="module" [kind]="kind" [recordId]="editing.id"></app-chatter>
        <p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="form = null">{{ 'common.cancel' | translate }}</button><button class="primary" *ngIf="!readOnly" (click)="save()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <app-report-designer *ngIf="reportOpen" [view]="module + ':' + kind" [title]="reportTitle()" [columns]="reportCols()" [rows]="reportRows()" [user]="auth.currentUser()?.displayName || ''" (close)="reportOpen = false"></app-report-designer>

    <div class="modal-scrim" *ngIf="deleting" (click)="deleting = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'admin.delete' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'fin.deleteConfirm' | translate: { name: deleting.code || '' } }}</p><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="deleting = null">{{ 'common.cancel' | translate }}</button><button class="primary danger-fill" (click)="doDelete()">{{ 'admin.delete' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; } .search { max-width: 280px; } .stsel { max-width: 180px; } .grow { flex: 1; }
    .act { white-space: nowrap; text-align: end; } .danger-i { color: var(--bad); }
    .danger-fill { background: var(--bad); border-color: var(--bad); color: #fff; }
    .chk { display: flex; gap: 8px; align-items: center; padding-top: 22px; } .chk input { width: auto; }
    .full { grid-column: 1 / -1; } small.dim { display: block; margin-top: 3px; }
    .modal.wide { width: min(860px, 96vw); } .lines { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px; display: grid; gap: 8px; } .lines td { padding: 4px; } .lines input, .lines select { min-width: 70px; }
  `]
})
export class ErpCrudComponent implements OnInit, OnChanges {
  @Input({ required: true }) module!: ErpModule;
  @Input({ required: true }) kind!: ErpKind;
  @Input({ required: true }) fields!: ErpField[];
  @Input() canManage = false;
  @Input() newLabel = 'erp.new';
  @Input() emptyKey = 'common.noData';
  @Input() company: string | null = null;
  @Input() scopeBranch = false;
  @Input() status = '';
  @Input() refFilter = '';
  @Input() statusFilter: string[] = [];             // adds a status drop-down
  @Input() extraData: () => Record<string, any> = () => ({});
  @Input() actions: ErpAction[] = [];
  @Input() autoNew = false;
  @Input() filter: (r: ErpRec) => boolean = () => true;
  @Input() editable: (r: ErpRec) => boolean = () => true;
  @Input() statusPrefix = 'erp.st.';
  @Input() pillMap: Record<string, 'approved' | 'rejected' | 'pending' | 'canceled'> = {};
  @Output() changed = new EventEmitter<ErpRec[]>();
  @Output() saved = new EventEmitter<ErpRec>();

  private erp = inject(ErpService);
  private collab = inject(CollabService);
  private ctx = inject(ErpContextService);
  private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  auth = inject(AuthService);

  all = signal<ErpRec[]>([]);
  q = signal(''); st = signal('');
  form: Record<string, any> | null = null;
  editing: ErpRec | null = null;
  deleting: ErpRec | null = null;
  readOnly = false;
  saving = false; error = ''; msg = ''; reportOpen = false;

  filterState = () => ({ q: this.q(), status: this.st() });
  applyFilter(f: { q: string; status: string }) { this.q.set(f.q ?? ''); this.st.set(f.status ?? ''); }
  reportTitle = () => this.i18n.t('module.' + this.module) + ' · ' + this.kind;
  reportCols = (): ReportColumn[] => this.cols().map(f => ({ key: f.key, label: this.i18n.t(f.label), numeric: f.type === 'number' || f.type === 'money' }));
  /** the rows as currently filtered, formatted like the table; numbers keep their raw value under "<key>#" for totals */
  reportRows = () => this.shown().map(r => {
    const o: Record<string, any> = {};
    for (const f of this.cols()) {
      const v = this.val(r, f);
      o[f.key] = f.type === 'status' ? this.stLabel(r.status) : f.type === 'select' ? this.optLabel(f, v) : f.type === 'bool' ? (v ? '✓' : '') : f.type === 'lines' ? (v || []).length
        : f.type === 'number' || f.type === 'money' ? new Intl.NumberFormat(this.i18n.locale, { maximumFractionDigits: 2 }).format(Number(v) || 0) : f.type === 'date' && v ? String(v).slice(0, 10) : v ?? '';
      if (f.type === 'number' || f.type === 'money') o[f.key + '#'] = Number(v) || 0;
    }
    return o;
  });
  /** activity log entry: which fields an edit changed */
  private logChange(prev: ErpRec, body: Partial<ErpRec>) {
    const diffs: string[] = [];
    for (const x of this.fields) {
      if (x.calc || x.type === 'lines') continue;
      const w = this.where(x);
      const before = w === 'code' ? prev.code : w === 'status' ? prev.status : w === 'ref' ? prev.ref : prev.data?.[x.key];
      const after = w === 'code' ? body.code : w === 'status' ? body.status : w === 'ref' ? body.ref : (body.data as any)?.[x.key];
      if (String(before ?? '') !== String(after ?? '')) diffs.push(`${this.i18n.t(x.label)}: ${String(before ?? '—')} → ${String(after ?? '—')}`);
    }
    if (diffs.length) this.collab.addNote(this.module, this.kind, prev.id, diffs.join('\n'), true).subscribe({ error: () => {} });
  }

  get hasLines() { return this.fields.some(f => f.type === 'lines'); }
  cols = () => this.fields.filter(f => f.table);
  shown = () => {
    const q = this.q().toLowerCase().trim(), st = this.st();
    return this.all().filter(this.filter).filter(r => !st || r.status === st)
      .filter(r => !q || this.fields.some(f => f.type !== 'lines' && String(this.val(r, f) ?? '').toLowerCase().includes(q)));
  };

  ngOnInit() { this.load(true); }
  ngOnChanges(c: SimpleChanges) {
    const changed = ['company', 'status', 'refFilter'].some(k => c[k] && !c[k].firstChange);
    if (changed) this.load(false);
  }

  load(first = false) {
    this.erp.records(this.module, this.kind, { company: this.company, branch: this.scopeBranch ? this.ctx.branch() : null, status: this.status, ref: this.refFilter, take: 3000 }).subscribe({
      next: l => {
        this.all.set(l); this.changed.emit(l);
        if (first && this.autoNew && this.route.snapshot.queryParamMap.get('new') && this.canManage) { this.openForm(null); this.router.navigate([], { queryParams: {}, replaceUrl: true }); }
      },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  where(f: ErpField) { return f.store ?? (f.key === 'code' ? 'code' : f.key === 'status' ? 'status' : f.key === 'ref' ? 'ref' : 'data'); }
  val(r: ErpRec, f: ErpField): any {
    if (f.calc) return f.calc(r);
    const w = this.where(f);
    return w === 'code' ? r.code : w === 'status' ? r.status : w === 'ref' ? r.ref : r.data?.[f.key];
  }
  optLabel(f: ErpField, v: any) { return f.options?.().find(o => o.value === v)?.label ?? v ?? ''; }
  stLabel(s: string | null | undefined) { const k = this.statusPrefix + s; const t = this.i18n.t(k); if (t !== k) return t; const g = this.i18n.t('erp.st.' + s); return g === 'erp.st.' + s ? (s ?? '') : g; }
  pill(s: string | null | undefined): 'approved' | 'rejected' | 'pending' | 'canceled' {
    if (s && this.pillMap[s]) return this.pillMap[s];
    return ['Active', 'Done', 'Completed', 'Passed', 'Approved', 'Won', 'Achieved', 'Accepted', 'Converted', 'Billed'].includes(s ?? '') ? 'approved'
      : ['Failed', 'Rejected', 'Lost', 'Cancelled'].includes(s ?? '') ? 'rejected' : ['Inactive', 'Closed'].includes(s ?? '') ? 'canceled' : 'pending';
  }

  addLine(f: ErpField) {
    const l: Record<string, any> = {};
    for (const c of f.cols ?? []) l[c.key] = c.def ?? (c.type === 'number' ? 0 : '');
    (this.form![f.key] as any[]).push(l);
    f.onChange?.(this.form!);
  }

  openForm(r: ErpRec | null, readOnly = false) {
    this.editing = r; this.error = ''; this.readOnly = readOnly;
    const f: Record<string, any> = {};
    for (const x of this.fields) {
      if (x.calc) continue;
      const base = x.type === 'bool' ? false : x.type === 'lines' ? [] : '';
      let v = r ? this.val(r, x) ?? base : (typeof x.def === 'function' ? x.def() : x.def ?? base);
      if (x.type === 'lines') v = JSON.parse(JSON.stringify(v));
      f[x.key] = v;
    }
    this.form = f;
  }

  save() {
    const f = this.form!;
    for (const x of this.fields) {
      if (x.show && !x.show(f)) continue;
      if (x.required && (f[x.key] === '' || f[x.key] === null || f[x.key] === undefined)) { this.error = this.i18n.t('hr.err.required'); return; }
    }
    const body: Partial<ErpRec> = { data: {} };
    for (const x of this.fields) {
      let v = f[x.key];
      if (x.type === 'number' || x.type === 'money') v = v === '' || v === null ? 0 : Number(v);
      if (x.type === 'lines') v = (v as any[]).map(l => { const o: Record<string, any> = { ...l }; for (const c of x.cols ?? []) if (c.type === 'number') o[c.key] = Number(o[c.key]) || 0; return o; }).filter(l => (x.cols ?? []).some(c => l[c.key] !== '' && l[c.key] !== 0));
      if (x.calc) continue;
      const w = this.where(x);
      if (w === 'code') body.code = String(v ?? '').trim() || undefined;
      else if (w === 'status') body.status = v || undefined;
      else if (w === 'ref') body.ref = v || undefined;
      else (body.data as any)[x.key] = v;
    }
    if (!this.editing) {
      if (this.company) body.company = this.company;
      if (this.scopeBranch && this.ctx.branch() !== 'ALL') body.branch = this.ctx.branch();
      Object.assign(body.data as any, this.extraData());
    }
    this.saving = true; this.error = '';
    const req = this.editing ? this.erp.update(this.module, this.kind, this.editing.id, { ...body, data: { ...(this.editing.data ?? {}), ...(body.data as any) } }) : this.erp.create(this.module, this.kind, body);
    req.subscribe({
      next: r => { this.saving = false; if (this.editing) this.logChange(this.editing, body); else this.collab.addNote(this.module, this.kind, r.id, this.i18n.t('collab.created'), true).subscribe({ error: () => {} }); this.form = null; this.flash(this.i18n.t('hr.saved')); this.load(); this.erp.refresh(this.module, this.kind, this.company).subscribe(); this.saved.emit(r); },
      error: e => { this.saving = false; this.error = errMsg(e, this.i18n); }
    });
  }

  doDelete() {
    const d = this.deleting!;
    this.erp.remove(this.module, this.kind, d.id).subscribe({
      next: () => { this.deleting = null; this.flash(this.i18n.t('hr.deleted')); this.load(); this.erp.refresh(this.module, this.kind, this.company).subscribe(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  flash(t: string) { this.msg = t; setTimeout(() => this.msg = '', 2500); }
  reload() { this.load(); this.erp.refresh(this.module, this.kind, this.company).subscribe(); }
  setError(m: string) { this.error = m; }
}
