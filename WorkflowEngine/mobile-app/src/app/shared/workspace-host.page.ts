import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { TranslatePipe } from '../core/translate.pipe';
import { ERP_MODULES, ErpModule } from '../core/erp.models';

const TITLES: Record<string, string> = { hr: 'module.hr', finance: 'module.finance', pos: 'module.pos' };

/** Ionic frame for a portal workspace (HR / Finance / POS / ERP modules): back button, title, and the workspace's own tab bar + pages inside. */
@Component({
  selector: 'app-workspace-host',
  standalone: true,
  imports: [CommonModule, RouterOutlet, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more" [text]="''"></ion-back-button></ion-buttons>
        <ion-title>{{ titleKey() | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content [scrollY]="true">
      <div class="erp-root"><router-outlet /></div>
    </ion-content>
  `
})
export class WorkspaceHostPage {
  private router = inject(Router);
  titleKey() {
    const seg = '/' + this.router.url.split('?')[0].split('/')[1];
    const mod = Object.values(ERP_MODULES).find(m => m.route === seg);
    return mod ? mod.titleKey : TITLES[seg.slice(1)] ?? 'more.title';
  }
}
