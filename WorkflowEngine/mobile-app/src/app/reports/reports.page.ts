import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton } from '@ionic/angular/standalone';
import { ErpDataService } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { MODULES } from '../core/erp.config';
import { MoneyPipe, NumPipe } from '../shared/ui';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, TranslatePipe, MoneyPipe, NumPipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more"></ion-back-button></ion-buttons>
        <ion-title>{{ 'rep.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <p class="dim sub">{{ 'rep.sub' | translate }}</p>

      <div class="section-title">{{ 'rep.byModule' | translate }}</div>
      <div class="mod" *ngFor="let r of byModule()">
        <div class="mh"><i [style.background]="r.color"></i><strong>{{ r.label }}</strong><span class="num">{{ r.value | money:cur():true }}</span></div>
        <div class="stats">
          <span>{{ r.count }} <small>{{ 'col.count' | translate }}</small></span>
          <span>{{ r.pending }} <small>{{ 'filter.pending' | translate }}</small></span>
          <span class="ok">{{ r.approved }} <small>{{ 'filter.approved' | translate }}</small></span>
          <span class="bad">{{ r.rejected }} <small>{{ 'filter.rejected' | translate }}</small></span>
        </div>
      </div>
      <p class="empty-state" *ngIf="!byModule().length">{{ 'common.noData' | translate }}</p>

      <div class="section-title">{{ 'rep.bottleneck' | translate }}</div>
      <div class="bars">
        <div class="bar" *ngFor="let b of bottleneck()">
          <span class="n">{{ b.label }}</span>
          <span class="track"><span class="fill" [style.width.%]="b.pct"></span></span>
          <b>{{ b.value }}</b>
        </div>
        <p class="empty-state" *ngIf="!bottleneck().length">—</p>
      </div>

      <div class="section-title">{{ 'rep.turnaround' | translate }}</div>
      <div class="bars">
        <div class="bar" *ngFor="let t of turnaround()">
          <span class="n">{{ t.step }}</span>
          <span class="track"><span class="fill" [style.width.%]="t.pct" [style.background]="t.avgHours > 24 ? 'var(--bad)' : t.avgHours > 8 ? 'var(--warn)' : 'var(--ok)'"></span></span>
          <b>{{ t.avgHours | num:1 }}{{ 'rep.hours' | translate }}</b>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .sub { font-size: 12.5px; margin: 4px 2px; }
    .mod { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; }
    .mh { display: flex; align-items: center; gap: 8px; }
    .mh i { width: 8px; height: 8px; border-radius: 50%; }
    .mh strong { flex: 1; font-size: 14px; }
    .mh .num { font-weight: 700; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; font-weight: 700; font-size: 15px; }
    .stats small { display: block; font-size: 10.5px; font-weight: 500; color: var(--text-dim); }
    .ok { color: var(--ok); } .bad { color: var(--bad); }
    .bars { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 8px 14px; }
    .bar { display: grid; grid-template-columns: 42% 1fr auto; gap: 8px; align-items: center; padding: 6px 0; font-size: 12.5px; }
    .n { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .track { height: 7px; background: var(--surface-3); border-radius: 9px; overflow: hidden; }
    .fill { display: block; height: 100%; background: var(--primary); border-radius: 9px; }
  `]
})
export class ReportsPage {
  cur = computed(() => this.ctx.companyObj().currency);
  byModule = computed(() => {
    this.i18n.lang();
    return MODULES.map(m => {
      const docs = this.data.docs().filter(d => d.module === m.key);
      return {
        label: this.i18n.t('module.' + m.key), color: m.color, count: docs.length,
        value: docs.filter(d => d.status !== 'canceled' && d.status !== 'rejected').reduce((s, d) => s + (d.total ?? 0), 0),
        pending: docs.filter(d => d.status === 'pending').length,
        approved: docs.filter(d => d.status === 'approved').length,
        rejected: docs.filter(d => d.status === 'rejected').length,
      };
    }).filter(r => r.count);
  });
  bottleneck = computed(() => {
    const m = new Map<string, number>();
    this.data.docs().filter(d => d.status === 'pending').forEach(d => m.set(d.step, (m.get(d.step) ?? 0) + 1));
    const max = Math.max(1, ...m.values());
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, pct: value / max * 100 }));
  });
  turnaround = computed(() => {
    this.data.docs();
    const list = this.data.stepTurnaround().slice(0, 8);
    const max = Math.max(1, ...list.map(t => t.avgHours));
    return list.map(t => ({ ...t, pct: t.avgHours / max * 100 }));
  });

  constructor(public data: ErpDataService, private ctx: ErpContextService, private i18n: I18nService) {}
  ionViewWillEnter() { this.data.refresh().subscribe(); }
}
