#include "MainWindow.h"

#include <QHBoxLayout>

#include "Api.h"
#include "I18n.h"
#include "ChatPage.h"
#include "WorkflowPage.h"
#include "MuslimPage.h"
#include "Dashboard.h"
#include "Pos.h"
#include "Hospital.h"
#include "CalendarPage.h"
#include "Finance.h"
#include "HrPage.h"
#include "OpsPage.h"
#include "SitePage.h"
#include "CustomPage.h"
#include "AdminPage.h"
#include "ActionsPage.h"

using I18n::t;

MainWindow::MainWindow(std::function<void()> relaunch) : relaunch_(std::move(relaunch)) {
    setWindowTitle(t("app.title") + " — " + Api::I().displayName);
    resize(1180, 740);
    auto* root = new QWidget;
    auto* lay = new QHBoxLayout(root);
    lay->setContentsMargins(0, 0, 0, 0);
    lay->setSpacing(0);
    nav = new QListWidget;
    nav->setObjectName("nav");
    nav->setFixedWidth(190);
    for (const char* k : {"tab.home", "tab.approvals", "tab.documents", "tab.reports", "tab.erp", "tab.chat", "tab.workflow", "tab.muslim", "tab.pos", "tab.hos", "tab.cal", "tab.fin", "tab.hr", "tab.ops", "tab.web", "tab.cus", "tab.adm", "tab.act", "tab.more"}) nav->addItem(t(k));
    stack = new QStackedWidget;
    erp = new ErpPage;
    pages << new DashboardPage([this](int i) { goPage(i); }, [this](const QString& m, const QString& k) { goPage(4); erp->select(m, k); })
          << new ApprovalsPage << new DocumentsPage << new ReportsPage << erp
          << new ChatPage([this](const QString& m, const QString& k) {
                 if (m == "gov" && k == "approval") goPage(1);
                 else { goPage(4); erp->select(m, k); }
             })
          << new WorkflowPage
          << new MuslimPage
          << new PosPage
          << new HospitalPage
          << new CalendarPage
          << new FinancePage
          << new HrPage
          << new OpsPage
          << new SitePage
          << new CustomPage
          << new AdminPage
          << new ActionsPage
          << new SettingsPage([this](const QString& l) { if (I18n::lang() != l) { I18n::setLang(l); relaunch_(); } },
                              [this] { Api::I().signOut(); relaunch_(); });
    for (Page* p : pages) stack->addWidget(p);
    connect(nav, &QListWidget::currentRowChanged, this, [this](int i) { if (i >= 0) { stack->setCurrentIndex(i); pages[i]->reload(); } });
    lay->addWidget(nav);
    lay->addWidget(stack, 1);
    setCentralWidget(root);
    nav->setCurrentRow(0);
}

void MainWindow::goPage(int i) { nav->setCurrentRow(i); }
