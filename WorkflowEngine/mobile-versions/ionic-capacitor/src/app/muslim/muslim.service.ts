import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { I18nService } from '../core/i18n.service';
import { ToastService } from '../core/toast.service';
import { userRegion } from '../core/region';
import { CITIES } from './muslim-data';
import { DayTimes, HighLat, Options, Prayer, PRAYERS, civilDate, defaultHanafi, defaultMethod, nextPrayer, prayerDay, qibla } from './prayer-times';
import { QuranService } from './quran.service';

export interface Remind { on: boolean; before: number; }
export interface MuslimSettings {
  cc: string; city: string; lat: number; lng: number; tz: string; placeSet: boolean;
  method: string; hanafi: boolean; highLat: HighLat; adjust: Partial<Record<Prayer, number>>; hijriAdjust: number; time24: boolean;
  remind: Record<Prayer, Remind>; sound: 'chime' | 'url' | 'none'; adhanUrl: string; verse: boolean; verseTime: string; browserNotify: boolean;
  tr: string; tafsir: string; arSize: number;
  /** Quran reader: 'mushaf' (page images) or 'text', last Mushaf page, zoom %, two-page spread, night mode, image source folder/URL ('' = default) */
  view: 'mushaf' | 'text'; mpage: number; mzoom: number; mtwo: boolean; mnight: boolean; mbase: string;
  /** page style of the Mushaf reader: 'img' (scanned page images) or 'text' (pages drawn as Arabic text in the Madinah 15-line layout) */
  mmode: 'img' | 'text'; mtheme: 'rose' | 'blue';
}

const KEY = 'we.muslim.v1';
const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

function defaults(): MuslimSettings {
  const cc = userRegion(); const c = CITIES[cc]?.[0];
  const mk = (on: boolean): Remind => ({ on, before: 10 });
  return {
    cc: c ? cc : '', city: c ? c[0] : '', lat: c ? c[1] : 21.4225, lng: c ? c[2] : 39.8262, tz: c ? c[3] : browserTz(), placeSet: !!c,
    method: defaultMethod(cc), hanafi: defaultHanafi(cc), highLat: 'angle', adjust: {}, hijriAdjust: 0, time24: false,
    remind: { fajr: mk(true), sunrise: { on: false, before: 15 }, dhuhr: mk(true), asr: mk(true), maghrib: mk(true), isha: mk(true) },
    sound: 'chime', adhanUrl: '', verse: true, verseTime: '', browserNotify: false, tr: '', tafsir: '', arSize: 30,
    view: 'mushaf', mpage: 1, mzoom: 100, mtwo: false, mnight: false, mbase: '', mmode: 'img', mtheme: 'rose',
  };
}

/** Settings, today's times, next prayer countdown and the reminder timer of the Muslim module. Settings are per user, kept in this browser. */
@Injectable({ providedIn: 'root' })
export class MuslimService {
  private i18n = inject(I18nService);
  private toast = inject(ToastService);
  private quran = inject(QuranService);
  s = signal<MuslimSettings>(this.load());
  now = signal(new Date());
  private timer?: any;
  private fired = new Set<string>();

  private load(): MuslimSettings {
    const d = defaults();
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) return { ...d, ...v, remind: { ...d.remind, ...(v.remind ?? {}) } }; } catch { /* ignore */ }
    return d;
  }
  save(p: Partial<MuslimSettings>) {
    this.s.update(x => ({ ...x, ...p }));
    try { localStorage.setItem(KEY, JSON.stringify(this.s())); } catch { /* ignore */ }
  }

  opts = computed<Options>(() => { const s = this.s(); return { method: s.method, hanafi: s.hanafi, highLat: s.highLat, adjust: s.adjust }; });
  place = computed(() => ({ lat: this.s().lat, lng: this.s().lng }));
  today = computed(() => { const s = this.s(); const [y, m, d] = civilDate(this.now(), s.tz); return prayerDay(y, m, d, this.place(), s.tz, this.opts()); });
  next = computed(() => nextPrayer(this.now(), this.place(), this.s().tz, this.opts()));
  qibla = computed(() => qibla(this.s().lat, this.s().lng));
  /** timezone differs from the browser: times are shown in the place's own clock */
  day(y: number, m: number, d: number): DayTimes { return prayerDay(y, m, d, this.place(), this.s().tz, this.opts()); }

  fmt(d: Date | null): string {
    if (!d) return '—';
    return new Intl.DateTimeFormat(this.i18n.locale, { timeZone: this.s().tz, hour: '2-digit', minute: '2-digit', hour12: !this.s().time24, numberingSystem: 'latn' }).format(new Date(Math.round(d.getTime() / 60000) * 60000));
  }
  countdown(): string {
    const ms = Math.max(0, this.next().at.getTime() - this.now().getTime()); const t = Math.floor(ms / 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
  }
  /** Hijri date in the place's zone; after Maghrib the Islamic day has already begun, so it moves on by one. */
  hijri(): string {
    const s = this.s(); const t = this.today(); const after = t.at.maghrib && this.now().getTime() >= t.at.maghrib.getTime();
    const at = new Date(this.now().getTime() + ((after ? 1 : 0) + s.hijriAdjust) * 86400000);
    try { return new Intl.DateTimeFormat(this.i18n.locale, { calendar: 'islamic-umalqura', numberingSystem: 'latn', timeZone: s.tz, day: 'numeric', month: 'long', year: 'numeric' }).format(at); } catch { return ''; }
  }

  // ---------------------------------------------------------------- reminders (run while the portal is open in a browser tab)
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.now.set(new Date()); this.check(); }, 1000);
  }
  stop() { clearInterval(this.timer); this.timer = undefined; }

  name(p: Prayer) { return this.i18n.t('mus.' + p); }

  private check() {
    const now = this.now().getTime(); const s = this.s(); const t = this.today();
    for (const p of PRAYERS) {
      const r = s.remind[p]; const at = t.at[p]; if (!r?.on || !at) continue;
      const target = at.getTime() - r.before * 60000;
      const key = `${t.ymd.join('-')}|${p}|${r.before}`;
      if (now >= target && now < target + 120000 && !this.fired.has(key) && !this.seen(key)) { this.fired.add(key); this.mark(key); this.fire(p, r.before); }
    }
    if (s.verse && s.verseTime && /^\d\d:\d\d$/.test(s.verseTime)) {
      const [y, m, d] = civilDate(this.now(), s.tz); const [h, mi] = s.verseTime.split(':').map(Number);
      const at = prayerDay(y, m, d, this.place(), s.tz, this.opts()); // only for the offset
      const target = Date.UTC(y, m - 1, d, h, mi) - at.tz * 3600000; const key = `${y}-${m}-${d}|verse`;
      if (now >= target && now < target + 120000 && !this.fired.has(key) && !this.seen(key)) { this.fired.add(key); this.mark(key); this.fire(null, 0); }
    }
  }
  private seen(k: string) { try { return (localStorage.getItem('we.muslim.fired') ?? '').split(',').includes(k); } catch { return false; } }
  private mark(k: string) { try { localStorage.setItem('we.muslim.fired', k); } catch { /* ignore */ } }

  async fire(p: Prayer | null, before: number) {
    const s = this.s();
    const title = p ? (before > 0 ? this.i18n.t('mus.remind.in', { name: this.name(p), n: before }) : this.i18n.t('mus.remind.now', { name: this.name(p) })) : this.i18n.t('mus.verse.title');
    let body = '';
    if (s.verse || !p) {
      const v = await this.quran.verseOfDay(s.tr || this.quran.defaultTranslation(), s.tafsir || this.quran.defaultTafsir()).catch(() => null);
      if (v) body = `${v.ar}\n${v.tr || v.tafsir}  (${v.surah} ${v.ref})`;
    }
    this.toast.add({ title, body, kind: 'prayer', link: p ? '/muslim/times' : '/muslim/quran' }, 120000);
    this.sound();
    if (s.browserNotify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: 'muslim-' + (p ?? 'verse'), icon: '/favicon.ico' }); } catch { /* some mobile browsers need a service worker */ }
    }
  }

  sound() {
    const s = this.s(); if (s.sound === 'none') return;
    if (s.sound === 'url' && s.adhanUrl) { try { const a = new Audio(s.adhanUrl); void a.play(); return; } catch { /* fall through to the chime */ } }
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        const t0 = ctx.currentTime + i * 0.35; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9); o.start(t0); o.stop(t0 + 1);
      });
    } catch { /* audio blocked until the user has interacted with the page */ }
  }

  async askNotifications(): Promise<string> {
    if (typeof Notification === 'undefined') return 'unsupported';
    const r = await Notification.requestPermission(); this.save({ browserNotify: r === 'granted' }); return r;
  }
}
