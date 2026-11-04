import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSegment, IonSegmentButton, IonLabel, IonList, IonItem, IonBadge,
  IonButton, IonIcon, IonFab, IonFabButton, IonRefresher, IonRefresherContent, AlertController, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, playOutline, trashOutline } from 'ionicons/icons';
import { WorkflowService } from './workflow.service';
import { AuthService } from '../core/auth.service';
import { WorkflowDefinition, WorkflowInstance } from './workflow.models';

/** Workflow hub: flows (designer entry) + running / completed / canceled instances. */
@Component({
  selector: 'app-workflows',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSegment, IonSegmentButton,
    IonLabel, IonList, IonItem, IonBadge, IonButton, IonIcon, IonFab, IonFabButton, IonRefresher, IonRefresherContent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more"></ion-back-button></ion-buttons>
      <ion-title>Workflows</ion-title>
    </ion-toolbar>
    <ion-toolbar>
      <ion-segment [(ngModel)]="tab">
        <ion-segment-button value="flows" *ngIf="auth.can('wf.view')"><ion-label>Flows</ion-label></ion-segment-button>
        <ion-segment-button value="Running" *ngIf="auth.can('wf.instances.view')"><ion-label>Running ({{ count('Running') }})</ion-label></ion-segment-button>
        <ion-segment-button value="Completed" *ngIf="auth.can('wf.instances.view')"><ion-label>Done ({{ count('Completed') }})</ion-label></ion-segment-button>
        <ion-segment-button value="Terminated" *ngIf="auth.can('wf.instances.view')"><ion-label>Canceled ({{ count('Terminated') }})</ion-label></ion-segment-button>
      </ion-segment>
    </ion-toolbar></ion-header>
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="load($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>

      <ion-list *ngIf="tab === 'flows'">
        <ion-item *ngFor="let d of defs" button detail (click)="open(d)">
          <ion-label>
            <h2>{{ d.name }}</h2>
            <p>v{{ d.version }} · {{ d.nodes.length }} steps · {{ d.description || 'no description' }}</p>
          </ion-label>
          <ion-badge slot="end" [color]="d.isPublished ? 'success' : 'medium'">{{ d.isPublished ? 'Published' : 'Draft' }}</ion-badge>
          <ion-button slot="end" fill="clear" *ngIf="d.isPublished && auth.can('wf.instances.view')" (click)="start(d); $event.stopPropagation()"><ion-icon name="play-outline" slot="icon-only"></ion-icon></ion-button>
          <ion-button slot="end" fill="clear" color="danger" *ngIf="auth.can('wf.design')" (click)="remove(d); $event.stopPropagation()"><ion-icon name="trash-outline" slot="icon-only"></ion-icon></ion-button>
        </ion-item>
        <ion-item *ngIf="!defs.length" lines="none"><ion-label color="medium">No workflows yet — tap + to design one.</ion-label></ion-item>
      </ion-list>

      <ion-list *ngIf="tab !== 'flows'">
        <ion-item *ngFor="let i of shown()" button detail (click)="router.navigate(['/workflow/instances', i.id])">
          <ion-label><h2>{{ i.definitionName }}</h2><p>{{ i.startedBy }} · {{ i.startedAt | date:'short' }}</p></ion-label>
          <ion-badge slot="end" [color]="i.status === 'Running' ? 'primary' : i.status === 'Completed' ? 'success' : 'danger'">{{ i.status }}</ion-badge>
        </ion-item>
        <ion-item *ngIf="!shown().length" lines="none"><ion-label color="medium">Nothing here.</ion-label></ion-item>
      </ion-list>

      <ion-fab slot="fixed" vertical="bottom" horizontal="end" *ngIf="tab === 'flows' && auth.can('wf.design')">
        <ion-fab-button (click)="router.navigate(['/workflow/designer'])"><ion-icon name="add-outline"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `
})
export class WorkflowsPage implements OnInit {
  wf = inject(WorkflowService); auth = inject(AuthService); router = inject(Router);
  private alerts = inject(AlertController); private toast = inject(ToastController);
  tab = 'flows'; defs: WorkflowDefinition[] = []; insts: WorkflowInstance[] = [];
  constructor() { addIcons({ addOutline, playOutline, trashOutline }); }
  ngOnInit() { if (!this.auth.can('wf.view')) this.tab = 'Running'; }
  ionViewWillEnter() { this.load(); }
  load(ev?: any) {
    if (this.auth.can('wf.view')) this.wf.getDefinitions().subscribe(d => this.defs = d);
    if (this.auth.can('wf.instances.view')) this.wf.getInstances().subscribe(i => { this.insts = i; ev?.target?.complete(); }, () => ev?.target?.complete());
    else ev?.target?.complete();
  }
  count(s: string) { return this.insts.filter(i => i.status === s).length; }
  shown() { return this.insts.filter(i => i.status === this.tab); }
  open(d: WorkflowDefinition) { this.router.navigate(['/workflow/designer', d.id]); }
  async start(d: WorkflowDefinition) {
    this.wf.startInstance(d.id).subscribe({
      next: async i => { (await this.toast.create({ message: `Started “${d.name}”`, duration: 1800 })).present(); this.router.navigate(['/workflow/instances', i.id]); },
      error: async e => (await this.toast.create({ message: 'Cannot start: ' + (e.error?.message ?? e.error ?? e.message), duration: 3500, color: 'danger' })).present()
    });
  }
  async remove(d: WorkflowDefinition) {
    const a = await this.alerts.create({ header: 'Delete workflow?', message: d.name, buttons: [{ text: 'Cancel', role: 'cancel' },
      { text: 'Delete', role: 'destructive', handler: () => this.wf.deleteDefinition(d.id).subscribe(() => this.load()) }] });
    a.present();
  }
}
