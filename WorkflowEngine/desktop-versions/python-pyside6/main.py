import sys

from PySide6.QtCore import QSettings, Qt
from PySide6.QtWidgets import QApplication, QDialog, QFormLayout, QLineEdit, QListWidget, QMainWindow, QStackedWidget, QHBoxLayout, QVBoxLayout, QWidget

from app import i18n
from app.api import DEFAULT_SERVER, api
from app.i18n import t
from app.chat import ChatPage
from app.workflow import WorkflowPage
from app.muslim import MuslimPage
from app.pos import PosPage
from app.hospital import HospitalPage
from app.calendar_page import CalendarPage
from app.finance_page import FinancePage
from app.ops_page import OpsPage
from app.site_page import SitePage
from app.custom_page import CustomPage
from app.admin_page import AdminPage
from app.actions_page import ActionsPage
from app.hr_page import HrPage
from app.dashboard import DashboardPage, ReportsPage
from app.pages import ApprovalsPage, DocumentsPage, ErpPage, SettingsPage
from app.ui import STYLE, button, label, run_async


class LoginDialog(QDialog):
    def __init__(self, server):
        super().__init__()
        self.setWindowTitle(t('app.title'))
        self.setMinimumWidth(380)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 24, 24, 24)
        lay.addWidget(label(t('app.name'), 'title'))
        lay.addWidget(label(t('login.title'), 'dim'))
        form = QFormLayout()
        self.server = QLineEdit(server)
        self.user = QLineEdit()
        self.pw = QLineEdit()
        self.pw.setEchoMode(QLineEdit.Password)
        self.pw.returnPressed.connect(self.go)
        form.addRow(t('login.server'), self.server)
        form.addRow(t('login.user'), self.user)
        form.addRow(t('login.pass'), self.pw)
        lay.addLayout(form)
        self.err = label('', 'error')
        lay.addWidget(self.err)
        self.btn = button(t('login.signin'), self.go)
        lay.addWidget(self.btn)

    def go(self):
        self.err.setText('')
        self.btn.setEnabled(False)
        s, u, p = self.server.text(), self.user.text().strip(), self.pw.text()

        def bad(_m):
            self.err.setText(t('login.failed'))
            self.btn.setEnabled(True)
        run_async(lambda: api.login(s, u, p), lambda _r: self.accept(), bad)


class MainWindow(QMainWindow):
    def __init__(self, relaunch):
        super().__init__()
        self.relaunch = relaunch
        self.setWindowTitle(f"{t('app.title')} — {api.session.display_name}")
        self.resize(1180, 740)
        root = QWidget()
        lay = QHBoxLayout(root)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        self.nav = QListWidget()
        self.nav.setObjectName('nav')
        self.nav.setFixedWidth(190)
        for key in ('tab.home', 'tab.approvals', 'tab.documents', 'tab.reports', 'tab.erp', 'tab.chat', 'tab.workflow', 'tab.muslim', 'tab.pos', 'tab.hos', 'tab.cal', 'tab.fin', 'tab.hr', 'tab.ops', 'tab.web', 'tab.cus', 'tab.adm', 'tab.act', 'tab.more'):
            self.nav.addItem(t(key))
        self.stack = QStackedWidget()
        self.erp = ErpPage()
        self.pages = [DashboardPage(self.go_page, self.open_erp), ApprovalsPage(), DocumentsPage(), ReportsPage(), self.erp, ChatPage(self.open_action), WorkflowPage(), MuslimPage(), PosPage(), HospitalPage(), CalendarPage(), FinancePage(), HrPage(), OpsPage(), SitePage(), CustomPage(), AdminPage(), ActionsPage(), SettingsPage(self.set_lang, self.sign_out)]
        for p in self.pages:
            self.stack.addWidget(p)
        self.nav.currentRowChanged.connect(self.go_page)
        lay.addWidget(self.nav)
        lay.addWidget(self.stack, 1)
        self.setCentralWidget(root)
        self.nav.setCurrentRow(0)

    def go_page(self, i):
        self.nav.blockSignals(True)
        self.nav.setCurrentRow(i)
        self.nav.blockSignals(False)
        self.stack.setCurrentIndex(i)
        self.pages[i].reload()

    def open_erp(self, module_id, kind_id):
        self.go_page(4)
        self.erp.select(module_id, kind_id)

    def open_action(self, module_id, kind_id):
        if module_id == 'gov' and kind_id == 'approval':
            self.go_page(1)
        else:
            self.open_erp(module_id, kind_id)

    def set_lang(self, l):
        if i18n.lang != l:
            i18n.set_lang(l)
            QSettings('WorkflowEngine', 'ErpPySide').setValue('lang', l)
            self.relaunch()

    def sign_out(self):
        api.sign_out()
        self.relaunch()


class Launcher:
    def __init__(self, app):
        self.app, self.win = app, None
        api.on_unauthorized = None
        self.show()

    def show(self):
        if self.win:
            self.win.close()
            self.win = None
        self.app.setLayoutDirection(Qt.RightToLeft if i18n.rtl() else Qt.LeftToRight)
        if api.session is None:
            dlg = LoginDialog(DEFAULT_SERVER)
            if not dlg.exec():
                self.app.quit()
                return
        self.win = MainWindow(self.show)
        self.win.show()


def main():
    app = QApplication(sys.argv)
    app.setStyleSheet(STYLE)
    i18n.set_lang(QSettings('WorkflowEngine', 'ErpPySide').value('lang', 'en'))
    if api.load():
        api.refresh_me()
    launcher = Launcher(app)  # noqa: F841 - keeps the window alive
    sys.exit(app.exec())


if __name__ == '__main__':
    main()
