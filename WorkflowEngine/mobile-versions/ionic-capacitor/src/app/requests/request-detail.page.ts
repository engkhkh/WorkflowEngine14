import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription, interval, startWith, switchMap } from 'rxjs';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, AlertController
} from '@ionic/angular/standalone';
import { PortalApiService } from '../core/portal-api.service';
import { AuthService } from '../core/auth.service';
import { ErpDataService, ErpDoc } from '../core/erp-data.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { OrgService } from '../core/org.service';
import { LocalDatePipe, MoneyPipe, NumPipe } from '../shared/ui';
import { MStepperComponent } from '../shared/mobile-widgets';

const SHOWN_KEYS = new Set(['docType', 'docNumber', 'module', 'company', 'branch', 'warehouse', 'toWarehouse', 'docDate', 'dueDate', 'party', 'currency',
  'costCenter', 'notes', 'lines', 'subtotal', 'discountPct', 'discountAmount', 'vatPct', 'vatAmount', 'total', 'requesterName', 'employeeName', 'vendor']);

@Component({
  selector: 'app-request-detail',
  standalone: true,
  imports: [CommonModule, TranslatePipe, MoneyPipe, NumPipe, LocalDatePipe, MStepperComponent,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/documents"></ion-back-button></ion-buttons>
        <ion-title>{{ doc?.number }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content *ngIf="doc as d">
      <div class="head">
        <div>
          <h2>{{ d.docType ? (('doc.' + d.docType.key) | translate) : d.title }}</h2>
          <div class="dim">{{ d.party }}</div>
        </div>
        <span class="badge-pill" [class]="d.status">{{ ('filter.' + d.status) | translate }}</span>
      </div>
      <div class="total-card" *ngIf="d.total !== null">
        <small>{{ 'form.total' | translate }}</small>
        <strong>{{ d.total | money:d.currency }}</strong>
        <span *ngIf="d.status === 'pending'" class="waiting"><i></i>{{ 'detail.waitingOn' | translate }}: {{ d.step }}</span>
      </div>

      <div class="section-title">{{ 'detail.process' | translate }}</div>
      <div class="box"><m-stepper [stages]="data.stagesFor(d)" [current]="d.stage" [status]="d.status" [step]="d.step"></m-stepper></div>

      <ng-container *ngIf="d.docType">
        <div class="section-title">{{ 'form.header' | translate }}</div>
        <div class="box kv">
          <div><span>{{ 'form.date' | translate }}</span><b>{{ val('docDate') | ldate }}</b></div>
          <div><span>{{ 'form.branch' | translate }}</span><b>{{ branchName(d.branch) }}</b></div>
          <div><span>{{ 'form.warehouse' | translate }}</span><b>{{ d.warehouse }}<ng-container *ngIf="val('toWarehouse')"> → {{ val('toWarehouse') }}</ng-container></b></div>
          <div><span>{{ 'col.by' | translate }}</span><b>{{ val('requesterName') || d.startedBy }}</b></div>
        </div>

        <div class="section-title">{{ 'form.lines' | translate }}</div>
        <div class="box lines">
          <div class="ln" *ngFor="let l of d.lines">
            <div><b>{{ l.item }}</b><small class="dim">{{ l.qty | num:2 }} {{ l.unit }} × {{ l.unitPrice | money:d.currency }}</small></div>
            <span class="num">{{ l.amount | money:d.currency }}</span>
          </div>
          <div class="tot">
            <div><span>{{ 'form.subtotal' | translate }}</span><span>{{ num_('subtotal') | money:d.currency }}</span></div>
            <div *ngIf="num_('discountAmount')"><span>{{ 'form.discount' | translate }}</span><span>− {{ num_('discountAmount') | money:d.currency }}</span></div>
            <div *ngIf="num_('vatAmount')"><span>{{ 'form.vat' | translate }} ({{ num_('vatPct') }}%)</span><span>{{ num_('vatAmount') | money:d.currency }}</span></div>
            <div class="grand"><span>{{ 'form.total' | translate }}</span><span>{{ d.total | money:d.currency }}</span></div>
          </div>
        </div>
        <div class="box notes" *ngIf="val('notes')">{{ val('notes') }}</div>
      </ng-container>

      <ng-container *ngIf="extra().length">
        <div class="section-title">{{ 'detail.data' | translate }}</div>
        <div class="box kv"><div *ngFor="let kv of extra()"><span>{{ kv[0] }}</span><b>{{ kv[1] }}</b></div></div>
      </ng-container>

      <ng-container *ngIf="gl().length">
        <div class="section-title">{{ 'detail.gl' | translate }}</div>
        <div class="box gl mono" *ngFor="let g of gl()">{{ g }}</div>
      </ng-container>

      <div class="section-title">{{ 'detail.timeline' | translate }}</div>
      <div class="box">
        <div class="entry" *ngFor="let h of d.instance.history">
          <i class="dot" [class]="dotClass(h.action)"></i>
          <div>
            <div class="et">{{ h.nodeName }} <span class="dim">· {{ h.action }}</span></div>
            <div class="em dim">{{ h.timestamp | ldate:'datetime' }}<span *ngIf="h.actor"> · {{ h.actor }}</span></div>
            <div class="ec" *ngIf="h.comment && h.action !== 'Logged'">"{{ h.comment }}"</div>
          </div>
        </div>
      </div>

      <ion-button *ngIf="canCancel()" expand="block" color="danger" fill="outline" [disabled]="canceling" (click)="cancel()" class="cancel">
        {{ 'detail.cancel' | translate }}
      </ion-button>
    </ion-content>
  `,
  styles: [`
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .head h2 { margin: 0; font-size: 19px; font-weight: 700; }
    .total-card { margin-top: 12px; padding: 14px; border-radius: 14px; background: linear-gradient(135deg, var(--hero-1), var(--hero-2)); color: #fff; display: flex; flex-direction: column; gap: 2px; }
    .total-card small { opacity: .7; font-size: 12px; }
    .total-card strong { font-size: 24px; }
    .waiting { font-size: 12.5px; opacity: .9; display: flex; align-items: center; gap: 6px; margin-top: 4px; }
    .waiting i { width: 7px; height: 7px; border-radius: 50%; background: #34d399; animation: blink 1.2s infinite; }
    @keyframes blink { 50% { opacity: .3; } }
    .box { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; margin-bottom: 4px; }
    .kv > div { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
    .kv > div:last-child { border-bottom: none; }
    .kv span { color: var(--text-dim); }
    .kv b { text-align: end; font-weight: 600; }
    .lines { padding: 4px 14px; }
    .ln { display: flex; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .ln > div { display: flex; flex-direction: column; }
    .ln small { font-size: 11.5px; }
    .tot { padding: 8px 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .tot > div { display: flex; justify-content: space-between; }
    .grand { font-weight: 700; font-size: 15px; border-top: 1px dashed var(--border-strong); padding-top: 6px; }
    .notes { font-size: 13px; white-space: pre-wrap; margin-top: 8px; }
    .gl { font-size: 11.5px; color: var(--text-2); direction: ltr; text-align: start; line-height: 1.5; }
    .entry { display: flex; gap: 10px; padding: 6px 0; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--info); margin-top: 5px; flex-shrink: 0; }
    .dot.good { background: var(--ok); } .dot.bad { background: var(--bad); } .dot.sys { background: var(--muted); }
    .et { font-size: 13px; font-weight: 600; }
    .em { font-size: 11.5px; }
    .ec { font-size: 12.5px; font-style: italic; color: var(--text-2); }
    .cancel { margin-top: 18px; }
  `]
})
export class RequestDetailPage implements OnInit, OnDestroy {
  doc: ErpDoc | null = null;
  canceling = false;
  private sub?: Subscription;

  constructor(private route: ActivatedRoute, private api: PortalApiService, private auth: AuthService,
              public data: ErpDataService, public i18n: I18nService, private alert: AlertController, private org: OrgService) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.sub = interval(3000).pipe(startWith(0), switchMap(() => this.api.getInstance(id)))
      .subscribe(i => {
        this.doc = this.data.toDoc(i);
        if (i.status !== 'Running') this.sub?.unsubscribe();
      });
  }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  val(k: string): any { return this.doc?.instance.data?.[k]; }
  num_(k: string): number { return +(this.doc?.instance.data?.[k] ?? 0) || 0; }
  branchName(code?: string) { const b = this.org.branch(code); return b ? this.i18n.nm(b) : (code || '—'); }

  extra(): [string, any][] {
    const data = this.doc?.instance.data ?? {};
    return Object.entries(data).filter(([k, v]) => !SHOWN_KEYS.has(k) && v !== null && v !== '' && typeof v !== 'object')
      .map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()), v === true ? '✓' : v]);
  }
  gl(): string[] { return (this.doc?.instance.history ?? []).filter(h => h.action === 'Logged' && h.comment).map(h => h.comment!); }

  dotClass(action: string) {
    if (/reject|cancel|return|out of stock/i.test(action)) return 'bad';
    if (/^(entered|logged|joined|forked)$/i.test(action)) return 'sys';
    return 'good';
  }

  canCancel(): boolean {
    const u = this.auth.currentUser();
    return !!this.doc && this.doc.status === 'pending' && (this.doc.startedBy === u?.username || u?.role === 'admin');
  }

  async cancel() {
    if (!this.doc) return;
    const a = await this.alert.create({
      message: this.i18n.t('detail.cancelConfirm'),
      buttons: [{ text: this.i18n.t('common.close'), role: 'cancel' }, { text: this.i18n.t('detail.cancel'), role: 'destructive', handler: () => this.doCancel() }]
    });
    await a.present();
  }

  private doCancel() {
    if (!this.doc) return;
    this.canceling = true;
    this.api.cancelInstance(this.doc.id).subscribe({
      next: updated => { this.doc = this.data.toDoc(updated); this.canceling = false; this.data.refresh().subscribe(); },
      error: () => { this.canceling = false; }
    });
  }
}
