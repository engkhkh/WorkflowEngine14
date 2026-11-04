/** Design of a site (stored as JSON): theme + pages of blocks. Rendered to one html document by site-renderer.ts. */
export interface Theme { primary: string; bg: string; text: string; font: 'sans' | 'serif' | 'mono' | 'arabic'; radius: number; dark: boolean; }
export interface Block { id: string; type: string; props: Record<string, any>; }
export interface Page { id: string; path: string; title: string; blocks: Block[]; }
export interface ShopItem { sku: string; name: string; price: number; category?: string; image?: string; description?: string; }
export interface SiteDesign {
  theme: Theme; pages: Page[];
  settings: { title: string; lang: string; dir: 'ltr' | 'rtl'; description?: string };
  shop: { enabled: boolean; currency: string; products: ShopItem[] };
}
export interface SiteRow { id: string; name: string; slug: string; published: boolean; publishedAt?: string | null; updatedAt: string; currency: string; }
export interface Submission {
  id: string; siteId: string; kind: 'order' | 'message'; number: string; name: string; email?: string; phone?: string; address?: string; note?: string;
  lines: { sku: string; name: string; qty: number; price: number }[]; total: number; currency: string; status: string; createdAt: string;
}

export type FieldKind = 'text' | 'textarea' | 'image' | 'select' | 'number' | 'list';
export interface FieldDef { key: string; label: string; kind: FieldKind; options?: { v: string; l: string }[]; itemFields?: FieldDef[]; itemDefault?: Record<string, any>; min?: number; max?: number; }
export interface BlockDef { type: string; label: string; icon: string; fields: FieldDef[]; defaults: Record<string, any>; }

const BG = { key: 'bgStyle', label: 'web.f.background', kind: 'select' as const, options: [{ v: 'none', l: 'web.o.none' }, { v: 'soft', l: 'web.o.soft' }, { v: 'primary', l: 'web.o.primary' }, { v: 'dark', l: 'web.o.dark' }] };
const PAD = { key: 'pad', label: 'web.f.padding', kind: 'select' as const, options: [{ v: 's', l: 'web.o.small' }, { v: 'm', l: 'web.o.medium' }, { v: 'l', l: 'web.o.large' }] };
const ALIGN = { key: 'align', label: 'web.f.align', kind: 'select' as const, options: [{ v: 'start', l: 'web.o.start' }, { v: 'center', l: 'web.o.center' }, { v: 'end', l: 'web.o.end' }] };
const COLS = { key: 'columns', label: 'web.f.columns', kind: 'select' as const, options: [{ v: '2', l: '2' }, { v: '3', l: '3' }, { v: '4', l: '4' }] };

export const BLOCK_DEFS: BlockDef[] = [
  { type: 'nav', label: 'web.b.nav', icon: 'menu', defaults: { brand: 'My Business', logo: '', sticky: 'yes' },
    fields: [{ key: 'brand', label: 'web.f.brand', kind: 'text' }, { key: 'logo', label: 'web.f.logo', kind: 'image' }, { key: 'sticky', label: 'web.f.sticky', kind: 'select', options: [{ v: 'yes', l: 'web.o.yes' }, { v: 'no', l: 'web.o.no' }] }] },
  { type: 'hero', label: 'web.b.hero', icon: 'sparkles', defaults: { title: 'Welcome to our website', subtitle: 'Tell visitors what you do in one sentence.', button: 'Get started', link: '/contact', button2: '', link2: '', image: '', overlay: 45, height: 'l', align: 'center' },
    fields: [{ key: 'title', label: 'web.f.title', kind: 'text' }, { key: 'subtitle', label: 'web.f.subtitle', kind: 'textarea' }, { key: 'button', label: 'web.f.button', kind: 'text' }, { key: 'link', label: 'web.f.link', kind: 'text' },
      { key: 'button2', label: 'web.f.button2', kind: 'text' }, { key: 'link2', label: 'web.f.link', kind: 'text' }, { key: 'image', label: 'web.f.image', kind: 'image' },
      { key: 'overlay', label: 'web.f.overlay', kind: 'number', min: 0, max: 85 }, { key: 'height', label: 'web.f.height', kind: 'select', options: [{ v: 's', l: 'web.o.small' }, { v: 'm', l: 'web.o.medium' }, { v: 'l', l: 'web.o.large' }] }, ALIGN] },
  { type: 'text', label: 'web.b.text', icon: 'file', defaults: { heading: 'About us', body: 'Write about your business here. Use a blank line to start a new paragraph.', align: 'start', bgStyle: 'none', pad: 'm' },
    fields: [{ key: 'heading', label: 'web.f.title', kind: 'text' }, { key: 'body', label: 'web.f.text', kind: 'textarea' }, ALIGN, BG, PAD] },
  { type: 'image', label: 'web.b.image', icon: 'image', defaults: { image: '', alt: '', caption: '', width: 'contained', pad: 'm', bgStyle: 'none' },
    fields: [{ key: 'image', label: 'web.f.image', kind: 'image' }, { key: 'alt', label: 'web.f.alt', kind: 'text' }, { key: 'caption', label: 'web.f.caption', kind: 'text' },
      { key: 'width', label: 'web.f.width', kind: 'select', options: [{ v: 'contained', l: 'web.o.contained' }, { v: 'full', l: 'web.o.full' }] }, BG, PAD] },
  { type: 'features', label: 'web.b.features', icon: 'grid', defaults: { heading: 'Why choose us', columns: '3', bgStyle: 'soft', pad: 'm', items: [{ icon: '⚡', title: 'Fast', text: 'Quick and reliable service.' }, { icon: '🛡️', title: 'Trusted', text: 'Quality you can count on.' }, { icon: '💬', title: 'Support', text: 'We are here to help.' }] },
    fields: [{ key: 'heading', label: 'web.f.title', kind: 'text' }, COLS, { key: 'items', label: 'web.f.items', kind: 'list', itemDefault: { icon: '⭐', title: 'Title', text: 'Text' },
      itemFields: [{ key: 'icon', label: 'web.f.icon', kind: 'text' }, { key: 'title', label: 'web.f.title', kind: 'text' }, { key: 'text', label: 'web.f.text', kind: 'textarea' }] }, BG, PAD] },
  { type: 'products', label: 'web.b.products', icon: 'store', defaults: { heading: 'Our products', columns: '4', category: '', limit: 8, bgStyle: 'none', pad: 'm' },
    fields: [{ key: 'heading', label: 'web.f.title', kind: 'text' }, COLS, { key: 'category', label: 'web.f.category', kind: 'text' }, { key: 'limit', label: 'web.f.limit', kind: 'number', min: 1, max: 60 }, BG, PAD] },
  { type: 'gallery', label: 'web.b.gallery', icon: 'image', defaults: { heading: 'Gallery', columns: '3', bgStyle: 'none', pad: 'm', items: [{ image: '', alt: '' }, { image: '', alt: '' }, { image: '', alt: '' }] },
    fields: [{ key: 'heading', label: 'web.f.title', kind: 'text' }, COLS, { key: 'items', label: 'web.f.items', kind: 'list', itemDefault: { image: '', alt: '' },
      itemFields: [{ key: 'image', label: 'web.f.image', kind: 'image' }, { key: 'alt', label: 'web.f.alt', kind: 'text' }] }, BG, PAD] },
  { type: 'testimonials', label: 'web.b.testimonials', icon: 'message', defaults: { heading: 'What customers say', bgStyle: 'soft', pad: 'm', items: [{ name: 'Sara A.', role: 'Customer', text: 'Excellent service, highly recommended.' }, { name: 'Omar K.', role: 'Customer', text: 'Great quality and fast delivery.' }] },
    fields: [{ key: 'heading', label: 'web.f.title', kind: 'text' }, { key: 'items', label: 'web.f.items', kind: 'list', itemDefault: { name: 'Name', role: '', text: 'Opinion' },
      itemFields: [{ key: 'name', label: 'web.f.name', kind: 'text' }, { key: 'role', label: 'web.f.role', kind: 'text' }, { key: 'text', label: 'web.f.text', kind: 'textarea' }] }, BG, PAD] },
  { type: 'faq', label: 'web.b.faq', icon: 'help', defaults: { heading: 'Questions', bgStyle: 'none', pad: 'm', items: [{ q: 'How can I order?', a: 'Add products to the cart and send your order.' }] },
    fields: [{ key: 'heading', label: 'web.f.title', kind: 'text' }, { key: 'items', label: 'web.f.items', kind: 'list', itemDefault: { q: 'Question', a: 'Answer' },
      itemFields: [{ key: 'q', label: 'web.f.question', kind: 'text' }, { key: 'a', label: 'web.f.answer', kind: 'textarea' }] }, BG, PAD] },
  { type: 'cta', label: 'web.b.cta', icon: 'send', defaults: { heading: 'Ready to start?', text: 'Contact us today.', button: 'Contact us', link: '/contact', bgStyle: 'primary', pad: 'm' },
    fields: [{ key: 'heading', label: 'web.f.title', kind: 'text' }, { key: 'text', label: 'web.f.text', kind: 'textarea' }, { key: 'button', label: 'web.f.button', kind: 'text' }, { key: 'link', label: 'web.f.link', kind: 'text' }, BG, PAD] },
  { type: 'contact', label: 'web.b.contact', icon: 'mail', defaults: { heading: 'Contact us', text: 'Send us a message and we will answer you soon.', button: 'Send', phone: '', email: '', address: '', bgStyle: 'none', pad: 'm' },
    fields: [{ key: 'heading', label: 'web.f.title', kind: 'text' }, { key: 'text', label: 'web.f.text', kind: 'textarea' }, { key: 'button', label: 'web.f.button', kind: 'text' },
      { key: 'phone', label: 'web.f.phone', kind: 'text' }, { key: 'email', label: 'web.f.email', kind: 'text' }, { key: 'address', label: 'web.f.address', kind: 'text' }, BG, PAD] },
  { type: 'embed', label: 'web.b.embed', icon: 'globe', defaults: { url: '', height: 360, pad: 'm', bgStyle: 'none' },
    fields: [{ key: 'url', label: 'web.f.embedUrl', kind: 'text' }, { key: 'height', label: 'web.f.height', kind: 'number', min: 200, max: 900 }, BG, PAD] },
  { type: 'spacer', label: 'web.b.spacer', icon: 'minus', defaults: { height: 48 }, fields: [{ key: 'height', label: 'web.f.height', kind: 'number', min: 8, max: 300 }] },
  { type: 'footer', label: 'web.b.footer', icon: 'chevron', defaults: { text: '© My Business. All rights reserved.', items: [{ label: 'Home', link: '/' }] },
    fields: [{ key: 'text', label: 'web.f.text', kind: 'text' }, { key: 'items', label: 'web.f.links', kind: 'list', itemDefault: { label: 'Link', link: '/' },
      itemFields: [{ key: 'label', label: 'web.f.label', kind: 'text' }, { key: 'link', label: 'web.f.link', kind: 'text' }] }] },
];
export const blockDef = (t: string) => BLOCK_DEFS.find(b => b.type === t);

export const uid = () => Math.random().toString(36).slice(2, 9);
export const newBlock = (type: string): Block => ({ id: uid(), type, props: JSON.parse(JSON.stringify(blockDef(type)?.defaults ?? {})) });
const B = (type: string, over: Record<string, any> = {}): Block => { const b = newBlock(type); Object.assign(b.props, over); return b; };

export const DEFAULT_THEME: Theme = { primary: '#4f46e5', bg: '#ffffff', text: '#1f2937', font: 'sans', radius: 10, dark: false };

export type TemplateKey = 'blank' | 'business' | 'shop';
export function templateDesign(key: TemplateKey, name: string, currency: string): SiteDesign {
  const nav = () => B('nav', { brand: name });
  const foot = () => B('footer', { text: `© ${new Date().getFullYear()} ${name}. All rights reserved.`, items: [{ label: 'Home', link: '/' }, { label: 'Contact', link: '/contact' }] });
  const base: SiteDesign = { theme: { ...DEFAULT_THEME }, pages: [], settings: { title: name, lang: 'en', dir: 'ltr' }, shop: { enabled: false, currency, products: [] } };
  if (key === 'blank') { base.pages = [{ id: uid(), path: '/', title: 'Home', blocks: [nav(), B('hero', { title: name }), foot()] }]; return base; }
  if (key === 'business') {
    base.pages = [
      { id: uid(), path: '/', title: 'Home', blocks: [nav(), B('hero', { title: name, subtitle: 'Professional services you can rely on.', link: '/contact', button: 'Contact us' }), B('features'), B('testimonials'), B('cta'), foot()] },
      { id: uid(), path: '/about', title: 'About', blocks: [nav(), B('text', { heading: 'About ' + name }), B('features', { heading: 'Our values', bgStyle: 'none' }), foot()] },
      { id: uid(), path: '/contact', title: 'Contact', blocks: [nav(), B('contact'), B('embed'), foot()] },
    ];
    return base;
  }
  base.shop.enabled = true;
  base.pages = [
    { id: uid(), path: '/', title: 'Home', blocks: [nav(), B('hero', { title: name, subtitle: 'Shop our latest products. Order online in minutes.', button: 'Shop now', link: '/shop' }), B('products', { heading: 'Featured products', limit: 4 }), B('features', { heading: 'Why shop with us', items: [{ icon: '🚚', title: 'Delivery', text: 'Fast delivery to your door.' }, { icon: '🔒', title: 'Safe ordering', text: 'Your details stay private.' }, { icon: '↩️', title: 'Easy returns', text: 'Change of mind? We help.' }] }), B('cta', { heading: 'Questions about an order?', button: 'Contact us' }), foot()] },
    { id: uid(), path: '/shop', title: 'Shop', blocks: [nav(), B('products', { heading: 'All products', limit: 60 }), foot()] },
    { id: uid(), path: '/contact', title: 'Contact', blocks: [nav(), B('contact'), B('faq'), foot()] },
  ];
  return base;
}
