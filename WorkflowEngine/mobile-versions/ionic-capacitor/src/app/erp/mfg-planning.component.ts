import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { ErpService } from '../core/erp.service';
import { I18nService } from '../core/i18n.service';
import { ErpRec } from '../core/erp.models';
import { MrpRow, mrp } from '../core/erp.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Material requirements planning. Enter what must be produced (or pull it from open sales demand you type in); the system explodes every bill of
 * materials, nets against stock on hand and the work orders already open, and tells you what to make (-> work orders in one click) and what to buy.
 */
@Component({
  selector: 'app-mfg-planning',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, NumPipe, IconComponent],
  template: `
    <p class="dim lead">{{ 'mfg.mrp.sub' | translate }}</p>
    <div class="card pad">
      <h3 class="h">{{ 'mfg.mrp.demand' | translate }}</h3>
      <table class="data"><thead><tr><th>{{ 'mfg.f.product' | translate }}</th><th class="num" style="width:140px">{{ 'erp.f.qty' | translate }}</th><th style="width:170px">{{ 'erp.f.due' | translate }}</th><th></th></tr></thead>
        <tbody><tr *ngFor="let d of demand(); let i = index">
          <td><select [ngModel]="d.sku" (ngModelChange)="set(i, 'sku', $event)"><option value="">—</option><option *ngFor="let b of boms()" [value]="b.code">{{ b.code }} · {{ b.data['name'] }}</option></select></td>
          <td><input type="number" step="any" [ngModel]="d.qty" (ngModelChange)="set(i, 'qty', +$event)" /></td>
          <td><input type="date" [ngModel]="d.due" (ngModelChange)="set(i, 'due', $event)" /></td>
          <td><button class="ghost sm" (click)="remove(i)"><app-icon name="x" [size]="14"></app-icon></button></td></tr></tbody></table>
      <div class="row"><button class="sm" (click)="add()"><app-icon name="plus" [size]="13"></app-icon>{{ 'erp.addLine' | translate }}</button>
        <span class="grow"></span>
        <label class="chk"><input type="checkbox" [(ngModel)]="useStock" (ngModelChange)="calc()" /> {{ 'mfg.mrp.useStock' | translate }}</label></div>
    </div>

    <p class="flash good" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error">{{ error }}</p>
    <div class="card" *ngIf="rows().length">
      <div class="card-head"><h3>{{ 'mfg.mrp.result' | translate }}</h3>
        <span class="row"><button class="primary sm" *ngIf="makeRows().length && auth.can('mfg.orders.manage')" (click)="createOrders()" [disabled]="busy">{{ 'mfg.mrp.createWo' | translate: { n: makeRows().length } }}</button>
          <button class="sm" (click)="exportBuy()" *ngIf="buyRows().length"><app-icon name="download" [size]="13"></app-icon>{{ 'mfg.mrp.exportBuy' | translate }}</button></span></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'mfg.f.product' | translate }}</th><th class="num">{{ 'mfg.mrp.gross' | translate }}</th><th class="num">{{ 'mfg.mrp.onHand' | translate }}</th><th class="num">{{ 'mfg.mrp.scheduled' | translate }}</th><th class="num">{{ 'mfg.mrp.net' | translate }}</th><th>{{ 'mfg.mrp.action' | translate }}</th></tr></thead>
        <tbody><tr *ngFor="let r of rows()"><td><span [style.padding-inline-start.px]="r.level * 16">{{ r.sku }}<small class="dim"> {{ r.name }}</small></span></td>
          <td class="num">{{ r.gross | num: 2 }}</td><td class="num">{{ r.onHand | num: 2 }}</td><td class="num">{{ r.scheduled | num: 2 }}</td><td class="num"><b [class.neg]="r.net > 0">{{ r.net | num: 2 }}</b></td>
          <td><span class="tag" [class.make]="r.action === 'make'" [class.buy]="r.action === 'buy'">{{ 'mfg.mrp.' + r.action | translate }}</span></td></tr></tbody></table></div>
    </div>
    <div class="empty" *ngIf="!rows().length && hasDemand()">{{ 'mfg.mrp.none' | translate }}</div>
  `,
  styles: [`
    .lead { margin: 0 0 14px; font-size: 13px; } .pad { padding: 16px; margin-bottom: 18px; display: grid; gap: 10px; } .h { margin: 0; font-size: 14px; } .row { display: flex; gap: 8px; align-items: center; } .grow { flex: 1; }
    .chk { display: flex; gap: 8px; align-items: center; font-size: 13px; } .chk input { width: auto; } .neg { color: var(--bad); }
    .tag { font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--ok-soft); color: var(--ok); } .tag.make { background: var(--info-soft); color: var(--info); } .tag.buy { background: #fef3c7; color: #b45309; }
    small.dim { margin-inline-start: 6px; }
  `]
})
export class MfgPlanningComponent implements OnInit {
  hasDemand() { return this.demand().some(d => !!(d.sku && d.qty)); }
  auth = inject(AuthService); private ctx = inject(ErpContextService); private erp = inject(ErpService); private i18n = inject(I18nService);
  demand = signal<{ sku: string; qty: number; due: string }[]>([{ sku: '', qty: 1, due: today() }]);
  boms = signal<ErpRec[]>([]); orders = signal<ErpRec[]>([]); stock = signal<Map<string, number>>(new Map());
  useStock = true; busy = false; msg = ''; error = '';
  rows = signal<MrpRow[]>([]);
  makeRows = computed(() => this.rows().filter(r => r.action === 'make'));
  buyRows = computed(() => this.rows().filter(r => r.action === 'buy'));

  ngOnInit() {
    const co = this.ctx.company();
    this.erp.refresh('mfg', 'bom', co).subscribe(l => { this.boms.set(l); this.calc(); });
    this.erp.records('mfg', 'workorder', { company: co }).subscribe({ next: l => { this.orders.set(l); this.calc(); }, error: () => undefined });
    this.erp.stock(co, this.ctx.branch()).subscribe({ next: l => { this.stock.set(new Map(l.map(x => [x.sku, x.qty]))); this.calc(); }, error: () => undefined });
    this.erp.loadItems('mfg', co).subscribe(() => this.calc());
  }
  add() { this.demand.update(l => [...l, { sku: '', qty: 1, due: today() }]); }
  remove(i: number) { this.demand.update(l => l.filter((_, x) => x !== i)); this.calc(); }
  set(i: number, k: 'sku' | 'qty' | 'due', v: any) { this.demand.update(l => l.map((d, x) => x === i ? { ...d, [k]: v } : d)); this.calc(); }

  calc() {
    const sched = new Map<string, number>();
    for (const o of this.orders().filter(o => o.status === 'Planned' || o.status === 'Released' || o.status === 'InProgress')) sched.set(String(o.data['sku']), (sched.get(String(o.data['sku'])) ?? 0) + (Number(o.data['qty']) || 0));
    this.rows.set(mrp(this.demand().filter(d => d.sku && d.qty > 0), this.boms(), this.useStock ? this.stock() : new Map(), this.useStock ? sched : new Map(), this.erp.itemMap()));
  }

  createOrders() {
    this.busy = true; this.error = ''; this.msg = '';
    const due = this.demand().find(d => d.due)?.due ?? today();
    const make = this.makeRows();
    let left = make.length, made = 0;
    for (const r of make) {
      const bom = this.boms().find(b => b.code === r.sku)!;
      this.erp.create('mfg', 'workorder', {
        company: this.ctx.company(), branch: this.ctx.branch() !== 'ALL' ? this.ctx.branch() : undefined, status: 'Planned',
        data: { sku: r.sku, qty: r.net, due: r.due || due, priority: 'Normal', workCenter: bom.data['workCenter'] ?? '', lines: bom.data['lines'] ?? [], bomQty: bom.data['qty'] ?? 1, routingMinutes: bom.data['routingMinutes'] ?? 0, source: 'MRP' }
      }).subscribe({
        next: () => { made++; if (--left === 0) this.finish(made); },
        error: e => { this.error = errMsg(e, this.i18n); if (--left === 0) this.finish(made); }
      });
    }
  }
  private finish(made: number) { this.busy = false; if (made) this.msg = this.i18n.t('mfg.mrp.created', { n: made }); this.erp.records('mfg', 'workorder', { company: this.ctx.company() }).subscribe(l => { this.orders.set(l); this.calc(); }); }

  exportBuy() {
    const lines = ['sku,name,quantity', ...this.buyRows().map(r => `${r.sku},"${(r.name || '').replace(/"/g, '""')}",${r.net}`)];
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'purchase-requirements.csv'; a.click(); URL.revokeObjectURL(url);
  }
}
