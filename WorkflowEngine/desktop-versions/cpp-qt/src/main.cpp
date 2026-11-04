#include <QApplication>
#include <QDialog>
#include <QFormLayout>
#include <QLineEdit>
#include <QPointer>
#include <QVBoxLayout>

#include "Api.h"
#include "I18n.h"
#include "MainWindow.h"
#include "Ui.h"

using I18n::t;

namespace {
class LoginDialog : public QDialog {
public:
    LoginDialog() {
        setWindowTitle(t("app.title"));
        setMinimumWidth(380);
        auto* lay = new QVBoxLayout(this);
        lay->setContentsMargins(24, 24, 24, 24);
        lay->addWidget(Ui::label(t("app.name"), "title"));
        lay->addWidget(Ui::label(t("login.title"), "dim"));
        auto* form = new QFormLayout;
        server = new QLineEdit(Api::defaultServer());
        user = new QLineEdit;
        pw = new QLineEdit;
        pw->setEchoMode(QLineEdit::Password);
        connect(pw, &QLineEdit::returnPressed, this, [this] { go(); });
        form->addRow(t("login.server"), server);
        form->addRow(t("login.user"), user);
        form->addRow(t("login.pass"), pw);
        lay->addLayout(form);
        err = Ui::label({}, "error");
        lay->addWidget(err);
        btn = Ui::button(t("login.signin"), [this] { go(); });
        lay->addWidget(btn);
    }
private:
    void go() {
        err->clear();
        btn->setEnabled(false);
        Api::I().login(server->text(), user->text().trimmed(), pw->text(), [this] { accept(); },
                       [this](const QString&) { err->setText(t("login.failed")); btn->setEnabled(true); });
    }
    QLineEdit *server, *user, *pw;
    QLabel* err;
    QPushButton* btn;
};

struct Launcher {
    QApplication& app;
    QPointer<MainWindow> win;
    void show() {
        if (win) { win->deleteLater(); win = nullptr; }
        app.setLayoutDirection(I18n::rtl() ? Qt::RightToLeft : Qt::LeftToRight);
        if (!Api::I().signedIn()) {
            LoginDialog dlg;
            if (!dlg.exec()) { app.quit(); return; }
        }
        win = new MainWindow([this] { show(); });
        win->show();
    }
};
}

int main(int argc, char** argv) {
    QApplication app(argc, argv);
    app.setStyleSheet(Ui::kStyle);
    I18n::init();
    Api::I().load();
    Launcher launcher{app, nullptr};
    auto start = [&] { launcher.show(); };
    if (Api::I().signedIn()) Api::I().refreshMe(start); else start();
    return app.exec();
}
