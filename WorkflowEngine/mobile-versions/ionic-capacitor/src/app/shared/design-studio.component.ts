import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppearanceService, DEFAULT_LOOK, TOKENS } from '../core/appearance.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from './ui';

type Tab = 'colors' | 'fonts' | 'themes';
const POPULAR = ['Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Nunito', 'Rubik', 'Raleway', 'Source Sans 3', 'IBM Plex Sans', 'Merriweather', 'Playfair Display',
  'Cairo', 'Tajawal', 'Almarai', 'Noto Sans Arabic', 'Noto Naskh Arabic', 'Amiri', 'Noto Nastaliq Urdu'];

/**
 * Design studio - every user can edit the look of their own workspace: colours of each part of the UI (separately for light and dark),
 * any Google font or an uploaded font file for text and headings, and saved / exported themes.
 * Everything is stored in this browser under the signed-in user's name; it needs no privilege and changes nobody else's screen.
 */
@Component({
  selector: 'app-design-studio',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent],
  template: `
    <div class="scrim" (click)="a.studio.set(false)">
      <div class="studio" (click)="$event.stopPropagation()">
        <div class="head"><h3><app-icon name="palette" [size]="18"></app-icon>{{ 'design.title' | translate }}</h3>
          <button class="ghost" (click)="a.studio.set(false)" [attr.aria-label]="'common.close' | translate"><app-icon name="x" [size]="18"></app-icon></button></div>
        <div class="seg tabs"><button *ngFor="let t of tabs" [class.on]="tab() === t" (click)="tab.set(t)">{{ 'design.tab.' + t | translate }}</button></div>

        <div class="main">
          <div class="pane">
            <ng-container *ngIf="tab() === 'colors'">
              <p class="note">{{ 'design.colorsHint' | translate }}</p>
              <div class="seg"><button [class.on]="a.look().mode === 'light'" (click)="a.setMode('light')">{{ 'appear.light' | translate }}</button>
                <button [class.on]="a.look().mode === 'dark'" (click)="a.setMode('dark')">{{ 'appear.dark' | translate }}</button></div>
              <div class="row"><span class="lab">{{ 'appear.accent' | translate }}</span>
                <input type="color" [value]="a.look().accent" (input)="a.update({ accent: $any($event.target).value })" />
                <code>{{ a.look().accent }}</code><span class="sp"></span>
                <button class="ghost sm" (click)="a.update({ accent: defaults.accent })">{{ 'design.default' | translate }}</button></div>
              <div class="row" *ngFor="let t of tokens">
                <span class="lab">{{ t.label | translate }}</span>
                <input type="color" [value]="shown(t.key, t.css)" (input)="a.setColor(t.key, $any($event.target).value)" />
                <code>{{ shown(t.key, t.css) }}</code><span class="sp"></span>
                <button class="ghost sm" *ngIf="custom()[t.key]" (click)="a.setColor(t.key, null)">{{ 'design.default' | translate }}</button>
              </div>
              <button class="sm" (click)="a.resetColors()">{{ 'design.resetColors' | translate }}</button>
            </ng-container>

            <ng-container *ngIf="tab() === 'fonts'">
              <p class="note">{{ 'design.fontsHint' | translate }}</p>
              <label class="lbl">{{ 'design.bodyFont' | translate }}</label>
              <input list="gf" [value]="a.look().fontBody" (change)="a.setCustomFont('fontBody', $any($event.target).value)" [placeholder]="'design.fontPh' | translate" />
              <label class="lbl">{{ 'design.headingFont' | translate }}</label>
              <input list="gf" [value]="a.look().fontHeading" (change)="a.setCustomFont('fontHeading', $any($event.target).value)" [placeholder]="'design.fontPh' | translate" />
              <datalist id="gf"><option *ngFor="let f of popular" [value]="f"></option></datalist>
              <label class="lbl">{{ 'design.uploadFont' | translate }}</label>
              <div class="row"><input type="file" accept=".woff2,.woff,.ttf,.otf" (change)="pickFont($event)" />
                <span class="sp"></span><button class="ghost sm" *ngIf="a.look().fontFile" (click)="a.setFontFile(null)">{{ 'design.removeFile' | translate }}</button></div>
              <p class="note" *ngIf="a.look().fontFile">{{ a.look().fontFile!.name }}</p>
              <p class="note bad" *ngIf="fontErr()">{{ fontErr() | translate }}</p>
              <button class="sm" (click)="clearFonts()">{{ 'design.resetFonts' | translate }}</button>
            </ng-container>

            <ng-container *ngIf="tab() === 'themes'">
              <div class="row"><input [value]="name()" (input)="name.set($any($event.target).value)" [placeholder]="'design.themeName' | translate" maxlength="40" />
                <button class="primary sm" (click)="save()" [disabled]="!name().trim()">{{ 'design.saveTheme' | translate }}</button></div>
              <div class="theme" *ngFor="let t of a.themes()">
                <span class="dot" [style.background]="t.look.accent"></span><strong>{{ t.name }}</strong><span class="sp"></span>
                <button class="sm" (click)="a.applyTheme(t.name)">{{ 'design.apply' | translate }}</button>
                <button class="ghost sm" (click)="a.deleteTheme(t.name)" [attr.aria-label]="'admin.delete' | translate"><app-icon name="trash" [size]="14"></app-icon></button>
              </div>
              <p class="note" *ngIf="!a.themes().length">{{ 'design.noThemes' | translate }}</p>
              <div class="row"><button class="sm" (click)="exportTheme()"><app-icon name="download" [size]="14"></app-icon>{{ 'design.export' | translate }}</button>
                <label class="btn sm">{{ 'design.import' | translate }}<input type="file" accept=".json,application/json" (change)="importTheme($event)" hidden /></label></div>
              <p class="note bad" *ngIf="importErr()">{{ 'design.badFile' | translate }}</p>
              <button class="sm" (click)="a.reset(); a.resetColors(); clearFonts()">{{ 'appear.reset' | translate }}</button>
            </ng-container>
          </div>

          <div class="preview">
            <h4>{{ 'appear.preview' | translate }}</h4>
            <div class="mock">
              <div class="side"><b>{{ 'brand' | translate }}</b><span class="on">{{ 'nav.dashboard' | translate }}</span><span>{{ 'nav.documents' | translate }}</span></div>
              <div class="page">
                <h3>{{ 'design.sampleHeading' | translate }}</h3>
                <p>{{ 'appear.previewText' | translate }}</p>
                <div class="cards"><div class="c"><small>{{ 'design.c.ok' | translate }}</small><b class="ok">12</b></div><div class="c"><small>{{ 'design.c.warn' | translate }}</small><b class="warn">3</b></div><div class="c"><small>{{ 'design.c.bad' | translate }}</small><b class="bad">1</b></div></div>
                <div class="rw"><button class="primary sm">{{ 'common.view' | translate }}</button><button class="sm">{{ 'common.cancel' | translate }}</button></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .scrim { position: fixed; inset: 0; background: rgba(8, 12, 24, .5); z-index: 1000; display: grid; place-items: center; padding: 16px; }
    .studio { background: var(--surface); color: var(--text); border-radius: var(--radius); box-shadow: var(--shadow-pop); width: min(920px, 100%); max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); }
    .head h3 { margin: 0; display: flex; gap: 8px; align-items: center; font-size: 16px; }
    .tabs { margin: 12px 18px 0; }
    .main { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(260px, 1fr); gap: 18px; padding: 14px 18px 18px; overflow: auto; }
    @media (max-width: 760px) { .main { grid-template-columns: 1fr; } }
    .pane { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .row { display: flex; align-items: center; gap: 10px; } .sp { flex: 1; }
    .lab { min-width: 118px; font-size: 13px; } code { font-size: 11.5px; color: var(--text-dim); }
    input[type=color] { width: 36px; height: 28px; padding: 0; border: 1px solid var(--border-strong); border-radius: 6px; background: none; cursor: pointer; }
    .note { margin: 0; font-size: 12px; color: var(--text-dim); } .note.bad { color: var(--bad); }
    .theme { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .dot { width: 14px; height: 14px; border-radius: 50%; } .btn { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); }
    .mock { display: grid; grid-template-columns: 110px 1fr; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; min-height: 260px; background: var(--bg); }
    .side { background: var(--side-bg); color: var(--side-text); padding: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
    .side b { color: var(--side-strong, #fff); } .side .on { color: var(--side-active, #fff); font-weight: 600; }
    .page { padding: 14px; } .page h3 { margin: 0 0 4px; } .page p { margin: 0 0 10px; color: var(--text-2); font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
    .c { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px; display: flex; flex-direction: column; }
    .c small { color: var(--text-dim); font-size: 11px; } .c b { font-size: 20px; } .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); }
    .rw { display: flex; gap: 8px; }
  `]
})
export class DesignStudioComponent {
  tab = signal<Tab>('colors');
  tabs: Tab[] = ['colors', 'fonts', 'themes'];
  tokens = TOKENS;
  defaults = DEFAULT_LOOK;
  popular = POPULAR;
  name = signal(''); fontErr = signal(''); importErr = signal(false);
  custom = computed(() => this.a.look().colors[this.a.effective()] ?? {});

  constructor(public a: AppearanceService) {}

  /** current value of a token: the user's override, else the computed CSS value of the theme */
  shown(key: string, css: string): string {
    const c = this.custom()[key]; if (c) return c;
    const v = getComputedStyle(document.documentElement).getPropertyValue(css).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v) ? '#' + v.slice(1).split('').map(x => x + x).join('') : '#888888';
  }
  pickFont(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; this.fontErr.set('');
    if (!f) return;
    if (f.size > 1_000_000) { this.fontErr.set('design.fontTooBig'); return; }
    const r = new FileReader();
    r.onload = () => this.a.setFontFile({ name: f.name, data: String(r.result) });
    r.readAsDataURL(f);
  }
  clearFonts() { this.a.update({ fontBody: '', fontHeading: '', fontFile: null }); this.fontErr.set(''); }
  save() { this.a.saveTheme(this.name()); this.name.set(''); }
  exportTheme() {
    const url = URL.createObjectURL(new Blob([this.a.exportJson()], { type: 'application/json' }));
    const el = document.createElement('a'); el.href = url; el.download = 'my-theme.json'; el.click(); URL.revokeObjectURL(url);
  }
  importTheme(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; this.importErr.set(false);
    if (!f) return;
    const r = new FileReader();
    r.onload = () => this.importErr.set(!this.a.importJson(String(r.result)));
    r.readAsText(f);
  }
}
