import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { HosRec, HospitalService } from './hospital.service';
import { HOS_CSS } from './hos-styles';

/** Invoices built from the visit (consultation, lab, dispensed medicines, bed days), insurance share and the payments taken. */
@Component({
  selector: 'app-hos-billing',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, LocalDatePipe, NumPipe],
  template: `
    <div class="bar">
      <div class="seg"><button *ngFor="let s of ['', 'Unpaid', 'Partial', 'Paid']" [class.on]="status === s" (click)="status = s; load()">{{ (s ? 'hos.s.' + s : 'hos.all') | translate }}</button></div>
      <input class="search" [placeholder]="'hos.searchPatient' | translate" [(ngModel)]="q" (ngModelChange)="load()" />
    </div>
    <p class="flash" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error && !sel">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.patient' | translate }}</th><th>{{ 'hos.f.date' | translate }}</th><th class="num">{{ 'hos.f.total' | translate }} ({{ api.currency() }})</th><th class="num">{{ 'hos.f.insurance' | translate }}</th><th class="num">{{ 'hos.f.paid' | translate }}</th><th class="num">{{ 'hos.f.balance' | translate }}</th><th>{{ 'hos.f.status' | translate }}</th></tr></thead><tbody>
      <tr *ngFor="let i of list()" class="click" (click)="open(i)"><td>{{ i.code }}</td><td>{{ i.data['patientName'] }}</td><td>{{ i.createdAt | ldate }}</td><td class="num">{{ (i.data['total'] ?? i.data['gross']) | num }}</td><td class="num">{{ i.data['insurance'] | num }}</td><td class="num">{{ i.data['paid'] | num }}</td><td class="num"><b>{{ i.data['balance'] | num }}</b></td>
        <td><span class="chip" [class.ok]="i.status === 'Paid'" [class.warn]="i.status === 'Partial'">{{ 'hos.s.' + i.status | translate }}</span></td></tr>
      <tr *ngIf="!list().length"><td colspan="8" class="dim">{{ 'hos.none' | translate }}</td></tr></tbody></table></div></div>

    <div class="modal-scrim" *ngIf="sel" (click)="sel = null"><div class="modal" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ sel.code }} — {{ sel.data['patientName'] }}</h3><button class="ghost" (click)="print()"><app-icon name="printer"></app-icon></button></div>
      <div class="modal-body" id="hos-inv">
        <p class="flash bad" *ngIf="error">{{ error }}</p>
        <table class="data"><thead><tr><th>{{ 'hos.f.item' | translate }}</th><th class="num">{{ 'hos.f.qty' | translate }}</th><th class="num">{{ 'hos.f.price' | translate }}</th><th class="num">{{ 'hos.f.amount' | translate }}</th></tr></thead><tbody>
          <tr *ngFor="let l of sel.data['lines']"><td>{{ l.desc }}</td><td class="num">{{ l.qty }}</td><td class="num">{{ l.price | num }}</td><td class="num">{{ l.amount | num }}</td></tr>
          <tr *ngIf="sel.data['tax']"><td colspan="3" class="num">{{ 'hos.f.subtotal' | translate }}</td><td class="num">{{ sel.data['gross'] | num }}</td></tr>
          <tr *ngIf="sel.data['tax']"><td colspan="3" class="num">{{ sel.data['taxName'] || ('hos.f.tax' | translate) }} ({{ sel.data['taxPct'] }}%)</td><td class="num">{{ sel.data['tax'] | num }}</td></tr>
          <tr><td colspan="3" class="num"><b>{{ 'hos.f.total' | translate }} ({{ api.currency() }})</b></td><td class="num"><b>{{ (sel.data['total'] ?? sel.data['gross']) | num }}</b></td></tr>
          <tr *ngIf="sel.data['insurance']"><td colspan="3" class="num">{{ sel.data['insuranceName'] }} ({{ sel.data['insurancePct'] }}%)</td><td class="num">− {{ sel.data['insurance'] | num }}</td></tr>
          <tr><td colspan="3" class="num"><b>{{ 'hos.f.due' | translate }}</b></td><td class="num"><b>{{ sel.data['due'] | num }}</b></td></tr>
          <tr *ngFor="let p of sel.data['payments']"><td colspan="3" class="num dim">{{ p.at | ldate }} · {{ p.method }} · {{ p.by }}</td><td class="num">− {{ p.amount | num }}</td></tr>
          <tr><td colspan="3" class="num"><b>{{ 'hos.f.balance' | translate }}</b></td><td class="num"><b>{{ sel.data['balance'] | num }}</b></td></tr></tbody></table>
        <div class="row mt no-print" *ngIf="auth.can('hos.billing.manage') && sel.data['balance'] > 0">
          <input type="number" style="width:130px" [(ngModel)]="pay.amount" /><select [(ngModel)]="pay.method"><option *ngFor="let m of api.methods()" [value]="m">{{ methodLabel(m) }}</option></select>
          <button class="primary" (click)="doPay()">{{ 'hos.pay' | translate }}</button></div>
      </div>
      <div class="modal-foot"><button (click)="sel = null">{{ 'hos.close' | translate }}</button></div>
    </div></div>
  `,
  styles: [HOS_CSS]
})
export class HosBillingComponent implements OnInit {
  auth = inject(AuthService); api = inject(HospitalService); private i18n = inject(I18nService);
  list = signal<HosRec[]>([]); status = ''; q = ''; error = ''; msg = ''; sel: HosRec | null = null; pay: any = { amount: 0, method: 'cash' };
  ngOnInit() { this.api.loadCfg(); this.load(); }
  load() { this.api.records('invoice', { status: this.status, q: this.q, take: 300 }).subscribe({ next: l => this.list.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  open(i: HosRec) { this.sel = i; this.error = ''; this.pay = { amount: i.data['balance'], method: 'cash' }; }
  doPay() {
    this.error = '';
    this.api.post(`invoices/${this.sel!.id}/pay`, this.pay).subscribe({
      next: (r: HosRec) => { this.sel = r; this.pay = { amount: r.data['balance'], method: this.pay.method }; this.msg = '✓'; setTimeout(() => this.msg = '', 2500); this.load(); },
      error: e => this.error = errMsg(e, this.i18n) });
  }
  methodLabel(m: string) { const k = 'hos.m.' + m; const t = this.i18n.t(k); return t === k ? m : t; }
  print() { window.print(); }
}
