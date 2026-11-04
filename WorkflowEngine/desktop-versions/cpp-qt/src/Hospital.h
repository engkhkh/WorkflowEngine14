#pragma once
#include <QComboBox>
#include <QJsonArray>
#include <QJsonObject>
#include <QLineEdit>
#include <QTabWidget>
#include <QTextBrowser>

#include "Pages.h"

/// Hospital: patients, appointments, visits, lab, pharmacy, wards and billing.
/// The screens are described by hospital.json (shared by every desktop app); this is the engine that draws them.
namespace Hos {
QJsonValue getp(const QJsonValue& o, const QString& path);
void setp(QJsonObject& o, const QString& path, const QJsonValue& v);
QJsonValue templ(const QJsonValue& v, const QJsonObject& row);
QString cell(const QJsonObject& rec, const QJsonObject& col);
QStringList flatten(const QJsonValue& o, int ind = 0);
QString dxText(const QJsonArray& a);
QJsonArray dxList(const QString& txt);
QString today();
/// values: field key -> text / bool; returns the request body the action describes
QJsonObject buildBody(const QJsonObject& act, const QMap<QString, QVariant>& vals, const QJsonObject& row, bool keepEmpty = false);
/// runs one action; on a safety warning (409 + warnings) err gets the message and warn the list
void run(const QJsonObject& sec, const QJsonObject& act, const QJsonObject& row, const QMap<QString, QVariant>& vals, const QJsonObject& extra, QObject* ctx,
         std::function<void(const QJsonValue&)> ok, std::function<void(const QString&, const QStringList&)> err);
const QJsonArray& sections();
}

class HosSection : public QWidget {
    Q_OBJECT
public:
    explicit HosSection(const QJsonObject& sec);
    void reload();
    QJsonObject sec;
    QJsonArray rows;
    QLineEdit *q = nullptr, *day = nullptr;
    QComboBox* status = nullptr;
    QTableWidget* table = nullptr;
    QTextBrowser* detail = nullptr;
    QMap<QString, QPushButton*> btns;
    QLabel* err = nullptr;
    void act(const QJsonObject& a, bool creating);
    void perform(const QJsonObject& a, const QJsonObject& row, const QMap<QString, QVariant>& vals, const QJsonObject& extra = {});
    bool enabledFor(const QString& actionId) const { return btns.contains(actionId) && btns[actionId]->isEnabled(); }
private:
    void selChanged();
    void paint(const QJsonArray& r);
};

class HosDashboard : public QWidget {
    Q_OBJECT
public:
    HosDashboard();
    void reload();
    QTextBrowser* body;
    QLabel* err;
};

class HospitalPage : public Page {
    Q_OBJECT
public:
    HospitalPage();
    void reload() override;
    QTabWidget* tabs;
    QList<QJsonObject> secs;
    QList<QWidget*> views;
};
