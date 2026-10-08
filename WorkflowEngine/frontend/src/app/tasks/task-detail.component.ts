import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorkflowService } from '../core/services/workflow.service';
import { WorkflowTask } from '../core/models/workflow.models';
import { DynamicFormComponent } from '../form-renderer/dynamic-form.component';
import { TranslatePipe } from '../core/i18n/translate.pipe';

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, DynamicFormComponent, TranslatePipe],
  template: `
    <div class="task-detail" *ngIf="task">
      <div class="header">
        <h2>{{ task.nodeName }}</h2>
        <span class="type-badge" [class.approval]="task.nodeType === 'ApprovalTask'">{{ task.nodeType }}</span>
      </div>

      <p class="instructions" *ngIf="instructions">{{ instructions }}</p>
      <p class="loading-note" *ngIf="loadingContext">Loading data collected earlier in this request…</p>

      <app-dynamic-form [form]="task.form" [values]="values"></app-dynamic-form>

      <div class="comment">
        <label class="field-label">{{ 'tasks.comment' | translate }}</label>
        <textarea rows="2" [(ngModel)]="comment" [placeholder]="'tasks.commentPlaceholder' | translate"></textarea>
      </div>

      <!-- One button per outcome this task's node actually defines - could be Approve/Reject,
           or Skelta-style custom outcomes like Suitable / Canceled / Timeout - Action. -->
      <div class="actions">
        <button *ngFor="let d of task.availableDecisions"
                [class]="styleFor(d)"
                (click)="complete(d)"
                [disabled]="submitting">{{ d }}</button>
      </div>
    </div>
  `,
  styles: [`
    .task-detail { display: flex; flex-direction: column; gap: 16px; max-width: 520px; }
    .header { display: flex; align-items: center; gap: 10px; }
    h2 { margin: 0; font-size: 17px; }
    .type-badge { font-size: 10px; padding: 2px 8px; border-radius: 20px; background: color-mix(in srgb, var(--accent) 16%, var(--panel)); color: var(--accent); }
    .type-badge.approval { background: color-mix(in srgb, var(--amber) 16%, var(--panel)); color: var(--amber); }
    .comment { display: flex; flex-direction: column; gap: 4px; }
    .field-label { font-size: 11px; color: var(--text-dim); }
    .actions { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
    .loading-note { font-size: 11px; color: var(--text-dim); font-style: italic; margin: -8px 0 0; }
    .instructions { font-size: 12px; color: var(--text-dim); background: var(--panel-2); border-radius: 8px; padding: 10px 12px; margin: -4px 0 0; line-height: 1.5; }
  `]
})
export class TaskDetailComponent {
  private _task!: WorkflowTask;
  @Input() set task(t: WorkflowTask) {
    this._task = t;
    this.values = {};
    this.comment = '';
    this.submitting = false;
    this.instructions = null;
    this.loadContext(t);
  }
  get task(): WorkflowTask { return this._task; }

  @Output() completed = new EventEmitter<void>();

  values: Record<string, any> = {};
  comment = '';
  submitting = false;
  loadingContext = false;
  instructions: string | null = null;

  constructor(private wf: WorkflowService) {}

  // Both FormTask and ApprovalTask forms often reference fields collected by an EARLIER step
  // in the same request (e.g. an approval form showing the employee name/amount read-only, or
  // a later form re-using a key from an earlier one). The task itself only carries its own
  // (empty, not-yet-submitted) form - so pull the running instance's already-collected data
  // and pre-fill any field whose key matches, instead of always starting blank. Also looks up
  // the node's Description (set in the designer) to show as instructions - kept out of the
  // WorkflowTask table entirely (no new column) by fetching the definition here instead.
  private loadContext(t: WorkflowTask) {
    this.loadingContext = true;
    this.wf.getInstance(t.instanceId).subscribe({
      next: instance => {
        this.loadingContext = false;
        if (t.form) {
          const prefill: Record<string, any> = {};
          for (const f of t.form.fields) {
            if (instance.data && Object.prototype.hasOwnProperty.call(instance.data, f.key)) {
              prefill[f.key] = instance.data[f.key];
            }
          }
          this.values = { ...prefill, ...this.values };
        }
        this.wf.getDefinition(instance.definitionId).subscribe({
          next: def => {
            const node = def.nodes.find(n => n.id === t.nodeId);
            this.instructions = node?.description || null;
          },
          error: () => {} // non-fatal - just no instructions banner
        });
      },
      error: () => { this.loadingContext = false; } // non-fatal - form still works blank
    });
  }

  // Green for anything that reads as a positive outcome, red for negative, neutral otherwise -
  // works for both plain Approve/Reject and arbitrary Skelta-style outcome labels.
  styleFor(decision: string): string {
    const d = decision.toLowerCase();
    if (/approve|accept|suitable|complete|success/.test(d)) return 'success';
    if (/reject|cancel|deny|fail/.test(d)) return 'danger';
    return 'primary';
  }

  complete(decision: string) {
    const missing = (this.task.form?.fields ?? [])
      .filter(f => f.required && !f.readOnly && !this.values[f.key]);
    if (missing.length > 0) {
      alert('Please fill required field(s): ' + missing.map(f => f.label).join(', '));
      return;
    }
    this.submitting = true;
    this.wf.completeTask(this.task.id, decision, this.values, this.comment).subscribe({
      next: () => { this.submitting = false; this.completed.emit(); },
      error: err => { this.submitting = false; alert('Error: ' + (err.error ?? err.message)); }
    });
  }
}
