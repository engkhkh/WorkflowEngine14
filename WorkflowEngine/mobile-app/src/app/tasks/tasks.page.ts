import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonRefresher, IonRefresherContent,
  IonModal, IonButtons, IonButton, IonIcon, IonTextarea, IonSegment, IonSegmentButton, IonFooter, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, openOutline } from 'ionicons/icons';
import { PortalApiService } from '../core/portal-api.service';
import { ErpDataService, ErpDoc } from '../core/erp-data.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { WorkflowTask } from '../core/models';
import { DynamicFormComponent } from '../shared/dynamic-form.component';
import { MoneyPipe, NumPipe } from '../shared/ui';
import { MStepperComponent } from '../shared/mobile-widgets';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [
    CommonModule, FormsModule, DynamicFormComponent, TranslatePipe, MoneyPipe, NumPipe, MStepperComponent,
    IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonRefresher, IonRefresherContent,
    IonModal, IonButtons, IonButton, IonIcon, IonTextarea, IonSegment, IonSegmentButton, IonFooter
  ],
  template: `
    <ion-header>
      <ion-toolbar><ion-title>{{ 'tasks.title' | translate }}</ion-title></ion-toolbar>
      <ion-toolbar>
        <ion-segment [value]="highOnly() ? 'high' : 'all'" (ionChange)="highOnly.set($any($event).detail.value === 'high')">
          <ion-segment-button value="all"><ion-label>{{ 'filter.all' | translate }} ({{ data.tasks().length }})</ion-label></ion-segment-button>
          <ion-segment-button value="high"><ion-label>{{ 'tasks.highOnly' | translate }}</ion-label></ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="load($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>

      <ion-list class="boxed" *ngIf="visible().length">
        <ion-item *ngFor="let t of visible()" button detail="true" (click)="open(t)" lines="full">
          <ion-label>
            <div class="top">
              <h2>{{ t.nodeName }}</h2>
              <span class="chip-prio" [class.high]="t.priority === 'High' || t.priority === 'Urgent'">{{ t.priority || 'Normal' }}</span>
            </div>
            <p><span class="mono">{{ docOf(t)?.number }}</span><span *ngIf="docOf(t)?.party"> · {{ docOf(t)?.party }}</span></p>
            <p class="amt" *ngIf="docOf(t)?.total !== null && docOf(t)?.total !== undefined">
              <strong>{{ docOf(t)!.total | money:docOf(t)!.currency }}</strong> <span class="dim">· {{ ageOf(t) }}</span>
            </p>
          </ion-label>
        </ion-item>
      </ion-list>
      <p class="empty-state" *ngIf="!visible().length">{{ 'tasks.none' | translate }}</p>
    </ion-content>

    <ion-modal [isOpen]="!!selected" (didDismiss)="selected = null">
      <ng-template>
        <ion-header>
          <ion-toolbar>
            <ion-title>{{ selected?.nodeName }}</ion-title>
            <ion-buttons slot="end"><ion-button (click)="selected = null"><ion-icon name="close-outline"></ion-icon></ion-button></ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content *ngIf="selected as t">
          <ng-container *ngIf="docOf(t) as d">
            <div class="doc-head">
              <div>
                <div class="mono num-tag">{{ d.number }}</div>
                <h3>{{ d.docType ? (('doc.' + d.docType.key) | translate) : d.title }}</h3>
                <div class="dim party">{{ d.party }}</div>
              </div>
              <div class="total" *ngIf="d.total !== null">{{ d.total | money:d.currency }}</div>
            </div>
            <div class="lines" *ngIf="d.lines.length">
              <div class="ln" *ngFor="let l of d.lines">
                <span>{{ l.item }} <small class="dim">× {{ l.qty | num:0 }}</small></span>
                <span class="num">{{ l.amount | money:d.currency }}</span>
              </div>
            </div>
            <div class="card-ish"><m-stepper [stages]="data.stagesFor(d)" [current]="d.stage" [status]="d.status" [step]="d.step"></m-stepper></div>
            <ion-button fill="clear" size="small" (click)="openDoc(d)"><ion-icon name="open-outline" slot="start"></ion-icon>{{ 'common.view' | translate }}</ion-button>
          </ng-container>

          <div class="section-title">{{ 'tasks.stepForm' | translate }}</div>
          <app-dynamic-form [form]="t.form" [values]="values"></app-dynamic-form>
          <ion-list class="boxed">
            <ion-item lines="none">
              <ion-textarea [label]="'tasks.comment' | translate" labelPlacement="stacked" [(ngModel)]="comment" [autoGrow]="true"></ion-textarea>
            </ion-item>
          </ion-list>
          <p class="err" *ngIf="error">{{ error }}</p>
        </ion-content>
        <ion-footer *ngIf="selected as t">
          <ion-toolbar>
            <div class="decisions">
              <ion-button *ngFor="let d of t.availableDecisions" [color]="colorFor(d)" [fill]="colorFor(d) === 'danger' ? 'outline' : 'solid'" (click)="complete(d)" [disabled]="busy">{{ d }}</ion-button>
            </div>
          </ion-toolbar>
        </ion-footer>
      </ng-template>
    </ion-modal>
  `,
  styles: [`
    .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    h2 { font-size: 15px !important; font-weight: 600 !important; }
    .amt { margin-top: 4px !important; color: var(--text) !important; }
    .doc-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
    .num-tag { color: var(--primary); background: var(--primary-soft); padding: 2px 7px; border-radius: 6px; display: inline-block; }
    .doc-head h3 { margin: 6px 0 2px; font-size: 17px; }
    .party { font-size: 13px; }
    .total { font-size: 18px; font-weight: 700; white-space: nowrap; }
    .lines { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); margin-bottom: 12px; }
    .ln { display: flex; justify-content: space-between; gap: 10px; padding: 9px 12px; font-size: 13px; border-bottom: 1px solid var(--border); }
    .ln:last-child { border-bottom: none; }
    .card-ish { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px 0; }
    .decisions { display: flex; gap: 8px; padding: 6px 10px; flex-wrap: wrap; }
    .decisions ion-button { flex: 1; min-width: 110px; }
    .err { color: var(--bad); font-size: 13px; }
  `]
})
export class TasksPage {
  selected: WorkflowTask | null = null;
  values: Record<string, any> = {};
  comment = '';
  error = '';
  busy = false;
  highOnly = signal(false);

  visible = computed(() => {
    const prio = (t: WorkflowTask) => ({ Low: 0, Normal: 1, High: 2, Urgent: 3 } as Record<string, number>)[t.priority ?? 'Normal'] ?? 1;
    const list = [...this.data.tasks()].sort((a, b) => prio(b) - prio(a) || +new Date(a.createdAt) - +new Date(b.createdAt));
    return this.highOnly() ? list.filter(t => prio(t) >= 2) : list;
  });

  constructor(private api: PortalApiService, public data: ErpDataService, public i18n: I18nService,
              private router: Router, private toast: ToastController) {
    addIcons({ closeOutline, openOutline });
  }

  ionViewWillEnter() { this.load(); }

  load(event?: any) { this.data.refresh().subscribe(() => event?.target?.complete()); }

  docOf(t: WorkflowTask): ErpDoc | undefined { return this.data.docById(t.instanceId); }

  ageOf(t: WorkflowTask) {
    const h = (Date.now() - +new Date(t.createdAt)) / 3_600_000;
    return h < 24 ? `${Math.max(1, Math.round(h))}h` : `${Math.round(h / 24)}d`;
  }

  open(t: WorkflowTask) {
    this.selected = t;
    this.comment = '';
    this.error = '';
    const data = this.docOf(t)?.instance.data ?? {};
    this.values = {};
    for (const f of t.form?.fields ?? []) if (data[f.key] !== undefined) this.values[f.key] = data[f.key];
  }

  openDoc(d: ErpDoc) { this.selected = null; this.router.navigate(['/documents', d.id]); }

  colorFor(decision: string): string {
    const d = decision.toLowerCase();
    if (/reject|cancel|deny|return|out of stock|write off/.test(d)) return 'danger';
    if (/approve|accept|suitable|success|paid|pay|issued|received|delivered|collected|completed/.test(d)) return 'success';
    return 'primary';
  }

  complete(decision: string) {
    const t = this.selected;
    if (!t) return;
    const negative = this.colorFor(decision) === 'danger';
    const missing = (t.form?.fields ?? []).some(f => f.required && !f.readOnly && (this.values[f.key] === undefined || this.values[f.key] === null || this.values[f.key] === ''));
    if (!negative && missing) { this.error = this.i18n.t('tasks.missing'); return; }
    const editable = new Set((t.form?.fields ?? []).filter(f => !f.readOnly).map(f => f.key));
    const payload = Object.fromEntries(Object.entries(this.values).filter(([k]) => editable.has(k)));
    this.busy = true;
    this.api.completeTask(t.id, decision, payload, this.comment).subscribe({
      next: async () => {
        this.busy = false;
        this.selected = null;
        this.load();
        (await this.toast.create({ message: `${t.nodeName}: ${decision}`, duration: 1800, color: negative ? 'danger' : 'success', position: 'top' })).present();
      },
      error: err => { this.busy = false; this.error = typeof err?.error === 'string' ? err.error : 'Error'; }
    });
  }
}
