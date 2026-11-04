#include "Hospital.h"

#include <QCheckBox>
#include <QDate>
#include <QDialog>
#include <QDialogButtonBox>
#include <QFile>
#include <QDesktopServices>
#include <QDir>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QInputDialog>
#include <QJsonDocument>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QUrl>
#include <QUrlQuery>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

namespace Hos {

const QJsonArray& sections() {
    static QJsonArray s = [] { QFile f(":/hospital.json"); f.open(QIODevice::ReadOnly); return QJsonDocument::fromJson(f.readAll()).object().value("sections").toArray(); }();
    return s;
}

QString today() { return QDate::currentDate().toString(Qt::ISODate); }

QJsonValue getp(const QJsonValue& o, const QString& path) {
    QJsonValue cur = o;
    for (const QString& p : path.split('.')) {
        if (!cur.isObject()) return QJsonValue();
        cur = cur.toObject().value(p);
    }
    return cur;
}

void setp(QJsonObject& o, const QString& path, const QJsonValue& v) {
    const QStringList parts = path.split('.');
    if (parts.size() == 1) { o[parts[0]] = v; return; }
    QJsonObject child = o.value(parts[0]).toObject();
    setp(child, parts.mid(1).join('.'), v);
    o[parts[0]] = child;
}

QJsonValue templ(const QJsonValue& v, const QJsonObject& row) {
    if (!v.isString()) return v;
    QString s = v.toString();
    if (s == "$today") return today();
    if (s.startsWith('@')) return row.value("status").toString() == s.mid(1);
    if (s.startsWith('{') && s.endsWith('}') && s.count('{') == 1) return getp(row, s.mid(1, s.size() - 2));
    for (const char* k : {"id", "code", "parent", "ref"}) s.replace(QString("{%1}").arg(k), row.value(k).toString());
    return s;
}

static QString val(const QJsonValue& v) {
    if (v.isNull() || v.isUndefined()) return {};
    if (v.isString()) return v.toString();
    if (v.isBool()) return v.toBool() ? "true" : "false";
    if (v.isDouble()) { const double d = v.toDouble(); return d == std::floor(d) ? QString::number(qlonglong(d)) : QString::number(d); }
    return {};
}

QString cell(const QJsonObject& rec, const QJsonObject& col) {
    const QString p = col.value("p").toString(), ty = col.value("t").toString();
    const QJsonValue v = getp(rec, p);
    if (v.isNull() || v.isUndefined()) return {};
    if (ty == "items") {
        QStringList out;
        for (const QJsonValue& x : v.toArray()) {
            const QJsonObject i = x.toObject();
            out << QString("%1 %2 %3 %4 %5/%6").arg(val(i["name"]), val(i["strength"]), val(i["dose"]), val(i["frequency"]), val(i["dispensed"]).isEmpty() ? "0" : val(i["dispensed"]), val(i["qty"])).simplified();
        }
        return out.join("; ");
    }
    if (ty == "money") return QLocale(QLocale::English).toString(v.toDouble(), 'f', 2);
    if (v.isArray()) { QStringList o; for (const QJsonValue& x : v.toArray()) o << val(x); return o.join(", "); }
    QString s = val(v);
    if (p == "createdAt" || p == "data.start") return s.replace('T', ' ').left(16);
    return s;
}

QStringList flatten(const QJsonValue& o, int ind) {
    const QString pad = QString("  ").repeated(ind);
    QStringList out;
    if (o.isObject()) {
        const QJsonObject ob = o.toObject();
        for (auto it = ob.begin(); it != ob.end(); ++it) {
            const QJsonValue v = it.value();
            const bool nested = (v.isObject() && !v.toObject().isEmpty()) || (v.isArray() && !v.toArray().isEmpty());
            if (nested) { out << pad + it.key() + ":"; out << flatten(v, ind + 1); }
            else if (!v.isNull() && !(v.isString() && v.toString().isEmpty()) && !v.isObject() && !v.isArray()) out << pad + it.key() + ": " + val(v);
        }
    } else if (o.isArray()) {
        for (const QJsonValue& i : o.toArray()) {
            if (i.isObject() || i.isArray()) { out << pad + "-"; out << flatten(i, ind + 1); }
            else out << pad + "- " + val(i);
        }
    } else out << pad + val(o);
    return out;
}

QString dxText(const QJsonArray& a) {
    QStringList l;
    for (const QJsonValue& x : a) { const QJsonObject d = x.toObject(); l << (d["code"].toString().isEmpty() ? d["name"].toString() : d["code"].toString() + " | " + d["name"].toString()); }
    return l.join('\n');
}

QJsonArray dxList(const QString& txt) {
    QJsonArray out;
    for (QString ln : txt.split('\n')) {
        ln = ln.trimmed();
        if (ln.isEmpty()) continue;
        const int i = ln.indexOf('|');
        out.append(i >= 0 ? QJsonObject{{"code", ln.left(i).trimmed()}, {"name", ln.mid(i + 1).trimmed()}} : QJsonObject{{"code", ""}, {"name", ln}});
    }
    return out;
}

static bool toNum(const QVariant& v, double& d) {
    bool ok = false;
    d = v.toString().trimmed().toDouble(&ok);
    return ok;
}

QJsonObject buildBody(const QJsonObject& act, const QMap<QString, QVariant>& vals, const QJsonObject& row, bool keepEmpty) {
    QJsonObject body;
    QMap<QString, QStringList> joins;
    QStringList joinOrder;
    for (const QJsonValue& fv : act.value("fields").toArray()) {
        const QJsonObject f = fv.toObject();
        const QString k = f["k"].toString(), ty = f.value("t").toString("text");
        const QVariant raw = vals.value(k);
        QJsonValue v;   // Null = skip
        if (ty == "num") { double d; if (toNum(raw, d)) v = d; }
        else if (ty == "check") v = raw.toBool();
        else if (ty == "dx") { const QJsonArray a = dxList(raw.toString()); if (!a.isEmpty() || keepEmpty) v = a; }
        else { const QString s = raw.toString().trimmed(); if (!s.isEmpty() || keepEmpty) v = s; }
        if (f.contains("join")) {
            const QString j = f["join"].toString();
            if (!joins.contains(j)) joinOrder << j;
            joins[j] << raw.toString().trimmed();
        } else if (v.isNull()) continue;
        else if (k.endsWith("[]")) { QJsonArray a = body.value(k.chopped(2)).toArray(); a.append(v); body[k.chopped(2)] = a; }
        else if (k.contains("[].")) {
            const QString base = k.section("[].", 0, 0), sub = k.section("[].", 1);
            QJsonArray a = body.value(base).toArray();
            QJsonObject o = a.isEmpty() ? QJsonObject() : a[0].toObject();
            o[sub] = v; a = QJsonArray{o}; body[base] = a;
        } else setp(body, k, v);
    }
    for (const QString& j : joinOrder) { QStringList parts; for (const QString& p : joins[j]) if (!p.isEmpty()) parts << p; body[j] = parts.join('T'); }
    const QJsonObject st = act.value("body").toObject();
    for (auto it = st.begin(); it != st.end(); ++it) body[it.key()] = templ(it.value(), row);
    return body;
}

void run(const QJsonObject& sec, const QJsonObject& act, const QJsonObject& row, const QMap<QString, QVariant>& vals, const QJsonObject& extra, QObject* ctx,
         std::function<void(const QJsonValue&)> ok, std::function<void(const QString&, const QStringList&)> err) {
    auto fail = [err](const QString& m) {
        QStringList w;
        if (Api::I().lastErrStatus == 409) for (const QJsonValue& x : Api::I().lastErrBody.value("warnings").toArray()) w << x.toString();
        err(m, w);
    };
    const QString kind = sec["kind"].toString();
    auto call = [&](const char* m, const QString& path, const QJsonValue& b) { Api::I().call(m, "/hospital/" + path, b, ctx, ok, fail); };
    if (act.contains("get")) { call("GET", templ(act["get"], row).toString(), QJsonValue()); return; }
    if (act.contains("toggle")) {
        const QString st = row.value("status").toString() == act["toggle"].toString() ? act["back"].toString() : act["toggle"].toString();
        call("PUT", "records/" + kind + "/" + row["id"].toString(), QJsonObject{{"data", row["data"]}, {"branch", row["branch"]}, {"status", st}});
        return;
    }
    if (act.value("record").toString() == "update") {
        QJsonObject data = row.value("data").toObject();
        const QJsonObject nd = buildBody(act, vals, row, true).value("data").toObject();
        for (auto it = nd.begin(); it != nd.end(); ++it) data[it.key()] = it.value();
        call("PUT", "records/" + kind + "/" + row["id"].toString(), QJsonObject{{"data", data}, {"status", row["status"]}, {"branch", row["branch"]}});
        return;
    }
    if (act.value("record").toString() == "create") { call("POST", "records/" + kind, QJsonObject{{"data", buildBody(act, vals, {}, true).value("data").toObject()}}); return; }
    QJsonObject body = buildBody(act, vals, row);
    for (auto it = extra.begin(); it != extra.end(); ++it) body[it.key()] = it.value();
    if (act.contains("put")) call("PUT", templ(act["put"], row).toString(), body);
    else call("POST", templ(act["post"], row).toString(), body);
}
}  // namespace Hos

// ---------------------------------------------------------------- form dialog
namespace {
struct Opt { QString v, l; };

QList<Opt> optionsOf(const QJsonObject& f, const QJsonArray& recs) {
    QList<Opt> out;
    if (f.contains("opts")) { for (const QJsonValue& o : f["opts"].toArray()) out << Opt{o.toString(), o.toString()}; return out; }
    const QJsonObject s = f["src"].toObject();
    out << Opt{"", ""};
    for (const QJsonValue& rv : recs) {
        const QJsonObject r = rv.toObject();
        if (r["status"].toString() == "Inactive") continue;
        out << Opt{Hos::getp(r, s.value("v").toString("code")).toString(), Hos::getp(r, s.value("l").toString("data.name")).toString() + " · " + r["code"].toString()};
    }
    return out;
}

class FormDlg : public QDialog {
public:
    FormDlg(QWidget* parent, const QString& title, const QJsonArray& fields, const QJsonObject& row, const QMap<QString, QJsonArray>& recs) : QDialog(parent), fields_(fields) {
        setWindowTitle(title);
        setMinimumWidth(460);
        auto* lay = new QVBoxLayout(this);
        auto* form = new QFormLayout;
        for (const QJsonValue& fv : fields) {
            const QJsonObject f = fv.toObject();
            const QString ty = f.value("t").toString("text"), k = f["k"].toString();
            QJsonValue d;
            if (f.contains("from")) d = Hos::getp(row, f["from"].toString());
            if ((d.isNull() || d.isUndefined()) && f.contains("def")) d = Hos::templ(f["def"], row);
            QWidget* w;
            if (ty == "select") {
                auto* c = new QComboBox;
                for (const Opt& o : optionsOf(f, recs.value(k))) c->addItem(o.l, o.v);
                const int i = c->findData(d.isString() ? d.toString() : QString());
                c->setCurrentIndex(qMax(0, i));
                w = c;
            } else if (ty == "check") {
                auto* c = new QCheckBox; c->setChecked(d.toBool()); w = c;
            } else if (ty == "area" || ty == "dx") {
                auto* e = new QPlainTextEdit(ty == "dx" ? Hos::dxText(d.toArray()) : d.toString());
                e->setFixedHeight(70); w = e;
            } else {
                QString s;
                if (d.isDouble()) s = Hos::cell(QJsonObject{{"x", d}}, QJsonObject{{"p", "x"}}); else s = d.toString();
                w = new QLineEdit(s);
            }
            w_[k] = w;
            form->addRow((I18n::lang() == "ar" ? f["ar"].toString() : f["en"].toString()) + (f["req"].toBool() ? " *" : ""), w);
        }
        lay->addLayout(form);
        err_ = Ui::label("", "error");
        lay->addWidget(err_);
        auto* bb = new QDialogButtonBox;
        bb->addButton(t("hos.ui.run"), QDialogButtonBox::AcceptRole);
        bb->addButton(t("common.cancel"), QDialogButtonBox::RejectRole);
        connect(bb, &QDialogButtonBox::accepted, this, [this] {
            const auto v = values();
            for (const QJsonValue& fv : fields_) {
                const QJsonObject f = fv.toObject();
                const QVariant x = v.value(f["k"].toString());
                if (f["req"].toBool() && (x.toString().isEmpty() && !x.toBool())) { err_->setText((I18n::lang() == "ar" ? f["ar"].toString() : f["en"].toString()) + " *"); return; }
            }
            accept();
        });
        connect(bb, &QDialogButtonBox::rejected, this, &QDialog::reject);
        lay->addWidget(bb);
    }
    QMap<QString, QVariant> values() const {
        QMap<QString, QVariant> out;
        for (auto it = w_.begin(); it != w_.end(); ++it) {
            QWidget* w = it.value();
            if (auto* c = qobject_cast<QComboBox*>(w)) out[it.key()] = c->currentData();
            else if (auto* k = qobject_cast<QCheckBox*>(w)) out[it.key()] = k->isChecked();
            else if (auto* p = qobject_cast<QPlainTextEdit*>(w)) out[it.key()] = p->toPlainText();
            else out[it.key()] = qobject_cast<QLineEdit*>(w)->text();
        }
        return out;
    }
private:
    QJsonArray fields_;
    QMap<QString, QWidget*> w_;
    QLabel* err_;
};
}  // namespace

// ---------------------------------------------------------------- section
HosSection::HosSection(const QJsonObject& s) : sec(s) {
    auto* lay = new QVBoxLayout(this);
    auto* bar = new QHBoxLayout;
    q = new QLineEdit; q->setPlaceholderText(t("common.search")); q->setVisible(s.value("search").toBool());
    connect(q, &QLineEdit::returnPressed, this, [this] { reload(); });
    day = new QLineEdit(Hos::today()); day->setMaximumWidth(120); day->setVisible(s.value("day").toBool());
    connect(day, &QLineEdit::returnPressed, this, [this] { reload(); });
    status = new QComboBox;
    for (const QJsonValue& v : s.value("status").toArray()) status->addItem(v.toString().isEmpty() ? t("hos.ui.all") : v.toString(), v.toString());
    status->setVisible(s.contains("status"));
    connect(status, &QComboBox::currentIndexChanged, this, [this] { reload(); });
    bar->addWidget(q); bar->addWidget(day); bar->addWidget(status);
    bar->addWidget(Ui::button(t("common.refresh"), [this] { reload(); }));
    if (s.contains("create")) { const QJsonObject c = s["create"].toObject(); bar->addWidget(Ui::button(I18n::lang() == "ar" ? c["ar"].toString() : c["en"].toString(), [this, c] { act(c, true); }, "primary")); }
    bar->addStretch(1);
    lay->addLayout(bar);
    err = Ui::label("", "error");
    lay->addWidget(err);
    QStringList heads;
    for (const QJsonValue& c : s["columns"].toArray()) heads << (I18n::lang() == "ar" ? c.toObject()["ar"].toString() : c.toObject()["en"].toString());
    table = Ui::table(heads);
    connect(table, &QTableWidget::itemSelectionChanged, this, [this] { selChanged(); });
    lay->addWidget(table, 3);
    auto* ab = new QHBoxLayout;
    for (const QJsonValue& av : s.value("actions").toArray()) {
        const QJsonObject a = av.toObject();
        auto* b = Ui::button(I18n::lang() == "ar" ? a["ar"].toString() : a["en"].toString(), [this, a] { act(a, false); });
        btns[a["id"].toString()] = b;
        ab->addWidget(b);
    }
    ab->addStretch(1);
    lay->addLayout(ab);
    detail = new QTextBrowser; detail->setMaximumHeight(170); detail->hide();
    lay->addWidget(detail);
    selChanged();
}

void HosSection::reload() {
    err->clear();
    QUrlQuery qs;
    qs.addQueryItem("take", QString::number(sec.value("take").toInt(200)));
    if (sec.value("search").toBool() && !q->text().trimmed().isEmpty()) qs.addQueryItem("q", q->text().trimmed());
    if (sec.value("day").toBool()) qs.addQueryItem("ref", day->text().trimmed());
    if (sec.contains("status") && !status->currentData().toString().isEmpty()) qs.addQueryItem("status", status->currentData().toString());
    Api::I().call("GET", "/hospital/records/" + sec["kind"].toString() + "?" + qs.toString(QUrl::FullyEncoded), QJsonValue(), this,
                  [this](const QJsonValue& v) { paint(v.toArray()); }, [this](const QString& m) { err->setText(m); });
}

void HosSection::paint(const QJsonArray& r) {
    rows = r;
    QList<QStringList> cells;
    QList<QJsonObject> pay;
    for (const QJsonValue& rv : r) {
        QStringList c;
        for (const QJsonValue& col : sec["columns"].toArray()) c << Hos::cell(rv.toObject(), col.toObject());
        cells << c; pay << rv.toObject();
    }
    Ui::fill(table, cells, pay);
    selChanged();
}

void HosSection::selChanged() {
    QJsonObject r;
    const bool has = Ui::selected(table, r);
    for (const QJsonValue& av : sec.value("actions").toArray()) {
        const QJsonObject a = av.toObject();
        bool ok = has;
        if (ok && a.contains("when")) { ok = false; for (const QJsonValue& w : a["when"].toArray()) if (w.toString() == r["status"].toString()) ok = true; }
        btns[a["id"].toString()]->setEnabled(ok);
    }
}

void HosSection::act(const QJsonObject& a, bool creating) {
    QJsonObject row;
    if (!creating && !Ui::selected(table, row)) return;
    if (a["confirm"].toBool() && !Ui::ask(this, t("hos.ui.confirm"), t("common.yes"), t("common.no"))) return;
    const QJsonArray fields = a.value("fields").toArray();
    if (fields.isEmpty()) { perform(a, row, {}); return; }
    // load the lists behind the select boxes, then open the form
    auto recs = std::make_shared<QMap<QString, QJsonArray>>();
    QList<QJsonObject> need;
    for (const QJsonValue& fv : fields) { const QJsonObject f = fv.toObject(); if (f.value("t").toString() == "select" && f.contains("src")) need << f; }
    auto openForm = [this, a, row, fields, recs] {
        FormDlg d(this, I18n::lang() == "ar" ? a["ar"].toString() : a["en"].toString(), fields, row, *recs);
        if (d.exec()) perform(a, row, d.values());
    };
    auto left = std::make_shared<int>(need.size());
    if (need.isEmpty()) { openForm(); return; }
    for (const QJsonObject& f : need) {
        const QJsonObject s = f["src"].toObject();
        QUrlQuery qs; qs.addQueryItem("take", QString::number(s.value("take").toInt(200)));
        const QJsonObject pr = s.value("params").toObject();
        for (auto it = pr.begin(); it != pr.end(); ++it) qs.addQueryItem(it.key(), it.value().toString());
        Api::I().call("GET", "/hospital/records/" + s["kind"].toString() + "?" + qs.toString(QUrl::FullyEncoded), QJsonValue(), this,
                      [=](const QJsonValue& v) { (*recs)[f["k"].toString()] = v.toArray(); if (--*left == 0) openForm(); },
                      [this](const QString& m) { err->setText(m); });
    }
}

/// A printable page for one hospital invoice (items, tax, insurance, payments, balance); opened in the browser.
static QString invoiceHtml(const QJsonObject& r) {
    using I18n::t;
    auto e = [](const QString& v) { return v.toHtmlEscaped(); };
    auto str = [](const QJsonValue& v) { return v.isString() ? v.toString() : v.isNull() || v.isUndefined() ? QString() : QString::number(v.toDouble(), 'g', 12); };
    auto m = [](const QJsonValue& v) { return QLocale(QLocale::English).toString(v.toDouble(), 'f', 2); };
    const QJsonObject d = r.value("data").toObject();
    QString rows;
    for (const QJsonValue& lv : d.value("lines").toArray()) { const QJsonObject l = lv.toObject(); rows += "<tr><td>" + e(str(l.value("desc"))) + "</td><td class=\"n\">" + e(str(l.value("qty"))) + "</td><td class=\"n\">" + m(l.value("price")) + "</td><td class=\"n\">" + m(l.value("amount")) + "</td></tr>"; }
    auto tot = [&](const QString& label, const QString& v, bool b = false) { return "<tr><td colspan=\"3\" class=\"n\">" + (b ? "<b>" + label + "</b>" : label) + "</td><td class=\"n\">" + (b ? "<b>" + v + "</b>" : v) + "</td></tr>"; };
    QString out;
    if (d.value("tax").toDouble() != 0) out += tot(t("hos.pr.subtotal"), m(d.value("gross"))) + tot(e(d.value("taxName").toString().isEmpty() ? QString("VAT") : d.value("taxName").toString()) + " (" + e(str(d.value("taxPct"))) + "%)", m(d.value("tax")));
    out += tot(t("hos.pr.total"), m(d.contains("total") ? d.value("total") : d.value("gross")), true);
    if (d.value("insurance").toDouble() != 0) out += tot(e(d.value("insuranceName").toString()) + " (" + e(str(d.value("insurancePct"))) + "%)", "- " + m(d.value("insurance")));
    out += tot(t("hos.pr.due"), m(d.value("due")), true);
    for (const QJsonValue& pv : d.value("payments").toArray()) { const QJsonObject p = pv.toObject(); out += tot(e(str(p.value("at")).left(10)) + " - " + e(str(p.value("method"))) + " - " + e(str(p.value("by"))), "- " + m(p.value("amount"))); }
    out += tot(t("hos.pr.balance"), m(d.value("balance")), true);
    return "<!doctype html><meta charset=\"utf-8\"><title>" + e(r.value("code").toString()) + "</title><style>body{font:14px system-ui;margin:40px;color:#111}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}.n{text-align:end}</style><h1>" +
        e(r.value("code").toString()) + "</h1><p>" + e(d.value("patientName").toString()) + "</p><table><tr><th>" + t("hos.pr.item") + "</th><th class=\"n\">" + t("hos.pr.qty") + "</th><th class=\"n\">" + t("hos.pr.price") + "</th><th class=\"n\">" + t("hos.pr.amount") + "</th></tr>" + rows + out + "</table><script>window.onload=function(){window.print()}</script>";
}

void HosSection::perform(const QJsonObject& a, const QJsonObject& row, const QMap<QString, QVariant>& vals, const QJsonObject& extra) {
    err->clear();
    Hos::run(sec, a, row, vals, extra, this,
             [this, a](const QJsonValue& v) {
                 if (a.contains("print")) {
                     const QString path = QDir::tempPath() + "/invoice-" + v.toObject().value("code").toString() + ".html"; QFile f(path);
                     if (f.open(QIODevice::WriteOnly)) { f.write(invoiceHtml(v.toObject()).toUtf8()); f.close(); QDesktopServices::openUrl(QUrl::fromLocalFile(path)); }
                     err->setText(I18n::t("hos.pr.saved"));
                 } else if (a.contains("show")) { detail->setPlainText(Hos::flatten(v).join('\n')); detail->show(); }
                 else { detail->hide(); reload(); }
             },
             [this, a, row, vals](const QString& m, const QStringList& warns) {
                 if (a.contains("warn") && !warns.isEmpty()) {
                     bool ok = false;
                     const QString reason = QInputDialog::getText(this, t("hos.ui.warnings"), m + "\n\n• " + warns.join("\n• ") + "\n\n" + t("hos.ui.override"), QLineEdit::Normal, "", &ok);
                     if (ok && !reason.trimmed().isEmpty()) perform(a, row, vals, QJsonObject{{"overrideReason", reason.trimmed()}});
                     return;
                 }
                 err->setText(m);
             });
}

// ---------------------------------------------------------------- dashboard + page
HosDashboard::HosDashboard() {
    auto* lay = new QVBoxLayout(this);
    err = Ui::label("", "error");
    body = new QTextBrowser;
    lay->addWidget(err);
    lay->addWidget(body, 1);
    lay->addWidget(Ui::button(t("common.refresh"), [this] { reload(); }));
}

void HosDashboard::reload() {
    Api::I().call("GET", "/hospital/dashboard?today=" + Hos::today() + "&tz=0", QJsonValue(), this, [this](const QJsonValue& v) {
        const QJsonObject d = v.toObject(), ap = d["appointmentsToday"].toObject(), bd = d["beds"].toObject();
        auto n = [](const QJsonValue& x) { return QString::number(qlonglong(x.toDouble())); };
        auto m = [](const QJsonValue& x) { return QLocale(QLocale::English).toString(x.toDouble(), 'f', 2); };
        const QList<QPair<QString, QString>> rows{
            {t("hos.ui.patients"), n(d["patients"])}, {t("hos.ui.openVisits"), n(d["openVisits"])}, {t("hos.ui.admitted"), n(d["admitted"])}, {t("hos.ui.labs"), n(d["pendingLabs"])},
            {t("hos.ui.rx"), n(d["pendingRx"])}, {t("hos.ui.appts"), QString("%1 (%2/%3/%4/%5)").arg(n(ap["total"]), n(ap["booked"]), n(ap["checkedIn"]), n(ap["completed"]), n(ap["cancelled"]))},
            {t("hos.ui.beds"), QString("%1/%2 · %3%").arg(n(bd["occupied"]), n(bd["total"]), n(bd["occupancyPct"]))}, {t("hos.ui.revenue"), m(d["revenueToday"])}, {t("hos.ui.outstanding"), m(d["outstanding"])}};
        QString h = "<table cellpadding=6>";
        for (const auto& r : rows) h += "<tr><td>" + r.first + "</td><td><b>" + r.second + "</b></td></tr>";
        h += "</table>";
        const QJsonArray low = d["lowStock"].toArray();
        if (!low.isEmpty()) {
            h += "<h4>" + t("hos.ui.lowstock") + "</h4>";
            for (const QJsonValue& x : low) h += x.toObject()["name"].toString() + " — " + n(x.toObject()["stock"]) + " / " + n(x.toObject()["reorder"]) + "<br>";
        }
        body->setHtml(h);
    }, [this](const QString& m) { err->setText(m); });
}

HospitalPage::HospitalPage() {
    lay->addWidget(Ui::label(t("tab.hos"), "title"));
    tabs = new QTabWidget;
    for (const QJsonValue& sv : Hos::sections()) {
        const QJsonObject s = sv.toObject();
        bool allowed = false;
        for (const QJsonValue& p : s["perm"].toArray()) if (Api::I().can(p.toString())) allowed = true;
        if (!allowed) continue;
        QWidget* w = s.value("type").toString() == "dashboard" ? static_cast<QWidget*>(new HosDashboard) : static_cast<QWidget*>(new HosSection(s));
        secs << s; views << w;
        tabs->addTab(w, I18n::lang() == "ar" ? s["ar"].toString() : s["en"].toString());
    }
    connect(tabs, &QTabWidget::currentChanged, this, [this](int i) { reload(); (void)i; });
    lay->addWidget(tabs, 1);
}

void HospitalPage::reload() {
    const int i = tabs->currentIndex();
    if (i < 0) return;
    if (auto* d = qobject_cast<HosDashboard*>(views[i])) d->reload();
    else if (auto* s = qobject_cast<HosSection*>(views[i])) s->reload();
}
