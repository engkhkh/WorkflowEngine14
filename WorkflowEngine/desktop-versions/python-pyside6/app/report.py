"""Report designer: choose columns, title, header / footer, orientation, grouping and totals for the rows of a list, preview it and print it or
save it as PDF. Layouts can be saved per list (and shared with the workspace) through the same endpoint as the portal."""
import html
from datetime import datetime

from PySide6.QtCore import Qt, QMarginsF
from PySide6.QtGui import QPageLayout, QPageSize, QTextDocument
from PySide6.QtPrintSupport import QPrintDialog, QPrinter
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFileDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
                               QPlainTextEdit, QTextBrowser, QVBoxLayout, QWidget)

from . import i18n
from .api import api
from .i18n import t
from .ui import button, run_async

DEFAULT = dict(title='', subtitle='', header='', footer='', orientation='portrait', columns=[], groupBy='', totals=True, showDate=True, showUser=True, rowNumbers=False)


def _nf(n):
    s = '{:,.2f}'.format(n)
    return s.rstrip('0').rstrip('.') if '.' in s else s


def build_html(L, columns, rows, user=''):
    """The printable document (escaped values only). `columns` = [{key,label,numeric}], `rows` = [{key: shown value, key#: raw number}]."""
    by = {c['key']: c for c in columns}
    cols = [by[k] for k in L['order'] if k in L['columns'] and k in by]
    esc = lambda v: html.escape(str(v if v is not None else ''))
    num = lambda r, k: float(r.get(k + '#', r.get(k)) or 0) if str(r.get(k + '#', r.get(k)) or '0').replace('.', '', 1).replace('-', '', 1).replace(',', '').isdigit() else 0.0
    ncol = len(cols) + (1 if L['rowNumbers'] else 0)
    th = ''.join(f'<th align="{"right" if c["numeric"] else "left"}" bgcolor="#f1f3f5">{esc(c["label"])}</th>' for c in cols)
    head = f'<tr>{"<th bgcolor=#f1f3f5>#</th>" if L["rowNumbers"] else ""}{th}</tr>'
    idx = [0]

    def row(r):
        idx[0] += 1
        return '<tr>' + (f'<td align="right">{idx[0]}</td>' if L['rowNumbers'] else '') + ''.join(f'<td align="{"right" if c["numeric"] else "left"}">{esc(r.get(c["key"], ""))}</td>' for c in cols) + '</tr>'

    def total(rs, label):
        if not L['totals'] or not any(c['numeric'] for c in cols):
            return ''
        cells = ''.join((f'<td align="right"><b>{_nf(sum(num(r, c["key"]) for r in rs))}</b></td>' if c['numeric'] else f'<td><b>{esc(label) if i == 0 else ""}</b></td>') for i, c in enumerate(cols))
        return f'<tr bgcolor="#fafafa">{"<td></td>" if L["rowNumbers"] else ""}{cells}</tr>'
    body = ''
    if L['groupBy'] and cols:
        groups = {}
        for r in rows:
            groups.setdefault(str(r.get(L['groupBy']) or '') or '—', []).append(r)
        for g, rs in groups.items():
            body += f'<tr bgcolor="#e8ecf1"><td colspan="{ncol}"><b>{esc(by[L["groupBy"]]["label"])}: {esc(g)} ({len(rs)})</b></td></tr>' + ''.join(row(r) for r in rs) + total(rs, t('collab.rep.subtotal'))
        body += total(rows, t('collab.rep.total'))
    else:
        body = ''.join(row(r) for r in rows) + total(rows, t('collab.rep.total'))
    meta = ' · '.join(x for x in [datetime.now().strftime('%Y-%m-%d %H:%M') if L['showDate'] else '', user if L['showUser'] else '', f'{len(rows)} {t("collab.rep.rows")}'] if x)
    d = 'rtl' if i18n.rtl() else 'ltr'
    pre = lambda s: esc(s).replace('\n', '<br>')
    return (f'<html dir="{d}"><body style="font-family:Segoe UI,Tahoma,Arial; font-size:10pt; color:#111;"><h2 style="margin:0">{esc(L["title"])}</h2>'
            + (f'<p style="color:#555; margin:2px 0">{esc(L["subtitle"])}</p>' if L['subtitle'] else '') + (f'<p>{pre(L["header"])}</p>' if L['header'] else '')
            + f'<p style="color:#666; font-size:8pt">{esc(meta)}</p><hr><table width="100%" cellspacing="0" cellpadding="4">{head}{body}</table>'
            + (f'<hr><p style="color:#444">{pre(L["footer"])}</p>' if L['footer'] else '') + '</body></html>')


def make_printer(L):
    pr = QPrinter(QPrinter.HighResolution)
    pr.setPageSize(QPageSize(QPageSize.A4))
    pr.setPageOrientation(QPageLayout.Landscape if L['orientation'] == 'landscape' else QPageLayout.Portrait)
    pr.setPageMargins(QMarginsF(12, 12, 12, 12), QPageLayout.Millimeter)
    return pr


def save_pdf(htm, L, path):
    pr = make_printer(L)
    pr.setOutputFormat(QPrinter.PdfFormat)
    pr.setOutputFileName(path)
    doc = QTextDocument()
    doc.setHtml(htm)
    doc.print_(pr)


class ReportDialog(QDialog):
    def __init__(self, parent, view, title, columns, rows, user=''):
        super().__init__(parent)
        self.setWindowTitle(t('collab.reportDesigner'))
        self.resize(1100, 680)
        self.view, self.columns, self.rows, self.user = view, columns, rows, user
        self.L = dict(DEFAULT, title=title, columns=[c['key'] for c in columns], order=[c['key'] for c in columns])
        if len(columns) > 6:
            self.L['orientation'] = 'landscape'
        self.saved = []
        lay = QHBoxLayout(self)
        side = QWidget(); side.setFixedWidth(310)
        sl = QVBoxLayout(side); sl.setContentsMargins(0, 0, 8, 0)
        top = QHBoxLayout()
        self.sel = QComboBox(); self.sel.activated.connect(self.choose)
        top.addWidget(self.sel, 1)
        self.b_del = button('🗑', self.delete, 'ghost'); self.b_del.setEnabled(False)
        top.addWidget(self.b_del)
        sl.addLayout(top)
        f = QFormLayout()
        self.e_title, self.e_sub = QLineEdit(title), QLineEdit()
        self.e_head, self.e_foot = QPlainTextEdit(), QPlainTextEdit()
        for e in (self.e_head, self.e_foot):
            e.setFixedHeight(46)
        self.c_orient = QComboBox(); self.c_orient.addItem(t('collab.rep.portrait'), 'portrait'); self.c_orient.addItem(t('collab.rep.landscape'), 'landscape')
        self.c_orient.setCurrentIndex(1 if self.L['orientation'] == 'landscape' else 0)
        self.c_group = QComboBox(); self.c_group.addItem('—', '')
        for c in columns:
            self.c_group.addItem(c['label'], c['key'])
        f.addRow(t('collab.rep.title'), self.e_title); f.addRow(t('collab.rep.subtitle'), self.e_sub)
        f.addRow(t('collab.rep.header'), self.e_head); f.addRow(t('collab.rep.footer'), self.e_foot)
        f.addRow(t('collab.rep.orientation'), self.c_orient); f.addRow(t('collab.rep.groupBy'), self.c_group)
        sl.addLayout(f)
        self.k_tot, self.k_num = QCheckBox(t('collab.rep.totals')), QCheckBox(t('collab.rep.rowNumbers'))
        self.k_date, self.k_user = QCheckBox(t('collab.rep.showDate')), QCheckBox(t('collab.rep.showUser'))
        for k, v in ((self.k_tot, True), (self.k_num, False), (self.k_date, True), (self.k_user, True)):
            k.setChecked(v); k.toggled.connect(self.refresh); sl.addWidget(k)
        sl.addWidget(QLabel(t('collab.rep.columns')))
        self.lst = QListWidget()
        for c in columns:
            it = QListWidgetItem(c['label']); it.setData(Qt.UserRole, c['key']); it.setFlags(it.flags() | Qt.ItemIsUserCheckable); it.setCheckState(Qt.Checked)
            self.lst.addItem(it)
        self.lst.setDragDropMode(QListWidget.InternalMove)
        self.lst.itemChanged.connect(self.refresh); self.lst.model().rowsMoved.connect(self.refresh)
        sl.addWidget(self.lst, 1)
        mv = QHBoxLayout(); mv.addWidget(button('▲', lambda: self.move(-1), 'ghost')); mv.addWidget(button('▼', lambda: self.move(1), 'ghost')); sl.addLayout(mv)
        self.e_name = QLineEdit(); self.e_name.setPlaceholderText(t('collab.rep.layoutName'))
        self.k_share = QCheckBox(t('collab.shareWorkspace'))
        sl.addWidget(self.e_name); sl.addWidget(self.k_share); sl.addWidget(button(t('collab.rep.saveLayout'), self.save))
        self.err = QLabel(''); self.err.setStyleSheet('color:#dc2626'); self.err.setWordWrap(True); sl.addWidget(self.err)
        lay.addWidget(side)
        right = QVBoxLayout()
        self.prev = QTextBrowser(); self.prev.setStyleSheet('background:#fff; color:#111;')
        right.addWidget(self.prev, 1)
        bar = QHBoxLayout(); bar.addStretch()
        bar.addWidget(button(t('common.cancel'), self.reject, 'ghost')); bar.addWidget(button('PDF', self.pdf, 'ghost')); bar.addWidget(button('🖨 ' + t('collab.rep.print'), self.print))
        right.addLayout(bar)
        lay.addLayout(right, 1)
        for w in (self.e_title, self.e_sub):
            w.textChanged.connect(self.refresh)
        for w in (self.e_head, self.e_foot):
            w.textChanged.connect(self.refresh)
        self.c_orient.currentIndexChanged.connect(self.refresh); self.c_group.currentIndexChanged.connect(self.refresh)
        self.refresh()
        run_async(lambda: api.configs('report', view), self.loaded, lambda _e: None)

    # ---- layout <-> widgets
    def collect(self):
        order = [self.lst.item(i).data(Qt.UserRole) for i in range(self.lst.count())]
        on = [k for k in order if self.lst.item(order.index(k)).checkState() == Qt.Checked]
        return dict(title=self.e_title.text(), subtitle=self.e_sub.text(), header=self.e_head.toPlainText(), footer=self.e_foot.toPlainText(), orientation=self.c_orient.currentData(),
                    columns=on, order=order, groupBy=self.c_group.currentData() or '', totals=self.k_tot.isChecked(), showDate=self.k_date.isChecked(), showUser=self.k_user.isChecked(), rowNumbers=self.k_num.isChecked())

    def apply(self, d):
        known = {c['key'] for c in self.columns}
        cols = [k for k in (d.get('columns') or self.L['columns']) if k in known]
        order = cols + [c['key'] for c in self.columns if c['key'] not in cols]
        lab = {c['key']: c['label'] for c in self.columns}
        self.lst.blockSignals(True); self.lst.clear()
        for k in order:
            it = QListWidgetItem(lab[k]); it.setData(Qt.UserRole, k); it.setFlags(it.flags() | Qt.ItemIsUserCheckable); it.setCheckState(Qt.Checked if k in cols else Qt.Unchecked); self.lst.addItem(it)
        self.lst.blockSignals(False)
        self.e_title.setText(d.get('title', '')); self.e_sub.setText(d.get('subtitle', '')); self.e_head.setPlainText(d.get('header', '')); self.e_foot.setPlainText(d.get('footer', ''))
        self.c_orient.setCurrentIndex(1 if d.get('orientation') == 'landscape' else 0); self.c_group.setCurrentIndex(max(0, self.c_group.findData(d.get('groupBy', ''))))
        for k, key in ((self.k_tot, 'totals'), (self.k_date, 'showDate'), (self.k_user, 'showUser'), (self.k_num, 'rowNumbers')):
            k.setChecked(bool(d.get(key, k.isChecked())))
        self.refresh()

    def refresh(self, *_):
        self.L = self.collect()
        self.prev.setHtml(build_html(self.L, self.columns, self.rows, self.user))

    def move(self, d):
        r = self.lst.currentRow(); j = r + d
        if r < 0 or j < 0 or j >= self.lst.count():
            return
        it = self.lst.takeItem(r); self.lst.insertItem(j, it); self.lst.setCurrentRow(j); self.refresh()

    # ---- saved layouts
    def loaded(self, rows):
        self.saved = rows
        self.sel.clear(); self.sel.addItem(t('collab.savedReports'), None)
        for c in rows:
            self.sel.addItem(('👥 ' if c.get('shared') and not c.get('mine') else '') + (c.get('name') or ''), c)

    def choose(self, i):
        c = self.sel.itemData(i)
        self.b_del.setEnabled(bool(c and c.get('mine')))
        if c:
            self.apply(c.get('data') or {})

    def save(self):
        n = self.e_name.text().strip()
        if not n:
            return
        L = self.collect(); data = dict(L, columns=[k for k in L['order'] if k in L['columns']]); data.pop('order', None)
        self.err.setText('')
        run_async(lambda: api.save_config('report', self.view, n, self.k_share.isChecked(), data), lambda _r: (self.e_name.clear(), run_async(lambda: api.configs('report', self.view), self.loaded)), lambda e: self.err.setText(e))

    def delete(self):
        c = self.sel.currentData()
        if c and c.get('mine'):
            run_async(lambda: api.del_config('report', c['id']), lambda _r: run_async(lambda: api.configs('report', self.view), self.loaded), lambda e: self.err.setText(e))

    # ---- output
    def pdf(self):
        path, _ = QFileDialog.getSaveFileName(self, 'PDF', (self.L['title'] or 'report') + '.pdf', 'PDF (*.pdf)')
        if path:
            save_pdf(build_html(self.L, self.columns, self.rows, self.user), self.L, path)

    def print(self):
        pr = make_printer(self.L)
        if QPrintDialog(pr, self).exec():
            doc = QTextDocument(); doc.setHtml(build_html(self.L, self.columns, self.rows, self.user)); doc.print_(pr)
