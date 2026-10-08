import { Component, HostListener, OnDestroy, OnInit, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription, filter, interval } from 'rxjs';
import { AuthService } from './core/auth.service';
import { I18nService } from './core/i18n.service';
import { TranslatePipe } from './core/translate.pipe';
import { ErpContextService } from './core/erp-context.service';
import { ErpDataService } from './core/erp-data.service';
import { AssistantService } from './core/assistant.service';
import { MODULES } from './core/erp.config';
import { OrgService } from './core/org.service';
import { HR_ANY } from './core/hr.models';
import { AppearanceService } from './core/appearance.service';
import { LangPickerComponent } from './shared/lang-picker.component';
import { AppearancePanelComponent } from './shared/appearance-panel.component';
import { IconComponent } from './shared/ui';
import { AssistantPanelComponent } from './assistant/assistant-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, IconComponent, AssistantPanelComponent, LangPickerComponent, AppearancePanelComponent],
  template: `
    <div class="shell" *ngIf="auth.currentUser() as user; else bare" [class.collapsed]="ctx.sidebarCollapsed()" [class.mobile-open]="mobileNav">
      <!-- ===== Sidebar ===== -->
      <aside class="side no-print">
        <div class="brand">
          <div class="logo">W</div>
          <div class="brand-text">
            <strong>{{ 'brand' | translate }}</strong>
            <span>{{ user.tenantName || ('brand.tag' | translate) }}</span>
          </div>
        </div>

        <nav>
          <div class="sec">{{ 'nav.main' | translate }}</div>
          <a *ngIf="auth.can('dashboard.view')" routerLink="/dashboard" routerLinkActive="on" [title]="'nav.dashboard' | translate"><app-icon name="grid"></app-icon><span>{{ 'nav.dashboard' | translate }}</span></a>
          <a *ngIf="auth.can('tasks.act')" routerLink="/approvals" routerLinkActive="on" [title]="'nav.approvals' | translate">
            <app-icon name="check-square"></app-icon><span>{{ 'nav.approvals' | translate }}</span>
            <b class="badge" *ngIf="data.tasks().length">{{ data.tasks().length }}</b>
          </a>
          <a routerLink="/documents" routerLinkActive="on" [title]="'nav.documents' | translate"><app-icon name="file"></app-icon><span>{{ 'nav.documents' | translate }}</span></a>
          <a routerLink="/services" routerLinkActive="on" [title]="'nav.services' | translate"><app-icon name="send"></app-icon><span>{{ 'nav.services' | translate }}</span></a>

          <div class="sec">{{ 'nav.modules' | translate }}</div>
          <a *ngFor="let m of visibleModules()" [routerLink]="m.key === 'hr' ? ['/hr'] : ['/m', m.key]" routerLinkActive="on" [title]="('module.' + m.key) | translate">
            <app-icon [name]="m.icon"></app-icon><span>{{ ('module.' + m.key) | translate }}</span>
            <i class="dot" [style.background]="m.color"></i>
          </a>

          <div class="sec">{{ 'nav.workspace' | translate }}</div>
          <a *ngIf="auth.can('reports.view')" routerLink="/reports" routerLinkActive="on" [title]="'nav.reports' | translate"><app-icon name="bar-chart"></app-icon><span>{{ 'nav.reports' | translate }}</span></a>
          <a *ngIf="auth.can('assistant.use')" routerLink="/assistant" routerLinkActive="on" [title]="'nav.assistant' | translate"><app-icon name="sparkles"></app-icon><span>{{ 'nav.assistant' | translate }}</span></a>

          <ng-container *ngIf="auth.canAny('admin.users', 'org.manage')">
            <div class="sec">{{ 'nav.administration' | translate }}</div>
            <a routerLink="/admin" routerLinkActive="on" [title]="'nav.admin' | translate"><app-icon name="shield"></app-icon><span>{{ 'nav.admin' | translate }}</span></a>
          </ng-container>
        </nav>

        <button class="collapse ghost" (click)="ctx.sidebarCollapsed.set(!ctx.sidebarCollapsed())">
          <app-icon name="chevron" [style.transform]="collapseRotation()"></app-icon><span>{{ 'nav.collapse' | translate }}</span>
        </button>
      </aside>
      <div class="scrim" (click)="mobileNav = false"></div>

      <!-- ===== Main column ===== -->
      <div class="col">
        <header class="top no-print">
          <button class="ghost icon-btn menu" (click)="mobileNav = !mobileNav"><app-icon name="menu"></app-icon></button>

          <form class="search" (ngSubmit)="search()">
            <app-icon name="search" [size]="16"></app-icon>
            <input [(ngModel)]="q" name="q" [placeholder]="'top.search' | translate" />
          </form>

          <div class="ctx">
            <app-icon name="building" [size]="16"></app-icon>
            <select [ngModel]="ctx.companyObj().code" (ngModelChange)="ctx.setCompany($event); data.refresh().subscribe()" [title]="'top.company' | translate">
              <option *ngFor="let c of org.companies()" [value]="c.code">{{ i18n.nm(c) }}</option>
            </select>
            <select [ngModel]="ctx.branch()" (ngModelChange)="ctx.branch.set($event)" [title]="'top.branch' | translate">
              <option value="ALL">{{ 'top.allBranches' | translate }}</option>
              <option *ngFor="let b of ctx.branches()" [value]="b.code">{{ i18n.nm(b) }}</option>
            </select>
          </div>

          <div class="spacer"></div>

          <button class="ai-btn" *ngIf="auth.can('assistant.use')" (click)="ai.open.set(!ai.open())"><app-icon name="sparkles" [size]="16"></app-icon><span>{{ 'nav.assistant' | translate }}</span></button>
          <button class="ghost icon-btn" (click)="look.open.set(true)" [title]="'top.appearance' | translate"><app-icon name="palette"></app-icon></button>
          <button class="ghost icon-btn" (click)="ctx.toggleTheme()" [title]="'top.theme' | translate"><app-icon [name]="ctx.theme() === 'light' ? 'moon' : 'sun'"></app-icon></button>
          <app-lang-picker></app-lang-picker>

          <div class="pop-wrap">
            <button class="ghost icon-btn" (click)="bellOpen = !bellOpen; userOpen = false">
              <app-icon name="bell"></app-icon>
              <b class="bell-badge" *ngIf="data.tasks().length">{{ data.tasks().length }}</b>
            </button>
            <div class="pop" *ngIf="bellOpen">
              <div class="pop-head">{{ 'top.notifications' | translate }}</div>
              <a class="pop-row" *ngFor="let t of data.tasks().slice(0, 6)" [routerLink]="['/approvals']" [queryParams]="{ task: t.id }" (click)="bellOpen = false">
                <span class="chip" [class.high]="t.priority === 'High' || t.priority === 'Urgent'">{{ t.priority || 'Normal' }}</span>
                <span class="pop-title">{{ t.nodeName }}</span>
                <span class="dim">{{ docNumberFor(t.instanceId) }}</span>
              </a>
              <div class="empty" *ngIf="!data.tasks().length">{{ 'top.noNotifications' | translate }}</div>
            </div>
          </div>

          <div class="pop-wrap">
            <button class="user" (click)="userOpen = !userOpen; bellOpen = false">
              <span class="av">{{ initials(user.displayName) }}</span>
              <span class="who"><strong>{{ user.displayName }}</strong><small>{{ user.role }}</small></span>
            </button>
            <div class="pop narrow" *ngIf="userOpen">
              <button class="ghost full" (click)="logout()"><app-icon name="log-out" [size]="16"></app-icon>{{ 'nav.signout' | translate }}</button>
            </div>
          </div>
        </header>

        <main><router-outlet /></main>
      </div>

      <!-- ===== AI assistant drawer ===== -->
      <div class="drawer no-print" [class.open]="ai.open()">
        <div class="drawer-head">
          <div class="avatar"><app-icon name="sparkles" [size]="15"></app-icon></div>
          <strong>{{ 'ai.title' | translate }}</strong>
          <div class="spacer"></div>
          <button class="ghost icon-btn" (click)="ai.open.set(false)"><app-icon name="x"></app-icon></button>
        </div>
        <app-assistant-panel *ngIf="ai.open()"></app-assistant-panel>
      </div>

      <!-- ===== Appearance drawer ===== -->
      <div class="scrim2 no-print" *ngIf="look.open()" (click)="look.open.set(false)"></div>
      <div class="drawer look no-print" [class.open]="look.open()">
        <div class="drawer-head">
          <div class="avatar"><app-icon name="palette" [size]="15"></app-icon></div>
          <strong>{{ 'appear.title' | translate }}</strong>
          <div class="spacer"></div>
          <button class="ghost icon-btn" (click)="look.open.set(false)"><app-icon name="x"></app-icon></button>
        </div>
        <app-appearance-panel *ngIf="look.open()"></app-appearance-panel>
      </div>
    </div>
    <ng-template #bare><router-outlet /></ng-template>
  `,
  styles: [`
    .shell { display: flex; min-height: 100vh; --side-w: 248px; }
    .shell.collapsed { --side-w: 72px; }

    /* sidebar */
    .side { position: fixed; inset-block: 0; inset-inline-start: 0; width: var(--side-w); background: var(--side-bg); color: var(--side-text);
      display: flex; flex-direction: column; z-index: 40; transition: width .2s ease, transform .2s ease; overflow: hidden; }
    .brand { display: flex; align-items: center; gap: 11px; padding: 18px 18px 14px; }
    .logo { width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0; display: grid; place-items: center; font-weight: 800; color: #fff; font-size: 17px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #0ea5a4 100%); box-shadow: 0 6px 18px rgba(99,102,241,.45); }
    .brand-text { display: flex; flex-direction: column; min-width: 0; }
    .brand-text strong { color: var(--side-strong, #fff); font-size: 14px; white-space: nowrap; }
    .brand-text span { font-size: 11px; color: var(--side-dim); }
    nav { flex: 1; overflow-y: auto; padding: 6px 10px 10px; display: flex; flex-direction: column; gap: 2px; }
    .sec { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--side-dim); padding: 14px 10px 6px; white-space: nowrap; }
    nav a { display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: 9px; color: var(--side-text); font-size: 13.5px; position: relative; white-space: nowrap; }
    nav a:hover { background: var(--side-bg-2); color: var(--side-strong, #fff); }
    nav a.on { background: linear-gradient(90deg, rgba(99,102,241,.32), rgba(99,102,241,.08)); color: var(--side-active); font-weight: 600; }
    nav a.on::before { content: ''; position: absolute; inset-inline-start: -10px; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: #818cf8; }
    nav a span { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .badge { background: #ef4444; color: #fff; font-size: 10.5px; padding: 1px 7px; border-radius: 999px; font-weight: 700; }
    .dot { width: 7px; height: 7px; border-radius: 50%; opacity: .9; }
    .collapse { margin: 8px 10px 14px; color: var(--side-dim); justify-content: flex-start; gap: 11px; padding: 9px 10px; }
    .collapse:hover { background: var(--side-bg-2); color: var(--side-strong, #fff); }
    .collapsed .brand-text, .collapsed nav a span, .collapsed .sec, .collapsed .collapse span, .collapsed .dot { display: none; }
    .collapsed nav a { justify-content: center; }
    .collapsed .badge { position: absolute; top: 2px; inset-inline-end: 6px; padding: 0 5px; font-size: 9.5px; }
    .collapsed .sec { display: block; height: 10px; padding: 0; font-size: 0; }

    /* main column */
    .col { flex: 1; min-width: 0; margin-inline-start: var(--side-w); transition: margin .2s ease; display: flex; flex-direction: column; }
    .top { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 10px; padding: 10px 24px;
      background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
    .menu { display: none; }
    .search { display: flex; align-items: center; gap: 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 0 12px; width: min(340px, 34vw); color: var(--text-dim); }
    .search input { border: none; background: transparent; padding: 8px 0; box-shadow: none; }
    .ctx { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
    .ctx select { width: auto; max-width: 170px; padding: 7px 10px; font-weight: 550; background: var(--surface-2); }
    .spacer { flex: 1; }
    .icon-btn { padding: 8px; position: relative; color: var(--text-2); }
    .ai-btn { background: linear-gradient(135deg, var(--primary), #0ea5a4); color: #fff; border: none; font-weight: 600; }
    .ai-btn:hover { filter: brightness(1.08); background: linear-gradient(135deg, var(--primary), #0ea5a4); }
    .bell-badge { position: absolute; top: 2px; inset-inline-end: 2px; background: #ef4444; color: #fff; font-size: 9.5px; min-width: 16px; height: 16px; border-radius: 8px; display: grid; place-items: center; padding: 0 4px; }
    .user { border: none; background: transparent; padding: 4px 6px; gap: 9px; }
    .user:hover { background: var(--surface-3); }
    .av { width: 32px; height: 32px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-weight: 700; font-size: 12px; }
    .who { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2; }
    .who strong { font-size: 12.5px; }
    .who small { font-size: 11px; color: var(--text-dim); font-weight: 500; }
    .pop-wrap { position: relative; }
    .pop { position: absolute; top: calc(100% + 8px); inset-inline-end: 0; width: 340px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-pop); overflow: hidden; z-index: 50; }
    .pop.narrow { width: 200px; padding: 6px; }
    .pop-head { padding: 12px 14px; font-weight: 650; font-size: 13px; border-bottom: 1px solid var(--border); }
    .pop-row { display: flex; align-items: center; gap: 8px; padding: 10px 14px; color: var(--text); font-size: 13px; border-bottom: 1px solid var(--border); }
    .pop-row:hover { background: var(--surface-2); }
    .pop-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .full { width: 100%; justify-content: flex-start; }
    main { padding: 24px 28px 48px; max-width: 1440px; width: 100%; margin: 0 auto; }

    /* AI drawer */
    .drawer { position: fixed; top: 0; bottom: 0; inset-inline-end: 0; width: min(420px, 100vw); background: var(--surface); border-inline-start: 1px solid var(--border);
      box-shadow: var(--shadow-pop); z-index: 60; display: flex; flex-direction: column; transform: translateX(105%); transition: transform .25s ease; }
    :host-context(html[dir="rtl"]) .drawer { transform: translateX(-105%); }
    .drawer.open, :host-context(html[dir="rtl"]) .drawer.open { transform: none; }
    .drawer-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .drawer-head .avatar { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, var(--primary), #0ea5a4); color: #fff; display: grid; place-items: center; }
    .drawer app-assistant-panel, .drawer app-appearance-panel { flex: 1; min-height: 0; display: block; }
    .drawer.look { z-index: 70; }
    .scrim2 { position: fixed; inset: 0; z-index: 65; background: rgba(8,13,26,.25); }

    .scrim { display: none; }

    @media (max-width: 1100px) {
      .who, .ai-btn span { display: none; }
      .ctx select { max-width: 120px; }
    }
    @media (max-width: 900px) {
      .shell, .shell.collapsed { --side-w: 248px; }
      .side { transform: translateX(-100%); }
      :host-context(html[dir="rtl"]) .side { transform: translateX(100%); }
      .mobile-open .side, :host-context(html[dir="rtl"]) .mobile-open .side { transform: none; }
      .mobile-open .scrim { display: block; position: fixed; inset: 0; background: rgba(8,13,26,.45); z-index: 35; }
      .collapsed .brand-text, .collapsed nav a span, .collapsed .sec, .collapsed .collapse span { display: initial; }
      .col { margin-inline-start: 0; }
      .menu { display: inline-flex; }
      .search { flex: 1; width: auto; }
      .ctx { display: none; }
      .top { padding: 10px 14px; }
      main { padding: 18px 16px 40px; }
      .collapse { display: none; }
    }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  modules = MODULES;
  visibleModules = computed(() => MODULES.filter(m => m.key === 'hr' ? this.auth.canAny(...HR_ANY) : this.auth.can(m.key + '.view')));
  q = '';
  bellOpen = false;
  userOpen = false;
  mobileNav = false;
  private poll?: Subscription;
  private navSub?: Subscription;

  constructor(
    public auth: AuthService, private router: Router, public i18n: I18nService,
    public ctx: ErpContextService, public data: ErpDataService, public ai: AssistantService,
    public org: OrgService, public look: AppearanceService
  ) {
    // load once whenever someone is signed in (also right after login)
    effect(() => {
      if (this.auth.currentUser() && !this.data.loadedOnce()) {
        this.data.refresh().subscribe();
        this.org.load().subscribe();              // this workspace's companies & branches
        this.auth.refreshMe().subscribe();        // pick up privilege changes made since the last sign-in
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    this.poll = interval(30000).subscribe(() => { if (this.auth.isLoggedIn()) this.data.refreshTasks().subscribe(); });
    this.navSub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.mobileNav = false; this.bellOpen = false; this.userOpen = false;
    });
  }

  ngOnDestroy() { this.poll?.unsubscribe(); this.navSub?.unsubscribe(); }

  @HostListener('document:keydown.escape') onEsc() { this.bellOpen = false; this.userOpen = false; this.ai.open.set(false); this.look.open.set(false); }

  collapseRotation() {
    const collapsed = this.ctx.sidebarCollapsed();
    const rtl = this.i18n.isRtl;
    return `rotate(${(collapsed ? 0 : 180) + (rtl ? 180 : 0)}deg)`;
  }

  initials(name: string) { return name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase(); }

  docNumberFor(instanceId: string) {
    const d = this.data.docById(instanceId);
    return d?.number ?? '';
  }

  search() {
    this.router.navigate(['/documents'], { queryParams: { q: this.q || null, scope: 'all' } });
  }

  logout() {
    this.userOpen = false;
    this.auth.logout();
    this.data.loadedOnce.set(false);
    this.data.instances.set([]);
    this.data.tasks.set([]);
    this.ai.messages.set([]);
    this.org.reset();
    this.router.navigate(['/login']);
  }
}
