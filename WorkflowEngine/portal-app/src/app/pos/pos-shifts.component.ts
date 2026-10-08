import { Component, OnInit, effect, inject, signal } from '@angular/core';
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
import { errMsg } from '../hr/hr-util';

/** Cash drawer control: open a shift with a float, cash in / out, close with a count and see the variance. History for supervisors. */
@Component({
  selector: 'app-pos-shifts',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, NumPipe, LocalDatePipe, IconComponent],
  template: `
    <p class="flash good" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error && !dlg">{{ error }}</p>

    <div class="card cur" *ngIf="auth.can('pos.sell')">
      <ng-container *ngIf="pos.shift() as s; else none">
        <div class="head"><h3>{{ 'pos.shift.current' | translate }} · <span class="mono">{{ s.code }}</span></h3>
          <span class="dim">{{ s.data['openedAt'] | ldate: 'datetime' }}<ng-container *ngIf="s.ref"> · {{ s.ref }}</ng-container></span></div>
        <div class="kv">
          <div><small>{{ 'pos.shift.opening' | translate }}</small><b>{{ s.data['opening'] | num: 2 }}</b></div>
          <div><small>{{ 'pos.shift.cashSales' | translate }}</small><b>{{ s.data['cashSales'] || 0 | num: 2 }}</b></div>
          <div><small>{{ 'pos.shift.cardSales' | translate }}</small><b>{{ (s.data['cardSales'] || 0) + (s.data['otherSales'] || 0) | num: 2 }}</b></div>
          <div><small>{{ 'pos.shift.refunds' | translate }}</small><b>{{ (s.data['returnsTotal'] || 0) | num: 2 }}</b></div>
          <div><small>{{ 'pos.shift.cashIn' | translate }} / {{ 'pos.shift.cashOut' | translate }}</small><b>{{ s.data['cashIn'] || 0 | num: 2 }} / {{ s.data['cashOut'] || 0 | num: 2 }}</b></div>
          <div><small>{{ 'pos.shift.sales' | translate }}</small><b>{{ s.data['salesCount'] || 0 }}</b></div>
        </div>
        <div class="btns"><button (click)="cashOpen('in')">{{ 'pos.shift.cashIn' | translate }}</button><button (click)="cashOpen('out')">{{ 'pos.shift.cashOut' | translate }}</button>
          <button class="primary" (click)="closeOpen()">{{ 'pos.shift.close' | translate }}</button></div>
      </ng-container>
      <ng-template #none>
        <div class="head"><h3>{{ 'pos.shift.none' | translate }}</h3></div>
        <div class="form-grid">
          <div *ngIf="pos.registers().length"><label class="lbl">{{ 'pos.register' | translate }}</label><select [(ngModel)]="reg"><option value="">—</option><option *ngFor="let r of pos.registers()" [value]="r.code">{{ r.code }} · {{ r.data['name'] }}</option></select></div>
          <div><label class="lbl">{{ 'pos.shift.opening' | translate }}</label><input type="number" step="0.01" [(ngModel)]="float" /></div>
        </div>
        <button class="primary" (click)="open()">{{ 'pos.shift.open' | translate }}</button>
      </ng-template>
    </div>

    <h3 class="h">{{ 'pos.shift.history' | translate }}</h3>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'pos.code' | translate }}</th><th>{{ 'pos.cashier' | translate }}</th><th *ngIf="pos.hasBranches()">{{ 'pos.branch' | translate }}</th><th>{{ 'pos.opened' | translate }}</th>
        <th>{{ 'pos.status' | translate }}</th><th class="num">{{ 'pos.shift.sales' | translate }}</th><th class="num">{{ 'pos.shift.expected' | translate }}</th><th class="num">{{ 'pos.shift.counted' | translate }}</th><th class="num">{{ 'pos.shift.variance' | translate }}</th><th>{{ 'pos.shift.journal' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let s of history()">
        <td class="mono">{{ s.code }}</td><td>{{ s.createdBy }}</td><td *ngIf="pos.hasBranches()">{{ s.branch }}</td><td>{{ s.createdAt | ldate: 'datetime' }}</td>
        <td>{{ 'pos.st.' + s.status | translate }}</td><td class="num">{{ s.data['salesTotal'] || 0 | num: 2 }}</td>
        <td class="num">{{ s.data['expected'] | num: 2 }}</td><td class="num">{{ s.data['counted'] | num: 2 }}</td>
        <td class="num" [class.neg]="s.data['variance'] < 0" [class.pos]="s.data['variance'] > 0">{{ s.status === 'Closed' ? (s.data['variance'] | num: 2) : '' }}</td><td class="mono">{{ s.data['journal'] }}</td></tr></tbody></table>
      <div class="empty" *ngIf="!history().length">{{ 'common.noData' | translate }}</div></div></div>

    <div class="modal-scrim" *ngIf="dlg" (click)="dlg = ''">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (dlg === 'close' ? 'pos.shift.close' : dlg === 'in' ? 'pos.shift.cashIn' : 'pos.shift.cashOut') | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div class="full"><label class="lbl">{{ (dlg === 'close' ? 'pos.shift.countedCash' : 'pos.amount') | translate }}</label><input type="number" step="0.01" [(ngModel)]="amount" /></div>
          <div class="full"><label class="lbl">{{ (dlg === 'close' ? 'pos.note' : 'pos.reason') | translate }}</label><input [(ngModel)]="note" /></div>
        </div><p class="dim" *ngIf="dlg === 'close'">{{ 'pos.shift.closeHint' | translate }}</p><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="submit()">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <div class="modal-scrim" *ngIf="closed()" (click)="closed.set(null)">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'pos.shift.closed' | translate }} · {{ closed()!.code }}</h3></div>
        <div class="modal-body kvl">
          <div><span>{{ 'pos.shift.expected' | translate }}</span><b>{{ closed()!.data['expected'] | num: 2 }}</b></div>
          <div><span>{{ 'pos.shift.counted' | translate }}</span><b>{{ closed()!.data['counted'] | num: 2 }}</b></div>
          <div><span>{{ 'pos.shift.variance' | translate }}</span><b [class.neg]="closed()!.data['variance'] < 0">{{ closed()!.data['variance'] | num: 2 }}</b></div>
          <div *ngIf="closed()!.data['journal']"><span>{{ 'pos.shift.journal' | translate }}</span><b class="mono">{{ closed()!.data['journal'] }}</b></div>
        </div>
        <div class="modal-foot"><button class="primary" (click)="closed.set(null)">OK</button></div>
      </div>
    </div>
  `,
  styles: [`
    .cur { padding: 16px; margin-bottom: 20px; display: grid; gap: 14px; } .head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; } .head h3 { margin: 0; }
    .kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; } .kv div { display: grid; gap: 2px; } .kv small { color: var(--text-dim); } .kv b { font-size: 17px; }
    .btns { display: flex; gap: 8px; flex-wrap: wrap; } .h { margin: 0 0 10px; font-size: 14px; } .neg { color: var(--bad); } .pos { color: #b45309; } .full { grid-column: 1 / -1; }
    .kvl div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); }
  `]
})
export class PosShiftsComponent implements OnInit {
  auth = inject(AuthService); ctx = inject(ErpContextService); pos = inject(PosService); private i18n = inject(I18nService);
  history = signal<PosRec[]>([]); closed = signal<PosRec | null>(null);
  dlg: '' | 'in' | 'out' | 'close' = ''; amount: any = ''; note = ''; reg = ''; float: any = 0; msg = ''; error = '';

  constructor() {
    effect(() => {
      const c = this.ctx.company(), b = this.pos.branch();
      this.pos.loadCatalog(c, b).subscribe(() => {
        this.pos.currentShift().pipe(catchError(() => of(null))).subscribe();
        this.loadHistory();
      });
    });
  }
  ngOnInit() {}
  loadHistory() { this.pos.records('shift', { company: this.ctx.company(), branch: this.pos.hasBranches() ? this.ctx.branch() : null, take: 200 }).pipe(catchError(() => of([] as PosRec[]))).subscribe(l => this.history.set(l)); }
  flash(t: string) { this.msg = t; setTimeout(() => this.msg = '', 2500); }

  open() {
    this.error = '';
    this.pos.openShift({ company: this.ctx.company(), branch: this.pos.branch(), register: this.reg || undefined, openingCash: Number(this.float) || 0 })
      .subscribe({ next: () => { this.flash(this.i18n.t('pos.shift.opened')); this.loadHistory(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  cashOpen(t: 'in' | 'out') { this.dlg = t; this.amount = ''; this.note = ''; this.error = ''; }
  closeOpen() { this.dlg = 'close'; this.amount = ''; this.note = ''; this.error = ''; }
  submit() {
    const s = this.pos.shift(); if (!s) return;
    const n = Number(this.amount);
    if (this.dlg === 'close') {
      if (this.amount === '' || isNaN(n)) { this.error = this.i18n.t('hr.err.required'); return; }
      this.pos.closeShift(s.id, n, this.note).subscribe({ next: r => { this.dlg = ''; this.closed.set(r); this.loadHistory(); }, error: e => this.error = errMsg(e, this.i18n) });
    } else {
      if (!(n > 0)) { this.error = this.i18n.t('hr.err.required'); return; }
      this.pos.cashMove(s.id, this.dlg as 'in' | 'out', n, this.note).subscribe({ next: () => { this.dlg = ''; this.flash(this.i18n.t('hr.saved')); }, error: e => this.error = errMsg(e, this.i18n) });
    }
  }
}
