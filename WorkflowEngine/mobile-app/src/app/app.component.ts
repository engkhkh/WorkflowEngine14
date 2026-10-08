import { Component, OnDestroy, OnInit, effect, untracked } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { Subscription, interval } from 'rxjs';
import { ErpContextService } from './core/erp-context.service';
import { I18nService } from './core/i18n.service';
import { AuthService } from './core/auth.service';
import { ErpDataService } from './core/erp-data.service';
import { OrgService } from './core/org.service';
import { AppearanceService } from './core/appearance.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  template: `
    <ion-app>
      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `
})
export class AppComponent implements OnInit, OnDestroy {
  private poll?: Subscription;
  // ErpContextService/I18nService are injected so theme + dir are applied on startup.
  constructor(private ctx: ErpContextService, private i18n: I18nService, private auth: AuthService, private data: ErpDataService,
              private org: OrgService, private look: AppearanceService) {
    // each user gets their own saved design (Design studio) as soon as they are signed in
    effect(() => { if (this.auth.currentUser()) untracked(() => this.look.reloadForUser()); });
  }

  ngOnInit() {
    if (this.auth.isLoggedIn()) { this.org.load().subscribe(); this.auth.refreshMe().subscribe(); }
    // keep the Approvals badge fresh while the app is open
    this.poll = interval(30000).subscribe(() => { if (this.auth.isLoggedIn()) this.data.refreshTasks().subscribe(); });
  }
  ngOnDestroy() { this.poll?.unsubscribe(); }
}
