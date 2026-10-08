import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { OrgService } from '../core/org.service';
import { I18nService } from '../core/i18n.service';
import { AuthService } from '../core/auth.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { Branch, Company, CURRENCIES } from '../core/erp.config';

/** Companies and their branches - a workspace admin adds/edits/removes them here. */
@Component({
  selector: 'app-admin-org',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <p class="dim lead">{{ 'org.sub' | translate }}</p>
    <div class="flash" [class.bad]="flashBad" *ngIf="flashMsg">{{ flashMsg }}</div>

    <div class="bar">
      <h3>{{ 'org.companies' | translate }}</h3><span class="spacer"></span>
      <button class="primary" (click)="newCompany()"><app-icon name="plus" [size]="15"></app-icon>{{ 'org.addCompany' | translate }}</button>
    </div>

    <div class="co card" *ngFor="let c of org.companies()">
      <div class="card-head">
        <span class="ic"><app-icon name="building" [size]="17"></app-icon></span>
        <h3>{{ i18n.nm(c) }} <span class="mono dim">{{ c.code }}</span>
          <span class="sub">{{ c.currency }}<span *ngIf="c.taxNo"> · {{ c.taxNo }}</span> · {{ 'org.branchCount' | translate: { n: org.branchesOf(c.code).length } }}</span></h3>
        <button class="ghost sm" (click)="editCompany(c)" [title]="'common.edit' | translate"><app-icon name="edit" [size]="15"></app-icon></button>
        <button class="ghost sm danger-i" (click)="askDeleteCompany(c)" [title]="'common.delete' | translate" [disabled]="org.companies().length < 2"><app-icon name="trash" [size]="15"></app-icon></button>
      </div>
      <div class="card-body">
        <div class="branches">
          <div class="br" *ngFor="let b of org.branchesOf(c.code)">
            <app-icon name="git-branch" [size]="15"></app-icon>
            <div class="bt"><strong>{{ i18n.nm(b) }}</strong><small class="dim"><span class="mono">{{ b.code }}</span> · {{ b.warehouse }}<span *ngIf="b.city"> · {{ b.city }}</span></small></div>
            <button class="ghost sm" (click)="editBranch(b)"><app-icon name="edit" [size]="14"></app-icon></button>
            <button class="ghost sm danger-i" (click)="askDeleteBranch(b)"><app-icon name="trash" [size]="14"></app-icon></button>
          </div>
          <div class="empty small" *ngIf="!org.branchesOf(c.code).length">{{ 'org.noBranches' | translate }}</div>
        </div>
        <button class="sm" (click)="newBranch(c.code)"><app-icon name="plus" [size]="14"></app-icon>{{ 'org.addBranch' | translate }}</button>
      </div>
    </div>
    <div class="empty" *ngIf="!org.companies().length">{{ 'org.noCompanies' | translate }}</div>

    <!-- company dialog -->
    <div class="modal-scrim" *ngIf="co" (click)="co = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (coNew ? 'org.addCompany' : 'org.editCompany') | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div><label class="lbl">{{ 'org.code' | translate }}</label><input [(ngModel)]="co.code" [disabled]="!coNew" maxlength="12" (ngModelChange)="co.code = clean($event)" />
            <div class="hint">{{ 'org.codeHint' | translate }}</div></div>
          <div><label class="lbl">{{ 'org.currency' | translate }}</label>
            <select [(ngModel)]="co.currency"><option *ngFor="let c of currencies" [value]="c">{{ c }}</option></select></div>
          <div class="full"><label class="lbl">{{ 'org.name' | translate }}</label><input [(ngModel)]="co.name" /></div>
          <div class="full"><label class="lbl">{{ 'org.nameAr' | translate }}</label><input [(ngModel)]="co.nameAr" dir="rtl" /></div>
          <div class="full"><label class="lbl">{{ 'org.taxNo' | translate }}</label><input [(ngModel)]="co.taxNo" /></div>
        </div><p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="co = null">{{ 'common.cancel' | translate }}</button>
          <button class="primary" (click)="saveCompany()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <!-- branch dialog -->
    <div class="modal-scrim" *ngIf="br" (click)="br = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (brNew ? 'org.addBranch' : 'org.editBranch') | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div><label class="lbl">{{ 'org.company' | translate }}</label>
            <select [(ngModel)]="br.company"><option *ngFor="let c of org.companies()" [value]="c.code">{{ i18n.nm(c) }}</option></select></div>
          <div><label class="lbl">{{ 'org.code' | translate }}</label><input [(ngModel)]="br.code" [disabled]="!brNew" maxlength="12" (ngModelChange)="br.code = clean($event)" /></div>
          <div class="full"><label class="lbl">{{ 'org.name' | translate }}</label><input [(ngModel)]="br.name" /></div>
          <div class="full"><label class="lbl">{{ 'org.nameAr' | translate }}</label><input [(ngModel)]="br.nameAr" dir="rtl" /></div>
          <div><label class="lbl">{{ 'org.city' | translate }}</label><input [(ngModel)]="br.city" /></div>
          <div><label class="lbl">{{ 'org.warehouse' | translate }}</label><input [(ngModel)]="br.warehouse" [placeholder]="'WH-' + (br.code || '…')" /></div>
        </div><p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="br = null">{{ 'common.cancel' | translate }}</button>
          <button class="primary" (click)="saveBranch()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <!-- delete confirm -->
    <div class="modal-scrim" *ngIf="del" (click)="del = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'common.delete' | translate }}</h3></div>
        <div class="modal-body"><p>{{ (del.kind === 'company' ? 'org.deleteCompanyConfirm' : 'org.deleteBranchConfirm') | translate: { name: del.name } }}</p>
          <p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="del = null">{{ 'common.cancel' | translate }}</button>
          <button class="danger" (click)="doDelete()" [disabled]="saving">{{ 'common.delete' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .lead { margin: 0 0 14px; font-size: 13px; }
    .bar { display: flex; align-items: center; margin-bottom: 12px; }
    .bar h3 { font-size: 15px; }
    .spacer { flex: 1; }
    .co { margin-bottom: 14px; }
    .ic { width: 32px; height: 32px; border-radius: 9px; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; }
    .card-head h3 { display: flex; flex-direction: column; gap: 2px; }
    .branches { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; margin-bottom: 12px; }
    .br { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-2); }
    .bt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .bt strong { color: var(--text); font-size: 13px; }
    .bt small { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .danger-i { color: var(--bad); }
    .empty.small { padding: 10px; grid-column: 1 / -1; }
  `]
})
export class AdminOrgComponent {
  currencies = [...CURRENCIES, 'GBP', 'PKR', 'EGP', 'SAR'].filter((v, i, a) => a.indexOf(v) === i);
  co: Company | null = null; coNew = false; coOriginal = '';
  br: Branch | null = null; brNew = false; brOriginal = '';
  del: { kind: 'company' | 'branch'; code: string; name: string } | null = null;
  saving = false; formError = ''; flashMsg = ''; flashBad = false;

  constructor(public org: OrgService, public i18n: I18nService, private auth: AuthService) {}

  clean(v: string) { return (v || '').toUpperCase().replace(/[^A-Z0-9_-]/g, ''); }

  newCompany() { this.co = { code: '', name: '', nameAr: '', currency: this.org.companies()[0]?.currency ?? 'SAR', taxNo: '' }; this.coNew = true; this.formError = ''; }
  editCompany(c: Company) { this.co = { ...c }; this.coNew = false; this.coOriginal = c.code; this.formError = ''; }
  saveCompany() {
    const c = this.co!;
    if (!c.code.trim() || !c.name.trim()) { this.formError = this.i18n.t('org.required'); return; }
    this.saving = true; this.formError = '';
    this.org.saveCompany({ ...c, nameAr: c.nameAr || c.name }, this.coNew, this.coOriginal).subscribe({
      next: () => { this.saving = false; this.co = null; this.flash(this.i18n.t('org.saved')); },
      error: e => { this.saving = false; this.formError = this.msg(e); }
    });
  }

  newBranch(company: string) { this.br = { code: '', company, name: '', nameAr: '', warehouse: '', city: '' }; this.brNew = true; this.formError = ''; }
  editBranch(b: Branch) { this.br = { ...b }; this.brNew = false; this.brOriginal = b.code; this.formError = ''; }
  saveBranch() {
    const b = this.br!;
    if (!b.code.trim() || !b.name.trim()) { this.formError = this.i18n.t('org.required'); return; }
    this.saving = true; this.formError = '';
    const payload: Branch = { ...b, nameAr: b.nameAr || b.name, warehouse: b.warehouse?.trim() || 'WH-' + b.code };
    this.org.saveBranch(payload, this.brNew, this.brOriginal).subscribe({
      next: () => { this.saving = false; this.br = null; this.flash(this.i18n.t('org.saved')); },
      error: e => { this.saving = false; this.formError = this.msg(e); }
    });
  }

  askDeleteCompany(c: Company) { this.del = { kind: 'company', code: c.code, name: this.i18n.nm(c) }; this.formError = ''; }
  askDeleteBranch(b: Branch) { this.del = { kind: 'branch', code: b.code, name: this.i18n.nm(b) }; this.formError = ''; }
  doDelete() {
    const d = this.del!;
    this.saving = true;
    (d.kind === 'company' ? this.org.removeCompany(d.code) : this.org.removeBranch(d.code)).subscribe({
      next: () => { this.saving = false; this.del = null; this.flash(this.i18n.t('org.deleted')); },
      error: e => { this.saving = false; this.formError = this.msg(e); }
    });
  }

  private flash(m: string, bad = false) { this.flashMsg = m; this.flashBad = bad; setTimeout(() => this.flashMsg = '', 3500); }
  private msg(e: HttpErrorResponse): string {
    if (e.status === 403) return this.i18n.t('common.forbidden');
    if (e.status === 402) return this.i18n.t('ws.limitReached');
    return typeof e.error === 'string' && e.error ? e.error : this.i18n.t('common.error');
  }
}
