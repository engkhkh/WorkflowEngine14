import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';

export interface HrNavItem { path: string; label: string; icon: string; any: string[]; }

/** Every HR page, with the privileges that open it. The Admin module hands these out per user. */
export const HR_NAV: HrNavItem[] = [
  { path: 'overview', label: 'hr.nav.overview', icon: 'bar-chart', any: ['hr.reports.view'] },
  { path: 'employees', label: 'hr.nav.employees', icon: 'users', any: ['hr.employees.view'] },
  { path: 'org', label: 'hr.nav.org', icon: 'layers', any: ['hr.org.view'] },
  { path: 'leave', label: 'hr.nav.leave', icon: 'clock', any: ['hr.leave.view', 'hr.self'] },
  { path: 'performance', label: 'hr.nav.performance', icon: 'trending-up', any: ['hr.performance.view', 'hr.self'] },
  { path: 'recruitment', label: 'hr.nav.recruitment', icon: 'git-branch', any: ['hr.recruitment.view'] },
  { path: 'me', label: 'hr.nav.me', icon: 'file', any: ['hr.self'] },
];

/** The HR workspace: a tab bar of the pages the signed-in user may open + the page itself. */
@Component({
  selector: 'app-hr-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, IconComponent],
  template: `
    <div class="page-head">
      <div class="titles"><h1>{{ 'module.hr' | translate }}</h1><p>{{ 'hr.sub' | translate }}</p></div>
      <a class="btn" routerLink="/m/hr" *ngIf="auth.can('hr.view')"><app-icon name="send" [size]="15"></app-icon>{{ 'hr.requests' | translate }}</a>
    </div>
    <nav class="tabs hrtabs">
      <a *ngFor="let n of items()" [routerLink]="n.path" routerLinkActive="on"><app-icon [name]="n.icon" [size]="15"></app-icon>{{ n.label | translate }}</a>
    </nav>
    <router-outlet />
  `,
  styles: [`
    .hrtabs a { display: inline-flex; align-items: center; gap: 7px; padding: 10px 14px; color: var(--text-2); border-bottom: 2px solid transparent; white-space: nowrap; font-weight: 550; font-size: 13px; }
    .hrtabs a:hover { color: var(--text); }
    .hrtabs a.on { color: var(--primary); border-bottom-color: var(--primary); }
    .btn { text-decoration: none; }
  `]
})
export class HrShellComponent implements OnInit {
  constructor(public auth: AuthService, private hr: HrService) {}
  items() { return HR_NAV.filter(n => this.auth.canAny(...n.any)); }
  ngOnInit() { this.hr.loadRefs().subscribe(); }
}

/** /hr -> the first page this user can open. */
@Component({ selector: 'app-hr-home', standalone: true, template: '' })
export class HrHomeComponent {
  constructor(auth: AuthService, router: Router) {
    const first = HR_NAV.find(n => auth.canAny(...n.any));
    router.navigate(['/hr', first ? first.path : 'me'], { replaceUrl: true });
  }
}
