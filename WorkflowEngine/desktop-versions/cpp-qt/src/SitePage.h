#pragma once
#include <QCheckBox>
#include <QComboBox>
#include <QDialog>
#include <QJsonArray>
#include <QJsonObject>
#include <QLineEdit>
#include <QListWidget>
#include <QMap>
#include <QPlainTextEdit>
#include <QTabWidget>

#include "Pages.h"

/// Website builder: the list of sites, a block-based editor (pages, blocks, theme, shop), publish / unpublish and the orders and messages visitors sent.
/// Blocks, templates and styles come from website.json (shared by every desktop app); pages are rendered by SiteRender, identical to the portal.
namespace Site {
const QJsonObject& block(const QString& type);
QJsonObject newBlock(const QString& type);
QJsonObject templateDesign(const QString& key, const QString& name, const QString& cur);
QString uid();
QString publicBase();
}

/// a form generated from field definitions (text, textarea, number, select, image, list)
class PropsDialog : public QDialog {
    Q_OBJECT
public:
    PropsDialog(QWidget* parent, const QString& title, const QJsonArray& fields, const QJsonObject& props);
    QJsonObject values;
    QJsonArray fields;
    QMap<QString, QWidget*> w;
    void editList(const QJsonObject& f);
    void ok();
};

class ListDialog : public QDialog {
    Q_OBJECT
public:
    ListDialog(QWidget* parent, const QString& title, const QJsonArray& fields, const QJsonArray& items, const QJsonObject& def);
    QJsonArray fields, items;
    QJsonObject def;
    QTableWidget* table;
    void refresh(int sel = 0);
    void add(); void edit(); void move(int n); void remove();
};

class SiteEditor : public QDialog {
    Q_OBJECT
public:
    SiteEditor(QWidget* parent, const QJsonObject& row, const QJsonObject& design, std::function<void()> onSaved);
    QJsonObject row, d;
    std::function<void()> onSaved;
    int pi = 0;
    QListWidget *pages, *blocks;
    QComboBox *kind, *font, *dir;
    QLineEdit *prim, *bg, *tx, *radius, *title, *lang, *desc, *cur;
    QCheckBox *dark, *shopOn;
    QTableWidget* prod;
    QLabel* msg;
    void refreshPages(int sel = -1);
    void refreshBlocks(int sel = 0);
    void refreshProducts(int sel = 0);
    QJsonObject page() const { return d.value("pages").toArray().at(pi).toObject(); }
    void setPage(const QJsonObject& p);
    QJsonArray blockList() const { return page().value("blocks").toArray(); }
    void setBlocks(const QJsonArray& b);
    void addPage(); void editPage(); void delPage();
    void addBlock(); void editBlock(); void dupBlock(); void moveBlock(int n); void delBlock();
    void addProd(); void editProd(); void delProd(); void sync();
    QJsonObject collect();
    void save();
    void preview();
    QJsonArray products() const { return d.value("shop").toObject().value("products").toArray(); }
    void setProducts(const QJsonArray& p);
};

class SitePage : public Page {
    Q_OBJECT
public:
    SitePage();
    void reload() override;
    QComboBox* pick;
    QMap<QString, QPushButton*> btns;
    QTableWidget* table;
    QLabel* msg;
    QJsonArray sites;
    QString mode() const { return pick->currentData().toString(); }
    void showSites(const QJsonArray& rows);
    void showSubs(const QJsonArray& subs, const QJsonArray& sites);
    void newSite(); void design(); void preview(); void saveHtml(); void publish(); void unpublish(); void del(); void status(const QString& s);
    void openEditor(const QJsonObject& row);
    void fetchDesign(std::function<void(const QJsonObject&, const QJsonObject&)> then);
    QString htmlFor(const QJsonObject& row, const QJsonObject& d, bool publish) const;
};
