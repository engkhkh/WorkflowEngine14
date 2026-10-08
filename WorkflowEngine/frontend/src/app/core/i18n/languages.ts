/** The seven UI languages. `native` is what the picker shows; `locale` drives Intl number/date formatting. */
export type Lang = 'en' | 'ar' | 'fr' | 'es' | 'ur' | 'de' | 'it';

export interface LangInfo { code: Lang; native: string; english: string; rtl: boolean; locale: string; }

export const LANGUAGES: LangInfo[] = [
  { code: 'en', native: 'English',  english: 'English',  rtl: false, locale: 'en-US' },
  { code: 'ar', native: 'العربية',  english: 'Arabic',   rtl: true,  locale: 'ar-SA-u-nu-latn' },
  { code: 'fr', native: 'Français', english: 'French',   rtl: false, locale: 'fr-FR' },
  { code: 'es', native: 'Español',  english: 'Spanish',  rtl: false, locale: 'es-ES' },
  { code: 'ur', native: 'اردو',      english: 'Urdu',     rtl: true,  locale: 'ur-PK-u-nu-latn' },
  { code: 'de', native: 'Deutsch',  english: 'German',   rtl: false, locale: 'de-DE' },
  { code: 'it', native: 'Italiano', english: 'Italian',  rtl: false, locale: 'it-IT' },
];
