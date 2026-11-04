import { Component, ElementRef, Injectable, Input, OnChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { JUZ_ORDINAL_AR, SURAH_AR, juzOfPage, surahOfPage } from './mushaf-data';

/** Madinah Mushaf layout: per page a list of lines. ['H', surah] banner, ['B'] basmala, ['L', tokens] where a token is a word, a verse number or '*' (quarter mark). */
export type MushafLine = ['H', number] | ['B'] | ['L', (string | number)[]];

/** The 604 pages of the Madinah Mushaf as text lines (loaded once, ~1.5 MB, then cached by the browser). */
@Injectable({ providedIn: 'root' })
export class MushafTextService {
  private data: Promise<MushafLine[][]> | null = null;
  load(): Promise<MushafLine[][]> {
    if (!this.data) {
      this.data = fetch('assets/quran/mushaf-text.json').then(r => { if (!r.ok) throw new Error('mushaf-text ' + r.status); return r.json() as Promise<MushafLine[][]>; })
        .catch(e => { this.data = null; throw e; });
    }
    return this.data;
  }
}

/** index of the text: where every page starts (surah, verse, word) and how many words each verse has - used to tell which verse a tapped word belongs to */
export interface MushafIndex { start: number[][]; count: Record<string, number>; }
@Injectable({ providedIn: 'root' })
export class MushafIndexService {
  private data: Promise<MushafIndex> | null = null;
  load(): Promise<MushafIndex> {
    if (!this.data) this.data = fetch('assets/quran/mushaf-index.json').then(r => { if (!r.ok) throw new Error('index ' + r.status); return r.json() as Promise<MushafIndex>; }).catch(e => { this.data = null; throw e; });
    return this.data;
  }
}

/** word meaning, verse translation and tafsir come from the public Quran.com API (needs internet; the address can be changed with localStorage 'quranApi') */
const apiBase = () => { try { return localStorage.getItem('quranApi') || 'https://api.quran.com/api/v4'; } catch { return 'https://api.quran.com/api/v4'; } };
const TAFSIR_ID: Record<string, number> = { ar: 16, en: 169 };
const stripHtml = (h: string) => h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
export interface WordSel { li: number; ti: number; word: string; surah: number; ayah: number; pos: number; total: number; busy: boolean; error: string; info?: { meaning: string; translit: string; verse: string }; tafsir: '' | 'ar' | 'en'; tafsirText: string; }

/** surah, verse and word number (1-based) of a token on a page, by walking the lines from the page's start */
export function locateWord(idx: MushafIndex, page: number, lines: MushafLine[], li: number, ti: number): { surah: number; ayah: number; pos: number; total: number } {
  let [surah, ayah, wi] = idx.start[page - 1] ?? [1, 1, 0];
  for (let i = 0; i <= li && i < lines.length; i++) {
    const l = lines[i];
    if (l[0] === 'H') { surah = l[1]; ayah = 1; wi = 0; continue; }
    if (l[0] !== 'L') continue;
    const toks = l[1];
    for (let j = 0; j < toks.length; j++) {
      const t = toks[j];
      if (i === li && j === ti) return { surah, ayah, pos: wi + 1, total: idx.count[surah + ':' + ayah] ?? 0 };
      if (t === '*') continue;
      if (typeof t === 'number') { ayah = t + 1; wi = 0; } else wi++;
    }
  }
  return { surah, ayah, pos: wi + 1, total: 0 };
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const arNum = (n: number) => String(n).replace(/\d/g, d => AR_DIGITS[+d]);
const STRIP = /[ً-ٰٟۖ-ۭـ]/g;
/** the words Allah / Rabb are printed in red in the Madinah Mushaf */
const RED = /^[وفبتك]?(?:الله|لله|رب(?:نا|كم|هم|ك|ي|ه|ها|هما|كما|هن)?)$/;
export const isRed = (w: string) => RED.test(w.replace(STRIP, '').replace(/ٱ/g, 'ا'));

/**
 * One Mushaf page drawn as text: ornate frame, surah / juz header, 15 justified lines, verse medallions and the page number.
 * Font: Amiri Quran (SIL OFL, assets/quran/OFL.txt). Lines that are narrower than the page (end of a surah, first pages) are centred, like in print.
 */
@Component({
  selector: 'app-mushaf-text-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tp" [class.night]="night" [class.blue]="theme === 'blue'">
      <div class="frame"><div class="inner">
        <div class="hd" dir="rtl"><span class="cart">{{ juzName() }}</span><span class="cart">سورة {{ surah() }}</span></div>
        <div class="body" *ngIf="lines().length; else load" dir="rtl">
          <ng-container *ngFor="let l of lines(); let li = index">
            <div class="hdr" *ngIf="l[0] === 'H'"><span>سُورَةُ {{ names[$any(l[1]) - 1] }}</span></div>
            <div class="bsm" *ngIf="l[0] === 'B'">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>
            <div class="ln" *ngIf="l[0] === 'L'">
              <ng-container *ngFor="let t of tokens(l); let ti = index">
                <span *ngIf="t === '*'" class="q">۞</span>
                <span *ngIf="t !== '*' && isNum(t)" class="vn"><i>{{ ar($any(t)) }}</i></span>
                <span *ngIf="t !== '*' && !isNum(t)" class="w" [class.red]="red($any(t))" [class.sel]="sel()?.li === li && sel()?.ti === ti" (click)="tap(li, ti, $any(t))">{{ t }}</span>
              </ng-container>
            </div>
          </ng-container>
        </div>
        <ng-template #load><div class="wait">{{ failed() ? '⚠' : '…' }}</div></ng-template>
        <div class="ft">{{ ar(page) }}</div>
      </div></div>
      <div class="sheet" *ngIf="sel() as w" dir="rtl" (click)="$event.stopPropagation()">
        <button class="x" (click)="close()" aria-label="close">✕</button>
        <div class="wd">{{ w.word }}</div>
        <div class="ref">{{ names[w.surah - 1] }} · {{ ar(w.ayah) }}</div>
        <div class="msg" *ngIf="w.busy">…</div>
        <div class="msg" *ngIf="w.error">{{ w.error }}</div>
        <ng-container *ngIf="w.info">
          <div class="row" dir="ltr" *ngIf="w.info.meaning"><b>{{ w.info.meaning }}</b><i *ngIf="w.info.translit"> · {{ w.info.translit }}</i></div>
          <div class="row note" dir="ltr" *ngIf="!w.info.meaning">Word meaning is not available for this word.</div>
          <div class="vt" dir="ltr">{{ w.info.verse }}</div>
          <div class="tabs"><button [class.on]="w.tafsir === 'ar'" (click)="loadTafsir('ar')">التفسير الميسر</button><button [class.on]="w.tafsir === 'en'" (click)="loadTafsir('en')">Tafsir Ibn Kathir</button></div>
          <div class="tf" [attr.dir]="w.tafsir === 'en' ? 'ltr' : 'rtl'" *ngIf="w.tafsirText">{{ w.tafsirText }}</div>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .tp { container-type: inline-size; position: relative; width: 100%; aspect-ratio: 2600 / 4206; background: var(--bg); --bg: #fffdf6; --edge: #9a2f63; --cfill: #fbe4ee; --ctext: #4a1030; --num: #6b2a4a; --h1: #fbe4ee; --h2: #f3c9d9; --mst: #8a3a63; --med: #f3c9d9; --frame: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 90 90'%3E%3Crect width='90' height='90' fill='%23f2c6d6'/%3E%3Cg fill='%23c2185b'%3E%3Cpath d='M45 22c-3-5-9-3-8 2 1 4 8 7 8 7s7-3 8-7c1-5-5-7-8-2z' transform='translate(0 -3) scale(1 .9) translate(0 4)'/%3E%3Cpath d='M45 68c-3-5-9-3-8 2 1 4 8 7 8 7s7-3 8-7c1-5-5-7-8-2z' transform='translate(0 8) scale(1 -.9) translate(0 -150)'/%3E%3Cpath d='M22 45c-5-3-3-9 2-8 4 1 7 8 7 8s-3 7-7 8c-5 1-7-5-2-8z' transform='translate(0 0)'/%3E%3Cpath d='M68 45c5-3 3-9-2-8-4 1-7 8-7 8s3 7 7 8c5 1 7-5 2-8z'/%3E%3C/g%3E%3Cg fill='%23fff7'%3E%3Ccircle cx='15' cy='15' r='6'/%3E%3Ccircle cx='75' cy='15' r='6'/%3E%3Ccircle cx='15' cy='75' r='6'/%3E%3Ccircle cx='75' cy='75' r='6'/%3E%3C/g%3E%3Cg fill='none' stroke='%237a1f4b'%3E%3Crect x='1.5' y='1.5' width='87' height='87' stroke-width='3'/%3E%3Crect x='28.5' y='28.5' width='33' height='33' stroke-width='2.4'/%3E%3C/g%3E%3C/svg%3E"); font-family: 'Amiri Quran', 'Amiri', 'Scheherazade New', 'Traditional Arabic', serif; color: #14110f; }
    .tp.blue { --bg: #f5f9ff; --edge: #2f6db5; --cfill: #e1eeff; --ctext: #0c2a55; --num: #1d3d6b; --h1: #e4efff; --h2: #cde1fb; --mst: #2a63ad; --med: #cde1fb; --frame: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 90 90'%3E%3Crect width='90' height='90' fill='%23b9d3f3'/%3E%3Cg fill='%231565c0'%3E%3Cpath d='M45 22c-3-5-9-3-8 2 1 4 8 7 8 7s7-3 8-7c1-5-5-7-8-2z' transform='translate(0 -3) scale(1 .9) translate(0 4)'/%3E%3Cpath d='M45 68c-3-5-9-3-8 2 1 4 8 7 8 7s7-3 8-7c1-5-5-7-8-2z' transform='translate(0 8) scale(1 -.9) translate(0 -150)'/%3E%3Cpath d='M22 45c-5-3-3-9 2-8 4 1 7 8 7 8s-3 7-7 8c-5 1-7-5-2-8z' transform='translate(0 0)'/%3E%3Cpath d='M68 45c5-3 3-9-2-8-4 1-7 8-7 8s3 7 7 8c5 1 7-5 2-8z'/%3E%3C/g%3E%3Cg fill='%23fff7'%3E%3Ccircle cx='15' cy='15' r='6'/%3E%3Ccircle cx='75' cy='15' r='6'/%3E%3Ccircle cx='15' cy='75' r='6'/%3E%3Ccircle cx='75' cy='75' r='6'/%3E%3C/g%3E%3Cg fill='none' stroke='%231b4a86'%3E%3Crect x='1.5' y='1.5' width='87' height='87' stroke-width='3'/%3E%3Crect x='28.5' y='28.5' width='33' height='33' stroke-width='2.4'/%3E%3C/g%3E%3C/svg%3E"); }
    .tp.night { filter: invert(1) hue-rotate(180deg) brightness(.92); }
    .frame { position: absolute; inset: 1.4cqw; border: 3.4cqw solid transparent; border-image: var(--frame) 30 round; }
    .inner { position: absolute; inset: 0; display: flex; flex-direction: column; padding: .4cqw 1.2cqw .2cqw; }
    .hd { display: flex; justify-content: space-between; align-items: center; height: 6.2cqw; font-size: 3.5cqw; }
    .cart { border: .35cqw solid var(--edge); border-radius: 1.2cqw; background: var(--cfill); padding: .1cqw 2.4cqw; color: var(--ctext); line-height: 1.5; }
    .body { flex: 1; display: grid; grid-auto-rows: calc(100% / 15); align-content: center; }
    .ln { display: flex; justify-content: space-between; align-items: center; white-space: nowrap; font-size: calc(5.6cqw * var(--k, 1)); line-height: 1; }
    .ln.mid { justify-content: center; gap: .32em; }
    .w { display: inline-block; } .w.red { color: #c0143c; }
    .q { color: var(--edge); font-size: .62em; }
    .vn { display: inline-flex; align-items: center; justify-content: center; width: 1.45em; height: 1.45em; flex: none; border-radius: 50%; border: .06em solid var(--mst); background: radial-gradient(circle, #fff 38%, var(--med) 100%); font-size: .74em; font-style: normal; color: var(--ctext); }
    .vn i { font-style: normal; line-height: 1; font-size: .66em; padding-top: .1em; }
    .hdr { display: flex; align-items: center; justify-content: center; font-size: 4.9cqw; border: .35cqw solid var(--edge); border-radius: 1.6cqw; background: linear-gradient(var(--h1), var(--h2)); color: var(--ctext); margin: .5cqw 0; color: #4a1030; }
    .bsm { display: flex; align-items: center; justify-content: center; font-size: 4.9cqw; }
    .ft { height: 4.6cqw; display: flex; align-items: center; justify-content: center; line-height: 1; font-size: 3.2cqw; color: var(--num); }
    .w { cursor: pointer; } .w.sel { background: color-mix(in srgb, var(--edge) 22%, transparent); border-radius: .2em; }
    .sheet { position: absolute; left: 3cqw; right: 3cqw; bottom: 3cqw; max-height: 62%; overflow: auto; background: var(--bg); border: .35cqw solid var(--edge); border-radius: 2cqw; padding: 2.2cqw 3cqw; box-shadow: 0 .8cqw 3cqw rgba(0,0,0,.28); font-size: 3.2cqw; color: var(--ctext); z-index: 5; }
    .sheet .x { position: absolute; top: 1cqw; left: 1.4cqw; border: 0; background: transparent; font-size: 3.4cqw; cursor: pointer; color: var(--ctext); }
    .sheet .wd { font-size: 7cqw; text-align: center; line-height: 1.5; } .sheet .ref { text-align: center; opacity: .7; }
    .sheet .row { text-align: center; margin: 1cqw 0; font-size: 3.6cqw; } .sheet .note { opacity: .6; font-size: 2.8cqw; }
    .sheet .vt { margin: 1.4cqw 0; line-height: 1.5; font-size: 3cqw; } .sheet .msg { text-align: center; opacity: .7; }
    .sheet .tabs { display: flex; gap: 1.5cqw; justify-content: center; margin: 1cqw 0; } .sheet .tabs button { border: .3cqw solid var(--edge); background: transparent; color: var(--ctext); border-radius: 1.2cqw; padding: .6cqw 2cqw; font-size: 2.8cqw; cursor: pointer; } .sheet .tabs button.on { background: var(--cfill); }
    .sheet .tf { line-height: 1.7; font-size: 3cqw; white-space: pre-line; }
    .wait { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 8cqw; color: #bbb; }
  `]
})
export class MushafTextPageComponent implements OnChanges {
  @Input({ required: true }) page = 1;
  @Input() night = false;
  @Input() theme: 'rose' | 'blue' = 'rose';
  private svc = inject(MushafTextService);
  private idxSvc = inject(MushafIndexService);
  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  names = SURAH_AR;
  lines = signal<MushafLine[]>([]);
  failed = signal(false);
  sel = signal<WordSel | null>(null);
  ar = arNum;
  red = isRed;
  isNum = (t: unknown) => typeof t === 'number';
  tokens = (l: MushafLine) => (l[0] === 'L' ? l[1] : []);
  juzName = () => 'الجزء ' + JUZ_ORDINAL_AR[juzOfPage(this.page) - 1];
  surah = () => SURAH_AR[surahOfPage(this.page) - 1];

  ngOnChanges() {
    this.sel.set(null);
    const p = this.page;
    this.svc.load().then(d => {
      if (p !== this.page) return;
      this.failed.set(false);
      this.lines.set(d[p - 1] ?? []);
      const run = () => requestAnimationFrame(() => this.fit());
      try { (document as any).fonts?.ready?.then(run) ?? run(); } catch { run(); }
    }).catch(() => this.failed.set(true));
  }

  close() { this.sel.set(null); }

  /** tap a word: show its meaning and the verse translation; tafsir is loaded on request */
  async tap(li: number, ti: number, word: string) {
    const cur = this.sel();
    if (cur && cur.li === li && cur.ti === ti) { this.close(); return; }
    try {
      const idx = await this.idxSvc.load();
      const loc = locateWord(idx, this.page, this.lines(), li, ti);
      const w: WordSel = { li, ti, word, ...loc, busy: true, error: '', tafsir: '', tafsirText: '' };
      this.sel.set(w);
      const key = `${loc.surah}:${loc.ayah}`;
      const r = await fetch(`${apiBase()}/verses/by_key/${key}?words=true&word_fields=transliteration&translations=20&language=en`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const v = (await r.json()).verse ?? {};
      const words = (v.words ?? []).filter((x: any) => !x.char_type_name || x.char_type_name === 'word');
      // the word meaning is only used when this text and Quran.com split the verse into the same number of words
      const hit = words.length === loc.total ? words[loc.pos - 1] : null;
      const info = { meaning: hit?.translation?.text ?? '', translit: hit?.transliteration?.text ?? '', verse: stripHtml(v.translations?.[0]?.text ?? '') };
      if (this.sel() === w) this.sel.set({ ...w, busy: false, info });
    } catch (e: any) {
      const c = this.sel();
      this.sel.set({ ...(c ?? { li, ti, word, surah: 0, ayah: 0, pos: 0, total: 0, tafsir: '' as const, tafsirText: '' }), busy: false, error: 'تعذّر التحميل - يلزم الاتصال بالإنترنت / Needs an internet connection' });
    }
  }

  async loadTafsir(lang: 'ar' | 'en') {
    const w = this.sel(); if (!w) return;
    this.sel.set({ ...w, tafsir: lang, tafsirText: '…' });
    try {
      const r = await fetch(`${apiBase()}/tafsirs/${TAFSIR_ID[lang]}/by_ayah/${w.surah}:${w.ayah}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = stripHtml(((await r.json()).tafsir?.text) ?? '') || '—';
      const c = this.sel(); if (c && c.li === w.li && c.ti === w.ti) this.sel.set({ ...c, tafsir: lang, tafsirText: text });
    } catch {
      const c = this.sel(); if (c) this.sel.set({ ...c, tafsirText: 'تعذّر التحميل / Could not load' });
    }
  }

  /** shrink a line that is too wide for the page, centre a line that is much narrower (end of a surah) */
  private fit() {
    const body = this.el.nativeElement.querySelector('.body') as HTMLElement | null;
    if (!body) return;
    const lines = Array.from(body.querySelectorAll<HTMLElement>('.ln'));
    for (const ln of lines) { ln.style.removeProperty('--k'); ln.classList.remove('mid'); }
    const W = body.clientWidth;
    for (const ln of lines) {
      const kids = Array.from(ln.children) as HTMLElement[];
      const gap = parseFloat(getComputedStyle(ln).fontSize) * 0.22 * Math.max(0, kids.length - 1);
      const nat = kids.reduce((s, c) => s + c.getBoundingClientRect().width, 0) + gap;
      if (nat > W) ln.style.setProperty('--k', String(Math.max(.6, (W / nat) * 0.985)));
      else if (nat < W * 0.72) ln.classList.add('mid');
    }
  }
}
