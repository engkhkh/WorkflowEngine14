import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { OrgService } from '../core/org.service';
import { HosKind, HosRec, HospitalService, localWeekend } from './hospital.service';
import { HOS_CSS } from './hos-styles';

interface F { key: string; label: string; type?: 'text' | 'number' | 'select' | 'days' | 'list' | 'time' | 'date'; where?: 'code' | 'parent' | 'data'; req?: boolean; opts?: () => { v: string; l: string }[]; col?: boolean; createOnly?: boolean; }
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Hospital setup: departments, doctors (with working days and hours), wards and beds, the price list, the lab catalogue and the formulary. */
@Component({
  selector: 'app-hos-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <div class="bar"><div class="seg"><button *ngFor="let k of kinds" [class.on]="kind === k" (click)="pick(k)">{{ 'hos.setup.' + k | translate }}</button></div><span class="grow"></span>
      <button class="primary" (click)="openForm(null)"><app-icon name="plus" [size]="15"></app-icon>{{ 'hos.add' | translate }}</button></div>
    <p class="flash" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error && !form">{{ error }}</p>
    <div class="card" *ngIf="empty()"><div class="card-body"><p>{{ 'hos.emptyHint' | translate }}</p><button class="primary" (click)="seed()">{{ 'hos.loadDemo' | translate }}</button></div></div>
    <div class="card"><div class="table-wrap"><table class="data"><thead><tr><th *ngFor="let f of cols()">{{ 'hos.f.' + f.label | translate }}</th><th></th></tr></thead><tbody>
      <tr *ngFor="let r of list()"><td *ngFor="let f of cols()">{{ show(r, f) }}</td>
        <td class="num"><button class="sm" (click)="openForm(r)">{{ 'common.edit' | translate }}</button> <button class="sm" (click)="del(r)">{{ 'common.delete' | translate }}</button></td></tr>
      <tr *ngIf="!list().length"><td [attr.colspan]="cols().length + 1" class="dim">{{ 'hos.none' | translate }}</td></tr></tbody></table></div></div>

    <div class="modal-scrim" *ngIf="form" (click)="form = null"><div class="modal" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'hos.setup.' + kind | translate }}</h3><button class="ghost" (click)="form = null"><app-icon name="x"></app-icon></button></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error">{{ error }}</p>
        <div class="form-grid">
          <ng-container *ngFor="let f of fields()">
            <div *ngIf="!f.createOnly || !editing" [class.full]="f.type === 'days' || f.type === 'list'">
              <label class="lbl">{{ 'hos.f.' + f.label | translate }}<span *ngIf="f.req"> *</span></label>
              <select *ngIf="f.type === 'select'" [(ngModel)]="form[f.key]"><option value=""></option><option *ngFor="let o of f.opts!()" [value]="o.v">{{ o.l }}</option></select>
              <div class="row" *ngIf="f.type === 'days'"><label class="row" *ngFor="let d of days; let i = index"><input type="checkbox" [checked]="form[f.key].includes(i)" (change)="toggleDay(f.key, i)" />{{ 'hos.d.' + d | translate }}</label></div>
              <input *ngIf="f.type === 'number'" type="number" [(ngModel)]="form[f.key]" />
              <input *ngIf="f.type === 'time'" type="time" [(ngModel)]="form[f.key]" />
              <input *ngIf="f.type === 'date'" type="date" [(ngModel)]="form[f.key]" />
              <input *ngIf="!f.type || f.type === 'text' || f.type === 'list'" [(ngModel)]="form[f.key]" [disabled]="f.where === 'code' && !!editing" [placeholder]="f.type === 'list' ? ('hos.commaSep' | translate) : ''" />
            </div>
          </ng-container>
        </div>
      </div>
      <div class="modal-foot"><button (click)="form = null">{{ 'common.cancel' | translate }}</button><button class="primary" [disabled]="busy" (click)="save()">{{ 'admin.save' | translate }}</button></div>
    </div></div>
  `,
  styles: [HOS_CSS]
})
export class HosSetupComponent implements OnInit {
  api = inject(HospitalService); private i18n = inject(I18nService); private org = inject(OrgService);
  kinds: HosKind[] = ['setting', 'department', 'doctor', 'ward', 'bed', 'service', 'labtest', 'drug'];
  kind: HosKind = 'setting'; list = signal<HosRec[]>([]); depts = signal<HosRec[]>([]); wardsL = signal<HosRec[]>([]);
  form: any = null; editing: HosRec | null = null; error = ''; msg = ''; busy = false; days = DAYS;

  private spec: Record<string, F[]> = {
    setting: [{ key: 'name', label: 'hospitalName', col: true }, { key: 'currency', label: 'currency', col: true }, { key: 'taxName', label: 'taxName', col: true }, { key: 'taxPct', label: 'taxPct', type: 'number', col: true },
      { key: 'taxExemptTypes', label: 'taxExempt', type: 'list' }, { key: 'paymentMethods', label: 'payMethods', type: 'list' }, { key: 'weekend', label: 'weekend', type: 'days' }],
    department: [{ key: 'code', label: 'code', where: 'code', req: true, col: true }, { key: 'name', label: 'name', req: true, col: true }],
    doctor: [{ key: 'code', label: 'code', where: 'code', req: true, col: true }, { key: 'name', label: 'name', req: true, col: true },
      { key: 'department', label: 'department', type: 'select', opts: () => this.depts().map(d => ({ v: d.code, l: d.data['name'] })), col: true }, { key: 'specialty', label: 'specialty', col: true },
      { key: 'fee', label: 'fee', type: 'number', col: true }, { key: 'days', label: 'workDays', type: 'days' }, { key: 'from', label: 'from', type: 'time' }, { key: 'to', label: 'to', type: 'time' }, { key: 'slot', label: 'slot', type: 'number' }],
    ward: [{ key: 'code', label: 'code', where: 'code', req: true, col: true }, { key: 'name', label: 'name', req: true, col: true }, { key: 'rate', label: 'dailyRate', type: 'number', col: true }],
    bed: [{ key: 'code', label: 'code', where: 'code', req: true, col: true }, { key: 'parent', label: 'ward', where: 'parent', type: 'select', req: true, opts: () => this.wardsL().map(w => ({ v: w.code, l: w.data['name'] })), col: true }, { key: 'label', label: 'name', col: true }],
    service: [{ key: 'code', label: 'code', where: 'code', req: true, col: true }, { key: 'name', label: 'name', req: true, col: true },
      { key: 'category', label: 'category', type: 'select', opts: () => ['consult', 'procedure', 'imaging', 'room', 'other'].map(v => ({ v, l: v })), col: true }, { key: 'price', label: 'price', type: 'number', req: true, col: true }],
    labtest: [{ key: 'code', label: 'code', where: 'code', req: true, col: true }, { key: 'name', label: 'name', req: true, col: true }, { key: 'unit', label: 'unit', col: true },
      { key: 'low', label: 'low', type: 'number', col: true }, { key: 'high', label: 'high', type: 'number', col: true }, { key: 'critLow', label: 'critLow', type: 'number' }, { key: 'critHigh', label: 'critHigh', type: 'number' },
      { key: 'price', label: 'price', type: 'number', col: true }, { key: 'sample', label: 'sample' }],
    drug: [{ key: 'code', label: 'code', where: 'code', req: true, col: true }, { key: 'name', label: 'name', req: true, col: true }, { key: 'class', label: 'class', col: true },
      { key: 'strength', label: 'strength', col: true }, { key: 'form', label: 'form' }, { key: 'price', label: 'price', type: 'number', col: true }, { key: 'reorder', label: 'reorder', type: 'number' },
      { key: 'stock', label: 'stock', type: 'number', createOnly: true }, { key: 'interactsWith', label: 'interactsWith', type: 'list' }, { key: 'contraindications', label: 'contraindications', type: 'list' }],
  };
  fields = () => this.spec[this.kind];
  cols = () => this.spec[this.kind].filter(f => f.col);
  empty = () => this.kind === 'setting' && !this.list().length;

  ngOnInit() { this.api.loadCfg(); this.reload(); }
  pick(k: HosKind) { this.kind = k; this.form = null; this.reload(); }
  reload() {
    this.api.records(this.kind, { take: 2000 }).subscribe({ next: l => this.list.set(l), error: e => this.error = errMsg(e, this.i18n) });
    this.api.records('department').subscribe(l => this.depts.set(l)); this.api.records('ward').subscribe(l => this.wardsL.set(l));
  }
  show(r: HosRec, f: F): string {
    if (f.where === 'code') return r.code; if (f.where === 'parent') return this.wardsL().find(w => w.code === r.parent)?.data['name'] ?? r.parent ?? '';
    const v = r.data[f.key]; if (f.key === 'department') return this.depts().find(d => d.code === v)?.data['name'] ?? v ?? '';
    return Array.isArray(v) ? v.join(', ') : (v ?? '');
  }
  toggleDay(key: string, i: number) { const a: number[] = this.form[key]; const ix = a.indexOf(i); ix >= 0 ? a.splice(ix, 1) : a.push(i); }
  openForm(r: HosRec | null) {
    if (this.kind === 'setting' && !r) r = this.list()[0] ?? null;   // one settings record per hospital
    this.error = ''; this.editing = r; const f: any = {};
    for (const x of this.fields()) {
      f[x.key] = x.where === 'code' ? (r?.code ?? '') : x.where === 'parent' ? (r?.parent ?? '') : x.type === 'days' ? [...(r?.data[x.key] ?? (x.key === 'weekend' ? localWeekend() : [0, 1, 2, 3, 4, 5, 6].filter(d => !((this.api.cfg()['weekend'] as number[] | undefined) ?? localWeekend()).includes(d))))] :
        x.type === 'list' ? (r?.data[x.key] ?? []).join(', ') : (r?.data[x.key] ?? (x.type === 'number' ? 0 : ''));
    }
    this.form = f;
  }
  save() {
    const data: any = this.editing ? { ...this.editing.data } : {}; let code = this.kind === 'setting' ? 'main' : ''; let parent: string | undefined;
    for (const x of this.fields()) {
      const v = this.form[x.key];
      if (x.req && (v === '' || v === null || v === undefined)) { this.error = this.i18n.t('hos.fillRequired'); return; }
      if (x.where === 'code') code = String(v).trim(); else if (x.where === 'parent') parent = v;
      else if (x.createOnly && this.editing) continue;
      else data[x.key] = x.type === 'number' ? (v === '' || v === null ? null : +v) : x.type === 'list' ? String(v).split(',').map(s => s.trim()).filter(Boolean) : v;
    }
    this.busy = true;
    const body: Partial<HosRec> = { code, parent, data, status: this.editing?.status ?? undefined };
    (this.editing ? this.api.update(this.kind, this.editing.id, body) : this.api.create(this.kind, body)).subscribe({
      next: () => { this.busy = false; this.form = null; this.reload(); }, error: e => { this.busy = false; this.error = errMsg(e, this.i18n); } });
  }
  del(r: HosRec) { if (!confirm(this.i18n.t('hos.confirmDelete'))) return; this.api.remove(this.kind, r.id).subscribe({ next: () => this.reload(), error: e => this.error = errMsg(e, this.i18n) }); }
  seed() { this.api.seedDemo(this.org.companies()[0]?.currency || '').subscribe({ next: () => { this.msg = '✓'; this.reload(); }, error: e => this.error = errMsg(e, this.i18n) }); }
}
