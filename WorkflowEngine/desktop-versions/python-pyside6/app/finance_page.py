"""Finance reports: overview, trial balance, income statement, balance sheet, receivables / payables ageing, budgets, projects, fixed assets,
bank reconciliation and the audit trail. The reports are described by finance.json (shared by every desktop app); the figures come from the
same finance records as the portal and are calculated here the same way (fincalc.py)."""
import json
from datetime import date
from pathlib import Path

from PySide6.QtWidgets import QComboBox, QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout, QWidget

from . import fincalc as fc
from . import i18n
from .api import api
from .i18n import t
from .ui import button, current_payload, fill_table, label, make_table, run_async, warn

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'finance.json').read_text(encoding='utf-8'))
LAB = SPEC['labels']
_VIEW = {'overview': 'finance.reports.view', 'tb': 'finance.gl.view', 'income': 'finance.gl.view', 'balance': 'finance.gl.view', 'ar': 'finance.ar.view', 'ap': 'finance.ap.view',
         'budgets': 'finance.budget.view', 'projects': 'finance.projects.view', 'assets': 'finance.assets.view', 'bank': 'finance.bank.view', 'audit': 'finance.audit.view'}
KINDS = {'tb': ('account', 'journal'), 'income': ('account', 'journal'), 'balance': ('account', 'journal'), 'ar': ('arinvoice',), 'ap': ('apinvoice',),
         'budgets': ('account', 'journal', 'budget'), 'projects': ('account', 'journal', 'project'), 'assets': ('asset',), 'bank': ('bankaccount', 'banktxn')}


def L(key, *a):
    s = LAB[key][1 if i18n.lang == 'ar' else 0]
    for i, v in enumerate(a):
        s = s.replace('{%d}' % i, str(v))
    return s


def tx(o, k='en'):
    return o['ar' if i18n.lang == 'ar' else 'en']


def money(v):
    return f'{v:,.2f}'


def build(rep, data, f):
    """-> (rows of strings, payloads, footer text). data: kind -> records (or the summary / audit for the server reports)."""
    ar = i18n.lang == 'ar'
    rid = rep['id']
    today = date.today().isoformat()
    accs = data.get('account', [])
    types = {a.get('code'): str((a.get('data') or {}).get('type') or '') for a in accs}
    typ = lambda c: types.get(c, '')
    if rid == 'overview':
        s = data['summary']
        rows = []
        for key, en, a in SPEC['measures']:
            v = s.get(key)
            if key == 'currentPeriod':
                v = '%s %s' % (v or '-', ('(%s)' % s['currentPeriodStatus']) if s.get('currentPeriodStatus') else '')
            elif isinstance(v, (int, float)):
                v = money(v) if key not in ('assetCount', 'activeProjects', 'journalsToApprove', 'invoicesToApprove') else str(int(v))
            rows.append([a if ar else en, str(v if v is not None else '-')])
        return rows, [None] * len(rows), ''
    if rid in ('tb', 'income', 'balance', 'budgets', 'projects'):
        lines = fc.posted_lines(data.get('journal', []), f['company'], f['from'], f['to'])
        tb = fc.trial_balance(lines, accs, ar)
        if rid == 'tb':
            rows = [[r['account'], r['name'], r['type'], money(r['debit']), money(r['credit']), money(r['balance'])] for r in tb]
            td, tc = fc.r2(sum(r['debit'] for r in tb)), fc.r2(sum(r['credit'] for r in tb))
            rows.append([L('totals'), '', '', money(td), money(tc), ''])
            return rows, [None] * len(rows), ''
        if rid == 'income':
            st = fc.income_statement(tb)
            rows = [[L('revenue'), r['account'], r['name'], money(r['balance'])] for r in st['revenue']] + [[L('totalrev'), '', '', money(st['total_revenue'])]]
            rows += [[L('expense'), r['account'], r['name'], money(r['balance'])] for r in st['expense']] + [[L('totalexp'), '', '', money(st['total_expense'])], [L('net'), '', '', money(st['net'])]]
            return rows, [None] * len(rows), ''
        if rid == 'balance':
            b = fc.balance_sheet(tb)
            rows = [[L('assets'), r['account'], r['name'], money(r['balance'])] for r in b['assets']] + [[L('totass'), '', '', money(b['total_assets'])]]
            rows += [[L('liab'), r['account'], r['name'], money(r['balance'])] for r in b['liabilities']] + [[L('totliab'), '', '', money(b['total_liabilities'])]]
            rows += [[L('equity'), r['account'], r['name'], money(r['balance'])] for r in b['equity']] + [[L('netincome'), '', '', money(b['net_income'])], [L('toteq'), '', '', money(b['total_equity'])], [L('check'), '', '', money(b['check'])]]
            return rows, [None] * len(rows), ''
        if rid == 'budgets':
            rows = [[x['cc'], x['account'], str(x['year']), money(x['budget']), money(x['actual']), money(x['remaining']), str(x['used'])] for x in fc.budget_vs_actual(data.get('budget', []), lines, typ)]
            return rows, [None] * len(rows), ''
        rows = [[x['code'], money(x['revenue']), money(x['cost']), money(x['profit']), str(x['margin'])] for x in fc.project_results(data.get('project', []), lines, typ)]
        return rows, [None] * len(rows), ''
    if rid in ('ar', 'ap'):
        inv = data.get('arinvoice' if rid == 'ar' else 'apinvoice', [])
        parties, totals = fc.aging(inv, 'customer' if rid == 'ar' else 'vendor', ['Issued'] if rid == 'ar' else ['Submitted', 'Approved', 'Held'], today)
        rows = [[p['party']] + [money(x) for x in p['buckets']] + [money(p['total'])] for p in parties]
        rows.append([L('totals')] + [money(x) for x in totals] + [money(fc.r2(sum(totals)))])
        return rows, [None] * len(rows), ''
    if rid == 'assets':
        rows = []
        for a in data.get('asset', []):
            d = a.get('data') or {}
            c = fc.asset_calc(d)
            rows.append([a.get('code') or '', str(d.get('name') or ''), money(c['cost']), money(c['accumulated']), money(c['nbv']), money(c['monthly']), str(c['months_left'])])
        return rows, [None] * len(rows), ''
    if rid == 'bank':
        sel = f['company']   # the company box doubles as an account filter here
        accounts = data.get('bankaccount', [])
        txns = [x for x in data.get('banktxn', []) if not sel or (x.get('data') or {}).get('account') == sel]
        rows = [[str((x.get('data') or {}).get('account') or ''), str((x.get('data') or {}).get('date') or '')[:10], str((x.get('data') or {}).get('description') or ''),
                 money(fc.num((x.get('data') or {}).get('amount'))), L('yes') if (x.get('data') or {}).get('reconciled') else ''] for x in txns]
        opening = sum(fc.num((a.get('data') or {}).get('openingBalance')) for a in accounts if not sel or a.get('code') == sel)
        rec = fc.r2(opening + sum(fc.num((x.get('data') or {}).get('amount')) for x in txns if (x.get('data') or {}).get('reconciled')))
        un = sum(1 for x in txns if not (x.get('data') or {}).get('reconciled'))
        return rows, txns, f"{L('opening')}: {money(opening)}   {L('reconciledbal')}: {money(rec)}   {L('unrec')}: {un}"
    if rid == 'audit':
        rows = [[str(a.get('at') or '')[:19].replace('T', ' '), str(a.get('userName') or ''), str(a.get('action') or ''), str(a.get('kind') or ''), str(a.get('code') or ''), str(a.get('summary') or '')] for a in data.get('audit', [])]
        return rows, [None] * len(rows), ''
    return [], [], ''


def fetch(rep, f):
    rid = rep['id']
    if rid == 'overview':
        return {'summary': api.fin('GET', 'summary', company=f['company'])}
    if rid == 'audit':
        return {'audit': api.fin('GET', 'audit')}
    out = {}
    for k in KINDS.get(rid, ()):
        try:
            out[k] = api.fin('GET', 'records/' + k, company=f['company'] if k in ('journal', 'arinvoice', 'apinvoice', 'budget', 'asset') and rid != 'bank' else None, take=2000) or []
        except Exception:   # a list the user may not read stays empty, like in the portal
            out[k] = []
    return out


class FinancePage(QWidget):
    def __init__(self):
        super().__init__()
        self.reports = [r for r in SPEC['reports'] if api.can(_VIEW[r['id']])]
        lay = QVBoxLayout(self)
        lay.addWidget(label(L('title'), 'title'))
        bar = QHBoxLayout()
        self.pick = QComboBox()
        for r in self.reports:
            self.pick.addItem(tx(r), r['id'])
        self.pick.currentIndexChanged.connect(lambda *_: self.reload())
        bar.addWidget(self.pick, 1)
        self.d_from, self.d_to, self.company = QLineEdit(), QLineEdit(), QLineEdit()
        self.d_from.setPlaceholderText(L('from') + ' yyyy-mm-dd')
        self.d_to.setPlaceholderText(L('to') + ' yyyy-mm-dd')
        self.company.setPlaceholderText(L('company'))
        self.d_from.setText(date.today().strftime('%Y-01-01'))
        for w in (self.d_from, self.d_to, self.company):
            w.setMaximumWidth(150)
            w.returnPressed.connect(self.reload)
            bar.addWidget(w)
        bar.addWidget(button(L('refresh'), self.reload))
        self.b_rec, self.b_unrec = button(L('reconcile'), lambda: self.mark(True)), button(L('unreconcile'), lambda: self.mark(False))
        self.b_seed = button(L('seed'), self.seed, 'ghost')
        for b in (self.b_rec, self.b_unrec, self.b_seed):
            bar.addWidget(b)
        lay.addLayout(bar)
        self.table = make_table([])
        lay.addWidget(self.table, 1)
        self.foot = QLabel('')
        lay.addWidget(self.foot)
        self.msg = QLabel('')
        lay.addWidget(self.msg)
        self.data, self.rep = {}, None

    def filters(self):
        return dict(**{'from': self.d_from.text().strip(), 'to': self.d_to.text().strip(), 'company': self.company.text().strip()})

    def reload(self):
        if not self.reports:
            self.msg.setText(L('noperm'))
            return
        self.rep = next(r for r in self.reports if r['id'] == self.pick.currentData())
        rid = self.rep['id']
        self.d_from.setVisible(bool(self.rep.get('dates')))
        self.d_to.setVisible(bool(self.rep.get('dates')))
        self.b_rec.setVisible(rid == 'bank' and api.can('finance.bank.manage'))
        self.b_unrec.setVisible(rid == 'bank' and api.can('finance.bank.manage'))
        self.b_seed.setVisible(rid == 'tb' and api.can('finance.setup'))
        self.table.setColumnCount(len(self.rep['cols']))
        self.table.setHorizontalHeaderLabels([tx(c) for c in self.rep['cols']])
        self.msg.setText('…')
        rep, f = self.rep, self.filters()
        run_async(lambda: fetch(rep, f), lambda d: self.show_data(rep, f, d), lambda m: self.msg.setText(m))

    def show_data(self, rep, f, data):
        if rep is not self.rep:
            return
        self.data = data
        rows, payloads, foot = build(rep, data, f)
        fill_table(self.table, rows, payloads)
        for r, row in enumerate(rows):
            for c, col in enumerate(rep['cols']):
                it = self.table.item(r, c)
                if it and col.get('num'):
                    it.setTextAlignment(0x0002 | 0x0080)   # right, vcenter
        self.foot.setText(foot)
        self.msg.setText('' if rows else L('empty'))

    def mark(self, value):
        rec = current_payload(self.table)
        if not rec:
            return
        d = dict(rec.get('data') or {})
        d['reconciled'] = value
        run_async(lambda: api.fin('PUT', 'records/banktxn/' + rec['id'], dict(code=rec.get('code'), company=rec.get('company'), status=rec.get('status'), data=d)), lambda _: self.reload(), lambda m: warn(self, m))

    def seed(self):
        run_async(lambda: api.fin('POST', 'accounts/seed', {}), lambda r: (self.msg.setText(L('seeded', (r or {}).get('created', 0))), self.reload()), lambda m: warn(self, m))
