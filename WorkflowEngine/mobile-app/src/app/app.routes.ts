import { Routes } from '@angular/router';
import { authGuard, createGuard, permGuard } from './core/auth.guard';
import { WORKSPACE_ROUTES } from './workspaces.routes';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tabs/home' },
  { path: 'login', loadComponent: () => import('./login/login.page').then(m => m.LoginPage) },
  {
    path: 'tabs',
    canActivate: [authGuard],
    loadComponent: () => import('./tabs/tabs.page').then(m => m.TabsPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./home/home.page').then(m => m.HomePage) },
      { path: 'approvals', loadComponent: () => import('./tasks/tasks.page').then(m => m.TasksPage) },
      { path: 'new', loadComponent: () => import('./new/new.page').then(m => m.NewPage) },
      { path: 'documents', loadComponent: () => import('./requests/requests.page').then(m => m.RequestsPage) },
      { path: 'more', loadComponent: () => import('./more/more.page').then(m => m.MorePage) },
      // old tab URLs
      { path: 'submit', redirectTo: 'new' },
      { path: 'tasks', redirectTo: 'approvals' },
      { path: 'requests', redirectTo: 'documents' },
    ]
  },
  { path: 'documents/:id', canActivate: [authGuard], loadComponent: () => import('./requests/request-detail.page').then(m => m.RequestDetailPage) },
  { path: 'requests/:id', redirectTo: 'documents/:id' },
  { path: 'new/:docType', canActivate: [authGuard, createGuard], loadComponent: () => import('./new/doc-form.page').then(m => m.DocFormPage) },
  { path: 'services', canActivate: [authGuard], loadComponent: () => import('./submit/submit.page').then(m => m.SubmitPage) },
  { path: 'assistant', canActivate: [authGuard, permGuard('assistant.use')], loadComponent: () => import('./assistant/assistant.page').then(m => m.AssistantPage) },
  { path: 'reports', canActivate: [authGuard, permGuard('reports.view')], loadComponent: () => import('./reports/reports.page').then(m => m.ReportsPage) },
  { path: 'appearance', canActivate: [authGuard], loadComponent: () => import('./appearance/appearance.page').then(m => m.AppearancePage) },
  ...WORKSPACE_ROUTES,
  { path: 'admin/roles', canActivate: [authGuard, permGuard('admin.users')], loadComponent: () => import('./erp/admin-roles.page').then(m => m.AdminRolesPage) },
  { path: 'admin', canActivate: [authGuard, permGuard('admin.users', 'org.manage')], loadComponent: () => import('./admin/admin.page').then(m => m.AdminPage) },
  { path: 'admin/user/:id', canActivate: [authGuard, permGuard('admin.users')], loadComponent: () => import('./admin/user-edit.page').then(m => m.UserEditPage) },
  { path: '**', redirectTo: 'tabs/home' },
];
