import { Routes } from '@angular/router';
import { authGuard, permGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tasks' },
  { path: 'login', loadComponent: () => import('./login/login.component').then(m => m.LoginComponent) },
  {
    path: 'definitions', canActivate: [authGuard],
    loadComponent: () => import('./definitions/definitions-list.component').then(m => m.DefinitionsListComponent)
  },
  {
    path: 'designer/:id', canActivate: [authGuard],
    loadComponent: () => import('./designer/designer.component').then(m => m.DesignerComponent)
  },
  {
    path: 'designer', canActivate: [authGuard],
    loadComponent: () => import('./designer/designer.component').then(m => m.DesignerComponent)
  },
  {
    path: 'tasks', canActivate: [authGuard],
    loadComponent: () => import('./tasks/task-inbox.component').then(m => m.TaskInboxComponent)
  },
  {
    path: 'instances', canActivate: [authGuard],
    loadComponent: () => import('./instances/instances-list.component').then(m => m.InstancesListComponent)
  },
  {
    path: 'instances/:id', canActivate: [authGuard],
    loadComponent: () => import('./instances/instance-detail.component').then(m => m.InstanceDetailComponent)
  },
  {
    path: 'admin', canActivate: [permGuard('admin.users', 'org.manage')],
    loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent)
  },
  {
    path: 'origins', canActivate: [authGuard],
    loadComponent: () => import('./about/origins.component').then(m => m.OriginsComponent)
  },
];
