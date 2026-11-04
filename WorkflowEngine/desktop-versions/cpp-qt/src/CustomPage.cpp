#include "CustomPage.h"

#include <QDialog>
#include <QFile>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QPlainTextEdit>
#include <QRegularExpression>
#include <QUrl>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

namespace Custom {
const QJsonObject& spec() {
    static QJsonObject s = [] { QFile f(":/custom.json"); f.open(QIODevice::ReadOnly); return QJsonDocument::fromJson(f.readAll()).object(); }();
    return s;
}
QString title(const QJsonObject& m) {
    const QJsonObject d = m.value("def").toObject();
    return I18n::lang() == "ar" && !d.value("titleAr").toString().isEmpty() ? d.value("titleAr").toString() : d.value("title").toString();
}
QString flabel(const QJsonObject& f) { return I18n::lang() == "ar" && !f.value("labelAr").toString().isEmpty() ? f.value("labelAr").toString() : f.value("label").toString(); }
static QString show(const QJsonObject& f, const QJsonObject& r) {
    const QJsonValue v = r.value("data").toObject().value(f.value("key").toString());
    if (f.value("type").toString() == "checkbox") return v.toBool() ? QString::fromUtf8("✓") : QString();
    if (v.isNull() || v.isUndefined()) return {};
    if (v.isDouble()) { const double d = v.toDouble(); return d == std::floor(d) ? QString::number(qint64(d)) : QString::number(d, 'g', QLocale::FloatingPointShortest); }
    return v.toString();
}
}  // namespace Custom

FieldDialog::FieldDialog(QWidget* parent, const QJsonObject& fo) : QDialog(parent), f(fo) {
    setWindowTitle(t("cus.fields"));
    auto* form = new QFormLayout(this);
    name = new QLineEdit(f.value("label").toString()); ar = new QLineEdit(f.value("labelAr").toString()); type = new QComboBox; req = new QCheckBox(t("cus.required"));
    QStringList opts; for (const QJsonValue& o : f.value("options").toArray()) opts << o.toString();
    opt = new QLineEdit(opts.join(", "));
    for (const QJsonValue& k : Custom::spec().value("types").toArray()) type->addItem(t("cus.t." + k.toString()), k.toString());
    type->setCurrentIndex(std::max(0, type->findData(f.value("type").toString("text"))));
    req->setChecked(f.value("required").toBool());
    form->addRow(t("cus.fieldName"), name); form->addRow(t("cus.fieldNameAr"), ar); form->addRow("", type); form->addRow("", req); form->addRow(t("cus.options"), opt);
    form->addRow(Ui::button(t("cal.save"), [this] { ok(); }));
}
void FieldDialog::ok() {
    f["label"] = name->text().trimmed();
    if (ar->text().trimmed().isEmpty()) f["labelAr"] = QJsonValue::Null; else f["labelAr"] = ar->text().trimmed();
    f["type"] = type->currentData().toString(); f["required"] = req->isChecked();
    QJsonArray o;
    if (type->currentData().toString() == "select") for (const QString& s : opt->text().split(QRegularExpression("[,،;]"))) if (!s.trimmed().isEmpty()) o.append(s.trimmed());
    f["options"] = o;
    accept();
}

ModuleDesigner::ModuleDesigner(QWidget* parent, const QJsonObject& m, std::function<void(const QJsonObject&)> saved) : QDialog(parent), mod(m), onSaved(saved) {
    d = m.isEmpty() ? QJsonObject{{"title", ""}, {"titleAr", ""}, {"icon", "grid"}, {"color", "#6366f1"}, {"fields", QJsonArray{QJsonObject{{"key", ""}, {"label", ""}, {"type", "text"}, {"required", true}}}}} : m.value("def").toObject();
    setWindowTitle(m.isEmpty() ? t("cus.newModule") : t("cus.design"));
    resize(640, 520);
    auto* lay = new QVBoxLayout(this);
    auto* form = new QFormLayout;
    name = new QLineEdit(d.value("title").toString()); ar = new QLineEdit(d.value("titleAr").toString()); icon = new QComboBox; color = new QLineEdit(d.value("color").toString("#6366f1"));
    for (const QJsonValue& i : Custom::spec().value("icons").toArray()) icon->addItem(i.toString(), i.toString());
    icon->setCurrentIndex(std::max(0, icon->findData(d.value("icon").toString("grid"))));
    form->addRow(t("cus.name") + " *", name); form->addRow(t("cus.nameAr"), ar); form->addRow(t("cus.icon"), icon); form->addRow(t("cus.color"), color);
    lay->addLayout(form);
    lay->addWidget(Ui::label(t("cus.fields")));
    table = Ui::table({t("cus.fieldName"), t("cus.fieldNameAr"), "Type", t("cus.required"), t("cus.options")});
    connect(table, &QTableWidget::doubleClicked, this, [this] { edit(); });
    lay->addWidget(table, 1);
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button("+ " + t("cus.addField"), [this] { add(); }, "ghost")); row->addWidget(Ui::button(t("web.edit"), [this] { edit(); }, "ghost"));
    row->addWidget(Ui::button(QString::fromUtf8("↑"), [this] { move(-1); }, "ghost")); row->addWidget(Ui::button(QString::fromUtf8("↓"), [this] { move(1); }, "ghost")); row->addWidget(Ui::button(QString::fromUtf8("✕"), [this] { remove(); }, "ghost"));
    row->addStretch(1);
    lay->addLayout(row);
    err = Ui::label("", "error");
    lay->addWidget(err);
    auto* bot = new QHBoxLayout; bot->addStretch(1);
    bot->addWidget(Ui::button(t("cal.close"), [this] { reject(); }, "ghost")); bot->addWidget(Ui::button(t("cal.save"), [this] { save(); }));
    lay->addLayout(bot);
    refresh();
}
void ModuleDesigner::refresh(int sel) {
    QList<QStringList> rows; QList<QJsonObject> pay;
    for (const QJsonValue& fv : fields()) {
        const QJsonObject f = fv.toObject(); QStringList o; for (const QJsonValue& x : f.value("options").toArray()) o << x.toString();
        rows << QStringList{f.value("label").toString(), f.value("labelAr").toString(), t("cus.t." + f.value("type").toString("text")), f.value("required").toBool() ? QString::fromUtf8("✓") : QString(), o.join(", ")}; pay << QJsonObject();
    }
    Ui::fill(table, rows, pay);
    if (!rows.isEmpty()) table->selectRow(std::min(sel, int(rows.size()) - 1));
}
void ModuleDesigner::add() { FieldDialog dlg(this, QJsonObject{{"key", ""}, {"label", ""}, {"type", "text"}}); if (dlg.exec()) { QJsonArray a = fields(); a.append(dlg.f); d["fields"] = a; refresh(a.size() - 1); } }
void ModuleDesigner::edit() {
    const int i = table->currentRow(); QJsonArray a = fields();
    if (i < 0 || i >= a.size()) return;
    FieldDialog dlg(this, a[i].toObject());
    if (dlg.exec()) { a[i] = dlg.f; d["fields"] = a; refresh(i); }
}
void ModuleDesigner::move(int n) {
    const int i = table->currentRow(); QJsonArray a = fields();
    if (i < 0 || i + n < 0 || i + n >= a.size()) return;
    const QJsonValue x = a[i]; a[i] = a[i + n]; a[i + n] = x; d["fields"] = a; refresh(i + n);
}
void ModuleDesigner::remove() { const int i = table->currentRow(); QJsonArray a = fields(); if (i >= 0 && i < a.size()) { a.removeAt(i); d["fields"] = a; refresh(i); } }
void ModuleDesigner::save() {
    QJsonObject body = d;
    body["title"] = name->text().trimmed(); body["titleAr"] = ar->text().trimmed().isEmpty() ? QJsonValue(QJsonValue::Null) : QJsonValue(ar->text().trimmed());
    body["icon"] = icon->currentData().toString(); body["color"] = color->text().trimmed().isEmpty() ? QString("#6366f1") : color->text().trimmed();
    QJsonArray fs; for (const QJsonValue& f : fields()) if (!f.toObject().value("label").toString().trimmed().isEmpty()) fs.append(f);
    body["fields"] = fs;
    auto ok = [this](const QJsonValue& v) { onSaved(v.toObject()); accept(); };
    auto bad = [this](const QString& e) { err->setText(e); };
    if (mod.isEmpty()) Api::I().call("POST", "/custom/modules", body, this, ok, bad);
    else Api::I().call("PUT", "/custom/modules/" + mod.value("key").toString(), body, this, ok, bad);
}

CusRecordDialog::CusRecordDialog(QWidget* parent, const QJsonObject& m, const QJsonObject& r, bool canEdit, std::function<void()> saved) : QDialog(parent), mod(m), rec(r), onSaved(saved) {
    setWindowTitle(r.isEmpty() ? t("cus.new") : r.value("code").toString());
    const QJsonArray fs = m.value("def").toObject().value("fields").toArray();
    resize(480, 120 + 40 * fs.size());
    auto* form = new QFormLayout(this);
    const QJsonObject data = r.value("data").toObject();
    for (const QJsonValue& fv : fs) {
        const QJsonObject f = fv.toObject(); const QString k = f.value("key").toString(), ty = f.value("type").toString(); const QJsonValue v = data.value(k);
        QWidget* wd;
        if (ty == "textarea") { auto* e = new QPlainTextEdit(v.isNull() || v.isUndefined() ? QString() : v.toString()); e->setFixedHeight(80); wd = e; }
        else if (ty == "select") {
            auto* c = new QComboBox; c->addItem("", "");
            for (const QJsonValue& o : f.value("options").toArray()) c->addItem(o.toString(), o.toString());
            c->setCurrentIndex(std::max(0, c->findData(v.toString()))); wd = c;
        }
        else if (ty == "checkbox") { auto* c = new QCheckBox; c->setChecked(v.toBool()); wd = c; }
        else {
            QString s; if (v.isDouble()) { const double dd = v.toDouble(); s = dd == std::floor(dd) ? QString::number(qint64(dd)) : QString::number(dd, 'g', QLocale::FloatingPointShortest); } else s = v.toString();
            auto* e = new QLineEdit(s); if (ty == "date") e->setPlaceholderText("yyyy-mm-dd"); wd = e;
        }
        wd->setEnabled(canEdit);
        w[k] = wd;
        form->addRow(Custom::flabel(f) + (f.value("required").toBool() ? " *" : ""), wd);
    }
    err = Ui::label("", "error");
    form->addRow(err);
    auto* row = new QHBoxLayout;
    if (canEdit) { row->addWidget(Ui::button(t("cal.save"), [this] { save(); })); if (!rec.isEmpty()) row->addWidget(Ui::button(t("cal.delete"), [this] { del(); }, "danger")); }
    row->addWidget(Ui::button(t("cal.close"), [this] { reject(); }, "ghost"));
    form->addRow(row);
}
QJsonObject CusRecordDialog::values() const {
    QJsonObject out;
    for (const QJsonValue& fv : mod.value("def").toObject().value("fields").toArray()) {
        const QJsonObject f = fv.toObject(); const QString k = f.value("key").toString(), ty = f.value("type").toString();
        if (ty == "textarea") out[k] = static_cast<QPlainTextEdit*>(w[k])->toPlainText();
        else if (ty == "select") out[k] = static_cast<QComboBox*>(w[k])->currentData().toString();
        else if (ty == "checkbox") out[k] = static_cast<QCheckBox*>(w[k])->isChecked();
        else {
            const QString s = static_cast<QLineEdit*>(w[k])->text().trimmed();
            bool ok = false; const double x = s.toDouble(&ok);
            if (ty == "number" && !s.isEmpty() && ok) out[k] = x; else out[k] = s;
        }
    }
    return out;
}
void CusRecordDialog::save() {
    const QJsonObject body{{"data", values()}};
    auto ok = [this](const QJsonValue&) { onSaved(); accept(); };
    auto bad = [this](const QString& e) { err->setText(e); };
    if (rec.isEmpty()) Api::I().call("POST", "/custom/records/" + mod.value("key").toString(), body, this, ok, bad);
    else Api::I().call("PUT", "/custom/records/" + mod.value("key").toString() + "/" + rec.value("id").toString(), body, this, ok, bad);
}
void CusRecordDialog::del() {
    if (Ui::ask(this, t("cal.delete") + "?", t("cal.delete"), t("cal.close")))
        Api::I().call("DELETE", "/custom/records/" + mod.value("key").toString() + "/" + rec.value("id").toString(), QJsonValue(), this, [this](const QJsonValue&) { onSaved(); accept(); }, [this](const QString& e) { err->setText(e); });
}

CustomPage::CustomPage() {
    auto* l = new QVBoxLayout(this);
    l->addWidget(Ui::label(t("tab.cus"), "title"));
    auto* bar = new QHBoxLayout;
    pick = new QComboBox;
    connect(pick, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this] { loadRecords(); });
    bar->addWidget(pick, 1);
    search = new QLineEdit; search->setPlaceholderText(t("cus.search")); search->setMaximumWidth(220);
    connect(search, &QLineEdit::returnPressed, this, [this] { loadRecords(); });
    bar->addWidget(search);
    bNew = Ui::button(t("cus.new"), [this] { openRec(true); });
    bMod = Ui::button(t("cus.newModule"), [this] { design(true); }, "ghost");
    bDes = Ui::button(t("cus.design"), [this] { design(false); }, "ghost");
    bDel = Ui::button(QString::fromUtf8("✕ ") + t("cus.name"), [this] { delModule(); }, "danger");
    for (QPushButton* b : {bNew, bMod, bDes, bDel}) bar->addWidget(b);
    l->addLayout(bar);
    table = Ui::table({});
    connect(table, &QTableWidget::doubleClicked, this, [this] { openRec(false); });
    l->addWidget(table, 1);
    msg = new QLabel; l->addWidget(msg);
}
QJsonObject CustomPage::cur() const { for (const QJsonValue& m : mods) if (m.toObject().value("key").toString() == pick->currentData().toString()) return m.toObject(); return {}; }
void CustomPage::reload() {
    const QString keep = pick->currentData().toString();
    bMod->setVisible(Api::I().can("cus.design"));
    Api::I().call("GET", "/custom/modules", QJsonValue(), this, [this, keep](const QJsonValue& v) { gotModules(v.toArray(), keep); }, [this](const QString& e) { msg->setText(e); });
}
void CustomPage::gotModules(const QJsonArray& m, const QString& keep) {
    mods = m;
    pick->blockSignals(true); pick->clear();
    for (const QJsonValue& mv : m) pick->addItem(Custom::title(mv.toObject()), mv.toObject().value("key").toString());
    pick->setCurrentIndex(std::max(0, pick->findData(keep)));
    pick->blockSignals(false);
    loadRecords();
}
void CustomPage::loadRecords() {
    const QJsonObject m = cur();
    bNew->setVisible(!m.isEmpty() && Api::I().can("cus.manage")); bDes->setVisible(!m.isEmpty() && Api::I().can("cus.design")); bDel->setVisible(!m.isEmpty() && Api::I().can("cus.design"));
    if (m.isEmpty()) { Ui::fill(table, {}, {}); msg->setText(t("cus.empty")); return; }
    QJsonArray cols; int n = 0; for (const QJsonValue& f : m.value("def").toObject().value("fields").toArray()) if (n++ < 6) cols.append(f);
    QStringList heads{"#"}; for (const QJsonValue& f : cols) heads << Custom::flabel(f.toObject());
    table->setColumnCount(heads.size()); table->setHorizontalHeaderLabels(heads);
    Api::I().call("GET", "/custom/records/" + m.value("key").toString() + "?q=" + QString::fromLatin1(QUrl::toPercentEncoding(search->text().trimmed())), QJsonValue(), this, [this, cols](const QJsonValue& v) {
        QList<QStringList> rows; QList<QJsonObject> pay;
        for (const QJsonValue& rv : v.toArray()) { const QJsonObject r = rv.toObject(); QStringList c{r.value("code").toString()}; for (const QJsonValue& f : cols) c << Custom::show(f.toObject(), r); rows << c; pay << r; }
        Ui::fill(table, rows, pay);
        QString s = t("cus.sub"); s.replace("{n}", QString::number(rows.size()));
        msg->setText(rows.isEmpty() ? t("cus.none") : s);
    }, [this](const QString& e) { msg->setText(e); });
}
void CustomPage::openRec(bool isNew) {
    const QJsonObject m = cur(); QJsonObject r;
    if (m.isEmpty()) return;
    if (!isNew && (!Ui::selected(table, r) || r.isEmpty())) return;
    if (isNew && !Api::I().can("cus.manage")) return;
    CusRecordDialog(this, m, r, Api::I().can("cus.manage"), [this] { loadRecords(); }).exec();
}
void CustomPage::design(bool isNew) {
    const QJsonObject m = isNew ? QJsonObject() : cur();
    if (!isNew && m.isEmpty()) return;
    ModuleDesigner(this, m, [this](const QJsonObject& saved) { const QString k = saved.value("key").toString(); Api::I().call("GET", "/custom/modules", QJsonValue(), this, [this, k](const QJsonValue& v) { gotModules(v.toArray(), k); }, [](const QString&) {}); }).exec();
}
void CustomPage::delModule() {
    const QJsonObject m = cur(); if (m.isEmpty()) return;
    if (Ui::ask(this, t("cal.delete") + " " + Custom::title(m) + "?", t("cal.delete"), t("cal.close")))
        Api::I().call("DELETE", "/custom/modules/" + m.value("key").toString(), QJsonValue(), this, [this](const QJsonValue&) { gotModules(QJsonArray(), ""); reload(); }, [this](const QString& e) { Ui::warn(this, e); });
}
