#pragma once
// Business-intelligence layer: workflow instances -> ERP documents, dashboard KPIs and report tables (port of the portal's erp-data.service.ts).
#include <QDateTime>
#include <QJsonArray>
#include <QJsonObject>
#include <QList>
#include <QMap>
#include <QString>
#include <QStringList>

namespace Bi {
struct Doc {
    QString id, type, module, number, title, party, currency, branch, stage, step, status, by;
    double total = 0; bool hasTotal = false;
    QDateTime date, completed;
    double age = 0;
    QJsonObject inst;
};
struct Kpis { double salesMonth = 0, purchasesMonth = 0, expensesMonth = 0, receivables = 0, payables = 0, pipeline = 0, committed = 0, inTransit = 0, avgCycleDays = 0, rejectRate = 0; int openDocs = 0, completedMonth = 0, myApprovals = 0; };
struct Month { int year, month; double sales = 0, purchases = 0; };
struct StageCount { int count = 0; double value = 0; };
struct Group { QString key; int count = 0, pending = 0, approved = 0, rejected = 0, ndone = 0; double days = 0, value = 0; double avgDays() const { return ndone ? days / ndone : 0; } };
struct Step { QString step; double avgHours = 0; int count = 0; };
struct Party { QString party; double value = 0; int count = 0; };

QStringList stages();
QMap<QString, QString> moduleColors();            // module id -> colour
QString colorOf(const QString& module);
QList<Doc> docsOf(const QJsonArray& instances);   // newest first
Kpis kpis(const QList<Doc>& d, int myTasks);
QList<Month> monthlyTrend(const QList<Doc>& d, int months = 6);
QMap<QString, StageCount> stageCounts(const QList<Doc>& d);
QList<Step> stepTurnaround(const QList<Doc>& d);
QList<Party> topParties(const QList<Doc>& d, const QStringList& types, int limit = 5);
QList<Group> groupBy(const QList<Doc>& d, bool byModule);
QList<QPair<QString, int>> bottleneck(const QList<Doc>& d);
QString money(double v, const QString& cur = {});
}
