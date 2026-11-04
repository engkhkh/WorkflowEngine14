import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { HosRec, HospitalService } from './hospital.service';
import { HOS_CSS } from './hos-styles';

/** Pharmacy: prescriptions waiting to be dispensed (stock is checked on the server) and the formulary with stock and movements. */
@Component({
  selector: 'app-hos-pharmacy',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, LocalDatePipe, NumPipe],
  template: `
    <div class="bar"><div class="seg"><button [class.on]="tab === 'rx'" (click)="tab = 'rx'">{{ 'hos.tab.prescriptions' | translate }}</button><button [class.on]="tab === 'stock'" (click)="tab = 'stock'">{{ 'hos.stock' | translate }}</button></div></div>
    <p class="flash" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error && !dlg">{{ error }}</p>

    <div class="card" *ngIf="tab === 'rx'">
      <div class="card-head"><div class="seg"><button [class.on]="rxStatus === 'Pending'" (click)="rxStatus = 'Pending'; load()">{{ 'hos.s.Pending' | translate }}</button><button [class.on]="rxStatus === 'Partial'" (click)="rxStatus = 'Partial'; load()">{{ 'hos.s.Partial' | translate }}</button><button [class.on]="rxStatus === 'Dispensed'" (click)="rxStatus = 'Dispensed'; load()">{{ 'hos.s.Dispensed' | translate }}</button></div></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.patient' | translate }}</th><th>{{ 'hos.f.medicines' | translate }}</th><th>{{ 'hos.f.doctor' | translate }}</th><th></th></tr></thead><tbody>
        <tr *ngFor="let r of rx()">
          <td>{{ r.code }}<div class="dim sm">{{ r.createdAt | ldate }}</div></td><td>{{ r.data['patientName'] }}</td>
          <td><div *ngFor="let i of r.data['items']">{{ i.name }} {{ i.strength }} — {{ i.dose }} {{ i.frequency }} × {{ i.days }}d <b>{{ i.dispensed }}/{{ i.qty }}</b></div><div class="chip warn" *ngIf="r.data['overrideReason']" [title]="r.data['warnings']?.join('; ')">⚠ {{ r.data['overrideReason'] }}</div></td>
          <td>{{ r.data['doctorName'] }}</td>
          <td class="num"><button class="sm primary" *ngIf="auth.can('hos.pharmacy.dispense') && (r.status === 'Pending' || r.status === 'Partial')" (click)="dispense(r, false)">{{ 'hos.dispense' | translate }}</button></td>
        </tr>
        <tr *ngIf="!rx().length"><td colspan="5" class="dim">{{ 'hos.none' | translate }}</td></tr></tbody></table></div>
    </div>

    <div class="card" *ngIf="tab === 'stock'">
      <div class="card-head"><input class="search" [placeholder]="'common.search' | translate" [(ngModel)]="q" /></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>{{ 'hos.f.code' | translate }}</th><th>{{ 'hos.f.name' | translate }}</th><th>{{ 'hos.f.strength' | translate }}</th><th class="num">{{ 'hos.f.price' | translate }}</th><th class="num">{{ 'hos.stock' | translate }}</th><th>{{ 'hos.f.expiry' | translate }}</th><th></th></tr></thead><tbody>
        <tr *ngFor="let d of shownDrugs()">
          <td>{{ d.code }}</td><td>{{ d.data['name'] }}</td><td>{{ d.data['strength'] }} {{ d.data['form'] }}</td><td class="num">{{ d.data['price'] | num }}</td>
          <td class="num"><b [style.color]="d.data['stock'] <= d.data['reorder'] ? 'var(--bad)' : ''">{{ d.data['stock'] }}</b></td><td>{{ d.data['expiry'] }}</td>
          <td class="num" *ngIf="auth.can('hos.pharmacy.stock')"><button class="sm" (click)="adjust(d)">{{ 'hos.adjust' | translate }}</button> <button class="sm" (click)="moves(d)">{{ 'hos.movements' | translate }}</button></td>
        </tr></tbody></table></div>
    </div>

    <div class="modal-scrim" *ngIf="dlg === 'adj'" (click)="dlg = ''"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ sel?.data?.['name'] }} — {{ 'hos.adjust' | translate }}</h3></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error">{{ error }}</p>
        <label class="lbl">{{ 'hos.f.qty' | translate }} (+ / −)</label><input type="number" [(ngModel)]="adj.delta" />
        <label class="lbl mt">{{ 'hos.f.reason' | translate }} *</label><input [(ngModel)]="adj.reason" placeholder="purchase / damage / count" />
        <label class="lbl mt">{{ 'hos.f.batch' | translate }}</label><input [(ngModel)]="adj.batch" />
        <label class="lbl mt">{{ 'hos.f.expiry' | translate }}</label><input type="date" [(ngModel)]="adj.expiry" /></div>
      <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="saveAdj()">{{ 'admin.save' | translate }}</button></div>
    </div></div>
    <div class="modal-scrim" *ngIf="dlg === 'mov'" (click)="dlg = ''"><div class="modal" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ sel?.data?.['name'] }} — {{ 'hos.movements' | translate }}</h3></div>
      <div class="modal-body"><table class="data"><tbody><tr *ngFor="let m of mv()"><td>{{ m.createdAt | ldate }}</td><td class="num">{{ m.data['delta'] }}</td><td class="num">{{ m.data['balance'] }}</td><td>{{ m.data['reason'] }}</td><td class="dim">{{ m.data['by'] }}</td></tr></tbody></table></div>
      <div class="modal-foot"><button (click)="dlg = ''">{{ 'hos.close' | translate }}</button></div>
    </div></div>
  `,
  styles: [HOS_CSS]
})
export class HosPharmacyComponent implements OnInit {
  auth = inject(AuthService); private api = inject(HospitalService); private i18n = inject(I18nService);
  tab: 'rx' | 'stock' = 'rx'; rxStatus = 'Pending'; rx = signal<HosRec[]>([]); drugs = signal<HosRec[]>([]); mv = signal<HosRec[]>([]); q = '';
  error = ''; msg = ''; dlg = ''; sel: HosRec | null = null; adj: any = {};
  ngOnInit() { this.load(); this.loadDrugs(); }
  shownDrugs() { const q = this.q.toLowerCase(); return this.drugs().filter(d => !q || (d.code + ' ' + d.data['name']).toLowerCase().includes(q)); }
  load() { this.api.records('prescription', { status: this.rxStatus, take: 300 }).subscribe({ next: l => this.rx.set(l), error: e => this.error = errMsg(e, this.i18n) }); }
  loadDrugs() { this.api.records('drug', { take: 2000 }).subscribe({ next: l => this.drugs.set(l), error: () => this.drugs.set([]) }); }
  flash(m = '✓') { this.msg = m; setTimeout(() => this.msg = '', 2500); }
  dispense(r: HosRec, partial: boolean) {
    this.error = '';
    this.api.post(`prescriptions/${r.id}/dispense`, { allowPartial: partial }).subscribe({
      next: () => { this.flash(); this.load(); this.loadDrugs(); },
      error: e => {
        if (e?.status === 409 && e.error?.shortages && !partial && confirm(e.error.message + '\n\n' + this.i18n.t('hos.partialAsk'))) this.dispense(r, true);
        else this.error = errMsg(e, this.i18n);
      }
    });
  }
  adjust(d: HosRec) { this.sel = d; this.error = ''; this.adj = { delta: 0, reason: '', batch: '', expiry: '' }; this.dlg = 'adj'; }
  saveAdj() { this.api.post(`drugs/${this.sel!.id}/stock`, this.adj).subscribe({ next: () => { this.dlg = ''; this.flash(); this.loadDrugs(); }, error: e => this.error = errMsg(e, this.i18n) }); }
  moves(d: HosRec) { this.sel = d; this.api.records('drugmove', { parent: d.code, take: 100 }).subscribe(l => { this.mv.set(l); this.dlg = 'mov'; }); }
}
