"""HR: overview, employees (with Excel / CSV import), leave requests and balances, recruitment, performance and the org structure.
The reports and the import fields are described by hr.json (shared by every desktop app)."""
import csv
import json
from datetime import date
from pathlib import Path

from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFileDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, QScrollArea, QTableWidgetItem, QVBoxLayout, QWidget)

from . import hrcalc as hc
from . import i18n
from .api import api
from .i18n import t
from .ui import button, current_payload, fill_table, label, make_table, run_async, warn

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'hr.json').read_text(encoding='utf-8'))
LAB, IMP = SPEC['labels'], SPEC['imp']
_VIEW = {'overview': 'hr.reports.view', 'employees': 'hr.employees.view', 'leave': 'hr.leave.view', 'balances': 'hr.leave.view', 'recruit': 'hr.recruitment.view',
         'perf': 'hr.performance.view', 'org': 'hr.org.view'}


def _ix():
    return 1 if i18n.lang == 'ar' else 0


def L(key, *a):
    s = LAB[key][_ix()]
    for i, v in enumerate(a):
        s = s.replace('{%d}' % i, str(v))
    return s


def I(key, **kw):
    s = IMP[key][_ix()]
    for k, v in kw.items():
        s = s.replace('{%s}' % k, str(v))
    return s


def tx(o):
    return o['ar' if i18n.lang == 'ar' else 'en']


def fl(f):
    return f['ar' if i18n.lang == 'ar' else 'en']


def money(v):
    return f'{v:,.0f}' if v == int(v) else f'{v:,.2f}'


def emp_name(e):
    return (e.get('fullNameAr') if i18n.lang == 'ar' and e.get('fullNameAr') else e.get('fullName')) or e.get('empNo') or ''


def visible_cols(rep):
    return [c for c in rep['cols'] if not (c.get('salary') or (rep['id'] == 'employees' and c['en'] == 'Salary' and not api.can('hr.employees.salary')))]


def build(rep, data, today=None):
    """-> (rows, payloads, footer)"""
    rid = rep['id']
    today = today or date.today().isoformat()
    emps = {e.get('empNo'): e for e in data.get('employees', [])}
    nm = lambda no: emp_name(emps[no]) if no in emps else (no or '')
    rows, pay, foot = [], [], ''
    if rid == 'overview':
        s = data['summary']
        for key, en, ar in SPEC['measures']:
            if key not in s or s[key] is None:
                continue
            v = s[key]
            rows.append([ar if i18n.lang == 'ar' else en, money(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else str(v)])
            pay.append(None)
    elif rid == 'employees':
        sal = api.can('hr.employees.salary')
        for e in data.get('employees', []):
            r = [e.get('empNo') or '', emp_name(e), e.get('position') or '', e.get('unit') or '', e.get('status') or '', str(e.get('hireDate') or '')[:10]]
            if sal:
                r.append(money(hc_num(e.get('basicSalary'))))
            rows.append(r)
            pay.append(e)
    elif rid == 'leave':
        for x in data.get('leave', []):
            d = x.get('data') or {}
            rows.append([nm(x.get('empNo')), str(d.get('type') or ''), str(d.get('from') or '')[:10], str(d.get('to') or '')[:10], str(d.get('days') or ''), x.get('status') or ''])
            pay.append(x)
    elif rid == 'balances':
        for e in data.get('employees', []):
            if e.get('status') == 'Terminated':
                continue
            for ty in data.get('leavetype', []):
                total = hc_num((ty.get('data') or {}).get('days'))
                used = sum(hc_num((x.get('data') or {}).get('days')) for x in data.get('leave', [])
                           if x.get('empNo') == e.get('empNo') and x.get('status') == 'Approved' and (x.get('data') or {}).get('type') == ty.get('code') and str((x.get('data') or {}).get('from'))[:4] == today[:4])
                rows.append([emp_name(e), str((ty.get('data') or {}).get('name') or ty.get('code')), money(total), money(used), money(total - used)])
                pay.append(None)
    elif rid == 'recruit':
        vac = {v.get('code'): (v.get('data') or {}).get('title') or v.get('code') for v in data.get('vacancy', [])}
        for c in data.get('candidate', []):
            d = c.get('data') or {}
            rows.append([str(d.get('name') or c.get('code')), str(vac.get(d.get('vacancy'), d.get('vacancy') or '')), str(d.get('email') or ''), c.get('status') or 'Applied'])
            pay.append(c)
    elif rid == 'perf':
        rated = []
        for x in data.get('review', []):
            d = x.get('data') or {}
            rating = hc_num(d.get('rating'))
            rows.append([nm(x.get('empNo')), str(d.get('stage') or ''), str(int(rating)) if rating else ''])
            pay.append(x)
            if rating > 0:
                rated.append(int(rating))
        if rated:
            foot = '%s: %.2f   %s: %d   %s: %s' % (L('avg'), sum(rated) / len(rated), L('rated'), len(rated), L('dist'), '  '.join('%d★ %d' % (n, rated.count(n)) for n in range(1, 6)))
    elif rid == 'org':
        for u in data.get('unit', []):
            d = u.get('data') or {}
            head = sum(1 for e in data.get('employees', []) if e.get('unit') in (u.get('code'), d.get('name')))
            rows.append([u.get('code') or '', (d.get('nameAr') if i18n.lang == 'ar' and d.get('nameAr') else d.get('name')) or '', str(d.get('level') or ''), str(d.get('parent') or ''), str(head)])
            pay.append(u)
    return rows, pay, foot


def hc_num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


KINDS = {'employees': (), 'leave': ('leave', 'employees'), 'balances': ('leave', 'leavetype', 'employees'), 'recruit': ('candidate', 'vacancy'), 'perf': ('review', 'employees'), 'org': ('unit', 'employees')}


def fetch(rid):
    if rid == 'overview':
        return {'summary': api.hr('GET', 'summary')}
    out = {}
    if rid in ('employees', 'leave', 'balances', 'perf', 'org'):
        out['employees'] = api.hr('GET', 'employees') or []
    for k in KINDS.get(rid, ()):
        if k != 'employees':
            try:
                out[k] = api.hr('GET', 'records/' + k) or []
            except Exception:   # a list the user may not read stays empty
                out[k] = []
    return out


class ImportDialog(QDialog):
    """choose a file -> check how the columns map to employee fields -> preview and validate -> import in chunks"""

    def __init__(self, parent, on_done):
        super().__init__(parent)
        self.setWindowTitle(I('title'))
        self.resize(900, 640)
        self.on_done = on_done
        self.fields = [f for f in SPEC['fields'] if not f.get('salary') or api.can('hr.employees.salary')]
        self.rows, self.mapping, self.mapped, self.combos = [], {}, [], {}
        lay = QVBoxLayout(self)
        lay.addWidget(label(I('intro')))
        top = QHBoxLayout()
        self.path = QLineEdit()
        self.path.setPlaceholderText(LAB['file'][_ix()])
        top.addWidget(self.path, 1)
        top.addWidget(button(LAB['pick'][_ix()], self.pick, 'ghost'))
        top.addWidget(button(LAB['load'][_ix()], self.load))
        top.addWidget(button(LAB['template'][_ix()], self.template, 'ghost'))
        lay.addLayout(top)
        self.head_chk = QCheckBox(I('hasHeader'))
        self.head_chk.setChecked(True)
        self.head_chk.stateChanged.connect(lambda *_: self.remap())
        lay.addWidget(self.head_chk)
        self.map_box = QVBoxLayout()
        holder = QWidget()
        holder.setLayout(self.map_box)
        sc = QScrollArea()
        sc.setWidgetResizable(True)
        sc.setWidget(holder)
        sc.setMaximumHeight(170)
        lay.addWidget(sc)
        self.summary = QLabel('')
        lay.addWidget(self.summary)
        self.table = make_table([])
        lay.addWidget(self.table, 1)
        self.upd = QCheckBox(I('update'))
        self.upd.setChecked(True)
        lay.addWidget(self.upd)
        self.msg = QLabel('')
        self.msg.setWordWrap(True)
        lay.addWidget(self.msg)
        row = QHBoxLayout()
        self.run_btn = button('', self.run)
        self.run_btn.setEnabled(False)
        row.addWidget(self.run_btn)
        row.addWidget(button(I('close'), self.accept, 'ghost'))
        lay.addLayout(row)

    def pick(self):
        p, _ = QFileDialog.getOpenFileName(self, I('title'), '', 'Excel / CSV (*.xlsx *.csv *.txt)')
        if p:
            self.path.setText(p)
            self.load()

    def template(self):
        p, _ = QFileDialog.getSaveFileName(self, I('title'), 'employees-template.csv', 'CSV (*.csv)')
        if not p:
            return
        with open(p, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow([x['key'] for x in self.fields])
            w.writerow([x['sample'] for x in self.fields])
        self.msg.setText(L('templated', p))

    def load(self):
        p = self.path.text().strip()
        if not p:
            self.msg.setText(L('nofile'))
            return
        try:
            self.rows = hc.read_table(p)
        except ValueError:
            self.msg.setText(I('badType'))
            return
        except Exception:   # noqa: BLE001 - not a valid file
            self.msg.setText(I('readError'))
            return
        if not self.rows:
            self.msg.setText(I('empty'))
            return
        if len(self.rows) > SPEC['maxRows']:
            self.msg.setText(I('tooMany'))
            self.rows = []
            return
        self.msg.setText('')
        self.auto_map()

    def auto_map(self):
        width = max(len(r) for r in self.rows)
        self.mapping, used = {}, set()
        for c in range(width):
            g = hc.guess_field(self.fields, self.rows[0][c] if c < len(self.rows[0]) else None)
            if g and g not in used:
                self.mapping[c] = g
                used.add(g)
        self.head_chk.blockSignals(True)
        self.head_chk.setChecked(len(self.mapping) >= 2 or 0 in self.mapping)
        self.head_chk.blockSignals(False)
        self.build_map_ui(width)
        self.remap()

    def build_map_ui(self, width):
        while self.map_box.count():
            it = self.map_box.takeAt(0)
            if it.layout():
                while it.layout().count():
                    w = it.layout().takeAt(0).widget()
                    if w:
                        w.deleteLater()
            if it.widget():
                it.widget().deleteLater()
        self.combos = {}
        for c in range(width):
            row = QHBoxLayout()
            head = str(self.rows[0][c]) if c < len(self.rows[0]) and self.rows[0][c] is not None else ''
            row.addWidget(QLabel('%s %d  %s' % (I('column'), c + 1, head)), 1)
            cb = QComboBox()
            cb.addItem(I('skip'), '')
            for f in self.fields:
                cb.addItem(fl(f), f['key'])
            cb.setCurrentIndex(max(0, cb.findData(self.mapping.get(c, ''))))
            cb.currentIndexChanged.connect(lambda _i, col=c: self.set_map(col))
            self.combos[c] = cb
            row.addWidget(cb, 1)
            self.map_box.addLayout(row)

    def set_map(self, col):
        key = self.combos[col].currentData()
        if key:
            for c, other in self.combos.items():
                if c != col and other.currentData() == key:
                    other.blockSignals(True)
                    other.setCurrentIndex(0)
                    other.blockSignals(False)
        self.mapping = {c: cb.currentData() for c, cb in self.combos.items() if cb.currentData()}
        self.remap()

    def missing(self):
        have = set(self.mapping.values())
        return [fl(f) for f in self.fields if f.get('required') and f['key'] not in have]

    def err_text(self, m):
        out = []
        for e in m['errors']:
            k, _, why = e.partition(':')
            f = next((x for x in self.fields if x['key'] == k), None)
            out.append('%s: %s' % (fl(f) if f else k, I('e.' + why) if why else I('e.required')))
        return ' · '.join(out)

    def remap(self):
        if not self.rows:
            return
        self.mapped = hc.map_rows(SPEC, self.rows, self.mapping, 1 if self.head_chk.isChecked() else 0, api.can('hr.employees.salary'))
        hc.mark_duplicates(self.mapped)
        keys = [f for f in self.fields if f['key'] in set(self.mapping.values())]
        self.table.setColumnCount(len(keys) + 2)
        self.table.setHorizontalHeaderLabels(['#'] + [fl(f) for f in keys] + [LAB['problem'][_ix()]])
        shown = self.mapped[:50]
        fill_table(self.table, [[str(m['row'])] + [str(m['data'].get(f['key'], '')) for f in keys] + [self.err_text(m)] for m in shown], shown)
        good = sum(1 for m in self.mapped if not m['errors'])
        self.summary.setText('%s   %s   %s' % (I('rows', n=len(self.mapped)), I('valid', n=good), I('invalid', n=len(self.mapped) - good) if len(self.mapped) > good else ''))
        miss = self.missing()
        self.msg.setText(L('needmap', ', '.join(miss)) if miss else (I('more', n=len(self.mapped) - 50) if len(self.mapped) > 50 else ''))
        self.run_btn.setText(I('run', n=good))
        self.run_btn.setEnabled(good > 0 and not miss)

    def run(self):
        good = [{'row': m['row'], 'data': m['data']} for m in self.mapped if not m['errors']]
        if not good:
            self.msg.setText(L('nothing'))
            return
        bad = [m for m in self.mapped if m['errors']]
        upd, chunk = self.upd.isChecked(), SPEC['chunk']
        self.run_btn.setEnabled(False)
        self.msg.setText('…')

        def work():
            total = {'created': 0, 'updated': 0, 'skipped': 0, 'errors': []}
            for i in range(0, len(good), chunk):
                r = api.hr('POST', 'employees/import', {'rows': good[i:i + chunk], 'updateExisting': upd}) or {}
                for k in ('created', 'updated', 'skipped'):
                    total[k] += r.get(k, 0)
                total['errors'] += r.get('errors', [])
            for m in bad:
                total['errors'].append({'row': m['row'], 'empNo': str(m['data'].get('empNo', '')), 'message': self.err_text(m)})
            return total

        run_async(work, self.finished, lambda m: (self.msg.setText(m), self.run_btn.setEnabled(True)))

    def finished(self, r):
        self.result = r
        lines = ['%s: %d   %s: %d   %s: %d   %s: %d' % (I('created'), r['created'], I('updated'), r['updated'], I('skipped'), r['skipped'], I('failed'), len(r['errors']))]
        lines += ['%s %s: %s' % (LAB['row'][_ix()], e['row'], e['message']) for e in r['errors'][:20]]
        self.msg.setText('%s\n%s' % (I('done'), '\n'.join(lines)))
        self.on_done()


class HireDialog(QDialog):
    """Hire a candidate: creates the employee (prefilled from the candidate and the vacancy) and marks the candidate Hired."""
    KEYS = ('empNo', 'fullName', 'email', 'phone', 'position', 'unit', 'location', 'grade', 'hireDate')

    def __init__(self, parent, cand, vacancies, done):
        super().__init__(parent)
        self.cand, self.on_done = cand, done
        d = cand.get('data') or {}
        v = next((x.get('data') or {} for x in vacancies if x.get('code') == d.get('vacancy')), {})
        pre = dict(fullName=d.get('name'), email=d.get('email'), phone=d.get('phone'), position=v.get('title'), unit=v.get('unit'), location=v.get('location'), grade=v.get('grade'), hireDate=date.today().isoformat())
        self.setWindowTitle(L('hireTitle'))
        lay = QVBoxLayout(self)
        form = QFormLayout()
        self.f = {}
        names = {x['key']: tx(x) for x in SPEC['fields']}
        for k in self.KEYS:
            self.f[k] = QLineEdit(str(pre.get(k) or ''))
            form.addRow(names.get(k, k) + (' *' if k in ('empNo', 'fullName') else ''), self.f[k])
        lay.addLayout(form)
        self.err = QLabel('')
        lay.addWidget(self.err)
        lay.addWidget(button(L('hire'), self.save))

    def save(self):
        body = {k: w.text().strip() for k, w in self.f.items() if w.text().strip()}
        if not body.get('empNo') or not body.get('fullName'):
            self.err.setText(L('empNoReq'))
            return
        body['status'] = 'Probation'
        cand = self.cand

        def work():
            e = api.hr('POST', 'employees', body)
            api.hr('PUT', 'records/candidate/' + cand['id'], {'status': 'Hired', 'data': cand.get('data')})
            return e
        run_async(work, lambda e: (self.accept(), self.on_done()), lambda m: self.err.setText(m))


class HrPage(QWidget):
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
        bar.addWidget(button(L('refresh'), self.reload))
        self.b_import = button(L('import'), self.open_import, 'ghost')
        self.b_a, self.b_b, self.b_c, self.b_d = (button('', lambda i=i: self.act(i)) for i in range(4))
        for b in (self.b_import, self.b_a, self.b_b, self.b_c, self.b_d):
            bar.addWidget(b)
        lay.addLayout(bar)
        self.table = make_table([])
        lay.addWidget(self.table, 1)
        self.foot = QLabel('')
        self.msg = QLabel('')
        lay.addWidget(self.foot)
        lay.addWidget(self.msg)
        self.rep, self.data = None, {}

    def reload(self):
        if not self.reports:
            self.msg.setText(L('noperm'))
            return
        rep = self.rep = next(r for r in self.reports if r['id'] == self.pick.currentData())
        rid = rep['id']
        self.b_import.setVisible(rid == 'employees' and api.can('hr.employees.import'))
        acts = rep.get('actions', [])
        can = {'leave': api.can('hr.leave.approve'), 'recruit': api.can('hr.recruitment.manage')}.get(rid, False)
        for b, name in zip((self.b_a, self.b_b, self.b_c, self.b_d), (acts + [None] * 4)[:4]):
            b.setVisible(bool(name) and can)
            if name:
                b.setText(L(name))
        cols = visible_cols(rep)
        self.table.setColumnCount(len(cols))
        self.table.setHorizontalHeaderLabels([tx(c) for c in cols])
        self.msg.setText('…')
        run_async(lambda: fetch(rid), lambda d: self.show_data(rep, d), lambda m: self.msg.setText(m))

    def show_data(self, rep, data):
        if rep is not self.rep:
            return
        self.data = data
        rows, pay, foot = build(rep, data)
        fill_table(self.table, rows, pay)
        cols = visible_cols(rep)
        for r in range(len(rows)):
            for c, col in enumerate(cols):
                it = self.table.item(r, c)
                if it and col.get('num'):
                    it.setTextAlignment(0x0002 | 0x0080)
        self.foot.setText(foot)
        self.msg.setText('' if rows else L('empty'))

    def open_import(self):
        ImportDialog(self, self.reload).exec()

    def act(self, which):
        rec = current_payload(self.table)
        if not rec or not self.rep:
            return
        rid = self.rep['id']
        name = self.rep['actions'][which]
        if rid == 'leave':
            if rec.get('status') != 'Pending':
                return
            status = 'Approved' if name == 'approve' else 'Rejected'
            body = {'status': status, 'empNo': rec.get('empNo'), 'data': rec.get('data')}
            path = 'records/leave/' + rec['id']
        elif name == 'hire':
            if rec.get('status') == 'Offer':
                HireDialog(self, rec, self.data.get('vacancy', []), self.reload).exec()
            return
        elif name == 'reject':
            if rec.get('status') in ('Hired', 'Rejected'):
                return
            body = {'status': 'Rejected', 'data': rec.get('data')}
            path = 'records/candidate/' + rec['id']
        else:
            stages = SPEC['stages']
            cur = stages.index(rec.get('status') or 'Applied')
            to = cur + (1 if name == 'next' else -1)
            if not 0 <= to < len(stages):
                return
            body = {'status': stages[to], 'data': rec.get('data')}
            path = 'records/candidate/' + rec['id']
        run_async(lambda: api.hr('PUT', path, body), lambda _: self.reload(), lambda m: warn(self, m))
