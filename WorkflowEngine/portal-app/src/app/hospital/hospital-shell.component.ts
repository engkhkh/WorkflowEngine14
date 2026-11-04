import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { HOS_NAV } from './hospital.service';

/** The Hospital workspace: a tab bar of the pages the signed-in user may open + the page itself. */
@Component({
  selector: 'app-hospital-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, IconComponent],
  template: `
    <div class="page-head"><div class="titles"><h1>{{ 'module.hospital' | translate }}</h1><p>{{ 'hos.sub' | translate }}</p></div></div>
    <nav class="tabs hostabs">
      <a *ngFor="let n of items()" [routerLink]="n.path" routerLinkActive="on"><app-icon [name]="n.icon" [size]="15"></app-icon>{{ n.label | translate }}</a>
    </nav>
    <router-outlet />
  `,
  styles: [`
    .hostabs a { display: inline-flex; align-items: center; gap: 7px; padding: 10px 14px; color: var(--text-2); border-bottom: 2px solid transparent; white-space: nowrap; font-weight: 550; font-size: 13px; }
    .hostabs a:hover { color: var(--text); } .hostabs a.on { color: var(--primary); border-bottom-color: var(--primary); }
  `]
})
export class HospitalShellComponent {
  auth = inject(AuthService);
  items() { return HOS_NAV.filter(n => this.auth.canAny(...n.any)); }
}

/** /hospital -> the first page this user can open. */
@Component({ selector: 'app-hospital-home', standalone: true, template: '' })
export class HospitalHomeComponent {
  constructor(auth: AuthService, router: Router) {
    const first = HOS_NAV.find(n => auth.canAny(...n.any));
    router.navigate(first ? ['/hospital', first.path] : ['/dashboard'], { replaceUrl: true });
  }
}
