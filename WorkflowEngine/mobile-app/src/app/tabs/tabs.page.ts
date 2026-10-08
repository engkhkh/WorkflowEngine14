import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { homeOutline, checkmarkDoneOutline, add, documentTextOutline, ellipsisHorizontalCircleOutline } from 'ionicons/icons';
import { TranslatePipe } from '../core/translate.pipe';
import { ErpDataService } from '../core/erp-data.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [CommonModule, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge, TranslatePipe],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="home" href="/tabs/home">
          <ion-icon name="home-outline"></ion-icon>
          <ion-label>{{ 'tab.home' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="approvals" href="/tabs/approvals" [hidden]="!auth.can('tasks.act')">
          <ion-icon name="checkmark-done-outline"></ion-icon>
          <ion-label>{{ 'tab.approvals' | translate }}</ion-label>
          <ion-badge color="danger" *ngIf="data.tasks().length">{{ data.tasks().length }}</ion-badge>
        </ion-tab-button>
        <ion-tab-button tab="new" href="/tabs/new" class="fab-tab">
          <span class="fab"><ion-icon name="add"></ion-icon></span>
          <ion-label>{{ 'tab.new' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="documents" href="/tabs/documents">
          <ion-icon name="document-text-outline"></ion-icon>
          <ion-label>{{ 'tab.documents' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="more" href="/tabs/more">
          <ion-icon name="ellipsis-horizontal-circle-outline"></ion-icon>
          <ion-label>{{ 'tab.more' | translate }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    ion-tab-bar { --border: 1px solid var(--border); padding-top: 4px; }
    .fab { width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; color: #fff; margin-top: -6px;
      background: linear-gradient(135deg, #4338ca, #0ea5a4); box-shadow: 0 6px 16px rgba(67,56,202,.35); }
    .fab ion-icon { font-size: 24px; margin: 0; }
  `]
})
export class TabsPage implements OnInit {
  constructor(public data: ErpDataService, public auth: AuthService) {
    addIcons({ homeOutline, checkmarkDoneOutline, add, documentTextOutline, ellipsisHorizontalCircleOutline });
  }
  ngOnInit() { if (!this.data.loadedOnce()) this.data.refresh().subscribe(); }
}
