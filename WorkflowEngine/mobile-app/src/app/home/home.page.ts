import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonContent, IonButtons, IonButton, IonIcon, IonRefresher, IonRefresherContent, IonList, IonItem
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  sparkles, trendingUpOutline, cartOutline, walletOutline, bookOutline, checkboxOutline, timeOutline, add, businessOutline, sendOutline
} from 'ionicons/icons';
import { ErpDataService, ErpDoc } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { AuthService } from '../core/auth.service';
import { AssistantService } from '../core/assistant.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { DOC_TYPES, MODULES, StageKey } from '../core/erp.config';
import { MoneyPipe, NumPipe } from '../shared/ui';
import { MDocRowComponent, MFlowComponent, MKpiComponent } from '../shared/mobile-widgets';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, MoneyPipe, NumPipe, MKpiComponent, MFlowComponent, MDocRowComponent,
    IonHeader, IonToolbar, IonContent, IonButtons, IonButton, IonIcon, IonRefresher, IonRefresherContent, IonList, IonItem],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar class="hero-bar">
        <div class="hero-top">
          <div class="logo">W</div>
          <div class="ctx" routerLink="/tabs/more">
            <ion-icon name="business-outline"></ion-icon>
            <span>{{ i18n.nm(ctx.companyObj()) }}</span>
            <span class="dim2">· {{ ctx.branchObj() ? i18n.nm(ctx.branchObj()) : ('top.allBranches' | translate) }}</span>
          </div>
        </div>
        <ion-buttons slot="end">
          <ion-button routerLink="/assistant" class="ai"><ion-icon name="sparkles"></ion-icon></ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="reload($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>

      <div class="hero">
        <h1>{{ 'dash.hello' | translate }}, {{ firstName() }}</h1>
        <p>{{ 'dash.sub' | translate }}</p>
        <button class="queue-cta" routerLink="/tabs/approvals">
          <ion-icon name="checkbox-outline"></ion-icon>
          <span><strong>{{ k().myApprovals }}</strong> {{ 'kpi.myApprovals' | translate }}</span>
        </button>
      </div>

      <div class="kpis">
        <m-kpi [label]="'kpi.sales' | translate" [value]="k().salesMonth | money:cur():true" icon="trending-up-outline" color="#0ea5e9" [hint]="('kpi.pipeline' | translate) + ' ' + (k().pipeline | money:cur():true)"></m-kpi>
        <m-kpi [label]="'kpi.purchases' | translate" [value]="k().purchasesMonth | money:cur():true" icon="cart-outline" color="#8b5cf6" [hint]="('kpi.committed' | translate) + ' ' + (k().committed | money:cur():true)"></m-kpi>
        <m-kpi [label]="'kpi.receivables' | translate" [value]="k().receivables | money:cur():true" icon="wallet-outline" color="#10b981"></m-kpi>
        <m-kpi [label]="'kpi.payables' | translate" [value]="k().payables | money:cur():true" icon="book-outline" color="#f59e0b"></m-kpi>
        <m-kpi [label]="'kpi.openDocs' | translate" [value]="k().openDocs" icon="checkbox-outline" color="#ef4444" [hint]="('kpi.rejectRate' | translate) + ' ' + ((k().rejectRate * 100) | num) + '%'"></m-kpi>
        <m-kpi [label]="'kpi.cycle' | translate" [value]="(k().avgCycleDays | num:1) + ' ' + ('kpi.days' | translate)" icon="time-outline" color="#64748b"></m-kpi>
      </div>

      <div class="section-title">{{ 'dash.flow' | translate }}</div>
      <m-flow [counts]="stageCounts()" [active]="stage()" [currency]="cur()" (pick)="stage.set(stage() === $event ? null : $event)"></m-flow>
      <ion-list class="boxed" *ngIf="stage()">
        <ion-item *ngFor="let d of stageDocs()" button detail="false" (click)="open(d)" lines="full"><m-doc-row [doc]="d" style="width:100%"></m-doc-row></ion-item>
        <div class="empty-state" *ngIf="!stageDocs().length">{{ 'docs.none' | translate }}</div>
      </ion-list>

      <div class="insight" routerLink="/assistant">
        <div class="ins-head"><ion-icon name="sparkles"></ion-icon>{{ 'dash.insight' | translate }}</div>
        <p>{{ insight() }}</p>
      </div>

      <div class="section-title">{{ 'dash.quick' | translate }}</div>
      <div class="quick">
        <button *ngFor="let dt of docTypes" [routerLink]="['/new', dt.key]">
          <span class="qi" [style.color]="color(dt.module)" [style.background]="color(dt.module) + '1f'"><ion-icon name="add"></ion-icon></span>
          <span>{{ ('doc.' + dt.key) | translate }}</span>
        </button>
        <button routerLink="/services">
          <span class="qi" style="color:#ec4899;background:#ec48991f"><ion-icon name="send-outline"></ion-icon></span>
          <span>{{ 'nav.services' | translate }}</span>
        </button>
      </div>

      <div class="section-title">{{ 'dash.recent' | translate }} <a routerLink="/tabs/documents">{{ 'dash.viewAll' | translate }}</a></div>
      <ion-list class="boxed">
        <ion-item *ngFor="let d of data.docs().slice(0, 6)" button detail="false" (click)="open(d)" lines="full"><m-doc-row [doc]="d" style="width:100%"></m-doc-row></ion-item>
        <div class="empty-state" *ngIf="!data.docs().length">{{ 'common.noData' | translate }}</div>
      </ion-list>
    </ion-content>
  `,
  styles: [`
    .hero-bar { --background: linear-gradient(135deg, var(--hero-1), var(--hero-2)); --color: #fff; padding: 4px 6px; }
    .hero-top { display: flex; align-items: center; gap: 10px; padding-inline-start: 12px; }
    .logo { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; font-weight: 800; color: #fff; background: linear-gradient(135deg, #6366f1, #8b5cf6 50%, #0ea5a4); }
    .ctx { display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; color: #fff; }
    .dim2 { opacity: .7; font-weight: 500; }
    .ai { --color: #fff; }
    .hero { margin: -12px -16px 14px; padding: 16px 18px 20px; background: linear-gradient(135deg, var(--hero-1), var(--hero-2)); color: #fff; border-radius: 0 0 22px 22px; }
    .hero h1 { margin: 0; font-size: 21px; font-weight: 700; }
    .hero p { margin: 4px 0 14px; font-size: 12.5px; opacity: .75; }
    .queue-cta { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); color: #fff; font-family: inherit; font-size: 13.5px; text-align: start; }
    .queue-cta ion-icon { font-size: 20px; }
    .queue-cta strong { font-size: 17px; margin-inline-end: 4px; }
    .kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .insight { margin-top: 16px; padding: 14px; border-radius: 14px; background: var(--primary-soft); border: 1px solid var(--border); }
    .ins-head { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; color: var(--primary); }
    .insight p { margin: 6px 0 0; font-size: 13px; line-height: 1.55; color: var(--text-2); }
    .quick { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .quick button { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 6px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-family: inherit; font-size: 11.5px; font-weight: 600; text-align: center; }
    .qi { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 19px; }
    ion-item { --padding-start: 0; --inner-padding-end: 0; }
  `]
})
export class HomePage {
  get docTypes() { return DOC_TYPES.filter(d => this.auth.can(d.module + '.create')); }
  stage = signal<StageKey | null>(null);
  k = computed(() => this.data.kpis());
  cur = computed(() => this.ctx.companyObj().currency);
  stageCounts = computed(() => this.data.stageCounts());
  insight = computed(() => { this.data.docs(); this.i18n.lang(); return this.ai.summary(); });
  stageDocs = computed<ErpDoc[]>(() => {
    const s = this.stage();
    if (!s) return [];
    if (s === 'request') { const n = new Date(); return this.data.docs().filter(d => d.date.getMonth() === n.getMonth() && d.date.getFullYear() === n.getFullYear()).slice(0, 8); }
    if (s === 'reporting') return this.data.docs().filter(d => d.status === 'approved').slice(0, 8);
    return this.data.docs().filter(d => d.status === 'pending' && d.stage === s).slice(0, 8);
  });

  constructor(public data: ErpDataService, public ctx: ErpContextService, private auth: AuthService,
              private ai: AssistantService, public i18n: I18nService, private router: Router) {
    addIcons({ sparkles, trendingUpOutline, cartOutline, walletOutline, bookOutline, checkboxOutline, timeOutline, add, businessOutline, sendOutline });
  }

  ionViewWillEnter() { this.data.refresh().subscribe(); }
  reload(ev: any) { this.data.refresh().subscribe(() => ev?.target?.complete()); }

  firstName() { return (this.auth.currentUser()?.displayName ?? '').split(' ')[0]; }
  color(m: string) { return MODULES.find(x => x.key === m)?.color ?? '#4338ca'; }
  open(d: ErpDoc) { this.router.navigate(['/documents', d.id]); }
}
