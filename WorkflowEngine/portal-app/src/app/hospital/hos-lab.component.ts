import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { LocalDatePipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { HosRec, HospitalService } from './hospital.service';
import { HOS_CSS, flagClass } from './hos-styles';

/** Laboratory worklist: ordered tests wait for a result; the server flags it against the reference range of the test. */
@Component({
  selector: 'app-hos-lab',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, LocalDatePipe],
  template: `
    <div class="bar"><div class="seg"><button [class.on]="status === 'Ordered'" (click)="status = 'Ordered'; load()">{{ 'hos.s.Ordered' | translate }}</button><button [class.on]="status === 'Resulted'" (click)="status = 'Resulted'; load()">{{ 'hos.s.Resulted' | translate }}</button></div>
      <input class="search" [placeholder]="'hos.searchPatient' | translate" [(ngModel)]="q" (ngModelChange)="load()" /></div>
    <p class="flash" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error && !sel">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.patient' | translate }}</th><th>{{ 'hos.f.test' | translate }}</th><th>{{ 'hos.f.sample' | translate }}</th><th>{{ 'hos.f.result' | translate }}</th><th></th></tr></thead><tbody>
      <tr *ngFor="let l of list()">
        <td>{{ l.code }}<div class="dim sm">{{ l.createdAt | ldate }}</div></td><td>{{ l.data['patientName'] }} <span class="chip bad" *ngIf="l.data['urgent']">{{ 'hos.urgent' | translate }}</span></td><td>{{ l.data['name'] }}</td><td>{{ l.data['sample'] }}</td>
        <td><ng-container *ngIf="l.status === 'Resulted'"><b>{{ l.data['value'] }}</b> {{ l.data['unit'] }} <span class="chip" [ngClass]="flag(l.data['flag'])">{{ l.data['flag'] }}</span><div class="dim sm">{{ l.data['range'] }}</div></ng-container></td>
        <td class="num"><button class="sm primary" *ngIf="auth.can('hos.lab.result')" (click)="enter(l)">{{ (l.status === 'Ordered' ? 'hos.enterResult' : 'hos.amend') | translate }}</button></td>
      </tr><tr *ngIf="!list().length"><td colspan="6" class="dim">{{ 'hos.none' | translate }}</td></tr></tbody></table></div></div>
    <div class="modal-scrim" *ngIf="sel" (click)="sel = null"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ sel.data['name'] }} — {{ sel.data['patientName'] }}</h3></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error">{{ error }}</p>
        <label class="lbl">{{ 'hos.f.result' | translate }} ({{ sel.data['unit'] }})</label><input [(ngModel)]="res.value" />
        <label class="lbl mt">{{ 'hos.f.note' | translate }}</label><input [(ngModel)]="res.note" /></div>
      <div class="modal-foot"><button (click)="sel = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="save()">{{ 'admin.save' | translate }}</button></div>
    </div></div>
  `,
  styles: [HOS_CSS]
})
export class HosLabComponent implements OnInit {
  auth = inject(AuthService); private api = inject(HospitalService); private i18n = inject(I18nService);
  list = signal<HosRec[]>([]); status = 'Ordered'; q = ''; error = ''; msg = ''; sel: HosRec | null = null; res: any = {}; flag = flagClass;
  ngOnInit() { this.load(); }
  load() { this.api.records('labrequest', { status: this.status, q: this.q, take: 300 }).subscribe({ next: l => this.list.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  enter(l: HosRec) { this.sel = l; this.error = ''; this.res = { value: l.data['value'] ?? '', note: l.data['note'] ?? '' }; }
  save() {
    this.api.post(`labrequests/${this.sel!.id}/result`, { value: this.res.value, note: this.res.note, amend: this.sel!.status === 'Resulted' }).subscribe({
      next: () => { this.sel = null; this.msg = '✓'; setTimeout(() => this.msg = '', 2500); this.load(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
}
