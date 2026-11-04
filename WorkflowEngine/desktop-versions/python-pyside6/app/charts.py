"""Small painter-drawn charts for the dashboard and reports (no extra dependencies)."""
from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPen
from PySide6.QtWidgets import QFrame, QLabel, QSizePolicy, QVBoxLayout, QWidget

from . import i18n

DIM = QColor('#64748b')
LINE = QColor('#e2e8f0')


def compact(v):
    a = abs(v)
    if a >= 1e6: return '%.1fM' % (v / 1e6)
    if a >= 1e3: return '%.1fk' % (v / 1e3)
    return '%d' % round(v)


def money(v, cur=''):
    return ('{:,.0f}'.format(v) + (' ' + cur if cur else ''))


class KpiCard(QFrame):
    clicked = Signal()

    def __init__(self, label, value, hint='', color='#2563eb'):
        super().__init__()
        self.setProperty('card', True)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet('QFrame[card="true"] { border-left: 4px solid %s; }' % color)
        l = QVBoxLayout(self)
        self.lab, self.val, self.hint = QLabel(label), QLabel(value), QLabel(hint)
        self.lab.setStyleSheet('color:#64748b; border:none; font-size:12px;')
        self.val.setStyleSheet('font-size:22px; font-weight:700; border:none; color:%s;' % color)
        self.hint.setStyleSheet('color:#94a3b8; border:none; font-size:11px;')
        self.hint.setWordWrap(True)
        for w in (self.lab, self.val, self.hint):
            l.addWidget(w)

    def set(self, value, hint=''):
        self.val.setText(value)
        self.hint.setText(hint)

    def mousePressEvent(self, e):
        self.clicked.emit()


class FlowStrip(QWidget):
    """Request > Approval > Purchase > Inventory > Accounting > Reporting with the open documents per stage."""
    picked = Signal(str)

    def __init__(self):
        super().__init__()
        self.setMinimumHeight(100)
        self.data, self.active = [], ''   # [(key, label, count, value_text)]

    def set(self, data):
        self.data = data
        self.update()

    def mousePressEvent(self, e):
        if not self.data:
            return
        w = self.width() / len(self.data)
        i = int((self.width() - e.position().x() if i18n.rtl() else e.position().x()) // w)
        if 0 <= i < len(self.data):
            self.active = '' if self.active == self.data[i][0] else self.data[i][0]
            self.picked.emit(self.active)
            self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        n = len(self.data)
        if not n:
            return
        w = self.width() / n
        for i, (key, lab, cnt, val) in enumerate(self.data):
            x = (self.width() - (i + 1) * w) if i18n.rtl() else i * w
            r = QRectF(x + 4, 4, w - 8, self.height() - 8)
            on = key == self.active
            p.setPen(QPen(QColor('#2563eb') if on else LINE, 1.5))
            p.setBrush(QColor('#eff6ff') if on else QColor('#ffffff'))
            p.drawRoundedRect(r, 10, 10)
            p.setPen(QColor('#0f172a'))
            f = QFont(self.font()); f.setPointSize(16); f.setBold(True); p.setFont(f)
            p.drawText(QRectF(r.x(), r.y() + 4, r.width(), 28), Qt.AlignCenter, str(cnt))
            f.setPointSize(9); f.setBold(False); p.setFont(f)
            p.setPen(DIM)
            p.drawText(QRectF(r.x() + 2, r.y() + 34, r.width() - 4, 18), Qt.AlignCenter, lab)
            p.drawText(QRectF(r.x() + 2, r.y() + 54, r.width() - 4, 18), Qt.AlignCenter, val)
        p.end()


class TrendChart(QWidget):
    """Grouped bars: sales vs purchases per month."""
    def __init__(self, a_label, b_label):
        super().__init__()
        self.setMinimumHeight(190)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.pts, self.a, self.b = [], a_label, b_label

    def set(self, pts):
        self.pts = pts
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        W, H = self.width(), self.height()
        L, R, T, B = 46, 8, 22, 26
        mx = max([max(q['sales'], q['purchases']) for q in self.pts] + [1.0])
        p.setPen(QPen(LINE, 1))
        f = QFont(self.font()); f.setPointSize(8); p.setFont(f)
        for k in range(5):
            y = T + (H - T - B) * (1 - k / 4)
            p.setPen(QPen(LINE, 1)); p.drawLine(L, int(y), W - R, int(y))
            p.setPen(DIM); p.drawText(QRectF(0, y - 8, L - 4, 16), Qt.AlignRight | Qt.AlignVCenter, compact(mx * k / 4))
        n = max(len(self.pts), 1)
        slot = (W - L - R) / n
        names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        ar = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
        for i, q in enumerate(self.pts):
            j = n - 1 - i if i18n.rtl() else i
            x0 = L + j * slot
            bw = slot * 0.32
            for k, (v, c) in enumerate(((q['sales'], '#0ea5e9'), (q['purchases'], '#8b5cf6'))):
                h = (H - T - B) * v / mx
                p.setPen(Qt.NoPen); p.setBrush(QColor(c))
                p.drawRoundedRect(QRectF(x0 + slot * 0.15 + k * (bw + 2), H - B - h, bw, max(h, 0)), 3, 3)
            p.setPen(DIM)
            p.drawText(QRectF(x0, H - B + 4, slot, 16), Qt.AlignCenter, (ar if i18n.rtl() else names)[q['month'] - 1])
        # legend
        x = W - R - 250 if not i18n.rtl() else L + 4
        for c, lab in (('#0ea5e9', self.a), ('#8b5cf6', self.b)):
            p.setBrush(QColor(c)); p.setPen(Qt.NoPen); p.drawRoundedRect(QRectF(x, 5, 10, 10), 2, 2)
            p.setPen(DIM); p.drawText(QRectF(x + 14, 2, 105, 16), Qt.AlignLeft | Qt.AlignVCenter, lab); x += 125
        p.end()


class HBars(QWidget):
    """Horizontal bars: rows = [(label, value, color, text)]."""
    def __init__(self):
        super().__init__()
        self.rows = []
        self.setMinimumHeight(40)

    def set(self, rows):
        self.rows = rows
        self.setMinimumHeight(max(40, 26 * len(rows) + 8))
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        if not self.rows:
            p.setPen(DIM); p.drawText(self.rect(), Qt.AlignCenter, i18n.t('common.noData')); p.end(); return
        mx = max(r[1] for r in self.rows) or 1
        lw = min(150, self.width() * 0.34)
        rtl = i18n.rtl()
        for i, (lab, v, col, txt) in enumerate(self.rows):
            y = 4 + i * 26
            tx = QRectF(self.width() - lw if rtl else 0, y, lw - 6, 20)
            p.setPen(QColor('#0f172a')); p.drawText(tx, (Qt.AlignRight if not rtl else Qt.AlignLeft) | Qt.AlignVCenter, p.fontMetrics().elidedText(lab, Qt.ElideRight, int(lw - 8)))
            span = self.width() - lw - 70
            bw = max(3.0, span * v / mx)
            x = (self.width() - lw - bw) if rtl else lw
            p.setPen(Qt.NoPen); p.setBrush(QColor(col)); p.drawRoundedRect(QRectF(x, y + 3, bw, 14), 4, 4)
            p.setPen(DIM)
            p.drawText(QRectF(x - 66, y, 60, 20) if rtl else QRectF(x + bw + 6, y, 64, 20), Qt.AlignVCenter | (Qt.AlignRight if rtl else Qt.AlignLeft), txt)
        p.end()
