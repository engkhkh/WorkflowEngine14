#pragma once
#include <QJsonObject>
#include <QLabel>
#include <QPushButton>
#include <QStringList>
#include <QTableWidget>
#include <QWidget>
#include <functional>

namespace Ui {
extern const char* kStyle;
QPushButton* button(const QString& text, const std::function<void()>& slot, const QString& kind = {}, QWidget* parent = nullptr);
QLabel* label(const QString& text, const QString& role = {});
QTableWidget* table(const QStringList& headers);
/// rows[i] are the cell texts, payloads[i] the object stored on row i
void fill(QTableWidget* t, const QList<QStringList>& rows, const QList<QJsonObject>& payloads);
bool selected(QTableWidget* t, QJsonObject& out);
void warn(QWidget* parent, const QString& text);
bool ask(QWidget* parent, const QString& text, const QString& yes, const QString& no);
}
