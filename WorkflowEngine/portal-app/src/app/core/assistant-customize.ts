import { Router } from '@angular/router';
import { AppearanceService, FONTS, Look, ACCENTS } from './appearance.service';
import { I18nService, Lang } from './i18n.service';
import { LayoutService, LayoutSnapshot } from './layout.service';
import { MODULES } from './erp.config';
import { AuthService } from './auth.service';

/**
 * The "customize my screen" part of the AI assistant.
 *
 * The assistant understands requests such as
 *   "make it dark", "use teal", "bigger text", "compact tables", "round corners", "use Cairo font", "switch to French",
 *   "hide the KPI cards", "show the trend chart again", "remove Sales from the menu", "reset my layout", "undo",
 *   "edit employee E1003", "new journal", "import employees".
 * It only changes this user's own preferences (stored in this browser) or opens the screen where the change is made - so it
 * never bypasses a privilege: opening an edit screen still goes through that page's permission guard and the server checks.
 *
 * All trigger words are plain lower-case substrings per language; add a word to a list to teach the assistant a new phrase.
 */
export interface CustomizeAction { label: string; route: any[]; queryParams?: Record<string, string>; }
export interface CustomizeReply { text: string; actions?: CustomizeAction[]; }

const has = (q: string, words: string[]) => words.some(w => q.includes(w));
/** whole-word match for short latin words ("red", "size") so they do not fire inside other words */
const hasWord = (q: string, words: string[]) => words.some(w => new RegExp(`(^|[^a-z0-9])${w}($|[^a-z0-9])`).test(q));

const W = {
  hide: ['hide', 'remove', 'turn off', 'get rid', 'أخف', 'اخف', 'إخفاء', 'اخفاء', 'احذف', 'أزل', 'ازل', 'masqu', 'cache', 'retire', 'supprim', 'ocult', 'quita', 'elimin', 'ausblend', 'verberg', 'entfern', 'nascond', 'rimuov', 'togli', 'چھپا', 'ہٹا'],
  show: ['show', 'display', 'bring back', 'restore', 'unhide', 'turn on', 'أظهر', 'اظهر', 'إظهار', 'اعرض', 'أعد', 'afficher', 'montre', 'rétabl', 'mostr', 'muestra', 'anzeig', 'zeig', 'einblend', 'mostra', 'visualizz', 'دکھا', 'واپس'],
  reset: ['reset', 'default', 'factory', 'original', 'إعادة ضبط', 'اعادة ضبط', 'افتراضي', 'الأصل', 'réinitialis', 'défaut', 'par défaut', 'restablec', 'predeterminad', 'por defecto', 'zurücksetz', 'standard', 'ripristin', 'predefinit', 'ری سیٹ', 'ڈیفالٹ'],
  undo: ['undo', 'revert', 'go back', 'تراجع', 'تراجع عن', 'annul', 'revenir', 'deshac', 'rückgängig', 'zurück', 'annulla', 'torna indietro', 'واپس کر', 'کالعدم'],
  all: ['everything', 'all ', 'كل', 'جميع', 'tout', 'todo', 'todas', 'alles', 'alle', 'tutto', 'tutti', 'سب', 'تمام'],
  look: ['look', 'theme', 'appearance', 'colour', 'color', 'layout', 'screen', 'مظهر', 'سمة', 'ثيم', 'تخطيط', 'شاشة', 'apparence', 'thème', 'mise en page', 'écran', 'apariencia', 'tema', 'diseño', 'pantalla', 'aussehen', 'design', 'layout', 'bildschirm', 'aspetto', 'tema', 'schermo', 'ظاہری', 'تھیم', 'اسکرین'],
  dark: ['dark', 'night', 'داكن', 'ليلي', 'الوضع الليلي', 'أسود', 'sombre', 'nuit', 'oscuro', 'noche', 'dunkel', 'nacht', 'scuro', 'notte', 'ڈارک', 'اندھیرا', 'رات'],
  light: ['light', 'bright', 'day mode', 'فاتح', 'نهاري', 'الوضع النهاري', 'clair', 'claro', 'hell', 'chiaro', 'روشن', 'لائٹ'],
  system: ['auto theme', 'system theme', 'follow system', 'تلقائي', 'automatique', 'automático', 'automatisch', 'automatico', 'خودکار'],
  sidebar: ['sidebar', 'side bar', 'side menu', 'navigation bar', 'القائمة الجانبية', 'الشريط الجانبي', 'barre latérale', 'menu latéral', 'barra lateral', 'seitenleiste', 'seitenmenü', 'barra laterale', 'سائیڈ بار', 'سائڈ بار'],
  menu: ['menu', 'navigation', 'القائمة', 'قائمة', 'menú', 'menü', 'menù', 'مینو'],
  colorCtx: ['colour', 'color', 'accent', 'theme', 'primary', 'use ', 'make it', 'لون', 'ألوان', 'اللون', 'ثيم', 'couleur', 'accent', 'thème', 'utilise', 'rends', 'tema', 'usa ', 'farbe', 'akzent', 'verwende', 'colore', 'usa', 'رنگ', 'استعمال'],
  font: ['font', 'typeface', 'خط', 'الخط', 'نوع الخط', 'police', 'fuente', 'tipografía', 'schrift', 'schriftart', 'carattere', 'font', 'فونٹ', 'خط'],
  textCtx: ['text', 'font', 'size', 'letters', 'writing', 'نص', 'الخط', 'حجم', 'الكتابة', 'texte', 'police', 'taille', 'texto', 'tamaño', 'letra', 'text', 'schrift', 'größe', 'testo', 'dimensione', 'carattere', 'متن', 'سائز', 'فونٹ'],
  bigger: ['bigger', 'larger', 'increase', 'enlarge', 'zoom in', 'big', 'أكبر', 'اكبر', 'كبر', 'كبّر', 'زد', 'تكبير', 'plus grand', 'agrand', 'augment', 'más grande', 'mayor', 'agranda', 'aumenta', 'größer', 'vergrößer', 'erhöh', 'più grande', 'ingrandisc', 'aumenta', 'بڑا', 'بڑھا'],
  smaller: ['smaller', 'decrease', 'reduce', 'shrink', 'zoom out', 'small', 'أصغر', 'اصغر', 'صغر', 'صغّر', 'قلل', 'تصغير', 'plus petit', 'réduis', 'diminu', 'más pequeñ', 'menor', 'reduce', 'kleiner', 'verkleiner', 'reduzier', 'più piccolo', 'riduc', 'rimpicciol', 'چھوٹا', 'کم کر'],
  compact: ['compact', 'dense', 'tight', 'مضغوط', 'مدمج', 'كثيف', 'compacto', 'kompakt', 'compatto', 'کمپیکٹ', 'تنگ'],
  comfortable: ['comfortable', 'spacious', 'roomy', 'relaxed', 'مريح', 'واسع', 'مريحة', 'spacieux', 'confortable', 'cómodo', 'espacioso', 'komfortabel', 'geräumig', 'comodo', 'spazioso', 'آرام دہ', 'کشادہ'],
  sharp: ['sharp', 'square', 'angular', 'حاد', 'مربع', 'حادة', 'carré', 'anguleux', 'cuadrad', 'eckig', 'quadrat', 'squadrat', 'spigolos', 'چوکور', 'نوکیلا'],
  round: ['round', 'circular', 'pill', 'مستدير', 'دائري', 'دائرية', 'arrondi', 'rond', 'redondead', 'redond', 'rund', 'abgerundet', 'arrotondat', 'tond', 'گول'],
  soft: ['soft', 'smooth', 'ناعم', 'ناعمة', 'doux', 'suave', 'weich', 'morbid', 'نرم'],
  language: ['language', 'langue', 'idioma', 'sprache', 'lingua', 'لغة', 'اللغة', 'زبان'],
  switchV: ['switch', 'change', 'set', 'speak', 'translate', 'use', 'tbaddel', 'غيّر', 'غير', 'بدل', 'حول', 'تحويل', 'passe', 'changer', 'cambia', 'wechsel', 'ändere', 'cambia', 'passa', 'بدلیں', 'تبدیل'],
  edit: ['edit', 'modify', 'update', 'change details', 'تعديل', 'عدّل', 'عدل', 'حرر', 'modifier', 'éditer', 'mettre à jour', 'editar', 'modificar', 'actualiz', 'bearbeit', 'ändern', 'aktualisier', 'modific', 'aggiorn', 'ترمیم', 'تبدیل کر'],
  add: ['add ', 'new ', 'create', 'register', 'enter ', 'أضف', 'اضف', 'إضافة', 'اضافة', 'جديد', 'أنشئ', 'انشئ', 'ajoute', 'nouveau', 'nouvelle', 'créer', 'añad', 'agrega', 'nuevo', 'nueva', 'crear', 'hinzufüg', 'neu', 'erstell', 'anlegen', 'aggiung', 'nuovo', 'nuova', 'crea', 'شامل', 'نیا', 'نئی', 'بنائیں'],
  importV: ['import', 'upload', 'bulk', 'استيراد', 'استورد', 'رفع', 'importer', 'importar', 'carga', 'importier', 'hochlad', 'importa', 'carica', 'امپورٹ', 'اپ لوڈ'],
};

const LANG_NAMES: { code: Lang; words: string[] }[] = [
  { code: 'en', words: ['english', 'الإنجليزية', 'الانجليزية', 'انجليزي', 'anglais', 'inglés', 'ingles', 'englisch', 'inglese', 'انگریزی'] },
  { code: 'ar', words: ['arabic', 'العربية', 'عربي', 'arabe', 'árabe', 'arabisch', 'arabo', 'عربی'] },
  { code: 'fr', words: ['french', 'الفرنسية', 'فرنسي', 'français', 'francais', 'francés', 'frances', 'französisch', 'francese', 'فرانسیسی'] },
  { code: 'es', words: ['spanish', 'الإسبانية', 'الاسبانية', 'إسباني', 'espagnol', 'español', 'espanol', 'spanisch', 'spagnolo', 'ہسپانوی'] },
  { code: 'ur', words: ['urdu', 'الأردية', 'الاردية', 'أردو', 'اردو', 'ourdou', 'urdú'] },
  { code: 'de', words: ['german', 'الألمانية', 'الالمانية', 'ألماني', 'allemand', 'alemán', 'aleman', 'deutsch', 'tedesco', 'جرمن'] },
  { code: 'it', words: ['italian', 'الإيطالية', 'الايطالية', 'إيطالي', 'italien', 'italiano', 'italienisch', 'اطالوی', 'اطالوی'] },
];

const COLORS: { hex: string; words: string[]; latin: string[] }[] = [
  { hex: ACCENTS[0], latin: ['indigo'], words: ['نيلي', 'indigo', 'índigo', 'انڈیگو'] },
  { hex: ACCENTS[1], latin: ['blue'], words: ['أزرق', 'ازرق', 'bleu', 'azul', 'blau', 'blu', 'نیلا'] },
  { hex: ACCENTS[2], latin: ['teal', 'turquoise', 'cyan'], words: ['تركوازي', 'فيروزي', 'sarcelle', 'turquoise', 'turquesa', 'türkis', 'turchese', 'فیروزی'] },
  { hex: ACCENTS[3], latin: ['green'], words: ['أخضر', 'اخضر', 'vert', 'verde', 'grün', 'سبز'] },
  { hex: ACCENTS[4], latin: ['orange'], words: ['برتقالي', 'orange', 'naranja', 'arancione', 'نارنجی'] },
  { hex: ACCENTS[5], latin: ['red', 'rose', 'pink', 'crimson'], words: ['أحمر', 'احمر', 'وردي', 'rouge', 'rojo', 'rosso', 'rot', 'لال', 'سرخ', 'گلابی'] },
  { hex: ACCENTS[6], latin: ['purple', 'violet'], words: ['بنفسجي', 'أرجواني', 'violet', 'morado', 'púrpura', 'lila', 'viola', 'lila', 'جامنی', 'بنفشی'] },
  { hex: ACCENTS[7], latin: ['slate', 'grey', 'gray'], words: ['رمادي', 'gris', 'grau', 'grigio', 'سرمئی', 'خاکستری'] },
];

const SIZES: Look['size'][] = ['s', 'm', 'l', 'xl'];

function norm(s: string) { return s.toLowerCase().replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim(); }

export interface EditTarget { id: string; words: string[]; route: any[]; withId?: boolean; need?: string; }
/** Screens the assistant can open for "add / edit / import". `need` = a privilege the user must have for the assistant to offer it. */
export const EDIT_TARGETS: EditTarget[] = [
  { id: 'employee', words: ['employee', 'staff', 'موظف', 'الموظف', 'employé', 'empleado', 'mitarbeiter', 'dipendente', 'ملازم'], route: ['/hr/employees'], withId: true, need: 'hr.employees.manage' },
  { id: 'journal', words: ['journal', 'قيد', 'écriture', 'asiento', 'buchung', 'scrittura', 'جرنل', 'اندراج'], route: ['/finance/gl'], need: 'finance.gl.manage' },
  { id: 'apinvoice', words: ['supplier invoice', 'vendor invoice', 'vendor bill', 'bill', 'payable', 'فاتورة مورد', 'فاتورة المورد', 'facture fournisseur', 'factura de proveedor', 'lieferantenrechnung', 'fattura fornitore', 'سپلائر انوائس'], route: ['/finance/payables'], need: 'finance.ap.manage' },
  { id: 'arinvoice', words: ['customer invoice', 'sales invoice', 'receivable', 'فاتورة عميل', 'فاتورة مبيعات', 'facture client', 'factura de cliente', 'kundenrechnung', 'fattura cliente', 'کسٹمر انوائس'], route: ['/finance/receivables'], need: 'finance.ar.manage' },
  { id: 'budget', words: ['budget', 'ميزانية', 'presupuesto', 'haushalt', 'bilancio preventivo', 'بجٹ'], route: ['/finance/budgets'], need: 'finance.budget.manage' },
  { id: 'asset', words: ['fixed asset', 'asset', 'أصل', 'الأصول', 'immobilisation', 'activo', 'anlage', 'cespite', 'اثاثہ'], route: ['/finance/assets'], need: 'finance.assets.manage' },
];

export class CustomizeEngine {
  private history: { look: Look; layout: LayoutSnapshot }[] = [];

  constructor(private look: AppearanceService, private layout: LayoutService, private i18n: I18nService, private router: Router, private auth: AuthService) {}

  private t = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);

  /** Returns a reply when the question was a customization / edit request, otherwise null so the other intents can run. */
  handle(raw: string): CustomizeReply | null {
    const q = norm(raw);

    // ---- undo
    if (has(q, W.undo) && (q.length < 40 || has(q, W.look))) return this.undo();

    // ---- open an edit / add / import screen
    const edit = this.openScreen(q);
    if (edit) return edit;

    const before = { look: { ...this.look.look() }, layout: this.layout.snapshot() };
    const done: string[] = [];
    const patch: Partial<Look> = {};
    const sep = this.i18n.isRtl ? '، ' : ', ';

    // ---- reset
    if (has(q, W.reset) && (has(q, W.look) || has(q, W.all) || q.length < 24)) {
      this.save(before);
      this.look.reset();
      this.layout.resetAll();
      return { text: this.t('ai.c.reset') };
    }

    // ---- language
    const lang = LANG_NAMES.find(l => has(q, l.words));
    if (lang && (has(q, W.language) || has(q, W.switchV)) && lang.code !== this.i18n.lang()) {
      this.save(before);
      this.i18n.setLang(lang.code);
      return { text: this.i18n.t('ai.c.lang', { l: this.i18n.info.native }) };
    }

    // ---- sidebar / menu
    const sidebarWord = has(q, W.sidebar);
    const menuWord = sidebarWord || has(q, W.menu);
    if (menuWord) {
      const mods = this.modulesIn(q);
      if (mods.length && (has(q, W.hide) || has(q, W.show))) {
        const hide = has(q, W.hide) && !(has(q, W.show) && q.indexOf(W.show.find(w => q.includes(w))!) < q.indexOf(W.hide.find(w => q.includes(w))!));
        this.save(before);
        this.layout.setNav(mods, hide);
        const names = mods.map(m => this.t('module.' + m)).join(sep);
        return { text: this.t(hide ? 'ai.c.navHid' : 'ai.c.navShown', { m: names }) };
      }
      if (sidebarWord) {
        if (has(q, W.dark)) { patch.sidebar = 'dark'; done.push(this.t('ai.c.w.sidebar', { s: this.t('ai.c.sb.dark') })); }
        else if (has(q, W.light)) { patch.sidebar = 'light'; done.push(this.t('ai.c.w.sidebar', { s: this.t('ai.c.sb.light') })); }
        else if (has(q, ['accent', 'colour', 'color', 'لون', 'couleur', 'color', 'farbe', 'colore', 'رنگ'])) { patch.sidebar = 'accent'; done.push(this.t('ai.c.w.sidebar', { s: this.t('ai.c.sb.accent') })); }
      }
    }

    // ---- theme mode (skip when the words were about the sidebar)
    if (!patch.sidebar) {
      const wantsMode = has(q, W.look) || q.length < 40 || has(q, ['mode', 'وضع', 'mode', 'modo', 'modus', 'modalità', 'موڈ']);
      if (wantsMode && has(q, W.dark) && !has(q, W.light)) { patch.mode = 'dark'; done.push(this.t('ai.c.w.dark')); }
      else if (wantsMode && has(q, W.light) && !has(q, W.dark)) { patch.mode = 'light'; done.push(this.t('ai.c.w.light')); }
      else if (wantsMode && has(q, W.system)) { patch.mode = 'system'; done.push(this.t('ai.c.w.system')); }
    }

    // ---- accent colour
    const hex = q.match(/#([0-9a-f]{6})\b/);
    if (hex) { patch.accent = '#' + hex[1]; done.push(this.t('ai.c.w.accent', { c: '#' + hex[1] })); }
    else if (has(q, W.colorCtx) && !patch.sidebar) {
      const c = COLORS.find(x => hasWord(q, x.latin) || has(q, x.words));
      if (c) { patch.accent = c.hex; done.push(this.t('ai.c.w.accent', { c: this.colourName(c.hex) })); }
    }

    // ---- font family
    if (has(q, W.font)) {
      const f = FONTS.find(x => hasWord(q, [x.id]) || q.includes(x.label.toLowerCase().split(' ')[0]));
      if (f) { patch.font = f.id; done.push(this.t('ai.c.w.font', { f: f.label })); }
      else if (has(q, ['auto', 'default', 'تلقائي', 'افتراضي', 'défaut', 'automático', 'standard', 'automatisch', 'predefinit', 'خودکار'])) { patch.font = 'auto'; done.push(this.t('ai.c.w.fontAuto')); }
    }

    // ---- text size
    const cur = SIZES.indexOf(this.look.look().size);
    if (has(q, W.textCtx) || has(q, W.bigger) || has(q, W.smaller)) {
      let idx = -1;
      if (has(q, ['extra large', 'huge', 'xl', 'كبير جدا', 'très grand', 'muy grande', 'sehr groß', 'molto grande', 'بہت بڑا'])) idx = 3;
      else if (has(q, W.bigger) && !has(q, W.smaller)) idx = Math.min(3, cur + 1);
      else if (has(q, W.smaller) && !has(q, W.bigger)) idx = Math.max(0, cur - 1);
      else if (has(q, ['large', 'كبير', 'grande', 'groß', 'grand', 'بڑا']) && !has(q, W.smaller)) idx = 2;
      else if (has(q, ['small', 'صغير', 'petit', 'pequeñ', 'klein', 'piccol', 'چھوٹا']) && !has(q, W.bigger)) idx = 0;
      else if (has(q, ['normal text', 'medium text', 'default size', 'normal size', 'حجم عادي', 'taille normale', 'tamaño normal', 'normale größe', 'dimensione normale', 'عام سائز'])) idx = 1;
      if (idx >= 0 && (has(q, W.textCtx) || !patch.mode)) {
        patch.size = SIZES[idx];
        done.push(this.t('ai.c.w.size', { s: this.t('ai.c.sz.' + SIZES[idx]) }));
      }
    }

    // ---- density & corners
    if (has(q, W.compact)) { patch.density = 'compact'; done.push(this.t('ai.c.w.compact')); }
    else if (has(q, W.comfortable)) { patch.density = 'comfortable'; done.push(this.t('ai.c.w.comfortable')); }
    if (has(q, ['corner', 'edge', 'radius', 'border', 'زوايا', 'حواف', 'coin', 'angle', 'bord', 'esquina', 'borde', 'ecke', 'rand', 'angol', 'bordi', 'کونے'])) {
      const k = has(q, W.sharp) ? 'sharp' : has(q, W.round) ? 'round' : has(q, W.soft) ? 'soft' : null;
      if (k) { patch.corners = k; done.push(this.t('ai.c.w.corners', { c: this.t('ai.c.cr.' + k) })); }
    }

    if (Object.keys(patch).length) {
      this.save(before);
      this.look.update(patch);
      return { text: this.t('ai.c.done', { what: done.join(sep) }) };
    }

    // ---- hide / show sections of the current page
    const hideV = has(q, W.hide), showV = has(q, W.show);
    if (hideV || showV) {
      const page = this.layout.pageFor(this.router.url);
      const mods = menuWord ? [] : this.modulesIn(q).filter(() => has(q, ['from', 'من', 'de ', 'aus', 'da ', 'سے']));
      if (!page) {
        // "hide X" on a page without sections: only answer if it clearly was a customize request
        return hideV ? { text: this.t('ai.c.noPage') } : null;
      }
      if (showV && has(q, W.all)) {
        if (!(this.layout.snapshot().hidden[page.key]?.length)) return { text: this.t('ai.c.nothingHidden') };
        this.save(before);
        this.layout.resetPage(page.key);
        return { text: this.t('ai.c.shownAll', { p: this.t(page.titleKey) }) };
      }
      const hit = page.blocks.filter(b => has(q, b.words));
      void mods;
      if (!hit.length) {
        if (!hideV) return null; // "show me ..." is a normal question
        return { text: this.t('ai.c.noBlock', { list: page.blocks.map(b => this.t(b.labelKey)).join(sep) }) };
      }
      const hide = hideV && !showV ? true : showV && !hideV ? false : q.search(new RegExp(W.hide.map(esc).join('|'))) <= q.search(new RegExp(W.show.map(esc).join('|')));
      this.save(before);
      this.layout.setBlocks(page.key, hit.map(b => b.id), hide);
      const names = hit.map(b => this.t(b.labelKey)).join(sep);
      return { text: this.t(hide ? 'ai.c.hid' : 'ai.c.shown', { b: names, first: this.t(hit[0].labelKey) }) };
    }
    return null;
  }

  // ------------------------------------------------------------------

  private modulesIn(q: string): string[] {
    return MODULES.filter(m => q.includes(m.key) || q.includes(this.t('module.' + m.key).toLowerCase())).map(m => m.key);
  }

  private colourName(hex: string) {
    const i = ACCENTS.indexOf(hex);
    return i >= 0 ? this.t('ai.c.col.' + i) : hex;
  }

  private save(snap: { look: Look; layout: LayoutSnapshot }) { this.history.push(snap); if (this.history.length > 20) this.history.shift(); }

  private undo(): CustomizeReply {
    const s = this.history.pop();
    if (!s) return { text: this.t('ai.c.nothingUndo') };
    this.look.update(s.look);
    this.layout.restore(s.layout);
    return { text: this.t('ai.c.undone') };
  }

  /** "edit employee E1003", "add a journal", "import employees" -> open the screen (the page re-checks privileges). */
  private openScreen(q: string): CustomizeReply | null {
    const isEdit = has(q, W.edit), isAdd = has(q, W.add), isImport = has(q, W.importV);
    if (!isEdit && !isAdd && !isImport) return null;
    // the specific multi-word targets (supplier invoice ...) must win over generic ones, so test longest word first
    const cand = EDIT_TARGETS
      .map(t => ({ t, w: t.words.filter(w => q.includes(w)).sort((a, b) => b.length - a.length)[0] }))
      .filter(x => x.w)
      .sort((a, b) => b.w.length - a.w.length)[0];
    if (!cand) return null;
    const t = cand.t;
    if (isImport && t.id !== 'employee') return null;
    if (t.need && !this.auth.can(t.need)) return { text: this.t('ai.c.noRight') };
    const idMatch = t.withId ? q.match(/\b([a-z]{0,3}\d{3,})\b/i) : null;
    const label = this.t('ai.c.target.' + t.id);
    if (isImport) return { text: this.t('ai.c.open', { w: label }), actions: [{ label, route: t.route, queryParams: { import: '1' } }] };
    if (isEdit && idMatch) return { text: this.t('ai.c.openEdit', { w: label, id: idMatch[1].toUpperCase() }), actions: [{ label: idMatch[1].toUpperCase(), route: t.route, queryParams: { edit: idMatch[1].toUpperCase() } }] };
    if (isEdit && !isAdd) return { text: this.t('ai.c.needId', { w: label }), actions: [{ label, route: t.route }] };
    return { text: this.t('ai.c.open', { w: label }), actions: [{ label, route: t.route, queryParams: { new: '1' } }] };
  }
}

function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
