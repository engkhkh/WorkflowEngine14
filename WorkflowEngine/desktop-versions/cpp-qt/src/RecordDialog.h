#pragma once
#include <QDialog>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QMap>
#include <QTableWidget>

/// Header fields plus one row per simple key of data (numbers and yes/no keep their type).
class RecordDialog : public QDialog {
    Q_OBJECT
public:
    RecordDialog(QWidget* parent, const QJsonObject& module, const QJsonObject& kind, const QJsonObject& rec, bool isNew);
    QJsonObject collectForTest() { return collect(); }
    void addFieldForTest(const QString& k) { newKey->setText(k); addField(); }
    QTableWidget* tableForTest() { return table; }
private:
    void fill();
    QJsonObject collect();
    void addField();
    void removeField();
    void save();
    void remove();
    QJsonObject module_, kind_, rec_, data_;
    bool isNew_, editable_;
    QLineEdit *code, *status, *company, *ref, *newKey = nullptr;
    QTableWidget* table;
    QLabel* err;
    QMap<QString, QString> types;
};
