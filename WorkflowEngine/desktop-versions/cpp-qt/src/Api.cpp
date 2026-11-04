#include "Api.h"

#include <QJsonDocument>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QSettings>

Api& Api::I() {
    static Api a;
    return a;
}

QString Api::baseOf(const QString& srv) {
    QString s = srv.trimmed();
    while (s.endsWith('/')) s.chop(1);
    if (s.endsWith(QLatin1String("/api"), Qt::CaseInsensitive)) s.chop(4);
    return s + QStringLiteral("/api");
}

void Api::load() {
    QSettings st("WorkflowEngine", "ErpQt");
    server = st.value("server").toString();
    token = st.value("token").toString();
    username = st.value("username").toString();
    displayName = st.value("displayName").toString();
    role = st.value("role").toString();
    tenant = st.value("tenant").toString();
    permissions = st.value("permissions").toStringList();
}

void Api::save() {
    QSettings st("WorkflowEngine", "ErpQt");
    if (!signedIn()) {
        st.remove("token");
        st.remove("permissions");
        return;
    }
    st.setValue("server", server);
    st.setValue("token", token);
    st.setValue("username", username);
    st.setValue("displayName", displayName);
    st.setValue("role", role);
    st.setValue("tenant", tenant);
    st.setValue("permissions", permissions);
}

void Api::signOut() {
    token.clear();
    permissions.clear();
    save();
}

void Api::send(const QByteArray& method, const QString& url, const QJsonValue& body, bool auth, QObject* ctx, Ok ok, Err err) {
    QNetworkRequest req{QUrl(url)};
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setTransferTimeout(40000);
    if (auth) req.setRawHeader("Authorization", "Bearer " + token.toUtf8());
    QByteArray payload;
    if (!body.isNull() && !body.isUndefined()) {
        payload = body.isArray() ? QJsonDocument(body.toArray()).toJson(QJsonDocument::Compact) : QJsonDocument(body.toObject()).toJson(QJsonDocument::Compact);
    }
    QNetworkReply* reply = nullptr;
    if (method == "GET") reply = nam_.get(req);
    else if (method == "DELETE") reply = nam_.deleteResource(req);
    else reply = nam_.sendCustomRequest(req, method, payload);
    QPointer<QObject> guard(ctx);
    connect(reply, &QNetworkReply::finished, this, [=]() {
        const QByteArray data = reply->readAll();
        const int code = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QNetworkReply::NetworkError ne = reply->error();
        const QString netMsg = reply->errorString();
        reply->deleteLater();
        if (ctx && guard.isNull()) return;   // the screen that asked is gone
        if (code == 401 && auth) {
            signOut();
            if (err) err(QStringLiteral("401"));
            return;
        }
        if (code == 0 && ne != QNetworkReply::NoError) {
            if (err) err(netMsg);
            return;
        }
        if (code < 200 || code >= 300) {
            QString msg = QString::fromUtf8(data);
            const QJsonObject o = QJsonDocument::fromJson(data).object();
            for (const char* k : {"message", "error", "title"})
                if (o.contains(QLatin1String(k))) { msg = o.value(QLatin1String(k)).toVariant().toString(); break; }
            if (msg.isEmpty()) msg = QString::number(code);
            lastErrStatus = code; lastErrBody = o;
            if (err) err(msg);
            return;
        }
        QJsonValue v;
        if (!data.trimmed().isEmpty()) {
            const QJsonDocument d = QJsonDocument::fromJson(data);
            v = d.isArray() ? QJsonValue(d.array()) : QJsonValue(d.object());
        }
        if (ok) ok(v);
    });
}

void Api::call(const QByteArray& method, const QString& path, const QJsonValue& body, QObject* ctx, Ok ok, Err err) {
    if (!signedIn()) {
        if (err) err(QStringLiteral("not signed in"));
        return;
    }
    send(method, baseOf(server) + path, body, true, ctx, ok, err);
}

void Api::login(const QString& srv, const QString& user, const QString& pass, std::function<void()> ok, Err err) {
    send("POST", baseOf(srv) + "/auth/login", QJsonObject{{"username", user}, {"password", pass}}, false, nullptr,
         [=](const QJsonValue& v) {
             const QJsonObject j = v.toObject();
             server = srv.trimmed();
             token = j.value("token").toString();
             username = j.value("username").toString();
             displayName = j.value("displayName").toString();
             role = j.value("role").toString();
             tenant = j.value("tenantName").toString();
             permissions.clear();
             for (const QJsonValue& p : j.value("permissions").toArray()) permissions << p.toString();
             save();
             if (token.isEmpty()) { if (err) err(QStringLiteral("login")); return; }
             if (ok) ok();
         },
         [=](const QString&) { if (err) err(QStringLiteral("login")); });
}

void Api::refreshMe(std::function<void()> done) {
    call("GET", "/users/me", QJsonValue(), nullptr,
         [=](const QJsonValue& v) {
             const QJsonObject j = v.toObject();
             const QJsonArray eff = j.value("effectivePermissions").toArray();
             if (!eff.isEmpty()) { permissions.clear(); for (const QJsonValue& p : eff) permissions << p.toString(); }
             if (j.contains("displayName")) displayName = j.value("displayName").toString();
             if (j.contains("role")) role = j.value("role").toString();
             save();
             if (done) done();
         },
         [=](const QString&) { if (done) done(); });
}

void Api::completeTask(const QString& id, const QString& decision, const QString& comment, QObject* c, Ok ok, Err e, const QJsonObject& form) {
    call("POST", "/tasks/" + id + "/complete", QJsonObject{{"decision", decision}, {"formData", form}, {"comment", comment}}, c, ok, e);
}

void Api::raw(const QString& path, QObject* ctx, std::function<void(const QByteArray&)> ok, Err e) {
    QNetworkRequest req{QUrl(baseOf(server) + path)};
    req.setTransferTimeout(60000);
    req.setRawHeader("Authorization", "Bearer " + token.toUtf8());
    QNetworkReply* reply = nam_.get(req);
    QPointer<QObject> guard(ctx);
    connect(reply, &QNetworkReply::finished, this, [=]() {
        const QByteArray data = reply->readAll();
        const int code = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QString msg = reply->errorString();
        reply->deleteLater();
        if (ctx && guard.isNull()) return;
        if (code < 200 || code >= 300) { if (e) e(code ? QString::number(code) : msg); return; }
        if (ok) ok(data);
    });
}

void Api::fileBytes(const QString& fid, QObject* c, std::function<void(const QByteArray&)> ok, Err e) {
    QNetworkRequest req{QUrl(baseOf(server) + "/collab/files/" + fid)};
    req.setTransferTimeout(60000);
    req.setRawHeader("Authorization", "Bearer " + token.toUtf8());
    QNetworkReply* reply = nam_.get(req);
    QPointer<QObject> guard(c);
    connect(reply, &QNetworkReply::finished, this, [=]() {
        const QByteArray data = reply->readAll();
        const int code = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QString msg = reply->errorString();
        reply->deleteLater();
        if (c && guard.isNull()) return;
        if (code < 200 || code >= 300) { if (e) e(code ? QString::number(code) : msg); return; }
        if (ok) ok(data);
    });
}

void Api::startInstance(const QString& defId, const QJsonObject& data, QObject* c, Ok ok, Err e) {
    call("POST", "/instances/start", QJsonObject{{"definitionId", defId}, {"initialData", data}}, c, ok, e);
}

void Api::approvalAct(const QString& id, const QString& op, const QString& note, QObject* c, Ok ok, Err e) {
    call("POST", "/erp/gov/approvals/" + id + "/" + op, QJsonObject{{"note", note}}, c, ok, e);
}

// ---------------------------------------------------------------- Setup & administration (users, roles, companies, branches)
static QJsonObject admRec(const QString& kind, const QJsonObject& x) {
    QJsonObject data, r{{"module", "adm"}, {"kind", kind}};
    if (kind == "user") {
        for (const char* k : {"displayName", "email", "role"}) if (x.contains(k)) data.insert(k, x.value(k));
        if (!x.value("branches").isNull() && x.contains("branches")) data.insert("branches", x.value("branches"));
        if (!x.value("permissions").isNull() && x.contains("permissions")) data.insert("permissions", x.value("permissions"));
        data.insert("newPassword", "");
        r.insert("id", x.value("id")); r.insert("code", x.value("username"));
        r.insert("status", x.value("isActive").toBool(true) ? "Active" : "Inactive");
    } else if (kind == "role") {
        data.insert("name", x.value("name").toString()); data.insert("users", x.value("users")); data.insert("permissions", x.value("permissions").toArray());
        r.insert("id", x.value("role")); r.insert("code", x.value("role")); r.insert("status", x.value("isSystem").toBool() ? "System" : "Custom");
    } else {
        data = x; data.remove("code");
        r.insert("id", x.value("code")); r.insert("code", x.value("code")); r.insert("status", "Active");
    }
    r.insert("data", data);
    return r;
}

static void admList(Api& api, const QString& kind, QObject* c, Api::Ok ok, Api::Err e) {
    QString path = kind == "user" ? "/users/admin" : kind == "role" ? "/admin/rbac" : "/org";
    api.call("GET", path, QJsonValue(), c, [=](const QJsonValue& v) {
        QJsonArray src = kind == "user" ? v.toArray() : kind == "role" ? v.toObject().value("roles").toArray()
                       : v.toObject().value(kind == "company" ? "companies" : "branches").toArray();
        QJsonArray out;
        for (const QJsonValue& x : src) out.append(admRec(kind, x.toObject()));
        ok(out);
    }, e);
}

static void admWrite(Api& api, bool create, const QString& kind, const QString& id, const QJsonObject& body, QObject* c, Api::Ok ok, Api::Err e) {
    const QJsonObject d = body.value("data").toObject();
    const QString code = body.value("code").toString().isEmpty() ? id : body.value("code").toString();
    if (kind == "user") {
        QJsonObject req{{"displayName", d.value("displayName").toString()}, {"email", d.value("email").toString()},
                        {"role", d.contains("role") ? d.value("role").toString() : QStringLiteral("employee")},
                        {"isActive", body.value("status").toString() != "Inactive"}, {"permissions", d.value("permissions")}, {"branches", d.value("branches")}};
        if (create) {
            req.insert("username", code);
            req.insert("password", d.value("password").toString().isEmpty() ? d.value("newPassword").toString() : d.value("password").toString());
            api.call("POST", "/users/admin", req, c, ok, e);
        } else {
            const QString np = d.value("newPassword").toString();
            api.call("PUT", "/users/admin/" + id, req, c, [=, &api](const QJsonValue& v) {
                if (np.isEmpty()) { ok(v); return; }
                api.call("POST", "/users/admin/" + id + "/reset-password", QJsonObject{{"password", np}}, c, ok, e);
            }, e);
        }
    } else if (kind == "role") {
        if (create) {
            QJsonObject req{{"role", code}, {"name", d.value("name")}, {"copyFrom", d.value("copyFrom")}};
            if (!d.value("permissions").toArray().isEmpty()) req.insert("permissions", d.value("permissions"));
            api.call("POST", "/admin/rbac/roles", req, c, ok, e);
        } else {
            api.call("PUT", "/admin/rbac/roles/" + id, QJsonObject{{"name", d.value("name")}, {"permissions", d.value("permissions").toArray()}}, c, ok, e);
        }
    } else {
        const QString path = kind == "company" ? "/org/companies" : "/org/branches";
        QJsonObject req = d; req.insert("code", code);
        if (create) api.call("POST", path, req, c, ok, e); else api.call("PUT", path + "/" + id, req, c, ok, e);
    }
}

static QString admPath(const QString& kind) {
    return kind == "user" ? "/users/admin" : kind == "role" ? "/admin/rbac/roles" : kind == "company" ? "/org/companies" : "/org/branches";
}

// ---------------------------------------------------------------- records (several backends)
static QString recBase(const QString& m, const QString& k) {
    if (m == "hr" && k == "employee") return QStringLiteral("/hr/employees");
    QString pre = m == "fin" ? "/finance" : m == "hr" ? "/hr" : m == "pos" ? "/pos" : m == "hos" ? "/hospital" : "/erp/" + m;
    return pre + "/records/" + k;
}
static bool isEmp(const QString& m, const QString& k) { return m == "hr" && k == "employee"; }

static QJsonObject empToRec(const QJsonObject& e) {
    QJsonObject data = e;
    for (const char* key : {"id", "empNo", "status", "tenantId", "createdAt", "updatedAt"}) data.remove(key);
    return QJsonObject{{"id", e.value("id")}, {"module", "hr"}, {"kind", "employee"}, {"code", e.value("empNo")}, {"status", e.value("status")}, {"data", data}};
}

static QJsonObject empBody(const QJsonObject& body, const QString& id) {
    QJsonObject o = body.value("data").toObject();
    o.insert("empNo", body.value("code"));
    o.insert("status", body.value("status"));
    if (!id.isEmpty()) o.insert("id", id);
    return o;
}

void Api::records(const QString& m, const QString& k, QObject* c, Ok ok, Err e) {
    if (m == "adm") { admList(*this, k, c, ok, e); return; }
    if (isEmp(m, k)) {
        call("GET", "/hr/employees", QJsonValue(), c, [ok](const QJsonValue& v) {
            QJsonArray out;
            for (const QJsonValue& x : v.toArray()) out.append(empToRec(x.toObject()));
            ok(out);
        }, e);
        return;
    }
    call("GET", recBase(m, k) + "?take=500", QJsonValue(), c, ok, e);
}

void Api::createRecord(const QString& m, const QString& k, const QJsonObject& b, QObject* c, Ok ok, Err e) {
    if (m == "adm") { admWrite(*this, true, k, QString(), b, c, ok, e); return; }
    call("POST", recBase(m, k), isEmp(m, k) ? empBody(b, QString()) : b, c, ok, e);
}

void Api::updateRecord(const QString& m, const QString& k, const QString& id, const QJsonObject& b, QObject* c, Ok ok, Err e) {
    if (m == "adm") { admWrite(*this, false, k, id, b, c, ok, e); return; }
    call("PUT", recBase(m, k) + "/" + id, isEmp(m, k) ? empBody(b, id) : b, c, ok, e);
}

void Api::deleteRecord(const QString& m, const QString& k, const QString& id, QObject* c, Ok ok, Err e) {
    if (m == "adm") { call("DELETE", admPath(k) + "/" + id, QJsonValue(), c, ok, e); return; }
    call("DELETE", recBase(m, k) + "/" + id, QJsonValue(), c, ok, e);
}

