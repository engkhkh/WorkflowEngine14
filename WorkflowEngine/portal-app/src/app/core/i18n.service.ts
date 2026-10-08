import { Injectable, signal, effect } from '@angular/core';
import { DICTIONARY } from './i18n/dictionary';
import { LANGUAGES, Lang, LangInfo } from './i18n/languages';
import { FR } from './i18n/lang-fr';
import { ES } from './i18n/lang-es';
import { UR } from './i18n/lang-ur';
import { DE } from './i18n/lang-de';
import { IT } from './i18n/lang-it';

export { Lang, LANGUAGES, LangInfo } from './i18n/languages';

const STORAGE_KEY = 'portal_lang';
const EXTRA: Partial<Record<Lang, Record<string, string>>> = { fr: FR, es: ES, ur: UR, de: DE, it: IT };

/**
 * Runtime i18n: English, Arabic, French, Spanish, Urdu, German, Italian.
 * Arabic and Urdu switch the whole page to RTL. A key missing in a language falls back to English.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  languages = LANGUAGES;
  lang = signal<Lang>(this.loadInitial());

  constructor() {
    effect(() => this.applyDom(this.lang()));
  }

  setLang(code: Lang) {
    this.lang.set(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage unavailable */ }
  }

  /** Cycles through the languages (kept for the old one-button toggle). */
  toggle() {
    const i = LANGUAGES.findIndex(l => l.code === this.lang());
    this.setLang(LANGUAGES[(i + 1) % LANGUAGES.length].code);
  }

  /** Translate a key; `{name}` placeholders are replaced from `params`. */
  t(key: string, params?: Record<string, string | number>): string {
    const lang = this.lang();
    const entry = DICTIONARY[key];
    let s: string;
    if (!entry) s = key;
    else if (lang === 'en' || lang === 'ar') s = entry[lang];
    else s = EXTRA[lang]?.[key] ?? entry.en;
    if (params) for (const p in params) s = s.split('{' + p + '}').join(String(params[p]));
    return s;
  }

  /** Inline English/Arabic text; every other language falls back to the English text. Prefer t(). */
  pick(en: string, ar: string): string { return this.lang() === 'ar' ? ar : en; }

  get info(): LangInfo { return LANGUAGES.find(l => l.code === this.lang()) ?? LANGUAGES[0]; }
  get isRtl(): boolean { return this.info.rtl; }

  /** Locale for numbers/dates. Arabic/Urdu keep Latin digits - the common ERP convention in KSA/PK. */
  get locale(): string { return this.info.locale; }

  /** Display name of a company/branch: Arabic UI uses the Arabic name when one was entered. */
  nm(o: { name: string; nameAr?: string } | null | undefined): string {
    if (!o) return '';
    return this.lang() === 'ar' && o.nameAr ? o.nameAr : o.name;
  }

  private loadInitial(): Lang {
    try {
      const v = localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (v && LANGUAGES.some(l => l.code === v)) return v;
      const nav = (navigator.language || 'en').slice(0, 2) as Lang;
      return LANGUAGES.some(l => l.code === nav) ? nav : 'en';
    } catch { return 'en'; }
  }

  private applyDom(lang: Lang) {
    const info = LANGUAGES.find(l => l.code === lang) ?? LANGUAGES[0];
    document.documentElement.lang = lang;
    document.documentElement.dir = info.rtl ? 'rtl' : 'ltr';
  }
}
