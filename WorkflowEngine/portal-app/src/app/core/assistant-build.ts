import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { I18nService } from './i18n.service';
import { CusDef, CusField, CusModule, CusType, CustomService } from '../custom/custom.service';
import { errMsg } from '../hr/hr-util';

/**
 * The "build" part of the assistant: create a module, add / remove / rename its fields, rename a module, delete a module, rename any
 * label on screen - from one typed sentence, entirely offline (no AI model, no internet): the sentence is read by the patterns below
 * and carried out through the normal custom-module API, so every privilege and validation of the server still applies.
 *
 *   create module Fleet with fields plate, model, year (number), service date (date), status (active / sold)
 *   أنشئ وحدة السيارات بحقول: الرقم، الموديل، السنة، تاريخ الصيانة
 *   create module visitors            (a ready-made field set is used when the name matches a template)
 *   add field Colour to Fleet  |  remove field Colour from Fleet  |  rename field Colour to Paint in Fleet
 *   make Plate optional in Fleet  |  rename module Fleet to Vehicles  |  delete module Fleet  (asks to confirm)
 *   rename Employees to Staff         (any text on screen; kept on this device)  |  reset names
 *
 * To teach it a new word, add it to the lists below (plain lower-case words, any language).
 */
export interface BuildReply { text: string; actions?: { label: string; route: any[]; queryParams?: Record<string, string> }[]; }

const MOD = '(?:modules?|وحدة|وحدات|module|modules|módulos?|moduls?|modul(?:e|o)?|ماڈیول)';
const FIELD = '(?:fields?|columns?|حقل|حقول|عمود|أعمدة|اعمدة|champs?|colonnes?|campos?|columnas?|felder?|spalten?|spalte|colonne|campi|فیلڈ|کالم)';
const CREATE = '(?:create|add|new|make|build|set up|setup|start|أنشئ|انشئ|أنشيء|أضف|اضف|اعمل|ابن|سوي|جديد|créer|crée|cree|ajoute|ajouter|nouveau|nouvelle|crear|crea|añade|añadir|agrega|nuevo|nueva|erstell\\w*|anlegen|hinzufüg\\w*|neu|aggiung\\w*|nuovo|nuova|بنائیں|شامل کریں|نیا|نئی)';
const REMOVE = '(?:remove|delete|drop|erase|احذف|أزل|ازل|امسح|supprim\\w*|retire\\w*|elimin\\w*|quita\\w*|lösch\\w*|entfern\\w*|rimuov\\w*|cancella|حذف کریں|ہٹائیں)';
const RENAME = '(?:rename|change the name of|change name of|call|غير اسم|غيّر اسم|بدل اسم|سمي|سمّي|أعد تسمية|اعد تسمية|renomm\\w*|renombr\\w*|umbenenn\\w*|rinomin\\w*|نام تبدیل کریں)';
const TO = '(?:to|into|as|إلى|الى|لـ|ل|à|en|a|zu|in|al|کو)';
const IN = '(?:to|in|into|on|from|of|إلى|الى|في|من|على|à|au|dans|de|du|a|en|zu|aus|von|da|nel|سے|میں)';
const WITH = '(?:with(?: the)?(?: fields?| columns?)?|having|containing|that has|which has|fields?|columns?|بحقول|بحقل|حقول|حقولها|الحقول|يحتوي على|تحتوي على|فيها|فيه|avec(?: les champs)?|champs|con(?: los campos| campos)?|campos|mit(?: den feldern| feldern)?|felder|con i campi|campi)';
const FOR = '(?:called|named|titled|for|about|to (?:manage|track|handle|record)|باسم|اسمها|اسمه|اسم|لإدارة|لتتبع|لـ|ل|عن|pour|appelé|para|llamado|für|namens|per|chiamato|کے لیے)';

/** ready-made field sets, picked when the module name contains one of the words */
interface Tpl { words: string[]; icon: string; color: string; fields: [string, string, CusType, string[]?][] }
const S_STATUS = ['Open', 'In progress', 'Closed'];
const TEMPLATES: Tpl[] = [
  { words: ['fleet', 'vehicle', 'car', 'truck', 'سيارات', 'سيارة', 'مركبات', 'أسطول', 'اسطول', 'flotte', 'véhicule', 'flota', 'fuhrpark', 'veicol'], icon: 'box', color: '#f97316',
    fields: [['Plate number', 'رقم اللوحة', 'text'], ['Make / model', 'الماركة / الموديل', 'text'], ['Year', 'السنة', 'number'], ['Driver', 'السائق', 'text'], ['Next service date', 'موعد الصيانة القادم', 'date'], ['Status', 'الحالة', 'select', ['Active', 'In service', 'Sold']]] },
  { words: ['visitor', 'guest', 'زوار', 'زائر', 'ضيوف', 'visiteur', 'visitante', 'besucher', 'visitatore'], icon: 'users', color: '#0ea5e9',
    fields: [['Visitor name', 'اسم الزائر', 'text'], ['Company', 'الشركة', 'text'], ['Phone', 'الجوال', 'phone'], ['Host', 'المضيف', 'text'], ['Visit date', 'تاريخ الزيارة', 'date'], ['Purpose', 'الغرض', 'textarea'], ['Status', 'الحالة', 'select', ['Expected', 'In', 'Out']]] },
  { words: ['complaint', 'ticket', 'support', 'issue', 'شكاوى', 'شكوى', 'بلاغات', 'تذاكر', 'réclamation', 'queja', 'reclamo', 'beschwerde'], icon: 'shield', color: '#ef4444',
    fields: [['Subject', 'الموضوع', 'text'], ['Customer', 'العميل', 'text'], ['Phone', 'الجوال', 'phone'], ['Priority', 'الأولوية', 'select', ['Low', 'Normal', 'High']], ['Details', 'التفاصيل', 'textarea'], ['Status', 'الحالة', 'select', S_STATUS]] },
  { words: ['asset', 'equipment', 'device', 'معدات', 'عهد', 'أصول', 'اصول', 'أجهزة', 'équipement', 'equipo', 'geräte', 'attrezzatur'], icon: 'settings', color: '#a16207',
    fields: [['Asset name', 'اسم الأصل', 'text'], ['Tag number', 'رقم العهدة', 'text'], ['Location', 'الموقع', 'text'], ['Assigned to', 'المسؤول', 'text'], ['Purchase date', 'تاريخ الشراء', 'date'], ['Value', 'القيمة', 'number'], ['Status', 'الحالة', 'select', ['In use', 'In store', 'Maintenance', 'Retired']]] },
  { words: ['contact', 'client', 'customer', 'directory', 'عملاء', 'جهات اتصال', 'دليل', 'contacts', 'clientes', 'kunden', 'clienti'], icon: 'users', color: '#8b5cf6',
    fields: [['Name', 'الاسم', 'text'], ['Phone', 'الجوال', 'phone'], ['Email', 'البريد الإلكتروني', 'email'], ['Company', 'الشركة', 'text'], ['Notes', 'ملاحظات', 'textarea']] },
  { words: ['expense', 'cost', 'مصروفات', 'مصاريف', 'نفقات', 'dépenses', 'gastos', 'ausgaben', 'spese'], icon: 'wallet', color: '#16a34a',
    fields: [['Description', 'الوصف', 'text'], ['Date', 'التاريخ', 'date'], ['Amount', 'المبلغ', 'number'], ['Paid', 'مدفوع', 'checkbox'], ['Notes', 'ملاحظات', 'textarea']] },
  { words: ['task', 'project', 'todo', 'مهام', 'مشاريع', 'مشروع', 'tâche', 'tarea', 'aufgabe', 'attivit'], icon: 'grid', color: '#6366f1',
    fields: [['Title', 'العنوان', 'text'], ['Owner', 'المسؤول', 'text'], ['Due date', 'تاريخ الاستحقاق', 'date'], ['Priority', 'الأولوية', 'select', ['Low', 'Normal', 'High']], ['Status', 'الحالة', 'select', ['To do', 'Doing', 'Done']], ['Notes', 'ملاحظات', 'textarea']] },
  { words: ['library', 'book', 'مكتبة', 'كتب', 'كتاب', 'bibliothèque', 'biblioteca', 'bibliothek'], icon: 'file', color: '#14b8a6',
    fields: [['Title', 'العنوان', 'text'], ['Author', 'المؤلف', 'text'], ['ISBN', 'ISBN', 'text'], ['Copies', 'النسخ', 'number'], ['Status', 'الحالة', 'select', ['Available', 'Borrowed', 'Lost']]] },
  { words: ['training', 'course', 'تدريب', 'دورات', 'دورة', 'formation', 'curso', 'schulung', 'corso'], icon: 'layers', color: '#db2777',
    fields: [['Course', 'الدورة', 'text'], ['Trainer', 'المدرب', 'text'], ['Start date', 'تاريخ البدء', 'date'], ['Hours', 'الساعات', 'number'], ['Notes', 'ملاحظات', 'textarea']] },
];
const GENERIC: Tpl['fields'] = [['Name', 'الاسم', 'text'], ['Date', 'التاريخ', 'date'], ['Status', 'الحالة', 'select', S_STATUS], ['Notes', 'ملاحظات', 'textarea']];
const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#16a34a', '#f97316', '#ef4444', '#8b5cf6', '#db2777'];

/** field-type words in a field name / explicit type */
const TYPE_WORDS: Record<CusType, string[]> = {
  date: ['date', 'day', 'deadline', 'expiry', 'dob', 'birthday', 'تاريخ', 'يوم', 'موعد', 'fecha', 'datum', 'data', 'تاریخ'],
  number: ['amount', 'price', 'cost', 'qty', 'quantity', 'total', 'salary', 'age', 'year', 'count', 'km', 'weight', 'hours', 'سعر', 'مبلغ', 'كمية', 'عدد', 'قيمة', 'تكلفة', 'راتب', 'سنة', 'عمر', 'ساعات', 'prix', 'montant', 'cantidad', 'precio', 'preis', 'menge', 'importo', 'prezzo'],
  email: ['email', 'e-mail', 'mail', 'بريد', 'correo'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'جوال', 'هاتف', 'موبايل', 'جوّال', 'teléfono', 'telefon', 'cell'],
  textarea: ['notes', 'note', 'description', 'details', 'comment', 'comments', 'remarks', 'address', 'ملاحظات', 'وصف', 'تفاصيل', 'تعليق', 'عنوان العميل', 'adresse', 'dirección'],
  checkbox: ['yes/no', 'checkbox', 'tick', 'نعم/لا', 'نعم / لا', 'خانة اختيار', 'paid', 'مدفوع'],
  select: ['list', 'select', 'dropdown', 'choice', 'قائمة', 'اختيار'],
  text: ['text', 'نص'],
};
const SELECT_DEFAULT: { words: string[]; en: string[]; ar: string[] }[] = [
  { words: ['status', 'state', 'حالة', 'statut', 'estado', 'stato', 'zustand'], en: ['Open', 'In progress', 'Closed'], ar: ['مفتوح', 'قيد التنفيذ', 'مغلق'] },
  { words: ['priority', 'أولوية', 'اولوية', 'priorité', 'prioridad', 'priorität', 'priorità'], en: ['Low', 'Normal', 'High'], ar: ['منخفضة', 'عادية', 'مرتفعة'] },
];

const AR = /[؀-ۿ]/;
const strip = (s: string) => s.replace(/[ً-ٟـ]/g, '');
const lc = (s: string) => strip(s).toLowerCase().replace(/^(?:the |al-|ال)/, '').trim();
const re = (src: string, flags = 'i') => new RegExp(src, flags);
const clean = (s: string) => s.replace(/^["'“”«»`]+|["'“”«»`.!؟?]+$/g, '').replace(/^(?:the|a|an|my|our|ال)\s+/i, '').trim();
const cap = (s: string) => (AR.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1));

export class BuildEngine {
  private pending: { kind: 'delete'; key: string; title: string } | null = null;

  constructor(private svc: CustomService, private i18n: I18nService, private router: Router, private auth: AuthService) {}
  private t = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);
  private ar = () => this.i18n.lang() === 'ar';

  /** null when the sentence is not a build request (the other assistant intents then run) */
  handle(raw0: string): Promise<BuildReply> | BuildReply | null {
    const raw = strip(raw0.trim());
    const q = raw.toLowerCase();

    if (this.pending) {
      const p = this.pending; this.pending = null;
      if (/^(?:yes|y|ok|okay|confirm|sure|نعم|أكيد|اكيد|تأكيد|تمام|oui|sí|si|ja|sì|جی|ہاں)\b/i.test(q) || q === 'نعم') return this.doDelete(p.key, p.title);
      if (/^(?:no|n|cancel|stop|لا|إلغاء|الغاء|non|nein|نہیں)\b/i.test(q)) return { text: this.t('ai.b.cancelled') };
    }

    if (re(`^(?:reset|restore|clear|أعد|اعد|إعادة|اعادة)\\s+(?:all\\s+)?(?:the\\s+)?(?:names|labels|renamed|الأسماء|الاسماء|التسميات)`).test(q) || /(?:reset|restore).*(?:names|labels)/.test(q) || /(?:إعادة|اعادة|أعد|اعد).*(?:الأسماء|الاسماء|التسميات)/.test(q)) {
      this.i18n.clearOverrides(); return { text: this.t('ai.b.labelsReset') };
    }

    const hasMod = re(`(?:^|\\s)${MOD}(?:\\s|$|:|،)`).test(q);
    const hasField = re(`(?:^|\\s)${FIELD}(?:\\s|$|:|،)`).test(q);

    // ---- list my custom modules / what can you build
    if (re(`(?:list|show|what|which|my|قائمة|اعرض|عرض|ما هي|وحداتي|liste|lista)\\s.*${MOD}`).test(q) && !re(`${CREATE}\\s`).test(q) && !re(`${REMOVE}\\s`).test(q) && !re(`${RENAME}\\s`).test(q) && !/ (?:for|with|بحقول|ل\w+) /.test(q)) {
      const l = this.svc.modules();
      return { text: l.length ? this.t('ai.b.list', { list: l.map(m => this.svc.title(m)).join(this.i18n.isRtl ? '، ' : ', ') }) : this.t('ai.b.noModules'),
        actions: l.length ? [{ label: this.t('module.custom'), route: ['/custom'] }] : undefined };
    }

    // ---- delete module
    if (hasMod && !hasField && re(`^${REMOVE}\\s`).test(q)) {
      const name = clean(raw.replace(re(`^${REMOVE}\\s+(?:the\\s+|هذه\\s+)?${MOD}\\s*`), ''));
      return this.guard(() => {
        const m = this.find(name); if (!m) return this.noModule(name);
        this.pending = { kind: 'delete', key: m.key, title: this.svc.title(m) };
        return this.svc.records(m.key).toPromise().then(r => ({ text: this.t('ai.b.confirmDelete', { m: this.svc.title(m), n: r?.length ?? 0 }) })).catch(() => ({ text: this.t('ai.b.confirmDelete', { m: this.svc.title(m), n: '?' }) }));
      });
    }

    // ---- rename (module, field, or any label on screen)
    const rn = raw.match(re(`^${RENAME}\\s+(?:the\\s+)?(?:(${MOD}|${FIELD})\\s+)?(.+?)\\s+${TO}\\s+(.+)$`));
    if (rn) {
      const what = rn[1]?.toLowerCase() ?? ''; const a = clean(rn[2]); let b = clean(rn[3]); let scope = '';
      const inM = b.match(re(`^(.+?)\\s+${IN}\\s+(?:the\\s+)?(?:${MOD}\\s+)?(.+)$`)); if (inM) { b = clean(inM[1]); scope = clean(inM[2]); }
      const isField = re(`^${FIELD}$`).test(what), isMod = re(`^${MOD}$`).test(what);
      if (isMod || (!isField && this.find(a) && !this.fieldIn(this.currentModule(scope), a))) return this.guard(() => this.renameModule(a, b));
      if (isField || this.fieldIn(this.currentModule(scope), a)) return this.guard(() => this.renameField(a, b, scope));
      if (!hasMod && !hasField) return this.renameLabel(a, b);
    }

    // ---- make a field required / optional
    const rq = raw.match(re(`^(?:make|set|جعل|اجعل|اجعلي)\\s+(?:the\\s+)?(?:${FIELD}\\s+)?(.+?)\\s+(?:${FIELD}\\s+)?(required|mandatory|optional|إلزامي|الزامي|مطلوب|اختياري)(?:\\s+${IN}\\s+(?:the\\s+)?(?:${MOD}\\s+)?(.+))?$`));
    if (rq) return this.guard(() => this.setRequired(clean(rq[1]), !/optional|اختياري/i.test(rq[2]), rq[3] ? clean(rq[3]) : ''));

    // ---- remove field
    if (hasField && re(`^${REMOVE}\\s`).test(q)) {
      const m = raw.match(re(`^${REMOVE}\\s+(?:the\\s+|هذا\\s+)?(?:${FIELD}\\s+)?(.+?)(?:\\s+${FIELD})?(?:\\s+${IN}\\s+(?:the\\s+)?(?:${MOD}\\s+)?(.+))?$`));
      if (m) return this.guard(() => this.removeField(clean(m[1]), m[2] ? clean(m[2]) : ''));
    }

    // ---- add field(s)
    if (hasField && re(`^(?:${FIELD}\\s+)?${CREATE}\\s`).test(q) && !hasMod) {
      const m = raw.match(re(`^(?:${FIELD}\\s+)?${CREATE}\\s+(?:a\\s+|an\\s+|new\\s+|another\\s+|جديد\\s+)*(?:${FIELD}\\s+)?(.+?)(?:\\s+${FIELD})?(?:\\s+${IN}\\s+(?:the\\s+)?(?:${MOD}\\s+)?(.+))?$`));
      if (m) return this.guard(() => this.addFields(this.parseFields(m[1]), m[2] ? clean(m[2]) : ''));
    }

    // ---- create module
    if (hasMod && re(`(?:^|\\s)${CREATE}(?:\\s|:|،|$)`).test(q) && !re(`^${REMOVE}\\s`).test(q)) {
      const after = raw.replace(re(`^.*?(?:^|\\s)${MOD}\\s*`), '');
      let name = after, fields = '';
      const w = after.match(re(`(?:^|\\s|:|،)${WITH}(?:\\s*:|\\s+|$)`));
      if (w && w.index !== undefined) { name = after.slice(0, w.index); fields = after.slice(w.index + w[0].length); }
      else if (after.includes(':')) { const i = after.indexOf(':'); name = after.slice(0, i); fields = after.slice(i + 1); }
      name = clean(name.replace(re(`(?:^|\\s)${CREATE}(?=\\s|:|،|$)`, 'gi'), ' ').replace(re(`^\\s*(?:${FOR})\\s+`), '').replace(re(`^(?:${FOR})\\s+`), '').replace(/\s+(?:module|وحدة)$/i, ''));
      if (!name) return { text: this.t('ai.b.needName') };
      return this.guard(() => this.createModule(name, fields));
    }

    // ---- open a custom module by name
    const op = raw.match(re(`^(?:open|go to|goto|show|افتح|اذهب إلى|اذهب الى|اعرض|ouvre\\w*|abre|öffne|apri)\\s+(?:the\\s+)?(?:${MOD}\\s+)?(.+)$`));
    if (op && this.svc.modules().length) {
      const m = this.find(clean(op[1]));
      if (m) return { text: this.t('ai.b.open', { m: this.svc.title(m) }), actions: [{ label: this.svc.title(m), route: ['/custom', m.key] }] };
    }
    return null;
  }

  // ------------------------------------------------------------------ helpers

  private guard(fn: () => Promise<BuildReply> | BuildReply): Promise<BuildReply> | BuildReply {
    if (!this.auth.can('cus.design')) return { text: this.t('ai.b.noRight') };
    try { return Promise.resolve(fn()).catch(e => ({ text: this.t('ai.b.failed', { e: errMsg(e, this.i18n) }) })); }
    catch (e) { return { text: this.t('ai.b.failed', { e: String(e) }) }; }
  }
  private noModule(name: string): BuildReply {
    const l = this.svc.modules();
    return { text: l.length ? this.t('ai.b.noModule', { m: name, list: l.map(m => this.svc.title(m)).join(', ') }) : this.t('ai.b.noModules') };
  }
  private find(name: string): CusModule | undefined {
    const n = lc(name); if (!n) return undefined;
    const l = this.svc.modules().map(m => ({ m, names: [m.def.title, m.def.titleAr ?? '', m.key].map(x => lc(x)).filter(x => x) }));
    return (l.find(x => x.names.includes(n)) ?? l.find(x => x.names.some(y => y.includes(n) || n.includes(y))))?.m;
  }
  /** the module named in the sentence, else the one open on screen */
  private currentModule(name: string): CusModule | undefined {
    if (name) return this.find(name);
    const m = this.router.url.match(/^\/custom\/([^/?#]+)/); return m ? this.svc.get(decodeURIComponent(m[1])) : undefined;
  }
  private fieldIn(m: CusModule | undefined, name: string): CusField | undefined {
    const n = lc(name); if (!m || !n) return undefined;
    return m.def.fields.find(f => lc(f.label) === n || lc(f.labelAr ?? '') === n) ?? m.def.fields.find(f => lc(f.label).includes(n) || (f.labelAr && lc(f.labelAr).includes(n)) || n.includes(lc(f.label)));
  }

  /** "plate, model, year (number), status (open / closed)" -> fields */
  private parseFields(text: string): CusField[] {
    const protectedText = text.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_m, a, b) => '(' + (a ?? b).replace(/[,،;]/g, '\u0001') + ')');
    const parts = protectedText.split(re('[,،;؛\\n]|\\s+(?:and|و|et|y|und|e|اور)\\s+', 'gi')).map(s => s.replace(/\u0001/g, ',').trim()).filter(Boolean);
    const out: CusField[] = [];
    for (const p0 of parts) {
      let name = p0, type: CusType | null = null; let options: string[] | undefined;
      const par = p0.match(/^(.*?)\s*\((.*)\)\s*$/) ?? p0.match(/^(.*?)\s*[:\-–]\s*(.+)$/);
      if (par) {
        name = par[1]; const inner = par[2].trim(); const il = inner.toLowerCase().replace(/^(?:list|select|قائمة)\s*[:\-]?\s*/, '');
        const t = (Object.keys(TYPE_WORDS) as CusType[]).find(k => TYPE_WORDS[k].includes(il));
        if (t) type = t;
        else if (/[,/|]/.test(il) || /^(?:list|select|قائمة)/i.test(inner)) { options = il.split(/[,/|،]/).map(s => cap(s.trim())).filter(Boolean); type = 'select'; }
      }
      name = clean(name.replace(re(`^(?:${FIELD})\\s+`), '').replace(re(`\\s+(?:${FIELD})$`), ''));
      if (!name) continue;
      const nl = name.toLowerCase();
      if (!type) {
        for (const k of ['email', 'phone', 'date', 'textarea', 'number', 'checkbox'] as CusType[]) { if (TYPE_WORDS[k].some(w => new RegExp(`(?:^|[\\s/])${w.replace(/[/-]/g, '\\$&')}(?:$|[\\s/])`).test(nl) || (AR.test(w) && nl.includes(w)))) { type = k; break; } }
        const sd = SELECT_DEFAULT.find(s => s.words.some(w => nl.includes(w)));
        if (!type && sd) { type = 'select'; options = AR.test(name) ? sd.ar : sd.en; }
      }
      out.push({ key: '', label: cap(name), labelAr: AR.test(name) ? name : null, type: type ?? 'text', required: false, ...(options ? { options } : {}) });
    }
    return out;
  }

  private tplFor(name: string): Tpl | undefined { const n = name.toLowerCase(); return TEMPLATES.find(t => t.words.some(w => n.includes(w))); }

  private async createModule(name: string, fieldText: string): Promise<BuildReply> {
    if (this.find(name) && lc(this.svc.title(this.find(name)!)) === lc(name)) return { text: this.t('ai.b.exists', { m: name }) };
    let fields = fieldText.trim() ? this.parseFields(fieldText) : [];
    let tpl = this.tplFor(name);
    if (!fields.length) fields = (tpl?.fields ?? GENERIC).map(([en, ar, type, opts]) => ({ key: '', label: en, labelAr: ar, type, required: false, ...(opts ? { options: opts } : {}) }));
    if (fields.length) fields[0].required = true;
    if (fieldText.trim()) tpl = undefined;
    const def: CusDef = { title: cap(name), titleAr: AR.test(name) ? name : null, icon: tpl?.icon ?? 'grid', color: tpl?.color ?? COLORS[this.svc.modules().length % COLORS.length], fields };
    const m = await firstValueFrom(this.svc.create(def));
    return { text: this.t('ai.b.created', { m: this.svc.title(m), n: m.def.fields.length, f: m.def.fields.map(f => this.svc.label(f)).join(this.i18n.isRtl ? '، ' : ', ') }), actions: [{ label: this.svc.title(m), route: ['/custom', m.key] }] };
  }

  private async mutate(m: CusModule, fn: (d: CusDef) => void): Promise<CusModule> {
    const d: CusDef = JSON.parse(JSON.stringify(m.def)); fn(d); return firstValueFrom(this.svc.update(m.key, d));
  }
  private async addFields(fields: CusField[], target: string): Promise<BuildReply> {
    const m = this.currentModule(target); if (!m) return target ? this.noModule(target) : { text: this.t('ai.b.needTarget') };
    if (!fields.length) return { text: this.t('ai.b.needTarget') };
    const fresh = fields.filter(f => !this.fieldIn(m, f.label) || lc(this.fieldIn(m, f.label)!.label) !== lc(f.label));
    if (!fresh.length) return { text: this.t('ai.b.fieldExists', { f: fields[0].label, m: this.svc.title(m) }) };
    const r = await this.mutate(m, d => d.fields.push(...fresh));
    return { text: this.t('ai.b.fieldAdded', { f: fresh.map(f => f.label).join(', '), m: this.svc.title(r) }), actions: [{ label: this.svc.title(r), route: ['/custom', r.key] }] };
  }
  private async removeField(name: string, target: string): Promise<BuildReply> {
    const m = this.currentModule(target); if (!m) return target ? this.noModule(target) : { text: this.t('ai.b.needTarget') };
    const f = this.fieldIn(m, name); if (!f) return { text: this.t('ai.b.fieldNone', { f: name, m: this.svc.title(m), list: m.def.fields.map(x => this.svc.label(x)).join(', ') }) };
    if (m.def.fields.length <= 1) return { text: this.t('ai.b.lastField') };
    const r = await this.mutate(m, d => { d.fields = d.fields.filter(x => x.key !== f.key); });
    return { text: this.t('ai.b.fieldRemoved', { f: this.svc.label(f), m: this.svc.title(r) }), actions: [{ label: this.svc.title(r), route: ['/custom', r.key] }] };
  }
  private async renameField(a: string, b: string, target: string): Promise<BuildReply> {
    const m = this.currentModule(target); if (!m) return target ? this.noModule(target) : { text: this.t('ai.b.needTarget') };
    const f = this.fieldIn(m, a); if (!f) return { text: this.t('ai.b.fieldNone', { f: a, m: this.svc.title(m), list: m.def.fields.map(x => this.svc.label(x)).join(', ') }) };
    await this.mutate(m, d => { const x = d.fields.find(y => y.key === f.key)!; x.label = cap(b); x.labelAr = AR.test(b) ? b : x.labelAr; });
    return { text: this.t('ai.b.fieldRenamed', { a: this.svc.label(f), b, m: this.svc.title(m) }) };
  }
  private async setRequired(name: string, req: boolean, target: string): Promise<BuildReply> {
    const m = this.currentModule(target); if (!m) return target ? this.noModule(target) : { text: this.t('ai.b.needTarget') };
    const f = this.fieldIn(m, name); if (!f) return { text: this.t('ai.b.fieldNone', { f: name, m: this.svc.title(m), list: m.def.fields.map(x => this.svc.label(x)).join(', ') }) };
    await this.mutate(m, d => { d.fields.find(y => y.key === f.key)!.required = req; });
    return { text: this.t('ai.b.fieldReq', { f: this.svc.label(f), m: this.svc.title(m), s: this.t(req ? 'ai.b.required' : 'ai.b.optional') }) };
  }
  private async renameModule(a: string, b: string): Promise<BuildReply> {
    const m = this.find(a); if (!m) return this.noModule(a);
    const old = this.svc.title(m);
    await this.mutate(m, d => { d.title = cap(b); if (AR.test(b)) d.titleAr = b; });
    return { text: this.t('ai.b.modRenamed', { a: old, b }) };
  }
  private async doDelete(key: string, title: string): Promise<BuildReply> {
    if (!this.auth.can('cus.design')) return { text: this.t('ai.b.noRight') };
    try { await firstValueFrom(this.svc.remove(key)); } catch (e) { return { text: this.t('ai.b.failed', { e: errMsg(e, this.i18n) }) }; }
    if (this.router.url.startsWith('/custom/' + key)) void this.router.navigate(['/custom']);
    return { text: this.t('ai.b.deleted', { m: title }) };
  }

  /** "rename Employees to Staff": every screen label that currently reads exactly like the first text is shown as the second, on this device */
  private renameLabel(a: string, b: string): BuildReply {
    const n = this.i18n.renameText(a, b);
    return n ? { text: this.t('ai.b.labelRenamed', { a, b }) } : { text: this.t('ai.b.labelNone', { a }) };
  }
}
