import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSegment, IonSegmentButton, IonLabel,
  IonRefresher, IonRefresherContent, IonFab, IonFabButton, IonIcon, IonSearchbar, ActionSheetController
} from '@ionic/angular/standalone';
import { ErpDataService } from '../core/erp-data.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { MoneyPipe } from '../core/money.pipe';
import { ErpDoc, ErpModule, MODULES, Outcome, definitionsFor } from '../core/erp';
import { registerErpIcons } from '../shared/icons';

@Component({
  selector: 'app-module',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TranslatePipe, MoneyPipe,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSegment, IonSegmentButton, IonLabel,
    IonRefresher, IonRefresherContent, IonFab, IonFabButton, IonIcon, IonSearchbar
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/modules"></ion-back-button></ion-buttons>
        <ion-title>{{ mod ? (('module.' + mod.key) | translate) : '' }}</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment [(ngModel)]="status" [scrollable]="true">
          <ion-segment-button *ngFor="let f of filters" [value]="f"><ion-label>{{ ('filter.' + f) | translate }}</ion-label></ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content *ngIf="mod as m">
      <ion-refresher slot="fixed" (ionRefresh)="load($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>

      <div class="head">
        <span class="m-ico" [style.--c]="m.color"><ion-icon [name]="m.ionIcon"></ion-icon></span>
        <div><p>{{ ('module.' + m.key + '.sub') | translate }}</p></div>
      </div>
      <div class="stats">
        <div class="erp-card"><span>{{ 'mod.total' | translate }}</span><b>{{ docs.length }}</b></div>
        <div class="erp-card"><span>{{ 'filter.pending' | translate }}</span><b class="amber">{{ count('pending') }}</b></div>
        <div class="erp-card"><span>{{ 'mod.value' | translate }}</span><b>{{ value | money:'':true }}</b></div>
      </div>

      <ion-searchbar [(ngModel)]="q" [placeholder]="'mod.search' | translate" class="search"></ion-searchbar>

      <div class="erp-card list">
        <a class="row" *ngFor="let d of shown" (click)="open(d)">
          <div class="r-main">
            <div class="r-top"><span class="docno">{{ d.docNo }}</span><small>{{ d.startedAt | date:'MMM d' }}</small></div>
            <div class="r-title">{{ d.party || d.title }}</div>
            <div class="r-meta">{{ d.item || d.title }}<span *ngIf="d.currentStep"> · {{ d.currentStep }}</span></div>
          </div>
          <div class="r-side">
            <span class="badge-pill" [class]="d.outcome"><i class="live-dot" *ngIf="d.outcome === 'pending'"></i>{{ (d.outcome === 'pending' ? 'stage.' + d.stage : 'filter.' + d.outcome) | translate }}</span>
            <b *ngIf="d.amount">{{ d.amount | money:d.currency }}</b>
          </div>
        </a>
        <p class="empty-state" *ngIf="shown.length === 0">{{ 'mod.none' | translate }}</p>
      </div>
      <div style="height: 80px"></div>

      <ion-fab slot="fixed" vertical="bottom" horizontal="end" *ngIf="processes.length">
        <ion-fab-button (click)="newDoc()"><ion-icon name="add-outline"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: [`
    .head { display: flex; align-items: center; gap: 12px; margin: 4px 0 12px; }
    .head p { margin: 0; color: var(--erp-dim); font-size: 13px; }
    .stats { display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 8px; }
    .stats div { padding: 10px 12px; display: flex; flex-direction: column; }
    .stats span { font-size: 11px; color: var(--erp-dim); }
    .stats b { font-size: 17px; }
    .amber { color: var(--erp-amber); }
    .search { padding: 10px 0 6px; --border-radius: 12px; --box-shadow: none; --background: #fff; }
    .list { overflow: hidden; }
    .row { display: flex; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--erp-border); color: var(--erp-text); cursor: pointer; }
    .row:last-child { border-bottom: none; }
    .r-main { flex: 1; min-width: 0; }
    .r-top { display: flex; gap: 8px; align-items: center; }
    .r-top small { color: var(--erp-faint); font-size: 11px; }
    .r-title { font-size: 14px; font-weight: 600; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .r-meta { font-size: 12px; color: var(--erp-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .r-side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    .r-side b { font-size: 13px; }
  `]
})
export class ModulePage implements OnInit {
  mod?: ErpModule;
  status: 'all' | Outcome = 'all';
  filters: ('all' | Outcome)[] = ['all', 'pending', 'approved', 'rejected', 'canceled'];
  q = '';

  constructor(private route: ActivatedRoute, private router: Router, public erp: ErpDataService,
              private i18n: I18nService, private sheet: ActionSheetController) { registerErpIcons(); }

  ngOnInit() {
    this.erp.ensureLoaded();
    this.route.paramMap.subscribe(p => {
      this.mod = MODULES.find(m => m.key === p.get('module'));
      if (!this.mod) this.router.navigate(['/tabs/modules']);
    });
  }

  get docs(): ErpDoc[] { return this.mod ? this.erp.docsFor(this.mod.key) : []; }
  get processes() { return this.mod ? definitionsFor(this.mod.key, this.erp.definitions()) : []; }
  get value() { return this.docs.filter(d => d.outcome === 'approved' || d.outcome === 'pending').reduce((s, d) => s + d.amountBase, 0); }
  count(o: Outcome) { return this.docs.filter(d => d.outcome === o).length; }
  get shown(): ErpDoc[] {
    const q = this.q.trim().toLowerCase();
    return this.docs.filter(d => (this.status === 'all' || d.outcome === this.status) &&
      (!q || [d.docNo, d.title, d.party, d.item, d.requester].some(v => v?.toLowerCase().includes(q))));
  }

  open(d: ErpDoc) { this.router.navigate(['/requests', d.id]); }
  load(event?: any) { this.erp.refresh().subscribe(() => event?.target?.complete()); }

  async newDoc() {
    const list = this.processes;
    if (list.length === 1) { this.router.navigate(['/submit'], { queryParams: { def: list[0].id } }); return; }
    const sheet = await this.sheet.create({
      header: this.i18n.t('mobile.chooseProcess'),
      buttons: [
        ...list.map(d => ({ text: d.name, handler: () => { this.router.navigate(['/submit'], { queryParams: { def: d.id } }); } })),
        { text: this.i18n.t('mobile.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }
}
