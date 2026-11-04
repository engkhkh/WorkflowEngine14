#pragma once
#include <QJsonArray>
#include <QMap>

#include "Bi.h"
#include "Charts.h"
#include "Pages.h"

class QScrollArea;

class ScrollPage : public Page {
    Q_OBJECT
public:
    ScrollPage();
protected:
    QVBoxLayout* il;
};

class DashboardPage : public ScrollPage {
    Q_OBJECT
public:
    DashboardPage(std::function<void(int)> goPage, std::function<void(const QString&, const QString&)> openKind);
    void reload() override;
    void fill(const QJsonArray& instances, const QJsonArray& tasks);   // also used by the smoke test
    FlowStrip* flowForTest() { return flow; }
    QTableWidget* stageTableForTest() { return stageTbl; }
    KpiCard* kpi(const QString& k) { return kpis.value(k); }
private:
    void pickStage(const QString& s);
    std::function<void(int)> go;
    QLabel* hello;
    QMap<QString, KpiCard*> kpis;
    FlowStrip* flow;
    QTableWidget *stageTbl, *queue, *recent;
    TrendChart* trend;
    HBars* mods;
    QList<Bi::Doc> docs;
    QString stage;
};

class ReportsPage : public ScrollPage {
    Q_OBJECT
public:
    ReportsPage();
    void reload() override;
    void fill(const QJsonArray& instances);
    QTableWidget* moduleTable() { return tMod; }
    QString csv() const;
    void designer();
private:
    void exportCsv();
    QList<QStringList> groupRows(bool byModule) const;
    QTableWidget *tMod, *tBr;
    HBars *bott, *turn, *cust, *vend;
    QList<Bi::Doc> docs;
    QList<QStringList> modRows, brRows;
};

QList<QStringList> docRows(const QList<Bi::Doc>& docs);
QStringList docHeaders();
