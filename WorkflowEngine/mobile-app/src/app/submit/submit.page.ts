import { Component, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonIcon, IonRefresher, IonRefresherContent
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle, peopleOutline, settingsOutline, cartOutline, trendingUpOutline, cubeOutline, walletOutline } from 'ionicons/icons';
import { PortalApiService } from '../core/portal-api.service';
import { ErpDataService } from '../core/erp-data.service';
import { ErpContextService } from '../core/erp-context.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { WorkflowDefinitionSummary, WorkflowTask } from '../core/models';
import { DOC_TYPES, MODULES, ModuleKey, moduleForWorkflowName } from '../core/erp.config';
import { DynamicFormComponent } from '../shared/dynamic-form.component';
import { ION_ICON } from '../shared/mobile-widgets';

/** Generic workflow catalog (HR + any non-ERP flows) - the original "Submit a Request" screen. */
@Component({
  selector: 'app-submit',
  standalone: true,
  imports: [CommonModule, DynamicFormComponent, TranslatePipe,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonIcon, IonRefresher, IonRefresherContent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/new"></ion-back-button></ion-buttons>
        <ion-title>{{ 'submit.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="load($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>

      <ng-container *ngIf="!startedTask && !justSubmitted">
        <p class="dim sub">{{ 'submit.sub' | translate }}</p>
        <ng-container *ngFor="let g of groups()">
          <div class="section-title">{{ ('module.' + g.module) | translate }}</div>
          <div class="svc" *ngFor="let d of g.defs">
            <span class="ic" [style.color]="color(g.module)" [style.background]="color(g.module) + '1f'"><ion-icon [name]="icon(g.module)"></ion-icon></span>
            <div class="txt"><strong>{{ d.name }}</strong><small>{{ d.description }}</small></div>
            <ion-button size="small" (click)="start(d)" [disabled]="starting">{{ 'submit.start' | translate }}</ion-button>
          </div>
        </ng-container>
        <p class="empty-state" *ngIf="!groups().length">{{ 'submit.noWorkflows' | translate }}</p>
      </ng-container>

      <ng-container *ngIf="startedTask">
        <div class="section-title">{{ 'submit.yourTurn' | translate }} {{ startedTask.nodeName }}</div>
        <app-dynamic-form [form]="startedTask.form" [values]="values"></app-dynamic-form>
        <ion-button *ngFor="let d of startedTask.availableDecisions" expand="block" (click)="complete(d)">{{ d }}</ion-button>
      </ng-container>

      <div class="done" *ngIf="justSubmitted">
        <ion-icon name="checkmark-circle" color="success"></ion-icon>
        <p>{{ 'submit.submitted' | translate }}</p>
        <ion-button expand="block" *ngIf="lastInstanceId" (click)="router.navigate(['/documents', lastInstanceId])">{{ 'common.view' | translate }}</ion-button>
        <ion-button expand="block" fill="clear" (click)="justSubmitted = false">{{ 'submit.title' | translate }}</ion-button>
      </div>
    </ion-content>
  `,
  styles: [`
    .sub { font-size: 13px; margin: 4px 2px; }
    .svc { display: flex; gap: 12px; align-items: center; padding: 12px; margin-bottom: 10px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); }
    .ic { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-size: 19px; flex-shrink: 0; }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .txt strong { font-size: 14px; }
    .txt small { font-size: 12px; color: var(--text-dim); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .done { text-align: center; padding-top: 40px; }
    .done ion-icon { font-size: 56px; }
  `]
})
export class SubmitPage implements OnInit {
  starting = false;
  startedTask: WorkflowTask | null = null;
  values: Record<string, any> = {};
  justSubmitted = false;
  lastInstanceId = '';

  groups = computed(() => {
    const erp = new Set(DOC_TYPES.map(d => d.workflowName));
    const defs = this.data.definitions().filter(d => d.isPublished && !erp.has(d.name));
    return MODULES.map(m => ({ module: m.key, defs: defs.filter(d => moduleForWorkflowName(d.name) === m.key) })).filter(g => g.defs.length);
  });

  constructor(private api: PortalApiService, public data: ErpDataService, private ctx: ErpContextService,
              public i18n: I18nService, public router: Router) {
    addIcons({ checkmarkCircle, peopleOutline, settingsOutline, cartOutline, trendingUpOutline, cubeOutline, walletOutline });
  }

  ngOnInit() { this.load(); }
  load(event?: any) { this.data.refresh().subscribe(() => event?.target?.complete()); }

  color(m: ModuleKey) { return MODULES.find(x => x.key === m)?.color ?? '#4338ca'; }
  icon(m: ModuleKey) { return ION_ICON[m]; }

  start(d: WorkflowDefinitionSummary) {
    this.starting = true;
    this.api.startInstance(d.id, { company: this.ctx.company(), branch: this.ctx.defaultBranch().code }).subscribe({
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
