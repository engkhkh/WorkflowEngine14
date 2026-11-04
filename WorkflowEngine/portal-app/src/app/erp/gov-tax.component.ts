import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { GovService, VatReturn, ZatcaProfile } from '../core/gov.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** Governance > Tax: the VAT return (output and input VAT for a period) and the ZATCA seller profile used for e-invoices. */
@Component({
  selector: 'app-gov-tax',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, NumPipe],
  template: `
    <nav class="tabs sub">
      <a *ngIf="canVat" [class.on]="tab() === 'vat'" (click)="tab.set('vat')">{{ 'gov.tax.vat' | translate }}</a>
      <a *ngIf="canProfile" [class.on]="tab() === 'zatca'" (click)="tab.set('zatca')">{{ 'gov.tax.zatca' | translate }}</a>
    </nav>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <p class="flash good" *ngIf="msg">{{ msg }}</p>

    <ng-container *ngIf="tab() === 'vat'">
      <div class="bar">
        <label class="lbl">{{ 'gov.tax.from' | translate }}</label><input type="date" [(ngModel)]="from" />
        <label class="lbl">{{ 'gov.tax.to' | translate }}</label><input type="date" [(ngModel)]="to" />
        <button class="primary" (click)="run()">{{ 'gov.tax.run' | translate }}</button>
        <button class="ghost" *ngIf="v()" (click)="csv()">CSV</button>
      </div>
      <ng-container *ngIf="v() as r">
        <div class="kpis">
          <div class="k"><span>{{ 'gov.tax.out' | translate }}</span><strong>{{ r.outputVat | num: 2 }}</strong></div>
          <div class="k"><span>{{ 'gov.tax.in' | translate }}</span><strong>{{ r.inputVat | num: 2 }}</strong></div>
          <div class="k"><span>{{ (r.netVatDue >= 0 ? 'gov.tax.due' : 'gov.tax.refund') | translate }}</span><strong [class.neg]="r.netVatDue > 0">{{ abs(r.netVatDue) | num: 2 }}</strong></div>
          <div class="k"><span>{{ 'gov.tax.einv' | translate }}</span><strong>{{ r.einvoiced }} / {{ r.salesInvoices }}</strong></div>
        </div>
        <p class="flash bad" *ngIf="r.notEinvoiced > 0">{{ 'gov.tax.notEinv' | translate: { n: r.notEinvoiced } }}</p>
        <p class="flash bad" *ngIf="r.warnings.missingTaxCode.length">{{ 'gov.tax.missingCode' | translate: { n: r.warnings.missingTaxCode.length } }}</p>
        <div class="grid g2">
          <div class="card"><div class="card-head"><h3>{{ 'gov.tax.sales' | translate }}</h3></div><div class="table-wrap"><table class="data">
            <thead><tr><th>{{ 'gov.tax.category' | translate }}</th><th class="num">#</th><th class="num">{{ 'gov.tax.net' | translate }}</th><th class="num">VAT</th></tr></thead>
            <tbody><tr *ngFor="let b of r.sales"><td>{{ catLabel(b.category) }}</td><td class="num">{{ b.count }}</td><td class="num">{{ b.net | num: 2 }}</td><td class="num">{{ b.vat | num: 2 }}</td></tr>
              <tr class="tot"><td>{{ 'gov.tax.total' | translate }}</td><td class="num">{{ r.salesInvoices }}</td><td class="num">{{ r.salesNet | num: 2 }}</td><td class="num">{{ r.outputVat | num: 2 }}</td></tr></tbody></table></div></div>
          <div class="card"><div class="card-head"><h3>{{ 'gov.tax.purchases' | translate }}</h3></div><div class="table-wrap"><table class="data">
            <thead><tr><th>{{ 'gov.tax.category' | translate }}</th><th class="num">#</th><th class="num">{{ 'gov.tax.net' | translate }}</th><th class="num">VAT</th></tr></thead>
            <tbody><tr *ngFor="let b of r.purchases"><td>{{ catLabel(b.category) }}</td><td class="num">{{ b.count }}</td><td class="num">{{ b.net | num: 2 }}</td><td class="num">{{ b.vat | num: 2 }}</td></tr>
              <tr class="tot"><td>{{ 'gov.tax.total' | translate }}</td><td class="num">{{ r.purchaseInvoices }}</td><td class="num">{{ r.purchasesNet | num: 2 }}</td><td class="num">{{ r.inputVat | num: 2 }}</td></tr></tbody></table></div></div>
        </div>
        <div class="card top"><div class="card-head"><h3>{{ 'gov.tax.byCode' | translate }}</h3></div><div class="table-wrap"><table class="data">
          <thead><tr><th>{{ 'gov.tax.side' | translate }}</th><th>{{ 'gov.tax.code' | translate }}</th><th class="num">#</th><th class="num">{{ 'gov.tax.net' | translate }}</th><th class="num">VAT</th></tr></thead>
          <tbody><tr *ngFor="let c of codeRows()"><td>{{ (c.side === 'sales' ? 'gov.tax.sales' : 'gov.tax.purchases') | translate }}</td><td class="mono">{{ c.code }}</td><td class="num">{{ c.count }}</td><td class="num">{{ c.net | num: 2 }}</td><td class="num">{{ c.vat | num: 2 }}</td></tr></tbody></table></div></div>
      </ng-container>
    </ng-container>

    <ng-container *ngIf="tab() === 'zatca' && p">
      <div class="card"><div class="card-body">
        <p class="dim">{{ 'gov.zatca.profileHint' | translate }}</p>
        <div class="form-grid">
          <div><label class="lbl">{{ 'gov.zatca.seller' | translate }} *</label><input [(ngModel)]="p.sellerName" [disabled]="!canSave" /></div>
          <div><label class="lbl">{{ 'gov.zatca.sellerAr' | translate }}</label><input [(ngModel)]="p.sellerNameAr" dir="rtl" [disabled]="!canSave" /></div>
          <div><label class="lbl">{{ 'gov.zatca.vatNo' | translate }} *</label><input [(ngModel)]="p.vatNo" maxlength="15" [disabled]="!canSave" /><small class="dim">{{ 'gov.zatca.vatHint' | translate }}</small></div>
          <div><label class="lbl">{{ 'gov.zatca.crNo' | translate }}</label><input [(ngModel)]="p.crNo" [disabled]="!canSave" /></div>
          <div><label class="lbl">{{ 'gov.zatca.street' | translate }}</label><input [(ngModel)]="p.street" [disabled]="!canSave" /></div>
          <div><label class="lbl">{{ 'gov.zatca.building' | translate }}</label><input [(ngModel)]="p.building" [disabled]="!canSave" /></div>
          <div><label class="lbl">{{ 'gov.zatca.district' | translate }}</label><input [(ngModel)]="p.district" [disabled]="!canSave" /></div>
          <div><label class="lbl">{{ 'gov.zatca.city' | translate }}</label><input [(ngModel)]="p.city" [disabled]="!canSave" /></div>
          <div><label class="lbl">{{ 'gov.zatca.postal' | translate }}</label><input [(ngModel)]="p.postalCode" maxlength="5" [disabled]="!canSave" /></div>
          <div><label class="lbl">{{ 'gov.zatca.country' | translate }}</label><input [(ngModel)]="p.country" maxlength="2" [disabled]="!canSave" /></div>
        </div>
        <p class="dim top2">{{ 'gov.zatca.phaseNote' | translate }}</p>
        <button class="primary" *ngIf="canSave" (click)="save()">{{ 'admin.save' | translate }}</button>
      </div></div>
    </ng-container>
  `,
  styles: [`
    .sub { display: flex; gap: 4px; margin-bottom: 14px; } .sub a { padding: 8px 14px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--text-2); font-weight: 550; } .sub a.on { color: var(--primary); border-bottom-color: var(--primary); }
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; } .bar input { max-width: 170px; } .bar .lbl { margin: 0; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .k { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; display: grid; gap: 4px; } .k span { color: var(--text-dim); font-size: 12px; } .k strong { font-size: 20px; font-variant-numeric: tabular-nums; }
    .g2 { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); align-items: start; gap: 14px; } .top { margin-top: 14px; } .top2 { margin: 12px 0; } .neg { color: var(--bad); } .tot td { font-weight: 700; border-top: 2px solid var(--border); }
  `]
})
export class GovTaxComponent {
  private gov = inject(GovService); private ctx = inject(ErpContextService); private i18n = inject(I18nService); private auth = inject(AuthService);
  canVat = this.auth.canAny('gov.vat.view', 'finance.reports.view'); canProfile = this.auth.canAny('gov.zatca.manage', 'finance.setup', 'finance.view'); canSave = this.auth.canAny('gov.zatca.manage', 'finance.setup');
  tab = signal<'vat' | 'zatca'>(this.canVat ? 'vat' : 'zatca');
  from = iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); to = iso(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
  v = signal<VatReturn | null>(null); p: ZatcaProfile | null = null; error = ''; msg = '';

  constructor() {
    this.gov.profile().subscribe({ next: x => this.p = x, error: () => this.p = { sellerName: '', sellerNameAr: '', vatNo: '', crNo: '', street: '', building: '', district: '', city: '', postalCode: '', country: 'SA' } });
    if (this.canVat) this.run();
  }
  abs = Math.abs;
  catLabel(c: string) { return this.i18n.t('fin.tax.cat.' + c); }
  codeRows() { const r = this.v(); return r ? [...r.salesByCode.map(x => ({ ...x, side: 'sales' })), ...r.purchasesByCode.map(x => ({ ...x, side: 'purchases' }))] : []; }
  run() {
    this.error = '';
    this.gov.vatReturn(this.from, this.to, this.ctx.company()).subscribe({ next: r => this.v.set(r), error: e => this.error = errMsg(e, this.i18n) });
  }
  save() {
    this.error = ''; this.msg = '';
    this.gov.saveProfile(this.p!).subscribe({ next: () => { this.msg = this.i18n.t('hr.saved'); setTimeout(() => this.msg = '', 2500); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  csv() {
    const r = this.v(); if (!r) return;
    const rows = [['side', 'category', 'count', 'net', 'vat'], ...r.sales.map(b => ['sales', b.category, b.count, b.net, b.vat]), ...r.purchases.map(b => ['purchases', b.category, b.count, b.net, b.vat]),
      ['sales', 'TOTAL', r.salesInvoices, r.salesNet, r.outputVat], ['purchases', 'TOTAL', r.purchaseInvoices, r.purchasesNet, r.inputVat], ['net vat due', '', '', '', r.netVatDue]];
    const url = URL.createObjectURL(new Blob(['﻿' + rows.map(x => x.join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `vat-return-${r.from}-${r.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
