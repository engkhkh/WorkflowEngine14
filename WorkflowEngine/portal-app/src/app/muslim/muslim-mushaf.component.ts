import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../core/translate.pipe';
import { MuslimService } from './muslim.service';
import { MushafTextPageComponent } from './mushaf-text-page.component';
import { JUZ_START, MUSHAF_BASE, MUSHAF_PAGES, SURAH_AR, SURAH_START, clampPage, juzOfPage, pageFile, surahOfPage } from './mushaf-data';

/**
 * The Holy Quran as Mushaf page images (Madinah Mushaf, 604 pages). The page is kept in the Muslim settings (so reading resumes where it stopped);
 * the surah list of the Quran tab jumps to a surah's first page by saving the page into the same settings.
 */
@Component({
  selector: 'app-mushaf-reader',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, MushafTextPageComponent],
  template: `
    <section class="card mushaf" [class.night]="night()">
      <div class="bar">
        <button class="nav" (click)="go(page() + step())" [disabled]="page() + step() > max" [title]="'mus.q.next' | translate">❮</button>
        <label class="pg">{{ 'mus.q.page' | translate }}
          <input type="number" min="1" [max]="max" [ngModel]="page()" (change)="go(+$any($event.target).value)" (keydown.enter)="go(+$any($event.target).value)"> <span class="dim">/ {{ max }}</span></label>
        <button class="nav" (click)="go(page() - step())" [disabled]="page() - step() < 1" [title]="'mus.q.prev' | translate">❯</button>
        <span class="where ara" dir="rtl">{{ surahName() }} · {{ 'mus.q.juz' | translate }} {{ juz() }}</span>
        <label class="inl">{{ 'mus.q.juz' | translate }}
          <select [ngModel]="juz()" (ngModelChange)="go(juzStart[$event - 1])"><option *ngFor="let j of juzList" [ngValue]="j">{{ j }}</option></select></label>
        <span class="grow"></span>
        <button (click)="zoom(-10)" [title]="'mus.q.zoomout' | translate">−</button>
        <span class="dim sm z">{{ m.s().mzoom }}%</span>
        <button (click)="zoom(10)" [title]="'mus.q.zoomin' | translate">+</button>
        <button (click)="m.save({ mzoom: 100 })" [title]="'mus.q.fit' | translate">⤢</button>
        <button [class.on]="two()" class="wide" (click)="m.save({ mtwo: !two() })" [title]="'mus.q.twopage' | translate">▯▯</button>
        <button [class.on]="text()" class="wide" (click)="m.save({ mmode: text() ? 'img' : 'text' })" [title]="(text() ? 'mus.q.imgmode' : 'mus.q.textmode') | translate">{{ text() ? '🖼' : 'Aa' }}</button>
        <button *ngIf="text()" [class.on]="m.s().mtheme === 'blue'" (click)="m.save({ mtheme: m.s().mtheme === 'blue' ? 'rose' : 'blue' })" [title]="'mus.q.theme' | translate">🎨</button>
        <button [class.on]="night()" (click)="m.save({ mnight: !night() })" [title]="'mus.q.night' | translate">☾</button>
        <button [class.on]="isMarked()" (click)="mark()" [title]="'mus.q.bookmark' | translate">★</button>
        <select *ngIf="marks().length" [ngModel]="0" (ngModelChange)="$event && go($event)" class="bm">
          <option [ngValue]="0">★ {{ marks().length }}</option><option *ngFor="let p of marks()" [ngValue]="p">{{ 'mus.q.page' | translate }} {{ p }} · {{ names[surahOf(p) - 1] }}</option></select>
        <button (click)="full()" [title]="'mus.q.fullscreen' | translate">⛶</button>
      </div>

      <div class="stage" #stage (touchstart)="ts($event)" (touchend)="te($event)">
        <div class="spread" [class.two]="two()" [style.--w.px]="width()" dir="rtl">
          <figure *ngFor="let p of shownPages()" class="pg-box" [class.txt]="text()" [class.err]="!text() && failed().has(p)">
            <app-mushaf-text-page *ngIf="text()" [page]="p" [night]="night()" [theme]="m.s().mtheme"></app-mushaf-text-page>
            <img *ngIf="!text() && !failed().has(p)" [src]="url(p)" [alt]="('mus.q.page' | translate) + ' ' + p" (error)="fail(p)" draggable="false">
            <div class="miss" dir="auto" *ngIf="!text() && failed().has(p)">
              <p>{{ 'mus.q.imgerr' | translate }}</p>
              <button (click)="retry(p)">{{ 'mus.q.retry' | translate }}</button>
            </div>
            <figcaption>{{ p }}</figcaption>
          </figure>
        </div>
      </div>

      <details class="src">
        <summary>{{ 'mus.q.source' | translate }}</summary>
        <p class="dim sm">{{ 'mus.q.sourcehelp' | translate }}</p>
        <div class="row"><input [(ngModel)]="baseEdit" [placeholder]="defaultBase" dir="ltr">
          <button (click)="applyBase()">{{ 'mus.q.apply' | translate }}</button><button (click)="baseEdit = ''; applyBase()">{{ 'mus.q.default' | translate }}</button></div>
      </details>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; } .mushaf { overflow: hidden; min-width: 0; } .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); }
    .bar button { padding: 4px 10px; min-width: 34px; } .bar button.on { color: var(--primary); font-weight: 700; } .bar .nav { font-size: 16px; }
    .pg { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-2); } .pg input { width: 64px; } .inl { display: inline-flex; flex-direction: column; font-size: 11px; color: var(--text-2); }
    .grow { flex: 1; } .where { font-size: 18px; } .z { width: 40px; text-align: center; } .bm { max-width: 190px; }
    .ara { font-family: 'Amiri', 'Scheherazade New', 'Traditional Arabic', 'Noto Naskh Arabic', serif; }
    .stage { overflow: auto; padding: 14px; background: var(--surface-3); max-height: calc(100vh - 210px); text-align: center; touch-action: pan-y pinch-zoom; }
    .spread { display: inline-flex; gap: 2px; align-items: flex-start; justify-content: center; margin: 0 auto; }
    .pg-box { margin: 0; width: var(--w); max-width: none; position: relative; background: #fff; box-shadow: 0 2px 14px rgba(0, 0, 0, .18); aspect-ratio: 2600 / 4206; }
    .pg-box img { width: 100%; height: 100%; display: block; user-select: none; } .pg-box figcaption { position: absolute; bottom: -22px; left: 0; right: 0; font-size: 11px; color: var(--text-dim); }
    .pg-box.err { display: flex; align-items: center; justify-content: center; } .miss { padding: 20px; color: #444; font-size: 13px; }
    .pg-box.txt { background: transparent; } .two .pg-box:first-child { box-shadow: -10px 2px 14px rgba(0,0,0,.2), inset -14px 0 14px -12px rgba(0,0,0,.35); } .two .pg-box:last-child { box-shadow: 10px 2px 14px rgba(0,0,0,.2), inset 14px 0 14px -12px rgba(0,0,0,.35); }
    .night .stage { background: #0d0d0d; } .night .pg-box { background: #000; box-shadow: none; } .night .pg-box img { filter: invert(1) brightness(.92); } .night .pg-box figcaption { color: #888; }
    .src { padding: 8px 14px 12px; border-top: 1px solid var(--border); font-size: 12.5px; } .src .row { display: flex; gap: 8px; } .src input { flex: 1; }
    .dim { color: var(--text-dim); } .sm { font-size: 12px; }
    :host(:fullscreen) .stage, .mushaf:fullscreen .stage { max-height: calc(100vh - 56px); }
  `]
})
export class MushafReaderComponent implements AfterViewInit, OnDestroy {
  m = inject(MuslimService);
  private el = inject(ElementRef);
  max = MUSHAF_PAGES; juzStart = JUZ_START; names = SURAH_AR; juzList = Array.from({ length: 30 }, (_, i) => i + 1); defaultBase = MUSHAF_BASE;
  baseEdit = this.m.s().mbase ?? '';
  failed = signal<Set<number>>(new Set());
  private busted = new Map<number, number>();
  marks = signal<number[]>(this.readMarks());
  private vw = signal(typeof window !== 'undefined' ? window.innerWidth : 1200);
  /** width of the reading area (not the window: the side menu and the surah list take room) */
  private cw = signal(0);
  private ro?: ResizeObserver;
  private x0 = 0; private y0 = 0;

  page = computed(() => clampPage(this.m.s().mpage ?? 1));
  two = computed(() => !!this.m.s().mtwo && (this.cw() || this.vw() - 300) >= 760);
  text = computed(() => this.m.s().mmode === 'text');
  night = computed(() => !!this.m.s().mnight);
  step = computed(() => (this.two() ? 2 : 1));
  juz = computed(() => juzOfPage(this.page()));
  surahName = computed(() => 'سورة ' + SURAH_AR[surahOfPage(this.page()) - 1]);
  /** right page first: in the Mushaf the odd page is on the right of a spread */
  shownPages = computed(() => { const p = this.page(); if (!this.two()) return [p]; const o = p % 2 ? p : p - 1; return [o, o + 1].filter(x => x >= 1 && x <= MUSHAF_PAGES); });
  width = computed(() => {
    const z = (this.m.s().mzoom ?? 100) / 100; const avail = Math.max(240, (this.cw() || this.vw() - 300) - 30);
    const base = this.two() ? Math.min(560, (avail - 6) / 2) : Math.min(640, avail);
    return Math.round(base * z);
  });
  surahOf = surahOfPage;

  constructor() { this.preload(); }
  ngAfterViewInit() {
    const st = this.stageEl(); if (!st) return; this.cw.set(st.clientWidth);
    try { this.ro = new ResizeObserver(() => this.cw.set(st.clientWidth)); this.ro.observe(st); } catch { /* old browser: the window size is used */ }
  }
  ngOnDestroy() { this.ro?.disconnect(); }

  url(p: number) { const b = (this.m.s().mbase || MUSHAF_BASE).replace(/\/?$/, '/'); const v = this.busted.get(p); return b + pageFile(p) + (v ? '?r=' + v : ''); }
  go(p: number) { const n = clampPage(p); this.m.save({ mpage: n }); this.failed.set(new Set()); this.preload(); this.stageEl()?.scrollTo({ top: 0 }); }
  zoom(d: number) { this.m.save({ mzoom: Math.min(220, Math.max(50, (this.m.s().mzoom ?? 100) + d)) }); }
  fail(p: number) { const s = new Set(this.failed()); s.add(p); this.failed.set(s); }
  retry(p: number) { this.busted.set(p, Date.now()); const s = new Set(this.failed()); s.delete(p); this.failed.set(s); }
  applyBase() { this.m.save({ mbase: this.baseEdit.trim() }); this.failed.set(new Set()); }
  private stageEl(): HTMLElement | null { return this.el.nativeElement.querySelector('.stage'); }
  private preload() { for (const p of [this.page() + 1, this.page() + 2, this.page() - 1]) if (p >= 1 && p <= MUSHAF_PAGES) { try { const i = new Image(); i.src = this.url(p); } catch { /* ignore */ } } }

  // ---- bookmarks (pages), kept in this browser
  private readMarks(): number[] { try { return (JSON.parse(localStorage.getItem('we.quran.pmarks') || '[]') as number[]).filter(n => n >= 1 && n <= MUSHAF_PAGES).sort((a, b) => a - b); } catch { return []; } }
  isMarked() { return this.marks().includes(this.page()); }
  mark() {
    const p = this.page(); const l = (this.isMarked() ? this.marks().filter(x => x !== p) : [...this.marks(), p]).sort((a, b) => a - b);
    this.marks.set(l); try { localStorage.setItem('we.quran.pmarks', JSON.stringify(l)); } catch { /* ignore */ }
  }
  full() { const e = this.el.nativeElement.querySelector('.mushaf') as HTMLElement | null; if (!e) return; try { document.fullscreenElement ? void document.exitFullscreen() : void e.requestFullscreen(); } catch { /* ignore */ } }

  // ---- keyboard and swipe: the book opens from the right, so the next page is to the left
  @HostListener('document:keydown', ['$event']) key(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageDown') { e.preventDefault(); this.go(this.page() + this.step()); }
    else if (e.key === 'ArrowRight' || e.key === 'PageUp') { e.preventDefault(); this.go(this.page() - this.step()); }
  }
  @HostListener('window:resize') resized() { this.vw.set(window.innerWidth); }
  ts(e: TouchEvent) { this.x0 = e.changedTouches[0].clientX; this.y0 = e.changedTouches[0].clientY; }
  te(e: TouchEvent) {
    const dx = e.changedTouches[0].clientX - this.x0; const dy = e.changedTouches[0].clientY - this.y0;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5 || (this.m.s().mzoom ?? 100) > 110) return;
    this.go(this.page() + (dx > 0 ? this.step() : -this.step()));
  }
}
