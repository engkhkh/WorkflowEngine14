import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { LocalDatePipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { HosRec, HospitalService } from './hospital.service';
import { HOS_CSS } from './hos-styles';

/** Queue of visits: who is waiting / being seen now, and the closed ones of the last days. */
@Component({
  selector: 'app-hos-visits',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, LocalDatePipe],
  template: `
    <div class="bar">
      <div class="seg"><button [class.on]="status === 'Open'" (click)="status = 'Open'; load()">{{ 'hos.s.Open' | translate }}</button><button [class.on]="status === 'Closed'" (click)="status = 'Closed'; load()">{{ 'hos.s.Closed' | translate }}</button></div>
      <input class="search" [placeholder]="'hos.searchPatient' | translate" [(ngModel)]="q" (ngModelChange)="load()" />
    </div>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>#</th><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.patient' | translate }}</th><th>{{ 'hos.f.doctor' | translate }}</th><th>{{ 'hos.f.type' | translate }}</th><th>{{ 'hos.f.complaint' | translate }}</th><th>{{ 'hos.f.date' | translate }}</th></tr></thead>
      <tbody>
        <tr *ngFor="let v of list()" class="click" (click)="open(v)">
          <td><b>{{ v.data['queue'] }}</b></td><td>{{ v.code }}</td><td>{{ v.data['patientName'] }} <span class="dim sm">{{ v.parent }}</span></td><td>{{ v.data['doctorName'] }}</td>
          <td><span class="chip" [class.bad]="v.data['type'] === 'ER'">{{ v.data['type'] }}</span></td><td>{{ v.data['complaint'] }}</td><td>{{ v.createdAt | ldate }}</td>
        </tr>
        <tr *ngIf="!list().length"><td colspan="7" class="dim">{{ 'hos.none' | translate }}</td></tr>
      </tbody></table></div></div>
  `,
  styles: [HOS_CSS]
})
export class HosVisitsComponent implements OnInit {
  private api = inject(HospitalService); private router = inject(Router); private i18n = inject(I18nService);
  list = signal<HosRec[]>([]); status = 'Open'; q = ''; error = '';
  ngOnInit() { this.load(); }
  load() { this.api.records('visit', { status: this.status, q: this.q, take: 200 }).subscribe({ next: l => this.list.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  open(v: HosRec) { this.router.navigate(['/hospital/visits', v.id]); }
}
