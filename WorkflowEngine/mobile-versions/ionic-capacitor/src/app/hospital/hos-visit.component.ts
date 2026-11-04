import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { HosRec, HospitalService, age } from './hospital.service';
import { HOS_CSS, flagClass } from './hos-styles';

/** The doctor's workspace of one visit: vitals, complaint and SOAP notes, diagnoses, prescriptions, lab orders, services, admission and closing. */
@Component({
  selector: 'app-hos-visit',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, IconComponent, LocalDatePipe, NumPipe],
  template: `
    <p class="flash bad" *ngIf="error && !dlg">{{ error }}</p><p class="flash" *ngIf="msg">{{ msg }}</p>
    <ng-container *ngIf="v() as v">
      <div class="card"><div class="card-body">
        <div class="row">
          <div class="grow">
            <h2 style="margin:0"><a class="link" [routerLink]="['/hospital/patients', v.parent]">{{ v.data.patientName }}</a> <span class="chip" [class.bad]="v.data.type === 'ER'">{{ v.data.type }}</span> <span class="chip" [class.ok]="v.status === 'Closed'">{{ 'hos.s.' + v.status | translate }}</span></h2>
            <p class="dim" style="margin:4px 0 0">{{ v.code }} · {{ v.parent }} <span *ngIf="pat()">· {{ age(pat()!.data['dob']) }} {{ pat()!.data['sex'] }}</span> · {{ v.data.doctorName }} · #{{ v.data.queue }}</p>
          </div>
          <a routerLink="/hospital/visits"><button>{{ 'hos.back' | translate }}</button></a>
          <button *ngIf="open() && auth.can('hos.wards.manage')" (click)="admitDlg()">{{ 'hos.admit' | translate }}</button>
          <button class="primary" *ngIf="open() && auth.can('hos.clinical.manage')" (click)="close()">{{ 'hos.closeVisit' | translate }}</button>
        </div>
        <div class="row mt" *ngIf="pat()?.data?.['allergies']?.length"><b style="color:var(--bad)">⚠ {{ 'hos.f.allergies' | translate }}:</b><span class="chip bad" *ngFor="let a of pat()!.data['allergies']">{{ a }}</span></div>
        <div class="row" *ngIf="pat()?.data?.['conditions']?.length"><b>{{ 'hos.f.conditions' | translate }}:</b><span class="chip" *ngFor="let a of pat()!.data['conditions']">{{ a }}</span></div>
      </div></div>

      <div class="two mt">
        <div class="card"><div class="card-head"><h3>{{ 'hos.vitals' | translate }}</h3></div><div class="card-body">
          <div class="form-grid">
            <div><label class="lbl">{{ 'hos.v.bp' | translate }} (sys / dia)</label><div class="row"><input type="number" style="width:80px" [(ngModel)]="vit.sys" [disabled]="!open()" />/<input type="number" style="width:80px" [(ngModel)]="vit.dia" [disabled]="!open()" /></div></div>
            <div><label class="lbl">{{ 'hos.v.pulse' | translate }}</label><input type="number" [(ngModel)]="vit.pulse" [disabled]="!open()" /></div>
            <div><label class="lbl">{{ 'hos.v.temp' | translate }} °C</label><input type="number" step="0.1" [(ngModel)]="vit.temp" [disabled]="!open()" /></div>
            <div><label class="lbl">SpO₂ %</label><input type="number" [(ngModel)]="vit.spo2" [disabled]="!open()" /></div>
            <div><label class="lbl">{{ 'hos.v.rr' | translate }}</label><input type="number" [(ngModel)]="vit.rr" [disabled]="!open()" /></div>
            <div><label class="lbl">{{ 'hos.v.weight' | translate }} kg</label><input type="number" step="0.1" [(ngModel)]="vit.weight" [disabled]="!open()" /></div>
            <div><label class="lbl">{{ 'hos.v.height' | translate }} cm</label><input type="number" [(ngModel)]="vit.height" [disabled]="!open()" /></div>
            <div *ngIf="bmi()"><label class="lbl">BMI</label><b>{{ bmi() }}</b></div>
          </div>
        </div></div>
        <div class="card"><div class="card-head"><h3>{{ 'hos.f.complaint' | translate }} / SOAP</h3></div><div class="card-body">
          <label class="lbl">{{ 'hos.f.complaint' | translate }}</label><input [(ngModel)]="complaint" [disabled]="!open()" />
          <label class="lbl mt">S — {{ 'hos.soap.s' | translate }}</label><textarea [(ngModel)]="notes.s" [disabled]="!open()"></textarea>
          <label class="lbl mt">O — {{ 'hos.soap.o' | translate }}</label><textarea [(ngModel)]="notes.o" [disabled]="!open()"></textarea>
          <label class="lbl mt">A — {{ 'hos.soap.a' | translate }}</label><textarea [(ngModel)]="notes.a" [disabled]="!open()"></textarea>
          <label class="lbl mt">P — {{ 'hos.soap.p' | translate }}</label><textarea [(ngModel)]="notes.p" [disabled]="!open()"></textarea>
        </div></div>
      </div>

      <div class="card mt"><div class="card-head"><h3>{{ 'hos.f.diagnosis' | translate }}</h3></div><div class="card-body">
        <div class="row"><span class="chip info" *ngFor="let d of dx; let i = index">{{ d.code }} {{ d.name }} <a class="link" *ngIf="open()" (click)="dx.splice(i, 1)">×</a></span></div>
        <div class="row mt" *ngIf="open()"><input style="width:110px" [placeholder]="'ICD'" [(ngModel)]="newDx.code" /><input class="grow" [placeholder]="'hos.f.diagnosis' | translate" [(ngModel)]="newDx.name" (keyup.enter)="addDx()" /><button (click)="addDx()">{{ 'hos.add' | translate }}</button></div>
      </div></div>
      <div class="row mt" *ngIf="open() && auth.can('hos.clinical.manage')"><span class="grow"></span><button class="primary" [disabled]="busy" (click)="save()">{{ 'admin.save' | translate }}</button></div>

      <div class="card mt"><div class="card-head"><h3>{{ 'hos.tab.prescriptions' | translate }}</h3><button *ngIf="open() && auth.can('hos.prescribe')" (click)="rxDlg()">{{ 'hos.newRx' | translate }}</button></div>
        <div class="table-wrap"><table class="data"><tbody>
          <tr *ngFor="let r of rx()"><td>{{ r.code }}</td>
            <td><div *ngFor="let i of r.data['items']">{{ i.name }} {{ i.strength }} — {{ i.dose }} {{ i.frequency }} × {{ i.days }}d <span class="dim">({{ i.dispensed }}/{{ i.qty }})</span></div><div class="chip warn" *ngIf="r.data['overrideReason']">⚠ {{ r.data['overrideReason'] }}</div></td>
            <td><span class="chip">{{ 'hos.s.' + r.status | translate }}</span></td>
            <td class="num"><button class="sm" *ngIf="r.status === 'Pending' && open() && auth.can('hos.prescribe')" (click)="cancelRx(r)">{{ 'common.cancel' | translate }}</button></td></tr>
          <tr *ngIf="!rx().length"><td class="dim">{{ 'hos.none' | translate }}</td></tr></tbody></table></div></div>

      <div class="card mt"><div class="card-head"><h3>{{ 'hos.tab.labs' | translate }}</h3><button *ngIf="open() && auth.can('hos.lab.order')" (click)="labDlg()">{{ 'hos.orderLab' | translate }}</button></div>
        <div class="table-wrap"><table class="data"><tbody>
          <tr *ngFor="let l of labs()"><td>{{ l.data['name'] }}</td><td><ng-container *ngIf="l.status === 'Resulted'"><b>{{ l.data['value'] }}</b> {{ l.data['unit'] }} <span class="chip" [ngClass]="flag(l.data['flag'])">{{ l.data['flag'] }}</span> <span class="dim sm">{{ l.data['range'] }}</span></ng-container></td><td><span class="chip">{{ 'hos.s.' + l.status | translate }}</span></td></tr>
          <tr *ngIf="!labs().length"><td class="dim">{{ 'hos.none' | translate }}</td></tr></tbody></table></div></div>

      <div class="card mt"><div class="card-head"><h3>{{ 'hos.services' | translate }}</h3><button *ngIf="open() && auth.can('hos.clinical.manage')" (click)="svcDlg()">{{ 'hos.add' | translate }}</button></div>
        <div class="table-wrap"><table class="data"><tbody>
          <tr *ngFor="let s of v.data.services"><td>{{ s.name }}</td><td class="num">{{ s.qty }} × {{ s.price | num }}</td></tr>
          <tr *ngIf="!v.data.services?.length"><td class="dim">{{ 'hos.none' | translate }}</td></tr></tbody></table></div></div>

      <div class="card mt" *ngIf="inv() as i"><div class="card-head"><h3>{{ 'hos.nav.billing' | translate }}</h3><span class="chip">{{ 'hos.s.' + i.status | translate }}</span></div>
        <div class="card-body">{{ 'hos.f.total' | translate }}: <b>{{ (i.data['total'] ?? i.data['gross']) | num }}</b> · {{ 'hos.f.insurance' | translate }}: {{ i.data['insurance'] | num }} · {{ 'hos.f.balance' | translate }}: <b>{{ i.data['balance'] | num }}</b> <a routerLink="/hospital/billing" class="link" *ngIf="auth.can('hos.billing.view')">→</a></div></div>
    </ng-container>

    <!-- prescription dialog -->
    <div class="modal-scrim" *ngIf="dlg === 'rx'" (click)="dlg = ''"><div class="modal" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.newRx' | translate }}</h3></div>
      <div class="modal-body">
        <p class="flash bad" *ngIf="error">{{ error }}</p>
        <div class="warnbox" *ngIf="warnings.length"><b>{{ 'hos.safety' | translate }}</b><ul><li *ngFor="let w of warnings">{{ w }}</li></ul>
          <label class="lbl">{{ 'hos.overrideReason' | translate }}</label><input [(ngModel)]="override" /></div>
        <div class="row mt" *ngFor="let it of rxItems; let i = index">
          <select style="min-width:200px" [(ngModel)]="it.drug"><option value=""></option><option *ngFor="let d of drugs()" [value]="d.code">{{ d.data['name'] }} {{ d.data['strength'] }} ({{ d.data['stock'] }})</option></select>
          <input style="width:110px" [placeholder]="'hos.f.dose' | translate" [(ngModel)]="it.dose" />
          <input style="width:110px" [placeholder]="'hos.f.frequency' | translate" [(ngModel)]="it.frequency" />
          <input style="width:70px" type="number" [placeholder]="'hos.f.days' | translate" [(ngModel)]="it.days" />
          <input style="width:70px" type="number" [placeholder]="'hos.f.qty' | translate" [(ngModel)]="it.qty" />
          <button class="sm" (click)="rxItems.splice(i, 1)" *ngIf="rxItems.length > 1">×</button>
        </div>
        <button class="sm mt" (click)="rxItems.push({ drug: '', dose: '', frequency: '', days: 5, qty: 1 })">+ {{ 'hos.add' | translate }}</button>
      </div>
      <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" [disabled]="busy" (click)="prescribe()">{{ (warnings.length ? 'hos.prescribeAnyway' : 'hos.prescribe') | translate }}</button></div>
    </div></div>

    <!-- lab dialog -->
    <div class="modal-scrim" *ngIf="dlg === 'lab'" (click)="dlg = ''"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.orderLab' | translate }}</h3></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error">{{ error }}</p>
        <label class="row" *ngFor="let t of tests()"><input type="checkbox" [checked]="picked.has(t.code)" (change)="toggle(t.code)" /> {{ t.data['name'] }} <span class="dim sm">{{ t.data['price'] | num }}</span></label>
        <label class="row mt"><input type="checkbox" [(ngModel)]="urgent" /> {{ 'hos.urgent' | translate }}</label></div>
      <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" [disabled]="busy" (click)="orderLabs()">{{ 'hos.orderLab' | translate }}</button></div>
    </div></div>

    <!-- service dialog -->
    <div class="modal-scrim" *ngIf="dlg === 'svc'" (click)="dlg = ''"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.services' | translate }}</h3></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error">{{ error }}</p>
        <select [(ngModel)]="svc.service"><option value=""></option><option *ngFor="let s of services()" [value]="s.code">{{ s.data['name'] }} — {{ s.data['price'] | num }}</option></select>
        <label class="lbl mt">{{ 'hos.f.qty' | translate }}</label><input type="number" min="1" [(ngModel)]="svc.qty" /></div>
      <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" [disabled]="busy" (click)="addSvc()">{{ 'hos.add' | translate }}</button></div>
    </div></div>

    <!-- admit dialog -->
    <div class="modal-scrim" *ngIf="dlg === 'admit'" (click)="dlg = ''"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.admit' | translate }}</h3></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error">{{ error }}</p>
        <label class="lbl">{{ 'hos.f.bed' | translate }}</label>
        <select [(ngModel)]="adm.bed"><option value=""></option><option *ngFor="let b of freeBeds()" [value]="b.code">{{ b.code }} — {{ b.parent }}</option></select>
        <label class="lbl mt">{{ 'hos.f.reason' | translate }}</label><input [(ngModel)]="adm.reason" /></div>
      <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" [disabled]="busy" (click)="admit()">{{ 'hos.admit' | translate }}</button></div>
    </div></div>
  `,
  styles: [HOS_CSS]
})
export class HosVisitComponent implements OnInit {
  auth = inject(AuthService); private api = inject(HospitalService); private route = inject(ActivatedRoute); private router = inject(Router); private i18n = inject(I18nService);
  v = signal<HosRec | null>(null); pat = signal<HosRec | null>(null); rx = signal<HosRec[]>([]); labs = signal<HosRec[]>([]); inv = signal<HosRec | null>(null);
  drugs = signal<HosRec[]>([]); tests = signal<HosRec[]>([]); services = signal<HosRec[]>([]); freeBeds = signal<HosRec[]>([]);
  vit: any = {}; notes: any = { s: '', o: '', a: '', p: '' }; complaint = ''; dx: { code: string; name: string }[] = []; newDx = { code: '', name: '' };
  error = ''; msg = ''; busy = false; dlg = ''; warnings: string[] = []; override = ''; rxItems: any[] = []; picked = new Set<string>(); urgent = false; svc: any = { service: '', qty: 1 }; adm: any = { bed: '', reason: '' };
  age = age; flag = flagClass;
  open = () => this.v()?.status === 'Open';
  bmi() { const w = +this.vit.weight, h = +this.vit.height; return w > 0 && h > 0 ? (w / Math.pow(h / 100, 2)).toFixed(1) : ''; }

  ngOnInit() { this.load(); }
  load() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.get<HosRec>(`records/visit/${id}`).subscribe({ next: v => {
      this.v.set(v); const d = v.data as any;
      this.vit = { ...(d['vitals'] ?? {}) }; this.notes = { s: '', o: '', a: '', p: '', ...(d['notes'] ?? {}) }; this.complaint = d['complaint'] ?? ''; this.dx = [...(d['diagnoses'] ?? [])];
      this.api.records('patient', { q: v.parent ?? '' }).subscribe(p => this.pat.set(p.find(x => x.code === v.parent) ?? null));
      this.api.records('prescription', { parent: v.code }).subscribe({ next: r => this.rx.set(r), error: () => this.rx.set([]) });
      this.api.records('labrequest', { parent: v.code }).subscribe({ next: r => this.labs.set(r), error: () => this.labs.set([]) });
      this.api.records('invoice', { parent: v.code }).subscribe({ next: r => this.inv.set(r[0] ?? null), error: () => this.inv.set(null) });
    }, error: e => this.error = errMsg(e, this.i18n) });
  }
  flash(m = '✓') { this.msg = m; setTimeout(() => this.msg = '', 2500); }
  addDx() { if (!this.newDx.name.trim()) return; this.dx.push({ code: this.newDx.code.trim(), name: this.newDx.name.trim() }); this.newDx = { code: '', name: '' }; }
  save(then?: () => void) {
    this.addDx(); this.busy = true; this.error = '';
    const clean: any = {}; for (const [k, x] of Object.entries(this.vit)) if (x !== null && x !== '' && !['by', 'at'].includes(k)) clean[k] = +(x as any);
    this.api.put(`visits/${this.v()!.id}`, { complaint: this.complaint, vitals: clean, diagnoses: this.dx, notes: this.notes }).subscribe({
      next: (r: HosRec) => { this.busy = false; this.v.set(r); this.flash(); then?.(); }, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); }
    });
  }
  close() {
    this.save(() => this.api.post(`visits/${this.v()!.id}/close`).subscribe({ next: () => { this.flash(); this.load(); }, error: e => this.error = errMsg(e, this.i18n) }));
  }
  rxDlg() { this.error = ''; this.warnings = []; this.override = ''; this.rxItems = [{ drug: '', dose: '', frequency: '', days: 5, qty: 1 }]; this.api.records('drug').subscribe(l => this.drugs.set(l.filter(d => d.status !== 'Inactive'))); this.dlg = 'rx'; }
  prescribe() {
    this.busy = true; this.error = '';
    this.api.post(`visits/${this.v()!.id}/prescriptions`, { items: this.rxItems.filter(i => i.drug), overrideReason: this.override }).subscribe({
      next: () => { this.busy = false; this.dlg = ''; this.flash(); this.load(); },
      error: e => { this.busy = false; if (e?.status === 409 && e.error?.warnings) { this.warnings = e.error.warnings; this.error = e.error.message; } else this.error = errMsg(e, this.i18n); }
    });
  }
  cancelRx(r: HosRec) { this.api.post(`prescriptions/${r.id}/cancel`).subscribe({ next: () => this.load(), error: e => this.error = errMsg(e, this.i18n) }); }
  labDlg() { this.error = ''; this.picked = new Set(); this.urgent = false; this.api.records('labtest').subscribe(l => this.tests.set(l.filter(t => t.status !== 'Inactive'))); this.dlg = 'lab'; }
  toggle(c: string) { this.picked.has(c) ? this.picked.delete(c) : this.picked.add(c); }
  orderLabs() { this.busy = true; this.api.post(`visits/${this.v()!.id}/labs`, { tests: [...this.picked], urgent: this.urgent }).subscribe({ next: () => { this.busy = false; this.dlg = ''; this.load(); }, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); } }); }
  svcDlg() { this.error = ''; this.svc = { service: '', qty: 1 }; this.api.records('service').subscribe(l => this.services.set(l.filter(s => s.status !== 'Inactive'))); this.dlg = 'svc'; }
  addSvc() { this.busy = true; this.api.post(`visits/${this.v()!.id}/services`, this.svc).subscribe({ next: () => { this.busy = false; this.dlg = ''; this.load(); }, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); } }); }
  admitDlg() { this.error = ''; this.adm = { bed: '', reason: this.complaint }; this.api.records('bed', { status: 'Available' }).subscribe(l => this.freeBeds.set(l)); this.dlg = 'admit'; }
  admit() { this.busy = true; this.api.post('admissions', { patient: this.v()!.parent, visit: this.v()!.code, bed: this.adm.bed, reason: this.adm.reason }).subscribe({ next: () => { this.busy = false; this.dlg = ''; this.router.navigate(['/hospital/wards']); }, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); } }); }
}
