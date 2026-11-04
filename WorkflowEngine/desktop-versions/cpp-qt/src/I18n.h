#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QString>

namespace I18n {
void init();                       // reads i18n.json and catalog.json from the resources
void setLang(const QString& l);
bool rtl();
QString lang();
QString t(const QString& key);
QString t1(const QString& key, const QString& token, const QString& value);   // t1("home.hello", "name", "Ali")
QString name(const QJsonObject& o);
QJsonArray modules();
QJsonArray visibleModules();
}
