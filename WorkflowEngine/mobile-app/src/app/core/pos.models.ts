/**
 * Point-of-sale data model (mirrors backend/.../Models/Pos.cs and Controllers/PosController.cs).
 * Every row is a PosRec: Kind / Code / Company / Branch / Status are columns, the rest is in `data`.
 * Branch is empty for a company that has no branches (one stock location, one set of tills).
 */
export type PosKind = 'product' | 'category' | 'customer' | 'promotion' | 'register' | 'setting' | 'shift' | 'sale' | 'cashmove' | 'stock' | 'stockmove' | 'transfer';

export interface PosRec<D = Record<string, any>> {
  id: string; kind: PosKind; code?: string | null; company?: string | null; branch?: string | null;
  status?: string | null; ref?: string | null; parent?: string | null; data: D;
  createdBy?: string | null; createdAt?: string; updatedAt?: string | null;
}

export interface PosSettings {
  taxRate?: number; pricesIncludeTax?: boolean; pointsPerCurrency?: number; pointValue?: number;
  requireShift?: boolean; allowNegativeStock?: boolean; maxDiscountPct?: number; receiptHeader?: string; receiptFooter?: string;
}
export const POS_DEFAULTS: Required<PosSettings> = {
  taxRate: 15, pricesIncludeTax: true, pointsPerCurrency: 1, pointValue: 0.05, requireShift: true, allowNegativeStock: false, maxDiscountPct: 20, receiptHeader: '', receiptFooter: ''
};

export interface CartLine { sku: string; qty: number; discountPct: number; }
export interface PosPayment { method: 'cash' | 'card' | 'other'; amount: number; ref?: string; }
export interface PosCheckoutBody {
  company?: string; branch?: string; register?: string; customer?: string;
  lines: CartLine[]; payments: PosPayment[]; discountPct?: number; redeemPoints?: number; note?: string; localId?: string;
}

export interface PosSummary {
  salesToday: number; returnsToday: number; countToday: number; avgBasket: number;
  salesPeriod: number; returnsPeriod: number; openShifts: number; cashVariance: number; stockValue: number;
  daily: { name: string; a: number; b: number }[];
  payments: { name: string; value: number }[];
  byBranch: { name: string; value: number }[];
  topProducts: { name: string; value: number; qty: number }[];
  lowStock: { sku: string; name: string; branch: string; qty: number }[];
}

/** Every POS page with the privileges that open it. The Admin module hands these out per user. */
export interface PosNavItem { path: string; label: string; icon: string; any: string[]; }
export const POS_NAV: PosNavItem[] = [
  { path: 'terminal', label: 'pos.nav.terminal', icon: 'cart', any: ['pos.sell'] },
  { path: 'shifts', label: 'pos.nav.shifts', icon: 'clock', any: ['pos.sell', 'pos.shifts.manage'] },
  { path: 'sales', label: 'pos.nav.sales', icon: 'file', any: ['pos.view'] },
  { path: 'products', label: 'pos.nav.products', icon: 'box', any: ['pos.products.manage', 'pos.view'] },
  { path: 'customers', label: 'pos.nav.customers', icon: 'users', any: ['pos.customers.manage', 'pos.view'] },
  { path: 'promotions', label: 'pos.nav.promotions', icon: 'trending-up', any: ['pos.promotions.manage', 'pos.view'] },
  { path: 'stock', label: 'pos.nav.stock', icon: 'layers', any: ['pos.stock.view'] },
  { path: 'overview', label: 'pos.nav.overview', icon: 'bar-chart', any: ['pos.reports.view'] },
  { path: 'setup', label: 'pos.nav.setup', icon: 'settings', any: ['pos.setup'] },
];
export const POS_ANY: string[] = ['pos.view', 'pos.sell', 'pos.reports.view', 'pos.stock.view', 'pos.shifts.manage', 'pos.products.manage', 'pos.customers.manage', 'pos.promotions.manage', 'pos.setup'];
