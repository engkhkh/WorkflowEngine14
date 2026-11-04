"""Custom modules: design a module (name, icon, fields) and keep its records. Everything is generated from the module definition,
exactly as in the portal; the validation and the privileges (cus.view / cus.manage / cus.design) are on the server."""
import copy
import json
from pathlib import Path

from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPlainTextEdit, QVBoxLayout, QWidget)

from . import i18n
from .api import api
from .i18n import t
from .ui import button, current_payload, fill_table, label, make_table, run_async, warn

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'custom.json').read_text(encoding='utf-8'))


def title(m):
    d = m['def']
    return d.get('titleAr') if i18n.lang == 'ar' and d.get('titleAr') else d['title']


def flabel(f):
    return f.get('labelAr') if i18n.lang == 'ar' and f.get('labelAr') else f['label']


def show(f, r):
    v = (r.get('data') or {}).get(f['key'])
    if f['type'] == 'checkbox':
        return '✓' if v else ''
    return '' if v is None else str(v)


class FieldDialog(QDialog):
    def __init__(self, parent, f):
        super().__init__(parent)
        self.setWindowTitle(t('cus.fields'))
        self.f = dict(f)
        form = QFormLayout(self)
        self.name, self.ar, self.type, self.req, self.opt = QLineEdit(f.get('label', '')), QLineEdit(f.get('labelAr') or ''), QComboBox(), QCheckBox(t('cus.required')), QLineEdit(', '.join(f.get('options') or []))
        for k in SPEC['types']:
            self.type.addItem(t('cus.t.' + k), k)
        self.type.setCurrentIndex(max(0, self.type.findData(f.get('type', 'text'))))
        self.req.setChecked(bool(f.get('required')))
        form.addRow(t('cus.fieldName'), self.name)
        form.addRow(t('cus.fieldNameAr'), self.ar)
        form.addRow('', self.type)
        form.addRow('', self.req)
        form.addRow(t('cus.options'), self.opt)
        form.addRow(button(t('cal.save'), self.ok))

    def ok(self):
        import re
        self.f.update(label=self.name.text().strip(), labelAr=self.ar.text().strip() or None, type=self.type.currentData(), required=self.req.isChecked(),
                      options=[x.strip() for x in re.split(r'[,،;]', self.opt.text()) if x.strip()] if self.type.currentData() == 'select' else [])
        self.accept()


class ModuleDesigner(QDialog):
    def __init__(self, parent, mod, on_saved):
        super().__init__(parent)
        self.mod, self.on_saved = mod, on_saved
        self.d = copy.deepcopy(mod['def']) if mod else {'title': '', 'titleAr': '', 'icon': 'grid', 'color': '#6366f1', 'fields': [{'key': '', 'label': '', 'type': 'text', 'required': True}]}
        self.setWindowTitle(t('cus.design') if mod else t('cus.newModule'))
        self.resize(640, 520)
        lay = QVBoxLayout(self)
        form = QFormLayout()
        self.name, self.ar, self.icon, self.color = QLineEdit(self.d['title']), QLineEdit(self.d.get('titleAr') or ''), QComboBox(), QLineEdit(self.d.get('color') or '#6366f1')
        for i in SPEC['icons']:
            self.icon.addItem(i, i)
        self.icon.setCurrentIndex(max(0, self.icon.findData(self.d.get('icon', 'grid'))))
        form.addRow(t('cus.name') + ' *', self.name)
        form.addRow(t('cus.nameAr'), self.ar)
        form.addRow(t('cus.icon'), self.icon)
        form.addRow(t('cus.color'), self.color)
        lay.addLayout(form)
        lay.addWidget(label(t('cus.fields')))
        self.table = make_table([t('cus.fieldName'), t('cus.fieldNameAr'), 'Type', t('cus.required'), t('cus.options')])
        self.table.doubleClicked.connect(lambda *_: self.edit())
        lay.addWidget(self.table, 1)
        row = QHBoxLayout()
        for text, fn in (('+ ' + t('cus.addField'), self.add), (t('web.edit'), self.edit), ('↑', lambda: self.move(-1)), ('↓', lambda: self.move(1)), ('✕', self.remove)):
            row.addWidget(button(text, fn, 'ghost'))
        row.addStretch(1)
        lay.addLayout(row)
        self.err = QLabel('')
        self.err.setProperty('role', 'error')
        lay.addWidget(self.err)
        bot = QHBoxLayout()
        bot.addStretch(1)
        bot.addWidget(button(t('cal.close'), self.reject, 'ghost'))
        bot.addWidget(button(t('cal.save'), self.save))
        lay.addLayout(bot)
        self.refresh()

    def refresh(self, sel=0):
        fs = self.d['fields']
        fill_table(self.table, [[f.get('label', ''), f.get('labelAr') or '', t('cus.t.' + f.get('type', 'text')), '✓' if f.get('required') else '', ', '.join(f.get('options') or [])] for f in fs], list(range(len(fs))))
        if fs:
            self.table.selectRow(min(sel, len(fs) - 1))

    def add(self):
        d = FieldDialog(self, {'key': '', 'label': '', 'type': 'text'})
        if d.exec():
            self.d['fields'].append(d.f)
            self.refresh(len(self.d['fields']) - 1)

    def edit(self):
        i = self.table.currentRow()
        if 0 <= i < len(self.d['fields']):
            d = FieldDialog(self, self.d['fields'][i])
            if d.exec():
                self.d['fields'][i] = d.f
                self.refresh(i)

    def move(self, n):
        i, f = self.table.currentRow(), self.d['fields']
        if i >= 0 and 0 <= i + n < len(f):
            f[i], f[i + n] = f[i + n], f[i]
            self.refresh(i + n)

    def remove(self):
        i = self.table.currentRow()
        if 0 <= i < len(self.d['fields']):
            del self.d['fields'][i]
            self.refresh(i)

    def save(self):
        body = dict(self.d, title=self.name.text().strip(), titleAr=self.ar.text().strip() or None, icon=self.icon.currentData(), color=self.color.text().strip() or '#6366f1',
                    fields=[f for f in self.d['fields'] if (f.get('label') or '').strip()])
        call = (lambda: api._call('PUT', '/custom/modules/' + self.mod['key'], body)) if self.mod else (lambda: api._call('POST', '/custom/modules', body))
        run_async(call, lambda m: (self.on_saved(m), self.accept()), lambda m: self.err.setText(m))


class RecordDialog(QDialog):
    def __init__(self, parent, mod, rec, can_edit, on_saved):
        super().__init__(parent)
        self.mod, self.rec, self.on_saved = mod, rec, on_saved
        self.setWindowTitle(rec['code'] if rec else t('cus.new'))
        self.resize(480, 120 + 40 * len(mod['def']['fields']))
        form = QFormLayout(self)
        self.w = {}
        data = (rec or {}).get('data') or {}
        for f in mod['def']['fields']:
            k, ty, v = f['key'], f['type'], data.get(f['key'])
            if ty == 'textarea':
                w = QPlainTextEdit('' if v is None else str(v))
                w.setFixedHeight(80)
            elif ty == 'select':
                w = QComboBox()
                w.addItem('', '')
                for o in f.get('options') or []:
                    w.addItem(o, o)
                w.setCurrentIndex(max(0, w.findData(v if v is not None else '')))
            elif ty == 'checkbox':
                w = QCheckBox()
                w.setChecked(bool(v))
            else:
                w = QLineEdit('' if v is None else str(v))
                if ty == 'date':
                    w.setPlaceholderText('yyyy-mm-dd')
            w.setEnabled(can_edit)
            self.w[k] = w
            form.addRow(flabel(f) + (' *' if f.get('required') else ''), w)
        self.err = QLabel('')
        self.err.setProperty('role', 'error')
        form.addRow(self.err)
        row = QHBoxLayout()
        if can_edit:
            row.addWidget(button(t('cal.save'), self.save))
            if rec:
                row.addWidget(button(t('cal.delete'), self.delete, 'danger'))
        row.addWidget(button(t('cal.close'), self.reject, 'ghost'))
        form.addRow(row)

    def values(self):
        out = {}
        for f in self.mod['def']['fields']:
            w, ty = self.w[f['key']], f['type']
            if ty == 'textarea':
                v = w.toPlainText()
            elif ty == 'select':
                v = w.currentData()
            elif ty == 'checkbox':
                v = w.isChecked()
            else:
                v = w.text().strip()
                if ty == 'number' and v != '':
                    try:
                        x = float(v)
                        v = int(x) if x == int(x) else x
                    except ValueError:
                        pass
            out[f['key']] = v
        return out

    def save(self):
        key, data = self.mod['key'], self.values()
        call = (lambda: api._call('PUT', '/custom/records/%s/%s' % (key, self.rec['id']), {'data': data})) if self.rec else (lambda: api._call('POST', '/custom/records/' + key, {'data': data}))
        run_async(call, lambda _: (self.on_saved(), self.accept()), lambda m: self.err.setText(m))

    def delete(self):
        if QMessageBox.question(self, '', t('cal.delete') + '?') == QMessageBox.Yes:
            run_async(lambda: api._call('DELETE', '/custom/records/%s/%s' % (self.mod['key'], self.rec['id'])), lambda _: (self.on_saved(), self.accept()), lambda m: self.err.setText(m))


class CustomPage(QWidget):
    def __init__(self):
        super().__init__()
        self.mods, self.key = [], None
        lay = QVBoxLayout(self)
        lay.addWidget(label(t('tab.cus'), 'title'))
        bar = QHBoxLayout()
        self.pick = QComboBox()
        self.pick.currentIndexChanged.connect(lambda *_: self.load_records())
        bar.addWidget(self.pick, 1)
        self.search = QLineEdit()
        self.search.setPlaceholderText(t('cus.search'))
        self.search.setMaximumWidth(220)
        self.search.returnPressed.connect(self.load_records)
        bar.addWidget(self.search)
        self.b_new = button(t('cus.new'), lambda: self.open_rec(None))
        self.b_mod = button(t('cus.newModule'), lambda: self.design(None), 'ghost')
        self.b_des = button(t('cus.design'), lambda: self.design(self.cur()), 'ghost')
        self.b_del = button('✕ ' + t('cus.name'), self.del_module, 'danger')
        for b in (self.b_new, self.b_mod, self.b_des, self.b_del):
            bar.addWidget(b)
        lay.addLayout(bar)
        self.table = make_table([])
        self.table.doubleClicked.connect(lambda *_: self.open_rec(current_payload(self.table)))
        lay.addWidget(self.table, 1)
        self.msg = QLabel('')
        lay.addWidget(self.msg)

    def cur(self):
        return next((m for m in self.mods if m['key'] == self.pick.currentData()), None)

    def reload(self, keep=None):
        keep = keep or self.pick.currentData()
        self.b_mod.setVisible(api.can('cus.design'))
        run_async(lambda: api._call('GET', '/custom/modules') or [], lambda l: self.got_modules(l, keep), lambda m: self.msg.setText(m))

    def got_modules(self, mods, keep):
        self.mods = mods
        self.pick.blockSignals(True)
        self.pick.clear()
        for m in mods:
            self.pick.addItem(title(m), m['key'])
        self.pick.setCurrentIndex(max(0, self.pick.findData(keep)))
        self.pick.blockSignals(False)
        self.load_records()

    def load_records(self):
        m = self.cur()
        self.b_new.setVisible(bool(m) and api.can('cus.manage'))
        self.b_des.setVisible(bool(m) and api.can('cus.design'))
        self.b_del.setVisible(bool(m) and api.can('cus.design'))
        if not m:
            fill_table(self.table, [], [])
            self.msg.setText(t('cus.empty'))
            return
        cols = m['def']['fields'][:6]
        self.table.setColumnCount(len(cols) + 1)
        self.table.setHorizontalHeaderLabels(['#'] + [flabel(f) for f in cols])
        q = self.search.text().strip()
        run_async(lambda: api._call('GET', '/custom/records/%s?q=%s' % (m['key'], q)) or [], lambda rows: self.show_rows(m, cols, rows), lambda e: self.msg.setText(e))

    def show_rows(self, m, cols, rows):
        if self.cur() is not m and self.cur() != m:
            return
        fill_table(self.table, [[r['code']] + [show(f, r) for f in cols] for r in rows], rows)
        self.msg.setText(t('cus.sub', n=len(rows)) if rows else t('cus.none'))

    def open_rec(self, rec):
        m = self.cur()
        if m and (rec or api.can('cus.manage')):
            RecordDialog(self, m, rec, api.can('cus.manage'), self.load_records).exec()

    def design(self, mod):
        ModuleDesigner(self, mod, lambda saved: self.reload(saved['key'])).exec()

    def del_module(self):
        m = self.cur()
        if m and QMessageBox.question(self, '', t('cal.delete') + ' ' + title(m) + '?') == QMessageBox.Yes:
            run_async(lambda: api._call('DELETE', '/custom/modules/' + m['key']), lambda _: self.reload(''), lambda e: warn(self, e))
