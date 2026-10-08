import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WorkflowService } from '../core/services/workflow.service';
import { AuthService } from '../core/services/auth.service';
import { WorkflowTask, WorkflowInstance } from '../core/models/workflow.models';
import { TaskDetailComponent } from './task-detail.component';
import { TranslatePipe } from '../core/i18n/translate.pipe';

type MainTab = 'assigned' | 'requests';

@Component({
  selector: 'app-task-inbox',
  standalone: true,
  imports: [CommonModule, RouterLink, TaskDetailComponent, TranslatePipe],
  template: `
    <div class="page">
      <div class="page-header">
        <h1>{{ 'tasks.title' | translate }}</h1>
        <p class="sub">{{ 'tasks.signedInAs' | translate }} <b>{{ auth.currentUser()?.displayName }}</b> ({{ auth.currentUser()?.role }})</p>
      </div>

      <div class="tabs">
        <button class="tab" [class.active]="mainTab === 'assigned'" (click)="mainTab = 'assigned'">
          {{ 'tasks.assignedToMe' | translate }} <span class="count">{{ tasks.length }}</span>
        </button>
        <button class="tab" [class.active]="mainTab === 'requests'" (click)="mainTab = 'requests'">
          {{ 'tasks.myRequests' | translate }} <span class="count">{{ myRequests.length }}</span>
        </button>
      </div>

      <!-- Assigned to Me -->
      <div class="layout" *ngIf="mainTab === 'assigned'">
        <div class="list">
          <div class="task-row" *ngFor="let t of tasks" [class.selected]="t.id === selectedTask?.id" (click)="select(t)">
            <span class="type-dot" [class.approval]="t.nodeType === 'ApprovalTask'"></span>
            <div class="row-main">
              <div class="row-title">
                {{ t.nodeName }}
                <span class="escalated-badge" *ngIf="t.isEscalated">{{ 'tasks.escalated' | translate }}</span>
              </div>
              <div class="row-sub">
                {{ t.nodeType }} · {{ t.createdAt | date:'short' }}
                <span class="priority" [class]="(t.priority || 'normal').toLowerCase()" *ngIf="t.priority">{{ t.priority }}</span>
              </div>
            </div>
          </div>
          <div class="empty" *ngIf="tasks.length === 0">{{ 'tasks.noneAssigned' | translate }}</div>
        </div>

        <div class="detail">
          <app-task-detail *ngIf="selectedTask as t" [task]="t" (completed)="onCompleted()"></app-task-detail>
          <div class="empty" *ngIf="!selectedTask">{{ 'tasks.selectOne' | translate }}</div>
        </div>
      </div>

      <!-- My Requests -->
      <div class="table-card" *ngIf="mainTab === 'requests'">
        <table>
          <thead>
            <tr><th>{{ 'instances.workflow' | translate }}</th><th>{{ 'instances.status' | translate }}</th><th>{{ 'instances.started' | translate }}</th><th></th></tr>
          </thead>
          <tbody>
            <tr *ngFor="let r of myRequests" [routerLink]="['/instances', r.id]" class="row">
              <td class="name">{{ r.definitionName }}</td>
              <td><span class="outcome" [class]="outcomeClassOf(r)">{{ outcomeKeyOf(r) | translate }}</span></td>
              <td class="dim">{{ r.startedAt | date:'short' }}</td>
              <td class="arrow">→</td>
            </tr>
            <tr *ngIf="myRequests.length === 0"><td colspan="4" class="empty">{{ 'tasks.noRequests' | translate }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 24px 28px; height: calc(100vh / var(--ui-zoom, 1)); box-sizing: border-box; display: flex; flex-direction: column; }
    .page-header { margin-bottom: 16px; }
    h1 { font-size: 22px; margin: 0; }
    .sub { font-size: 12px; color: var(--text-dim); margin: 4px 0 0; }
    .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 10px 16px; font-size: 13px; color: var(--text-dim); border-radius: 0; }
    .tab:hover { background: var(--panel-2); color: var(--text); }
    .tab.active { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
    .count { font-size: 10px; background: var(--panel-2); border-radius: 10px; padding: 1px 6px; margin-left: 4px; }
    .layout { display: flex; gap: 16px; flex: 1; min-height: 0; }
    .list { width: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); flex-shrink: 0; }
    .task-row { display: flex; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border); cursor: pointer; }
    .task-row:hover { background: var(--panel-2); }
    .task-row.selected { background: var(--panel-2); border-left: 3px solid var(--accent); }
    .type-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 6px; flex-shrink: 0; }
    .type-dot.approval { background: var(--amber); }
    .row-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
    .row-sub { font-size: 11px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
    .escalated-badge { font-size: 9px; padding: 1px 6px; border-radius: 10px; background: color-mix(in srgb, var(--red) 16%, var(--panel)); color: var(--red); }
    .priority { font-size: 9px; padding: 1px 6px; border-radius: 10px; background: var(--panel-2); border: 1px solid var(--border); }
    .priority.high, .priority.urgent { color: var(--amber); border-color: var(--amber); }
    .detail { flex: 1; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); padding: 20px; }
    .empty { padding: 30px; color: var(--text-dim); text-align: center; }
    .table-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-card); }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .4px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid var(--border-soft); }
    .row { cursor: pointer; }
    .row:hover { background: var(--panel-2); }
    .name { font-weight: 600; }
    .dim { color: var(--text-dim); }
    .arrow { color: var(--text-dim); }
    .outcome { font-size: 10px; padding: 3px 10px; border-radius: 20px; background: color-mix(in srgb, var(--accent) 16%, var(--panel)); color: var(--accent); font-weight: 600; }
    .outcome.approved { background: color-mix(in srgb, var(--green) 16%, var(--panel)); color: var(--green); }
    .outcome.rejected { background: color-mix(in srgb, var(--red) 16%, var(--panel)); color: var(--red); }
    .outcome.canceled { background: color-mix(in srgb, var(--red) 16%, var(--panel)); color: var(--red); }
    .outcome.pending { background: color-mix(in srgb, var(--accent) 16%, var(--panel)); color: var(--accent); }
  `]
})
export class TaskInboxComponent implements OnInit {
  tasks: WorkflowTask[] = [];
  selectedTask: WorkflowTask | null = null;
  mainTab: MainTab = 'assigned';
  allInstances: WorkflowInstance[] = [];

  constructor(private wf: WorkflowService, public auth: AuthService) {}

  ngOnInit() {
    this.load();
    this.wf.getInstances().subscribe(list => this.allInstances = list);
  }

  load() {
    this.wf.getTasks().subscribe(tasks => this.tasks = tasks);
  }

  get myRequests(): WorkflowInstance[] {
    const me = this.auth.currentUser()?.username;
    return this.allInstances
      .filter(i => i.startedBy === me)
      .sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
  }

  // Approved/Rejected are derived (the engine only tracks Running/Completed/Terminated) -
  // a Completed instance whose history contains a "Rejected" action anywhere is labeled
  // Rejected, otherwise Approved; Terminated is always Canceled; Running is always Pending.
  private outcomeOf(i: WorkflowInstance): 'pending' | 'canceled' | 'rejected' | 'approved' {
    if (i.status === 'Running') return 'pending';
    if (i.status === 'Terminated') return 'canceled';
    return i.history.some(h => h.action === 'Rejected') ? 'rejected' : 'approved';
  }

  outcomeClassOf(i: WorkflowInstance): string {
    return this.outcomeOf(i);
  }

  outcomeKeyOf(i: WorkflowInstance): string {
    return 'status.' + this.outcomeOf(i);
  }

  select(t: WorkflowTask) {
    this.selectedTask = t;
  }

  onCompleted() {
    this.selectedTask = null;
    this.load();
  }
}
