import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ErpContextService } from '../core/erp-context.service';
import { ErpService } from '../core/erp.service';
import { ErpRec } from '../core/erp.models';
import { bomCost } from '../core/erp.calc';
import { TranslatePipe } from '../core/translate.pipe';
import { NumPipe } from '../shared/ui';

/** Standard cost per bill of materials (material + routing labour + overhead) and, for completed work orders, standard vs actual with the variance. */
@Component({
  selector: 'app-mfg-costing',
  standalone: true,
  imports: [CommonModule, TranslatePipe, NumPipe],
  template: `
    <h3 class="h">{{ 'mfg.cost.standard' | translate }}</h3>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'mfg.f.product' | translate }}</th><th class="num">{{ 'mfg.cost.material' | translate }}</th><th class="num">{{ 'mfg.cost.labor' | translate }}</th><th class="num">{{ 'mfg.cost.overhead' | translate }}</th><th class="num">{{ 'mfg.cost.total' | translate }}</th><th class="num">{{ 'mfg.cost.unit' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let r of std()"><td>{{ r.code }} <small class="dim">{{ r.name }}</small></td><td class="num">{{ r.material | num: 2 }}</td><td class="num">{{ r.labor | num: 2 }}</td><td class="num">{{ r.overhead | num: 2 }}</td><td class="num">{{ r.total | num: 2 }}</td><td class="num"><b>{{ r.unit | num: 2 }}</b></td></tr></tbody></table>
      <div class="empty" *ngIf="!std().length">{{ 'mfg.bom.none' | translate }}</div></div></div>

    <h3 class="h top">{{ 'mfg.cost.variance' | translate }}</h3>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'erp.f.code' | translate }}</th><th>{{ 'mfg.f.product' | translate }}</th><th class="num">{{ 'mfg.wo.good' | translate }}</th><th class="num">{{ 'mfg.cost.material' | translate }}</th><th class="num">{{ 'mfg.cost.labor' | translate }}</th><th class="num">{{ 'mfg.cost.overhead' | translate }}</th><th class="num">{{ 'mfg.wo.actual' | translate }}</th><th class="num">{{ 'mfg.cost.standardCost' | translate }}</th><th class="num">{{ 'mfg.wo.variance' | translate }}</th></tr></thead>
      <tbody><tr *ngFor="let o of done()"><td class="mono">{{ o.code }}</td><td>{{ o.data['sku'] }}</td><td class="num">{{ o.data['goodQty'] | num: 2 }}</td><td class="num">{{ o.data['materialCost'] | num: 2 }}</td><td class="num">{{ o.data['laborCost'] | num: 2 }}</td><td class="num">{{ o.data['overheadCost'] | num: 2 }}</td>
        <td class="num">{{ o.data['actualCost'] | num: 2 }}</td><td class="num">{{ o.data['standardCost'] | num: 2 }}</td><td class="num" [class.neg]="o.data['variance'] > 0" [class.pos]="o.data['variance'] < 0">{{ o.data['variance'] | num: 2 }}</td></tr></tbody></table>
      <div class="empty" *ngIf="!done().length">{{ 'common.noData' | translate }}</div></div></div>
  `,
  styles: [`.h { margin: 0 0 10px; font-size: 14px; } .top { margin-top: 24px; } .neg { color: var(--bad); } .pos { color: var(--ok); } small.dim { margin-inline-start: 6px; }`]
})
export class MfgCostingComponent implements OnInit {
  private erp = inject(ErpService); private ctx = inject(ErpContextService);
  boms = signal<ErpRec[]>([]); wcs = signal<ErpRec[]>([]); orders = signal<ErpRec[]>([]); overheadPct = signal(15);
  done = computed(() => this.orders().filter(o => o.status === 'Completed'));
  std = computed(() => this.boms().map(b => {
    const rate = Number(this.wcs().find(w => w.code === b.data['workCenter'])?.data['costPerHour']) || 0;
    return { code: b.code, name: b.data['name'] ?? '', ...bomCost(b, this.erp.itemMap(), rate, this.overheadPct()) };
  }));
  ngOnInit() {
    const co = this.ctx.company();
    this.erp.loadItems('mfg', co).subscribe(() => this.boms.update(l => [...l]));
    this.erp.records('mfg', 'bom', { company: co }).subscribe(l => this.boms.set(l));
    this.erp.records('mfg', 'workcenter', { company: co }).subscribe(l => this.wcs.set(l));
    this.erp.records('mfg', 'workorder', { company: co, status: 'Completed' }).subscribe({ next: l => this.orders.set(l), error: () => undefined });
    this.erp.records('mfg', 'setting', { company: co }).subscribe({ next: l => { const p = l.find(s => s.code === 'defaults')?.data['overheadPct']; if (p !== undefined && p !== '') this.overheadPct.set(Number(p) || 0); }, error: () => undefined });
  }
}
