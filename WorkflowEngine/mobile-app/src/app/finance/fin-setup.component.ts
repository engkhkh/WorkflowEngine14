import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { FinDefaults } from '../core/fin.models';
import { TranslatePipe } from '../core/translate.pipe';
import { CrudField, FinCrudComponent } from './fin-crud.component';
import { errMsg, recLabel } from './fin-util';

type Tab = 'controls' | 'defaults' | 'currencies' | 'tax' | 'cc';

/** Finance setup (finance.setup): internal controls, default GL accounts, currencies, tax codes, cost centres. */
@Component({
  selector: 'app-fin-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, FinCrudComponent],
  template: `
    <div class="seg sub"><button *ngFor="let t of tabs" [class.on]="tab() === t" (click)="tab.set(t)">{{ 'fin.setup.' + t | translate }}</button></div>
    <p class="flash good" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error">{{ error }}</p>

    <div class="card pad" *ngIf="tab() === 'controls'">
      <label class="chk"><input type="checkbox" [(ngModel)]="ctl.enforceSod" /> <span><b>{{ 'fin.setup.sod' | translate }}</b><br><small class="dim">{{ 'fin.setup.sodHint' | translate }}</small></span></label>
      <div class="field"><label class="lbl">{{ 'fin.setup.tolerance' | translate }}</label><input type="number" min="0" step="0.5" [(ngModel)]="ctl.matchTolerancePct" style="max-width:140px" /><small class="dim">{{ 'fin.setup.toleranceHint' | translate }}</small></div>
      <button class="primary" (click)="saveControls()">{{ 'admin.save' | translate }}</button>
    </div>

    <div class="card pad" *ngIf="tab() === 'defaults'">
      <p class="dim">{{ 'fin.setup.defaultsHint' | translate }}</p>
      <div class="form-grid">
        <div *ngFor="let f of defKeys"><label class="lbl">{{ 'fin.def.' + f | translate }}</label>
          <select [(ngModel)]="def[f]"><option value="">—</option><option *ngFor="let a of accounts()" [value]="a.code!">{{ label(a) }}</option></select></div>
      </div>
      <button class="primary" (click)="saveDefaults()">{{ 'admin.save' | translate }}</button>
    </div>

    <app-fin-crud *ngIf="tab() === 'currencies'" kind="currency" [fields]="curFields" [canManage]="true" newLabel="fin.cur.new" emptyKey="fin.cur.none" />
    <app-fin-crud *ngIf="tab() === 'tax'" kind="taxcode" [fields]="taxFields" [canManage]="true" newLabel="fin.tax.new" emptyKey="fin.tax.none" />
    <app-fin-crud *ngIf="tab() === 'cc'" kind="costcenter" [fields]="ccFields" [canManage]="true" newLabel="fin.cc.new" emptyKey="fin.cc.none" />
  `,
  styles: [`.sub { margin-bottom: 14px; } .pad { padding: 18px; max-width: 760px; } .chk { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 16px; } .chk input { width: auto; margin-top: 4px; }
    .field { margin-bottom: 16px; } .field small { display: block; margin-top: 4px; } .form-grid { margin-bottom: 16px; }`]
})
export class FinSetupComponent implements OnInit {
  auth = inject(AuthService); private fin = inject(FinService); private i18n = inject(I18nService);
  tabs: Tab[] = ['controls', 'defaults', 'currencies', 'tax', 'cc'];
  tab = signal<Tab>('controls');
  ctl: { enforceSod: boolean; matchTolerancePct: number } = { enforceSod: false, matchTolerancePct: 2 };
  def: Record<string, string> = {};
  defKeys: (keyof FinDefaults)[] = ['arAccount', 'apAccount', 'bankAccount', 'revenueAccount', 'expenseAccount', 'vatInput', 'vatOutput', 'deprExpense', 'deprAccum'];
  msg = ''; error = '';
  accounts = () => this.fin.ref('account').filter(a => !a.data?.['isHeader'] && a.status !== 'Inactive').sort((x, y) => (x.code ?? '').localeCompare(y.code ?? ''));
  label(r: any) { return recLabel(r, this.i18n); }

  ngOnInit() {
    this.fin.loadRefs(['setting', 'account']).subscribe(() => {
      const c = this.fin.controls();
      this.ctl = { enforceSod: !!c.enforceSod, matchTolerancePct: Number(c.matchTolerancePct ?? 2) };
      this.def = { ...(this.fin.defaults() as Record<string, string>) };
    });
  }

  private saveSetting(code: string, data: Record<string, any>) {
    const existing = this.fin.ref('setting').find(s => s.code === code);
    const req = existing ? this.fin.update('setting', existing.id, { code, status: 'Active', data }) : this.fin.create('setting', { code, status: 'Active', data });
    this.error = '';
    req.subscribe({
      next: () => { this.msg = this.i18n.t('hr.saved'); setTimeout(() => this.msg = '', 2500); this.fin.loadRefs(['setting']).subscribe(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }
  saveControls() { this.saveSetting('controls', { enforceSod: this.ctl.enforceSod, matchTolerancePct: Number(this.ctl.matchTolerancePct) || 0 }); }
  saveDefaults() { this.saveSetting('defaults', Object.fromEntries(Object.entries(this.def).filter(([, v]) => !!v))); }

  curFields: CrudField[] = [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true, hint: 'fin.cur.codeHint' },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'rate', label: 'fin.cur.rate', type: 'number', def: 1, required: true, table: true, hint: 'fin.cur.rateHint' },
    { key: 'status', label: 'fin.f.status', type: 'status', def: 'Active', table: true, options: () => ['Active', 'Inactive'].map(v => ({ value: v, label: this.i18n.t('fin.st.' + v) })) },
  ];
  taxFields: CrudField[] = [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'rate', label: 'fin.tax.rate', type: 'number', required: true, table: true },
    { key: 'status', label: 'fin.f.status', type: 'status', def: 'Active', table: true, options: () => ['Active', 'Inactive'].map(v => ({ value: v, label: this.i18n.t('fin.st.' + v) })) },
  ];
  ccFields: CrudField[] = [
    { key: 'code', label: 'fin.f.code', required: true, table: true, lockOnEdit: true },
    { key: 'name', label: 'fin.f.name', required: true, table: true },
    { key: 'nameAr', label: 'fin.f.nameAr', rtl: true },
    { key: 'status', label: 'fin.f.status', type: 'status', def: 'Active', table: true, options: () => ['Active', 'Inactive'].map(v => ({ value: v, label: this.i18n.t('fin.st.' + v) })) },
  ];
}
