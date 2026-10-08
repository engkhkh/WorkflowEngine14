/**
 * Finance data model (mirrors backend/.../Models/Finance.cs and Controllers/FinanceController.cs).
 * Every finance row is a FinRec: Kind / Code / Company / Status are columns, everything else is in `data`.
 */
export type FinKind =
  | 'account' | 'period' | 'journal' | 'vendor' | 'apinvoice' | 'customer' | 'arinvoice' | 'receipt'
  | 'bankaccount' | 'banktxn' | 'budget' | 'assetclass' | 'asset' | 'project' | 'currency' | 'taxcode' | 'costcenter' | 'setting';

export interface FinRec<D = Record<string, any>> {
  id: string;
  kind: FinKind;
  code?: string | null;
  company?: string | null;
  status?: string | null;
  data: D;
  createdBy?: string | null;
  approvedBy?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface FinAuditRow {
  id: string; kind: FinKind; recordId: string; code?: string | null; action: string; userName: string; at: string; summary?: string | null;
}

export interface FinCount { name: string; value: number; }
export interface FinSummary {
  revenueYtd: number; expenseYtd: number; profitYtd: number;
  monthly: { name: string; a: number; b: number }[];
  cash: number; cashByAccount: FinCount[];
  arOutstanding: number; arOverdue: number; arAging: FinCount[];
  apOutstanding: number; apOverdue: number; apAging: FinCount[];
  apDue: { code: string; party: string; dueDate: string; amount: number; overdue: boolean }[];
  budgetTotal: number; budgetActual: number; budgetRows: { name: string; budget: number; actual: number }[];
  deptSpend: FinCount[];
  journalsToApprove: number; invoicesToApprove: number;
  assetCount: number; assetCost: number; assetAccumulated: number;
  activeProjects: number; currentPeriod?: string | null; currentPeriodStatus?: string | null;
}

export const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'] as const;
export type AccountType = typeof ACCOUNT_TYPES[number];

export const JOURNAL_STATUSES = ['Draft', 'Submitted', 'Posted', 'Rejected', 'Reversed'] as const;
export const AP_STATUSES = ['Draft', 'Submitted', 'Approved', 'Paid', 'Held', 'Rejected'] as const;
export const AR_STATUSES = ['Draft', 'Issued', 'Paid', 'Cancelled'] as const;

/** kinds whose rows belong to one company (the others are shared by the whole workspace) */
export const COMPANY_KINDS: FinKind[] = ['period', 'journal', 'apinvoice', 'arinvoice', 'receipt', 'bankaccount', 'banktxn', 'budget', 'asset'];

export interface JournalLine {
  account: string; debit: number; credit: number; costCenter?: string; project?: string; memo?: string; icPartner?: string;
}

/** Every finance page, with the privileges that open it. The Admin module hands these out per user. */
export interface FinNavItem { path: string; label: string; icon: string; any: string[]; }
export const FIN_NAV: FinNavItem[] = [
  { path: 'overview', label: 'fin.nav.overview', icon: 'bar-chart', any: ['finance.reports.view'] },
  { path: 'gl', label: 'fin.nav.gl', icon: 'book', any: ['finance.gl.view'] },
  { path: 'payables', label: 'fin.nav.ap', icon: 'cart', any: ['finance.ap.view'] },
  { path: 'receivables', label: 'fin.nav.ar', icon: 'wallet', any: ['finance.ar.view'] },
  { path: 'bank', label: 'fin.nav.bank', icon: 'layers', any: ['finance.bank.view'] },
  { path: 'budgets', label: 'fin.nav.budgets', icon: 'trending-up', any: ['finance.budget.view'] },
  { path: 'assets', label: 'fin.nav.assets', icon: 'box', any: ['finance.assets.view'] },
  { path: 'projects', label: 'fin.nav.projects', icon: 'git-branch', any: ['finance.projects.view'] },
  { path: 'setup', label: 'fin.nav.setup', icon: 'settings', any: ['finance.setup'] },
  { path: 'audit', label: 'fin.nav.audit', icon: 'shield', any: ['finance.audit.view'] },
];
/** any of these opens the Finance workspace; otherwise the sidebar link goes to the plain finance documents page */
export const FIN_ANY: string[] = FIN_NAV.flatMap(n => n.any);

export interface FinControls { enforceSod?: boolean; matchTolerancePct?: number; }
export interface FinDefaults {
  arAccount?: string; apAccount?: string; bankAccount?: string; revenueAccount?: string; vatInput?: string; vatOutput?: string;
  deprExpense?: string; deprAccum?: string; expenseAccount?: string;
}
