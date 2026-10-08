import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { trendingUpOutline, cartOutline, cubeOutline, walletOutline, peopleOutline, settingsOutline, sendOutline, chevronForward } from 'ionicons/icons';
import { TranslatePipe } from '../core/translate.pipe';
import { ErpDataService } from '../core/erp-data.service';
import { AuthService } from '../core/auth.service';
import { DOC_TYPES, MODULES, ModuleKey } from '../core/erp.config';
import { ION_ICON } from '../shared/mobile-widgets';


@Component({
  selector: 'app-new',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonIcon],
  template: `
    <ion-header><ion-toolbar><ion-title>{{ 'new.title' | translate }}</ion-title></ion-toolbar></ion-header>
    <ion-content>
      <p class="dim sub">{{ 'new.sub' | translate }}</p>

      <div class="section-title">{{ 'submit.erpDocs' | translate }}</div>
      <a class="tile" *ngFor="let dt of docTypes" [routerLink]="['/new', dt.key]">
        <span class="ic" [style.color]="color(dt.module)" [style.background]="color(dt.module) + '1f'"><ion-icon [name]="icon(dt.module)"></ion-icon></span>
        <span class="txt">
          <strong>{{ ('doc.' + dt.key) | translate }}</strong>
          <small>{{ ('doc.' + dt.key + '.desc') | translate }}</small>
        </span>
        <ion-icon class="chev" name="chevron-forward"></ion-icon>
      </a>

      <div class="section-title">{{ 'nav.services' | translate }}</div>
      <a class="tile" routerLink="/services">
        <span class="ic" style="color:#ec4899;background:#ec48991f"><ion-icon name="send-outline"></ion-icon></span>
        <span class="txt">
          <strong>{{ 'nav.services' | translate }}</strong>
          <small>{{ otherCount() }} {{ 'submit.workflows' | translate }} · {{ 'module.hr' | translate }}, {{ 'module.operations' | translate }}</small>
        </span>
        <ion-icon class="chev" name="chevron-forward"></ion-icon>
      </a>
    </ion-content>
  `,
  styles: [`
    .sub { margin: 4px 2px 0; font-size: 13px; }
    .tile { display: flex; align-items: center; gap: 12px; padding: 14px; margin-bottom: 10px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); color: var(--text); text-decoration: none; }
    .ic { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; font-size: 21px; flex-shrink: 0; }
    .txt { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .txt strong { font-size: 15px; }
    .txt small { font-size: 12px; color: var(--text-dim); line-height: 1.4; }
    .chev { color: var(--text-dim); }
    :host-context(html[dir="rtl"]) .chev { transform: scaleX(-1); }
  `]
})
export class NewPage {
  get docTypes() { return DOC_TYPES.filter(d => this.auth.can(d.module + '.create')); }
  otherCount = computed(() => {
    const erp = new Set(DOC_TYPES.map(d => d.workflowName));
    return this.data.definitions().filter(d => d.isPublished && !erp.has(d.name)).length;
  });
  constructor(private data: ErpDataService, private auth: AuthService) {
    addIcons({ trendingUpOutline, cartOutline, cubeOutline, walletOutline, peopleOutline, settingsOutline, sendOutline, chevronForward });
  }
  color(m: ModuleKey) { return MODULES.find(x => x.key === m)?.color ?? '#4338ca'; }
  icon(m: ModuleKey) { return ION_ICON[m]; }
}

