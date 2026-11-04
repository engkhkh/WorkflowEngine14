#include "Finance.h"

#include <QDate>
#include <QFile>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QLocale>
#include <QPushButton>
#include <QSharedPointer>
#include <QVBoxLayout>
#include <algorithm>
#include <cmath>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

namespace Fin {
const QJsonObject& spec() {
    static QJsonObject s = [] { QFile f(":/finance.json"); f.open(QIODevice::ReadOnly); return QJsonDocument::fromJson(f.readAll()).object(); }();
    return s;
}
QString L(const QString& key, const QStringList& args) {
    QString s = spec().value("labels").toObject().value(key).toArray().at(I18n::lang() == "ar" ? 1 : 0).toString();
    for (int i = 0; i < args.size(); ++i) s.replace(QString("{%1}").arg(i), args[i]);
    return s;
}
QString tx(const QJsonObject& o) { return o.value(I18n::lang() == "ar" ? "ar" : "en").toString(); }
QString money(double v) { return QLocale(QLocale::English).toString(v, 'f', 2); }
double num(const QJsonValue& v) {
    double n = v.isString() ? v.toString().toDouble() : v.toDouble();
    return std::isfinite(n) ? n : 0;
}
double r2(double v) { return std::round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) / 100; }

namespace {
struct Line { QString journal, date, account, cc, project; double debit, credit; };
struct Tb { QString account, name, type; double debit, credit, balance; };

QList<Line> postedLines(const QJsonArray& journals, const Filters& f) {
    QList<Line> out;
    for (const QJsonValue& jv : journals) {
        const QJsonObject j = jv.toObject(), d = j.value("data").toObject();
        if (j.value("status").toString() != "Posted") continue;
        const QString dt = d.value("date").toString().left(10);
        if (dt.isEmpty() || (!f.from.isEmpty() && dt < f.from) || (!f.to.isEmpty() && dt > f.to)) continue;
        const QString co = j.value("company").toString();
        if (!f.company.isEmpty() && f.company != "ALL" && !co.isEmpty() && co != f.company) continue;
        const double rate = num(d.value("rate")) > 0 ? num(d.value("rate")) : 1;
        for (const QJsonValue& lv : d.value("lines").toArray()) {
            const QJsonObject l = lv.toObject();
            out.append({j.value("code").toString(), dt, l.value("account").toString(), l.value("costCenter").toString(), l.value("project").toString(), r2(num(l.value("debit")) * rate), r2(num(l.value("credit")) * rate)});
        }
    }
    return out;
}
QString accName(const QJsonObject& a) {
    const QJsonObject d = a.value("data").toObject();
    const bool ar = I18n::lang() == "ar";
    const QString n = ar && !d.value("nameAr").toString().isEmpty() ? d.value("nameAr").toString() : d.value("name").toString();
    return n.isEmpty() ? a.value("code").toString() : n;
}
QList<Tb> trialBalance(const QList<Line>& lines, const QJsonArray& accounts) {
    QMap<QString, QPair<double, double>> sums;
    for (const Line& l : lines) { auto& s = sums[l.account]; s.first += l.debit; s.second += l.credit; }
    QList<QJsonObject> accs;
    for (const QJsonValue& v : accounts) accs << v.toObject();
    std::sort(accs.begin(), accs.end(), [](const QJsonObject& a, const QJsonObject& b) { return a.value("code").toString() < b.value("code").toString(); });
    QList<Tb> rows;
    QSet<QString> seen;
    for (const QJsonObject& a : accs) {
        const QString code = a.value("code").toString();
        seen.insert(code);
        if (!sums.contains(code)) continue;
        const auto s = sums.value(code);
        const QString type = a.value("data").toObject().value("type").toString();
        const bool dn = type == "Asset" || type == "Expense";
        rows.append({code, accName(a), type, r2(s.first), r2(s.second), r2(dn ? s.first - s.second : s.second - s.first)});
    }
    for (auto it = sums.begin(); it != sums.end(); ++it)
        if (!seen.contains(it.key())) rows.append({it.key(), it.key(), "", r2(it.value().first), r2(it.value().second), r2(it.value().first - it.value().second)});
    return rows;
}
double sumType(const QList<Tb>& tb, const QString& type) { double s = 0; for (const Tb& r : tb) if (r.type == type) s += r.balance; return r2(s); }

double invoiceTotal(const QJsonObject& d) { return num(d.value("total")) > 0 ? num(d.value("total")) : num(d.value("amount")) + num(d.value("taxAmount")); }
double outstanding(const QJsonObject& r) {
    const QJsonObject d = r.value("data").toObject();
    return r2((invoiceTotal(d) - num(d.value("paid"))) * (num(d.value("rate")) > 0 ? num(d.value("rate")) : 1));
}
int bucketOf(qint64 late) { return late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4; }
QStringList moneyList(const QList<double>& v) { QStringList s; for (double x : v) s << money(x); return s; }
}  // namespace

Built build(const QString& rid, const QMap<QString, QJsonValue>& data, const Filters& f, const QString& today) {
    Built b;
    const bool ar = I18n::lang() == "ar";
    auto add = [&](const QStringList& r, const QJsonObject& p = QJsonObject()) { b.rows << r; b.payloads << p; };
    if (rid == "overview") {
        const QJsonObject s = data.value("summary").toObject();
        for (const QJsonValue& mv : spec().value("measures").toArray()) {
            const QJsonArray m = mv.toArray();
            const QString key = m.at(0).toString();
            QString v;
            if (key == "currentPeriod") v = s.value(key).toString("-") + (s.value("currentPeriodStatus").toString().isEmpty() ? "" : " (" + s.value("currentPeriodStatus").toString() + ")");
            else if (!s.contains(key)) v = "-";
            else if (key == "assetCount" || key == "activeProjects" || key == "journalsToApprove" || key == "invoicesToApprove") v = QString::number(int(num(s.value(key))));
            else v = money(num(s.value(key)));
            add({m.at(ar ? 2 : 1).toString(), v});
        }
        return b;
    }
    const QJsonArray accs = data.value("account").toArray();
    QMap<QString, QString> types;
    for (const QJsonValue& a : accs) types[a.toObject().value("code").toString()] = a.toObject().value("data").toObject().value("type").toString();
    auto typ = [&](const QString& c) { return types.value(c); };
    if (rid == "tb" || rid == "income" || rid == "balance" || rid == "budgets" || rid == "projects") {
        const QList<Line> lines = postedLines(data.value("journal").toArray(), f);
        const QList<Tb> tb = trialBalance(lines, accs);
        if (rid == "tb") {
            double td = 0, tc = 0;
            for (const Tb& r : tb) { add({r.account, r.name, r.type, money(r.debit), money(r.credit), money(r.balance)}); td += r.debit; tc += r.credit; }
            add({L("totals"), "", "", money(r2(td)), money(r2(tc)), ""});
        } else if (rid == "income") {
            for (const Tb& r : tb) if (r.type == "Revenue") add({L("revenue"), r.account, r.name, money(r.balance)});
            const double tr = sumType(tb, "Revenue"), te = sumType(tb, "Expense");
            add({L("totalrev"), "", "", money(tr)});
            for (const Tb& r : tb) if (r.type == "Expense") add({L("expense"), r.account, r.name, money(r.balance)});
            add({L("totalexp"), "", "", money(te)});
            add({L("net"), "", "", money(r2(tr - te))});
        } else if (rid == "balance") {
            const double ta = sumType(tb, "Asset"), tl = sumType(tb, "Liability"), ni = r2(sumType(tb, "Revenue") - sumType(tb, "Expense")), te = r2(sumType(tb, "Equity") + ni);
            for (const Tb& r : tb) if (r.type == "Asset") add({L("assets"), r.account, r.name, money(r.balance)});
            add({L("totass"), "", "", money(ta)});
            for (const Tb& r : tb) if (r.type == "Liability") add({L("liab"), r.account, r.name, money(r.balance)});
            add({L("totliab"), "", "", money(tl)});
            for (const Tb& r : tb) if (r.type == "Equity") add({L("equity"), r.account, r.name, money(r.balance)});
            add({L("netincome"), "", "", money(ni)});
            add({L("toteq"), "", "", money(te)});
            add({L("check"), "", "", money(r2(ta - tl - te))});
        } else if (rid == "budgets") {
            for (const QJsonValue& bv : data.value("budget").toArray()) {
                const QJsonObject d = bv.toObject().value("data").toObject();
                const int year = int(num(d.value("year")));
                const QString cc = d.value("costCenter").toString(), acc = d.value("account").toString();
                double actual = 0;
                for (const Line& l : lines)
                    if (l.date.startsWith(QString::number(year)) && typ(l.account) == "Expense" && (cc.isEmpty() || l.cc == cc) && (acc.isEmpty() || l.account == acc)) actual += l.debit - l.credit;
                actual = r2(actual);
                const double budget = num(d.value("amount"));
                add({cc, acc, QString::number(year), money(budget), money(actual), money(r2(budget - actual)), QString::number(budget > 0 ? int(std::round(actual / budget * 100)) : 0)});
            }
        } else {
            for (const QJsonValue& pv : data.value("project").toArray()) {
                const QString code = pv.toObject().value("code").toString();
                double rev = 0, cost = 0;
                for (const Line& l : lines) {
                    if (l.project != code) continue;
                    if (typ(l.account) == "Revenue") rev += l.credit - l.debit;
                    if (typ(l.account) == "Expense") cost += l.debit - l.credit;
                }
                rev = r2(rev); cost = r2(cost);
                add({code, money(rev), money(cost), money(r2(rev - cost)), QString::number(rev > 0 ? int(std::round((rev - cost) / rev * 100)) : 0)});
            }
        }
        return b;
    }
    if (rid == "ar" || rid == "ap") {
        const bool isAr = rid == "ar";
        const QStringList open = isAr ? QStringList{"Issued"} : QStringList{"Submitted", "Approved", "Held"};
        const QString key = isAr ? "customer" : "vendor";
        QMap<QString, QList<double>> m;
        for (const QJsonValue& rv : data.value(isAr ? "arinvoice" : "apinvoice").toArray()) {
            const QJsonObject r = rv.toObject(), d = r.value("data").toObject();
            if (!open.contains(r.value("status").toString())) continue;
            const double amt = outstanding(r);
            if (amt <= 0) continue;
            QString due = (d.value("dueDate").toString().isEmpty() ? d.value("date").toString() : d.value("dueDate").toString()).left(10);
            if (due.isEmpty()) due = today;
            const qint64 late = QDate::fromString(due, Qt::ISODate).daysTo(QDate::fromString(today, Qt::ISODate));
            QString p = d.value(key).toString();
            if (p.isEmpty()) p = QString::fromUtf8("—");
            if (!m.contains(p)) m[p] = QList<double>(5, 0);
            m[p][bucketOf(late)] += amt;
        }
        QList<QPair<double, QString>> order;
        for (auto it = m.begin(); it != m.end(); ++it) { double t = 0; for (double x : it.value()) t += x; order.append({r2(t), it.key()}); }
        std::sort(order.begin(), order.end(), [](const auto& a, const auto& c) { return a.first > c.first; });
        QList<double> totals(5, 0);
        double all = 0;
        for (const auto& o : order) {
            QList<double> bk;
            for (int i = 0; i < 5; ++i) { bk << r2(m[o.second][i]); totals[i] += bk[i]; }
            add(QStringList{o.second} + moneyList(bk) + QStringList{money(o.first)});
            all += o.first;
        }
        QList<double> tr; for (double x : totals) tr << r2(x);
        add(QStringList{L("totals")} + moneyList(tr) + QStringList{money(r2(all))});
        return b;
    }
    if (rid == "assets") {
        for (const QJsonValue& av : data.value("asset").toArray()) {
            const QJsonObject a = av.toObject(), d = a.value("data").toObject();
            const double cost = num(d.value("cost")), salvage = num(d.value("salvage")), acc = num(d.value("accumulated"));
            const int life = qMax(1, int(std::round(num(d.value("lifeMonths")) != 0 ? num(d.value("lifeMonths")) : 60)));
            const double nbv = r2(cost - acc);
            double monthly = d.value("method").toString() == "DB" ? nbv * (2.0 / life) : (cost - salvage) / life;
            monthly = qMax(0.0, qMin(monthly, nbv - salvage));
            const int left = monthly > 0 ? int(std::ceil((nbv - salvage) / qMax(monthly, 0.01))) : 0;
            add({a.value("code").toString(), d.value("name").toString(), money(cost), money(acc), money(nbv), money(r2(monthly)), QString::number(left)});
        }
        return b;
    }
    if (rid == "bank") {
        double opening = 0, rec = 0;
        int un = 0;
        for (const QJsonValue& av : data.value("bankaccount").toArray()) {
            const QJsonObject a = av.toObject();
            if (f.company.isEmpty() || a.value("code").toString() == f.company) opening += num(a.value("data").toObject().value("openingBalance"));
        }
        for (const QJsonValue& tv : data.value("banktxn").toArray()) {
            const QJsonObject t = tv.toObject(), d = t.value("data").toObject();
            if (!f.company.isEmpty() && d.value("account").toString() != f.company) continue;
            const bool done = d.value("reconciled").toBool();
            add({d.value("account").toString(), d.value("date").toString().left(10), d.value("description").toString(), money(num(d.value("amount"))), done ? L("yes") : QString()}, t);
            if (done) rec += num(d.value("amount")); else ++un;
        }
        b.foot = QString("%1: %2   %3: %4   %5: %6").arg(L("opening"), money(opening), L("reconciledbal"), money(r2(opening + rec)), L("unrec")).arg(un);
        return b;
    }
    if (rid == "audit") {
        for (const QJsonValue& av : data.value("audit").toArray()) {
            const QJsonObject a = av.toObject();
            add({a.value("at").toString().left(19).replace('T', ' '), a.value("userName").toString(), a.value("action").toString(), a.value("kind").toString(), a.value("code").toString(), a.value("summary").toString()});
        }
    }
    return b;
}
}  // namespace Fin

namespace {
const QMap<QString, QString>& viewPerm() {
    static const QMap<QString, QString> m{{"overview", "finance.reports.view"}, {"tb", "finance.gl.view"}, {"income", "finance.gl.view"}, {"balance", "finance.gl.view"}, {"ar", "finance.ar.view"}, {"ap", "finance.ap.view"},
        {"budgets", "finance.budget.view"}, {"projects", "finance.projects.view"}, {"assets", "finance.assets.view"}, {"bank", "finance.bank.view"}, {"audit", "finance.audit.view"}};
    return m;
}
QStringList kindsOf(const QString& id) {
    if (id == "tb" || id == "income" || id == "balance") return {"account", "journal"};
    if (id == "ar") return {"arinvoice"};
    if (id == "ap") return {"apinvoice"};
    if (id == "budgets") return {"account", "journal", "budget"};
    if (id == "projects") return {"account", "journal", "project"};
    if (id == "assets") return {"asset"};
    if (id == "bank") return {"bankaccount", "banktxn"};
    return {};
}
}  // namespace

FinancePage::FinancePage() {
    for (const QJsonValue& r : Fin::spec().value("reports").toArray())
        if (Api::I().can(viewPerm().value(r.toObject().value("id").toString()))) reports.append(r);
    auto* lay = new QVBoxLayout(this);
    lay->addWidget(Ui::label(Fin::L("title"), "title"));
    auto* bar = new QHBoxLayout;
    pick = new QComboBox;
    for (const QJsonValue& r : reports) pick->addItem(Fin::tx(r.toObject()), r.toObject().value("id").toString());
    connect(pick, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this] { reload(); });
    bar->addWidget(pick, 1);
    from = new QLineEdit(QDate::currentDate().toString("yyyy-01-01"));
    to = new QLineEdit;
    company = new QLineEdit;
    from->setPlaceholderText(Fin::L("from") + " yyyy-mm-dd");
    to->setPlaceholderText(Fin::L("to") + " yyyy-mm-dd");
    company->setPlaceholderText(Fin::L("company"));
    for (QLineEdit* w : {from, to, company}) { w->setMaximumWidth(150); connect(w, &QLineEdit::returnPressed, this, [this] { reload(); }); bar->addWidget(w); }
    bar->addWidget(Ui::button(Fin::L("refresh"), [this] { reload(); }));
    bRec = Ui::button(Fin::L("reconcile"), [this] { mark(true); });
    bUnrec = Ui::button(Fin::L("unreconcile"), [this] { mark(false); });
    bSeed = Ui::button(Fin::L("seed"), [this] {
        Api::I().call("POST", "/finance/accounts/seed", QJsonObject(), this, [this](const QJsonValue& v) { msg->setText(Fin::L("seeded", {QString::number(v.toObject().value("created").toInt())})); reload(); },
                      [this](const QString& e) { Ui::warn(this, e); });
    }, "ghost");
    for (QPushButton* b : {bRec, bUnrec, bSeed}) bar->addWidget(b);
    lay->addLayout(bar);
    table = Ui::table({});
    lay->addWidget(table, 1);
    foot = new QLabel;
    msg = new QLabel;
    lay->addWidget(foot);
    lay->addWidget(msg);
}

void FinancePage::reload() {
    if (reports.isEmpty()) { msg->setText(Fin::L("noperm")); return; }
    current = pick->currentData().toString();
    QJsonObject rep;
    for (const QJsonValue& r : reports) if (r.toObject().value("id").toString() == current) rep = r.toObject();
    const bool dates = rep.value("dates").toBool();
    from->setVisible(dates); to->setVisible(dates);
    const bool manage = current == "bank" && Api::I().can("finance.bank.manage");
    bRec->setVisible(manage); bUnrec->setVisible(manage);
    bSeed->setVisible(current == "tb" && Api::I().can("finance.setup"));
    QStringList heads;
    for (const QJsonValue& c : rep.value("cols").toArray()) heads << Fin::tx(c.toObject());
    table->setColumnCount(heads.size());
    table->setHorizontalHeaderLabels(heads);
    msg->setText(QString::fromUtf8("…"));
    data.clear();
    const QString id = current;
    const QString co = company->text().trimmed();
    auto finish = [this, id] { if (id == current) showData(id); };
    if (id == "overview" || id == "audit") {
        const QString path = id == "overview" ? "/finance/summary" + (co.isEmpty() ? QString() : "?company=" + co) : "/finance/audit";
        Api::I().call("GET", path, QJsonValue(), this, [this, id, finish](const QJsonValue& v) { data[id == "overview" ? "summary" : "audit"] = v; finish(); }, [this](const QString& e) { msg->setText(e); });
        return;
    }
    const QStringList kinds = kindsOf(id);
    auto left = QSharedPointer<int>::create(kinds.size());
    for (const QString& k : kinds) {
        const bool scoped = id != "bank" && (k == "journal" || k == "arinvoice" || k == "apinvoice" || k == "budget" || k == "asset");
        const QString path = "/finance/records/" + k + "?take=2000" + (scoped && !co.isEmpty() ? "&company=" + co : QString());
        auto done = [this, left, finish](const QString& kk, const QJsonValue& v) { data[kk] = v; if (--*left == 0) finish(); };
        Api::I().call("GET", path, QJsonValue(), this, [k, done](const QJsonValue& v) { done(k, v); }, [k, done](const QString&) { done(k, QJsonArray()); });
    }
}

void FinancePage::showData(const QString& id) {
    Fin::Filters f{from->text().trimmed(), to->text().trimmed(), company->text().trimmed()};
    const Fin::Built b = Fin::build(id, data, f, QDate::currentDate().toString(Qt::ISODate));
    Ui::fill(table, b.rows, b.payloads);
    QJsonObject rep;
    for (const QJsonValue& r : reports) if (r.toObject().value("id").toString() == id) rep = r.toObject();
    const QJsonArray cols = rep.value("cols").toArray();
    for (int r = 0; r < table->rowCount(); ++r)
        for (int c = 0; c < cols.size(); ++c)
            if (cols.at(c).toObject().value("num").toBool() && table->item(r, c)) table->item(r, c)->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
    foot->setText(b.foot);
    msg->setText(b.rows.isEmpty() ? Fin::L("empty") : QString());
}

void FinancePage::mark(bool v) {
    QJsonObject rec;
    if (!Ui::selected(table, rec) || rec.isEmpty()) return;
    QJsonObject d = rec.value("data").toObject();
    d["reconciled"] = v;
    QJsonObject body{{"code", rec.value("code")}, {"company", rec.value("company")}, {"status", rec.value("status")}, {"data", d}};
    Api::I().call("PUT", "/finance/records/banktxn/" + rec.value("id").toString(), body, this, [this](const QJsonValue&) { reload(); }, [this](const QString& e) { Ui::warn(this, e); });
}
