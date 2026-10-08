import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PosService } from '../core/pos.service';
import { I18nService } from '../core/i18n.service';
import { ErpContextService } from '../core/erp-context.service';
import { TranslatePipe } from '../core/translate.pipe';
import { parseCsv } from '../core/hr.fields';
import { IconComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';

const FIELDS: Record<'product' | 'customer', { key: string; aliases: string[]; num?: boolean; bool?: boolean }[]> = {
  product: [
    { key: 'code', aliases: ['code', 'sku', 'itemcode', 'itemno', 'productcode'] }, { key: 'name', aliases: ['name', 'description', 'productname', 'item'] },
    { key: 'nameAr', aliases: ['namear', 'arabicname', 'name_ar'] }, { key: 'barcode', aliases: ['barcode', 'ean', 'upc'] }, { key: 'category', aliases: ['category', 'group'] },
    { key: 'price', aliases: ['price', 'unitprice', 'saleprice', 'sellingprice'], num: true }, { key: 'cost', aliases: ['cost', 'unitcost', 'purchaseprice'], num: true },
    { key: 'taxRate', aliases: ['taxrate', 'tax', 'vat', 'vatrate'] }, { key: 'trackStock', aliases: ['trackstock', 'stocked', 'inventory'], bool: true },
    { key: 'reorder', aliases: ['reorder', 'reorderlevel', 'minstock'], num: true },
  ],
  customer: [
    { key: 'code', aliases: ['code', 'customerno', 'id'] }, { key: 'name', aliases: ['name', 'customer', 'fullname'] }, { key: 'phone', aliases: ['phone', 'mobile', 'tel'] },
    { key: 'email', aliases: ['email', 'mail'] }, { key: 'discountPct', aliases: ['discountpct', 'discount', 'discount%'], num: true }, { key: 'points', aliases: ['points', 'loyaltypoints'], num: true },
  ],
};

/** Bulk-add products or customers from an Excel (.xlsx) or CSV file. Columns are matched by their header; rows with an existing code are updated. */
@Component({
  selector: 'app-pos-import',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent],
  template: `
    <div class="modal-scrim" (click)="closed.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'pos.imp.title' | translate }}</h3><button class="ghost icon-btn" (click)="closed.emit()"><app-icon name="x"></app-icon></button></div>
        <div class="modal-body">
          <p class="dim">{{ 'pos.imp.intro' | translate }}</p>
          <p class="mono cols">{{ cols() }}</p>
          <div class="row"><label class="btn"><app-icon name="download" [size]="15"></app-icon>{{ 'pos.imp.choose' | translate }}<input type="file" accept=".xlsx,.csv,.txt" (change)="onFile($event)" hidden /></label>
            <button (click)="template()">{{ 'hr.imp.template' | translate }}</button></div>
          <p class="flash bad" *ngIf="error">{{ error }}</p>
          <ng-container *ngIf="rows().length">
            <p><b>{{ fileName }}</b> · {{ 'hr.imp.rows' | translate: { n: rows().length } }}</p>
            <div class="table-wrap"><table class="data"><thead><tr><th *ngFor="let f of used()">{{ f }}</th></tr></thead>
              <tbody><tr *ngFor="let r of rows().slice(0, 6)"><td *ngFor="let f of used()">{{ r.data[f] ?? (f === 'code' ? r.code : '') }}</td></tr></tbody></table></div>
          </ng-container>
          <p class="flash good" *ngIf="result">{{ 'pos.imp.done' | translate: { c: result.created, u: result.updated, s: result.skipped } }}</p>
        </div>
        <div class="modal-foot"><button (click)="closed.emit()">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="run()" [disabled]="!rows().length || busy">{{ 'pos.imp.run' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`.row { display: flex; gap: 10px; align-items: center; margin: 10px 0; } .cols { font-size: 12px; word-break: break-word; } .btn { cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }`]
})
export class PosImportComponent {
  @Input({ required: true }) kind!: 'product' | 'customer';
  @Output() closed = new EventEmitter<void>();
  @Output() imported = new EventEmitter<void>();
  private pos = inject(PosService); private i18n = inject(I18nService); private ctx = inject(ErpContextService);
  rows = signal<{ code: string; data: Record<string, any> }[]>([]);
  fileName = ''; error = ''; busy = false; result: { created: number; updated: number; skipped: number } | null = null;

  cols = () => FIELDS[this.kind].map(f => f.key).join(', ');
  used = () => { const s = new Set<string>(); for (const r of this.rows()) for (const k of Object.keys(r.data)) s.add(k); return ['code', ...s]; };
  template() {
    const head = FIELDS[this.kind].map(f => f.key).join(',');
    const sample = this.kind === 'product' ? 'P-1001,Sample product,منتج تجريبي,6281000000001,General,25.00,15.00,,true,10' : 'C-1001,Sample customer,0500000000,a@b.com,0,0';
    const blob = new Blob(['﻿' + head + '\n' + sample + '\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pos-${this.kind}s-template.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  async onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    this.error = ''; this.result = null; this.fileName = f.name;
    try {
      const ext = f.name.toLowerCase().split('.').pop();
      let grid: unknown[][];
      if (ext === 'xlsx') { const { default: readXlsxFile } = await import('read-excel-file'); grid = (await readXlsxFile(f)) as unknown[][]; }
      else if (ext === 'csv' || ext === 'txt') grid = parseCsv(await f.text());
      else { this.error = this.i18n.t('hr.imp.badType'); return; }
      grid = grid.filter(r => r.some(c => c !== null && c !== undefined && String(c).trim() !== ''));
      if (grid.length < 2) { this.error = this.i18n.t('hr.imp.empty'); return; }
      if (grid.length > 5001) { this.error = this.i18n.t('hr.imp.tooMany'); return; }
      const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[\s_\-]/g, '');
      const idx = grid[0].map(h => FIELDS[this.kind].find(fd => fd.aliases.map(norm).includes(norm(h))));
      if (!idx.some(x => x?.key === 'code') || !idx.some(x => x?.key === 'name')) { this.error = this.i18n.t('pos.imp.needCols'); return; }
      this.rows.set(grid.slice(1).map(r => {
        const data: Record<string, any> = {}; let code = '';
        idx.forEach((fd, i) => {
          if (!fd) return; const v = r[i]; if (v === null || v === undefined || String(v).trim() === '') return;
          if (fd.key === 'code') code = String(v).trim();
          else if (fd.num) data[fd.key] = Number(v) || 0;
          else if (fd.bool) data[fd.key] = ['true', '1', 'yes', 'y', 'نعم'].includes(String(v).trim().toLowerCase());
          else data[fd.key] = String(v).trim();
        });
        return { code, data };
      }).filter(r => r.code));
    } catch { this.error = this.i18n.t('hr.imp.readError'); }
  }

  run() {
    this.busy = true; this.error = '';
    const rows = this.rows().map(r => ({ code: r.code, company: this.ctx.company(), data: r.data }));
    this.pos.bulk(this.kind, rows).subscribe({
      next: r => { this.busy = false; this.result = r; this.rows.set([]); this.imported.emit(); },
      error: e => { this.busy = false; this.error = errMsg(e, this.i18n); }
    });
  }
}
