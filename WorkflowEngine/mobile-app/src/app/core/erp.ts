/**
 * ERP layer on top of the workflow engine.
 *
 * The engine itself only knows about definitions, instances and tasks. This file turns those
 * into ERP concepts - business modules (Sales, Purchasing, Inventory, Finance, HR, Operations),
 * documents with numbers/amounts/parties, a lifecycle stage per document
 * (Request -> Approval -> Procurement -> Fulfillment -> Payment -> Accounting -> Closed) and
 * management KPIs - so the portal and mobile app can behave like an ERP while every number
 * still comes from the same live workflow data.
 *
 * Pure functions only (no Angular), so this exact file is shared by portal-app and mobile-app.
 */
import { WorkflowDefinitionSummary, WorkflowInstance, WorkflowNodeLite, WorkflowTask } from './models';

export type ModuleKey = 'sales' | 'purchasing' | 'inventory' | 'finance' | 'hr' | 'operations';
export type StageKey = 'request' | 'approval' | 'procurement' | 'fulfillment' | 'payment' | 'accounting' | 'closed';
export type Outcome = 'pending' | 'approved' | 'rejected' | 'canceled';

export interface ErpModule {
  key: ModuleKey;
  icon: string;      // portal icon name (see shared/icon.component.ts)
  ionIcon: string;   // ionicons name for the mobile app
  color: string;
  prefix: string;    // document number prefix
  match: RegExp;     // workflow-name keywords that put a definition in this module
}

// Order matters: the first match wins, so "Stock Transfer" lands in Inventory before HR's "transfer".
export const MODULES: ErpModule[] = [
  { key: 'sales', icon: 'cart', ionIcon: 'cart-outline', color: '#0284c7', prefix: 'SO', match: /sales|customer|quotation|order[- ]to[- ]cash/i },
  { key: 'purchasing', icon: 'bag', ionIcon: 'bag-handle-outline', color: '#7c3aed', prefix: 'PR', match: /purchas|procure|vendor|supplier|rfq/i },
  { key: 'inventory', icon: 'box', ionIcon: 'cube-outline', color: '#d97706', prefix: 'ST', match: /stock|inventory|warehouse|goods/i },
  { key: 'finance', icon: 'wallet', ionIcon: 'wallet-outline', color: '#059669', prefix: 'FN', match: /expense|payment|invoice|budget|financ|petty|reimburs/i },
  { key: 'hr', icon: 'users', ionIcon: 'people-outline', color: '#db2777', prefix: 'HR', match: /leave|clearance|employee|hire|onboard|candidate|transfer|recruit|start work/i },
  { key: 'operations', icon: 'cog', ionIcon: 'construct-outline', color: '#475569', prefix: 'OP', match: /.*/ },
];

export const STAGES: StageKey[] = ['request', 'approval', 'procurement', 'fulfillment', 'payment', 'accounting', 'closed'];

/** Node-name keywords -> lifecycle stage. First match wins. */
const STAGE_RULES: [StageKey, RegExp][] = [
  ['request', /^(submit|new |raise )/i],
  ['accounting', /journal|ledger|\bgl\b|posting|post to|vendor master/i],
  ['payment', /payment|invoice|collect|reimburs|settle/i],
  ['fulfillment', /goods|receipt|grn|pick|ship|deliver|dispatch|warehouse|receiv|provision|stock/i],
  ['procurement', /purchase order|procure|rfq|sourcing/i],
  ['approval', /approv|review|sign-off|committee|verif/i],
  ['request', /request|entry|order|claim|registration/i],
];

/** Base currency for consolidated (multi-currency) KPIs. Indicative rates - replace with a real FX feed. */
export const BASE_CURRENCY = 'SAR';
export const FX_TO_BASE: Record<string, number> = { SAR: 1, USD: 3.75, EUR: 4.05, AED: 1.02, GBP: 4.75 };

/** Roles that see every document in a module (management view) rather than only their own. */
const OVERSIGHT_ROLES = /admin|manager|head|finance|procurement|warehouse|stores|sales|hr|secretary|committee/i;
export function canSeeAll(role: string | undefined): boolean { return !!role && OVERSIGHT_ROLES.test(role); }

export interface ErpDoc {
  id: string;
  docNo: string;
  title: string;
  module: ModuleKey;
  stage: StageKey;
  outcome: Outcome;
  amount: number;          // in the document's own currency
  amountBase: number;      // converted to BASE_CURRENCY
  currency: string;
  company: string;
  branch: string;
  party: string;           // customer / vendor / employee, whichever the flow collected
  item: string;
  requester: string;
  currentStep: string;     // node name the document is waiting on right now
  startedAt: Date;
  completedAt?: Date;
  cycleHours?: number;
  instance: WorkflowInstance;
}

export interface TrackerStep {
  id: string;
  name: string;
  stage: StageKey | null;
  state: 'done' | 'current' | 'rejected' | 'pending' | 'skipped';
  actor?: string;
  at?: string;
}

// ---------- classification ----------

const moduleCache = new Map<string, ModuleKey>();
export function moduleOf(definitionName: string): ModuleKey {
  const hit = moduleCache.get(definitionName);
  if (hit) return hit;
  const key = MODULES.find(m => m.match.test(definitionName))!.key;
  moduleCache.set(definitionName, key);
  return key;
}
export function moduleMeta(key: ModuleKey): ErpModule { return MODULES.find(m => m.key === key)!; }

export function stageOfNode(name: string, type?: string): StageKey | null {
  for (const [stage, re] of STAGE_RULES) if (re.test(name)) return stage;
  if (type === 'ApprovalTask') return 'approval';
  if (type === 'FormTask') return 'request';
  return null;
}

const isReject = (action: string) => /^reject/i.test(action);

export function outcomeOf(i: WorkflowInstance): Outcome {
  if (i.status === 'Running') return 'pending';
  if (i.status === 'Terminated') return 'canceled';
  return i.history.some(h => isReject(h.action)) ? 'rejected' : 'approved';
}

export function instanceStage(i: WorkflowInstance, def?: WorkflowDefinitionSummary): StageKey {
  if (i.status !== 'Running') return 'closed';
  const types = new Map((def?.nodes ?? []).map(n => [n.id, n.type]));
  for (let k = i.history.length - 1; k >= 0; k--) {
    const h = i.history[k];
    if (h.action !== 'Entered') continue;
    const s = stageOfNode(h.nodeName, types.get(h.nodeId));
    if (s && s !== 'closed') return s;
  }
  return 'request';
}

function currentStepName(i: WorkflowInstance): string {
  if (i.status !== 'Running') return '';
  for (let k = i.history.length - 1; k >= 0; k--) {
    const h = i.history[k];
    if (h.action === 'Entered' && (!i.currentNodeIds || i.currentNodeIds.includes(h.nodeId))) return h.nodeName;
  }
  return i.history[i.history.length - 1]?.nodeName ?? '';
}

// ---------- data helpers ----------

export function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

const AMOUNT_KEYS = ['amount', 'totalAmount', 'total', 'estimatedAmount', 'invoiceAmount', 'paidAmount', 'collectedAmount', 'value'];
const PARTY_KEYS = ['customer', 'vendor', 'vendorName', 'supplier', 'employeeName', 'candidateName'];
const str = (v: any) => (v === null || v === undefined ? '' : String(v));

export function amountOf(data: Record<string, any>): number {
  for (const k of AMOUNT_KEYS) if (data?.[k] !== undefined && data[k] !== '' && data[k] !== null) return num(data[k]);
  return 0;
}

export function toBase(amount: number, currency: string): number {
  return amount * (FX_TO_BASE[(currency || BASE_CURRENCY).toUpperCase()] ?? 1);
}

export function docNumber(i: WorkflowInstance, module: ModuleKey): string {
  const d = new Date(i.startedAt);
  const yy = isNaN(d.getTime()) ? '' : String(d.getFullYear()).slice(2);
  return `${moduleMeta(module).prefix}-${yy}${i.id.slice(0, 5).toUpperCase()}`;
}

export function toDoc(i: WorkflowInstance, def?: WorkflowDefinitionSummary): ErpDoc {
  const module = moduleOf(i.definitionName);
  const data = i.data ?? {};
  const currency = str(data['currency']).toUpperCase() || BASE_CURRENCY;
  const amount = amountOf(data);
  const startedAt = new Date(i.startedAt);
  const completedAt = i.completedAt ? new Date(i.completedAt) : undefined;
  return {
    id: i.id,
    docNo: docNumber(i, module),
    title: i.definitionName,
    module,
    stage: instanceStage(i, def),
    outcome: outcomeOf(i),
    amount,
    amountBase: toBase(amount, currency),
    currency,
    company: str(data['company']),
    branch: str(data['branch']),
    party: PARTY_KEYS.map(k => str(data[k])).find(v => !!v) ?? '',
    item: str(data['item'] ?? data['category'] ?? data['expenseType'] ?? data['leaveType']),
    requester: i.startedBy,
    currentStep: currentStepName(i),
    startedAt,
    completedAt,
    cycleHours: completedAt ? (completedAt.getTime() - startedAt.getTime()) / 36e5 : undefined,
    instance: i,
  };
}

/** Human/accounting steps of a definition, in canvas order, with this instance's progress on each. */
export function trackerSteps(i: WorkflowInstance, def?: WorkflowDefinitionSummary): TrackerStep[] {
  const nodes: WorkflowNodeLite[] = (def?.nodes ?? [])
    .filter(n => ['FormTask', 'ApprovalTask', 'Logger'].includes(n.type))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  if (nodes.length === 0) {
    // Definition not loaded - fall back to whatever the history shows.
    const seen = new Map<string, TrackerStep>();
    for (const h of i.history) {
      if (h.action === 'Entered' || /^start$/i.test(h.nodeName) || /^end$/i.test(h.nodeName)) continue;
      seen.set(h.nodeId, { id: h.nodeId, name: h.nodeName, stage: stageOfNode(h.nodeName), state: isReject(h.action) ? 'rejected' : 'done', actor: h.actor, at: h.timestamp });
    }
    return [...seen.values()];
  }

  const current = new Set(i.currentNodeIds ?? []);
  return nodes.map(n => {
    const entries = i.history.filter(h => h.nodeId === n.id);
    const decision = [...entries].reverse().find(h => h.action !== 'Entered');
    let state: TrackerStep['state'] = 'pending';
    if (i.status === 'Running' && current.has(n.id)) state = 'current';
    else if (decision && isReject(decision.action)) state = 'rejected';
    else if (entries.length > 0) state = 'done';
    else if (i.status !== 'Running') state = 'skipped';
    return { id: n.id, name: n.name, stage: stageOfNode(n.name, n.type), state, actor: decision?.actor, at: decision?.timestamp ?? entries[0]?.timestamp };
  });
}

// ---------- KPIs ----------

export interface MonthPoint { key: string; label: Date; sales: number; spend: number; count: number; }

export interface ErpKpis {
  openDocs: number;
  closedDocs: number;
  salesBooked: number;      // approved sales orders
  salesPipeline: number;    // sales orders still running
  spend: number;            // approved purchasing + finance (expenses/payments)
  commitments: number;      // purchasing still running (open POs/PRs)
  receivables: number;      // sales orders waiting on invoice/collection
  payables: number;         // purchases waiting on vendor payment
  stockMoves: number;       // completed inventory documents
  approvalRate: number;     // approved / (approved + rejected), 0..1
  avgCycleHours: number;
  byModule: Record<ModuleKey, { count: number; open: number; amount: number }>;
  byStage: Record<StageKey, number>;
  months: MonthPoint[];
  bottlenecks: { step: string; count: number }[];
  topParties: { name: string; amount: number; module: ModuleKey }[];
  forecastNextMonthSales: number;
}

export function computeKpis(docs: ErpDoc[], monthsBack = 6): ErpKpis {
  const byModule = Object.fromEntries(MODULES.map(m => [m.key, { count: 0, open: 0, amount: 0 }])) as ErpKpis['byModule'];
  const byStage = Object.fromEntries(STAGES.map(s => [s, 0])) as ErpKpis['byStage'];
  const now = new Date();
  const months: MonthPoint[] = [];
  for (let k = monthsBack - 1; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d, sales: 0, spend: 0, count: 0 });
  }
  const monthIdx = new Map(months.map((m, ix) => [m.key, ix]));
  const steps = new Map<string, number>();
  const parties = new Map<string, { amount: number; module: ModuleKey }>();

  let salesBooked = 0, salesPipeline = 0, spend = 0, commitments = 0, receivables = 0, payables = 0, stockMoves = 0;
  let approved = 0, rejected = 0, cycleSum = 0, cycleN = 0, open = 0;

  for (const d of docs) {
    const isOpen = d.outcome === 'pending';
    const ok = d.outcome === 'approved';
    byModule[d.module].count++;
    if (isOpen) { byModule[d.module].open++; open++; byStage[d.stage]++; if (d.currentStep) steps.set(d.currentStep, (steps.get(d.currentStep) ?? 0) + 1); }
    if (ok || isOpen) byModule[d.module].amount += d.amountBase;
    if (ok) approved++;
    if (d.outcome === 'rejected') rejected++;
    if (d.cycleHours !== undefined && ok) { cycleSum += d.cycleHours; cycleN++; }

    if (d.module === 'sales') {
      if (ok) salesBooked += d.amountBase;
      if (isOpen) { salesPipeline += d.amountBase; if (d.stage === 'payment') receivables += d.amountBase; }
    }
    if (d.module === 'purchasing') {
      if (ok) spend += d.amountBase;
      if (isOpen) { commitments += d.amountBase; if (d.stage === 'payment' || d.stage === 'accounting') payables += d.amountBase; }
    }
    if (d.module === 'finance' && ok) spend += d.amountBase;
    if (d.module === 'inventory' && ok) stockMoves++;

    const mi = monthIdx.get(`${d.startedAt.getFullYear()}-${d.startedAt.getMonth()}`);
    if (mi !== undefined) {
      months[mi].count++;
      if (ok && d.module === 'sales') months[mi].sales += d.amountBase;
      if (ok && (d.module === 'purchasing' || d.module === 'finance')) months[mi].spend += d.amountBase;
    }
    if (d.party && (ok || isOpen) && d.amountBase > 0) {
      const p = parties.get(d.party) ?? { amount: 0, module: d.module };
      p.amount += d.amountBase;
      parties.set(d.party, p);
    }
  }

  return {
    openDocs: open,
    closedDocs: docs.length - open,
    salesBooked, salesPipeline, spend, commitments, receivables, payables, stockMoves,
    approvalRate: approved + rejected === 0 ? 0 : approved / (approved + rejected),
    avgCycleHours: cycleN === 0 ? 0 : cycleSum / cycleN,
    byModule, byStage, months,
    bottlenecks: [...steps.entries()].map(([step, count]) => ({ step, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    topParties: [...parties.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 5),
    forecastNextMonthSales: linearForecast(months.map(m => m.sales)),
  };
}

/** Least-squares trend over the monthly series, projected one period ahead (never negative). */
export function linearForecast(series: number[]): number {
  const n = series.length;
  if (n === 0) return 0;
  if (n === 1) return series[0];
  const xs = series.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = series.reduce((a, b) => a + b, 0) / n;
  let num_ = 0, den = 0;
  for (let i = 0; i < n; i++) { num_ += (xs[i] - mx) * (series[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den === 0 ? 0 : num_ / den;
  return Math.max(0, my + slope * (n - mx));
}

/** CSV export for the Reports page. */
export function docsToCsv(docs: ErpDoc[]): string {
  const head = ['Document', 'Process', 'Module', 'Stage', 'Status', 'Company', 'Branch', 'Party', 'Item', 'Amount', 'Currency', `Amount (${BASE_CURRENCY})`, 'Requester', 'Started', 'Completed', 'Cycle hours'];
  const esc = (v: any) => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = docs.map(d => [d.docNo, d.title, d.module, d.stage, d.outcome, d.company, d.branch, d.party, d.item, d.amount, d.currency, d.amountBase.toFixed(2), d.requester, d.startedAt.toISOString(), d.completedAt?.toISOString() ?? '', d.cycleHours?.toFixed(1) ?? ''].map(esc).join(','));
  return [head.join(','), ...rows].join('\n');
}

/** Definitions shown in the "New" menu of a module. */
export function definitionsFor(module: ModuleKey, defs: WorkflowDefinitionSummary[]): WorkflowDefinitionSummary[] {
  return defs.filter(d => d.isPublished && moduleOf(d.name) === module);
}

export function priorityRank(p?: string): number {
  return ({ Urgent: 0, High: 1, Normal: 2, Low: 3 } as Record<string, number>)[p ?? 'Normal'] ?? 2;
}

export function sortTasks(tasks: WorkflowTask[]): WorkflowTask[] {
  return [...tasks].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || +new Date(a.createdAt) - +new Date(b.createdAt));
}
