"""Administration: workspace plan and usage, the first-run setup wizard, invitations, billing and the module switches. The same data and rules
as the portal's Administration and Setup screens; the server decides what is allowed."""
import html
import json
import os
import random
import string
import tempfile
import webbrowser
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QDialog, QFormLayout, QGridLayout, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem, QStackedWidget, QTabWidget, QVBoxLayout, QWidget)

from .api import api
from .i18n import t
from .ui import button, current_payload, fill_table, label, make_table, run_async, warn

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'admin.json').read_text(encoding='utf-8'))


def web_origin():
    s = api.session.server.strip().rstrip('/')
    return s[:-4] if s.lower().endswith('/api') else s


def invite_link(token):
    from urllib.parse import quote
    return '%s/accept-invite?token=%s' % (web_origin(), quote(token, safe=''))


def money(v):
    return '$%s' % format(float(v or 0), ',.2f')


def invoice_html(i):
    e = html.escape
    rows = ''.join('<tr><td>%s</td><td>%s</td><td>$%.2f</td><td>$%.2f</td></tr>' % (e(l['branchName']), l['users'], i['unitPrice'], l['amount']) for l in i.get('lines') or [])
    return ('<!doctype html><meta charset="utf-8"><title>%s</title><style>body{font:14px system-ui;margin:40px;color:#111}table{width:100%%;border-collapse:collapse;margin:20px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}.r{text-align:end}</style>'
            '<h1>%s</h1><p>%s%s<br>%s · %s</p><table><tr><th>Branch</th><th>Users</th><th>Price</th><th>Amount</th></tr>%s<tr><th colspan="3" class="r">Total (USD)</th><th>$%.2f</th></tr></table>'
            '<p>≈ %.2f SAR (rate %s) · %s%s</p>') % (e(i['number']), e(i['number']), e(i.get('companyName') or ''), (' · ' + e(i['taxNo'])) if i.get('taxNo') else '', e(i['period']), e((i.get('issuedAt') or '')[:10]), rows,
                                                      i['total'], i['totalSar'], i['sarPerUsd'], e(i['status'].upper()), (' · ' + e(i['method'])) if i.get('method') else '')


def open_html(text, name):
    path = os.path.join(tempfile.gettempdir(), name)
    Path(path).write_text(text, encoding='utf-8')
    webbrowser.open('file://' + path)
    return path


class ModulesBox(QWidget):
    """Which modules the company uses (checkboxes); saving needs org.manage."""

    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        lay.addWidget(label(t('mods.hint'), 'dim'))
        self.grid = QGridLayout()
        lay.addLayout(self.grid)
        row = QHBoxLayout()
        row.addWidget(button(t('mods.all'), lambda: self.set_all(True), 'ghost'))
        row.addWidget(button(t('mods.none'), lambda: self.set_all(False), 'ghost'))
        row.addStretch(1)
        row.addWidget(button(t('adm.save'), self.save))
        lay.addLayout(row)
        self.msg = QLabel('')
        lay.addWidget(self.msg)
        self.boxes = {}

    def reload(self):
        run_async(lambda: api._call('GET', '/org/modules'), self.show_mods, lambda m: self.msg.setText(m))

    def show_mods(self, r):
        while self.grid.count():
            w = self.grid.takeAt(0).widget()
            if w:
                w.deleteLater()
        self.boxes = {}
        on = set(r.get('enabled') or [])
        for n, m in enumerate(r.get('all') or []):
            name = t('module.' + m)
            cb = QCheckBox(m if name == 'module.' + m else name)
            cb.setChecked(m in on)
            self.boxes[m] = cb
            self.grid.addWidget(cb, n // 3, n % 3)

    def set_all(self, v):
        for cb in self.boxes.values():
            cb.setChecked(v)

    def selected(self):
        return [m for m, cb in self.boxes.items() if cb.isChecked()]

    def save(self):
        run_async(lambda: api._call('PUT', '/org/modules', {'enabled': self.selected()}), lambda r: (self.show_mods(r), self.msg.setText(t('adm.saved'))), lambda m: self.msg.setText(m))


class InviteForm(QWidget):
    """Name, e-mail, login, role and branch access; creates the user without a password and returns the invitation link."""

    def __init__(self, on_done):
        super().__init__()
        self.on_done = on_done
        form = QFormLayout(self)
        self.name, self.email, self.user, self.role = QLineEdit(), QLineEdit(), QLineEdit(), QComboBox()
        self.branches = QListWidget()
        self.branches.setMaximumHeight(90)
        self.err = QLabel('')
        self.err.setProperty('role', 'error')
        form.addRow(t('admin.displayName'), self.name)
        form.addRow(t('admin.email'), self.email)
        form.addRow(t('admin.username'), self.user)
        form.addRow(t('admin.role'), self.role)
        form.addRow(t('invite.branchAccess'), self.branches)
        form.addRow(button(t('setup.invite'), self.invite))
        form.addRow(self.err)

    def load(self, roles, branches):
        self.role.clear()
        for r in roles:
            if r != 'admin':
                self.role.addItem(r, r)
        self.branches.clear()
        for b in branches:
            it = QListWidgetItem(b['name'])
            it.setData(Qt.UserRole, b['code'])
            it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
            it.setCheckState(Qt.Unchecked)
            self.branches.addItem(it)

    def invite(self):
        if not self.name.text().strip() or not self.user.text().strip():
            self.err.setText(t('signup.fill'))
            return
        br = [self.branches.item(i).data(Qt.UserRole) for i in range(self.branches.count()) if self.branches.item(i).checkState() == Qt.Checked]
        body = {'username': self.user.text().strip(), 'displayName': self.name.text().strip(), 'email': self.email.text().strip(), 'role': self.role.currentData() or 'employee', 'isActive': True,
                'permissions': None, 'branches': br or None, 'invite': True, 'appUrl': web_origin()}

        def done(u):
            self.err.setText('')
            for w in (self.name, self.email, self.user):
                w.clear()
            self.on_done(u)
        run_async(lambda: api._call('POST', '/users/admin', body), done, lambda m: self.err.setText(m))


class SetupWizard(QWidget):
    """Company -> branches -> team -> finish (with the module switches), like the portal's first-run wizard."""

    def __init__(self, on_finished):
        super().__init__()
        self.on_finished = on_finished
        self.company, self.branches, self.step = None, [], 0
        lay = QVBoxLayout(self)
        self.head = QLabel('')
        lay.addWidget(self.head)
        self.stack = QStackedWidget()
        lay.addWidget(self.stack, 1)
        # 1 company
        w = QWidget()
        f = QFormLayout(w)
        self.name, self.ar, self.cur, self.country, self.tax = QLineEdit(), QLineEdit(), QComboBox(), QLineEdit(), QLineEdit()
        for c in SPEC['currencies']:
            self.cur.addItem(c, c)
        for text, wd in ((t('signup.company'), self.name), (t('org.nameAr'), self.ar), (t('signup.currency'), self.cur), (t('setup.country'), self.country), (t('setup.taxNo'), self.tax)):
            f.addRow(text, wd)
        f.addRow(label(t('setup.oneCompany'), 'dim'))
        self.stack.addWidget(w)
        # 2 branches
        w = QWidget()
        v = QVBoxLayout(w)
        self.brt = make_table([t('org.branches'), 'Code', t('org.city')])
        v.addWidget(self.brt, 1)
        row = QHBoxLayout()
        self.brn, self.brc = QLineEdit(), QLineEdit()
        self.brn.setPlaceholderText(t('setup.branchName'))
        self.brc.setPlaceholderText(t('org.city'))
        row.addWidget(self.brn)
        row.addWidget(self.brc)
        row.addWidget(button(t('org.addBranch'), self.add_branch))
        row.addWidget(button(t('adm.delete'), self.del_branch, 'ghost'))
        v.addLayout(row)
        self.stack.addWidget(w)
        # 3 team
        w = QWidget()
        v = QVBoxLayout(w)
        v.addWidget(label(t('setup.teamHint'), 'dim'))
        self.invited = make_table([t('admin.displayName'), t('admin.role'), t('adm.link')])
        self.invited.setMaximumHeight(130)
        v.addWidget(self.invited)
        v.addWidget(button(t('invite.copy'), self.copy_sel, 'ghost'))
        self.form = InviteForm(self.invited_one)
        v.addWidget(self.form)
        self.stack.addWidget(w)
        # 4 done
        w = QWidget()
        v = QVBoxLayout(w)
        v.addWidget(label(t('setup.ready'), 'title'))
        v.addWidget(label(t('setup.readyHint'), 'dim'))
        self.mods = ModulesBox()
        v.addWidget(self.mods)
        self.stack.addWidget(w)
        nav = QHBoxLayout()
        self.b_back, self.b_skip, self.b_next = button(t('setup.back'), self.back, 'ghost'), button(t('setup.skip'), lambda: self.go(3), 'ghost'), button(t('setup.next'), self.next)
        nav.addWidget(self.b_back)
        nav.addStretch(1)
        nav.addWidget(self.b_skip)
        nav.addWidget(self.b_next)
        lay.addLayout(nav)
        self.msg = QLabel('')
        lay.addWidget(self.msg)
        self.roles = ['employee']
        self.users = []
        self.go(0)

    def reload(self):
        def got(res):
            org, cat = res
            self.company = (org.get('companies') or [None])[0]
            self.branches = org.get('branches') or []
            if self.company:
                c = self.company
                self.name.setText(c.get('name') or '')
                self.ar.setText(c.get('nameAr') or '')
                self.cur.setCurrentIndex(max(0, self.cur.findData(c.get('currency'))))
                self.country.setText(c.get('country') or '')
                self.tax.setText(c.get('taxNo') or '')
            self.roles = cat.get('roles') or ['employee']
            self.show_branches()
            self.form.load(self.roles, self.branches)
            self.mods.reload()
        run_async(lambda: (api._call('GET', '/org'), api._call('GET', '/users/permissions')), got, lambda m: self.msg.setText(m))

    def go(self, n):
        self.step = n
        self.stack.setCurrentIndex(n)
        self.head.setText('<b>%s</b> &nbsp; %s' % (t('adm.step').replace('{n}', str(n + 1)).replace('{t}', '4'), t('setup.s%d' % (n + 1))))
        self.b_back.setVisible(n > 0)
        self.b_skip.setVisible(n == 2)
        self.b_next.setText(t('setup.finish') if n == 3 else t('setup.next'))
        self.msg.setText('')

    def back(self):
        self.go(self.step - 1)

    def next(self):
        if self.step == 0:
            if not self.name.text().strip():
                self.msg.setText(t('adm.mustName'))
                return
            if not self.company:
                self.go(1)
                return
            c = dict(self.company, name=self.name.text().strip(), nameAr=self.ar.text().strip(), currency=self.cur.currentData(), country=self.country.text().strip(), taxNo=self.tax.text().strip())
            run_async(lambda: api._call('PUT', '/org/companies/' + c['code'], c), lambda r: (setattr(self, 'company', r), self.go(1)), lambda m: self.msg.setText(m))
        elif self.step < 3:
            self.go(self.step + 1)
        else:
            run_async(lambda: api._call('POST', '/org/setup/complete', {}), lambda r: (self.msg.setText(t('adm.setupDone')), self.on_finished()), lambda m: self.msg.setText(m))

    def show_branches(self):
        fill_table(self.brt, [[b['name'], b['code'], b.get('city') or ''] for b in self.branches], self.branches)

    def add_branch(self):
        if not self.brn.text().strip() or not self.company:
            return
        code = ('BR%02d-%s' % (len(self.branches) + 1, ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(3)))).upper()
        body = {'code': code, 'company': self.company['code'], 'name': self.brn.text().strip(), 'nameAr': '', 'warehouse': '', 'city': self.brc.text().strip()}

        def done(b):
            self.branches.append(b)
            self.brn.clear()
            self.brc.clear()
            self.show_branches()
            self.form.load(self.roles, self.branches)
        run_async(lambda: api._call('POST', '/org/branches', body), done, lambda m: self.msg.setText(m))

    def del_branch(self):
        b = current_payload(self.brt)
        if not b or len(self.branches) < 2:
            return

        def done(_):
            self.branches = [x for x in self.branches if x['code'] != b['code']]
            self.show_branches()
        run_async(lambda: api._call('DELETE', '/org/branches/' + b['code']), done, lambda m: self.msg.setText(m))

    def invited_one(self, u):
        self.users.append(u)
        link = invite_link(u['inviteToken']) if u.get('inviteToken') else ''
        rows = [[x['displayName'], x['role'], invite_link(x['inviteToken']) if x.get('inviteToken') else ''] for x in self.users]
        fill_table(self.invited, rows, self.users)

    def copy_sel(self):
        u = current_payload(self.invited)
        if u and u.get('inviteToken'):
            QApplication.clipboard().setText(invite_link(u['inviteToken']))
            self.msg.setText(t('invite.copied'))


class AdminPage(QWidget):
    """Tabs the user may use: workspace, setup wizard, invitations, billing, modules."""

    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self)
        lay.addWidget(label(t('adm.title'), 'title'))
        self.tabs = QTabWidget()
        lay.addWidget(self.tabs, 1)
        self.msg = QLabel('')
        lay.addWidget(self.msg)
        self.views = []
        # workspace
        self.ws = make_table([t('adm.v.ws'), t('bill.users'), 'Max'])
        self.ws_head = QLabel('')
        w = QWidget()
        v = QVBoxLayout(w)
        v.addWidget(self.ws_head)
        v.addWidget(self.ws, 1)
        v.addWidget(label(t('ws.note'), 'dim'))
        self.tabs.addTab(w, t('adm.v.ws'))
        self.views.append(('ws', self.load_ws))
        if api.can('org.manage'):
            self.wiz = SetupWizard(self.reload)
            self.tabs.addTab(self.wiz, t('adm.v.setup'))
            self.views.append(('setup', self.wiz.reload))
        if api.can('admin.users'):
            w = QWidget()
            v = QVBoxLayout(w)
            self.inv = make_table([t('admin.displayName'), t('admin.username'), t('admin.role'), t('adm.status'), t('adm.link')])
            v.addWidget(self.inv, 1)
            row = QHBoxLayout()
            row.addWidget(button(t('invite.resend'), self.resend))
            row.addWidget(button(t('invite.copy'), self.copy_link, 'ghost'))
            row.addStretch(1)
            v.addLayout(row)
            v.addWidget(label(t('adm.newInvite'), 'title'))
            self.form = InviteForm(lambda u: self.load_invites())
            v.addWidget(self.form)
            self.tabs.addTab(w, t('adm.v.invites'))
            self.views.append(('invites', self.load_invites))
        if api.can('org.manage'):
            w = QWidget()
            v = QVBoxLayout(w)
            self.kpi = QLabel('')
            v.addWidget(self.kpi)
            self.lines = make_table([t('bill.byBranch'), t('bill.usersShort'), t('bill.total')])
            self.lines.setMaximumHeight(110)
            v.addWidget(self.lines)
            self.invs = make_table([t('bill.number'), t('bill.period'), t('bill.usersShort'), t('bill.total'), t('bill.due'), t('adm.status')])
            v.addWidget(self.invs, 1)
            row = QHBoxLayout()
            row.addWidget(button(t('bill.pay'), self.pay))
            row.addWidget(button(t('bill.check'), self.check, 'ghost'))
            row.addWidget(button(t('bill.print'), self.print_inv, 'ghost'))
            row.addWidget(button(t('adm.sandbox'), self.sandbox, 'ghost'))
            row.addStretch(1)
            v.addLayout(row)
            self.tabs.addTab(w, t('bill.tab'))
            self.views.append(('billing', self.load_billing))
            self.mods = ModulesBox()
            self.tabs.addTab(self.mods, t('mods.tab'))
            self.views.append(('modules', self.mods.reload))
        self.tabs.currentChanged.connect(lambda i: self.views[i][1]())
        self.users = []

    def reload(self):
        i = self.tabs.currentIndex()
        if 0 <= i < len(self.views):
            self.views[i][1]()

    def say(self, m):
        self.msg.setText(m)

    # ---------------------------------------------------------- workspace
    def load_ws(self):
        def done(o):
            tn = o.get('tenant') or {}
            self.ws_head.setText('<b>%s</b> &nbsp; %s: %s &nbsp; %s: %s' % (html.escape(str(tn.get('name', ''))), t('ws.id'), tn.get('id', ''), t('ws.plan'), t('ws.plan.' + str(tn.get('plan', 'starter')))))

            def lim(k):
                mx = tn.get('max' + k, 0)
                return str(mx) if mx else t('ws.unlimited')
            rows = [[t('ws.users'), str(tn.get('users', 0)), lim('Users')], [t('org.companies'), str(tn.get('companies', 0)), lim('Companies')], [t('org.branches'), str(tn.get('branches', 0)), lim('Branches')]]
            fill_table(self.ws, rows, rows)
            self.say('' if tn.get('setupDone', True) else t('setup.banner'))
        run_async(lambda: api._call('GET', '/org'), done, self.say)

    # ---------------------------------------------------------- invitations
    def load_invites(self):
        def done(res):
            users, org, cat = res
            self.users = users
            rows = [[u['displayName'], u['username'], u['role'], t('invite.pending') if u.get('invitePending') else ('✓' if u.get('isActive') else '-'), invite_link(u['inviteToken']) if u.get('inviteToken') else ''] for u in users]
            fill_table(self.inv, rows, users)
            self.form.load(cat.get('roles') or ['employee'], org.get('branches') or [])
            self.say(t('adm.noInvites') if not users else '')
        run_async(lambda: (api._call('GET', '/users/admin') or [], api._call('GET', '/org'), api._call('GET', '/users/permissions')), done, self.say)

    def resend(self):
        u = current_payload(self.inv)
        if u:
            run_async(lambda: api._call('POST', '/users/admin/%s/invite' % u['id'], {'appUrl': web_origin()}), lambda r: (self.say(t('adm.accept')), self.load_invites()), self.say)

    def copy_link(self):
        u = current_payload(self.inv)
        if u and u.get('inviteToken'):
            QApplication.clipboard().setText(invite_link(u['inviteToken']))
            self.say(t('invite.copied'))
        elif u:
            self.say(t('invite.resend'))

    # ---------------------------------------------------------- billing
    def load_billing(self):
        def done(res):
            s, inv = res
            self.kpi.setText('%s: <b>%s</b> &nbsp; %s: <b>%s</b> (%s) &nbsp; %s: <b>%s</b> &nbsp; %s: <b>%s</b> (%s %s)<br><span style="color:#64748b">%s</span>' % (
                t('bill.users'), s['users'], t('bill.rate'), money(s['unitPrice']), t('bill.perUserMonth'), t('bill.estimate'), money(s['estimate']), t('bill.balance'), money(s['balance']), s['openInvoices'], t('bill.open'),
                t('bill.pricing').replace('{p}', str(s['pricePerUser'])).replace('{v}', str(s['volumePrice'])).replace('{n}', str(s['volumeFrom']))))
            fill_table(self.lines, [[l['branchName'], str(l['users']), money(l['amount'])] for l in s.get('lines') or []], s.get('lines') or [])
            self.invoices = inv
            fill_table(self.invs, [[i['number'], i['period'], '%s x %s' % (i['users'], money(i['unitPrice'])), '%s (~%.2f SAR)' % (money(i['total']), i['totalSar']), (i['dueAt'] or '')[:10],
                                    t('bill.paid') if i['status'] == 'paid' else t('bill.overdue') if i.get('overdue') else t('bill.unpaid')] for i in inv], inv)
            self.say('')
        run_async(lambda: (api._call('GET', '/billing/summary'), api._call('GET', '/billing/invoices') or []), done, self.say)

    def sel_invoice(self):
        return current_payload(self.invs)

    def pay(self):
        i = self.sel_invoice()
        if not i or i['status'] != 'open':
            return

        def done(r):
            if r.get('url'):
                webbrowser.open(r['url'])
                self.say(t('adm.payOpened'))
            else:
                self.say('%s: %s' % (t('bill.testMode'), t('bill.testHint')))
        run_async(lambda: api._call('POST', '/billing/invoices/%s/pay' % i['id'], {'returnUrl': web_origin() + '/admin?tab=billing'}), done, self.say)

    def check(self):
        i = self.sel_invoice()
        if i:
            run_async(lambda: api._call('POST', '/billing/invoices/%s/confirm' % i['id'], {}), lambda r: (self.say(t('bill.thanks') if r['status'] == 'paid' else t('bill.notPaid')), self.load_billing()), self.say)

    def sandbox(self):
        i = self.sel_invoice()
        if i and i['status'] == 'open':
            run_async(lambda: api._call('POST', '/billing/invoices/%s/sandbox-pay' % i['id'], {}), lambda r: (self.say(t('bill.thanks')), self.load_billing()), self.say)

    def print_inv(self):
        i = self.sel_invoice()
        if i:
            self.say(open_html(invoice_html(i), i['number'] + '.html'))
