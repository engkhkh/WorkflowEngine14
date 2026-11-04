"""Muslim workspace: prayer times (Adhan-style reminders, Qibla, Hijri date) and the Holy Quran as Mushaf page images.
Same behaviour as the portal's Muslim module; the settings live on this computer (QSettings)."""
import json
import math
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, available_timezones

from PySide6.QtCore import QLocale, QPointF, QSettings, QStandardPaths, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QImage, QKeySequence, QPainter, QPen, QPixmap, QShortcut
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QDoubleSpinBox, QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QMessageBox, QPushButton, QScrollArea, QSpinBox, QTabWidget, QTableWidget, QTableWidgetItem,
                               QVBoxLayout, QWidget, QAbstractItemView, QHeaderView)

from . import i18n, prayer
from .i18n import t
from .mushaf_text import MushafTextPage
from .quran_words import WordDialog
from .pages import Page
from .ui import button, label, run_async

PRAYERS = prayer.PRAYERS
CITIES = prayer.SPEC['cities']
MF = prayer.SPEC['mushaf']
PAGES, SURAH_START, JUZ_START, SURAH_AR = MF['pages'], MF['surahStart'], MF['juzStart'], MF['surahAr']


def clamp_page(p):
    return min(PAGES, max(1, int(round(p or 1))))


def surah_of_page(p):
    n = 1
    for i, s in enumerate(SURAH_START):
        if s <= p:
            n = i + 1
    return n


def juz_of_page(p):
    n = 1
    for i, s in enumerate(JUZ_START):
        if s <= p:
            n = i + 1
    return n


# ------------------------------------------------------------------ settings
def _region():
    n = QLocale.system().name()
    cc = n.split('_')[1] if '_' in n else ''
    return cc if cc in CITIES else ''


def defaults():
    cc = _region()
    c = CITIES[cc][0] if cc else None
    return {
        'cc': cc if c else '', 'city': c[0] if c else '', 'lat': c[1] if c else 21.4225, 'lng': c[2] if c else 39.8262, 'tz': c[3] if c else 'Asia/Riyadh',
        'placeSet': bool(c), 'method': prayer.default_method(cc), 'hanafi': prayer.default_hanafi(cc), 'highLat': 'angle', 'adjust': {}, 'hijriAdjust': 0, 'time24': False,
        'remind': {p: {'on': p != 'sunrise', 'before': 15 if p == 'sunrise' else 10} for p in PRAYERS}, 'sound': 'chime',
        'mpage': 1, 'mzoom': 100, 'mtwo': False, 'mnight': False, 'mbase': '', 'mmode': 'img', 'mtheme': 'rose', 'pmarks': [],
    }


class Store:
    def __init__(self):
        self._q = QSettings('WorkflowEngine', 'ErpPySide')
        self.s = defaults()
        try:
            v = json.loads(self._q.value('muslim', '') or 'null')
            if v:
                self.s.update(v)
                self.s['remind'] = {**defaults()['remind'], **(v.get('remind') or {})}
        except Exception:  # noqa: BLE001
            pass

    def save(self, **kw):
        self.s.update(kw)
        self._q.setValue('muslim', json.dumps(self.s))

    def opts(self):
        s = self.s
        return {'method': s['method'], 'hanafi': s['hanafi'], 'highLat': s['highLat'], 'adjust': s['adjust']}

    def place(self):
        return {'lat': self.s['lat'], 'lng': self.s['lng']}


store = Store()


def now_ms():
    return datetime.now(timezone.utc).timestamp() * 1000


def pname(p):
    return t('mus.' + p)


def fmt_time(ms):
    if ms is None:
        return '—'
    s = store.s
    d = datetime.fromtimestamp(round(ms / 60000) * 60, ZoneInfo(s['tz']))
    return d.strftime('%H:%M') if s['time24'] else d.strftime('%I:%M %p').lstrip('0')


def hijri_text(today):
    """Hijri (Umm al-Qura) date in the place's zone; after Maghrib the Islamic day has begun, so it moves on by one."""
    try:
        from hijridate import Gregorian
        s = store.s
        after = today['at']['maghrib'] and now_ms() >= today['at']['maghrib']
        d = datetime.fromtimestamp(now_ms() / 1000, ZoneInfo(s['tz'])).date() + timedelta(days=(1 if after else 0) + s['hijriAdjust'])
        h = Gregorian(d.year, d.month, d.day).to_hijri()
        return f"{h.day} {h.month_name('ar' if i18n.rtl() else 'en')} {h.year}"
    except Exception:  # noqa: BLE001
        return ''


def country_name(cc):
    try:
        loc = QLocale('ar' if i18n.rtl() else 'en')
        return loc.territoryToString(QLocale.codeToTerritory(cc)) or cc
    except Exception:  # noqa: BLE001
        return cc


# ------------------------------------------------------------------ prayer times tab
class Dial(QWidget):
    def __init__(self):
        super().__init__()
        self.deg = 0
        self.setFixedSize(90, 90)

    def set_bearing(self, d):
        self.deg = d
        self.update()

    def paintEvent(self, _e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        c = QPointF(45, 45)
        p.setPen(QPen(QColor('#cbd5e1'), 2))
        p.drawEllipse(c, 40, 40)
        p.setPen(QColor('#64748b'))
        p.drawText(38, 14, 'N')
        p.translate(c)
        p.rotate(self.deg)
        p.setPen(QPen(QColor('#16a34a'), 4, Qt.SolidLine, Qt.RoundCap))
        p.drawLine(QPointF(0, 6), QPointF(0, -30))
        p.setBrush(QColor('#16a34a'))
        p.drawRect(-6, -38, 12, 12)


class PrayerTab(QWidget):
    def __init__(self):
        super().__init__()
        outer = QHBoxLayout(self)
        left = QVBoxLayout()
        outer.addLayout(left, 3)

        self.warn = QLabel(t('mus.pickplace'))
        self.warn.setStyleSheet('background:#fef3c7;color:#92400e;padding:8px;border-radius:6px')
        self.warn.setWordWrap(True)
        left.addWidget(self.warn)

        hero = QFrame()
        hero.setProperty('card', True)
        hl = QHBoxLayout(hero)
        col = QVBoxLayout()
        self.place_l = label('', 'title')
        self.date_l = label('', 'dim')
        self.next_l = QLabel()
        self.next_l.setStyleSheet('font-size:15px')
        self.cd_l = QLabel()
        self.cd_l.setStyleSheet('font-size:34px;font-weight:700;color:#2563eb')
        for w in (self.place_l, self.date_l, self.next_l, self.cd_l):
            col.addWidget(w)
        hl.addLayout(col, 1)
        qcol = QVBoxLayout()
        self.dial = Dial()
        self.q_l = label('', 'dim')
        qcol.addWidget(self.dial, 0, Qt.AlignHCenter)
        qcol.addWidget(self.q_l)
        hl.addLayout(qcol)
        left.addWidget(hero)

        seg = QHBoxLayout()
        self.day_b = button(t('mus.day'), lambda: self.set_monthly(False))
        self.mon_b = button(t('mus.month'), lambda: self.set_monthly(True), 'ghost')
        seg.addWidget(label(t('mus.today'), 'title'))
        seg.addStretch()
        seg.addWidget(self.day_b)
        seg.addWidget(self.mon_b)
        left.addLayout(seg)
        self.monthly = False
        self.table = QTableWidget(6, 3)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        left.addWidget(self.table, 1)
        self.polar = label(t('mus.polar'), 'dim')
        left.addWidget(self.polar)

        # ---- settings (right)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        form_w = QWidget()
        g = QGridLayout(form_w)
        scroll.setWidget(form_w)
        outer.addWidget(scroll, 2)
        r = 0

        def row(text, w):
            nonlocal r
            g.addWidget(QLabel(text), r, 0)
            g.addWidget(w, r, 1)
            r += 1
        g.addWidget(label(t('mus.place'), 'title'), r, 0, 1, 2)
        r += 1
        self.country = QComboBox()
        self.city = QComboBox()
        self.lat = QDoubleSpinBox()
        self.lng = QDoubleSpinBox()
        for sp, lim in ((self.lat, 90), (self.lng, 180)):
            sp.setRange(-lim, lim)
            sp.setDecimals(4)
        self.tz = QComboBox()
        self.method = QComboBox()
        self.asr = QComboBox()
        self.hl = QComboBox()
        self.hj = QComboBox()
        self.clock = QComboBox()
        self.country.addItem(t('mus.custom'), '')
        for cc in sorted(CITIES, key=country_name):
            self.country.addItem(country_name(cc), cc)
        self.tz.addItems(sorted(available_timezones()))
        for m in prayer.METHODS:
            self.method.addItem(m['name'], m['id'])
        self.asr.addItem(t('mus.asr.std'), False)
        self.asr.addItem(t('mus.asr.hanafi'), True)
        for k in ('angle', 'seventh', 'middle'):
            self.hl.addItem(t('mus.hl.' + k), k)
        for n in (-2, -1, 0, 1, 2):
            self.hj.addItem(('+%d' % n) if n > 0 else str(n), n)
        self.clock.addItem('12 h', False)
        self.clock.addItem('24 h', True)
        row(t('mus.country'), self.country)
        row(t('mus.city'), self.city)
        row(t('mus.lat'), self.lat)
        row(t('mus.lng'), self.lng)
        row(t('mus.tz'), self.tz)
        row(t('mus.method'), self.method)
        row(t('mus.asr.label'), self.asr)
        row(t('mus.highlat'), self.hl)
        row(t('mus.hijriadj'), self.hj)
        row(t('mus.clock'), self.clock)
        g.addWidget(label(t('mus.adjhelp'), 'dim'), r, 0, 1, 2)
        r += 1
        self.adj = {}
        self.rem_on = {}
        self.rem_min = {}
        for p in PRAYERS:
            sp = QSpinBox()
            sp.setRange(-60, 60)
            self.adj[p] = sp
            row(pname(p), sp)
        g.addWidget(label(t('mus.reminders'), 'title'), r, 0, 1, 2)
        r += 1
        for p in PRAYERS:
            h = QHBoxLayout()
            cb = QCheckBox(pname(p))
            sp = QSpinBox()
            sp.setRange(0, 120)
            sp.setSuffix(' ' + t('mus.minbefore', n='').strip())
            h.addWidget(cb)
            h.addWidget(sp)
            self.rem_on[p], self.rem_min[p] = cb, sp
            g.addLayout(h, r, 0, 1, 2)
            r += 1
        self.sound = QComboBox()
        self.sound.addItem(t('mus.sound.chime'), 'chime')
        self.sound.addItem(t('mus.sound.none'), 'none')
        row(t('mus.sound'), self.sound)
        g.addWidget(button(t('mus.testremind'), lambda: self.fire('fajr', 10)), r, 0, 1, 2)
        r += 1
        g.setRowStretch(r, 1)
        self.fired = set()
        self.toasts = []
        self.loading = True
        self.load_form()
        self.loading = False
        for w in (self.country, self.city, self.tz, self.method, self.asr, self.hl, self.hj, self.clock, self.sound):
            w.currentIndexChanged.connect(self.on_change)
        for w in (self.lat, self.lng, *self.adj.values(), *self.rem_min.values()):
            w.valueChanged.connect(self.on_change)
        for w in self.rem_on.values():
            w.toggled.connect(self.on_change)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.tick)
        self.timer.start(1000)
        self.refresh()

    def set_monthly(self, m):
        self.monthly = m
        self.day_b.setProperty('kind', 'ghost' if m else None)
        self.mon_b.setProperty('kind', None if m else 'ghost')
        for b in (self.day_b, self.mon_b):
            b.style().unpolish(b)
            b.style().polish(b)
        self.refresh()

    def load_form(self):
        s = store.s
        self.country.setCurrentIndex(max(0, self.country.findData(s['cc'])))
        self.fill_cities()
        self.city.setCurrentIndex(max(0, self.city.findText(s['city'])))
        self.lat.setValue(s['lat'])
        self.lng.setValue(s['lng'])
        self.tz.setCurrentText(s['tz'])
        self.method.setCurrentIndex(max(0, self.method.findData(s['method'])))
        self.asr.setCurrentIndex(1 if s['hanafi'] else 0)
        self.hl.setCurrentIndex(max(0, self.hl.findData(s['highLat'])))
        self.hj.setCurrentIndex(max(0, self.hj.findData(s['hijriAdjust'])))
        self.clock.setCurrentIndex(1 if s['time24'] else 0)
        for p in PRAYERS:
            self.adj[p].setValue(int(s['adjust'].get(p) or 0))
            self.rem_on[p].setChecked(s['remind'][p]['on'])
            self.rem_min[p].setValue(s['remind'][p]['before'])
        self.sound.setCurrentIndex(max(0, self.sound.findData(s['sound'])))
        self.warn.setVisible(not s['placeSet'])

    def fill_cities(self):
        self.city.blockSignals(True)
        self.city.clear()
        for c in CITIES.get(self.country.currentData() or '', []):
            self.city.addItem(c[0])
        self.city.setEnabled(bool(self.country.currentData()))
        self.city.blockSignals(False)

    def on_change(self, *_):
        if self.loading:
            return
        sender = self.sender()
        s = {}
        if sender is self.country:
            cc = self.country.currentData() or ''
            self.fill_cities()
            if cc:
                c = CITIES[cc][0]
                s.update(cc=cc, city=c[0], lat=c[1], lng=c[2], tz=c[3], placeSet=True, method=prayer.default_method(cc), hanafi=prayer.default_hanafi(cc))
            else:
                s.update(cc='', city='')
            self.apply_and_reload(s)
            return
        if sender is self.city:
            c = next((x for x in CITIES.get(store.s['cc'], []) if x[0] == self.city.currentText()), None)
            if c:
                s.update(city=c[0], lat=c[1], lng=c[2], tz=c[3], placeSet=True)
                self.apply_and_reload(s)
                return
        s.update(lat=self.lat.value(), lng=self.lng.value(), tz=self.tz.currentText(), method=self.method.currentData(), hanafi=bool(self.asr.currentData()),
                 highLat=self.hl.currentData(), hijriAdjust=self.hj.currentData(), time24=bool(self.clock.currentData()), sound=self.sound.currentData(),
                 adjust={p: self.adj[p].value() for p in PRAYERS}, remind={p: {'on': self.rem_on[p].isChecked(), 'before': self.rem_min[p].value()} for p in PRAYERS})
        if sender in (self.lat, self.lng):
            s['placeSet'] = True
            s['cc'] = ''
            s['city'] = ''
        self.apply_and_reload(s)

    def apply_and_reload(self, s):
        store.save(**s)
        self.loading = True
        self.load_form()
        self.loading = False
        self.refresh()

    def today(self):
        s = store.s
        y, m, d = prayer.civil_date(now_ms(), s['tz'])
        return prayer.prayer_day(y, m, d, store.place(), s['tz'], store.opts())

    def refresh(self):
        s = store.s
        td = self.today()
        nxt, at = prayer.next_prayer(now_ms(), store.place(), s['tz'], store.opts())
        self.place_l.setText((s['city'] or t('mus.custom')) + (f" · {country_name(s['cc'])}" if s['cc'] else ''))
        d = datetime.fromtimestamp(now_ms() / 1000, ZoneInfo(s['tz']))
        self.date_l.setText(f"{d.strftime('%A %d %B %Y')} · {hijri_text(td)}")
        self.next_l.setText(f"{t('mus.next')}  <b>{pname(nxt)}</b>  {fmt_time(at)}")
        self.nxt_at = at
        b, km = prayer.qibla(s['lat'], s['lng'])
        self.dial.set_bearing(b)
        self.q_l.setText(f"{t('mus.qibla')}: {b:.0f}° · {km:,.0f} km")
        self.warn.setVisible(not s['placeSet'])
        self.polar.setVisible(any(v is None for v in td['at'].values()))
        if not self.monthly:
            self.table.setColumnCount(3)
            self.table.setHorizontalHeaderLabels(['', '', ''])
            self.table.horizontalHeader().setVisible(False)
            self.table.setRowCount(len(PRAYERS))
            for i, p in enumerate(PRAYERS):
                items = [QTableWidgetItem(pname(p)), QTableWidgetItem(fmt_time(td['at'][p])), QTableWidgetItem('🔔' if s['remind'][p]['on'] else '🔕')]
                for j, it in enumerate(items):
                    if p == nxt:
                        f = it.font()
                        f.setBold(True)
                        it.setFont(f)
                        it.setBackground(QColor('#dbeafe'))
                    self.table.setItem(i, j, it)
            self.table.cellClicked.connect(self.bell) if not getattr(self, '_wired', False) else None
            self._wired = True
        else:
            y, m, _ = td['ymd']
            days = (datetime(y + (m == 12), m % 12 + 1, 1) - datetime(y, m, 1)).days
            self.table.horizontalHeader().setVisible(True)
            self.table.setColumnCount(1 + len(PRAYERS))
            self.table.setHorizontalHeaderLabels(['#'] + [pname(p) for p in PRAYERS])
            self.table.setRowCount(days)
            for dd in range(1, days + 1):
                day = prayer.prayer_day(y, m, dd, store.place(), s['tz'], store.opts())
                self.table.setItem(dd - 1, 0, QTableWidgetItem(str(dd)))
                for j, p in enumerate(PRAYERS):
                    it = QTableWidgetItem(fmt_time(day['at'][p]))
                    if dd == td['ymd'][2]:
                        it.setBackground(QColor('#dbeafe'))
                    self.table.setItem(dd - 1, j + 1, it)

    def bell(self, row, col):
        if self.monthly or col != 2 or not (0 <= row < len(PRAYERS)):
            return
        p = PRAYERS[row]
        rem = {k: dict(v) for k, v in store.s['remind'].items()}
        rem[p]['on'] = not rem[p]['on']
        self.apply_and_reload({'remind': rem})

    def tick(self):
        left = max(0, int((getattr(self, 'nxt_at', now_ms()) - now_ms()) / 1000))
        self.cd_l.setText('%02d:%02d:%02d' % (left // 3600, left % 3600 // 60, left % 60))
        if left == 0:
            self.refresh()
        self.check()

    def check(self):
        s = store.s
        td = self.today()
        now = now_ms()
        for p in PRAYERS:
            r = s['remind'][p]
            at = td['at'][p]
            if not r['on'] or not at:
                continue
            target = at - r['before'] * 60000
            key = f"{td['ymd']}|{p}|{r['before']}"
            if target <= now < target + 120000 and key not in self.fired:
                self.fired.add(key)
                self.fire(p, r['before'])

    def fire(self, p, before):
        title = t('mus.remind.in', name=pname(p), n=before) if before > 0 else t('mus.remind.now', name=pname(p))
        if store.s['sound'] != 'none':
            for i in range(3):
                QTimer.singleShot(i * 350, QApplication.beep)
        box = QMessageBox(QMessageBox.Information, t('module.muslim'), title, parent=self.window())
        box.setModal(False)
        box.setAttribute(Qt.WA_DeleteOnClose)
        box.show()
        self.toasts.append(box)
        QTimer.singleShot(120000, box.close)


# ------------------------------------------------------------------ Mushaf reader
CACHE = Path(QStandardPaths.writableLocation(QStandardPaths.CacheLocation) or Path.home() / '.cache' / 'workflow-erp') / 'mushaf'


class MushafReader(QWidget):
    def __init__(self):
        super().__init__()
        self.setLayoutDirection(Qt.LeftToRight)  # physical layout: the next page is to the left, like an Arabic book
        v = QVBoxLayout(self)
        bar = QHBoxLayout()
        self.next_b = QPushButton('❮')
        self.prev_b = QPushButton('❯')
        self.next_b.setToolTip(t('mus.q.next'))
        self.prev_b.setToolTip(t('mus.q.prev'))
        self.page_sp = QSpinBox()
        self.page_sp.setRange(1, PAGES)
        self.where = QLabel()
        self.where.setStyleSheet('font-size:18px')
        self.juz = QComboBox()
        for j in range(1, 31):
            self.juz.addItem(f"{t('mus.q.juz')} {j}", j)
        self.minus = QPushButton('−')
        self.zoom_l = QLabel('100%')
        self.plus = QPushButton('+')
        self.fit = QPushButton('⤢')
        self.two = QPushButton('▯▯')
        self.mode = QPushButton('Aa')
        self.night = QPushButton('☾')
        self.theme = QPushButton('🎨')
        self.star = QPushButton('★')
        self.marks = QComboBox()
        self.full = QPushButton('⛶')
        for b in (self.two, self.mode, self.night, self.star):
            b.setCheckable(True)
        for w in (self.next_b, QLabel(t('mus.q.page')), self.page_sp, QLabel(f'/ {PAGES}'), self.prev_b, self.where, self.juz):
            bar.addWidget(w)
        bar.addStretch()
        for w in (self.minus, self.zoom_l, self.plus, self.fit, self.two, self.mode, self.theme, self.night, self.star, self.marks, self.full):
            bar.addWidget(w)
        v.addLayout(bar)
        self.area = QScrollArea()
        self.area.setWidgetResizable(True)
        self.canvas = QWidget()
        self.canvas.setLayoutDirection(Qt.LeftToRight)
        self.box = QHBoxLayout(self.canvas)
        self.box.setAlignment(Qt.AlignHCenter | Qt.AlignTop)
        self.area.setWidget(self.canvas)
        v.addWidget(self.area, 1)
        src = QHBoxLayout()
        src.addWidget(QLabel(t('mus.q.source')))
        self.base = QLineEdit(store.s['mbase'])
        self.base.setPlaceholderText(MF['base'])
        src.addWidget(self.base, 1)
        src.addWidget(button(t('mus.q.apply'), self.apply_base))
        v.addLayout(src)
        self.pix = {}
        self.failed = {}
        self.want = []
        self.setFocusPolicy(Qt.StrongFocus)
        QShortcut(QKeySequence(Qt.Key_Left), self, activated=lambda: self.go(self.page() + self.step()), context=Qt.WidgetWithChildrenShortcut)
        QShortcut(QKeySequence(Qt.Key_Right), self, activated=lambda: self.go(self.page() - self.step()), context=Qt.WidgetWithChildrenShortcut)
        self.next_b.clicked.connect(lambda: self.go(self.page() + self.step()))
        self.prev_b.clicked.connect(lambda: self.go(self.page() - self.step()))
        self.page_sp.editingFinished.connect(lambda: self.go(self.page_sp.value()))
        self.juz.activated.connect(lambda i: self.go(JUZ_START[i]))
        self.minus.clicked.connect(lambda: self.zoom(-10))
        self.plus.clicked.connect(lambda: self.zoom(10))
        self.fit.clicked.connect(lambda: self.set(mzoom=100))
        self.two.clicked.connect(lambda c: self.set(mtwo=c))
        self.mode.clicked.connect(lambda c: self.set(mmode='text' if c else 'img'))
        self.night.clicked.connect(lambda c: self.set(mnight=c))
        self.theme.clicked.connect(lambda: self.set(mtheme='blue' if store.s['mtheme'] == 'rose' else 'rose'))
        self.star.clicked.connect(self.toggle_mark)
        self.marks.activated.connect(lambda i: self.go(self.marks.itemData(i)) if self.marks.itemData(i) else None)
        self.full.clicked.connect(lambda: self.window().showNormal() if self.window().isFullScreen() else self.window().showFullScreen())
        self.area.viewport().installEventFilter(self)
        self.render()

    # state
    def page(self):
        return clamp_page(store.s['mpage'])

    def is_two(self):
        return bool(store.s['mtwo']) and self.area.viewport().width() >= 760

    def step(self):
        return 2 if self.is_two() else 1

    def set(self, **kw):
        store.save(**kw)
        self.render()

    def go(self, p):
        self.failed.clear()
        store.save(mpage=clamp_page(p))
        self.render()
        self.area.verticalScrollBar().setValue(0)

    def zoom(self, d):
        self.set(mzoom=min(220, max(50, store.s['mzoom'] + d)))

    def apply_base(self):
        store.save(mbase=self.base.text().strip())
        self.pix.clear()
        self.failed.clear()
        self.render()

    def eventFilter(self, o, e):
        if o is self.area.viewport() and e.type() == e.Type.Resize:
            QTimer.singleShot(0, self.layout_pages)
        return super().eventFilter(o, e)

    # pages
    def shown(self):
        p = self.page()
        if not self.is_two():
            return [p]
        o = p if p % 2 else p - 1
        return [x for x in (o, o + 1) if 1 <= x <= PAGES]

    def width_px(self):
        avail = max(240, self.area.viewport().width() - 40)
        base = min(560, (avail - 6) / 2) if self.is_two() else min(640, avail)
        return int(base * store.s['mzoom'] / 100)

    def url(self, p):
        return (store.s['mbase'] or MF['base']).rstrip('/\\') + '/' + '%03d.png' % p

    def fetch(self, p):
        base = store.s['mbase'] or MF['base']
        name = '%03d.png' % p
        if base.lower().startswith(('http://', 'https://')):
            f = CACHE / (str(abs(hash(base)) % 10 ** 8)) / name
            if f.exists():
                return f.read_bytes()
            req = urllib.request.Request(base.rstrip('/') + '/' + name, headers={'User-Agent': 'WorkflowErp-Desktop'})
            data = urllib.request.urlopen(req, timeout=25).read()
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(data)
            return data
        return (Path(base) / name).read_bytes()

    def render(self):
        s = store.s
        p = self.page()
        self.page_sp.blockSignals(True)
        self.page_sp.setValue(p)
        self.page_sp.blockSignals(False)
        self.where.setText('سورة ' + SURAH_AR[surah_of_page(p) - 1] + f" · {t('mus.q.juz')} {juz_of_page(p)}")
        self.juz.blockSignals(True)
        self.juz.setCurrentIndex(juz_of_page(p) - 1)
        self.juz.blockSignals(False)
        self.zoom_l.setText(f"{s['mzoom']}%")
        self.two.setChecked(bool(s['mtwo']))
        self.night.setChecked(bool(s['mnight']))
        self.mode.setChecked(s['mmode'] == 'text')
        self.theme.setVisible(s['mmode'] == 'text')
        self.theme.setToolTip(t('mus.q.theme'))
        self.mode.setToolTip(t('mus.q.imgmode') if s['mmode'] == 'text' else t('mus.q.textmode'))
        self.star.setChecked(p in s['pmarks'])
        self.marks.blockSignals(True)
        self.marks.clear()
        self.marks.addItem(f"★ {len(s['pmarks'])}", 0)
        for m in sorted(s['pmarks']):
            self.marks.addItem(f"{t('mus.q.page')} {m} · {SURAH_AR[surah_of_page(m) - 1]}", m)
        self.marks.setVisible(bool(s['pmarks']))
        self.marks.blockSignals(False)
        self.next_b.setEnabled(p + self.step() <= PAGES)
        self.prev_b.setEnabled(p - self.step() >= 1)
        self.area.setStyleSheet('background:#0d0d0d' if s['mnight'] else 'background:#e5e9f0')
        self.want = self.shown()
        for q in self.want:
            if q not in self.pix and q not in self.failed:
                self.load(q)
        for q in (p + 1, p + 2, p - 1):  # preload neighbours
            if 1 <= q <= PAGES and q not in self.pix and q not in self.failed:
                self.load(q, quiet=True)
        self.layout_pages()

    def load(self, p, quiet=False):
        def ok(data):
            pm = QPixmap()
            if pm.loadFromData(data):
                self.pix[p] = pm
                if len(self.pix) > 12:
                    for k in list(self.pix)[:4]:
                        if k not in self.want:
                            self.pix.pop(k, None)
                if p in self.want:
                    self.layout_pages()
            elif not quiet:
                self.fail(p)

        def bad(_m):
            if not quiet:
                self.fail(p)
        self.pix.setdefault(p, None) if False else None
        run_async(lambda: self.fetch(p), ok, bad)

    def fail(self, p):
        self.failed[p] = True
        self.layout_pages()

    def layout_pages(self):
        while self.box.count():
            it = self.box.takeAt(0)
            if it.widget():
                it.widget().deleteLater()
        w = self.width_px()
        h = int(w * 4206 / 2600)
        night = store.s['mnight']
        for p in sorted(self.shown(), reverse=True):  # left to right: the even (later) page, then the odd page on the right
            if store.s['mmode'] == 'text':
                mp = MushafTextPage(p, w, night, store.s['mtheme'])
                mp.on_word = lambda pg, li, ti, wd: WordDialog(self, pg, li, ti, wd).exec()
                self.box.addWidget(mp)
                continue
            lab = QLabel()
            lab.setAlignment(Qt.AlignCenter)
            lab.setFixedSize(w, h)
            lab.setStyleSheet('background:%s' % ('#000' if night else '#fff'))
            if p in self.pix and self.pix[p]:
                img = self.pix[p].toImage().scaledToWidth(w, Qt.SmoothTransformation)
                if night:
                    img.invertPixels()
                lab.setPixmap(QPixmap.fromImage(img))
            elif p in self.failed:
                lab.setWordWrap(True)
                lab.setText(t('mus.q.imgerr'))
                lab.setStyleSheet('background:#fff;color:#444;padding:20px')
            else:
                lab.setText(t('mus.loading'))
            self.box.addWidget(lab)

    def toggle_mark(self):
        p = self.page()
        m = list(store.s['pmarks'])
        m.remove(p) if p in m else m.append(p)
        store.save(pmarks=sorted(m))
        self.render()

    def go_surah(self, n):
        self.go(SURAH_START[n - 1])


class QuranTab(QWidget):
    def __init__(self):
        super().__init__()
        h = QHBoxLayout(self)
        self.list = QListWidget()
        self.list.setFixedWidth(230)
        for i, n in enumerate(SURAH_AR, 1):
            self.list.addItem(f'{i}   {n}')
        h.addWidget(self.list)
        self.reader = MushafReader()
        h.addWidget(self.reader, 1)
        self.list.currentRowChanged.connect(lambda r: self.reader.go_surah(r + 1) if r >= 0 else None)
        self.reader.page_sp.valueChanged.connect(lambda *_: self.sync())
        self.sync()

    def sync(self):
        self.list.blockSignals(True)
        self.list.setCurrentRow(surah_of_page(self.reader.page()) - 1)
        self.list.blockSignals(False)

    def showEvent(self, e):
        self.sync()
        QTimer.singleShot(0, self.reader.render)
        super().showEvent(e)


class MuslimPage(Page):
    def __init__(self):
        super().__init__()
        self.title(t('module.muslim'))
        self.tabs = QTabWidget()
        self.times = PrayerTab()
        self.quran = QuranTab()
        self.tabs.addTab(self.times, t('mus.tab.times'))
        self.tabs.addTab(self.quran, t('mus.tab.quran'))
        self.lay.addWidget(self.tabs, 1)

    def reload(self):
        self.times.refresh()
