import { Component, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PortalApiService } from '../core/portal-api.service';
import { ErpDataService } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { WorkflowDefinitionSummary, WorkflowTask } from '../core/models';
import { DynamicFormComponent } from '../shared/dynamic-form.component';
import { TranslatePipe } from '../core/translate.pipe';
import { DOC_TYPES, MODULES, ModuleKey, moduleForWorkflowName } from '../core/erp.config';
import { IconComponent } from '../shared/ui';

@Component({
  selector: 'app-submit',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DynamicFormComponent, TranslatePipe, IconComponent],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>{{ 'submit.title' | translate }}</h1>
        <p>{{ 'submit.sub' | translate }}</p>
      </div>
    </div>

    <ng-container *ngIf="!startedTask && !justSubmitted">
      <h2 class="sec">{{ 'submit.erpDocs' | translate }}</h2>
      <div class="cards">
        <a class="svc" *ngFor="let dt of docTypes" [routerLink]="['/new', dt.key]">
          <span class="ic" [style.color]="color(dt.module)" [style.background]="color(dt.module) + '1a'"><app-icon [name]="icon(dt.module)"></app-icon></span>
          <strong>{{ ('doc.' + dt.key) | translate }}</strong>
          <small>{{ ('doc.' + dt.key + '.desc') | translate }}</small>
          <span class="mod">{{ ('module.' + dt.module) | translate }}</span>
        </a>
      </div>

      <ng-container *ngFor="let g of groups()">
        <h2 class="sec">{{ ('module.' + g.module) | translate }} · {{ 'submit.workflows' | translate }}</h2>
        <div class="cards">
          <div class="svc" *ngFor="let d of g.defs">
            <span class="ic" [style.color]="color(g.module)" [style.background]="color(g.module) + '1a'"><app-icon [name]="icon(g.module)"></app-icon></span>
            <strong>{{ d.name }}</strong>
            <small>{{ d.description }}</small>
            <button class="primary sm start" (click)="start(d)" [disabled]="starting"><app-icon name="send" [size]="14"></app-icon>{{ 'submit.start' | translate }}</button>
          </div>
        </div>
      </ng-container>
      <div class="empty" *ngIf="!groups().length && data.loadedOnce()">{{ 'submit.noWorkflows' | translate }}</div>
    </ng-container>

    <section class="card" *ngIf="startedTask">
      <div class="card-head"><h3>{{ 'submit.yourTurn' | translate }} {{ startedTask.nodeName }}</h3></div>
      <div class="card-body">
        <app-dynamic-form [form]="startedTask.form" [values]="values"></app-dynamic-form>
        <div class="actions">
          <button *ngFor="let d of startedTask.availableDecisions" class="primary" (click)="complete(d)">{{ d }}</button>
        </div>
      </div>
    </section>

    <div class="card done" *ngIf="justSubmitted">
      <app-icon name="check" [size]="28" [stroke]="2.4"></app-icon>
      <p>{{ 'submit.submitted' | translate }}</p>
      <div class="actions">
        <a class="btn primary" [routerLink]="['/documents', lastInstanceId]" *ngIf="lastInstanceId">{{ 'common.view' | translate }}</a>
        <button (click)="justSubmitted = false">{{ 'submit.title' | translate }}</button>
      </div>
    </div>
  `,
  styles: [`
    .sec { font-size: 14px; font-weight: 650; color: var(--text-2); margin: 6px 0 12px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; margin-bottom: 26px; }
    .svc { display: flex; flex-direction: column; gap: 6px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); color: var(--text); position: relative; }
    a.svc:hover { border-color: var(--primary); transform: translateY(-1px); }
    .ic { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; margin-bottom: 4px; }
    .svc strong { font-size: 14px; }
    .svc small { font-size: 12.5px; color: var(--text-dim); line-height: 1.45; flex: 1; }
    .mod { position: absolute; top: 14px; inset-inline-end: 14px; font-size: 11px; color: var(--text-dim); }
    .start { align-self: flex-start; margin-top: 6px; }
    .actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
    .done { padding: 36px; text-align: center; display: flex; flex-direction: column; align-items: center; color: var(--ok); }
    .done p { color: var(--text); font-size: 14px; }
  `]
})
export class SubmitComponent implements OnInit {
  docTypes = DOC_TYPES;
  starting = false;
  startedTask: WorkflowTask | null = null;
  values: Record<string, any> = {};
  justSubmitted = false;
  lastInstanceId = '';

  groups = computed(() => {
    const erpNames = new Set(DOC_TYPES.map(d => d.workflowName));
    const defs = this.data.definitions().filter(d => d.isPublished && !erpNames.has(d.name));
    return MODULES.map(m => ({ module: m.key, defs: defs.filter(d => moduleForWorkflowName(d.name) === m.key) })).filter(g => g.defs.length);
  });

  constructor(private api: PortalApiService, public data: ErpDataService, private ctx: ErpContextService,
              private route: ActivatedRoute, private router: Router) {}

  ngOnInit() {
    this.data.refresh().subscribe(() => {
      const startId = this.route.snapshot.queryParamMap.get('start');
      const def = startId ? this.data.definitions().find(d => d.id === startId) : undefined;
      if (def) { this.router.navigate([], { queryParams: {} }); this.start(def); }
    });
  }

  color(m: ModuleKey) { return MODULES.find(x => x.key === m)?.color ?? '#4338ca'; }
  icon(m: ModuleKey) { return MODULES.find(x => x.key === m)?.icon ?? 'grid'; }

  start(d: WorkflowDefinitionSummary) {
    this.starting = true;
    // stamp company/branch so even generic workflows show up in the right branch view
    const b = this.ctx.defaultBranch();
    this.api.startInstance(d.id, { company: this.ctx.company(), branch: b.code }).subscribe({
      next: instance => {
        this.lastInstanceId = instance.id;
        this.api.getTasks().subscribe(tasks => {
          this.starting = false;
          this.startedTask = tasks.find(t => t.instanceId === instance.id) ?? null;
          if (!this.startedTask) this.justSubmitted = true;
        });
      },
      error: () => { this.starting = false; }
    });
  }

  complete(decision: string) {
    if (!this.startedTask) return;
    this.api.completeTask(this.startedTask.id, decision, this.values, '').subscribe(() => {
      this.startedTask = null;
      this.values = {};
      this.justSubmitted = true;
      this.data.refresh().subscribe();
    });
  }
}
