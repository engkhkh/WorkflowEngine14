import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinService } from '../core/fin.service';
import { FinAuditRow } from '../core/fin.models';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { LocalDatePipe } from '../shared/ui';
import { errMsg } from './fin-util';

/** Who did what to a finance record, and when - shown as a dialog from any record and as the Audit page. */
@Component({
  selector: 'app-fin-history',
  standalone: true,
  imports: [CommonModule, TranslatePipe, LocalDatePipe],
  template: `
    <div class="modal-scrim" (click)="closed.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'fin.audit.history' | translate }} · {{ title }}</h3></div>
        <div class="modal-body">
          <p class="flash bad" *ngIf="error">{{ error }}</p>
          <div class="ev" *ngFor="let a of rows()">
            <div class="when mono">{{ a.at | ldate:'datetime' }}</div>
            <div><strong>{{ a.userName }}</strong> · {{ actionLabel(a.action) }}<div class="dim sum">{{ a.summary }}</div></div>
          </div>
          <p class="dim" *ngIf="!rows().length && !error">{{ 'common.noData' | translate }}</p>
        </div>
        <div class="modal-foot"><button (click)="closed.emit()">{{ 'hr.imp.close' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .ev { display: grid; grid-template-columns: 170px 1fr; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .ev:last-child { border-bottom: none; } .when { color: var(--text-dim); } .sum { margin-top: 2px; word-break: break-word; }
  `]
})
export class FinHistoryComponent implements OnInit {
  @Input({ required: true }) kind!: string;
  @Input({ required: true }) recordId!: string;
  @Input() title = '';
  @Output() closed = new EventEmitter<void>();
  private fin = inject(FinService); private i18n = inject(I18nService);
  rows = signal<FinAuditRow[]>([]); error = '';
  ngOnInit() { this.fin.audit(this.kind, this.recordId).subscribe({ next: l => this.rows.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  actionLabel(a: string) { const k = 'fin.audit.a.' + a; const t = this.i18n.t(k); return t === k ? a : t; }
}

/** The whole audit trail (needs finance.audit.view). */
@Component({
  selector: 'app-fin-audit',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, LocalDatePipe],
  template: `
    <p class="dim lead">{{ 'fin.audit.hint' | translate }}</p>
    <div class="bar">
      <select [ngModel]="kind()" (ngModelChange)="kind.set($event); load()">
        <option value="">{{ 'fin.audit.allKinds' | translate }}</option>
        <option *ngFor="let k of kinds" [value]="k">{{ 'fin.kind.' + k | translate }}</option>
      </select>
      <input class="search" [placeholder]="'common.search' | translate" [ngModel]="q()" (ngModelChange)="q.set($event)" />
    </div>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'fin.audit.when' | translate }}</th><th>{{ 'fin.audit.who' | translate }}</th><th>{{ 'fin.audit.what' | translate }}</th><th>{{ 'fin.audit.record' | translate }}</th><th>{{ 'fin.audit.details' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let a of shown()">
        <td class="mono nw">{{ a.at | ldate:'datetime' }}</td><td>{{ a.userName }}</td><td>{{ actionLabel(a.action) }}</td>
        <td><span class="dim">{{ 'fin.kind.' + a.kind | translate }}</span> <span class="mono">{{ a.code }}</span></td><td class="det">{{ a.summary }}</td></tr></tbody>
    </table><div class="empty" *ngIf="!shown().length">{{ 'common.noData' | translate }}</div></div></div>
  `,
  styles: [`.bar { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; } .bar select { width: auto; } .search { max-width: 260px; } .lead { margin: 0 0 12px; font-size: 13px; } .nw { white-space: nowrap; } .det { max-width: 520px; word-break: break-word; color: var(--text-2); }`]
})
export class FinAuditComponent implements OnInit {
  private fin = inject(FinService); private i18n = inject(I18nService);
  kinds = ['journal', 'apinvoice', 'arinvoice', 'period', 'account', 'bankaccount', 'banktxn', 'budget', 'asset', 'project', 'vendor', 'customer', 'setting'];
  all = signal<FinAuditRow[]>([]); kind = signal(''); q = signal(''); error = '';
  shown = () => { const q = this.q().toLowerCase(); return this.all().filter(a => !q || `${a.userName} ${a.code} ${a.summary} ${a.action}`.toLowerCase().includes(q)); };
  ngOnInit() { this.load(); }
  load() { this.fin.audit(this.kind() || undefined).subscribe({ next: l => this.all.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  actionLabel(a: string) { const k = 'fin.audit.a.' + a; const t = this.i18n.t(k); return t === k ? a : t; }
}
