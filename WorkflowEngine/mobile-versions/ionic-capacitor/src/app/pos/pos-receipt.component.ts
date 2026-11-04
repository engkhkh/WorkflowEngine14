import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PosRec } from '../core/pos.models';
import { PosService } from '../core/pos.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { OrgService } from '../core/org.service';
import { TranslatePipe } from '../core/translate.pipe';
import { LocalDatePipe, NumPipe } from '../shared/ui';

/** A till receipt (80 mm). Print it with printReceipt(). */
@Component({
  selector: 'app-pos-receipt',
  standalone: true,
  imports: [CommonModule, TranslatePipe, NumPipe, LocalDatePipe],
  template: `
    <div class="rc pos-receipt-print" *ngIf="sale as s">
      <div class="c b">{{ i18n.nm(company()) }}</div>
      <div class="c" *ngIf="branchName()">{{ branchName() }}</div>
      <div class="c" *ngIf="pos.settings().receiptHeader">{{ pos.settings().receiptHeader }}</div>
      <hr />
      <div class="r"><span>{{ s.data['type'] === 'Return' ? ('pos.rc.return' | translate) : ('pos.rc.receipt' | translate) }}</span><span class="mono">{{ s.code }}</span></div>
      <div class="r" *ngIf="s.parent"><span>{{ 'pos.rc.original' | translate }}</span><span class="mono">{{ s.parent }}</span></div>
      <div class="r"><span>{{ s.createdAt || s.data['date'] | ldate: 'datetime' }}</span><span>{{ s.data['cashier'] }}</span></div>
      <div class="r" *ngIf="s.data['customerName']"><span>{{ 'pos.customer' | translate }}</span><span>{{ s.data['customerName'] }}</span></div>
      <hr />
      <div class="ln" *ngFor="let l of s.data['lines']">
        <div class="r"><span>{{ l.name }}</span><span>{{ l.total | num: 2 }}</span></div>
        <div class="d">{{ l.qty }} × {{ l.price | num: 2 }}<span *ngIf="l.discount"> · −{{ l.discount | num: 2 }}</span></div>
      </div>
      <hr />
      <div class="r" *ngIf="s.data['subtotal']"><span>{{ 'pos.subtotal' | translate }}</span><span>{{ s.data['subtotal'] | num: 2 }}</span></div>
      <div class="r" *ngIf="s.data['discount']"><span>{{ 'pos.discount' | translate }}</span><span>−{{ s.data['discount'] | num: 2 }}</span></div>
      <div class="r"><span>{{ 'pos.tax' | translate }}</span><span>{{ s.data['tax'] | num: 2 }}</span></div>
      <div class="r b big"><span>{{ 'pos.total' | translate }}</span><span>{{ s.data['total'] | num: 2 }} {{ company().currency }}</span></div>
      <ng-container *ngIf="s.data['payments']">
        <div class="r" *ngFor="let p of s.data['payments']"><span>{{ 'pos.pay.' + p.method | translate }}</span><span>{{ p.amount | num: 2 }}</span></div>
        <div class="r" *ngIf="s.data['change']"><span>{{ 'pos.change' | translate }}</span><span>{{ s.data['change'] | num: 2 }}</span></div>
      </ng-container>
      <div class="r" *ngIf="s.data['earned']"><span>{{ 'pos.pointsEarned' | translate }}</span><span>{{ s.data['earned'] }}</span></div>
      <hr />
      <div class="c" *ngIf="pos.settings().receiptFooter">{{ pos.settings().receiptFooter }}</div>
      <div class="c d">{{ 'pos.rc.thanks' | translate }}</div>
    </div>
  `,
  styles: [`
    .rc { width: 300px; max-width: 100%; margin: 0 auto; padding: 14px; background: #fff; color: #111; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; border: 1px dashed #bbb; border-radius: 6px; }
    .c { text-align: center; } .b { font-weight: 700; } .big { font-size: 15px; margin-top: 4px; } .d { color: #555; font-size: 11.5px; }
    .r { display: flex; justify-content: space-between; gap: 10px; } hr { border: 0; border-top: 1px dashed #999; margin: 8px 0; } .ln { margin-bottom: 4px; }
  `]
})
export class PosReceiptComponent {
  @Input() sale: PosRec | null = null;
  pos = inject(PosService); i18n = inject(I18nService); private ctx = inject(ErpContextService); private org = inject(OrgService);
  company = () => this.org.companies().find(c => c.code === (this.sale?.company || this.ctx.company())) ?? this.ctx.companyObj();
  branchName = () => { const b = this.org.branch(this.sale?.branch ?? ''); return b ? this.i18n.nm(b) : ''; };
}

/** Prints whatever <app-pos-receipt> is on screen (everything else is hidden by the print rules in styles.scss). */
export function printReceipt() {
  document.body.classList.add('pos-printing');
  const done = () => { document.body.classList.remove('pos-printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
