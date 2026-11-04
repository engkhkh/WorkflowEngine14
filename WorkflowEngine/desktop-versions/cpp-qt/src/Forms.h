#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QLabel>
#include <QListWidget>
#include <QMap>
#include <QTabWidget>
#include <QTextEdit>
#include <QWidget>

namespace Forms {
bool isNegative(const QString& decision);
}

/// One editor per field of a form definition {title, fields:[{key,label,type,required,readOnly,options,placeholder}]}.
class TypedForm : public QWidget {
    Q_OBJECT
public:
    explicit TypedForm(const QJsonObject& form, QWidget* parent = nullptr);
    void setValues(const QJsonObject& data);
    /// Required, editable fields that are still empty.
    QStringList missing() const;
    /// Only the fields this step owns (read-only echoes are not sent back).
    QJsonObject values() const;
    QWidget* editor(const QString& key) const { return w_.value(key); }
private:
    QJsonValue valueOf(const QJsonObject& f) const;
    QJsonArray fields_;
    QMap<QString, QWidget*> w_;
};

/// Notes and file attachments of one record; the server checks the caller's module privileges.
class Chatter : public QWidget {
    Q_OBJECT
public:
    Chatter(const QString& module, const QString& kind, const QString& rid, QWidget* parent = nullptr);
    QListWidget* notesForTest() { return notes_; }
    QListWidget* filesForTest() { return files_; }
    void sendForTest(const QString& text) { text_->setPlainText(text); send(); }
    void attachForTest(const QString& name, const QByteArray& bytes) { attach(name, bytes); }
private:
    void load();
    void send();
    void delNote();
    void pick();
    void attach(const QString& name, const QByteArray& bytes);
    void download();
    void delFile();
    QString m_, k_, id_;
    QTabWidget* tabs_;
    QListWidget *notes_, *files_;
    QTextEdit* text_;
    QLabel* err_;
};
