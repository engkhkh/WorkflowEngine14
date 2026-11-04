import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { PosService } from '../core/pos.service';
import { PosSettings, POS_DEFAULTS } from '../core/pos.models';
import { TranslatePipe } from '../core/translate.pipe';
import { CrudField } from '../finance/fin-crud.component';
import { PosCrudComponent } from './pos-crud.component';
import { errMsg } from '../hr/hr-util';

/** POS settings (tax, loyalty, shift and discount rules, receipt text), product categories and registers. Needs pos.setup. */
@Component({
  selector: 'app-pos-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, PosCrudComponent],
  template: `
    <h3 class="h">{{ 'pos.setup.rules' | translate }}</h3>
    <div class="card pad">
      <div class="form-grid">
        <div><label class="lbl">{{ 'pos.setup.taxRate' | translate }}</label><input type="number" step="0.01" [(ngModel)]="f.taxRate" /></div>
        <div><label class="lbl">{{ 'pos.setup.maxDisc' | translate }}</label><input type="number" [(ngModel)]="f.maxDiscountPct" /></div>
        <div><label class="lbl">{{ 'pos.setup.ppc' | translate }}</label><input type="number" step="0.01" [(ngModel)]="f.pointsPerCurrency" /></div>
        <div><label class="lbl">{{ 'pos.setup.pointValue' | translate }}</label><input type="number" step="0.001" [(ngModel)]="f.pointValue" /></div>
        <label class="chk"><input type="checkbox" [(ngModel)]="f.pricesIncludeTax" /> {{ 'pos.setup.inclTax' | translate }}</label>
        <label class="chk"><input type="checkbox" [(ngModel)]="f.requireShift" /> {{ 'pos.setup.reqShift' | translate }}</label>
        <label class="chk"><input type="checkbox" [(ngModel)]="f.allowNegativeStock" /> {{ 'pos.setup.negStock' | translate }}</label>
        <div class="full"><label class="lbl">{{ 'pos.setup.rcHeader' | translate }}</label><input [(ngModel)]="f.receiptHeader" /></div>
        <div class="full"><label class="lbl">{{ 'pos.setup.rcFooter' | translate }}</label><input [(ngModel)]="f.receiptFooter" /></div>
      </div>
      <p class="flash good" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error">{{ error }}</p>
      <button class="primary" (click)="save()">{{ 'admin.save' | translate }}</button>
    </div>
    <h3 class="h">{{ 'pos.setup.categories' | translate }}</h3>
    <app-pos-crud kind="category" [company]="ctx.company()" [fields]="catFields" [canManage]="auth.can('pos.setup')" newLabel="pos.category.new" emptyKey="common.noData" />
    <h3 class="h top">{{ 'pos.setup.registers' | translate }}</h3>
    <app-pos-crud kind="register" [company]="ctx.company()" [scopeBranch]="true" [fields]="regFields" [canManage]="auth.can('pos.setup')" newLabel="pos.register.new" emptyKey="common.noData" />
  `,
  styles: [`.h { margin: 0 0 10px; font-size: 14px; } .top { margin-top: 24px; } .pad { padding: 16px; margin-bottom: 24px; display: grid; gap: 12px; } .chk { display: flex; gap: 8px; align-items: center; padding-top: 22px; } .chk input { width: auto; } .full { grid-column: 1 / -1; }`]
})
export class PosSetupComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); pos = inject(PosService); private i18n = inject(I18nService);
  f: Required<PosSettings> = { ...POS_DEFAULTS }; msg = ''; error = '';
  catFields: CrudField[] = [{ key: 'code', label: 'pos.code', required: true, table: true, lockOnEdit: true }, { key: 'name', label: 'pos.name', required: true, table: true }, { key: 'nameAr', label: 'pos.nameAr', rtl: true }];
  regFields: CrudField[] = [{ key: 'code', label: 'pos.code', required: true, table: true, lockOnEdit: true }, { key: 'name', label: 'pos.name', required: true, table: true }];
  constructor() {
    effect(() => { this.ctx.company(); this.pos.loadCatalog(this.ctx.company(), this.pos.branch()).subscribe(() => this.f = { ...POS_DEFAULTS, ...this.pos.settings() }); });
  }
  save() {
    this.error = '';
    const data = { ...this.f }; for (const k of ['taxRate', 'maxDiscountPct', 'pointsPerCurrency', 'pointValue'] as const) (data as any)[k] = Number(data[k]) || 0;
    const rec = this.pos.settingRec();
    const req = rec ? this.pos.update('setting', rec.id, { ...rec, data }) : this.pos.create('setting', { code: 'pos', data });
    req.subscribe({ next: r => { this.pos.settingRec.set(r); this.msg = this.i18n.t('hr.saved'); setTimeout(() => this.msg = '', 2500); }, error: e => this.error = errMsg(e, this.i18n) });
  }
}
