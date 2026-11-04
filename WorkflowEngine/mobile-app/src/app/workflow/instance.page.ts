import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe, KeyValuePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription, interval, startWith, switchMap } from 'rxjs';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonList, IonItem, IonLabel, IonListHeader, IonBadge, AlertController } from '@ionic/angular/standalone';
import { WorkflowService } from './workflow.service';
import { AuthService } from '../core/auth.service';
import { ActivityLogEntry, WorkflowDefinition, WorkflowInstance } from './workflow.models';
import { InstanceDiagramComponent } from './instance-diagram.component';

/** One run: live process map (polls while running), timeline, collected data, persisted activity log, cancel. */
@Component({
  selector: 'app-wf-instance',
  standalone: true,
  imports: [CommonModule, DatePipe, KeyValuePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonList, IonItem, IonLabel, IonListHeader, IonBadge, InstanceDiagramComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/workflow"></ion-back-button></ion-buttons>
      <ion-title>{{ instance?.definitionName || 'Instance' }}</ion-title>
      <ion-buttons slot="end"><ion-button color="danger" *ngIf="canCancel()" (click)="cancel()">Cancel</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content *ngIf="instance as i">
      <div class="pad"><ion-badge [color]="i.status === 'Running' ? 'primary' : i.status === 'Completed' ? 'success' : 'danger'">{{ i.status }}</ion-badge>
        <small> started by {{ i.startedBy }} · {{ i.startedAt | date:'medium' }}</small></div>
      <div class="map"><app-instance-diagram [definition]="definition" [instance]="i"></app-instance-diagram></div>
      <ion-list>
        <ion-list-header>Timeline</ion-list-header>
        <ion-item *ngFor="let h of i.history"><ion-label>
          <h3>{{ h.nodeName }} — {{ h.action }}</h3>
          <p>{{ h.timestamp | date:'short' }}<span *ngIf="h.actor"> · {{ h.actor }}</span></p>
          <p *ngIf="h.comment"><i>“{{ h.comment }}”</i></p></ion-label></ion-item>
        <ion-list-header>Collected data</ion-list-header>
        <ion-item *ngFor="let kv of i.data | keyvalue"><ion-label><p>{{ kv.key }}</p><h3>{{ kv.value }}</h3></ion-label></ion-item>
        <ion-item *ngIf="!(i.data | keyvalue).length" lines="none"><ion-label color="medium">No data collected yet.</ion-label></ion-item>
        <ion-list-header>Activity log</ion-list-header>
        <ion-item *ngFor="let l of log"><ion-label><h3>{{ l.nodeName }} — {{ l.action }}</h3><p>{{ l.timestamp | date:'short' }} · {{ l.actor || 'system' }} {{ l.comment }}</p></ion-label></ion-item>
      </ion-list>
    </ion-content>
  `,
  styles: [`.pad { padding: 10px 14px; } .map { margin: 0 10px 8px; overflow: auto; border-radius: 12px; }`]
})
export class WfInstancePage implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute); private wf = inject(WorkflowService); auth = inject(AuthService); private alerts = inject(AlertController);
  instance: WorkflowInstance | null = null; definition: WorkflowDefinition | null = null; log: ActivityLogEntry[] = [];
  private sub?: Subscription;
  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.sub = interval(3000).pipe(startWith(0), switchMap(() => this.wf.getInstance(id))).subscribe(i => {
      this.instance = i;
      if (!this.definition) this.wf.getDefinition(i.definitionId).subscribe(d => this.definition = d);
      this.wf.getActivityLog(id).subscribe(l => this.log = l, () => {});
      if (i.status !== 'Running') this.sub?.unsubscribe();
    });
  }
  ngOnDestroy() { this.sub?.unsubscribe(); }
  canCancel() { const u = this.auth.currentUser(); return !!u && this.instance?.status === 'Running' && (u.username === this.instance.startedBy || u.role === 'admin'); }
  async cancel() {
    const a = await this.alerts.create({ header: 'Cancel this request?', buttons: [{ text: 'No', role: 'cancel' },
      { text: 'Yes, cancel', role: 'destructive', handler: () => this.wf.cancelInstance(this.instance!.id).subscribe(i => this.instance = i) }] });
    a.present();
  }
}
