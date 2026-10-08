import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../core/translate.pipe';
import { AssistantChatComponent } from './assistant-chat.component';
import { ErpDataService } from '../core/erp-data.service';
import { MoneyPipe } from '../core/money.pipe';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'app-assistant-page',
  standalone: true,
  imports: [CommonModule, TranslatePipe, AssistantChatComponent, MoneyPipe, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1>{{ 'ai.title' | translate }}</h1>
        <p class="sub">{{ 'ai.sub' | translate }}</p>
      </div>
    </div>
    <div class="layout">
      <div class="card chat-card"><app-assistant-chat /></div>
      <div class="side">
        <div class="card mini">
          <div class="lbl"><app-icon name="trend" [size]="15" /> {{ 'dash.forecast' | translate }}</div>
          <div class="val">{{ erp.kpis().forecastNextMonthSales | money }}</div>
        </div>
        <div class="card mini">
          <div class="lbl"><app-icon name="check" [size]="15" /> {{ 'kpi.pending' | translate }}</div>
          <div class="val">{{ erp.pendingCount() }}</div>
        </div>
        <div class="card mini">
          <div class="lbl"><app-icon name="clock" [size]="15" /> {{ 'kpi.cycle' | translate }}</div>
          <div class="val">{{ erp.kpis().avgCycleHours | number:'1.0-1' }} {{ 'kpi.hours' | translate }}</div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 1fr 260px; gap: 18px; }
    .chat-card { height: calc(100vh - 210px); min-height: 460px; overflow: hidden; display: flex; flex-direction: column; }
    .side { display: flex; flex-direction: column; gap: 12px; }
    .mini { padding: 14px 16px; }
    .lbl { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); }
    .val { font-size: 20px; font-weight: 700; margin-top: 6px; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .side { flex-direction: row; flex-wrap: wrap; } .mini { flex: 1; min-width: 140px; } }
  `]
})
export class AssistantPage {
  constructor(public erp: ErpDataService) {}
}
