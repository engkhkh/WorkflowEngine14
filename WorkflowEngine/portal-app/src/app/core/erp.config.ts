/**
 * ERP configuration: modules, document types and how each document type's workflow nodes map
 * onto the end-to-end business stages
 *
 *   Request -> Approval -> Purchase -> Inventory -> Accounting -> Reporting
 *
 * The workflow templates themselves live in backend/.../Services/ErpSeedData.cs - the
 * `workflowName` and node names below must match that file. Everything here is plain data,
 * so adding a new ERP document type = one seed template + one entry in DOC_TYPES.
 *
 * (This file is intentionally duplicated in mobile-app/src/app/core/erp.config.ts - the
 * portal and mobile app share no code with each other by design. Keep both in sync.)
 */

export type ModuleKey = 'sales' | 'purchasing' | 'inventory' | 'finance' | 'hr' | 'operations';
export type StageKey = 'request' | 'approval' | 'purchase' | 'inventory' | 'accounting' | 'reporting';
export type DocTypeKey = 'PR' | 'SO' | 'EXP' | 'TRF' | 'PV';

export interface ErpModule {
  key: ModuleKey;
  icon: string;
  color: string;
}

export const MODULES: ErpModule[] = [
  { key: 'sales', icon: 'trending-up', color: '#0ea5e9' },
  { key: 'purchasing', icon: 'cart', color: '#8b5cf6' },
  { key: 'inventory', icon: 'box', color: '#f59e0b' },
  { key: 'finance', icon: 'wallet', color: '#10b981' },
  { key: 'hr', icon: 'users', color: '#ec4899' },
  { key: 'operations', icon: 'settings', color: '#64748b' },
];

export const STAGES: StageKey[] = ['request', 'approval', 'purchase', 'inventory', 'accounting', 'reporting'];

export interface DocTypeConfig {
  key: DocTypeKey;
  module: ModuleKey;
  workflowName: string;
  prefix: string;
  partyKind: 'vendor' | 'customer' | 'employee' | 'payee' | 'warehouse';
  hasDiscount?: boolean;
  hasVat?: boolean;
  needsToWarehouse?: boolean;
  stages: StageKey[];
}

export const DOC_TYPES: DocTypeConfig[] = [
  {
    key: 'PR', module: 'purchasing', prefix: 'PR', partyKind: 'vendor', hasVat: true,
    workflowName: 'ERP · Purchase Requisition (Procure-to-Pay)',
    stages: ['request', 'approval', 'purchase', 'inventory', 'accounting', 'reporting'],
  },
  {
    key: 'SO', module: 'sales', prefix: 'SO', partyKind: 'customer', hasVat: true, hasDiscount: true,
    workflowName: 'ERP · Sales Order (Order-to-Cash)',
    stages: ['request', 'approval', 'inventory', 'accounting', 'reporting'],
  },
  {
    key: 'TRF', module: 'inventory', prefix: 'TRF', partyKind: 'warehouse', needsToWarehouse: true,
    workflowName: 'ERP · Stock Transfer',
    stages: ['request', 'approval', 'inventory', 'reporting'],
  },
  {
    key: 'PV', module: 'finance', prefix: 'PV', partyKind: 'payee',
    workflowName: 'ERP · Payment Voucher',
    stages: ['request', 'approval', 'accounting', 'reporting'],
  },
  {
    key: 'EXP', module: 'finance', prefix: 'EXP', partyKind: 'employee', hasVat: true,
    workflowName: 'ERP · Expense Claim',
    stages: ['request', 'approval', 'accounting', 'reporting'],
  },
];

/** Workflow node name -> ERP stage. Anything not listed falls back by keyword (see stageForNode). */
const NODE_STAGE: Record<string, StageKey> = {
  'Manager Approval': 'approval',
  'Senior Manager Approval': 'approval',
  'Sales Manager Approval': 'approval',
  'Warehouse Approval': 'approval',
  'Finance Approval': 'approval',
  'Credit Check': 'approval',
  'Issue Purchase Order': 'purchase',
  'Goods Receipt': 'inventory',
  'Deliver Goods': 'inventory',
  'Dispatch & Receive': 'inventory',
  'Vendor Invoice & Payment': 'accounting',
  'Invoice & Collect Payment': 'accounting',
  'Finance Review & Payment': 'accounting',
  'Finance Payment': 'accounting',
  'Post to General Ledger': 'accounting',
};

export function stageForNode(nodeName: string | undefined): StageKey {
  if (!nodeName) return 'request';
  const direct = NODE_STAGE[nodeName];
  if (direct) return direct;
  const n = nodeName.toLowerCase();
  if (/approv|review|check|sign/.test(n)) return 'approval';
  if (/purchase order|\bpo\b|procure/.test(n)) return 'purchase';
  if (/receipt|deliver|dispatch|stock|stores|warehouse/.test(n)) return 'inventory';
  if (/invoice|payment|pay|ledger|finance/.test(n)) return 'accounting';
  return 'request';
}

/** Non-ERP workflows (the HR/Skelta templates etc.) are still placed in a module by name. */
export function moduleForWorkflowName(name: string): ModuleKey {
  const dt = DOC_TYPES.find(d => d.workflowName === name);
  if (dt) return dt.module;
  const n = name.toLowerCase();
  if (/leave|clearance|transfer|start work|candidate|employee|hire|ambitious|hr/.test(n)) return 'hr';
  if (/purchase|procure|vendor|supplier/.test(n)) return 'purchasing';
  if (/sales|customer|quotation|order/.test(n)) return 'sales';
  if (/stock|inventory|warehouse/.test(n)) return 'inventory';
  if (/expense|payment|invoice|budget|finance/.test(n)) return 'finance';
  return 'operations';
}

// ---------- master data ----------
// COMPANIES / BRANCHES are only the DEFAULTS shown before a workspace has its own - the live lists come from
// OrgService (GET /api/org), where admins add/edit/remove companies and branches.

export interface Company { code: string; name: string; nameAr: string; currency: string; taxNo?: string; }
export interface Branch { code: string; company: string; name: string; nameAr: string; warehouse: string; city?: string; }

export const COMPANIES: Company[] = [
  { code: 'MAIN', name: 'Main Company', nameAr: 'الشركة الرئيسية', currency: 'SAR' },
  { code: 'TRD', name: 'Trading Co.', nameAr: 'شركة التجارة', currency: 'SAR' },
];

export const BRANCHES: Branch[] = [
  { code: 'RUH', company: 'MAIN', name: 'Riyadh', nameAr: 'الرياض', warehouse: 'WH-RUH Main' },
  { code: 'JED', company: 'MAIN', name: 'Jeddah', nameAr: 'جدة', warehouse: 'WH-JED' },
  { code: 'DMM', company: 'MAIN', name: 'Dammam', nameAr: 'الدمام', warehouse: 'WH-DMM' },
  { code: 'RUH2', company: 'TRD', name: 'Riyadh – Trading', nameAr: 'الرياض – التجارة', warehouse: 'WH-TRD Riyadh' },
];

export const WAREHOUSES = ['WH-RUH Main', 'WH-JED', 'WH-DMM', 'WH-TRD Riyadh'];
export const CURRENCIES = ['SAR', 'USD', 'EUR', 'AED'];
export const VAT_RATE = 15;

export interface CatalogItem { sku: string; name: string; unit: string; price: number; }

export const ITEM_CATALOG: CatalogItem[] = [
  { sku: 'IT-LAP-01', name: 'Laptop 14"', unit: 'pc', price: 4200 },
  { sku: 'IT-MON-27', name: 'Monitor 27"', unit: 'pc', price: 1100 },
  { sku: 'IT-PRN-01', name: 'Laser Printer', unit: 'pc', price: 1650 },
  { sku: 'OF-PAP-A4', name: 'A4 Paper (box)', unit: 'box', price: 95 },
  { sku: 'OF-CHR-01', name: 'Office Chair', unit: 'pc', price: 780 },
  { sku: 'OF-DSK-01', name: 'Office Desk', unit: 'pc', price: 1350 },
  { sku: 'FM-CLN-01', name: 'Cleaning Supplies (set)', unit: 'set', price: 240 },
  { sku: 'SV-MNT-01', name: 'Maintenance Service', unit: 'hr', price: 180 },
  { sku: 'SV-CON-01', name: 'Consulting Service', unit: 'day', price: 3500 },
  { sku: 'TR-TKT-01', name: 'Travel Ticket', unit: 'trip', price: 1900 },
  { sku: 'TR-HTL-01', name: 'Hotel Night', unit: 'night', price: 650 },
];

export const PARTIES: Record<DocTypeConfig['partyKind'], string[]> = {
  vendor: ['Al-Noor Supplies', 'Gulf Tech Trading', 'Desert Office Furniture', 'Prime Logistics'],
  customer: ['Riyadh Retail Group', 'Najd Contracting', 'Red Sea Hospitality', 'Eastern Industrial Co.'],
  employee: [],
  payee: ['Gulf Tech Trading', 'Electricity Utility', 'Landlord – HQ Building', 'Prime Logistics'],
  warehouse: WAREHOUSES,
};
