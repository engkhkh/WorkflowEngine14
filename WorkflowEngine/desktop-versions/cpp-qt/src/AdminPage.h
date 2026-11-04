#pragma once
#include <QCheckBox>
#include <QComboBox>
#include <QGridLayout>
#include <QJsonArray>
#include <QJsonObject>
#include <QLineEdit>
#include <QListWidget>
#include <QStackedWidget>
#include <QTabWidget>

#include "Pages.h"

/// Administration: workspace plan and usage, the first-run setup wizard, invitations, billing and the module switches.
namespace Adm {
QString webOrigin();
QString inviteLink(const QString& token);
QString money(double v);
QString invoiceHtml(const QJsonObject& i);
}

class ModulesBox : public QWidget {
    Q_OBJECT
public:
    ModulesBox();
    QGridLayout* grid;
    QLabel* msg;
    QMap<QString, QCheckBox*> boxes;
    void reload();
    void showMods(const QJsonObject& r);
    void setAll(bool v);
    QStringList selected() const;
    void save();
};

class InviteForm : public QWidget {
    Q_OBJECT
public:
    explicit InviteForm(std::function<void(const QJsonObject&)> onDone);
    std::function<void(const QJsonObject&)> onDone;
    QLineEdit *name, *email, *user;
    QComboBox* role;
    QListWidget* branches;
    QLabel* err;
    void load(const QStringList& roles, const QJsonArray& brs);
    void invite();
};

class SetupWizard : public QWidget {
    Q_OBJECT
public:
    explicit SetupWizard(std::function<void()> onFinished);
    std::function<void()> onFinished;
    QJsonObject company;
    QJsonArray branches, users;
    QStringList roles{"employee"};
    int step = 0;
    QLabel *head, *msg;
    QStackedWidget* stack;
    QLineEdit *name, *ar, *country, *tax, *brn, *brc;
    QComboBox* cur;
    QTableWidget *brt, *invited;
    InviteForm* form;
    ModulesBox* mods;
    QPushButton *bBack, *bSkip, *bNext;
    void reload();
    void go(int n);
    void back() { go(step - 1); }
    void next();
    void showBranches();
    void addBranch();
    void delBranch();
    void invitedOne(const QJsonObject& u);
    void copySel();
};

class AdminPage : public Page {
    Q_OBJECT
public:
    AdminPage();
    void reload() override;
    QTabWidget* tabs;
    QLabel *msg, *wsHead, *kpi;
    QTableWidget *ws, *inv, *lines, *invs;
    SetupWizard* wiz = nullptr;
    InviteForm* form = nullptr;
    ModulesBox* mods = nullptr;
    QList<std::function<void()>> views;
    void say(const QString& m) { msg->setText(m); }
    void loadWs();
    void loadInvites();
    void resend();
    void copyLink();
    void loadBilling();
    void pay();
    void check();
    void sandbox();
    void printInv();
};
