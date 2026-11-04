import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { PortalApiService } from '../core/portal-api.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe } from '../shared/ui';
import { BillingSummary, Invoice } from '../core/models';

/** Subscription: price per user, the monthly invoices of this workspace and online payment (Visa / mada through the provider's hosted page). */
@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent, LocalDatePipe],
  template: `
    <div class="flash" [class.bad]="bad" *ngIf="msg">{{ msg }}</div>
    <div class="cards" *ngIf="sum() as s">
      <div class="card kpi"><span class="dim">{{ 'bill.users' | translate }}</span><strong>{{ s.users }}</strong></div>
      <div class="card kpi"><span class="dim">{{ 'bill.rate' | translate }}</span><strong>\${{ s.unitPrice }}</strong><small class="dim">{{ 'bill.perUserMonth' | translate }}</small></div>
      <div class="card kpi"><span class="dim">{{ 'bill.estimate' | translate }}</span><strong>\${{ s.estimate | number:'1.2-2' }}</strong><small class="dim">{{ 'bill.next' | translate }} {{ s.nextInvoice | ldate }}</small></div>
      <div class="card kpi" [class.warnbox]="s.balance > 0"><span class="dim">{{ 'bill.balance' | translate }}</span><strong>\${{ s.balance | number:'1.2-2' }}</strong><small class="dim">{{ s.openInvoices }} {{ 'bill.open' | translate }}</small></div>
    </div>
    <p class="dim note" *ngIf="sum() as s">{{ 'bill.pricing' | translate: { p: s.pricePerUser, v: s.volumePrice, n: s.volumeFrom } }}</p>

    <div class="card" *ngIf="sum()?.lines?.length">
      <div class="card-head"><h3>{{ 'bill.byBranch' | translate }}</h3></div>
      <table class="data"><tbody>
        <tr *ngFor="let l of sum()!.lines"><td>{{ l.branchName }}</td><td class="num">{{ l.users }} {{ 'bill.usersShort' | translate }}</td><td class="num">\${{ l.amount | number:'1.2-2' }}</td></tr>
      </tbody></table>
    </div>

    <div class="card">
      <div class="card-head"><h3>{{ 'bill.invoices' | translate }}</h3></div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>{{ 'bill.number' | translate }}</th><th>{{ 'bill.period' | translate }}</th><th>{{ 'bill.usersShort' | translate }}</th><th>{{ 'bill.total' | translate }}</th><th>{{ 'bill.due' | translate }}</th><th>{{ 'admin.status' | translate }}</th><th></th></tr></thead>
          <tbody>
            <tr *ngFor="let i of invoices()">
              <td class="mono">{{ i.number }}</td><td>{{ i.period }}</td><td>{{ i.users }} × \${{ i.unitPrice }}</td>
              <td><strong>\${{ i.total | number:'1.2-2' }}</strong><div class="dim" style="font-size:11px">≈ {{ i.totalSar | number:'1.2-2' }} SAR</div></td>
              <td>{{ i.dueAt | ldate }}</td>
              <td><span class="chip" [class.warn]="i.overdue">{{ (i.status === 'paid' ? 'bill.paid' : (i.overdue ? 'bill.overdue' : 'bill.unpaid')) | translate }}</span>
                <div class="dim" style="font-size:11px" *ngIf="i.method">{{ i.method }}</div></td>
              <td class="act">
                <button class="ghost sm" (click)="print(i)" [title]="'bill.print' | translate"><app-icon name="printer" [size]="15"></app-icon></button>
                <button class="primary sm" *ngIf="i.status === 'open'" (click)="pay(i)" [disabled]="busy"><app-icon name="credit-card" [size]="14"></app-icon>{{ 'bill.pay' | translate }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="empty" *ngIf="!invoices().length">{{ 'common.noData' | translate }}</div>
    </div>

    <div class="modal-scrim" *ngIf="test" (click)="test = null">
      <div class="modal" style="max-width:460px" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'bill.testMode' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'bill.testHint' | translate }}</p><p><strong>{{ test.number }} · \${{ test.total | number:'1.2-2' }}</strong></p></div>
        <div class="modal-foot"><button (click)="test = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="sandbox()">{{ 'bill.markPaid' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 10px; }
    .kpi { padding: 14px; display: flex; flex-direction: column; gap: 2px; } .kpi strong { font-size: 24px; }
    .warnbox { border-color: #f59e0b; } .note { margin: 6px 2px 14px; font-size: 12.5px; } .card { margin-bottom: 14px; } .num { text-align: end; }
  `]
})
export class AdminBillingComponent implements OnInit {
  sum = signal<BillingSummary | null>(null);
  invoices = signal<Invoice[]>([]);
  msg = ''; bad = false; busy = false; test: Invoice | null = null;
  constructor(private api: PortalApiService, private i18n: I18nService, private route: ActivatedRoute) {}

  ngOnInit() {
    const back = this.route.snapshot.queryParamMap.get('invoice');
    if (back) {                                    // returned from the payment page: ask the server (which asks the provider)
      this.api.billingConfirm(back).subscribe({
        next: i => { this.flash(this.i18n.t(i.status === 'paid' ? 'bill.thanks' : 'bill.notPaid'), i.status !== 'paid'); this.load(); },
        error: () => this.load()
      });
    } else this.load();
  }
  load() {
    this.api.billingSummary().subscribe(s => this.sum.set(s));
    this.api.billingInvoices().subscribe(l => this.invoices.set(l));
  }
  private flash(m: string, bad = false) { this.msg = m; this.bad = bad; setTimeout(() => this.msg = '', 6000); }

  pay(i: Invoice) {
    this.busy = true;
    this.api.billingPay(i.id, `${location.origin}/admin?tab=billing`).subscribe({
      next: r => { this.busy = false; if (r.url) location.href = r.url; else this.test = i; },
      error: e => { this.busy = false; this.flash(typeof e.error === 'string' && e.error ? e.error : this.i18n.t('common.error'), true); }
    });
  }
  sandbox() {
    if (!this.test) return;
    this.api.billingSandboxPay(this.test.id).subscribe({ next: () => { this.test = null; this.flash(this.i18n.t('bill.thanks')); this.load(); }, error: () => this.test = null });
  }

  print(i: Invoice) {
    const w = window.open('', '_blank'); if (!w) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    const rows = i.lines.map(l => `<tr><td>${esc(l.branchName)}</td><td>${l.users}</td><td>$${i.unitPrice.toFixed(2)}</td><td>$${l.amount.toFixed(2)}</td></tr>`).join('');
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(i.number)}</title><style>body{font:14px system-ui;margin:40px;color:#111}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}h1{margin:0}.r{text-align:end}</style>
      <h1>${esc(i.number)}</h1><p>${esc(i.companyName)}${i.taxNo ? ' · ' + esc(i.taxNo) : ''}<br>${esc(i.period)} · ${new Date(i.issuedAt).toLocaleDateString()}</p>
      <table><tr><th>Branch</th><th>Users</th><th>Price</th><th>Amount</th></tr>${rows}<tr><th colspan="3" class="r">Total (USD)</th><th>$${i.total.toFixed(2)}</th></tr></table>
      <p>≈ ${i.totalSar.toFixed(2)} SAR (rate ${i.sarPerUsd}) · ${i.status.toUpperCase()}${i.method ? ' · ' + esc(i.method) : ''}</p>`);
    w.document.close(); w.focus(); w.print();
  }
}
