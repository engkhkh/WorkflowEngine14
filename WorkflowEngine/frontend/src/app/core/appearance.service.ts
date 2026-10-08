import { Injectable, computed, effect, signal } from '@angular/core';
import { I18nService } from './i18n/i18n.service';

export type ThemeMode = 'light' | 'dark' | 'system';
export type TextSize = 's' | 'm' | 'l' | 'xl';
export type Density = 'comfortable' | 'compact';
export type Corners = 'sharp' | 'soft' | 'round';
export type SidebarStyle = 'dark' | 'light' | 'accent';

export interface Look {
  mode: ThemeMode;
  accent: string;       // #rrggbb
  font: string;         // FONTS id, or 'auto'
  size: TextSize;
  density: Density;
  corners: Corners;
  sidebar: SidebarStyle;
}

export interface FontOption { id: string; label: string; stack: string; google?: string; }

const SYS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SYS_AR = "'Segoe UI', Tahoma, 'Noto Naskh Arabic', Arial, sans-serif";

/** Picker fonts. `google` = the Google Fonts "family=" query, loaded the first time the font is used. */
export const FONTS: FontOption[] = [
  { id: 'inter',    label: 'Inter',            stack: `'Inter', 'IBM Plex Sans Arabic', ${SYS}`, google: 'Inter:wght@400;500;600;700' },
  { id: 'system',   label: 'System',           stack: `${SYS}, ${SYS_AR}` },
  { id: 'plex',     label: 'IBM Plex Sans',    stack: `'IBM Plex Sans', 'IBM Plex Sans Arabic', ${SYS}`, google: 'IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700' },
  { id: 'noto',     label: 'Noto Sans',        stack: `'Noto Sans', 'Noto Sans Arabic', ${SYS}`, google: 'Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700' },
  { id: 'cairo',    label: 'Cairo',            stack: `'Cairo', 'Inter', ${SYS}`, google: 'Cairo:wght@400;500;600;700' },
  { id: 'tajawal',  label: 'Tajawal',          stack: `'Tajawal', 'Inter', ${SYS}`, google: 'Tajawal:wght@400;500;700' },
  { id: 'naskh',    label: 'Noto Naskh Arabic', stack: `'Noto Naskh Arabic', 'Inter', ${SYS}`, google: 'Noto+Naskh+Arabic:wght@400;500;600;700' },
  { id: 'nastaliq', label: 'Noto Nastaliq Urdu', stack: `'Noto Nastaliq Urdu', 'Inter', ${SYS}`, google: 'Noto+Nastaliq+Urdu:wght@400;500;600;700' },
  { id: 'merri',    label: 'Merriweather (serif)', stack: `'Merriweather', Georgia, 'Times New Roman', serif`, google: 'Merriweather:wght@400;700' },
  { id: 'mono',     label: 'JetBrains Mono',   stack: `'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace`, google: 'JetBrains+Mono:wght@400;500;700' },
];

/** What "Automatic" uses per UI language. */
const AUTO: Record<string, string> = { ar: 'plex', ur: 'naskh' };

export const ACCENTS = ['#4338ca', '#2563eb', '#0d9488', '#059669', '#ea580c', '#e11d48', '#7c3aed', '#475569'];
const ZOOM: Record<TextSize, number> = { s: 0.92, m: 1, l: 1.1, xl: 1.22 };
const RADIUS: Record<Corners, [string, string]> = { sharp: ['4px', '3px'], soft: ['12px', '8px'], round: ['18px', '12px'] };

export const DEFAULT_LOOK: Look = { mode: 'dark', accent: '#5b7cf0', font: 'auto', size: 'm', density: 'comfortable', corners: 'soft', sidebar: 'dark' };

const KEY = 'wfe_appearance';

// ---- tiny colour helpers (hex only) ----
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
function rgb(hex: string): [number, number, number] {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '4338ca';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const toHex = (c: number[]) => '#' + c.map(v => clamp(v).toString(16).padStart(2, '0')).join('');
/** mix(a, b, t): t=0 -> a, t=1 -> b */
function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return toHex([0, 1, 2].map(i => x[i] + (y[i] - x[i]) * t));
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Theme, accent colour, font, text size, density, corners and sidebar style - chosen by the user in the
 * Appearance panel, saved in this browser, applied as CSS variables on <html>.
 */
@Injectable({ providedIn: 'root' })
export class AppearanceService {
  look = signal<Look>(this.load());
  open = signal(false);
  private systemDark = signal(typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : false);
  private loadedFonts = new Set<string>();

  effective = computed<'light' | 'dark'>(() => {
    const m = this.look().mode;
    return m === 'system' ? (this.systemDark() ? 'dark' : 'light') : m;
  });

  fonts = FONTS;
  accents = ACCENTS;

  constructor(private i18n: I18nService) {
    try {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => this.systemDark.set(e.matches));
    } catch { /* old browser */ }
    effect(() => this.apply(this.look(), this.effective(), this.i18n.lang()));
  }

  update(patch: Partial<Look>) {
    this.look.set({ ...this.look(), ...patch });
    try { localStorage.setItem(KEY, JSON.stringify(this.look())); } catch { /* ignore */ }
  }
  setMode(mode: ThemeMode) { this.update({ mode }); }
  reset() { this.update({ ...DEFAULT_LOOK }); }

  /** Font actually in use for the current UI language. */
  fontFor(lang: string): FontOption {
    const id = this.look().font === 'auto' ? (AUTO[lang] ?? 'inter') : this.look().font;
    return FONTS.find(f => f.id === id) ?? FONTS[0];
  }

  private load(): Look {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...DEFAULT_LOOK, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { ...DEFAULT_LOOK };
  }

  private ensureFont(f: FontOption) {
    if (!f.google || this.loadedFonts.has(f.id)) return;
    this.loadedFonts.add(f.id);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
    document.head.appendChild(link);
  }

  private apply(l: Look, theme: 'light' | 'dark', lang: string) {
    const root = document.documentElement;
    const dark = theme === 'dark';
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-density', l.density);
    root.setAttribute('data-sidebar', l.sidebar);

    // accent -> primary family (lighter in dark mode so it stays readable)
    const surface = dark ? '#121a2e' : '#ffffff';
    const primary = dark ? mix(l.accent, '#ffffff', 0.32) : l.accent;
    const set = (k: string, v: string) => root.style.setProperty(k, v);
    set('--primary', primary);
    set('--primary-hover', dark ? mix(primary, '#ffffff', 0.18) : mix(primary, '#000000', 0.16));
    set('--primary-soft', mix(surface, primary, dark ? 0.22 : 0.1));
    set('--primary-contrast', luminance(primary) > 0.45 ? '#0b1020' : '#ffffff');
    set('--chart-1', primary);
    // Ionic (mobile app) reads these; harmless in the portal
    set('--ion-color-primary', primary);
    set('--ion-color-primary-rgb', rgb(primary).join(','));
    set('--ion-color-primary-contrast', luminance(primary) > 0.45 ? '#0b1020' : '#ffffff');
    set('--ion-color-primary-shade', mix(primary, '#000000', 0.12));
    set('--ion-color-primary-tint', mix(primary, '#ffffff', 0.12));

    // sidebar
    const side = l.sidebar;
    if (side === 'dark') {
      ['--side-bg', '--side-bg-2', '--side-text', '--side-dim', '--side-active', '--side-strong'].forEach(k => root.style.removeProperty(k));
    } else if (side === 'light') {
      set('--side-bg', dark ? '#121a2e' : '#ffffff'); set('--side-bg-2', dark ? '#1c2844' : '#eef2f8');
      set('--side-text', dark ? '#b4c0d8' : '#425066'); set('--side-dim', dark ? '#8492b0' : '#6b778c');
      set('--side-active', primary); set('--side-strong', dark ? '#e8f0ff' : '#0f1b2d');
    } else {
      const bg = mix(l.accent, '#000000', 0.42);
      set('--side-bg', bg); set('--side-bg-2', mix(bg, '#ffffff', 0.12));
      set('--side-text', '#e4e9ff'); set('--side-dim', mix(bg, '#ffffff', 0.55)); set('--side-active', '#ffffff'); set('--side-strong', '#ffffff');
    }

    // corners
    const [r, rs] = RADIUS[l.corners];
    set('--radius', r); set('--radius-sm', rs);

    // font
    const f = this.fontFor(lang);
    this.ensureFont(f);
    set('--font', f.stack);
    set('--ion-font-family', f.stack);
    root.setAttribute('data-font', f.id);

    // text size: scales the whole UI (the app is laid out in px)
    set('--ui-zoom', String(ZOOM[l.size]));
    root.setAttribute('data-size', l.size);
  }
}
