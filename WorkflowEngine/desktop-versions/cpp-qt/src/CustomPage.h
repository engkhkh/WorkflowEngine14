#pragma once
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QJsonArray>
#include <QJsonObject>
#include <QLineEdit>
#include <QMap>

#include "Pages.h"

/// Custom modules: design a module (name, icon, fields) and keep its records. Everything is generated from the module definition.
namespace Custom {
const QJsonObject& spec();
QString title(const QJsonObject& m);
QString flabel(const QJsonObject& f);
}

class FieldDialog : public QDialog {
    Q_OBJECT
public:
    FieldDialog(QWidget* parent, const QJsonObject& f);
    QJsonObject f;
    QLineEdit *name, *ar, *opt;
    QComboBox* type;
    QCheckBox* req;
    void ok();
};

class ModuleDesigner : public QDialog {
    Q_OBJECT
public:
    ModuleDesigner(QWidget* parent, const QJsonObject& mod, std::function<void(const QJsonObject&)> onSaved);
    QJsonObject mod, d;
    std::function<void(const QJsonObject&)> onSaved;
    QLineEdit *name, *ar, *color;
    QComboBox* icon;
    QTableWidget* table;
    QLabel* err;
    QJsonArray fields() const { return d.value("fields").toArray(); }
    void refresh(int sel = 0);
    void add(); void edit(); void move(int n); void remove(); void save();
};

class CusRecordDialog : public QDialog {
    Q_OBJECT
public:
    CusRecordDialog(QWidget* parent, const QJsonObject& mod, const QJsonObject& rec, bool canEdit, std::function<void()> onSaved);
    QJsonObject mod, rec;
    std::function<void()> onSaved;
    QMap<QString, QWidget*> w;
    QLabel* err;
    QJsonObject values() const;
    void save(); void del();
};

class CustomPage : public Page {
    Q_OBJECT
public:
    CustomPage();
    void reload() override;
    QComboBox* pick;
    QLineEdit* search;
    QPushButton *bNew, *bMod, *bDes, *bDel;
    QTableWidget* table;
    QLabel* msg;
    QJsonArray mods;
    QJsonObject cur() const;
    void gotModules(const QJsonArray& m, const QString& keep);
    void loadRecords();
    void openRec(bool isNew);
    void design(bool isNew);
    void delModule();
};
