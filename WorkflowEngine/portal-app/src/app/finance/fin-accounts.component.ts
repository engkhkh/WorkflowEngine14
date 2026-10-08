import { Component, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../core/auth.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { ACCOUNT_TYPES } from '../core/fin.models';
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
    <app-fin-crud #crud kind="account" [fields]="fields" [canManage]="auth.can('finance.gl.manage')" newLabel="fin.acc.new" emptyKey="fin.acc.none" [autoNew]="true">
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
  fields: CrudField[] = [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'nameAr', label: 'fin.f.nameAr', rtl: true },
    { key: 'type', label: 'fin.f.type', type: 'select', required: true, table: true, options: this.types },
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
