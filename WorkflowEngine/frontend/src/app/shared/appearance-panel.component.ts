import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppearanceService, ThemeMode, TextSize, Density, Corners, SidebarStyle } from '../core/appearance.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from './ui';
import { DesignStudioComponent } from './design-studio.component';

/** Theme / accent colour / font / text size / density / corners / sidebar controls. */
@Component({
  selector: 'app-appearance-panel',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent, DesignStudioComponent],
  template: `
    <div class="body">
      <p class="sub">{{ 'appear.sub' | translate }}</p>

      <section>
        <h4>{{ 'appear.mode' | translate }}</h4>
        <div class="seg">
          <button *ngFor="let m of modes" [class.on]="a.look().mode === m" (click)="a.update({ mode: m })">
            <app-icon [name]="m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'settings'" [size]="14"></app-icon>{{ 'appear.' + m | translate }}
          </button>
        </div>
      </section>

      <section>
        <h4>{{ 'appear.accent' | translate }}</h4>
        <div class="swatches">
          <button *ngFor="let c of a.accents" class="sw" [style.background]="c" [class.on]="a.look().accent.toLowerCase() === c" (click)="a.update({ accent: c })" [attr.aria-label]="c">
            <app-icon *ngIf="a.look().accent.toLowerCase() === c" name="check" [size]="14"></app-icon>
          </button>
          <label class="sw custom" [class.on]="!a.accents.includes(a.look().accent.toLowerCase())" [title]="'appear.custom' | translate">
            <input type="color" [value]="a.look().accent" (input)="a.update({ accent: $any($event.target).value })" />
            <span>+</span>
          </label>
        </div>
      </section>

      <section>
        <h4>{{ 'appear.font' | translate }}</h4>
        <div class="fonts">
          <button class="font" [class.on]="a.look().font === 'auto'" (click)="a.update({ font: 'auto' })">
            <strong>{{ 'appear.font.auto' | translate }}</strong>
            <small>{{ a.fontFor(i18n.lang()).label }}</small>
          </button>
          <button class="font" *ngFor="let f of a.fonts" [class.on]="a.look().font === f.id" (click)="a.update({ font: f.id })">
            <strong [style.font-family]="f.stack">{{ f.label }}</strong>
            <small *ngIf="f.id === 'system'">{{ 'appear.font.system' | translate }}</small>
          </button>
        </div>
        <p class="note">{{ 'appear.fontNote' | translate }}</p>
      </section>

      <section>
        <h4>{{ 'appear.fontSize' | translate }}</h4>
        <div class="seg">
          <button *ngFor="let s of sizes" [class.on]="a.look().size === s" (click)="a.update({ size: s })">{{ 'appear.size.' + s | translate }}</button>
        </div>
      </section>

      <section class="two">
        <div>
          <h4>{{ 'appear.density' | translate }}</h4>
          <div class="seg">
            <button *ngFor="let d of densities" [class.on]="a.look().density === d" (click)="a.update({ density: d })">{{ 'appear.' + d | translate }}</button>
          </div>
        </div>
        <div>
          <h4>{{ 'appear.corners' | translate }}</h4>
          <div class="seg">
            <button *ngFor="let c of corners" [class.on]="a.look().corners === c" (click)="a.update({ corners: c })">{{ 'appear.' + c | translate }}</button>
          </div>
        </div>
      </section>

      <section>
        <h4>{{ 'appear.sidebar' | translate }}</h4>
        <div class="seg">
          <button *ngFor="let s of sides" [class.on]="a.look().sidebar === s" (click)="a.update({ sidebar: s })">{{ 'appear.side.' + s | translate }}</button>
        </div>
      </section>

      <section>
        <h4>{{ 'appear.preview' | translate }}</h4>
        <div class="preview">
          <strong>{{ 'brand' | translate }}</strong>
          <p>{{ 'appear.previewText' | translate }}</p>
          <div class="row"><button class="primary sm">{{ 'common.view' | translate }}</button><button class="sm">{{ 'common.cancel' | translate }}</button><span class="chip">PR-2610-0001</span></div>
        </div>
      </section>

      <button class="primary" (click)="a.studio.set(true)"><app-icon name="palette" [size]="14"></app-icon>{{ 'design.open' | translate }}</button>
      <app-design-studio *ngIf="a.studio()"></app-design-studio>
      <button class="reset" (click)="a.reset()"><app-icon name="refresh" [size]="14"></app-icon>{{ 'appear.reset' | translate }}</button>
    </div>
  `,
  styles: [`
    .body { padding: 16px 18px 28px; overflow-y: auto; height: 100%; display: flex; flex-direction: column; gap: 18px; }
    .sub { margin: 0; color: var(--text-dim); font-size: 12.5px; }
    h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); }
    :host-context(html[dir="rtl"]) h4 { text-transform: none; letter-spacing: 0; }
    .seg { display: flex; width: 100%; }
    .seg button { flex: 1; padding: 7px 8px; display: inline-flex; gap: 5px; }
    .swatches { display: flex; flex-wrap: wrap; gap: 9px; }
    .sw { width: 30px; height: 30px; border-radius: 50%; padding: 0; border: 2px solid transparent; color: #fff; display: grid; place-items: center; cursor: pointer; }
    .sw.on { outline: 2px solid var(--text); outline-offset: 2px; }
    .sw.custom { position: relative; background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); overflow: hidden; }
    .sw.custom input { position: absolute; inset: -6px; opacity: 0; width: 44px; height: 44px; padding: 0; cursor: pointer; }
    .sw.custom span { pointer-events: none; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
    .fonts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .font { flex-direction: column; align-items: flex-start; gap: 2px; padding: 9px 11px; white-space: normal; text-align: start; }
    .font strong { font-size: 13px; font-weight: 600; }
    .font small { color: var(--text-dim); font-size: 11px; font-weight: 450; }
    .font.on { border-color: var(--primary); background: var(--primary-soft); }
    .note { margin: 8px 0 0; font-size: 11.5px; color: var(--text-dim); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .preview { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; background: var(--surface-2); }
    .preview p { margin: 6px 0 10px; color: var(--text-2); }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .reset { align-self: flex-start; }
  `]
})
export class AppearancePanelComponent {
  modes: ThemeMode[] = ['light', 'dark', 'system'];
  sizes: TextSize[] = ['s', 'm', 'l', 'xl'];
  densities: Density[] = ['comfortable', 'compact'];
  corners: Corners[] = ['sharp', 'soft', 'round'];
  sides: SidebarStyle[] = ['dark', 'light', 'accent'];
  constructor(public a: AppearanceService, public i18n: I18nService) {}
}
