import { Injectable, computed, signal } from '@angular/core';
import { Observable, forkJoin, map, of, catchError, tap } from 'rxjs';
import { PortalApiService } from './portal-api.service';
import { AuthService } from './auth.service';
import { ErpContextService } from './erp-context.service';
import { DocLine, WorkflowDefinitionSummary, WorkflowInstance, WorkflowTask } from './models';
import {
  DOC_TYPES, DocTypeConfig, DocTypeKey, ModuleKey, STAGES, StageKey, moduleForWorkflowName, stageForNode
} from './erp.config';

export type DocStatus = 'pending' | 'approved' | 'rejected' | 'canceled';

/** A workflow instance seen through ERP eyes: a business document with a stage and a value. */
export interface ErpDoc {
  id: string;
  instance: WorkflowInstance;
  docType?: DocTypeConfig;
  module: ModuleKey;
  number: string;
  title: string;
  party: string;
  total: number | null;
  currency: string;
  company?: string;
  branch?: string;
  warehouse?: string;
  date: Date;
  completedAt?: Date;
  status: DocStatus;
  stage: StageKey;
  step: string;          // current workflow node name (or final outcome)
  startedBy: string;
  ageDays: number;
  lines: DocLine[];
}

export interface Kpis {
  salesMonth: number;
  purchasesMonth: number;
  expensesMonth: number;
  receivables: number;
  payables: number;
  pipeline: number;
  committed: number;
  inTransit: number;
  openDocs: number;
  completedMonth: number;
  avgCycleDays: number;
  rejectRate: number;
  myApprovals: number;
}

const DAY = 86_400_000;

export function outcomeOf(i: WorkflowInstance): DocStatus {
  if (i.status === 'Running') return 'pending';
  if (i.status === 'Terminated') return 'canceled';
  const rejected = i.history.some(h =>
    /^(reject|rejected|declined?|return to vendor|out of stock)$/i.test(h.action) ||
    (h.action === 'Entered' && /reject/i.test(h.nodeName)));
  return rejected ? 'rejected' : 'approved';
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) ? n : null;
}

@Injectable({ providedIn: 'root' })
export class ErpDataService {
  instances = signal<WorkflowInstance[]>([]);
  tasks = signal<WorkflowTask[]>([]);
  definitions = signal<WorkflowDefinitionSummary[]>([]);
  loading = signal(false);
  loadedOnce = signal(false);

  constructor(private api: PortalApiService, private auth: AuthService, private ctx: ErpContextService) {}

  /** Every document, unfiltered. */
  allDocs = computed<ErpDoc[]>(() => this.instances().map(i => this.toDoc(i))
    .sort((a, b) => b.date.getTime() - a.date.getTime()));

  /** Documents visible in the selected company / branch. Non-ERP docs (no company stamp) always show. */
  docs = computed<ErpDoc[]>(() => {
    const company = this.ctx.company();
    const branch = this.ctx.branch();
    return this.allDocs().filter(d =>
      (!d.company || d.company === company) && (branch === 'ALL' || !d.branch || d.branch === branch));
  });

  myDocs = computed<ErpDoc[]>(() => {
    const me = this.auth.currentUser()?.username;
    return this.docs().filter(d => d.startedBy === me);
  });

  kpis = computed<Kpis>(() => this.computeKpis(this.docs()));

  refresh(): Observable<void> {
    this.loading.set(true);
    return forkJoin({
      instances: this.api.getInstances().pipe(catchError(() => of([] as WorkflowInstance[]))),
      tasks: this.api.getTasks().pipe(catchError(() => of([] as WorkflowTask[]))),
      defs: this.api.getPublishedDefinitions().pipe(catchError(() => of([] as WorkflowDefinitionSummary[]))),
    }).pipe(
      tap(r => {
        this.instances.set(r.instances);
        this.tasks.set(r.tasks);
        this.definitions.set(r.defs);
        this.loading.set(false);
        this.loadedOnce.set(true);
      }),
      map(() => void 0)
    );
  }

  refreshTasks(): Observable<WorkflowTask[]> {
    return this.api.getTasks().pipe(tap(t => this.tasks.set(t)), catchError(() => of(this.tasks())));
  }

  docTypeByKey(key: string | null | undefined): DocTypeConfig | undefined {
    return DOC_TYPES.find(d => d.key === key);
  }

  definitionFor(dt: DocTypeConfig): WorkflowDefinitionSummary | undefined {
    return this.definitions().find(d => d.name === dt.workflowName && d.isPublished);
  }

  docById(id: string): ErpDoc | undefined {
    return this.allDocs().find(d => d.id === id);
  }

  toDoc(i: WorkflowInstance): ErpDoc {
    const data = i.data ?? {};
    const docType = this.docTypeByKey(data['docType']) ?? DOC_TYPES.find(d => d.workflowName === i.definitionName);
    const status = outcomeOf(i);
    const lastTaskEntry = [...i.history].reverse()
      .find(h => h.action === 'Entered' && !/^(start|end|completed|rejected)$/i.test(h.nodeName));
    let stage: StageKey;
    let step: string;
    if (status === 'approved') { stage = 'reporting'; step = 'Completed'; }
    else if (status === 'pending') { stage = stageForNode(lastTaskEntry?.nodeName); step = lastTaskEntry?.nodeName ?? 'Start'; }
    else { stage = stageForNode(lastTaskEntry?.nodeName); step = status === 'rejected' ? 'Rejected' : 'Canceled'; }

    const date = new Date(i.startedAt);
    const end = i.completedAt ? new Date(i.completedAt) : new Date();
    const lines: DocLine[] = Array.isArray(data['lines']) ? data['lines'] : [];

    return {
      id: i.id,
      instance: i,
      docType,
      module: docType?.module ?? moduleForWorkflowName(i.definitionName),
      number: data['docNumber'] ?? ('WF-' + i.id.slice(0, 6).toUpperCase()),
      title: i.definitionName,
      party: data['party'] ?? data['employeeName'] ?? data['candidateName'] ?? '',
      total: num(data['total']),
      currency: data['currency'] ?? 'SAR',
      company: data['company'],
      branch: data['branch'],
      warehouse: data['warehouse'],
      date,
      completedAt: i.completedAt ? new Date(i.completedAt) : undefined,
      status,
      stage,
      step,
      startedBy: i.startedBy,
      ageDays: Math.max(0, (end.getTime() - date.getTime()) / DAY),
      lines,
    };
  }

  /** Index of a document's stage within its own doc-type stage list (for steppers). */
  stagesFor(doc: ErpDoc): StageKey[] {
    return doc.docType?.stages ?? ['request', 'approval', 'reporting'];
  }

  private computeKpis(docs: ErpDoc[]): Kpis {
    const now = new Date();
    const inMonth = (d?: Date) => !!d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const sum = (list: ErpDoc[]) => list.reduce((s, d) => s + (d.total ?? 0), 0);
    const of = (k: DocTypeKey) => docs.filter(d => d.docType?.key === k);

    const completed = docs.filter(d => d.status === 'approved');
    const closed = docs.filter(d => d.status === 'approved' || d.status === 'rejected');

    return {
      salesMonth: sum(of('SO').filter(d => d.status === 'approved' && inMonth(d.completedAt))),
      purchasesMonth: sum(of('PR').filter(d => d.status === 'approved' && inMonth(d.completedAt))),
      expensesMonth: sum([...of('EXP'), ...of('PV')].filter(d => d.status === 'approved' && inMonth(d.completedAt))),
      receivables: sum(of('SO').filter(d => d.status === 'pending' && d.stage === 'accounting')),
      payables: sum([...of('PR'), ...of('PV'), ...of('EXP')].filter(d => d.status === 'pending' && d.stage === 'accounting')),
      pipeline: sum(of('SO').filter(d => d.status === 'pending')),
      committed: sum(of('PR').filter(d => d.status === 'pending' && (d.stage === 'purchase' || d.stage === 'inventory'))),
      inTransit: sum(of('TRF').filter(d => d.status === 'pending' && d.stage === 'inventory')),
      openDocs: docs.filter(d => d.status === 'pending').length,
      completedMonth: completed.filter(d => inMonth(d.completedAt)).length,
      avgCycleDays: completed.length ? completed.reduce((s, d) => s + d.ageDays, 0) / completed.length : 0,
      rejectRate: closed.length ? docs.filter(d => d.status === 'rejected').length / closed.length : 0,
      myApprovals: this.tasks().length,
    };
  }

  /** Last N months of completed sales vs purchases (by completion month). */
  monthlyTrend(months = 6): { label: string; sales: number; purchases: number }[] {
    const now = new Date();
    const out: { label: string; key: string; sales: number; purchases: number }[] = [];
    for (let k = months - 1; k >= 0; k--) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      out.push({ label: d.toLocaleString('en-US', { month: 'short' }), key: `${d.getFullYear()}-${d.getMonth()}`, sales: 0, purchases: 0 });
    }
    for (const doc of this.docs()) {
      if (doc.status !== 'approved' || !doc.completedAt || doc.total === null) continue;
      const key = `${doc.completedAt.getFullYear()}-${doc.completedAt.getMonth()}`;
      const bucket = out.find(b => b.key === key);
      if (!bucket) continue;
      if (doc.docType?.key === 'SO') bucket.sales += doc.total;
      if (doc.docType?.key === 'PR') bucket.purchases += doc.total;
    }
    return out.map(({ label, sales, purchases }) => ({ label, sales, purchases }));
  }

  /** Running documents per stage - the "where is everything stuck" view. */
  stageCounts(docs = this.docs()): Record<StageKey, { count: number; value: number }> {
    const r = Object.fromEntries(STAGES.map(s => [s, { count: 0, value: 0 }])) as Record<StageKey, { count: number; value: number }>;
    for (const d of docs) {
      const s: StageKey = d.status === 'pending' ? d.stage : (d.status === 'approved' ? 'reporting' : d.stage);
      if (d.status === 'pending' || d.status === 'approved') {
        r[s].count++;
        r[s].value += d.total ?? 0;
      }
    }
    // 'request' = documents raised this month (everything starts there)
    const now = new Date();
    const raised = docs.filter(d => d.date.getMonth() === now.getMonth() && d.date.getFullYear() === now.getFullYear());
    r.request = { count: raised.length, value: raised.reduce((s, d) => s + (d.total ?? 0), 0) };
    return r;
  }

  /** Average hours between a task node being Entered and the decision on it, per step name. */
  stepTurnaround(): { step: string; avgHours: number; count: number }[] {
    const acc = new Map<string, { total: number; count: number }>();
    for (const d of this.docs()) {
      const h = d.instance.history;
      for (let k = 0; k < h.length; k++) {
        if (h[k].action !== 'Entered') continue;
        const decision = h.slice(k + 1).find(x => x.nodeId === h[k].nodeId && x.action !== 'Entered' && x.action !== 'Logged' && x.actor !== 'system');
        if (!decision) continue;
        const hours = (new Date(decision.timestamp).getTime() - new Date(h[k].timestamp).getTime()) / 3_600_000;
        const a = acc.get(h[k].nodeName) ?? { total: 0, count: 0 };
        a.total += hours; a.count++;
        acc.set(h[k].nodeName, a);
      }
    }
    return [...acc.entries()].map(([step, a]) => ({ step, avgHours: a.total / a.count, count: a.count }))
      .sort((x, y) => y.avgHours - x.avgHours);
  }

  /** Item movement from completed receipts (PR past inventory) and deliveries (SO past inventory). */
  itemMovement(): { item: string; inQty: number; outQty: number }[] {
    const m = new Map<string, { inQty: number; outQty: number }>();
    const passed = (d: ErpDoc) => d.status === 'approved' || (d.status === 'pending' && d.stage === 'accounting');
    for (const d of this.docs()) {
      if (!passed(d)) continue;
      const dir = d.docType?.key === 'PR' ? 'in' : d.docType?.key === 'SO' ? 'out' : null;
      if (!dir) continue;
      for (const l of d.lines) {
        const e = m.get(l.item) ?? { inQty: 0, outQty: 0 };
        if (dir === 'in') e.inQty += +l.qty || 0; else e.outQty += +l.qty || 0;
        m.set(l.item, e);
      }
    }
    return [...m.entries()].map(([item, e]) => ({ item, ...e })).sort((a, b) => (b.inQty + b.outQty) - (a.inQty + a.outQty));
  }

  /** "Logged" GL-posting entries written by the workflows' Post to General Ledger step. */
  ledgerEntries(): { date: Date; doc: ErpDoc; text: string }[] {
    const out: { date: Date; doc: ErpDoc; text: string }[] = [];
    for (const d of this.docs()) {
      for (const h of d.instance.history) {
        if (h.action === 'Logged' && h.comment) out.push({ date: new Date(h.timestamp), doc: d, text: h.comment });
      }
    }
    return out.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  topParties(keys: DocTypeKey[], limit = 5): { party: string; value: number; count: number }[] {
    const m = new Map<string, { value: number; count: number }>();
    for (const d of this.docs()) {
      if (!d.docType || !keys.includes(d.docType.key) || !d.party || d.status === 'canceled' || d.status === 'rejected') continue;
      const e = m.get(d.party) ?? { value: 0, count: 0 };
      e.value += d.total ?? 0; e.count++;
      m.set(d.party, e);
    }
    return [...m.entries()].map(([party, e]) => ({ party, ...e })).sort((a, b) => b.value - a.value).slice(0, limit);
  }

  /** Next document number for a type - prefix-YYMM-#### based on what this client can see. */
  nextNumber(dt: DocTypeConfig): string {
    const now = new Date();
    const stem = `${dt.prefix}-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}-`;
    const used = this.allDocs().map(d => d.number).filter(n => n.startsWith(stem))
      .map(n => parseInt(n.slice(stem.length), 10)).filter(n => isFinite(n));
    const next = (used.length ? Math.max(...used) : 0) + 1 + Math.floor(Math.random() * 3); // small jitter avoids clashes between two users creating at once
    return stem + String(next).padStart(4, '0');
  }
}
