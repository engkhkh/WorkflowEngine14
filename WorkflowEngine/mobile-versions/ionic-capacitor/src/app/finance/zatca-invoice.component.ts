import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { GovService, ZatcaInvoice } from '../core/gov.service';
import { I18nService } from '../core/i18n.service';
import { FinRec } from '../core/fin.models';
import { TranslatePipe } from '../core/translate.pipe';
import { qrSvg } from '../shared/qr-svg';
import { errMsg } from './fin-util';

/** The ZATCA e-invoice of one customer invoice: issue it (UUID, counter, hash chain, XML, QR) and show / print the QR code. */
@Component({
  selector: 'app-zatca-invoice',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="modal-scrim" (click)="closed.emit(changed)">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'gov.zatca.title' | translate }} · {{ invoice.code }}</h3></div>
        <div class="modal-body">
          <p class="flash bad" *ngIf="error">{{ error }}</p>
          <p class="dim" *ngIf="busy">…</p>
          <ng-container *ngIf="z() as d">
            <div *ngIf="!d.issued && !busy">
              <p>{{ 'gov.zatca.notIssued' | translate }}</p>
              <p class="dim">{{ 'gov.zatca.phaseNote' | translate }}</p>
            </div>
            <div class="grid" *ngIf="d.issued">
              <div class="qr" [innerHTML]="qr()"></div>
              <div class="info">
                <div><span class="k">{{ 'gov.zatca.type' | translate }}</span> {{ d.type }}</div>
                <div><span class="k">{{ 'gov.zatca.icv' | translate }}</span> {{ d.icv }}</div>
                <div><span class="k">UUID</span> <span class="mono">{{ d.uuid }}</span></div>
                <div><span class="k">{{ 'gov.zatca.hash' | translate }}</span> <span class="mono wrap">{{ d.hash }}</span></div>
                <div><span class="k">{{ 'gov.zatca.pih' | translate }}</span> <span class="mono wrap">{{ d.pih }}</span></div>
                <div><span class="k">{{ 'gov.zatca.issued' | translate }}</span> {{ d.issuedAt | date:'medium' }} · {{ d.issuedBy }}</div>
                <p class="dim">{{ (d.signed ? 'gov.zatca.signed' : 'gov.zatca.unsigned') | translate }}</p>
              </div>
            </div>
          </ng-container>
        </div>
        <div class="modal-foot">
          <button (click)="closed.emit(changed)">{{ 'hr.imp.close' | translate }}</button>
          <button class="ghost" *ngIf="z()?.issued" (click)="xml()">XML</button>
          <button class="ghost" *ngIf="z()?.issued" (click)="print()">{{ 'common.print' | translate }}</button>
          <button class="primary" *ngIf="z() && !z()!.issued && canIssue" (click)="issue()" [disabled]="busy">{{ 'gov.zatca.issue' | translate }}</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .grid { display: grid; grid-template-columns: 190px 1fr; gap: 18px; align-items: start; } .qr { width: 190px; background: #fff; padding: 6px; border-radius: 8px; border: 1px solid var(--border); }
    .info { display: grid; gap: 6px; font-size: 13px; min-width: 0; } .k { color: var(--text-dim); margin-inline-end: 6px; } .wrap { word-break: break-all; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  `]
})
export class ZatcaInvoiceComponent implements OnInit {
  @Input({ required: true }) invoice!: FinRec;
  @Input() canIssue = false;
  @Output() closed = new EventEmitter<boolean>();
  private gov = inject(GovService); private i18n = inject(I18nService); private san = inject(DomSanitizer);
  z = signal<ZatcaInvoice | null>(null); busy = true; error = ''; changed = false;

  ngOnInit() { this.gov.invoice(this.invoice.id).subscribe({ next: d => { this.z.set(d); this.busy = false; }, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); } }); }
  issue() {
    this.busy = true; this.error = '';
    this.gov.issue(this.invoice.id).subscribe({ next: d => { this.z.set(d); this.busy = false; this.changed = true; }, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); } });
  }
  qr(): SafeHtml { const q = this.z()?.qr; return q ? this.san.bypassSecurityTrustHtml(qrSvg(q)) : ''; }
  xml() {
    const x = this.z()?.xml; if (!x) return;
    const url = URL.createObjectURL(new Blob([x], { type: 'application/xml' }));
    const a = document.createElement('a'); a.href = url; a.download = `${this.invoice.code}.xml`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  print() {
    const q = this.z()?.qr; if (!q) return;
    const w = window.open('', '_blank', 'width=420,height=520'); if (!w) return;
    w.document.write(`<html><head><title>${this.invoice.code}</title><style>body{font:14px system-ui;text-align:center;padding:24px}svg{width:240px;height:240px}</style></head><body><h3>${this.invoice.code}</h3>${qrSvg(q)}<p>${this.z()?.uuid ?? ''}</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  }
}
