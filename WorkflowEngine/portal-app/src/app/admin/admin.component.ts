import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../core/auth.service';
import { TranslatePipe } from '../core/translate.pipe';
import { AdminUsersComponent } from './admin-users.component';
import { AdminRolesComponent } from './admin-roles.component';
import { AdminOrgComponent } from './admin-org.component';
import { AdminWorkspaceComponent } from './admin-workspace.component';

type Tab = 'users' | 'roles' | 'org' | 'ws';

/** Administration: users & privileges, role presets, companies & branches, workspace (SaaS plan/usage). */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, TranslatePipe, AdminUsersComponent, AdminRolesComponent, AdminOrgComponent, AdminWorkspaceComponent],
  template: `
    <div class="page-head"><div class="titles"><h1>{{ 'nav.administration' | translate }}</h1><p>{{ 'admin.sub' | translate }}</p></div></div>
    <div class="tabs">
      <button *ngIf="auth.can('admin.users')" [class.on]="tab() === 'users'" (click)="tab.set('users')">{{ 'admin.usersTab' | translate }}</button>
      <button *ngIf="auth.can('admin.users')" [class.on]="tab() === 'roles'" (click)="tab.set('roles')">{{ 'admin.rolesTab' | translate }}</button>
      <button *ngIf="auth.can('org.manage')" [class.on]="tab() === 'org'" (click)="tab.set('org')">{{ 'admin.orgTab' | translate }}</button>
      <button [class.on]="tab() === 'ws'" (click)="tab.set('ws')">{{ 'admin.wsTab' | translate }}</button>
    </div>
    <app-admin-users *ngIf="tab() === 'users'"></app-admin-users>
    <app-admin-roles *ngIf="tab() === 'roles'"></app-admin-roles>
    <app-admin-org *ngIf="tab() === 'org'"></app-admin-org>
    <app-admin-workspace *ngIf="tab() === 'ws'"></app-admin-workspace>
  `
})
export class AdminComponent {
  tab = signal<Tab>('users');
  constructor(public auth: AuthService) {
    if (!auth.can('admin.users')) this.tab.set(auth.can('org.manage') ? 'org' : 'ws');
  }
}
