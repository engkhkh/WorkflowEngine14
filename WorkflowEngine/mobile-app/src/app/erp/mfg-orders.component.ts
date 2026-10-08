import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { ErpService } from '../core/erp.service';
import { I18nService } from '../core/i18n.service';
import { ErpRec } from '../core/erp.models';
import { r2 } from '../core/erp.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { ErpAction, ErpCrudComponent, ErpField } from './erp-crud.component';

const today = () => new Date().toISOString().slice(0, 10);
const num = (v: any) => Number(v) || 0;

/**
 * Work orders: plan from a bill of materials, release, start, complete. Completing issues the components from stock, receives the finished
 * goods, and costs the order (material + labour + overhead) against the standard cost - all done on the server.
 */
@Component({
  selector: 'app-mfg-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, NumPipe, ErpCrudComponent],
  template: `
    <p class="flash bad" *ngIf="error && !done">{{ error }}</p>
    <app-erp-crud #crud module="mfg" kind="workorder" [company]="ctx.company()" [scopeBranch]="true" [fields]="fields" [canManage]="auth.can('mfg.orders.manage')" newLabel="mfg.wo.new" emptyKey="mfg.wo.none"
      [statusFilter]="['Planned','Released','InProgress','Completed','Cancelled']" [actions]="actions" [editable]="editable" [autoNew]="true" />

    <div class="modal-scrim" *ngIf="done" (click)="done = null">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'mfg.wo.complete' | translate }} · {{ done.code }}</h3></div>
        <div class="modal-body">
          <div class="form-grid">
            <div><label class="lbl">{{ 'mfg.wo.good' | translate }}</label><input type="number" step="any" [(ngModel)]="cq" /></div>
            <div><label class="lbl">{{ 'mfg.wo.scrap' | translate }}</label><input type="number" step="any" [(ngModel)]="cs" /></div>
            <div><label class="lbl">{{ 'mfg.wo.hours' | translate }}</label><input type="number" step="0.01" [(ngModel)]="ch" /></div>
            <div class="full"><label class="lbl">{{ 'erp.f.notes' | translate }}</label><input [(ngModel)]="cn" /></div>
          </div>
          <h4 class="sub">{{ 'mfg.wo.materials' | translate }}</h4>
          <table class="data"><thead><tr><th>{{ 'mfg.f.component' | translate }}</th><th class="num">{{ 'mfg.wo.need' | translate }}</th><th class="num">{{ 'mfg.wo.have' | translate }}</th></tr></thead>
            <tbody><tr *ngFor="let m of materials()"><td>{{ m.sku }}</td><td class="num">{{ m.need | num: 2 }}</td><td class="num" [class.neg]="m.have < m.need">{{ m.have | num: 2 }}</td></tr></tbody></table>
          <p class="flash bad" *ngIf="error">{{ error }}</p>
        </div>
        <div class="modal-foot"><button (click)="done = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="complete()" [disabled]="busy">{{ 'mfg.wo.complete' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`.full { grid-column: 1 / -1; } .sub { margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; color: var(--text-dim); } .neg { color: var(--bad); font-weight: 600; }`]
})
export class MfgOrdersComponent implements OnInit {
  auth = inject(AuthService); ctx = inject(ErpContextService); private erp = inject(ErpService); private i18n = inject(I18nService);
  @ViewChild('crud') crud!: ErpCrudComponent;
  error = ''; busy = false;
  done: ErpRec | null = null; cq = 0; cs = 0; ch = 0; cn = '';
  stock = signal<Map<string, number>>(new Map());

  editable = (r: ErpRec) => r.status === 'Planned' || r.status === 'Released';

  fields: ErpField[] = [
    { key: 'code', label: 'erp.f.code', table: true, lockOnEdit: true, hint: 'erp.autoCode' },
    { key: 'sku', label: 'mfg.f.product', type: 'select', required: true, table: true, options: () => this.erp.ref('mfg', 'bom', this.ctx.company()).filter(b => b.status !== 'Inactive').map(b => ({ value: b.code ?? '', label: `${b.code} · ${b.data['name'] ?? ''}` })),
      onChange: f => {
        const bom = this.erp.ref('mfg', 'bom', this.ctx.company()).find(b => b.code === f['sku']);
        if (!bom) return;
        f['lines'] = JSON.parse(JSON.stringify(bom.data['lines'] ?? [])); f['bomQty'] = bom.data['qty'] ?? 1; f['routingMinutes'] = bom.data['routingMinutes'] ?? 0;
        if (bom.data['workCenter']) f['workCenter'] = bom.data['workCenter'];
      } },
    { key: 'qty', label: 'mfg.wo.qty', type: 'number', required: true, table: true, def: 1 },
    { key: 'due', label: 'erp.f.due', type: 'date', table: true, def: () => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); } },
    { key: 'priority', label: 'mfg.wo.priority', type: 'select', table: true, def: 'Normal', options: () => ['Low', 'Normal', 'High', 'Urgent'].map(v => ({ value: v, label: this.i18n.t('erp.o.' + v) })) },
    { key: 'workCenter', label: 'mfg.f.workCenter', type: 'select', options: () => this.erp.ref('mfg', 'workcenter', this.ctx.company()).map(w => ({ value: w.code ?? '', label: `${w.code} · ${w.data['name'] ?? ''}` })) },
    { key: 'actualCost', label: 'mfg.wo.actual', type: 'money', table: true, calc: r => r.data['actualCost'] ?? '' },
    { key: 'variance', label: 'mfg.wo.variance', type: 'money', table: true, calc: r => r.data['variance'] ?? '' },
    { key: 'status', label: 'erp.f.status', type: 'status', table: true, def: 'Planned', show: () => false, options: () => [] },
    { key: 'bomQty', label: 'mfg.f.outQty', type: 'number', show: () => false, def: 1 },
    { key: 'routingMinutes', label: 'mfg.f.routing', type: 'number', show: () => false, def: 0 },
    { key: 'lines', label: 'mfg.f.components', type: 'lines', show: f => !!f['sku'], cols: [
      { key: 'sku', label: 'mfg.f.component', type: 'text' }, { key: 'qty', label: 'mfg.f.qtyPer', type: 'number', width: '120px' }, { key: 'scrapPct', label: 'mfg.f.scrapPct', type: 'number', width: '110px' }] },
    { key: 'notes', label: 'erp.f.notes', type: 'textarea' },
  ];

  actions: ErpAction[] = [
    { label: 'mfg.wo.release', show: r => r.status === 'Planned' && this.auth.can('mfg.orders.manage'), run: r => this.step(r, 'release') },
    { label: 'mfg.wo.start', show: r => r.status === 'Released' && this.auth.can('mfg.orders.execute'), run: r => this.step(r, 'start') },
    { label: 'mfg.wo.complete', show: r => r.status === 'InProgress' && this.auth.can('mfg.orders.execute'), run: r => this.openComplete(r) },
    { label: 'mfg.wo.cancel', danger: true, show: r => (r.status === 'Planned' || r.status === 'Released') && this.auth.can('mfg.orders.manage'), run: r => this.step(r, 'cancel') },
  ];

  ngOnInit() {
    this.erp.refresh('mfg', 'bom', this.ctx.company()).subscribe();
    this.erp.refresh('mfg', 'workcenter', this.ctx.company()).subscribe();
    this.erp.stock(this.ctx.company(), this.ctx.branch()).subscribe({ next: l => this.stock.set(new Map(l.map(x => [x.sku, x.qty]))), error: () => undefined });
  }

  private step(r: ErpRec, a: 'release' | 'start' | 'cancel') {
    this.error = '';
    this.erp.workOrder(r.id, a).subscribe({ next: () => this.crud.reload(), error: e => this.error = errMsg(e, this.i18n) });
  }
  openComplete(r: ErpRec) {
    this.error = ''; this.done = r; this.cq = num(r.data['qty']); this.cs = 0; this.cn = '';
    this.ch = r2(num(r.data['routingMinutes']) / 60 * (num(r.data['qty']) / Math.max(0.0001, num(r.data['bomQty']) || 1)));
  }
  materials() {
    const r = this.done; if (!r) return [];
    const factor = (this.cq + this.cs) / Math.max(0.0001, num(r.data['bomQty']) || 1);
    return ((r.data['lines'] ?? []) as any[]).map(l => ({ sku: l.sku, need: r2(num(l.qty) * factor * (1 + num(l.scrapPct) / 100)), have: this.stock().get(l.sku) ?? 0 }));
  }
  complete() {
    this.busy = true; this.error = '';
    this.erp.workOrder(this.done!.id, 'complete', { qty: num(this.cq), scrap: num(this.cs), hours: num(this.ch), note: this.cn }).subscribe({
      next: () => { this.busy = false; this.done = null; this.crud.reload(); },
      error: e => { this.busy = false; this.error = errMsg(e, this.i18n); }
    });
  }
}
