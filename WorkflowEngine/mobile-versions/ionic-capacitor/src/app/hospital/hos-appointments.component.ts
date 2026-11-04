import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { HosRec, HospitalService, localToday } from './hospital.service';
import { HOS_CSS } from './hos-styles';

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (s: string) => { const [h, m] = (s || '0:0').split(':'); return (+h) * 60 + (+m || 0); };

@Component({
  selector: 'app-hos-appointments',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <div class="bar">
      <input type="date" [(ngModel)]="day" (ngModelChange)="load()" />
      <select [(ngModel)]="docFilter" (ngModelChange)="load()"><option value="">{{ 'hos.allDoctors' | translate }}</option><option *ngFor="let d of docs()" [value]="d.code">{{ d.data['name'] }}</option></select>
      <span class="grow"></span>
      <button class="primary" *ngIf="auth.can('hos.appointments.manage')" (click)="openBook()"><app-icon name="plus" [size]="15"></app-icon>{{ 'hos.bookAppt' | translate }}</button>
    </div>
    <p class="flash" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error && !form">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'hos.f.time' | translate }}</th><th>{{ 'hos.f.patient' | translate }}</th><th>{{ 'hos.f.doctor' | translate }}</th><th>{{ 'hos.f.reason' | translate }}</th><th>{{ 'hos.f.status' | translate }}</th><th></th></tr></thead>
      <tbody>
        <tr *ngFor="let a of list()">
          <td><b>{{ a.data['start']?.slice(11) }}</b> <span class="dim sm">– {{ a.data['end']?.slice(11) }}</span></td>
          <td>{{ a.data['patientName'] }} <span class="dim sm">{{ a.data['patient'] }}</span></td><td>{{ a.data['doctorName'] }}</td><td>{{ a.data['reason'] }}</td>
          <td><span class="chip" [class.ok]="a.status === 'Completed'" [class.info]="a.status === 'CheckedIn'" [class.bad]="a.status === 'Cancelled' || a.status === 'NoShow'">{{ 'hos.s.' + a.status | translate }}</span></td>
          <td class="num" *ngIf="auth.can('hos.appointments.manage')">
            <ng-container *ngIf="a.status === 'Booked'">
              <button class="sm primary" (click)="setStatus(a, 'CheckedIn')">{{ 'hos.checkIn' | translate }}</button>
              <button class="sm" (click)="setStatus(a, 'NoShow')">{{ 'hos.s.NoShow' | translate }}</button>
              <button class="sm" (click)="setStatus(a, 'Cancelled')">{{ 'common.cancel' | translate }}</button>
            </ng-container>
          </td>
        </tr>
        <tr *ngIf="!list().length"><td colspan="6" class="dim">{{ 'hos.none' | translate }}</td></tr>
      </tbody></table></div></div>

    <div class="modal-scrim" *ngIf="form" (click)="form = null"><div class="modal" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.bookAppt' | translate }}</h3><button class="ghost" (click)="form = null"><app-icon name="x"></app-icon></button></div>
      <div class="modal-body">
        <p class="flash bad" *ngIf="error">{{ error }}</p>
        <div class="form-grid">
          <div class="full"><label class="lbl">{{ 'hos.f.patient' | translate }} *</label>
            <input [placeholder]="'hos.searchPatient' | translate" [(ngModel)]="pq" (ngModelChange)="findPatients()" *ngIf="!form.patient" />
            <div class="row" *ngIf="form.patient"><b>{{ form.patientName }}</b><span class="dim">{{ form.patient }}</span><button class="sm" (click)="form.patient = ''">×</button></div>
            <div *ngIf="!form.patient"><div class="row" *ngFor="let p of found()"><span class="link" (click)="pick(p)">{{ p.data['name'] }} · {{ p.code }}</span></div></div></div>
          <div><label class="lbl">{{ 'hos.f.doctor' | translate }} *</label><select [(ngModel)]="form.doctor" (ngModelChange)="loadSlots()"><option value=""></option><option *ngFor="let d of docs()" [value]="d.code">{{ d.data['name'] }} — {{ d.data['specialty'] }}</option></select></div>
          <div><label class="lbl">{{ 'hos.f.date' | translate }} *</label><input type="date" [(ngModel)]="form.date" (ngModelChange)="loadSlots()" /></div>
          <div class="full" *ngIf="slots().length"><label class="lbl">{{ 'hos.freeSlots' | translate }}</label>
            <div class="row"><button class="sm" *ngFor="let s of slots()" [class.primary]="form.time === s" (click)="form.time = s">{{ s }}</button></div></div>
          <div><label class="lbl">{{ 'hos.f.time' | translate }} *</label><input type="time" [(ngModel)]="form.time" /></div>
          <div><label class="lbl">{{ 'hos.f.minutes' | translate }}</label><input type="number" min="5" max="240" [(ngModel)]="form.minutes" /></div>
          <div class="full"><label class="lbl">{{ 'hos.f.reason' | translate }}</label><input [(ngModel)]="form.reason" /></div>
        </div>
      </div>
      <div class="modal-foot"><button (click)="form = null">{{ 'common.cancel' | translate }}</button><button class="primary" [disabled]="busy" (click)="book()">{{ 'hos.bookAppt' | translate }}</button></div>
    </div></div>
  `,
  styles: [HOS_CSS]
})
export class HosAppointmentsComponent implements OnInit {
  auth = inject(AuthService); private api = inject(HospitalService); private i18n = inject(I18nService); private route = inject(ActivatedRoute); private router = inject(Router);
  list = signal<HosRec[]>([]); docs = signal<HosRec[]>([]); found = signal<HosRec[]>([]); slots = signal<string[]>([]);
  day = localToday(); docFilter = ''; form: any = null; pq = ''; error = ''; msg = ''; busy = false;
  ngOnInit() {
    this.api.records('doctor').subscribe(l => { this.docs.set(l.filter(d => d.status !== 'Inactive')); });
    this.load();
    const p = this.route.snapshot.queryParamMap.get('patient');
    if (p) this.api.records('patient', { q: p }).subscribe(l => { const x = l.find(r => r.code === p); if (x) { this.openBook(); this.pick(x); } });
  }
  load() { this.api.records('appointment', { ref: this.day, parent: this.docFilter, take: 500 }).subscribe({ next: l => this.list.set(l.sort((a, b) => (a.data['start'] ?? '').localeCompare(b.data['start'] ?? ''))), error: e => this.error = errMsg(e, this.i18n) }); }
  openBook() { this.error = ''; this.pq = ''; this.found.set([]); this.slots.set([]); this.form = { patient: '', patientName: '', doctor: this.docFilter, date: this.day, time: '', minutes: 0, reason: '' }; if (this.docFilter) this.loadSlots(); }
  findPatients() { if (this.pq.trim().length < 2) { this.found.set([]); return; } this.api.records('patient', { q: this.pq.trim(), take: 8 }).subscribe(l => this.found.set(l)); }
  pick(p: HosRec) { this.form.patient = p.code; this.form.patientName = p.data['name']; this.found.set([]); }
  /** free start times of the chosen doctor on the chosen day (the server re-checks when saving) */
  loadSlots() {
    this.slots.set([]);
    const d = this.docs().find(x => x.code === this.form.doctor); if (!d || !this.form.date) return;
    const dow = new Date(this.form.date + 'T00:00').getDay(); const days: number[] = d.data['days'] ?? [];
    if (days.length && !days.includes(dow)) return;
    const slot = +d.data['slot'] || 20; const from = mins(d.data['from'] || '08:00'), to = mins(d.data['to'] || '17:00');
    this.api.records('appointment', { ref: this.form.date, parent: d.code, take: 500 }).subscribe(l => {
      const busy = l.filter(a => a.status === 'Booked' || a.status === 'CheckedIn').map(a => [mins(a.data['start'].slice(11)), mins(a.data['end'].slice(11))]);
      const out: string[] = []; const now = new Date(); const today = localToday();
      for (let t = from; t + slot <= to; t += slot) {
        if (this.form.date === today && t < now.getHours() * 60 + now.getMinutes()) continue;
        if (!busy.some(([s, e]) => t < e && s < t + slot)) out.push(hm(t));
      }
      this.slots.set(out); if (!this.form.minutes) this.form.minutes = slot;
    });
  }
  book() {
    const f = this.form; this.error = '';
    if (!f.patient || !f.doctor || !f.date || !f.time) { this.error = this.i18n.t('hos.fillRequired'); return; }
    this.busy = true;
    this.api.post('appointments', { patient: f.patient, doctor: f.doctor, start: `${f.date}T${f.time}`, minutes: +f.minutes || 0, reason: f.reason }).subscribe({
      next: () => { this.busy = false; this.form = null; this.day = f.date; this.load(); this.msg = '✓'; setTimeout(() => this.msg = '', 2500); },
      error: e => { this.busy = false; this.error = errMsg(e, this.i18n); }
    });
  }
  setStatus(a: HosRec, status: string) {
    this.error = '';
    this.api.post(`appointments/${a.id}/status`, { status, today: localToday() }).subscribe({
      next: (r: any) => { this.load(); if (status === 'CheckedIn' && r?.visit && this.auth.can('hos.clinical.view')) this.router.navigate(['/hospital/visits', r.visit.id]); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }
}
