#pragma once
// Small painter-drawn charts for the dashboard and reports.
#include <QFrame>
#include <QLabel>
#include <QList>
#include <QWidget>
#include <functional>
#include "Bi.h"

QString compactNum(double v);

class KpiCard : public QFrame {
public:
    KpiCard(const QString& label, const QString& color, std::function<void()> click);
    void set(const QString& value, const QString& hint = {});
protected:
    void mousePressEvent(QMouseEvent*) override { if (click_) click_(); }
private:
    QLabel *val, *hint;
    std::function<void()> click_;
};

struct FlowItem { QString key, label, value; int count; };
class FlowStrip : public QWidget {
    Q_OBJECT
public:
    FlowStrip();
    void set(const QList<FlowItem>& d) { data = d; update(); }
signals:
    void picked(const QString& key);
protected:
    void paintEvent(QPaintEvent*) override;
    void mousePressEvent(QMouseEvent*) override;
private:
    QList<FlowItem> data;
    QString active;
};

class TrendChart : public QWidget {
public:
    TrendChart(const QString& a, const QString& b);
    void set(const QList<Bi::Month>& p) { pts = p; update(); }
protected:
    void paintEvent(QPaintEvent*) override;
private:
    QList<Bi::Month> pts;
    QString a, b;
};

struct BarRow { QString label; double value; QString color, text; };
class HBars : public QWidget {
public:
    HBars();
    void set(const QList<BarRow>& r) { rows = r; setMinimumHeight(qMax(40, 26 * int(r.size()) + 8)); update(); }
protected:
    void paintEvent(QPaintEvent*) override;
private:
    QList<BarRow> rows;
};
