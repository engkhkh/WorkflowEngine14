import { ErpItem, ErpRec } from './erp.models';

export const r2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

// ------------------------------------------------------------------------------- Manufacturing

export interface BomLine { sku: string; qty: number; scrapPct?: number; }
export interface MrpDemand { sku: string; qty: number; due?: string; }
export interface MrpRow { sku: string; name: string; gross: number; onHand: number; scheduled: number; net: number; action: 'make' | 'buy' | 'ok'; level: number; due?: string; }

/** Standard cost of one produced unit: components at item cost + routing time at the work-centre rate + overhead. */
export function bomCost(bom: ErpRec, items: Map<string, ErpItem>, rate: number, overheadPct: number): { material: number; labor: number; overhead: number; total: number; unit: number } {
  const out = Math.max(0.0001, num(bom.data['qty']) || 1);
  const material = r2(((bom.data['lines'] ?? []) as BomLine[]).reduce((s, l) => s + num(l.qty) * (1 + num(l.scrapPct) / 100) * (items.get(l.sku)?.cost ?? 0), 0));
  const labor = r2(num(bom.data['routingMinutes']) / 60 * rate);
  const overhead = r2(labor * overheadPct / 100);
  const total = r2(material + labor + overhead);
  return { material, labor, overhead, total, unit: r2(total / out) };
}

/**
 * Material requirements planning: explodes the demand through every bill of materials level by level, nets it against what is on hand
 * and what open work orders will already deliver, and says per item whether to MAKE it (it has a BOM -> work order) or BUY it (purchase request).
 */
export function mrp(demands: MrpDemand[], boms: ErpRec[], onHand: Map<string, number>, scheduled: Map<string, number>, items: Map<string, ErpItem>, maxLevels = 12): MrpRow[] {
  const bomBy = new Map(boms.filter(b => b.status !== 'Inactive').map(b => [String(b.code), b]));
  const free = new Map(onHand);                 // on-hand still unallocated
  const sched = new Map(scheduled);
  const rows = new Map<string, MrpRow>();

  const need = (sku: string, qty: number, level: number, due?: string) => {
    if (qty <= 0 || level > maxLevels) return;
    let row = rows.get(sku);
    if (!row) { row = { sku, name: items.get(sku)?.name ?? '', gross: 0, onHand: Math.max(0, onHand.get(sku) ?? 0), scheduled: Math.max(0, scheduled.get(sku) ?? 0), net: 0, action: 'ok', level, due }; rows.set(sku, row); }
    row.gross = r2(row.gross + qty); row.level = Math.max(row.level, level);
    const fromStock = Math.min(Math.max(0, free.get(sku) ?? 0), qty); free.set(sku, (free.get(sku) ?? 0) - fromStock);
    let left = qty - fromStock;
    const fromOrders = Math.min(Math.max(0, sched.get(sku) ?? 0), left); sched.set(sku, (sched.get(sku) ?? 0) - fromOrders);
    left = r2(left - fromOrders);
    if (left <= 0) return;
    row.net = r2(row.net + left);
    const bom = bomBy.get(sku);
    row.action = bom ? 'make' : 'buy';
    if (bom) {
      const out = Math.max(0.0001, num(bom.data['qty']) || 1);
      for (const l of (bom.data['lines'] ?? []) as BomLine[]) need(l.sku, r2(left / out * num(l.qty) * (1 + num(l.scrapPct) / 100)), level + 1, due);
    }
  };
  for (const d of demands) need(d.sku, num(d.qty), 0, d.due);
  return [...rows.values()].sort((a, b) => a.level - b.level || a.sku.localeCompare(b.sku));
}

/** True when putting `sku` into the bill of `product` would make the bills circular. */
export function wouldCycle(product: string, comps: string[], boms: ErpRec[]): boolean {
  const by = new Map(boms.filter(b => b.code !== product).map(b => [String(b.code), ((b.data['lines'] ?? []) as BomLine[]).map(l => l.sku)]));
  const seen = new Set<string>();
  const go = (list: string[]): boolean => list.some(c => { if (c === product) return true; if (seen.has(c)) return false; seen.add(c); return go(by.get(c) ?? []); });
  return go(comps);
}

// ------------------------------------------------------------------------------- Projects

export interface ProjectFin {
  code: string; name: string; customer: string; status: string; budget: number; labor: number; other: number; actual: number; billed: number; ready: number; hours: number;
  progress: number; forecast: number; margin: number; marginPct: number; over: boolean; byType: { name: string; budget: number; actual: number }[];
}
const labelOf = (p: ErpRec) => String(p.data['name'] ?? p.code ?? '');

/** Budget vs actual vs forecast for one project, from its timesheets (cost rate x hours), costs, milestones and tasks. */
export function projectFin(p: ErpRec, timesheets: ErpRec[], costs: ErpRec[], milestones: ErpRec[], tasks: ErpRec[]): ProjectFin {
  const ts = timesheets.filter(t => t.ref === p.code && t.status !== 'Rejected');
  const cs = costs.filter(c => c.ref === p.code);
  const ms = milestones.filter(m => m.ref === p.code);
  const tk = tasks.filter(t => t.ref === p.code);
  const labor = r2(ts.reduce((s, t) => s + num(t.data['hours']) * num(t.data['costRate']), 0));
  const other = r2(cs.reduce((s, c) => s + num(c.data['amount']), 0));
  const budgetLines = ((p.data['lines'] ?? []) as { category: string; amount: number }[]);
  const budget = r2(budgetLines.reduce((s, l) => s + num(l.amount), 0));
  const actual = r2(labor + other);
  const done = tk.filter(t => t.status === 'Done').length;
  const progress = tk.length ? Math.round(done / tk.length * 100) : num(p.data['progress']);
  const forecast = budget > 0 && progress > 0 && progress < 100 ? r2(Math.max(actual, actual / (progress / 100))) : Math.max(actual, progress >= 100 ? actual : budget);
  const billed = num(p.data['billed']);
  const model = String(p.data['billingModel'] ?? '');
  let ready = 0;
  if (model === 'tm') {
    ready += ts.filter(t => t.status === 'Approved' && t.data['billable']).reduce((s, t) => s + num(t.data['hours']) * num(t.data['rate']), 0);
    ready += cs.filter(c => c.status === 'Open' && c.data['billable']).reduce((s, c) => s + num(c.data['amount']) * (1 + num(c.data['markupPct']) / 100), 0);
  } else {
    ready += ms.filter(m => m.status === 'Achieved').reduce((s, m) => s + num(m.data['amount']), 0);
  }
  const types = new Set<string>([...budgetLines.map(l => l.category), ...cs.map(c => String(c.data['type'] ?? '')), 'Labor']);
  const byType = [...types].filter(Boolean).map(name => ({
    name,
    budget: r2(budgetLines.filter(l => l.category === name).reduce((s, l) => s + num(l.amount), 0)),
    actual: name === 'Labor' ? labor : r2(cs.filter(c => c.data['type'] === name).reduce((s, c) => s + num(c.data['amount']), 0)),
  }));
  const margin = r2(billed - actual);
  return {
    code: String(p.code), name: labelOf(p), customer: String(p.data['customer'] ?? ''), status: String(p.status ?? ''), budget, labor, other, actual, billed, ready: r2(ready),
    hours: r2(ts.reduce((s, t) => s + num(t.data['hours']), 0)), progress, forecast, margin, marginPct: billed ? Math.round(margin / billed * 1000) / 10 : 0, over: budget > 0 && forecast > budget, byType,
  };
}

/** Percent of working capacity an employee is allocated to projects over [from, to] (sum of overlapping allocations). */
export function utilization(allocs: ErpRec[], employee: string, from: string, to: string): number {
  return allocs.filter(a => a.data['employee'] === employee && (!a.data['to'] || a.data['to'] >= from) && (!a.data['from'] || a.data['from'] <= to) && a.status !== 'Inactive')
    .reduce((s, a) => s + num(a.data['pct']), 0);
}

// ------------------------------------------------------------------------------- CRM

export interface QuoteLine { desc: string; qty: number; price: number; discountPct?: number; }
export function quoteTotals(lines: QuoteLine[], taxPct: number, orderDiscountPct = 0): { net: number; discount: number; tax: number; total: number } {
  const gross = lines.reduce((s, l) => s + num(l.qty) * num(l.price) * (1 - num(l.discountPct) / 100), 0);
  const discount = r2(gross * orderDiscountPct / 100);
  const net = r2(gross - discount);
  const tax = r2(net * taxPct / 100);
  return { net, discount, tax, total: r2(net + tax) };
}
export const weighted = (amount: number, probability: number) => r2(num(amount) * num(probability) / 100);

/** Default win probability of a pipeline stage. */
export const STAGE_PROB: Record<string, number> = { Qualified: 25, Proposal: 50, Negotiation: 75, Won: 100, Lost: 0 };
