"""Website builder: the list of sites, a block-based editor (pages, blocks, theme, shop), publish / unpublish and the orders and messages
visitors sent. The blocks, templates and styles come from website.json (shared by every desktop app); the page is rendered by siterender.py,
which produces the same html as the portal's designer."""
import copy
import json
import os
import random
import string
import tempfile
import webbrowser
from pathlib import Path

from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFileDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QListWidget, QMessageBox, QPlainTextEdit, QPushButton, QTabWidget, QVBoxLayout, QWidget)

from .api import api
from .i18n import t
from .siterender import SPEC, render_site
from .ui import button, current_payload, fill_table, label, make_table, run_async, warn

BLOCKS = {b['type']: b for b in SPEC['blocks']}


def uid():
    return ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(7))


def new_block(kind):
    return {'id': uid(), 'type': kind, 'props': copy.deepcopy(BLOCKS[kind]['defaults'])}


def template_design(key, name, cur):
    s = json.dumps(SPEC['templates'][key])
    d = json.loads(s.replace('{{name}}', json.dumps(name)[1:-1]).replace('{{cur}}', json.dumps(cur)[1:-1]))
    return d


def opt_label(v):
    return t(v) if v.startswith('web.') else v


def summary(value):
    if isinstance(value, list):
        return '%d' % len(value)
    return str(value if value is not None else '')[:60]


class ListDialog(QDialog):
    """Edits a list of items (features, gallery pictures, FAQ ...): add, edit, remove, move."""

    def __init__(self, parent, title, fields, items, default):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(640, 420)
        self.fields, self.items, self.default = fields, [dict(i) for i in items], default
        lay = QVBoxLayout(self)
        self.table = make_table([t(f['label']) for f in fields])
        lay.addWidget(self.table, 1)
        row = QHBoxLayout()
        for text, fn in (('+', self.add), (t('web.edit'), self.edit), ('↑', lambda: self.move(-1)), ('↓', lambda: self.move(1)), ('✕', self.remove)):
            row.addWidget(button(text, fn, 'ghost'))
        row.addStretch(1)
        row.addWidget(button(t('cal.save'), self.accept))
        lay.addLayout(row)
        self.table.doubleClicked.connect(lambda *_: self.edit())
        self.refresh()

    def refresh(self, sel=0):
        fill_table(self.table, [[summary(i.get(f['key'])) for f in self.fields] for i in self.items], list(range(len(self.items))))
        if self.items:
            self.table.selectRow(min(sel, len(self.items) - 1))

    def cur(self):
        return self.table.currentRow()

    def add(self):
        self.items.append(dict(self.default))
        self.refresh(len(self.items) - 1)
        self.edit()

    def edit(self):
        i = self.cur()
        if 0 <= i < len(self.items):
            d = PropsDialog(self, t('web.edit'), self.fields, self.items[i])
            if d.exec():
                self.items[i] = d.values
                self.refresh(i)

    def move(self, n):
        i = self.cur()
        if 0 <= i + n < len(self.items) and i >= 0:
            self.items[i], self.items[i + n] = self.items[i + n], self.items[i]
            self.refresh(i + n)

    def remove(self):
        i = self.cur()
        if 0 <= i < len(self.items):
            del self.items[i]
            self.refresh(i)


class PropsDialog(QDialog):
    """A form generated from a list of field definitions (text, textarea, number, select, image, list)."""

    def __init__(self, parent, title, fields, props):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(520, 120 + 38 * len(fields))
        self.fields, self.values, self.w = fields, copy.deepcopy(props), {}
        form = QFormLayout(self)
        for f in fields:
            k, kind = f['key'], f['kind']
            v = self.values.get(k)
            if kind == 'textarea':
                w = QPlainTextEdit(str(v if v is not None else ''))
                w.setFixedHeight(90)
            elif kind == 'select':
                w = QComboBox()
                for o in f['options']:
                    w.addItem(opt_label(o['l']), o['v'])
                w.setCurrentIndex(max(0, w.findData(str(v))))
            elif kind == 'list':
                w = button('%s (%d)…' % (t(f['label']), len(v or [])), lambda f=f: self.edit_list(f), 'ghost')
            elif kind == 'image':
                w = QLineEdit(str(v or ''))
                w.setPlaceholderText('https://… / ' + t('web.upload'))
            else:
                w = QLineEdit(str(v if v is not None else ''))
            self.w[k] = w
            form.addRow(t(f['label']), w)
        form.addRow(button(t('cal.save'), self.done_ok))

    def edit_list(self, f):
        d = ListDialog(self, t(f['label']), f['itemFields'], self.values.get(f['key']) or [], f.get('itemDefault') or {})
        if d.exec():
            self.values[f['key']] = d.items
            self.w[f['key']].setText('%s (%d)…' % (t(f['label']), len(d.items)))

    def done_ok(self):
        for f in self.fields:
            k, kind, w = f['key'], f['kind'], self.w[f['key']]
            if kind == 'textarea':
                self.values[k] = w.toPlainText()
            elif kind == 'select':
                self.values[k] = w.currentData()
            elif kind == 'number':
                try:
                    x = float(w.text())
                    self.values[k] = int(x) if x == int(x) else x
                except ValueError:
                    self.values[k] = f.get('min', 0)
                if 'min' in f:
                    self.values[k] = max(f['min'], self.values[k])
                if 'max' in f:
                    self.values[k] = min(f['max'], self.values[k])
            elif kind != 'list':
                self.values[k] = w.text()
        self.accept()


PRODUCT_FIELDS = [{'key': 'sku', 'label': 'SKU', 'kind': 'text'}, {'key': 'name', 'label': 'web.f.name', 'kind': 'text'}, {'key': 'price', 'label': 'Price', 'kind': 'number', 'min': 0},
                  {'key': 'category', 'label': 'web.f.category', 'kind': 'text'}, {'key': 'description', 'label': 'web.f.text', 'kind': 'text'}, {'key': 'image', 'label': 'web.f.image', 'kind': 'image'}]


class SiteEditor(QDialog):
    """Pages and blocks, theme and settings, shop products of one site."""

    def __init__(self, parent, row, design, on_saved):
        super().__init__(parent)
        self.row, self.d, self.on_saved = row, design, on_saved
        self.setWindowTitle(t('web.design') + ' · ' + row['name'])
        self.resize(900, 600)
        self.pi = 0
        lay = QVBoxLayout(self)
        self.tabs = QTabWidget()
        lay.addWidget(self.tabs, 1)
        # pages and blocks
        w = QWidget()
        h = QHBoxLayout(w)
        left = QVBoxLayout()
        left.addWidget(label(t('web.p.pages')))
        self.pages = QListWidget()
        self.pages.currentRowChanged.connect(self.pick_page)
        left.addWidget(self.pages, 1)
        pr = QHBoxLayout()
        for text, fn in (('+', self.add_page), (t('web.edit'), self.edit_page), ('✕', self.del_page)):
            pr.addWidget(button(text, fn, 'ghost'))
        left.addLayout(pr)
        h.addLayout(left, 1)
        right = QVBoxLayout()
        right.addWidget(label(t('web.p.layers')))
        self.blocks = QListWidget()
        self.blocks.itemDoubleClicked.connect(lambda *_: self.edit_block())
        right.addWidget(self.blocks, 1)
        br = QHBoxLayout()
        self.kind = QComboBox()
        for b in SPEC['blocks']:
            self.kind.addItem(t(b['label']), b['type'])
        br.addWidget(self.kind)
        for text, fn in (('+', self.add_block), (t('web.edit'), self.edit_block), (t('web.duplicate'), self.dup_block), ('↑', lambda: self.move_block(-1)), ('↓', lambda: self.move_block(1)), ('✕', self.del_block)):
            br.addWidget(button(text, fn, 'ghost'))
        right.addLayout(br)
        h.addLayout(right, 2)
        self.tabs.addTab(w, t('web.p.pages'))
        # theme and settings
        th = self.d['theme']
        w2 = QWidget()
        f2 = QFormLayout(w2)
        self.prim, self.bg, self.tx = QLineEdit(th['primary']), QLineEdit(th['bg']), QLineEdit(th['text'])
        self.font = QComboBox()
        for k in SPEC['fonts']:
            self.font.addItem(k, k)
        self.font.setCurrentIndex(max(0, self.font.findData(th.get('font', 'sans'))))
        self.radius, self.dark = QLineEdit(str(th.get('radius', 10))), QCheckBox(t('web.dark'))
        self.dark.setChecked(bool(th.get('dark')))
        st = self.d['settings']
        self.title_, self.lang, self.dir, self.desc = QLineEdit(st['title']), QLineEdit(st['lang']), QComboBox(), QLineEdit(st.get('description') or '')
        self.dir.addItem('ltr', 'ltr')
        self.dir.addItem('rtl', 'rtl')
        self.dir.setCurrentIndex(1 if st.get('dir') == 'rtl' else 0)
        for text, wd in ((t('web.colorPrimary'), self.prim), (t('web.colorBg'), self.bg), (t('web.colorText'), self.tx), (t('web.font'), self.font), (t('web.radius'), self.radius), ('', self.dark),
                         (t('web.siteTitle'), self.title_), (t('web.language'), self.lang), ('dir', self.dir), (t('web.metaDesc'), self.desc)):
            f2.addRow(text, wd)
        self.tabs.addTab(w2, t('web.details'))
        # shop
        w3 = QWidget()
        v3 = QVBoxLayout(w3)
        top = QHBoxLayout()
        self.shop_on, self.cur = QCheckBox(t('web.shopOn')), QLineEdit(self.d['shop']['currency'])
        self.shop_on.setChecked(bool(self.d['shop']['enabled']))
        self.cur.setMaximumWidth(80)
        top.addWidget(self.shop_on)
        top.addWidget(label(t('web.currency')))
        top.addWidget(self.cur)
        top.addStretch(1)
        v3.addLayout(top)
        self.prod = make_table([p['label'] if p['label'] == 'SKU' or p['label'] == 'Price' else t(p['label']) for p in PRODUCT_FIELDS])
        v3.addWidget(self.prod, 1)
        pb = QHBoxLayout()
        for text, fn in (('+', self.add_prod), (t('web.edit'), self.edit_prod), ('✕', self.del_prod), (t('web.sync'), self.sync)):
            pb.addWidget(button(text, fn, 'ghost'))
        pb.addStretch(1)
        v3.addLayout(pb)
        self.tabs.addTab(w3, t('web.p.shop'))
        bottom = QHBoxLayout()
        self.msg = QLabel('')
        bottom.addWidget(self.msg, 1)
        bottom.addWidget(button(t('web.preview'), self.preview, 'ghost'))
        bottom.addWidget(button(t('cal.save'), self.save))
        bottom.addWidget(button(t('cal.close'), self.accept, 'ghost'))
        lay.addLayout(bottom)
        self.refresh_pages()
        self.refresh_products()

    # ---------------------------------------------------------- pages
    def refresh_pages(self, sel=None):
        self.pages.blockSignals(True)
        self.pages.clear()
        for p in self.d['pages']:
            self.pages.addItem('%s   %s' % (p['title'], p['path']))
        self.pages.blockSignals(False)
        self.pi = min(self.pi if sel is None else sel, len(self.d['pages']) - 1)
        self.pages.setCurrentRow(self.pi)
        self.refresh_blocks()

    def pick_page(self, i):
        if i >= 0:
            self.pi = i
            self.refresh_blocks()

    def page(self):
        return self.d['pages'][self.pi]

    def add_page(self):
        n = len(self.d['pages']) + 1
        self.d['pages'].append({'id': uid(), 'path': '/page%d' % n, 'title': t('web.newPage'), 'blocks': [new_block('nav'), new_block('footer')]})
        self.refresh_pages(len(self.d['pages']) - 1)
        self.edit_page()

    def edit_page(self):
        p = self.page()
        d = PropsDialog(self, t('web.edit'), [{'key': 'title', 'label': 'web.pageTitle', 'kind': 'text'}, {'key': 'path', 'label': 'web.pagePath', 'kind': 'text'}], p)
        if d.exec():
            path = d.values['path'].strip() or '/'
            p['title'], p['path'] = d.values['title'], path if path.startswith('/') else '/' + path
            self.refresh_pages()

    def del_page(self):
        if len(self.d['pages']) > 1:
            del self.d['pages'][self.pi]
            self.pi = 0
            self.refresh_pages()

    # ---------------------------------------------------------- blocks
    def refresh_blocks(self, sel=0):
        self.blocks.clear()
        for b in self.page()['blocks']:
            p = b['props']
            first = next((str(p[k]) for k in ('title', 'heading', 'brand', 'text', 'button') if p.get(k)), '')
            self.blocks.addItem('%s   %s' % (t(BLOCKS[b['type']]['label']) if b['type'] in BLOCKS else b['type'], first[:50]))
        if self.page()['blocks']:
            self.blocks.setCurrentRow(min(sel, len(self.page()['blocks']) - 1))

    def bi(self):
        return self.blocks.currentRow()

    def add_block(self):
        bl = self.page()['blocks']
        b = new_block(self.kind.currentData())
        i = self.bi()
        pos = len(bl) - 1 if (bl and bl[-1]['type'] == 'footer') else len(bl)
        bl.insert(pos, b)
        self.refresh_blocks(pos)

    def edit_block(self):
        i = self.bi()
        bl = self.page()['blocks']
        if 0 <= i < len(bl):
            d = PropsDialog(self, t(BLOCKS[bl[i]['type']]['label']), BLOCKS[bl[i]['type']]['fields'], bl[i]['props'])
            if d.exec():
                bl[i]['props'] = d.values
                self.refresh_blocks(i)

    def dup_block(self):
        i, bl = self.bi(), self.page()['blocks']
        if 0 <= i < len(bl):
            c = copy.deepcopy(bl[i])
            c['id'] = uid()
            bl.insert(i + 1, c)
            self.refresh_blocks(i + 1)

    def move_block(self, n):
        i, bl = self.bi(), self.page()['blocks']
        if i >= 0 and 0 <= i + n < len(bl):
            bl[i], bl[i + n] = bl[i + n], bl[i]
            self.refresh_blocks(i + n)

    def del_block(self):
        i, bl = self.bi(), self.page()['blocks']
        if 0 <= i < len(bl):
            del bl[i]
            self.refresh_blocks(i)

    # ---------------------------------------------------------- shop
    def refresh_products(self, sel=0):
        ps = self.d['shop']['products']
        fill_table(self.prod, [[str(p.get(f['key'], '')) for f in PRODUCT_FIELDS] for p in ps], list(range(len(ps))))
        if ps:
            self.prod.selectRow(min(sel, len(ps) - 1))

    def add_prod(self):
        self.d['shop']['products'].append({'sku': 'SKU%d' % (len(self.d['shop']['products']) + 1), 'name': '', 'price': 0, 'category': '', 'description': '', 'image': ''})
        self.refresh_products(len(self.d['shop']['products']) - 1)
        self.edit_prod()

    def edit_prod(self):
        i = self.prod.currentRow()
        ps = self.d['shop']['products']
        if 0 <= i < len(ps):
            d = PropsDialog(self, t('web.edit'), PRODUCT_FIELDS, ps[i])
            if d.exec():
                ps[i] = d.values
                self.refresh_products(i)

    def del_prod(self):
        i = self.prod.currentRow()
        if 0 <= i < len(self.d['shop']['products']):
            del self.d['shop']['products'][i]
            self.refresh_products(i)

    def sync(self):
        def done(lst):
            old = {p['sku']: p for p in self.d['shop']['products']}
            self.d['shop']['products'] = [{'sku': r['code'], 'name': str((r.get('data') or {}).get('name') or r['code']), 'price': float((r.get('data') or {}).get('price') or 0), 'category': str((r.get('data') or {}).get('category') or ''),
                                           'description': old.get(r['code'], {}).get('description', ''), 'image': old.get(r['code'], {}).get('image') or ((r.get('data') or {}).get('image') if isinstance((r.get('data') or {}).get('image'), str) else '')}
                                          for r in lst if r.get('code') and r.get('status') != 'inactive']
            self.shop_on.setChecked(True)
            self.refresh_products()
            self.msg.setText('%d' % len(self.d['shop']['products']))
        run_async(lambda: api.pos_records('product'), done, lambda m: self.msg.setText(t('web.syncFail')))

    # ---------------------------------------------------------- save / preview
    def collect(self):
        th = self.d['theme']
        th.update(primary=self.prim.text().strip() or th['primary'], bg=self.bg.text().strip() or th['bg'], text=self.tx.text().strip() or th['text'], font=self.font.currentData(), dark=self.dark.isChecked())
        try:
            th['radius'] = int(float(self.radius.text()))
        except ValueError:
            pass
        self.d['settings'].update(title=self.title_.text().strip() or self.row['name'], lang=self.lang.text().strip() or 'en', dir=self.dir.currentData())
        if self.desc.text().strip():
            self.d['settings']['description'] = self.desc.text().strip()
        else:
            self.d['settings'].pop('description', None)
        self.d['shop']['enabled'] = self.shop_on.isChecked()
        self.d['shop']['currency'] = self.cur.text().strip() or self.d['shop']['currency']
        return self.d

    def save(self):
        d = self.collect()
        run_async(lambda: api._call('PUT', '/website/sites/' + self.row['id'], {'name': self.row['name'], 'design': d}), lambda r: (self.msg.setText(t('web.saved')), self.on_saved()), lambda m: self.msg.setText(m))

    def preview(self):
        preview_html(render_site(self.collect()), self.row['slug'])


def preview_html(html, slug):
    path = os.path.join(tempfile.gettempdir(), (slug or 'site') + '-preview.html')
    Path(path).write_text(html, encoding='utf-8')
    webbrowser.open('file://' + path)


def public_urls(slug):
    base = api._base(api.session.server)
    return base + '/public/sites/%s/orders' % slug, base + '/public/sites/%s/messages' % slug


class SitePage(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        lay.addWidget(label(t('tab.web'), 'title'))
        bar = QHBoxLayout()
        self.pick = QComboBox()
        self.pick.addItem(t('web.sites'), 'sites')
        if api.can('web.orders.manage'):
            self.pick.addItem(t('web.orders'), 'subs')
        self.pick.currentIndexChanged.connect(lambda *_: self.reload())
        bar.addWidget(self.pick)
        self.btns = {}
        for key, text, fn, kind in (('new', t('web.newSite'), self.new_site, None), ('design', t('web.design'), self.design, None), ('preview', t('web.preview'), self.preview, 'ghost'), ('save', t('web.download'), self.save_html, 'ghost'),
                                    ('pub', t('web.publish'), self.publish, None), ('unpub', t('web.unpublish'), self.unpublish, 'ghost'), ('del', '✕', self.delete, 'danger'),
                                    ('s_new', t('web.st.new'), lambda: self.status('new'), 'ghost'), ('s_conf', t('web.st.confirmed'), lambda: self.status('confirmed'), 'ghost'), ('s_ship', t('web.st.shipped'), lambda: self.status('shipped'), 'ghost'),
                                    ('s_done', t('web.st.done'), lambda: self.status('done'), 'ghost'), ('s_can', t('web.st.cancelled'), lambda: self.status('cancelled'), 'ghost')):
            b = button(text, fn, kind)
            self.btns[key] = b
            bar.addWidget(b)
        bar.addStretch(1)
        lay.addLayout(bar)
        self.table = make_table([])
        lay.addWidget(self.table, 1)
        self.msg = QLabel('')
        lay.addWidget(self.msg)
        self.sites = []

    def mode(self):
        return self.pick.currentData()

    def reload(self):
        subs = self.mode() == 'subs'
        for k, b in self.btns.items():
            if k.startswith('s_'):
                b.setVisible(subs)
            elif k == 'new':
                b.setVisible(not subs and api.can('web.edit'))
            elif k == 'design':
                b.setVisible(not subs and api.can('web.edit'))
            elif k in ('pub', 'unpub', 'del'):
                b.setVisible(not subs and api.can('web.publish'))
            else:
                b.setVisible(not subs)
        self.msg.setText('…')
        if subs:
            self.table.setColumnCount(7)
            self.table.setHorizontalHeaderLabels(['#', t('web.site'), 'Type', t('web.customer'), 'Total', 'Status', 'Date'])
            run_async(lambda: (api._call('GET', '/website/submissions') or [], api._call('GET', '/website/sites') or []), self.show_subs, lambda m: self.msg.setText(m))
        else:
            self.table.setColumnCount(5)
            self.table.setHorizontalHeaderLabels([t('web.siteName'), 'URL', 'Status', 'Currency', t('web.view')])
            run_async(lambda: api._call('GET', '/website/sites') or [], self.show_sites, lambda m: self.msg.setText(m))

    def show_sites(self, rows):
        self.sites = rows
        fill_table(self.table, [[r['name'], '/s/' + r['slug'], t('web.live') if r['published'] else t('web.draft'), r.get('currency') or '', (r.get('updatedAt') or '')[:16].replace('T', ' ')] for r in rows], rows)
        self.msg.setText('' if rows else t('web.none'))

    def show_subs(self, res):
        subs, sites = res
        names = {s['id']: s['name'] for s in sites}
        fill_table(self.table, [[s['number'], names.get(s['siteId'], ''), s['kind'], s['name'] + (' · ' + s['email'] if s.get('email') else ''), '%s %s' % (s['total'], s['currency']) if s['kind'] == 'order' else (s.get('note') or '')[:40], s['status'], s['createdAt'][:16].replace('T', ' ')] for s in subs], subs)
        self.msg.setText('' if subs else t('web.none'))

    def sel(self):
        return current_payload(self.table)

    def new_site(self):
        d = QDialog(self)
        d.setWindowTitle(t('web.newSite'))
        f = QFormLayout(d)
        name, tpl, cur = QLineEdit(), QComboBox(), QLineEdit('SAR')
        for k in ('shop', 'business', 'blank'):
            tpl.addItem(t('web.t.' + k), k)
        f.addRow(t('web.siteName'), name)
        f.addRow(t('web.template'), tpl)
        f.addRow(t('web.currency'), cur)
        f.addRow(button(t('web.create'), d.accept))
        if d.exec() and name.text().strip():
            design = template_design(tpl.currentData(), name.text().strip(), cur.text().strip() or 'SAR')
            body = {'name': name.text().strip(), 'design': design, 'currency': cur.text().strip() or 'SAR'}
            run_async(lambda: api._call('POST', '/website/sites', body), lambda r: (self.reload(), self.open_editor(r)), lambda m: warn(self, m))

    def open_editor(self, row):
        run_async(lambda: api._call('GET', '/website/sites/' + row['id']), lambda r: SiteEditor(self, r, r['design'], self.reload).exec(), lambda m: warn(self, m))

    def design(self):
        r = self.sel()
        if r:
            self.open_editor(r)

    def fetch_design(self, then):
        r = self.sel()
        if r:
            run_async(lambda: api._call('GET', '/website/sites/' + r['id']), lambda full: then(r, full['design']), lambda m: warn(self, m))

    def html_for(self, r, d, publish=False):
        if publish:
            o, m = public_urls(r['slug'])
            return render_site(d, o, m, 'publish')
        return render_site(d)

    def preview(self):
        self.fetch_design(lambda r, d: preview_html(self.html_for(r, d), r['slug']))

    def save_html(self):
        def go(r, d):
            path, _ = QFileDialog.getSaveFileName(self, t('web.download'), r['slug'] + '.html', 'HTML (*.html)')
            if path:
                Path(path).write_text(self.html_for(r, d), encoding='utf-8')
                self.msg.setText(path)
        self.fetch_design(go)

    def publish(self):
        def go(r, d):
            html = self.html_for(r, d, True)
            prods = [{'sku': p['sku'], 'name': p['name'], 'price': p['price']} for p in d['shop']['products']]
            run_async(lambda: api._call('POST', '/website/sites/%s/publish' % r['id'], {'html': html, 'products': prods, 'currency': d['shop']['currency']}),
                      lambda _: (self.reload(), self.msg.setText(t('web.isLive'))), lambda m: warn(self, m))
        self.fetch_design(go)

    def unpublish(self):
        r = self.sel()
        if r:
            run_async(lambda: api._call('POST', '/website/sites/%s/unpublish' % r['id'], {}), lambda _: self.reload(), lambda m: warn(self, m))

    def delete(self):
        r = self.sel()
        if r and QMessageBox.question(self, '', t('web.deleteAsk', n=r['name'])) == QMessageBox.Yes:
            run_async(lambda: api._call('DELETE', '/website/sites/' + r['id']), lambda _: self.reload(), lambda m: warn(self, m))

    def status(self, s):
        r = self.sel()
        if r:
            run_async(lambda: api._call('PUT', '/website/submissions/' + r['id'], {'status': s}), lambda _: self.reload(), lambda m: warn(self, m))
