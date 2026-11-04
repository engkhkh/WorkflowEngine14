import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../core/translate.pipe';
import { LocalDatePipe } from '../shared/ui';
import { I18nService } from '../core/i18n.service';
import { MuslimService } from './muslim.service';
import { QuranService, VerseOfDay } from './quran.service';
import { CITIES, COUNTRIES } from './muslim-data';
import { METHODS, PRAYERS, Prayer, defaultHanafi, defaultMethod } from './prayer-times';

@Component({
  selector: 'app-muslim-times',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, LocalDatePipe],
  template: `
    <div class="warnbox" *ngIf="!m.s().placeSet">{{ 'mus.pickplace' | translate }}</div>

    <div class="hero card">
      <div class="hl">
        <div class="place">{{ m.s().city || ('mus.custom' | translate) }}<span *ngIf="m.s().cc"> · {{ country(m.s().cc) }}</span></div>
        <div class="dates">{{ m.now() | ldate }} · <b>{{ m.hijri() }}</b></div>
        <div class="next"><span>{{ 'mus.next' | translate }}</span> <b>{{ m.name(m.next().prayer) }}</b> <em>{{ m.fmt(m.next().at) }}</em></div>
        <div class="cd">{{ m.countdown() }}</div>
      </div>
      <div class="qb" [title]="'mus.qibla' | translate">
        <div class="dial"><i class="kaaba" [style.transform]="'rotate(' + m.qibla().bearing + 'deg)'"><b></b></i><span class="n">N</span></div>
        <small>{{ 'mus.qibla' | translate }}: <b>{{ m.qibla().bearing | number:'1.0-0' }}°</b> · {{ m.qibla().km | number:'1.0-0' }} km</small>
      </div>
    </div>

    <div class="two mt">
      <div class="card">
        <div class="card-head"><h3>{{ 'mus.today' | translate }}</h3>
          <div class="seg"><button [class.on]="!monthly()" (click)="monthly.set(false)">{{ 'mus.day' | translate }}</button><button [class.on]="monthly()" (click)="monthly.set(true)">{{ 'mus.month' | translate }}</button></div></div>
        <div class="card-body" *ngIf="!monthly()">
          <div class="prow" *ngFor="let p of prayers" [class.cur]="m.next().prayer === p">
            <span class="pn">{{ m.name(p) }}</span>
            <span class="pt">{{ m.fmt(m.today().at[p]) }}</span>
            <button class="bell" [class.on]="m.s().remind[p].on" (click)="toggle(p)" [title]="'mus.remind' | translate">{{ m.s().remind[p].on ? '🔔' : '🔕' }}</button>
          </div>
          <p class="dim sm" *ngIf="hasNaN()">{{ 'mus.polar' | translate }}</p>
        </div>
        <div class="card-body" *ngIf="monthly()" style="overflow:auto">
          <table class="data"><thead><tr><th>#</th><th *ngFor="let p of prayers">{{ m.name(p) }}</th></tr></thead>
            <tbody><tr *ngFor="let r of month()" [class.cur]="r.today"><td>{{ r.d }}</td><td *ngFor="let p of prayers">{{ m.fmt(r.t.at[p]) }}</td></tr></tbody></table>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>{{ 'mus.place' | translate }}</h3></div>
        <div class="card-body form-grid">
          <label>{{ 'mus.country' | translate }}
            <select [ngModel]="m.s().cc" (ngModelChange)="setCountry($event)">
              <option value="">{{ 'mus.custom' | translate }}</option>
              <option *ngFor="let c of countries()" [value]="c.code">{{ c.name }}</option>
            </select></label>
          <label>{{ 'mus.city' | translate }}
            <select [ngModel]="m.s().city" (ngModelChange)="setCity($event)" [disabled]="!m.s().cc">
              <option *ngFor="let c of cities()" [value]="c[0]">{{ c[0] }}</option>
            </select></label>
          <label>{{ 'mus.lat' | translate }}<input type="number" step="0.0001" [ngModel]="m.s().lat" (ngModelChange)="coord('lat', $event)"></label>
          <label>{{ 'mus.lng' | translate }}<input type="number" step="0.0001" [ngModel]="m.s().lng" (ngModelChange)="coord('lng', $event)"></label>
          <label class="full">{{ 'mus.tz' | translate }}
            <select [ngModel]="m.s().tz" (ngModelChange)="m.save({ tz: $event })"><option *ngFor="let z of zones" [value]="z">{{ z }}</option></select></label>
          <div class="full row"><button (click)="locate()">📍 {{ 'mus.locate' | translate }}</button><span class="dim sm">{{ geoMsg() }}</span></div>
          <label class="full">{{ 'mus.method' | translate }}
            <select [ngModel]="m.s().method" (ngModelChange)="m.save({ method: $event })"><option *ngFor="let x of methods" [value]="x.id">{{ x.name }}</option></select></label>
          <label>{{ 'mus.asr.label' | translate }}
            <select [ngModel]="m.s().hanafi" (ngModelChange)="m.save({ hanafi: $event })"><option [ngValue]="false">{{ 'mus.asr.std' | translate }}</option><option [ngValue]="true">{{ 'mus.asr.hanafi' | translate }}</option></select></label>
          <label>{{ 'mus.highlat' | translate }}
            <select [ngModel]="m.s().highLat" (ngModelChange)="m.save({ highLat: $event })"><option value="angle">{{ 'mus.hl.angle' | translate }}</option><option value="seventh">{{ 'mus.hl.seventh' | translate }}</option><option value="middle">{{ 'mus.hl.middle' | translate }}</option></select></label>
          <label>{{ 'mus.hijriadj' | translate }}
            <select [ngModel]="m.s().hijriAdjust" (ngModelChange)="m.save({ hijriAdjust: +$event })"><option *ngFor="let n of [-2,-1,0,1,2]" [ngValue]="n">{{ n > 0 ? '+' + n : n }}</option></select></label>
          <label>{{ 'mus.clock' | translate }}
            <select [ngModel]="m.s().time24" (ngModelChange)="m.save({ time24: $event })"><option [ngValue]="false">12 h</option><option [ngValue]="true">24 h</option></select></label>
          <p class="full dim sm">{{ 'mus.adjhelp' | translate }}</p>
          <div class="full adj"><label *ngFor="let p of prayers">{{ m.name(p) }}<input type="number" step="1" [ngModel]="m.s().adjust[p] || 0" (ngModelChange)="adjust(p, $event)"></label></div>
        </div>
      </div>
    </div>

    <div class="two mt">
      <div class="card">
        <div class="card-head"><h3>{{ 'mus.reminders' | translate }}</h3></div>
        <div class="card-body">
          <div class="rrow" *ngFor="let p of prayers">
            <label class="chk"><input type="checkbox" [ngModel]="m.s().remind[p].on" (ngModelChange)="setRemind(p, { on: $event })"> {{ m.name(p) }}</label>
            <select [ngModel]="m.s().remind[p].before" (ngModelChange)="setRemind(p, { before: +$event })"><option *ngFor="let n of beforeOpts" [ngValue]="n">{{ n === 0 ? ('mus.atadhan' | translate) : ('mus.minbefore' | translate:{ n: n }) }}</option></select>
          </div>
          <div class="form-grid mt">
            <label>{{ 'mus.sound' | translate }}
              <select [ngModel]="m.s().sound" (ngModelChange)="m.save({ sound: $event })"><option value="chime">{{ 'mus.sound.chime' | translate }}</option><option value="url">{{ 'mus.sound.url' | translate }}</option><option value="none">{{ 'mus.sound.none' | translate }}</option></select></label>
            <label *ngIf="m.s().sound === 'url'">{{ 'mus.adhanurl' | translate }}<input [ngModel]="m.s().adhanUrl" (ngModelChange)="m.save({ adhanUrl: $event })" placeholder="https://…/adhan.mp3"></label>
            <label class="chk full"><input type="checkbox" [ngModel]="m.s().verse" (ngModelChange)="m.save({ verse: $event })"> {{ 'mus.withverse' | translate }}</label>
            <label *ngIf="m.s().verse">{{ 'mus.versetime' | translate }}<input type="time" [ngModel]="m.s().verseTime" (ngModelChange)="m.save({ verseTime: $event })"></label>
            <div class="full row"><button (click)="notify()">🔔 {{ 'mus.notify' | translate }}</button><button (click)="m.sound()">▶ {{ 'mus.test' | translate }}</button><button (click)="testReminder()">{{ 'mus.testremind' | translate }}</button></div>
            <p class="full dim sm">{{ notifMsg() }} {{ 'mus.openhelp' | translate }}</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>{{ 'mus.verse.title' | translate }}</h3><a routerLink="/muslim/quran" class="sm">{{ 'mus.tab.quran' | translate }} →</a></div>
        <div class="card-body">
          <ng-container *ngIf="verse() as v; else noverse">
            <div class="ar" dir="rtl">{{ v.ar }}</div>
            <p *ngIf="v.tr">{{ v.tr }}</p>
            <p class="dim sm" *ngIf="v.tafsir"><b>{{ 'mus.explain' | translate }}:</b> {{ v.tafsir }}</p>
            <p class="dim sm">{{ v.surah }} · {{ v.ref }}</p>
          </ng-container>
          <ng-template #noverse><p class="dim">{{ verseErr() ? ('mus.offline' | translate) : ('mus.loading' | translate) }}</p></ng-template>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .hero { display: flex; gap: 20px; justify-content: space-between; align-items: center; padding: 22px 26px; flex-wrap: wrap; background: linear-gradient(135deg, #064e3b, #047857); color: #fff; border: 0; }
    .place { font-size: 22px; font-weight: 700; } .dates { opacity: .85; margin: 4px 0 14px; } .next { font-size: 15px; } .next span { margin-inline-end: 6px; } .next em { font-style: normal; opacity: .85; margin-inline-start: 6px; }
    .cd { font-size: 44px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
    .qb { text-align: center; } .qb small { display: block; margin-top: 6px; opacity: .9; }
    .dial { width: 104px; height: 104px; border-radius: 50%; border: 2px solid rgba(255,255,255,.6); position: relative; margin: 0 auto; }
    .dial .n { position: absolute; top: 2px; left: 50%; transform: translateX(-50%); font-size: 11px; opacity: .8; }
    .kaaba { position: absolute; inset: 8px; } .kaaba b { position: absolute; top: 0; left: 50%; width: 0; height: 0; margin-left: -8px; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 44px solid #fbbf24; }
    .prow { display: flex; align-items: center; padding: 11px 12px; border-radius: 9px; gap: 10px; } .prow.cur { background: var(--primary-soft, var(--surface-3)); font-weight: 650; }
    .pn { flex: 1; } .pt { font-variant-numeric: tabular-nums; font-size: 17px; } .bell { background: none; border: 0; cursor: pointer; font-size: 16px; opacity: .55; } .bell.on { opacity: 1; }
    tr.cur td { background: var(--primary-soft, var(--surface-3)); font-weight: 650; } table.data td, table.data th { text-align: center; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; } @media (max-width: 1000px) { .two { grid-template-columns: 1fr; } } .mt { margin-top: 14px; }
    .adj { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; } .adj input { width: 100%; }
    .rrow { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 0; } .chk { display: flex; gap: 8px; align-items: center; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .dim { color: var(--text-dim); } .sm { font-size: 12px; }
    .ar { font-family: 'Amiri', 'Scheherazade New', 'Traditional Arabic', 'Noto Naskh Arabic', serif; font-size: 26px; line-height: 2; margin-bottom: 8px; }
    .warnbox { background: var(--warn-soft); color: var(--warn); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--text-2); } label.chk { flex-direction: row; }
  `]
})
export class MuslimTimesComponent implements OnInit {
  m = inject(MuslimService);
  i18n = inject(I18nService);
  private quran = inject(QuranService);
  prayers: Prayer[] = PRAYERS;
  methods = METHODS;
  beforeOpts = [0, 5, 10, 15, 20, 30, 45, 60];
  monthly = signal(false);
  verse = signal<VerseOfDay | null>(null);
  verseErr = signal(false);
  geoMsg = signal('');
  notifMsg = signal('');
  zones: string[] = (() => { try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return [this.m.s().tz]; } })();

  countries = computed(() => {
    let dn: Intl.DisplayNames | null = null; try { dn = new Intl.DisplayNames([this.i18n.locale], { type: 'region' }); } catch { /* old browser */ }
    return COUNTRIES.map(code => ({ code, name: dn?.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, this.i18n.locale));
  });
  country(cc: string) { try { return new Intl.DisplayNames([this.i18n.locale], { type: 'region' }).of(cc) ?? cc; } catch { return cc; } }
  cities = computed(() => CITIES[this.m.s().cc] ?? []);
  hasNaN = computed(() => PRAYERS.some(p => !this.m.today().at[p]));

  month = computed(() => {
    const [y, mo, d0] = this.m.today().ymd; const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => ({ d: i + 1, today: i + 1 === d0, t: this.m.day(y, mo, i + 1) }));
  });

  ngOnInit() {
    const s = this.m.s();
    this.quran.verseOfDay(s.tr || this.quran.defaultTranslation(), s.tafsir || this.quran.defaultTafsir()).then(v => { this.verse.set(v); this.verseErr.set(!v); });
    this.notifMsg.set(typeof Notification === 'undefined' ? '' : Notification.permission === 'granted' ? '✓' : '');
  }

  setCountry(cc: string) {
    if (!cc) { this.m.save({ cc: '' }); return; }
    const c = CITIES[cc][0];
    this.m.save({ cc, city: c[0], lat: c[1], lng: c[2], tz: c[3], placeSet: true, method: defaultMethod(cc), hanafi: defaultHanafi(cc) });
  }
  setCity(name: string) { const c = this.cities().find(x => x[0] === name); if (c) this.m.save({ city: c[0], lat: c[1], lng: c[2], tz: c[3], placeSet: true }); }
  coord(k: 'lat' | 'lng', v: number) { if (v == null || isNaN(+v)) return; const x = Math.max(k === 'lat' ? -90 : -180, Math.min(k === 'lat' ? 90 : 180, +v)); this.m.save({ [k]: x, city: '', cc: '', placeSet: true } as any); }
  adjust(p: Prayer, v: number) { this.m.save({ adjust: { ...this.m.s().adjust, [p]: Math.max(-60, Math.min(60, +v || 0)) } }); }
  setRemind(p: Prayer, patch: Partial<{ on: boolean; before: number }>) { const r = this.m.s().remind; this.m.save({ remind: { ...r, [p]: { ...r[p], ...patch } } }); }
  toggle(p: Prayer) { this.setRemind(p, { on: !this.m.s().remind[p].on }); }

  locate() {
    if (!navigator.geolocation) { this.geoMsg.set(this.i18n.t('mus.geo.no')); return; }
    this.geoMsg.set('…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        let tz = this.m.s().tz; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch { /* keep */ }
        this.m.save({ lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4), city: '', cc: '', tz, placeSet: true });
        this.geoMsg.set('✓');
      },
      () => this.geoMsg.set(this.i18n.t('mus.geo.denied')), { timeout: 10000 });
  }
  async notify() { const r = await this.m.askNotifications(); this.notifMsg.set(r === 'granted' ? '✓' : this.i18n.t('mus.notif.' + (r === 'unsupported' ? 'unsupported' : 'denied'))); }
  testReminder() { void this.m.fire(this.m.next().prayer, this.m.s().remind[this.m.next().prayer].before); }
}
