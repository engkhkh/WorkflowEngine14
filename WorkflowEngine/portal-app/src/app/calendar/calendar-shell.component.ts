import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { CAL_NAV } from './calendar.service';

@Component({
  selector: 'app-calendar-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, IconComponent],
  template: `
    <div class="page-head"><div class="titles"><h1>{{ 'module.calendar' | translate }}</h1><p>{{ 'cal.sub' | translate }}</p></div></div>
    <nav class="tabs ctabs"><a *ngFor="let n of items()" [routerLink]="n.path" routerLinkActive="on"><app-icon [name]="n.icon" [size]="15"></app-icon>{{ n.label | translate }}</a></nav>
    <router-outlet />
  `,
  styles: [`
    .ctabs a { display: inline-flex; align-items: center; gap: 7px; padding: 10px 14px; color: var(--text-2); border-bottom: 2px solid transparent; font-weight: 550; font-size: 13px; }
    .ctabs a:hover { color: var(--text); } .ctabs a.on { color: var(--primary); border-bottom-color: var(--primary); }
  `]
})
export class CalendarShellComponent {
  auth = inject(AuthService);
  items() { return CAL_NAV.filter(n => this.auth.canAny(...n.any)); }
}
