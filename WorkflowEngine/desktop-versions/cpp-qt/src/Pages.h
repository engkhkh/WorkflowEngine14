#pragma once
#include <QComboBox>
#include <QDialog>
#include <QJsonArray>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QTableWidget>
#include <QTextEdit>
#include <QTreeWidget>
#include <QVBoxLayout>
#include <QWidget>
#include <functional>

class Page : public QWidget {
    Q_OBJECT
public:
    explicit Page(QWidget* parent = nullptr);
    virtual void reload() {}
protected:
    QVBoxLayout* lay;
};

class HomePage : public Page {
    Q_OBJECT
public:
    HomePage(std::function<void(int)> goPage, std::function<void(const QString&, const QString&)> openKind);
    void reload() override;
private:
    QLabel *hello, *tasks, *appr, *docs;
};

class ApprovalsPage : public Page {
    Q_OBJECT
public:
    ApprovalsPage();
    void reload() override;
private:
    void open();
    QTableWidget* table;
    QLabel* empty;
};

class DocumentsPage : public Page {
    Q_OBJECT
public:
    DocumentsPage();
    void reload() override;
private:
    void create();
    void open();
    QTableWidget* table;
    QLabel* empty;
};

class ErpPage : public Page {
    Q_OBJECT
public:
    ErpPage();
    void reload() override;
    void select(const QString& moduleId, const QString& kindId);
    QTableWidget* tableForTest() { return table; }
private:
    void picked(QTreeWidgetItem* item);
    void load();
    void refill();
    void create();
    void edit();
    void printReport();
    QList<QStringList> shownRows;
    QString viewKey() const;
    void loadFilters();
    void applySaved(int i);
    void saveFilter();
    void deleteFilter();
    QComboBox *status, *saved;
    QPushButton* btnDelF;
    QTreeWidget* tree;
    QLabel *head, *msg;
    QLineEdit* search;
    QPushButton* btnNew;
    QTableWidget* table;
    QJsonObject module, kind;
    bool hasKind = false;
    QJsonArray rows;
};

class SettingsPage : public Page {
    Q_OBJECT
public:
    SettingsPage(std::function<void(const QString&)> setLang, std::function<void()> signOut);
};
