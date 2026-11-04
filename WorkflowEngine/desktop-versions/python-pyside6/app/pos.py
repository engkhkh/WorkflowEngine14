"""Point of sale: the till, shifts and sales history with receipts (port of the portal's /pos/terminal, /pos/shifts, /pos/sales)."""
import json
import uuid
from datetime import date, datetime, timedelta

from PySide6.QtCore import QSettings, QSize, Qt
from PySide6.QtGui import QTextDocument
from PySide6.QtPrintSupport import QPrintDialog, QPrinter
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QDialog, QDoubleSpinBox, QFormLayout, QFrame, QHBoxLayout, QLabel, QLineEdit, QListWidget,
                               QListWidgetItem, QPushButton, QSpinBox, QTabWidget, QTextBrowser, QVBoxLayout, QWidget)

from app.api import ApiError, api
from app.i18n import t
from app.ui import button, current_payload, fill_table, label, make_table, run_async, warn

DEFAULTS = dict(taxRate=15, pricesIncludeTax=True, pointsPerCurrency=1, pointValue=0.05, requireShift=True, allowNegativeStock=False, maxDiscountPct=20, receiptHeader='', receiptFooter='')


def r2(n):
    return round(n + 1e-9, 2)


def money(n):
    return '{:,.2f}'.format(float(n or 0))


# ---------------------------------------------------------------- pricing (same rules the server applies at checkout)
def best_promo(promos, branch, sku, category, qty, price):
    best, code = 0.0, None
    today = date.today().isoformat()
    for pr in promos:
        if pr.get('status') and pr['status'] != 'Active':
            continue
        p = pr.get('data') or {}
        if p.get('from') and today < str(p['from'])[:10]:
            continue
        if p.get('to') and today > str(p['to'])[:10]:
            continue
        br = [x.strip() for x in str(p.get('branches') or '').split(',') if x.strip()]
        if br and branch and branch not in br:
            continue
        scope, target = p.get('scope') or 'all', str(p.get('target') or '').lower()
        if scope == 'sku' and target != sku.lower():
            continue
        if scope == 'category' and target != category.lower():
            continue
        gross, v = price * qty, float(p.get('value') or 0)
        disc = 0.0
        if p.get('type') == 'pct':
            disc = gross * v / 100
        elif p.get('type') == 'amount':
            disc = min(gross, v * qty)
        elif p.get('type') == 'qty' and qty >= max(1, float(p.get('minQty') or 1)):
            disc = gross * v / 100
        if disc > best:
            best, code = disc, pr.get('code')
    return r2(best), code


def price_cart(items, products, promos, customer, order_pct, cfg, branch):
    s = dict(DEFAULTS, **(cfg or {}))
    cust_pct = float(((customer or {}).get('data') or {}).get('discountPct') or 0)
    by = {(p.get('code') or '').lower(): p for p in products}
    lines = []
    for it in items:
        p = by.get(it['sku'].lower())
        if not p:
            continue
        d = p['data']
        price = float(d.get('price') or 0)
        gross = r2(price * it['qty'])
        pd, pcode = best_promo(promos, branch, p['code'], str(d.get('category') or ''), it['qty'], price)
        rest = gross - pd
        manual = r2(rest * it.get('discountPct', 0) / 100)
        rest -= manual
        cust = r2(rest * cust_pct / 100)
        rest -= cust
        order = r2(rest * order_pct / 100)
        rest -= order
        net = r2(rest)
        tr = d.get('taxRate')
        rate = s['taxRate'] if tr in (None, '') else float(tr)
        if s['pricesIncludeTax']:
            tax = r2(net - net / (1 + rate / 100))
        else:
            tax = r2(net * rate / 100)
            net = r2(net + tax)
        lines.append(dict(sku=p['code'], name=d.get('name') or p['code'], qty=it['qty'], price=price, gross=gross, promo=pd, promoCode=pcode,
                          discount=r2(pd + manual + cust + order), tax=tax, total=net, discountPct=it.get('discountPct', 0)))
    return dict(lines=lines, subtotal=r2(sum(l['gross'] for l in lines)), discount=r2(sum(l['discount'] for l in lines)),
                tax=r2(sum(l['tax'] for l in lines)), total=r2(sum(l['total'] for l in lines)))


# ---------------------------------------------------------------- shared state
class PosState:
    def __init__(self):
        self.products, self.categories, self.customers, self.promos, self.registers = [], [], [], [], []
        self.settings, self.shift, self.stock = dict(DEFAULTS), None, {}
        self.loaded = False

    @property
    def branch(self):
        return ''

    def load(self):
        """blocking - run on a worker thread"""
        co = None
        self.products = api.pos_records('product', take=5000)
        self.categories = _safe(lambda: api.pos_records('category'))
        self.customers = _safe(lambda: api.pos_records('customer', take=5000))
        self.promos = _safe(lambda: api.pos_records('promotion'))
        self.registers = _safe(lambda: api.pos_records('register'))
        st = next((x for x in _safe(lambda: api.pos_records('setting')) if x.get('code') == 'pos'), None)
        self.settings = dict(DEFAULTS, **((st or {}).get('data') or {}))
        self.shift = api.pos_shift()
        self.stock = {str(x['data'].get('sku')): float(x['data'].get('qty') or 0) for x in _safe(lambda: api.pos_records('stock'))}
        self.loaded = True
        return self


def _safe(fn):
    try:
        return fn() or []
    except ApiError as e:
        if e.offline:
            raise
        return []


def _offline_queue():
    try:
        return json.loads(QSettings('WorkflowEngine', 'ErpPySide').value('pos_queue', '[]'))
    except Exception:
        return []


def _save_queue(q):
    QSettings('WorkflowEngine', 'ErpPySide').setValue('pos_queue', json.dumps(q))


# ---------------------------------------------------------------- receipt
def receipt_html(sale, state):
    d = sale['data']
    esc = lambda x: str(x if x is not None else '').replace('&', '&amp;').replace('<', '&lt;')  # noqa: E731
    cur = ''
    rows = ''.join(f"<tr><td>{esc(l['name'])}<br><small>{l['qty']} × {money(l['price'])}" + (f" · −{money(l['discount'])}" if l.get('discount') else '') + f"</small></td><td align='right'>{money(l['total'])}</td></tr>" for l in d.get('lines', []))
    pays = ''.join(f"<tr><td>{t('pos.pay.' + p['method'])}</td><td align='right'>{money(p['amount'])}</td></tr>" for p in d.get('payments') or [])
    head = state.settings.get('receiptHeader') or ''
    foot = state.settings.get('receiptFooter') or ''
    title = t('pos.rc.return') if d.get('type') == 'Return' else t('pos.rc.receipt')
    h = f"<div style='font-family:Consolas,monospace;font-size:12px;width:290px'><div align='center'><b>{esc(api.session.tenant)}</b><br>{esc(head)}</div><hr>"
    h += f"<table width='100%'><tr><td>{title}</td><td align='right'>{esc(sale.get('code'))}</td></tr>"
    if sale.get('parent'):
        h += f"<tr><td>{t('pos.rc.original')}</td><td align='right'>{esc(sale['parent'])}</td></tr>"
    h += f"<tr><td>{esc((sale.get('createdAt') or '')[:16].replace('T', ' '))}</td><td align='right'>{esc(d.get('cashier'))}</td></tr>"
    if d.get('customerName'):
        h += f"<tr><td>{t('pos.customer')}</td><td align='right'>{esc(d['customerName'])}</td></tr>"
    h += f"</table><hr><table width='100%'>{rows}</table><hr><table width='100%'>"
    if d.get('subtotal'):
        h += f"<tr><td>{t('pos.subtotal')}</td><td align='right'>{money(d['subtotal'])}</td></tr>"
    if d.get('discount'):
        h += f"<tr><td>{t('pos.discount')}</td><td align='right'>−{money(d['discount'])}</td></tr>"
    h += f"<tr><td>{t('pos.tax')}</td><td align='right'>{money(d.get('tax'))}</td></tr>"
    h += f"<tr><td><b>{t('pos.total')}</b></td><td align='right'><b>{money(d.get('total'))}</b></td></tr>{pays}"
    if d.get('change'):
        h += f"<tr><td>{t('pos.change')}</td><td align='right'>{money(d['change'])}</td></tr>"
    if d.get('earned'):
        h += f"<tr><td>{t('pos.pointsEarned')}</td><td align='right'>{d['earned']}</td></tr>"
    h += f"</table><hr><div align='center'>{esc(foot)}<br><small>{t('pos.rc.thanks')}</small></div></div>"
    return h


class ReceiptDialog(QDialog):
    def __init__(self, sale, state, parent=None, title=None):
        super().__init__(parent)
        self.setWindowTitle(title or t('pos.saleDone'))
        self.setMinimumSize(360, 520)
        lay = QVBoxLayout(self)
        self.view = QTextBrowser()
        self.html = receipt_html(sale, state)
        self.view.setHtml(self.html)
        lay.addWidget(self.view, 1)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(button(t('pos.print'), self.print_, 'ghost'))
        row.addWidget(button(t('common.ok'), self.accept))
        lay.addLayout(row)

    def print_(self):
        pr = QPrinter(QPrinter.HighResolution)
        if QPrintDialog(pr, self).exec():
            doc = QTextDocument()
            doc.setHtml(self.html)
            doc.print_(pr)


# ---------------------------------------------------------------- small dialogs
def _num_edit(maximum=1e9):
    s = QDoubleSpinBox()
    s.setDecimals(2)
    s.setRange(0, maximum)
    s.setSingleStep(1)
    return s


class PayDialog(QDialog):
    def __init__(self, total, customer, state, parent=None):
        super().__init__(parent)
        self.state, self.customer, self.total = state, customer, total
        self.setWindowTitle(f"{t('pos.pay')} · {money(total)}")
        self.setMinimumWidth(380)
        lay = QVBoxLayout(self)
        form = QFormLayout()
        self.cash, self.card, self.other = _num_edit(), _num_edit(), _num_edit()
        for w in (self.cash, self.card, self.other):
            w.valueChanged.connect(self.recalc)
        form.addRow(t('pos.pay.cash'), self.cash)
        form.addRow(t('pos.pay.card'), self.card)
        form.addRow(t('pos.pay.other'), self.other)
        pts = int(((customer or {}).get('data') or {}).get('points') or 0)
        self.redeem = QSpinBox()
        self.redeem.setRange(0, pts)
        self.redeem.valueChanged.connect(self.recalc)
        if pts > 0:
            form.addRow(f"{t('pos.redeem')} ({pts})", self.redeem)
        lay.addLayout(form)
        quick = QHBoxLayout()
        quick.addWidget(button(t('pos.exactCash'), lambda: self.exact(self.cash), 'ghost'))
        quick.addWidget(button(t('pos.exactCard'), lambda: self.exact(self.card), 'ghost'))
        for n in (50, 100, 200, 500):
            quick.addWidget(button(str(n), lambda n=n: (self.card.setValue(0), self.other.setValue(0), self.cash.setValue(n)), 'ghost'))
        lay.addLayout(quick)
        self.sum = QLabel()
        self.sum.setTextFormat(Qt.RichText)
        lay.addWidget(self.sum)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(button(t('common.cancel'), self.reject, 'ghost'))
        self.ok = button(t('pos.complete'), self.accept)
        row.addWidget(self.ok)
        lay.addLayout(row)
        self.recalc()

    def redeem_value(self):
        return r2(self.redeem.value() * float(self.state.settings['pointValue']))

    def due(self):
        return r2(max(0, self.total - min(self.redeem_value(), self.total)))

    def tendered(self):
        return r2(self.cash.value() + self.card.value() + self.other.value())

    def remaining(self):
        return r2(self.due() - self.tendered())

    def exact(self, w):
        self.cash.setValue(0)
        self.card.setValue(0)
        self.other.setValue(0)
        w.setValue(self.due())

    def recalc(self):
        rem = self.remaining()
        col = '#dc2626' if rem > 0 else '#16a34a'
        self.sum.setText(f"{t('pos.due')}: <b>{money(self.due())}</b><br>{t('pos.tendered')}: <b>{money(self.tendered())}</b><br>"
                         f"<span style='color:{col}'>{t('pos.remaining') if rem > 0 else t('pos.change')}: <b>{money(abs(rem))}</b></span>")
        self.ok.setEnabled(rem <= 0.004)

    def payments(self):
        out = []
        for m, w in (('cash', self.cash), ('card', self.card), ('other', self.other)):
            if w.value() > 0:
                out.append({'method': m, 'amount': w.value()})
        return out


class AmountDialog(QDialog):
    def __init__(self, title, amount_label, note_label, hint=None, parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setMinimumWidth(340)
        lay = QVBoxLayout(self)
        form = QFormLayout()
        self.amount = _num_edit()
        self.note = QLineEdit()
        form.addRow(amount_label, self.amount)
        form.addRow(note_label, self.note)
        lay.addLayout(form)
        if hint:
            lay.addWidget(label(hint, 'dim'))
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(button(t('common.cancel'), self.reject, 'ghost'))
        row.addWidget(button(t('admin.save'), self.accept))
        lay.addLayout(row)


# ---------------------------------------------------------------- the till
class TillView(QWidget):
    def __init__(self, state, on_shift):
        super().__init__()
        self.state, self.on_shift = state, on_shift
        self.cart, self.order_pct, self.customer_code = [], 0, ''
        self.busy = False
        root = QVBoxLayout(self)
        self.banner = label('', 'error')
        root.addWidget(self.banner)
        self.queue_row = QHBoxLayout()
        self.queue_lbl = label('', 'dim')
        self.queue_btn = button(t('pos.syncNow'), self.flush, 'ghost')
        self.queue_row.addWidget(self.queue_lbl, 1)
        self.queue_row.addWidget(self.queue_btn)
        root.addLayout(self.queue_row)
        # no shift gate
        self.gate = QFrame()
        self.gate.setProperty('card', True)
        g = QVBoxLayout(self.gate)
        g.addWidget(label(t('pos.shift.none'), 'title'))
        g.addWidget(label(t('pos.shift.noneHint'), 'dim'))
        f = QFormLayout()
        self.reg = QComboBox()
        self.float = _num_edit()
        f.addRow(t('pos.register'), self.reg)
        f.addRow(t('pos.shift.opening'), self.float)
        g.addLayout(f)
        g.addWidget(button(t('pos.shift.open'), self.open_shift))
        root.addWidget(self.gate)
        # till
        self.till = QWidget()
        h = QHBoxLayout(self.till)
        left = QVBoxLayout()
        bar = QHBoxLayout()
        self.q = QLineEdit()
        self.q.setPlaceholderText(t('pos.scan'))
        self.q.textChanged.connect(self.fill_products)
        self.q.returnPressed.connect(self.scan)
        self.cat = QComboBox()
        self.cat.currentIndexChanged.connect(self.fill_products)
        self.shift_lbl = label('', 'dim')
        bar.addWidget(self.q, 1)
        bar.addWidget(self.cat)
        bar.addWidget(self.shift_lbl)
        left.addLayout(bar)
        self.grid = QListWidget()
        self.grid.setViewMode(QListWidget.IconMode)
        self.grid.setResizeMode(QListWidget.Adjust)
        self.grid.setMovement(QListWidget.Static)
        self.grid.setSpacing(6)
        self.grid.setWordWrap(True)
        self.grid.setUniformItemSizes(True)
        self.grid.setGridSize(QSize(196, 104))
        self.grid.setTextElideMode(Qt.ElideNone)
        self.grid.itemClicked.connect(lambda it: self.add(it.data(Qt.UserRole)))
        left.addWidget(self.grid, 1)
        h.addLayout(left, 3)
        right = QFrame()
        right.setProperty('card', True)
        right.setMinimumWidth(360)
        r = QVBoxLayout(right)
        self.cust = QComboBox()
        self.cust.currentIndexChanged.connect(self.on_customer)
        r.addWidget(self.cust)
        self.cust_info = label('', 'dim')
        r.addWidget(self.cust_info)
        self.lines = make_table([t('pos.product'), '#', t('pos.total')])
        self.lines.horizontalHeader().setSectionResizeMode(0, self.lines.horizontalHeader().ResizeMode.Stretch)
        r.addWidget(self.lines, 1)
        qrow = QHBoxLayout()
        qrow.addWidget(button('−', lambda: self.bump(-1), 'ghost'))
        qrow.addWidget(button('+', lambda: self.bump(1), 'ghost'))
        qrow.addWidget(button('✕', self.remove_line, 'ghost'))
        self.line_disc = QSpinBox()
        self.line_disc.setRange(0, 100)
        self.line_disc.setSuffix(' %')
        self.line_disc.setToolTip(t('pos.lineDisc'))
        self.line_disc.valueChanged.connect(self.set_line_disc)
        qrow.addWidget(self.line_disc)
        r.addLayout(qrow)
        orow = QHBoxLayout()
        orow.addWidget(QLabel(t('pos.orderDisc')))
        self.order = QSpinBox()
        self.order.setRange(0, 100)
        self.order.setSuffix(' %')
        self.order.valueChanged.connect(self.set_order)
        orow.addWidget(self.order)
        r.addLayout(orow)
        self.tot = QLabel()
        self.tot.setTextFormat(Qt.RichText)
        self.tot.setMinimumHeight(96)
        r.addWidget(self.tot)
        b = QHBoxLayout()
        self.hold_b = button(t('pos.hold'), self.hold, 'ghost')
        self.recall_b = button(t('pos.recall'), self.recall, 'ghost')
        self.clear_b = button(t('pos.clear'), self.clear, 'ghost')
        self.pay_b = button(t('pos.pay'), self.pay)
        for w in (self.hold_b, self.recall_b, self.clear_b):
            b.addWidget(w)
        r.addLayout(b)
        r.addWidget(self.pay_b)
        h.addWidget(right, 2)
        root.addWidget(self.till, 1)

    # -- data
    def refresh(self):
        s = self.state
        self.reg.clear()
        self.reg.addItem('—', '')
        for x in s.registers:
            self.reg.addItem(f"{x['code']} · {x['data'].get('name', '')}", x['code'])
        gate = not s.shift and s.settings.get('requireShift')
        self.gate.setVisible(bool(gate))
        self.till.setVisible(not gate)
        self.shift_lbl.setText(s.shift['code'] if s.shift else '')
        self.cat.blockSignals(True)
        self.cat.clear()
        self.cat.addItem(t('pos.all'), '')
        for c in sorted({str(p['data'].get('category') or '') for p in s.products if p['data'].get('category')}):
            cr = next((x for x in s.categories if x.get('code') == c), None)
            nm = (cr['data'].get('nameAr') if cr and self._ar() and cr['data'].get('nameAr') else (cr['data'].get('name') if cr else c)) or c
            self.cat.addItem(nm, c)
        self.cat.blockSignals(False)
        self.cust.blockSignals(True)
        self.cust.clear()
        self.cust.addItem(t('pos.walkin'), '')
        for c in s.customers:
            self.cust.addItem(f"{c['data'].get('name')} · {c['code']}", c['code'])
        i = self.cust.findData(self.customer_code)
        self.cust.setCurrentIndex(max(0, i))
        self.cust.blockSignals(False)
        self.fill_products()
        self.repaint_cart()
        self.update_queue()

    @staticmethod
    def _ar():
        from app import i18n
        return i18n.rtl()

    def update_queue(self):
        n = len(_offline_queue())
        self.queue_lbl.setText(t('pos.queued', n=n) if n else '')
        self.queue_lbl.setVisible(bool(n))
        self.queue_btn.setVisible(bool(n))

    def stock_of(self, p):
        if not p['data'].get('trackStock'):
            return None
        return self.state.stock.get(p['code'], 0)

    def sold_out(self, p):
        s = self.stock_of(p)
        return s is not None and s <= 0 and not self.state.settings.get('allowNegativeStock')

    def fill_products(self):
        q, c = self.q.text().lower().strip(), self.cat.currentData() or ''
        self.grid.clear()
        n = 0
        for p in self.state.products:
            d = p['data']
            if p.get('status') == 'Inactive' or (c and d.get('category') != c):
                continue
            if q and q not in str(d.get('name') or '').lower() and q not in (p.get('code') or '').lower() and q not in str(d.get('barcode') or '').lower():
                continue
            st = self.stock_of(p)
            promo = ' %' if any(x.get('status') == 'Active' and (x['data'].get('scope') == 'all' or str(x['data'].get('target')).lower() == p['code'].lower()) for x in self.state.promos) else ''
            it = QListWidgetItem(f"{d.get('name')}\n{money(d.get('price'))}{promo}\n{p['code']}" + (f" · {t('pos.left', n=int(st))}" if st is not None else ''))
            it.setData(Qt.UserRole, p['code'])
            if self.sold_out(p):
                it.setFlags(Qt.NoItemFlags)
            self.grid.addItem(it)
            n += 1
            if n >= 80:
                break

    def customer(self):
        return next((c for c in self.state.customers if c['code'] == self.customer_code), None)

    def priced(self):
        return price_cart(self.cart, self.state.products, self.state.promos, self.customer(), self.order_pct, self.state.settings, '')

    # -- cart
    def scan(self):
        t_ = self.q.text().strip().lower()
        if not t_:
            return
        exact = next((p for p in self.state.products if (p.get('code') or '').lower() == t_ or str(p['data'].get('barcode') or '').lower() == t_), None)
        if exact:
            self.add(exact['code'])
            self.q.clear()
        elif self.grid.count() == 1:
            self.add(self.grid.item(0).data(Qt.UserRole))
            self.q.clear()
        else:
            self.banner.setText(t('pos.notFound'))

    def add(self, sku):
        self.banner.setText('')
        for l in self.cart:
            if l['sku'] == sku:
                l['qty'] += 1
                break
        else:
            self.cart.append(dict(sku=sku, qty=1, discountPct=0))
        self.repaint_cart(len(self.cart) - 1 if self.cart[-1]['sku'] == sku else None)

    def sel(self):
        r = self.lines.currentRow()
        return r if 0 <= r < len(self.cart) else -1

    def bump(self, d):
        i = self.sel()
        if i < 0:
            return
        self.cart[i]['qty'] += d
        if self.cart[i]['qty'] <= 0:
            del self.cart[i]
        self.repaint_cart(min(i, len(self.cart) - 1))

    def remove_line(self):
        i = self.sel()
        if i >= 0:
            del self.cart[i]
            self.repaint_cart(min(i, len(self.cart) - 1))

    def set_line_disc(self, v):
        i = self.sel()
        if i >= 0 and self.cart[i]['discountPct'] != v:
            self.cart[i]['discountPct'] = min(v, int(self.state.settings['maxDiscountPct']))
            self.repaint_cart(i)

    def set_order(self, v):
        self.order_pct = min(v, int(self.state.settings['maxDiscountPct']))
        self.repaint_cart(self.sel())

    def on_customer(self):
        self.customer_code = self.cust.currentData() or ''
        self.repaint_cart(self.sel())

    def repaint_cart(self, select=None):
        p = self.priced()
        rows = [[l['name'] + (f"  [{l['promoCode']}]" if l.get('promoCode') else ''), str(l['qty']), money(l['total'])] for l in p['lines']]
        fill_table(self.lines, rows, p['lines'])
        if select is not None and 0 <= select < len(rows):
            self.lines.selectRow(select)
        i = self.sel()
        self.line_disc.blockSignals(True)
        self.line_disc.setValue(self.cart[i]['discountPct'] if i >= 0 else 0)
        self.line_disc.blockSignals(False)
        self.order.blockSignals(True)
        self.order.setValue(self.order_pct)
        self.order.blockSignals(False)
        c = self.customer()
        self.cust_info.setText(f"{t('pos.points')}: {int(c['data'].get('points') or 0)}" + (f" · {c['data'].get('discountPct')}%" if c['data'].get('discountPct') else '') if c else '')
        cur = (api.session.tenant and '') or ''
        h = f"{t('pos.subtotal')}: {money(p['subtotal'])}<br>"
        if p['discount']:
            h += f"{t('pos.discount')}: −{money(p['discount'])}<br>"
        h += f"{t('pos.tax')}: {money(p['tax'])}<br><span style='font-size:18px'><b>{t('pos.total')}: {money(p['total'])}</b></span>"
        self.tot.setText(h)
        has = bool(self.cart)
        self.pay_b.setEnabled(has)
        self.hold_b.setEnabled(has)
        self.clear_b.setEnabled(has)
        self.recall_b.setVisible(bool(self.held()))
        self.recall_b.setText(f"{t('pos.recall')} ({len(self.held())})")
        if not has:
            self.lines.setRowCount(0)

    def clear(self):
        self.cart, self.order_pct, self.customer_code = [], 0, ''
        self.cust.blockSignals(True)
        self.cust.setCurrentIndex(0)
        self.cust.blockSignals(False)
        self.repaint_cart()

    # -- held baskets
    def held(self):
        try:
            return json.loads(QSettings('WorkflowEngine', 'ErpPySide').value('pos_held:' + api.session.username, '[]'))
        except Exception:
            return []

    def _save_held(self, h):
        QSettings('WorkflowEngine', 'ErpPySide').setValue('pos_held:' + api.session.username, json.dumps(h))

    def hold(self):
        self._save_held(self.held() + [dict(id=str(uuid.uuid4()), at=datetime.now().strftime('%H:%M'), cart=self.cart, customer=self.customer_code)])
        self.clear()

    def recall(self):
        h = self.held()
        if not h:
            return
        d = QDialog(self)
        d.setWindowTitle(t('pos.recall'))
        lay = QVBoxLayout(d)
        lst = QListWidget()
        for x in h:
            it = QListWidgetItem(f"{x['at']} · {len(x['cart'])} {t('pos.items')}")
            it.setData(Qt.UserRole, x['id'])
            lst.addItem(it)
        lst.setCurrentRow(0)
        lay.addWidget(lst)
        row = QHBoxLayout()
        pick = {}

        def do(drop):
            it = lst.currentItem()
            if it:
                pick['id'], pick['drop'] = it.data(Qt.UserRole), drop
                d.accept()
        row.addWidget(button(t('pos.recallOne'), lambda: do(False)))
        row.addWidget(button(t('btn.delete') if t('btn.delete') != 'btn.delete' else '🗑', lambda: do(True), 'danger'))
        row.addWidget(button(t('common.cancel'), d.reject, 'ghost'))
        lay.addLayout(row)
        if d.exec() and pick:
            x = next(i for i in h if i['id'] == pick['id'])
            self._save_held([i for i in h if i['id'] != x['id']])
            if not pick['drop']:
                self.cart, self.customer_code = x['cart'], x.get('customer', '')
                self.cust.blockSignals(True)
                self.cust.setCurrentIndex(max(0, self.cust.findData(self.customer_code)))
                self.cust.blockSignals(False)
            self.repaint_cart()

    # -- shift
    def open_shift(self):
        body = {'register': self.reg.currentData() or None, 'openingCash': self.float.value()}
        run_async(lambda: api.pos_open(body), lambda s: (setattr(self.state, 'shift', s), self.on_shift()), lambda m: self.banner.setText(m))

    # -- checkout
    def pay(self):
        if self.busy or not self.cart:
            return
        p = self.priced()
        dlg = PayDialog(p['total'], self.customer(), self.state, self)
        if not dlg.exec():
            return
        body = dict(branch='', register=(self.state.shift or {}).get('ref'), customer=self.customer_code or None, lines=self.cart, payments=dlg.payments(),
                    discountPct=self.order_pct, redeemPoints=dlg.redeem.value(), localId=str(uuid.uuid4()))
        self.busy = True

        def ok(sale):
            self.busy = False
            self.done(sale)

        def fail(m, offline=False):
            self.busy = False
            self.banner.setText(m)

        def err(m):
            # the network is down: keep the sale, show a provisional receipt, send it later
            if _is_offline(m):
                q = _offline_queue() + [body]
                _save_queue(q)
                self.busy = False
                pp = self.priced()
                sale = dict(code=t('pos.offlineCode'), status='Queued', createdAt=datetime.now().isoformat(), parent=None,
                            data=dict(type='Sale', lines=pp['lines'], subtotal=pp['subtotal'], discount=pp['discount'], tax=pp['tax'], total=pp['total'],
                                      payments=body['payments'], change=max(0, -dlg.remaining()), cashier=api.session.username))
                self.done(sale, queued=True)
            else:
                fail(m)
        run_async(lambda: api.pos_checkout(body), ok, err)

    def done(self, sale, queued=False):
        self.clear()
        self.update_queue()
        ReceiptDialog(sale, self.state, self).exec()
        self.on_shift()   # reloads stock, points and the shift totals

    def flush(self):
        q = _offline_queue()
        if not q:
            return

        def work():
            left = []
            for i, b in enumerate(q):
                try:
                    api.pos_checkout(b)
                except ApiError as e:
                    if e.offline:
                        left = q[i:]
                        break
                    # refused by the server: dropped from the queue (the portal moves it to a "rejected" list)
            return left
        run_async(work, lambda left: (_save_queue(left), self.update_queue(), self.on_shift()))


def _is_offline(m):
    m = (m or '').lower()
    return any(k in m for k in ('refused', 'unreachable', 'timed out', 'name or service', 'getaddrinfo', 'no route', 'errno'))


# ---------------------------------------------------------------- shifts
class ShiftsView(QWidget):
    def __init__(self, state, on_change):
        super().__init__()
        self.state, self.on_change = state, on_change
        root = QVBoxLayout(self)
        self.msg = label('', 'dim')
        root.addWidget(self.msg)
        self.card = QFrame()
        self.card.setProperty('card', True)
        cl = QVBoxLayout(self.card)
        self.head = label('', 'title')
        cl.addWidget(self.head)
        self.kv = QLabel()
        self.kv.setTextFormat(Qt.RichText)
        cl.addWidget(self.kv)
        row = QHBoxLayout()
        self.b_in = button(t('pos.shift.cashIn'), lambda: self.cash('in'), 'ghost')
        self.b_out = button(t('pos.shift.cashOut'), lambda: self.cash('out'), 'ghost')
        self.b_close = button(t('pos.shift.close'), self.close_shift)
        self.reg = QComboBox()
        self.float = _num_edit()
        self.b_open = button(t('pos.shift.open'), self.open_shift)
        for w in (self.reg, self.float, self.b_open, self.b_in, self.b_out, self.b_close):
            row.addWidget(w)
        row.addStretch(1)
        cl.addLayout(row)
        root.addWidget(self.card)
        root.addWidget(label(t('pos.shift.history'), 'title'))
        self.table = make_table([t('pos.code'), t('pos.cashier'), t('pos.opened'), t('pos.status'), t('pos.shift.sales'), t('pos.shift.expected'), t('pos.shift.counted'), t('pos.shift.variance'), t('pos.shift.journal')])
        root.addWidget(self.table, 1)

    def refresh(self):
        s = self.state.shift
        self.reg.clear()
        self.reg.addItem('—', '')
        for x in self.state.registers:
            self.reg.addItem(f"{x['code']} · {x['data'].get('name', '')}", x['code'])
        for w in (self.reg, self.float, self.b_open):
            w.setVisible(not s)
        for w in (self.b_in, self.b_out, self.b_close):
            w.setVisible(bool(s))
        if s:
            d = s['data']
            self.head.setText(f"{t('pos.shift.current')} · {s['code']}")
            self.kv.setText(' &nbsp;&nbsp; '.join([
                f"{t('pos.shift.opening')}: <b>{money(d.get('opening'))}</b>", f"{t('pos.shift.cashSales')}: <b>{money(d.get('cashSales'))}</b>",
                f"{t('pos.shift.cardSales')}: <b>{money((d.get('cardSales') or 0) + (d.get('otherSales') or 0))}</b>", f"{t('pos.shift.refunds')}: <b>{money(d.get('returnsTotal'))}</b>",
                f"{t('pos.shift.cashIn')} / {t('pos.shift.cashOut')}: <b>{money(d.get('cashIn'))} / {money(d.get('cashOut'))}</b>", f"{t('pos.shift.sales')}: <b>{d.get('salesCount') or 0}</b>"]))
        else:
            self.head.setText(t('pos.shift.none'))
            self.kv.setText('')
        run_async(lambda: api.pos_records('shift', take=200), self.fill, lambda m: self.msg.setText(m))

    def fill(self, rows):
        rows = sorted(rows, key=lambda r: r.get('createdAt') or '', reverse=True)
        out = []
        for r in rows:
            d = r['data']
            out.append([r.get('code') or '', r.get('createdBy') or '', (r.get('createdAt') or '')[:16].replace('T', ' '), t('pos.st.' + (r.get('status') or 'Open')), money(d.get('salesTotal')),
                        money(d['expected']) if 'expected' in d else '', money(d['counted']) if 'counted' in d else '', money(d['variance']) if r.get('status') == 'Closed' else '', d.get('journal') or ''])
        fill_table(self.table, out, rows)

    def flash(self, text):
        self.msg.setText(text)

    def open_shift(self):
        body = {'register': self.reg.currentData() or None, 'openingCash': self.float.value()}
        run_async(lambda: api.pos_open(body), lambda s: (setattr(self.state, 'shift', s), self.flash(t('pos.shift.opened')), self.on_change()), lambda m: warn(self, m))

    def cash(self, typ):
        d = AmountDialog(t('pos.shift.cashIn' if typ == 'in' else 'pos.shift.cashOut'), t('pos.amount'), t('pos.reason'), parent=self)
        if not d.exec():
            return
        if not d.amount.value() > 0:
            return warn(self, t('pos.required'))
        sid = self.state.shift['id']
        run_async(lambda: api.pos_cash(sid, typ, d.amount.value(), d.note.text()), lambda s: (setattr(self.state, 'shift', s), self.flash(t('pos.saved')), self.on_change()), lambda m: warn(self, m))

    def close_shift(self):
        d = AmountDialog(t('pos.shift.close'), t('pos.shift.countedCash'), t('pos.note'), t('pos.shift.closeHint'), self)
        if not d.exec():
            return
        sid = self.state.shift['id']

        def ok(r):
            self.state.shift = None
            dd = r['data']
            warn_box = QDialog(self)
            warn_box.setWindowTitle(f"{t('pos.shift.closed')} · {r['code']}")
            lay = QVBoxLayout(warn_box)
            lay.addWidget(QLabel(f"{t('pos.shift.expected')}: <b>{money(dd.get('expected'))}</b><br>{t('pos.shift.counted')}: <b>{money(dd.get('counted'))}</b><br>"
                                 f"{t('pos.shift.variance')}: <b>{money(dd.get('variance'))}</b><br>{t('pos.shift.journal')}: <b>{dd.get('journal') or ''}</b>"))
            lay.addWidget(button(t('common.ok'), warn_box.accept))
            warn_box.exec()
            self.on_change()
        run_async(lambda: api.pos_close(sid, d.amount.value(), d.note.text()), ok, lambda m: warn(self, m))


# ---------------------------------------------------------------- sales history
class ReturnDialog(QDialog):
    def __init__(self, sale, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"{t('pos.rc.return')} · {sale['code']}")
        self.setMinimumWidth(480)
        lay = QVBoxLayout(self)
        self.spins = []
        form = QFormLayout()
        for l in sale['data']['lines']:
            sp = QSpinBox()
            left = int(l['qty'] - (l.get('returned') or 0))
            sp.setRange(0, max(0, left))
            self.spins.append((l['sku'], sp))
            form.addRow(f"{l['name']}  ({t('pos.sold')} {l['qty']} / {t('pos.alreadyReturned')} {l.get('returned') or 0})", sp)
        lay.addLayout(form)
        f2 = QFormLayout()
        self.method = QComboBox()
        self.method.addItem(t('pos.pay.cash'), 'cash')
        self.method.addItem(t('pos.pay.card'), 'card')
        self.reason = QLineEdit()
        f2.addRow(t('pos.refundMethod'), self.method)
        f2.addRow(t('pos.reason'), self.reason)
        lay.addLayout(f2)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(button(t('common.cancel'), self.reject, 'ghost'))
        row.addWidget(button(t('pos.rc.return'), self.go))
        lay.addLayout(row)

    def go(self):
        if not self.lines():
            self.err.setText(t('pos.pickReturn'))
            return
        self.accept()

    def lines(self):
        return [{'sku': s, 'qty': sp.value()} for s, sp in self.spins if sp.value() > 0]


class SalesView(QWidget):
    def __init__(self, state):
        super().__init__()
        self.state, self.rows = state, []
        root = QVBoxLayout(self)
        bar = QHBoxLayout()
        self.q = QLineEdit()
        self.q.setPlaceholderText(t('pos.findReceipt'))
        self.q.textChanged.connect(self.paint)
        self.type = QComboBox()
        self.type.addItem(t('pos.all'), '')
        self.type.addItem(t('pos.rc.receipt'), 'Sale')
        self.type.addItem(t('pos.rc.return'), 'Return')
        self.type.currentIndexChanged.connect(self.paint)
        self.days = QComboBox()
        for n in (1, 7, 30, 365):
            self.days.addItem(f'{n} d', n)
        self.days.setCurrentIndex(1)
        self.days.currentIndexChanged.connect(self.load)
        self.total = label('', 'dim')
        for w in (self.q, self.type, self.days):
            bar.addWidget(w)
        bar.addStretch(1)
        bar.addWidget(self.total)
        root.addLayout(bar)
        self.msg = label('', 'dim')
        root.addWidget(self.msg)
        self.table = make_table([t('pos.code'), t('pos.date'), t('pos.cashier'), t('pos.customer'), t('pos.status'), t('pos.total')])
        self.table.doubleClicked.connect(lambda *_: self.view())
        root.addWidget(self.table, 1)
        row = QHBoxLayout()
        row.addWidget(button(t('pos.nav.sales') + ' ▸ ' + t('pos.print'), self.view, 'ghost'))
        self.b_ret = button(t('pos.rc.return'), self.do_return, 'ghost')
        self.b_void = button(t('pos.void'), self.do_void, 'danger')
        row.addWidget(self.b_ret)
        row.addWidget(self.b_void)
        row.addStretch(1)
        root.addLayout(row)
        self.table.itemSelectionChanged.connect(self.buttons)

    def load(self):
        since = (datetime.now() - timedelta(days=int(self.days.currentData()))).strftime('%Y-%m-%d')
        run_async(lambda: api.pos_records('sale', take=1000, **{'from': since}), self.set_rows, lambda m: self.msg.setText(m))

    def set_rows(self, rows):
        self.rows = sorted(rows, key=lambda r: r.get('createdAt') or '', reverse=True)
        self.paint()

    def shown(self):
        q, ty = self.q.text().lower().strip(), self.type.currentData()
        return [s for s in self.rows if (not ty or s['data'].get('type') == ty)
                and (not q or q in (s.get('code') or '').lower() or q in (s.get('parent') or '').lower() or q in str(s['data'].get('customerName') or '').lower() or q in (s.get('createdBy') or '').lower())]

    def paint(self):
        rows = self.shown()
        out = [[(s.get('code') or '') + (f" ← {s['parent']}" if s.get('parent') else ''), (s.get('createdAt') or '')[:16].replace('T', ' '), s.get('createdBy') or '',
                s['data'].get('customerName') or '—', t('pos.st.' + (s.get('status') or 'Completed')), money(s['data'].get('total'))] for s in rows]
        fill_table(self.table, out, rows)
        self.total.setText(f"{len(rows)} · {money(sum(float(s['data'].get('total') or 0) for s in rows if s.get('status') != 'Voided'))}")
        self.buttons()

    def can_return(self, s):
        return api.can('pos.refund') and s['data'].get('type') == 'Sale' and s.get('status') not in ('Voided', 'Returned')

    def can_void(self, s):
        return api.can('pos.void') and s['data'].get('type') == 'Sale' and s.get('status') == 'Completed'

    def buttons(self):
        s = current_payload(self.table)
        self.b_ret.setEnabled(bool(s) and self.can_return(s))
        self.b_void.setEnabled(bool(s) and self.can_void(s))

    def view(self):
        s = current_payload(self.table)
        if s:
            ReceiptDialog(s, self.state, self, s.get('code')).exec()

    def do_return(self):
        s = current_payload(self.table)
        if not s:
            return
        d = ReturnDialog(s, self)
        if not d.exec():
            return
        lines, method, reason = d.lines(), d.method.currentData(), d.reason.text()

        def ok(r):
            self.msg.setText(t('pos.returned'))
            self.load()
            ReceiptDialog(r, self.state, self, t('pos.returned')).exec()
        run_async(lambda: api.pos_return(s['id'], lines, method, reason), ok, lambda m: warn(self, m))

    def do_void(self):
        s = current_payload(self.table)
        if not s:
            return
        from app.ui import ask
        if ask(self, t('pos.voidConfirm', name=s.get('code') or ''), t('pos.void'), t('common.cancel')):
            run_async(lambda: api.pos_void(s['id']), lambda _r: self.load(), lambda m: warn(self, m))


# ---------------------------------------------------------------- the page
class PosPage(QWidget):
    def __init__(self):
        super().__init__()
        self.state = PosState()
        lay = QVBoxLayout(self)
        top = QHBoxLayout()
        top.addWidget(label(t('tab.pos'), 'title'))
        self.err = label('', 'error')
        top.addWidget(self.err, 1)
        lay.addLayout(top)
        self.tabs = QTabWidget()
        self.till = TillView(self.state, self.reload)
        self.shifts = ShiftsView(self.state, self.reload)
        self.sales = SalesView(self.state)
        self.tabs.addTab(self.till, t('pos.nav.terminal'))
        self.tabs.addTab(self.shifts, t('pos.nav.shifts'))
        self.tabs.addTab(self.sales, t('pos.nav.sales'))
        self.tabs.currentChanged.connect(lambda *_: self.paint())
        lay.addWidget(self.tabs, 1)

    def reload(self):
        self.err.setText('')
        run_async(self.state.load, lambda _s: (self.paint(), self.till.update_queue()), lambda m: self.err.setText(m))

    def paint(self):
        if not self.state.loaded:
            return
        i = self.tabs.currentIndex()
        (self.till, self.shifts, self.sales)[i]
        if i == 0:
            self.till.refresh()
        elif i == 1:
            self.shifts.refresh()
        else:
            self.sales.load()
