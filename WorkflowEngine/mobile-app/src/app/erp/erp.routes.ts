import { Routes } from '@angular/router';
import { authGuard, permGuard } from '../core/auth.guard';
import { ERP_MODULES, ErpModule } from '../core/erp.models';

type Loader = () => Promise<any>;
const page: Loader = () => import('./erp-page.component').then(m => m.ErpPageComponent);
const ex = (n: string): Loader => () => import('./erp-extras.component').then((m: any) => m[n]);
const overview: Loader = () => import('./erp-overview.component').then(m => m.ErpOverviewComponent);
const setup: Loader = () => import('./erp-setup.component').then(m => m.ErpSetupComponent);

/** pages that are not the generic list page */
const SPECIAL: Record<string, Loader> = {
  'mfg/orders': () => import('./mfg-orders.component').then(m => m.MfgOrdersComponent),
  'mfg/planning': () => import('./mfg-planning.component').then(m => m.MfgPlanningComponent),
  'mfg/costing': () => import('./mfg-costing.component').then(m => m.MfgCostingComponent),
  'prj/billing': () => import('./prj-billing.component').then(m => m.PrjBillingComponent),
  'wh/stock': ex('WhStockComponent'), 'epm/variance': ex('EpmVarianceComponent'), 'bpm/monitor': ex('BpmMonitorComponent'),
  'int/keys': ex('IntKeysComponent'), 'int/docs': ex('IntDocsComponent'), 'bi/insights': ex('BiInsightsComponent'), 'bi/reports': ex('BiReportsComponent'),
};

/** One route tree per module, generated from ERP_MODULES - every page is guarded by the privileges listed there (stored in the database, per user/role). */
export const ERP_ROUTES: Routes = (Object.keys(ERP_MODULES) as ErpModule[]).map(id => {
  const def = ERP_MODULES[id];
  return {
    path: def.route.slice(1), canActivate: [authGuard, permGuard(...def.any)], data: { module: id },
    loadComponent: () => import('./erp-shell.component').then(m => m.ErpShellComponent),
    children: [
      { path: '', pathMatch: 'full', data: { module: id }, loadComponent: () => import('./erp-shell.component').then(m => m.ErpHomeComponent) },
      ...def.nav.map(n => ({
        path: n.path, canActivate: [permGuard(...n.any)], data: { module: id, page: n.path },
        loadComponent: n.path === 'overview' ? overview : n.path === 'setup' ? setup : SPECIAL[`${id}/${n.path}`] ?? page,
      })),
    ],
  };
});
