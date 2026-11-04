import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../core/i18n.service';

export interface SurahInfo { number: number; name: string; englishName: string; englishNameTranslation: string; numberOfAyahs: number; revelationType: string; }
export interface Ayah { number: number; text: string; numberInSurah: number; juz?: number; page?: number; sajda?: any; }
export interface Edition { identifier: string; language: string; name: string; englishName: string; format: string; type: string; direction?: string; }
export interface VerseOfDay { ref: string; surah: string; ar: string; tr: string; tafsir: string; }

/** Default API (public, free). Can be changed in the Muslim settings to a self-hosted copy. */
export const QURAN_API = 'https://api.alquran.cloud/v1';
export const AUDIO_BASE = 'https://cdn.islamic.network/quran/audio/128/ar.alafasy/';
const ARABIC = 'quran-uthmani';
/** default translation / explanation per UI language (all of them can be changed in the reader) */
const TR_BY_LANG: Record<string, string> = { en: 'en.sahih', fr: 'fr.hamidullah', es: 'es.cortes', ur: 'ur.jalandhry', de: 'de.aburida', it: 'it.piccardo', ar: '' };
/** well-known verses used for the daily verse reminder (surah:ayah) */
const DAILY = ['2:255', '94:5', '94:6', '2:286', '3:139', '13:28', '39:53', '65:3', '2:152', '2:153', '2:186', '33:56', '49:13', '16:90', '55:13', '112:1', '93:5', '29:69', '24:35', '59:22',
  '3:103', '8:46', '64:11', '57:4', '2:45', '17:9', '20:114', '103:1', '103:3', '1:5', '1:6', '25:63', '31:14', '42:36', '9:51'];

const BASMALA = 'بسم الله الرحمن الرحيم';
const strip = (s: string) => s.replace(/[ً-ٰٟۖ-ۭـ]/g, '').replace(/ٱ/g, 'ا');

@Injectable({ providedIn: 'root' })
export class QuranService {
  private http = inject(HttpClient);
  private i18n = inject(I18nService);
  base = QURAN_API;

  private get<T>(path: string): Promise<T> { return firstValueFrom(this.http.get<{ code: number; data: T }>(this.base + path)).then(r => r.data); }
  private cache<T>(key: string, load: () => Promise<T>): Promise<T> {
    try { const c = localStorage.getItem(key); if (c) return Promise.resolve(JSON.parse(c) as T); } catch { /* ignore */ }
    return load().then(v => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full: still works online */ } return v; });
  }

  surahs(): Promise<SurahInfo[]> { return this.cache('we.quran.surahs', () => this.get<SurahInfo[]>('/surah')); }
  editions(): Promise<Edition[]> { return this.cache('we.quran.editions', () => this.get<Edition[]>('/edition?format=text')); }
  defaultTranslation(): string { return TR_BY_LANG[this.i18n.lang()] ?? 'en.sahih'; }
  defaultTafsir(): string { return 'ar.muyassar'; }

  /** one surah in one edition (cached on this device after the first read) */
  surah(n: number, edition: string): Promise<{ ayahs: Ayah[]; info: SurahInfo }> {
    if (!edition) return Promise.resolve({ ayahs: [], info: {} as SurahInfo });
    return this.cache(`we.quran.s.${n}.${edition}`, () => this.get<any>(`/surah/${n}/${edition}`).then(d => ({ ayahs: d.ayahs as Ayah[], info: d as SurahInfo })));
  }

  /** the Arabic text without the Basmala that the service glues to the first verse of most surahs */
  clean(n: number, a: Ayah): string {
    if (a.numberInSurah !== 1 || n === 1 || n === 9) return a.text;
    const words = a.text.split(/\s+/);
    return strip(words.slice(0, 4).join(' ')) === BASMALA ? words.slice(4).join(' ') : a.text;
  }

  async ayah(ref: string, edition: string): Promise<string> {
    if (!edition) return '';
    return this.cache(`we.quran.a.${ref}.${edition}`, () => this.get<any>(`/ayah/${ref}/${edition}`).then(d => String(d.text ?? '')));
  }

  /** the verse of the day with its translation and explanation (null when the service cannot be reached and nothing is cached) */
  async verseOfDay(tr: string, tafsir: string, now = new Date()): Promise<VerseOfDay | null> {
    const day = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 86400000);
    const ref = DAILY[day % DAILY.length];
    try {
      const [ar, t, x] = await Promise.all([this.ayah(ref, ARABIC), this.ayah(ref, tr).catch(() => ''), this.ayah(ref, tafsir).catch(() => '')]);
      const [s] = ref.split(':'); const sur = (await this.surahs().catch(() => [] as SurahInfo[])).find(z => z.number === +s);
      return { ref, surah: sur ? sur.englishName : 'Surah ' + s, ar: this.cleanText(ref, ar), tr: t, tafsir: x };
    } catch { return null; }
  }
  private cleanText(ref: string, t: string) { return t; }

  audioUrl(ayahNumber: number) { return AUDIO_BASE + ayahNumber + '.mp3'; }
}
