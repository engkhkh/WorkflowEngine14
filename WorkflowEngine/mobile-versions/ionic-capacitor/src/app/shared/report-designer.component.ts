import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollabConfig, CollabService } from '../core/collab.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from './ui';
import { errMsg } from '../hr/hr-util';

export interface ReportColumn { key: string; label: string; numeric: boolean; }
export interface ReportLayout {
  title: string; subtitle: string; header: string; footer: string; orientation: 'portrait' | 'landscape';
  columns: string[]; groupBy: string; totals: boolean; showDate: boolean; showUser: boolean; rowNumbers: boolean;
}

/**
 * Report designer: choose the columns, title, header / footer text, orientation, grouping and totals for the rows currently shown in a list,
 * preview it and print it / save it as PDF (browser print dialog). Layouts can be saved per list and shared with the workspace.
 * The printed document follows the UI direction, so Arabic / Urdu reports come out right-to-left.
 */
@Component({
  selector: 'app-report-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <div class="modal-scrim" (click)="close.emit()">
      <div class="modal wide rd" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3><app-icon name="printer" [size]="17"></app-icon> {{ 'collab.reportDesigner' | translate }}</h3></div>
        <div class="modal-body rdb">
          <div class="side">
            <div class="row2"><select [ngModel]="sel()" (ngModelChange)="choose($event)"><option value="">{{ 'collab.savedReports' | translate }}</option><option *ngFor="let c of saved()" [value]="c.id">{{ c.shared && !c.mine ? '👥 ' : '' }}{{ c.name }}</option></select>
              <button class="ghost sm danger-i" type="button" *ngIf="current()?.mine" (click)="del()"><app-icon name="trash" [size]="14"></app-icon></button></div>
            <label class="lbl">{{ 'collab.rep.title' | translate }}</label><input [(ngModel)]="L.title" />
            <label class="lbl">{{ 'collab.rep.subtitle' | translate }}</label><input [(ngModel)]="L.subtitle" />
            <label class="lbl">{{ 'collab.rep.header' | translate }}</label><textarea rows="2" [(ngModel)]="L.header"></textarea>
            <label class="lbl">{{ 'collab.rep.footer' | translate }}</label><textarea rows="2" [(ngModel)]="L.footer"></textarea>
            <label class="lbl">{{ 'collab.rep.orientation' | translate }}</label>
            <select [(ngModel)]="L.orientation"><option value="portrait">{{ 'collab.rep.portrait' | translate }}</option><option value="landscape">{{ 'collab.rep.landscape' | translate }}</option></select>
            <label class="lbl">{{ 'collab.rep.groupBy' | translate }}</label>
            <select [(ngModel)]="L.groupBy"><option value="">—</option><option *ngFor="let c of columns" [value]="c.key">{{ c.label }}</option></select>
            <label class="chk"><input type="checkbox" [(ngModel)]="L.totals" /> {{ 'collab.rep.totals' | translate }}</label>
            <label class="chk"><input type="checkbox" [(ngModel)]="L.rowNumbers" /> {{ 'collab.rep.rowNumbers' | translate }}</label>
            <label class="chk"><input type="checkbox" [(ngModel)]="L.showDate" /> {{ 'collab.rep.showDate' | translate }}</label>
            <label class="chk"><input type="checkbox" [(ngModel)]="L.showUser" /> {{ 'collab.rep.showUser' | translate }}</label>
            <label class="lbl">{{ 'collab.rep.columns' | translate }}</label>
            <div class="cols"><div *ngFor="let c of ordered(); let i = index" class="colrow">
              <label class="chk"><input type="checkbox" [checked]="L.columns.includes(c.key)" (change)="toggle(c.key)" /> {{ c.label }}</label>
              <span class="mv"><button type="button" class="ghost sm" (click)="move(c.key, -1)" [disabled]="i === 0">▲</button><button type="button" class="ghost sm" (click)="move(c.key, 1)" [disabled]="i === columns.length - 1">▼</button></span></div></div>
            <div class="save"><input [(ngModel)]="saveName" [placeholder]="'collab.rep.layoutName' | translate" /><label class="chk"><input type="checkbox" [(ngModel)]="shared" /> {{ 'collab.shareWorkspace' | translate }}</label>
              <button class="sm" type="button" (click)="save()" [disabled]="!saveName.trim()">{{ 'collab.rep.saveLayout' | translate }}</button></div>
            <p class="flash bad" *ngIf="error">{{ error }}</p>
          </div>
          <div class="prev"><iframe #fr class="frame" [srcdoc]="safeHtml()" title="report"></iframe></div>
        </div>
        <div class="modal-foot"><button (click)="close.emit()">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="print()"><app-icon name="printer" [size]="15"></app-icon> {{ 'collab.rep.print' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .rd { width: min(1100px, 97vw); } .rdb { display: grid; grid-template-columns: 300px 1fr; gap: 14px; min-height: 420px; } .side { display: grid; grid-auto-rows: min-content; gap: 6px; align-content: start; max-height: 62vh; overflow: auto; padding-inline-end: 6px; }
    .row2 { display: flex; gap: 6px; } .row2 select { flex: 1; } .danger-i { color: var(--bad); } .chk { display: flex; gap: 8px; align-items: center; font-size: 12.5px; } .chk input { width: auto; }
    .cols { border: 1px solid var(--border); border-radius: 8px; padding: 6px; display: grid; gap: 2px; max-height: 190px; min-height: 90px; overflow: auto; flex-shrink: 0; } .colrow { display: flex; justify-content: space-between; align-items: center; } .mv { display: inline-flex; }
    .save { display: grid; gap: 6px; margin-top: 6px; border-top: 1px solid var(--border); padding-top: 8px; }
    .prev { border: 1px solid var(--border); border-radius: 8px; background: #fff; overflow: hidden; } .frame { width: 100%; height: 62vh; border: 0; background: #fff; }
    @media (max-width: 760px) { .rdb { grid-template-columns: 1fr; } .frame { height: 40vh; } .side { max-height: 42vh; overflow: auto; } }
  `]
})
export class ReportDesignerComponent implements OnInit {
  @Input({ required: true }) view!: string;
  @Input({ required: true }) title!: string;
  @Input({ required: true }) columns!: ReportColumn[];
  @Input({ required: true }) rows!: Record<string, any>[];       // already formatted display values, keyed by column key
  @Input() user = '';
  @Output() close = new EventEmitter<void>();

  private api = inject(CollabService); private i18n = inject(I18nService); private san = inject(DomSanitizer);
  /** the document is built from escaped values only, so it is safe to hand to the sandbox-less preview frame as trusted HTML */
  safeHtml = (): SafeHtml => this.san.bypassSecurityTrustHtml(this.html());
  L: ReportLayout = { title: '', subtitle: '', header: '', footer: '', orientation: 'portrait', columns: [], groupBy: '', totals: true, showDate: true, showUser: true, rowNumbers: false };
  saved = signal<CollabConfig<ReportLayout>[]>([]); sel = signal(''); order = signal<string[]>([]);
  saveName = ''; shared = false; error = '';
  current = () => this.saved().find(c => c.id === this.sel());

  ngOnInit() {
    this.L.title = this.title; this.L.columns = this.columns.map(c => c.key); this.order.set(this.columns.map(c => c.key));
    if (this.columns.length > 6) this.L.orientation = 'landscape';
    this.api.configs<ReportLayout>('report', this.view).subscribe({ next: l => this.saved.set(l), error: () => {} });
  }
  ordered = () => this.order().map(k => this.columns.find(c => c.key === k)!).filter(Boolean);
  toggle(k: string) { this.L.columns = this.L.columns.includes(k) ? this.L.columns.filter(x => x !== k) : [...this.L.columns, k]; }
  move(k: string, d: number) { const o = [...this.order()]; const i = o.indexOf(k), j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; this.order.set(o); }
  choose(id: string) {
    this.sel.set(id); const c = this.saved().find(x => x.id === id); if (!c) return;
    const d = c.data ?? ({} as ReportLayout);
    const known = new Set(this.columns.map(x => x.key));
    this.L = { ...this.L, ...d, columns: (d.columns ?? this.L.columns).filter(k => known.has(k)) };
    const rest = this.columns.map(x => x.key).filter(k => !this.L.columns.includes(k));
    this.order.set([...this.L.columns, ...rest]);
  }
  save() {
    this.error = '';
    const data = { ...this.L, columns: this.ordered().map(c => c.key).filter(k => this.L.columns.includes(k)) };
    this.api.saveConfig<ReportLayout>('report', this.view, this.saveName.trim(), this.shared, data).subscribe({
      next: c => { this.saved.update(l => [...l.filter(x => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name))); this.sel.set(c.id); this.saveName = ''; },
      error: e => this.error = errMsg(e, this.i18n)
    });
  }
  del() { const c = this.current(); if (!c) return; this.api.deleteConfig('report', c.id).subscribe({ next: () => { this.saved.update(l => l.filter(x => x.id !== c.id)); this.sel.set(''); } }); }

  private esc(s: any) { return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!)); }
  private nf(n: number) { return new Intl.NumberFormat(this.i18n.locale, { maximumFractionDigits: 2 }).format(n); }
  private cols = () => this.ordered().filter(c => this.L.columns.includes(c.key));

  /** The printable document. */
  html = () => {
    const cols = this.cols(), rtl = this.i18n.isRtl, L = this.L;
    const num = (r: Record<string, any>, k: string) => Number(r[k + '#'] ?? r[k]) || 0;
    const head = `<tr>${L.rowNumbers ? '<th class="n">#</th>' : ''}${cols.map(c => `<th class="${c.numeric ? 'n' : ''}">${this.esc(c.label)}</th>`).join('')}</tr>`;
    const cell = (c: ReportColumn, r: Record<string, any>) => `<td class="${c.numeric ? 'n' : ''}">${this.esc(r[c.key] ?? '')}</td>`;
    let idx = 0;
    const row = (r: Record<string, any>) => `<tr>${L.rowNumbers ? `<td class="n">${++idx}</td>` : ''}${cols.map(c => cell(c, r)).join('')}</tr>`;
    const totalRow = (rows: Record<string, any>[], label: string) => !L.totals || !cols.some(c => c.numeric) ? '' :
      `<tr class="tot">${L.rowNumbers ? '<td></td>' : ''}${cols.map((c, i) => c.numeric ? `<td class="n">${this.nf(rows.reduce((s, r) => s + num(r, c.key), 0))}</td>` : `<td>${i === 0 ? this.esc(label) : ''}</td>`).join('')}</tr>`;
    let body = '';
    if (L.groupBy && cols.length) {
      const groups = new Map<string, Record<string, any>[]>();
      for (const r of this.rows) { const g = String(r[L.groupBy] ?? '') || '—'; (groups.get(g) ?? groups.set(g, []).get(g)!).push(r); }
      const span = cols.length + (L.rowNumbers ? 1 : 0);
      for (const [g, rs] of groups) body += `<tr class="grp"><td colspan="${span}">${this.esc(this.columns.find(c => c.key === L.groupBy)?.label)}: ${this.esc(g)} (${rs.length})</td></tr>${rs.map(row).join('')}${totalRow(rs, this.i18n.t('collab.rep.subtotal'))}`;
      body += totalRow(this.rows, this.i18n.t('collab.rep.total'));
    } else body = this.rows.map(row).join('') + totalRow(this.rows, this.i18n.t('collab.rep.total'));
    const meta = [L.showDate ? new Intl.DateTimeFormat(this.i18n.locale, { dateStyle: 'medium', timeStyle: 'short', calendar: 'gregory' }).format(new Date()) : '', L.showUser ? this.user : '', `${this.rows.length} ${this.i18n.t('collab.rep.rows')}`].filter(Boolean).join(' · ');
    return `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}" lang="${this.i18n.lang()}"><head><meta charset="utf-8"><title>${this.esc(L.title)}</title><style>
      @page { size: A4 ${L.orientation}; margin: 14mm; }
      body { font: 12px/1.45 'Segoe UI', Tahoma, Arial, sans-serif; color: #111; margin: 0; padding: 14px; }
      h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #555; margin-bottom: 4px; } .hdr { white-space: pre-wrap; margin: 6px 0; } .meta { color: #666; font-size: 11px; margin-bottom: 10px; border-bottom: 2px solid #111; padding-bottom: 6px; }
      table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ddd; padding: 5px 7px; text-align: start; vertical-align: top; } th { background: #f1f3f5; font-weight: 600; border-bottom: 1px solid #999; }
      .n { text-align: end; font-variant-numeric: tabular-nums; } tr.grp td { background: #e8ecf1; font-weight: 600; } tr.tot td { font-weight: 700; border-top: 1px solid #333; background: #fafafa; }
      thead { display: table-header-group; } tr { page-break-inside: avoid; } .ftr { white-space: pre-wrap; margin-top: 14px; color: #444; border-top: 1px solid #ccc; padding-top: 6px; }
    </style></head><body><h1>${this.esc(L.title)}</h1>${L.subtitle ? `<div class="sub">${this.esc(L.subtitle)}</div>` : ''}${L.header ? `<div class="hdr">${this.esc(L.header)}</div>` : ''}<div class="meta">${this.esc(meta)}</div>
      <table><thead>${head}</thead><tbody>${body}</tbody></table>${L.footer ? `<div class="ftr">${this.esc(L.footer)}</div>` : ''}</body></html>`;
  };

  print() {
    const fr = document.querySelector('iframe.frame') as HTMLIFrameElement | null;
    const w = fr?.contentWindow; if (!w) return;
    w.focus(); w.print();
  }
}
