#include "Ui.h"

#include <QHeaderView>
#include <QMessageBox>

namespace Ui {
const char* kStyle = R"(
QMainWindow, QDialog { background: #f4f6fa; }
QListWidget#nav { background: #0f172a; color: #cbd5e1; border: none; font-size: 14px; outline: 0; }
QListWidget#nav::item { padding: 12px 16px; }
QListWidget#nav::item:selected { background: #2563eb; color: white; }
QPushButton { background: #2563eb; color: white; border: none; border-radius: 6px; padding: 7px 14px; }
QPushButton:disabled { background: #94a3b8; }
QPushButton[kind="ghost"] { background: white; color: #2563eb; border: 1px solid #2563eb; }
QPushButton[kind="danger"] { background: #dc2626; }
QLineEdit, QTextEdit, QComboBox { background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px; }
QTableWidget { background: white; border: 1px solid #e2e8f0; gridline-color: #eef2f7; }
QHeaderView::section { background: #f1f5f9; border: none; padding: 6px; font-weight: 600; }
QLabel[role="title"] { font-size: 20px; font-weight: 700; }
QLabel[role="dim"] { color: #64748b; }
QLabel[role="error"] { color: #dc2626; }
QFrame[card="true"] { background: white; border: 1px solid #e2e8f0; border-radius: 10px; }
)";

QPushButton* button(const QString& text, const std::function<void()>& slot, const QString& kind, QWidget* parent) {
    auto* b = new QPushButton(text, parent);
    if (!kind.isEmpty()) b->setProperty("kind", kind);
    QObject::connect(b, &QPushButton::clicked, b, [slot]() { slot(); });
    return b;
}

QLabel* label(const QString& text, const QString& role) {
    auto* l = new QLabel(text);
    if (!role.isEmpty()) l->setProperty("role", role);
    l->setWordWrap(true);
    return l;
}

QTableWidget* table(const QStringList& headers) {
    auto* t = new QTableWidget(0, headers.size());
    t->setHorizontalHeaderLabels(headers);
    t->setEditTriggers(QAbstractItemView::NoEditTriggers);
    t->setSelectionBehavior(QAbstractItemView::SelectRows);
    t->setSelectionMode(QAbstractItemView::SingleSelection);
    t->verticalHeader()->setVisible(false);
    t->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
    t->setAlternatingRowColors(true);
    return t;
}

void fill(QTableWidget* t, const QList<QStringList>& rows, const QList<QJsonObject>& payloads) {
    t->setRowCount(rows.size());
    for (int i = 0; i < rows.size(); ++i)
        for (int j = 0; j < rows[i].size(); ++j) {
            auto* it = new QTableWidgetItem(rows[i][j]);
            if (j == 0) it->setData(Qt::UserRole, QVariant::fromValue(payloads[i]));
            t->setItem(i, j, it);
        }
}

bool selected(QTableWidget* t, QJsonObject& out) {
    const int r = t->currentRow();
    if (r < 0 || !t->item(r, 0)) return false;
    out = t->item(r, 0)->data(Qt::UserRole).toJsonObject();
    return true;
}

void warn(QWidget* parent, const QString& text) { QMessageBox::warning(parent, QString(), text); }

bool ask(QWidget* parent, const QString& text, const QString& yes, const QString& no) {
    QMessageBox box(QMessageBox::Question, QString(), text, QMessageBox::NoButton, parent);
    QPushButton* y = box.addButton(yes, QMessageBox::YesRole);
    box.addButton(no, QMessageBox::NoRole);
    box.exec();
    return box.clickedButton() == y;
}
}
