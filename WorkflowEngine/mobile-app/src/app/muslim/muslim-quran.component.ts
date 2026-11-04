import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '../core/translate.pipe';
import { I18nService } from '../core/i18n.service';
import { MuslimService } from './muslim.service';
import { Ayah, Edition, QuranService, SurahInfo } from './quran.service';
import { MushafReaderComponent } from './muslim-mushaf.component';
import { SURAH_START, surahOfPage } from './mushaf-data';

interface Row { n: number; global: number; ar: string; tr: string; tafsir: string; }

@Component({
  selector: 'app-muslim-quran',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, MushafReaderComponent],
  template: `
    <div class="seg" role="tablist">
      <button role="tab" [class.on]="view() === 'mushaf'" (click)="setView('mushaf')">{{ 'mus.q.mushaf' | translate }}</button>
      <button role="tab" [class.on]="view() === 'text'" (click)="setView('text')">{{ 'mus.q.textview' | translate }}</button>
    </div>
    <div class="layout">
      <aside class="card list">
        <div class="card-head"><input class="q" [(ngModel)]="filter" [placeholder]="'mus.q.search' | translate"></div>
        <div class="items">
          <button *ngFor="let s of shown()" [class.on]="s.number === shownSurah()" (click)="open(s.number)">
            <span class="no">{{ s.number }}</span><span class="nm"><b>{{ s.englishName }}</b><small>{{ s.englishNameTranslation }} · {{ s.numberOfAyahs }}</small></span><span class="ara">{{ s.name }}</span>
          </button>
          <p class="dim pad" *ngIf="!all().length">{{ err() ? ('mus.offline' | translate) : ('mus.loading' | translate) }}</p>
        </div>
      </aside>

      <app-mushaf-reader *ngIf="view() === 'mushaf'" />
      <section class="card reader" *ngIf="view() === 'text'">
        <div class="card-head bar">
          <h3>{{ info()?.englishName }} <span class="ara big" *ngIf="info()">{{ info()?.name }}</span></h3>
          <label class="inl">{{ 'mus.q.translation' | translate }}
            <select [ngModel]="trId()" (ngModelChange)="setTr($event)"><option value="">{{ 'mus.q.none' | translate }}</option>
              <optgroup [label]="'mus.q.yourlang' | translate"><option *ngFor="let e of trMine()" [value]="e.identifier">{{ e.name }}</option></optgroup>
              <optgroup [label]="'mus.q.otherlang' | translate"><option *ngFor="let e of trOther()" [value]="e.identifier">{{ e.language }} · {{ e.name }}</option></optgroup>
            </select></label>
          <label class="inl">{{ 'mus.q.tafsir' | translate }}
            <select [ngModel]="tfId()" (ngModelChange)="setTf($event)"><option value="">{{ 'mus.q.none' | translate }}</option>
              <option *ngFor="let e of tafsirs()" [value]="e.identifier">{{ e.language }} · {{ e.name }}</option></select></label>
          <label class="inl">A <input type="range" min="22" max="48" [ngModel]="m.s().arSize" (ngModelChange)="m.save({ arSize: +$event })"></label>
        </div>
        <div class="bar2">
          <button (click)="playSurah()">{{ playing() ? ('mus.q.stop' | translate) : ('mus.q.play' | translate) }}</button>
          <button *ngIf="last() && last()!.s !== cur()" (click)="open(last()!.s)">{{ 'mus.q.continue' | translate }} ({{ last()!.s }}:{{ last()!.a }})</button>
          <span class="dim sm" *ngIf="busy()">{{ 'mus.loading' | translate }}</span>
          <span class="flash bad" *ngIf="rerr()">{{ 'mus.offline' | translate }}</span>
        </div>
        <div class="basmala ar" *ngIf="cur() !== 1 && cur() !== 9 && rows().length" [style.font-size.px]="m.s().arSize">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>
        <div class="ayah" *ngFor="let r of rows()" [id]="'a' + r.n" [class.now]="playingN() === r.n">
          <div class="tools"><span class="num">{{ cur() }}:{{ r.n }}</span>
            <button (click)="playAyah(r)" [title]="'mus.q.listen' | translate">▶</button>
            <button (click)="mark(r)" [class.on]="isMarked(r)" [title]="'mus.q.bookmark' | translate">★</button>
            <button (click)="copy(r)" [title]="'mus.q.copy' | translate">⧉</button>
            <button *ngIf="tfId()" (click)="toggle(r.n)" [class.on]="openTf().has(r.n)">{{ 'mus.explain' | translate }}</button></div>
          <div class="ar" dir="rtl" [style.font-size.px]="m.s().arSize">{{ r.ar }} <span class="end">﴿{{ r.n }}﴾</span></div>
          <p class="tr" *ngIf="r.tr">{{ r.tr }}</p>
          <div class="tf" *ngIf="openTf().has(r.n)" [attr.dir]="tfRtl() ? 'rtl' : 'ltr'"><b>{{ 'mus.explain' | translate }}</b> {{ r.tafsir || ('mus.q.notafsir' | translate) }}</div>
        </div>
        <p class="dim pad" *ngIf="!rows().length && !busy() && !rerr()">{{ 'mus.q.choose' | translate }}</p>
      </section>
    </div>
  `,
  styles: [`
    .seg { display: inline-flex; margin-bottom: 12px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; } .seg button { padding: 7px 18px; border: 0; background: none; cursor: pointer; color: var(--text-2); font-weight: 550; } .seg button.on { background: var(--primary); color: #fff; }
    .layout { display: grid; grid-template-columns: 300px 1fr; gap: 14px; align-items: start; } @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .items { max-height: 260px !important; } }
    .list { position: sticky; top: 12px; } .items { max-height: calc(100vh - 190px); overflow: auto; }
    .q { width: 100%; } .items button { display: flex; width: 100%; align-items: center; gap: 10px; text-align: start; padding: 8px 12px; border: 0; background: none; border-bottom: 1px solid var(--border); cursor: pointer; color: var(--text); }
    .items button.on { background: var(--primary-soft, var(--surface-3)); } .no { width: 28px; color: var(--text-dim); font-variant-numeric: tabular-nums; } .nm { flex: 1; display: flex; flex-direction: column; } .nm small { color: var(--text-dim); font-size: 11px; }
    .ara { font-family: 'Amiri', 'Scheherazade New', 'Traditional Arabic', 'Noto Naskh Arabic', serif; font-size: 18px; } .ara.big { font-size: 22px; margin-inline-start: 8px; }
    .bar { flex-wrap: wrap; gap: 12px; } .inl { display: inline-flex; flex-direction: column; font-size: 11.5px; color: var(--text-2); gap: 2px; } .inl select { max-width: 230px; }
    .bar2 { display: flex; gap: 8px; align-items: center; padding: 10px 18px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    .basmala { text-align: center; padding: 18px 0 4px; } .ayah { padding: 14px 18px; border-bottom: 1px solid var(--border); } .ayah.now { background: var(--primary-soft, var(--surface-3)); }
    .ar { font-family: 'Amiri', 'Scheherazade New', 'Traditional Arabic', 'Noto Naskh Arabic', serif; line-height: 2.1; } .ayah .ar { font-size: 30px; } .end { color: var(--primary); font-size: .6em; }
    .tools { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; } .tools .num { font-size: 11px; color: var(--text-dim); margin-inline-end: auto; } .tools button { padding: 2px 8px; font-size: 12px; } .tools button.on { color: var(--primary); font-weight: 700; }
    .tr { margin: 6px 0 0; line-height: 1.7; } .tf { margin-top: 8px; padding: 10px 12px; background: var(--surface-3); border-radius: 8px; font-size: 13.5px; line-height: 1.8; }
    .dim { color: var(--text-dim); } .sm { font-size: 12px; } .pad { padding: 16px; }
  `]
})
export class MuslimQuranComponent implements OnInit, OnDestroy {
  m = inject(MuslimService);
  private q = inject(QuranService);
  private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private el = inject(ElementRef);

  all = signal<SurahInfo[]>([]); err = signal(false); rerr = signal(false); busy = signal(false);
  editions = signal<Edition[]>([]);
  cur = signal(0);
  view = computed(() => this.m.s().view ?? 'mushaf');
  shownSurah = computed(() => this.view() === 'mushaf' ? surahOfPage(this.m.s().mpage ?? 1) : this.cur());
  info = signal<SurahInfo | null>(null);
  rows = signal<Row[]>([]);
  openTf = signal<Set<number>>(new Set());
  filter = '';
  trId = signal(''); tfId = signal('');
  playing = signal(false); playingN = signal(0);
  private audio?: HTMLAudioElement;
  private queue: Row[] = [];
  marks = signal<string[]>(this.readMarks());
  last = signal<{ s: number; a: number } | null>(this.readLast());

  shown = computed(() => { const f = this.filter.trim().toLowerCase(); return !f ? this.all() : this.all().filter(s => String(s.number) === f || s.englishName.toLowerCase().includes(f) || s.englishNameTranslation.toLowerCase().includes(f) || s.name.includes(this.filter.trim())); });
  private lang = () => this.i18n.lang();
  trMine = computed(() => this.editions().filter(e => e.type === 'translation' && e.language === this.lang()));
  trOther = computed(() => this.editions().filter(e => e.type === 'translation' && e.language !== this.lang()));
  tafsirs = computed(() => { const l = this.lang(); return this.editions().filter(e => e.type === 'tafsir').sort((a, b) => (a.language === l ? 0 : a.language === 'ar' ? 1 : 2) - (b.language === l ? 0 : b.language === 'ar' ? 1 : 2)); });
  tfRtl = computed(() => ['ar', 'ur', 'fa', 'he'].includes(this.editions().find(e => e.identifier === this.tfId())?.language ?? ''));

  async ngOnInit() {
    const s = this.m.s();
    this.trId.set(s.tr || this.q.defaultTranslation()); this.tfId.set(s.tafsir || this.q.defaultTafsir());
    this.q.surahs().then(l => this.all.set(l)).catch(() => this.err.set(true));
    this.q.editions().then(l => this.editions.set(l)).catch(() => { /* the reader still works with the defaults */ });
    this.route.paramMap.subscribe(p => { const n = +(p.get('n') ?? 0); if (n >= 1 && n <= 114) { if (this.view() === 'mushaf') this.m.save({ mpage: SURAH_START[n - 1] }); else void this.load(n); } });
  }
  ngOnDestroy() { this.stopAudio(); }

  open(n: number) {
    if (this.view() === 'mushaf') { this.m.save({ mpage: SURAH_START[n - 1] }); return; }
    void this.router.navigate(['/muslim/quran', n]);
  }
  setView(v: 'mushaf' | 'text') {
    if (v === this.view()) return;
    if (v === 'mushaf') { if (this.cur()) this.m.save({ view: v, mpage: SURAH_START[this.cur() - 1] }); else this.m.save({ view: v }); }
    else { const n = surahOfPage(this.m.s().mpage ?? 1); this.m.save({ view: v }); void this.router.navigate(['/muslim/quran', n]); setTimeout(() => void this.load(n), 0); }
  }
  setTr(id: string) { this.trId.set(id); this.m.save({ tr: id }); if (this.cur()) void this.load(this.cur()); }
  setTf(id: string) { this.tfId.set(id); this.m.save({ tafsir: id }); if (this.cur()) void this.load(this.cur()); }

  async load(n: number) {
    this.stopAudio(); this.cur.set(n); this.busy.set(true); this.rerr.set(false); this.rows.set([]); this.openTf.set(new Set());
    try {
      const [ar, tr, tf] = await Promise.all([this.q.surah(n, 'quran-uthmani'), this.q.surah(n, this.trId()).catch(() => ({ ayahs: [] as Ayah[], info: {} as SurahInfo })), this.q.surah(n, this.tfId()).catch(() => ({ ayahs: [] as Ayah[], info: {} as SurahInfo }))]);
      this.info.set(ar.info);
      this.rows.set(ar.ayahs.map((a, i) => ({ n: a.numberInSurah, global: a.number, ar: this.q.clean(n, a), tr: tr.ayahs[i]?.text ?? '', tafsir: tf.ayahs[i]?.text ?? '' })));
      const l = this.last(); if (l && l.s === n) setTimeout(() => this.el.nativeElement.querySelector('#a' + l.a)?.scrollIntoView({ block: 'center' }), 50);
    } catch { this.rerr.set(true); }
    this.busy.set(false);
  }

  toggle(n: number) { const s = new Set(this.openTf()); s.has(n) ? s.delete(n) : s.add(n); this.openTf.set(s); }

  // ---- audio (verse by verse, Mishary Alafasy via the public Islamic Network CDN)
  playAyah(r: Row) { this.queue = []; this.play(r); }
  playSurah() { if (this.playing()) { this.stopAudio(); return; } this.queue = [...this.rows()]; const f = this.queue.shift(); if (f) this.play(f); }
  private play(r: Row) {
    this.audio?.pause(); this.audio = new Audio(this.q.audioUrl(r.global)); this.playing.set(true); this.playingN.set(r.n);
    this.setLast(this.cur(), r.n);
    this.audio.onended = () => { const nx = this.queue.shift(); if (nx) { this.play(nx); this.el.nativeElement.querySelector('#a' + nx.n)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else this.stopAudio(); };
    this.audio.onerror = () => this.stopAudio();
    void this.audio.play().catch(() => this.stopAudio());
  }
  stopAudio() { this.audio?.pause(); this.audio = undefined; this.queue = []; this.playing.set(false); this.playingN.set(0); }

  // ---- bookmarks / last read / copy
  private readMarks(): string[] { try { return JSON.parse(localStorage.getItem('we.quran.marks') || '[]'); } catch { return []; } }
  private readLast() { try { return JSON.parse(localStorage.getItem('we.quran.last') || 'null'); } catch { return null; } }
  private setLast(s: number, a: number) { this.last.set({ s, a }); try { localStorage.setItem('we.quran.last', JSON.stringify({ s, a })); } catch { /* ignore */ } }
  isMarked(r: Row) { return this.marks().includes(this.cur() + ':' + r.n); }
  mark(r: Row) {
    const k = this.cur() + ':' + r.n; const l = this.isMarked(r) ? this.marks().filter(x => x !== k) : [...this.marks(), k];
    this.marks.set(l); try { localStorage.setItem('we.quran.marks', JSON.stringify(l)); } catch { /* ignore */ } this.setLast(this.cur(), r.n);
  }
  copy(r: Row) { const t = `${r.ar}\n${r.tr}\n(${this.info()?.englishName} ${this.cur()}:${r.n})`; try { void navigator.clipboard.writeText(t); } catch { /* ignore */ } }
}
