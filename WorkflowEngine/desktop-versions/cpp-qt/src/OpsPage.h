#pragma once
#include <QCheckBox>
#include <QComboBox>
#include <QJsonArray>
#include <QJsonObject>
#include <QLineEdit>
#include <QMap>
#include <QStackedWidget>

#include "Pages.h"

/// Operations: material requirements planning, standard cost and work order variance, project billing, the VAT return and the ZATCA seller profile.
/// The reports are described by ops.json (shared by every desktop app).
namespace Ops {
const QJsonObject& spec();
QString L(const QString& key, const QStringList& args = {});
QString tx(const QJsonObject& o);
double num(const QJsonValue& v);
double r2(double v);
struct Cost { double material, labor, overhead, total, unit; };
Cost bomCost(const QJsonObject& bom, const QMap<QString, QJsonObject>& items, double rate, double overheadPct);
struct MrpRow { QString sku, name, action, due; double gross = 0, onHand = 0, scheduled = 0, net = 0; int level = 0; };
QList<MrpRow> mrp(const QList<QJsonObject>& demands, const QJsonArray& boms, const QMap<QString, double>& onHand, const QMap<QString, double>& scheduled, const QMap<QString, QJsonObject>& items);
void projectReady(const QJsonObject& p, const QJsonArray& ts, const QJsonArray& cs, const QJsonArray& ms, double& ready, double& billed);
}

class OpsPage : public Page {
    Q_OBJECT
public:
    OpsPage();
    void reload() override;
    QComboBox *pick, *mSku;
    QLineEdit *dFrom, *dTo, *mQty, *mDue;
    QCheckBox* mStock;
    QTableWidget* table;
    QLabel *foot, *msg, *mList;
    QPushButton *bWo, *bBuy, *bBill, *bCsv;
    QWidget* mrpBox;
    QWidget* form;
    QStackedWidget* stack;
    QMap<QString, QLineEdit*> fields;
    QPushButton* bSave;
    QJsonArray reports;
    QJsonObject rep;
    QMap<QString, QJsonValue> data;
    QList<QJsonObject> demand;
    QList<Ops::MrpRow> plan;
    void showData();
    void paint();
    void refreshMrp();
    void addDemand();
    void delDemand();
    void makeOrders();
    void exportBuy();
    void bill();
    void billNow(const QJsonObject& proj, const QString& date, int terms, double tax);
    void exportVat();
    void saveProfile();
    QString lastInvoice, pending;
    QMap<QString, QJsonObject> itemMap() const;
    QMap<QString, double> stockMap() const;
    QMap<QString, double> schedMap() const;
};
