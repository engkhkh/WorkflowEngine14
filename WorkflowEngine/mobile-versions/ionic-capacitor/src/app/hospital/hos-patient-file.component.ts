import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { HosRec, HospitalService, age, localToday } from './hospital.service';
import { HOS_CSS, flagClass } from './hos-styles';

@Component({
  selector: 'app-hos-patient-file',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, IconComponent, LocalDatePipe, NumPipe],
  template: `
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <ng-container *ngIf="f() as f">
      <div class="card"><div class="card-body">
        <div class="row">
          <div class="grow">
            <h2 style="margin:0">{{ f.patient.data.name }} <span class="chip bad" *ngIf="f.patient.status === 'Deceased'">†</span></h2>
            <p class="dim" style="margin:4px 0 0">{{ f.patient.code }} · {{ age(f.patient.data.dob) }} {{ f.patient.data.sex }} · {{ f.patient.data.phone }} · {{ f.patient.data.blood }}</p>
          </div>
          <a routerLink="/hospital/patients"><button>{{ 'hos.back' | translate }}</button></a>
          <button *ngIf="auth.can('hos.appointments.manage') && f.patient.status !== 'Deceased'" (click)="book()">{{ 'hos.bookAppt' | translate }}</button>
          <button class="primary" *ngIf="(auth.can('hos.clinical.manage') || auth.can('hos.appointments.manage')) && f.patient.status !== 'Deceased'" (click)="walk = { doctor: '', type: 'OPD', complaint: '' }; loadDocs()">{{ 'hos.startVisit' | translate }}</button>
        </div>
        <div class="row mt" *ngIf="f.patient.data.allergies?.length"><b>{{ 'hos.f.allergies' | translate }}:</b><span class="chip bad" *ngFor="let a of f.patient.data.allergies">{{ a }}</span></div>
        <div class="row" *ngIf="f.patient.data.conditions?.length"><b>{{ 'hos.f.conditions' | translate }}:</b><span class="chip" *ngFor="let a of f.patient.data.conditions">{{ a }}</span></div>
        <div class="row" *ngIf="f.patient.data.insurance"><b>{{ 'hos.f.insurance' | translate }}:</b> {{ f.patient.data.insurance.company }} · {{ f.patient.data.insurance.policyNo }} · {{ f.patient.data.insurance.coveragePct }}% <span class="dim" *ngIf="f.patient.data.insurance.validUntil">→ {{ f.patient.data.insurance.validUntil }}</span></div>
      </div></div>

      <div class="seg mt"><button *ngFor="let t of tabs(f)" [class.on]="tab === t" (click)="tab = t">{{ 'hos.tab.' + t | translate }}</button></div>
      <div class="card mt"><div class="table-wrap">
        <table class="data" *ngIf="tab === 'visits'"><thead><tr><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.date' | translate }}</th><th>{{ 'hos.f.doctor' | translate }}</th><th>{{ 'hos.f.diagnosis' | translate }}</th><th>{{ 'hos.f.status' | translate }}</th></tr></thead><tbody>
          <tr *ngFor="let v of f.visits" class="click" [routerLink]="['/hospital/visits', v.id]"><td>{{ v.code }}</td><td>{{ v.createdAt | ldate }}</td><td>{{ v.data.doctorName }}</td><td><span *ngFor="let d of v.data.diagnoses; let l = last">{{ d.name }}<ng-container *ngIf="!l">, </ng-container></span></td><td><span class="chip">{{ 'hos.s.' + v.status | translate }}</span></td></tr></tbody></table>
        <table class="data" *ngIf="tab === 'appointments'"><thead><tr><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.when' | translate }}</th><th>{{ 'hos.f.doctor' | translate }}</th><th>{{ 'hos.f.reason' | translate }}</th><th>{{ 'hos.f.status' | translate }}</th></tr></thead><tbody>
          <tr *ngFor="let a of f.appointments"><td>{{ a.code }}</td><td>{{ a.data.start?.replace('T', ' ') }}</td><td>{{ a.data.doctorName }}</td><td>{{ a.data.reason }}</td><td><span class="chip">{{ 'hos.s.' + a.status | translate }}</span></td></tr></tbody></table>
        <table class="data" *ngIf="tab === 'prescriptions'"><thead><tr><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.date' | translate }}</th><th>{{ 'hos.f.medicines' | translate }}</th><th>{{ 'hos.f.status' | translate }}</th></tr></thead><tbody>
          <tr *ngFor="let r of f.prescriptions"><td>{{ r.code }}</td><td>{{ r.createdAt | ldate }}</td><td><div *ngFor="let i of r.data.items">{{ i.name }} {{ i.strength }} — {{ i.dose }} {{ i.frequency }} × {{ i.days }}d ({{ i.dispensed }}/{{ i.qty }})</div><div class="chip warn" *ngIf="r.data.overrideReason">⚠ {{ r.data.overrideReason }}</div></td><td><span class="chip">{{ 'hos.s.' + r.status | translate }}</span></td></tr></tbody></table>
        <table class="data" *ngIf="tab === 'labs'"><thead><tr><th>{{ 'hos.f.date' | translate }}</th><th>{{ 'hos.f.test' | translate }}</th><th>{{ 'hos.f.result' | translate }}</th><th>{{ 'hos.f.range' | translate }}</th><th>{{ 'hos.f.status' | translate }}</th></tr></thead><tbody>
          <tr *ngFor="let l of f.labs"><td>{{ l.createdAt | ldate }}</td><td>{{ l.data.name }}</td><td><b>{{ l.data.value }}</b> {{ l.data.unit }} <span class="chip" [ngClass]="flag(l.data.flag)" *ngIf="l.data.flag">{{ l.data.flag }}</span></td><td class="dim">{{ l.data.range }}</td><td><span class="chip">{{ 'hos.s.' + l.status | translate }}</span></td></tr></tbody></table>
        <table class="data" *ngIf="tab === 'admissions'"><thead><tr><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.bed' | translate }}</th><th>{{ 'hos.f.admitted' | translate }}</th><th>{{ 'hos.f.discharged' | translate }}</th><th>{{ 'hos.f.status' | translate }}</th></tr></thead><tbody>
          <tr *ngFor="let a of f.admissions"><td>{{ a.code }}</td><td>{{ a.data.bed }} ({{ a.data.wardName }})</td><td>{{ a.data.admittedAt | ldate }}</td><td>{{ a.data.dischargedAt | ldate }}</td><td><span class="chip">{{ 'hos.s.' + a.status | translate }}</span></td></tr></tbody></table>
        <table class="data" *ngIf="tab === 'invoices'"><thead><tr><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.date' | translate }}</th><th class="num">{{ 'hos.f.total' | translate }}</th><th class="num">{{ 'hos.f.balance' | translate }}</th><th>{{ 'hos.f.status' | translate }}</th></tr></thead><tbody>
          <tr *ngFor="let i of f.invoices"><td>{{ i.code }}</td><td>{{ i.createdAt | ldate }}</td><td class="num">{{ (i.data.total ?? i.data.gross) | num }}</td><td class="num">{{ i.data.balance | num }}</td><td><span class="chip">{{ 'hos.s.' + i.status | translate }}</span></td></tr></tbody></table>
        <table class="data" *ngIf="tab === 'audit'"><thead><tr><th>{{ 'hos.f.date' | translate }}</th><th>{{ 'hos.f.user' | translate }}</th><th>{{ 'hos.f.action' | translate }}</th></tr></thead><tbody>
          <tr *ngFor="let a of f.audit"><td>{{ a.createdAt | ldate }}</td><td>{{ a.data.by }}</td><td>{{ a.data.action }}</td></tr></tbody></table>
      </div></div>
    </ng-container>

    <div class="modal-scrim" *ngIf="walk" (click)="walk = null"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.startVisit' | translate }}</h3></div>
      <div class="modal-body">
        <p class="flash bad" *ngIf="error">{{ error }}</p>
        <label class="lbl">{{ 'hos.f.doctor' | translate }}</label>
        <select [(ngModel)]="walk.doctor"><option value=""></option><option *ngFor="let d of docs()" [value]="d.code">{{ d.data['name'] }}</option></select>
        <label class="lbl mt">{{ 'hos.f.type' | translate }}</label>
        <select [(ngModel)]="walk.type"><option value="OPD">OPD</option><option value="ER">ER</option></select>
        <label class="lbl mt">{{ 'hos.f.complaint' | translate }}</label><input [(ngModel)]="walk.complaint" />
      </div>
      <div class="modal-foot"><button (click)="walk = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="startWalk()">{{ 'hos.startVisit' | translate }}</button></div>
    </div></div>
  `,
  styles: [HOS_CSS]
})
export class HosPatientFileComponent implements OnInit {
  auth = inject(AuthService); private api = inject(HospitalService); private route = inject(ActivatedRoute); private router = inject(Router); private i18n = inject(I18nService);
  f = signal<any>(null); docs = signal<HosRec[]>([]); error = ''; tab = 'visits'; walk: any = null; age = age; flag = flagClass;
  ngOnInit() {
    this.api.patientFile(this.route.snapshot.paramMap.get('code')!).subscribe({ next: f => { this.f.set(f); this.tab = this.tabs(f)[0]; }, error: e => this.error = errMsg(e, this.i18n) });
  }
  tabs(f: any): string[] {
    const t: string[] = [];
    if (f.canClinical) t.push('visits');
    t.push('appointments');
    if (f.canClinical || f.prescriptions.length) t.push('prescriptions');
    if (f.canClinical || f.labs.length) t.push('labs');
    if (f.admissions.length || f.canClinical) t.push('admissions');
    if (f.invoices.length || this.auth.can('hos.billing.view')) t.push('invoices');
    if (f.audit.length) t.push('audit');
    return t;
  }
  book() { this.router.navigate(['/hospital/appointments'], { queryParams: { patient: this.f().patient.code } }); }
  loadDocs() { this.error = ''; this.api.records('doctor').subscribe(l => this.docs.set(l.filter(d => d.status !== 'Inactive'))); }
  startWalk() {
    this.api.post('visits', { patient: this.f().patient.code, doctor: this.walk.doctor, type: this.walk.type, complaint: this.walk.complaint, today: localToday() }).subscribe({
      next: (v: HosRec) => { this.walk = null; if (this.auth.can('hos.clinical.view')) this.router.navigate(['/hospital/visits', v.id]); else this.ngOnInit(); },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }
}
