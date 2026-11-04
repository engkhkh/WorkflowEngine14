"""Calendar and meetings: agenda (day / week / month), events, meetings with a join link, RSVP, availability check, to-dos and settings
(port of the portal's /calendar pages; the server keeps UTC, the screen shows the computer's own time zone)."""
from datetime import date, datetime, timedelta, timezone

from PySide6.QtCore import QUrl, Qt
from PySide6.QtGui import QDesktopServices, QGuiApplication
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFileDialog, QFormLayout, QHBoxLayout, QLineEdit, QListWidget, QListWidgetItem,
                               QPlainTextEdit, QTabWidget, QVBoxLayout, QWidget)

from app.api import ApiError, api
from app.i18n import t
from app.ui import ask, button, current_payload, fill_table, label, make_table, run_async, warn

FMT = '%Y-%m-%d %H:%M'


# ---------------------------------------------------------------- time helpers
def to_local(iso):
    """'2026-11-03T09:00:00Z' -> aware local datetime"""
    return datetime.strptime(iso[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc).astimezone()


def to_utc_iso(dt):
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_local(s):
    """'2026-11-03 14:30' (local time) -> UTC ISO, or None when empty; ValueError when malformed"""
    s = (s or '').strip()
    if not s:
        return None
    return to_utc_iso(datetime.strptime(s, FMT).astimezone())


def fmt_local(iso):
    return to_local(iso).strftime(FMT) if iso else ''


def period(view, anchor):
    """(from, to) as aware local datetimes for day / week (Monday first) / month"""
    if view == 'day':
        a = anchor
        b = a + timedelta(days=1)
    elif view == 'week':
        a = anchor - timedelta(days=anchor.weekday())
        b = a + timedelta(days=7)
    else:
        a = anchor.replace(day=1)
        b = (a.replace(year=a.year + 1, month=1) if a.month == 12 else a.replace(month=a.month + 1))
    mk = lambda d: datetime(d.year, d.month, d.day).astimezone()
    return mk(a), mk(b)


def shift(view, anchor, n):
    if view == 'day':
        return anchor + timedelta(days=n)
    if view == 'week':
        return anchor + timedelta(days=7 * n)
    m = anchor.month - 1 + n
    return anchor.replace(year=anchor.year + m // 12, month=m % 12 + 1, day=1)


def event_payload(v):
    """Form values -> request body (the same shape the portal sends). Raises ValueError with a message key on bad input."""
    kind = v['kind']
    if not v['title'].strip():
        raise ValueError(t('cal.u.needtitle'))
    try:
        start, end = parse_local(v.get('start')), parse_local(v.get('end'))
        until = v.get('until', '').strip()
        until_iso = to_utc_iso(datetime.strptime(until, '%Y-%m-%d').astimezone()) if until else None
    except ValueError:
        raise ValueError(t('cal.u.badtime'))
    if kind != 'todo' and not start:
        raise ValueError(t('cal.u.badtime'))
    if kind != 'todo' and (not end or end <= start):
        end = to_utc_iso(datetime.strptime(start, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc) + timedelta(hours=1))
    guests = [x.strip() for x in v.get('guests', '').replace(';', ',').replace(' ', ',').split(',') if x.strip()]
    rem = v.get('remind', '').strip()
    return {'kind': kind, 'title': v['title'].strip(), 'start': start, 'end': None if kind == 'todo' else end, 'notes': v.get('notes', ''), 'location': v.get('location', ''),
            'attendees': [] if kind == 'todo' else list(v.get('attendees', [])), 'guests': guests, 'repeat': v.get('repeat', 'none'), 'repeatUntil': until_iso,
            'remindMinutes': int(rem) if rem.isdigit() else None, 'priority': v.get('priority', 'normal')}


def kind_name(k):
    return t({'event': 'cal.u.event', 'meeting': 'cal.u.meeting', 'todo': 'cal.u.todo'}.get(k, 'cal.u.event'))


def my_name():
    return (api.session.username if api.session else '') or ''


# ---------------------------------------------------------------- event dialog
class EventDialog(QDialog):
    def __init__(self, parent, item, people, kind='event'):
        super().__init__(parent)
        self.item, self.people = item, people
        self.setWindowTitle(t('cal.u.edit') if item else t('cal.u.new'))
        self.setMinimumWidth(520)
        d = (item or {}).get('data', {})
        lay = QVBoxLayout(self)
        form = QFormLayout()
        self.kind = QComboBox()
        for k in ('event', 'meeting', 'todo'):
            self.kind.addItem(kind_name(k), k)
        self.kind.setCurrentIndex(max(0, self.kind.findData((item or {}).get('kind', kind))))
        self.title = QLineEdit((item or {}).get('title', ''))
        now = datetime.now().replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        self.start = QLineEdit(fmt_local(item['start']) if item and item.get('start') else now.strftime(FMT))
        self.end = QLineEdit(fmt_local(item['end']) if item and item.get('end') else (now + timedelta(hours=1)).strftime(FMT))
        self.location = QLineEdit(d.get('location', ''))
        self.notes = QPlainTextEdit(d.get('notes', ''))
        self.notes.setFixedHeight(60)
        self.repeat = QComboBox()
        for k, key in (('none', 'cal.u.none'), ('daily', 'cal.u.daily'), ('weekly', 'cal.u.weekly'), ('monthly', 'cal.u.monthly')):
            self.repeat.addItem(t(key), k)
        self.repeat.setCurrentIndex(max(0, self.repeat.findData(d.get('repeat') or 'none')))
        self.until = QLineEdit((d.get('repeatUntil') or '')[:10])
        self.remind = QLineEdit('' if d.get('remind') is None else str(d.get('remind', 10)) if item else '10')
        self.prio = QComboBox()
        for k in ('low', 'normal', 'high'):
            self.prio.addItem(k, k)
        self.prio.setCurrentIndex(max(0, self.prio.findData(d.get('priority') or 'normal')))
        self.guests = QLineEdit(', '.join(d.get('guests', [])))
        self.att = QListWidget()
        self.att.setMaximumHeight(110)
        for p in people:
            if p['username'].lower() == my_name().lower():
                continue
            it = QListWidgetItem(f"{p['displayName']} ({p['username']})")
            it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
            it.setCheckState(Qt.Checked if p['username'] in d.get('attendees', []) else Qt.Unchecked)
            it.setData(Qt.UserRole, p['username'])
            self.att.addItem(it)
        for k, w in (('cal.u.type', self.kind), ('cal.u.title', self.title), ('cal.u.start', self.start), ('cal.u.end', self.end), ('cal.u.location', self.location), ('cal.u.notes', self.notes),
                     ('cal.u.repeat', self.repeat), ('cal.u.until', self.until), ('cal.u.remind', self.remind), ('cal.u.priority', self.prio), ('cal.u.attendees', self.att), ('cal.u.guests', self.guests)):
            form.addRow(t(k), w)
        lay.addLayout(form)
        self.avail = label('', 'dim')
        lay.addWidget(button(t('cal.u.avail'), self.check, 'ghost'))
        lay.addWidget(self.avail)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        bb = QDialogButtonBox()
        bb.addButton(t('cal.u.save'), QDialogButtonBox.AcceptRole)
        bb.addButton(t('common.cancel'), QDialogButtonBox.RejectRole)
        bb.accepted.connect(self.go)
        bb.rejected.connect(self.reject)
        lay.addWidget(bb)
        owner = (item or {}).get('owner', my_name())
        if item and owner.lower() != my_name().lower() and not api.can('cal.settings'):
            for w in (self.kind, self.title, self.start, self.end, self.location, self.notes, self.repeat, self.until, self.remind, self.prio, self.att, self.guests):
                w.setEnabled(False)
            bb.buttons()[0].setEnabled(False)

    def attendees(self):
        return [self.att.item(i).data(Qt.UserRole) for i in range(self.att.count()) if self.att.item(i).checkState() == Qt.Checked]

    def values(self):
        return {'kind': self.kind.currentData(), 'title': self.title.text(), 'start': self.start.text(), 'end': self.end.text(), 'location': self.location.text(), 'notes': self.notes.toPlainText(),
                'repeat': self.repeat.currentData(), 'until': self.until.text(), 'remind': self.remind.text(), 'priority': self.prio.currentData(), 'attendees': self.attendees(), 'guests': self.guests.text()}

    def check(self):
        """free / busy of everyone invited around the chosen time (only blocks are shown, never titles)"""
        try:
            s, e = parse_local(self.start.text()), parse_local(self.end.text())
        except ValueError:
            self.avail.setText(t('cal.u.badtime'))
            return
        users = [my_name()] + self.attendees()
        a = to_utc_iso(to_local(s) - timedelta(hours=12)) if s else None
        b = to_utc_iso(to_local(e or s) + timedelta(hours=12)) if s else None

        def show(res):
            lines = []
            for u in users:
                clash = [x for x in res.get(u, []) if e and x['s'] < e and x['e'] > s]
                lines.append(f"{u}: " + (t('cal.u.busy') + ' ' + ', '.join(fmt_local(x['s'])[11:] + '-' + fmt_local(x['e'])[11:] for x in clash) if clash else t('cal.u.free')))
            self.avail.setText('\n'.join(lines))
        run_async(lambda: api.cal('POST', 'freebusy', {'users': users, 'from': a, 'to': b}), show, lambda m: self.avail.setText(m))

    def go(self):
        try:
            self.body = event_payload(self.values())
        except ValueError as e:
            self.err.setText(str(e))
            return
        self.accept()


# ---------------------------------------------------------------- agenda
class AgendaView(QWidget):
    def __init__(self):
        super().__init__()
        self.view, self.anchor, self.people, self.items = 'week', date.today(), [], []
        lay = QVBoxLayout(self)
        bar = QHBoxLayout()
        bar.addWidget(button('‹', lambda: self.move(-1), 'ghost'))
        bar.addWidget(button(t('cal.u.today'), self.today, 'ghost'))
        bar.addWidget(button('›', lambda: self.move(1), 'ghost'))
        self.vsel = QComboBox()
        for k in ('day', 'week', 'month'):
            self.vsel.addItem(t('cal.u.' + k), k)
        self.vsel.setCurrentIndex(1)
        self.vsel.currentIndexChanged.connect(self.set_view)
        bar.addWidget(self.vsel)
        self.rng = label('', 'dim')
        bar.addWidget(self.rng, 1)
        bar.addWidget(button(t('cal.u.new'), lambda: self.edit(None), 'primary'))
        bar.addWidget(button(t('cal.u.instant'), self.instant, 'ghost'))
        lay.addLayout(bar)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        self.table = make_table([t('cal.u.when'), t('cal.u.title'), t('cal.u.type'), t('cal.u.where'), t('cal.u.rsvp')])
        self.table.itemSelectionChanged.connect(self.sel)
        self.table.doubleClicked.connect(lambda *_: self.edit(current_payload(self.table)))
        lay.addWidget(self.table, 1)
        row = QHBoxLayout()
        self.btn = {}
        for key, fn in (('edit', lambda: self.edit(current_payload(self.table))), ('join', self.join), ('link', self.link), ('ics', self.ics),
                        ('accept', lambda: self.rsvp('accepted')), ('maybe', lambda: self.rsvp('maybe')), ('decline', lambda: self.rsvp('declined')), ('delete', self.delete)):
            self.btn[key] = button(t('cal.u.' + key), fn, 'ghost')
            row.addWidget(self.btn[key])
        row.addStretch(1)
        lay.addLayout(row)
        self.sel()

    def reload(self):
        a, b = period(self.view, self.anchor)
        self.rng.setText(f"{a.strftime('%Y-%m-%d')} → {(b - timedelta(days=1)).strftime('%Y-%m-%d')}")
        self.err.setText('')

        def work():
            ev = api.cal('GET', f'events?from={to_utc_iso(a)}&to={to_utc_iso(b)}') or []
            ppl = api.cal('GET', 'people') or []
            return ev, ppl

        def ok(r):
            self.items, self.people = r
            self.paint()
        run_async(work, ok, lambda m: self.err.setText(m))

    def paint(self):
        me = my_name()
        rows = []
        for e in self.items:
            r = (e.get('data', {}).get('rsvp') or {}).get(me, '')
            rows.append([fmt_local(e['start']) + (' → ' + fmt_local(e['end'])[11:] if e.get('end') else ''), e['title'] + (' ↻' if e.get('occurrence') else ''), kind_name(e['kind']), e.get('data', {}).get('location', ''), r])
        fill_table(self.table, rows, self.items)
        self.sel()

    def sel(self):
        e = current_payload(self.table)
        has = e is not None
        mine = has and (e['owner'].lower() == my_name().lower() or api.can('cal.settings'))
        invited = has and my_name() in e.get('data', {}).get('attendees', [])
        for k in ('edit', 'ics'):
            self.btn[k].setEnabled(has)
        self.btn['join'].setEnabled(has and e['kind'] == 'meeting')
        self.btn['link'].setEnabled(has and e['kind'] == 'meeting')
        for k in ('accept', 'maybe', 'decline'):
            self.btn[k].setEnabled(bool(invited))
        self.btn['delete'].setEnabled(bool(mine))

    def move(self, n):
        self.anchor = shift(self.view, self.anchor, n)
        self.reload()

    def today(self):
        self.anchor = date.today()
        self.reload()

    def set_view(self):
        self.view = self.vsel.currentData()
        self.reload()

    # ---- actions
    def edit(self, item):
        dlg = EventDialog(self, item, self.people)
        if not dlg.exec():
            return
        body = dlg.body
        run_async(lambda: api.cal('PUT', f"events/{item['id']}", body) if item else api.cal('POST', 'events', body), lambda _r: self.reload(), lambda m: self.err.setText(m))

    def join_info(self, cb):
        e = current_payload(self.table)
        run_async(lambda: api.cal('POST', f"events/{e['id']}/join", {}), cb, lambda m: self.err.setText(m))

    def join(self):
        def go(r):
            QDesktopServices.openUrl(QUrl(r['url']))
            self.err.setText(t('cal.u.opened'))
        self.join_info(go)

    def link(self):
        def go(r):
            QGuiApplication.clipboard().setText(r['url'])
            self.err.setText(t('cal.u.copied') + ': ' + r['url'])
        self.join_info(go)

    def ics(self):
        e = current_payload(self.table)
        path, _ = QFileDialog.getSaveFileName(self, t('cal.u.ics'), (e['title'] or 'event') + '.ics', 'iCalendar (*.ics)')
        if path:
            run_async(lambda: api.raw(f"/calendar/events/{e['id']}/ics"), lambda b: open(path, 'wb').write(b), lambda m: self.err.setText(m))

    def rsvp(self, resp):
        e = current_payload(self.table)
        run_async(lambda: api.cal('POST', f"events/{e['id']}/rsvp", {'response': resp}), lambda _r: self.reload(), lambda m: self.err.setText(m))

    def delete(self):
        e = current_payload(self.table)
        if e and ask(self, t('cal.u.confirmdel'), t('common.yes'), t('common.no')):
            run_async(lambda: api.cal('DELETE', f"events/{e['id']}"), lambda _r: self.reload(), lambda m: self.err.setText(m))

    def instant(self):
        def go(r):
            QDesktopServices.openUrl(QUrl(r['url']))
            self.reload()
        run_async(lambda: api.cal('POST', 'meetings/instant', {'title': t('cal.u.instant'), 'attendees': []}), go, lambda m: self.err.setText(m))


# ---------------------------------------------------------------- to-dos
class TodosView(QWidget):
    def __init__(self):
        super().__init__()
        self.items = []
        lay = QVBoxLayout(self)
        bar = QHBoxLayout()
        self.title = QLineEdit()
        self.title.setPlaceholderText(t('cal.u.title'))
        self.due = QLineEdit()
        self.due.setPlaceholderText(t('cal.u.due'))
        self.prio = QComboBox()
        for k in ('low', 'normal', 'high'):
            self.prio.addItem(k, k)
        self.prio.setCurrentIndex(1)
        for w in (self.title, self.due, self.prio):
            bar.addWidget(w)
        bar.addWidget(button(t('cal.u.add'), self.add, 'primary'))
        lay.addLayout(bar)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        self.table = make_table([t('cal.u.title'), t('cal.u.due'), t('cal.u.priority'), t('cal.u.done')])
        lay.addWidget(self.table, 1)
        row = QHBoxLayout()
        row.addWidget(button(t('cal.u.toggle'), self.toggle, 'ghost'))
        row.addWidget(button(t('cal.u.delete'), self.delete, 'ghost'))
        row.addStretch(1)
        lay.addLayout(row)

    def reload(self):
        run_async(lambda: api.cal('GET', 'todos') or [], self.paint, lambda m: self.err.setText(m))

    def paint(self, items):
        self.items = items
        fill_table(self.table, [[x['title'], fmt_local(x['start']) if x.get('start') else '', x.get('data', {}).get('priority', ''), '✓' if x.get('status') == 'Done' else ''] for x in items], items)

    def add(self):
        try:
            body = event_payload({'kind': 'todo', 'title': self.title.text(), 'start': self.due.text(), 'priority': self.prio.currentData(), 'remind': ''})
        except ValueError as e:
            self.err.setText(str(e))
            return
        self.title.clear()
        self.due.clear()
        run_async(lambda: api.cal('POST', 'events', body), lambda _r: self.reload(), lambda m: self.err.setText(m))

    def toggle(self):
        x = current_payload(self.table)
        if x:
            run_async(lambda: api.cal('POST', f"events/{x['id']}/done", {}), lambda _r: self.reload(), lambda m: self.err.setText(m))

    def delete(self):
        x = current_payload(self.table)
        if x:
            run_async(lambda: api.cal('DELETE', f"events/{x['id']}"), lambda _r: self.reload(), lambda m: self.err.setText(m))


# ---------------------------------------------------------------- settings
class CalSettingsView(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        form = QFormLayout()
        self.jitsi, self.ws, self.we = QLineEdit(), QLineEdit(), QLineEdit()
        form.addRow(t('cal.u.jitsi'), self.jitsi)
        form.addRow(t('cal.u.ws'), self.ws)
        form.addRow(t('cal.u.we'), self.we)
        lay.addLayout(form)
        self.msg = label('', 'dim')
        lay.addWidget(button(t('cal.u.save'), self.save, 'primary'))
        lay.addWidget(self.msg)
        lay.addStretch(1)

    def reload(self):
        def ok(s):
            self.jitsi.setText(s.get('jitsiDomain', ''))
            self.ws.setText(s.get('workStart', ''))
            self.we.setText(s.get('workEnd', ''))
        run_async(lambda: api.cal('GET', 'settings'), ok, lambda m: self.msg.setText(m))

    def save(self):
        body = {'jitsiDomain': self.jitsi.text().strip(), 'workStart': self.ws.text().strip(), 'workEnd': self.we.text().strip()}
        run_async(lambda: api.cal('PUT', 'settings', body), lambda _r: self.msg.setText(t('cal.u.saved')), lambda m: self.msg.setText(m))


class CalendarPage(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        lay.addWidget(label(t('tab.cal'), 'title'))
        self.tabs = QTabWidget()
        self.agenda, self.todos = AgendaView(), TodosView()
        self.views = [self.agenda, self.todos]
        self.tabs.addTab(self.agenda, t('cal.u.agenda'))
        self.tabs.addTab(self.todos, t('cal.u.todos'))
        if api.can('cal.settings'):
            self.settings = CalSettingsView()
            self.views.append(self.settings)
            self.tabs.addTab(self.settings, t('cal.u.settings'))
        self.tabs.currentChanged.connect(lambda i: self.views[i].reload())
        lay.addWidget(self.tabs, 1)

    def reload(self):
        self.views[self.tabs.currentIndex()].reload()
