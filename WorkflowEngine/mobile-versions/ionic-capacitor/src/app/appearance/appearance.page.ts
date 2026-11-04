import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton } from '@ionic/angular/standalone';
import { AppearanceService, ThemeMode, TextSize, Density, Corners } from '../core/appearance.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { DesignStudioComponent } from '../shared/design-studio.component';

/** Theme, accent colour, font, text size, density and corners - saved on this device. */
@Component({
  selector: 'app-appearance',
  standalone: true,
  imports: [CommonModule, TranslatePipe, DesignStudioComponent, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more"></ion-back-button></ion-buttons>
      <ion-title>{{ 'appear.title' | translate }}</ion-title>
      <ion-buttons slot="end"><ion-button (click)="a.reset()">{{ 'appear.reset' | translate }}</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <p class="sub">{{ 'appear.sub' | translate }}</p>

      <h4>{{ 'appear.mode' | translate }}</h4>
      <div class="seg"><button *ngFor="let m of modes" [class.on]="a.look().mode === m" (click)="a.update({ mode: m })">{{ 'appear.' + m | translate }}</button></div>

      <h4>{{ 'appear.accent' | translate }}</h4>
      <div class="swatches">
        <button *ngFor="let c of a.accents" class="sw" [style.background]="c" [class.on]="a.look().accent.toLowerCase() === c" (click)="a.update({ accent: c })" [attr.aria-label]="c"></button>
        <label class="sw custom" [class.on]="!a.accents.includes(a.look().accent.toLowerCase())"><input type="color" [value]="a.look().accent" (input)="a.update({ accent: $any($event.target).value })" /><span>+</span></label>
      </div>

      <h4>{{ 'appear.font' | translate }}</h4>
      <div class="fonts">
        <button class="font" [class.on]="a.look().font === 'auto'" (click)="a.update({ font: 'auto' })"><strong>{{ 'appear.font.auto' | translate }}</strong><small>{{ a.fontFor(i18n.lang()).label }}</small></button>
        <button class="font" *ngFor="let f of a.fonts" [class.on]="a.look().font === f.id" (click)="a.update({ font: f.id })"><strong [style.font-family]="f.stack">{{ f.label }}</strong></button>
      </div>
      <p class="note">{{ 'appear.fontNote' | translate }}</p>

      <h4>{{ 'appear.fontSize' | translate }}</h4>
      <div class="seg"><button *ngFor="let s of sizes" [class.on]="a.look().size === s" (click)="a.update({ size: s })">{{ 'appear.size.' + s | translate }}</button></div>

      <h4>{{ 'appear.density' | translate }}</h4>
      <div class="seg"><button *ngFor="let d of densities" [class.on]="a.look().density === d" (click)="a.update({ density: d })">{{ 'appear.' + d | translate }}</button></div>

      <h4>{{ 'appear.corners' | translate }}</h4>
      <div class="seg"><button *ngFor="let c of corners" [class.on]="a.look().corners === c" (click)="a.update({ corners: c })">{{ 'appear.' + c | translate }}</button></div>

      <h4>{{ 'appear.preview' | translate }}</h4>
      <div class="preview"><strong>{{ 'brand' | translate }}</strong><p>{{ 'appear.previewText' | translate }}</p><ion-button size="small">{{ 'common.view' | translate }}</ion-button></div>
      <div class="erp-root studio-wrap">
        <button class="primary" (click)="a.studio.set(true)">{{ 'design.open' | translate }}</button>
        <app-design-studio *ngIf="a.studio()"></app-design-studio>
      </div>
    </ion-content>
  `,
  styles: [`
    .sub { margin: 4px 2px 0; font-size: 13px; color: var(--text-dim); }
    h4 { margin: 20px 2px 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); }
    :host-context(html[dir="rtl"]) h4 { text-transform: none; letter-spacing: 0; }
    button { font-family: inherit; }
    .seg { display: flex; background: var(--surface-3); border-radius: 12px; padding: 3px; gap: 2px; }
    .seg button { flex: 1; border: none; background: transparent; padding: 9px 4px; font-size: 13px; border-radius: 10px; color: var(--text-2); }
    .seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
    .swatches { display: flex; flex-wrap: wrap; gap: 12px; }
    .sw { width: 38px; height: 38px; border-radius: 50%; border: 2px solid transparent; padding: 0; display: grid; place-items: center; color: #fff; }
    .sw.on { outline: 2px solid var(--text); outline-offset: 2px; }
    .sw.custom { position: relative; background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); overflow: hidden; }
    .sw.custom input { position: absolute; inset: -6px; opacity: 0; width: 52px; height: 52px; padding: 0; }
    .sw.custom span { pointer-events: none; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
    .fonts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .font { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: start; padding: 11px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .font strong { font-size: 13.5px; font-weight: 600; }
    .font small { color: var(--text-dim); font-size: 11px; }
    .font.on { border-color: var(--primary); background: var(--primary-soft); }
    .note { font-size: 11.5px; color: var(--text-dim); margin: 8px 2px 0; }
    .preview { border: 1px solid var(--border); background: var(--surface); border-radius: 14px; padding: 14px; }
    .preview p { color: var(--text-2); margin: 6px 0 10px; }
  `]
})
export class AppearancePage {
  modes: ThemeMode[] = ['light', 'dark', 'system'];
  sizes: TextSize[] = ['s', 'm', 'l', 'xl'];
  densities: Density[] = ['comfortable', 'compact'];
  corners: Corners[] = ['sharp', 'soft', 'round'];
  constructor(public a: AppearanceService, public i18n: I18nService) {}
}
