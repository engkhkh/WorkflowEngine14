import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { ERP_MODULES, ErpModule, ErpModuleDef } from '../core/erp.models';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';

/** Workspace shell of Manufacturing / Projects / CRM: a tab bar of the pages the signed-in user may open + the page itself. */
@Component({
  selector: 'app-erp-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, IconComponent],
  template: `
    <div class="page-head">
      <div class="titles"><h1>{{ def.titleKey | translate }}</h1><p>{{ def.subKey | translate }} · {{ i18n.nm(ctx.companyObj()) }}</p></div>
    </div>
    <nav class="tabs erptabs">
      <a *ngFor="let n of items()" [routerLink]="n.path" routerLinkActive="on"><app-icon [name]="n.icon" [size]="15"></app-icon>{{ n.label | translate }}</a>
    </nav>
    <router-outlet />
  `,
  styles: [`
    .erptabs a { display: inline-flex; align-items: center; gap: 7px; padding: 10px 14px; color: var(--text-2); border-bottom: 2px solid transparent; white-space: nowrap; font-weight: 550; font-size: 13px; }
    .erptabs a:hover { color: var(--text); } .erptabs a.on { color: var(--primary); border-bottom-color: var(--primary); }
  `]
})
export class ErpShellComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); i18n = inject(I18nService);
  def: ErpModuleDef = ERP_MODULES[inject(ActivatedRoute).snapshot.data['module'] as ErpModule];
  items() { return this.def.nav.filter(n => this.auth.canAny(...n.any)); }
}

/** /mfg -> the first page this user can open. */
@Component({ selector: 'app-erp-home', standalone: true, template: '' })
export class ErpHomeComponent {
  constructor(auth: AuthService, router: Router, route: ActivatedRoute) {
    const def = ERP_MODULES[route.snapshot.data['module'] as ErpModule];
    const first = def.nav.find(n => auth.canAny(...n.any));
    router.navigate(first ? [def.route, first.path] : ['/dashboard'], { replaceUrl: true });
  }
}
