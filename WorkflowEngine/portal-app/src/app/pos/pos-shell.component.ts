import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { PosService } from '../core/pos.service';
import { POS_NAV } from '../core/pos.models';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';

/** The Point of sale workspace: a tab bar of the pages the signed-in user may open + the page itself. */
@Component({
  selector: 'app-pos-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, IconComponent],
  template: `
    <div class="page-head">
      <div class="titles"><h1>{{ 'module.pos' | translate }}</h1>
        <p>{{ 'pos.sub' | translate }} · {{ i18n.nm(ctx.companyObj()) }}<ng-container *ngIf="pos.hasBranches()"> · {{ branchLabel() }}</ng-container><ng-container *ngIf="!pos.hasBranches()"> · {{ 'pos.noBranches' | translate }}</ng-container></p></div>
    </div>
    <nav class="tabs postabs">
      <a *ngFor="let n of items()" [routerLink]="n.path" routerLinkActive="on"><app-icon [name]="n.icon" [size]="15"></app-icon>{{ n.label | translate }}</a>
    </nav>
    <router-outlet />
  `,
  styles: [`
    .postabs a { display: inline-flex; align-items: center; gap: 7px; padding: 10px 14px; color: var(--text-2); border-bottom: 2px solid transparent; white-space: nowrap; font-weight: 550; font-size: 13px; }
    .postabs a:hover { color: var(--text); } .postabs a.on { color: var(--primary); border-bottom-color: var(--primary); }
  `]
})
export class PosShellComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); i18n = inject(I18nService); pos = inject(PosService);
  items() { return POS_NAV.filter(n => this.auth.canAny(...n.any)); }
  branchLabel() { const b = this.ctx.branches().find(x => x.code === this.pos.branch()); return b ? this.i18n.nm(b) : ''; }
}

/** /pos -> the first page this user can open. */
@Component({ selector: 'app-pos-home', standalone: true, template: '' })
export class PosHomeComponent {
  constructor(auth: AuthService, router: Router) {
    const first = POS_NAV.find(n => auth.canAny(...n.any));
    router.navigate(first ? ['/pos', first.path] : ['/dashboard'], { replaceUrl: true });
  }
}
