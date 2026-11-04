#pragma once
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QJsonArray>
#include <QJsonObject>
#include <QLineEdit>
#include <QMap>
#include <QVBoxLayout>

#include "Pages.h"
#include "Xlsx.h"

/// HR: overview, employees (with Excel / CSV import), leave requests and balances, recruitment, performance and the org structure.
/// The reports and the import fields are described by hr.json (shared by every desktop app).
namespace Hr {
struct Mapped { int row; QJsonObject data; QStringList errors; };
const QJsonObject& spec();
QString L(const QString& key, const QStringList& args = {});
QString I(const QString& key, const QMap<QString, QString>& vars = {});
QString tx(const QJsonObject& o);
QString fieldLabel(const QJsonObject& f);
double num(const QJsonValue& v);
QString guessField(const QList<QJsonObject>& fields, const QVariant& heading);
QString parseDate(const QVariant& v);   // yyyy-MM-dd or empty
QString cellText(const QVariant& v);
/// mapping: column index -> field key
QList<Mapped> mapRows(const Xlsx::Table& rows, const QMap<int, QString>& mapping, int firstDataRow, bool canSalary);
void markDuplicates(QList<Mapped>& m);
struct Built { QList<QStringList> rows; QList<QJsonObject> payloads; QString foot; };
Built build(const QString& rid, const QMap<QString, QJsonValue>& data, const QString& today);
QList<QJsonObject> visibleCols(const QJsonObject& rep);
}

class HrImportDialog : public QDialog {
    Q_OBJECT
public:
    HrImportDialog(QWidget* parent, std::function<void()> onDone);
    QLineEdit* path;
    QCheckBox *head, *upd;
    QLabel *summary, *msg;
    QTableWidget* table;
    QPushButton* runBtn;
    QList<QJsonObject> fields;
    Xlsx::Table rows;
    QMap<int, QString> mapping;
    QList<Hr::Mapped> mapped;
    QMap<int, QComboBox*> combos;
    QVBoxLayout* mapBox;
    std::function<void()> onDone_;
    void load();
    void autoMap();
    void buildMapUi(int width);
    void setMap(int col);
    void remap();
    void run();
    QString errText(const Hr::Mapped& m) const;
    QStringList missing() const;
};

class HrPage : public Page {
    Q_OBJECT
public:
    HrPage();
    void reload() override;
    QComboBox* pick;
    QTableWidget* table;
    QLabel *foot, *msg;
    QPushButton *bImport, *bA, *bB, *bC, *bD;
    QJsonArray reports;
    QJsonObject rep;
    QMap<QString, QJsonValue> data;
    void showData(const QJsonObject& r);
    void act(int which);
    void hire(const QJsonObject& cand);
};
