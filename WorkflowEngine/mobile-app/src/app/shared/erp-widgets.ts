import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe } from '../core/translate.pipe';
import { I18nService } from '../core/i18n.service';
import { ErpDoc } from '../core/erp-data.service';
import { STAGES, StageKey } from '../core/erp.config';
import { IconComponent, LocalDatePipe, MoneyPipe, NumPipe, StatusComponent } from './ui';

// ---------------------------------------------------------------- KPI card
@Component({
  selector: 'app-kpi',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="kpi" [class.clickable]="clickable">
      <div class="ic" [style.color]="color" [style.background]="color + '1a'"><app-icon [name]="icon" [size]="18"></app-icon></div>
      <div class="body">
        <div class="label">{{ label }}</div>
        <div class="value">{{ value }}</div>
        <div class="hint" *ngIf="hint">{{ hint }}</div>
      </div>
    </div>
  `,
  styles: [`
    .kpi { display: flex; gap: 14px; align-items: flex-start; padding: 16px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); height: 100%; }
    .kpi.clickable { cursor: pointer; transition: border-color .15s, transform .15s; }
    .kpi.clickable:hover { border-color: var(--primary); transform: translateY(-1px); }
    .ic { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0; }
    .body { min-width: 0; }
    .label { font-size: 12.5px; color: var(--text-dim); font-weight: 500; }
    .value { font-size: 21px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; line-height: 1.2; white-space: nowrap; }
    .hint { font-size: 11.5px; color: var(--text-dim); margin-top: 3px; }
  `]
})
export class KpiCardComponent {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() icon = 'grid';
  @Input() color = '#4338ca';
  @Input() hint = '';
  @Input() clickable = false;
}

// ---------------------------------------------------------------- end-to-end flow
const STAGE_ICON: Record<StageKey, string> = {
  request: 'file', approval: 'check-square', purchase: 'cart', inventory: 'box', accounting: 'book', reporting: 'bar-chart',
};

@Component({
  selector: 'app-flow',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent, MoneyPipe],
  template: `
    <div class="flow">
      <ng-container *ngFor="let s of stages; let last = last">
        <button class="stage" [class.active]="active === s" (click)="pick.emit(s)">
          <span class="ic"><app-icon [name]="icon(s)" [size]="18"></app-icon></span>
          <span class="name">{{ ('stage.' + s) | translate }}</span>
          <span class="count">{{ counts?.[s]?.count ?? 0 }}</span>
          <span class="val">{{ (counts?.[s]?.value ?? 0) | money:currency:true }}</span>
        </button>
        <span class="arrow" *ngIf="!last"><app-icon name="chevron" [size]="16"></app-icon></span>
      </ng-container>
    </div>
  `,
  styles: [`
    .flow { display: flex; align-items: stretch; gap: 6px; overflow-x: auto; padding: 2px; }
    .stage { flex: 1; min-width: 118px; flex-direction: column; align-items: flex-start; gap: 3px; padding: 12px 14px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); text-align: start; }
    .stage:hover { border-color: var(--primary); background: var(--primary-soft); }
    .stage.active { border-color: var(--primary); background: var(--primary-soft); box-shadow: 0 0 0 3px var(--primary-soft); }
    .ic { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--surface); color: var(--primary); border: 1px solid var(--border); margin-bottom: 6px; }
    .name { font-size: 12px; color: var(--text-2); font-weight: 600; }
    .count { font-size: 22px; font-weight: 700; color: var(--text); line-height: 1.1; }
    .val { font-size: 11.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
    .arrow { display: grid; place-items: center; color: var(--text-dim); }
    :host-context(html[dir="rtl"]) .arrow { transform: scaleX(-1); }
  `]
})
export class FlowComponent {
  @Input() stages: StageKey[] = STAGES;
  @Input() counts: Record<StageKey, { count: number; value: number }> | null = null;
  @Input() active: StageKey | null = null;
  @Input() currency = 'SAR';
  @Output() pick = new EventEmitter<StageKey>();
  icon(s: StageKey) { return STAGE_ICON[s]; }
}

// ---------------------------------------------------------------- stepper for one document
@Component({
  selector: 'app-stepper',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IconComponent],
  template: `
    <ol class="steps" [class.vertical]="vertical">
      <li *ngFor="let s of stages; let i = index" [class.done]="stateOf(i) === 'done'" [class.current]="stateOf(i) === 'current'" [class.bad]="stateOf(i) === 'bad'">
        <span class="node">
          <app-icon *ngIf="stateOf(i) === 'done'" name="check" [size]="14" [stroke]="2.6"></app-icon>
          <app-icon *ngIf="stateOf(i) === 'bad'" name="x" [size]="14" [stroke]="2.6"></app-icon>
          <span *ngIf="stateOf(i) === 'todo' || stateOf(i) === 'current'">{{ i + 1 }}</span>
        </span>
        <span class="lbl">{{ ('stage.' + s) | translate }}</span>
        <span class="sub" *ngIf="stateOf(i) === 'current' && step">{{ step }}</span>
      </li>
    </ol>
  `,
  styles: [`
    .steps { list-style: none; margin: 0; padding: 0; display: flex; }
    li { flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; position: relative; gap: 6px; min-width: 0; }
    li::before { content: ''; position: absolute; top: 15px; inset-inline-start: calc(-50% + 18px); inset-inline-end: calc(50% + 18px); height: 2px; background: var(--border); }
    li:first-child::before { display: none; }
    li.done::before, li.current::before, li.bad::before { background: var(--ok); }
    .node { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--surface-3); color: var(--text-dim); border: 2px solid var(--border); z-index: 1; }
    .done .node { background: var(--ok); border-color: var(--ok); color: #fff; }
    .current .node { background: var(--surface); border-color: var(--primary); color: var(--primary); box-shadow: 0 0 0 4px var(--primary-soft); }
    .bad .node { background: var(--bad); border-color: var(--bad); color: #fff; }
    .lbl { font-size: 12px; font-weight: 600; color: var(--text-2); }
    .current .lbl { color: var(--primary); }
    .sub { font-size: 11px; color: var(--text-dim); max-width: 120px; }
    .vertical { flex-direction: column; gap: 10px; }
    .vertical li { flex-direction: row; text-align: start; gap: 10px; }
    .vertical li::before { top: -10px; bottom: auto; height: 10px; width: 2px; inset-inline-start: 14px; inset-inline-end: auto; }
    .vertical .node { width: 30px; height: 30px; }
    .vertical .sub { max-width: none; }
  `]
})
export class StepperComponent {
  @Input() stages: StageKey[] = [];
  @Input() current: StageKey = 'request';
  @Input() status: string = 'pending';
  @Input() step = '';
  @Input() vertical = false;

  stateOf(i: number): 'done' | 'current' | 'todo' | 'bad' {
    const idx = Math.max(0, this.stages.indexOf(this.current));
    if (this.status === 'approved') return 'done';
    if (this.status === 'rejected' || this.status === 'canceled') return i < idx ? 'done' : i === idx ? 'bad' : 'todo';
    // the request stage is always done once the document exists
    const cur = Math.max(1, idx);
    return i < cur ? 'done' : i === cur ? 'current' : 'todo';
  }
}

// ---------------------------------------------------------------- document table
@Component({
  selector: 'app-doc-table',
  standalone: true,
  imports: [CommonModule, TranslatePipe, MoneyPipe, LocalDatePipe, StatusComponent, NumPipe],
  template: `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>{{ 'col.number' | translate }}</th>
            <th>{{ 'col.type' | translate }}</th>
            <th>{{ 'col.party' | translate }}</th>
            <th>{{ 'col.date' | translate }}</th>
            <th *ngIf="showBranch">{{ 'col.branch' | translate }}</th>
            <th>{{ 'col.step' | translate }}</th>
            <th>{{ 'col.status' | translate }}</th>
            <th class="num">{{ 'col.amount' | translate }}</th>
          </tr>
        </thead>
        <tbody>
          <tr class="click" *ngFor="let d of docs" (click)="open(d)">
            <td class="mono strong">{{ d.number }}</td>
            <td>{{ d.docType ? (('doc.' + d.docType.key) | translate) : d.title }}</td>
            <td>{{ d.party || '—' }}</td>
            <td class="dim">{{ d.date | ldate }}</td>
            <td *ngIf="showBranch" class="dim">{{ d.branch || '—' }}</td>
            <td><span class="dim">{{ ('stage.' + d.stage) | translate }}</span> · {{ d.step }}</td>
            <td><app-status [status]="d.status" [label]="('filter.' + d.status) | translate"></app-status></td>
            <td class="num strong">{{ d.total !== null ? (d.total | money:d.currency) : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="empty" *ngIf="!docs.length">{{ emptyText || ('docs.none' | translate) }}</div>
    </div>
  `,
  styles: [`.strong { font-weight: 600; }`]
})
export class DocTableComponent {
  @Input() docs: ErpDoc[] = [];
  @Input() showBranch = true;
  @Input() emptyText = '';
  constructor(private router: Router) {}
  open(d: ErpDoc) { this.router.navigate(['/documents', d.id]); }
}

// ---------------------------------------------------------------- grouped bar chart
@Component({
  selector: 'app-trend-chart',
  standalone: true,
  imports: [CommonModule, MoneyPipe],
  template: `
    <div class="legend">
      <span class="cur">{{ currency }}</span>
      <span><i [style.background]="'var(--chart-1)'"></i>{{ labelA }}</span>
      <span><i [style.background]="'var(--chart-2)'"></i>{{ labelB }}</span>
    </div>
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" class="chart" role="img">
      <g *ngFor="let t of ticks">
        <line [attr.x1]="padL" [attr.x2]="W" [attr.y1]="y(t)" [attr.y2]="y(t)" class="grid"></line>
        <text [attr.x]="padL - 8" [attr.y]="y(t) + 4" text-anchor="end" class="tick">{{ compact(t) }}</text>
      </g>
      <g *ngFor="let p of points; let i = index">
        <rect [attr.x]="bx(i)" [attr.y]="y(p.a)" [attr.width]="bw" [attr.height]="h(p.a)" rx="4" fill="var(--chart-1)"><title>{{ p.label }}: {{ p.a | money:currency }}</title></rect>
        <rect [attr.x]="bx(i) + bw + 4" [attr.y]="y(p.b)" [attr.width]="bw" [attr.height]="h(p.b)" rx="4" fill="var(--chart-2)"><title>{{ p.label }}: {{ p.b | money:currency }}</title></rect>
        <text [attr.x]="bx(i) + bw + 2" [attr.y]="H - 6" text-anchor="middle" class="tick">{{ p.label }}</text>
      </g>
    </svg>
  `,
  styles: [`
    .legend { display: flex; gap: 16px; font-size: 12px; color: var(--text-2); margin-bottom: 8px; }
    .legend .cur { margin-inline-start: auto; order: 9; color: var(--text-dim); font-weight: 600; }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-inline-end: 6px; vertical-align: -1px; }
    .chart { width: 100%; height: 230px; display: block; overflow: visible; }
    .grid { stroke: var(--border); stroke-dasharray: 3 4; }
    .tick { font-size: 10.5px; fill: var(--text-dim); font-family: var(--font); }
  `]
})
export class TrendChartComponent {
  @Input() points: { label: string; a: number; b: number }[] = [];
  @Input() labelA = '';
  @Input() labelB = '';
  @Input() currency = 'SAR';
  W = 640; H = 230; padL = 52; padB = 24; padT = 8;
  constructor(private i18n: I18nService) {}
  compact(v: number) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v); }

  get max() {
    const m = Math.max(1, ...this.points.map(p => Math.max(p.a, p.b)));
    const mag = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / mag) * mag;
  }
  get ticks() { const m = this.max; return [0, m / 4, m / 2, (3 * m) / 4, m]; }
  get slot() { return (this.W - this.padL) / Math.max(1, this.points.length); }
  get bw() { return Math.min(26, (this.slot - 22) / 2); }
  bx(i: number) { return this.padL + i * this.slot + (this.slot - (this.bw * 2 + 4)) / 2; }
  y(v: number) { return this.padT + (this.H - this.padB - this.padT) * (1 - v / this.max); }
  h(v: number) { return Math.max(v > 0 ? 2 : 0, (this.H - this.padB - this.padT) * (v / this.max)); }
}

// ---------------------------------------------------------------- horizontal bars
@Component({
  selector: 'app-hbars',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="row" *ngFor="let r of rows">
      <span class="name">{{ r.label }}</span>
      <span class="track"><span class="fill" [style.width.%]="pct(r.value)" [style.background]="r.color || 'var(--primary)'"></span></span>
      <span class="v">{{ r.display ?? r.value }}</span>
    </div>
    <div class="empty" *ngIf="!rows.length">—</div>
  `,
  styles: [`
    .row { display: grid; grid-template-columns: minmax(90px, 34%) 1fr auto; gap: 10px; align-items: center; padding: 6px 0; font-size: 12.5px; }
    .name { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .track { height: 8px; background: var(--surface-3); border-radius: 99px; overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: 99px; }
    .v { font-weight: 600; font-variant-numeric: tabular-nums; min-width: 28px; text-align: end; }
  `]
})
export class HBarsComponent {
  @Input() rows: { label: string; value: number; display?: string; color?: string }[] = [];
  pct(v: number) { const m = Math.max(1, ...this.rows.map(r => r.value)); return (v / m) * 100; }
}
