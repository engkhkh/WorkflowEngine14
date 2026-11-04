import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { HosRec, HospitalService } from './hospital.service';
import { HOS_CSS } from './hos-styles';

/** Bed board: every ward with its beds and who is in them; admit, transfer and discharge (one patient per bed, enforced by the server). */
@Component({
  selector: 'app-hos-wards',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, LocalDatePipe],
  template: `
    <div class="bar">
      <span class="chip">{{ occupied() }} / {{ beds().length }} {{ 'hos.k.beds' | translate }}</span><span class="grow"></span>
      <button class="primary" *ngIf="auth.can('hos.wards.manage')" (click)="admitDlg(null)"><app-icon name="plus" [size]="15"></app-icon>{{ 'hos.admit' | translate }}</button>
    </div>
    <p class="flash" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error && !dlg">{{ error }}</p>
    <div class="card mt" *ngFor="let w of wards()">
      <div class="card-head"><h3>{{ w.data['name'] }} <span class="dim sm">{{ w.code }} · {{ w.data['rate'] }}/{{ 'hos.perDay' | translate }}</span></h3></div>
      <div class="card-body"><div class="bedgrid">
        <div class="bed" *ngFor="let b of bedsOf(w)" [ngClass]="b.status">
          <b>{{ b.code }}</b>
          <ng-container *ngIf="b.status === 'Occupied'"><div>{{ b.data['patientName'] }}</div>
            <div class="row mt" *ngIf="auth.can('hos.wards.manage') || auth.can('hos.clinical.manage')"><button class="sm" (click)="transferDlg(b)" *ngIf="auth.can('hos.wards.manage')">{{ 'hos.transfer' | translate }}</button><button class="sm" (click)="dischargeDlg(b)">{{ 'hos.discharge' | translate }}</button></div></ng-container>
          <ng-container *ngIf="b.status !== 'Occupied'"><span class="chip" [class.ok]="b.status === 'Available'">{{ 'hos.s.' + b.status | translate }}</span>
            <div class="row mt" *ngIf="auth.can('hos.wards.manage')"><button class="sm" *ngIf="b.status === 'Available'" (click)="admitDlg(b)">{{ 'hos.admit' | translate }}</button><button class="sm" (click)="toggleMaint(b)">{{ (b.status === 'Maintenance' ? 'hos.s.Available' : 'hos.s.Maintenance') | translate }}</button></div></ng-container>
        </div>
      </div></div>
    </div>
    <p class="dim" *ngIf="!wards().length">{{ 'hos.noWards' | translate }}</p>

    <div class="modal-scrim" *ngIf="dlg === 'admit'" (click)="dlg = ''"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.admit' | translate }}</h3></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error">{{ error }}</p>
        <label class="lbl">{{ 'hos.f.patient' | translate }}</label>
        <input *ngIf="!f.patient" [placeholder]="'hos.searchPatient' | translate" [(ngModel)]="pq" (ngModelChange)="findPatients()" />
        <div class="row" *ngIf="f.patient"><b>{{ f.patientName }}</b> <span class="dim">{{ f.patient }}</span> <button class="sm" (click)="f.patient = ''">×</button></div>
        <div *ngIf="!f.patient"><div *ngFor="let p of found()" class="link" (click)="f.patient = p.code; f.patientName = p.data['name']; found.set([])">{{ p.data['name'] }} · {{ p.code }}</div></div>
        <label class="lbl mt">{{ 'hos.f.bed' | translate }}</label><select [(ngModel)]="f.bed"><option value=""></option><option *ngFor="let b of freeBeds()" [value]="b.code">{{ b.code }} ({{ b.parent }})</option></select>
        <label class="lbl mt">{{ 'hos.f.doctor' | translate }}</label><select [(ngModel)]="f.doctor"><option value=""></option><option *ngFor="let d of docs()" [value]="d.code">{{ d.data['name'] }}</option></select>
        <label class="lbl mt">{{ 'hos.f.reason' | translate }}</label><input [(ngModel)]="f.reason" /></div>
      <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="admit()">{{ 'hos.admit' | translate }}</button></div>
    </div></div>
    <div class="modal-scrim" *ngIf="dlg === 'transfer'" (click)="dlg = ''"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.transfer' | translate }} — {{ cur?.data?.['patientName'] }}</h3></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error">{{ error }}</p>
        <label class="lbl">{{ 'hos.f.bed' | translate }}</label><select [(ngModel)]="f.bed"><option value=""></option><option *ngFor="let b of freeBeds()" [value]="b.code">{{ b.code }} ({{ b.parent }})</option></select></div>
      <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="transfer()">{{ 'hos.transfer' | translate }}</button></div>
    </div></div>
    <div class="modal-scrim" *ngIf="dlg === 'discharge'" (click)="dlg = ''"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.discharge' | translate }} — {{ cur?.data?.['patientName'] }}</h3></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error">{{ error }}</p>
        <label class="lbl">{{ 'hos.outcome' | translate }}</label><select [(ngModel)]="f.outcome"><option value="Recovered">{{ 'hos.o.Recovered' | translate }}</option><option value="Improved">{{ 'hos.o.Improved' | translate }}</option><option value="Referred">{{ 'hos.o.Referred' | translate }}</option><option value="Deceased">{{ 'hos.o.Deceased' | translate }}</option></select>
        <label class="lbl mt">{{ 'hos.summary' | translate }} *</label><textarea [(ngModel)]="f.summary"></textarea></div>
      <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="discharge()">{{ 'hos.discharge' | translate }}</button></div>
    </div></div>
  `,
  styles: [HOS_CSS]
})
export class HosWardsComponent implements OnInit {
  auth = inject(AuthService); private api = inject(HospitalService); private i18n = inject(I18nService);
  wards = signal<HosRec[]>([]); beds = signal<HosRec[]>([]); docs = signal<HosRec[]>([]); found = signal<HosRec[]>([]); adms = signal<HosRec[]>([]);
  error = ''; msg = ''; dlg = ''; f: any = {}; pq = ''; cur: HosRec | null = null;
  occupied = () => this.beds().filter(b => b.status === 'Occupied').length;
  freeBeds = () => this.beds().filter(b => b.status === 'Available');
  bedsOf = (w: HosRec) => this.beds().filter(b => b.parent === w.code).sort((a, b) => a.code.localeCompare(b.code));
  ngOnInit() { this.load(); this.api.records('doctor').subscribe({ next: l => this.docs.set(l), error: () => {} }); }
  load() {
    this.api.records('ward').subscribe(l => this.wards.set(l));
    this.api.records('bed', { take: 2000 }).subscribe({ next: l => this.beds.set(l), error: e => this.error = errMsg(e, this.i18n) });
    this.api.records('admission', { status: 'Admitted', take: 500 }).subscribe({ next: l => this.adms.set(l), error: () => this.adms.set([]) });
  }
  flash() { this.msg = '✓'; setTimeout(() => this.msg = '', 2500); }
  findPatients() { if (this.pq.trim().length < 2) { this.found.set([]); return; } this.api.records('patient', { q: this.pq.trim(), take: 8 }).subscribe(l => this.found.set(l)); }
  admitDlg(b: HosRec | null) { this.error = ''; this.pq = ''; this.f = { patient: '', patientName: '', bed: b?.code ?? '', doctor: '', reason: '' }; this.dlg = 'admit'; }
  admit() { this.api.post('admissions', this.f).subscribe({ next: () => { this.dlg = ''; this.flash(); this.load(); }, error: e => this.error = errMsg(e, this.i18n) }); }
  admOf(b: HosRec) { return this.adms().find(a => a.code === b.data['admission']); }
  transferDlg(b: HosRec) { this.cur = b; this.error = ''; this.f = { bed: '' }; this.dlg = 'transfer'; }
  transfer() { const a = this.admOf(this.cur!); if (!a) { this.error = '?'; return; } this.api.post(`admissions/${a.id}/transfer`, { bed: this.f.bed }).subscribe({ next: () => { this.dlg = ''; this.flash(); this.load(); }, error: e => this.error = errMsg(e, this.i18n) }); }
  dischargeDlg(b: HosRec) { this.cur = b; this.error = ''; this.f = { outcome: 'Recovered', summary: '' }; this.dlg = 'discharge'; }
  discharge() { const a = this.admOf(this.cur!); if (!a) { this.error = '?'; return; } this.api.post(`admissions/${a.id}/discharge`, this.f).subscribe({ next: () => { this.dlg = ''; this.flash(); this.load(); }, error: e => this.error = errMsg(e, this.i18n) }); }
  toggleMaint(b: HosRec) { this.api.update('bed', b.id, { data: b.data, branch: b.branch, status: b.status === 'Maintenance' ? 'Available' : 'Maintenance' }).subscribe({ next: () => this.load(), error: e => this.error = errMsg(e, this.i18n) }); }
}
