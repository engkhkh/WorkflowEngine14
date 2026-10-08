import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, KeyValuePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, interval, switchMap, startWith } from 'rxjs';
import { WorkflowService } from '../core/services/workflow.service';
import { AuthService } from '../core/services/auth.service';
import { WorkflowDefinition, WorkflowInstance, ActivityLogEntry } from '../core/models/workflow.models';
import { InstanceDiagramComponent } from './instance-diagram.component';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { I18nService } from '../core/i18n/i18n.service';

@Component({
  selector: 'app-instance-detail',
  standalone: true,
  imports: [CommonModule, KeyValuePipe, RouterLink, InstanceDiagramComponent, TranslatePipe],
  template: `
    <div class="page" *ngIf="instance as i">
      <a routerLink="/instances" class="back-link">{{ 'instances.backToAll' | translate }}</a>
      <div class="header">
        <h1>{{ i.definitionName }}</h1>
        <span class="status" [class]="i.status.toLowerCase()">
          <i class="live-dot" *ngIf="i.status === 'Running'"></i>{{ i.status }}
        </span>
        <div class="spacer"></div>
        <button class="danger" *ngIf="canCancel(i)" (click)="cancel(i)" [disabled]="canceling">
          {{ canceling ? ('instances.canceling' | translate) : ('✕ ' + ('instances.cancelRequest' | translate)) }}
        </button>
      </div>
      <p class="meta">{{ 'instances.startedBy' | translate }} {{ i.startedBy }} · {{ i.startedAt | date:'medium' }}</p>

      <h3 class="section-title">{{ 'instances.processMap' | translate }}</h3>
      <app-instance-diagram [definition]="definition" [instance]="i"></app-instance-diagram>

      <div class="grid">
        <div class="panel">
          <h3>{{ 'instances.timeline' | translate }}</h3>
          <div class="timeline">
            <div class="entry" *ngFor="let h of i.history">
              <div class="dot" [class]="h.action.toLowerCase()"></div>
              <div class="entry-body">
                <div class="entry-title">{{ h.nodeName }} — {{ h.action }}</div>
                <div class="entry-meta">{{ h.timestamp | date:'short' }} <span *ngIf="h.actor"> · {{ h.actor }}</span></div>
                <div class="entry-comment" *ngIf="h.comment">"{{ h.comment }}"</div>
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <h3>{{ 'instances.collectedData' | translate }}</h3>
          <table class="data-table">
            <tr *ngFor="let kv of i.data | keyvalue">
              <td class="k">{{ kv.key }}</td>
              <td>{{ kv.value }}</td>
            </tr>
            <tr *ngIf="!i.data || objectKeys(i.data).length === 0"><td colspan="2" class="empty">{{ 'instances.noDataYet' | translate }}</td></tr>
          </table>
        </div>
      </div>

      <div class="panel log-panel">
        <button class="log-toggle" (click)="showLog = !showLog">
          {{ showLog ? '▾' : '▸' }} Persisted Activity Log ({{ activityLog.length }})
        </button>
        <p class="log-note" *ngIf="showLog">Read straight from the ActivityLogs database table (a durable, queryable
          record separate from this instance's own history above), and mirrored to a log file on the server under
          <code>Logs/</code>.</p>
        <table class="data-table" *ngIf="showLog">
          <thead><tr><th>Time</th><th>Node</th><th>Action</th><th>Actor</th><th>Comment</th></tr></thead>
          <tr *ngFor="let l of activityLog">
            <td class="dim">{{ l.timestamp | date:'short' }}</td>
            <td>{{ l.nodeName }}</td>
            <td>{{ l.action }}</td>
            <td class="dim">{{ l.actor || '—' }}</td>
            <td class="dim">{{ l.comment || '—' }}</td>
          </tr>
          <tr *ngIf="activityLog.length === 0"><td colspan="5" class="empty">No log entries yet.</td></tr>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 28px 32px; max-width: 1100px; }
    .back-link { font-size: 12px; color: var(--text-dim); text-decoration: none; }
    .back-link:hover { color: var(--text); }
    .header { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
    h1 { font-size: 22px; margin: 0; }
    .spacer { flex: 1; }
    .meta { color: var(--text-dim); font-size: 12px; margin: 4px 0 22px; }
    .status { font-size: 10px; padding: 3px 10px; border-radius: 20px; background: color-mix(in srgb, var(--accent) 16%, var(--panel)); color: var(--accent); display: inline-flex; align-items: center; gap: 5px; }
    .status.completed { background: color-mix(in srgb, var(--green) 16%, var(--panel)); color: var(--green); }
    .status.terminated { background: color-mix(in srgb, var(--red) 16%, var(--panel)); color: var(--red); }
    .live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: blink 1.2s ease-in-out infinite; }
    @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
    .section-title { font-size: 13px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .5px; margin: 0 0 10px; }
    .grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 20px; margin-top: 24px; }
    .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
    .panel h3 { margin: 0 0 12px; font-size: 13px; }
    .timeline { display: flex; flex-direction: column; gap: 14px; max-height: 420px; overflow-y: auto; }
    .entry { display: flex; gap: 10px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); margin-top: 4px; flex-shrink: 0; }
    .dot.approved { background: var(--green); }
    .dot.rejected { background: var(--red); }
    .dot.autocompleted { background: var(--text-dim); }
    .dot.escalated { background: var(--red); }
    .dot.canceled { background: var(--red); }
    .dot.forked, .dot.joined { background: #4fc3d9; }
    .entry-title { font-size: 13px; font-weight: 600; }
    .entry-meta { font-size: 11px; color: var(--text-dim); }
    .entry-comment { font-size: 12px; color: var(--text-dim); font-style: italic; margin-top: 2px; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .data-table td { padding: 6px 4px; border-bottom: 1px solid var(--border); }
    .data-table .k { color: var(--text-dim); width: 40%; }
    .empty { color: var(--text-dim); }
    .log-panel { margin-top: 20px; }
    .log-toggle { background: none; border: none; color: var(--text); font-size: 13px; font-weight: 600; padding: 0; cursor: pointer; }
    .log-note { font-size: 11px; color: var(--text-dim); margin: 8px 0 12px; line-height: 1.5; }
    .log-note code { background: var(--panel-2); padding: 1px 5px; border-radius: 4px; font-family: monospace; }
    .log-panel table th { text-align: left; font-size: 10px; color: var(--text-dim); text-transform: uppercase; padding: 6px 4px; border-bottom: 1px solid var(--border); }
    .dim { color: var(--text-dim); }
  `]
})
export class InstanceDetailComponent implements OnInit, OnDestroy {
  instance: WorkflowInstance | null = null;
  definition: WorkflowDefinition | null = null;
  objectKeys = Object.keys;
  canceling = false;
  showLog = false;
  activityLog: ActivityLogEntry[] = [];
  private sub?: Subscription;

  constructor(private route: ActivatedRoute, private wf: WorkflowService, private auth: AuthService, private i18n: I18nService) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;

    this.wf.getActivityLog(id).subscribe(log => this.activityLog = log);

    // Poll every 3s while the instance is still running, so the diagram/timeline update
    // live as other people complete tasks - stop once it reaches a terminal status.
    this.sub = interval(3000).pipe(
      startWith(0),
      switchMap(() => this.wf.getInstance(id))
    ).subscribe(instance => {
      this.instance = instance;
      if (!this.definition) {
        this.wf.getDefinition(instance.definitionId).subscribe(def => this.definition = def);
      }
      // Refresh the persisted log alongside the instance while things are still moving.
      this.wf.getActivityLog(id).subscribe(log => this.activityLog = log);
      if (instance.status !== 'Running') {
        this.sub?.unsubscribe();
      }
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  canCancel(i: WorkflowInstance): boolean {
    if (i.status !== 'Running') return false;
    const user = this.auth.currentUser();
    if (!user) return false;
    return user.username === i.startedBy || user.role === 'admin';
  }

  cancel(i: WorkflowInstance) {
    const msg = this.i18n.isRtl
      ? 'إلغاء هذا الطلب؟ سيتم إغلاق أي مهام معلقة عليه.'
      : 'Cancel this request? Any pending tasks on it will be closed out.';
    if (!confirm(msg)) return;
    this.canceling = true;
    this.wf.cancelInstance(i.id).subscribe({
      next: updated => { this.instance = updated; this.canceling = false; },
      error: err => { this.canceling = false; alert('Could not cancel: ' + (err.error ?? err.message)); }
    });
  }
}
