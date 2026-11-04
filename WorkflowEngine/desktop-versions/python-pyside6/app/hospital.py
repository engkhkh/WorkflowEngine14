"""Hospital: patients, appointments, visits, lab, pharmacy, wards and billing.
The screens are described by data/hospital.json (shared by every desktop app); this file is the engine that draws them."""
import copy
import os
import json
from datetime import date
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFormLayout, QHBoxLayout, QInputDialog, QLineEdit, QPlainTextEdit, QTabWidget,
                               QTextBrowser, QVBoxLayout, QWidget)

from app import i18n
from app.api import ApiError, api
from app.i18n import t
from app.ui import ask, button, current_payload, fill_table, label, make_table, run_async, warn

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'hospital.json').read_text(encoding='utf-8'))['sections']


def L(o, k='en'):
    return o.get('ar' if i18n.rtl() else 'en') or o.get('en') or o.get(k, '')


def getp(o, path):
    for part in path.split('.'):
        if isinstance(o, dict):
            o = o.get(part)
        else:
            return None
    return o


def setp(o, path, v):
    parts = path.split('.')
    for p in parts[:-1]:
        o = o.setdefault(p, {})
    o[parts[-1]] = v


def today():
    return date.today().isoformat()


def templ(v, row):
    if not isinstance(v, str):
        return v
    if v == '$today':
        return today()
    if v.startswith('@'):
        return row.get('status') == v[1:]
    if v.startswith('{') and v.endswith('}') and v.count('{') == 1:
        return getp(row, v[1:-1])
    for k in ('id', 'code', 'parent', 'ref'):
        v = v.replace('{' + k + '}', str(row.get(k) or ''))
    return v


def cell(rec, col):
    v = getp(rec, col['p'])
    ty = col.get('t')
    if v is None:
        return ''
    if ty == 'items':
        return '; '.join(f"{i.get('name', '')} {i.get('strength', '')} {i.get('dose', '')} {i.get('frequency', '')} {i.get('dispensed', 0)}/{i.get('qty', '')}".replace('  ', ' ').strip() for i in v)
    if ty == 'money':
        return '{:,.2f}'.format(float(v or 0))
    if isinstance(v, list):
        return ', '.join(str(x) for x in v)
    s = str(v)
    return s.replace('T', ' ')[:16] if col['p'] in ('createdAt', 'data.start') else s


def flatten(o, ind=0):
    pad = '  ' * ind
    out = []
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, (dict, list)) and v:
                out.append(f'{pad}{k}:')
                out += flatten(v, ind + 1)
            elif v not in (None, '', [], {}):
                out.append(f'{pad}{k}: {v}')
    elif isinstance(o, list):
        for i in o:
            if isinstance(i, (dict, list)):
                out.append(f'{pad}-')
                out += flatten(i, ind + 1)
            else:
                out.append(f'{pad}- {i}')
    else:
        out.append(f'{pad}{o}')
    return out


def dx_text(lst):
    return '\n'.join((f"{d.get('code')} | {d.get('name')}" if d.get('code') else str(d.get('name', ''))) for d in (lst or []))


def dx_list(txt):
    out = []
    for ln in (txt or '').splitlines():
        ln = ln.strip()
        if not ln:
            continue
        c, _, n = ln.partition('|')
        out.append({'code': c.strip(), 'name': n.strip()} if n else {'code': '', 'name': ln})
    return out


def num(v):
    try:
        f = float(str(v).strip())
    except ValueError:
        return None
    return int(f) if f == int(f) else f


def build_body(action, vals, row, keep_empty=False):
    """Turns the form values into the request body described by the action in the spec."""
    body, joins = {}, {}
    for f in action.get('fields', []):
        k, ty, v = f['k'], f.get('t', 'text'), vals.get(f['k'])
        if ty == 'num':
            v = num(v) if v not in (None, '') else None
        elif ty == 'check':
            v = bool(v)
        elif ty == 'dx':
            v = dx_list(v)
            if not v and not keep_empty:
                v = None
        else:
            v = (v or '').strip() if isinstance(v, str) or v is None else v
            if v == '' and not keep_empty:
                v = None
        if f.get('join'):
            joins.setdefault(f['join'], []).append(v)
        elif v is None:
            continue
        elif k.endswith('[]'):
            body.setdefault(k[:-2], []).append(v)
        elif '[].' in k:
            base, sub = k.split('[].')
            lst = body.setdefault(base, [{}])
            lst[0][sub] = v
        else:
            setp(body, k, v)
    for j, parts in joins.items():
        body[j] = 'T'.join(str(p) for p in parts if p)
    for k, v in action.get('body', {}).items():
        body[k] = templ(v, row)
    return body


def do_action(sec, act, row, vals, extra=None):
    """Runs one action against the server (blocking). Raises ApiError."""
    kind = sec['kind']
    if act.get('get'):
        return api.hos('GET', templ(act['get'], row))
    if act.get('toggle'):
        st = act['back'] if row.get('status') == act['toggle'] else act['toggle']
        return api.hos('PUT', f"records/{kind}/{row['id']}", {'data': row.get('data'), 'branch': row.get('branch'), 'status': st})
    if act.get('record') == 'update':
        data = copy.deepcopy(row.get('data') or {})
        for k, v in (build_body(act, vals, row, True).get('data') or {}).items():
            data[k] = v
        return api.hos('PUT', f"records/{kind}/{row['id']}", {'data': data, 'status': row.get('status'), 'branch': row.get('branch')})
    if act.get('record') == 'create':
        return api.hos('POST', f'records/{kind}', {'data': build_body(act, vals, {}, True).get('data', {})})
    method = 'PUT' if act.get('put') else 'POST'
    path = templ(act.get('put') or act.get('post'), row)
    body = build_body(act, vals, row)
    body.update(extra or {})
    return api.hos(method, path, body)


def options(f):
    """[(value, label)] for a select field, from the spec or from the server."""
    if f.get('opts') is not None:
        return [(o, o) for o in f['opts']]
    s = f.get('src') or {}
    recs = api.hos('GET', 'records/' + s['kind'], None, take=s.get('take', 200), **(s.get('params') or {})) or []
    lab = s.get('l', 'data.name')
    return [('', '')] + [(getp(r, s.get('v', 'code')), f"{getp(r, lab) or ''} · {r.get('code')}") for r in recs if r.get('status') != 'Inactive']


def invoice_html(r):
    """A printable page for one hospital invoice (items, tax, insurance, payments, balance)."""
    import html as H
    e = lambda v: H.escape(str(v if v is not None else ''))
    d = r.get('data') or {}
    m = lambda v: format(num(v), ',.2f')
    rows = ''.join('<tr><td>%s</td><td class="n">%s</td><td class="n">%s</td><td class="n">%s</td></tr>' % (e(l.get('desc')), e(l.get('qty')), m(l.get('price')), m(l.get('amount'))) for l in d.get('lines') or [])

    def tot(label, v, bold=False):
        return '<tr><td colspan="3" class="n">%s</td><td class="n">%s</td></tr>' % (('<b>%s</b>' % label) if bold else label, ('<b>%s</b>' % v) if bold else v)
    out = ''
    if num(d.get('tax')):
        out += tot(t('hos.pr.subtotal'), m(d.get('gross'))) + tot('%s (%s%%)' % (e(d.get('taxName') or 'VAT'), e(d.get('taxPct'))), m(d.get('tax')))
    out += tot(t('hos.pr.total'), m(d.get('total') if d.get('total') is not None else d.get('gross')), True)
    if num(d.get('insurance')):
        out += tot('%s (%s%%)' % (e(d.get('insuranceName')), e(d.get('insurancePct'))), '- ' + m(d.get('insurance')))
    out += tot(t('hos.pr.due'), m(d.get('due')), True)
    for p in d.get('payments') or []:
        out += tot('%s - %s - %s' % (e(str(p.get('at') or '')[:10]), e(p.get('method')), e(p.get('by'))), '- ' + m(p.get('amount')))
    out += tot(t('hos.pr.balance'), m(d.get('balance')), True)
    return ('<!doctype html><meta charset="utf-8"><title>%s</title><style>body{font:14px system-ui;margin:40px;color:#111}table{width:100%%;border-collapse:collapse;margin:20px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}.n{text-align:end}</style>'
            '<h1>%s</h1><p>%s</p><table><tr><th>%s</th><th class="n">%s</th><th class="n">%s</th><th class="n">%s</th></tr>%s%s</table><script>window.onload=function(){window.print()}</script>') % (
        e(r.get('code')), e(r.get('code')), e(d.get('patientName')), t('hos.pr.item'), t('hos.pr.qty'), t('hos.pr.price'), t('hos.pr.amount'), rows, out)


def open_invoice(r):
    import tempfile
    import webbrowser
    path = os.path.join(tempfile.gettempdir(), 'invoice-%s.html' % (r.get('code') or 'x'))
    open(path, 'w', encoding='utf-8').write(invoice_html(r))
    webbrowser.open('file://' + path)
    return path


class FormDialog(QDialog):
    def __init__(self, parent, title, fields, row, opts):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setMinimumWidth(460)
        self.fields, self.w = fields, {}
        lay = QVBoxLayout(self)
        form = QFormLayout()
        for f in fields:
            ty, d = f.get('t', 'text'), None
            if f.get('from'):
                d = dx_text(getp(row, f['from'])) if ty == 'dx' else getp(row, f['from'])
            if d is None and f.get('def') is not None:
                d = templ(f['def'], row)
            if ty == 'select':
                w = QComboBox()
                for v, lab in opts.get(f['k'], []):
                    w.addItem(lab, v)
                i = w.findData(d if d is not None else '')
                w.setCurrentIndex(max(0, i))
            elif ty == 'check':
                w = QCheckBox()
                w.setChecked(bool(d))
            elif ty in ('area', 'dx'):
                w = QPlainTextEdit(str(d or ''))
                w.setFixedHeight(70)
            else:
                w = QLineEdit('' if d is None else str(d))
            self.w[f['k']] = w
            form.addRow(L(f) + (' *' if f.get('req') else ''), w)
        lay.addLayout(form)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        bb = QDialogButtonBox()
        ok = bb.addButton(t('hos.ui.run'), QDialogButtonBox.AcceptRole)
        bb.addButton(t('common.cancel'), QDialogButtonBox.RejectRole)
        bb.accepted.connect(self.go)
        bb.rejected.connect(self.reject)
        lay.addWidget(bb)

    def values(self):
        out = {}
        for f in self.fields:
            w = self.w[f['k']]
            out[f['k']] = (w.currentData() if isinstance(w, QComboBox) else w.isChecked() if isinstance(w, QCheckBox) else w.toPlainText() if isinstance(w, QPlainTextEdit) else w.text())
        return out

    def go(self):
        v = self.values()
        for f in self.fields:
            if f.get('req') and (v[f['k']] in (None, '', False)):
                self.err.setText(L(f) + ' *')
                return
        self.accept()


class Section(QWidget):
    def __init__(self, sec):
        super().__init__()
        self.sec, self.rows = sec, []
        lay = QVBoxLayout(self)
        bar = QHBoxLayout()
        self.q = QLineEdit()
        self.q.setPlaceholderText(t('common.search'))
        self.q.returnPressed.connect(self.reload)
        self.q.setVisible(bool(sec.get('search')))
        self.day = QLineEdit(today())
        self.day.setMaximumWidth(120)
        self.day.setVisible(bool(sec.get('day')))
        self.day.returnPressed.connect(self.reload)
        self.status = QComboBox()
        for s in sec.get('status', []):
            self.status.addItem(s or t('hos.ui.all'), s)
        self.status.setVisible(bool(sec.get('status')))
        self.status.currentIndexChanged.connect(lambda *_: self.reload())
        for w in (self.q, self.day, self.status):
            bar.addWidget(w)
        bar.addWidget(button(t('common.refresh'), self.reload))
        if sec.get('create'):
            bar.addWidget(button(L(sec['create']), lambda: self.act(sec['create'], True), 'primary'))
        bar.addStretch(1)
        self.err = label('', 'error')
        lay.addLayout(bar)
        lay.addWidget(self.err)
        self.table = make_table([L(c) for c in sec['columns']])
        self.table.itemSelectionChanged.connect(self.sel_changed)
        lay.addWidget(self.table, 3)
        self.bar = QHBoxLayout()
        self.btns = {}
        for a in sec.get('actions', []):
            b = button(L(a), lambda a=a: self.act(a))
            self.btns[a['id']] = b
            self.bar.addWidget(b)
        self.bar.addStretch(1)
        lay.addLayout(self.bar)
        self.detail = QTextBrowser()
        self.detail.setMaximumHeight(170)
        self.detail.hide()
        lay.addWidget(self.detail)
        self.sel_changed()

    # ---- data
    def fetch(self):
        s = self.sec
        q = dict(take=s.get('take', 200))
        if s.get('search') and self.q.text().strip():
            q['q'] = self.q.text().strip()
        if s.get('day'):
            q['ref'] = self.day.text().strip()
        if s.get('status') and self.status.currentData():
            q['status'] = self.status.currentData()
        return api.hos('GET', 'records/' + s['kind'], None, **q) or []

    def reload(self):
        self.err.setText('')
        run_async(self.fetch, self.paint, lambda m: self.err.setText(m))

    def paint(self, rows):
        self.rows = rows
        fill_table(self.table, [[cell(r, c) for c in self.sec['columns']] for r in rows], rows)
        self.sel_changed()

    def cur(self):
        return current_payload(self.table)

    def sel_changed(self):
        r = self.cur()
        for a in self.sec.get('actions', []):
            ok = r is not None and (not a.get('when') or r.get('status') in a['when'])
            self.btns[a['id']].setEnabled(bool(ok))

    # ---- actions
    def act(self, a, creating=False):
        row = {} if creating else (self.cur() or {})
        if not creating and not row:
            return
        if a.get('confirm') and not ask(self, t('hos.ui.confirm'), t('common.yes'), t('common.no')):
            return
        fields = a.get('fields', [])
        if not fields:
            return self.perform(a, row, {})

        def load():
            return {f['k']: options(f) for f in fields if f.get('t') == 'select'}

        def open_form(opts):
            dlg = FormDialog(self, L(a), fields, row, opts)
            if dlg.exec():
                self.perform(a, row, dlg.values())
        run_async(load, open_form, lambda m: self.err.setText(m))

    def perform(self, a, row, vals, extra=None):
        self.err.setText('')

        def go():
            try:
                return do_action(self.sec, a, row, vals, extra)
            except ApiError as e:
                # a safety warning (allergy, interaction) can be overridden with a written reason
                if a.get('warn') and e.status == 409 and e.body.get('warnings'):
                    return {'__warn': e.body}
                raise
        run_async(go, lambda r: self.done(a, row, vals, r), lambda m: self.err.setText(m))

    def done(self, a, row, vals, r):
        if isinstance(r, dict) and '__warn' in r:
            w = r['__warn']
            reason, ok = QInputDialog.getText(self, t('hos.ui.warnings'), w.get('message', '') + '\n\n' + '\n'.join('• ' + x for x in w['warnings']) + '\n\n' + t('hos.ui.override'))
            if ok and reason.strip():
                self.perform(a, row, vals, {'overrideReason': reason.strip()})
            return
        if a.get('print'):
            open_invoice(r)
            self.err.setText(t('hos.pr.saved'))
        elif a.get('show'):
            self.detail.setPlainText('\n'.join(flatten(r)))
            self.detail.show()
        else:
            self.detail.hide()
            self.reload()


class Dashboard(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        self.body = QTextBrowser()
        lay.addWidget(self.body, 1)
        lay.addWidget(button(t('common.refresh'), self.reload))

    def reload(self):
        run_async(lambda: api.hos('GET', 'dashboard', None, today=today(), tz=0), self.paint, lambda m: self.err.setText(m))

    def paint(self, d):
        ap, bd = d['appointmentsToday'], d['beds']
        rows = [(t('hos.ui.patients'), d['patients']), (t('hos.ui.openVisits'), d['openVisits']), (t('hos.ui.admitted'), d['admitted']), (t('hos.ui.labs'), d['pendingLabs']), (t('hos.ui.rx'), d['pendingRx']),
                (t('hos.ui.appts'), f"{ap['total']} ({ap['booked']}/{ap['checkedIn']}/{ap['completed']}/{ap['cancelled']})"), (t('hos.ui.beds'), f"{bd['occupied']}/{bd['total']} · {bd['occupancyPct']}%"),
                (t('hos.ui.revenue'), '{:,.2f}'.format(d['revenueToday'])), (t('hos.ui.outstanding'), '{:,.2f}'.format(d['outstanding']))]
        h = '<table cellpadding=6>' + ''.join(f'<tr><td>{k}</td><td><b>{v}</b></td></tr>' for k, v in rows) + '</table>'
        if d.get('lowStock'):
            h += f"<h4>{t('hos.ui.lowstock')}</h4>" + '<br>'.join(f"{x['name']} — {x['stock']} / {x['reorder']}" for x in d['lowStock'])
        self.body.setHtml(h)


class HospitalPage(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        lay.addWidget(label(t('tab.hos'), 'title'))
        self.tabs = QTabWidget()
        self.views = []
        self.secs = [s for s in SPEC if any(api.can(p) for p in s['perm'])]
        for s in self.secs:
            w = Dashboard() if s.get('type') == 'dashboard' else Section(s)
            self.views.append(w)
            self.tabs.addTab(w, L(s))
        self.tabs.currentChanged.connect(lambda i: self.views[i].reload())
        lay.addWidget(self.tabs, 1)

    def reload(self):
        if self.views:
            self.views[self.tabs.currentIndex()].reload()
