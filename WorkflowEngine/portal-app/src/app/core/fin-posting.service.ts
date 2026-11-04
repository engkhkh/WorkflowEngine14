import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { FinService } from './fin.service';
import { FinRec, JournalLine } from './fin.models';
import { invoiceTotal, round2 } from './fin.calc';

/**
 * Turns finance documents into general-ledger drafts: supplier invoice -> Dr expense / Dr VAT input / Cr payables,
 * payment -> Dr payables / Cr bank, customer invoice -> Dr receivables / Cr revenue / Cr VAT output, receipt -> Dr bank / Cr receivables.
 * The journals are created as DRAFTS so the normal approval (finance.gl.approve) still applies before anything is posted.
 * Account numbers come from Setup > Default accounts.
 */
@Injectable({ providedIn: 'root' })
export class FinPostingService {
  private fin = inject(FinService);

  private journal(company: string | null | undefined, date: string, memo: string, ref: string, d: any, lines: JournalLine[]): Observable<FinRec> {
    const rate = Number(d?.rate) > 0 ? Number(d.rate) : 1;
    return this.fin.create('journal', {
      company: company ?? undefined, status: 'Draft',
      data: { date, memo, reference: ref, currency: d?.currency ?? '', rate, lines: lines.filter(l => l.debit || l.credit) }
    });
  }
  private need(...codes: (string | undefined)[]): string | null { return codes.every(Boolean) ? null : 'fin.needDefaults'; }

  apInvoice(inv: FinRec): Observable<FinRec> {
    const df = this.fin.defaults(); const d = inv.data;
    const exp = d['account'] || df.expenseAccount;
    if (this.need(df.apAccount, exp)) return throwError(() => new Error('fin.needDefaults'));
    const total = round2(invoiceTotal(d)), tax = round2(Number(d['taxAmount']) || 0), net = round2(total - tax);
    const vat = !!(tax && df.vatInput);      // without a VAT account the tax stays inside the expense line
    const lines: JournalLine[] = [
      { account: exp, debit: vat ? net : total, credit: 0, costCenter: d['costCenter'] ?? '', project: d['project'] ?? '', memo: d['vendor'] },
      ...(vat ? [{ account: df.vatInput!, debit: tax, credit: 0, memo: 'VAT' } as JournalLine] : []),
      { account: df.apAccount!, debit: 0, credit: total, memo: d['vendor'] },
    ];
    return this.journal(inv.company, String(d['date']).slice(0, 10), `${d['vendor']} · ${d['invoiceNo']}`, inv.code ?? '', d, lines);
  }

  apPayment(inv: FinRec, bank: string, date: string): Observable<FinRec> {
    const df = this.fin.defaults(); const d = inv.data;
    const bankGl = this.bankGl(bank);
    if (this.need(df.apAccount, bankGl)) return throwError(() => new Error('fin.needDefaults'));
    const total = round2(invoiceTotal(d));
    return this.journal(inv.company, date, `Payment ${d['vendor']} · ${d['invoiceNo']}`, inv.code ?? '', d, [
      { account: df.apAccount!, debit: total, credit: 0, memo: d['vendor'] }, { account: bankGl!, debit: 0, credit: total, memo: d['vendor'] }]);
  }

  arInvoice(inv: FinRec): Observable<FinRec> {
    const df = this.fin.defaults(); const d = inv.data;
    const rev = d['account'] || df.revenueAccount;
    if (this.need(df.arAccount, rev)) return throwError(() => new Error('fin.needDefaults'));
    const total = round2(invoiceTotal(d)), tax = round2(Number(d['taxAmount']) || 0), net = round2(total - tax);
    const lines: JournalLine[] = [
      { account: df.arAccount!, debit: total, credit: 0, memo: d['customer'] },
      { account: rev, debit: 0, credit: tax && df.vatOutput ? net : total, costCenter: d['costCenter'] ?? '', project: d['project'] ?? '', memo: d['customer'] },
      ...(tax && df.vatOutput ? [{ account: df.vatOutput, debit: 0, credit: tax, memo: 'VAT' } as JournalLine] : []),
    ];
    return this.journal(inv.company, String(d['date']).slice(0, 10), `${d['customer']} · ${inv.code}`, inv.code ?? '', d, lines);
  }

  arReceipt(inv: FinRec, bank: string, date: string, amount: number): Observable<FinRec> {
    const df = this.fin.defaults(); const d = inv.data;
    const bankGl = this.bankGl(bank);
    if (this.need(df.arAccount, bankGl)) return throwError(() => new Error('fin.needDefaults'));
    return this.journal(inv.company, date, `Receipt ${d['customer']} · ${inv.code}`, inv.code ?? '', d, [
      { account: bankGl!, debit: round2(amount), credit: 0, memo: d['customer'] }, { account: df.arAccount!, debit: 0, credit: round2(amount), memo: d['customer'] }]);
  }

  /** the GL account a bank account is linked to (falls back to the default bank account) */
  private bankGl(bankCode: string): string | undefined {
    const b = this.fin.ref('bankaccount').find(x => x.code === bankCode);
    return (b?.data?.['glAccount'] as string) || this.fin.defaults().bankAccount;
  }

  /** run `then` after the journal draft was created; when the user may not create journals, just continue */
  safely<T>(obs: Observable<T>, canGl: boolean, fallback: T): Observable<T> { return canGl ? obs : of(fallback); }
}
