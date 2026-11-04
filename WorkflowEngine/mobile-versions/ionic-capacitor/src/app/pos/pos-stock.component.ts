import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { PosService } from '../core/pos.service';
import { PosRec } from '../core/pos.models';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent, LocalDatePipe, NumPipe } from '../shared/ui';
import { errMsg } from '../hr/hr-util';

type Tab = 'levels' | 'transfers' | 'moves';

/** Stock per branch (or the single location when the company has no branches): levels, counts / adjustments, branch-to-branch transfers, movement log. */
@Component({
  selector: 'app-pos-stock',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, NumPipe, LocalDatePipe, IconComponent],
  template: `
    <nav class="seg">
      <button [class.on]="tab() === 'levels'" (click)="tab.set('levels')">{{ 'pos.stock.levels' | translate }}</button>
      <button [class.on]="tab() === 'transfers'" (click)="tab.set('transfers')" *ngIf="pos.hasBranches()">{{ 'pos.stock.transfers' | translate }}</button>
      <button [class.on]="tab() === 'moves'" (click)="tab.set('moves')">{{ 'pos.stock.moves' | translate }}</button>
    </nav>
    <p class="flash good" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error && !dlg">{{ error }}</p>

    <ng-container *ngIf="tab() === 'levels'">
      <div class="bar"><input class="search" [placeholder]="'common.search' | translate" [ngModel]="q()" (ngModelChange)="q.set($event)" />
        <label class="chk"><input type="checkbox" [ngModel]="lowOnly()" (ngModelChange)="lowOnly.set($event)" /> {{ 'pos.stock.lowOnly' | translate }}</label>
        <span class="grow"></span><span class="dim">{{ 'pos.stock.value' | translate }}: <b>{{ value() | num: 2 }}</b></span>
        <button *ngIf="auth.can('pos.stock.manage') && pos.hasBranches()" (click)="openTransfer()">{{ 'pos.stock.newTransfer' | translate }}</button></div>
      <div class="card"><div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'pos.sku' | translate }}</th><th>{{ 'pos.name' | translate }}</th><th *ngIf="pos.hasBranches()">{{ 'pos.branch' | translate }}</th><th class="num">{{ 'pos.stock.qty' | translate }}</th><th class="num">{{ 'pos.reorder' | translate }}</th><th class="num">{{ 'pos.stock.value' | translate }}</th><th></th></tr></thead>
        <tbody><tr *ngFor="let r of rows()"><td class="mono">{{ r.sku }}</td><td>{{ r.name }}</td><td *ngIf="pos.hasBranches()">{{ r.branch }}</td>
          <td class="num" [class.low]="r.low">{{ r.qty | num: 2 }}</td><td class="num">{{ r.reorder | num: 0 }}</td><td class="num">{{ r.qty * r.cost | num: 2 }}</td>
          <td class="act"><button class="ghost sm" *ngIf="auth.can('pos.stock.manage')" (click)="openAdjust(r)">{{ 'pos.stock.adjust' | translate }}</button></td></tr></tbody></table>
        <div class="empty" *ngIf="!rows().length">{{ 'common.noData' | translate }}</div></div></div>
    </ng-container>

    <ng-container *ngIf="tab() === 'transfers'">
      <div class="bar"><span class="grow"></span><button class="primary" *ngIf="auth.can('pos.stock.manage')" (click)="openTransfer()"><app-icon name="plus" [size]="15"></app-icon>{{ 'pos.stock.newTransfer' | translate }}</button></div>
      <div class="card"><div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'pos.code' | translate }}</th><th>{{ 'pos.date' | translate }}</th><th>{{ 'pos.stock.from' | translate }}</th><th>{{ 'pos.stock.to' | translate }}</th><th>{{ 'pos.product' | translate }}</th><th>{{ 'pos.status' | translate }}</th><th></th></tr></thead>
        <tbody><tr *ngFor="let t of transfers()"><td class="mono">{{ t.code }}</td><td>{{ t.createdAt | ldate }}</td><td>{{ t.branch }}</td><td>{{ t.ref }}</td>
          <td>{{ summary(t) }}</td><td>{{ 'pos.st.' + t.status | translate }}</td>
          <td class="act"><button class="ghost sm" *ngIf="t.status === 'InTransit' && auth.can('pos.stock.manage')" (click)="receive(t)">{{ 'pos.stock.receive' | translate }}</button></td></tr></tbody></table>
        <div class="empty" *ngIf="!transfers().length">{{ 'common.noData' | translate }}</div></div></div>
    </ng-container>

    <ng-container *ngIf="tab() === 'moves'">
      <div class="card"><div class="table-wrap"><table class="data">
        <thead><tr><th>{{ 'pos.date' | translate }}</th><th>{{ 'pos.sku' | translate }}</th><th *ngIf="pos.hasBranches()">{{ 'pos.branch' | translate }}</th><th>{{ 'pos.stock.type' | translate }}</th><th class="num">{{ 'pos.stock.delta' | translate }}</th><th class="num">{{ 'pos.stock.balance' | translate }}</th><th>{{ 'pos.document' | translate }}</th><th>{{ 'pos.cashier' | translate }}</th></tr></thead>
        <tbody><tr *ngFor="let m of moves()"><td>{{ m.createdAt | ldate: 'datetime' }}</td><td class="mono">{{ m.code }}</td><td *ngIf="pos.hasBranches()">{{ m.branch }}</td><td>{{ 'pos.mv.' + m.data['type'] | translate }}</td>
          <td class="num" [class.neg]="m.data['delta'] < 0">{{ m.data['delta'] | num: 2 }}</td><td class="num">{{ m.data['balance'] | num: 2 }}</td><td class="mono">{{ m.parent }}</td><td>{{ m.createdBy }}</td></tr></tbody></table>
        <div class="empty" *ngIf="!moves().length">{{ 'common.noData' | translate }}</div></div></div>
    </ng-container>

    <div class="modal-scrim" *ngIf="dlg === 'adjust'" (click)="dlg = ''">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'pos.stock.adjust' | translate }} · {{ adj.sku }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div><label class="lbl">{{ 'pos.stock.qty' | translate }}</label><input disabled [value]="adj.qty" /></div>
          <div><label class="lbl">{{ 'pos.stock.counted' | translate }}</label><input type="number" step="0.01" [(ngModel)]="adj.counted" /></div>
          <div class="full"><label class="lbl">{{ 'pos.reason' | translate }}</label><input [(ngModel)]="adj.reason" /></div></div><p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="saveAdjust()">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <div class="modal-scrim" *ngIf="dlg === 'transfer'" (click)="dlg = ''">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'pos.stock.newTransfer' | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div><label class="lbl">{{ 'pos.stock.from' | translate }}</label><select [(ngModel)]="tr.from"><option *ngFor="let b of ctx.branches()" [value]="b.code">{{ b.code }} · {{ i18n.nm(b) }}</option></select></div>
          <div><label class="lbl">{{ 'pos.stock.to' | translate }}</label><select [(ngModel)]="tr.to"><option *ngFor="let b of ctx.branches()" [value]="b.code">{{ b.code }} · {{ i18n.nm(b) }}</option></select></div></div>
          <div class="trl" *ngFor="let l of tr.lines; let i = index"><select [(ngModel)]="l.sku"><option value="">—</option><option *ngFor="let p of tracked()" [value]="p.code">{{ p.code }} · {{ p.data['name'] }}</option></select>
            <input type="number" min="1" [(ngModel)]="l.qty" /><button class="ghost sm" (click)="tr.lines.splice(i, 1)"><app-icon name="x" [size]="14"></app-icon></button></div>
          <button class="ghost sm" (click)="tr.lines.push({ sku: '', qty: 1 })">+ {{ 'pos.product' | translate }}</button>
          <p class="flash bad" *ngIf="error">{{ error }}</p></div>
        <div class="modal-foot"><button (click)="dlg = ''">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="saveTransfer()">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .seg { display: flex; gap: 6px; margin-bottom: 12px; } .seg button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; } .search { max-width: 260px; } .grow { flex: 1; } .chk { display: flex; gap: 6px; align-items: center; } .chk input { width: auto; }
    .act { text-align: end; white-space: nowrap; } .low { color: var(--bad); font-weight: 700; } .neg { color: var(--bad); } .full { grid-column: 1 / -1; }
    .trl { display: grid; grid-template-columns: 1fr 90px auto; gap: 8px; margin-top: 8px; }
  `]
})
export class PosStockComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); pos = inject(PosService); i18n = inject(I18nService);
  tab = signal<Tab>('levels'); q = signal(''); lowOnly = signal(false);
  stock = signal<PosRec[]>([]); transfers = signal<PosRec[]>([]); moves = signal<PosRec[]>([]);
  dlg: '' | 'adjust' | 'transfer' = ''; msg = ''; error = '';
  adj: { sku: string; branch: string; qty: number; counted: any; reason: string } = { sku: '', branch: '', qty: 0, counted: '', reason: '' };
  tr: { from: string; to: string; lines: { sku: string; qty: number }[] } = { from: '', to: '', lines: [{ sku: '', qty: 1 }] };

  tracked = computed(() => this.pos.products().filter(p => p.data['trackStock']));
  rows = computed(() => {
    const locs = this.pos.hasBranches() ? (this.ctx.branch() === 'ALL' ? this.ctx.branches().map(b => b.code) : [this.ctx.branch()]) : [''];
    const q = this.q().toLowerCase().trim(); const out: { sku: string; name: string; branch: string; qty: number; reorder: number; cost: number; low: boolean }[] = [];
    for (const p of this.tracked()) for (const b of locs) {
      const s = this.stock().find(x => x.code === `${b}|${p.code}`);
      const qty = Number(s?.data['qty']) || 0, reorder = Number(p.data['reorder']) || 0;
      const name = p.data['name'] ?? '';
      if (q && !(p.code ?? '').toLowerCase().includes(q) && !String(name).toLowerCase().includes(q)) continue;
      if (this.lowOnly() && qty > reorder) continue;
      out.push({ sku: p.code!, name, branch: b, qty, reorder, cost: Number(p.data['cost']) || 0, low: qty <= reorder });
    }
    return out;
  });
  value = computed(() => this.rows().reduce((a, r) => a + r.qty * r.cost, 0));

  constructor() {
    effect(() => { const c = this.ctx.company(); this.ctx.branch(); this.load(c); });
  }
  load(c = this.ctx.company()) {
    this.pos.loadCatalog(c, this.pos.branch()).subscribe();
    forkJoin([
      this.pos.records('stock', { company: c, take: 5000 }).pipe(catchError(() => of([] as PosRec[]))),
      this.pos.records('transfer', { company: c, take: 200 }).pipe(catchError(() => of([] as PosRec[]))),
      this.pos.records('stockmove', { company: c, branch: this.pos.hasBranches() ? this.ctx.branch() : null, take: 300 }).pipe(catchError(() => of([] as PosRec[]))),
    ]).subscribe(([s, t, m]) => { this.stock.set(s); this.transfers.set(t); this.moves.set(m); });
  }
  flash(t: string) { this.msg = t; setTimeout(() => this.msg = '', 2500); }
  summary(t: PosRec) { return ((t.data['lines'] as any[]) ?? []).map(l => `${l.sku} × ${l.qty}`).join(', '); }

  openAdjust(r: { sku: string; branch: string; qty: number }) { this.adj = { sku: r.sku, branch: r.branch, qty: r.qty, counted: r.qty, reason: '' }; this.error = ''; this.dlg = 'adjust'; }
  saveAdjust() {
    const n = Number(this.adj.counted); if (this.adj.counted === '' || isNaN(n)) { this.error = this.i18n.t('hr.err.required'); return; }
    this.pos.adjust({ company: this.ctx.company(), branch: this.adj.branch || undefined, sku: this.adj.sku, counted: n, reason: this.adj.reason })
      .subscribe({ next: () => { this.dlg = ''; this.flash(this.i18n.t('hr.saved')); this.load(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  openTransfer() {
    const bs = this.ctx.branches(); this.tr = { from: this.pos.branch() || bs[0]?.code || '', to: bs.find(b => b.code !== this.pos.branch())?.code ?? '', lines: [{ sku: '', qty: 1 }] };
    this.error = ''; this.dlg = 'transfer'; this.tab.set('transfers');
  }
  saveTransfer() {
    const lines = this.tr.lines.filter(l => l.sku && l.qty > 0);
    if (!lines.length) { this.error = this.i18n.t('pos.stock.addLine'); return; }
    this.pos.transfer({ company: this.ctx.company(), fromBranch: this.tr.from, toBranch: this.tr.to, lines })
      .subscribe({ next: () => { this.dlg = ''; this.flash(this.i18n.t('hr.saved')); this.load(); }, error: e => this.error = errMsg(e, this.i18n) });
  }
  receive(t: PosRec) { this.pos.receive(t.id).subscribe({ next: () => { this.flash(this.i18n.t('pos.stock.received')); this.load(); }, error: e => this.error = errMsg(e, this.i18n) }); }
}
