import { Component } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { TranslatePipe } from '../core/translate.pipe';
import { AdminRolesComponent } from './admin-roles.component';

/** Roles & privileges editor (stored in the database) - same component as the portal, inside an Ionic page. */
@Component({
  selector: 'app-admin-roles-page',
  standalone: true,
  imports: [AdminRolesComponent, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton],
  template: `
    <ion-header><ion-toolbar><ion-buttons slot="start"><ion-back-button defaultHref="/admin" [text]="''"></ion-back-button></ion-buttons><ion-title>{{ 'admin.rolesTab' | translate }}</ion-title></ion-toolbar></ion-header>
    <ion-content><div class="erp-root"><app-admin-roles /></div></ion-content>
  `
})
export class AdminRolesPage {}
