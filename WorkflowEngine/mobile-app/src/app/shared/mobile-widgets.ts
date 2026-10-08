import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  documentTextOutline, checkboxOutline, cartOutline, cubeOutline, bookOutline, barChartOutline,
  checkmark, close, chevronForward
} from 'ionicons/icons';
import { TranslatePipe } from '../core/translate.pipe';
import { ErpDoc } from '../core/erp-data.service';
import { ModuleKey, STAGES, StageKey } from '../core/erp.config';
import { LocalDatePipe, MoneyPipe } from './ui';

addIcons({ documentTextOutline, checkboxOutline, cartOutline, cubeOutline, bookOutline, barChartOutline, checkmark, close, chevronForward });

export const ION_ICON: Record<ModuleKey, string> = {
  sales: 'trending-up-outline', purchasing: 'cart-outline', inventory: 'cube-outline',
  finance: 'wallet-outline', hr: 'people-outline', operations: 'settings-outline',
};

const STAGE_ICON: Record<StageKey, string> = {
  request: 'document-text-outline', approval: 'checkbox-outline', purchase: 'cart-outline',
  inventory: 'cube-outline', accounting: 'book-outline', reporting: 'bar-chart-outline',
};

// ---------------------------------------------------------------- KPI tile
@Component({
  selector: 'm-kpi',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <div class="kpi">
      <span class="ic" [style.color]="color" [style.background]="color + '1f'"><ion-icon [name]="icon"></ion-icon></span>
      <div class="label">{{ label }}</div>
      <div class="value">{{ value }}</div>
      <div class="hint" *ngIf="hint">{{ hint }}</div>
    </div>
  `,
  styles: [`
    .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 12px 13px; height: 100%; }
    .ic { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; font-size: 16px; margin-bottom: 8px; }
    .label { font-size: 11.5px; color: var(--text-dim); font-weight: 500; }
    .value { font-size: 18px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; line-height: 1.2; }
    .hint { font-size: 10.5px; color: var(--text-dim); margin-top: 3px; }
  `]
})
export class MKpiComponent {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() icon = 'document-text-outline';
  @Input() color = '#4338ca';
  @Input() hint = '';
}

// ---------------------------------------------------------------- end-to-end flow strip
@Component({
  selector: 'm-flow',
  standalone: true,
  imports: [CommonModule, IonIcon, TranslatePipe, MoneyPipe],
  template: `
    <div class="strip">
      <ng-container *ngFor="let s of stages; let last = last">
        <button class="st" [class.on]="active === s" (click)="pick.emit(s)">
          <ion-icon [name]="icon(s)"></ion-icon>
          <span class="n">{{ ('stage.' + s) | translate }}</span>
          <strong>{{ counts?.[s]?.count ?? 0 }}</strong>
          <small>{{ (counts?.[s]?.value ?? 0) | money:currency:true }}</small>
        </button>
        <ion-icon *ngIf="!last" class="arr" name="chevron-forward"></ion-icon>
      </ng-container>
    </div>
  `,
  styles: [`
    .strip { display: flex; align-items: center; gap: 4px; overflow-x: auto; padding: 2px 2px 6px; scrollbar-width: none; }
    .st { flex: 0 0 auto; min-width: 92px; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 10px 11px; border-radius: 12px;
      background: var(--surface); border: 1px solid var(--border); color: var(--text); font-family: inherit; text-align: start; }
    .st.on { border-color: var(--primary); background: var(--primary-soft); }
    .st ion-icon { font-size: 17px; color: var(--primary); margin-bottom: 4px; }
    .n { font-size: 11px; color: var(--text-2); font-weight: 600; }
    strong { font-size: 19px; line-height: 1.15; }
    small { font-size: 10.5px; color: var(--text-dim); }
    .arr { color: var(--text-dim); font-size: 14px; flex-shrink: 0; }
    :host-context(html[dir="rtl"]) .arr { transform: scaleX(-1); }
  `]
})
export class MFlowComponent {
  @Input() stages: StageKey[] = STAGES;
  @Input() counts: Record<StageKey, { count: number; value: number }> | null = null;
  @Input() active: StageKey | null = null;
  @Input() currency = 'SAR';
  @Output() pick = new EventEmitter<StageKey>();
  icon(s: StageKey) { return STAGE_ICON[s]; }
}

// ---------------------------------------------------------------- stepper (vertical, phone friendly)
@Component({
  selector: 'm-stepper',
  standalone: true,
  imports: [CommonModule, IonIcon, TranslatePipe],
  template: `
    <div class="steps">
      <div class="s" *ngFor="let s of stages; let i = index; let last = last" [class]="stateOf(i)">
        <div class="rail">
          <span class="node">
            <ion-icon *ngIf="stateOf(i) === 'done'" name="checkmark"></ion-icon>
            <ion-icon *ngIf="stateOf(i) === 'bad'" name="close"></ion-icon>
            <span *ngIf="stateOf(i) === 'todo' || stateOf(i) === 'current'">{{ i + 1 }}</span>
          </span>
          <span class="line" *ngIf="!last"></span>
        </div>
        <div class="txt">
          <strong>{{ ('stage.' + s) | translate }}</strong>
          <small *ngIf="stateOf(i) === 'current' && step">{{ step }}</small>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .s { display: flex; gap: 12px; }
    .rail { display: flex; flex-direction: column; align-items: center; }
    .node { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 11.5px; font-weight: 700;
      background: var(--surface-3); color: var(--text-dim); border: 2px solid var(--border); }
    .line { width: 2px; flex: 1; min-height: 14px; background: var(--border); margin: 2px 0; }
    .done .node { background: var(--ok); border-color: var(--ok); color: #fff; }
    .done .line { background: var(--ok); }
    .current .node { background: var(--surface); border-color: var(--primary); color: var(--primary); box-shadow: 0 0 0 4px var(--primary-soft); }
    .bad .node { background: var(--bad); border-color: var(--bad); color: #fff; }
    .txt { padding: 3px 0 14px; display: flex; flex-direction: column; }
    .txt strong { font-size: 13.5px; font-weight: 600; color: var(--text-2); }
    .current .txt strong { color: var(--primary); }
    .txt small { font-size: 12px; color: var(--text-dim); }
  `]
})
export class MStepperComponent {
  @Input() stages: StageKey[] = [];
  @Input() current: StageKey = 'request';
  @Input() status: string = 'pending';
  @Input() step = '';

  stateOf(i: number): 'done' | 'current' | 'todo' | 'bad' {
    const idx = Math.max(0, this.stages.indexOf(this.current));
    if (this.status === 'approved') return 'done';
    if (this.status === 'rejected' || this.status === 'canceled') return i < idx ? 'done' : i === idx ? 'bad' : 'todo';
    const cur = Math.max(1, idx);
    return i < cur ? 'done' : i === cur ? 'current' : 'todo';
  }
}

// ---------------------------------------------------------------- document row
@Component({
  selector: 'm-doc-row',
  standalone: true,
  imports: [CommonModule, TranslatePipe, MoneyPipe, LocalDatePipe],
  template: `
    <div class="row">
      <div class="main">
        <div class="top"><span class="mono">{{ doc.number }}</span><span class="badge-pill" [class]="doc.status">{{ ('filter.' + doc.status) | translate }}</span></div>
        <div class="title">{{ doc.docType ? (('doc.' + doc.docType.key) | translate) : doc.title }}<span class="dim" *ngIf="doc.party"> · {{ doc.party }}</span></div>
        <div class="sub dim">{{ doc.date | ldate:'short' }} · {{ ('stage.' + doc.stage) | translate }} · {{ doc.step }}</div>
      </div>
      <div class="amt num">{{ doc.total !== null ? (doc.total | money:doc.currency:true) : '' }}</div>
    </div>
  `,
  styles: [`
    .row { display: flex; gap: 10px; align-items: center; padding: 12px 14px; }
    .main { flex: 1; min-width: 0; }
    .top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .title { font-size: 14px; font-weight: 600; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amt { font-weight: 700; font-size: 14px; white-space: nowrap; align-self: flex-end; }
  `]
})
export class MDocRowComponent {
  @Input({ required: true }) doc!: ErpDoc;
}
