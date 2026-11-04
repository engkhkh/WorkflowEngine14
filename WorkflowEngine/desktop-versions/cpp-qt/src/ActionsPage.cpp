#include "ActionsPage.h"

#include <QDate>
#include <QDialog>
#include <QFileDialog>
#include <QFormLayout>
#include <QPlainTextEdit>
#include <QTimer>
#include <QFile>
#include <QHBoxLayout>
#include <QJsonDocument>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

namespace Act {
double r2(double v) { return std::round(v * 100) / 100.0; }
QString nextMonth(const QString& p) {
    int y = p.left(4).toInt(), m = p.mid(5, 2).toInt();
    return m == 12 ? QString("%1-01").arg(y + 1) : QString("%1-%2").arg(y).arg(m + 1, 2, 10, QChar('0'));
}
QStringList periodsDue(const QJsonObject& d, const QString& upTo) {
    const QString last = d.value("lastPeriod").toString();
    const QString start = !last.isEmpty() ? nextMonth(last) : d.value("inServiceDate").toString().left(7);
    QStringList out;
    if (start.size() != 7 || start > upTo) return out;
    QString p = start;
    while (p <= upTo && out.size() < 600) { out << p; p = nextMonth(p); }
    return out;
}
Dep depreciationDue(const QJsonObject& d, const QString& upTo) {
    Dep r;
    double acc = d.value("accumulated").toDouble(), cost = d.value("cost").toDouble(), salvage = d.value("salvage").toDouble(), total = 0;
    const int life = std::max(1, int(std::round(d.value("lifeMonths").toDouble(60))));
    for (const QString& p : periodsDue(d, upTo)) {
        const double nbv = cost - acc;
        double m = d.value("method").toString() == "DB" ? nbv * (2.0 / life) : (cost - salvage) / life;
        m = std::max(0.0, std::min(m, nbv - salvage));
        if (m <= 0.004) break;
        acc += m; total += m; r.last = p; r.months++;
    }
    r.amount = r2(total);
    return r;
}
double invoiceTotal(const QJsonObject& d) { return d.value("total").toDouble() > 0 ? d.value("total").toDouble() : d.value("amount").toDouble() + d.value("taxAmount").toDouble(); }
QString matchInvoice(const QJsonObject& d, double tol) {
    if (d.value("poNo").toString().trimmed().isEmpty()) return "NoPO";
    const double limit = std::min(d.value("poAmount").toDouble(), d.value("receivedAmount").toDouble());
    if (limit <= 0) return "Mismatch";
    return invoiceTotal(d) <= limit * (1 + tol / 100) ? "Matched" : "Mismatch";
}
QJsonArray ledgerLines(const QString& side, const QJsonObject& rec, const QJsonObject& df) {
    const QJsonObject d = rec.value("data").toObject();
    const double total = r2(invoiceTotal(d)), tax = r2(d.value("taxAmount").toDouble()), net = r2(total - tax);
    auto has = [&](const char* k) { return !df.value(k).toString().isEmpty(); };
    auto line = [&](const QString& acc, double dr, double cr, const QString& memo, bool dims) {
        QJsonObject l{{"account", acc}, {"debit", dr}, {"credit", cr}, {"memo", memo}};
        if (dims) { l["costCenter"] = d.value("costCenter").toString(); l["project"] = d.value("project").toString(); }
        return l;
    };
    QJsonArray out;
    if (side == "ap") {
        const QString exp = !d.value("account").toString().isEmpty() ? d.value("account").toString() : df.value("expenseAccount").toString();
        if (!has("apAccount") || exp.isEmpty()) return out;
        const bool vat = tax != 0 && has("vatInput");
        out.append(line(exp, vat ? net : total, 0, d.value("vendor").toString(), true));
        if (vat) out.append(line(df.value("vatInput").toString(), tax, 0, "VAT", false));
        out.append(line(df.value("apAccount").toString(), 0, total, d.value("vendor").toString(), false));
        return out;
    }
    const QString rev = !d.value("account").toString().isEmpty() ? d.value("account").toString() : df.value("revenueAccount").toString();
    if (!has("arAccount") || rev.isEmpty()) return out;
    const bool vat = tax != 0 && has("vatOutput");
    out.append(line(df.value("arAccount").toString(), total, 0, d.value("customer").toString(), false));
    out.append(line(rev, 0, vat ? net : total, d.value("customer").toString(), true));
    if (vat) out.append(line(df.value("vatOutput").toString(), 0, tax, "VAT", false));
    return out;
}
}  // namespace Act

static QString rep(QString s, const QString& k, const QString& v) { return s.replace("{" + k + "}", v); }
static QJsonObject D(const QJsonObject& r) { return r.value("data").toObject(); }
/// A list the user may not read just stays empty.
static void list(QObject* ctx, const QString& path, std::function<void(const QJsonArray&)> done) {
    Api::I().call("GET", path, QJsonValue(), ctx, [done](const QJsonValue& v) { done(v.toArray()); }, [done](const QString&) { done(QJsonArray()); });
}

ActionsPage::ActionsPage() {
    lay->addWidget(Ui::label(t("act.title"), "title"));
    tabs = new QTabWidget; lay->addWidget(tabs, 1);
    msg = new QLabel; lay->addWidget(msg);
    auto add = [&](const char* perm, const char* key, void (ActionsPage::*build)(QWidget*), void (ActionsPage::*load)()) {
        if (!Api::I().can(perm)) return;
        auto* w = new QWidget; (this->*build)(w); tabs->addTab(w, t(key)); views << [this, load] { (this->*load)(); };
    };
    add("mfg.view", "act.v.wo", &ActionsPage::buildWo, &ActionsPage::loadWo);
    add("finance.gl.view", "act.v.per", &ActionsPage::buildPer, &ActionsPage::loadPer);
    add("finance.assets.view", "act.v.depr", &ActionsPage::buildDep, &ActionsPage::loadDep);
    add("finance.ar.view", "act.v.inv", &ActionsPage::buildInv, &ActionsPage::loadInv);
    connect(tabs, &QTabWidget::currentChanged, this, [this](int i) { if (i >= 0 && i < views.size()) views[i](); });
}
void ActionsPage::reload() { const int i = tabs->currentIndex(); if (i >= 0 && i < views.size()) views[i](); }

// ------------------------------------------------------------ work orders
void ActionsPage::buildWo(QWidget* w) {
    auto* v = new QVBoxLayout(w);
    wo = Ui::table({t("act.code"), t("act.sku"), t("act.qty"), t("act.due"), t("act.status"), t("mfg.wo.actual"), t("mfg.wo.variance")});
    v->addWidget(wo, 1);
    auto* row = new QHBoxLayout;
    bRel = Ui::button(t("mfg.wo.release"), [this] { step("release"); });
    bStart = Ui::button(t("mfg.wo.start"), [this] { step("start"); });
    bDone = Ui::button(t("mfg.wo.complete"), [this] { complete(); });
    bCancel = Ui::button(t("mfg.wo.cancel"), [this] { step("cancel"); }, "danger");
    for (auto* b : {bRel, bStart, bDone, bCancel}) row->addWidget(b);
    row->addStretch(1); row->addWidget(Ui::button(t("act.refresh"), [this] { loadWo(); }, "ghost"));
    v->addLayout(row);
    auto* f = new QWidget; auto* h = new QHBoxLayout(f);
    bom = new QComboBox; qty = new QDoubleSpinBox; qty->setRange(0.01, 1e9); qty->setValue(1);
    due = new QLineEdit(QDate::currentDate().addDays(7).toString(Qt::ISODate));
    h->addWidget(new QLabel(t("act.bom"))); h->addWidget(bom); h->addWidget(new QLabel(t("act.qty"))); h->addWidget(qty); h->addWidget(new QLabel(t("act.due"))); h->addWidget(due);
    h->addWidget(Ui::button(t("act.create"), [this] { createWo(); }));
    f->setVisible(Api::I().can("mfg.orders.manage"));
    v->addWidget(f);
    connect(wo, &QTableWidget::itemSelectionChanged, this, [this] { gateWo(); });
    gateWo();
}
void ActionsPage::gateWo() {
    QJsonObject r; Ui::selected(wo, r);
    const QString s = r.value("status").toString();
    const bool mg = Api::I().can("mfg.orders.manage"), ex = Api::I().can("mfg.orders.execute");
    bRel->setEnabled(s == "Planned" && mg); bStart->setEnabled(s == "Released" && ex); bDone->setEnabled(s == "InProgress" && ex); bCancel->setEnabled((s == "Planned" || s == "Released") && mg);
}
void ActionsPage::loadWo() {
    list(this, "/erp/mfg/records/workorder?take=5000", [this](const QJsonArray& a) {
        woRows = a;
        list(this, "/erp/mfg/records/bom?take=5000", [this](const QJsonArray& b) {
            boms = b;
            list(this, "/erp/mfg/stock", [this](const QJsonArray& s) {
                stock.clear();
                for (const QJsonValue& x : s) stock[x.toObject().value("sku").toString()] = x.toObject().value("qty").toDouble();
                QList<QStringList> rows; QList<QJsonObject> pay;
                for (const QJsonValue& rv : woRows) {
                    const QJsonObject r = rv.toObject(), d = D(r);
                    auto g = [&](const char* k) { const QJsonValue v = d.value(k); return v.isUndefined() || v.isNull() ? QString() : v.isString() ? v.toString() : QString::number(v.toDouble()); };
                    rows.append({r.value("code").toString(), g("sku"), g("qty"), g("due"), r.value("status").toString(), g("actualCost"), g("variance")}); pay.append(r);
                }
                Ui::fill(wo, rows, pay);
                bom->clear();
                for (const QJsonValue& bv : boms) { const QJsonObject b = bv.toObject(); if (b.value("status").toString() != "Inactive") bom->addItem(b.value("code").toString() + " · " + D(b).value("name").toString(), QJsonValue(b).toObject()); }
                gateWo();
            });
        });
    });
}
void ActionsPage::step(const QString& a) {
    QJsonObject r; if (!Ui::selected(wo, r)) return;
    Api::I().call("POST", "/mfg/workorders/" + r.value("id").toString() + "/" + a, QJsonObject(), this, [this](const QJsonValue&) { say(t("act.done")); loadWo(); }, [this](const QString& e) { Ui::warn(this, e); });
}
void ActionsPage::complete() {
    QJsonObject r; if (!Ui::selected(wo, r)) return;
    const QJsonObject d = D(r);
    QDialog dlg(this); dlg.setWindowTitle(t("mfg.wo.complete") + " " + r.value("code").toString());
    auto* lv = new QVBoxLayout(&dlg); auto* form = new QFormLayout;
    auto* q = new QDoubleSpinBox, * sc = new QDoubleSpinBox, * hr = new QDoubleSpinBox;
    for (auto* s : {q, sc, hr}) { s->setRange(0, 1e9); s->setDecimals(2); }
    q->setValue(d.value("qty").toDouble());
    const double bq = d.value("bomQty").toDouble(1) > 0 ? d.value("bomQty").toDouble(1) : 1;
    hr->setValue(Act::r2(d.value("routingMinutes").toDouble() / 60 * (d.value("qty").toDouble() / bq)));
    auto* note = new QLineEdit;
    form->addRow(t("mfg.wo.good"), q); form->addRow(t("mfg.wo.scrap"), sc); form->addRow(t("mfg.wo.hours"), hr); form->addRow(t("erp.f.notes"), note);
    lv->addLayout(form); lv->addWidget(Ui::label(t("mfg.wo.materials"), "title"));
    auto* mat = Ui::table({t("act.sku"), t("mfg.wo.need"), t("mfg.wo.have")}); lv->addWidget(mat);
    auto paint = [&] {
        const double f = (q->value() + sc->value()) / bq; QList<QStringList> rows; QList<QJsonObject> pay;
        for (const QJsonValue& lvv : d.value("lines").toArray()) {
            const QJsonObject l = lvv.toObject();
            rows.append({l.value("sku").toString(), QString::number(Act::r2(l.value("qty").toDouble() * f * (1 + l.value("scrapPct").toDouble() / 100))), QString::number(stock.value(l.value("sku").toString()))}); pay.append(QJsonObject());
        }
        Ui::fill(mat, rows, pay);
    };
    connect(q, qOverload<double>(&QDoubleSpinBox::valueChanged), &dlg, [&](double) { paint(); });
    connect(sc, qOverload<double>(&QDoubleSpinBox::valueChanged), &dlg, [&](double) { paint(); });
    paint();
    auto* ok = Ui::button(t("mfg.wo.complete"), [&] { dlg.accept(); }); lv->addWidget(ok);
    if (dlg.exec() != QDialog::Accepted) return;
    QJsonObject b{{"qty", q->value()}, {"scrap", sc->value()}, {"hours", hr->value()}, {"note", note->text()}};
    Api::I().call("POST", "/mfg/workorders/" + r.value("id").toString() + "/complete", b, this, [this](const QJsonValue&) { say(t("act.done")); loadWo(); }, [this](const QString& e) { Ui::warn(this, e); });
}
void ActionsPage::createWo() {
    const QJsonObject b = bom->currentData().toJsonObject();
    if (b.isEmpty()) return;
    const QJsonObject bd = D(b);
    QJsonObject data{{"sku", b.value("code")}, {"qty", qty->value()}, {"due", due->text()}, {"priority", "Normal"}, {"workCenter", bd.value("workCenter")}, {"lines", bd.value("lines")}, {"bomQty", bd.value("qty").isUndefined() ? QJsonValue(1) : bd.value("qty")}, {"routingMinutes", bd.value("routingMinutes").isUndefined() ? QJsonValue(0) : bd.value("routingMinutes")}};
    Api::I().call("POST", "/erp/mfg/records/workorder", QJsonObject{{"status", "Planned"}, {"data", data}}, this, [this](const QJsonValue& v) { say(rep(t("act.created"), "n", v.toObject().value("code").toString())); loadWo(); }, [this](const QString& e) { Ui::warn(this, e); });
}

// ------------------------------------------------------------ accounting periods
void ActionsPage::buildPer(QWidget* w) {
    auto* v = new QVBoxLayout(w);
    per = Ui::table({t("fin.per.code"), t("act.status")});
    v->addWidget(per, 1);
    auto* row = new QHBoxLayout;
    bClose = Ui::button(t("fin.per.close"), [this] { setPer("Closed"); });
    bOpen = Ui::button(t("fin.per.reopen"), [this] { setPer("Open"); }, "ghost");
    row->addWidget(bClose); row->addWidget(bOpen); row->addStretch(1);
    year = new QSpinBox; year->setRange(2000, 2100); year->setValue(QDate::currentDate().year());
    row->addWidget(new QLabel(t("act.year"))); row->addWidget(year);
    auto* g = Ui::button(t("fin.per.generate"), [this] { generate(); }); g->setVisible(Api::I().can("finance.gl.approve")); row->addWidget(g);
    v->addLayout(row);
    connect(per, &QTableWidget::itemSelectionChanged, this, [this] { gatePer(); });
    gatePer();
}
void ActionsPage::gatePer() {
    QJsonObject r; const bool has = Ui::selected(per, r); const QString s = r.value("status").toString();
    const bool ok = Api::I().can("finance.gl.approve");
    bClose->setEnabled(ok && has && s != "Closed"); bOpen->setEnabled(ok && s == "Closed");
}
void ActionsPage::loadPer() {
    list(this, "/finance/records/period", [this](const QJsonArray& a) {
        QList<QJsonObject> rs; for (const QJsonValue& v : a) rs << v.toObject();
        std::sort(rs.begin(), rs.end(), [](const QJsonObject& x, const QJsonObject& y) { return x.value("code").toString() < y.value("code").toString(); });
        perRows = QJsonArray(); QList<QStringList> rows;
        for (const QJsonObject& r : rs) { perRows.append(r); const QString s = r.value("status").toString().isEmpty() ? "Open" : r.value("status").toString(); rows.append({r.value("code").toString(), t("fin.st." + s)}); }
        Ui::fill(per, rows, rs); gatePer();
    });
}
void ActionsPage::setPer(const QString& status) {
    QJsonObject r; if (!Ui::selected(per, r)) return;
    Api::I().call("PUT", "/finance/records/period/" + r.value("id").toString(), QJsonObject{{"status", status}, {"data", r.value("data")}}, this, [this](const QJsonValue&) { loadPer(); }, [this](const QString& e) { Ui::warn(this, e); });
}
void ActionsPage::generate() {
    QSet<QString> have; for (const QJsonValue& v : perRows) have.insert(v.toObject().value("code").toString());
    auto todo = std::make_shared<QStringList>();
    for (int m = 1; m <= 12; ++m) { const QString c = QString("%1-%2").arg(year->value()).arg(m, 2, 10, QChar('0')); if (!have.contains(c)) *todo << c; }
    const int n = todo->size();
    auto next = std::make_shared<std::function<void(int)>>();
    *next = [this, todo, n, next](int i) {
        if (i >= n) { say(rep(t("act.perCreated"), "n", QString::number(n))); loadPer(); return; }
        Api::I().call("POST", "/finance/records/period", QJsonObject{{"code", todo->at(i)}, {"status", "Open"}, {"data", QJsonObject()}}, this, [next, i](const QJsonValue&) { (*next)(i + 1); }, [this](const QString& e) { Ui::warn(this, e); loadPer(); });
    };
    (*next)(0);
}

// ------------------------------------------------------------ depreciation
void ActionsPage::buildDep(QWidget* w) {
    auto* v = new QVBoxLayout(w);
    auto* top = new QHBoxLayout;
    month = new QLineEdit(QDate::currentDate().toString("yyyy-MM")); month->setMaximumWidth(110);
    connect(month, &QLineEdit::editingFinished, this, [this] { paintDep(); });
    top->addWidget(new QLabel(t("fin.asset.upTo"))); top->addWidget(month); top->addStretch(1); v->addLayout(top);
    dep = Ui::table({t("act.asset"), t("act.months"), t("act.amount")}); v->addWidget(dep, 1);
    total = new QLabel; v->addWidget(total);
    bRun = Ui::button(t("fin.asset.run"), [this] { runDep(); });
    bRun->setVisible(Api::I().can("finance.assets.manage") && Api::I().can("finance.gl.manage")); v->addWidget(bRun);
}
void ActionsPage::loadDep() {
    list(this, "/finance/records/asset", [this](const QJsonArray& a) {
        assets = a;
        list(this, "/finance/records/setting", [this](const QJsonArray& s) {
            defaults = QJsonObject();
            for (const QJsonValue& x : s) if (x.toObject().value("code").toString() == "defaults") defaults = D(x.toObject());
            paintDep();
        });
    });
}
void ActionsPage::paintDep() {
    items.clear(); QList<QStringList> rows; QList<QJsonObject> pay; double tot = 0;
    for (const QJsonValue& av : assets) {
        const QJsonObject a = av.toObject();
        if (a.value("status").toString() != "Active") continue;
        const Act::Dep d = Act::depreciationDue(D(a), month->text().trimmed());
        if (d.amount <= 0) continue;
        items.append({a, d}); tot += d.amount;
        rows.append({D(a).value("name").toString().isEmpty() ? a.value("code").toString() : D(a).value("name").toString(), QString::number(d.months), QString::number(d.amount, 'f', 2)}); pay.append(a);
    }
    Ui::fill(dep, rows, pay);
    total->setText(items.isEmpty() ? t("fin.asset.nothingDue") : t("act.total") + ": " + QString::number(Act::r2(tot), 'f', 2));
    bRun->setEnabled(!items.isEmpty());
}
void ActionsPage::runDep() {
    const QString m = month->text().trimmed();
    if (defaults.value("deprExpense").toString().isEmpty() || defaults.value("deprAccum").toString().isEmpty()) { Ui::warn(this, t("fin.needDefaults")); return; }
    double tot = 0; for (auto& it : items) tot += it.second.amount;
    tot = Act::r2(tot);
    const QDate first(m.left(4).toInt(), m.mid(5, 2).toInt(), 1);
    QJsonArray lines{QJsonObject{{"account", defaults.value("deprExpense")}, {"debit", tot}, {"credit", 0}, {"memo", m}}, QJsonObject{{"account", defaults.value("deprAccum")}, {"debit", 0}, {"credit", tot}, {"memo", m}}};
    QJsonObject data{{"date", QString("%1-%2").arg(m).arg(first.daysInMonth(), 2, 10, QChar('0'))}, {"memo", t("fin.asset.deprMemo") + " " + m}, {"reference", "DEPR-" + m}, {"rate", 1}, {"lines", lines}};
    auto its = std::make_shared<QList<QPair<QJsonObject, Act::Dep>>>(items);
    Api::I().call("POST", "/finance/records/journal", QJsonObject{{"status", "Draft"}, {"data", data}}, this, [this, its](const QJsonValue& jv) {
        const QString code = jv.toObject().value("code").toString();
        auto next = std::make_shared<std::function<void(int)>>();
        *next = [this, its, code, next](int i) {
            if (i >= its->size()) { say(rep(t("fin.asset.runDone"), "n", code)); loadDep(); return; }
            const QJsonObject a = its->at(i).first; QJsonObject nd = D(a);
            nd["accumulated"] = Act::r2(nd.value("accumulated").toDouble() + its->at(i).second.amount); nd["lastPeriod"] = its->at(i).second.last;
            Api::I().call("PUT", "/finance/records/asset/" + a.value("id").toString(), QJsonObject{{"status", a.value("status")}, {"data", nd}}, this, [next, i](const QJsonValue&) { (*next)(i + 1); }, [this](const QString& e) { Ui::warn(this, e); });
        };
        (*next)(0);
    }, [this](const QString& e) { Ui::warn(this, e); });
}

// ------------------------------------------------------------ invoices
void ActionsPage::buildInv(QWidget* w) {
    auto* v = new QVBoxLayout(w);
    side = new QComboBox; side->addItem(t("act.ar"), "ar"); side->addItem(t("act.ap"), "ap");
    connect(side, qOverload<int>(&QComboBox::currentIndexChanged), this, [this](int) { loadInv(); });
    v->addWidget(side);
    inv = Ui::table({t("act.code"), t("act.party"), t("act.inv.total"), t("act.status"), t("fin.ap.match"), t("act.gl")});
    v->addWidget(inv, 1);
    auto* row = new QHBoxLayout;
    bPost = Ui::button(t("act.post"), [this] { postInv(); });
    bEinv = Ui::button(t("act.einv"), [this] { einvoice(); }, "ghost");
    row->addWidget(bPost); row->addWidget(bEinv); row->addStretch(1); v->addLayout(row);
    connect(inv, &QTableWidget::itemSelectionChanged, this, [this] { gateInv(); });
    gateInv();
}
void ActionsPage::gateInv() {
    QJsonObject r; Ui::selected(inv, r);
    const bool ap = side->currentData().toString() == "ap"; const QString st = r.value("status").toString();
    const bool postable = !r.isEmpty() && r.value("data").toObject().value("glJournal").toString().isEmpty() && (ap ? (st == "Approved" || st == "Paid") : (st == "Issued" || st == "Paid"));
    bPost->setEnabled(postable && Api::I().can("finance.gl.manage"));
    bEinv->setVisible(!ap && (Api::I().can("finance.ar.view") || Api::I().can("gov.zatca.manage")));
    bEinv->setEnabled(st == "Issued" || st == "Paid");
}
void ActionsPage::loadInv() {
    list(this, "/finance/records/" + invKind(), [this](const QJsonArray& a) {
        invRows = a;
        list(this, "/finance/records/setting", [this](const QJsonArray& s) {
            invDefaults = QJsonObject(); tol = 2;
            for (const QJsonValue& x : s) {
                const QString c = x.toObject().value("code").toString();
                if (c == "defaults") invDefaults = D(x.toObject());
                if (c == "controls" && D(x.toObject()).contains("matchTolerancePct")) tol = D(x.toObject()).value("matchTolerancePct").toDouble(2);
            }
            const bool ap = side->currentData().toString() == "ap";
            QList<QStringList> rows; QList<QJsonObject> pay;
            for (const QJsonValue& rv : invRows) {
                const QJsonObject r = rv.toObject(), d = D(r); const QString st = r.value("status").toString().isEmpty() ? "Draft" : r.value("status").toString();
                rows.append({r.value("code").toString(), d.value(ap ? "vendor" : "customer").toString(), QString::number(Act::r2(Act::invoiceTotal(d)), 'f', 2), t("fin.st." + st), ap ? t("fin.match." + Act::matchInvoice(d, tol)) : QString(), d.value("glJournal").toString()}); pay.append(r);
            }
            Ui::fill(inv, rows, pay); gateInv();
        });
    });
}
void ActionsPage::postInv() {
    QJsonObject r; if (!Ui::selected(inv, r)) return;
    const QString sd = side->currentData().toString();
    const QJsonArray ls = Act::ledgerLines(sd, r, invDefaults);
    if (ls.isEmpty()) { Ui::warn(this, t("fin.needDefaults")); return; }
    const QJsonObject d = D(r);
    QJsonArray lines; for (const QJsonValue& l : ls) if (l.toObject().value("debit").toDouble() != 0 || l.toObject().value("credit").toDouble() != 0) lines.append(l);
    const QString who = d.value(sd == "ap" ? "vendor" : "customer").toString();
    QJsonObject jd{{"date", d.value("date").toString().left(10)}, {"memo", who + " · " + (sd == "ap" ? d.value("invoiceNo").toString() : r.value("code").toString())}, {"reference", r.value("code")}, {"currency", d.value("currency").toString()}, {"rate", d.value("rate").toDouble() > 0 ? d.value("rate").toDouble() : 1.0}, {"lines", lines}};
    const QString kind = invKind();
    Api::I().call("POST", "/finance/records/journal", QJsonObject{{"status", "Draft"}, {"data", jd}}, this, [this, r, d, kind](const QJsonValue& jv) {
        const QString code = jv.toObject().value("code").toString(); QJsonObject nd = d; nd["glJournal"] = code;
        Api::I().call("PUT", "/finance/records/" + kind + "/" + r.value("id").toString(), QJsonObject{{"status", r.value("status")}, {"data", nd}}, this, [this, code](const QJsonValue&) { say(rep(t("fin.inv.glDone"), "n", code)); loadInv(); }, [this](const QString& e) { Ui::warn(this, e); });
    }, [this](const QString& e) { Ui::warn(this, e); });
}
void ActionsPage::einvoice() {
    QJsonObject r; if (!Ui::selected(inv, r)) return;
    auto* dlg = new QDialog(this); dlg->setAttribute(Qt::WA_DeleteOnClose); dlg->setWindowTitle(t("gov.zatca.title") + " · " + r.value("code").toString()); dlg->resize(560, 360);
    auto* lv = new QVBoxLayout(dlg); auto* info = new QPlainTextEdit; info->setReadOnly(true); lv->addWidget(info);
    auto z = std::make_shared<QJsonObject>();
    auto* row = new QHBoxLayout; QPushButton* bIssue = nullptr; QPushButton* bXml = nullptr;
    auto paint = [=] {
        if (!z->value("issued").toBool()) info->setPlainText(t("gov.zatca.notIssued") + "\n\n" + t("gov.zatca.phaseNote"));
        else info->setPlainText(QStringList{t("gov.zatca.type") + ": " + z->value("type").toString(), t("gov.zatca.icv") + ": " + QString::number(z->value("icv").toInt()), "UUID: " + z->value("uuid").toString(), t("gov.zatca.hash") + ": " + z->value("hash").toString(), t("gov.zatca.pih") + ": " + z->value("pih").toString(),
            t("gov.zatca.issued") + ": " + z->value("issuedAt").toString() + " · " + z->value("issuedBy").toString(), t(z->value("signed").toBool() ? "gov.zatca.signed" : "gov.zatca.unsigned"), "", t("act.qr") + ":\n" + z->value("qr").toString()}.join("\n"));
    };
    const QString id = r.value("id").toString(), code = r.value("code").toString();
    bIssue = Ui::button(t("gov.zatca.issue"), [=] { Api::I().call("POST", "/finance/zatca/issue/" + id, QJsonObject(), dlg, [=](const QJsonValue& v) { *z = v.toObject(); paint(); }, [this](const QString& e) { Ui::warn(this, e); }); });
    bXml = Ui::button(t("act.xml"), [=] { const QString path = QFileDialog::getSaveFileName(dlg, t("act.xml"), code + ".xml", "XML (*.xml)"); if (path.isEmpty()) return; QFile f(path); if (f.open(QIODevice::WriteOnly)) f.write(z->value("xml").toString().toUtf8()); }, "ghost");
    row->addWidget(bIssue); row->addWidget(bXml); row->addStretch(1); row->addWidget(Ui::button(t("act.close"), [dlg] { dlg->accept(); }, "ghost")); lv->addLayout(row);
    Api::I().call("GET", "/finance/zatca/invoice/" + id, QJsonValue(), dlg, [=](const QJsonValue& v) { *z = v.toObject(); paint(); bIssue->setEnabled(!z->value("issued").toBool()); bXml->setEnabled(!z->value("xml").toString().isEmpty()); }, [info](const QString& e) { info->setPlainText(e); });
    connect(bIssue, &QPushButton::clicked, dlg, [=] { QTimer::singleShot(600, dlg, [=] { bIssue->setEnabled(!z->value("issued").toBool()); bXml->setEnabled(!z->value("xml").toString().isEmpty()); }); });
    dlg->open();
}
