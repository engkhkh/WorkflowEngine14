import { Component, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../core/auth.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { ACCOUNT_TYPES, FinRec } from '../core/fin.models';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { CrudField, FinCrudComponent } from './fin-crud.component';
import { errMsg } from './fin-util';

/** Chart of accounts. Needs finance.gl.view to read, finance.gl.manage to change. */
@Component({
  selector: 'app-fin-accounts',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent, FinCrudComponent],
  template: `
    <p class="dim lead">{{ 'fin.acc.hint' | translate }}</p>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <app-fin-crud #crud kind="account" [fields]="fields" [canManage]="auth.can('finance.gl.manage')" newLabel="fin.acc.new" emptyKey="fin.acc.none" [autoNew]="true" [parentOf]="parentOf">
      <button bar *ngIf="auth.can('finance.gl.manage') && empty" (click)="seed()"><app-icon name="layers" [size]="15"></app-icon>{{ 'fin.acc.seed' | translate }}</button>
    </app-fin-crud>
  `,
  styles: [`.lead { margin: 0 0 12px; font-size: 13px; }`]
})
export class FinAccountsComponent {
  auth = inject(AuthService); private fin = inject(FinService); private i18n = inject(I18nService);
  @ViewChild('crud') crud!: FinCrudComponent;
  error = '';
  get empty() { return !this.fin.ref('account').length; }
  types = () => ACCOUNT_TYPES.map(t => ({ value: t, label: this.i18n.t('fin.type.' + t) }));
  /** Parent account: the explicit "parent" code if set, otherwise the closest header account whose code is a prefix (1000 -> 1010, 1100). */
  parentOf = (r: FinRec, all: FinRec[]): string | null => {
    const explicit = String(r.data?.['parent'] ?? '').trim();
    if (explicit) { const p = all.find(a => a.code === explicit && a.id !== r.id); if (p) return p.id; }
    const c = r.code ?? ''; let best: FinRec | null = null; let bl = 0;
    for (const a of all) {
      if (a.id === r.id || !a.code || !a.data?.['isHeader']) continue;
      const s = a.code.replace(/0+$/, '');
      if (s && c.length > s.length && c.startsWith(s) && s.length > bl) { best = a; bl = s.length; }
    }
    return best ? best.id : null;
  };
  parents = () => this.fin.ref('account').filter(a => a.code).sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }))
    .map(a => ({ value: a.code as string, label: `${a.code} — ${a.data?.['name'] ?? a.data?.['nameAr'] ?? ''}` }));
  fields: CrudField[] = [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'nameAr', label: 'fin.f.nameAr', rtl: true },
    { key: 'type', label: 'fin.f.type', type: 'select', required: true, table: true, options: this.types },
    { key: 'parent', label: 'fin.f.parent', type: 'select', options: this.parents, hint: 'fin.f.parentHint' },
    { key: 'isHeader', label: 'fin.f.isHeader', type: 'bool', table: true, hint: 'fin.f.isHeaderHint' },
    { key: 'status', label: 'fin.f.status', type: 'status', table: true, def: 'Active', options: () => ['Active', 'Inactive'].map(v => ({ value: v, label: this.i18n.t('fin.st.' + v) })) },
  ];
  seed() {
    this.fin.seedAccounts().subscribe({
      next: () => { this.crud.reload(); this.fin.loadRefs(['account']).subscribe(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }
}
