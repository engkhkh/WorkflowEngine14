#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonValue>
#include <QNetworkAccessManager>
#include <QObject>
#include <QStringList>
#include <QUrl>
#include <functional>

/// HTTP client for the Workflow ERP backend. Every call is asynchronous: ok / err run on the UI thread.
class Api : public QObject {
    Q_OBJECT
public:
    using Ok = std::function<void(const QJsonValue&)>;
    using Err = std::function<void(const QString&)>;

    static Api& I();
    static QString defaultServer() { return QStringLiteral("http://localhost:63353"); }

    QString server, token, username, displayName, role, tenant;
    QStringList permissions;
    int lastErrStatus = 0;        // HTTP status and JSON body of the last failed call (a screen can look at them in its error callback)
    QJsonObject lastErrBody;

    bool signedIn() const { return !token.isEmpty(); }
    bool can(const QString& p) const { return permissions.contains(p); }
    void load();
    void signOut();

    void login(const QString& server, const QString& user, const QString& pass, std::function<void()> ok, Err err);
    void refreshMe(std::function<void()> done);

    void call(const QByteArray& method, const QString& path, const QJsonValue& body, QObject* ctx, Ok ok, Err err);

    // workflow
    void tasks(QObject* c, Ok ok, Err e) { call("GET", "/tasks", QJsonValue(), c, ok, e); }
    void completeTask(const QString& id, const QString& decision, const QString& comment, QObject* c, Ok ok, Err e, const QJsonObject& form = QJsonObject());
    void instances(QObject* c, Ok ok, Err e) { call("GET", "/instances", QJsonValue(), c, ok, e); }
    void instance(const QString& id, QObject* c, Ok ok, Err e) { call("GET", "/instances/" + id, QJsonValue(), c, ok, e); }
    void cancelInstance(const QString& id, QObject* c, Ok ok, Err e) { call("POST", "/instances/" + id + "/cancel", QJsonObject(), c, ok, e); }
    void definitions(QObject* c, Ok ok, Err e) { call("GET", "/definitions", QJsonValue(), c, ok, e); }
    void startInstance(const QString& defId, const QJsonObject& data, QObject* c, Ok ok, Err e);
    // workflow designer
    void definition(const QString& id, QObject* c, Ok ok, Err e) { call("GET", "/definitions/" + id, QJsonValue(), c, ok, e); }
    void saveDefinition(const QString& id, const QJsonObject& b, QObject* c, Ok ok, Err e) { id.isEmpty() ? call("POST", "/definitions", b, c, ok, e) : call("PUT", "/definitions/" + id, b, c, ok, e); }
    void publishDefinition(const QString& id, QObject* c, Ok ok, Err e) { call("POST", "/definitions/" + id + "/publish", QJsonObject(), c, ok, e); }
    void deleteDefinition(const QString& id, QObject* c, Ok ok, Err e) { call("DELETE", "/definitions/" + id, QJsonValue(), c, ok, e); }
    void users(QObject* c, Ok ok, Err e) { call("GET", "/users", QJsonValue(), c, ok, e); }
    void testCondition(const QString& expr, const QJsonObject& data, QObject* c, Ok ok, Err e) { call("POST", "/definitions/test-condition", QJsonObject{{"expression", expr}, {"data", data}}, c, ok, e); }
    void activityLog(const QString& id, QObject* c, Ok ok, Err e) { call("GET", "/instances/" + id + "/activity-log", QJsonValue(), c, ok, e); }
    void startRun(const QString& defId, QObject* c, Ok ok, Err e) { call("POST", "/instances/start", QJsonObject{{"definitionId", defId}}, c, ok, e); }

    // erp
    // record APIs: most modules live under /erp/<module>; finance, HR, POS and hospital have their own controllers
    void records(const QString& m, const QString& k, QObject* c, Ok ok, Err e);
    void createRecord(const QString& m, const QString& k, const QJsonObject& b, QObject* c, Ok ok, Err e);
    void updateRecord(const QString& m, const QString& k, const QString& id, const QJsonObject& b, QObject* c, Ok ok, Err e);
    void deleteRecord(const QString& m, const QString& k, const QString& id, QObject* c, Ok ok, Err e);
    /// The shared ERP assistant (POST api/assistant/chat): answers from the live data this user may see.
    void chat(const QString& message, const QString& lang, const QJsonArray& history, QObject* c, Ok ok, Err e) {
        call("POST", "/assistant/chat", QJsonObject{{"message", message}, {"lang", lang}, {"history", history}}, c, ok, e);
    }
    // collaboration: notes, attachments and saved filters (same store as the portal)
    void notes(const QString& m, const QString& k, const QString& id, QObject* c, Ok ok, Err e) { call("GET", "/collab/" + m + "/" + k + "/" + id + "/notes", QJsonValue(), c, ok, e); }
    void addNote(const QString& m, const QString& k, const QString& id, const QString& text, QObject* c, Ok ok, Err e) { call("POST", "/collab/" + m + "/" + k + "/" + id + "/notes", QJsonObject{{"text", text}, {"system", false}}, c, ok, e); }
    void deleteNote(const QString& nid, QObject* c, Ok ok, Err e) { call("DELETE", "/collab/notes/" + nid, QJsonValue(), c, ok, e); }
    void files(const QString& m, const QString& k, const QString& id, QObject* c, Ok ok, Err e) { call("GET", "/collab/" + m + "/" + k + "/" + id + "/files", QJsonValue(), c, ok, e); }
    void addFile(const QString& m, const QString& k, const QString& id, const QString& name, const QString& type, const QString& b64, QObject* c, Ok ok, Err e) {
        call("POST", "/collab/" + m + "/" + k + "/" + id + "/files", QJsonObject{{"name", name}, {"type", type}, {"content", b64}}, c, ok, e);
    }
    void deleteFile(const QString& fid, QObject* c, Ok ok, Err e) { call("DELETE", "/collab/files/" + fid, QJsonValue(), c, ok, e); }
    void raw(const QString& path, QObject* c, std::function<void(const QByteArray&)> ok, Err e);   // GET a non-JSON answer (for example an .ics file)
    void fileBytes(const QString& fid, QObject* c, std::function<void(const QByteArray&)> ok, Err e);
    void filters(const QString& view, QObject* c, Ok ok, Err e) { call("GET", "/collab/configs/filter?view=" + QString::fromLatin1(QUrl::toPercentEncoding(view)), QJsonValue(), c, ok, e); }
    void saveFilter(const QString& view, const QString& name, bool shared, const QJsonObject& data, QObject* c, Ok ok, Err e) {
        call("POST", "/collab/configs/filter?view=" + QString::fromLatin1(QUrl::toPercentEncoding(view)), QJsonObject{{"name", name}, {"shared", shared}, {"data", data}}, c, ok, e);
    }
    void deleteFilter(const QString& fid, QObject* c, Ok ok, Err e) { call("DELETE", "/collab/configs/filter/" + fid, QJsonValue(), c, ok, e); }
    void configs(const QString& kind, const QString& view, QObject* c, Ok ok, Err e) { call("GET", "/collab/configs/" + kind + "?view=" + QString::fromLatin1(QUrl::toPercentEncoding(view)), QJsonValue(), c, ok, e); }
    void saveConfig(const QString& kind, const QString& view, const QString& name, bool shared, const QJsonObject& data, QObject* c, Ok ok, Err e) {
        call("POST", "/collab/configs/" + kind + "?view=" + QString::fromLatin1(QUrl::toPercentEncoding(view)), QJsonObject{{"name", name}, {"shared", shared}, {"data", data}}, c, ok, e);
    }
    void deleteConfig(const QString& kind, const QString& id, QObject* c, Ok ok, Err e) { call("DELETE", "/collab/configs/" + kind + "/" + id, QJsonValue(), c, ok, e); }
    void approvalAct(const QString& id, const QString& op, const QString& note, QObject* c, Ok ok, Err e);

private:
    Api() = default;
    QNetworkAccessManager nam_;
    static QString baseOf(const QString& server);
    void save();
    void send(const QByteArray& method, const QString& url, const QJsonValue& body, bool auth, QObject* ctx, Ok ok, Err err);
};
