import { Routes } from '@angular/router';
import { authGuard, permGuard } from './core/auth.guard';
import { HR_ANY } from './core/hr.models';
import { FIN_ANY } from './core/fin.models';
import { POS_ANY } from './core/pos.models';
import { HOS_ANY } from './hospital/hospital.service';
import { ERP_ROUTES } from './erp/erp.routes';

/**
 * Workspaces of the portal (HR, Finance, Point of sale and the ERP modules) run on the phone with the SAME screens, privileges and API.
 * Every workspace is wrapped by WorkspaceHostPage (Ionic header + scrollable content) so it opens like any other mobile screen.
 */
const hrRoute: any = {
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
  };
const posRoute: any = {
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
  };
const finRoute: any = {
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
  };

const hospitalRoute: any = {
    // Hospital: every page is guarded by its own hos.* privilege (set per user in Admin > Users)
    path: 'hospital', canActivate: [authGuard, permGuard(...HOS_ANY)],
    loadComponent: () => import('./hospital/hospital-shell.component').then(m => m.HospitalShellComponent),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./hospital/hospital-shell.component').then(m => m.HospitalHomeComponent) },
      { path: 'overview', canActivate: [permGuard('hos.view', 'hos.reports.view')], loadComponent: () => import('./hospital/hos-dashboard.component').then(m => m.HosDashboardComponent) },
      { path: 'patients', canActivate: [permGuard('hos.patients.view')], loadComponent: () => import('./hospital/hos-patients.component').then(m => m.HosPatientsComponent) },
      { path: 'patients/:code', canActivate: [permGuard('hos.patients.view')], loadComponent: () => import('./hospital/hos-patient-file.component').then(m => m.HosPatientFileComponent) },
      { path: 'appointments', canActivate: [permGuard('hos.appointments.view')], loadComponent: () => import('./hospital/hos-appointments.component').then(m => m.HosAppointmentsComponent) },
      { path: 'visits', canActivate: [permGuard('hos.clinical.view')], loadComponent: () => import('./hospital/hos-visits.component').then(m => m.HosVisitsComponent) },
      { path: 'visits/:id', canActivate: [permGuard('hos.clinical.view')], loadComponent: () => import('./hospital/hos-visit.component').then(m => m.HosVisitComponent) },
      { path: 'lab', canActivate: [permGuard('hos.lab.view')], loadComponent: () => import('./hospital/hos-lab.component').then(m => m.HosLabComponent) },
      { path: 'pharmacy', canActivate: [permGuard('hos.pharmacy.view')], loadComponent: () => import('./hospital/hos-pharmacy.component').then(m => m.HosPharmacyComponent) },
      { path: 'wards', canActivate: [permGuard('hos.wards.view')], loadComponent: () => import('./hospital/hos-wards.component').then(m => m.HosWardsComponent) },
      { path: 'billing', canActivate: [permGuard('hos.billing.view')], loadComponent: () => import('./hospital/hos-billing.component').then(m => m.HosBillingComponent) },
      { path: 'setup', canActivate: [permGuard('hos.setup')], loadComponent: () => import('./hospital/hos-setup.component').then(m => m.HosSetupComponent) },
    ]
  };

const muslimRoute: any = {
    // Muslim: prayer times (reminders, Qibla) and the Holy Quran as Mushaf pages
    path: 'muslim', canActivate: [authGuard, permGuard('mus.view')],
    loadComponent: () => import('./muslim/muslim-shell.component').then(m => m.MuslimShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'times' },
      { path: 'times', loadComponent: () => import('./muslim/muslim-times.component').then(m => m.MuslimTimesComponent) },
      { path: 'quran', loadComponent: () => import('./muslim/muslim-quran.component').then(m => m.MuslimQuranComponent) },
      { path: 'quran/:n', loadComponent: () => import('./muslim/muslim-quran.component').then(m => m.MuslimQuranComponent) },
    ]
  };

const wrap = (r: any) => ({
  path: r.path, canActivate: r.canActivate,
  loadComponent: () => import('./shared/workspace-host.page').then(m => m.WorkspaceHostPage),
  children: [{ path: '', data: r.data, loadComponent: r.loadComponent, children: r.children }]
});

export const WORKSPACE_ROUTES: Routes = [hrRoute, posRoute, finRoute, hospitalRoute, muslimRoute, ...ERP_ROUTES].map(wrap);
