import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { PosService } from '../core/pos.service';
import { PosKind, PosRec } from '../core/pos.models';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe, StatusComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { ChatterComponent } from '../shared/chatter.component';
import { SavedViewsComponent } from '../shared/saved-views.component';
import { ReportColumn, ReportDesignerComponent } from '../shared/report-designer.component';
import { CollabService } from '../core/collab.service';

export interface CrudField {
  key: string;
  label: string;                       // i18n key
  type?: 'text' | 'number' | 'date' | 'select' | 'bool' | 'textarea' | 'status';
  store?: 'code' | 'status' | 'data';  // where the value lives (default: data, or code/status for those keys)
  required?: boolean;
  table?: boolean;                     // show as a column
  options?: () => { value: string; label: string }[];
  def?: any;
  lockOnEdit?: boolean;                // can't be changed once created (codes)
  hint?: string;                       // i18n key
  rtl?: boolean;
}
export interface CrudAction { label: string; show: (r: PosRec) => boolean; run: (r: PosRec) => void; danger?: boolean; }

/**
 * A reusable list + add/edit dialog for the simple finance lists (accounts, vendors, customers, bank accounts, cost centres,
 * projects, currencies, tax codes, budgets ...). Which fields exist and which are columns is configured by the host page.
 * Privileges: the host passes canManage; the server re-checks.
 */
@Component({
  selector: 'app-pos-crud',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, NumPipe, LocalDatePipe, StatusComponent, ChatterComponent, SavedViewsComponent, ReportDesignerComponent],
  template: `
    <div class="bar">
      <input class="search" [placeholder]="'common.search' | translate" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <app-saved-views [view]="'pos:' + kind" [state]="filterState" (apply)="applyFilter($event)"></app-saved-views>
      <span class="grow"></span>
      <ng-content select="[bar]"></ng-content>
      <button class="ghost" type="button" (click)="reportOpen = true" [title]="'collab.reportDesigner' | translate"><app-icon name="printer" [size]="15"></app-icon></button>
      <button class="primary" *ngIf="canManage" (click)="openForm(null)"><app-icon name="plus" [size]="15"></app-icon>{{ newLabel | translate }}</button>
    </div>
    <p class="flash good" *ngIf="msg">{{ msg }}</p>
    <p class="flash bad" *ngIf="error && !form">{{ error }}</p>

    <div class="card"><div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th *ngFor="let f of cols()" [class.num]="f.type === 'number'">{{ f.label | translate }}</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let r of shown()">
            <td *ngFor="let f of cols()" [class.num]="f.type === 'number'">
              <ng-container [ngSwitch]="f.type">
                <app-status *ngSwitchCase="'status'" [status]="pillClass(r.status)" [label]="statusLabel(r.status)"></app-status>
                <span *ngSwitchCase="'bool'">{{ val(r, f) ? '✓' : '' }}</span>
                <span *ngSwitchCase="'number'">{{ val(r, f) | num: 2 }}</span>
                <span *ngSwitchCase="'date'">{{ val(r, f) | ldate }}</span>
                <span *ngSwitchCase="'select'">{{ optLabel(f, val(r, f)) }}</span>
                <span *ngSwitchDefault [class.mono]="f.key === 'code'">{{ val(r, f) }}</span>
              </ng-container>
            </td>
            <td class="act">
              <button class="ghost sm" *ngFor="let a of actions" [hidden]="!a.show(r)" [class.danger-i]="a.danger" (click)="a.run(r)">{{ a.label | translate }}</button>
              <button class="ghost sm" *ngIf="canManage" (click)="openForm(r)" [title]="'admin.edit' | translate"><app-icon name="edit" [size]="15"></app-icon></button>
              <button class="ghost sm danger-i" *ngIf="canManage" (click)="deleting = r; error = ''" [title]="'admin.delete' | translate"><app-icon name="trash" [size]="15"></app-icon></button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="empty" *ngIf="!shown().length">{{ emptyKey | translate }}</div>
    </div></div>

    <div class="modal-scrim" *ngIf="form" (click)="form = null">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (editing ? 'admin.edit' : newLabel) | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div *ngFor="let f of fields" [class.full]="f.type === 'textarea'">
            <label class="lbl" *ngIf="f.type !== 'bool'">{{ f.label | translate }}<span *ngIf="f.required"> *</span></label>
            <ng-container [ngSwitch]="f.type">
              <select *ngSwitchCase="'select'" [(ngModel)]="form[f.key]"><option value="">—</option><option *ngFor="let o of f.options!()" [value]="o.value">{{ o.label }}</option></select>
              <input *ngSwitchCase="'number'" type="number" step="0.01" [(ngModel)]="form[f.key]" />
              <input *ngSwitchCase="'date'" type="date" [(ngModel)]="form[f.key]" />
              <textarea *ngSwitchCase="'textarea'" rows="2" [(ngModel)]="form[f.key]"></textarea>
              <label class="chk" *ngSwitchCase="'bool'"><input type="checkbox" [(ngModel)]="form[f.key]" /> {{ f.label | translate }}</label>
              <select *ngSwitchCase="'status'" [(ngModel)]="form[f.key]"><option *ngFor="let o of f.options!()" [value]="o.value">{{ o.label }}</option></select>
              <input *ngSwitchDefault [(ngModel)]="form[f.key]" [disabled]="!!(f.lockOnEdit && editing)" [attr.dir]="f.rtl ? 'rtl' : null" />
            </ng-container>
            <small class="dim" *ngIf="f.hint">{{ f.hint | translate }}</small>
          </div>
        </div>
        <app-chatter *ngIf="editing" module="pos" [kind]="kind" [recordId]="editing.id"></app-chatter>
        <p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="form = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="save()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <app-report-designer *ngIf="reportOpen" [view]="'pos:' + kind" [title]="reportTitle()" [columns]="reportCols()" [rows]="reportRows()" [user]="auth.currentUser()?.displayName || ''" (close)="reportOpen = false"></app-report-designer>

    <div class="modal-scrim" *ngIf="deleting" (click)="deleting = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'admin.delete' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'fin.deleteConfirm' | translate: { name: deleting.code || '' } }}</p><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="deleting = null">{{ 'common.cancel' | translate }}</button><button class="primary danger-fill" (click)="doDelete()">{{ 'admin.delete' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; } .search { max-width: 280px; } .grow { flex: 1; }
    .act { white-space: nowrap; text-align: end; } .danger-i { color: var(--bad); }
    .danger-fill { background: var(--bad); border-color: var(--bad); color: #fff; }
    .chk { display: flex; gap: 8px; align-items: center; padding-top: 22px; } .chk input { width: auto; }
    .full { grid-column: 1 / -1; } small.dim { display: block; margin-top: 3px; }
  `]
})
export class PosCrudComponent implements OnInit, OnChanges {
  @Input({ required: true }) kind!: PosKind;
  @Input({ required: true }) fields!: CrudField[];
  @Input() canManage = false;
  @Input() newLabel = 'pos.new';
  @Input() emptyKey = 'common.noData';
  @Input() company: string | null = null;          // list / create scope
  @Input() scopeBranch = false;                     // limit the list to the branch picked in the header, and stamp it on new rows
  @Input() status = '';
  @Input() extraData: () => Record<string, any> = () => ({});
  @Input() actions: CrudAction[] = [];
  @Input() autoNew = false;                        // open the "new" dialog when the page has ?new=1
  @Input() filter: (r: PosRec) => boolean = () => true;
  @Output() changed = new EventEmitter<PosRec[]>();

  private pos = inject(PosService);
  private ctx = inject(ErpContextService);
  private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  auth = inject(AuthService);
  private collab = inject(CollabService);

  all = signal<PosRec[]>([]);
  q = signal('');
  form: Record<string, any> | null = null;
  editing: PosRec | null = null;
  deleting: PosRec | null = null;
  saving = false; error = ''; msg = ''; reportOpen = false;

  filterState = () => ({ q: this.q(), status: '' });
  applyFilter(f: { q: string; status: string }) { this.q.set(f.q ?? ''); }
  reportTitle = () => this.i18n.t('pos.title') !== 'pos.title' ? this.i18n.t('pos.title') : this.kind;
  reportCols = (): ReportColumn[] => this.cols().map(f => ({ key: f.key, label: this.i18n.t(f.label), numeric: f.type === 'number' }));
  reportRows = () => this.shown().map(r => {
    const o: Record<string, any> = {};
    for (const f of this.cols()) {
      const v = this.val(r, f);
      o[f.key] = f.type === 'status' ? this.statusLabel(r.status) : f.type === 'select' ? this.optLabel(f, v) : f.type === 'bool' ? (v ? '✓' : '')
        : f.type === 'number' ? new Intl.NumberFormat(this.i18n.locale, { maximumFractionDigits: 2 }).format(Number(v) || 0) : f.type === 'date' && v ? String(v).slice(0, 10) : v ?? '';
      if (f.type === 'number') o[f.key + '#'] = Number(v) || 0;
    }
    return o;
  });
  private logChange(prev: PosRec, body: Partial<PosRec>) {
    const diffs: string[] = [];
    for (const x of this.fields) {
      const w = x.store ?? (x.key === 'code' ? 'code' : x.key === 'status' ? 'status' : 'data');
      const before = w === 'code' ? prev.code : w === 'status' ? prev.status : prev.data?.[x.key];
      const after = w === 'code' ? body.code : w === 'status' ? body.status : (body.data as any)?.[x.key];
      if (String(before ?? '') !== String(after ?? '')) diffs.push(`${this.i18n.t(x.label)}: ${String(before ?? '—')} → ${String(after ?? '—')}`);
    }
    if (diffs.length) this.collab.addNote('pos', this.kind, prev.id, diffs.join('\n'), true).subscribe({ error: () => {} });
  }

  cols = () => this.fields.filter(f => f.table);
  shown = () => {
    const q = this.q().toLowerCase().trim();
    return this.all().filter(this.filter).filter(r => !q || this.fields.some(f => String(this.val(r, f) ?? '').toLowerCase().includes(q)));
  };

  ngOnInit() { this.load(true); }
  ngOnChanges(c: SimpleChanges) { if ((c['company'] || c['status']) && !(c['company']?.firstChange ?? true)) this.load(false); }

  load(first = false) {
    this.pos.records(this.kind, { company: this.company, branch: this.scopeBranch ? this.ctx.branch() : null, status: this.status }).subscribe({
      next: l => {
        this.all.set(l); this.changed.emit(l);
        if (first && this.autoNew && this.route.snapshot.queryParamMap.get('new') && this.canManage) { this.openForm(null); this.router.navigate([], { queryParams: {}, replaceUrl: true }); }
      },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  val(r: PosRec, f: CrudField): any {
    const where = f.store ?? (f.key === 'code' ? 'code' : f.key === 'status' ? 'status' : 'data');
    return where === 'code' ? r.code : where === 'status' ? r.status : r.data?.[f.key];
  }
  optLabel(f: CrudField, v: any) { return f.options?.().find(o => o.value === v)?.label ?? v ?? ''; }
  statusLabel(s: string | null | undefined) { const k = 'pos.st.' + s; const t = this.i18n.t(k); return t === k ? (s ?? '') : t; }
  pillClass(s: string | null | undefined): 'approved' | 'rejected' | 'pending' | 'canceled' { return s === 'Active' ? 'approved' : s === 'Inactive' ? 'canceled' : 'pending'; }

  openForm(r: PosRec | null) {
    this.editing = r; this.error = '';
    const f: Record<string, any> = {};
    for (const x of this.fields) f[x.key] = r ? this.val(r, x) ?? (x.type === 'bool' ? false : '') : (x.def ?? (x.type === 'bool' ? false : ''));
    this.form = f;
  }

  save() {
    const f = this.form!;
    for (const x of this.fields) if (x.required && (f[x.key] === '' || f[x.key] === null || f[x.key] === undefined)) { this.error = this.i18n.t('hr.err.required'); return; }
    const body: Partial<PosRec> = { data: {} };
    for (const x of this.fields) {
      const where = x.store ?? (x.key === 'code' ? 'code' : x.key === 'status' ? 'status' : 'data');
      let v = f[x.key];
      if (x.type === 'number') v = v === '' || v === null ? 0 : Number(v);
      if (where === 'code') body.code = String(v ?? '').trim();
      else if (where === 'status') body.status = v || undefined;
      else (body.data as any)[x.key] = v;
    }
    if (!this.editing) {
      if (this.company) body.company = this.company;
      if (this.scopeBranch && this.ctx.branch() !== 'ALL') body.branch = this.ctx.branch();
      Object.assign(body.data as any, this.extraData());
    }
    this.saving = true; this.error = '';
    const req = this.editing ? this.pos.update(this.kind, this.editing.id, { ...body, data: { ...(this.editing.data ?? {}), ...(body.data as any) } }) : this.pos.create(this.kind, body);
    req.subscribe({
      next: r => { this.saving = false; if (this.editing) this.logChange(this.editing, body); else this.collab.addNote('pos', this.kind, (r as any).id, this.i18n.t('collab.created'), true).subscribe({ error: () => {} }); this.form = null; this.flash(this.i18n.t('hr.saved')); this.load(); this.pos.loadCatalog(this.company ?? '', this.ctx.branch()).subscribe(); },
      error: e => { this.saving = false; this.error = errMsg(e, this.i18n); }
    });
  }

  doDelete() {
    const d = this.deleting!;
    this.pos.remove(this.kind, d.id).subscribe({
      next: () => { this.deleting = null; this.flash(this.i18n.t('hr.deleted')); this.load(); this.pos.loadCatalog(this.company ?? '', this.ctx.branch()).subscribe(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  flash(t: string) { this.msg = t; setTimeout(() => this.msg = '', 2500); }
  reload() { this.load(); }
}
