import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { I18nService } from './core/i18n/i18n.service';
import { TranslatePipe } from './core/i18n/translate.pipe';
import { AppearanceService } from './core/appearance.service';
import { OrgService } from './core/org.service';
import { LangPickerComponent } from './shared/lang-picker.component';
import { AppearancePanelComponent } from './shared/appearance-panel.component';
import { IconComponent } from './shared/ui';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, LangPickerComponent, AppearancePanelComponent, IconComponent],
  template: `
    <div class="shell" *ngIf="auth.currentUser() as user; else bare">
      <aside class="sidebar">
        <div class="brand">⚡ {{ 'brand.name' | translate }}</div>
        <div class="ws" *ngIf="user.tenantName">{{ user.tenantName }}</div>
        <nav>
          <a routerLink="/tasks" routerLinkActive="active">{{ 'nav.tasks' | translate }}</a>
          <a routerLink="/definitions" routerLinkActive="active">{{ 'nav.workflows' | translate }}</a>
          <a routerLink="/designer" routerLinkActive="active">{{ 'nav.newFlow' | translate }}</a>
          <a routerLink="/instances" routerLinkActive="active">{{ 'nav.instances' | translate }}</a>
          <a routerLink="/origins" routerLinkActive="active">{{ 'nav.origins' | translate }}</a>
          <ng-container *ngIf="auth.canAny('admin.users', 'org.manage')">
            <div class="nav-title">{{ 'nav.administration' | translate }}</div>
            <a routerLink="/admin" routerLinkActive="active"><app-icon name="shield" [size]="15"></app-icon> {{ 'nav.admin' | translate }}</a>
          </ng-container>
        </nav>
        <div class="user-box">
          <div class="tools">
            <app-lang-picker></app-lang-picker>
            <button class="ghost" (click)="look.open.set(true)" [title]="'top.appearance' | translate"><app-icon name="palette" [size]="16"></app-icon></button>
          </div>
          <div class="user-name">{{ user.displayName }}</div>
          <div class="user-role">{{ user.role }}</div>
          <button (click)="logout()">{{ 'nav.signOut' | translate }}</button>
        </div>
      </aside>
      <main class="content">
        <router-outlet />
      </main>

      <div class="scrim2" *ngIf="look.open()" (click)="look.open.set(false)"></div>
      <div class="drawer" [class.open]="look.open()">
        <div class="drawer-head">
          <app-icon name="palette" [size]="16"></app-icon>
          <strong>{{ 'appear.title' | translate }}</strong>
          <div class="spacer"></div>
          <button class="ghost" (click)="look.open.set(false)"><app-icon name="x" [size]="16"></app-icon></button>
        </div>
        <app-appearance-panel *ngIf="look.open()"></app-appearance-panel>
      </div>
    </div>
    <ng-template #bare><router-outlet /></ng-template>
  `,
  styles: [`
    .shell { display: flex; height: calc(100vh / var(--ui-zoom, 1)); }
    .sidebar {
      width: 224px;
      background: var(--side-bg, var(--panel));
      border-inline-end: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 16px 0;
      flex-shrink: 0;
    }
    .brand { font-weight: 700; font-size: 16px; padding: 0 20px 4px; color: var(--side-strong, var(--text)); }
    .ws { font-size: 11.5px; padding: 0 20px 16px; color: var(--side-dim, var(--text-dim)); }
    .brand:last-child { padding-bottom: 20px; }
    nav { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
    .nav-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--side-dim, var(--text-dim)); padding: 16px 20px 6px; }
    nav a {
      padding: 10px 20px;
      color: var(--side-text, var(--text-dim));
      text-decoration: none;
      font-size: 14px;
      border-inline-start: 3px solid transparent;
      display: flex; align-items: center; gap: 8px;
    }
    nav a:hover { background: var(--side-bg-2, var(--panel-2)); color: var(--side-strong, var(--text)); }
    nav a.active { color: var(--side-strong, var(--text)); border-inline-start-color: var(--accent); background: var(--side-bg-2, var(--panel-2)); }
    .user-box { margin-top: auto; padding: 14px 20px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; color: var(--side-text, var(--text)); }
    .tools { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .tools button, .tools ::ng-deep .trigger { color: var(--side-text, var(--text-dim)); }
    .user-name { font-size: 13px; font-weight: 600; color: var(--side-strong, var(--text)); }
    .user-role { font-size: 11px; color: var(--side-dim, var(--text-dim)); text-transform: capitalize; }
    .user-box > button { width: 100%; font-size: 11px; padding: 5px; }
    .content { flex: 1; overflow: auto; min-width: 0; }
    .spacer { flex: 1; }

    .drawer { position: fixed; top: 0; bottom: 0; inset-inline-end: 0; width: min(400px, 100vw); background: var(--panel); border-inline-start: 1px solid var(--border);
      box-shadow: 0 12px 40px rgba(0,0,0,.35); z-index: 70; display: flex; flex-direction: column; transform: translateX(105%); transition: transform .25s ease; }
    :host-context(html[dir="rtl"]) .drawer { transform: translateX(-105%); }
    .drawer.open, :host-context(html[dir="rtl"]) .drawer.open { transform: none; }
    .drawer-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .drawer app-appearance-panel { flex: 1; min-height: 0; display: block; overflow-y: auto; }
    .scrim2 { position: fixed; inset: 0; z-index: 65; background: rgba(8,13,26,.3); }
  `]
})
export class AppComponent implements OnInit {
  constructor(public auth: AuthService, private router: Router, public i18n: I18nService,
              public look: AppearanceService, private org: OrgService) {}

  ngOnInit() {
    if (this.auth.isLoggedIn()) { this.look.reloadForUser(); this.sync(); }
  }

  /** Refresh the signed-in user's current privileges and load the workspace's companies/branches. */
  private sync() {
    this.auth.refreshMe().subscribe();
    this.org.load().subscribe();
  }

  logout() {
    this.auth.logout();
    this.org.reset();
    this.router.navigate(['/login']);
  }

  @HostListener('document:keydown.escape') onEsc() { this.look.open.set(false); }
}
