#include "OpsPage.h"

#include <QDate>
#include <QDialog>
#include <QFile>
#include <QFileDialog>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QLabel>
#include <QLocale>
#include <QPushButton>
#include <QSharedPointer>
#include <QTextStream>
#include <algorithm>
#include <cmath>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

namespace Ops {
const QJsonObject& spec() {
    static QJsonObject s = [] { QFile f(":/ops.json"); f.open(QIODevice::ReadOnly); return QJsonDocument::fromJson(f.readAll()).object(); }();
    return s;
}
static int ix() { return I18n::lang() == "ar" ? 1 : 0; }
QString L(const QString& key, const QStringList& args) {
    QString s = spec().value("labels").toObject().value(key).toArray().at(ix()).toString();
    for (int i = 0; i < args.size(); ++i) s.replace(QString("{%1}").arg(i), args[i]);
    return s;
}
QString tx(const QJsonObject& o) { return o.value(I18n::lang() == "ar" ? "ar" : "en").toString(); }
double num(const QJsonValue& v) { double n = v.isString() ? v.toString().toDouble() : v.toDouble(); return std::isfinite(n) ? n : 0; }
double r2(double v) { return std::round((v + 1e-9) * 100) / 100; }
static QString money(double v) { return QLocale(QLocale::English).toString(v, 'f', 2); }

Cost bomCost(const QJsonObject& bom, const QMap<QString, QJsonObject>& items, double rate, double overheadPct) {
    const QJsonObject d = bom.value("data").toObject();
    const double out = std::max(0.0001, num(d.value("qty")) != 0 ? num(d.value("qty")) : 1);
    double mat = 0;
    for (const QJsonValue& lv : d.value("lines").toArray()) {
        const QJsonObject l = lv.toObject();
        mat += num(l.value("qty")) * (1 + num(l.value("scrapPct")) / 100) * num(items.value(l.value("sku").toString()).value("cost"));
    }
    Cost c;
    c.material = r2(mat);
    c.labor = r2(num(d.value("routingMinutes")) / 60 * rate);
    c.overhead = r2(c.labor * overheadPct / 100);
    c.total = r2(c.material + c.labor + c.overhead);
    c.unit = r2(c.total / out);
    return c;
}

QList<MrpRow> mrp(const QList<QJsonObject>& demands, const QJsonArray& boms, const QMap<QString, double>& onHand, const QMap<QString, double>& scheduled, const QMap<QString, QJsonObject>& items) {
    QMap<QString, QJsonObject> bomBy;
    for (const QJsonValue& b : boms) if (b.toObject().value("status").toString() != "Inactive") bomBy[b.toObject().value("code").toString()] = b.toObject();
    QMap<QString, double> freeS = onHand, sched = scheduled;
    QMap<QString, MrpRow> rows;
    std::function<void(const QString&, double, int, const QString&)> need = [&](const QString& sku, double qty, int level, const QString& due) {
        if (qty <= 0 || level > 12) return;
        if (!rows.contains(sku)) { MrpRow r; r.sku = sku; r.name = items.value(sku).value("name").toString(); r.onHand = std::max(0.0, onHand.value(sku)); r.scheduled = std::max(0.0, scheduled.value(sku)); r.action = "ok"; r.level = level; r.due = due; rows[sku] = r; }
        MrpRow& row = rows[sku];
        row.gross = r2(row.gross + qty);
        row.level = std::max(row.level, level);
        const double fromStock = std::min(std::max(0.0, freeS.value(sku)), qty);
        freeS[sku] = freeS.value(sku) - fromStock;
        double left = qty - fromStock;
        const double fromOrders = std::min(std::max(0.0, sched.value(sku)), left);
        sched[sku] = sched.value(sku) - fromOrders;
        left = r2(left - fromOrders);
        if (left <= 0) return;
        row.net = r2(row.net + left);
        const bool has = bomBy.contains(sku);
        row.action = has ? "make" : "buy";
        if (has) {
            const QJsonObject d = bomBy[sku].value("data").toObject();
            const double out = std::max(0.0001, num(d.value("qty")) != 0 ? num(d.value("qty")) : 1);
            for (const QJsonValue& lv : d.value("lines").toArray()) {
                const QJsonObject l = lv.toObject();
                need(l.value("sku").toString(), r2(left / out * num(l.value("qty")) * (1 + num(l.value("scrapPct")) / 100)), level + 1, due);
            }
        }
    };
    for (const QJsonObject& d : demands) need(d.value("sku").toString(), num(d.value("qty")), 0, d.value("due").toString());
    QList<MrpRow> out = rows.values();
    std::sort(out.begin(), out.end(), [](const MrpRow& a, const MrpRow& b) { return a.level != b.level ? a.level < b.level : a.sku < b.sku; });
    return out;
}

void projectReady(const QJsonObject& p, const QJsonArray& ts, const QJsonArray& cs, const QJsonArray& ms, double& ready, double& billed) {
    const QString code = p.value("code").toString();
    const QJsonObject d = p.value("data").toObject();
    ready = 0;
    if (d.value("billingModel").toString() == "tm") {
        for (const QJsonValue& v : ts) { const QJsonObject t = v.toObject(), x = t.value("data").toObject(); if (t.value("ref").toString() == code && t.value("status").toString() == "Approved" && x.value("billable").toBool()) ready += num(x.value("hours")) * num(x.value("rate")); }
        for (const QJsonValue& v : cs) { const QJsonObject c = v.toObject(), x = c.value("data").toObject(); if (c.value("ref").toString() == code && c.value("status").toString() == "Open" && x.value("billable").toBool()) ready += num(x.value("amount")) * (1 + num(x.value("markupPct")) / 100); }
    } else {
        for (const QJsonValue& v : ms) { const QJsonObject m = v.toObject(); if (m.value("ref").toString() == code && m.value("status").toString() == "Achieved") ready += num(m.value("data").toObject().value("amount")); }
    }
    ready = r2(ready);
    billed = r2(num(d.value("billed")));
}
}  // namespace Ops

using Ops::L;

static bool allowed(const QJsonObject& r) {
    for (const QJsonValue& p : r.value("view").toArray()) if (Api::I().can(p.toString())) return true;
    return false;
}

OpsPage::OpsPage() {
    for (const QJsonValue& r : Ops::spec().value("reports").toArray()) if (allowed(r.toObject())) reports.append(r);
    auto* l = new QVBoxLayout(this);
    l->addWidget(Ui::label(L("title"), "title"));
    auto* bar = new QHBoxLayout;
    pick = new QComboBox;
    for (const QJsonValue& r : reports) pick->addItem(Ops::tx(r.toObject()), r.toObject().value("id").toString());
    connect(pick, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this] { reload(); });
    bar->addWidget(pick, 1);
    dFrom = new QLineEdit(QDate::currentDate().toString("yyyy-MM-01")); dTo = new QLineEdit(QDate::currentDate().toString(Qt::ISODate));
    dFrom->setPlaceholderText(L("from") + " yyyy-mm-dd"); dTo->setPlaceholderText(L("to") + " yyyy-mm-dd");
    for (QLineEdit* e : {dFrom, dTo}) { e->setMaximumWidth(130); bar->addWidget(e); }
    bar->addWidget(Ui::button(L("refresh"), [this] { reload(); }));
    bWo = Ui::button({}, [this] { makeOrders(); });
    bBuy = Ui::button(L("exportBuy"), [this] { exportBuy(); }, "ghost");
    bBill = Ui::button(L("createInvoice"), [this] { bill(); });
    bCsv = Ui::button(L("csv"), [this] { exportVat(); }, "ghost");
    for (QPushButton* b : {bWo, bBuy, bBill, bCsv}) bar->addWidget(b);
    l->addLayout(bar);
    mrpBox = new QWidget;
    auto* mb = new QHBoxLayout(mrpBox);
    mb->setContentsMargins(0, 0, 0, 0);
    mSku = new QComboBox; mQty = new QLineEdit("1"); mDue = new QLineEdit(QDate::currentDate().toString(Qt::ISODate));
    mQty->setMaximumWidth(90); mDue->setMaximumWidth(120);
    mStock = new QCheckBox(L("useStock")); mStock->setChecked(true);
    connect(mStock, &QCheckBox::stateChanged, this, [this] { refreshMrp(); });
    mb->addWidget(mSku); mb->addWidget(mQty); mb->addWidget(mDue);
    mb->addWidget(Ui::button(L("add"), [this] { addDemand(); }));
    mb->addWidget(Ui::button(L("remove"), [this] { delDemand(); }, "ghost"));
    mb->addWidget(mStock);
    l->addWidget(mrpBox);
    mList = new QLabel; l->addWidget(mList);
    stack = new QStackedWidget;
    table = Ui::table({});
    stack->addWidget(table);
    form = new QWidget;
    auto* fl = new QFormLayout(form);
    for (const QJsonValue& zv : Ops::spec().value("zatca").toArray()) {
        const QJsonObject z = zv.toObject();
        auto* e = new QLineEdit;
        if (z.value("max").toInt() > 0) e->setMaxLength(z.value("max").toInt());
        fields[z.value("key").toString()] = e;
        fl->addRow(Ops::tx(z), e);
    }
    bSave = Ui::button(L("save"), [this] { saveProfile(); });
    fl->addRow(bSave);
    stack->addWidget(form);
    l->addWidget(stack, 1);
    foot = new QLabel; msg = new QLabel;
    l->addWidget(foot); l->addWidget(msg);
}

void OpsPage::reload() {
    if (reports.isEmpty()) { msg->setText(L("noperm")); return; }
    rep = QJsonObject();
    for (const QJsonValue& r : reports) if (r.toObject().value("id").toString() == pick->currentData().toString()) rep = r.toObject();
    const QString id = rep.value("id").toString();
    dFrom->setVisible(id == "vat"); dTo->setVisible(id == "vat");
    mrpBox->setVisible(id == "mrp"); mList->setVisible(id == "mrp");
    bWo->setVisible(false); bBuy->setVisible(false);
    bBill->setVisible(id == "projbill"); bCsv->setVisible(id == "vat");
    stack->setCurrentIndex(id == "zatca" ? 1 : 0);
    QStringList heads;
    for (const QJsonValue& c : rep.value("cols").toArray()) heads << Ops::tx(c.toObject());
    table->setColumnCount(heads.size());
    table->setHorizontalHeaderLabels(heads);
    msg->setText(QString::fromUtf8("…"));
    data.clear();
    // what each report reads: key -> path (optional ones may fail)
    QList<QPair<QString, QString>> gets;
    if (id == "mrp" || id == "cost" || id == "variance") { gets << qMakePair(QString("bom"), QString("/erp/mfg/records/bom?take=5000")); gets << qMakePair(QString("items"), QString("/erp/mfg/items")); }
    if (id == "mrp") { gets << qMakePair(QString("orders"), QString("/erp/mfg/records/workorder?take=5000")); gets << qMakePair(QString("stock"), QString("/erp/mfg/stock")); }
    if (id == "cost") { gets << qMakePair(QString("wc"), QString("/erp/mfg/records/workcenter?take=5000")); gets << qMakePair(QString("setting"), QString("/erp/mfg/records/setting?take=5000")); }
    if (id == "variance") gets << qMakePair(QString("orders"), QString("/erp/mfg/records/workorder?take=5000"));
    if (id == "projbill") for (const char* k : {"project", "timesheet", "cost", "milestone"}) gets << qMakePair(QString(k), QString("/erp/prj/records/%1?take=5000").arg(k));
    if (id == "vat") gets << qMakePair(QString("vat"), QString("/finance/zatca/vat-return?from=%1&to=%2").arg(dFrom->text().trimmed(), dTo->text().trimmed()));
    if (id == "zatca") gets << qMakePair(QString("profile"), QString("/finance/zatca/profile"));
    auto left = QSharedPointer<int>::create(gets.size());
    const QJsonObject mine = rep;
    auto done = [this, left, mine](const QString& k, const QJsonValue& v) { data[k] = v; if (--*left == 0 && mine.value("id") == rep.value("id")) showData(); };
    for (const auto& g : gets)
        Api::I().call("GET", g.second, QJsonValue(), this, [done, k = g.first](const QJsonValue& v) { done(k, v); }, [this, done, k = g.first](const QString& e) { if (k == "vat" || k == "profile" || k == "bom") msg->setText(e); done(k, QJsonArray()); });
}

QMap<QString, QJsonObject> OpsPage::itemMap() const {
    QMap<QString, QJsonObject> m;
    for (const QJsonValue& v : data.value("items").toArray()) m[v.toObject().value("sku").toString()] = v.toObject();
    return m;
}
QMap<QString, double> OpsPage::stockMap() const {
    QMap<QString, double> m;
    for (const QJsonValue& v : data.value("stock").toArray()) m[v.toObject().value("sku").toString()] = Ops::num(v.toObject().value("qty"));
    return m;
}
QMap<QString, double> OpsPage::schedMap() const {
    QMap<QString, double> m;
    for (const QJsonValue& v : data.value("orders").toArray()) {
        const QJsonObject o = v.toObject();
        const QString s = o.value("status").toString();
        if (s == "Planned" || s == "Released" || s == "InProgress") m[o.value("data").toObject().value("sku").toString()] += Ops::num(o.value("data").toObject().value("qty"));
    }
    return m;
}

static QString money(double v) { return QLocale(QLocale::English).toString(v, 'f', 2); }

void OpsPage::showData() {
    const QString id = rep.value("id").toString();
    msg->setText({});
    if (id == "zatca") {
        const QJsonObject p = data.value("profile").toObject();
        for (auto it = fields.begin(); it != fields.end(); ++it) it.value()->setText(p.value(it.key()).toString());
        bSave->setVisible(Api::I().can("gov.zatca.manage") || Api::I().can("finance.setup"));
        foot->setText(L("profileHint"));
        return;
    }
    if (id == "mrp") {
        mSku->clear();
        for (const QJsonValue& b : data.value("bom").toArray()) mSku->addItem(b.toObject().value("code").toString() + " · " + b.toObject().value("data").toObject().value("name").toString(), b.toObject().value("code").toString());
        refreshMrp();
        return;
    }
    paint();
}

void OpsPage::paint() {
    const QString id = rep.value("id").toString();
    QList<QStringList> rows;
    QList<QJsonObject> pay;
    QString f;
    if (id == "mrp") {
        const bool us = mStock->isChecked();
        plan = Ops::mrp(demand, data.value("bom").toArray(), us ? stockMap() : QMap<QString, double>(), us ? schedMap() : QMap<QString, double>(), itemMap());
        for (const Ops::MrpRow& r : plan) {
            rows << QStringList{QString(r.level * 4, ' ') + r.sku + (r.name.isEmpty() ? "" : "  " + r.name), money(r.gross), money(r.onHand), money(r.scheduled), money(r.net), L(r.action)};
            pay << QJsonObject{{"sku", r.sku}};
        }
    } else if (id == "cost") {
        QMap<QString, double> rates;
        for (const QJsonValue& w : data.value("wc").toArray()) rates[w.toObject().value("code").toString()] = Ops::num(w.toObject().value("data").toObject().value("costPerHour"));
        double pct = Ops::spec().value("defaultOverheadPct").toDouble();
        for (const QJsonValue& s : data.value("setting").toArray()) {
            const QJsonValue v = s.toObject().value("data").toObject().value("overheadPct");
            if (s.toObject().value("code").toString() == "defaults" && !v.isNull() && !v.isUndefined() && v.toVariant().toString() != "") pct = Ops::num(v);
        }
        const auto items = itemMap();
        for (const QJsonValue& bv : data.value("bom").toArray()) {
            const QJsonObject b = bv.toObject();
            const auto c = Ops::bomCost(b, items, rates.value(b.value("data").toObject().value("workCenter").toString()), pct);
            rows << QStringList{b.value("code").toString() + "  " + b.value("data").toObject().value("name").toString(), money(c.material), money(c.labor), money(c.overhead), money(c.total), money(c.unit)};
            pay << b;
        }
        f = L("overheadPct") + ": " + QString::number(pct) + "%";
    } else if (id == "variance") {
        for (const QJsonValue& ov : data.value("orders").toArray()) {
            const QJsonObject o = ov.toObject(), x = o.value("data").toObject();
            if (o.value("status").toString() != "Completed") continue;
            rows << QStringList{o.value("code").toString(), x.value("sku").toString(), money(Ops::num(x.value("goodQty"))), money(Ops::num(x.value("materialCost"))), money(Ops::num(x.value("laborCost"))), money(Ops::num(x.value("overheadCost"))), money(Ops::num(x.value("actualCost"))), money(Ops::num(x.value("standardCost"))), money(Ops::num(x.value("variance")))};
            pay << o;
        }
    } else if (id == "projbill") {
        for (const QJsonValue& pv : data.value("project").toArray()) {
            const QJsonObject p = pv.toObject(), x = p.value("data").toObject();
            double ready, billed;
            Ops::projectReady(p, data.value("timesheet").toArray(), data.value("cost").toArray(), data.value("milestone").toArray(), ready, billed);
            const QString m = x.value("billingModel").toString().isEmpty() ? "tm" : x.value("billingModel").toString();
            rows << QStringList{p.value("code").toString() + "  " + x.value("name").toString(), x.value("customer").toString().isEmpty() ? "-" : x.value("customer").toString(), L("bm." + m), money(ready), money(billed)};
            QJsonObject o = p; o["_ready"] = ready;
            pay << o;
        }
    } else if (id == "vat") {
        const QJsonObject v = data.value("vat").toObject();
        for (const char* side : {"sales", "purchases"}) for (const QJsonValue& bv : v.value(side).toArray()) { const QJsonObject b = bv.toObject(); rows << QStringList{L(side), b.value("category").toString(), QString::number(b.value("count").toInt()), money(Ops::num(b.value("net"))), money(Ops::num(b.value("vat")))}; pay << QJsonObject(); }
        const QPair<const char*, const char*> codes[] = {{"sales", "salesByCode"}, {"purchases", "purchasesByCode"}};
        for (const auto& c : codes) for (const QJsonValue& bv : v.value(c.second).toArray()) { const QJsonObject b = bv.toObject(); rows << QStringList{L(c.first) + " · " + L("byCode"), b.value("code").toString(), QString::number(b.value("count").toInt()), money(Ops::num(b.value("net"))), money(Ops::num(b.value("vat")))}; pay << QJsonObject(); }
        rows << QStringList{L("total") + " · " + L("sales"), "", QString::number(v.value("salesInvoices").toInt()), money(Ops::num(v.value("salesNet"))), money(Ops::num(v.value("outputVat")))};
        rows << QStringList{L("total") + " · " + L("purchases"), "", QString::number(v.value("purchaseInvoices").toInt()), money(Ops::num(v.value("purchasesNet"))), money(Ops::num(v.value("inputVat")))};
        pay << QJsonObject() << QJsonObject();
        const double nd = Ops::num(v.value("netVatDue"));
        f = QString("%1: %2   %3: %4   %5: %6 / %7 %8/%9").arg(L("out"), money(Ops::num(v.value("outputVat"))), L("in"), money(Ops::num(v.value("inputVat"))), nd >= 0 ? L("netDue") : L("netRefund"), money(std::fabs(nd)), L("einv")).arg(v.value("einvoiced").toInt()).arg(v.value("salesInvoices").toInt());
        if (v.value("notEinvoiced").toInt() > 0) f += "\n" + L("notEinv", {QString::number(v.value("notEinvoiced").toInt())});
        const int miss = v.value("warnings").toObject().value("missingTaxCode").toArray().size();
        if (miss > 0) f += "\n" + L("missingCode", {QString::number(miss)});
    }
    Ui::fill(table, rows, pay);
    const QJsonArray cols = rep.value("cols").toArray();
    for (int r = 0; r < table->rowCount(); ++r)
        for (int c = 0; c < cols.size(); ++c)
            if (cols[c].toObject().value("num").toBool() && table->item(r, c)) table->item(r, c)->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
    foot->setText(f);
    msg->setText(!pending.isEmpty() ? pending : (rows.isEmpty() ? L("empty") : QString()));
    pending.clear();
}

void OpsPage::addDemand() {
    const QString sku = mSku->currentData().toString();
    const double q = Ops::num(mQty->text());
    if (sku.isEmpty() || q <= 0) return;
    demand << QJsonObject{{"sku", sku}, {"qty", q}, {"due", mDue->text().trimmed()}};
    refreshMrp();
}
void OpsPage::delDemand() { if (!demand.isEmpty()) { demand.removeLast(); refreshMrp(); } }

void OpsPage::refreshMrp() {
    if (rep.value("id").toString() != "mrp" || !data.contains("bom")) return;
    QStringList parts;
    for (const QJsonObject& d : demand) parts << QString("%1 × %2 (%3)").arg(d.value("sku").toString()).arg(Ops::num(d.value("qty"))).arg(d.value("due").toString());
    mList->setText(parts.isEmpty() ? L("mrpHint") : parts.join("  |  "));
    paint();
    int make = 0, buy = 0;
    for (const auto& r : plan) { if (r.action == "make") ++make; if (r.action == "buy") ++buy; }
    bWo->setVisible(make > 0 && Api::I().can("mfg.orders.manage"));
    bWo->setText(L("createWo", {QString::number(make)}));
    bBuy->setVisible(buy > 0);
}

void OpsPage::makeOrders() {
    QMap<QString, QJsonObject> boms;
    for (const QJsonValue& b : data.value("bom").toArray()) boms[b.toObject().value("code").toString()] = b.toObject();
    QString due = QDate::currentDate().toString(Qt::ISODate);
    for (const QJsonObject& d : demand) if (!d.value("due").toString().isEmpty()) { due = d.value("due").toString(); break; }
    QList<Ops::MrpRow> make;
    for (const auto& r : plan) if (r.action == "make") make << r;
    auto left = QSharedPointer<int>::create(make.size());
    auto made = QSharedPointer<int>::create(0);
    auto fin = [this, left, made] {
        if (--*left > 0) return;
        const int n = *made;
        Api::I().call("GET", "/erp/mfg/records/workorder?take=5000", QJsonValue(), this, [this, n](const QJsonValue& v) { data["orders"] = v; refreshMrp(); msg->setText(L("created", {QString::number(n)})); }, [this](const QString& e) { msg->setText(e); });
    };
    for (const auto& r : make) {
        const QJsonObject bd = boms.value(r.sku).value("data").toObject();
        QJsonObject d{{"sku", r.sku}, {"qty", r.net}, {"due", r.due.isEmpty() ? due : r.due}, {"priority", "Normal"}, {"workCenter", bd.value("workCenter").toString()}, {"lines", bd.value("lines")}, {"bomQty", bd.value("qty")}, {"routingMinutes", bd.value("routingMinutes")}, {"source", "MRP"}};
        Api::I().call("POST", "/erp/mfg/records/workorder", QJsonObject{{"status", "Planned"}, {"data", d}}, this, [made, fin](const QJsonValue&) { ++*made; fin(); }, [this, fin](const QString& e) { msg->setText(e); fin(); });
    }
}

void OpsPage::exportBuy() {
    const QString path = QFileDialog::getSaveFileName(this, L("exportBuy"), "purchase-requirements.csv", "CSV (*.csv)");
    if (path.isEmpty()) return;
    QFile f(path);
    if (!f.open(QIODevice::WriteOnly)) return;
    QTextStream ts(&f);
    ts.setGenerateByteOrderMark(true);
    ts << "sku,name,quantity\n";
    for (const auto& r : plan) if (r.action == "buy") { QString n = r.name; n.replace('"', "\"\""); ts << r.sku << ",\"" << n << "\"," << r.net << "\n"; }
    msg->setText(path);
}

void OpsPage::bill() {
    QJsonObject p;
    if (!Ui::selected(table, p) || p.isEmpty()) return;
    if (p.value("_ready").toDouble() <= 0 || p.value("data").toObject().value("customer").toString().isEmpty()) { msg->setText(L("noReady")); return; }
    QDialog d(this);
    d.setWindowTitle(L("createInvoice") + " · " + p.value("code").toString());
    auto* fl = new QFormLayout(&d);
    auto* dt = new QLineEdit(QDate::currentDate().toString(Qt::ISODate));
    auto* terms = new QLineEdit("30");
    auto* tax = new QLineEdit(QString::number(Ops::spec().value("defaultTax").toDouble()));
    fl->addRow(L("date"), dt); fl->addRow(L("terms"), terms); fl->addRow(L("tax"), tax);
    auto* err = new QLabel; fl->addRow(err);
    auto* go = Ui::button(L("createInvoice"), [&] { d.accept(); });
    fl->addRow(go);
    if (d.exec() == QDialog::Accepted) billNow(p, dt->text().trimmed(), int(Ops::num(terms->text())), Ops::num(tax->text()));
}

void OpsPage::billNow(const QJsonObject& proj, const QString& date, int terms, double tax) {
    Api::I().call("POST", "/erp/prj/projects/" + proj.value("id").toString() + "/bill", QJsonObject{{"taxPct", tax}, {"date", date}, {"termsDays", terms}}, this,
        [this](const QJsonValue& v) { lastInvoice = v.toObject().value("invoice").toString(); pending = L("billDone", {lastInvoice, QString::number(Ops::num(v.toObject().value("total")))}); reload(); },
        [this](const QString& e) { Ui::warn(this, e); });
}

void OpsPage::exportVat() {
    const QJsonObject v = data.value("vat").toObject();
    if (v.isEmpty()) return;
    const QString path = QFileDialog::getSaveFileName(this, L("csv"), QString("vat-return-%1-%2.csv").arg(v.value("from").toString(), v.value("to").toString()), "CSV (*.csv)");
    if (path.isEmpty()) return;
    QFile f(path);
    if (!f.open(QIODevice::WriteOnly)) return;
    QTextStream ts(&f);
    ts.setGenerateByteOrderMark(true);
    ts << "side,category,count,net,vat\n";
    for (const char* side : {"sales", "purchases"}) for (const QJsonValue& bv : v.value(side).toArray()) { const QJsonObject b = bv.toObject(); ts << side << "," << b.value("category").toString() << "," << b.value("count").toInt() << "," << Ops::num(b.value("net")) << "," << Ops::num(b.value("vat")) << "\n"; }
    ts << "sales,TOTAL," << v.value("salesInvoices").toInt() << "," << Ops::num(v.value("salesNet")) << "," << Ops::num(v.value("outputVat")) << "\n";
    ts << "purchases,TOTAL," << v.value("purchaseInvoices").toInt() << "," << Ops::num(v.value("purchasesNet")) << "," << Ops::num(v.value("inputVat")) << "\n";
    ts << "net vat due,,,," << Ops::num(v.value("netVatDue")) << "\n";
    msg->setText(path);
}

void OpsPage::saveProfile() {
    QJsonObject b;
    for (auto it = fields.begin(); it != fields.end(); ++it) b[it.key()] = it.value()->text().trimmed();
    if (b.value("sellerName").toString().isEmpty()) { msg->setText(L("sellerReq")); return; }
    if (!b.value("vatNo").toString().isEmpty() && b.value("vatNo").toString().size() != 15) { msg->setText(L("vatLen")); return; }
    Api::I().call("PUT", "/finance/zatca/profile", b, this, [this](const QJsonValue&) { msg->setText(L("saved")); }, [this](const QString& e) { msg->setText(e); });
}
