#include "HrPage.h"

#include <QDate>
#include <QFile>
#include <QDialog>
#include <QFileDialog>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QLabel>
#include <QLocale>
#include <QPushButton>
#include <QScrollArea>
#include <QSharedPointer>
#include <QTextStream>
#include <cmath>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

namespace Hr {
const QJsonObject& spec() {
    static QJsonObject s = [] { QFile f(":/hr.json"); f.open(QIODevice::ReadOnly); return QJsonDocument::fromJson(f.readAll()).object(); }();
    return s;
}
static int ix() { return I18n::lang() == "ar" ? 1 : 0; }
QString L(const QString& key, const QStringList& args) {
    QString s = spec().value("labels").toObject().value(key).toArray().at(ix()).toString();
    for (int i = 0; i < args.size(); ++i) s.replace(QString("{%1}").arg(i), args[i]);
    return s;
}
QString I(const QString& key, const QMap<QString, QString>& vars) {
    QString s = spec().value("imp").toObject().value(key).toArray().at(ix()).toString();
    for (auto it = vars.begin(); it != vars.end(); ++it) s.replace("{" + it.key() + "}", it.value());
    return s;
}
QString tx(const QJsonObject& o) { return o.value(I18n::lang() == "ar" ? "ar" : "en").toString(); }
QString fieldLabel(const QJsonObject& f) { return tx(f); }
double num(const QJsonValue& v) { double n = v.isString() ? v.toString().toDouble() : v.toDouble(); return std::isfinite(n) ? n : 0; }
static QString money(double v) { return QLocale(QLocale::English).toString(v, 'f', v == std::floor(v) ? 0 : 2); }
static QString norm(const QString& s) { return s.trimmed().toLower().replace(QRegularExpression("[\\s_\\-.]+"), " "); }

QString cellText(const QVariant& v) {
    if (!v.isValid()) return {};
    if (v.typeId() == QMetaType::Double) { const double d = v.toDouble(); return d == std::floor(d) ? QString::number(qint64(d)) : QString::number(d); }
    return v.toString().trimmed();
}

QString guessField(const QList<QJsonObject>& fields, const QVariant& heading) {
    const QString h = norm(heading.toString());
    if (h.isEmpty()) return {};
    const QString flat = QString(h).remove(' ');
    for (const QJsonObject& f : fields)
        for (const QJsonValue& n : f.value("names").toArray()) {
            const QString nn = norm(n.toString());
            if (nn == h || QString(nn).remove(' ') == flat) return f.value("key").toString();
        }
    return {};
}

static QString valid(int y, int m, int d) { const QDate dt(y, m, d); return dt.isValid() ? dt.toString(Qt::ISODate) : QString(); }
QString parseDate(const QVariant& v) {
    if (!v.isValid()) return {};
    if (v.typeId() == QMetaType::Double) {
        const double d = v.toDouble();
        if (d > 20000 && d < 80000) return QDate(1899, 12, 30).addDays(int(d)).toString(Qt::ISODate);
        return {};
    }
    const QString s = v.toString().trimmed();
    static const QRegularExpression a("^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})"), b("^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})");
    auto m = a.match(s);
    if (m.hasMatch()) return valid(m.captured(1).toInt(), m.captured(2).toInt(), m.captured(3).toInt());
    m = b.match(s);
    if (m.hasMatch()) {
        const int x = m.captured(1).toInt(), y = m.captured(2).toInt(), yr = m.captured(3).toInt();
        return x > 12 ? valid(yr, y, x) : (y > 12 ? valid(yr, x, y) : valid(yr, y, x));   // day first
    }
    return {};
}

QList<Mapped> mapRows(const Xlsx::Table& rows, const QMap<int, QString>& mapping, int first, bool canSalary) {
    QList<Mapped> out;
    QMap<QString, int> byField;
    for (auto it = mapping.begin(); it != mapping.end(); ++it) if (!it.value().isEmpty()) byField[it.value()] = it.key();
    const QJsonObject st = spec().value("status").toObject();
    for (int i = first; i < rows.size(); ++i) {
        const auto& r = rows[i];
        bool blank = true;
        for (const QVariant& c : r) if (c.isValid() && !c.toString().trimmed().isEmpty()) blank = false;
        if (blank) continue;
        Mapped m; m.row = i + 1;
        for (const QJsonValue& fv : spec().value("fields").toArray()) {
            const QJsonObject f = fv.toObject();
            const QString key = f.value("key").toString();
            if (!byField.contains(key) || (f.value("salary").toBool() && !canSalary)) continue;
            const int col = byField[key];
            const QVariant raw = col < r.size() ? r[col] : QVariant();
            if (!raw.isValid() || raw.toString().trimmed().isEmpty()) { if (f.value("required").toBool()) m.errors << key; continue; }
            const QString t = f.value("type").toString();
            if (t == "date") { const QString d = parseDate(raw); if (!d.isEmpty()) m.data[key] = d; else m.errors << key + ":date"; }
            else if (t == "number") {
                bool ok = true; double n;
                if (raw.typeId() == QMetaType::Double) n = raw.toDouble(); else n = QString(raw.toString()).remove(',').remove(' ').toDouble(&ok);
                if (ok) { if (n == std::floor(n)) m.data[key] = qint64(n); else m.data[key] = n; } else m.errors << key + ":number";
            } else if (t == "status") {
                const QString s = norm(raw.toString());
                const QString v = s.isEmpty() ? "Active" : (st.contains(s) ? st.value(s).toString() : st.value(QString(s).remove(' ')).toString());
                if (!v.isEmpty()) m.data[key] = v; else m.errors << key + ":status";
            } else if (t == "gender") {
                const QString s = norm(raw.toString());
                if (QStringList{"m", "male", "man", QString::fromUtf8("ذكر"), QString::fromUtf8("رجل")}.contains(s)) m.data[key] = "Male";
                else if (QStringList{"f", "female", "woman", QString::fromUtf8("أنثى"), QString::fromUtf8("انثى"), QString::fromUtf8("امرأة")}.contains(s)) m.data[key] = "Female";
                else m.errors << key + ":gender";
            } else if (t == "email") { const QString e = raw.toString().trimmed(); if (e.contains('@')) m.data[key] = e; else m.errors << key + ":email"; }
            else m.data[key] = cellText(raw);
        }
        if (!m.data.contains("status") || m.data.value("status").toString().isEmpty()) m.data["status"] = "Active";
        out << m;
    }
    return out;
}

void markDuplicates(QList<Mapped>& ms) {
    QSet<QString> seen;
    for (Mapped& m : ms) {
        const QString no = m.data.value("empNo").toString().toLower();
        if (!no.isEmpty() && seen.contains(no)) m.errors << "empNo:dup";
        if (!no.isEmpty()) seen.insert(no);
    }
}

QList<QJsonObject> visibleCols(const QJsonObject& rep) {
    QList<QJsonObject> out;
    for (const QJsonValue& c : rep.value("cols").toArray()) {
        const QJsonObject o = c.toObject();
        if (rep.value("id").toString() == "employees" && o.value("en").toString() == "Salary" && !Api::I().can("hr.employees.salary")) continue;
        out << o;
    }
    return out;
}

static QString empName(const QJsonObject& e) {
    const QString ar = e.value("fullNameAr").toString();
    const QString n = I18n::lang() == "ar" && !ar.isEmpty() ? ar : e.value("fullName").toString();
    return n.isEmpty() ? e.value("empNo").toString() : n;
}

Built build(const QString& rid, const QMap<QString, QJsonValue>& data, const QString& today) {
    Built b;
    auto add = [&](const QStringList& r, const QJsonObject& p = QJsonObject()) { b.rows << r; b.payloads << p; };
    QMap<QString, QJsonObject> emps;
    for (const QJsonValue& e : data.value("employees").toArray()) emps[e.toObject().value("empNo").toString()] = e.toObject();
    auto nm = [&](const QString& no) { return emps.contains(no) ? empName(emps[no]) : no; };
    if (rid == "overview") {
        const QJsonObject s = data.value("summary").toObject();
        for (const QJsonValue& mv : spec().value("measures").toArray()) {
            const QJsonArray m = mv.toArray();
            const QString key = m.at(0).toString();
            if (!s.contains(key) || s.value(key).isNull()) continue;
            const QJsonValue v = s.value(key);
            add({m.at(ix() + 1).toString(), v.isString() ? v.toString() : money(v.toDouble())});
        }
    } else if (rid == "employees") {
        const bool sal = Api::I().can("hr.employees.salary");
        for (const QJsonValue& ev : data.value("employees").toArray()) {
            const QJsonObject e = ev.toObject();
            QStringList r{e.value("empNo").toString(), empName(e), e.value("position").toString(), e.value("unit").toString(), e.value("status").toString(), e.value("hireDate").toString().left(10)};
            if (sal) r << money(num(e.value("basicSalary")));
            add(r, e);
        }
    } else if (rid == "leave") {
        for (const QJsonValue& xv : data.value("leave").toArray()) {
            const QJsonObject x = xv.toObject(), d = x.value("data").toObject();
            add({nm(x.value("empNo").toString()), d.value("type").toString(), d.value("from").toString().left(10), d.value("to").toString().left(10), QString::number(num(d.value("days"))), x.value("status").toString()}, x);
        }
    } else if (rid == "balances") {
        for (const QJsonValue& ev : data.value("employees").toArray()) {
            const QJsonObject e = ev.toObject();
            if (e.value("status").toString() == "Terminated") continue;
            for (const QJsonValue& tv : data.value("leavetype").toArray()) {
                const QJsonObject ty = tv.toObject(), td = ty.value("data").toObject();
                const double total = num(td.value("days"));
                double used = 0;
                for (const QJsonValue& xv : data.value("leave").toArray()) {
                    const QJsonObject x = xv.toObject(), d = x.value("data").toObject();
                    if (x.value("empNo").toString() == e.value("empNo").toString() && x.value("status").toString() == "Approved" && d.value("type").toString() == ty.value("code").toString() && d.value("from").toString().left(4) == today.left(4)) used += num(d.value("days"));
                }
                const QString nameStr = td.value("name").toString().isEmpty() ? ty.value("code").toString() : td.value("name").toString();
                add({empName(e), nameStr, money(total), money(used), money(total - used)});
            }
        }
    } else if (rid == "recruit") {
        QMap<QString, QString> vac;
        for (const QJsonValue& v : data.value("vacancy").toArray()) { const QJsonObject o = v.toObject(); const QString t = o.value("data").toObject().value("title").toString(); vac[o.value("code").toString()] = t.isEmpty() ? o.value("code").toString() : t; }
        for (const QJsonValue& cv : data.value("candidate").toArray()) {
            const QJsonObject c = cv.toObject(), d = c.value("data").toObject();
            const QString vk = d.value("vacancy").toString();
            const QString name = d.value("name").toString().isEmpty() ? c.value("code").toString() : d.value("name").toString();
            add({name, vac.value(vk, vk), d.value("email").toString(), c.value("status").toString().isEmpty() ? "Applied" : c.value("status").toString()}, c);
        }
    } else if (rid == "perf") {
        QList<int> rated;
        for (const QJsonValue& xv : data.value("review").toArray()) {
            const QJsonObject x = xv.toObject(), d = x.value("data").toObject();
            const int rating = int(num(d.value("rating")));
            add({nm(x.value("empNo").toString()), d.value("stage").toString(), rating ? QString::number(rating) : QString()}, x);
            if (rating > 0) rated << rating;
        }
        if (!rated.isEmpty()) {
            double sum = 0; for (int r : rated) sum += r;
            QStringList dist;
            for (int n = 1; n <= 5; ++n) dist << QString("%1★ %2").arg(n).arg(rated.count(n));
            b.foot = QString("%1: %2   %3: %4   %5: %6").arg(L("avg"), QString::number(sum / rated.size(), 'f', 2), L("rated")).arg(rated.size()).arg(L("dist"), dist.join("  "));
        }
    } else if (rid == "org") {
        for (const QJsonValue& uv : data.value("unit").toArray()) {
            const QJsonObject u = uv.toObject(), d = u.value("data").toObject();
            int head = 0;
            for (const QJsonValue& ev : data.value("employees").toArray()) { const QString un = ev.toObject().value("unit").toString(); if (un == u.value("code").toString() || un == d.value("name").toString()) ++head; }
            const QString ar = d.value("nameAr").toString();
            add({u.value("code").toString(), I18n::lang() == "ar" && !ar.isEmpty() ? ar : d.value("name").toString(), d.value("level").toString(), d.value("parent").toString(), QString::number(head)}, u);
        }
    }
    return b;
}
}  // namespace Hr

// ---------------------------------------------------------------- import dialog
using Hr::I;
using Hr::L;

HrImportDialog::HrImportDialog(QWidget* parent, std::function<void()> onDone) : QDialog(parent), onDone_(std::move(onDone)) {
    setWindowTitle(I("title"));
    resize(900, 640);
    for (const QJsonValue& f : Hr::spec().value("fields").toArray())
        if (!f.toObject().value("salary").toBool() || Api::I().can("hr.employees.salary")) fields << f.toObject();
    auto* lay = new QVBoxLayout(this);
    lay->addWidget(Ui::label(I("intro")));
    auto* top = new QHBoxLayout;
    path = new QLineEdit;
    path->setPlaceholderText(L("file"));
    top->addWidget(path, 1);
    top->addWidget(Ui::button(L("pick"), [this] {
        const QString p = QFileDialog::getOpenFileName(this, I("title"), {}, "Excel / CSV (*.xlsx *.csv *.txt)");
        if (!p.isEmpty()) { path->setText(p); load(); }
    }, "ghost"));
    top->addWidget(Ui::button(L("load"), [this] { load(); }));
    top->addWidget(Ui::button(L("template"), [this] {
        const QString p = QFileDialog::getSaveFileName(this, I("title"), "employees-template.csv", "CSV (*.csv)");
        if (p.isEmpty()) return;
        QFile f(p);
        if (!f.open(QIODevice::WriteOnly)) return;
        QTextStream out(&f);
        out.setGenerateByteOrderMark(true);
        QStringList h, s;
        for (const QJsonObject& x : fields) { h << x.value("key").toString(); s << (x.value("sample").isString() ? x.value("sample").toString() : QString::number(x.value("sample").toInt())); }
        out << h.join(",") << "\n" << s.join(",") << "\n";
        msg->setText(L("templated", {p}));
    }, "ghost"));
    lay->addLayout(top);
    head = new QCheckBox(I("hasHeader"));
    head->setChecked(true);
    connect(head, &QCheckBox::stateChanged, this, [this] { remap(); });
    lay->addWidget(head);
    auto* holder = new QWidget;
    mapBox = new QVBoxLayout(holder);
    auto* sc = new QScrollArea;
    sc->setWidgetResizable(true);
    sc->setWidget(holder);
    sc->setMaximumHeight(170);
    lay->addWidget(sc);
    summary = new QLabel;
    lay->addWidget(summary);
    table = Ui::table({});
    lay->addWidget(table, 1);
    upd = new QCheckBox(I("update"));
    upd->setChecked(true);
    lay->addWidget(upd);
    msg = new QLabel;
    msg->setWordWrap(true);
    lay->addWidget(msg);
    auto* row = new QHBoxLayout;
    runBtn = Ui::button({}, [this] { run(); });
    runBtn->setEnabled(false);
    row->addWidget(runBtn);
    row->addWidget(Ui::button(I("close"), [this] { accept(); }, "ghost"));
    lay->addLayout(row);
}

void HrImportDialog::load() {
    const QString p = path->text().trimmed();
    if (p.isEmpty()) { msg->setText(L("nofile")); return; }
    QString err;
    if (!Xlsx::readTable(p, rows, err)) { msg->setText(I(err == "type" ? "badType" : "readError")); return; }
    if (rows.isEmpty()) { msg->setText(I("empty")); return; }
    if (rows.size() > Hr::spec().value("maxRows").toInt()) { msg->setText(I("tooMany")); rows.clear(); return; }
    msg->clear();
    autoMap();
}

void HrImportDialog::autoMap() {
    int width = 0;
    for (const auto& r : rows) width = qMax(width, int(r.size()));
    mapping.clear();
    QSet<QString> used;
    for (int c = 0; c < width; ++c) {
        const QString g = Hr::guessField(fields, c < rows[0].size() ? rows[0][c] : QVariant());
        if (!g.isEmpty() && !used.contains(g)) { mapping[c] = g; used.insert(g); }
    }
    head->blockSignals(true);
    head->setChecked(mapping.size() >= 2 || mapping.contains(0));
    head->blockSignals(false);
    buildMapUi(width);
    remap();
}

void HrImportDialog::buildMapUi(int width) {
    while (QLayoutItem* it = mapBox->takeAt(0)) {
        if (QLayout* l = it->layout()) while (QLayoutItem* x = l->takeAt(0)) { delete x->widget(); delete x; }
        delete it->widget();
        delete it;
    }
    combos.clear();
    for (int c = 0; c < width; ++c) {
        auto* row = new QHBoxLayout;
        const QString h = c < rows[0].size() ? Hr::cellText(rows[0][c]) : QString();
        row->addWidget(new QLabel(QString("%1 %2  %3").arg(I("column")).arg(c + 1).arg(h)), 1);
        auto* cb = new QComboBox;
        cb->addItem(I("skip"), "");
        for (const QJsonObject& f : fields) cb->addItem(Hr::fieldLabel(f), f.value("key").toString());
        cb->setCurrentIndex(qMax(0, cb->findData(mapping.value(c))));
        connect(cb, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this, c] { setMap(c); });
        combos[c] = cb;
        row->addWidget(cb, 1);
        mapBox->addLayout(row);
    }
}

void HrImportDialog::setMap(int col) {
    const QString key = combos[col]->currentData().toString();
    if (!key.isEmpty())
        for (auto it = combos.begin(); it != combos.end(); ++it)
            if (it.key() != col && it.value()->currentData().toString() == key) { it.value()->blockSignals(true); it.value()->setCurrentIndex(0); it.value()->blockSignals(false); }
    mapping.clear();
    for (auto it = combos.begin(); it != combos.end(); ++it) if (!it.value()->currentData().toString().isEmpty()) mapping[it.key()] = it.value()->currentData().toString();
    remap();
}

QStringList HrImportDialog::missing() const {
    QStringList out;
    const QList<QString> mv = mapping.values();
    const QSet<QString> have(mv.begin(), mv.end());
    for (const QJsonObject& f : fields) if (f.value("required").toBool() && !have.contains(f.value("key").toString())) out << Hr::fieldLabel(f);
    return out;
}

QString HrImportDialog::errText(const Hr::Mapped& m) const {
    QStringList out;
    for (const QString& e : m.errors) {
        const QString k = e.section(':', 0, 0), why = e.contains(':') ? e.section(':', 1) : QString();
        QString label = k;
        for (const QJsonObject& f : fields) if (f.value("key").toString() == k) label = Hr::fieldLabel(f);
        out << label + ": " + I(why.isEmpty() ? "e.required" : "e." + why);
    }
    return out.join(QString::fromUtf8(" · "));
}

void HrImportDialog::remap() {
    if (rows.isEmpty()) return;
    mapped = Hr::mapRows(rows, mapping, head->isChecked() ? 1 : 0, Api::I().can("hr.employees.salary"));
    Hr::markDuplicates(mapped);
    QList<QJsonObject> keys;
    const QList<QString> mv = mapping.values();
    const QSet<QString> have(mv.begin(), mv.end());
    for (const QJsonObject& f : fields) if (have.contains(f.value("key").toString())) keys << f;
    QStringList heads{"#"};
    for (const QJsonObject& f : keys) heads << Hr::fieldLabel(f);
    heads << L("problem");
    table->setColumnCount(heads.size());
    table->setHorizontalHeaderLabels(heads);
    QList<QStringList> cells; QList<QJsonObject> pay;
    for (int i = 0; i < qMin(50, int(mapped.size())); ++i) {
        const Hr::Mapped& m = mapped[i];
        QStringList r{QString::number(m.row)};
        for (const QJsonObject& f : keys) { const QJsonValue v = m.data.value(f.value("key").toString()); r << (v.isString() ? v.toString() : v.isUndefined() || v.isNull() ? QString() : QString::number(v.toDouble(), 'g', 12)); }
        r << errText(m);
        cells << r; pay << QJsonObject();
    }
    Ui::fill(table, cells, pay);
    int good = 0; for (const auto& m : mapped) if (m.errors.isEmpty()) ++good;
    summary->setText(I("rows", {{"n", QString::number(mapped.size())}}) + "   " + I("valid", {{"n", QString::number(good)}}) + (mapped.size() > good ? "   " + I("invalid", {{"n", QString::number(mapped.size() - good)}}) : QString()));
    const QStringList miss = missing();
    msg->setText(!miss.isEmpty() ? L("needmap", {miss.join(", ")}) : (mapped.size() > 50 ? I("more", {{"n", QString::number(mapped.size() - 50)}}) : QString()));
    runBtn->setText(I("run", {{"n", QString::number(good)}}));
    runBtn->setEnabled(good > 0 && miss.isEmpty());
}

void HrImportDialog::run() {
    QJsonArray good; QList<Hr::Mapped> bad;
    for (const auto& m : mapped) { if (m.errors.isEmpty()) good.append(QJsonObject{{"row", m.row}, {"data", m.data}}); else bad << m; }
    if (good.isEmpty()) { msg->setText(L("nothing")); return; }
    runBtn->setEnabled(false);
    msg->setText(QString::fromUtf8("…"));
    struct Tot { int created = 0, updated = 0, skipped = 0; QJsonArray errors; };
    auto tot = QSharedPointer<Tot>::create();
    const int chunk = Hr::spec().value("chunk").toInt();
    auto next = QSharedPointer<std::function<void(int)>>::create();
    const bool upd_ = upd->isChecked();
    *next = [this, good, bad, tot, chunk, next, upd_](int from) {
        if (from >= good.size()) {
            for (const auto& m : bad) tot->errors.append(QJsonObject{{"row", m.row}, {"empNo", m.data.value("empNo").toString()}, {"message", errText(m)}});
            QStringList lines{QString("%1: %2   %3: %4   %5: %6   %7: %8").arg(I("created")).arg(tot->created).arg(I("updated")).arg(tot->updated).arg(I("skipped")).arg(tot->skipped).arg(I("failed")).arg(tot->errors.size())};
            for (int i = 0; i < qMin(20, int(tot->errors.size())); ++i) lines << QString("%1 %2: %3").arg(L("row")).arg(tot->errors[i].toObject().value("row").toInt()).arg(tot->errors[i].toObject().value("message").toString());
            msg->setText(I("done") + "\n" + lines.join("\n"));
            if (onDone_) onDone_();
            return;
        }
        QJsonArray part;
        for (int i = from; i < qMin(from + chunk, int(good.size())); ++i) part.append(good[i]);
        Api::I().call("POST", "/hr/employees/import", QJsonObject{{"rows", part}, {"updateExisting", upd_}}, this, [tot, next, from, chunk](const QJsonValue& v) {
            const QJsonObject r = v.toObject();
            tot->created += r.value("created").toInt(); tot->updated += r.value("updated").toInt(); tot->skipped += r.value("skipped").toInt();
            for (const QJsonValue& e : r.value("errors").toArray()) tot->errors.append(e);
            (*next)(from + chunk);
        }, [this](const QString& e) { msg->setText(e); runBtn->setEnabled(true); });
    };
    (*next)(0);
}

// ---------------------------------------------------------------- page
namespace {
const QMap<QString, QString>& viewPerm() {
    static const QMap<QString, QString> m{{"overview", "hr.reports.view"}, {"employees", "hr.employees.view"}, {"leave", "hr.leave.view"}, {"balances", "hr.leave.view"}, {"recruit", "hr.recruitment.view"}, {"perf", "hr.performance.view"}, {"org", "hr.org.view"}};
    return m;
}
QStringList kindsOf(const QString& id) {
    if (id == "leave") return {"leave"};
    if (id == "balances") return {"leave", "leavetype"};
    if (id == "recruit") return {"candidate", "vacancy"};
    if (id == "perf") return {"review"};
    if (id == "org") return {"unit"};
    return {};
}
}  // namespace

HrPage::HrPage() {
    for (const QJsonValue& r : Hr::spec().value("reports").toArray())
        if (Api::I().can(viewPerm().value(r.toObject().value("id").toString()))) reports.append(r);
    auto* lay = new QVBoxLayout(this);
    lay->addWidget(Ui::label(L("title"), "title"));
    auto* bar = new QHBoxLayout;
    pick = new QComboBox;
    for (const QJsonValue& r : reports) pick->addItem(Hr::tx(r.toObject()), r.toObject().value("id").toString());
    connect(pick, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this] { reload(); });
    bar->addWidget(pick, 1);
    bar->addWidget(Ui::button(L("refresh"), [this] { reload(); }));
    bImport = Ui::button(L("import"), [this] { HrImportDialog(this, [this] { reload(); }).exec(); }, "ghost");
    bA = Ui::button({}, [this] { act(0); });
    bB = Ui::button({}, [this] { act(1); });
    bC = Ui::button({}, [this] { act(2); });
    bD = Ui::button({}, [this] { act(3); });
    for (QPushButton* b : {bImport, bA, bB, bC, bD}) bar->addWidget(b);
    lay->addLayout(bar);
    table = Ui::table({});
    lay->addWidget(table, 1);
    foot = new QLabel; msg = new QLabel;
    lay->addWidget(foot); lay->addWidget(msg);
}

void HrPage::reload() {
    if (reports.isEmpty()) { msg->setText(L("noperm")); return; }
    rep = QJsonObject();
    for (const QJsonValue& r : reports) if (r.toObject().value("id").toString() == pick->currentData().toString()) rep = r.toObject();
    const QString id = rep.value("id").toString();
    bImport->setVisible(id == "employees" && Api::I().can("hr.employees.import"));
    const QJsonArray acts = rep.value("actions").toArray();
    const bool can = (id == "leave" && Api::I().can("hr.leave.approve")) || (id == "recruit" && Api::I().can("hr.recruitment.manage"));
    QPushButton* bs[4] = {bA, bB, bC, bD};
    for (int i = 0; i < 4; ++i) { bs[i]->setVisible(can && i < acts.size()); if (i < acts.size()) bs[i]->setText(L(acts[i].toString())); }
    QStringList heads;
    for (const QJsonObject& c : Hr::visibleCols(rep)) heads << Hr::tx(c);
    table->setColumnCount(heads.size());
    table->setHorizontalHeaderLabels(heads);
    msg->setText(QString::fromUtf8("…"));
    data.clear();
    const QJsonObject mine = rep;
    auto finish = [this, mine] { if (mine.value("id") == rep.value("id")) showData(mine); };
    if (id == "overview") {
        Api::I().call("GET", "/hr/summary", QJsonValue(), this, [this, finish](const QJsonValue& v) { data["summary"] = v; finish(); }, [this](const QString& e) { msg->setText(e); });
        return;
    }
    QStringList kinds = kindsOf(id);
    const bool needEmps = id != "recruit";
    const int total = kinds.size() + (needEmps ? 1 : 0);
    auto left = QSharedPointer<int>::create(total);
    auto done = [this, left, finish](const QString& k, const QJsonValue& v) { data[k] = v; if (--*left == 0) finish(); };
    if (needEmps) Api::I().call("GET", "/hr/employees", QJsonValue(), this, [done](const QJsonValue& v) { done("employees", v); }, [this](const QString& e) { msg->setText(e); });
    for (const QString& k : kinds)
        Api::I().call("GET", "/hr/records/" + k, QJsonValue(), this, [k, done](const QJsonValue& v) { done(k, v); }, [k, done](const QString&) { done(k, QJsonArray()); });
    if (id == "recruit" || id == "balances") {}
    if (id == "recruit") {   // vacancies are read with the candidates
    }
}

void HrPage::showData(const QJsonObject& r) {
    const Hr::Built b = Hr::build(r.value("id").toString(), data, QDate::currentDate().toString(Qt::ISODate));
    Ui::fill(table, b.rows, b.payloads);
    const auto cols = Hr::visibleCols(r);
    for (int row = 0; row < table->rowCount(); ++row)
        for (int c = 0; c < cols.size(); ++c)
            if (cols[c].value("num").toBool() && table->item(row, c)) table->item(row, c)->setTextAlignment(Qt::AlignRight | Qt::AlignVCenter);
    foot->setText(b.foot);
    msg->setText(b.rows.isEmpty() ? L("empty") : QString());
}

void HrPage::act(int which) {
    QJsonObject rec;
    if (!Ui::selected(table, rec) || rec.isEmpty()) return;
    const QString id = rep.value("id").toString(), name = rep.value("actions").toArray().at(which).toString();
    QString path; QJsonObject body;
    if (id == "leave") {
        if (rec.value("status").toString() != "Pending") return;
        body = QJsonObject{{"status", name == "approve" ? "Approved" : "Rejected"}, {"empNo", rec.value("empNo")}, {"data", rec.value("data")}};
        path = "/hr/records/leave/" + rec.value("id").toString();
    } else if (name == "hire") {
        if (rec.value("status").toString() == "Offer") hire(rec);
        return;
    } else if (name == "reject") {
        const QString st = rec.value("status").toString();
        if (st == "Hired" || st == "Rejected") return;
        body = QJsonObject{{"status", "Rejected"}, {"data", rec.value("data")}};
        path = "/hr/records/candidate/" + rec.value("id").toString();
    } else {
        QStringList stages; for (const QJsonValue& s : Hr::spec().value("stages").toArray()) stages << s.toString();
        const int cur = stages.indexOf(rec.value("status").toString().isEmpty() ? "Applied" : rec.value("status").toString());
        const int to = cur + (name == "next" ? 1 : -1);
        if (to < 0 || to >= stages.size()) return;
        body = QJsonObject{{"status", stages[to]}, {"data", rec.value("data")}};
        path = "/hr/records/candidate/" + rec.value("id").toString();
    }
    Api::I().call("PUT", path, body, this, [this](const QJsonValue&) { reload(); }, [this](const QString& e) { Ui::warn(this, e); });
}

/// Hire a candidate: creates the employee (prefilled from the candidate and the vacancy) and marks the candidate Hired.
void HrPage::hire(const QJsonObject& cand) {
    const QJsonObject d = cand.value("data").toObject(); QJsonObject v;
    for (const QJsonValue& x : data.value("vacancy").toArray()) if (x.toObject().value("code").toString() == d.value("vacancy").toString()) v = x.toObject().value("data").toObject();
    const QMap<QString, QString> pre{{"fullName", d.value("name").toString()}, {"email", d.value("email").toString()}, {"phone", d.value("phone").toString()}, {"position", v.value("title").toString()}, {"unit", v.value("unit").toString()}, {"location", v.value("location").toString()}, {"grade", v.value("grade").toString()}, {"hireDate", QDate::currentDate().toString(Qt::ISODate)}};
    QMap<QString, QString> names; for (const QJsonValue& f : Hr::spec().value("fields").toArray()) names[f.toObject().value("key").toString()] = Hr::tx(f.toObject());
    auto* dlg = new QDialog(this); dlg->setAttribute(Qt::WA_DeleteOnClose); dlg->setWindowTitle(L("hireTitle"));
    auto* lv = new QVBoxLayout(dlg); auto* form = new QFormLayout; auto edits = QSharedPointer<QMap<QString, QLineEdit*>>::create();
    for (const char* k : {"empNo", "fullName", "email", "phone", "position", "unit", "location", "grade", "hireDate"}) {
        auto* e = new QLineEdit(pre.value(k)); (*edits)[k] = e;
        form->addRow(names.value(k, k) + (QString(k) == "empNo" || QString(k) == "fullName" ? " *" : ""), e);
    }
    lv->addLayout(form); auto* err = new QLabel; lv->addWidget(err);
    lv->addWidget(Ui::button(L("hire"), [=] {
        QJsonObject body;
        for (auto it = edits->begin(); it != edits->end(); ++it) if (!it.value()->text().trimmed().isEmpty()) body[it.key()] = it.value()->text().trimmed();
        if (body.value("empNo").toString().isEmpty() || body.value("fullName").toString().isEmpty()) { err->setText(L("empNoReq")); return; }
        body["status"] = "Probation";
        Api::I().call("POST", "/hr/employees", body, dlg, [=](const QJsonValue&) {
            Api::I().call("PUT", "/hr/records/candidate/" + cand.value("id").toString(), QJsonObject{{"status", "Hired"}, {"data", cand.value("data")}}, this, [=](const QJsonValue&) { dlg->accept(); reload(); }, [=](const QString& e) { err->setText(e); });
        }, [=](const QString& e) { err->setText(e); });
    }));
    dlg->open();
}
