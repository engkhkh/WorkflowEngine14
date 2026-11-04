import { Component, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { PosService } from '../core/pos.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { CrudField } from '../finance/fin-crud.component';
import { PosCrudComponent } from './pos-crud.component';
import { PosImportComponent } from './pos-import.component';

const statusOpts = (i18n: I18nService) => () => [{ value: 'Active', label: i18n.t('pos.st.Active') }, { value: 'Inactive', label: i18n.t('pos.st.Inactive') }];

/** Products: SKU, barcode, price, cost, tax, stock tracking. Import from Excel / CSV. */
@Component({
  selector: 'app-pos-products',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent, PosCrudComponent, PosImportComponent],
  template: `
    <app-pos-crud #crud kind="product" [company]="ctx.company()" [fields]="fields()" [canManage]="auth.can('pos.products.manage')" newLabel="pos.product.new" emptyKey="pos.noProducts">
      <button bar *ngIf="auth.can('pos.products.manage')" (click)="imp.set(true)"><app-icon name="download" [size]="15"></app-icon>{{ 'pos.imp.title' | translate }}</button>
    </app-pos-crud>
    <app-pos-import *ngIf="imp()" kind="product" (closed)="imp.set(false)" (imported)="crud.reload(); pos.loadCatalog(ctx.company(), pos.branch()).subscribe()"></app-pos-import>
  `
})
export class PosProductsComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); pos = inject(PosService); private i18n = inject(I18nService);
  @ViewChild('crud') crud!: PosCrudComponent;
  imp = signal(false);
  constructor() { this.pos.loadCatalog(this.ctx.company(), this.pos.branch()).subscribe(); }
  fields = (): CrudField[] => [
    { key: 'code', label: 'pos.sku', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'pos.name', required: true, table: true },
    { key: 'nameAr', label: 'pos.nameAr', rtl: true },
    { key: 'barcode', label: 'pos.barcode', table: true },
    { key: 'category', label: 'pos.category', type: 'select', table: true, options: () => this.pos.categories().map(c => ({ value: c.code ?? '', label: c.data['name'] ?? c.code ?? '' })) },
    { key: 'price', label: 'pos.price', type: 'number', required: true, table: true },
    { key: 'cost', label: 'pos.cost', type: 'number', table: true },
    { key: 'taxRate', label: 'pos.taxRate', hint: 'pos.taxRateHint' },
    { key: 'trackStock', label: 'pos.trackStock', type: 'bool', table: true, def: true },
    { key: 'reorder', label: 'pos.reorder', type: 'number' },
    { key: 'status', label: 'pos.status', type: 'status', table: true, def: 'Active', options: statusOpts(this.i18n) },
  ];
}

/** Customers and their loyalty balance / standing discount. */
@Component({
  selector: 'app-pos-customers',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent, PosCrudComponent, PosImportComponent],
  template: `
    <app-pos-crud #crud kind="customer" [company]="ctx.company()" [fields]="fields()" [canManage]="auth.can('pos.customers.manage')" newLabel="pos.customer.new" emptyKey="common.noData">
      <button bar *ngIf="auth.can('pos.customers.manage')" (click)="imp.set(true)"><app-icon name="download" [size]="15"></app-icon>{{ 'pos.imp.title' | translate }}</button>
    </app-pos-crud>
    <app-pos-import *ngIf="imp()" kind="customer" (closed)="imp.set(false)" (imported)="crud.reload()"></app-pos-import>
  `
})
export class PosCustomersComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); private i18n = inject(I18nService);
  @ViewChild('crud') crud!: PosCrudComponent;
  imp = signal(false);
  fields = (): CrudField[] => [
    { key: 'code', label: 'pos.code', table: true, lockOnEdit: true, hint: 'pos.autoCode' },
    { key: 'name', label: 'pos.name', required: true, table: true },
    { key: 'phone', label: 'pos.phone', table: true },
    { key: 'email', label: 'pos.email' },
    { key: 'discountPct', label: 'pos.discountPct', type: 'number', table: true },
    { key: 'points', label: 'pos.points', type: 'number', table: true, def: 0 },
    { key: 'status', label: 'pos.status', type: 'status', def: 'Active', options: statusOpts(this.i18n) },
  ];
}

/** Promotions: % off, amount off, or buy-N-get-%-off; for everything, one product or one category; optional dates and branches. */
@Component({
  selector: 'app-pos-promotions',
  standalone: true,
  imports: [CommonModule, PosCrudComponent],
  template: `<app-pos-crud kind="promotion" [company]="ctx.company()" [fields]="fields()" [canManage]="auth.can('pos.promotions.manage')" newLabel="pos.promo.new" emptyKey="common.noData" />`
})
export class PosPromotionsComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); pos = inject(PosService); private i18n = inject(I18nService);
  constructor() { this.pos.loadCatalog(this.ctx.company(), this.pos.branch()).subscribe(); }
  fields = (): CrudField[] => [
    { key: 'code', label: 'pos.code', table: true, lockOnEdit: true, hint: 'pos.autoCode' },
    { key: 'name', label: 'pos.name', required: true, table: true },
    { key: 'type', label: 'pos.promo.type', type: 'select', table: true, def: 'pct', options: () => ['pct', 'amount', 'qty'].map(v => ({ value: v, label: this.i18n.t('pos.promo.t.' + v) })) },
    { key: 'scope', label: 'pos.promo.scope', type: 'select', table: true, def: 'all', options: () => ['all', 'category', 'sku'].map(v => ({ value: v, label: this.i18n.t('pos.promo.s.' + v) })) },
    { key: 'target', label: 'pos.promo.target', table: true, hint: 'pos.promo.targetHint' },
    { key: 'value', label: 'pos.promo.value', type: 'number', required: true, table: true },
    { key: 'minQty', label: 'pos.promo.minQty', type: 'number' },
    { key: 'from', label: 'pos.promo.from', type: 'date' },
    { key: 'to', label: 'pos.promo.to', type: 'date' },
    { key: 'branches', label: 'pos.promo.branches', hint: 'pos.promo.branchesHint' },
    { key: 'status', label: 'pos.status', type: 'status', table: true, def: 'Active', options: statusOpts(this.i18n) },
  ];
}
