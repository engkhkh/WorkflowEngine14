/**
 * Built-in ERP assistant: answers questions about the live ERP data (approvals, sales,
 * spend, receivables/payables, inventory, bottlenecks, forecasts, "where is my request")
 * and how-to questions about using the system - in English or Arabic.
 *
 * It is deliberately a deterministic, on-device intent engine: every number it quotes is
 * computed from the same documents the dashboard shows, so it never invents figures. To put
 * a real LLM behind it, send `question` plus `buildContext(...)` to your model endpoint in
 * AssistantService.ask() and fall back to answer() when the endpoint is unavailable.
 */
import { BASE_CURRENCY, ErpDoc, ErpKpis, ModuleKey, MODULES, StageKey } from './erp';
import { WorkflowTask } from './models';

export interface AssistantReply {
  text: string;
  bullets?: string[];
  link?: { label: string; route: string };
}

type Lang = 'en' | 'ar';

const T = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en);

const MODULE_NAMES: Record<ModuleKey, [string, string]> = {
  sales: ['Sales', 'المبيعات'], purchasing: ['Purchasing', 'المشتريات'], inventory: ['Inventory', 'المخزون'],
  finance: ['Finance', 'المالية'], hr: ['HR', 'الموارد البشرية'], operations: ['Operations', 'العمليات'],
};
const STAGE_NAMES: Record<StageKey, [string, string]> = {
  request: ['Request', 'الطلب'], approval: ['Approval', 'الاعتماد'], procurement: ['Procurement', 'الشراء'],
  fulfillment: ['Warehouse / Delivery', 'المستودع / التسليم'], payment: ['Invoice & Payment', 'الفوترة والدفع'],
  accounting: ['Accounting', 'المحاسبة'], closed: ['Closed', 'مغلق'],
};

export const ASSISTANT_SUGGESTIONS: Record<Lang, string[]> = {
  en: ['What needs my approval?', 'Sales this month', 'Forecast next month sales', 'Where are the bottlenecks?', 'Payables and receivables', 'How do I raise a purchase request?'],
  ar: ['ما الذي ينتظر اعتمادي؟', 'مبيعات هذا الشهر', 'توقع مبيعات الشهر القادم', 'أين الاختناقات؟', 'الذمم الدائنة والمدينة', 'كيف أرفع طلب شراء؟'],
};

export function answer(
  question: string,
  ctx: { docs: ErpDoc[]; myDocs: ErpDoc[]; tasks: WorkflowTask[]; kpis: ErpKpis; lang: Lang; money: (n: number) => string; user?: string }
): AssistantReply {
  const q = question.toLowerCase().trim();
  const { lang, money, kpis, docs, tasks } = ctx;
  const has = (...words: string[]) => words.some(w => q.includes(w));
  const modName = (m: ModuleKey) => MODULE_NAMES[m][lang === 'ar' ? 1 : 0];
  const stageName = (s: StageKey) => STAGE_NAMES[s][lang === 'ar' ? 1 : 0];

  if (!q) return help(lang);

  // --- how-to ---
  if (has('how', 'help', 'كيف', 'مساعدة', 'شرح')) {
    if (has('purchase', 'buy', 'شراء', 'مشتريات')) return {
      text: T(lang, 'To raise a purchase request:', 'لرفع طلب شراء:'),
      bullets: T(lang,
        'Open Purchasing → New → Purchase Requisition|Fill item, quantity, estimated amount, branch and justification|Submit - it routes to your manager, then the department head if over 10,000, then Procurement raises the PO, the warehouse receives the goods, Finance pays and the journal is posted automatically',
        'افتح المشتريات ← جديد ← طلب شراء|أدخل الصنف والكمية والمبلغ التقديري والفرع والمبرر|أرسل الطلب - يذهب إلى مديرك ثم رئيس القسم إذا تجاوز 10,000، ثم تصدر المشتريات أمر الشراء ويستلم المستودع البضاعة وتدفع المالية ويُرحَّل القيد تلقائياً').split('|'),
      link: { label: T(lang, 'Open Purchasing', 'فتح المشتريات'), route: '/m/purchasing' },
    };
    if (has('approve', 'اعتماد', 'موافقة')) return {
      text: T(lang, 'Open Approvals, pick a document, review the details and the process tracker, add a comment and choose Approve or Reject. The document moves to the next step immediately.', 'افتح الاعتمادات، اختر المستند، راجع التفاصيل ومسار العملية، أضف ملاحظة ثم اختر اعتماد أو رفض. ينتقل المستند للخطوة التالية فوراً.'),
      link: { label: T(lang, 'Open Approvals', 'فتح الاعتمادات'), route: '/tasks' },
    };
    if (has('sales', 'order', 'مبيعات', 'بيع')) return {
      text: T(lang, 'Sales → New → Sales Order. Discounts above 10% go to the sales manager; then the warehouse picks and ships, Finance invoices and collects, and revenue is posted to the ledger.', 'المبيعات ← جديد ← أمر بيع. الخصومات فوق 10% تذهب لمدير المبيعات، ثم يجهز المستودع الشحنة، وتصدر المالية الفاتورة وتحصّل، ويُرحَّل الإيراد إلى دفتر الأستاذ.'),
      link: { label: T(lang, 'Open Sales', 'فتح المبيعات'), route: '/m/sales' },
    };
    return help(lang);
  }

  // --- approvals / tasks ---
  if (has('approv', 'task', 'inbox', 'pending my', 'my approval', 'اعتماد', 'مهام', 'مهامي', 'موافق', 'ينتظر')) {
    if (tasks.length === 0) return { text: T(lang, 'Nothing is waiting on you right now. 🎉', 'لا يوجد ما ينتظر قرارك حالياً. 🎉') };
    const urgent = tasks.filter(t => t.priority === 'Urgent' || t.priority === 'High').length;
    return {
      text: T(lang, `${tasks.length} item(s) are waiting on you${urgent ? `, ${urgent} high priority` : ''}:`, `لديك ${tasks.length} عنصر بانتظار قرارك${urgent ? `، منها ${urgent} عالية الأولوية` : ''}:`),
      bullets: tasks.slice(0, 5).map(t => `${t.nodeName}${t.priority && t.priority !== 'Normal' ? ` · ${t.priority}` : ''}`),
      link: { label: T(lang, 'Go to Approvals', 'الذهاب إلى الاعتمادات'), route: '/tasks' },
    };
  }

  // --- forecast ---
  if (has('forecast', 'predict', 'next month', 'توقع', 'تنبؤ', 'الشهر القادم')) {
    const last = kpis.months[kpis.months.length - 1]?.sales ?? 0;
    const f = kpis.forecastNextMonthSales;
    const delta = last === 0 ? 0 : ((f - last) / last) * 100;
    return {
      text: T(lang,
        `Based on the last ${kpis.months.length} months of booked sales, next month is trending toward about ${money(f)}${last ? ` (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% vs this month)` : ''}.`,
        `بناءً على مبيعات آخر ${kpis.months.length} أشهر، يتجه الشهر القادم إلى حوالي ${money(f)}${last ? ` (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% مقارنة بهذا الشهر)` : ''}.`),
      bullets: kpis.months.map(m => `${m.label.toLocaleDateString(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US', { month: 'short', year: '2-digit' })}: ${money(m.sales)}`),
    };
  }

  // --- receivables / payables / cash ---
  if (has('receivable', 'payable', 'cash', 'owe', 'ذمم', 'مدين', 'دائن', 'نقد', 'سيولة')) {
    return {
      text: T(lang, 'Working-capital snapshot:', 'لمحة عن رأس المال العامل:'),
      bullets: [
        T(lang, `Receivables (invoiced, awaiting collection): ${money(kpis.receivables)}`, `الذمم المدينة (مفوترة بانتظار التحصيل): ${money(kpis.receivables)}`),
        T(lang, `Payables (received, awaiting vendor payment): ${money(kpis.payables)}`, `الذمم الدائنة (مستلمة بانتظار الدفع للمورد): ${money(kpis.payables)}`),
        T(lang, `Open purchase commitments: ${money(kpis.commitments)}`, `التزامات الشراء المفتوحة: ${money(kpis.commitments)}`),
        T(lang, `Net position: ${money(kpis.receivables - kpis.payables)}`, `صافي المركز: ${money(kpis.receivables - kpis.payables)}`),
      ],
      link: { label: T(lang, 'Open Finance', 'فتح المالية'), route: '/m/finance' },
    };
  }

  // --- sales ---
  if (has('sales', 'revenue', 'customer', 'sold', 'مبيعات', 'إيراد', 'عملاء', 'عميل')) {
    const thisMonth = kpis.months[kpis.months.length - 1]?.sales ?? 0;
    const top = kpis.topParties.filter(p => p.module === 'sales').slice(0, 3);
    return {
      text: T(lang, `Sales booked: ${money(kpis.salesBooked)} in total, ${money(thisMonth)} this month. Open pipeline: ${money(kpis.salesPipeline)}.`,
        `المبيعات المحققة: ${money(kpis.salesBooked)} إجمالاً، و${money(thisMonth)} هذا الشهر. خط المبيعات المفتوح: ${money(kpis.salesPipeline)}.`),
      bullets: top.length ? top.map(p => `${p.name}: ${money(p.amount)}`) : undefined,
      link: { label: T(lang, 'Open Sales', 'فتح المبيعات'), route: '/m/sales' },
    };
  }

  // --- purchasing / spend / vendors ---
  if (has('spend', 'purchas', 'vendor', 'supplier', 'procure', 'expense', 'cost', 'مشتريات', 'مورد', 'إنفاق', 'مصروف', 'تكلفة')) {
    const top = kpis.topParties.filter(p => p.module === 'purchasing').slice(0, 3);
    return {
      text: T(lang, `Approved spend: ${money(kpis.spend)}. Open purchase commitments: ${money(kpis.commitments)} across ${kpis.byModule.purchasing.open} document(s).`,
        `الإنفاق المعتمد: ${money(kpis.spend)}. التزامات الشراء المفتوحة: ${money(kpis.commitments)} عبر ${kpis.byModule.purchasing.open} مستند.`),
      bullets: top.length ? top.map(p => T(lang, `Vendor ${p.name}: ${money(p.amount)}`, `المورد ${p.name}: ${money(p.amount)}`)) : undefined,
      link: { label: T(lang, 'Open Purchasing', 'فتح المشتريات'), route: '/m/purchasing' },
    };
  }

  // --- inventory ---
  if (has('stock', 'inventory', 'warehouse', 'item', 'مخزون', 'مستودع', 'صنف', 'أصناف')) {
    const inv = docs.filter(d => d.module === 'inventory' || d.stage === 'fulfillment');
    const items = new Map<string, number>();
    inv.forEach(d => d.item && items.set(d.item, (items.get(d.item) ?? 0) + 1));
    return {
      text: T(lang, `${kpis.stockMoves} stock movement(s) completed; ${inv.filter(d => d.outcome === 'pending').length} document(s) are at the warehouse right now.`,
        `اكتملت ${kpis.stockMoves} حركة مخزون؛ و${inv.filter(d => d.outcome === 'pending').length} مستند في المستودع حالياً.`),
      bullets: [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}: ${v}`),
      link: { label: T(lang, 'Open Inventory', 'فتح المخزون'), route: '/m/inventory' },
    };
  }

  // --- bottlenecks / delays ---
  if (has('bottleneck', 'delay', 'stuck', 'slow', 'late', 'اختناق', 'تأخير', 'متأخر', 'عالق')) {
    if (kpis.bottlenecks.length === 0) return { text: T(lang, 'No open documents - nothing is stuck.', 'لا توجد مستندات مفتوحة - لا شيء عالق.') };
    return {
      text: T(lang, `Where open documents are waiting (average closed cycle time ${kpis.avgCycleHours.toFixed(1)} h):`, `أين تنتظر المستندات المفتوحة (متوسط زمن الإنجاز ${kpis.avgCycleHours.toFixed(1)} ساعة):`),
      bullets: kpis.bottlenecks.map(b => `${b.step}: ${b.count}`),
    };
  }

  // --- my requests / status ---
  if (has('my request', 'status', 'where is', 'track', 'طلبي', 'طلباتي', 'حالة', 'أين')) {
    const open = ctx.myDocs.filter(d => d.outcome === 'pending').slice(0, 5);
    if (open.length === 0) return { text: T(lang, 'You have no open requests.', 'ليس لديك طلبات مفتوحة.'), link: { label: T(lang, 'My Requests', 'طلباتي'), route: '/requests' } };
    return {
      text: T(lang, 'Your open requests:', 'طلباتك المفتوحة:'),
      bullets: open.map(d => `${d.docNo} · ${d.title} → ${stageName(d.stage)}${d.currentStep ? ` (${d.currentStep})` : ''}`),
      link: { label: T(lang, 'My Requests', 'طلباتي'), route: '/requests' },
    };
  }

  // --- summary / overview ---
  if (has('summary', 'overview', 'kpi', 'dashboard', 'today', 'report', 'ملخص', 'نظرة', 'مؤشرات', 'تقرير', 'اليوم')) {
    return summary(ctx.lang, kpis, money, modName);
  }

  // --- a specific module by name ---
  const mod = MODULES.find(m => q.includes(m.key) || q.includes(MODULE_NAMES[m.key][1]));
  if (mod) {
    const s = kpis.byModule[mod.key];
    return {
      text: T(lang, `${modName(mod.key)}: ${s.count} document(s), ${s.open} open, ${money(s.amount)} in value.`, `${modName(mod.key)}: ${s.count} مستند، ${s.open} مفتوح، بقيمة ${money(s.amount)}.`),
      link: { label: modName(mod.key), route: `/m/${mod.key}` },
    };
  }

  return summary(lang, kpis, money, modName, true);
}

function summary(lang: Lang, k: ErpKpis, money: (n: number) => string, modName: (m: ModuleKey) => string, fallback = false): AssistantReply {
  return {
    text: fallback
      ? T(lang, "I couldn't match that exactly, so here's the business snapshot. Try one of the suggestions below.", 'لم أتمكن من فهم السؤال تماماً، إليك لمحة عن الأعمال. جرّب أحد الاقتراحات أدناه.')
      : T(lang, 'Business snapshot:', 'لمحة عن الأعمال:'),
    bullets: [
      T(lang, `Open documents: ${k.openDocs} · closed: ${k.closedDocs}`, `المستندات المفتوحة: ${k.openDocs} · المغلقة: ${k.closedDocs}`),
      T(lang, `Sales booked: ${money(k.salesBooked)} · pipeline: ${money(k.salesPipeline)}`, `المبيعات: ${money(k.salesBooked)} · المفتوحة: ${money(k.salesPipeline)}`),
      T(lang, `Approved spend: ${money(k.spend)} · commitments: ${money(k.commitments)}`, `الإنفاق المعتمد: ${money(k.spend)} · الالتزامات: ${money(k.commitments)}`),
      T(lang, `Approval rate: ${(k.approvalRate * 100).toFixed(0)}% · avg cycle: ${k.avgCycleHours.toFixed(1)} h`, `نسبة الاعتماد: ${(k.approvalRate * 100).toFixed(0)}% · متوسط الإنجاز: ${k.avgCycleHours.toFixed(1)} ساعة`),
      ...MODULES.filter(m => k.byModule[m.key].count > 0).map(m => `${modName(m.key)}: ${k.byModule[m.key].count} (${k.byModule[m.key].open} ${T(lang, 'open', 'مفتوح')})`),
    ],
  };
}

function help(lang: Lang): AssistantReply {
  return {
    text: T(lang, `I'm your ERP assistant. I read the live data (all amounts in ${BASE_CURRENCY}) and can help with:`, `أنا مساعد نظام تخطيط الموارد. أقرأ البيانات الحية (المبالغ بـ ${BASE_CURRENCY}) ويمكنني المساعدة في:`),
    bullets: T(lang,
      'Your pending approvals and open requests|Sales, spend, receivables and payables|Inventory movements and bottlenecks|Next-month sales forecast|How to raise purchase requests, sales orders and approvals',
      'اعتماداتك المعلقة وطلباتك المفتوحة|المبيعات والإنفاق والذمم المدينة والدائنة|حركات المخزون والاختناقات|توقع مبيعات الشهر القادم|طريقة رفع طلبات الشراء وأوامر البيع والاعتماد').split('|'),
  };
}
