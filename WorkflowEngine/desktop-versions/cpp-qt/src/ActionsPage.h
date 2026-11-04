#pragma once
#include <QComboBox>
#include <QDoubleSpinBox>
#include <QJsonArray>
#include <QJsonObject>
#include <QLineEdit>
#include <QPushButton>
#include <QSpinBox>
#include <QTabWidget>

#include "Pages.h"

/// Operations and finance actions: work orders, accounting periods, the monthly depreciation run. Same endpoints and rules as the portal.
namespace Act {
struct Dep { double amount = 0; int months = 0; QString last; };
QStringList periodsDue(const QJsonObject& d, const QString& upTo);
Dep depreciationDue(const QJsonObject& d, const QString& upTo);
QString nextMonth(const QString& p);
double r2(double v);
double invoiceTotal(const QJsonObject& d);
QString matchInvoice(const QJsonObject& d, double tol);
/// journal lines for an invoice (same rules as the portal); empty when the default accounts are missing
QJsonArray ledgerLines(const QString& side, const QJsonObject& rec, const QJsonObject& df);
}

class ActionsPage : public Page {
    Q_OBJECT
public:
    ActionsPage();
    void reload() override;
    QTabWidget* tabs;
    QLabel* msg;
    // work orders
    QTableWidget* wo = nullptr;
    QComboBox* bom = nullptr;
    QDoubleSpinBox* qty = nullptr;
    QLineEdit* due = nullptr;
    QPushButton *bRel = nullptr, *bStart = nullptr, *bDone = nullptr, *bCancel = nullptr;
    QJsonArray woRows, boms;
    QMap<QString, double> stock;
    // periods
    QTableWidget* per = nullptr;
    QSpinBox* year = nullptr;
    QPushButton *bClose = nullptr, *bOpen = nullptr;
    QJsonArray perRows;
    // depreciation
    QTableWidget* dep = nullptr;
    QLineEdit* month = nullptr;
    QLabel* total = nullptr;
    QPushButton* bRun = nullptr;
    QJsonArray assets;
    QJsonObject defaults;
    QList<QPair<QJsonObject, Act::Dep>> items;
    // invoices
    QTableWidget* inv = nullptr;
    QComboBox* side = nullptr;
    QPushButton *bPost = nullptr, *bEinv = nullptr;
    QJsonArray invRows;
    QJsonObject invDefaults;
    double tol = 2;
    QList<std::function<void()>> views;
    void say(const QString& m) { msg->setText(m); }
    void buildWo(QWidget* w);
    void buildPer(QWidget* w);
    void buildDep(QWidget* w);
    void loadWo();
    void gateWo();
    void step(const QString& a);
    void complete();
    void createWo();
    void loadPer();
    void gatePer();
    void setPer(const QString& status);
    void generate();
    void loadDep();
    void paintDep();
    void runDep();
    void buildInv(QWidget* w);
    void loadInv();
    void gateInv();
    void postInv();
    void einvoice();
    QString invKind() const { return side->currentData().toString() == "ap" ? "apinvoice" : "arinvoice"; }
};
