import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WorkflowService } from '../core/services/workflow.service';
import { WorkflowInstance } from '../core/models/workflow.models';
import { TranslatePipe } from '../core/i18n/translate.pipe';

type Tab = 'pending' | 'completed' | 'canceled';

@Component({
  selector: 'app-instances-list',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  template: `
    <div class="page">
      <div class="page-header">
        <h1>{{ 'instances.title' | translate }}</h1>
        <p class="sub">{{ 'instances.subtitle' | translate }}</p>
      </div>

      <div class="tabs">
        <button class="tab" [class.active]="tab === 'pending'" (click)="tab = 'pending'">
          {{ 'status.pending' | translate }} <span class="count">{{ pending.length }}</span>
        </button>
        <button class="tab" [class.active]="tab === 'completed'" (click)="tab = 'completed'">
          {{ 'status.completed' | translate }} <span class="count">{{ completed.length }}</span>
        </button>
        <button class="tab" [class.active]="tab === 'canceled'" (click)="tab = 'canceled'">
          {{ 'status.canceledFailed' | translate }} <span class="count">{{ canceled.length }}</span>
        </button>
      </div>

      <div class="table-card">
        <table>
          <thead>
            <tr><th>{{ 'instances.workflow' | translate }}</th><th>{{ 'instances.status' | translate }}</th><th>{{ 'instances.startedBy' | translate }}</th><th>{{ 'instances.started' | translate }}</th><th></th></tr>
          </thead>
          <tbody>
            <tr *ngFor="let i of shown" [routerLink]="['/instances', i.id]" class="row">
              <td class="name">{{ i.definitionName }}</td>
              <td>
                <span class="status" [class]="i.status.toLowerCase()">
                  <i class="live-dot" *ngIf="i.status === 'Running'"></i>{{ i.status }}
                </span>
              </td>
              <td>{{ i.startedBy }}</td>
              <td class="dim">{{ i.startedAt | date:'short' }}</td>
              <td class="arrow">→</td>
            </tr>
            <tr *ngIf="shown.length === 0"><td colspan="5" class="empty">{{ 'instances.empty' | translate }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 28px 32px; max-width: 1100px; }
    .page-header { margin-bottom: 20px; }
    h1 { font-size: 22px; margin: 0; }
    .sub { font-size: 12px; color: var(--text-dim); margin: 4px 0 0; }
    .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
    .tab {
      background: none; border: none; border-bottom: 2px solid transparent;
      padding: 10px 16px; font-size: 13px; color: var(--text-dim); border-radius: 0;
    }
    .tab:hover { background: var(--panel-2); color: var(--text); }
    .tab.active { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
    .count { font-size: 10px; background: var(--panel-2); border-radius: 10px; padding: 1px 6px; margin-left: 4px; }
    .table-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-card); }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .4px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid var(--border-soft); }
    .row { cursor: pointer; transition: background .12s ease; }
    .row:hover { background: var(--panel-2); }
    .row:hover .arrow { opacity: 1; transform: translateX(2px); }
    .name { font-weight: 600; }
    .dim { color: var(--text-dim); }
    .arrow { color: var(--text-dim); opacity: 0; transition: opacity .12s ease, transform .12s ease; }
    .status { font-size: 10px; padding: 3px 10px; border-radius: 20px; background: color-mix(in srgb, var(--accent) 16%, var(--panel)); color: var(--accent); display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
    .status.completed { background: color-mix(in srgb, var(--green) 16%, var(--panel)); color: var(--green); }
    .status.terminated { background: color-mix(in srgb, var(--red) 16%, var(--panel)); color: var(--red); }
    .live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: blink 1.2s ease-in-out infinite; }
    @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
    .empty { text-align: center; color: var(--text-dim); padding: 30px; }
  `]
})
export class InstancesListComponent implements OnInit {
  instances: WorkflowInstance[] = [];
  tab: Tab = 'pending';

  constructor(private wf: WorkflowService) {}

  ngOnInit() { this.wf.getInstances().subscribe(i => this.instances = i); }

  get pending() { return this.instances.filter(i => i.status === 'Running'); }
  get completed() { return this.instances.filter(i => i.status === 'Completed'); }
  get canceled() { return this.instances.filter(i => i.status === 'Terminated'); }

  get shown() {
    return this.tab === 'pending' ? this.pending : this.tab === 'completed' ? this.completed : this.canceled;
  }
}
