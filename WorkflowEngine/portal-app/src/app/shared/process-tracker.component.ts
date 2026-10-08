import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { STAGES, StageKey, TrackerStep } from '../core/erp';
import { TranslatePipe } from '../core/translate.pipe';

/** Horizontal step tracker for one document: every human/accounting step of its process, with progress. */
@Component({
  selector: 'app-process-tracker',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="lifecycle" *ngIf="stage">
      <div class="lc" *ngFor="let s of stages; let i = index" [class.done]="i < stageIndex" [class.current]="i === stageIndex" [class.final]="stage === 'closed' && i === stageIndex">
        <span class="bar"></span>
        <span class="lbl">{{ ('stage.' + s) | translate }}</span>
      </div>
    </div>
    <ol class="steps">
      <li *ngFor="let s of steps; let last = last" [class]="s.state">
        <div class="marker">
          <span class="circle">
            <ng-container [ngSwitch]="s.state">
              <span *ngSwitchCase="'done'">✓</span>
              <span *ngSwitchCase="'rejected'">✕</span>
              <span *ngSwitchCase="'current'" class="pulse"></span>
              <span *ngSwitchDefault></span>
            </ng-container>
          </span>
          <span class="line" *ngIf="!last"></span>
        </div>
        <div class="info">
          <div class="name">{{ s.name }}</div>
          <div class="meta">
            <span>{{ ('step.' + s.state) | translate }}</span>
            <span *ngIf="s.actor && s.state !== 'pending'"> · {{ s.actor }}</span>
          </div>
          <div class="meta" *ngIf="s.at && (s.state === 'done' || s.state === 'rejected')">{{ s.at | date:'short' }}</div>
        </div>
      </li>
    </ol>
  `,
  styles: [`
    .lifecycle { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 18px; }
    .lc { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .lc .bar { height: 5px; border-radius: 4px; background: var(--panel-3); }
    .lc.done .bar { background: var(--accent-2); opacity: .55; }
    .lc.current .bar { background: var(--accent); }
    .lc.final .bar { background: var(--green); }
    .lc .lbl { font-size: 10.5px; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lc.current .lbl { color: var(--text); font-weight: 600; }
    .steps { list-style: none; margin: 0; padding: 0; display: flex; overflow-x: auto; padding-bottom: 4px; }
    li { flex: 1 0 128px; min-width: 128px; }
    .marker { display: flex; align-items: center; }
    .circle {
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center;
      font-size: 12px; font-weight: 700; border: 2px solid var(--border); background: var(--panel); color: var(--text-faint);
    }
    .line { flex: 1; height: 2px; background: var(--border); margin: 0 6px; }
    li.done .circle { background: var(--green); border-color: var(--green); color: #fff; }
    li.done .line { background: var(--green); }
    li.rejected .circle { background: var(--red); border-color: var(--red); color: #fff; }
    li.current .circle { border-color: var(--accent); background: var(--accent-soft); }
    li.skipped .circle { border-style: dashed; }
    .pulse { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); animation: blink 1.2s ease-in-out infinite; }
    .info { padding: 8px 10px 0 0; }
    :host-context([dir="rtl"]) .info { padding: 8px 0 0 10px; }
    .name { font-size: 12.5px; font-weight: 600; line-height: 1.3; }
    li.pending .name, li.skipped .name { color: var(--text-dim); font-weight: 500; }
    .meta { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
    li.current .meta span:first-child { color: var(--accent); font-weight: 600; }
    li.rejected .meta span:first-child { color: var(--red); font-weight: 600; }
    @media (max-width: 640px) { .lifecycle { grid-template-columns: repeat(4, 1fr); } }
  `]
})
export class ProcessTrackerComponent {
  @Input() steps: TrackerStep[] = [];
  @Input() stage?: StageKey;
  stages = STAGES;
  get stageIndex(): number { return this.stage ? STAGES.indexOf(this.stage) : -1; }
}
