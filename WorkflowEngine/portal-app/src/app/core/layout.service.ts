import { Injectable, signal } from '@angular/core';

/**
 * Per-user screen layout: which sections of a page are hidden, and which modules are hidden from the sidebar.
 * Saved in this browser only (it is a personal preference, so it needs no privilege), and changed either by
 * the AI assistant ("hide the KPI cards") or programmatically.
 *
 * To make a new section hideable: add it to LAYOUT_PAGES below and put
 *   *ngIf="!layout.isHidden('<page>','<block id>')"
 * on its element (`layout = inject(LayoutService)` in the component).
 */
export interface LayoutBlock {
  id: string;
  labelKey: string;
  /** lower-case words (all 7 UI languages) that name this section when the user types a request */
  words: string[];
}
export interface LayoutPage { key: string; titleKey: string; match: RegExp; blocks: LayoutBlock[]; }

const KPI = ['kpi', 'card', 'indicator', 'مؤشر', 'بطاقات', 'indicateur', 'tarjeta', 'indicador', 'kennzahl', 'kacheln', 'indicator', 'carte', 'کارڈ', 'اشاریے'];
const FLOW = ['flow', 'process', 'pipeline', 'مسار', 'العملية', 'تدفق', 'processus', 'flux', 'proceso', 'flujo', 'prozess', 'ablauf', 'processo', 'flusso', 'عمل', 'بہاؤ'];
const TREND = ['trend', 'chart', 'graph', 'اتجاه', 'رسم', 'الاتجاه', 'tendance', 'graphique', 'tendencia', 'gráfico', 'verlauf', 'diagramm', 'tendenza', 'grafico', 'رجحان', 'چارٹ'];

export const LAYOUT_PAGES: LayoutPage[] = [
  { key: 'dashboard', titleKey: 'nav.dashboard', match: /^\/dashboard/, blocks: [
    { id: 'kpis', labelKey: 'blk.kpis', words: KPI },
    { id: 'flow', labelKey: 'blk.flow', words: FLOW },
    { id: 'trend', labelKey: 'blk.trend', words: TREND },
    { id: 'insight', labelKey: 'blk.insight', words: ['insight', 'ai ', 'analysis', 'رؤية', 'تحليل', 'ذكاء', 'aperçu', 'analyse', 'análisis', 'einblick', 'analisi', 'بصیرت', 'تجزیہ'] },
    { id: 'queue', labelKey: 'blk.queue', words: ['queue', 'my approvals', 'approvals', 'inbox', 'موافقات', 'طابور', 'file d', 'approbations', 'cola', 'aprobaciones', 'warteschlange', 'genehmigungen', 'coda', 'approvazioni', 'منظوریاں', 'قطار'] },
    { id: 'quick', labelKey: 'blk.quick', words: ['quick', 'shortcut', 'سريعة', 'اختصار', 'raccourci', 'rapide', 'rápid', 'acceso', 'schnell', 'rapide', 'veloci', 'scorciatoie', 'فوری', 'شارٹ کٹ'] },
    { id: 'recent', labelKey: 'blk.recent', words: ['recent', 'latest', 'documents', 'الأخيرة', 'الحديثة', 'مستندات', 'récent', 'dernier', 'reciente', 'último', 'zuletzt', 'neueste', 'recenti', 'ultimi', 'حالیہ', 'دستاویز'] },
  ] },
  { key: 'module', titleKey: 'nav.modules', match: /^\/m\//, blocks: [
    { id: 'kpis', labelKey: 'blk.kpis', words: KPI },
    { id: 'flow', labelKey: 'blk.flow', words: FLOW },
    { id: 'documents', labelKey: 'blk.documents', words: ['document', 'table', 'list', 'مستند', 'جدول', 'قائمة', 'tableau', 'liste', 'tabla', 'lista', 'dokument', 'tabelle', 'tabella', 'دستاویز', 'فہرست'] },
    { id: 'stock', labelKey: 'blk.stock', words: ['stock', 'movement', 'inventory', 'مخزون', 'حركة', 'mouvement', 'inventaire', 'movimiento', 'inventario', 'bestand', 'bewegung', 'movimento', 'اسٹاک', 'حرکت'] },
    { id: 'ledger', labelKey: 'blk.ledger', words: ['ledger', 'posting', 'journal', 'gl', 'دفتر', 'قيود', 'grand livre', 'écriture', 'libro mayor', 'asiento', 'hauptbuch', 'buchung', 'libro mastro', 'scritture', 'کھاتہ', 'اندراج'] },
    { id: 'otherFlows', labelKey: 'blk.otherFlows', words: ['workflow', 'other', 'service', 'خدمات', 'أخرى', 'سير', 'autres', 'otros', 'andere', 'altri', 'دیگر'] },
  ] },
  { key: 'hr', titleKey: 'module.hr', match: /^\/hr\/overview/, blocks: [
    { id: 'kpis', labelKey: 'blk.kpis', words: KPI },
    { id: 'hires', labelKey: 'blk.hires', words: ['hire', 'hiring', 'تعيين', 'embauche', 'contratac', 'einstellung', 'assunzion', 'تقرری'] },
    { id: 'byUnit', labelKey: 'blk.byUnit', words: ['department', 'unit', 'قسم', 'إدارة', 'département', 'departamento', 'abteilung', 'reparto', 'شعبہ'] },
    { id: 'byNationality', labelKey: 'blk.byNationality', words: ['nationalit', 'جنسية', 'nacionalidad', 'nationalität', 'nazionalità', 'قومیت'] },
    { id: 'byLocation', labelKey: 'blk.byLocation', words: ['location', 'site', 'موقع', 'lieu', 'ubicación', 'standort', 'sede', 'مقام'] },
    { id: 'byGender', labelKey: 'blk.byGender', words: ['gender', 'الجنس', 'genre', 'género', 'geschlecht', 'genere', 'جنس'] },
    { id: 'ratings', labelKey: 'blk.ratings', words: ['rating', 'performance', 'تقييم', 'أداء', 'note', 'calificación', 'bewertung', 'leistung', 'voto', 'ریٹنگ', 'کارکردگی'] },
  ] },
  { key: 'finance', titleKey: 'module.finance', match: /^\/finance\/overview/, blocks: [
    { id: 'kpis', labelKey: 'blk.kpis', words: KPI },
    { id: 'pnl', labelKey: 'blk.pnl', words: ['profit', 'revenue', 'expense', 'income', 'ربح', 'إيراد', 'مصروف', 'bénéfice', 'recette', 'dépense', 'beneficio', 'ingreso', 'gasto', 'gewinn', 'umsatz', 'ausgabe', 'utile', 'ricavi', 'spese', 'منافع', 'آمدنی', 'خرچ'] },
    { id: 'cash', labelKey: 'blk.cash', words: ['cash', 'bank', 'نقد', 'بنك', 'trésorerie', 'banque', 'efectivo', 'banco', 'kasse', 'bank', 'cassa', 'banca', 'نقد', 'بینک'] },
    { id: 'arAging', labelKey: 'blk.arAging', words: ['receivable', 'ar ', 'customers aging', 'ذمم مدينة', 'مدينة', 'créances', 'cuentas por cobrar', 'forderungen', 'crediti', 'وصولیاں'] },
    { id: 'apAging', labelKey: 'blk.apAging', words: ['payable', 'ap ', 'suppliers aging', 'ذمم دائنة', 'دائنة', 'dettes', 'cuentas por pagar', 'verbindlichkeiten', 'debiti', 'ادائیگیاں'] },
    { id: 'budget', labelKey: 'blk.budget', words: ['budget', 'ميزانية', 'budget', 'presupuesto', 'haushalt', 'bilancio preventivo', 'بجٹ'] },
    { id: 'deptSpend', labelKey: 'blk.deptSpend', words: ['department', 'spending', 'cost center', 'قسم', 'إنفاق', 'مركز', 'département', 'dépenses', 'departamento', 'gastos', 'abteilung', 'ausgaben', 'reparto', 'spese', 'شعبہ', 'اخراجات'] },
    { id: 'apDue', labelKey: 'blk.apDue', words: ['due', 'bills', 'invoices due', 'مستحق', 'فواتير', 'échéance', 'factures', 'vencimiento', 'facturas', 'fällig', 'rechnungen', 'scadenza', 'fatture', 'واجب'] },
  ] },
];

const KEY = 'portal_layout';
interface Saved { hidden: Record<string, string[]>; nav: string[]; }
export interface LayoutSnapshot { hidden: Record<string, string[]>; nav: string[]; }

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private state = signal<Saved>(this.load());
  /** module keys hidden from the sidebar */
  hiddenNav = () => this.state().nav;

  pages = LAYOUT_PAGES;

  pageFor(url: string): LayoutPage | null {
    const path = url.split('?')[0].split('#')[0];
    return LAYOUT_PAGES.find(p => p.match.test(path)) ?? null;
  }

  isHidden(page: string, block: string): boolean { return (this.state().hidden[page] ?? []).includes(block); }
  isNavHidden(module: string): boolean { return this.state().nav.includes(module); }

  snapshot(): LayoutSnapshot { const s = this.state(); return { hidden: JSON.parse(JSON.stringify(s.hidden)), nav: [...s.nav] }; }
  restore(s: LayoutSnapshot) { this.set({ hidden: s.hidden, nav: s.nav }); }

  setBlocks(page: string, ids: string[], hidden: boolean) {
    const cur = new Set(this.state().hidden[page] ?? []);
    ids.forEach(i => hidden ? cur.add(i) : cur.delete(i));
    this.set({ ...this.state(), hidden: { ...this.state().hidden, [page]: [...cur] } });
  }
  setNav(modules: string[], hidden: boolean) {
    const cur = new Set(this.state().nav);
    modules.forEach(m => hidden ? cur.add(m) : cur.delete(m));
    this.set({ ...this.state(), nav: [...cur] });
  }
  resetPage(page: string) { const h = { ...this.state().hidden }; delete h[page]; this.set({ ...this.state(), hidden: h }); }
  resetAll() { this.set({ hidden: {}, nav: [] }); }
  anyCustom(): boolean { const s = this.state(); return s.nav.length > 0 || Object.values(s.hidden).some(v => v.length); }

  private set(s: Saved) {
    this.state.set(s);
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
  }
  private load(): Saved {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const p = JSON.parse(raw); return { hidden: p.hidden ?? {}, nav: p.nav ?? [] }; }
    } catch { /* ignore */ }
    return { hidden: {}, nav: [] };
  }
}
