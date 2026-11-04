"""Operations and finance actions: work orders (create from a BOM, release, start, complete, cancel), accounting periods (generate, close,
reopen) and the monthly fixed-asset depreciation run. Same endpoints and rules as the portal; the server enforces the privileges."""
import calendar
from datetime import date, timedelta

from PySide6.QtWidgets import (QFileDialog, QPlainTextEdit, QComboBox, QDialog, QDoubleSpinBox, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QSpinBox, QTabWidget, QVBoxLayout, QWidget)

from .api import api
from .fincalc import invoice_total, next_month, r2, num
from .i18n import t
from .ui import button, current_payload, fill_table, label, make_table, run_async, warn


def recs(path):
    try:
        return api._call('GET', path) or []
    except Exception:  # noqa: BLE001 - a list the user may not read stays empty
        return []


def periods_due(d, up_to):
    start = next_month(d['lastPeriod']) if d.get('lastPeriod') else str(d.get('inServiceDate') or '')[:7]
    out = []
    if len(start) != 7 or start > up_to:
        return out
    p = start
    while p <= up_to and len(out) < 600:
        out.append(p)
        p = next_month(p)
    return out


def depreciation_due(d, up_to):
    acc, total, last, n = num(d.get('accumulated')), 0.0, None, 0
    cost, salvage = num(d.get('cost')), num(d.get('salvage'))
    life = max(1, round(num(d.get('lifeMonths')) or 60))
    for p in periods_due(d, up_to):
        nbv = cost - acc
        m = nbv * (2 / life) if d.get('method') == 'DB' else (cost - salvage) / life
        m = max(0.0, min(m, nbv - salvage))
        if m <= 0.004:
            break
        acc += m
        total += m
        last = p
        n += 1
    return dict(amount=r2(total), months=n, last=last)


def match_invoice(d, tol):
    """3-way match of a supplier invoice: the total must not exceed the smaller of the PO and the received amount (plus the tolerance)."""
    if not str(d.get('poNo') or '').strip():
        return 'NoPO', 0.0
    limit = min(num(d.get('poAmount')), num(d.get('receivedAmount')))
    if limit <= 0:
        return 'Mismatch', limit
    return ('Matched' if invoice_total(d) <= limit * (1 + tol / 100) else 'Mismatch'), limit


def ledger_lines(side, rec, df):
    """Journal lines for an invoice (same rules as the portal's posting service); None when the default accounts are missing."""
    d = rec.get('data') or {}
    total, tax = r2(invoice_total(d)), r2(num(d.get('taxAmount')))
    net = r2(total - tax)
    if side == 'ap':
        exp = d.get('account') or df.get('expenseAccount')
        if not df.get('apAccount') or not exp:
            return None
        vat = bool(tax and df.get('vatInput'))
        ls = [dict(account=exp, debit=net if vat else total, credit=0, costCenter=d.get('costCenter', ''), project=d.get('project', ''), memo=d.get('vendor', ''))]
        if vat:
            ls.append(dict(account=df['vatInput'], debit=tax, credit=0, memo='VAT'))
        ls.append(dict(account=df['apAccount'], debit=0, credit=total, memo=d.get('vendor', '')))
        return ls
    rev = d.get('account') or df.get('revenueAccount')
    if not df.get('arAccount') or not rev:
        return None
    vat = bool(tax and df.get('vatOutput'))
    ls = [dict(account=df['arAccount'], debit=total, credit=0, memo=d.get('customer', '')), dict(account=rev, debit=0, credit=net if vat else total, costCenter=d.get('costCenter', ''), project=d.get('project', ''), memo=d.get('customer', ''))]
    if vat:
        ls.append(dict(account=df['vatOutput'], debit=0, credit=tax, memo='VAT'))
    return ls


class EInvoiceDialog(QDialog):
    """The ZATCA e-invoice of one customer invoice: shows the numbers, issues it, saves the XML."""

    def __init__(self, parent, inv, can_issue):
        super().__init__(parent)
        self.inv, self.z = inv, {}
        self.setWindowTitle('%s · %s' % (t('gov.zatca.title'), inv.get('code')))
        self.resize(560, 360)
        lay = QVBoxLayout(self)
        self.info = QPlainTextEdit()
        self.info.setReadOnly(True)
        lay.addWidget(self.info)
        row = QHBoxLayout()
        self.b_issue = button(t('gov.zatca.issue'), self.issue)
        self.b_issue.setVisible(can_issue)
        self.b_xml = button(t('act.xml'), self.save_xml, 'ghost')
        row.addWidget(self.b_issue)
        row.addWidget(self.b_xml)
        row.addStretch(1)
        row.addWidget(button(t('act.close'), self.accept, 'ghost'))
        lay.addLayout(row)
        run_async(lambda: api._call('GET', '/finance/zatca/invoice/%s' % inv['id']), self.show_z, lambda m: self.info.setPlainText(m))

    def show_z(self, z):
        self.z = z or {}
        if not self.z.get('issued'):
            self.info.setPlainText(t('gov.zatca.notIssued') + '\n\n' + t('gov.zatca.phaseNote'))
        else:
            z = self.z
            self.info.setPlainText('\n'.join([
                '%s: %s' % (t('gov.zatca.type'), z.get('type')), '%s: %s' % (t('gov.zatca.icv'), z.get('icv')), 'UUID: %s' % z.get('uuid'), '%s: %s' % (t('gov.zatca.hash'), z.get('hash')),
                '%s: %s' % (t('gov.zatca.pih'), z.get('pih')), '%s: %s · %s' % (t('gov.zatca.issued'), z.get('issuedAt'), z.get('issuedBy')), t('gov.zatca.signed' if z.get('signed') else 'gov.zatca.unsigned'), '',
                '%s:\n%s' % (t('act.qr'), z.get('qr'))]))
        self.b_issue.setEnabled(not self.z.get('issued'))
        self.b_xml.setEnabled(bool(self.z.get('xml')))

    def issue(self):
        run_async(lambda: api._call('POST', '/finance/zatca/issue/%s' % self.inv['id'], {}), self.show_z, lambda m: warn(self, m))

    def save_xml(self):
        path, _ = QFileDialog.getSaveFileName(self, t('act.xml'), '%s.xml' % self.inv.get('code'), 'XML (*.xml)')
        if path:
            open(path, 'w', encoding='utf-8').write(self.z.get('xml') or '')


class Invoices(QWidget):
    """Customer and supplier invoices: post to the ledger (draft journal), the supplier 3-way match and the ZATCA e-invoice."""

    def __init__(self, say):
        super().__init__()
        self.say, self.rows, self.defaults, self.tol = say, [], {}, 2.0
        lay = QVBoxLayout(self)
        top = QHBoxLayout()
        self.side = QComboBox()
        self.side.addItem(t('act.ar'), 'ar')
        self.side.addItem(t('act.ap'), 'ap')
        self.side.currentIndexChanged.connect(lambda *_: self.reload())
        top.addWidget(self.side)
        top.addStretch(1)
        lay.addLayout(top)
        self.tbl = make_table([t('act.code'), t('act.party'), t('act.inv.total'), t('act.status'), t('fin.ap.match'), t('act.gl')])
        lay.addWidget(self.tbl, 1)
        row = QHBoxLayout()
        self.b_post = button(t('act.post'), self.post)
        self.b_einv = button(t('act.einv'), self.einv, 'ghost')
        row.addWidget(self.b_post)
        row.addWidget(self.b_einv)
        row.addStretch(1)
        lay.addLayout(row)
        self.tbl.itemSelectionChanged.connect(self.gate)
        self.gate()

    def kind(self):
        return 'apinvoice' if self.side.currentData() == 'ap' else 'arinvoice'

    def gate(self):
        r = current_payload(self.tbl) or {}
        ap, st = self.side.currentData() == 'ap', r.get('status')
        postable = bool(r) and not (r.get('data') or {}).get('glJournal') and st in (('Approved', 'Paid') if ap else ('Issued', 'Paid'))
        self.b_post.setEnabled(postable and api.can('finance.gl.manage'))
        self.b_einv.setVisible(not ap and (api.can('finance.ar.view') or api.can('gov.zatca.manage')))
        self.b_einv.setEnabled(st in ('Issued', 'Paid'))

    def reload(self):
        k = self.kind()

        def work():
            st = recs('/finance/records/setting')
            return recs('/finance/records/' + k), {s.get('code'): s.get('data') or {} for s in st}
        run_async(work, self.show, lambda m: warn(self, m))

    def show(self, res):
        rows, st = res
        self.rows, self.defaults = rows, st.get('defaults', {})
        self.tol = num(st.get('controls', {}).get('matchTolerancePct', 2))
        ap = self.side.currentData() == 'ap'
        out = []
        for r in rows:
            d = r.get('data') or {}
            m = ''
            if ap:
                m = t('fin.match.' + match_invoice(d, self.tol)[0])
            out.append([r.get('code') or '', d.get('vendor' if ap else 'customer') or '', '%.2f' % r2(invoice_total(d)), t('fin.st.' + (r.get('status') or 'Draft')), m, d.get('glJournal') or ''])
        fill_table(self.tbl, out, rows)
        self.gate()

    def post(self):
        r = current_payload(self.tbl)
        if not r:
            return
        side = self.side.currentData()
        ls = ledger_lines(side, r, self.defaults)
        if ls is None:
            warn(self, t('fin.needDefaults'))
            return
        d = r.get('data') or {}
        jr = dict(status='Draft', data=dict(date=str(d.get('date') or '')[:10], memo='%s · %s' % (d.get('vendor' if side == 'ap' else 'customer'), d.get('invoiceNo') if side == 'ap' else r.get('code')), reference=r.get('code'),
                                            currency=d.get('currency', ''), rate=num(d.get('rate')) or 1, lines=[l for l in ls if l['debit'] or l['credit']]))

        def work():
            j = api._call('POST', '/finance/records/journal', jr)
            nd = dict(d)
            nd['glJournal'] = j.get('code')
            api._call('PUT', '/finance/records/%s/%s' % (self.kind(), r['id']), dict(status=r.get('status'), data=nd))
            return j
        run_async(work, lambda j: (self.say(t('fin.inv.glDone', n=(j or {}).get('code') or '')), self.reload()), lambda m: warn(self, m))

    def einv(self):
        r = current_payload(self.tbl)
        if r:
            EInvoiceDialog(self, r, api.can('gov.zatca.manage') or api.can('finance.ar.view')).exec()


class CompleteDialog(QDialog):
    """Finish a work order: good quantity, scrap, hours and a note; shows the components against the stock."""

    def __init__(self, parent, wo, stock):
        super().__init__(parent)
        self.setWindowTitle(t('mfg.wo.complete') + ' ' + str(wo.get('code') or ''))
        self.wo, self.stock = wo, stock
        d = wo.get('data') or {}
        lay = QVBoxLayout(self)
        form = QFormLayout()
        self.qty, self.scrap, self.hours = QDoubleSpinBox(), QDoubleSpinBox(), QDoubleSpinBox()
        for s in (self.qty, self.scrap, self.hours):
            s.setRange(0, 1e9)
            s.setDecimals(2)
        self.qty.setValue(num(d.get('qty')))
        self.hours.setValue(r2(num(d.get('routingMinutes')) / 60 * (num(d.get('qty')) / max(0.0001, num(d.get('bomQty')) or 1))))
        self.note = QLineEdit()
        form.addRow(t('mfg.wo.good'), self.qty)
        form.addRow(t('mfg.wo.scrap'), self.scrap)
        form.addRow(t('mfg.wo.hours'), self.hours)
        form.addRow(t('erp.f.notes') if t('erp.f.notes') != 'erp.f.notes' else 'Note', self.note)
        lay.addLayout(form)
        lay.addWidget(label(t('mfg.wo.materials'), 'title'))
        self.mat = make_table([t('act.sku'), t('mfg.wo.need'), t('mfg.wo.have')])
        lay.addWidget(self.mat)
        for s in (self.qty, self.scrap):
            s.valueChanged.connect(self.paint)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(button(t('mfg.wo.complete'), self.accept))
        lay.addLayout(row)
        self.paint()

    def materials(self):
        d = self.wo.get('data') or {}
        f = (self.qty.value() + self.scrap.value()) / max(0.0001, num(d.get('bomQty')) or 1)
        return [(l.get('sku'), r2(num(l.get('qty')) * f * (1 + num(l.get('scrapPct')) / 100)), self.stock.get(l.get('sku'), 0)) for l in d.get('lines') or []]

    def paint(self, *_):
        rows = self.materials()
        fill_table(self.mat, [[str(s), str(n), str(h)] for s, n, h in rows], rows)

    def body(self):
        return dict(qty=self.qty.value(), scrap=self.scrap.value(), hours=self.hours.value(), note=self.note.text())


class WorkOrders(QWidget):
    def __init__(self, say):
        super().__init__()
        self.say, self.rows, self.boms, self.stock = say, [], [], {}
        lay = QVBoxLayout(self)
        self.tbl = make_table([t('act.code'), t('act.sku'), t('act.qty'), t('act.due'), t('act.status'), t('mfg.wo.actual'), t('mfg.wo.variance')])
        lay.addWidget(self.tbl, 1)
        row = QHBoxLayout()
        self.b = {}
        for k, fn, kind in (('release', lambda: self.step('release'), None), ('start', lambda: self.step('start'), None), ('complete', self.complete, None), ('cancel', lambda: self.step('cancel'), 'danger')):
            self.b[k] = button(t('mfg.wo.' + k), fn, kind)
            row.addWidget(self.b[k])
        row.addStretch(1)
        row.addWidget(button(t('act.refresh'), self.reload, 'ghost'))
        lay.addLayout(row)
        self.form = QWidget()
        h = QHBoxLayout(self.form)
        self.bom, self.qty, self.due = QComboBox(), QDoubleSpinBox(), QLineEdit((date.today() + timedelta(days=7)).isoformat())
        self.qty.setRange(0.01, 1e9)
        self.qty.setValue(1)
        for lb, w in ((t('act.bom'), self.bom), (t('act.qty'), self.qty), (t('act.due'), self.due)):
            h.addWidget(QLabel(lb))
            h.addWidget(w)
        h.addWidget(button(t('act.create'), self.create))
        lay.addWidget(self.form)
        self.form.setVisible(api.can('mfg.orders.manage'))
        self.tbl.itemSelectionChanged.connect(self.gate)
        self.gate()

    def sel(self):
        return current_payload(self.tbl)

    def gate(self):
        s = (self.sel() or {}).get('status')
        mg, ex = api.can('mfg.orders.manage'), api.can('mfg.orders.execute')
        self.b['release'].setEnabled(s == 'Planned' and mg)
        self.b['start'].setEnabled(s == 'Released' and ex)
        self.b['complete'].setEnabled(s == 'InProgress' and ex)
        self.b['cancel'].setEnabled(s in ('Planned', 'Released') and mg)

    def reload(self):
        def work():
            return (recs('/erp/mfg/records/workorder?take=5000'), recs('/erp/mfg/records/bom?take=5000'), {x['sku']: x['qty'] for x in recs('/erp/mfg/stock')})
        run_async(work, self.show, lambda m: warn(self, m))

    def show(self, res):
        self.rows, self.boms, self.stock = res
        d = lambda r: r.get('data') or {}
        fill_table(self.tbl, [[str(r.get('code') or ''), str(d(r).get('sku', '')), str(d(r).get('qty', '')), str(d(r).get('due', '')), r.get('status') or '', str(d(r).get('actualCost', '')), str(d(r).get('variance', ''))] for r in self.rows], self.rows)
        self.bom.clear()
        for b in self.boms:
            if b.get('status') != 'Inactive':
                self.bom.addItem('%s · %s' % (b.get('code'), (b.get('data') or {}).get('name', '')), b)
        self.gate()

    def step(self, a):
        r = self.sel()
        if r:
            run_async(lambda: api._call('POST', '/mfg/workorders/%s/%s' % (r['id'], a), {}), lambda _: (self.say(t('act.done')), self.reload()), lambda m: warn(self, m))

    def complete(self):
        r = self.sel()
        if not r:
            return
        dlg = CompleteDialog(self, r, self.stock)
        if dlg.exec():
            run_async(lambda: api._call('POST', '/mfg/workorders/%s/complete' % r['id'], dlg.body()), lambda _: (self.say(t('act.done')), self.reload()), lambda m: warn(self, m))

    def create(self):
        b = self.bom.currentData()
        if not b:
            return
        bd = b.get('data') or {}
        body = dict(status='Planned', data=dict(sku=b.get('code'), qty=self.qty.value(), due=self.due.text(), priority='Normal', workCenter=bd.get('workCenter', ''), lines=bd.get('lines', []), bomQty=bd.get('qty', 1), routingMinutes=bd.get('routingMinutes', 0)))
        run_async(lambda: api._call('POST', '/erp/mfg/records/workorder', body), lambda r: (self.say(t('act.created', n=r.get('code') or '')), self.reload()), lambda m: warn(self, m))


class Periods(QWidget):
    def __init__(self, say):
        super().__init__()
        self.say, self.rows = say, []
        lay = QVBoxLayout(self)
        self.tbl = make_table([t('fin.per.code'), t('act.status')])
        lay.addWidget(self.tbl, 1)
        row = QHBoxLayout()
        ok = api.can('finance.gl.approve')
        self.bc, self.bo = button(t('fin.per.close'), lambda: self.set('Closed')), button(t('fin.per.reopen'), lambda: self.set('Open'), 'ghost')
        for b in (self.bc, self.bo):
            b.setEnabled(False)
            row.addWidget(b)
        row.addStretch(1)
        self.year = QSpinBox()
        self.year.setRange(2000, 2100)
        self.year.setValue(date.today().year)
        row.addWidget(QLabel(t('act.year')))
        row.addWidget(self.year)
        self.gen = button(t('fin.per.generate'), self.generate)
        self.gen.setVisible(ok)
        row.addWidget(self.gen)
        lay.addLayout(row)
        self.ok = ok
        self.tbl.itemSelectionChanged.connect(self.gate)

    def gate(self):
        s = (current_payload(self.tbl) or {}).get('status')
        self.bc.setEnabled(self.ok and s is not None and s != 'Closed')
        self.bo.setEnabled(self.ok and s == 'Closed')

    def reload(self):
        run_async(lambda: sorted(recs('/finance/records/period'), key=lambda r: r.get('code') or ''), self.show, lambda m: warn(self, m))

    def show(self, rows):
        self.rows = rows
        fill_table(self.tbl, [[r.get('code') or '', t('fin.st.' + (r.get('status') or 'Open'))] for r in rows], rows)
        self.gate()

    def set(self, status):
        r = current_payload(self.tbl)
        if r:
            run_async(lambda: api._call('PUT', '/finance/records/period/%s' % r['id'], dict(status=status, data=r.get('data') or {})), lambda _: self.reload(), lambda m: warn(self, m))

    def generate(self):
        y = self.year.value()
        have = {r.get('code') for r in self.rows}
        todo = ['%d-%02d' % (y, m) for m in range(1, 13) if '%d-%02d' % (y, m) not in have]

        def work():
            for c in todo:
                api._call('POST', '/finance/records/period', dict(code=c, status='Open', data={}))
            return len(todo)
        run_async(work, lambda n: (self.say(t('act.perCreated', n=n)), self.reload()), lambda m: (warn(self, m), self.reload()))


class Depreciation(QWidget):
    def __init__(self, say):
        super().__init__()
        self.say, self.assets, self.items, self.defaults = say, [], [], {}
        lay = QVBoxLayout(self)
        top = QHBoxLayout()
        self.month = QLineEdit(date.today().strftime('%Y-%m'))
        self.month.setMaximumWidth(110)
        self.month.editingFinished.connect(self.paint)
        top.addWidget(QLabel(t('fin.asset.upTo')))
        top.addWidget(self.month)
        top.addStretch(1)
        lay.addLayout(top)
        self.tbl = make_table([t('act.asset'), t('act.months'), t('act.amount')])
        lay.addWidget(self.tbl, 1)
        self.total = QLabel('')
        lay.addWidget(self.total)
        self.run_b = button(t('fin.asset.run'), self.run)
        self.run_b.setVisible(api.can('finance.assets.manage') and api.can('finance.gl.manage'))
        lay.addWidget(self.run_b)

    def reload(self):
        def work():
            st = recs('/finance/records/setting')
            return recs('/finance/records/asset'), next((s.get('data') or {} for s in st if s.get('code') == 'defaults'), {})
        run_async(work, lambda r: (setattr(self, 'assets', r[0]), setattr(self, 'defaults', r[1]), self.paint()), lambda m: warn(self, m))

    def paint(self):
        m = self.month.text().strip()
        self.items = []
        for a in self.assets:
            if a.get('status') == 'Active':
                d = depreciation_due(a.get('data') or {}, m)
                if d['amount'] > 0:
                    self.items.append((a, d))
        fill_table(self.tbl, [[(a.get('data') or {}).get('name') or a.get('code') or '', str(d['months']), '%.2f' % d['amount']] for a, d in self.items], self.items)
        tot = r2(sum(d['amount'] for _, d in self.items))
        self.total.setText('%s: %.2f' % (t('act.total'), tot) if self.items else t('fin.asset.nothingDue'))
        self.run_b.setEnabled(bool(self.items))

    def run(self):
        df, m = self.defaults, self.month.text().strip()
        if not df.get('deprExpense') or not df.get('deprAccum'):
            warn(self, t('fin.needDefaults'))
            return
        items, total = list(self.items), r2(sum(d['amount'] for _, d in self.items))
        y, mo = int(m[:4]), int(m[5:7])
        jr = dict(status='Draft', data=dict(date='%s-%02d' % (m, calendar.monthrange(y, mo)[1]), memo='%s %s' % (t('fin.asset.deprMemo'), m), reference='DEPR-' + m, rate=1,
                                            lines=[dict(account=df['deprExpense'], debit=total, credit=0, memo=m), dict(account=df['deprAccum'], debit=0, credit=total, memo=m)]))

        def work():
            j = api._call('POST', '/finance/records/journal', jr)
            for a, d in items:
                nd = dict(a.get('data') or {})
                nd['accumulated'] = r2(num(nd.get('accumulated')) + d['amount'])
                nd['lastPeriod'] = d['last']
                api._call('PUT', '/finance/records/asset/%s' % a['id'], dict(status=a.get('status'), data=nd))
            return j
        run_async(work, lambda j: (self.say(t('fin.asset.runDone', n=(j or {}).get('code') or '')), self.reload()), lambda m_: warn(self, m_))


class ActionsPage(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        lay.addWidget(label(t('act.title'), 'title'))
        self.tabs = QTabWidget()
        lay.addWidget(self.tabs, 1)
        self.msg = QLabel('')
        lay.addWidget(self.msg)
        self.views = []
        for perm, key, cls in (('mfg.view', 'act.v.wo', WorkOrders), ('finance.gl.view', 'act.v.per', Periods), ('finance.assets.view', 'act.v.depr', Depreciation), ('finance.ar.view', 'act.v.inv', Invoices)):
            if api.can(perm):
                w = cls(self.msg.setText)
                self.tabs.addTab(w, t(key))
                self.views.append(w)
        self.tabs.currentChanged.connect(self.load)

    def load(self, *_):
        i = self.tabs.currentIndex()
        if 0 <= i < len(self.views):
            self.views[i].reload()

    def reload(self):
        self.load()
