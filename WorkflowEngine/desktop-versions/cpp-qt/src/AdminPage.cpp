#include "AdminPage.h"

#include <QCheckBox>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFormLayout>
#include <QGridLayout>
#include <QGuiApplication>
#include <QClipboard>
#include <QHBoxLayout>
#include <QRandomGenerator>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QUrl>
#include <QJsonDocument>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

static QJsonObject specObj() {
    static QJsonObject s = [] { QFile f(":/admin.json"); f.open(QIODevice::ReadOnly); return QJsonDocument::fromJson(f.readAll()).object(); }();
    return s;
}
static QString rep(QString s, const QString& k, const QString& v) { return s.replace("{" + k + "}", v); }

namespace Adm {
QString webOrigin() {
    QString s = Api::I().server.trimmed();
    while (s.endsWith('/')) s.chop(1);
    if (s.toLower().endsWith("/api")) s.chop(4);
    return s;
}
QString inviteLink(const QString& token) { return webOrigin() + "/accept-invite?token=" + QString::fromLatin1(QUrl::toPercentEncoding(token)); }
QString money(double v) { return "$" + QLocale(QLocale::English).toString(v, 'f', 2); }
QString invoiceHtml(const QJsonObject& i) {
    auto e = [](const QString& s) { return s.toHtmlEscaped(); };
    QString rows;
    for (const QJsonValue& lv : i.value("lines").toArray()) {
        const QJsonObject l = lv.toObject();
        rows += "<tr><td>" + e(l.value("branchName").toString()) + "</td><td>" + QString::number(l.value("users").toInt()) + "</td><td>$" + QString::number(i.value("unitPrice").toDouble(), 'f', 2) + "</td><td>$" + QString::number(l.value("amount").toDouble(), 'f', 2) + "</td></tr>";
    }
    return "<!doctype html><meta charset=\"utf-8\"><title>" + e(i.value("number").toString()) + "</title><style>body{font:14px system-ui;margin:40px;color:#111}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}.r{text-align:end}</style>"
        "<h1>" + e(i.value("number").toString()) + "</h1><p>" + e(i.value("companyName").toString()) + (i.value("taxNo").toString().isEmpty() ? "" : " · " + e(i.value("taxNo").toString())) + "<br>" + e(i.value("period").toString()) + " · " + e(i.value("issuedAt").toString().left(10)) +
        "</p><table><tr><th>Branch</th><th>Users</th><th>Price</th><th>Amount</th></tr>" + rows + "<tr><th colspan=\"3\" class=\"r\">Total (USD)</th><th>$" + QString::number(i.value("total").toDouble(), 'f', 2) + "</th></tr></table><p>≈ " +
        QString::number(i.value("totalSar").toDouble(), 'f', 2) + " SAR (rate " + QString::number(i.value("sarPerUsd").toDouble()) + ") · " + e(i.value("status").toString().toUpper()) + (i.value("method").toString().isEmpty() ? "" : " · " + e(i.value("method").toString())) + "</p>";
}
}  // namespace Adm

// ---------------------------------------------------------------- modules
ModulesBox::ModulesBox() {
    auto* lay = new QVBoxLayout(this);
    lay->addWidget(Ui::label(t("mods.hint"), "dim"));
    grid = new QGridLayout; lay->addLayout(grid);
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button(t("mods.all"), [this] { setAll(true); }, "ghost")); row->addWidget(Ui::button(t("mods.none"), [this] { setAll(false); }, "ghost"));
    row->addStretch(1); row->addWidget(Ui::button(t("adm.save"), [this] { save(); }));
    lay->addLayout(row);
    msg = new QLabel; lay->addWidget(msg);
}
void ModulesBox::reload() { Api::I().call("GET", "/org/modules", QJsonValue(), this, [this](const QJsonValue& v) { showMods(v.toObject()); }, [this](const QString& e) { msg->setText(e); }); }
void ModulesBox::showMods(const QJsonObject& r) {
    while (QLayoutItem* it = grid->takeAt(0)) { delete it->widget(); delete it; }
    boxes.clear();
    QSet<QString> on; for (const QJsonValue& v : r.value("enabled").toArray()) on.insert(v.toString());
    int n = 0;
    for (const QJsonValue& mv : r.value("all").toArray()) {
        const QString m = mv.toString(), name = t("module." + m);
        auto* cb = new QCheckBox(name == "module." + m ? m : name); cb->setChecked(on.contains(m));
        boxes[m] = cb; grid->addWidget(cb, n / 3, n % 3); ++n;
    }
}
void ModulesBox::setAll(bool v) { for (QCheckBox* c : boxes) c->setChecked(v); }
QStringList ModulesBox::selected() const { QStringList out; for (auto it = boxes.begin(); it != boxes.end(); ++it) if (it.value()->isChecked()) out << it.key(); return out; }
void ModulesBox::save() {
    QJsonArray a; for (const QString& m : selected()) a.append(m);
    Api::I().call("PUT", "/org/modules", QJsonObject{{"enabled", a}}, this, [this](const QJsonValue& v) { showMods(v.toObject()); msg->setText(t("adm.saved")); }, [this](const QString& e) { msg->setText(e); });
}

// ---------------------------------------------------------------- invite form
InviteForm::InviteForm(std::function<void(const QJsonObject&)> done) : onDone(done) {
    auto* form = new QFormLayout(this);
    name = new QLineEdit; email = new QLineEdit; user = new QLineEdit; role = new QComboBox; branches = new QListWidget; branches->setMaximumHeight(90);
    err = Ui::label("", "error");
    form->addRow(t("admin.displayName"), name); form->addRow(t("admin.email"), email); form->addRow(t("admin.username"), user); form->addRow(t("admin.role"), role); form->addRow(t("invite.branchAccess"), branches);
    form->addRow(Ui::button(t("setup.invite"), [this] { invite(); })); form->addRow(err);
}
void InviteForm::load(const QStringList& roles, const QJsonArray& brs) {
    role->clear(); for (const QString& r : roles) if (r != "admin") role->addItem(r, r);
    branches->clear();
    for (const QJsonValue& bv : brs) {
        const QJsonObject b = bv.toObject();
        auto* it = new QListWidgetItem(b.value("name").toString()); it->setData(Qt::UserRole, b.value("code").toString());
        it->setFlags(it->flags() | Qt::ItemIsUserCheckable); it->setCheckState(Qt::Unchecked); branches->addItem(it);
    }
}
void InviteForm::invite() {
    if (name->text().trimmed().isEmpty() || user->text().trimmed().isEmpty()) { err->setText(t("signup.fill")); return; }
    QJsonArray br;
    for (int i = 0; i < branches->count(); ++i) if (branches->item(i)->checkState() == Qt::Checked) br.append(branches->item(i)->data(Qt::UserRole).toString());
    QJsonObject body{{"username", user->text().trimmed()}, {"displayName", name->text().trimmed()}, {"email", email->text().trimmed()}, {"role", role->currentData().toString().isEmpty() ? "employee" : role->currentData().toString()},
        {"isActive", true}, {"permissions", QJsonValue::Null}, {"branches", br.isEmpty() ? QJsonValue(QJsonValue::Null) : QJsonValue(br)}, {"invite", true}, {"appUrl", Adm::webOrigin()}};
    Api::I().call("POST", "/users/admin", body, this, [this](const QJsonValue& v) { err->setText(""); name->clear(); email->clear(); user->clear(); onDone(v.toObject()); }, [this](const QString& e) { err->setText(e); });
}

// ---------------------------------------------------------------- wizard
SetupWizard::SetupWizard(std::function<void()> done) : onFinished(done) {
    auto* lay = new QVBoxLayout(this);
    head = new QLabel; lay->addWidget(head);
    stack = new QStackedWidget; lay->addWidget(stack, 1);
    { // 1 company
        auto* w = new QWidget; auto* f = new QFormLayout(w);
        name = new QLineEdit; ar = new QLineEdit; cur = new QComboBox; country = new QLineEdit; tax = new QLineEdit;
        for (const QJsonValue& c : specObj().value("currencies").toArray()) cur->addItem(c.toString(), c.toString());
        f->addRow(t("signup.company"), name); f->addRow(t("org.nameAr"), ar); f->addRow(t("signup.currency"), cur); f->addRow(t("setup.country"), country); f->addRow(t("setup.taxNo"), tax); f->addRow(Ui::label(t("setup.oneCompany"), "dim"));
        stack->addWidget(w);
    }
    { // 2 branches
        auto* w = new QWidget; auto* v = new QVBoxLayout(w);
        brt = Ui::table({t("org.branches"), "Code", t("org.city")}); v->addWidget(brt, 1);
        auto* row = new QHBoxLayout; brn = new QLineEdit; brc = new QLineEdit; brn->setPlaceholderText(t("setup.branchName")); brc->setPlaceholderText(t("org.city"));
        row->addWidget(brn); row->addWidget(brc); row->addWidget(Ui::button(t("org.addBranch"), [this] { addBranch(); })); row->addWidget(Ui::button(t("adm.delete"), [this] { delBranch(); }, "ghost"));
        v->addLayout(row); stack->addWidget(w);
    }
    { // 3 team
        auto* w = new QWidget; auto* v = new QVBoxLayout(w);
        v->addWidget(Ui::label(t("setup.teamHint"), "dim"));
        invited = Ui::table({t("admin.displayName"), t("admin.role"), t("adm.link")}); invited->setMaximumHeight(130); v->addWidget(invited);
        v->addWidget(Ui::button(t("invite.copy"), [this] { copySel(); }, "ghost"));
        form = new InviteForm([this](const QJsonObject& u) { invitedOne(u); }); v->addWidget(form); stack->addWidget(w);
    }
    { // 4 done
        auto* w = new QWidget; auto* v = new QVBoxLayout(w);
        v->addWidget(Ui::label(t("setup.ready"), "title")); v->addWidget(Ui::label(t("setup.readyHint"), "dim"));
        mods = new ModulesBox; v->addWidget(mods); stack->addWidget(w);
    }
    auto* nav = new QHBoxLayout;
    bBack = Ui::button(t("setup.back"), [this] { back(); }, "ghost"); bSkip = Ui::button(t("setup.skip"), [this] { go(3); }, "ghost"); bNext = Ui::button(t("setup.next"), [this] { next(); });
    nav->addWidget(bBack); nav->addStretch(1); nav->addWidget(bSkip); nav->addWidget(bNext); lay->addLayout(nav);
    msg = new QLabel; lay->addWidget(msg);
    go(0);
}
void SetupWizard::reload() {
    Api::I().call("GET", "/org", QJsonValue(), this, [this](const QJsonValue& ov) {
        const QJsonObject org = ov.toObject();
        company = org.value("companies").toArray().isEmpty() ? QJsonObject() : org.value("companies").toArray().at(0).toObject();
        branches = org.value("branches").toArray();
        if (!company.isEmpty()) {
            name->setText(company.value("name").toString()); ar->setText(company.value("nameAr").toString()); cur->setCurrentIndex(std::max(0, cur->findData(company.value("currency").toString())));
            country->setText(company.value("country").toString()); tax->setText(company.value("taxNo").toString());
        }
        showBranches();
        Api::I().call("GET", "/users/permissions", QJsonValue(), this, [this](const QJsonValue& cv) {
            roles.clear(); for (const QJsonValue& r : cv.toObject().value("roles").toArray()) roles << r.toString();
            if (roles.isEmpty()) roles << "employee";
            form->load(roles, branches); mods->reload();
        }, [this](const QString& e) { msg->setText(e); });
    }, [this](const QString& e) { msg->setText(e); });
}
void SetupWizard::go(int n) {
    step = n; stack->setCurrentIndex(n);
    head->setText("<b>" + rep(rep(t("adm.step"), "n", QString::number(n + 1)), "t", "4") + "</b> &nbsp; " + t(QString("setup.s%1").arg(n + 1)));
    bBack->setVisible(n > 0); bSkip->setVisible(n == 2); bNext->setText(n == 3 ? t("setup.finish") : t("setup.next")); msg->setText("");
}
void SetupWizard::next() {
    if (step == 0) {
        if (name->text().trimmed().isEmpty()) { msg->setText(t("adm.mustName")); return; }
        if (company.isEmpty()) { go(1); return; }
        QJsonObject c = company;
        c["name"] = name->text().trimmed(); c["nameAr"] = ar->text().trimmed(); c["currency"] = cur->currentData().toString(); c["country"] = country->text().trimmed(); c["taxNo"] = tax->text().trimmed();
        Api::I().call("PUT", "/org/companies/" + company.value("code").toString(), c, this, [this](const QJsonValue& v) { company = v.toObject(); go(1); }, [this](const QString& e) { msg->setText(e); });
    } else if (step < 3) go(step + 1);
    else Api::I().call("POST", "/org/setup/complete", QJsonObject(), this, [this](const QJsonValue&) { msg->setText(t("adm.setupDone")); onFinished(); }, [this](const QString& e) { msg->setText(e); });
}
void SetupWizard::showBranches() {
    QList<QStringList> rows; QList<QJsonObject> pay;
    for (const QJsonValue& bv : branches) { const QJsonObject b = bv.toObject(); rows << QStringList{b.value("name").toString(), b.value("code").toString(), b.value("city").toString()}; pay << b; }
    Ui::fill(brt, rows, pay);
}
void SetupWizard::addBranch() {
    if (brn->text().trimmed().isEmpty() || company.isEmpty()) return;
    const QString chars = "abcdefghijklmnopqrstuvwxyz0123456789"; QString rnd; for (int i = 0; i < 3; ++i) rnd += chars.at(int(QRandomGenerator::global()->bounded(chars.size())));
    QJsonObject body{{"code", QString("BR%1-%2").arg(branches.size() + 1, 2, 10, QChar('0')).arg(rnd).toUpper()}, {"company", company.value("code").toString()}, {"name", brn->text().trimmed()}, {"nameAr", ""}, {"warehouse", ""}, {"city", brc->text().trimmed()}};
    Api::I().call("POST", "/org/branches", body, this, [this](const QJsonValue& v) { branches.append(v.toObject()); brn->clear(); brc->clear(); showBranches(); form->load(roles, branches); }, [this](const QString& e) { msg->setText(e); });
}
void SetupWizard::delBranch() {
    QJsonObject b; if (!Ui::selected(brt, b) || branches.size() < 2) return;
    const QString code = b.value("code").toString();
    Api::I().call("DELETE", "/org/branches/" + code, QJsonValue(), this, [this, code](const QJsonValue&) {
        QJsonArray n; for (const QJsonValue& x : branches) if (x.toObject().value("code").toString() != code) n.append(x);
        branches = n; showBranches();
    }, [this](const QString& e) { msg->setText(e); });
}
void SetupWizard::invitedOne(const QJsonObject& u) {
    users.append(u);
    QList<QStringList> rows; QList<QJsonObject> pay;
    for (const QJsonValue& xv : users) { const QJsonObject x = xv.toObject(); rows << QStringList{x.value("displayName").toString(), x.value("role").toString(), x.value("inviteToken").toString().isEmpty() ? QString() : Adm::inviteLink(x.value("inviteToken").toString())}; pay << x; }
    Ui::fill(invited, rows, pay);
}
void SetupWizard::copySel() {
    QJsonObject u; if (Ui::selected(invited, u) && !u.value("inviteToken").toString().isEmpty()) { QGuiApplication::clipboard()->setText(Adm::inviteLink(u.value("inviteToken").toString())); msg->setText(t("invite.copied")); }
}

// ---------------------------------------------------------------- the page
AdminPage::AdminPage() {
    auto* lay = new QVBoxLayout(this);
    lay->addWidget(Ui::label(t("adm.title"), "title"));
    tabs = new QTabWidget; lay->addWidget(tabs, 1);
    msg = new QLabel; lay->addWidget(msg);
    { // workspace
        ws = Ui::table({t("adm.v.ws"), t("bill.users"), "Max"}); wsHead = new QLabel;
        auto* w = new QWidget; auto* v = new QVBoxLayout(w); v->addWidget(wsHead); v->addWidget(ws, 1); v->addWidget(Ui::label(t("ws.note"), "dim"));
        tabs->addTab(w, t("adm.v.ws")); views << [this] { loadWs(); };
    }
    if (Api::I().can("org.manage")) { wiz = new SetupWizard([this] { reload(); }); tabs->addTab(wiz, t("adm.v.setup")); views << [this] { wiz->reload(); }; }
    if (Api::I().can("admin.users")) {
        auto* w = new QWidget; auto* v = new QVBoxLayout(w);
        inv = Ui::table({t("admin.displayName"), t("admin.username"), t("admin.role"), t("adm.status"), t("adm.link")}); v->addWidget(inv, 1);
        auto* row = new QHBoxLayout; row->addWidget(Ui::button(t("invite.resend"), [this] { resend(); })); row->addWidget(Ui::button(t("invite.copy"), [this] { copyLink(); }, "ghost")); row->addStretch(1); v->addLayout(row);
        v->addWidget(Ui::label(t("adm.newInvite"), "title"));
        form = new InviteForm([this](const QJsonObject&) { loadInvites(); }); v->addWidget(form);
        tabs->addTab(w, t("adm.v.invites")); views << [this] { loadInvites(); };
    }
    if (Api::I().can("org.manage")) {
        auto* w = new QWidget; auto* v = new QVBoxLayout(w);
        kpi = new QLabel; kpi->setWordWrap(true); v->addWidget(kpi);
        lines = Ui::table({t("bill.byBranch"), t("bill.usersShort"), t("bill.total")}); lines->setMaximumHeight(110); v->addWidget(lines);
        invs = Ui::table({t("bill.number"), t("bill.period"), t("bill.usersShort"), t("bill.total"), t("bill.due"), t("adm.status")}); v->addWidget(invs, 1);
        auto* row = new QHBoxLayout;
        row->addWidget(Ui::button(t("bill.pay"), [this] { pay(); })); row->addWidget(Ui::button(t("bill.check"), [this] { check(); }, "ghost")); row->addWidget(Ui::button(t("bill.print"), [this] { printInv(); }, "ghost")); row->addWidget(Ui::button(t("adm.sandbox"), [this] { sandbox(); }, "ghost"));
        row->addStretch(1); v->addLayout(row);
        tabs->addTab(w, t("bill.tab")); views << [this] { loadBilling(); };
        mods = new ModulesBox; tabs->addTab(mods, t("mods.tab")); views << [this] { mods->reload(); };
    }
    connect(tabs, &QTabWidget::currentChanged, this, [this](int i) { if (i >= 0 && i < views.size()) views[i](); });
}
void AdminPage::reload() { const int i = tabs->currentIndex(); if (i >= 0 && i < views.size()) views[i](); }

void AdminPage::loadWs() {
    Api::I().call("GET", "/org", QJsonValue(), this, [this](const QJsonValue& v) {
        const QJsonObject tn = v.toObject().value("tenant").toObject();
        wsHead->setText("<b>" + tn.value("name").toString().toHtmlEscaped() + "</b> &nbsp; " + t("ws.id") + ": " + tn.value("id").toString() + " &nbsp; " + t("ws.plan") + ": " + t("ws.plan." + (tn.value("plan").toString().isEmpty() ? QString("starter") : tn.value("plan").toString())));
        auto lim = [&](const char* k) { const int mx = tn.value(QString("max") + k).toInt(); return mx ? QString::number(mx) : t("ws.unlimited"); };
        QList<QStringList> rows{{t("ws.users"), QString::number(tn.value("users").toInt()), lim("Users")}, {t("org.companies"), QString::number(tn.value("companies").toInt()), lim("Companies")}, {t("org.branches"), QString::number(tn.value("branches").toInt()), lim("Branches")}};
        Ui::fill(ws, rows, {QJsonObject(), QJsonObject(), QJsonObject()});
        say(tn.value("setupDone").toBool(true) ? QString() : t("setup.banner"));
    }, [this](const QString& e) { say(e); });
}
void AdminPage::loadInvites() {
    Api::I().call("GET", "/users/admin", QJsonValue(), this, [this](const QJsonValue& uv) {
        const QJsonArray users = uv.toArray(); QList<QStringList> rows; QList<QJsonObject> pay;
        for (const QJsonValue& xv : users) {
            const QJsonObject u = xv.toObject();
            rows << QStringList{u.value("displayName").toString(), u.value("username").toString(), u.value("role").toString(), u.value("invitePending").toBool() ? t("invite.pending") : (u.value("isActive").toBool() ? QString::fromUtf8("✓") : "-"),
                u.value("inviteToken").toString().isEmpty() ? QString() : Adm::inviteLink(u.value("inviteToken").toString())};
            pay << u;
        }
        Ui::fill(inv, rows, pay); say(users.isEmpty() ? t("adm.noInvites") : QString());
        Api::I().call("GET", "/org", QJsonValue(), this, [this](const QJsonValue& ov) {
            Api::I().call("GET", "/users/permissions", QJsonValue(), this, [this, ov](const QJsonValue& cv) {
                QStringList roles; for (const QJsonValue& r : cv.toObject().value("roles").toArray()) roles << r.toString();
                if (roles.isEmpty()) roles << "employee";
                form->load(roles, ov.toObject().value("branches").toArray());
            }, [this](const QString& e) { say(e); });
        }, [this](const QString& e) { say(e); });
    }, [this](const QString& e) { say(e); });
}
void AdminPage::resend() {
    QJsonObject u; if (!Ui::selected(inv, u)) return;
    Api::I().call("POST", "/users/admin/" + u.value("id").toString() + "/invite", QJsonObject{{"appUrl", Adm::webOrigin()}}, this, [this](const QJsonValue&) { say(t("adm.accept")); loadInvites(); }, [this](const QString& e) { say(e); });
}
void AdminPage::copyLink() {
    QJsonObject u; if (!Ui::selected(inv, u)) return;
    if (!u.value("inviteToken").toString().isEmpty()) { QGuiApplication::clipboard()->setText(Adm::inviteLink(u.value("inviteToken").toString())); say(t("invite.copied")); }
    else say(t("invite.resend"));
}
void AdminPage::loadBilling() {
    Api::I().call("GET", "/billing/summary", QJsonValue(), this, [this](const QJsonValue& sv) {
        const QJsonObject s = sv.toObject();
        kpi->setText(t("bill.users") + ": <b>" + QString::number(s.value("users").toInt()) + "</b> &nbsp; " + t("bill.rate") + ": <b>" + Adm::money(s.value("unitPrice").toDouble()) + "</b> (" + t("bill.perUserMonth") + ") &nbsp; " + t("bill.estimate") + ": <b>" + Adm::money(s.value("estimate").toDouble()) +
            "</b> &nbsp; " + t("bill.balance") + ": <b>" + Adm::money(s.value("balance").toDouble()) + "</b> (" + QString::number(s.value("openInvoices").toInt()) + " " + t("bill.open") + ")<br><span style=\"color:#64748b\">" +
            rep(rep(rep(t("bill.pricing"), "p", QString::number(s.value("pricePerUser").toDouble())), "v", QString::number(s.value("volumePrice").toDouble())), "n", QString::number(s.value("volumeFrom").toDouble())) + "</span>");
        QList<QStringList> lr; QList<QJsonObject> lp;
        for (const QJsonValue& lv : s.value("lines").toArray()) { const QJsonObject l = lv.toObject(); lr << QStringList{l.value("branchName").toString(), QString::number(l.value("users").toInt()), Adm::money(l.value("amount").toDouble())}; lp << l; }
        Ui::fill(lines, lr, lp);
        Api::I().call("GET", "/billing/invoices", QJsonValue(), this, [this](const QJsonValue& iv) {
            QList<QStringList> rows; QList<QJsonObject> pay;
            for (const QJsonValue& xv : iv.toArray()) {
                const QJsonObject i = xv.toObject(); const QString st = i.value("status").toString();
                rows << QStringList{i.value("number").toString(), i.value("period").toString(), QString("%1 x %2").arg(i.value("users").toInt()).arg(Adm::money(i.value("unitPrice").toDouble())),
                    Adm::money(i.value("total").toDouble()) + " (~" + QString::number(i.value("totalSar").toDouble(), 'f', 2) + " SAR)", i.value("dueAt").toString().left(10),
                    st == "paid" ? t("bill.paid") : (i.value("overdue").toBool() ? t("bill.overdue") : t("bill.unpaid"))};
                pay << i;
            }
            Ui::fill(invs, rows, pay); say("");
        }, [this](const QString& e) { say(e); });
    }, [this](const QString& e) { say(e); });
}
void AdminPage::pay() {
    QJsonObject i; if (!Ui::selected(invs, i) || i.value("status").toString() != "open") return;
    Api::I().call("POST", "/billing/invoices/" + i.value("id").toString() + "/pay", QJsonObject{{"returnUrl", Adm::webOrigin() + "/admin?tab=billing"}}, this, [this](const QJsonValue& v) {
        const QString url = v.toObject().value("url").toString();
        if (!url.isEmpty()) { QDesktopServices::openUrl(QUrl(url)); say(t("adm.payOpened")); } else say(t("bill.testMode") + ": " + t("bill.testHint"));
    }, [this](const QString& e) { say(e); });
}
void AdminPage::check() {
    QJsonObject i; if (!Ui::selected(invs, i)) return;
    Api::I().call("POST", "/billing/invoices/" + i.value("id").toString() + "/confirm", QJsonObject(), this, [this](const QJsonValue& v) { say(v.toObject().value("status").toString() == "paid" ? t("bill.thanks") : t("bill.notPaid")); loadBilling(); }, [this](const QString& e) { say(e); });
}
void AdminPage::sandbox() {
    QJsonObject i; if (!Ui::selected(invs, i) || i.value("status").toString() != "open") return;
    Api::I().call("POST", "/billing/invoices/" + i.value("id").toString() + "/sandbox-pay", QJsonObject(), this, [this](const QJsonValue&) { say(t("bill.thanks")); loadBilling(); }, [this](const QString& e) { say(e); });
}
void AdminPage::printInv() {
    QJsonObject i; if (!Ui::selected(invs, i)) return;
    const QString path = QDir(QStandardPaths::writableLocation(QStandardPaths::TempLocation)).filePath(i.value("number").toString() + ".html");
    QFile f(path); if (f.open(QIODevice::WriteOnly)) { f.write(Adm::invoiceHtml(i).toUtf8()); f.close(); QDesktopServices::openUrl(QUrl::fromLocalFile(path)); say(path); }
}
