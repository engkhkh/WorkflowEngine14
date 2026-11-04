#pragma once
// Report designer: choose columns, title, header / footer, orientation, grouping and totals for the rows of a list, preview, print or save as PDF.
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QJsonArray>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QListWidget>
#include <QPlainTextEdit>
#include <QTextBrowser>
#include <QVariantMap>

struct ReportColumn { QString key, label; bool numeric = false; };
struct ReportLayout {
    QString title, subtitle, header, footer, orientation = "portrait", groupBy;
    QStringList columns, order;
    bool totals = true, showDate = true, showUser = true, rowNumbers = false;
};
using ReportRow = QMap<QString, QString>;   // shown value per column key; "<key>#" holds the raw number for totals

QString buildReportHtml(const ReportLayout& L, const QList<ReportColumn>& cols, const QList<ReportRow>& rows, const QString& user);
bool saveReportPdf(const QString& html, const ReportLayout& L, const QString& path);

class ReportDialog : public QDialog {
    Q_OBJECT
public:
    ReportDialog(QWidget* parent, const QString& view, const QString& title, const QList<ReportColumn>& cols, const QList<ReportRow>& rows, const QString& user);
    ReportLayout layout() const;
    QString html() const { return buildReportHtml(layout(), cols_, rows_, user_); }
    void applyLayout(const QJsonObject& d);
    QComboBox* groupBox() { return group; }
private:
    void refresh();
    void loadSaved();
    void saveLayout();
    void deleteLayout();
    void move(int d);
    void printIt();
    void pdfIt();
    QString view_, user_;
    QList<ReportColumn> cols_;
    QList<ReportRow> rows_;
    QComboBox *sel, *orient, *group;
    QLineEdit *eTitle, *eSub, *eName;
    QPlainTextEdit *eHead, *eFoot;
    QCheckBox *kTot, *kNum, *kDate, *kUser, *kShare;
    QListWidget* lst;
    QTextBrowser* prev;
    QPushButton* bDel;
    QLabel* err;
    QJsonArray saved_;
};
