import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { STAGES, StageKey, TrackerStep } from '../core/erp';
import { TranslatePipe } from '../core/translate.pipe';

/** Vertical step tracker for one document (mobile layout of the portal's tracker). */
@Component({
  selector: 'app-process-tracker',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="lifecycle" *ngIf="stage">
      <span class="lc" *ngFor="let s of stages; let i = index" [class.done]="i < stageIndex" [class.current]="i === stageIndex" [class.final]="stage === 'closed' && i === stageIndex"></span>
    </div>
    <div class="lc-label" *ngIf="stage">{{ ('stage.' + stage) | translate }}</div>
    <ol class="steps">
      <li *ngFor="let s of steps; let last = last" [class]="s.state">
        <div class="rail">
          <span class="circle">{{ s.state === 'done' ? '✓' : s.state === 'rejected' ? '✕' : '' }}<i *ngIf="s.state === 'current'"></i></span>
          <span class="line" *ngIf="!last"></span>
        </div>
        <div class="info">
          <div class="name">{{ s.name }}</div>
          <div class="meta">{{ ('step.' + s.state) | translate }}<span *ngIf="s.actor && s.state !== 'pending'"> · {{ s.actor }}</span><span *ngIf="s.at && (s.state === 'done' || s.state === 'rejected')"> · {{ s.at | date:'short' }}</span></div>
        </div>
      </li>
    </ol>
  `,
  styles: [`
    .lifecycle { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
    .lc { height: 5px; border-radius: 4px; background: var(--erp-panel-3); }
    .lc.done { background: #6366f1; opacity: .5; }
    .lc.current { background: var(--erp-accent); }
    .lc.final { background: var(--erp-green); opacity: 1; }
    .lc-label { font-size: 12px; font-weight: 600; color: var(--erp-accent); margin: 6px 0 12px; }
    .steps { list-style: none; margin: 0; padding: 0; }
    li { display: flex; gap: 12px; }
    .rail { display: flex; flex-direction: column; align-items: center; }
    .circle { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--erp-border); background: var(--erp-panel); display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0; }
    .circle i { width: 8px; height: 8px; border-radius: 50%; background: var(--erp-accent); animation: blink 1.2s infinite; }
    .line { width: 2px; flex: 1; min-height: 18px; background: var(--erp-border); margin: 3px 0; }
    li.done .circle { background: var(--erp-green); border-color: var(--erp-green); }
    li.done .line { background: var(--erp-green); }
    li.rejected .circle { background: var(--erp-red); border-color: var(--erp-red); }
    li.current .circle { border-color: var(--erp-accent); background: var(--erp-accent-soft); }
    li.skipped .circle { border-style: dashed; }
    .info { padding-bottom: 14px; min-width: 0; }
    .name { font-size: 14px; font-weight: 600; }
    li.pending .name, li.skipped .name { color: var(--erp-dim); font-weight: 500; }
    .meta { font-size: 12px; color: var(--erp-dim); margin-top: 2px; }
    li.current .meta { color: var(--erp-accent); font-weight: 600; }
    li.rejected .meta { color: var(--erp-red); }
  `]
})
export class ProcessTrackerComponent {
  @Input() steps: TrackerStep[] = [];
  @Input() stage?: StageKey;
  stages = STAGES;
  get stageIndex(): number { return this.stage ? STAGES.indexOf(this.stage) : -1; }
}
