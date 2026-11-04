import { FinRec, JournalLine } from './fin.models';

/** Pure finance calculations used by the screens (trial balance, statements, ageing, depreciation, budgets, projects). */

export interface PostedLine {
  journal: string; date: string; company: string; account: string; debit: number; credit: number;
  costCenter: string; project: string; memo: string; icPartner: string;
}

const num = (v: any) => { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : 0; };
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LineFilter {
  company?: string;            // '' / 'ALL' = every company
  from?: string; to?: string;  // yyyy-mm-dd, inclusive
  eliminateIc?: boolean;       // drop intercompany lines (group consolidation)
  /** value of 1 unit of each company's currency in the group currency - used when consolidating companies with different currencies */
  groupRates?: Record<string, number>;
  statuses?: string[];         // default ['Posted']
}

/** Journal lines in the base currency (amount x the journal's rate), filtered. */
export function postedLines(journals: FinRec[], f: LineFilter = {}): PostedLine[] {
  const out: PostedLine[] = [];
  const statuses = f.statuses ?? ['Posted'];
  for (const j of journals) {
    if (!statuses.includes(j.status ?? '')) continue;
    const d = j.data ?? {};
    const date = String(d['date'] ?? '').slice(0, 10);
    if (!date) continue;
    if (f.from && date < f.from) continue;
    if (f.to && date > f.to) continue;
    const co = j.company ?? '';
    if (f.company && f.company !== 'ALL' && co && co !== f.company) continue;
    const rate = (num(d['rate']) > 0 ? num(d['rate']) : 1) * (f.groupRates?.[co] ?? 1);
    for (const l of (d['lines'] as JournalLine[] | undefined) ?? []) {
      if (f.eliminateIc && l.icPartner) continue;
      out.push({
        journal: j.code ?? '', date, company: co, account: l.account, debit: round2(num(l.debit) * rate), credit: round2(num(l.credit) * rate),
        costCenter: l.costCenter ?? '', project: l.project ?? '', memo: l.memo || (d['memo'] ?? ''), icPartner: l.icPartner ?? ''
      });
    }
  }
  return out;
}

export interface TbRow { account: string; name: string; type: string; debit: number; credit: number; balance: number; }

/** Trial balance: per account debit / credit totals and the net balance in its normal direction (positive = normal). */
export function trialBalance(lines: PostedLine[], accounts: FinRec[], nameOf: (a: FinRec) => string): TbRow[] {
  const sums = new Map<string, { d: number; c: number }>();
  for (const l of lines) {
    const s = sums.get(l.account) ?? { d: 0, c: 0 };
    s.d += l.debit; s.c += l.credit; sums.set(l.account, s);
  }
  const rows: TbRow[] = [];
  const seen = new Set<string>();
  for (const a of [...accounts].sort((x, y) => (x.code ?? '').localeCompare(y.code ?? ''))) {
    const code = a.code ?? '';
    const s = sums.get(code);
    seen.add(code);
    if (!s && a.data?.['isHeader']) continue;
    if (!s) continue;
    const type = String(a.data?.['type'] ?? '');
    const debitNormal = type === 'Asset' || type === 'Expense';
    rows.push({ account: code, name: nameOf(a), type, debit: round2(s.d), credit: round2(s.c), balance: round2(debitNormal ? s.d - s.c : s.c - s.d) });
  }
  // lines on accounts that were deleted / are unknown still count
  for (const [code, s] of sums) if (!seen.has(code)) rows.push({ account: code, name: code, type: '', debit: round2(s.d), credit: round2(s.c), balance: round2(s.d - s.c) });
  return rows;
}

export interface Statement { revenue: TbRow[]; expense: TbRow[]; totalRevenue: number; totalExpense: number; net: number; }
export function incomeStatement(tb: TbRow[]): Statement {
  const revenue = tb.filter(r => r.type === 'Revenue');
  const expense = tb.filter(r => r.type === 'Expense');
  const totalRevenue = round2(revenue.reduce((s, r) => s + r.balance, 0));
  const totalExpense = round2(expense.reduce((s, r) => s + r.balance, 0));
  return { revenue, expense, totalRevenue, totalExpense, net: round2(totalRevenue - totalExpense) };
}

export interface BalanceSheet { assets: TbRow[]; liabilities: TbRow[]; equity: TbRow[]; netIncome: number; totalAssets: number; totalLiabilities: number; totalEquity: number; check: number; }
export function balanceSheet(tb: TbRow[]): BalanceSheet {
  const assets = tb.filter(r => r.type === 'Asset');
  const liabilities = tb.filter(r => r.type === 'Liability');
  const equity = tb.filter(r => r.type === 'Equity');
  const netIncome = incomeStatement(tb).net;
  const totalAssets = round2(assets.reduce((s, r) => s + r.balance, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.balance, 0));
  const totalEquity = round2(equity.reduce((s, r) => s + r.balance, 0) + netIncome);
  return { assets, liabilities, equity, netIncome, totalAssets, totalLiabilities, totalEquity, check: round2(totalAssets - totalLiabilities - totalEquity) };
}

// ---------------------------------------------------------------- invoices & ageing

export const invoiceTotal = (d: any) => num(d?.total) > 0 ? num(d.total) : num(d?.amount) + num(d?.taxAmount);
export const invoiceOutstanding = (r: FinRec) => round2((invoiceTotal(r.data) - num(r.data?.['paid'])) * (num(r.data?.['rate']) > 0 ? num(r.data['rate']) : 1));

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;
export function daysLate(r: FinRec, today: string): number {
  const due = String(r.data?.['dueDate'] || r.data?.['date'] || today).slice(0, 10);
  return Math.round((Date.parse(today) - Date.parse(due)) / 86400000);
}
export function bucketOf(late: number): number { return late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4; }

export interface AgingParty { party: string; buckets: number[]; total: number; }
/** Ageing per customer / supplier from the open invoices. */
export function agingByParty(invoices: FinRec[], partyKey: 'vendor' | 'customer', openStatuses: string[], today: string): { parties: AgingParty[]; totals: number[] } {
  const map = new Map<string, number[]>();
  for (const r of invoices) {
    if (!openStatuses.includes(r.status ?? '')) continue;
    const amt = invoiceOutstanding(r);
    if (amt <= 0) continue;
    const p = String(r.data?.[partyKey] ?? '—');
    const b = map.get(p) ?? [0, 0, 0, 0, 0];
    b[bucketOf(daysLate(r, today))] += amt;
    map.set(p, b);
  }
  const parties = [...map.entries()].map(([party, buckets]) => ({ party, buckets: buckets.map(round2), total: round2(buckets.reduce((s, v) => s + v, 0)) }))
    .sort((a, b) => b.total - a.total);
  const totals = [0, 1, 2, 3, 4].map(i => round2(parties.reduce((s, p) => s + p.buckets[i], 0)));
  return { parties, totals };
}

/** 3-way match: purchase order, goods received and invoice. */
export type MatchState = 'Matched' | 'Mismatch' | 'NoPO';
export function matchInvoice(d: any, tolerancePct: number): { state: MatchState; reason?: string; limit: number } {
  const po = String(d?.poNo ?? '').trim();
  const total = invoiceTotal(d);
  if (!po) return { state: 'NoPO', limit: 0 };
  const limit = Math.min(num(d?.poAmount), num(d?.receivedAmount));
  if (limit <= 0) return { state: 'Mismatch', reason: 'noReceipt', limit };
  if (total <= limit * (1 + tolerancePct / 100)) return { state: 'Matched', limit };
  return { state: 'Mismatch', reason: 'over', limit };
}

// ---------------------------------------------------------------- fixed assets

export interface AssetCalc { cost: number; salvage: number; accumulated: number; nbv: number; monthly: number; monthsLeft: number; }
export function assetCalc(d: any): AssetCalc {
  const cost = num(d?.cost), salvage = num(d?.salvage), accumulated = num(d?.accumulated);
  const life = Math.max(1, Math.round(num(d?.lifeMonths) || 60));
  const nbv = round2(cost - accumulated);
  const method = d?.method === 'DB' ? 'DB' : 'SL';
  let monthly = method === 'SL' ? (cost - salvage) / life : nbv * (2 / life);
  monthly = Math.max(0, Math.min(monthly, nbv - salvage));
  return { cost, salvage, accumulated, nbv, monthly: round2(monthly), monthsLeft: monthly > 0 ? Math.ceil((nbv - salvage) / Math.max(monthly, 0.01)) : 0 };
}

/** Months (yyyy-mm) still to be depreciated up to and including `upTo` (yyyy-mm). */
export function periodsDue(d: any, upTo: string): string[] {
  const start = String(d?.lastPeriod ? nextMonth(d.lastPeriod) : String(d?.inServiceDate ?? '').slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(start) || start > upTo) return [];
  const out: string[] = [];
  let p = start;
  while (p <= upTo && out.length < 600) { out.push(p); p = nextMonth(p); }
  return out;
}
export function nextMonth(p: string): string {
  const [y, m] = p.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
/** Depreciation for all the months that are due (stops at the salvage value). */
export function depreciationDue(d: any, upTo: string): { amount: number; months: number; lastPeriod: string | null } {
  const due = periodsDue(d, upTo);
  let acc = num(d?.accumulated), total = 0, last: string | null = null, n = 0;
  const cost = num(d?.cost), salvage = num(d?.salvage);
  const life = Math.max(1, Math.round(num(d?.lifeMonths) || 60));
  for (const p of due) {
    const nbv = cost - acc;
    let m = d?.method === 'DB' ? nbv * (2 / life) : (cost - salvage) / life;
    m = Math.max(0, Math.min(m, nbv - salvage));
    if (m <= 0.004) break;
    acc += m; total += m; last = p; n++;
  }
  return { amount: round2(total), months: n, lastPeriod: last };
}
export function schedule(d: any, months = 12): { period: string; amount: number; nbv: number }[] {
  const out: { period: string; amount: number; nbv: number }[] = [];
  const cost = num(d?.cost), salvage = num(d?.salvage);
  const life = Math.max(1, Math.round(num(d?.lifeMonths) || 60));
  let acc = num(d?.accumulated);
  let p = d?.lastPeriod ? nextMonth(d.lastPeriod) : String(d?.inServiceDate ?? '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(p)) return out;
  for (let i = 0; i < months; i++) {
    const nbv = cost - acc;
    let m = d?.method === 'DB' ? nbv * (2 / life) : (cost - salvage) / life;
    m = Math.max(0, Math.min(m, nbv - salvage));
    if (m <= 0.004) break;
    acc += m; out.push({ period: p, amount: round2(m), nbv: round2(cost - acc) }); p = nextMonth(p);
  }
  return out;
}

// ---------------------------------------------------------------- budgets & projects

export interface BudgetLine { id: string; costCenter: string; account: string; year: number; budget: number; actual: number; remaining: number; usedPct: number; }
/** Budget vs actual: actual = posted expense for that cost centre (and account when the budget names one) in the budget's year. */
export function budgetVsActual(budgets: FinRec[], lines: PostedLine[], accountType: (code: string) => string): BudgetLine[] {
  return budgets.map(b => {
    const d = b.data ?? {};
    const year = num(d['year']);
    const cc = String(d['costCenter'] ?? ''), acc = String(d['account'] ?? '');
    const actual = round2(lines.filter(l => l.date.startsWith(String(year)) && accountType(l.account) === 'Expense'
      && (!cc || l.costCenter === cc) && (!acc || l.account === acc)).reduce((s, l) => s + l.debit - l.credit, 0));
    const budget = num(d['amount']);
    return { id: b.id, costCenter: cc, account: acc, year, budget, actual, remaining: round2(budget - actual), usedPct: budget > 0 ? Math.round(actual / budget * 100) : 0 };
  });
}

export interface ProjectResult { code: string; revenue: number; cost: number; profit: number; marginPct: number; }
export function projectResults(projects: FinRec[], lines: PostedLine[], accountType: (code: string) => string): ProjectResult[] {
  return projects.map(p => {
    const mine = lines.filter(l => l.project === p.code);
    const revenue = round2(mine.filter(l => accountType(l.account) === 'Revenue').reduce((s, l) => s + l.credit - l.debit, 0));
    const cost = round2(mine.filter(l => accountType(l.account) === 'Expense').reduce((s, l) => s + l.debit - l.credit, 0));
    return { code: p.code ?? '', revenue, cost, profit: round2(revenue - cost), marginPct: revenue > 0 ? Math.round((revenue - cost) / revenue * 100) : 0 };
  });
}

export const periodOf = (date: string) => String(date ?? '').slice(0, 7);
