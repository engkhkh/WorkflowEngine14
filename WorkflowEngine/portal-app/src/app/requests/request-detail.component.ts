import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, interval, startWith, switchMap } from 'rxjs';
import { PortalApiService } from '../core/portal-api.service';
import { AuthService } from '../core/auth.service';
import { ErpDataService, ErpDoc } from '../core/erp-data.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { OrgService } from '../core/org.service';
import { IconComponent, LocalDatePipe, MoneyPipe, NumPipe, StatusComponent } from '../shared/ui';
import { StepperComponent } from '../shared/erp-widgets';

/** Data keys rendered in the document header/lines, so they aren't repeated under "Additional data". */
const SHOWN_KEYS = new Set(['docType', 'docNumber', 'module', 'company', 'branch', 'warehouse', 'toWarehouse', 'docDate', 'dueDate', 'party', 'currency',
  'costCenter', 'notes', 'lines', 'subtotal', 'discountPct', 'discountAmount', 'vatPct', 'vatAmount', 'total', 'requesterName', 'employeeName', 'vendor']);

@Component({
  selector: 'app-request-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, IconComponent, MoneyPipe, NumPipe, LocalDatePipe, StatusComponent, StepperComponent],
  template: `
    <div *ngIf="doc as d">
      <div class="crumb no-print"><a routerLink="/documents">{{ 'detail.back' | translate }}</a><span>/</span><span class="mono">{{ d.number }}</span></div>
      <div class="page-head">
        <div class="titles">
          <h1>
            {{ d.docType ? (('doc.' + d.docType.key) | translate) : d.title }}
            <span class="mono num-tag">{{ d.number }}</span>
          </h1>
          <p>
            <app-status [status]="d.status" [label]="('filter.' + d.status) | translate"></app-status>
            <span class="live" *ngIf="d.status === 'pending'">· {{ 'detail.waitingOn' | translate }}: <strong>{{ d.step }}</strong></span>
          </p>
        </div>
        <button class="no-print" (click)="print()"><app-icon name="printer" [size]="15"></app-icon>{{ 'detail.print' | translate }}</button>
        <button class="danger no-print" *ngIf="canCancel()" (click)="cancel()" [disabled]="canceling"><app-icon name="x" [size]="15"></app-icon>{{ 'detail.cancel' | translate }}</button>
      </div>

      <section class="card">
        <div class="card-head"><h3>{{ 'detail.process' | translate }}</h3><span class="live-tag" *ngIf="d.status === 'pending'"><i></i>{{ 'detail.live' | translate }}</span></div>
        <div class="card-body"><app-stepper [stages]="data.stagesFor(d)" [current]="d.stage" [status]="d.status" [step]="d.step"></app-stepper></div>
      </section>

      <div class="layout">
        <div class="main">
          <!-- ERP document body -->
          <section class="card" *ngIf="d.docType; else genericData">
            <div class="card-body hdr">
              <div><span class="k">{{ ('party.' + d.docType.partyKind) | translate }}</span><span class="v">{{ d.party }}</span></div>
              <div><span class="k">{{ 'form.date' | translate }}</span><span class="v">{{ data_('docDate') | ldate }}</span></div>
              <div><span class="k">{{ 'form.branch' | translate }}</span><span class="v">{{ branchName(d.branch) }}</span></div>
              <div><span class="k">{{ 'form.warehouse' | translate }}</span><span class="v">{{ d.warehouse || '—' }}<span *ngIf="data_('toWarehouse')"> → {{ data_('toWarehouse') }}</span></span></div>
              <div *ngIf="data_('dueDate')"><span class="k">{{ 'form.dueDate' | translate }}</span><span class="v">{{ data_('dueDate') | ldate }}</span></div>
              <div *ngIf="data_('costCenter')"><span class="k">{{ 'form.costCenter' | translate }}</span><span class="v">{{ data_('costCenter') }}</span></div>
              <div><span class="k">{{ 'col.by' | translate }}</span><span class="v">{{ data_('requesterName') || d.startedBy }}</span></div>
            </div>
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>#</th><th>{{ 'form.item' | translate }}</th><th>{{ 'form.description' | translate }}</th><th class="num">{{ 'form.qty' | translate }}</th><th>{{ 'form.unit' | translate }}</th><th class="num">{{ 'form.unitPrice' | translate }}</th><th class="num">{{ 'form.amount' | translate }}</th></tr></thead>
                <tbody>
                  <tr *ngFor="let l of d.lines; let i = index"><td class="dim">{{ i + 1 }}</td><td>{{ l.item }}</td><td class="dim">{{ l.description }}</td>
                    <td class="num">{{ l.qty | num:2 }}</td><td>{{ l.unit }}</td><td class="num">{{ l.unitPrice | money:d.currency }}</td><td class="num">{{ l.amount | money:d.currency }}</td></tr>
                </tbody>
              </table>
            </div>
            <div class="totals">
              <div><span>{{ 'form.subtotal' | translate }}</span><span>{{ num_('subtotal') | money:d.currency }}</span></div>
              <div *ngIf="num_('discountAmount')"><span>{{ 'form.discount' | translate }} ({{ num_('discountPct') }}%)</span><span>− {{ num_('discountAmount') | money:d.currency }}</span></div>
              <div *ngIf="num_('vatAmount')"><span>{{ 'form.vat' | translate }} ({{ num_('vatPct') }}%)</span><span>{{ num_('vatAmount') | money:d.currency }}</span></div>
              <div class="grand"><span>{{ 'form.total' | translate }}</span><span>{{ d.total | money:d.currency }}</span></div>
            </div>
            <div class="card-body notes" *ngIf="data_('notes')"><span class="k">{{ 'form.notes' | translate }}</span><p>{{ data_('notes') }}</p></div>
          </section>

          <ng-template #genericData>
            <section class="card">
              <div class="card-head"><h3>{{ d.title }}</h3></div>
              <table class="data kv"><tr *ngFor="let kv of extraData()"><td class="dim">{{ kv[0] }}</td><td>{{ kv[1] }}</td></tr></table>
            </section>
          </ng-template>

          <section class="card" *ngIf="d.docType && extraData().length">
            <div class="card-head"><h3>{{ 'detail.data' | translate }}</h3></div>
            <table class="data kv"><tr *ngFor="let kv of extraData()"><td class="dim">{{ kv[0] }}</td><td>{{ kv[1] }}</td></tr></table>
          </section>

          <section class="card" *ngIf="glEntries().length">
            <div class="card-head"><app-icon name="book" [size]="16"></app-icon><h3>{{ 'detail.gl' | translate }}</h3></div>
            <div class="card-body"><p class="gl mono" *ngFor="let g of glEntries()">{{ g }}</p></div>
          </section>
        </div>

        <aside class="card timeline">
          <div class="card-head"><h3>{{ 'detail.timeline' | translate }}</h3></div>
          <div class="card-body">
            <div class="entry" *ngFor="let h of d.instance.history">
              <div class="dot" [class]="dotClass(h.action)"></div>
              <div>
                <div class="entry-title">{{ h.nodeName }} <span class="act">{{ h.action }}</span></div>
                <div class="entry-meta">{{ h.timestamp | ldate:'datetime' }}<span *ngIf="h.actor"> · {{ h.actor }}</span></div>
                <div class="entry-comment" *ngIf="h.comment && h.action !== 'Logged'">"{{ h.comment }}"</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
    <div class="empty" *ngIf="!doc">{{ 'common.loading' | translate }}</div>
  `,
  styles: [`
    .num-tag { font-size: 13px; font-weight: 600; color: var(--primary); background: var(--primary-soft); padding: 3px 8px; border-radius: 6px; vertical-align: middle; margin-inline-start: 8px; }
    .page-head p { display: flex; align-items: center; gap: 8px; }
    .live { font-size: 13px; }
    section.card { margin-bottom: 18px; }
    .live-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: var(--ok); }
    .live-tag i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); animation: blink 1.2s ease-in-out infinite; }
    @keyframes blink { 50% { opacity: .3; } }
    .layout { display: grid; grid-template-columns: 1fr 360px; gap: 18px; align-items: start; }
    .main { min-width: 0; }
    .hdr { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px 20px; border-bottom: 1px solid var(--border); }
    .k { display: block; font-size: 11.5px; color: var(--text-dim); font-weight: 550; margin-bottom: 3px; }
    .v { font-size: 13.5px; font-weight: 600; }
    .totals { display: flex; flex-direction: column; gap: 6px; padding: 14px 18px; border-top: 1px solid var(--border); margin-inline-start: auto; width: min(340px, 100%); font-variant-numeric: tabular-nums; font-size: 13px; }
    .totals > div { display: flex; justify-content: space-between; }
    .grand { font-size: 16px; font-weight: 700; border-top: 1px dashed var(--border-strong); padding-top: 8px; }
    .notes { border-top: 1px solid var(--border); }
    .notes p { margin: 0; white-space: pre-wrap; font-size: 13px; }
    .kv td { padding: 9px 18px; }
    .gl { margin: 0 0 8px; padding: 10px 12px; background: var(--surface-2); border-radius: 8px; color: var(--text-2); direction: ltr; text-align: start; line-height: 1.5; }
    .timeline { position: sticky; top: 78px; max-height: calc(100vh - 100px); overflow-y: auto; }
    .entry { display: flex; gap: 10px; margin-bottom: 14px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--info); margin-top: 5px; flex-shrink: 0; box-shadow: 0 0 0 3px var(--info-soft); }
    .dot.good { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
    .dot.bad { background: var(--bad); box-shadow: 0 0 0 3px var(--bad-soft); }
    .dot.sys { background: var(--muted); box-shadow: 0 0 0 3px var(--muted-soft); }
    .entry-title { font-size: 13px; font-weight: 600; }
    .act { font-weight: 500; color: var(--text-dim); font-size: 12px; margin-inline-start: 4px; }
    .entry-meta { font-size: 11.5px; color: var(--text-dim); }
    .entry-comment { font-size: 12.5px; color: var(--text-2); font-style: italic; margin-top: 2px; }
    @media (max-width: 1050px) { .layout { grid-template-columns: 1fr; } .timeline { position: static; max-height: none; } }
  `]
})
export class RequestDetailComponent implements OnInit, OnDestroy {
  doc: ErpDoc | null = null;
  canceling = false;
  private sub?: Subscription;

  constructor(private route: ActivatedRoute, private api: PortalApiService, private auth: AuthService,
              public data: ErpDataService, private i18n: I18nService, private org: OrgService) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.sub = interval(3000).pipe(startWith(0), switchMap(() => this.api.getInstance(id)))
      .subscribe(i => {
        this.doc = this.data.toDoc(i);
        if (i.status !== 'Running') this.sub?.unsubscribe();
      });
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  data_(key: string): any { return this.doc?.instance.data?.[key]; }
  num_(key: string): number { return +(this.doc?.instance.data?.[key] ?? 0) || 0; }

  branchName(code?: string) {
    const b = this.org.branch(code);
    return b ? this.i18n.nm(b) : (code || '—');
  }

  extraData(): [string, any][] {
    const data = this.doc?.instance.data ?? {};
    return Object.entries(data)
      .filter(([k, v]) => !SHOWN_KEYS.has(k) && v !== null && v !== '' && typeof v !== 'object')
      .map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()), v === true ? '✓' : v]);
  }

  glEntries(): string[] {
    return (this.doc?.instance.history ?? []).filter(h => h.action === 'Logged' && h.comment).map(h => h.comment!);
  }

  dotClass(action: string) {
    if (/reject|cancel|return|out of stock/i.test(action)) return 'bad';
    if (/^(entered|logged|joined|forked)$/i.test(action)) return 'sys';
    return 'good';
  }

  canCancel(): boolean {
    const u = this.auth.currentUser();
    return !!this.doc && this.doc.status === 'pending' && (this.doc.startedBy === u?.username || u?.role === 'admin');
  }

  print() { window.print(); }

  cancel() {
    if (!this.doc || !confirm(this.i18n.t('detail.cancelConfirm'))) return;
    this.canceling = true;
    this.api.cancelInstance(this.doc.id).subscribe({
      next: updated => { this.doc = this.data.toDoc(updated); this.canceling = false; this.data.refresh().subscribe(); },
      error: () => { this.canceling = false; }
    });
  }
}
