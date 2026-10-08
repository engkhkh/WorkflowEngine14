import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonIcon } from '@ionic/angular/standalone';
import { ErpDataService } from '../core/erp-data.service';
import { TranslatePipe } from '../core/translate.pipe';
import { MoneyPipe } from '../core/money.pipe';
import { MODULES, moduleOf } from '../core/erp';
import { registerErpIcons } from '../shared/icons';

@Component({
  selector: 'app-modules',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, MoneyPipe, IonHeader, IonToolbar, IonTitle, IonContent, IonIcon],
  template: `
    <ion-header><ion-toolbar><ion-title>{{ 'shell.modules' | translate }}</ion-title></ion-toolbar></ion-header>
    <ion-content>
      <div class="grid">
        <a class="erp-card mod" *ngFor="let m of modules" [routerLink]="['/m', m.key]">
          <span class="m-ico" [style.--c]="m.color"><ion-icon [name]="m.ionIcon"></ion-icon></span>
          <b>{{ ('module.' + m.key) | translate }}</b>
          <small>{{ erp.kpis().byModule[m.key].count }} {{ 'dash.docs' | translate }} · {{ erp.kpis().byModule[m.key].open }} {{ 'dash.open' | translate }}</small>
          <span class="val">{{ erp.kpis().byModule[m.key].amount | money:'':true }}</span>
        </a>
      </div>

      <div class="section-title">{{ 'submit.title' | translate }}</div>
      <div class="erp-card list">
        <a class="row" *ngFor="let d of processes" routerLink="/submit" [queryParams]="{ def: d.id }">
          <span class="dot" [style.background]="colorOf(d.name)"></span>
          <div class="r-main"><b>{{ d.name }}</b><small>{{ ('module.' + modOf(d.name)) | translate }}</small></div>
          <ion-icon name="add-outline"></ion-icon>
        </a>
        <p class="empty-state" *ngIf="processes.length === 0">{{ 'submit.noWorkflows' | translate }}</p>
      </div>
    </ion-content>
  `,
  styles: [`
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .mod { padding: 14px; display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: var(--erp-text); }
    .mod b { font-size: 14px; margin-top: 6px; }
    .mod small { font-size: 11.5px; color: var(--erp-dim); }
    .val { font-size: 13px; font-weight: 700; }
    .list { overflow: hidden; }
    .row { display: flex; align-items: center; gap: 10px; padding: 13px 14px; border-bottom: 1px solid var(--erp-border); text-decoration: none; color: var(--erp-text); }
    .row:last-child { border-bottom: none; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .r-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .r-main b { font-size: 13.5px; }
    .r-main small { font-size: 11.5px; color: var(--erp-dim); }
    .row ion-icon { color: var(--erp-accent); font-size: 20px; }
  `]
})
export class ModulesPage {
  modules = MODULES;
  constructor(public erp: ErpDataService) { registerErpIcons(); }
  get processes() { return this.erp.definitions().filter(d => d.isPublished).sort((a, b) => MODULES.findIndex(m => m.key === moduleOf(a.name)) - MODULES.findIndex(m => m.key === moduleOf(b.name))); }
  modOf(name: string) { return moduleOf(name); }
  colorOf(name: string) { return MODULES.find(m => m.key === moduleOf(name))!.color; }
}
