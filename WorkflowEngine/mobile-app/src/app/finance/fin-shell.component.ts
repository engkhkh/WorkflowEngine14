import { Component, OnInit, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { FIN_NAV } from '../core/fin.models';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { I18nService } from '../core/i18n.service';

/** The Finance workspace: a tab bar of the pages the signed-in user may open + the page itself. */
@Component({
  selector: 'app-fin-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, IconComponent],
  template: `
    <div class="page-head">
      <div class="titles"><h1>{{ 'module.finance' | translate }}</h1>
        <p>{{ 'fin.sub' | translate }} · {{ i18n.nm(ctx.companyObj()) }} ({{ ctx.companyObj().currency }})</p></div>
      <a class="btn" routerLink="/m/finance" *ngIf="auth.can('finance.view')"><app-icon name="send" [size]="15"></app-icon>{{ 'fin.requests' | translate }}</a>
    </div>
    <nav class="tabs fintabs">
      <a *ngFor="let n of items()" [routerLink]="n.path" routerLinkActive="on"><app-icon [name]="n.icon" [size]="15"></app-icon>{{ n.label | translate }}</a>
    </nav>
    <router-outlet />
  `,
  styles: [`
    .fintabs a { display: inline-flex; align-items: center; gap: 7px; padding: 10px 14px; color: var(--text-2); border-bottom: 2px solid transparent; white-space: nowrap; font-weight: 550; font-size: 13px; }
    .fintabs a:hover { color: var(--text); }
    .fintabs a.on { color: var(--primary); border-bottom-color: var(--primary); }
    .btn { text-decoration: none; }
  `]
})
export class FinShellComponent implements OnInit {
  auth = inject(AuthService);
  ctx = inject(ErpContextService);
  i18n = inject(I18nService);
  private fin = inject(FinService);

  constructor() {
    // reload the drop-down lists when the user switches company
    effect(() => { const c = this.ctx.company(); this.fin.loadRefs(undefined, c).subscribe(); });
  }
  items() { return FIN_NAV.filter(n => this.auth.canAny(...n.any)); }
  ngOnInit() { /* refs are loaded by the effect above */ }
}

/** /finance -> the first page this user can open (or the plain finance documents page). */
@Component({ selector: 'app-fin-home', standalone: true, template: '' })
export class FinHomeComponent {
  constructor(auth: AuthService, router: Router) {
    const first = FIN_NAV.find(n => auth.canAny(...n.any));
    if (first) router.navigate(['/finance', first.path], { replaceUrl: true });
    else router.navigate(['/m', 'finance'], { replaceUrl: true });
  }
}
