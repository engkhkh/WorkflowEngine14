#pragma once
#include <QJsonArray>
#include <QLineEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QVBoxLayout>
#include <functional>

#include "Pages.h"

/// The ERP assistant: questions go to POST api/assistant/chat, which answers from the live data this user may see.
class ChatPage : public Page {
    Q_OBJECT
public:
    using OpenFn = std::function<void(const QString& module, const QString& kind)>;
    explicit ChatPage(OpenFn open);
    void reload() override;
    void send(const QString& text);
    QStringList textsForTest() const;
private:
    QWidget* bubble(bool mine, const QString& text, const QJsonArray& actions);
    void toBottom();
    OpenFn open_;
    QWidget* log_;
    QVBoxLayout* logLay_;
    QScrollArea* scroll_;
    QHBoxLayout* sugs_;
    QLineEdit* input_;
    QPushButton* sendBtn_;
    QJsonArray history_;
    bool busy_ = false;
};
