/**
 * Manufacturing, Projects and CRM data model (mirrors backend/.../Models/Modules.cs and Controllers/ModulesController.cs).
 * Every row is an ErpRec: Module / Kind / Code / Company / Branch / Status / Ref are columns, the rest is in `data`.
 */
export type ErpModule = 'mfg' | 'prj' | 'crm' | 'proc' | 'scm' | 'wh' | 'ast' | 'pay' | 'epm' | 'bpm' | 'int' | 'bi' | 'arc' | 're' | 'gov';

export type ErpKind =
  | 'bom' | 'workcenter' | 'machine' | 'workorder' | 'inspection' | 'maintenance' | 'plan'
  | 'project' | 'task' | 'allocation' | 'timesheet' | 'cost' | 'milestone'
  | 'lead' | 'account' | 'contact' | 'opportunity' | 'activity' | 'quote' | 'campaign'
  | 'requisition' | 'rfq' | 'po' | 'contract' | 'evaluation' | 'forecast' | 'shipment' | 'carrier' | 'location' | 'pick' | 'count'
  | 'asset' | 'meter' | 'element' | 'adjustment' | 'run' | 'payslip' | 'line' | 'process' | 'apikey' | 'webhook' | 'connector' | 'log' | 'report'
  | 'category' | 'incoming' | 'outgoing' | 'document' | 'appointment' | 'visitor' | 'todo'
  | 'property' | 'unit' | 'owner' | 'tenant' | 'lease' | 'installment' | 'sale' | 'request'
  | 'audit' | 'rule' | 'approval' | 'delegation' | 'customfield' | 'lot' | 'trackrule'
  | 'setting';

export interface ErpRec<D = Record<string, any>> {
  id: string; module: ErpModule; kind: ErpKind; code?: string | null; company?: string | null; branch?: string | null;
  status?: string | null; ref?: string | null; parent?: string | null; data: D;
  createdBy?: string | null; createdAt?: string; updatedAt?: string | null;
}
export interface ErpItem { sku: string; name: string; cost: number; price: number; stocked: boolean; }
export interface ErpQuery { company?: string | null; branch?: string | null; status?: string; ref?: string; take?: number; }

export interface ErpNavItem { path: string; label: string; icon: string; any: string[]; }
export interface ErpModuleDef { id: ErpModule; route: string; icon: string; color: string; titleKey: string; subKey: string; nav: ErpNavItem[]; any: string[]; }

const n = (path: string, icon: string, any: string[], mod: string): ErpNavItem => ({ path, label: `${mod}.nav.${path}`, icon, any });

/** Every page with the privileges that open it. The Admin module (stored in the database) hands these out per user / role. */
export const ERP_MODULES: Record<ErpModule, ErpModuleDef> = {
  proc: {
    id: 'proc', route: '/procurement', icon: 'cart', color: '#14b8a6', titleKey: 'module.proc', subKey: 'proc.sub',
    nav: [
      n('overview', 'bar-chart', ['proc.reports.view'], 'proc'), n('requisitions', 'clipboard', ['proc.view'], 'proc'), n('orders', 'file', ['proc.view'], 'proc'),
      n('rfq', 'send', ['proc.view'], 'proc'), n('contracts', 'book', ['proc.view'], 'proc'), n('evaluations', 'check-square', ['proc.view'], 'proc'), n('setup', 'settings', ['proc.setup'], 'proc'),
    ],
    any: ['proc.view', 'proc.req.manage', 'proc.po.manage', 'proc.receive', 'proc.reports.view', 'proc.setup'],
  },
  scm: {
    id: 'scm', route: '/supply-chain', icon: 'globe', color: '#0891b2', titleKey: 'module.scm', subKey: 'scm.sub',
    nav: [
      n('overview', 'bar-chart', ['scm.reports.view'], 'scm'), n('forecast', 'trending-up', ['scm.view'], 'scm'), n('shipments', 'send', ['scm.view'], 'scm'), n('carriers', 'building', ['scm.view'], 'scm'),
    ],
    any: ['scm.view', 'scm.planning', 'scm.shipments.manage', 'scm.reports.view', 'scm.setup'],
  },
  wh: {
    id: 'wh', route: '/warehouse', icon: 'layers', color: '#84cc16', titleKey: 'module.wh', subKey: 'wh.sub',
    nav: [
      n('overview', 'bar-chart', ['wh.reports.view'], 'wh'), n('stock', 'box', ['wh.view'], 'wh'), n('picks', 'clipboard', ['wh.view'], 'wh'), n('counts', 'check-square', ['wh.view'], 'wh'),
      n('lots', 'layers', ['wh.view'], 'wh'), n('tracking', 'shield', ['wh.setup'], 'wh'),
      n('locations', 'store', ['wh.view'], 'wh'), n('setup', 'settings', ['wh.setup'], 'wh'),
    ],
    any: ['wh.view', 'wh.pick.manage', 'wh.count.manage', 'wh.reports.view', 'wh.setup'],
  },
  ast: {
    id: 'ast', route: '/assets', icon: 'wrench', color: '#a16207', titleKey: 'module.ast', subKey: 'ast.sub',
    nav: [
      n('overview', 'bar-chart', ['ast.reports.view'], 'ast'), n('assets', 'building', ['ast.view'], 'ast'), n('plans', 'clock', ['ast.view'], 'ast'), n('orders', 'wrench', ['ast.view'], 'ast'),
      n('meters', 'trending-up', ['ast.view'], 'ast'), n('setup', 'settings', ['ast.setup'], 'ast'),
    ],
    any: ['ast.view', 'ast.assets.manage', 'ast.plans.manage', 'ast.orders.manage', 'ast.reports.view', 'ast.setup'],
  },
  pay: {
    id: 'pay', route: '/payroll', icon: 'wallet', color: '#16a34a', titleKey: 'module.pay', subKey: 'pay.sub',
    nav: [
      n('overview', 'bar-chart', ['pay.reports.view'], 'pay'), n('runs', 'refresh', ['pay.view'], 'pay'), n('payslips', 'file', ['pay.self', 'pay.payslips.view', 'pay.run.manage'], 'pay'),
      n('elements', 'layers', ['pay.view'], 'pay'), n('adjustments', 'edit', ['pay.run.manage'], 'pay'), n('setup', 'settings', ['pay.setup'], 'pay'),
    ],
    any: ['pay.self', 'pay.view', 'pay.payslips.view', 'pay.run.manage', 'pay.run.approve', 'pay.post', 'pay.reports.view', 'pay.setup'],
  },
  epm: {
    id: 'epm', route: '/planning', icon: 'trending-up', color: '#e11d48', titleKey: 'module.epm', subKey: 'epm.sub',
    nav: [
      n('overview', 'bar-chart', ['epm.reports.view'], 'epm'), n('plans', 'book', ['epm.view'], 'epm'), n('forecast', 'trending-up', ['epm.view'], 'epm'), n('variance', 'target', ['epm.reports.view', 'epm.view'], 'epm'), n('setup', 'settings', ['epm.setup'], 'epm'),
    ],
    any: ['epm.view', 'epm.plans.manage', 'epm.forecast.manage', 'epm.reports.view', 'epm.setup'],
  },
  bpm: {
    id: 'bpm', route: '/bpm', icon: 'git-branch', color: '#7c3aed', titleKey: 'module.bpm', subKey: 'bpm.sub',
    nav: [ n('overview', 'bar-chart', ['bpm.view'], 'bpm'), n('processes', 'git-branch', ['bpm.view'], 'bpm'), n('monitor', 'clock', ['bpm.monitor', 'bpm.view'], 'bpm') ],
    any: ['bpm.view', 'bpm.manage', 'bpm.monitor'],
  },
  int: {
    id: 'int', route: '/integration', icon: 'key', color: '#475569', titleKey: 'module.int', subKey: 'int.sub',
    nav: [ n('overview', 'bar-chart', ['int.view'], 'int'), n('keys', 'key', ['int.view'], 'int'), n('webhooks', 'send', ['int.view'], 'int'), n('logs', 'file', ['int.view'], 'int'), n('docs', 'book', ['int.view'], 'int') ],
    any: ['int.view', 'int.keys.manage', 'int.hooks.manage'],
  },
  bi: {
    id: 'bi', route: '/analytics', icon: 'sparkles', color: '#db2777', titleKey: 'module.bi', subKey: 'bi.sub',
    nav: [ n('overview', 'bar-chart', ['bi.view'], 'bi'), n('insights', 'sparkles', ['bi.ai.use', 'bi.view'], 'bi'), n('reports', 'file', ['bi.view'], 'bi') ],
    any: ['bi.view', 'bi.reports.manage', 'bi.ai.use'],
  },
  arc: {
    id: 'arc', route: '/archive', icon: 'mail', color: '#0f766e', titleKey: 'module.arc', subKey: 'arc.sub',
    nav: [
      n('overview', 'bar-chart', ['arc.reports.view'], 'arc'), n('incoming', 'download', ['arc.view'], 'arc'), n('outgoing', 'upload', ['arc.view'], 'arc'),
      n('documents', 'book', ['arc.view'], 'arc'), n('appointments', 'calendar', ['arc.view'], 'arc'), n('visitors', 'users', ['arc.view'], 'arc'),
      n('todos', 'check-square', ['arc.view'], 'arc'), n('categories', 'layers', ['arc.view'], 'arc'),
    ],
    any: ['arc.view', 'arc.incoming.manage', 'arc.outgoing.manage', 'arc.docs.manage', 'arc.secretary.manage', 'arc.reports.view', 'arc.setup'],
  },
  re: {
    id: 're', route: '/realestate', icon: 'building', color: '#b45309', titleKey: 'module.re', subKey: 're.sub',
    nav: [
      n('overview', 'bar-chart', ['re.reports.view'], 're'), n('properties', 'building', ['re.view'], 're'), n('units', 'grid', ['re.view'], 're'),
      n('owners', 'users', ['re.view'], 're'), n('tenants', 'users', ['re.view'], 're'), n('leases', 'file', ['re.view'], 're'),
      n('installments', 'wallet', ['re.view'], 're'), n('sales', 'trending-up', ['re.view'], 're'), n('requests', 'wrench', ['re.view'], 're'),
    ],
    any: ['re.view', 're.properties.manage', 're.units.manage', 're.leases.manage', 're.collect', 're.sales.manage', 're.maintenance.manage', 're.reports.view', 're.setup'],
  },
  gov: {
    id: 'gov', route: '/governance', icon: 'shield', color: '#475569', titleKey: 'module.gov', subKey: 'gov.sub',
    nav: [
      n('overview', 'bar-chart', ['gov.view'], 'gov'), n('approvals', 'check-square', ['gov.view'], 'gov'), n('rules', 'settings', ['gov.view'], 'gov'),
      n('delegation', 'users', ['gov.delegate'], 'gov'), n('audit', 'clipboard', ['gov.audit.view'], 'gov'), n('fields', 'layers', ['gov.fields.manage'], 'gov'),
      n('lock', 'clock', ['gov.lock.manage'], 'gov'), n('tax', 'file', ['gov.vat.view', 'gov.zatca.manage'], 'gov'),
    ],
    any: ['gov.view', 'gov.audit.view', 'gov.rules.manage', 'gov.approvals.admin', 'gov.delegate', 'gov.fields.manage', 'gov.lock.manage', 'gov.zatca.manage', 'gov.vat.view'],
  },
  mfg: {
    id: 'mfg', route: '/mfg', icon: 'factory', color: '#f97316', titleKey: 'module.mfg', subKey: 'mfg.sub',
    nav: [
      n('overview', 'bar-chart', ['mfg.reports.view'], 'mfg'),
      n('orders', 'clipboard', ['mfg.view'], 'mfg'),
      n('bom', 'layers', ['mfg.view', 'mfg.bom.manage'], 'mfg'),
      n('planning', 'trending-up', ['mfg.planning'], 'mfg'),
      n('workcenters', 'building', ['mfg.view', 'mfg.bom.manage'], 'mfg'),
      n('quality', 'shield', ['mfg.view', 'mfg.quality.manage'], 'mfg'),
      n('maintenance', 'wrench', ['mfg.view', 'mfg.maintenance.manage'], 'mfg'),
      n('costing', 'wallet', ['mfg.costing.view'], 'mfg'),
      n('setup', 'settings', ['mfg.setup'], 'mfg'),
    ],
    any: ['mfg.view', 'mfg.bom.manage', 'mfg.orders.manage', 'mfg.orders.execute', 'mfg.planning', 'mfg.quality.manage', 'mfg.maintenance.manage', 'mfg.costing.view', 'mfg.reports.view', 'mfg.setup'],
  },
  prj: {
    id: 'prj', route: '/projects', icon: 'briefcase', color: '#0ea5e9', titleKey: 'module.prj', subKey: 'prj.sub',
    nav: [
      n('overview', 'bar-chart', ['prj.reports.view'], 'prj'),
      n('projects', 'briefcase', ['prj.view', 'prj.manage'], 'prj'),
      n('tasks', 'check-square', ['prj.view', 'prj.tasks.manage'], 'prj'),
      n('resources', 'users', ['prj.view', 'prj.resources.manage'], 'prj'),
      n('timesheets', 'clock', ['prj.time.log', 'prj.time.approve', 'prj.view'], 'prj'),
      n('costs', 'wallet', ['prj.view', 'prj.costs.manage'], 'prj'),
      n('milestones', 'target', ['prj.view', 'prj.manage'], 'prj'),
      n('billing', 'file', ['prj.billing'], 'prj'),
    ],
    any: ['prj.view', 'prj.manage', 'prj.tasks.manage', 'prj.resources.manage', 'prj.time.log', 'prj.time.approve', 'prj.costs.manage', 'prj.billing', 'prj.reports.view'],
  },
  crm: {
    id: 'crm', route: '/crm', icon: 'target', color: '#8b5cf6', titleKey: 'module.crm', subKey: 'crm.sub',
    nav: [
      n('overview', 'bar-chart', ['crm.reports.view'], 'crm'),
      n('leads', 'trending-up', ['crm.view', 'crm.leads.manage'], 'crm'),
      n('opportunities', 'target', ['crm.view', 'crm.opps.manage'], 'crm'),
      n('accounts', 'building', ['crm.view', 'crm.accounts.manage'], 'crm'),
      n('contacts', 'users', ['crm.view', 'crm.accounts.manage'], 'crm'),
      n('activities', 'phone', ['crm.view', 'crm.activities.manage'], 'crm'),
      n('quotes', 'file', ['crm.view', 'crm.quotes.manage'], 'crm'),
      n('campaigns', 'send', ['crm.view', 'crm.campaigns.manage'], 'crm'),
      n('setup', 'settings', ['crm.setup'], 'crm'),
    ],
    any: ['crm.view', 'crm.leads.manage', 'crm.accounts.manage', 'crm.opps.manage', 'crm.activities.manage', 'crm.quotes.manage', 'crm.campaigns.manage', 'crm.reports.view', 'crm.setup'],
  },
};

export const CRM_STAGES_DEFAULT = ['Qualified', 'Proposal', 'Negotiation'];
export const CRM_SOURCES_DEFAULT = ['Web', 'Referral', 'Event', 'Cold call', 'Partner', 'Campaign'];

export interface ErpLookup { code: string; name: string; extra?: string | null; }
export interface WhStockRow { sku: string; name: string; branch: string; qty: number; cost: number; value: number; reorder: number; }
export interface ErpKpi { k: string; v: number; t: 'n' | 'm' | 'p'; }
export interface ErpSeries { k: string; rows: { name: string; value: number }[]; }
export interface ErpSummary { module: ErpModule; kpis: ErpKpi[]; lists: ErpSeries[]; }
export interface ErpInsight { code: string; module: ErpModule; level: 'info' | 'warn' | 'bad'; n: number; ref?: string | null; }
