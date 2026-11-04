"""Operations: material requirements planning, standard cost and work order variance, project billing, the VAT return and the ZATCA seller
profile. The reports are described by ops.json (shared by every desktop app); the figures come from the same records as the portal."""
import json
from datetime import date
from pathlib import Path

from PySide6.QtWidgets import (QComboBox, QDialog, QFileDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QCheckBox, QStackedWidget, QVBoxLayout, QWidget)

from . import i18n
from . import opscalc as oc
from .api import api
from .i18n import t
from .ui import button, current_payload, fill_table, label, make_table, run_async, warn

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'ops.json').read_text(encoding='utf-8'))
LAB = SPEC['labels']


def L(key, *a):
    s = LAB[key][1 if i18n.lang == 'ar' else 0]
    for i, v in enumerate(a):
        s = s.replace('{%d}' % i, str(v))
    return s


def tx(o):
    return o['ar' if i18n.lang == 'ar' else 'en']


def money(v):
    return f'{float(v or 0):,.2f}'


def allowed(rep):
    return any(api.can(p) for p in rep['view'])


def erp(module, kind, **q):
    try:
        return api._call('GET', f'/erp/{module}/records/{kind}?take=5000') or []
    except Exception:  # noqa: BLE001 - a list the user may not read stays empty
        return []


def fetch(rid, f):
    d = {}
    if rid in ('mrp', 'cost', 'variance'):
        d['bom'] = erp('mfg', 'bom')
        d['items'] = {i['sku']: i for i in (api._call('GET', '/erp/mfg/items') or [])}
    if rid == 'mrp':
        d['orders'] = erp('mfg', 'workorder')
        try:
            d['stock'] = {x['sku']: x['qty'] for x in (api._call('GET', '/erp/mfg/stock') or [])}
        except Exception:  # noqa: BLE001
            d['stock'] = {}
    if rid == 'cost':
        d['wc'] = erp('mfg', 'workcenter')
        d['setting'] = erp('mfg', 'setting')
    if rid == 'variance':
        d['orders'] = erp('mfg', 'workorder')
    if rid == 'projbill':
        for k, kind in (('p', 'project'), ('t', 'timesheet'), ('c', 'cost'), ('m', 'milestone')):
            d[k] = erp('prj', kind)
    if rid == 'vat':
        d['vat'] = api._call('GET', '/finance/zatca/vat-return?from=%s&to=%s' % (f['from'], f['to']))
    if rid == 'zatca':
        d['profile'] = api._call('GET', '/finance/zatca/profile') or {}
    return d


def build(rid, d, f):
    """-> (rows, payloads, footer)"""
    rows, pay, foot = [], [], ''
    ar = i18n.lang == 'ar'
    if rid == 'mrp':
        for r in oc.mrp(f['demand'], d['bom'], d['stock'] if f['use_stock'] else {}, sched(d['orders']) if f['use_stock'] else {}, d['items']):
            rows.append(['    ' * r['level'] + r['sku'] + ('  ' + r['name'] if r['name'] else ''), money(r['gross']), money(r['onHand']), money(r['scheduled']), money(r['net']), L(r['action'])])
            pay.append(r)
    elif rid == 'cost':
        rates = {w.get('code'): oc.num((w.get('data') or {}).get('costPerHour')) for w in d['wc']}
        pct = SPEC['defaultOverheadPct']
        for s in d['setting']:
            v = (s.get('data') or {}).get('overheadPct')
            if s.get('code') == 'defaults' and v not in (None, ''):
                pct = oc.num(v)
        for b in d['bom']:
            c = oc.bom_cost(b, d['items'], rates.get(b['data'].get('workCenter'), 0), pct)
            rows.append([b['code'] + '  ' + str(b['data'].get('name') or ''), money(c['material']), money(c['labor']), money(c['overhead']), money(c['total']), money(c['unit'])])
            pay.append(b)
        foot = '%s: %s%%' % (L('overheadPct'), pct)
    elif rid == 'variance':
        for o in d['orders']:
            if o.get('status') != 'Completed':
                continue
            x = o.get('data') or {}
            rows.append([o['code'], str(x.get('sku', '')), money(x.get('goodQty')), money(x.get('materialCost')), money(x.get('laborCost')), money(x.get('overheadCost')), money(x.get('actualCost')), money(x.get('standardCost')), money(x.get('variance'))])
            pay.append(o)
    elif rid == 'projbill':
        for p in d['p']:
            ready, billed = oc.project_ready(p, d['t'], d['c'], d['m'])
            x = p.get('data') or {}
            rows.append([p['code'] + '  ' + str(x.get('name') or ''), str(x.get('customer') or '-'), L('bm.' + (x.get('billingModel') or 'tm')), money(ready), money(billed)])
            pay.append(dict(rec=p, ready=ready))
    elif rid == 'vat':
        v = d['vat'] or {}
        for side, key in (('sales', 'sales'), ('purchases', 'purchases')):
            for b in v.get(key, []):
                rows.append([L(side), b['category'], str(b['count']), money(b['net']), money(b['vat'])])
                pay.append(None)
        for side, key in (('sales', 'salesByCode'), ('purchases', 'purchasesByCode')):
            for b in v.get(key, []):
                rows.append([L(side) + ' · ' + L('byCode'), b['code'], str(b['count']), money(b['net']), money(b['vat'])])
                pay.append(None)
        rows.append([L('total') + ' · ' + L('sales'), '', str(v.get('salesInvoices', 0)), money(v.get('salesNet')), money(v.get('outputVat'))])
        rows.append([L('total') + ' · ' + L('purchases'), '', str(v.get('purchaseInvoices', 0)), money(v.get('purchasesNet')), money(v.get('inputVat'))])
        pay += [None, None]
        nd = oc.num(v.get('netVatDue'))
        foot = '%s: %s   %s: %s   %s: %s / %s' % (L('out'), money(v.get('outputVat')), L('in'), money(v.get('inputVat')), L('netDue') if nd >= 0 else L('netRefund'), money(abs(nd)), L('einv') + ' ' + str(v.get('einvoiced', 0)) + '/' + str(v.get('salesInvoices', 0)))
        if v.get('notEinvoiced'):
            foot += '\n' + L('notEinv', v['notEinvoiced'])
        miss = (v.get('warnings') or {}).get('missingTaxCode') or []
        if miss:
            foot += '\n' + L('missingCode', len(miss))
    return rows, pay, foot


def sched(orders):
    out = {}
    for o in orders:
        if o.get('status') in ('Planned', 'Released', 'InProgress'):
            k = str((o.get('data') or {}).get('sku'))
            out[k] = out.get(k, 0) + oc.num((o.get('data') or {}).get('qty'))
    return out


class BillDialog(QDialog):
    def __init__(self, parent, proj):
        super().__init__(parent)
        self.setWindowTitle(L('createInvoice') + ' · ' + proj['rec']['code'])
        self.proj = proj
        lay = QFormLayout(self)
        self.date, self.terms, self.tax = QLineEdit(date.today().isoformat()), QLineEdit('30'), QLineEdit(str(SPEC['defaultTax']))
        lay.addRow(L('date'), self.date)
        lay.addRow(L('terms'), self.terms)
        lay.addRow(L('tax'), self.tax)
        self.msg = QLabel('')
        lay.addRow(self.msg)
        row = QHBoxLayout()
        row.addWidget(button(L('createInvoice'), self.go))
        row.addWidget(button(t('common.cancel') if t('common.cancel') != 'common.cancel' else 'Cancel', self.reject, 'ghost'))
        lay.addRow(row)
        self.result = None

    def go(self):
        body = dict(taxPct=oc.num(self.tax.text()), date=self.date.text().strip(), termsDays=int(oc.num(self.terms.text())))
        run_async(lambda: api._call('POST', '/erp/prj/projects/%s/bill' % self.proj['rec']['id'], body), self.ok, lambda m: self.msg.setText(m))

    def ok(self, r):
        self.result = r
        self.accept()


class OpsPage(QWidget):
    def __init__(self):
        super().__init__()
        self.reports = [r for r in SPEC['reports'] if allowed(r)]
        self.demand = []
        self.pending = ''
        self.data, self.rep = {}, None
        lay = QVBoxLayout(self)
        lay.addWidget(label(L('title'), 'title'))
        bar = QHBoxLayout()
        self.pick = QComboBox()
        for r in self.reports:
            self.pick.addItem(tx(r), r['id'])
        self.pick.currentIndexChanged.connect(lambda *_: self.reload())
        bar.addWidget(self.pick, 1)
        self.d_from, self.d_to = QLineEdit(date.today().replace(day=1).isoformat()), QLineEdit(date.today().isoformat())
        for w, ph in ((self.d_from, L('from')), (self.d_to, L('to'))):
            w.setPlaceholderText(ph + ' yyyy-mm-dd')
            w.setMaximumWidth(130)
            bar.addWidget(w)
        self.b_run = button(L('refresh'), self.reload)
        self.b_wo = button('', self.make_orders)
        self.b_buy = button(L('exportBuy'), self.export_buy, 'ghost')
        self.b_bill = button(L('createInvoice'), self.bill)
        self.b_csv = button(L('csv'), self.export_vat, 'ghost')
        for b in (self.b_run, self.b_wo, self.b_buy, self.b_bill, self.b_csv):
            bar.addWidget(b)
        lay.addLayout(bar)
        # MRP demand editor
        self.mrp_box = QWidget()
        mb = QHBoxLayout(self.mrp_box)
        mb.setContentsMargins(0, 0, 0, 0)
        self.m_sku, self.m_qty, self.m_due = QComboBox(), QLineEdit('1'), QLineEdit(date.today().isoformat())
        self.m_qty.setMaximumWidth(90)
        self.m_due.setMaximumWidth(120)
        self.m_stock = QCheckBox(L('useStock'))
        self.m_stock.setChecked(True)
        self.m_stock.stateChanged.connect(lambda *_: self.refresh_mrp())
        self.m_list = QLabel('')
        for w in (self.m_sku, self.m_qty, self.m_due, button(L('add'), self.add_demand), button(L('remove'), self.del_demand, 'ghost'), self.m_stock):
            mb.addWidget(w)
        lay.addWidget(self.mrp_box)
        lay.addWidget(self.m_list)
        self.stack = QStackedWidget()
        self.table = make_table([])
        self.stack.addWidget(self.table)
        self.form = QWidget()
        fl = QFormLayout(self.form)
        self.fields = {}
        for z in SPEC['zatca']:
            e = QLineEdit()
            if z['max']:
                e.setMaxLength(z['max'])
            self.fields[z['key']] = e
            fl.addRow(tx(z), e)
        self.b_save = button(L('save'), self.save_profile)
        fl.addRow(self.b_save)
        self.stack.addWidget(self.form)
        lay.addWidget(self.stack, 1)
        self.foot = QLabel('')
        lay.addWidget(self.foot)
        self.msg = QLabel('')
        lay.addWidget(self.msg)

    # ------------------------------------------------------------------ loading
    def filters(self):
        return dict(**{'from': self.d_from.text().strip(), 'to': self.d_to.text().strip()}, demand=self.demand, use_stock=self.m_stock.isChecked())

    def reload(self):
        if not self.reports:
            self.msg.setText(L('noperm'))
            return
        self.rep = next(r for r in self.reports if r['id'] == self.pick.currentData())
        rid = self.rep['id']
        self.d_from.setVisible(rid == 'vat')
        self.d_to.setVisible(rid == 'vat')
        self.mrp_box.setVisible(rid == 'mrp')
        self.m_list.setVisible(rid == 'mrp')
        self.b_wo.setVisible(False)
        self.b_buy.setVisible(False)
        self.b_bill.setVisible(rid == 'projbill')
        self.b_csv.setVisible(rid == 'vat')
        self.stack.setCurrentIndex(1 if rid == 'zatca' else 0)
        self.table.setColumnCount(len(self.rep['cols']))
        self.table.setHorizontalHeaderLabels([tx(c) for c in self.rep['cols']])
        self.msg.setText('…')
        rep, f = self.rep, self.filters()
        run_async(lambda: fetch(rid, f), lambda d: self.show_data(rep, f, d), lambda m: self.msg.setText(m))

    def show_data(self, rep, f, data):
        if rep is not self.rep:
            return
        self.data = data
        rid = rep['id']
        self.msg.setText('')
        if rid == 'zatca':
            for k, e in self.fields.items():
                e.setText(str((data['profile'] or {}).get(k) or ''))
            self.b_save.setVisible(api.can('gov.zatca.manage') or api.can('finance.setup'))
            self.foot.setText(L('profileHint'))
            return
        if rid == 'mrp':
            self.m_sku.clear()
            for b in data['bom']:
                self.m_sku.addItem('%s · %s' % (b['code'], (b.get('data') or {}).get('name', '')), b['code'])
            self.refresh_mrp()
            return
        self.paint(rid, data, f)

    def paint(self, rid, data, f):
        rows, pay, foot = build(rid, data, f)
        fill_table(self.table, rows, pay)
        for r in range(len(rows)):
            for c, col in enumerate(self.rep['cols']):
                it = self.table.item(r, c)
                if it and col.get('num'):
                    it.setTextAlignment(0x0002 | 0x0080)
        self.foot.setText(foot)
        self.msg.setText(self.pending or ('' if rows else L('empty')))
        self.pending = ''

    # ------------------------------------------------------------------ MRP
    def add_demand(self):
        sku = self.m_sku.currentData()
        q = oc.num(self.m_qty.text())
        if sku and q > 0:
            self.demand.append(dict(sku=sku, qty=q, due=self.m_due.text().strip()))
            self.refresh_mrp()

    def del_demand(self):
        if self.demand:
            self.demand.pop()
            self.refresh_mrp()

    def refresh_mrp(self):
        if not self.rep or self.rep['id'] != 'mrp' or 'bom' not in self.data:
            return
        self.m_list.setText('  |  '.join('%s × %s (%s)' % (d['sku'], d['qty'], d['due']) for d in self.demand) or L('mrpHint'))
        f = self.filters()
        rows = oc.mrp(self.demand, self.data['bom'], self.data['stock'] if f['use_stock'] else {}, sched(self.data['orders']) if f['use_stock'] else {}, self.data['items'])
        self.paint('mrp', self.data, f)
        make = [r for r in rows if r['action'] == 'make']
        buy = [r for r in rows if r['action'] == 'buy']
        self.b_wo.setVisible(bool(make) and api.can('mfg.orders.manage'))
        self.b_wo.setText(L('createWo', len(make)))
        self.b_buy.setVisible(bool(buy))
        self.plan = (make, buy)

    def make_orders(self):
        make = self.plan[0]
        boms = {b['code']: b for b in self.data['bom']}
        due = next((d['due'] for d in self.demand if d['due']), date.today().isoformat())

        def work():
            n = 0
            for r in make:
                bd = boms[r['sku']].get('data') or {}
                api._call('POST', '/erp/mfg/records/workorder', dict(status='Planned', data=dict(sku=r['sku'], qty=r['net'], due=r.get('due') or due, priority='Normal', workCenter=bd.get('workCenter', ''), lines=bd.get('lines', []), bomQty=bd.get('qty', 1), routingMinutes=bd.get('routingMinutes', 0), source='MRP')))
                n += 1
            return n
        run_async(work, lambda n: (self.reload_orders(), self.msg.setText(L('created', n))), lambda m: warn(self, m))

    def reload_orders(self):
        self.data['orders'] = erp('mfg', 'workorder')
        self.refresh_mrp()

    def export_buy(self):
        path, _ = QFileDialog.getSaveFileName(self, L('exportBuy'), 'purchase-requirements.csv', 'CSV (*.csv)')
        if not path:
            return
        lines = ['sku,name,quantity'] + ['%s,"%s",%s' % (r['sku'], (r['name'] or '').replace('"', '""'), r['net']) for r in self.plan[1]]
        Path(path).write_text('﻿' + '\n'.join(lines), encoding='utf-8')
        self.msg.setText(path)

    # ------------------------------------------------------------------ billing, VAT, profile
    def bill(self):
        p = current_payload(self.table)
        if not p:
            return
        if p['ready'] <= 0 or not (p['rec'].get('data') or {}).get('customer'):
            self.msg.setText(L('noReady'))
            return
        dlg = BillDialog(self, p)
        if dlg.exec() and dlg.result:
            self.pending = L('billDone', dlg.result.get('invoice'), dlg.result.get('total'))
            self.reload()

    def export_vat(self):
        v = (self.data or {}).get('vat')
        if not v:
            return
        path, _ = QFileDialog.getSaveFileName(self, L('csv'), 'vat-return-%s-%s.csv' % (v.get('from'), v.get('to')), 'CSV (*.csv)')
        if not path:
            return
        rows = [['side', 'category', 'count', 'net', 'vat']] + [['sales', b['category'], b['count'], b['net'], b['vat']] for b in v['sales']] + [['purchases', b['category'], b['count'], b['net'], b['vat']] for b in v['purchases']]
        rows += [['sales', 'TOTAL', v['salesInvoices'], v['salesNet'], v['outputVat']], ['purchases', 'TOTAL', v['purchaseInvoices'], v['purchasesNet'], v['inputVat']], ['net vat due', '', '', '', v['netVatDue']]]
        Path(path).write_text('﻿' + '\n'.join(','.join(str(x) for x in r) for r in rows), encoding='utf-8')
        self.msg.setText(path)

    def save_profile(self):
        body = {k: e.text().strip() for k, e in self.fields.items()}
        if not body['sellerName']:
            self.msg.setText(L('sellerReq'))
            return
        if body['vatNo'] and len(body['vatNo']) != 15:
            self.msg.setText(L('vatLen'))
            return
        run_async(lambda: api._call('PUT', '/finance/zatca/profile', body), lambda _: self.msg.setText(L('saved')), lambda m: self.msg.setText(m))
