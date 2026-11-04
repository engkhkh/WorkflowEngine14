#include "I18n.h"

#include <QFile>
#include <QJsonDocument>
#include <QSettings>

#include "Api.h"

namespace {
QJsonObject g_dict;
QJsonArray g_modules;
QString g_lang = "en";

QJsonObject readObj(const char* res) {
    QFile f(QString(":/") + res);
    f.open(QIODevice::ReadOnly);
    return QJsonDocument::fromJson(f.readAll()).object();
}
}

namespace I18n {
void init() {
    g_dict = readObj("i18n.json");
    g_modules = readObj("catalog.json").value("modules").toArray();
    g_lang = QSettings("WorkflowEngine", "ErpQt").value("lang", "en").toString() == "ar" ? "ar" : "en";
}
void setLang(const QString& l) {
    g_lang = l;
    QSettings("WorkflowEngine", "ErpQt").setValue("lang", l);
}
bool rtl() { return g_lang == "ar"; }
QString lang() { return g_lang; }

QString t1(const QString& key, const QString& token, const QString& value) {
    QString s = g_dict.value(g_lang).toObject().value(key).toString();
    if (s.isEmpty()) s = g_dict.value("en").toObject().value(key).toString();
    if (s.isEmpty()) s = key;
    return s.replace("{" + token + "}", value);
}
QString t(const QString& key) { return t1(key, QString(), QString()); }

QString name(const QJsonObject& o) { return o.value(rtl() ? "ar" : "en").toString(); }
QJsonArray modules() { return g_modules; }

QJsonArray visibleModules() {
    QJsonArray out;
    for (const QJsonValue& m : g_modules)
        for (const QJsonValue& k : m.toObject().value("kinds").toArray())
            if (Api::I().can(k.toObject().value("view").toString())) { out.append(m); break; }
    return out;
}
}
