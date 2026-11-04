#pragma once
#include <QComboBox>
#include <QDate>
#include <QJsonArray>
#include <QJsonObject>
#include <QLineEdit>
#include <QMap>

#include "Pages.h"

/// Finance reports: overview, trial balance, income statement, balance sheet, receivables / payables ageing, budgets, projects, fixed assets,
/// bank reconciliation and the audit trail. Described by finance.json (shared by every desktop app); the figures are calculated from the same
/// finance records as the portal (port of fin.calc.ts).
namespace Fin {
struct Filters { QString from, to, company; };
struct Built { QList<QStringList> rows; QList<QJsonObject> payloads; QString foot; };
const QJsonObject& spec();
QString L(const QString& key, const QStringList& args = {});
QString tx(const QJsonObject& o);
QString money(double v);
double num(const QJsonValue& v);
double r2(double v);
/// data: record kind -> array of finance rows (or "summary" / "audit" for the server reports)
Built build(const QString& reportId, const QMap<QString, QJsonValue>& data, const Filters& f, const QString& today);
}

class FinancePage : public Page {
    Q_OBJECT
public:
    FinancePage();
    void reload() override;
    QComboBox* pick;
    QLineEdit *from, *to, *company;
    QTableWidget* table;
    QLabel *foot, *msg;
    QPushButton *bRec, *bUnrec, *bSeed;
    QJsonArray reports;
    QMap<QString, QJsonValue> data;
    QString current;
    void showData(const QString& id);
    void mark(bool v);
};
