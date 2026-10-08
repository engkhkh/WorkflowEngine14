import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonIcon, IonSelect, IonSelectOption, IonToggle, IonListHeader
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  businessOutline, gitBranchOutline, globeOutline, moonOutline, barChartOutline, sparklesOutline, sendOutline, logOutOutline,
  trendingUpOutline, cartOutline, cubeOutline, walletOutline, peopleOutline, settingsOutline, colorPaletteOutline, shieldCheckmarkOutline
} from 'ionicons/icons';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { ErpContextService } from '../core/erp-context.service';
import { ErpDataService } from '../core/erp-data.service';
import { AssistantService } from '../core/assistant.service';
import { TranslatePipe } from '../core/translate.pipe';
import { OrgService } from '../core/org.service';
import { LangSelectComponent } from '../shared/lang-select.component';

@Component({
  selector: 'app-more',
  standalone: true,
  imports: [CommonModule, TranslatePipe, LangSelectComponent, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonIcon,
    IonSelect, IonSelectOption, IonToggle, IonListHeader],
  template: `
    <ion-header><ion-toolbar><ion-title>{{ 'more.title' | translate }}</ion-title></ion-toolbar></ion-header>
    <ion-content>
      <div class="me" *ngIf="auth.currentUser() as u">
        <span class="av">{{ initials(u.displayName) }}</span>
        <div><strong>{{ u.displayName }}</strong><small>{{ u.username }} · {{ u.role }}</small></div>
      </div>

      <ion-list class="boxed" lines="full">
        <ion-list-header>{{ 'more.workspace' | translate }}</ion-list-header>
        <ion-item button detail="true" *ngIf="auth.can('reports.view')" (click)="go('/reports')"><ion-icon name="bar-chart-outline" slot="start"></ion-icon><ion-label>{{ 'nav.reports' | translate }}</ion-label></ion-item>
        <ion-item button detail="true" *ngIf="auth.can('assistant.use')" (click)="go('/assistant')"><ion-icon name="sparkles-outline" slot="start"></ion-icon><ion-label>{{ 'nav.assistant' | translate }}</ion-label></ion-item>
        <ion-item button detail="true" (click)="go('/services')"><ion-icon name="send-outline" slot="start"></ion-icon><ion-label>{{ 'nav.services' | translate }}</ion-label></ion-item>
      </ion-list>

      <ion-list class="boxed" lines="full" *ngIf="auth.canAny('admin.users', 'org.manage')">
        <ion-list-header>{{ 'nav.administration' | translate }}</ion-list-header>
        <ion-item button detail="true" (click)="go('/admin')"><ion-icon name="shield-checkmark-outline" slot="start"></ion-icon><ion-label>{{ 'nav.admin' | translate }}</ion-label></ion-item>
      </ion-list>

      <ion-list class="boxed" lines="full">
        <ion-list-header>{{ 'more.settings' | translate }}</ion-list-header>
        <ion-item>
          <ion-icon name="business-outline" slot="start"></ion-icon>
          <ion-select [label]="'top.company' | translate" interface="action-sheet" [value]="ctx.company()" (ionChange)="ctx.setCompany($any($event).detail.value); data.refresh().subscribe()">
            <ion-select-option *ngFor="let c of org.companies()" [value]="c.code">{{ i18n.nm(c) }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-icon name="git-branch-outline" slot="start"></ion-icon>
          <ion-select [label]="'top.branch' | translate" interface="action-sheet" [value]="ctx.branch()" (ionChange)="ctx.branch.set($any($event).detail.value)">
            <ion-select-option value="ALL">{{ 'top.allBranches' | translate }}</ion-select-option>
            <ion-select-option *ngFor="let b of ctx.branches()" [value]="b.code">{{ i18n.nm(b) }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-icon name="globe-outline" slot="start"></ion-icon>
          <app-lang-select [label]="'more.language' | translate"></app-lang-select>
        </ion-item>
        <ion-item>
          <ion-icon name="moon-outline" slot="start"></ion-icon>
          <ion-toggle [checked]="ctx.theme() === 'dark'" (ionChange)="ctx.toggleTheme()">{{ 'more.dark' | translate }}</ion-toggle>
        </ion-item>
        <ion-item button detail="true" (click)="go('/appearance')"><ion-icon name="color-palette-outline" slot="start"></ion-icon><ion-label>{{ 'appear.title' | translate }}</ion-label></ion-item>
      </ion-list>

      <ion-list class="boxed" lines="none">
        <ion-item button detail="false" (click)="logout()"><ion-icon name="log-out-outline" slot="start" color="danger"></ion-icon><ion-label color="danger">{{ 'nav.signout' | translate }}</ion-label></ion-item>
      </ion-list>
    </ion-content>
  `,
  styles: [`
    .me { display: flex; gap: 12px; align-items: center; padding: 6px 4px 16px; }
    .av { width: 48px; height: 48px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-weight: 700; }
    .me strong { display: block; font-size: 16px; }
    .me small { color: var(--text-dim); font-size: 12.5px; }
    ion-list-header { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); min-height: 34px; }
    ion-icon[slot="start"] { color: var(--primary); margin-inline-end: 14px; }
  `]
})
export class MorePage {
  constructor(public auth: AuthService, public i18n: I18nService, public ctx: ErpContextService, public data: ErpDataService,
              private ai: AssistantService, private router: Router, public org: OrgService) {
    addIcons({ businessOutline, gitBranchOutline, globeOutline, moonOutline, barChartOutline, sparklesOutline, sendOutline, logOutOutline,
      trendingUpOutline, cartOutline, cubeOutline, walletOutline, peopleOutline, settingsOutline, colorPaletteOutline, shieldCheckmarkOutline });
  }
  initials(n: string) { return n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase(); }
  go(path: string) { this.router.navigate([path]); }
  logout() {
    this.auth.logout();
    this.data.loadedOnce.set(false);
    this.data.instances.set([]);
    this.data.tasks.set([]);
    this.ai.messages.set([]);
    this.org.reset();
    this.router.navigate(['/login'], { replaceUrl: true });
  }
}
