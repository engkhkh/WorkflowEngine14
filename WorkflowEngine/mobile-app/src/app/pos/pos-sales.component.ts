import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { PosService } from '../core/pos.service';
import { PosRec } from '../core/pos.models';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe } from '../shared/ui';
import { errMsg, todayStr } from '../hr/hr-util';
import { PosReceiptComponent, printReceipt } from './pos-receipt.component';

/** Sales history: find a receipt, reprint it, return items (pos.refund) or void a sale in the open shift (pos.void). */
@Component({
  selector: 'app-pos-sales',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, NumPipe, LocalDatePipe, IconComponent, PosReceiptComponent],
  template: `
    <div class="bar">
      <input class="search" [placeholder]="'pos.findReceipt' | translate" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <input type="date" [(ngModel)]="from" (ngModelChange)="load()" /><input type="date" [(ngModel)]="to" (ngModelChange)="load()" />
      <select [ngModel]="type()" (ngModelChange)="type.set($event)"><option value="">{{ 'pos.all' | translate }}</option><option value="Sale">{{ 'pos.rc.receipt' | translate }}</option><option value="Return">{{ 'pos.rc.return' | translate }}</option></select>
      <span class="grow"></span><span class="dim">{{ shown().length }} · {{ total() | num: 2 }}</span>
    </div>
    <p class="flash good" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error && !ret">{{ error }}</p>

    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'pos.code' | translate }}</th><th>{{ 'pos.date' | translate }}</th><th *ngIf="pos.hasBranches()">{{ 'pos.branch' | translate }}</th><th>{{ 'pos.cashier' | translate }}</th><th>{{ 'pos.customer' | translate }}</th>
        <th>{{ 'pos.status' | translate }}</th><th class="num">{{ 'pos.total' | translate }}</th><th></th></tr></thead>
      <tbody><tr *ngFor="let s of shown()" [class.void]="s.status === 'Voided'">
        <td class="mono">{{ s.code }}<small class="dim" *ngIf="s.parent"> ← {{ s.parent }}</small></td><td>{{ s.createdAt | ldate: 'datetime' }}</td><td *ngIf="pos.hasBranches()">{{ s.branch }}</td>
        <td>{{ s.createdBy }}</td><td>{{ s.data['customerName'] || '—' }}</td><td>{{ 'pos.st.' + s.status | translate }}</td>
        <td class="num" [class.neg]="s.data['total'] < 0">{{ s.data['total'] | num: 2 }}</td>
        <td class="act"><button class="ghost sm" (click)="view.set(s)"><app-icon name="file" [size]="15"></app-icon></button>
          <button class="ghost sm" *ngIf="canReturn(s)" (click)="openReturn(s)">{{ 'pos.rc.return' | translate }}</button>
          <button class="ghost sm danger-i" *ngIf="canVoid(s)" (click)="confirmVoid = s">{{ 'pos.void' | translate }}</button></td></tr></tbody></table>
      <div class="empty" *ngIf="!shown().length">{{ 'common.noData' | translate }}</div></div></div>

    <div class="modal-scrim" *ngIf="view()" (click)="view.set(null)">
      <div class="modal" (click)="$event.stopPropagation()"><div class="modal-body"><app-pos-receipt [sale]="view()"></app-pos-receipt></div>
        <div class="modal-foot"><button (click)="printReceipt()"><app-icon name="printer" [size]="14"></app-icon>{{ 'pos.print' | translate }}</button><button class="primary" (click)="view.set(null)">OK</button></div></div>
    </div>

    <div class="modal-scrim" *ngIf="ret" (click)="ret = null">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'pos.rc.return' | translate }} · {{ ret.code }}</h3></div>
        <div class="modal-body">
          <table class="data"><thead><tr><th>{{ 'pos.product' | translate }}</th><th class="num">{{ 'pos.sold' | translate }}</th><th class="num">{{ 'pos.alreadyReturned' | translate }}</th><th class="num">{{ 'pos.returnQty' | translate }}</th></tr></thead>
            <tbody><tr *ngFor="let l of ret.data['lines']; let i = index"><td>{{ l.name }}<small class="dim"> {{ l.sku }}</small></td><td class="num">{{ l.qty }}</td><td class="num">{{ l.returned || 0 }}</td>
              <td class="num"><input class="q" type="number" min="0" [max]="l.qty - (l.returned || 0)" [(ngModel)]="retQty[i]" /></td></tr></tbody></table>
          <div class="form-grid"><div><label class="lbl">{{ 'pos.refundMethod' | translate }}</label><select [(ngModel)]="retMethod"><option value="cash">{{ 'pos.pay.cash' | translate }}</option><option value="card">{{ 'pos.pay.card' | translate }}</option></select></div>
            <div><label class="lbl">{{ 'pos.reason' | translate }}</label><input [(ngModel)]="retReason" /></div></div>
          <p class="flash bad" *ngIf="error">{{ error }}</p>
        </div>
        <div class="modal-foot"><button (click)="ret = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="doReturn()">{{ 'pos.rc.return' | translate }}</button></div>
      </div>
    </div>

    <div class="modal-scrim" *ngIf="confirmVoid" (click)="confirmVoid = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'pos.void' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'pos.voidConfirm' | translate: { name: confirmVoid.code || '' } }}</p><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="confirmVoid = null">{{ 'common.cancel' | translate }}</button><button class="primary danger-fill" (click)="doVoid()">{{ 'pos.void' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; } .search { max-width: 260px; } .grow { flex: 1; } .act { white-space: nowrap; text-align: end; }
    .void td { opacity: .55; text-decoration: line-through; } .neg { color: var(--bad); } .danger-i { color: var(--bad); } .danger-fill { background: var(--bad); border-color: var(--bad); color: #fff; }
    .q { width: 70px; text-align: center; }
  `]
})
export class PosSalesComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); pos = inject(PosService); private i18n = inject(I18nService);
  all = signal<PosRec[]>([]); q = signal(''); type = signal(''); view = signal<PosRec | null>(null);
  from = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10); to = todayStr();
  ret: PosRec | null = null; retQty: number[] = []; retMethod = 'cash'; retReason = ''; confirmVoid: PosRec | null = null; msg = ''; error = '';
  printReceipt = printReceipt;

  shown = computed(() => {
    const q = this.q().toLowerCase().trim(), t = this.type();
    return this.all().filter(s => (!t || s.data['type'] === t) && (!q || (s.code ?? '').toLowerCase().includes(q) || (s.parent ?? '').toLowerCase().includes(q) || String(s.data['customerName'] ?? '').toLowerCase().includes(q) || (s.createdBy ?? '').toLowerCase().includes(q)));
  });
  total = computed(() => this.shown().filter(s => s.status !== 'Voided').reduce((a, s) => a + (Number(s.data['total']) || 0), 0));

  constructor() {
    effect(() => { this.ctx.company(); this.ctx.branch(); this.load(); });
    this.pos.loadCatalog(this.ctx.company(), this.pos.branch()).subscribe();
  }
  load() {
    this.pos.records('sale', { company: this.ctx.company(), branch: this.pos.hasBranches() ? this.ctx.branch() : null, from: this.from, to: this.to, take: 1000 })
      .pipe(catchError(e => { this.error = errMsg(e, this.i18n); return of([] as PosRec[]); })).subscribe(l => this.all.set(l));
  }
  canReturn = (s: PosRec) => this.auth.can('pos.refund') && s.data['type'] === 'Sale' && s.status !== 'Voided' && s.status !== 'Returned';
  canVoid = (s: PosRec) => this.auth.can('pos.void') && s.data['type'] === 'Sale' && s.status === 'Completed';

  openReturn(s: PosRec) { this.ret = s; this.retQty = (s.data['lines'] as any[]).map(() => 0); this.retMethod = 'cash'; this.retReason = ''; this.error = ''; }
  doReturn() {
    const s = this.ret!; const lines = (s.data['lines'] as any[]).map((l, i) => ({ sku: l.sku, qty: Number(this.retQty[i]) || 0 })).filter(l => l.qty > 0);
    if (!lines.length) { this.error = this.i18n.t('pos.pickReturn'); return; }
    this.pos.returnSale(s.id, lines, this.retMethod, this.retReason).subscribe({
      next: r => { this.ret = null; this.msg = this.i18n.t('pos.returned'); setTimeout(() => this.msg = '', 2500); this.view.set(r); this.load(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }
  doVoid() {
    this.pos.voidSale(this.confirmVoid!.id).subscribe({ next: () => { this.confirmVoid = null; this.load(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
}
