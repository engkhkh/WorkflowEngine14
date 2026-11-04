import { Component, OnDestroy, OnInit, effect, untracked } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { Subscription, interval } from 'rxjs';
import { ErpContextService } from './core/erp-context.service';
import { I18nService } from './core/i18n.service';
import { AuthService } from './core/auth.service';
import { ErpDataService } from './core/erp-data.service';
import { OrgService } from './core/org.service';
import { AppearanceService } from './core/appearance.service';
import { ApiStatusComponent } from './core/api/api-status.component';
import { ToastHostComponent } from './shared/toast-host.component';
import { MuslimService } from './muslim/muslim.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet, ApiStatusComponent, ToastHostComponent],
  template: `
    <ion-app>
      <app-api-status />
      <ion-router-outlet></ion-router-outlet>
      <app-toast-host />
    </ion-app>
  `
})
export class AppComponent implements OnInit, OnDestroy {
  private poll?: Subscription;
  // ErpContextService/I18nService are injected so theme + dir are applied on startup.
  constructor(private ctx: ErpContextService, private i18n: I18nService, private auth: AuthService, private data: ErpDataService,
              private org: OrgService, private look: AppearanceService, private muslim: MuslimService) {
    // each user gets their own saved design (Design studio) as soon as they are signed in
    effect(() => { if (this.auth.currentUser()) untracked(() => this.look.reloadForUser()); });
    // prayer reminders run while the app is open, for users who hold mus.view
    effect(() => { if (this.auth.can('mus.view') && this.auth.currentUser()) untracked(() => this.muslim.start()); else untracked(() => this.muslim.stop()); });
  }

  ngOnInit() {
    if (this.auth.isLoggedIn()) { this.org.load().subscribe(); this.auth.refreshMe().subscribe(); }
    // keep the Approvals badge fresh while the app is open
    this.poll = interval(30000).subscribe(() => { if (this.auth.isLoggedIn()) this.data.refreshTasks().subscribe(); });
  }
  ngOnDestroy() { this.poll?.unsubscribe(); }
}
