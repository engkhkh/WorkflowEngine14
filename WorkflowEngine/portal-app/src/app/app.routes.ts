import { Routes } from '@angular/router';
import { authGuard, createGuard, moduleGuard, permGuard } from './core/auth.guard';
import { HR_ANY } from './core/hr.models';
import { FIN_ANY } from './core/fin.models';
import { ERP_ROUTES } from './erp/erp.routes';
import { POS_ANY } from './core/pos.models';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'login', loadComponent: () => import('./login/login.component').then(m => m.LoginComponent) },
  { path: 'dashboard', canActivate: [authGuard, permGuard('dashboard.view')], loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'm/:module', canActivate: [authGuard, moduleGuard], loadComponent: () => import('./modules/module.component').then(m => m.ModuleComponent) },
  { path: 'new/:docType', canActivate: [authGuard, createGuard], loadComponent: () => import('./documents/doc-form.component').then(m => m.DocFormComponent) },
  { path: 'approvals', canActivate: [authGuard, permGuard('tasks.act')], loadComponent: () => import('./tasks/tasks.component').then(m => m.TasksComponent) },
  { path: 'documents', canActivate: [authGuard], loadComponent: () => import('./requests/requests.component').then(m => m.RequestsComponent) },
  { path: 'documents/:id', canActivate: [authGuard], loadComponent: () => import('./requests/request-detail.component').then(m => m.RequestDetailComponent) },
  { path: 'services', canActivate: [authGuard], loadComponent: () => import('./submit/submit.component').then(m => m.SubmitComponent) },
  { path: 'reports', canActivate: [authGuard, permGuard('reports.view')], loadComponent: () => import('./reports/reports.component').then(m => m.ReportsComponent) },
  { path: 'assistant', canActivate: [authGuard, permGuard('assistant.use')], loadComponent: () => import('./assistant/assistant-page.component').then(m => m.AssistantPageComponent) },

  {
    // HR workspace: every page below is guarded by its own privilege (set per user in Admin > Users)
    path: 'hr', canActivate: [authGuard, permGuard(...HR_ANY)],
    loadComponent: () => import('./hr/hr-shell.component').then(m => m.HrShellComponent),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./hr/hr-shell.component').then(m => m.HrHomeComponent) },
      { path: 'overview', canActivate: [permGuard('hr.reports.view')], loadComponent: () => import('./hr/hr-overview.component').then(m => m.HrOverviewComponent) },
      { path: 'employees', canActivate: [permGuard('hr.employees.view')], loadComponent: () => import('./hr/hr-employees.component').then(m => m.HrEmployeesComponent) },
      { path: 'employees/:id', canActivate: [permGuard('hr.employees.view')], loadComponent: () => import('./hr/hr-profile.component').then(m => m.HrProfileComponent) },
      { path: 'org', canActivate: [permGuard('hr.org.view')], loadComponent: () => import('./hr/hr-org.component').then(m => m.HrOrgComponent) },
      { path: 'leave', canActivate: [permGuard('hr.leave.view', 'hr.self')], loadComponent: () => import('./hr/hr-leave.component').then(m => m.HrLeaveComponent) },
      { path: 'performance', canActivate: [permGuard('hr.performance.view', 'hr.self')], loadComponent: () => import('./hr/hr-performance.component').then(m => m.HrPerformanceComponent) },
      { path: 'recruitment', canActivate: [permGuard('hr.recruitment.view')], loadComponent: () => import('./hr/hr-recruitment.component').then(m => m.HrRecruitmentComponent) },
      { path: 'me', canActivate: [permGuard('hr.self')], loadComponent: () => import('./hr/hr-self.component').then(m => m.HrSelfComponent) },
    ]
  },

  {
    // Point of sale: every page is guarded by its own pos.* privilege (set per user in Admin > Users)
    path: 'pos', canActivate: [authGuard, permGuard(...POS_ANY)],
    loadComponent: () => import('./pos/pos-shell.component').then(m => m.PosShellComponent),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./pos/pos-shell.component').then(m => m.PosHomeComponent) },
      { path: 'terminal', canActivate: [permGuard('pos.sell')], loadComponent: () => import('./pos/pos-terminal.component').then(m => m.PosTerminalComponent) },
      { path: 'shifts', canActivate: [permGuard('pos.sell', 'pos.shifts.manage')], loadComponent: () => import('./pos/pos-shifts.component').then(m => m.PosShiftsComponent) },
      { path: 'sales', canActivate: [permGuard('pos.view')], loadComponent: () => import('./pos/pos-sales.component').then(m => m.PosSalesComponent) },
      { path: 'products', canActivate: [permGuard('pos.products.manage', 'pos.view')], loadComponent: () => import('./pos/pos-catalog.component').then(m => m.PosProductsComponent) },
      { path: 'customers', canActivate: [permGuard('pos.customers.manage', 'pos.view')], loadComponent: () => import('./pos/pos-catalog.component').then(m => m.PosCustomersComponent) },
      { path: 'promotions', canActivate: [permGuard('pos.promotions.manage', 'pos.view')], loadComponent: () => import('./pos/pos-catalog.component').then(m => m.PosPromotionsComponent) },
      { path: 'stock', canActivate: [permGuard('pos.stock.view')], loadComponent: () => import('./pos/pos-stock.component').then(m => m.PosStockComponent) },
      { path: 'overview', canActivate: [permGuard('pos.reports.view')], loadComponent: () => import('./pos/pos-overview.component').then(m => m.PosOverviewComponent) },
      { path: 'setup', canActivate: [permGuard('pos.setup')], loadComponent: () => import('./pos/pos-setup.component').then(m => m.PosSetupComponent) },
    ]
  },

  ...ERP_ROUTES,

  {
    // Finance workspace: every page is guarded by its own finance.* privilege (set per user in Admin > Users)
    path: 'finance', canActivate: [authGuard, permGuard(...FIN_ANY)],
    loadComponent: () => import('./finance/fin-shell.component').then(m => m.FinShellComponent),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./finance/fin-shell.component').then(m => m.FinHomeComponent) },
      { path: 'overview', canActivate: [permGuard('finance.reports.view')], loadComponent: () => import('./finance/fin-overview.component').then(m => m.FinOverviewComponent) },
      { path: 'gl', canActivate: [permGuard('finance.gl.view')], loadComponent: () => import('./finance/fin-gl.component').then(m => m.FinGlComponent) },
      { path: 'payables', canActivate: [permGuard('finance.ap.view')], loadComponent: () => import('./finance/fin-ap-ar.component').then(m => m.FinPayablesComponent) },
      { path: 'receivables', canActivate: [permGuard('finance.ar.view')], loadComponent: () => import('./finance/fin-ap-ar.component').then(m => m.FinReceivablesComponent) },
      { path: 'bank', canActivate: [permGuard('finance.bank.view')], loadComponent: () => import('./finance/fin-bank.component').then(m => m.FinBankComponent) },
      { path: 'budgets', canActivate: [permGuard('finance.budget.view')], loadComponent: () => import('./finance/fin-budgets.component').then(m => m.FinBudgetsComponent) },
      { path: 'assets', canActivate: [permGuard('finance.assets.view')], loadComponent: () => import('./finance/fin-assets.component').then(m => m.FinAssetsComponent) },
      { path: 'projects', canActivate: [permGuard('finance.projects.view')], loadComponent: () => import('./finance/fin-projects.component').then(m => m.FinProjectsComponent) },
      { path: 'setup', canActivate: [permGuard('finance.setup')], loadComponent: () => import('./finance/fin-setup.component').then(m => m.FinSetupComponent) },
      { path: 'audit', canActivate: [permGuard('finance.audit.view')], loadComponent: () => import('./finance/fin-audit.component').then(m => m.FinAuditComponent) },
    ]
  },

  { path: 'admin', canActivate: [authGuard, permGuard('admin.users', 'org.manage')], loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent) },

  // old portal URLs keep working
  { path: 'submit', redirectTo: 'services' },
  { path: 'tasks', redirectTo: 'approvals' },
  { path: 'requests', redirectTo: 'documents' },
  { path: 'requests/:id', redirectTo: 'documents/:id' },
  { path: '**', redirectTo: 'dashboard' },
];
