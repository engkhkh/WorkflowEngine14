#include "Bi.h"

#include <QFile>
#include <QJsonDocument>
#include <QRegularExpression>
#include <algorithm>

namespace Bi {
namespace {
const QJsonObject& spec() {
    static QJsonObject o = [] { QFile f(":/dashboard.json"); f.open(QIODevice::ReadOnly); return QJsonDocument::fromJson(f.readAll()).object(); }();
    return o;
}
QDateTime parse(const QString& s) { return s.isEmpty() ? QDateTime() : QDateTime::fromString(s.left(19), "yyyy-MM-ddTHH:mm:ss"); }
QDateTime nowUtc() { return QDateTime::currentDateTimeUtc(); }
bool inMonth(const QDateTime& d) { if (!d.isValid()) return false; const QDate n = nowUtc().date(); return d.date().month() == n.month() && d.date().year() == n.year(); }
QString outcome(const QJsonObject& i) {
    const QString st = i.value("status").toString();
    if (st == "Running") return "pending";
    if (st == "Terminated") return "canceled";
    static const QRegularExpression rej(spec().value("rejectActions").toString(), QRegularExpression::CaseInsensitiveOption);
    for (const QJsonValue& hv : i.value("history").toArray()) {
        const QJsonObject h = hv.toObject();
        const QString a = h.value("action").toString();
        if (rej.match(a).hasMatch() || (a == "Entered" && h.value("nodeName").toString().contains("reject", Qt::CaseInsensitive))) return "rejected";
    }
    return "approved";
}
QString stageForNode(const QString& n) {
    if (n.isEmpty()) return "request";
    const QJsonObject m = spec().value("nodeStage").toObject();
    if (m.contains(n)) return m.value(n).toString();
    const QString low = n.toLower();
    for (const QJsonValue& kv : spec().value("stageKeywords").toArray()) {
        const QJsonArray k = kv.toArray();
        if (QRegularExpression(k.at(1).toString()).match(low).hasMatch()) return k.at(0).toString();
    }
    return "request";
}
QString moduleFor(const QString& wf) {
    for (const QJsonValue& dv : spec().value("docTypes").toArray()) if (dv.toObject().value("workflow").toString() == wf) return dv.toObject().value("module").toString();
    const QString low = wf.toLower();
    for (const QJsonValue& kv : spec().value("moduleKeywords").toArray()) {
        const QJsonArray k = kv.toArray();
        if (QRegularExpression(k.at(1).toString()).match(low).hasMatch()) return k.at(0).toString();
    }
    return "operations";
}
QString str(const QJsonValue& v) { return v.isString() ? v.toString() : (v.isNull() || v.isUndefined()) ? QString() : v.toVariant().toString(); }
Doc toDoc(const QJsonObject& i) {
    Doc d;
    const QJsonObject data = i.value("data").toObject();
    QString type, module;
    for (const QJsonValue& dv : spec().value("docTypes").toArray()) {
        const QJsonObject o = dv.toObject();
        if (o.value("key").toString() == data.value("docType").toString() || (type.isEmpty() && o.value("workflow").toString() == i.value("definitionName").toString())) { type = o.value("key").toString(); module = o.value("module").toString(); if (o.value("key").toString() == data.value("docType").toString()) break; }
    }
    d.type = type; d.module = module.isEmpty() ? moduleFor(i.value("definitionName").toString()) : module;
    d.status = outcome(i);
    QString lastNode;
    const QJsonArray h = i.value("history").toArray();
    static const QRegularExpression skip("^(start|end|completed|rejected)$", QRegularExpression::CaseInsensitiveOption);
    for (int k = h.size() - 1; k >= 0; --k) { const QJsonObject e = h.at(k).toObject(); if (e.value("action").toString() == "Entered" && !skip.match(e.value("nodeName").toString()).hasMatch()) { lastNode = e.value("nodeName").toString(); break; } }
    if (d.status == "approved") { d.stage = "reporting"; d.step = "Completed"; }
    else if (d.status == "pending") { d.stage = stageForNode(lastNode); d.step = lastNode.isEmpty() ? "Start" : lastNode; }
    else { d.stage = stageForNode(lastNode); d.step = d.status == "rejected" ? "Rejected" : "Canceled"; }
    d.id = i.value("id").toString(); d.inst = i; d.title = i.value("definitionName").toString();
    d.number = data.value("docNumber").toString().isEmpty() ? "WF-" + d.id.left(6).toUpper() : data.value("docNumber").toString();
    for (const char* k : {"party", "employeeName", "candidateName"}) if (d.party.isEmpty()) d.party = str(data.value(k));
    bool ok = false; const double tv = data.value("total").toVariant().toDouble(&ok);
    d.hasTotal = ok && !data.value("total").isNull() && !str(data.value("total")).isEmpty(); d.total = d.hasTotal ? tv : 0;
    d.currency = str(data.value("currency")); d.branch = str(data.value("branch")); d.by = i.value("startedBy").toString();
    d.date = parse(i.value("startedAt").toString()); if (!d.date.isValid()) d.date = nowUtc();
    d.completed = parse(i.value("completedAt").toString());
    d.age = qMax(0.0, double(d.date.secsTo(d.completed.isValid() ? d.completed : nowUtc())) / 86400.0);
    return d;
}
}

QStringList stages() { QStringList l; for (const QJsonValue& v : spec().value("stages").toArray()) l << v.toString(); return l; }
QMap<QString, QString> moduleColors() { QMap<QString, QString> m; const QJsonObject o = spec().value("modules").toObject(); for (auto it = o.begin(); it != o.end(); ++it) m[it.key()] = it.value().toString(); return m; }
QString colorOf(const QString& m) { return moduleColors().value(m, "#64748b"); }

QList<Doc> docsOf(const QJsonArray& a) {
    QList<Doc> out;
    for (const QJsonValue& v : a) out << toDoc(v.toObject());
    std::stable_sort(out.begin(), out.end(), [](const Doc& x, const Doc& y) { return x.date > y.date; });
    return out;
}

Kpis kpis(const QList<Doc>& docs, int myTasks) {
    Kpis k; k.myApprovals = myTasks;
    int done = 0, closed = 0, rejected = 0; double days = 0;
    for (const Doc& d : docs) {
        const double v = d.total;
        const bool pend = d.status == "pending", appr = d.status == "approved";
        if (appr && inMonth(d.completed)) {
            if (d.type == "SO") k.salesMonth += v;
            if (d.type == "PR") k.purchasesMonth += v;
            if (d.type == "EXP" || d.type == "PV") k.expensesMonth += v;
            ++k.completedMonth;
        }
        if (pend) {
            ++k.openDocs;
            if (d.type == "SO") { k.pipeline += v; if (d.stage == "accounting") k.receivables += v; }
            if (d.stage == "accounting" && (d.type == "PR" || d.type == "PV" || d.type == "EXP")) k.payables += v;
            if (d.type == "PR" && (d.stage == "purchase" || d.stage == "inventory")) k.committed += v;
            if (d.type == "TRF" && d.stage == "inventory") k.inTransit += v;
        }
        if (appr) { ++done; days += d.age; }
        if (appr || d.status == "rejected") ++closed;
        if (d.status == "rejected") ++rejected;
    }
    k.avgCycleDays = done ? days / done : 0; k.rejectRate = closed ? double(rejected) / closed : 0;
    return k;
}

QList<Month> monthlyTrend(const QList<Doc>& docs, int months) {
    QList<Month> out; const QDate n = nowUtc().date();
    for (int k = months - 1; k >= 0; --k) { const QDate d = QDate(n.year(), n.month(), 1).addMonths(-k); out << Month{d.year(), d.month(), 0, 0}; }
    for (const Doc& d : docs) {
        if (d.status != "approved" || !d.completed.isValid() || !d.hasTotal) continue;
        for (Month& m : out) if (m.year == d.completed.date().year() && m.month == d.completed.date().month()) { if (d.type == "SO") m.sales += d.total; if (d.type == "PR") m.purchases += d.total; }
    }
    return out;
}

QMap<QString, StageCount> stageCounts(const QList<Doc>& docs) {
    QMap<QString, StageCount> r; for (const QString& s : stages()) r[s] = {};
    const QDate n = nowUtc().date(); StageCount raised;
    for (const Doc& d : docs) {
        if (d.status == "pending" || d.status == "approved") { StageCount& c = r[d.status == "pending" ? d.stage : "reporting"]; ++c.count; c.value += d.total; }
        if (d.date.date().month() == n.month() && d.date.date().year() == n.year()) { ++raised.count; raised.value += d.total; }
    }
    r["request"] = raised;
    return r;
}

QList<Step> stepTurnaround(const QList<Doc>& docs) {
    QMap<QString, QPair<double, int>> acc;
    for (const Doc& d : docs) {
        const QJsonArray h = d.inst.value("history").toArray();
        for (int k = 0; k < h.size(); ++k) {
            const QJsonObject e = h.at(k).toObject();
            if (e.value("action").toString() != "Entered") continue;
            for (int j = k + 1; j < h.size(); ++j) {
                const QJsonObject x = h.at(j).toObject(); const QString a = x.value("action").toString();
                if (x.value("nodeId") != e.value("nodeId") || a == "Entered" || a == "Logged" || x.value("actor").toString() == "system") continue;
                const QDateTime t0 = parse(e.value("timestamp").toString()), t1 = parse(x.value("timestamp").toString());
                if (t0.isValid() && t1.isValid()) { auto& p = acc[e.value("nodeName").toString()]; p.first += double(t0.secsTo(t1)) / 3600.0; p.second++; }
                break;
            }
        }
    }
    QList<Step> out; for (auto it = acc.begin(); it != acc.end(); ++it) out << Step{it.key(), it.value().first / it.value().second, it.value().second};
    std::sort(out.begin(), out.end(), [](const Step& a, const Step& b) { return a.avgHours > b.avgHours; });
    return out;
}

QList<Party> topParties(const QList<Doc>& docs, const QStringList& types, int limit) {
    QMap<QString, Party> m;
    for (const Doc& d : docs) {
        if (!types.contains(d.type) || d.party.isEmpty() || d.status == "canceled" || d.status == "rejected") continue;
        Party& p = m[d.party]; p.party = d.party; p.value += d.total; p.count++;
    }
    QList<Party> out = m.values();
    std::sort(out.begin(), out.end(), [](const Party& a, const Party& b) { return a.value > b.value; });
    return out.mid(0, limit);
}

QList<Group> groupBy(const QList<Doc>& docs, bool byModule) {
    QMap<QString, Group> g;
    for (const Doc& d : docs) {
        QString k = byModule ? d.module : d.branch; if (k.isEmpty()) k = QString::fromUtf8("—");
        Group& r = g[k]; r.key = k; r.count++; r.value += d.total;
        if (d.status == "pending") r.pending++; else if (d.status == "approved") { r.approved++; r.days += d.age; r.ndone++; } else if (d.status == "rejected") r.rejected++;
    }
    QList<Group> out = g.values();
    std::sort(out.begin(), out.end(), [](const Group& a, const Group& b) { return a.count > b.count; });
    return out;
}

QList<QPair<QString, int>> bottleneck(const QList<Doc>& docs) {
    QMap<QString, int> m; for (const Doc& d : docs) if (d.status == "pending") m[d.step]++;
    QList<QPair<QString, int>> out; for (auto it = m.begin(); it != m.end(); ++it) out << qMakePair(it.key(), it.value());
    std::sort(out.begin(), out.end(), [](const auto& a, const auto& b) { return a.second > b.second; });
    return out;
}

QString money(double v, const QString& cur) { return QLocale(QLocale::English).toString(qRound64(v)) + (cur.isEmpty() ? QString() : " " + cur); }
}
