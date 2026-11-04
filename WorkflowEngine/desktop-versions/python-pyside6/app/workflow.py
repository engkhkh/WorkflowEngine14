"""Workflow designer, flows list and instance monitor (PySide6).
Mirrors the portal: 22 node types in 7 categories, drag nodes, link edges, per-type property editor driven by
data/workflow.json (shared by every desktop client), form builder, condition tester, save / publish / run,
and a live process map for instances."""
import json
import math
import uuid
from pathlib import Path

from PySide6.QtCore import QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QBrush, QColor, QFont, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import (QAbstractItemView, QCheckBox, QComboBox, QDialog, QDialogButtonBox, QDoubleSpinBox, QFormLayout, QGraphicsItem,
                               QGraphicsPathItem, QGraphicsScene, QGraphicsSimpleTextItem, QGraphicsView, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QPlainTextEdit, QPushButton, QScrollArea, QSplitter, QTabWidget, QTableWidget,
                               QTableWidgetItem, QTextEdit, QToolBox, QVBoxLayout, QWidget, QHeaderView)

from . import i18n
from .api import api
from .i18n import t
from .pages import Page, short
from .ui import ask, button, fill_table, label, make_table, run_async, warn, current_payload

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'workflow.json').read_text(encoding='utf-8'))
TYPES = {n['type']: n for n in SPEC['nodes']}
FIELD_TYPES = SPEC['fieldTypes']


def new_id():
    return str(uuid.uuid4())


def shape_of(tp):
    return TYPES.get(tp, {}).get('shape', 'rect')


def node_size(tp):
    return SPEC['nodeSize'][shape_of(tp)]


def center_of(n):
    w, h = node_size(n['type'])
    return QPointF(n['x'] + w / 2, n['y'] + h / 2)


def default_node(tp, x, y):
    spec = TYPES[tp]
    n = {'id': new_id(), 'type': tp, 'name': spec['label'], 'x': x, 'y': y}
    if tp in ('FormTask', 'ApprovalTask'):
        n.update(assignee='', priority='Normal', escalationMode='Reassign', form={'id': new_id(), 'title': spec['label'], 'fields': []})
    if tp == 'Timer':
        n['durationSeconds'] = 60
    if tp == 'WebhookCall':
        n['webhookMethod'] = 'POST'
    if tp == 'FileOperations':
        n['fileOperation'] = 'Read'
    if tp == 'InvokeSoapService':
        n['soapEnvelope'] = '<?xml version="1.0"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n\n  </soap:Body>\n</soap:Envelope>'
    return n


# --------------------------------------------------------------------------- canvas items
class NodeItem(QGraphicsItem):
    def __init__(self, node, canvas, state=None):
        super().__init__()
        self.node, self.canvas, self.state = node, canvas, state
        self.w, self.h = node_size(node['type'])
        self.setPos(node['x'], node['y'])
        self.setZValue(2)
        if canvas.editable:
            self.setFlag(QGraphicsItem.ItemIsMovable, True)
            self.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)
        self.setFlag(QGraphicsItem.ItemIsSelectable, True)

    def boundingRect(self):
        return QRectF(-6, -6, self.w + 12, self.h + 12)

    def paint(self, p, option, widget=None):
        p.setRenderHint(QPainter.Antialiasing)
        col = QColor(TYPES[self.node['type']]['color'])
        st = self.state
        fill = QColor('#ffffff')
        pen_col = col
        width = 2
        if st == 'active':
            fill, pen_col, width = QColor('#dcfce7'), QColor('#16a34a'), 4
        elif st == 'visited':
            fill, pen_col = QColor('#f0fdf4'), QColor('#16a34a')
        elif st == 'rejected':
            fill, pen_col = QColor('#fee2e2'), QColor('#dc2626')
        elif st == 'pending':
            p.setOpacity(0.5)
        if self.isSelected() or self.canvas.link_from == self.node['id']:
            pen_col, width = QColor('#2563eb'), 4
        p.setBrush(QBrush(fill))
        pen = QPen(pen_col, width)
        if self.canvas.link_from == self.node['id']:
            pen.setStyle(Qt.DashLine)
        p.setPen(pen)
        sh = shape_of(self.node['type'])
        if sh == 'circle':
            p.drawEllipse(QRectF(0, 0, self.w, self.h))
        elif sh == 'diamond':
            path = QPainterPath(QPointF(self.w / 2, 0))
            path.lineTo(self.w, self.h / 2); path.lineTo(self.w / 2, self.h); path.lineTo(0, self.h / 2); path.closeSubpath()
            p.drawPath(path)
        else:
            p.drawRoundedRect(QRectF(0, 0, self.w, self.h), 10, 10)
        p.setPen(QColor('#0f172a'))
        f = QFont(); f.setPointSize(13)
        p.setFont(f)
        icon = TYPES[self.node['type']]['icon']
        if sh == 'circle':
            p.drawText(QRectF(0, 0, self.w, self.h), Qt.AlignCenter, icon)
        else:
            p.drawText(QRectF(0, 4 if sh == 'rect' else 12, self.w, 22), Qt.AlignCenter, icon)
            f.setPointSize(9); f.setBold(True); p.setFont(f)
            p.drawText(QRectF(8, 30 if sh == 'rect' else 38, self.w - 16, 24), Qt.AlignCenter, short(self.node['name'], 22))

    def itemChange(self, change, value):
        if change == QGraphicsItem.ItemPositionHasChanged and self.canvas.editable:
            self.node['x'], self.node['y'] = round(value.x()), round(value.y())
            self.canvas.refresh_edges()
            self.canvas.changed()
        return super().itemChange(change, value)

    def mousePressEvent(self, e):
        if self.canvas.link_mode:
            self.canvas.handle_link(self.node['id'])
            e.accept()
            return
        super().mousePressEvent(e)
        self.canvas.node_clicked(self.node['id'])


class EdgeItem(QGraphicsPathItem):
    def __init__(self, edge, canvas, traveled=None):
        super().__init__()
        self.edge, self.canvas, self.traveled = edge, canvas, traveled
        self.setZValue(1)
        self.setFlag(QGraphicsItem.ItemIsSelectable, True)
        self.txt = QGraphicsSimpleTextItem(edge['label'], self)
        self.txt.setBrush(QBrush(QColor('#475569')))
        self.update_path()

    def update_path(self):
        nodes = {n['id']: n for n in self.canvas.definition['nodes']}
        a, b = nodes.get(self.edge['sourceNodeId']), nodes.get(self.edge['targetNodeId'])
        if not a or not b:
            return
        s, e = center_of(a), center_of(b)
        dx = (e.x() - s.x()) * 0.5
        path = QPainterPath(s)
        path.cubicTo(QPointF(s.x() + dx, s.y()), QPointF(e.x() - dx, e.y()), e)
        self.setPath(path)
        mid = path.pointAtPercent(0.5)
        self.txt.setText(self.edge['label'])
        self.txt.setPos(mid.x() - self.txt.boundingRect().width() / 2, mid.y() - 18)
        ang = math.atan2(e.y() - (path.pointAtPercent(0.97).y()), e.x() - path.pointAtPercent(0.97).x())
        # arrow head sits at the node border: shorten by the node's half size roughly
        self._arrow = (e, ang)

    def shape(self):
        from PySide6.QtGui import QPainterPathStroker
        st = QPainterPathStroker(); st.setWidth(14)
        return st.createStroke(self.path())

    def paint(self, p, option, widget=None):
        p.setRenderHint(QPainter.Antialiasing)
        col = QColor('#94a3b8')
        w = 2
        if self.traveled == 'ok':
            col, w = QColor('#16a34a'), 3
        elif self.traveled == 'rejected':
            col, w = QColor('#dc2626'), 3
        if self.isSelected():
            col, w = QColor('#2563eb'), 3
        p.setPen(QPen(col, w))
        p.setBrush(Qt.NoBrush)
        p.drawPath(self.path())
        # arrow head, placed where the curve leaves the target node
        nodes = {n['id']: n for n in self.canvas.definition['nodes']}
        tgt = nodes.get(self.edge['targetNodeId'])
        if tgt:
            tw, th = node_size(tgt['type'])
            c = center_of(tgt)
            rad = max(tw, th) / 2 + 4
            # walk back along the curve until outside the target shape's radius
            pct = 1.0
            path = self.path()
            while pct > 0.5 and math.hypot(path.pointAtPercent(pct).x() - c.x(), path.pointAtPercent(pct).y() - c.y()) < rad:
                pct -= 0.01
            tip, prev = path.pointAtPercent(pct), path.pointAtPercent(max(pct - 0.03, 0))
            ang = math.atan2(tip.y() - prev.y(), tip.x() - prev.x())
            p.setBrush(QBrush(col)); p.setPen(Qt.NoPen)
            poly = [tip, QPointF(tip.x() - 10 * math.cos(ang - 0.4), tip.y() - 10 * math.sin(ang - 0.4)), QPointF(tip.x() - 10 * math.cos(ang + 0.4), tip.y() - 10 * math.sin(ang + 0.4))]
            from PySide6.QtGui import QPolygonF
            p.drawPolygon(QPolygonF(poly))


class Canvas(QGraphicsView):
    """Scene + interaction for a WorkflowDefinition dict. editable=False renders the instance process map."""
    def __init__(self, definition, editable=True, on_select=None, on_change=None):
        super().__init__()
        self.definition, self.editable = definition, editable
        self.on_select, self.on_change = on_select, on_change
        self.link_mode, self.link_from = False, None
        self.states, self.edge_states = {}, {}
        self.scene_ = QGraphicsScene(self)
        self.setScene(self.scene_)
        self.setRenderHint(QPainter.Antialiasing)
        self.setBackgroundBrush(QBrush(QColor('#f8fafc')))
        self.setDragMode(QGraphicsView.RubberBandDrag if editable else QGraphicsView.ScrollHandDrag)
        self.node_items, self.edge_items = {}, []
        self.scene_.selectionChanged.connect(self._sel)
        self.rebuild()

    def changed(self):
        if self.on_change:
            self.on_change()

    def rebuild(self):
        sel = self.selected_id()
        self.scene_.clear()
        self.node_items, self.edge_items = {}, []
        for e in self.definition['edges']:
            it = EdgeItem(e, self, self.edge_states.get(e['id']))
            self.scene_.addItem(it); self.edge_items.append(it)
        for n in self.definition['nodes']:
            it = NodeItem(n, self, self.states.get(n['id']))
            self.scene_.addItem(it); self.node_items[n['id']] = it
        r = self.scene_.itemsBoundingRect()
        self.scene_.setSceneRect(r.adjusted(-80, -80, 200, 200) if self.definition['nodes'] else QRectF(0, 0, 900, 600))
        if sel and sel in self.node_items:
            self.node_items[sel].setSelected(True)

    def refresh_edges(self):
        for e in self.edge_items:
            e.prepareGeometryChange(); e.update_path(); e.update()

    def selected_id(self):
        for it in self.scene_.selectedItems():
            if isinstance(it, NodeItem):
                return it.node['id']
        return None

    def selected_edge(self):
        for it in self.scene_.selectedItems():
            if isinstance(it, EdgeItem):
                return it.edge['id']
        return None

    def _sel(self):
        try:
            if self.on_select:
                self.on_select(self.selected_id(), self.selected_edge())
        except RuntimeError:
            pass

    def node_clicked(self, _id):
        pass

    def set_link_mode(self, on):
        self.link_mode, self.link_from = on, None
        self.setDragMode(QGraphicsView.NoDrag if on else QGraphicsView.RubberBandDrag)
        self.viewport().setCursor(Qt.CrossCursor if on else Qt.ArrowCursor)
        self.scene_.update()

    def handle_link(self, nid):
        if not self.link_from:
            self.link_from = nid
        elif self.link_from == nid:
            self.link_from = None
        else:
            src = next(n for n in self.definition['nodes'] if n['id'] == self.link_from)
            edges = self.definition['edges']
            label_ = SPEC['edgeDefaults']['default']
            if src['type'] == 'ApprovalTask':
                label_ = 'Reject' if any(e['sourceNodeId'] == src['id'] and e['label'] == 'Approve' for e in edges) else 'Approve'
            elif src['type'] == 'Condition':
                label_ = 'False' if any(e['sourceNodeId'] == src['id'] and e['label'] == 'True' for e in edges) else 'True'
            edges.append({'id': new_id(), 'sourceNodeId': self.link_from, 'targetNodeId': nid, 'label': label_})
            self.link_from = None
            self.rebuild()
            self.changed()
        self.scene_.update()

    def add_node(self, tp):
        k = len(self.definition['nodes'])
        n = default_node(tp, 40 + (k % 5) * 180, 40 + (k // 5) * 120)
        self.definition['nodes'].append(n)
        self.rebuild()
        self.node_items[n['id']].setSelected(True)
        self.changed()

    def delete_selected(self):
        d = self.definition
        nid, eid = self.selected_id(), self.selected_edge()
        if nid:
            d['nodes'] = [n for n in d['nodes'] if n['id'] != nid]
            d['edges'] = [e for e in d['edges'] if e['sourceNodeId'] != nid and e['targetNodeId'] != nid]
        elif eid:
            d['edges'] = [e for e in d['edges'] if e['id'] != eid]
        else:
            return
        self.rebuild(); self.changed()

    def wheelEvent(self, e):
        if e.modifiers() & Qt.ControlModifier:
            f = 1.15 if e.angleDelta().y() > 0 else 1 / 1.15
            self.scale(f, f)
        else:
            super().wheelEvent(e)


# --------------------------------------------------------------------------- form builder
class FormEditorDialog(QDialog):
    def __init__(self, parent, form):
        super().__init__(parent)
        self.setWindowTitle(t('wf.form'))
        self.resize(820, 460)
        self.form = form
        lay = QVBoxLayout(self)
        top = QHBoxLayout()
        top.addWidget(QLabel(t('wf.formTitle')))
        self.title = QLineEdit(form.get('title', ''))
        top.addWidget(self.title)
        lay.addLayout(top)
        self.tbl = QTableWidget(0, 6)
        self.tbl.setHorizontalHeaderLabels(['Key', 'Label', 'Type', 'Required', 'Read-only', 'Options (label=value; …)'])
        self.tbl.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        lay.addWidget(self.tbl, 1)
        for f in form.get('fields', []):
            self.add_row(f)
        row = QHBoxLayout()
        row.addWidget(button('+ ' + t('wf.addField'), lambda: self.add_row(None)))
        row.addWidget(button(t('wf.removeField'), self.remove_row))
        row.addStretch()
        lay.addLayout(row)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(self.accept_); bb.rejected.connect(self.reject)
        lay.addWidget(bb)

    def add_row(self, f):
        f = f or {'id': new_id(), 'key': '', 'label': '', 'type': 'Text', 'required': False, 'readOnly': False, 'options': []}
        r = self.tbl.rowCount(); self.tbl.insertRow(r)
        k = QTableWidgetItem(f.get('key', '')); k.setData(Qt.UserRole, f.get('id') or new_id()); self.tbl.setItem(r, 0, k)
        self.tbl.setItem(r, 1, QTableWidgetItem(f.get('label', '')))
        c = QComboBox(); c.addItems(FIELD_TYPES); c.setCurrentText(f.get('type', 'Text')); self.tbl.setCellWidget(r, 2, c)
        for col, key in ((3, 'required'), (4, 'readOnly')):
            ck = QCheckBox(); ck.setChecked(bool(f.get(key))); self.tbl.setCellWidget(r, col, ck)
        self.tbl.setItem(r, 5, QTableWidgetItem('; '.join(f'{o["label"]}={o["value"]}' for o in f.get('options', []))))

    def remove_row(self):
        if self.tbl.currentRow() >= 0:
            self.tbl.removeRow(self.tbl.currentRow())

    def accept_(self):
        fields = []
        for r in range(self.tbl.rowCount()):
            opts = []
            for part in (self.tbl.item(r, 5).text() if self.tbl.item(r, 5) else '').split(';'):
                part = part.strip()
                if part:
                    lab, _, val = part.partition('=')
                    opts.append({'label': lab.strip(), 'value': (val or lab).strip()})
            fields.append({'id': self.tbl.item(r, 0).data(Qt.UserRole), 'key': self.tbl.item(r, 0).text().strip(), 'label': self.tbl.item(r, 1).text().strip(),
                           'type': self.tbl.cellWidget(r, 2).currentText(), 'required': self.tbl.cellWidget(r, 3).isChecked(),
                           'readOnly': self.tbl.cellWidget(r, 4).isChecked(), 'options': opts, 'placeholder': None})
        self.form['title'] = self.title.text().strip()
        self.form['fields'] = fields
        self.accept()


# --------------------------------------------------------------------------- designer
class DesignerDialog(QDialog):
    def __init__(self, parent, def_id=None):
        super().__init__(parent)
        self.setWindowTitle(t('wf.designer'))
        self.resize(1300, 800)
        self.definition = {'id': '', 'name': 'Untitled flow', 'description': '', 'isPublished': False, 'version': 1, 'nodes': [], 'edges': []}
        self.users, self.roles, self.published = [], [], []
        self.can_design = api.can(SPEC['permissions']['design'])
        self.dirty = False
        lay = QVBoxLayout(self)
        bar = QHBoxLayout()
        self.name = QLineEdit(); self.name.setPlaceholderText(t('wf.name')); self.name.textChanged.connect(lambda s: self.definition.__setitem__('name', s))
        self.desc = QLineEdit(); self.desc.setPlaceholderText(t('wf.description')); self.desc.textChanged.connect(lambda s: self.definition.__setitem__('description', s))
        self.badge = QLabel()
        bar.addWidget(self.name, 2); bar.addWidget(self.desc, 3); bar.addWidget(self.badge)
        self.b_save = button(t('wf.save'), self.save, 'primary')
        self.b_pub = button(t('wf.publish'), self.publish)
        self.b_run = button(t('wf.run'), self.run)
        self.b_link = button(t('wf.link'), self.toggle_link)
        self.b_link.setCheckable(True)
        self.b_del = button(t('wf.delete'), lambda: self.canvas.delete_selected())
        for b in (self.b_link, self.b_del, self.b_save, self.b_pub, self.b_run):
            bar.addWidget(b)
        lay.addLayout(bar)
        split = QSplitter()
        self.toolbox = QToolBox()
        self.toolbox.setMinimumWidth(210); self.toolbox.setMaximumWidth(260)
        for cat in SPEC['categories']:
            w = QListWidget()
            for n in SPEC['nodes']:
                if n['category'] == cat:
                    it = QListWidgetItem(f'{n["icon"]}  {n["label"]}')
                    it.setData(Qt.UserRole, n['type']); it.setToolTip(n['note'])
                    w.addItem(it)
            w.itemDoubleClicked.connect(lambda it: self.add(it.data(Qt.UserRole)))
            self.toolbox.addItem(w, cat)
        split.addWidget(self.toolbox)
        self.canvas = Canvas(self.definition, True, self.on_select, self.on_change)
        split.addWidget(self.canvas)
        self.panel_scroll = QScrollArea(); self.panel_scroll.setWidgetResizable(True); self.panel_scroll.setMinimumWidth(320); self.panel_scroll.setMaximumWidth(420)
        self.panel = QWidget(); self.panel_scroll.setWidget(self.panel)
        PanelLay = QVBoxLayout(self.panel); self.panel_lay = PanelLay
        split.addWidget(self.panel_scroll)
        split.setStretchFactor(1, 1)
        lay.addWidget(split, 1)
        self.status = QLabel(t('wf.hint'))
        self.status.setStyleSheet('color:#64748b;')
        lay.addWidget(self.status)
        for b in (self.b_link, self.b_del, self.b_save, self.name, self.desc):
            b.setEnabled(self.can_design)
        self.b_pub.setEnabled(False); self.b_run.setEnabled(False)
        self.show_empty_panel()
        self._load(def_id)

    # ---- loading
    def _load(self, def_id):
        if def_id:
            run_async(lambda: api.wf_definition(def_id), self._loaded, lambda m: warn(self, m))
        run_async(lambda: (api.wf_users(), api.wf_definitions()), self._lookups, lambda m: None)
        if not def_id:
            self._apply()

    def _lookups(self, r):
        users, defs = r
        self.users = users or []
        self.roles = sorted({u.get('role') for u in self.users if u.get('role')})
        self.published = [d for d in (defs or []) if d.get('isPublished') and d.get('id') != self.definition.get('id')]

    def _loaded(self, d):
        self.definition = d
        d.setdefault('nodes', []); d.setdefault('edges', [])
        self.canvas.definition = d
        self.canvas.rebuild()
        self._apply()

    def _apply(self):
        d = self.definition
        self.name.blockSignals(True); self.desc.blockSignals(True)
        self.name.setText(d.get('name', '')); self.desc.setText(d.get('description') or '')
        self.name.blockSignals(False); self.desc.blockSignals(False)
        pub = d.get('isPublished')
        self.badge.setText(('● ' + t('wf.published') + f' v{d.get("version", 1)}') if pub else ('○ ' + t('wf.draft')))
        self.badge.setStyleSheet('color:#16a34a;font-weight:600' if pub else 'color:#d97706;font-weight:600')
        self.b_pub.setEnabled(bool(d.get('id')) and not pub and api.can(SPEC['permissions']['publish']))
        self.b_run.setEnabled(bool(pub))

    def on_change(self):
        self.dirty = True

    def toggle_link(self):
        self.canvas.set_link_mode(self.b_link.isChecked())
        self.status.setText(t('wf.linkHint') if self.b_link.isChecked() else t('wf.hint'))

    def add(self, tp):
        if self.can_design:
            self.canvas.add_node(tp)

    # ---- property panel
    def clear_panel(self):
        while self.panel_lay.count():
            it = self.panel_lay.takeAt(0)
            w = it.widget()
            if w:
                w.setParent(None)
                w.deleteLater()

    def show_empty_panel(self):
        self.clear_panel()
        l = QLabel(t('wf.selectHint')); l.setWordWrap(True); l.setStyleSheet('color:#64748b;')
        self.panel_lay.addWidget(l); self.panel_lay.addStretch()

    def on_select(self, nid, eid):
        if nid:
            self.build_node_panel(next(n for n in self.definition['nodes'] if n['id'] == nid))
        elif eid:
            self.build_edge_panel(next(e for e in self.definition['edges'] if e['id'] == eid))
        else:
            self.show_empty_panel()

    def _set(self, obj, key, value, rebuild=False, redraw=False):
        if value in ('', None):
            obj.pop(key, None) if key not in ('name', 'label') else obj.__setitem__(key, value or '')
        else:
            obj[key] = value
        self.dirty = True
        if redraw:
            self.canvas.scene_.update(); self.canvas.refresh_edges()
        if rebuild:
            QTimer.singleShot(0, lambda: self.on_select(self.canvas.selected_id(), self.canvas.selected_edge()))

    def build_edge_panel(self, e):
        self.clear_panel()
        self.panel_lay.addWidget(label(t('wf.edge'), 'title'))
        src = next((n for n in self.definition['nodes'] if n['id'] == e['sourceNodeId']), None)
        if src and src['type'] == 'Condition':
            w = QComboBox(); w.addItems(SPEC['conditionLabels']); w.setCurrentText(e['label'])
            w.currentTextChanged.connect(lambda v: (e.__setitem__('label', v), self.canvas.refresh_edges(), self.on_change()))
        else:
            w = QLineEdit(e['label'])
            w.textChanged.connect(lambda v: (e.__setitem__('label', v), self.canvas.refresh_edges(), self.on_change()))
        w.setEnabled(self.can_design)
        self.panel_lay.addWidget(QLabel(t('wf.edgeLabel'))); self.panel_lay.addWidget(w)
        if src and src['type'] == 'ApprovalTask':
            self.panel_lay.addWidget(self._hint(t('wf.edgeApprovalHint')))
        self.panel_lay.addStretch()

    def _hint(self, text):
        l = QLabel(text); l.setWordWrap(True); l.setStyleSheet('color:#64748b;font-size:11px;')
        return l

    def build_node_panel(self, n):
        self.clear_panel()
        spec = TYPES[n['type']]
        self.panel_lay.addWidget(label(f'{spec["icon"]} {spec["label"]}', 'title'))
        self.panel_lay.addWidget(self._hint(spec['note']))
        form = QFormLayout(); form.setLabelAlignment(Qt.AlignTop)
        host = QWidget(); host.setLayout(form)
        self.panel_lay.addWidget(host)
        referenced = {p['showIf']['key'] for p in sum((v['props'] for v in SPEC['nodes']), []) if p.get('showIf')}
        for p in SPEC['common'] + spec['props']:
            si = p.get('showIf')
            if si:
                cur = str(n.get(si['key']) or '')
                if ('eq' in si and cur != si['eq']) or ('ne' in si and cur == si['ne']):
                    continue
            w = self._editor(n, p, p['key'] in referenced)
            if w is None:
                continue
            w.setEnabled(self.can_design or p['kind'] == 'form')
            form.addRow(p['label'] + ':', w)
            if p.get('hint') and p['kind'] != 'form':
                form.addRow('', self._hint(p['hint']))
        self.panel_lay.addStretch()

    def _editor(self, n, p, rebuild):
        k, kind = p['key'], p['kind']
        if kind == 'text':
            w = QLineEdit(str(n.get(k) or ''))
            w.textChanged.connect(lambda v: self._set(n, k, v, redraw=(k == 'name')))
            return self._with_test(n, p, w) if p.get('test') else w
        if kind == 'textarea':
            w = QPlainTextEdit(str(n.get(k) or '')); w.setFixedHeight(90)
            w.textChanged.connect(lambda: self._set(n, k, w.toPlainText()))
            return w
        if kind == 'number':
            w = QDoubleSpinBox(); w.setRange(0, 10_000_000); w.setDecimals(0); w.setSpecialValueText('—')
            w.setValue(float(n.get(k) or 0))
            w.valueChanged.connect(lambda v: self._set(n, k, int(v) if v else None))
            return w
        if kind == 'bool':
            w = QCheckBox(); w.setChecked(bool(n.get(k)))
            w.toggled.connect(lambda v: self._set(n, k, bool(v), rebuild=rebuild))
            return w
        if kind == 'select':
            w = QComboBox(); w.addItems([o if o else '— none (stub) —' for o in p['options']])
            cur = n.get(k) or ''
            w.setCurrentIndex(p['options'].index(cur) if cur in p['options'] else 0)
            w.currentIndexChanged.connect(lambda i: self._set(n, k, p['options'][i], rebuild=rebuild))
            return w
        if kind == 'assignees':
            w = QListWidget(); w.setFixedHeight(130)
            chosen = {s.strip() for s in (n.get('assignee') or '').split(',') if s.strip()}
            for r in self.roles:
                it = QListWidgetItem(f'role: {r}'); it.setData(Qt.UserRole, r); it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
                it.setCheckState(Qt.Checked if r in chosen else Qt.Unchecked); w.addItem(it)
            for u in self.users:
                it = QListWidgetItem(f'{u.get("displayName")} ({u["username"]})'); it.setData(Qt.UserRole, u['username']); it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
                it.setCheckState(Qt.Checked if u['username'] in chosen else Qt.Unchecked); w.addItem(it)
            def upd(_):
                vals = [w.item(i).data(Qt.UserRole) for i in range(w.count()) if w.item(i).checkState() == Qt.Checked]
                self._set(n, 'assignee', ','.join(vals))
            w.itemChanged.connect(upd)
            return w
        if kind == 'assignee1':
            w = QComboBox(); w.setEditable(True)
            w.addItem('', '')
            for r in self.roles:
                w.addItem(f'role: {r}', r)
            for u in self.users:
                w.addItem(f'{u.get("displayName")} ({u["username"]})', u['username'])
            cur = n.get(k) or ''
            i = w.findData(cur)
            w.setCurrentIndex(i if i >= 0 else 0)
            if i < 0 and cur:
                w.setEditText(cur)
            w.currentIndexChanged.connect(lambda i: self._set(n, k, w.itemData(i)))
            return w
        if kind == 'workflow':
            w = QComboBox(); w.addItem('', '')
            for d in self.published:
                w.addItem(d['name'], d['id'])
            i = w.findData(n.get(k) or '')
            w.setCurrentIndex(max(i, 0))
            def pick(_):
                self._set(n, k, w.currentData())
                self._set(n, 'subWorkflowDefinitionName', w.currentText() if w.currentData() else None)
            w.currentIndexChanged.connect(pick)
            return w
        if kind == 'form':
            n.setdefault('form', {'id': new_id(), 'title': n['name'], 'fields': []})
            b = QPushButton(t('wf.editForm', n=len(n['form'].get('fields', []))))
            def edit():
                if FormEditorDialog(self, n['form']).exec():
                    self.dirty = True
                    b.setText(t('wf.editForm', n=len(n['form'].get('fields', []))))
            b.clicked.connect(edit)
            return b
        return None

    def _with_test(self, n, p, w):
        box = QWidget(); v = QVBoxLayout(box); v.setContentsMargins(0, 0, 0, 0)
        v.addWidget(w)
        data = QPlainTextEdit('{\n  "days": 6\n}'); data.setFixedHeight(70)
        out = QLabel(); out.setWordWrap(True)
        def test():
            try:
                d = json.loads(data.toPlainText() or '{}')
            except Exception:
                out.setText(t('wf.badJson')); return
            def ok(r):
                lines = [('<b style="color:%s">%s: %s</b>' % ('#16a34a' if r['result'] else '#dc2626', t('wf.result'), 'True' if r['result'] else 'False'))]
                lines += [('✓ ' if c['result'] else '✕ ') + c['clause'] for c in r.get('clauses', [])]
                out.setText('<br>'.join(lines))
            run_async(lambda: api.wf_test_condition(n.get('conditionExpression') or '', d), ok, lambda m: out.setText(m))
        v.addWidget(QLabel(t('wf.sampleData'))); v.addWidget(data); v.addWidget(button('▶ ' + t('wf.test'), test)); v.addWidget(out)
        return box

    # ---- server actions
    def _body(self):
        d = self.definition
        return {'name': d['name'], 'description': d.get('description', ''), 'nodes': d['nodes'], 'edges': d['edges']}

    def save(self, then=None):
        def ok(d):
            self.dirty = False
            self.definition = d; d.setdefault('nodes', []); d.setdefault('edges', [])
            self.canvas.definition = d; self.canvas.rebuild(); self._apply()
            self.status.setText(t('wf.saved'))
            if then:
                then()
        d = self.definition
        run_async(lambda: api.wf_save(d.get('id'), self._body()), ok, lambda m: warn(self, m))

    def publish(self):
        starts = sum(1 for n in self.definition['nodes'] if n['type'] == 'Start')
        if starts != 1:
            return warn(self, t('wf.needStart'))
        if not any(n['type'] == 'End' for n in self.definition['nodes']):
            return warn(self, t('wf.needEnd'))
        def go():
            run_async(lambda: api.wf_publish(self.definition['id']), lambda d: (self.definition.update(d), self._apply(), self.status.setText(t('wf.publishedMsg'))), lambda m: warn(self, m))
        self.save(go)

    def run(self):
        def ok(i):
            self.status.setText(t('wf.started', id=i.get('id', '')))
            InstanceDialog(self, i['id']).exec()
        run_async(lambda: api.wf_start(self.definition['id']), ok, lambda m: warn(self, m))


# --------------------------------------------------------------------------- instance monitor
class InstanceDialog(QDialog):
    def __init__(self, parent, inst_id):
        super().__init__(parent)
        self.setWindowTitle(t('wf.instance'))
        self.resize(1100, 720)
        self.inst_id, self.inst, self.definition = inst_id, None, None
        lay = QVBoxLayout(self)
        top = QHBoxLayout()
        self.head = label('…', 'title'); top.addWidget(self.head, 1)
        self.b_cancel = button(t('wf.cancelReq'), self.cancel); self.b_cancel.setEnabled(False)
        top.addWidget(self.b_cancel)
        lay.addLayout(top)
        self.meta = QLabel(); self.meta.setStyleSheet('color:#64748b;'); lay.addWidget(self.meta)
        leg = QLabel('<span style="color:#16a34a">●</span> ' + t('wf.legActive') + '  <span style="color:#86efac">●</span> ' + t('wf.legDone') + '  <span style="color:#dc2626">●</span> ' + t('wf.legRejected') + '  <span style="color:#94a3b8">●</span> ' + t('wf.legPending'))
        lay.addWidget(leg)
        self.holder = QVBoxLayout(); lay.addLayout(self.holder, 2)
        self.canvas = None
        tabs = QTabWidget(); lay.addWidget(tabs, 1)
        self.timeline = QListWidget(); tabs.addTab(self.timeline, t('wf.timeline'))
        self.data = make_table([t('wf.key'), t('wf.value')]); tabs.addTab(self.data, t('wf.data'))
        self.log = QListWidget(); tabs.addTab(self.log, t('wf.activityLog'))
        self.timer = QTimer(self); self.timer.timeout.connect(self.refresh); self.timer.start(3000)
        self.finished.connect(lambda _=0: self.timer.stop())
        self.refresh()

    def refresh(self):
        run_async(lambda: api.wf_instance(self.inst_id), self._got, lambda m: None)

    def _got(self, i):
        self.inst = i
        if not self.definition and i.get('definitionId'):
            run_async(lambda: api.wf_definition(i['definitionId']), self._def, lambda m: None)
        self._paint()
        if i.get('status') != 'Running':
            self.timer.stop()

    def _def(self, d):
        self.definition = d
        d.setdefault('nodes', []); d.setdefault('edges', [])
        self._paint()

    def _paint(self):
        i = self.inst
        if not i:
            return
        self.head.setText(f'{i.get("definitionName", "")}  —  {i.get("status", "")}')
        self.meta.setText(f'{t("wf.startedBy")} {i.get("startedBy", "")} · {i.get("startedAt", "")}')
        u = api.session.username if api.session else ''
        self.b_cancel.setEnabled(i.get('status') == 'Running' and (u == i.get('startedBy') or (api.session and api.session.role == 'admin')))
        hist = i.get('history') or []
        self.timeline.clear()
        for h in hist:
            self.timeline.addItem(f'{h.get("timestamp", "")[:16].replace("T", " ")}   {h.get("nodeName", "")} — {h.get("action", "")}' + (f'  · {h["actor"]}' if h.get('actor') else '') + (f'   “{h["comment"]}”' if h.get('comment') else ''))
        fill_table(self.data, [[k, short(v, 80)] for k, v in (i.get('data') or {}).items()], [k for k in (i.get('data') or {})])
        def logs(rows):
            self.log.clear()
            for l in rows or []:
                self.log.addItem(f'{l.get("timestamp", "")[:16].replace("T", " ")}   {l.get("nodeName", "")} — {l.get("action", "")}   {l.get("actor") or "system"}')
        run_async(lambda: api.wf_activity(self.inst_id), logs, lambda m: None)
        if self.definition:
            visited = {h['nodeId'] for h in hist if h.get('nodeId')}
            rejected = {h['nodeId'] for h in hist if h.get('action') in ('Rejected', 'Canceled', 'Escalated') and h.get('nodeId')}
            active = set(i.get('currentNodeIds') or []) if i.get('status') == 'Running' else set()
            states = {}
            for n in self.definition['nodes']:
                states[n['id']] = 'rejected' if n['id'] in rejected else 'active' if n['id'] in active else 'visited' if n['id'] in visited else 'pending'
            estates = {}
            for e in self.definition['edges']:
                if e['sourceNodeId'] in visited and (e['targetNodeId'] in visited or e['targetNodeId'] in active):
                    estates[e['id']] = 'rejected' if e['targetNodeId'] in rejected else 'ok'
            if self.canvas is None:
                self.canvas = Canvas(self.definition, False)
                self.holder.addWidget(self.canvas)
            self.canvas.states, self.canvas.edge_states = states, estates
            self.canvas.rebuild()

    def cancel(self):
        if ask(self, t('wf.cancelConfirm'), t('wf.yes'), t('wf.no')):
            run_async(lambda: api.wf_cancel(self.inst_id), lambda r: self.refresh(), lambda m: warn(self, m))


# --------------------------------------------------------------------------- page
class WorkflowPage(Page):
    def __init__(self):
        super().__init__()
        self.title(t('tab.workflow'))
        self.tabs = QTabWidget(); self.lay.addWidget(self.tabs, 1)
        fw = QWidget(); fl = QVBoxLayout(fw)
        row = QHBoxLayout()
        self.b_new = button('+ ' + t('wf.new'), self.new, 'primary'); self.b_open = button(t('wf.open'), self.open_); self.b_start = button(t('wf.run'), self.start)
        self.b_dup = button(t('wf.delete'), self.remove)
        for b in (self.b_new, self.b_open, self.b_start, self.b_dup):
            row.addWidget(b)
        row.addStretch(); fl.addLayout(row)
        self.defs_tbl = make_table([t('wf.name'), t('wf.version'), t('wf.steps'), t('wf.status'), t('wf.description')])
        self.defs_tbl.doubleClicked.connect(lambda _=0: self.open_())
        fl.addWidget(self.defs_tbl, 1)
        self.tabs.addTab(fw, t('wf.flows'))
        self.inst_tbls = {}
        for key, lab in (('Running', 'wf.running'), ('Completed', 'wf.completed'), ('Terminated', 'wf.canceled')):
            tb = make_table([t('wf.name'), t('wf.status'), t('wf.startedBy'), t('wf.startedAt')])
            tb.doubleClicked.connect(lambda _=0, tb=tb: self.open_instance(tb))
            self.inst_tbls[key] = tb
            self.tabs.addTab(tb, t(lab))
        can_d = api.can(SPEC['permissions']['design'])
        self.b_new.setEnabled(can_d); self.b_dup.setEnabled(can_d)
        self.defs = []

    def reload(self):
        if api.can(SPEC['permissions']['view']):
            run_async(api.wf_definitions, self._defs, lambda m: warn(self, m))
        run_async(api.wf_instances, self._insts, lambda m: None)

    def _defs(self, rows):
        self.defs = rows or []
        fill_table(self.defs_tbl, [[d['name'], f'v{d.get("version", 1)}', str(len(d.get('nodes') or [])), t('wf.published') if d.get('isPublished') else t('wf.draft'), short(d.get('description') or '', 60)] for d in self.defs], self.defs)

    def _insts(self, rows):
        rows = rows or []
        for key, tb in self.inst_tbls.items():
            sub = [r for r in rows if r.get('status') == key]
            fill_table(tb, [[r.get('definitionName'), r.get('status'), r.get('startedBy'), (r.get('startedAt') or '')[:16].replace('T', ' ')] for r in sub], sub)
            self.tabs.setTabText(1 + list(self.inst_tbls).index(key), f'{t({"Running": "wf.running", "Completed": "wf.completed", "Terminated": "wf.canceled"}[key])} ({len(sub)})')

    def new(self):
        DesignerDialog(self).exec(); self.reload()

    def open_(self):
        d = current_payload(self.defs_tbl)
        if d:
            DesignerDialog(self, d['id']).exec(); self.reload()

    def start(self):
        d = current_payload(self.defs_tbl)
        if not d:
            return
        if not d.get('isPublished'):
            return warn(self, t('wf.notPublished'))
        run_async(lambda: api.wf_start(d['id']), lambda i: (InstanceDialog(self, i['id']).exec(), self.reload()), lambda m: warn(self, m))

    def remove(self):
        d = current_payload(self.defs_tbl)
        if d and ask(self, t('wf.deleteConfirm', name=d['name']), t('wf.yes'), t('wf.no')):
            run_async(lambda: api.wf_delete(d['id']), lambda r: self.reload(), lambda m: warn(self, m))

    def open_instance(self, tb):
        r = current_payload(tb)
        if r:
            InstanceDialog(self, r['id']).exec(); self.reload()
