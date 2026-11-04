// Headless smoke test against tools/mock_server.py:  QT_QPA_PLATFORM=offscreen ./build/smoke
#include <QApplication>
#include <QEventLoop>
#include <QTimer>
#include <cstdio>

#include "../src/Api.h"
#include "../src/I18n.h"
#include "../src/ChatPage.h"
#include "../src/Forms.h"
#include "../src/MushafText.h"
#include "../src/QuranWords.h"
#include <QTcpServer>
#include <QTcpSocket>
#include <QComboBox>
#include <QCheckBox>
#include <QJsonArray>
#include <QJsonDocument>
#include "../src/MainWindow.h"
#include "../src/Dashboard.h"
#include "../src/Pos.h"
#include "../src/Hospital.h"
#include "../src/CalendarPage.h"
#include "../src/Finance.h"
#include "../src/HrPage.h"
#include "../src/OpsPage.h"
#include "../src/SiteRender.h"
#include "../src/SitePage.h"
#include "../src/CustomPage.h"
#include "../src/AdminPage.h"
#include "../src/ActionsPage.h"
#include <QJsonDocument>
#include "../src/ReportDialog.h"
#include <QFile>
#include <QFileInfo>
#include <QTextDocument>
#include "../src/RecordDialog.h"
#include "../src/Ui.h"
#include "../src/WorkflowPage.h"

static void pump(int ms) { QEventLoop l; QTimer::singleShot(ms, &l, &QEventLoop::quit); l.exec(); }

int main(int argc, char** argv) {
    QApplication app(argc, argv);
    app.setStyleSheet(Ui::kStyle);
    I18n::init();
    bool ok = false, failed = false;
    Api::I().login("http://localhost:5055", "admin", "admin", [&] { ok = true; }, [&](const QString&) { failed = true; });
    while (!ok && !failed) pump(50);
    std::printf("login %s, perms %d\n", ok ? "ok" : "FAILED", int(Api::I().permissions.size()));
    if (!ok) return 1;
    MainWindow w([] {});
    w.show();
    for (int i = 0; i < 12; ++i) { w.goPage(i); pump(500); }
    auto* chat = static_cast<ChatPage*>(w.pages[5]);
    chat->send("show purchase orders");
    pump(800);
    std::printf("chat texts: %s\n", qPrintable(chat->textsForTest().join(" | ")));
    w.goPage(4);
    w.erp->select("crm", "lead");
    pump(800);
    auto* t = w.erp->tableForTest();
    std::printf("erp rows %d first=%s / %s\n", t->rowCount(), qPrintable(t->item(0, 0)->text()), qPrintable(t->item(0, 1)->text()));
    QJsonObject rec = t->item(0, 0)->data(Qt::UserRole).toJsonObject();
    QJsonObject mod, kind;
    for (const QJsonValue& m : I18n::modules())
        if (m.toObject().value("id").toString() == "crm") {
            mod = m.toObject();
            for (const QJsonValue& k : mod.value("kinds").toArray()) if (k.toObject().value("kind").toString() == "lead") kind = k.toObject();
        }
    RecordDialog d(&w, mod, kind, rec, false);
    d.tableForTest()->item(1, 1)->setText("15000");
    d.addFieldForTest("city");
    QJsonObject body = d.collectForTest();
    std::printf("collect amount=%g hot=%d city=%d notes=%d\n", body.value("amount").toDouble(), int(body.value("hot").toBool()), int(body.contains("city")), int(body.value("notes").isObject()));
    for (auto mk : {std::pair<QString, QString>{"hr", "employee"}, {"fin", "account"}, {"pos", "product"}, {"hos", "patient"}, {"adm", "user"}, {"adm", "company"}}) {
        bool got = false; int n = -1; QString code;
        Api::I().records(mk.first, mk.second, &w, [&](const QJsonValue& v) { got = true; n = int(v.toArray().size()); code = v.toArray().at(0).toObject().value("code").toString(); }, [&](const QString&) { got = true; });
        while (!got) pump(30);
        std::printf("%s/%s rows=%d first=%s\n", qPrintable(mk.first), qPrintable(mk.second), n, qPrintable(code));
    }
    // ---- text Mushaf pages
    { for (int pg : {50, 157, 2}) { QImage im = MushafText::render(pg, 560, false); im.save(QString("/tmp/qt_mushaf_%1.png").arg(pg)); std::printf("mushaf text page %d: %dx%d\n", pg, im.width(), im.height()); } }
    // ---- typed forms, notes / files, saved filters
    {
        QJsonArray tasks; bool got = false;
        Api::I().tasks(&w, [&](const QJsonValue& v) { tasks = v.toArray(); got = true; }, [&](const QString&) { got = true; });
        while (!got) pump(30);
        const QJsonObject tk = tasks.at(0).toObject();
        TypedForm f(tk.value("form").toObject());
        const bool m1 = !f.missing().isEmpty();
        static_cast<QComboBox*>(f.editor("kind"))->setCurrentIndex(1);
        static_cast<QCheckBox*>(f.editor("paid"))->setChecked(true);
        std::printf("form missing-before=%d missing-after=%d values=%s neg(Reject)=%d neg(Approve)=%d\n", int(m1), int(f.missing().size()),
                    qPrintable(QString::fromUtf8(QJsonDocument(f.values()).toJson(QJsonDocument::Compact))), int(Forms::isNegative("Reject")), int(Forms::isNegative("Approve")));
        bool done = false; QString res;
        Api::I().completeTask(tk.value("id").toString(), "Approve", "ok", &w, [&](const QJsonValue&) { done = true; res = "ok"; }, [&](const QString& e) { done = true; res = e; }, f.values());
        while (!done) pump(30);
        std::printf("task complete: %s\n", qPrintable(res));
        Chatter c("crm", "lead", rec.value("id").toString());
        pump(400);
        c.sendForTest("hello from qt");
        c.attachForTest("a.txt", "hi");
        pump(800);
        std::printf("notes=%d files=%d\n", c.notesForTest()->count(), c.filesForTest()->count());
        QString bytes;
        done = false;
        const QString fid = c.filesForTest()->item(0)->data(Qt::UserRole).toJsonObject().value("id").toString();
        Api::I().fileBytes(fid, &w, [&](const QByteArray& b) { bytes = QString::fromUtf8(b); done = true; }, [&](const QString& e) { bytes = e; done = true; });
        while (!done) pump(30);
        std::printf("file bytes=%s\n", qPrintable(bytes));
        done = false; int nf = -1;
        Api::I().saveFilter("crm:lead", "Hot", false, QJsonObject{{"q", "acme"}, {"status", "New"}}, &w, [&](const QJsonValue&) { done = true; }, [&](const QString&) { done = true; });
        while (!done) pump(30);
        done = false;
        Api::I().filters("crm:lead", &w, [&](const QJsonValue& v) { nf = int(v.toArray().size()); done = true; }, [&](const QString&) { done = true; });
        while (!done) pump(30);
        std::printf("filters=%d\n", nf);
        w.goPage(4);
        w.erp->select("crm", "lead");
        pump(900);
        w.grab().save("/tmp/qt_erp2.png");
        RecordDialog rd(&w, mod, kind, rec, false);
        rd.show(); pump(500);
        rd.grab().save("/tmp/qt_rec.png");
    }
    // ---- workflow designer
    w.goPage(6); pump(600);
    auto* wp = static_cast<WorkflowPage*>(w.pages[6]);
    std::printf("wf defs rows=%d\n", wp->defsForTest()->rowCount());
    {
        Wf::DesignerDialog d(&w, "d1");
        d.show(); pump(800);
        d.canvas->selectNode("n3"); pump(200);
        d.grab().save("/tmp/qt_designer.png");
        std::printf("wf loaded nodes=%d edges=%d\n", int(d.model.nodes.size()), int(d.model.edges.size()));
    }
    Wf::DesignerDialog nd(&w, QString());
    nd.show(); pump(300);
    for (const QJsonValue& v : Wf::spec().value("nodes").toArray()) { nd.canvas->addNode(v.toObject().value("type").toString()); nd.buildNode(nd.model.nodes.last().value("id").toString()); }
    std::printf("wf added=%d\n", int(nd.model.nodes.size()));
    for (int i = nd.model.nodes.size() - 1; i >= 0; --i) { const QString ty = nd.model.nodes[i].value("type").toString(); if (ty != "Start" && ty != "End") nd.model.nodes.removeAt(i); }
    nd.canvas->rebuild();
    nd.canvas->handleLink(nd.model.nodes[0].value("id").toString());
    nd.canvas->handleLink(nd.model.nodes[1].value("id").toString());
    nd.nameEdit()->setText("Qt test flow");
    nd.save(); pump(600);
    std::printf("wf saved id=%s\n", qPrintable(nd.model.meta.value("id").toString()));
    nd.publish(); pump(900);
    std::printf("wf published=%d\n", int(nd.model.meta.value("isPublished").toBool()));
    QString iid;
    Api::I().startRun(nd.model.meta.value("id").toString(), &w, [&](const QJsonValue& v) { iid = v.toObject().value("id").toString(); }, [&](const QString&) { iid = "ERR"; });
    while (iid.isEmpty()) pump(30);
    Wf::InstanceDialog idlg(&w, iid);
    idlg.show(); pump(1200);
    idlg.grab().save("/tmp/qt_instance.png");
    std::printf("wf instance %s timeline=%d\n", qPrintable(iid), idlg.timelineCount());
    // ---- dashboard + reports (batch 3)
    {
        QJsonArray inst, tasks;
        bool g1 = false, g2 = false;
        Api::I().instances(&w, [&](const QJsonValue& v) { inst = v.toArray(); g1 = true; }, [&](const QString&) { g1 = true; });
        Api::I().tasks(&w, [&](const QJsonValue& v) { tasks = v.toArray(); g2 = true; }, [&](const QString&) { g2 = true; });
        while (!g1 || !g2) pump(30);
        const auto docs = Bi::docsOf(inst);
        const Bi::Kpis K = Bi::kpis(docs, tasks.size());
        std::printf("bi docs=%d open=%d sales=%g purch=%g recv=%g pay=%g pipe=%g cycle=%.1f rej=%.2f\n", int(docs.size()), K.openDocs, K.salesMonth, K.purchasesMonth, K.receivables, K.payables, K.pipeline, K.avgCycleDays, K.rejectRate);
        const auto sc = Bi::stageCounts(docs);
        std::printf("stages req=%d appr=%d purch=%d inv=%d acc=%d rep=%d\n", sc["request"].count, sc["approval"].count, sc["purchase"].count, sc["inventory"].count, sc["accounting"].count, sc["reporting"].count);
        std::printf("turnaround top=%s %.1f parties=%d groups=%d\n", qPrintable(Bi::stepTurnaround(docs).value(0).step), Bi::stepTurnaround(docs).value(0).avgHours, int(Bi::topParties(docs, {"SO"}).size()), int(Bi::groupBy(docs, true).size()));
        auto* dash = static_cast<DashboardPage*>(w.pages[0]);
        w.goPage(0); pump(1200);
        dash->resize(1100, 1500); dash->flowForTest(); emit dash->flowForTest()->picked("approval");
        pump(300);
        std::printf("stage table rows=%d\n", dash->stageTableForTest()->rowCount());
        dash->grab().save("/tmp/qt_dash.png");
        auto* rep = static_cast<ReportsPage*>(w.pages[3]);
        w.goPage(3); pump(1200);
        std::printf("module table rows=%d csvlen=%d\n", rep->moduleTable()->rowCount(), int(rep->csv().size()));
        rep->resize(1100, 1400); rep->grab().save("/tmp/qt_rep.png");
        QList<ReportColumn> cols{{"a", "Number", false}, {"b", "Amount", true}, {"c", "Party", false}};
        QList<ReportRow> rows{{{"a", "SO-1"}, {"b", "1,200"}, {"b#", "1200"}, {"c", "Alpha"}}, {{"a", "SO-2"}, {"b", "800"}, {"b#", "800"}, {"c", "Alpha"}}, {{"a", "SO-3"}, {"b", "500"}, {"b#", "500"}, {"c", "Beta"}}};
        ReportDialog rd(&w, "x:y", "Test report", cols, rows, "Admin");
        rd.resize(1000, 600); rd.show(); pump(500);
        rd.groupBox()->setCurrentIndex(3); pump(300);
        rd.grab().save("/tmp/qt_designer2.png");
        const QString html = rd.html();
        std::printf("designer html has subtotal=%d total2500=%d\n", int(html.contains("2,000")), int(html.contains("2,500")));
        saveReportPdf(html, rd.layout(), "/tmp/qt_t.pdf");
        std::printf("pdf bytes=%lld\n", QFileInfo("/tmp/qt_t.pdf").size());
    }
    {   // ---- point of sale
        auto* pos = static_cast<PosPage*>(w.pages[8]);
        w.goPage(8); pump(1500);
        std::printf("pos gate=%d products=%d\n", int(pos->till->gateVisible()), pos->till->productCount());
        pos->till->openShift(100); pump(1500);
        std::printf("pos gate after open=%d\n", int(pos->till->gateVisible()));
        pos->till->setFilter("tea"); std::printf("pos filter tea=%d\n", pos->till->productCount()); pos->till->setFilter("");
        for (const char* sku : {"P-104", "P-104", "P-100", "P-106"}) pos->till->add(sku);
        pos->till->setCustomer("CU-001"); pos->till->setLineDisc(0, 5);
        const Pos::Priced pp = pos->till->priced();
        std::printf("pos cart total=%.2f lines=%d\n", pp.total, int(pp.lines.size()));
        pos->grab().save("/tmp/qt_pos_till.png");
        pos->till->pay(true); pump(1500);
        pos->till->add("P-100"); pos->till->hold(); std::printf("pos held=%d\n", pos->till->heldCount());
        pos->tabs->setCurrentIndex(2); pump(1200);
        std::printf("pos sales rows=%d\n", pos->sales->rowCount());
        const QJsonObject sale = pos->sales->first();
        std::printf("pos canReturn=%d canVoid=%d\n", int(pos->sales->canReturn(sale)), int(pos->sales->canVoid(sale)));
        pos->sales->doReturn(sale, QJsonArray{QJsonObject{{"sku", "P-106"}, {"qty", 1}}}, "cash", "test"); pump(1200);
        std::printf("pos sales rows after return=%d\n", pos->sales->rowCount());
        pos->sales->grab().save("/tmp/qt_pos_sales.png");
        pos->tabs->setCurrentIndex(1); pump(1200);
        pos->shifts->cashMove("in", 50); pump(1200);
        std::printf("pos shift cashIn=%.2f sales=%d history=%d\n", pos->state.shift["data"].toObject()["cashIn"].toDouble(), pos->state.shift["data"].toObject()["salesCount"].toInt(), pos->shifts->historyTable()->rowCount());
        pos->shifts->closeShift(250); pump(1200);
        std::printf("pos shift closed=%d\n", int(pos->state.shift.isEmpty()));
        pos->grab().save("/tmp/qt_pos_shift.png");
    }

    {   // ---- hospital
        auto sec = [](const QString& id) { for (const QJsonValue& s : Hos::sections()) if (s.toObject()["id"].toString() == id) return s.toObject(); return QJsonObject(); };
        auto actOf = [&](const QJsonObject& s, const QString& id) { for (const QJsonValue& a : s["actions"].toArray()) if (a.toObject()["id"].toString() == id) return a.toObject(); return QJsonObject(); };
        auto go = [&](const QString& sid, const QJsonObject& act, const QJsonObject& row, const QMap<QString, QVariant>& vals, const QJsonObject& extra = {}) {
            QJsonValue res; QString msg; QStringList warns; bool done = false;
            Hos::run(sec(sid), act, row, vals, extra, &w, [&](const QJsonValue& v) { res = v; done = true; }, [&](const QString& m, const QStringList& wl) { msg = m; warns = wl; done = true; });
            while (!done) pump(30);
            if (!msg.isEmpty()) std::printf("  (error: %s%s)\n", qPrintable(msg), warns.isEmpty() ? "" : qPrintable(" warnings=" + warns.join(";")));
            return res;
        };
        auto list = [&](const QString& kind) { QJsonArray out; bool done = false; Api::I().call("GET", "/hospital/records/" + kind, QJsonValue(), &w, [&](const QJsonValue& v) { out = v.toArray(); done = true; }, [&](const QString&) { done = true; }); while (!done) pump(30); return out; };
        auto* hp = static_cast<HospitalPage*>(w.pages[9]);
        std::printf("hospital tabs=%d\n", hp->tabs->count());
        const QJsonObject pat = go("patients", sec("patients")["create"].toObject(), {}, {{"data.name", "Test Pat"}, {"data.phone", "055"}, {"data.insPct", "80"}}).toObject();
        std::printf("patient %s name=%s ins=%g\n", qPrintable(pat["code"].toString()), qPrintable(pat["data"].toObject()["name"].toString()), pat["data"].toObject()["insPct"].toDouble());
        const QJsonObject ed = go("patients", actOf(sec("patients"), "edit"), pat, {{"data.name", "Test Pat 2"}, {"data.phone", "055"}, {"data.insPct", "80"}}).toObject();
        std::printf("edit %s phone=%s\n", qPrintable(ed["data"].toObject()["name"].toString()), qPrintable(ed["data"].toObject()["phone"].toString()));
        const QJsonObject ap = go("appointments", sec("appointments")["create"].toObject(), {}, {{"patient", "MRN-000002"}, {"doctor", "DR-01"}, {"date", Hos::today()}, {"time", "10:00"}, {"minutes", "20"}, {"reason", "check"}}).toObject();
        std::printf("appt %s %s %s\n", qPrintable(ap["code"].toString()), qPrintable(ap["data"].toObject()["start"].toString()), qPrintable(ap["status"].toString()));
        go("appointments", sec("appointments")["create"].toObject(), {}, {{"patient", "MRN-000002"}, {"doctor", "DR-01"}, {"date", Hos::today()}, {"time", "10:00"}});
        const QJsonObject ci = go("appointments", actOf(sec("appointments"), "in"), ap, {}).toObject();
        std::printf("checkin visit %s\n", qPrintable(ci["visit"].toObject()["code"].toString()));
        QJsonObject v = list("visit").last().toObject();
        v = go("visits", actOf(sec("visits"), "edit"), v, {{"complaint", "cough"}, {"vitals.sys", "120"}, {"vitals.dia", "80"}, {"vitals.temp", "38.2"}, {"diagnoses", "J00 | Common cold\nFever"}, {"notes.s", "dry cough"}}).toObject();
        std::printf("visit vitals.sys=%g temp=%g dx=%d dx0=%s notes.s=%s\n", v["data"].toObject()["vitals"].toObject()["sys"].toDouble(), v["data"].toObject()["vitals"].toObject()["temp"].toDouble(), int(v["data"].toObject()["diagnoses"].toArray().size()),
                    qPrintable(v["data"].toObject()["diagnoses"].toArray()[0].toObject()["code"].toString()), qPrintable(v["data"].toObject()["notes"].toObject()["s"].toString()));
        const QJsonObject wk = go("patients", actOf(sec("patients"), "walkin"), QJsonObject{{"code", "MRN-000001"}}, {{"doctor", "DR-01"}, {"type", "Outpatient"}, {"complaint", "rash"}}).toObject();
        std::printf("walkin %s parent=%s\n", qPrintable(wk["code"].toString()), qPrintable(wk["parent"].toString()));
        const QMap<QString, QVariant> rxv{{"items[].drug", "DG-01"}, {"items[].dose", "1"}, {"items[].days", "5"}, {"items[].qty", "10"}};
        go("visits", actOf(sec("visits"), "rx"), wk, rxv);
        const QJsonObject rx = go("visits", actOf(sec("visits"), "rx"), wk, rxv, QJsonObject{{"overrideReason", "doctor aware"}}).toObject();
        std::printf("rx %s %s\n", qPrintable(rx["code"].toString()), qPrintable(rx["status"].toString()));
        go("visits", actOf(sec("visits"), "lab"), wk, {{"tests[]", "LT-01"}, {"urgent", true}});
        go("visits", actOf(sec("visits"), "svc"), wk, {{"service", "SV-01"}, {"qty", "2"}});
        const QJsonObject lab = go("lab", actOf(sec("lab"), "res"), list("labrequest").first().toObject(), {{"value", "13.5"}, {"note", "ok"}}).toObject();
        std::printf("lab %s %s\n", qPrintable(lab["status"].toString()), qPrintable(lab["data"].toObject()["value"].toString()));
        std::printf("disp %s\n", qPrintable(go("pharmacy", actOf(sec("pharmacy"), "disp"), list("prescription").first().toObject(), {}).toObject()["status"].toString()));
        std::printf("stock %g\n", go("drugs", actOf(sec("drugs"), "adj"), list("drug").first().toObject(), {{"delta", "25"}, {"reason", "recv"}}).toObject()["data"].toObject()["stock"].toDouble());
        const QJsonObject ad = go("beds", actOf(sec("beds"), "admit"), list("bed").first().toObject(), {{"patient", "MRN-000001"}, {"reason", "obs"}}).toObject();
        std::printf("admit %s\n", qPrintable(ad["code"].toString()));
        QString bs; for (const QJsonValue& b : list("bed")) bs += b.toObject()["status"].toString() + " ";
        std::printf("beds %s\n", qPrintable(bs.trimmed()));
        QString free; for (const QJsonValue& b : list("bed")) if (b.toObject()["status"].toString() == "Available") free = b.toObject()["code"].toString();
        std::printf("transfer %s\n", qPrintable(go("adm", actOf(sec("adm"), "tr"), ad, {{"bed", free}}).toObject()["data"].toObject()["bed"].toString()));
        std::printf("discharge %s\n", qPrintable(go("adm", actOf(sec("adm"), "dis"), ad, {{"outcome", "Recovered"}, {"summary", "fine"}}).toObject()["status"].toString()));
        go("visits", actOf(sec("visits"), "close"), wk, {});
        QString vs; for (const QJsonValue& x : list("visit")) vs += x.toObject()["status"].toString() + " ";
        std::printf("visits %s\n", qPrintable(vs.trimmed()));
        const QJsonObject inv = list("invoice").first().toObject();
        std::printf("invoice %s total=%g\n", qPrintable(inv["code"].toString()), inv["data"].toObject()["total"].toDouble());
        std::printf("pay %s\n", qPrintable(go("billing", actOf(sec("billing"), "pay"), inv, {{"amount", "100"}, {"method", "card"}}).toObject()["status"].toString()));
        for (int i = 0; i < hp->tabs->count(); ++i) {
            hp->tabs->setCurrentIndex(i); pump(700);
            auto* hs = qobject_cast<HosSection*>(hp->views[i]);
            std::printf("tab %s rows=%d\n", qPrintable(hp->secs[i]["id"].toString()), hs ? int(hs->rows.size()) : -1);
            if (i == 3) hp->grab().save("/tmp/qt_hos_visits.png");
        }
        auto* ap2 = qobject_cast<HosSection*>(hp->views[2]); ap2->table->selectRow(0);
        std::printf("appt btns in=%d done=%d cancel=%d\n", int(ap2->enabledFor("in")), int(ap2->enabledFor("done")), int(ap2->enabledFor("cancel")));
    }

    {   // ---- calendar and meetings
        auto* cp = static_cast<CalendarPage*>(w.pages[10]);
        w.goPage(10); pump(1500);
        std::printf("cal tabs=%d week rows=%d\n", cp->tabs->count(), int(cp->agenda->items.size()));
        cp->agenda->vsel->setCurrentIndex(0); pump(900); std::printf("cal day rows=%d\n", int(cp->agenda->items.size()));
        cp->agenda->vsel->setCurrentIndex(2); pump(900); std::printf("cal month rows=%d range=%s\n", int(cp->agenda->items.size()), qPrintable(cp->agenda->rng->text()));
        cp->agenda->vsel->setCurrentIndex(1); pump(900);
        const QDateTime now = QDateTime(QDate::currentDate().addDays(1), QTime(14, 0));
        QString e;
        QJsonObject body = Cal::eventPayload(QJsonObject{{"kind", "meeting"}, {"title", "Design sync"}, {"start", now.toString(Cal::kFmt)}, {"end", ""}, {"location", "Room 5"}, {"notes", "x"}, {"repeat", "weekly"}, {"until", ""}, {"remind", "15"}, {"priority", "normal"}, {"attendees", QJsonArray{"sara"}}, {"guests", "a@x.com; b@y.com"}}, e);
        std::printf("cal payload start=%s end=%s guests=%d remind=%d\n", qPrintable(body["start"].toString()), qPrintable(body["end"].toString()), int(body["guests"].toArray().size()), body["remindMinutes"].toInt());
        Cal::eventPayload(QJsonObject{{"kind", "event"}, {"title", " "}}, e); std::printf("cal bad title -> %s\n", qPrintable(e));
        Cal::eventPayload(QJsonObject{{"kind", "event"}, {"title", "x"}, {"start", "3/4/2026"}, {"end", ""}}, e); std::printf("cal bad time -> %s\n", qPrintable(e));
        auto call = [&](const char* m, const QString& path, const QJsonValue& b) { QJsonValue res; bool done = false; Api::I().call(m, path, b, &w, [&](const QJsonValue& v) { res = v; done = true; }, [&](const QString& msg) { std::printf("  (error: %s)\n", qPrintable(msg)); done = true; }); while (!done) pump(30); return res; };
        const QJsonObject r = call("POST", "/calendar/events", body).toObject(); const QJsonObject ev = r["ev"].toObject();
        std::printf("cal created %s %s emailed=%d\n", qPrintable(ev["id"].toString()), qPrintable(ev["room"].toString()), r["emailed"].toInt());
        std::printf("cal roundtrip=%d\n", int(Cal::fmtLocal(ev["start"].toString()) == now.toString(Cal::kFmt)));
        std::printf("cal join %s\n", qPrintable(call("POST", "/calendar/events/" + ev["id"].toString() + "/join", QJsonObject()).toObject()["url"].toString()));
        std::printf("cal rsvp %s\n", qPrintable(call("POST", "/calendar/events/" + ev["id"].toString() + "/rsvp", QJsonObject{{"response", "accepted"}}).toObject()["data"].toObject()["rsvp"].toObject()["admin"].toString()));
        { QByteArray ics; bool d2 = false; Api::I().raw("/calendar/events/" + ev["id"].toString() + "/ics", &w, [&](const QByteArray& b) { ics = b; d2 = true; }, [&](const QString&) { d2 = true; }); while (!d2) pump(30); std::printf("cal ics ok=%d\n", int(ics.contains("BEGIN:VEVENT"))); }
        std::printf("cal instant %s\n", qPrintable(call("POST", "/calendar/meetings/instant", QJsonObject{{"title", "Quick"}, {"attendees", QJsonArray()}}).toObject()["url"].toString()));
        call("DELETE", "/calendar/events/" + ev["id"].toString(), QJsonValue());
        cp->tabs->setCurrentIndex(1); pump(900); std::printf("cal todos=%d\n", int(cp->todos->items.size()));
        cp->todos->title->setText("Call vendor"); cp->todos->due->setText(now.toString(Cal::kFmt)); cp->todos->add(); pump(1200); std::printf("cal todos after add=%d\n", int(cp->todos->items.size()));
        cp->tabs->setCurrentIndex(2); pump(900); std::printf("cal settings jitsi=%s ws=%s\n", qPrintable(cp->settings->jitsi->text()), qPrintable(cp->settings->ws->text()));
        cp->settings->jitsi->setText("meet.example.org"); cp->settings->save(); pump(900); std::printf("cal saved=%s\n", qPrintable(cp->settings->msg->text()));
        cp->tabs->setCurrentIndex(0); pump(900); cp->agenda->table->selectRow(0);
        std::printf("cal btns edit=%d join=%d delete=%d\n", int(cp->agenda->btn["edit"]->isEnabled()), int(cp->agenda->btn["join"]->isEnabled()), int(cp->agenda->btn["delete"]->isEnabled()));
        cp->grab().save("/tmp/qt_cal.png");
    }
    {   // tap a word: locate + dialog against a stand-in Quran.com server
        QTcpServer srv; srv.listen(QHostAddress::LocalHost, 5067);
        QObject::connect(&srv, &QTcpServer::newConnection, [&] {
            QTcpSocket* c = srv.nextPendingConnection();
            QObject::connect(c, &QTcpSocket::readyRead, [c] {
                const QByteArray rq = c->readAll(); QByteArray body;
                if (rq.contains("/verses/by_key/1:2")) body = R"({"verse":{"words":[{"char_type_name":"word","translation":{"text":"[all] praise"},"transliteration":{"text":"al-hamdu"}},{"char_type_name":"word","translation":{"text":"for Allah"},"transliteration":{"text":"lillahi"}},{"char_type_name":"word","translation":{"text":"Lord"},"transliteration":{"text":"rabbi"}},{"char_type_name":"word","translation":{"text":"worlds"},"transliteration":{"text":"al-alamin"}},{"char_type_name":"end"}],"translations":[{"text":"All praise is for <b>Allah</b>"}]}})";
                else if (rq.contains("/tafsirs/16/by_ayah/1:2")) body = R"({"tafsir":{"text":"<p>tafsir</p>"}})";
                c->write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: " + QByteArray::number(body.size()) + "\r\n\r\n" + body); c->disconnectFromHost();
            });
        });
        qputenv("QURAN_API", "http://127.0.0.1:5067");
        QVector<MushafText::Hit> hits; MushafText::render(1, 500, false, "rose", &hits);
        const auto a = MushafText::locate(1, 2, 1), b = MushafText::locate(1, 3, 4), z = MushafText::locate(604, 15, 0);
        std::printf("locate 1/2/1=%d:%d#%d/%d  1/3/4=%d:%d#%d/%d  hits=%d\n", a.surah, a.ayah, a.pos, a.total, b.surah, b.ayah, b.pos, b.total, int(hits.size()));
        (void)z;
        WordDialog d(nullptr, 1, 2, 1, QString::fromUtf8("لِلَّهِ")); d.show(); pump(1500);
        d.showTafsir("ar"); pump(1500);
        std::printf("word: %s | %s | %s\n", qPrintable(d.meaningText()), qPrintable(d.verseText()), qPrintable(d.tafsirText()));
    }
    {   // finance reports
        auto* fp = new FinancePage; fp->show(); pump(500);
        std::printf("fin reports %d\n", int(fp->reports.size()));
        for (int i = 0; i < fp->pick->count(); ++i) {
            fp->pick->setCurrentIndex(i); pump(900);
            std::printf("== %s | %s\n", qPrintable(fp->current), qPrintable(fp->foot->text()));
            for (int r = 0; r < fp->table->rowCount(); ++r) { QStringList c; for (int k = 0; k < fp->table->columnCount(); ++k) c << fp->table->item(r, k)->text(); std::printf("   [%s]\n", qPrintable(c.join("|"))); }
        }
    }
    {   // HR reports + import
        auto* hp = new HrPage; hp->show(); pump(500);
        std::printf("hr reports %d\n", int(hp->reports.size()));
        for (int i = 0; i < hp->pick->count(); ++i) {
            hp->pick->setCurrentIndex(i); pump(900);
            std::printf("== %s | %s\n", qPrintable(hp->rep.value("id").toString()), qPrintable(hp->foot->text()));
            for (int r = 0; r < hp->table->rowCount(); ++r) { QStringList c; for (int k = 0; k < hp->table->columnCount(); ++k) c << hp->table->item(r, k)->text(); std::printf("   [%s]\n", qPrintable(c.join("|"))); }
        }
        hp->pick->setCurrentIndex(2); pump(900); hp->table->selectRow(0); hp->act(0); pump(900);
        std::printf("leave after approve: %s\n", qPrintable(hp->table->item(0, 5)->text()));
        HrImportDialog d(hp, [] {}); d.show();
        d.path->setText("/tmp/emp.xlsx"); d.load(); pump(300);
        QStringList mp; for (auto it = d.mapping.begin(); it != d.mapping.end(); ++it) mp << QString("%1=%2").arg(it.key()).arg(it.value());
        std::printf("mapping %s header=%d | %s | %s | run=%d %s\n", qPrintable(mp.join(",")), int(d.head->isChecked()), qPrintable(d.summary->text()), qPrintable(d.msg->text()), int(d.runBtn->isEnabled()), qPrintable(d.runBtn->text()));
        for (int r = 0; r < d.table->rowCount(); ++r) { QStringList c; for (int k = 0; k < d.table->columnCount(); ++k) c << d.table->item(r, k)->text(); std::printf("   [%s]\n", qPrintable(c.join("|"))); }
        d.run(); pump(1500);
        std::printf("RESULT %s\n", qPrintable(d.msg->text()));
        d.path->setText("/tmp/emp.csv"); d.load(); pump(300);
        std::printf("csv %s\n", qPrintable(d.summary->text()));
        d.run(); pump(1500);
        std::printf("CSV RESULT %s\n", qPrintable(d.msg->text()));
    }
    {   // Operations
        auto* op = new OpsPage; op->show(); op->reload(); pump(900);
        std::printf("ops reports %d\n", int(op->reports.size()));
        for (int i = 0; i < op->pick->count(); ++i) {
            if (i > 0) { op->pick->setCurrentIndex(i); pump(900); }
            const QString id = op->rep.value("id").toString();
            if (id == "mrp") { op->mSku->setCurrentIndex(0); op->mQty->setText("10"); op->addDemand(); pump(100); std::printf("wo btn %s vis=%d buy=%d\n", qPrintable(op->bWo->text()), int(op->bWo->isVisibleTo(op)), int(op->bBuy->isVisibleTo(op))); }
            if (id == "zatca") { std::printf("ZATCA city=%s\n", qPrintable(op->fields["city"]->text())); op->fields["city"]->setText("Jeddah"); op->saveProfile(); pump(600); std::printf("%s\n", qPrintable(op->msg->text())); continue; }
            std::printf("== %s | %s\n", qPrintable(id), qPrintable(op->foot->text().replace('\n', " / ")));
            for (int r = 0; r < op->table->rowCount(); ++r) { QStringList c; for (int k = 0; k < op->table->columnCount(); ++k) c << op->table->item(r, k)->text(); std::printf("   [%s]\n", qPrintable(c.join("|"))); }
            if (id == "mrp") { op->makeOrders(); pump(1200); std::printf("%s\n", qPrintable(op->msg->text())); }
            if (id == "projbill") { op->table->selectRow(0); QJsonObject p; Ui::selected(op->table, p); op->billNow(p, "2026-11-04", 30, 15); pump(1200); std::printf("BILL %s | %s\n", qPrintable(op->lastInvoice), qPrintable(op->msg->text())); std::printf("   after: %s\n", qPrintable(op->table->item(0, 4)->text())); }
        }
    }
    {   // site renderer against the portal's own output
        QFile f("/tmp/ref.json"); f.open(QIODevice::ReadOnly);
        const QJsonObject ref = QJsonDocument::fromJson(f.readAll()).object();
        for (const QString& k : ref.keys()) {
            const QString out = SiteRender::render(ref.value(k).toObject().value("design").toObject(), "http://h/o", "http://h/m");
            const QString want = ref.value(k).toObject().value("html").toString();
            int i = 0; while (i < out.size() && i < want.size() && out[i] == want[i]) ++i;
            std::printf("render %s %s (%d/%d)\n", qPrintable(k), out == want ? "IDENTICAL" : "DIFFERENT", int(out.size()), int(want.size()));
            if (out != want) std::printf("  at %d: %s\n  want : %s\n", i, qPrintable(out.mid(i - 60, 140)), qPrintable(want.mid(i - 60, 140)));
        }
    }
    {   // website builder + custom modules
        auto* sp = new SitePage; sp->show(); sp->reload(); pump(700);
        QJsonObject des = Site::templateDesign("shop", "Acme \"Shop\"", "SAR");
        bool done = false; QJsonObject made;
        Api::I().call("POST", "/website/sites", QJsonObject{{"name", "Acme \"Shop\""}, {"design", des}, {"currency", "SAR"}}, sp, [&](const QJsonValue& v) { made = v.toObject(); done = true; }, [&](const QString&) { done = true; });
        while (!done) pump(50);
        std::printf("created %s\n", qPrintable(made.value("slug").toString()));
        sp->reload(); pump(700);
        std::printf("sites rows %d : %s\n", sp->table->rowCount(), qPrintable(sp->table->item(0, 2)->text()));
        done = false; QJsonObject full;
        Api::I().call("GET", "/website/sites/" + made.value("id").toString(), QJsonValue(), sp, [&](const QJsonValue& v) { full = v.toObject(); done = true; }, [&](const QString&) { done = true; });
        while (!done) pump(50);
        SiteEditor ed(sp, full, full.value("design").toObject(), [] {});
        std::printf("pages %d blocks %d\n", ed.pages->count(), ed.blocks->count());
        ed.kind->setCurrentIndex(ed.kind->findData("faq")); ed.addBlock(); std::printf("after add %d\n", ed.blocks->count());
        ed.moveBlock(-1); ed.dupBlock(); ed.delBlock(); std::printf("after ops %d\n", ed.blocks->count());
        ed.sync(); pump(700); std::printf("products %d\n", int(ed.products().size()));
        ed.title->setText("Acme site"); ed.save(); pump(700); std::printf("saved msg %s\n", qPrintable(ed.msg->text()));
        sp->table->selectRow(0); sp->publish(); pump(1200); std::printf("after publish: %s\n", qPrintable(sp->table->item(0, 2)->text()));
        sp->pick->setCurrentIndex(1); pump(900); std::printf("subs %d first %s\n", sp->table->rowCount(), qPrintable(sp->table->item(0, 0)->text()));
        sp->table->selectRow(0); sp->status("shipped"); pump(800); std::printf("status %s\n", qPrintable(sp->table->item(0, 5)->text()));
        auto* cp = new CustomPage; cp->show(); cp->reload(); pump(600);
        done = false; QJsonObject mod;
        QJsonArray fs{QJsonObject{{"key", ""}, {"label", "Name"}, {"labelAr", QString::fromUtf8("الاسم")}, {"type", "text"}, {"required", true}}, QJsonObject{{"key", ""}, {"label", "Cost"}, {"type", "number"}}, QJsonObject{{"key", ""}, {"label", "Kind"}, {"type", "select"}, {"options", QJsonArray{"A", "B"}}}, QJsonObject{{"key", ""}, {"label", "Active"}, {"type", "checkbox"}}};
        Api::I().call("POST", "/custom/modules", QJsonObject{{"title", "Assets"}, {"titleAr", QString::fromUtf8("أصول")}, {"icon", "box"}, {"color", "#112233"}, {"fields", fs}}, cp, [&](const QJsonValue& v) { mod = v.toObject(); done = true; }, [&](const QString&) { done = true; });
        while (!done) pump(50);
        cp->reload(); pump(700);
        std::printf("module %s pick %s\n", qPrintable(mod.value("key").toString()), qPrintable(cp->pick->currentText()));
        CusRecordDialog rd(cp, cp->cur(), QJsonObject(), true, [cp] { cp->loadRecords(); });
        static_cast<QLineEdit*>(rd.w["name"])->setText("Laptop"); static_cast<QLineEdit*>(rd.w["cost"])->setText("1200.5"); static_cast<QComboBox*>(rd.w["kind"])->setCurrentIndex(static_cast<QComboBox*>(rd.w["kind"])->findData("B")); static_cast<QCheckBox*>(rd.w["active"])->setChecked(true);
        std::printf("values %s\n", QJsonDocument(rd.values()).toJson(QJsonDocument::Compact).constData());
        rd.save(); pump(800);
        std::printf("records %d: %s|%s|%s|%s\n", cp->table->rowCount(), qPrintable(cp->table->item(0, 0)->text()), qPrintable(cp->table->item(0, 1)->text()), qPrintable(cp->table->item(0, 2)->text()), qPrintable(cp->table->item(0, 4)->text()));
    }
    {   // administration: workspace, wizard, invitations, billing, modules
        auto* ap = new AdminPage; ap->show(); ap->reload(); pump(700);
        std::printf("adm tabs %d : %s | ws %s %s | %s\n", ap->tabs->count(), qPrintable(ap->tabs->tabText(1)), qPrintable(ap->ws->item(0, 1)->text()), qPrintable(ap->ws->item(0, 2)->text()), qPrintable(ap->msg->text()));
        ap->tabs->setCurrentIndex(1); pump(900);
        SetupWizard* w = ap->wiz;
        std::printf("co %s %s branches %d roles %d\n", qPrintable(w->name->text()), qPrintable(w->cur->currentText()), w->brt->rowCount(), int(w->roles.size()));
        w->name->setText("Acme Ltd"); w->next(); pump(700); std::printf("step %d\n", w->step);
        w->brn->setText("Jeddah"); w->brc->setText("Jeddah"); w->addBranch(); pump(700); std::printf("branches %d\n", w->brt->rowCount());
        w->next(); w->form->name->setText("Sara"); w->form->user->setText("sara"); w->form->email->setText("s@x.co"); w->form->invite(); pump(700); std::printf("invited %d %s\n", w->invited->rowCount(), qPrintable(w->invited->item(0, 2)->text()));
        w->next(); pump(700); std::printf("step %d mods %d\n", w->step, int(w->mods->boxes.size()));
        w->mods->boxes["mfg"]->setChecked(true); w->mods->save(); pump(700); std::printf("mods saved %s %s\n", qPrintable(w->mods->msg->text()), qPrintable(w->mods->selected().join(",")));
        w->next(); pump(700); std::printf("finish %s\n", qPrintable(w->msg->text()));
        ap->tabs->setCurrentIndex(2); pump(700); std::printf("invites %d %s\n", ap->inv->rowCount(), qPrintable(ap->inv->item(1, 3)->text()));
        ap->inv->selectRow(1); ap->resend(); pump(700); ap->copyLink(); std::printf("%s\n", qPrintable(ap->msg->text()));
        ap->tabs->setCurrentIndex(3); pump(700); std::printf("invoices %d %s\n", ap->invs->rowCount(), qPrintable(ap->invs->item(0, 5)->text()));
        ap->invs->selectRow(0); ap->pay(); pump(700); std::printf("%s\n", qPrintable(ap->msg->text().left(40))); ap->sandbox(); pump(700); std::printf("%s\n", qPrintable(ap->invs->item(0, 5)->text()));
        ap->invs->selectRow(0); ap->printInv(); std::printf("%s\n", qPrintable(ap->msg->text()));
        ap->tabs->setCurrentIndex(4); pump(700); std::printf("mods %d\n", int(ap->mods->boxes.size()));
    }
    {   // actions: work orders, periods, depreciation
        auto* ac = new ActionsPage; ac->show(); ac->reload(); pump(900);
        std::printf("act tabs %d wo %d boms %d\n", ac->tabs->count(), ac->wo->rowCount(), ac->bom->count());
        ac->createWo(); pump(700); std::printf("%s rows %d\n", qPrintable(ac->msg->text()), ac->wo->rowCount());
        ac->wo->selectRow(0); pump(100); std::printf("rel %d start %d\n", int(ac->bRel->isEnabled()), int(ac->bStart->isEnabled()));
        ac->step("release"); pump(700); ac->wo->selectRow(0); ac->step("start"); pump(700); std::printf("status %s\n", qPrintable(ac->wo->item(0, 4)->text()));
        ac->tabs->setCurrentIndex(1); pump(900); std::printf("periods %d\n", ac->per->rowCount());
        ac->year->setValue(2027); ac->generate(); pump(1500); std::printf("%s rows %d\n", qPrintable(ac->msg->text()), ac->per->rowCount());
        ac->per->selectRow(0); pump(100); ac->setPer("Closed"); pump(700); std::printf("first %s %s\n", qPrintable(ac->per->item(0, 0)->text()), qPrintable(ac->per->item(0, 1)->text()));
        ac->tabs->setCurrentIndex(2); pump(900); std::printf("due %d %s\n", int(ac->items.size()), qPrintable(ac->total->text()));
        ac->runDep(); pump(1200); std::printf("%s | %s\n", qPrintable(ac->msg->text()), qPrintable(ac->total->text()));
        ac->tabs->setCurrentIndex(3); pump(900); std::printf("inv %d\n", ac->inv->rowCount());
        ac->inv->selectRow(0); pump(100); std::printf("post %d einv %d\n", int(ac->bPost->isEnabled()), int(ac->bEinv->isEnabled()));
        ac->postInv(); pump(900); std::printf("%s | %s\n", qPrintable(ac->msg->text()), qPrintable(ac->inv->item(0, 5)->text()));
        ac->einvoice(); pump(700);
        ac->side->setCurrentIndex(1); pump(900); std::printf("AP %s %s\n", qPrintable(ac->inv->item(0, 4)->text()), qPrintable(ac->inv->item(1, 4)->text()));
    }
    {   // HR: hire a candidate
        auto* hp = new HrPage; hp->show(); hp->pick->setCurrentIndex(hp->pick->findData("recruit")); pump(900);
        int offer = -1; for (int r = 0; r < hp->table->rowCount(); ++r) if (hp->table->item(r, 3)->text() == "Offer") offer = r;
        std::printf("hr recruit rows %d offer %d btns %d%d%d%d\n", hp->table->rowCount(), offer, int(hp->bA->isVisible()), int(hp->bB->isVisible()), int(hp->bC->isVisible()), int(hp->bD->isVisible()));
        QJsonObject cand; hp->table->selectRow(offer); Ui::selected(hp->table, cand); hp->hire(cand); pump(200);
        auto dl = hp->findChildren<QDialog*>(); QDialog* d = dl.isEmpty() ? nullptr : dl.last();
        if (d) { auto eds = d->findChildren<QLineEdit*>(); eds[0]->setText("E9002"); auto bs = d->findChildren<QPushButton*>(); bs.last()->click(); pump(1200); }
        std::printf("after hire: %s\n", qPrintable(hp->table->item(offer, 3)->text()));
    }
    { MushafText::render(2, 780, false, "blue").save("/tmp/qt_blue2.png"); MushafText::render(2, 780, false, "rose").save("/tmp/qt_rose2.png"); std::printf("mushaf themes rendered\n"); }
    w.grab().save("/tmp/qt_shot.png");
    std::printf("shot ok\n");
    return 0;
}
