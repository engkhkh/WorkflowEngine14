"""Turns a site design (theme + pages of blocks) into one self-contained html document - a port of the portal's site-renderer.ts. The css, the
cart script and the labels come from website.json (shared by every desktop app); only the blocks are rendered here."""
import json
import re
from pathlib import Path

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'website.json').read_text(encoding='utf-8'))
PADS = {'s': '28px', 'm': '56px', 'l': '96px'}


def js(v):
    """String(v ?? '') of a JSON value, the way JavaScript prints it"""
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, float) and v == int(v) and abs(v) < 1e15:
        return str(int(v))
    return str(v)


def num(v, d=0):
    try:
        x = float(v)
        return x if x == x else d
    except (TypeError, ValueError):
        return d


def esc(v):
    return js(v).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace("'", '&#39;')


def href(l):
    s = js(l).strip()
    if not s:
        return '#/'
    if s.startswith('/'):
        return '#' + s
    if re.match(r'(?i)^(https?://|mailto:|tel:|#)', s):
        return s
    return '#'


def is_ext(h):
    return bool(re.match(r'(?i)^https?:', h))


def img(v):
    s = js(v).strip()
    return s if re.match(r'(?i)^(https?://|data:image/(png|jpe?g|gif|webp|svg\+xml);base64,)', s) else ''


def embed_url(v):
    s = js(v).strip()
    return s if re.match(r'(?i)^https://(www\.youtube\.com/embed/|www\.google\.com/maps/embed|www\.openstreetmap\.org/export/embed)', s) else ''


def paras(t):
    return ''.join('<p>%s</p>' % esc(p.strip()).replace('\n', '<br>') for p in re.split(r'\n{2,}', js(t)))


def money(n, cur):
    return '%s %s' % (format(round(n * 100 + 1e-9) / 100, ',.2f'), esc(cur))


def heading(t):
    return '<h2 class="h2">%s</h2>' % esc(t) if js(t) else ''


def section(b, inner):
    p = b.get('props', {})
    bg = p.get('bgStyle') if p.get('bgStyle') is not None else 'none'
    pad = PADS.get(p.get('pad') if p.get('pad') is not None else 'm', PADS['m'])
    return '<section class="blk bg-%s " style="padding-block:%s"><div class="wrap">%s</div></section>' % (esc(bg), pad, inner)


def a_ext(h):
    return ' target="_blank" rel="noopener"' if is_ext(h) else ''


def render_block(b, d, labels):
    p = b.get('props', {})
    g = lambda k, dv='': p.get(k) if p.get(k) is not None else dv
    t = b.get('type')
    if t == 'nav':
        links = ''.join('<a href="#%s" data-nav="%s">%s</a>' % (esc(pg['path']), esc(pg['path']), esc(pg['title'])) for pg in d['pages'])
        logo = img(g('logo'))
        cart = '<button class="cartbtn" type="button" data-cart-open aria-label="cart">🛒 <b data-cart-count>0</b></button>' if d['shop']['enabled'] else ''
        return ('<header class="nav%s"><div class="wrap navin"><a class="brand" href="#/">%s<span>%s</span></a>\n        <nav class="links">%s</nav>%s</div></header>'
                % (' sticky' if g('sticky') == 'yes' else '', '<img src="%s" alt="">' % esc(logo) if logo else '', esc(g('brand')), links, cart))
    if t == 'hero':
        bg = img(g('image'))
        ov = max(0, min(85, num(g('overlay')))) / 100
        h = {'s': '320px', 'm': '460px', 'l': '620px'}.get(js(g('height')), '460px')
        b1 = '<a class="btn" href="%s"%s>%s</a>' % (esc(href(g('link'))), a_ext(href(g('link'))), esc(g('button'))) if g('button') else ''
        b2 = '<a class="btn ghost" href="%s"%s>%s</a>' % (esc(href(g('link2'))), a_ext(href(g('link2'))), esc(g('button2'))) if g('button2') else ''
        ovs = js(ov)
        bgs = "background-image:linear-gradient(rgba(0,0,0,%s),rgba(0,0,0,%s)),url('%s')" % (ovs, ovs, esc(bg)) if bg else ''
        return ('<section class="blk hero %s" style="min-height:%s;text-align:%s;%s">\n        <div class="wrap"><h1>%s</h1><p class="lead">%s</p><div class="btns">%s%s</div></div></section>'
                % ('has-img' if bg else '', h, esc(g('align', 'center')), bgs, esc(g('title')), esc(g('subtitle')), b1, b2))
    if t == 'text':
        return section(b, '<div style="text-align:%s">%s<div class="prose">%s</div></div>' % (esc(g('align', 'start')), heading(g('heading')), paras(g('body'))))
    if t == 'image':
        s = img(g('image'))
        body = ('<figure class="fig%s"><img src="%s" alt="%s">%s</figure>' % (' full' if g('width') == 'full' else '', esc(s), esc(g('alt')), '<figcaption>%s</figcaption>' % esc(g('caption')) if g('caption') else '')) if s else '<div class="ph">🖼️</div>'
        return section(b, body)
    if t == 'features':
        items = ''.join('<div class="card feat"><div class="ico">%s</div><h3>%s</h3><p>%s</p></div>' % (esc(i.get('icon')), esc(i.get('title')), esc(i.get('text'))) for i in g('items', []))
        return section(b, '%s<div class="grid c%s">%s</div>' % (heading(g('heading')), esc(g('columns', '3')), items))
    if t == 'products':
        lst = d['shop']['products']
        cat = js(g('category')).strip().lower()
        if cat:
            lst = [x for x in lst if (x.get('category') or '').lower() == cat]
        lst = lst[:max(1, int(num(g('limit'), 8)) or 8)]
        cards = ''.join('<div class="card prod"><div class="pimg">%s</div>\n        <h3>%s</h3>%s<div class="price">%s</div>\n        <button class="btn sm" type="button" data-add="%s">%s</button></div>'
                        % ('<img src="%s" alt="%s" loading="lazy">' % (esc(img(x.get('image'))), esc(x.get('name'))) if img(x.get('image')) else '<span>🛍️</span>', esc(x.get('name')),
                           '<p class="muted">%s</p>' % esc(x.get('description')) if x.get('description') else '', money(num(x.get('price')), d['shop']['currency']), esc(x.get('sku')), esc(labels.get('add', 'Add to cart'))) for x in lst)
        empty = '<p class="muted center">%s</p>' % esc(labels.get('noProducts', 'No products yet. Sync products from the point of sale in the shop settings.'))
        return section(b, '%s%s' % (heading(g('heading')), '<div class="grid c%s">%s</div>' % (esc(g('columns', '4')), cards) if lst else empty))
    if t == 'gallery':
        items = ''.join(('<img class="g" src="%s" alt="%s" loading="lazy">' % (esc(img(i.get('image'))), esc(i.get('alt')))) if img(i.get('image')) else '<div class="ph">🖼️</div>' for i in g('items', []))
        return section(b, '%s<div class="grid c%s">%s</div>' % (heading(g('heading')), esc(g('columns', '3')), items))
    if t == 'testimonials':
        items = ''.join('<blockquote class="card"><p>“%s”</p><footer><b>%s</b>%s</footer></blockquote>' % (esc(i.get('text')), esc(i.get('name')), ' · <span class="muted">%s</span>' % esc(i.get('role')) if i.get('role') else '') for i in g('items', []))
        return section(b, '%s<div class="grid c2">%s</div>' % (heading(g('heading')), items))
    if t == 'faq':
        items = ''.join('<details class="card"><summary>%s</summary><p>%s</p></details>' % (esc(i.get('q')), esc(i.get('a'))) for i in g('items', []))
        return section(b, '%s<div class="faq">%s</div>' % (heading(g('heading')), items))
    if t == 'cta':
        btn = '<a class="btn light" href="%s"%s>%s</a>' % (esc(href(g('link'))), a_ext(href(g('link'))), esc(g('button'))) if g('button') else ''
        return section(b, '<div class="center"><h2 class="h2">%s</h2><p class="lead">%s</p>%s</div>' % (esc(g('heading')), esc(g('text')), btn))
    if t == 'contact':
        info = ''.join([('<div>📞 <a href="tel:%s">%s</a></div>' % (esc(g('phone')), esc(g('phone')))) if g('phone') else '',
                        ('<div>✉️ <a href="mailto:%s">%s</a></div>' % (esc(g('email')), esc(g('email')))) if g('email') else '', ('<div>📍 %s</div>' % esc(g('address'))) if g('address') else ''])
        L = lambda k, dv: esc(labels.get(k, dv))
        return section(b, ('<div class="two"><div>%s<p>%s</p><div class="info">%s</div></div>\n        <form class="card form" data-contact><input name="name" placeholder="%s" required maxlength="120"><input name="email" type="email" placeholder="%s" maxlength="160">\n        '
                           '<input name="phone" placeholder="%s" maxlength="40"><textarea name="message" rows="4" placeholder="%s" required maxlength="2000"></textarea>\n        '
                           '<input name="website" class="hp" tabindex="-1" autocomplete="off"><button class="btn" type="submit">%s</button><p class="status" data-status></p></form></div>')
                       % (heading(g('heading')), esc(g('text')), info, L('name', 'Your name'), L('email', 'E-mail'), L('phone', 'Phone'), L('message', 'Message'), esc(g('button'))))
    if t == 'embed':
        u = embed_url(g('url'))
        return section(b, ('<iframe class="embed" src="%s" style="height:%spx" loading="lazy" referrerpolicy="no-referrer" allowfullscreen></iframe>' % (esc(u), js(max(200, min(900, num(g('height'), 360)) or 360))) if u else '<div class="ph">🗺️</div>'))
    if t == 'spacer':
        return '<div style="height:%spx"></div>' % js(max(8, min(300, num(g('height'), 48) or 48)))
    if t == 'footer':
        links = ''.join('<a href="%s"%s>%s</a>' % (esc(href(i.get('link'))), a_ext(href(i.get('link'))), esc(i.get('label'))) for i in g('items', []))
        return '<footer class="foot"><div class="wrap"><div class="flinks">%s</div><p>%s</p></div></footer>' % (links, esc(g('text')))
    return ''


def render_site(d, order_url='', message_url='', mode='download'):
    t = d['theme']
    dark = bool(t.get('dark'))
    bg = '#0f172a' if dark else t['bg']
    tx = '#e5e7eb' if dark else t['text']
    soft = '#1e293b' if dark else 'rgba(0,0,0,.04)'
    line = '#334155' if dark else 'rgba(0,0,0,.1)'
    labels = SPEC['arLabels'] if d['settings'].get('dir') == 'rtl' else {}
    L = lambda k: labels.get(k, SPEC['enLabels'][k])
    pages = ''.join('<main class="page" data-path="%s"%s>%s</main>' % (esc(pg['path']), ' data-home="1"' if i == 0 else '', ''.join(render_block(b, d, labels) for b in pg['blocks'])) for i, pg in enumerate(d['pages']))
    css = SPEC['css']
    for k, v in (('bg', bg), ('tx', tx), ('font', SPEC['fonts'].get(t.get('font'), SPEC['fonts']['sans'])), ('primary', esc(t['primary'])), ('radius', js(max(0, min(32, num(t.get('radius'), 10))))), ('soft', soft), ('line', line),
                 ('navbg', '#0b1220' if dark else '#fff'), ('cardbg', '#1e293b' if dark else '#fff'), ('panelbg', '#0f172a' if dark else '#fff')):
        css = css.replace('{{%s}}' % k, v)
    cart = ''
    if d['shop']['enabled']:
        cart = SPEC['cart']
        for k in re.findall(r'\{\{L\.(\w+)\}\}', cart):
            cart = cart.replace('{{L.%s}}' % k, esc(labels.get(k, SPEC['enLabels'][k])))
    data = {'shop': bool(d['shop']['enabled']), 'cur': d['shop']['currency'], 'prods': [{'sku': p['sku'], 'name': p['name'], 'price': p['price']} for p in d['shop']['products']], 'order': order_url, 'msg': message_url, 'mode': mode, 'page': '', 'y': 0,
            't': {'empty': L('empty'), 'thanks': L('thanks'), 'sent': L('sent'), 'fail': L('fail'), 'nopub': L('nopub')}}
    djs = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    script = SPEC['js'].replace('{{data}}', djs)
    s = d['settings']
    return ('<!doctype html><html lang="%s" dir="%s"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<title>%s</title>%s<style>%s</style></head><body>%s%s<script>%s</script></body></html>'
            % (esc(s['lang']), esc(s['dir']), esc(s['title']), '<meta name="description" content="%s">' % esc(s['description']) if s.get('description') else '', css, pages, cart, script))
