import { Component, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../core/i18n.service';
import { IconComponent } from './ui';

/** Language drop-down: all seven languages, shown by their own names. */
@Component({
  selector: 'app-lang-picker',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="wrap">
      <button class="ghost trigger" type="button" (click)="open = !open" [attr.aria-expanded]="open" [title]="i18n.t('lang.title')">
        <app-icon name="globe" [size]="16"></app-icon><span *ngIf="!iconOnly">{{ i18n.info.native }}</span>
      </button>
      <div class="menu" *ngIf="open" role="listbox">
        <button type="button" role="option" *ngFor="let l of i18n.languages" [class.on]="l.code === i18n.lang()" [attr.lang]="l.code" (click)="pick(l.code)">
          <span class="nm">{{ l.native }}</span>
          <small>{{ l.english }}</small>
          <app-icon *ngIf="l.code === i18n.lang()" name="check" [size]="14"></app-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .wrap { position: relative; display: inline-block; }
    .trigger { padding: 8px 10px; color: var(--text-2); }
    .trigger span { font-size: 12.5px; }
    .menu { position: absolute; top: calc(100% + 6px); inset-inline-end: 0; min-width: 190px; background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; box-shadow: var(--shadow-pop); padding: 6px; z-index: 80; display: flex; flex-direction: column; gap: 1px; }
    .menu button { width: 100%; justify-content: flex-start; border: none; background: transparent; padding: 8px 10px; gap: 10px; font-weight: 500; }
    .menu button:hover { background: var(--surface-3); }
    .menu button.on { background: var(--primary-soft); color: var(--primary); }
    .nm { font-size: 14px; flex: 1; text-align: start; }
    small { color: var(--text-dim); font-size: 11px; }
  `]
})
export class LangPickerComponent {
  @Input() iconOnly = false;
  open = false;
  constructor(public i18n: I18nService) {}
  pick(code: any) { this.i18n.setLang(code); this.open = false; }
  @HostListener('document:keydown.escape') esc() { this.open = false; }
  @HostListener('document:click', ['$event']) outside(e: Event) {
    if (this.open && !(e.target as HTMLElement).closest('app-lang-picker')) this.open = false;
  }
}
