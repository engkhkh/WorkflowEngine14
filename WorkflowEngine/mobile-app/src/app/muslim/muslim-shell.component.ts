import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '../core/translate.pipe';

/** The Muslim workspace: prayer times (Adhan-style) and the Holy Quran with explanation. */
@Component({
  selector: 'app-muslim-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <div class="page-head"><div class="titles"><h1>{{ 'module.muslim' | translate }}</h1><p>{{ 'mus.sub' | translate }}</p></div></div>
    <nav class="tabs mtabs">
      <a routerLink="times" routerLinkActive="on">{{ 'mus.tab.times' | translate }}</a>
      <a routerLink="quran" routerLinkActive="on">{{ 'mus.tab.quran' | translate }}</a>
    </nav>
    <router-outlet />
  `,
  styles: [`
    .mtabs a { display: inline-flex; padding: 10px 16px; color: var(--text-2); border-bottom: 2px solid transparent; font-weight: 550; font-size: 13px; }
    .mtabs a:hover { color: var(--text); } .mtabs a.on { color: var(--primary); border-bottom-color: var(--primary); }
  `]
})
export class MuslimShellComponent {}
