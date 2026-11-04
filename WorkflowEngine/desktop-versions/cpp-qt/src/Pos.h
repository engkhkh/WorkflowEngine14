#pragma once
#include <QComboBox>
#include <QDoubleSpinBox>
#include <QJsonArray>
#include <QJsonObject>
#include <QListWidget>
#include <QMap>
#include <QSpinBox>
#include <QTabWidget>

#include "Pages.h"

/// Point of sale: till, shifts and sales history with receipts (port of the portal's /pos/terminal, /pos/shifts, /pos/sales).
namespace Pos {
struct Priced {
    QList<QJsonObject> lines;
    double subtotal = 0, discount = 0, tax = 0, total = 0;
};
double r2(double n);
QString money(double v);
/// items: [{sku, qty, discountPct}]
Priced priceCart(const QJsonArray& items, const QJsonArray& products, const QJsonArray& promos, const QJsonObject& customer, double orderPct, const QJsonObject& cfg);
QString receiptHtml(const QJsonObject& sale, const QJsonObject& settings);

struct State {
    QJsonArray products, categories, customers, promos, registers;
    QJsonObject settings, shift;
    QMap<QString, double> stock;
    bool loaded = false;
    void load(QObject* ctx, std::function<void()> done, std::function<void(const QString&)> err);
};
}

class TillView : public QWidget {
public:
    TillView(Pos::State* st, std::function<void()> onShift);
    void refresh();
    void add(const QString& sku);
    void setCustomer(const QString& code);
    void clear();
    Pos::Priced priced() const;
    int productCount() const { return grid->count(); }
    void setFilter(const QString& s) { q->setText(s); }
    int cartSize() const { return cart.size(); }
    int heldCount() const;
    void hold();
    void pay(bool autoExact = false);          // autoExact: skip the dialog and pay the exact amount in cash (tests)
    bool gateVisible() const { return !gate->isHidden(); }
    void openShift(double opening);
    void setLineDisc(int row, int pct);
    QString lastReceipt;
private:
    void fillProducts();
    void repaintCart();
    void scan();
    void recall();
    void flush();
    void updateQueue();
    void checkout(const QJsonObject& body, double remaining, bool autoExact);
    double stockOf(const QJsonObject& p, bool& tracked) const;
    int sel() const;
    Pos::State* st;
    std::function<void()> onShift;
    QJsonArray cart;
    QString customerCode;
    double orderPct = 0;
    bool busy = false;
    QLabel *banner, *queueLbl, *shiftLbl, *custInfo, *tot;
    QPushButton *queueBtn, *holdB, *recallB, *clearB, *payB;
    QWidget *gate, *till;
    QComboBox *reg, *cat, *cust;
    QDoubleSpinBox* floatBox;
    QLineEdit* q;
    QListWidget* grid;
    QTableWidget* lines;
    QSpinBox *lineDisc, *order;
};

class ShiftsView : public QWidget {
public:
    ShiftsView(Pos::State* st, std::function<void()> onChange);
    void refresh();
    QTableWidget* historyTable() { return table; }
    void cashMove(const QString& type, double amount);
    void closeShift(double counted);
private:
    void fill(const QJsonArray& rows);
    Pos::State* st;
    std::function<void()> onChange;
    QLabel *msg, *head, *kv;
    QPushButton *bIn, *bOut, *bClose, *bOpen;
    QComboBox* reg;
    QDoubleSpinBox* floatBox;
    QTableWidget* table;
};

class SalesView : public QWidget {
public:
    explicit SalesView(Pos::State* st);
    void load();
    int rowCount() const { return table->rowCount(); }
    QJsonObject first() const;
    void doReturn(const QJsonObject& sale, const QJsonArray& lines, const QString& method, const QString& reason);
    void doVoid(const QJsonObject& sale);
    bool canReturn(const QJsonObject& s) const;
    bool canVoid(const QJsonObject& s) const;
private:
    void paint();
    void buttons();
    QJsonArray shown() const;
    Pos::State* st;
    QJsonArray rows;
    QLineEdit* q;
    QComboBox *type, *days;
    QLabel *total, *msg;
    QTableWidget* table;
    QPushButton *bRet, *bVoid;
};

class PosPage : public Page {
    Q_OBJECT
public:
    PosPage();
    void reload() override;
    Pos::State state;
    TillView* till;
    ShiftsView* shifts;
    SalesView* sales;
    QTabWidget* tabs;
private:
    void paint();
    QLabel* err;
};
