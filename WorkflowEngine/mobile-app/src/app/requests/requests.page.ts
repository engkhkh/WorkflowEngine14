import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonSegment, IonSegmentButton,
  IonRefresher, IonRefresherContent, IonSearchbar, IonButtons, IonButton
} from '@ionic/angular/standalone';
import { ErpDataService, ErpDoc, DocStatus } from '../core/erp-data.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { MDocRowComponent } from '../shared/mobile-widgets';

type Filter = 'all' | DocStatus;

@Component({
  selector: 'app-requests',
  standalone: true,
  imports: [
    CommonModule, TranslatePipe, MDocRowComponent,
    IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonSegment, IonSegmentButton,
    IonRefresher, IonRefresherContent, IonSearchbar, IonButtons, IonButton
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'docs.title' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="scope.set(scope() === 'mine' ? 'all' : 'mine')">{{ (scope() === 'mine' ? 'docs.mine' : 'docs.everyone') | translate }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar [value]="q()" (ionInput)="q.set($any($event).detail.value ?? '')" [placeholder]="'top.search' | translate" [debounce]="150"></ion-searchbar>
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment [value]="filter()" (ionChange)="filter.set($any($event).detail.value)" [scrollable]="true">
          <ion-segment-button *ngFor="let f of filters" [value]="f"><ion-label>{{ ('filter.' + f) | translate }}</ion-label></ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="load($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <ion-list class="boxed" *ngIf="shown().length">
        <ion-item *ngFor="let d of shown()" button detail="false" (click)="openDoc(d)" lines="full"><m-doc-row [doc]="d" style="width:100%"></m-doc-row></ion-item>
      </ion-list>
      <p class="empty-state" *ngIf="!shown().length">{{ 'docs.none' | translate }}</p>
    </ion-content>
  `,
  styles: [`ion-item { --padding-start: 0; --inner-padding-end: 0; }`]
})
export class RequestsPage {
  filters: Filter[] = ['all', 'pending', 'approved', 'rejected', 'canceled'];
  filter = signal<Filter>('all');
  scope = signal<'mine' | 'all'>('mine');
  q = signal('');

  shown = computed(() => {
    let list = this.scope() === 'mine' ? this.data.myDocs() : this.data.docs();
    if (this.filter() !== 'all') list = list.filter(d => d.status === this.filter());
    const q = this.q().trim().toLowerCase();
    if (q) list = list.filter(d => [d.number, d.party, d.title, d.step].some(x => x.toLowerCase().includes(q)));
    return list;
  });

  constructor(public data: ErpDataService, public i18n: I18nService, private router: Router) {}

  ionViewWillEnter() { this.load(); }
  load(event?: any) { this.data.refresh().subscribe(() => event?.target?.complete()); }
  openDoc(d: ErpDoc) { this.router.navigate(['/documents', d.id]); }
}
