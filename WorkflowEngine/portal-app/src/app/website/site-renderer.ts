import { Block, Page, SiteDesign } from './website.models';

export interface RenderOpts {
  /** preview = editor canvas (selectable blocks); publish / download = the real thing */
  mode: 'preview' | 'publish' | 'download';
  page?: string;               // preview: path of the page to show first
  selected?: string;           // preview: id of the selected block
  scrollY?: number;            // preview: scroll position to restore
  orderUrl?: string;           // where the cart posts the order (published sites)
  messageUrl?: string;         // where the contact form posts
  labels?: Record<string, string>;
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** page link ("/about") -> "#/about"; only http(s), mailto, tel and "#" are allowed, anything else becomes "#" */
function href(l: unknown): string {
  const s = String(l ?? '').trim();
  if (!s) return '#/';
  if (s.startsWith('/')) return '#' + s;
  if (/^(https?:\/\/|mailto:|tel:|#)/i.test(s)) return s;
  return '#';
}
const isExt = (h: string) => /^https?:/i.test(h);
/** images: https, http, or an uploaded data: image */
function img(v: unknown): string { const s = String(v ?? '').trim(); return /^(https?:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i.test(s) ? s : ''; }
function embedUrl(v: unknown): string {
  const s = String(v ?? '').trim();
  return /^https:\/\/(www\.youtube\.com\/embed\/|www\.google\.com\/maps\/embed|www\.openstreetmap\.org\/export\/embed)/i.test(s) ? s : '';
}
const FONTS: Record<string, string> = {
  sans: "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", serif: "Georgia,'Times New Roman',serif",
  mono: "ui-monospace,Menlo,Consolas,monospace", arabic: "Tahoma,'Segoe UI','Noto Naskh Arabic',Arial,sans-serif"
};
const PADS: Record<string, string> = { s: '28px', m: '56px', l: '96px' };
const paras = (t: unknown) => String(t ?? '').split(/\n{2,}/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
const money = (n: number, cur: string) => `${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${esc(cur)}`;

function section(b: Block, inner: string, o: RenderOpts, extraClass = ''): string {
  const p = b.props, bg = p['bgStyle'] ?? 'none', pad = PADS[p['pad'] ?? 'm'] ?? PADS['m'];
  const sel = o.mode === 'preview' ? ` data-bid="${esc(b.id)}"${o.selected === b.id ? ' data-sel="1"' : ''}` : '';
  return `<section class="blk bg-${esc(bg)} ${extraClass}" style="padding-block:${pad}"${sel}><div class="wrap">${inner}</div></section>`;
}
const heading = (t: unknown) => (t ? `<h2 class="h2">${esc(t)}</h2>` : '');

function renderBlock(b: Block, d: SiteDesign, page: Page, o: RenderOpts): string {
  const p = b.props;
  const sel = o.mode === 'preview' ? ` data-bid="${esc(b.id)}"${o.selected === b.id ? ' data-sel="1"' : ''}` : '';
  switch (b.type) {
    case 'nav': {
      const links = d.pages.map(pg => `<a href="#${esc(pg.path)}" data-nav="${esc(pg.path)}">${esc(pg.title)}</a>`).join('');
      const logo = img(p['logo']);
      return `<header class="nav${p['sticky'] === 'yes' ? ' sticky' : ''}"${sel}><div class="wrap navin"><a class="brand" href="#/">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<span>${esc(p['brand'])}</span></a>
        <nav class="links">${links}</nav>${d.shop.enabled ? `<button class="cartbtn" type="button" data-cart-open aria-label="cart">🛒 <b data-cart-count>0</b></button>` : ''}</div></header>`;
    }
    case 'hero': {
      const bg = img(p['image']); const ov = Math.max(0, Math.min(85, Number(p['overlay']) || 0)) / 100;
      const h = { s: '320px', m: '460px', l: '620px' }[String(p['height'])] ?? '460px';
      const b1 = p['button'] ? `<a class="btn" href="${esc(href(p['link']))}"${isExt(href(p['link'])) ? ' target="_blank" rel="noopener"' : ''}>${esc(p['button'])}</a>` : '';
      const b2 = p['button2'] ? `<a class="btn ghost" href="${esc(href(p['link2']))}"${isExt(href(p['link2'])) ? ' target="_blank" rel="noopener"' : ''}>${esc(p['button2'])}</a>` : '';
      return `<section class="blk hero ${bg ? 'has-img' : ''}" style="min-height:${h};text-align:${esc(p['align'] ?? 'center')};${bg ? `background-image:linear-gradient(rgba(0,0,0,${ov}),rgba(0,0,0,${ov})),url('${esc(bg)}')` : ''}"${sel}>
        <div class="wrap"><h1>${esc(p['title'])}</h1><p class="lead">${esc(p['subtitle'])}</p><div class="btns">${b1}${b2}</div></div></section>`;
    }
    case 'text':
      return section(b, `<div style="text-align:${esc(p['align'] ?? 'start')}">${heading(p['heading'])}<div class="prose">${paras(p['body'])}</div></div>`, o);
    case 'image': {
      const s = img(p['image']);
      const body = s ? `<figure class="fig${p['width'] === 'full' ? ' full' : ''}"><img src="${esc(s)}" alt="${esc(p['alt'])}">${p['caption'] ? `<figcaption>${esc(p['caption'])}</figcaption>` : ''}</figure>` : `<div class="ph">🖼️</div>`;
      return section(b, body, o);
    }
    case 'features': {
      const items = (p['items'] as any[] ?? []).map(i => `<div class="card feat"><div class="ico">${esc(i.icon)}</div><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join('');
      return section(b, `${heading(p['heading'])}<div class="grid c${esc(p['columns'] ?? '3')}">${items}</div>`, o);
    }
    case 'products': {
      let list = d.shop.products;
      const cat = String(p['category'] ?? '').trim().toLowerCase();
      if (cat) list = list.filter(x => (x.category ?? '').toLowerCase() === cat);
      list = list.slice(0, Math.max(1, Number(p['limit']) || 8));
      const cards = list.map(x => `<div class="card prod"><div class="pimg">${img(x.image) ? `<img src="${esc(img(x.image))}" alt="${esc(x.name)}" loading="lazy">` : '<span>🛍️</span>'}</div>
        <h3>${esc(x.name)}</h3>${x.description ? `<p class="muted">${esc(x.description)}</p>` : ''}<div class="price">${money(x.price, d.shop.currency)}</div>
        <button class="btn sm" type="button" data-add="${esc(x.sku)}">${esc(o.labels?.['add'] ?? 'Add to cart')}</button></div>`).join('');
      const empty = `<p class="muted center">${esc(o.labels?.['noProducts'] ?? 'No products yet. Sync products from the point of sale in the shop settings.')}</p>`;
      return section(b, `${heading(p['heading'])}${list.length ? `<div class="grid c${esc(p['columns'] ?? '4')}">${cards}</div>` : empty}`, o);
    }
    case 'gallery': {
      const items = (p['items'] as any[] ?? []).map(i => img(i.image) ? `<img class="g" src="${esc(img(i.image))}" alt="${esc(i.alt)}" loading="lazy">` : `<div class="ph">🖼️</div>`).join('');
      return section(b, `${heading(p['heading'])}<div class="grid c${esc(p['columns'] ?? '3')}">${items}</div>`, o);
    }
    case 'testimonials': {
      const items = (p['items'] as any[] ?? []).map(i => `<blockquote class="card"><p>“${esc(i.text)}”</p><footer><b>${esc(i.name)}</b>${i.role ? ` · <span class="muted">${esc(i.role)}</span>` : ''}</footer></blockquote>`).join('');
      return section(b, `${heading(p['heading'])}<div class="grid c2">${items}</div>`, o);
    }
    case 'faq': {
      const items = (p['items'] as any[] ?? []).map(i => `<details class="card"><summary>${esc(i.q)}</summary><p>${esc(i.a)}</p></details>`).join('');
      return section(b, `${heading(p['heading'])}<div class="faq">${items}</div>`, o);
    }
    case 'cta':
      return section(b, `<div class="center"><h2 class="h2">${esc(p['heading'])}</h2><p class="lead">${esc(p['text'])}</p>${p['button'] ? `<a class="btn light" href="${esc(href(p['link']))}"${isExt(href(p['link'])) ? ' target="_blank" rel="noopener"' : ''}>${esc(p['button'])}</a>` : ''}</div>`, o);
    case 'contact': {
      const info = [p['phone'] ? `<div>📞 <a href="tel:${esc(p['phone'])}">${esc(p['phone'])}</a></div>` : '', p['email'] ? `<div>✉️ <a href="mailto:${esc(p['email'])}">${esc(p['email'])}</a></div>` : '', p['address'] ? `<div>📍 ${esc(p['address'])}</div>` : ''].join('');
      const L = o.labels ?? {};
      return section(b, `<div class="two"><div>${heading(p['heading'])}<p>${esc(p['text'])}</p><div class="info">${info}</div></div>
        <form class="card form" data-contact><input name="name" placeholder="${esc(L['name'] ?? 'Your name')}" required maxlength="120"><input name="email" type="email" placeholder="${esc(L['email'] ?? 'E-mail')}" maxlength="160">
        <input name="phone" placeholder="${esc(L['phone'] ?? 'Phone')}" maxlength="40"><textarea name="message" rows="4" placeholder="${esc(L['message'] ?? 'Message')}" required maxlength="2000"></textarea>
        <input name="website" class="hp" tabindex="-1" autocomplete="off"><button class="btn" type="submit">${esc(p['button'])}</button><p class="status" data-status></p></form></div>`, o);
    }
    case 'embed': {
      const u = embedUrl(p['url']);
      return section(b, u ? `<iframe class="embed" src="${esc(u)}" style="height:${Math.max(200, Math.min(900, Number(p['height']) || 360))}px" loading="lazy" referrerpolicy="no-referrer" allowfullscreen></iframe>` : `<div class="ph">🗺️</div>`, o);
    }
    case 'spacer':
      return `<div style="height:${Math.max(8, Math.min(300, Number(p['height']) || 48))}px"${sel}></div>`;
    case 'footer': {
      const links = (p['items'] as any[] ?? []).map(i => `<a href="${esc(href(i.link))}"${isExt(href(i.link)) ? ' target="_blank" rel="noopener"' : ''}>${esc(i.label)}</a>`).join('');
      return `<footer class="foot"${sel}><div class="wrap"><div class="flinks">${links}</div><p>${esc(p['text'])}</p></div></footer>`;
    }
  }
  return '';
}

/** Turns a design into one self-contained html document (all pages, "#/path" navigation, cart + checkout for shops). */
export function renderSite(d: SiteDesign, o: RenderOpts): string {
  const t = d.theme, dark = t.dark;
  const bg = dark ? '#0f172a' : t.bg, tx = dark ? '#e5e7eb' : t.text, soft = dark ? '#1e293b' : 'rgba(0,0,0,.04)', line = dark ? '#334155' : 'rgba(0,0,0,.1)';
  const L = o.labels ?? {};
  const pages = d.pages.map((pg, i) => `<main class="page" data-path="${esc(pg.path)}"${i === 0 ? ' data-home="1"' : ''}>${pg.blocks.map(b => renderBlock(b, d, pg, o)).join('')}</main>`).join('');
  const css = `
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:${bg};color:${tx};font-family:${FONTS[t.font] ?? FONTS['sans']};line-height:1.6;--p:${esc(t.primary)};--r:${Math.max(0, Math.min(32, t.radius))}px;--soft:${soft};--line:${line}}
img{max-width:100%;display:block}a{color:var(--p)}.wrap{max-width:1120px;margin:0 auto;padding-inline:20px}.center{text-align:center}.muted{opacity:.7}
.page{display:none}.page.on{display:block}
.nav{background:${dark ? '#0b1220' : '#fff'};border-bottom:1px solid var(--line);z-index:30}.nav.sticky{position:sticky;top:0}.navin{display:flex;align-items:center;gap:20px;min-height:64px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;text-decoration:none;color:inherit}.brand img{height:36px;width:auto}
.links{display:flex;gap:18px;margin-inline-start:auto;flex-wrap:wrap}.links a{text-decoration:none;color:inherit;opacity:.8}.links a.on,.links a:hover{opacity:1;color:var(--p)}
.cartbtn{border:1px solid var(--line);background:transparent;color:inherit;border-radius:var(--r);padding:6px 12px;cursor:pointer;font-size:15px}
.hero{display:flex;align-items:center;background:linear-gradient(135deg,var(--p),#111827);color:#fff;background-size:cover;background-position:center;padding:60px 0}.hero h1{font-size:clamp(30px,5vw,56px);line-height:1.15;margin:0 0 14px}.hero .lead{font-size:clamp(16px,2vw,21px);opacity:.92;max-width:680px;margin:0 auto 24px}.hero[style*="start"] .lead{margin-inline:0}
.btn{display:inline-block;background:var(--p);color:#fff;border:2px solid var(--p);padding:11px 24px;border-radius:var(--r);text-decoration:none;font-weight:600;cursor:pointer;font-size:15px;font-family:inherit}.btn.ghost{background:transparent;color:#fff;border-color:#fff;margin-inline-start:10px}.btn.light{background:#fff;color:var(--p);border-color:#fff}.btn.sm{padding:7px 16px;font-size:14px}
.blk.bg-soft{background:var(--soft)}.blk.bg-primary{background:var(--p);color:#fff}.blk.bg-primary .card{color:${tx}}.blk.bg-dark{background:#111827;color:#f3f4f6}.blk.bg-dark .card{color:#f3f4f6;background:#1f2937;border-color:#374151}
.h2{font-size:clamp(24px,3.4vw,36px);margin:0 0 28px;text-align:center}.prose{max-width:760px;margin-inline:auto}.prose p{margin:0 0 14px}.lead{font-size:18px}
.grid{display:grid;gap:22px}.c2{grid-template-columns:repeat(2,1fr)}.c3{grid-template-columns:repeat(3,1fr)}.c4{grid-template-columns:repeat(4,1fr)}
.card{background:${dark ? '#1e293b' : '#fff'};border:1px solid var(--line);border-radius:var(--r);padding:20px;margin:0}.feat .ico{font-size:34px}.feat h3,.prod h3{margin:8px 0 6px;font-size:18px}
.prod{display:flex;flex-direction:column;gap:6px;padding:12px}.pimg{aspect-ratio:1/1;border-radius:calc(var(--r) - 2px);background:var(--soft);display:grid;place-items:center;overflow:hidden;font-size:42px}.pimg img{width:100%;height:100%;object-fit:cover}.price{font-weight:700;color:var(--p);margin-top:auto}
.g{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}.fig{margin:0 auto;max-width:860px}.fig.full{max-width:none}.fig img{width:100%;border-radius:var(--r)}.fig figcaption{text-align:center;font-size:14px;opacity:.7;margin-top:8px}
.ph{background:var(--soft);border:2px dashed var(--line);border-radius:var(--r);min-height:140px;display:grid;place-items:center;font-size:36px}
blockquote.card p{font-size:17px;margin:0 0 12px}blockquote footer{font-size:14px}.faq{max-width:760px;margin:0 auto;display:grid;gap:10px}.faq summary{cursor:pointer;font-weight:600}.faq p{margin:10px 0 0}
.two{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}.two .h2{text-align:start}.info{display:grid;gap:8px;margin-top:16px}.form{display:grid;gap:10px}
input,textarea,select{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:var(--r);padding:10px 12px;width:100%}.hp{position:absolute;left:-9999px;opacity:0;height:0;width:0}
.status{margin:0;font-size:14px}.embed{width:100%;border:0;border-radius:var(--r)}
.foot{background:#111827;color:#d1d5db;padding:32px 0;text-align:center}.foot a{color:#e5e7eb;margin:0 10px}.foot p{margin:14px 0 0;font-size:14px;opacity:.8}
.drawer{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;z-index:50}.drawer.open{display:block}.panel{position:absolute;inset-block:0;inset-inline-end:0;width:min(420px,100%);background:${dark ? '#0f172a' : '#fff'};color:${tx};padding:20px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.panel h3{margin:0}.ci{display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--line);padding:8px 0}.ci span{flex:1}.q{display:flex;gap:6px;align-items:center}.q button{width:26px;height:26px;border-radius:50%;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer}
.total{display:flex;justify-content:space-between;font-weight:700;font-size:18px}.ok{color:#16a34a}.err{color:#dc2626}
@media(max-width:860px){.c3,.c4{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.links{margin-inline-start:0;width:100%}}
@media(max-width:520px){.c2,.c3,.c4{grid-template-columns:1fr}.c4.prodgrid{grid-template-columns:repeat(2,1fr)}}
${o.mode === 'preview' ? `[data-bid]{cursor:pointer;position:relative}[data-bid]:hover{outline:2px dashed #6366f1;outline-offset:-2px}[data-sel]{outline:3px solid #6366f1!important;outline-offset:-3px}` : ''}`;

  const cartHtml = d.shop.enabled ? `<div class="drawer" data-drawer><div class="panel"><div style="display:flex;justify-content:space-between;align-items:center"><h3>🛒 ${esc(L['cart'] ?? 'Your cart')}</h3><button class="btn sm ghost" style="color:inherit;border-color:var(--line)" type="button" data-cart-close>✕</button></div>
    <div data-items></div><div class="total"><span>${esc(L['total'] ?? 'Total')}</span><span data-total></span></div>
    <form class="form" data-checkout><input name="name" placeholder="${esc(L['name'] ?? 'Your name')}" required maxlength="120"><input name="phone" placeholder="${esc(L['phone'] ?? 'Phone')}" maxlength="40"><input name="email" type="email" placeholder="${esc(L['email'] ?? 'E-mail')}" maxlength="160">
    <textarea name="address" rows="2" placeholder="${esc(L['address'] ?? 'Delivery address')}" maxlength="300"></textarea><textarea name="note" rows="2" placeholder="${esc(L['note'] ?? 'Note')}" maxlength="500"></textarea>
    <input name="website" class="hp" tabindex="-1" autocomplete="off"><button class="btn" type="submit">${esc(L['order'] ?? 'Place order')}</button><p class="status" data-ostatus></p></form></div></div>` : '';

  const data = { shop: d.shop.enabled, cur: d.shop.currency, prods: d.shop.products.map(p => ({ sku: p.sku, name: p.name, price: p.price })), order: o.orderUrl ?? '', msg: o.messageUrl ?? '', mode: o.mode, page: o.page ?? '', y: o.scrollY ?? 0,
    t: { empty: L['empty'] ?? 'Your cart is empty', thanks: L['thanks'] ?? 'Thank you! Your order number is', sent: L['sent'] ?? 'Message sent. Thank you!', fail: L['fail'] ?? 'Could not send. Please try again.', nopub: L['nopub'] ?? 'Ordering works once the site is published.' } };
  const js = `
(function(){var D=${JSON.stringify(data).replace(/</g, '\\u003c')};var cart={};var $=function(s,r){return(r||document).querySelector(s)};var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
function fmt(n){return (Math.round(n*100)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+D.cur}
function show(){var h=(location.hash||'').replace(/^#/,'')||D.page||'/';var pg=$$('.page');var f=pg.filter(function(p){return p.getAttribute('data-path')===h})[0]||pg[0];pg.forEach(function(p){p.classList.toggle('on',p===f)});
$$('[data-nav]').forEach(function(a){a.classList.toggle('on',a.getAttribute('data-nav')===f.getAttribute('data-path'))});if(D.mode!=='preview')window.scrollTo(0,0)}
function render(){if(!D.shop)return;var items=$('[data-items]'),n=0,t=0,html='';Object.keys(cart).forEach(function(k){var p=D.prods.filter(function(x){return x.sku===k})[0];if(!p)return;n+=cart[k];t+=p.price*cart[k];
html+='<div class="ci"><span>'+esc(p.name)+'<br><small class="muted">'+fmt(p.price)+'</small></span><div class="q"><button type="button" data-q="-1" data-k="'+esc(k)+'">−</button><b>'+cart[k]+'</b><button type="button" data-q="1" data-k="'+esc(k)+'">+</button></div></div>'});
items.innerHTML=html||'<p class="muted">'+esc(D.t.empty)+'</p>';$('[data-total]').textContent=fmt(t);$$('[data-cart-count]').forEach(function(b){b.textContent=n})}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function post(url,body,ok,bad){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.ok?r.json():r.text().then(function(t){throw new Error(t)})}).then(ok).catch(function(e){bad(e&&e.message)})}
document.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;
var add=t.closest('[data-add]');if(add){var k=add.getAttribute('data-add');cart[k]=(cart[k]||0)+1;render();var d=$('[data-drawer]');if(d)d.classList.add('open');return}
if(t.closest('[data-cart-open]')){$('[data-drawer]').classList.add('open');return}
if(t.closest('[data-cart-close]')||t.matches('[data-drawer]')){$('[data-drawer]').classList.remove('open');return}
var q=t.closest('[data-q]');if(q){var kk=q.getAttribute('data-k');cart[kk]=(cart[kk]||0)+Number(q.getAttribute('data-q'));if(cart[kk]<=0)delete cart[kk];render();return}
if(D.mode==='preview'){var a=t.closest('a');if(a){e.preventDefault();var h=a.getAttribute('href')||'';if(h.indexOf('#/')===0)parent.postMessage({wb:'goto',path:h.slice(1)},'*');return}
var b=t.closest('[data-bid]');if(b){e.preventDefault();parent.postMessage({wb:'select',id:b.getAttribute('data-bid')},'*')}}},true);
document.addEventListener('submit',function(e){var f=e.target;e.preventDefault();if(D.mode==='preview')return;var v=function(n){var i=f.elements[n];return i?i.value:''};
if(f.hasAttribute('data-contact')){var s=$('[data-status]',f);if(!D.msg){s.textContent=D.t.nopub;return}post(D.msg,{name:v('name'),email:v('email'),phone:v('phone'),message:v('message'),website:v('website')},function(){s.className='status ok';s.textContent=D.t.sent;f.reset()},function(){s.className='status err';s.textContent=D.t.fail});return}
if(f.hasAttribute('data-checkout')){var st=$('[data-ostatus]',f);if(!D.order){st.textContent=D.t.nopub;return}var lines=Object.keys(cart).map(function(k){return{sku:k,qty:cart[k]}});if(!lines.length){st.className='status err';st.textContent=D.t.empty;return}
post(D.order,{name:v('name'),phone:v('phone'),email:v('email'),address:v('address'),note:v('note'),website:v('website'),lines:lines},function(r){cart={};render();f.reset();st.className='status ok';st.textContent=D.t.thanks+' '+r.number},function(m){st.className='status err';st.textContent=D.t.fail})}},true);
window.addEventListener('hashchange',show);if(D.mode==='preview'){window.addEventListener('scroll',function(){parent.postMessage({wb:'scroll',y:window.scrollY},'*')});setTimeout(function(){window.scrollTo(0,D.y)},0)}
show();render()})();`;

  return `<!doctype html><html lang="${esc(d.settings.lang)}" dir="${esc(d.settings.dir)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.settings.title)}</title>${d.settings.description ? `<meta name="description" content="${esc(d.settings.description)}">` : ''}<style>${css}</style></head><body>${pages}${cartHtml}<script>${js}</script></body></html>`;
}
