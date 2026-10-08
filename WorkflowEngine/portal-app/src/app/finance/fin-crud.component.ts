import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { FinService } from '../core/fin.service';
import { FinKind, FinRec, COMPANY_KINDS } from '../core/fin.models';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe, StatusComponent } from '../shared/ui';
import { errMsg, finPill } from './fin-util';

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
export interface CrudAction { label: string; show: (r: FinRec) => boolean; run: (r: FinRec) => void; danger?: boolean; }

/**
 * A reusable list + add/edit dialog for the simple finance lists (accounts, vendors, customers, bank accounts, cost centres,
 * projects, currencies, tax codes, budgets ...). Which fields exist and which are columns is configured by the host page.
 * Privileges: the host passes canManage; the server re-checks.
 */
@Component({
  selector: 'app-fin-crud',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, NumPipe, LocalDatePipe, StatusComponent],
  template: `
    <div class="bar">
      <input class="search" [placeholder]="'common.search' | translate" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <span class="grow"></span>
      <ng-content select="[bar]"></ng-content>
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
        </div><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="form = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="save()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

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
export class FinCrudComponent implements OnInit, OnChanges {
  @Input({ required: true }) kind!: FinKind;
  @Input({ required: true }) fields!: CrudField[];
  @Input() canManage = false;
  @Input() newLabel = 'fin.new';
  @Input() emptyKey = 'common.noData';
  @Input() company: string | null = null;          // list / create scope for company kinds
  @Input() actions: CrudAction[] = [];
  @Input() autoNew = false;                        // open the "new" dialog when the page has ?new=1
  @Input() filter: (r: FinRec) => boolean = () => true;
  @Output() changed = new EventEmitter<FinRec[]>();

  private fin = inject(FinService);
  private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  auth = inject(AuthService);

  all = signal<FinRec[]>([]);
  q = signal('');
  form: Record<string, any> | null = null;
  editing: FinRec | null = null;
  deleting: FinRec | null = null;
  saving = false; error = ''; msg = '';

  cols = () => this.fields.filter(f => f.table);
  shown = () => {
    const q = this.q().toLowerCase().trim();
    return this.all().filter(this.filter).filter(r => !q || this.fields.some(f => String(this.val(r, f) ?? '').toLowerCase().includes(q)));
  };

  ngOnInit() { this.load(true); }
  ngOnChanges(c: SimpleChanges) { if (c['company'] && !c['company'].firstChange) this.load(false); }

  load(first = false) {
    this.fin.records(this.kind, COMPANY_KINDS.includes(this.kind) ? this.company : null).subscribe({
      next: l => {
        this.all.set(l); this.changed.emit(l);
        if (first && this.autoNew && this.route.snapshot.queryParamMap.get('new') && this.canManage) { this.openForm(null); this.router.navigate([], { queryParams: {}, replaceUrl: true }); }
      },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  val(r: FinRec, f: CrudField): any {
    const where = f.store ?? (f.key === 'code' ? 'code' : f.key === 'status' ? 'status' : 'data');
    return where === 'code' ? r.code : where === 'status' ? r.status : r.data?.[f.key];
  }
  optLabel(f: CrudField, v: any) { return f.options?.().find(o => o.value === v)?.label ?? v ?? ''; }
  statusLabel(s: string | null | undefined) { const k = 'fin.st.' + s; const t = this.i18n.t(k); return t === k ? (s ?? '') : t; }
  pillClass(s: string | null | undefined) { return finPill(s); }

  openForm(r: FinRec | null) {
    this.editing = r; this.error = '';
    const f: Record<string, any> = {};
    for (const x of this.fields) f[x.key] = r ? this.val(r, x) ?? (x.type === 'bool' ? false : '') : (x.def ?? (x.type === 'bool' ? false : ''));
    this.form = f;
  }

  save() {
    const f = this.form!;
    for (const x of this.fields) if (x.required && (f[x.key] === '' || f[x.key] === null || f[x.key] === undefined)) { this.error = this.i18n.t('hr.err.required'); return; }
    const body: Partial<FinRec> = { data: {} };
    for (const x of this.fields) {
      const where = x.store ?? (x.key === 'code' ? 'code' : x.key === 'status' ? 'status' : 'data');
      let v = f[x.key];
      if (x.type === 'number') v = v === '' || v === null ? 0 : Number(v);
      if (where === 'code') body.code = String(v ?? '').trim();
      else if (where === 'status') body.status = v || undefined;
      else (body.data as any)[x.key] = v;
    }
    if (COMPANY_KINDS.includes(this.kind) && !this.editing && this.company) body.company = this.company;
    this.saving = true; this.error = '';
    const req = this.editing ? this.fin.update(this.kind, this.editing.id, { ...body, data: { ...(this.editing.data ?? {}), ...(body.data as any) } }) : this.fin.create(this.kind, body);
    req.subscribe({
      next: () => { this.saving = false; this.form = null; this.flash(this.i18n.t('hr.saved')); this.load(); this.fin.loadRefs([this.kind], this.company ?? undefined).subscribe(); },
      error: e => { this.saving = false; this.error = errMsg(e, this.i18n); }
    });
  }

  doDelete() {
    const d = this.deleting!;
    this.fin.remove(this.kind, d.id).subscribe({
      next: () => { this.deleting = null; this.flash(this.i18n.t('hr.deleted')); this.load(); this.fin.loadRefs([this.kind], this.company ?? undefined).subscribe(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }

  flash(t: string) { this.msg = t; setTimeout(() => this.msg = '', 2500); }
  reload() { this.load(); }
}
