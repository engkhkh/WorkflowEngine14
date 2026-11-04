import json
import re

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QComboBox, QTabWidget, QDialog, QFormLayout, QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit, QSplitter,
                               QTextEdit, QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget, QTableWidget, QTableWidgetItem, QAbstractItemView, QHeaderView)

from . import i18n
from .api import api
from .i18n import name, t
from .forms import Chatter, TypedForm, is_negative
from .ui import DIM, button, current_payload, fill_table, label, make_table, run_async, warn, ask

STATUS_COLORS = {'Approved': '#16a34a', 'Active': '#16a34a', 'Completed': '#16a34a', 'Posted': '#16a34a', 'Paid': '#16a34a',
                 'Rejected': '#dc2626', 'Cancelled': '#dc2626', 'Terminated': '#dc2626', 'Expired': '#dc2626',
                 'Pending': '#d97706', 'Draft': '#d97706', 'Running': '#d97706'}


def visible_modules():
    return [m for m in i18n.catalog if any(api.can(k['view']) for k in m['kinds'])]


def short(v, n=60):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    return s if len(s) <= n else s[:n] + '…'


class Page(QWidget):
    """A page that reloads whenever it is shown."""
    def __init__(self):
        super().__init__()
        self.lay = QVBoxLayout(self)
        self.lay.setContentsMargins(20, 16, 20, 16)

    def title(self, text):
        self.lay.addWidget(label(text, 'title'))

    def reload(self):
        pass


class Card(QFrame):
    clicked = Signal()

    def __init__(self, big, small):
        super().__init__()
        self.setProperty('card', True)
        self.setCursor(Qt.PointingHandCursor)
        lay = QVBoxLayout(self)
        b = QLabel(str(big))
        b.setStyleSheet('font-size: 30px; font-weight: 700; color: #2563eb; border: none;')
        s = QLabel(small)
        s.setStyleSheet('color: #64748b; border: none;')
        s.setWordWrap(True)
        lay.addWidget(b)
        lay.addWidget(s)
        self.big = b

    def mousePressEvent(self, e):
        self.clicked.emit()


# --------------------------------------------------------------------------- home
class HomePage(Page):
    def __init__(self, go_page, open_kind):
        super().__init__()
        self.go_page, self.open_kind = go_page, open_kind
        self.hello = label('', 'title')
        self.lay.addWidget(self.hello)
        row = QHBoxLayout()
        self.c_tasks = Card('–', t('home.pendingTasks'))
        self.c_appr = Card('–', t('home.pendingApprovals'))
        self.c_docs = Card('–', t('home.myDocs'))
        for c, pg in ((self.c_tasks, 1), (self.c_appr, 1), (self.c_docs, 2)):
            c.clicked.connect(lambda pg=pg: self.go_page(pg))
            row.addWidget(c)
        self.lay.addLayout(row)
        self.lay.addSpacing(10)
        self.lay.addWidget(label(t('home.modules'), 'title'))
        grid = QGridLayout()
        for i, m in enumerate(visible_modules()):
            b = button(name(m), lambda m=m: self.open_kind(m['id'], None), 'ghost')
            grid.addWidget(b, i // 4, i % 4)
        self.lay.addLayout(grid)
        self.lay.addStretch()

    def reload(self):
        self.hello.setText(t('home.hello', name=api.session.display_name))

        def load():
            tk = _safe(api.tasks)
            ap = _safe(lambda: api.records('gov', 'approval')) if api.can('gov.view') else []
            return len(tk), len([a for a in ap if a.get('status') == 'Pending' and (a.get('data') or {}).get('canAct')]), len(_safe(api.instances))

        def show(r):
            self.c_tasks.big.setText(str(r[0])); self.c_appr.big.setText(str(r[1])); self.c_docs.big.setText(str(r[2]))
        run_async(load, show)


def _safe(fn):
    try:
        return fn()
    except Exception:  # noqa: BLE001
        return []


# --------------------------------------------------------------------------- approvals
class ApprovalDialog(QDialog):
    def __init__(self, parent, task=None, appr=None):
        super().__init__(parent)
        self.task, self.appr = task, appr
        d = (appr or {}).get('data') or {}
        self.setWindowTitle(task['nodeName'] if task else f"{d.get('target', '')} {d.get('code') or appr.get('code') or ''}")
        self.setMinimumWidth(420)
        lay = QVBoxLayout(self)
        lay.addWidget(label(self.windowTitle(), 'title'))
        if appr:
            lay.addWidget(label(f"{t('appr.amount')}: {d.get('amount', '-')}"))
            lay.addWidget(label(f"{t('appr.requestedBy')}: {d.get('requestedBy') or appr.get('createdBy') or ''}"))
            if d.get('canAct') is False:
                lay.addWidget(label(t('appr.cantAct'), 'error'))
        self.form = None
        if task and (task.get('form') or {}).get('fields'):
            self.setMinimumWidth(480)
            if task['form'].get('title'):
                lay.addWidget(label(task['form']['title'], 'dim'))
            self.form = TypedForm(task['form'])
            lay.addWidget(self.form)
            # pre-fill the step's form from the data already collected on this document
            run_async(lambda: api.instance(task['instanceId']), lambda i: self.form.set_values((i or {}).get('data') or {}), lambda _m: None)
        self.comment = QTextEdit()
        self.comment.setPlaceholderText(t('appr.comment'))
        self.comment.setFixedHeight(80)
        lay.addWidget(self.comment)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        row = QHBoxLayout()
        self.btns = []
        if task:
            for dec in task.get('availableDecisions', []):
                bad = re.search('reject|deny|decline', dec, re.I)
                b = button(dec, lambda dec=dec: self.act(dec), 'danger' if bad else None)
                self.btns.append(b); row.addWidget(b)
        else:
            ok = d.get('canAct') is not False
            a = button(t('appr.approve'), lambda: self.act('approve')); a.setEnabled(ok)
            r = button(t('appr.reject'), lambda: self.act('reject'), 'danger'); r.setEnabled(ok)
            self.btns += [a, r]; row.addWidget(a); row.addWidget(r)
        row.addWidget(button(t('common.cancel'), self.reject, 'ghost'))
        lay.addLayout(row)

    def act(self, decision):
        text = self.comment.toPlainText()
        self.err.setText('')
        form = None
        if self.form is not None:
            if not is_negative(decision) and self.form.missing():
                self.err.setText(t('tasks.missing'))
                return
            form = self.form.values()
        for b in self.btns:
            b.setEnabled(False)
        if self.task:
            fn = lambda: api.complete_task(self.task['id'], decision, text, form)  # noqa: E731
        else:
            fn = lambda: api.approval_act(self.appr['id'], 'reject' if decision == 'reject' else 'approve', text)  # noqa: E731
        run_async(fn, lambda _r: self.accept(), self._failed)

    def _failed(self, msg):
        self.err.setText(msg)
        for b in self.btns:
            b.setEnabled(True)


class ApprovalsPage(Page):
    def __init__(self):
        super().__init__()
        self.title(t('tab.approvals'))
        bar = QHBoxLayout()
        bar.addStretch()
        bar.addWidget(button(t('common.refresh'), self.reload, 'ghost'))
        self.lay.addLayout(bar)
        self.table = make_table([t('appr.type'), t('appr.target'), t('appr.requestedBy'), t('erp.status')])
        self.table.doubleClicked.connect(lambda *_: self.open())
        self.lay.addWidget(self.table)
        self.empty = label(t('appr.none'), 'dim')
        self.lay.addWidget(self.empty)

    def reload(self):
        def load():
            tk = api.tasks()
            ap = [a for a in (api.records('gov', 'approval') if api.can('gov.view') else []) if a.get('status') == 'Pending']
            return tk, ap

        def show(r):
            tk, ap = r
            rows, pay = [], []
            for x in tk:
                rows.append([t('appr.workflow'), x['nodeName'], x.get('priority') or 'Normal', 'Pending']); pay.append(('wf', x))
            for a in ap:
                d = a.get('data') or {}
                rows.append([t('appr.erp'), f"{d.get('target', '')} {d.get('code') or a.get('code') or ''}", d.get('requestedBy') or a.get('createdBy') or '', a.get('status') or ''])
                pay.append(('erp', a))
            fill_table(self.table, rows, pay)
            self.empty.setVisible(not rows)
        run_async(load, show, lambda m: warn(self, m))

    def open(self):
        p = current_payload(self.table)
        if not p:
            return
        dlg = ApprovalDialog(self, task=p[1]) if p[0] == 'wf' else ApprovalDialog(self, appr=p[1])
        if dlg.exec():
            self.reload()


# --------------------------------------------------------------------------- documents
class InstanceDialog(QDialog):
    def __init__(self, parent, inst):
        super().__init__(parent)
        self.inst = inst
        self.setWindowTitle(inst['definitionName'])
        self.setMinimumSize(520, 420)
        lay = QVBoxLayout(self)
        lay.addWidget(label(inst['definitionName'], 'title'))
        lay.addWidget(label(f"{t('docs.status')}: {inst['status']}"))
        lay.addWidget(label(t('docs.history'), 'title'))
        tb = make_table([t('erp.name'), t('docs.status'), t('appr.requestedBy'), t('appr.comment')])
        rows = [[h.get('nodeName', ''), h.get('action', ''), h.get('actor') or '', h.get('comment') or ''] for h in inst.get('history', [])]
        fill_table(tb, rows, rows)
        lay.addWidget(tb)
        row = QHBoxLayout()
        if inst['status'] == 'Running':
            row.addWidget(button(t('docs.cancel'), self.cancel_it, 'danger'))
        row.addStretch()
        row.addWidget(button(t('common.close'), self.reject, 'ghost'))
        lay.addLayout(row)

    def cancel_it(self):
        if not ask(self, t('docs.cancel') + '?', t('common.yes'), t('common.no')):
            return
        run_async(lambda: api.cancel_instance(self.inst['id']), lambda _r: self.accept(), lambda m: warn(self, m))


class NewRequestDialog(QDialog):
    def __init__(self, parent, defs):
        super().__init__(parent)
        self.setWindowTitle(t('docs.choose'))
        self.setMinimumWidth(420)
        lay = QVBoxLayout(self)
        lay.addWidget(label(t('docs.choose'), 'title'))
        self.combo = QComboBox()
        for d in defs:
            self.combo.addItem(d['name'], d)
        lay.addWidget(self.combo)
        self.note = QTextEdit()
        self.note.setPlaceholderText(t('appr.comment'))
        self.note.setFixedHeight(80)
        lay.addWidget(self.note)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        row = QHBoxLayout()
        self.go = button(t('docs.start'), self.start)
        self.go.setEnabled(bool(defs))
        row.addWidget(self.go)
        row.addWidget(button(t('common.cancel'), self.reject, 'ghost'))
        lay.addLayout(row)

    def start(self):
        d = self.combo.currentData()
        note = self.note.toPlainText().strip()
        self.go.setEnabled(False)
        def started(inst):
            # a flow that begins with a form step asks for it right away, like the portal's Submit screen
            def find():
                return next((tk for tk in api.tasks() if tk.get('instanceId') == (inst or {}).get('id') and (tk.get('form') or {}).get('fields')), None)

            def got(task):
                self.accept()
                if task:
                    ApprovalDialog(self.parent(), task=task).exec()
            run_async(find, got, lambda _m: self.accept())
        run_async(lambda: api.start_instance(d['id'], {'note': note} if note else {}), started,
                  lambda m: (self.err.setText(m), self.go.setEnabled(True)))


class DocumentsPage(Page):
    def __init__(self):
        super().__init__()
        self.title(t('docs.title'))
        bar = QHBoxLayout()
        bar.addWidget(button('+ ' + t('docs.new'), self.new))
        bar.addStretch()
        bar.addWidget(button(t('common.refresh'), self.reload, 'ghost'))
        self.lay.addLayout(bar)
        self.table = make_table([t('erp.name'), t('docs.status'), t('docs.when')])
        self.table.doubleClicked.connect(lambda *_: self.open())
        self.lay.addWidget(self.table)
        self.empty = label(t('docs.none'), 'dim')
        self.lay.addWidget(self.empty)

    def reload(self):
        def show(items):
            rows = [[i['definitionName'], i['status'], (i.get('startedAt') or '')[:16].replace('T', ' ')] for i in items]
            fill_table(self.table, rows, items)
            self.empty.setVisible(not rows)
        run_async(api.instances, show, lambda m: warn(self, m))

    def new(self):
        def got(defs):
            if NewRequestDialog(self, defs).exec():
                self.reload()
        run_async(api.definitions, got, lambda m: warn(self, m))

    def open(self):
        p = current_payload(self.table)
        if not p:
            return
        run_async(lambda: api.instance(p['id']), lambda full: InstanceDialog(self, full or p).exec() and self.reload(), lambda m: warn(self, m))


# --------------------------------------------------------------------------- ERP
class RecordDialog(QDialog):
    """Header fields plus one row per simple key of data (numbers and yes/no keep their type)."""
    def __init__(self, parent, module, kind, rec):
        super().__init__(parent)
        self.module, self.kind, self.rec = module, kind, rec
        self.editable = api.can(kind['manage']) and not kind.get('readOnly')
        self.setWindowTitle((rec or {}).get('code') or t('erp.new'))
        self.setMinimumSize(560, 600)
        outer = QVBoxLayout(self)
        tabs = QTabWidget()
        outer.addWidget(tabs, 1)
        data_tab = QWidget()
        lay = QVBoxLayout(data_tab)
        tabs.addTab(data_tab, t('collab.tab.data'))
        if rec and rec.get('id'):
            tabs.addTab(Chatter(module['id'], kind['kind'], rec['id']), t('collab.notes') + ' / ' + t('collab.files'))
        else:
            note = label(t('collab.save.first'), 'dim')
            lay.addWidget(note)
        if not self.editable:
            lay.addWidget(label(t('erp.readOnly'), 'dim'))
        form = QFormLayout()
        self.code = QLineEdit((rec or {}).get('code') or '')
        self.code.setEnabled(self.editable and rec is None)
        self.status = QLineEdit((rec or {}).get('status') or '')
        self.company = QLineEdit((rec or {}).get('company') or '')
        self.ref = QLineEdit((rec or {}).get('ref') or '')
        for w in (self.status, self.company, self.ref):
            w.setEnabled(self.editable)
        form.addRow(t('erp.code'), self.code)
        form.addRow(t('erp.status'), self.status)
        form.addRow(t('erp.company'), self.company)
        form.addRow(t('erp.ref'), self.ref)
        lay.addLayout(form)
        lay.addWidget(label(t('erp.data'), 'title'))
        self.data = dict((rec or {}).get('data') or (kind.get('template') if rec is None else None) or {})
        self.table = QTableWidget(0, 2)
        self.table.setHorizontalHeaderLabels([t('erp.fieldName'), t('erp.fieldValue')])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.verticalHeader().setVisible(False)
        lay.addWidget(self.table)
        self.fill()
        if self.editable:
            row = QHBoxLayout()
            self.newkey = QLineEdit()
            self.newkey.setPlaceholderText(t('erp.fieldName'))
            row.addWidget(self.newkey)
            row.addWidget(button(t('erp.addField'), self.add_field, 'ghost'))
            row.addWidget(button(t('erp.removeField'), self.remove_field, 'ghost'))
            lay.addLayout(row)
        self.err = label('', 'error')
        outer.addWidget(self.err)
        row = QHBoxLayout()
        if self.editable:
            row.addWidget(button(t('erp.save'), self.save))
            if rec:
                row.addWidget(button(t('erp.delete'), self.delete, 'danger'))
        row.addStretch()
        row.addWidget(button(t('common.close'), self.reject, 'ghost'))
        outer.addLayout(row)

    @staticmethod
    def simple(v):
        return v is None or isinstance(v, (str, int, float, bool))

    def fill(self):
        self.table.setRowCount(len(self.data))
        self.types = {}
        for i, (k, v) in enumerate(self.data.items()):
            ki = QTableWidgetItem(k)
            ki.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            self.table.setItem(i, 0, ki)
            if self.simple(v):
                self.types[k] = 'bool' if isinstance(v, bool) else 'num' if isinstance(v, (int, float)) else 'str'
                text = '' if v is None else ('true' if v is True else 'false' if v is False else str(v))
                vi = QTableWidgetItem(text)
                if not self.editable:
                    vi.setFlags(Qt.ItemIsEnabled)
            else:
                self.types[k] = 'raw'
                vi = QTableWidgetItem(short(v, 160))
                vi.setFlags(Qt.ItemIsEnabled)
            self.table.setItem(i, 1, vi)

    def collect(self):
        out = dict(self.data)
        for i in range(self.table.rowCount()):
            k = self.table.item(i, 0).text()
            kind = self.types.get(k)
            if kind == 'raw':
                continue
            txt = self.table.item(i, 1).text()
            if kind == 'num':
                try:
                    out[k] = int(txt) if re.fullmatch(r'-?\d+', txt.strip()) else float(txt)
                except ValueError:
                    out[k] = txt
            elif kind == 'bool':
                out[k] = txt.strip().lower() in ('true', '1', 'yes')
            else:
                out[k] = txt
        return out

    def add_field(self):
        k = self.newkey.text().strip()
        if not re.fullmatch(r'[A-Za-z]\w*', k) or k in self.data:
            return
        self.data = self.collect()
        self.data[k] = ''
        self.newkey.clear()
        self.fill()

    def remove_field(self):
        r = self.table.currentRow()
        if r < 0:
            return
        k = self.table.item(r, 0).text()
        self.data = self.collect()
        self.data.pop(k, None)
        self.fill()

    def save(self):
        self.err.setText('')
        n = lambda w: w.text().strip() or None  # noqa: E731
        body = {'code': n(self.code), 'status': n(self.status), 'company': n(self.company), 'ref': n(self.ref), 'data': self.collect()}
        if self.rec:
            fn = lambda: api.update_record(self.module['id'], self.kind['kind'], self.rec['id'], body)  # noqa: E731
        else:
            fn = lambda: api.create_record(self.module['id'], self.kind['kind'], body)  # noqa: E731
        run_async(fn, lambda _r: self.accept(), self.err.setText)

    def delete(self):
        if not ask(self, t('erp.confirmDelete'), t('erp.delete'), t('common.cancel')):
            return
        run_async(lambda: api.delete_record(self.module['id'], self.kind['kind'], self.rec['id']), lambda _r: self.accept(), self.err.setText)


class ErpPage(Page):
    def __init__(self):
        super().__init__()
        self.module = self.kind = None
        self.rows = []
        self.filters = []
        split = QSplitter()
        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setMaximumWidth(240)
        for m in visible_modules():
            top = QTreeWidgetItem([name(m)])
            top.setData(0, Qt.UserRole, (m, None))
            for k in m['kinds']:
                if api.can(k['view']):
                    ch = QTreeWidgetItem([name(k)])
                    ch.setData(0, Qt.UserRole, (m, k))
                    top.addChild(ch)
            self.tree.addTopLevelItem(top)
        self.tree.itemClicked.connect(self.picked)
        split.addWidget(self.tree)
        right = QWidget()
        rl = QVBoxLayout(right)
        rl.setContentsMargins(12, 0, 0, 0)
        self.head = label(t('erp.title'), 'title')
        rl.addWidget(self.head)
        bar = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText(t('erp.search'))
        self.search.textChanged.connect(self.refill)
        bar.addWidget(self.search)
        self.status = QComboBox()
        self.status.addItem(t('collab.allStatus'), '')
        self.status.currentIndexChanged.connect(lambda *_: self.refill())
        bar.addWidget(self.status)
        # saved filters (same store as the portal: search text + status, optionally shared with the workspace)
        self.saved = QComboBox()
        self.saved.setMinimumWidth(150)
        self.saved.activated.connect(self.apply_saved)
        bar.addWidget(self.saved)
        bar.addWidget(button('🔖', self.save_filter, 'ghost'))
        self.btn_delf = button('🗑', self.delete_filter, 'ghost')
        self.btn_delf.setEnabled(False)
        bar.addWidget(self.btn_delf)
        self.btn_new = button('+ ' + t('erp.new'), self.new)
        bar.addWidget(self.btn_new)
        bar.addWidget(button('🖨', self.print_report, 'ghost'))
        bar.addWidget(button(t('common.refresh'), self.load, 'ghost'))
        rl.addLayout(bar)
        self.table = make_table([t('erp.code'), t('erp.name'), t('erp.status'), t('erp.company')])
        self.table.doubleClicked.connect(lambda *_: self.edit())
        rl.addWidget(self.table)
        self.msg = label(t('erp.noModules') if not visible_modules() else '', 'dim')
        rl.addWidget(self.msg)
        split.addWidget(right)
        split.setStretchFactor(1, 1)
        self.lay.addWidget(split)
        self.btn_new.setEnabled(False)

    def select(self, module_id, kind_id):
        for i in range(self.tree.topLevelItemCount()):
            top = self.tree.topLevelItem(i)
            if top.data(0, Qt.UserRole)[0]['id'] != module_id:
                continue
            top.setExpanded(True)
            target = top
            for j in range(top.childCount()):
                if kind_id is None or top.child(j).data(0, Qt.UserRole)[1]['kind'] == kind_id:
                    target = top.child(j)
                    break
            self.tree.setCurrentItem(target)
            self.picked(target)
            return

    def picked(self, item, *_):
        m, k = item.data(0, Qt.UserRole)
        if k is None:
            item.setExpanded(True)
            if item.childCount():
                self.picked(item.child(0))
            return
        self.module, self.kind = m, k
        self.head.setText(f'{name(m)} › {name(k)}')
        self.btn_new.setEnabled(api.can(k['manage']) and not k.get('readOnly'))
        self.search.blockSignals(True)
        self.search.clear()
        self.search.blockSignals(False)
        self.status.blockSignals(True)
        self.status.setCurrentIndex(0)
        self.status.blockSignals(False)
        self.load_filters()
        self.load()

    def load(self):
        if not self.kind:
            return
        m, k = self.module, self.kind
        self.msg.setText(t('common.loading'))

        def show(rows):
            if (m, k) != (self.module, self.kind):
                return
            self.rows = rows
            self.refill()
        run_async(lambda: api.records(m['id'], k['kind']), show, lambda e: self.msg.setText(e))

    # ---- saved filters
    def view_key(self):
        return f"{self.module['id']}:{self.kind['kind']}"

    def load_filters(self):
        m, k = self.module, self.kind

        def show(rows):
            if (m, k) != (self.module, self.kind):
                return
            self.filters = rows
            self.saved.clear()
            self.saved.addItem(t('collab.savedFilters'), None)
            for c in rows:
                self.saved.addItem(('👥 ' if c.get('shared') and not c.get('mine') else '') + (c.get('name') or ''), c)
            self.btn_delf.setEnabled(False)
        run_async(lambda: api.filters(self.view_key()), show, lambda _e: None)

    def apply_saved(self, i):
        c = self.saved.itemData(i)
        d = (c or {}).get('data') or {}
        self.search.blockSignals(True)
        self.search.setText(d.get('q') or '')
        self.search.blockSignals(False)
        st = d.get('status') or ''
        self.status.blockSignals(True)
        self.status.setCurrentIndex(max(0, self.status.findData(st)))
        self.status.blockSignals(False)
        self.btn_delf.setEnabled(bool(c and c.get('mine')))
        self.refill()

    def save_filter(self):
        if not self.kind:
            return
        dlg = QDialog(self)
        dlg.setWindowTitle(t('collab.saveFilter'))
        lay = QVBoxLayout(dlg)
        name_e = QLineEdit()
        name_e.setPlaceholderText(t('collab.filterName'))
        share = QCheckBox(t('collab.shareWorkspace'))
        lay.addWidget(name_e)
        lay.addWidget(share)
        row = QHBoxLayout()
        row.addWidget(button(t('admin.save'), dlg.accept))
        row.addWidget(button(t('common.cancel'), dlg.reject, 'ghost'))
        lay.addLayout(row)
        if not dlg.exec() or not name_e.text().strip():
            return
        data = {'q': self.search.text().strip(), 'status': self.status.currentData() or ''}
        run_async(lambda: api.save_filter(self.view_key(), name_e.text().strip(), share.isChecked(), data), lambda _r: self.load_filters(), lambda e: self.msg.setText(e))

    def delete_filter(self):
        c = self.saved.currentData()
        if c and c.get('mine'):
            run_async(lambda: api.del_filter(c['id']), lambda _r: self.load_filters(), lambda e: self.msg.setText(e))

    def refill(self):
        s = self.search.text().strip().lower()
        cur = self.status.currentData() or ''
        have = sorted({r.get('status') for r in self.rows if r.get('status')})
        if [self.status.itemData(i) for i in range(1, self.status.count())] != have:
            self.status.blockSignals(True)
            self.status.clear()
            self.status.addItem(t('collab.allStatus'), '')
            for v in have:
                self.status.addItem(v, v)
            self.status.setCurrentIndex(max(0, self.status.findData(cur)))
            self.status.blockSignals(False)
        shown = [r for r in self.rows if (not s or s in json.dumps([r.get('code'), r.get('status'), r.get('ref'), r.get('data')], ensure_ascii=False).lower())
                 and (not cur or r.get('status') == cur)]
        rows = []
        for r in shown:
            d = r.get('data') or {}
            rows.append([r.get('code') or '', str(d.get('name') or d.get('title') or d.get('description') or r.get('ref') or ''), r.get('status') or '', r.get('company') or ''])
        fill_table(self.table, rows, shown)
        self.shown_rows = rows
        self.msg.setText('' if rows else t('erp.none'))

    def print_report(self):
        if not self.kind:
            return
        from .report import ReportDialog
        cols = [dict(key=k, label=t(l), numeric=False) for k, l in (('code', 'erp.code'), ('name', 'erp.name'), ('status', 'erp.status'), ('company', 'erp.company'))]
        rows = [dict(zip(('code', 'name', 'status', 'company'), r)) for r in getattr(self, 'shown_rows', [])]
        ReportDialog(self, self.view_key(), name(self.kind), cols, rows, api.session.display_name).exec()

    def new(self):
        if self.kind and RecordDialog(self, self.module, self.kind, None).exec():
            self.load()

    def edit(self):
        r = current_payload(self.table)
        if r and RecordDialog(self, self.module, self.kind, r).exec():
            self.load()

    def reload(self):
        if self.kind:
            self.load()


# --------------------------------------------------------------------------- settings
class SettingsPage(Page):
    def __init__(self, set_lang, sign_out):
        super().__init__()
        self.title(t('tab.more'))
        s = api.session
        self.lay.addWidget(label(t('more.signedInAs'), 'dim'))
        self.lay.addWidget(label(f'{s.display_name}  ({s.username} · {s.role})', 'title'))
        if s.tenant:
            self.lay.addWidget(label(f"{t('more.workspace')}: {s.tenant}"))
        self.lay.addWidget(label(f"{t('more.server')}: {s.server}", 'dim'))
        self.lay.addSpacing(12)
        self.lay.addWidget(label(t('more.language'), 'dim'))
        row = QHBoxLayout()
        row.addWidget(button('English', lambda: set_lang('en'), None if i18n.lang == 'en' else 'ghost'))
        row.addWidget(button('العربية', lambda: set_lang('ar'), None if i18n.lang == 'ar' else 'ghost'))
        row.addStretch()
        self.lay.addLayout(row)
        self.lay.addSpacing(12)
        row2 = QHBoxLayout()
        row2.addWidget(button(t('more.signout'), sign_out, 'danger'))
        row2.addStretch()
        self.lay.addLayout(row2)
        self.lay.addStretch()
