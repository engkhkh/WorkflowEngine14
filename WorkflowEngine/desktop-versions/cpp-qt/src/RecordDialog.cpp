#include "RecordDialog.h"

#include <QFormLayout>
#include <QTabWidget>
#include "Forms.h"
#include <QHBoxLayout>
#include <QHeaderView>
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QVBoxLayout>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

static bool isSimple(const QJsonValue& v) { return v.isNull() || v.isString() || v.isDouble() || v.isBool() || v.isUndefined(); }

RecordDialog::RecordDialog(QWidget* parent, const QJsonObject& module, const QJsonObject& kind, const QJsonObject& rec, bool isNew)
    : QDialog(parent), module_(module), kind_(kind), rec_(rec), data_(isNew ? kind.value("template").toObject() : rec.value("data").toObject()), isNew_(isNew) {
    editable_ = Api::I().can(kind.value("manage").toString()) && !kind.value("readOnly").toBool();
    setWindowTitle(isNew ? t("erp.new") : rec.value("code").toString());
    resize(540, 600);
    auto* outer = new QVBoxLayout(this);
    auto* tabs = new QTabWidget;
    outer->addWidget(tabs);
    auto* dataTab = new QWidget;
    auto* lay = new QVBoxLayout(dataTab);
    tabs->addTab(dataTab, t("collab.tab.data"));
    if (!isNew && !rec.value("id").toString().isEmpty())
        tabs->addTab(new Chatter(module.value("id").toString(), kind.value("kind").toString(), rec.value("id").toString()), t("collab.notes") + " / " + t("collab.files"));
    if (!editable_) lay->addWidget(Ui::label(t("erp.readOnly"), "dim"));
    auto* form = new QFormLayout;
    code = new QLineEdit(rec.value("code").toString());
    code->setEnabled(editable_ && isNew);
    status = new QLineEdit(rec.value("status").toString());
    company = new QLineEdit(rec.value("company").toString());
    ref = new QLineEdit(rec.value("ref").toString());
    for (QLineEdit* w : {status, company, ref}) w->setEnabled(editable_);
    form->addRow(t("erp.code"), code);
    form->addRow(t("erp.status"), status);
    form->addRow(t("erp.company"), company);
    form->addRow(t("erp.ref"), ref);
    lay->addLayout(form);
    lay->addWidget(Ui::label(t("erp.data"), "title"));
    table = new QTableWidget(0, 2);
    table->setHorizontalHeaderLabels({t("erp.fieldName"), t("erp.fieldValue")});
    table->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
    table->verticalHeader()->setVisible(false);
    lay->addWidget(table);
    fill();
    if (editable_) {
        auto* row = new QHBoxLayout;
        newKey = new QLineEdit;
        newKey->setPlaceholderText(t("erp.fieldName"));
        row->addWidget(newKey);
        row->addWidget(Ui::button(t("erp.addField"), [this] { addField(); }, "ghost"));
        row->addWidget(Ui::button(t("erp.removeField"), [this] { removeField(); }, "ghost"));
        lay->addLayout(row);
    }
    err = Ui::label({}, "error");
    outer->addWidget(err);
    auto* row = new QHBoxLayout;
    if (editable_) {
        row->addWidget(Ui::button(t("erp.save"), [this] { save(); }));
        if (!isNew) row->addWidget(Ui::button(t("erp.delete"), [this] { remove(); }, "danger"));
    }
    row->addStretch();
    row->addWidget(Ui::button(t("common.close"), [this] { reject(); }, "ghost"));
    outer->addLayout(row);
}

void RecordDialog::fill() {
    table->setRowCount(0);
    types.clear();
    int i = 0;
    for (auto it = data_.begin(); it != data_.end(); ++it, ++i) {
        table->insertRow(i);
        auto* k = new QTableWidgetItem(it.key());
        k->setFlags(Qt::ItemIsEnabled | Qt::ItemIsSelectable);
        table->setItem(i, 0, k);
        const QJsonValue v = it.value();
        QTableWidgetItem* vi;
        if (isSimple(v)) {
            types[it.key()] = v.isBool() ? "bool" : v.isDouble() ? "num" : "str";
            QString text;
            if (v.isBool()) text = v.toBool() ? "true" : "false";
            else if (v.isDouble()) text = QString::number(v.toDouble(), 'g', 15);
            else text = v.toString();
            vi = new QTableWidgetItem(text);
            if (!editable_) vi->setFlags(Qt::ItemIsEnabled);
        } else {
            types[it.key()] = "raw";
            const QByteArray js = v.isArray() ? QJsonDocument(v.toArray()).toJson(QJsonDocument::Compact) : QJsonDocument(v.toObject()).toJson(QJsonDocument::Compact);
            QString s = QString::fromUtf8(js);
            if (s.size() > 160) s = s.left(160) + QStringLiteral("…");
            vi = new QTableWidgetItem(s);
            vi->setFlags(Qt::ItemIsEnabled);
        }
        table->setItem(i, 1, vi);
    }
}

QJsonObject RecordDialog::collect() {
    QJsonObject out = data_;
    for (int i = 0; i < table->rowCount(); ++i) {
        const QString k = table->item(i, 0)->text();
        const QString txt = table->item(i, 1)->text();
        const QString ty = types.value(k, "str");
        if (ty == "raw") continue;
        if (ty == "num") {
            bool ok = false;
            const double d = txt.trimmed().toDouble(&ok);
            out[k] = ok ? QJsonValue(d) : QJsonValue(txt);
        } else if (ty == "bool") {
            const QString l = txt.trimmed().toLower();
            out[k] = (l == "true" || l == "1" || l == "yes");
        } else {
            out[k] = txt;
        }
    }
    return out;
}

void RecordDialog::addField() {
    const QString k = newKey->text().trimmed();
    if (!QRegularExpression("^[A-Za-z]\\w*$").match(k).hasMatch() || data_.contains(k)) return;
    data_ = collect();
    data_[k] = QString();
    newKey->clear();
    fill();
}

void RecordDialog::removeField() {
    const int r = table->currentRow();
    if (r < 0) return;
    const QString k = table->item(r, 0)->text();
    data_ = collect();
    data_.remove(k);
    fill();
}

void RecordDialog::save() {
    err->clear();
    auto nz = [](QLineEdit* e) { const QString s = e->text().trimmed(); return s.isEmpty() ? QJsonValue(QJsonValue::Null) : QJsonValue(s); };
    const QJsonObject body{{"code", nz(code)}, {"status", nz(status)}, {"company", nz(company)}, {"ref", nz(ref)}, {"data", collect()}};
    const QString m = module_.value("id").toString(), k = kind_.value("kind").toString();
    auto ok = [this](const QJsonValue&) { accept(); };
    auto bad = [this](const QString& e) { err->setText(e); };
    if (isNew_) Api::I().createRecord(m, k, body, this, ok, bad);
    else Api::I().updateRecord(m, k, rec_.value("id").toString(), body, this, ok, bad);
}

void RecordDialog::remove() {
    if (!Ui::ask(this, t("erp.confirmDelete"), t("erp.delete"), t("common.cancel"))) return;
    Api::I().deleteRecord(module_.value("id").toString(), kind_.value("kind").toString(), rec_.value("id").toString(), this,
                          [this](const QJsonValue&) { accept(); }, [this](const QString& e) { err->setText(e); });
}
