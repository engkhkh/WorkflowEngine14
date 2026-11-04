#include "ChatPage.h"

#include <QFrame>
#include <QHBoxLayout>
#include <QLabel>
#include <QScrollBar>
#include <QTimer>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

ChatPage::ChatPage(OpenFn open) : open_(std::move(open)) {
    lay->addWidget(Ui::label(t("chat.title"), "title"));
    scroll_ = new QScrollArea;
    scroll_->setWidgetResizable(true);
    scroll_->setFrameShape(QFrame::NoFrame);
    log_ = new QWidget;
    logLay_ = new QVBoxLayout(log_);
    logLay_->setAlignment(Qt::AlignTop);
    logLay_->setSpacing(8);
    scroll_->setWidget(log_);
    lay->addWidget(scroll_, 1);

    sugs_ = new QHBoxLayout;
    sugs_->setAlignment(Qt::AlignLeft);
    lay->addLayout(sugs_);

    auto* row = new QHBoxLayout;
    input_ = new QLineEdit;
    input_->setPlaceholderText(t("chat.placeholder"));
    connect(input_, &QLineEdit::returnPressed, this, [this] { send(input_->text()); });
    sendBtn_ = Ui::button(t("chat.send"), [this] { send(input_->text()); });
    row->addWidget(input_, 1);
    row->addWidget(sendBtn_);
    lay->addLayout(row);
    bubble(false, t("chat.greet"), QJsonArray());
}

void ChatPage::reload() { input_->setFocus(); }

void ChatPage::toBottom() {
    QTimer::singleShot(0, this, [this] { scroll_->verticalScrollBar()->setValue(scroll_->verticalScrollBar()->maximum()); });
}

QWidget* ChatPage::bubble(bool mine, const QString& text, const QJsonArray& actions) {
    auto* box = new QFrame;
    box->setObjectName("card");
    auto* bl = new QVBoxLayout(box);
    auto* msg = new QLabel(text);
    msg->setWordWrap(true);
    msg->setTextInteractionFlags(Qt::TextSelectableByMouse);
    msg->setObjectName("chatText");
    bl->addWidget(msg);
    if (!actions.isEmpty()) {
        auto* row = new QHBoxLayout;
        row->setAlignment(Qt::AlignLeft);
        for (const QJsonValue& v : actions) {
            QJsonObject a = v.toObject();
            QString mod = a.value("module").toString(), kind = a.value("kind").toString();
            row->addWidget(Ui::button(a.value("label").toString() + QStringLiteral(" ›"), [this, mod, kind] { if (open_) open_(mod, kind); }, "ghost"));
        }
        bl->addLayout(row);
    }
    if (mine) box->setStyleSheet("QFrame#card { background: #dbeafe; }");
    auto* wrap = new QWidget;
    auto* outer = new QHBoxLayout(wrap);
    outer->setContentsMargins(0, 0, 0, 0);
    if (mine) { outer->addStretch(1); outer->addWidget(box, 3); }
    else { outer->addWidget(box, 3); outer->addStretch(1); }
    logLay_->addWidget(wrap);
    toBottom();
    return wrap;
}

void ChatPage::send(const QString& text) {
    QString q = text.trimmed();
    if (q.isEmpty() || busy_) return;
    busy_ = true;
    sendBtn_->setEnabled(false);
    input_->clear();
    QJsonArray past;
    for (int i = qMax(0, int(history_.size()) - 6); i < history_.size(); ++i) past.append(history_.at(i));
    history_.append(QJsonObject{{"from", "user"}, {"text", q}});
    bubble(true, q, QJsonArray());
    QWidget* thinking = bubble(false, t("chat.thinking"), QJsonArray());
    auto finish = [this, thinking] { thinking->deleteLater(); busy_ = false; sendBtn_->setEnabled(true); };
    Api::I().chat(q, I18n::lang(), past, this,
        [this, finish](const QJsonValue& v) {
            finish();
            QJsonObject r = v.toObject();
            QString reply = r.value("reply").toString();
            history_.append(QJsonObject{{"from", "ai"}, {"text", reply}});
            bubble(false, reply, r.value("actions").toArray());
            while (QLayoutItem* it = sugs_->takeAt(0)) { delete it->widget(); delete it; }
            for (const QJsonValue& s : r.value("suggestions").toArray()) {
                QString st = s.toString();
                sugs_->addWidget(Ui::button(st, [this, st] { send(st); }, "ghost"));
            }
        },
        [this, finish](const QString&) { finish(); bubble(false, t("chat.error"), QJsonArray()); });
}

QStringList ChatPage::textsForTest() const {
    QStringList out;
    for (QLabel* l : log_->findChildren<QLabel*>("chatText")) out << l->text();
    return out;
}
