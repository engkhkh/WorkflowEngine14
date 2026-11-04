import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { HosRec, HospitalService, age } from './hospital.service';
import { HOS_CSS } from './hos-styles';

@Component({
  selector: 'app-hos-patients',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <div class="bar">
      <input class="search" [placeholder]="'hos.searchPatient' | translate" [(ngModel)]="q" (ngModelChange)="load()" />
      <span class="grow"></span>
      <button class="primary" *ngIf="auth.can('hos.patients.manage')" (click)="open(null)"><app-icon name="plus" [size]="15"></app-icon>{{ 'hos.newPatient' | translate }}</button>
    </div>
    <p class="flash bad" *ngIf="error && !form">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'hos.f.mrn' | translate }}</th><th>{{ 'hos.f.name' | translate }}</th><th>{{ 'hos.f.age' | translate }}</th><th>{{ 'hos.f.phone' | translate }}</th><th>{{ 'hos.f.allergies' | translate }}</th><th>{{ 'hos.f.insurance' | translate }}</th></tr></thead>
      <tbody>
        <tr *ngFor="let p of list()" class="click" (click)="file(p)">
          <td><b>{{ p.code }}</b></td><td>{{ p.data['name'] }} <span class="chip bad" *ngIf="p.status === 'Deceased'">†</span></td>
          <td>{{ age(p.data['dob']) }} {{ p.data['sex'] }}</td><td>{{ p.data['phone'] }}</td>
          <td><span class="chip bad" *ngFor="let a of p.data['allergies'] || []">{{ a }}</span></td>
          <td>{{ p.data['insurance']?.company }} <span class="dim sm" *ngIf="p.data['insurance']?.coveragePct">{{ p.data['insurance'].coveragePct }}%</span></td>
        </tr>
        <tr *ngIf="!list().length"><td colspan="6" class="dim">{{ 'hos.none' | translate }}</td></tr>
      </tbody></table></div></div>

    <div class="modal-scrim" *ngIf="form" (click)="form = null"><div class="modal" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ (editing ? 'hos.editPatient' : 'hos.newPatient') | translate }}</h3><button class="ghost" (click)="form = null"><app-icon name="x"></app-icon></button></div>
      <div class="modal-body">
        <p class="flash bad" *ngIf="error">{{ error }}</p>
        <div class="form-grid">
          <div class="full"><label class="lbl">{{ 'hos.f.name' | translate }} *</label><input [(ngModel)]="form.name" /></div>
          <div><label class="lbl">{{ 'hos.f.sex' | translate }}</label><select [(ngModel)]="form.sex"><option value="M">{{ 'hos.male' | translate }}</option><option value="F">{{ 'hos.female' | translate }}</option></select></div>
          <div><label class="lbl">{{ 'hos.f.dob' | translate }}</label><input type="date" [(ngModel)]="form.dob" /></div>
          <div><label class="lbl">{{ 'hos.f.phone' | translate }}</label><input [(ngModel)]="form.phone" /></div>
          <div><label class="lbl">{{ 'hos.f.nationalId' | translate }}</label><input [(ngModel)]="form.nationalId" /></div>
          <div><label class="lbl">{{ 'hos.f.blood' | translate }}</label><select [(ngModel)]="form.blood"><option value=""></option><option *ngFor="let b of bloods">{{ b }}</option></select></div>
          <div><label class="lbl">{{ 'hos.f.emergency' | translate }}</label><input [(ngModel)]="form.emergency" /></div>
          <div class="full"><label class="lbl">{{ 'hos.f.allergies' | translate }} <span class="dim sm">({{ 'hos.commaSep' | translate }})</span></label><input [(ngModel)]="form.allergies" placeholder="penicillin, aspirin" /></div>
          <div class="full"><label class="lbl">{{ 'hos.f.conditions' | translate }} <span class="dim sm">({{ 'hos.commaSep' | translate }})</span></label><input [(ngModel)]="form.conditions" /></div>
          <div><label class="lbl">{{ 'hos.f.insCompany' | translate }}</label><input [(ngModel)]="form.insCompany" /></div>
          <div><label class="lbl">{{ 'hos.f.policy' | translate }}</label><input [(ngModel)]="form.insPolicy" /></div>
          <div><label class="lbl">{{ 'hos.f.coverage' | translate }} %</label><input type="number" min="0" max="100" [(ngModel)]="form.insPct" /></div>
          <div><label class="lbl">{{ 'hos.f.validUntil' | translate }}</label><input type="date" [(ngModel)]="form.insUntil" /></div>
        </div>
      </div>
      <div class="modal-foot"><button (click)="form = null">{{ 'common.cancel' | translate }}</button><button class="primary" [disabled]="busy" (click)="save()">{{ 'admin.save' | translate }}</button></div>
    </div></div>
  `,
  styles: [HOS_CSS]
})
export class HosPatientsComponent implements OnInit {
  auth = inject(AuthService); private api = inject(HospitalService); private router = inject(Router); private i18n = inject(I18nService);
  list = signal<HosRec[]>([]); q = ''; error = ''; busy = false; form: any = null; editing: HosRec | null = null;
  bloods = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']; age = age;
  ngOnInit() { this.load(); }
  load() { this.api.records('patient', { q: this.q, take: 300 }).subscribe({ next: l => this.list.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  file(p: HosRec) { this.router.navigate(['/hospital/patients', p.code]); }
  open(p: HosRec | null) {
    this.error = ''; this.editing = p;
    const d: any = p?.data ?? {}; const ins = d.insurance ?? {};
    this.form = { name: d.name ?? '', sex: d.sex ?? 'M', dob: d.dob ?? '', phone: d.phone ?? '', nationalId: d.nationalId ?? '', blood: d.blood ?? '', emergency: d.emergency ?? '',
      allergies: (d.allergies ?? []).join(', '), conditions: (d.conditions ?? []).join(', '), insCompany: ins.company ?? '', insPolicy: ins.policyNo ?? '', insPct: ins.coveragePct ?? 0, insUntil: ins.validUntil ?? '' };
  }
  save() {
    const f = this.form; if (!f.name?.trim()) { this.error = this.i18n.t('hos.f.name'); return; }
    const split = (s: string) => (s ?? '').split(',').map(x => x.trim()).filter(Boolean);
    const data = { name: f.name.trim(), sex: f.sex, dob: f.dob, phone: f.phone, nationalId: f.nationalId, blood: f.blood, emergency: f.emergency, allergies: split(f.allergies), conditions: split(f.conditions),
      insurance: f.insCompany ? { company: f.insCompany, policyNo: f.insPolicy, coveragePct: +f.insPct || 0, validUntil: f.insUntil } : null };
    this.busy = true; this.error = '';
    const req = this.editing ? this.api.update('patient', this.editing.id, { data, status: this.editing.status }) : this.api.create('patient', { data });
    req.subscribe({ next: r => { this.busy = false; this.form = null; this.load(); if (!this.editing) this.file(r); }, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); } });
  }
}
