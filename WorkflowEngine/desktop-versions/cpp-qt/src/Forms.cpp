#include "Forms.h"

#include <QCheckBox>
#include <QComboBox>
#include <QDateEdit>
#include <QFile>
#include <QFileDialog>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QRegularExpression>
#include <QVBoxLayout>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

bool Forms::isNegative(const QString& d) {
    return QRegularExpression("reject|cancel|deny|return|out of stock|write off", QRegularExpression::CaseInsensitiveOption).match(d).hasMatch();
}

static QString typeOf(const QJsonObject& f) { const QString s = f.value("type").toString(); return s.isEmpty() ? QStringLiteral("Text") : s; }

TypedForm::TypedForm(const QJsonObject& form, QWidget* parent) : QWidget(parent), fields_(form.value("fields").toArray()) {
    auto* lay = new QFormLayout(this);
    lay->setContentsMargins(0, 0, 0, 0);
    for (const QJsonValue& fv : fields_) {
        const QJsonObject f = fv.toObject();
        const QString ty = typeOf(f), key = f.value("key").toString();
        const bool ro = f.value("readOnly").toBool();
        QWidget* w;
        if (ty == "TextArea") {
            auto* e = new QPlainTextEdit;
            e->setFixedHeight(70);
            e->setReadOnly(ro);
            e->setPlaceholderText(f.value("placeholder").toString());
            w = e;
        } else if (ty == "Select") {
            auto* c = new QComboBox;
            c->addItem(t("common.select"), QVariant());
            for (const QJsonValue& ov : f.value("options").toArray()) {
                const QJsonObject o = ov.toObject();
                const QString v = o.value("value").toString();
                c->addItem(o.value("label").toString().isEmpty() ? v : o.value("label").toString(), v);
            }
            c->setEnabled(!ro);
            w = c;
        } else if (ty == "Checkbox") {
            auto* c = new QCheckBox(f.value("placeholder").toString().isEmpty() ? t("common.yes") : f.value("placeholder").toString());
            c->setEnabled(!ro);
            w = c;
        } else if (ty == "Date") {
            auto* d = new QDateEdit;
            d->setCalendarPopup(true);
            d->setDisplayFormat("yyyy-MM-dd");
            d->setSpecialValueText(" ");
            d->setMinimumDate(QDate(1900, 1, 1));
            d->setDate(d->minimumDate());   // empty until the user picks a date
            d->setEnabled(!ro);
            w = d;
        } else {
            auto* e = new QLineEdit;
            e->setReadOnly(ro);
            e->setPlaceholderText(f.value("placeholder").toString());
            w = e;
        }
        w_[key] = w;
        const QString lbl = f.value("label").toString().isEmpty() ? key : f.value("label").toString();
        lay->addRow(lbl + (f.value("required").toBool() && !ro ? QStringLiteral(" *") : QString()), w);
    }
}

void TypedForm::setValues(const QJsonObject& data) {
    for (const QJsonValue& fv : fields_) {
        const QJsonObject f = fv.toObject();
        const QString k = f.value("key").toString(), ty = typeOf(f);
        const QJsonValue v = data.value(k);
        if (v.isNull() || v.isUndefined()) continue;
        const QString s = v.isBool() ? (v.toBool() ? "true" : "false") : v.isDouble() ? QString::number(v.toDouble(), 'g', 15) : v.toString();
        QWidget* w = w_.value(k);
        if (ty == "TextArea") static_cast<QPlainTextEdit*>(w)->setPlainText(s);
        else if (ty == "Select") { auto* c = static_cast<QComboBox*>(w); c->setCurrentIndex(qMax(0, c->findData(s))); }
        else if (ty == "Checkbox") static_cast<QCheckBox*>(w)->setChecked(s == "true" || s == "1" || s.toLower() == "yes");
        else if (ty == "Date") { const QDate d = QDate::fromString(s.left(10), "yyyy-MM-dd"); if (d.isValid()) static_cast<QDateEdit*>(w)->setDate(d); }
        else static_cast<QLineEdit*>(w)->setText(s);
    }
}

QJsonValue TypedForm::valueOf(const QJsonObject& f) const {
    QWidget* w = w_.value(f.value("key").toString());
    const QString ty = typeOf(f);
    if (ty == "TextArea") return static_cast<QPlainTextEdit*>(w)->toPlainText();
    if (ty == "Select") { const QVariant d = static_cast<QComboBox*>(w)->currentData(); return d.isNull() || !d.isValid() ? QJsonValue(QJsonValue::Null) : QJsonValue(d.toString()); }
    if (ty == "Checkbox") return static_cast<QCheckBox*>(w)->isChecked();
    if (ty == "Date") { auto* d = static_cast<QDateEdit*>(w); return d->date() == d->minimumDate() ? QJsonValue(QJsonValue::Null) : QJsonValue(d->date().toString("yyyy-MM-dd")); }
    const QString txt = static_cast<QLineEdit*>(w)->text().trimmed();
    if (ty == "Number") {
        if (txt.isEmpty()) return QJsonValue(QJsonValue::Null);
        bool ok = false;
        const qlonglong n = txt.toLongLong(&ok);
        if (ok) return QJsonValue(double(n));
        const double d = txt.toDouble(&ok);
        return ok ? QJsonValue(d) : QJsonValue(QJsonValue::Null);
    }
    return txt;
}

QStringList TypedForm::missing() const {
    QStringList out;
    for (const QJsonValue& fv : fields_) {
        const QJsonObject f = fv.toObject();
        if (!f.value("required").toBool() || f.value("readOnly").toBool()) continue;
        const QJsonValue v = valueOf(f);
        if (v.isNull() || (v.isString() && v.toString().isEmpty())) out << f.value("key").toString();
    }
    return out;
}

QJsonObject TypedForm::values() const {
    QJsonObject out;
    for (const QJsonValue& fv : fields_) {
        const QJsonObject f = fv.toObject();
        if (f.value("readOnly").toBool()) continue;
        const QJsonValue v = valueOf(f);
        if (!v.isNull()) out[f.value("key").toString()] = v;
    }
    return out;
}

// ------------------------------------------------------------------------------------------------ Chatter
Chatter::Chatter(const QString& module, const QString& kind, const QString& rid, QWidget* parent) : QWidget(parent), m_(module), k_(kind), id_(rid) {
    auto* v = new QVBoxLayout(this);
    v->setContentsMargins(0, 0, 0, 0);
    tabs_ = new QTabWidget;
    v->addWidget(tabs_);
    err_ = Ui::label({}, "error");
    v->addWidget(err_);
    auto* nw = new QWidget;
    auto* nl = new QVBoxLayout(nw);
    notes_ = new QListWidget;
    notes_->setWordWrap(true);
    text_ = new QTextEdit;
    text_->setPlaceholderText(t("collab.notePh"));
    text_->setFixedHeight(60);
    nl->addWidget(notes_, 1);
    nl->addWidget(text_);
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button(t("collab.send"), [this] { send(); }));
    row->addWidget(Ui::button(t("collab.delete"), [this] { delNote(); }, "ghost"));
    row->addStretch();
    nl->addLayout(row);
    tabs_->addTab(nw, t("collab.notes"));
    auto* fw = new QWidget;
    auto* fl = new QVBoxLayout(fw);
    files_ = new QListWidget;
    fl->addWidget(files_, 1);
    fl->addWidget(Ui::label(t("collab.maxSize"), "dim"));
    auto* r2 = new QHBoxLayout;
    r2->addWidget(Ui::button(t("collab.choose"), [this] { pick(); }));
    r2->addWidget(Ui::button(t("collab.download"), [this] { download(); }, "ghost"));
    r2->addWidget(Ui::button(t("collab.delete"), [this] { delFile(); }, "ghost"));
    r2->addStretch();
    fl->addLayout(r2);
    tabs_->addTab(fw, t("collab.files"));
    load();
}

void Chatter::load() {
    Api::I().notes(m_, k_, id_, this, [this](const QJsonValue& v) {
        QList<QJsonObject> rows;
        for (const QJsonValue& x : v.toArray()) rows << x.toObject();
        std::sort(rows.begin(), rows.end(), [](const QJsonObject& a, const QJsonObject& b) { return a.value("createdAt").toString() > b.value("createdAt").toString(); });
        notes_->clear();
        for (const QJsonObject& n : rows) {
            auto* it = new QListWidgetItem(n.value("author").toString() + "  ·  " + n.value("createdAt").toString().left(16).replace('T', ' ') + "\n" + n.value("text").toString());
            it->setData(Qt::UserRole, QVariant::fromValue(n));
            if (n.value("system").toBool()) it->setForeground(Qt::gray);
            notes_->addItem(it);
        }
        tabs_->setTabText(0, t("collab.notes") + " (" + QString::number(rows.size()) + ")");
    }, [this](const QString& e) { err_->setText(e); });
    Api::I().files(m_, k_, id_, this, [this](const QJsonValue& v) {
        files_->clear();
        for (const QJsonValue& x : v.toArray()) {
            const QJsonObject f = x.toObject();
            const int kb = qMax(1, int(f.value("size").toDouble() / 1024 + 0.5));
            auto* it = new QListWidgetItem(f.value("name").toString() + "   —   " + QString::number(kb) + " KB · " + f.value("author").toString() + " · " + f.value("createdAt").toString().left(10));
            it->setData(Qt::UserRole, QVariant::fromValue(f));
            files_->addItem(it);
        }
        tabs_->setTabText(1, t("collab.files") + " (" + QString::number(files_->count()) + ")");
    }, [](const QString&) {});
}

void Chatter::send() {
    const QString txt = text_->toPlainText().trimmed();
    if (txt.isEmpty()) return;
    err_->clear();
    Api::I().addNote(m_, k_, id_, txt, this, [this](const QJsonValue&) { text_->clear(); load(); }, [this](const QString& e) { err_->setText(e); });
}

void Chatter::delNote() {
    auto* it = notes_->currentItem();
    if (!it) return;
    const QJsonObject n = it->data(Qt::UserRole).toJsonObject();
    if (n.value("system").toBool()) return;
    Api::I().deleteNote(n.value("id").toString(), this, [this](const QJsonValue&) { load(); }, [this](const QString& e) { err_->setText(e); });
}

void Chatter::pick() {
    const QStringList paths = QFileDialog::getOpenFileNames(this, t("collab.attach"));
    for (const QString& p : paths) {
        QFile f(p);
        if (!f.open(QIODevice::ReadOnly)) { err_->setText(f.errorString()); continue; }
        attach(p.section('/', -1).section('\\', -1), f.readAll());
    }
}

void Chatter::attach(const QString& name, const QByteArray& bytes) {
    if (bytes.size() > 4 * 1024 * 1024) { err_->setText(QString(t("collab.tooBig")).replace("{name}", name)); return; }
    Api::I().addFile(m_, k_, id_, name, "application/octet-stream", QString::fromLatin1(bytes.toBase64()), this,
                     [this](const QJsonValue&) { load(); }, [this](const QString& e) { err_->setText(e); });
}

void Chatter::download() {
    auto* it = files_->currentItem();
    if (!it) return;
    const QJsonObject f = it->data(Qt::UserRole).toJsonObject();
    const QString dest = QFileDialog::getSaveFileName(this, t("collab.download"), f.value("name").toString());
    if (dest.isEmpty()) return;
    Api::I().fileBytes(f.value("id").toString(), this, [this, dest](const QByteArray& b) {
        QFile o(dest);
        if (o.open(QIODevice::WriteOnly)) o.write(b); else err_->setText(o.errorString());
    }, [this](const QString& e) { err_->setText(e); });
}

void Chatter::delFile() {
    auto* it = files_->currentItem();
    if (!it) return;
    Api::I().deleteFile(it->data(Qt::UserRole).toJsonObject().value("id").toString(), this, [this](const QJsonValue&) { load(); }, [this](const QString& e) { err_->setText(e); });
}
