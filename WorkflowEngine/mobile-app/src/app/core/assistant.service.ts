import { Injectable, signal } from '@angular/core';
import { ErpDataService, ErpDoc } from './erp-data.service';
import { I18nService } from './i18n.service';
import { ErpContextService } from './erp-context.service';
import { DOC_TYPES } from './erp.config';

export interface AssistantAction { label: string; route: any[]; queryParams?: Record<string, string>; }
export interface AssistantMessage { from: 'user' | 'ai'; text: string; actions?: AssistantAction[]; at: Date; }


/**
 * Words (lower-case, substring match) that trigger each assistant intent, for all seven UI languages.
 * Add a language word here and the assistant understands it - no other change needed.
 */
const KW = {
  howTo: ['how', 'create', 'raise', 'new ', 'كيف', 'أنشئ', 'انشاء', 'إنشاء', 'comment', 'créer', 'creer', 'nouvelle', 'nouveau',
    'cómo', 'como', 'crear', 'creo', 'nuevo', 'wie ', 'erstell', 'anlegen', 'neu', 'creare', 'creo', 'nuovo', 'کیسے', 'بنا', 'نیا'],
  leave: ['leave', 'vacation', 'إجازة', 'اجازة', 'congé', 'conge', 'vacances', 'permiso', 'vacaciones', 'urlaub', 'ferie', 'permesso', 'چھٹی'],
  approvals: ['approv', 'pending', 'waiting', 'inbox', 'task', 'موافق', 'معلق', 'ينتظر', 'بانتظار', 'مهام', 'approb', 'attend', 'en attente', 'tâche',
    'aprobaci', 'pendiente', 'tarea', 'genehmig', 'wartet', 'aufgabe', 'attesa', 'in sospeso', 'منظوری', 'منتظر', 'زیر التوا'],
  forecast: ['forecast', 'predict', 'next month', 'توقع', 'تنبؤ', 'prévision', 'prevision', 'pronóstic', 'pronostic', 'prognose', 'vorhersage', 'previsione', 'تخمینہ', 'پیش گوئی'],
  stuck: ['stuck', 'bottleneck', 'delay', 'slow', 'late', 'تأخ', 'اختناق', 'متأخر', 'عالق', 'bloqu', 'retard', 'goulot', 'detenid', 'retras', 'cuello',
    'festhäng', 'hängen', 'verzög', 'engpass', 'fermi', 'ritard', 'collo di bottiglia', 'رکی', 'تاخیر', 'رکاوٹ'],
  vendor: ['vendor', 'supplier', 'مورد', 'fournisseur', 'proveedor', 'lieferant', 'fornitore', 'وینڈر', 'سپلائر'],
  customer: ['customer', 'client', 'عميل', 'عملاء', 'cliente', 'kunde', 'گاہک', 'کسٹمر'],
  sales: ['sales', 'revenue', 'مبيعات', 'إيراد', 'ايراد', 'vente', 'chiffre d', 'ventas', 'ingresos', 'verkauf', 'umsatz', 'vendite', 'ricavi', 'سیلز', 'فروخت', 'آمدنی'],
  spend: ['spend', 'purchas', 'cost', 'expense', 'payable', 'cash', 'إنفاق', 'مشتريات', 'مصروف', 'دائن', 'نقد', 'dépense', 'depense', 'achat', 'coût', 'trésorerie',
    'gasto', 'compra', 'costo', 'ausgabe', 'einkauf', 'kosten', 'verbindlichkeit', 'spesa', 'spese', 'acquist', 'costi', 'اخراجات', 'خریداری', 'خرچ', 'ادائیگی'],
  stock: ['stock', 'inventory', 'item', 'مخزون', 'صنف', 'أصناف', 'inventaire', 'article', 'existencia', 'inventario', 'artículo', 'lager', 'bestand', 'artikel',
    'magazzino', 'giacenza', 'انوینٹری', 'اسٹاک'],
  summary: ['summary', 'overview', 'kpi', 'how are we', 'ملخص', 'نظرة', 'الأداء', 'résumé', 'resume', 'aperçu', 'resumen', 'zusammenfassung', 'übersicht', 'riepilogo', 'panoramica', 'خلاصہ', 'جائزہ'],
  doc: {
    PR: ['purchase', 'requisition', 'شراء', 'achat', 'compra', 'bestell', 'einkauf', 'acquist', 'خرید'],
    SO: ['sales order', 'sell', 'order', 'بيع', 'vente', 'commande', 'venta', 'pedido', 'verkauf', 'auftrag', 'vendita', 'ordine', 'سیلز', 'فروخت'],
    TRF: ['transfer', 'stock', 'تحويل', 'transfert', 'traslado', 'transferencia', 'umlager', 'trasferimento', 'منتقل'],
    PV: ['payment', 'voucher', 'pay ', 'صرف', 'دفع', 'paiement', 'pago', 'zahlung', 'pagamento', 'ادائیگی'],
    EXP: ['expense', 'claim', 'reimburse', 'مصروف', 'dépense', 'note de frais', 'gasto', 'reembolso', 'spese', 'rimborso', 'spesen', 'اخراجات'],
  } as Record<string, string[]>,
};

/**
 * ERP "AI assistant" - answers questions about the live ERP data (approvals, sales, spend,
 * forecast, bottlenecks, document status) and how-to questions, entirely client-side.
 *
 * It's an intent matcher + real computations over ErpDataService, not an LLM - so answers
 * are exact and instant, and nothing leaves the browser. To add free-form answers, POST
 * the question plus a compact JSON summary (kpis, stageCounts, topParties) to an LLM
 * endpoint on your backend from `fallback()` below.
 */
@Injectable({ providedIn: 'root' })
export class AssistantService {
  messages = signal<AssistantMessage[]>([]);
  open = signal(false);

  constructor(private data: ErpDataService, private i18n: I18nService, private ctx: ErpContextService) {}

  suggestions(): string[] {
    return ['ai.s1', 'ai.s2', 'ai.s3', 'ai.s4', 'ai.s5'].map(k => this.i18n.t(k));
  }

  ensureGreeting() {
    if (this.messages().length) return;
    this.push('ai', this.i18n.t('ai.greet'));
  }

  ask(question: string) {
    const q = question.trim();
    if (!q) return;
    this.push('user', q);
    const answer = this.answer(q.toLowerCase());
    this.push('ai', answer.text, answer.actions);
  }

  private push(from: 'user' | 'ai', text: string, actions?: AssistantAction[]) {
    this.messages.set([...this.messages(), { from, text, actions, at: new Date() }]);
  }

  private money(v: number, cur = this.ctx.companyObj().currency): string {
    return new Intl.NumberFormat(this.i18n.locale, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v);
  }

  private answer(q: string): { text: string; actions?: AssistantAction[] } {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    const k = this.data.kpis();
    const has = (words: string[]) => words.some(w => q.includes(w));
    const sep = this.i18n.isRtl ? '، ' : ', ';

    // 1. Document number lookup, e.g. "PR-2610-0003" or "status of so-2610-0001"
    const numMatch = q.match(/\b(pr|so|trf|pv|exp|wf)-[a-z0-9-]+/i);
    if (numMatch) {
      const doc = this.data.allDocs().find(d => d.number.toLowerCase() === numMatch[0].toLowerCase());
      if (!doc) return { text: t('ai.notFound', { n: numMatch[0].toUpperCase() }) };
      return {
        text: t('ai.docStatus', {
          n: doc.number, t: doc.title, s: this.statusWord(doc), step: doc.step, stage: this.i18n.t('stage.' + doc.stage),
          amt: doc.total !== null ? this.money(doc.total, doc.currency) : t('ai.noAmount'), d: doc.ageDays.toFixed(1)
        }),
        actions: [{ label: doc.number, route: ['/documents', doc.id] }]
      };
    }

    // 2. How-to / create
    if (has(KW.howTo)) {
      const dt = DOC_TYPES.find(d => q.includes(t('doc.' + d.key).toLowerCase()) || has(KW.doc[d.key]));
      if (dt) {
        return {
          text: t('ai.howTo', { module: t('module.' + dt.module), doc: t('doc.' + dt.key), route: t('doc.' + dt.key + '.desc') }),
          actions: [{ label: t('doc.' + dt.key), route: ['/new', dt.key] }]
        };
      }
      if (has(KW.leave)) return { text: t('ai.howLeave'), actions: [{ label: t('nav.services'), route: ['/services'] }] };
    }

    // 3. Approvals
    if (has(KW.approvals)) {
      const tasks = this.data.tasks();
      if (!tasks.length) return { text: t('ai.noApprovals') };
      const urgent = tasks.filter(x => x.priority === 'High' || x.priority === 'Urgent').length;
      const oldest = [...tasks].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))[0];
      const days = (Date.now() - +new Date(oldest.createdAt)) / 86_400_000;
      return {
        text: t('ai.approvals', { n: tasks.length, urgent: urgent ? t('ai.urgentPart', { n: urgent }) : '', step: oldest.nodeName, d: days.toFixed(1) }),
        actions: [{ label: t('nav.approvals'), route: ['/approvals'] }]
      };
    }

    // 4. Forecast
    if (has(KW.forecast)) {
      const trend = this.data.monthlyTrend(6).map(m => m.sales);
      const f = this.linearForecast(trend);
      return {
        text: t('ai.forecast', {
          series: trend.map(v => this.money(v)).join(sep), next: this.money(f.next), dir: t(f.slope >= 0 ? 'ai.up' : 'ai.down'),
          slope: this.money(Math.abs(f.slope)), pipe: this.money(k.pipeline)
        }),
        actions: [{ label: t('module.sales'), route: ['/m', 'sales'] }]
      };
    }

    // 5. Bottlenecks
    if (has(KW.stuck)) {
      const steps = this.data.stepTurnaround().slice(0, 3);
      const open = this.data.docs().filter(d => d.status === 'pending');
      if (!open.length) return { text: t('ai.noOpen') };
      const byStep = new Map<string, number>();
      open.forEach(d => byStep.set(d.step, (byStep.get(d.step) ?? 0) + 1));
      const worst = [...byStep.entries()].sort((a, b) => b[1] - a[1])[0];
      const old = open.filter(d => d.ageDays > 3).length;
      return {
        text: t('ai.stuck', { n: open.length, old, step: worst[0], c: worst[1] }) +
          (steps.length ? t('ai.slowest', { list: steps.map(s => `${s.step} (${s.avgHours.toFixed(1)}h)`).join(sep) }) : ''),
        actions: [{ label: t('nav.reports'), route: ['/reports'] }]
      };
    }

    // 6. Top vendors / customers
    if (has(KW.vendor)) {
      const top = this.data.topParties(['PR', 'PV']);
      return { text: top.length ? t('ai.topVendors', { list: top.map(x => `${x.party} ${this.money(x.value)}`).join(' · ') }) : t('ai.noVendors'), actions: [{ label: t('module.purchasing'), route: ['/m', 'purchasing'] }] };
    }
    if (has(KW.customer)) {
      const top = this.data.topParties(['SO']);
      return { text: top.length ? t('ai.topCustomers', { list: top.map(x => `${x.party} ${this.money(x.value)}`).join(' · ') }) : t('ai.noCustomers'), actions: [{ label: t('module.sales'), route: ['/m', 'sales'] }] };
    }

    // 7. Money questions
    if (has(KW.sales)) {
      return { text: t('ai.sales', { m: this.money(k.salesMonth), p: this.money(k.pipeline), r: this.money(k.receivables) }), actions: [{ label: t('module.sales'), route: ['/m', 'sales'] }] };
    }
    if (has(KW.spend)) {
      return { text: t('ai.spend', { p: this.money(k.purchasesMonth), e: this.money(k.expensesMonth), c: this.money(k.committed), a: this.money(k.payables) }), actions: [{ label: t('module.finance'), route: ['/m', 'finance'] }] };
    }
    if (has(KW.stock)) {
      const mv = this.data.itemMovement().slice(0, 5);
      return { text: mv.length ? t('ai.stock', { list: mv.map(m => `${m.item} ${m.inQty}/${m.outQty}`).join(' · '), t: this.money(k.inTransit) }) : t('ai.noStock'), actions: [{ label: t('module.inventory'), route: ['/m', 'inventory'] }] };
    }
    if (has(KW.summary)) {
      return { text: this.summary(), actions: [{ label: t('nav.dashboard'), route: ['/dashboard'] }] };
    }

    return this.fallback();
  }

  /** One-paragraph insight used on the dashboard card too. */
  summary(): string {
    const k = this.data.kpis();
    return this.i18n.t('ai.summary', {
      open: k.openDocs, done: k.completedMonth, cycle: k.avgCycleDays.toFixed(1), rej: (k.rejectRate * 100).toFixed(0),
      sales: this.money(k.salesMonth), purch: this.money(k.purchasesMonth), mine: k.myApprovals
    });
  }

  private fallback() { return { text: this.i18n.t('ai.fallback') }; }

  private statusWord(d: ErpDoc) { return this.i18n.t('filter.' + d.status).toLowerCase(); }

  /** Least-squares line through the series, evaluated one step ahead (never below zero). */
  private linearForecast(ys: number[]): { next: number; slope: number } {
    const n = ys.length;
    if (n < 2) return { next: ys[0] ?? 0, slope: 0 };
    const xs = ys.map((_, i) => i);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const slope = den ? num / den : 0;
    return { next: Math.max(0, my + slope * (n - mx)), slope };
  }
}
