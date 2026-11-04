"""Typed forms for workflow steps (Text, Email, Number, Date, TextArea, Select, Checkbox) and the notes / files panel of a record."""
import base64
import re

from PySide6.QtCore import QDate, Qt
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDateEdit, QFileDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
                               QPlainTextEdit, QTabWidget, QTextEdit, QVBoxLayout, QWidget)

from .api import api
from .i18n import t
from .ui import button, label, run_async, warn

NEGATIVE = re.compile(r'reject|cancel|deny|return|out of stock|write off', re.I)


def is_negative(decision):
    return bool(NEGATIVE.search(decision or ''))


class TypedForm(QWidget):
    """One editor per field of a form definition {title, fields:[{key,label,type,required,readOnly,options,placeholder}]}."""
    def __init__(self, form, values=None):
        super().__init__()
        self.fields = (form or {}).get('fields') or []
        self.w = {}
        lay = QFormLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        for f in self.fields:
            ty = f.get('type') or 'Text'
            ro = bool(f.get('readOnly'))
            if ty == 'TextArea':
                w = QPlainTextEdit()
                w.setFixedHeight(70)
                w.setReadOnly(ro)
                w.setPlaceholderText(f.get('placeholder') or '')
            elif ty == 'Select':
                w = QComboBox()
                w.addItem(t('common.select'), None)
                for o in f.get('options') or []:
                    w.addItem(o.get('label') or o.get('value'), o.get('value'))
                w.setEnabled(not ro)
            elif ty == 'Checkbox':
                w = QCheckBox(f.get('placeholder') or t('common.yes'))
                w.setEnabled(not ro)
            elif ty == 'Date':
                w = QDateEdit()
                w.setCalendarPopup(True)
                w.setDisplayFormat('yyyy-MM-dd')
                w.setSpecialValueText(' ')
                w.setMinimumDate(QDate(1900, 1, 1))
                w.setDate(w.minimumDate())      # empty until the user picks a date
                w.setEnabled(not ro)
            else:  # Text, Email, Number
                w = QLineEdit()
                w.setReadOnly(ro)
                w.setPlaceholderText(f.get('placeholder') or '')
            self.w[f['key']] = w
            cap = (f.get('label') or f['key']) + (' *' if f.get('required') and not ro else '')
            lay.addRow(cap, w)
        if values:
            self.set_values(values)

    def set_values(self, data):
        for f in self.fields:
            k, ty, v = f['key'], f.get('type') or 'Text', (data or {}).get(f['key'])
            if v is None:
                continue
            w = self.w[k]
            if ty == 'TextArea':
                w.setPlainText(str(v))
            elif ty == 'Select':
                i = w.findData(str(v))
                w.setCurrentIndex(max(0, i))
            elif ty == 'Checkbox':
                w.setChecked(v is True or str(v).lower() in ('true', '1', 'yes'))
            elif ty == 'Date':
                d = QDate.fromString(str(v)[:10], 'yyyy-MM-dd')
                if d.isValid():
                    w.setDate(d)
            else:
                w.setText(str(v))

    def _value(self, f):
        w, ty = self.w[f['key']], f.get('type') or 'Text'
        if ty == 'TextArea':
            return w.toPlainText()
        if ty == 'Select':
            return w.currentData()
        if ty == 'Checkbox':
            return w.isChecked()
        if ty == 'Date':
            return None if w.date() == w.minimumDate() else w.date().toString('yyyy-MM-dd')
        txt = w.text().strip()
        if ty == 'Number':
            if txt == '':
                return None
            try:
                return int(txt) if re.fullmatch(r'-?\d+', txt) else float(txt)
            except ValueError:
                return None
        return txt

    def missing(self):
        out = []
        for f in self.fields:
            if f.get('required') and not f.get('readOnly'):
                v = self._value(f)
                if v is None or v == '':
                    out.append(f)
        return out

    def values(self):
        """Only the fields this step owns (read-only echoes of earlier data are not sent back)."""
        out = {}
        for f in self.fields:
            if f.get('readOnly'):
                continue
            v = self._value(f)
            if v is not None:
                out[f['key']] = v
        return out


class Chatter(QWidget):
    """Notes and file attachments of one record; the server checks the caller's module privileges."""
    MAX = 4 * 1024 * 1024

    def __init__(self, module, kind, rid):
        super().__init__()
        self.m, self.k, self.rid = module, kind, rid
        v = QVBoxLayout(self)
        self.tabs = QTabWidget()
        v.addWidget(self.tabs)
        self.err = label('', 'error')
        v.addWidget(self.err)
        # notes
        nw = QWidget()
        nl = QVBoxLayout(nw)
        self.notes_l = QListWidget()
        self.notes_l.setWordWrap(True)
        self.text = QTextEdit()
        self.text.setPlaceholderText(t('collab.notePh'))
        self.text.setFixedHeight(60)
        nl.addWidget(self.notes_l, 1)
        nl.addWidget(self.text)
        row = QHBoxLayout()
        row.addWidget(button(t('collab.send'), self.send))
        row.addWidget(button(t('collab.delete'), self.del_note, 'ghost'))
        row.addStretch()
        nl.addLayout(row)
        self.tabs.addTab(nw, t('collab.notes'))
        # files
        fw = QWidget()
        fl = QVBoxLayout(fw)
        self.files_l = QListWidget()
        fl.addWidget(self.files_l, 1)
        fl.addWidget(label(t('collab.maxSize'), 'dim'))
        row = QHBoxLayout()
        row.addWidget(button(t('collab.choose'), self.pick))
        row.addWidget(button(t('collab.download'), self.download, 'ghost'))
        row.addWidget(button(t('collab.delete'), self.del_file, 'ghost'))
        row.addStretch()
        fl.addLayout(row)
        self.tabs.addTab(fw, t('collab.files'))
        self.notes, self.files = [], []
        self.load()

    def _fail(self, m):
        self.err.setText(str(m))

    def load(self):
        run_async(lambda: api.notes(self.m, self.k, self.rid), self._show_notes, self._fail)
        run_async(lambda: api.files(self.m, self.k, self.rid), self._show_files, lambda _m: None)

    def _show_notes(self, rows):
        self.notes = sorted(rows, key=lambda n: n.get('createdAt') or '', reverse=True)
        self.notes_l.clear()
        for n in self.notes:
            it = QListWidgetItem(f"{n.get('author', '')}  ·  {(n.get('createdAt') or '')[:16].replace('T', ' ')}\n{n.get('text', '')}")
            it.setData(Qt.UserRole, n)
            if n.get('system'):
                it.setForeground(Qt.gray)
            self.notes_l.addItem(it)
        self.tabs.setTabText(0, f"{t('collab.notes')} ({len(self.notes)})")

    def _show_files(self, rows):
        self.files = rows
        self.files_l.clear()
        for f in rows:
            kb = max(1, round((f.get('size') or 0) / 1024))
            it = QListWidgetItem(f"{f.get('name', '')}   —   {kb} KB · {f.get('author', '')} · {(f.get('createdAt') or '')[:10]}")
            it.setData(Qt.UserRole, f)
            self.files_l.addItem(it)
        self.tabs.setTabText(1, f"{t('collab.files')} ({len(rows)})")

    def send(self):
        txt = self.text.toPlainText().strip()
        if not txt:
            return
        self.err.setText('')
        run_async(lambda: api.add_note(self.m, self.k, self.rid, txt), lambda _r: (self.text.clear(), self.load()), self._fail)

    def del_note(self):
        it = self.notes_l.currentItem()
        n = it.data(Qt.UserRole) if it else None
        if n and not n.get('system'):
            run_async(lambda: api.del_note(n['id']), lambda _r: self.load(), self._fail)

    def pick(self):
        paths, _ = QFileDialog.getOpenFileNames(self, t('collab.attach'))
        for p in paths:
            try:
                data = open(p, 'rb').read()
            except OSError as e:
                self._fail(e)
                continue
            name = p.replace('\\', '/').rsplit('/', 1)[-1]
            if len(data) > self.MAX:
                self._fail(t('collab.tooBig').replace('{name}', name))
                continue
            ctype = 'application/octet-stream'
            b64 = base64.b64encode(data).decode('ascii')
            run_async(lambda name=name, b64=b64: api.add_file(self.m, self.k, self.rid, name, ctype, b64), lambda _r: self.load(), self._fail)

    def download(self):
        it = self.files_l.currentItem()
        f = it.data(Qt.UserRole) if it else None
        if not f:
            return
        dest, _ = QFileDialog.getSaveFileName(self, t('collab.download'), f['name'])
        if dest:
            def save(b):
                with open(dest, 'wb') as fh:
                    fh.write(b)
            run_async(lambda: api.file_bytes(f['id']), save, self._fail)

    def del_file(self):
        it = self.files_l.currentItem()
        f = it.data(Qt.UserRole) if it else None
        if f:
            run_async(lambda: api.del_file(f['id']), lambda _r: self.load(), self._fail)
