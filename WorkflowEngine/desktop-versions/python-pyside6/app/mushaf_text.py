"""The Madinah Mushaf drawn as text: ornate frame, surah / juz header, 15 justified lines, verse medallions (same look as the portal's text pages).
Data: data/mushaf-text.json (per page: ['H', surah] banner, ['B'] basmala, ['L', tokens] where a token is a word, a verse number or '*').
Font: Amiri Quran (SIL OFL, data/OFL.txt)."""
import json
import re
from pathlib import Path

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QBrush, QColor, QFont, QFontDatabase, QFontMetricsF, QPainter, QPen, QPolygonF
from PySide6.QtCore import QPointF
from PySide6.QtWidgets import QWidget

from . import prayer

_DATA = Path(__file__).resolve().parent.parent / 'data'
MF = prayer.SPEC['mushaf']
_pages = None
_family = None
AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
THEMES = {
    'rose': dict(bg='#fffdf6', band='#f2c6d6', line='#7a1f4b', orn='#c2185b', edge='#9a2f63', cfill='#fbe4ee', ctext='#4a1030', num='#6b2a4a', hfill='#f6d3e1', mstroke='#8a3a63', mfill='#fbe3ec', hearts=True),
    'blue': dict(bg='#f5f9ff', band='#b9d3f3', line='#1b4a86', orn='#1565c0', edge='#2f6db5', cfill='#e1eeff', ctext='#0c2a55', num='#1d3d6b', hfill='#cde1fb', mstroke='#2a63ad', mfill='#e4efff', hearts=False),
}
_P = THEMES['rose']

_STRIP = re.compile('[ً-ٰٟۖ-ۭـ]')
_RED = re.compile('^[وفبتك]?(?:الله|لله|رب(?:نا|كم|هم|ك|ي|ه|ها|هما|كما|هن)?)$')


def ar_num(n):
    return ''.join(AR_DIGITS[int(c)] for c in str(n))


def is_red(w):
    return bool(_RED.match(_STRIP.sub('', w).replace('ٱ', 'ا')))


def pages():
    global _pages
    if _pages is None:
        _pages = json.loads((_DATA / 'mushaf-text.json').read_text(encoding='utf-8'))
    return _pages


def family():
    global _family
    if _family is None:
        fid = QFontDatabase.addApplicationFont(str(_DATA / 'AmiriQuran-Regular.ttf'))
        fams = QFontDatabase.applicationFontFamilies(fid) if fid >= 0 else []
        _family = fams[0] if fams else 'Amiri'
    return _family


def surah_of_page(p):
    n = 1
    for i, s in enumerate(MF['surahStart']):
        if s <= p:
            n = i + 1
    return n


def juz_of_page(p):
    n = 1
    for i, s in enumerate(MF['juzStart']):
        if s <= p:
            n = i + 1
    return n


def _font(px, bold=False):
    f = QFont(family())
    f.setPixelSize(max(4, int(round(px))))
    f.setBold(bold)
    return f


def _center(p, rect, text):
    """Draw text centred in rect on a baseline derived from the font metrics (Amiri's tall line box would otherwise push it down)."""
    fm = QFontMetricsF(p.font())
    w = fm.horizontalAdvance(text)
    base = rect.center().y() + (fm.ascent() - fm.descent()) / 2.0 - p.font().pixelSize() * .05
    p.drawText(QPointF(rect.center().x() - w / 2.0, base), text)


def _cartouche(p, rect, text, u):
    p.setPen(QPen(QColor(_P['edge']), .35 * u))
    p.setBrush(QColor(_P['cfill']))
    p.drawRoundedRect(rect, 1.2 * u, 1.2 * u)
    p.setPen(QColor(_P['ctext']))
    p.setFont(_font(3.5 * u))
    _center(p, rect, text)


def draw_page(p, W, H, page, night=False, theme='rose', hits=None):
    """Paint one Mushaf page into a W x H box. hits (a list) receives (rect, line index, token index) of every word, so a tap can be mapped to a word."""
    global _P
    _P = THEMES.get(theme, THEMES['rose'])
    u = W / 100.0
    p.save()
    p.setRenderHint(QPainter.Antialiasing)
    p.setRenderHint(QPainter.TextAntialiasing)
    p.setLayoutDirection(Qt.RightToLeft)
    p.fillRect(QRectF(0, 0, W, H), QColor(_P['bg']))
    # frame: pink band between two dark lines, white rosettes in the corners, hearts along the band
    fo, bw = 1.4 * u, 3.4 * u
    outer = QRectF(fo, fo, W - 2 * fo, H - 2 * fo)
    p.setPen(Qt.NoPen)
    p.setBrush(QColor(_P['band']))
    p.drawRect(outer)
    inner = outer.adjusted(bw, bw, -bw, -bw)
    p.setBrush(QColor(_P['bg']))
    p.drawRect(inner)
    p.setBrush(Qt.NoBrush)
    p.setPen(QPen(QColor(_P['line']), .5 * u))
    p.drawRect(outer.adjusted(.25 * u, .25 * u, -.25 * u, -.25 * u))
    p.setPen(QPen(QColor(_P['line']), .4 * u))
    p.drawRect(inner)
    p.setPen(Qt.NoPen)
    p.setBrush(QColor(_P['orn']))
    mid = bw / 2

    def heart(cx, cy):
        r = .72 * u
        if not _P['hearts']:
            p.drawPolygon(QPolygonF([QPointF(cx, cy - r * 1.05), QPointF(cx + r * .8, cy), QPointF(cx, cy + r * 1.05), QPointF(cx - r * .8, cy)]))
            return
        p.drawEllipse(QPointF(cx - r * .5, cy - r * .25), r * .55, r * .55)
        p.drawEllipse(QPointF(cx + r * .5, cy - r * .25), r * .55, r * .55)
        p.drawPolygon(QPolygonF([QPointF(cx - r * 1.02, cy - r * .05), QPointF(cx + r * 1.02, cy - r * .05), QPointF(cx, cy + r * 1.1)]))
    step = 4.2 * u
    x = outer.left() + bw + step / 2
    while x < outer.right() - bw - step / 4:
        heart(x, outer.top() + mid)
        heart(x, outer.bottom() - mid)
        x += step
    y = outer.top() + bw + step / 2
    while y < outer.bottom() - bw - step / 4:
        heart(outer.left() + mid, y)
        heart(outer.right() - mid, y)
        y += step
    p.setBrush(QColor('#ffffff'))
    for cx, cy in ((outer.left() + mid, outer.top() + mid), (outer.right() - mid, outer.top() + mid), (outer.left() + mid, outer.bottom() - mid), (outer.right() - mid, outer.bottom() - mid)):
        p.drawEllipse(QPointF(cx, cy), 1.25 * u, 1.25 * u)
    # header (juz on the right, surah on the left) and page number
    left = inner.left() + 1.2 * u
    right = inner.right() - 1.2 * u
    top = inner.top() + .4 * u
    hh = 6.2 * u
    p.setFont(_font(3.5 * u))
    jt = 'الجزء ' + MF['juzAr'][juz_of_page(page) - 1]
    st = 'سورة ' + MF['surahAr'][surah_of_page(page) - 1]
    for text, right_side in ((jt, True), (st, False)):
        w = QFontMetricsF(p.font()).horizontalAdvance(text) + 4.8 * u
        r = QRectF(right - w if right_side else left, top + .7 * u, w, hh - 1.4 * u)
        _cartouche(p, r, text, u)
    ftxt = ar_num(page)
    p.setPen(QColor(_P['num']))
    p.setFont(_font(3.2 * u))
    _center(p, QRectF(left, inner.bottom() - 4.8 * u, right - left, 4.4 * u), ftxt)
    # lines
    data = pages()[page - 1]
    body_top = top + hh
    body_bot = inner.bottom() - 4.8 * u
    row = (body_bot - body_top) / 15.0
    y0 = body_top + (15 - len(data)) * row / 2.0
    W2 = right - left
    S = 5.6 * u
    for i, ln in enumerate(data):
        ry = y0 + i * row
        kind = ln[0]
        if kind == 'H':
            r = QRectF(left, ry + .5 * u, W2, row - 1.0 * u)
            p.setPen(QPen(QColor(_P['edge']), .35 * u))
            p.setBrush(QColor(_P['hfill']))
            p.drawRoundedRect(r, 1.6 * u, 1.6 * u)
            p.setPen(QColor(_P['ctext']))
            p.setFont(_font(4.9 * u))
            _center(p, r, 'سُورَةُ ' + MF['surahAr'][ln[1] - 1])
        elif kind == 'B':
            p.setPen(QColor('#14110f'))
            p.setFont(_font(4.9 * u))
            _center(p, QRectF(left, ry, W2, row), 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ')
        else:
            _draw_line(p, ln[1], left, ry, W2, row, S, u, hits, i)
    p.restore()
    if night:
        pass  # inversion is applied by the caller on the rendered image


def _draw_line(p, toks, left, ry, W, row, S, u, hits=None, li=0):
    k = 1.0
    for _ in range(2):
        fs = S * k
        font = _font(fs)
        fm = QFontMetricsF(font)
        small = _font(fs * .62)
        fms = QFontMetricsF(small)
        items = []
        for ti, t in enumerate(toks):
            if t == '*':
                items.append(('q', t, fms.horizontalAdvance('۞'), ti))
            elif isinstance(t, int):
                items.append(('n', t, fs * .74 * 1.45, ti))
            else:
                items.append(('w', t, fm.horizontalAdvance(t), ti))
        tot = sum(w for _, _, w, _ in items)
        gap0 = fs * .22 * max(0, len(items) - 1)
        nat = tot + gap0
        if nat > W and k == 1.0:
            k = max(.6, W / nat * .985)
            continue
        break
    n = len(items)
    if nat < W * .72:
        gap = fs * .32
        x = left + W - (tot + gap * (n - 1) + 0) - (W - (tot + gap * (n - 1))) / 2.0
        x = left + (W - (tot + gap * (n - 1))) / 2.0 + (tot + gap * (n - 1))
    else:
        gap = (W - tot) / (n - 1) if n > 1 else 0
        x = left + W
    cy = ry + row / 2.0
    base = cy + (fm.ascent() - fm.descent()) / 2.0 - fs * .05
    for kind, t, w, ti in items:
        x -= w
        if kind == 'w':
            if hits is not None:
                hits.append((QRectF(x - gap / 2, ry, w + gap, row), li, ti))
            p.setFont(font)
            p.setPen(QColor('#c0143c' if is_red(t) else '#14110f'))
            p.drawText(QPointF(x, base), t)
        elif kind == 'q':
            p.setFont(small)
            p.setPen(QColor(_P['edge']))
            p.drawText(QPointF(x, base), '۞')
        else:
            d = fs * .74 * 1.45
            p.setPen(QPen(QColor(_P['mstroke']), fs * .045))
            p.setBrush(QColor(_P['mfill']))
            p.drawEllipse(QRectF(x, cy - d / 2, d, d))
            p.setPen(QColor(_P['ctext']))
            p.setFont(_font(fs * .49))
            _center(p, QRectF(x, cy - d / 2, d, d), ar_num(t))
        x -= gap


class MushafTextPage(QWidget):
    def __init__(self, page, width, night=False, theme='rose'):
        super().__init__()
        self.page, self.night, self.theme = page, night, theme
        self.hits = []
        self.on_word = None   # set by the owner: called with (page, line index, token index, word)
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedSize(width, int(width * 4206 / 2600))

    def paintEvent(self, _e):
        from PySide6.QtGui import QImage
        img = QImage(self.width(), self.height(), QImage.Format_ARGB32_Premultiplied)
        img.fill(Qt.white)
        qp = QPainter(img)
        self.hits = []
        draw_page(qp, self.width(), self.height(), self.page, self.night, self.theme, self.hits)
        qp.end()
        if self.night:
            img.invertPixels()
        out = QPainter(self)
        out.drawImage(0, 0, img)

    def word_at(self, pos):
        """(line index, token index, word) under a point, or None"""
        for r, li, ti in self.hits:
            if r.contains(pos):
                return li, ti, pages()[self.page - 1][li][1][ti]
        return None

    def mousePressEvent(self, e):
        w = self.word_at(e.position())
        if w and self.on_word:
            self.on_word(self.page, w[0], w[1], w[2])
