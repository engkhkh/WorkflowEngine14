import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { WorkflowService } from '../core/services/workflow.service';
import { WorkflowDefinition } from '../core/models/workflow.models';
import { TranslatePipe } from '../core/i18n/translate.pipe';

const ICONS: { match: RegExp; icon: string; tint: string }[] = [
  { match: /leave/i, icon: '🌴', tint: '#3ecb7e' },
  { match: /clearance/i, icon: '📋', tint: '#eab04a' },
  { match: /transfer/i, icon: '🔁', tint: '#6d8cf0' },
  { match: /new start|onboard/i, icon: '🎉', tint: '#f08fd0' },
];

@Component({
  selector: 'app-definitions-list',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>{{ 'workflows.title' | translate }}</h1>
          <p class="sub">{{ 'workflows.subtitle' | translate }}</p>
        </div>
        <a routerLink="/designer"><button class="primary">{{ 'workflows.newFlow' | translate }}</button></a>
      </div>

      <div class="cards">
        <div class="card" *ngFor="let d of definitions">
          <div class="card-top">
            <div class="icon-badge" [style.background]="iconFor(d.name).tint + '22'" [style.color]="iconFor(d.name).tint">
              {{ iconFor(d.name).icon }}
            </div>
            <span class="badge" [class.published]="d.isPublished">{{ (d.isPublished ? 'status.published' : 'status.draft') | translate }}</span>
          </div>
          <h3>{{ d.name }}</h3>
          <p class="desc">{{ d.description || 'No description' }}</p>
          <p class="meta">{{ d.nodes.length }} nodes · v{{ d.version }}</p>
          <div class="actions">
            <a [routerLink]="['/designer', d.id]"><button>{{ 'workflows.edit' | translate }}</button></a>
            <button class="success" [disabled]="!d.isPublished" (click)="start(d)">{{ 'workflows.start' | translate }}</button>
          </div>
        </div>

        <div class="empty" *ngIf="definitions.length === 0">
          {{ 'workflows.empty' | translate }}
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 28px 32px; max-width: 1200px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 26px; }
    h1 { font-size: 22px; margin: 0; }
    .sub { font-size: 12px; color: var(--text-dim); margin: 4px 0 0; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 16px; }
    .card {
      background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 18px; box-shadow: var(--shadow-card);
      transition: transform .15s ease, border-color .15s ease;
    }
    .card:hover { transform: translateY(-2px); border-color: var(--border); }
    .card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .icon-badge { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .card h3 { margin: 2px 0 6px; font-size: 15px; }
    .card .desc { color: var(--text-dim); font-size: 12px; min-height: 32px; line-height: 1.5; }
    .card .meta { color: var(--text-dim); font-size: 11px; margin-bottom: 14px; }
    .badge { font-size: 10px; padding: 2px 9px; border-radius: 20px; background: color-mix(in srgb, var(--amber) 16%, var(--panel)); color: var(--amber); font-weight: 600; }
    .badge.published { background: color-mix(in srgb, var(--green) 16%, var(--panel)); color: var(--green); }
    .actions { display: flex; gap: 8px; }
    .empty { color: var(--text-dim); padding: 40px; text-align: center; grid-column: 1 / -1; }
  `]
})
export class DefinitionsListComponent implements OnInit {
  definitions: WorkflowDefinition[] = [];

  constructor(private wf: WorkflowService, private router: Router) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.wf.getDefinitions().subscribe(defs => this.definitions = defs);
  }

  iconFor(name: string): { icon: string; tint: string } {
    const found = ICONS.find(i => i.match.test(name));
    return found ?? { icon: '⚡', tint: '#6d8cf0' };
  }

  start(d: WorkflowDefinition) {
    this.wf.startInstance(d.id, {}).subscribe(instance => {
      this.router.navigate(['/instances', instance.id]);
    });
  }
}
