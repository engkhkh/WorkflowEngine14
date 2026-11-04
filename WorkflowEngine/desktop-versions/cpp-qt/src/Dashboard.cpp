#include "Dashboard.h"

#include <QFile>
#include <QFileDialog>
#include <QFrame>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QScrollArea>

#include "Api.h"
#include "I18n.h"
#include "ReportDialog.h"
#include "Ui.h"

using I18n::t;

ScrollPage::ScrollPage() {
    auto* inner = new QWidget;
    il = new QVBoxLayout(inner);
    il->setContentsMargins(0, 0, 0, 0);
    auto* sc = new QScrollArea;
    sc->setWidgetResizable(true); sc->setFrameShape(QFrame::NoFrame); sc->setWidget(inner);
    lay->addWidget(sc);
}

static const char* kDocKeys[] = {"col.number", "col.type", "col.party", "col.date", "col.amount", "col.stage", "col.status", "col.step"};
QStringList docHeaders() { QStringList h; for (const char* k : kDocKeys) h << t(k); return h; }

QList<QStringList> docRows(const QList<Bi::Doc>& docs) {
    QList<QStringList> out;
    for (const Bi::Doc& d : docs) {
        QString st = d.status == "pending" ? t("filter.pending") : d.status == "approved" ? t("filter.approved") : t("filter.rejected");
        out << QStringList{d.number, d.type.isEmpty() ? d.title : t("doc." + d.type), d.party, d.date.toString("yyyy-MM-dd"), d.hasTotal ? Bi::money(d.total) : QString(), t("stage." + d.stage), st, d.step};
    }
    return out;
}

static QString curOf(const QList<Bi::Doc>& docs) { for (const auto& d : docs) if (!d.currency.isEmpty()) return d.currency; return {}; }

static QFrame* card(const QString& title, QWidget* w, QWidget* extra = nullptr) {
    auto* f = new QFrame; f->setProperty("card", true);
    auto* l = new QVBoxLayout(f);
    auto* h = new QHBoxLayout; h->addWidget(Ui::label(title, "title"), 1);
    if (extra) h->addWidget(extra);
    l->addLayout(h); l->addWidget(w);
    return f;
}

// ----------------------------------------------------------------------------- dashboard
DashboardPage::DashboardPage(std::function<void(int)> goPage, std::function<void(const QString&, const QString&)> openKind) : go(goPage) {
    hello = Ui::label({}, "title");
    auto* top = new QHBoxLayout; top->addWidget(hello, 1); top->addWidget(Ui::button(t("common.refresh"), [this] { reload(); }, "ghost"));
    il->addLayout(top);
    auto* grid = new QGridLayout;
    struct S { const char* key; const char* color; int pg; };
    int i = 0;
    for (S s : {S{"kpi.sales", "#0ea5e9", 4}, S{"kpi.purchases", "#8b5cf6", 4}, S{"kpi.receivables", "#10b981", 4}, S{"kpi.payables", "#f59e0b", 4}, S{"kpi.myApprovals", "#ef4444", 1}, S{"kpi.cycle", "#64748b", 3}}) {
        const int pg = s.pg;
        auto* c = new KpiCard(t(s.key), s.color, [goPage, pg] { goPage(pg); });
        kpis[s.key] = c; grid->addWidget(c, i / 3, i % 3); ++i;
    }
    il->addLayout(grid);
    flow = new FlowStrip;
    connect(flow, &FlowStrip::picked, this, [this](const QString& s) { pickStage(s); });
    stageTbl = Ui::table(docHeaders()); stageTbl->setMaximumHeight(200); stageTbl->hide();
    auto* fw = new QWidget; auto* fl = new QVBoxLayout(fw); fl->setContentsMargins(0, 0, 0, 0);
    fl->addWidget(Ui::label(t("dash.flowSub"), "dim")); fl->addWidget(flow); fl->addWidget(stageTbl);
    il->addWidget(card(t("dash.flow"), fw));
    trend = new TrendChart(t("module.sales"), t("chart.purchases"));
    mods = new HBars;
    auto* row = new QHBoxLayout; row->addWidget(card(t("dash.trend"), trend), 3); row->addWidget(card(t("dash.byModule"), mods), 2);
    il->addLayout(row);
    queue = Ui::table({t("col.step"), t("col.number"), t("col.party"), t("col.priority")}); queue->setMaximumHeight(210);
    recent = Ui::table(docHeaders()); recent->setMinimumHeight(250);
    il->addWidget(card(t("dash.myQueue"), queue, Ui::button(t("dash.viewAll"), [goPage] { goPage(1); }, "ghost")));
    il->addWidget(card(t("dash.recent"), recent, Ui::button(t("dash.viewAll"), [goPage] { goPage(2); }, "ghost")));
    il->addWidget(Ui::label(t("home.modules"), "title"));
    auto* mg = new QGridLayout; int n = 0;
    for (const QJsonValue& mv : I18n::visibleModules()) {
        const QJsonObject m = mv.toObject(); const QString id = m.value("id").toString();
        mg->addWidget(Ui::button(I18n::name(m), [openKind, id] { openKind(id, QString()); }, "ghost"), n / 4, n % 4); ++n;
    }
    il->addLayout(mg);
    il->addStretch();
}

void DashboardPage::reload() {
    hello->setText(t("dash.hello") + ", " + Api::I().displayName);
    Api::I().instances(this, [this](const QJsonValue& iv) {
        const QJsonArray inst = iv.toArray();
        Api::I().tasks(this, [this, inst](const QJsonValue& tv) { fill(inst, tv.toArray()); }, [this, inst](const QString&) { fill(inst, QJsonArray()); });
    }, [this](const QString&) { fill(QJsonArray(), QJsonArray()); });
}

void DashboardPage::fill(const QJsonArray& instances, const QJsonArray& tasks) {
    docs = Bi::docsOf(instances);
    const Bi::Kpis K = Bi::kpis(docs, tasks.size());
    const QString c = curOf(docs);
    auto m = [&](double v) { return Bi::money(v, c); };
    kpis["kpi.sales"]->set(m(K.salesMonth), t("kpi.pipeline") + ": " + m(K.pipeline));
    kpis["kpi.purchases"]->set(m(K.purchasesMonth), t("kpi.committed") + ": " + m(K.committed));
    kpis["kpi.receivables"]->set(m(K.receivables));
    kpis["kpi.payables"]->set(m(K.payables), t("kpi.expenses") + ": " + m(K.expensesMonth));
    kpis["kpi.myApprovals"]->set(QString::number(K.myApprovals));
    kpis["kpi.cycle"]->set(QString::number(K.avgCycleDays, 'f', 1) + " " + t("kpi.days"), QString("%1: %2 · %3: %4%").arg(t("kpi.openDocs")).arg(K.openDocs).arg(t("kpi.rejectRate")).arg(qRound(K.rejectRate * 100)));
    const auto sc = Bi::stageCounts(docs);
    QList<FlowItem> fi;
    for (const QString& s : Bi::stages()) fi << FlowItem{s, t("stage." + s), Bi::money(sc[s].value), sc[s].count};
    flow->set(fi);
    trend->set(Bi::monthlyTrend(docs));
    QList<BarRow> mr;
    const auto colors = Bi::moduleColors();
    for (auto it = colors.begin(); it != colors.end(); ++it) {
        int n = 0; for (const auto& d : docs) if (d.status == "pending" && d.module == it.key()) ++n;
        if (n) mr << BarRow{t("module." + it.key()), double(n), it.value(), QString::number(n)};
    }
    std::sort(mr.begin(), mr.end(), [](const BarRow& a, const BarRow& b) { return a.value > b.value; });
    mods->set(mr);
    QMap<QString, const Bi::Doc*> byId; for (const auto& d : docs) byId[d.id] = &d;
    QList<QStringList> qr; QList<QJsonObject> qp;
    for (int i = 0; i < qMin(6, int(tasks.size())); ++i) {
        const QJsonObject tk = tasks.at(i).toObject();
        const Bi::Doc* d = byId.value(tk.value("instanceId").toString());
        qr << QStringList{tk.value("nodeName").toString(), d ? d->number : QString(), d ? d->party : QString(), tk.value("priority").toString().isEmpty() ? "Normal" : tk.value("priority").toString()};
        qp << tk;
    }
    Ui::fill(queue, qr, qp);
    const QList<Bi::Doc> top = docs.mid(0, 8);
    QList<QJsonObject> rp; for (const auto& d : top) rp << d.inst;
    Ui::fill(recent, docRows(top), rp);
    pickStage(stage);
}

void DashboardPage::pickStage(const QString& s) {
    stage = s;
    if (s.isEmpty()) { stageTbl->hide(); return; }
    QList<Bi::Doc> sel;
    for (const auto& d : docs) if (s == "reporting" ? d.status == "approved" : (d.status == "pending" && d.stage == s)) sel << d;
    sel = sel.mid(0, 50);
    QList<QJsonObject> p; for (const auto& d : sel) p << d.inst;
    Ui::fill(stageTbl, docRows(sel), p);
    stageTbl->show();
}

// ----------------------------------------------------------------------------- reports
ReportsPage::ReportsPage() {
    auto* top = new QHBoxLayout; top->addWidget(Ui::label(t("rep.title"), "title"), 1);
    top->addWidget(Ui::button(t("common.refresh"), [this] { reload(); }, "ghost"));
    top->addWidget(Ui::button(QString::fromUtf8("🖨 ") + t("collab.rep.print"), [this] { designer(); }, "ghost"));
    top->addWidget(Ui::button(t("rep.export"), [this] { exportCsv(); }));
    il->addLayout(top);
    il->addWidget(Ui::label(t("rep.sub"), "dim"));
    auto hd = [](const QString& first) { return QStringList{first, t("col.count"), t("filter.pending"), t("filter.approved"), t("filter.rejected"), t("col.avgDays"), t("col.value")}; };
    tMod = Ui::table(hd(t("col.module"))); tBr = Ui::table(hd(t("col.branch")));
    tMod->setMaximumHeight(210); tBr->setMaximumHeight(210);
    il->addWidget(card(t("rep.byModule"), tMod)); il->addWidget(card(t("rep.byBranch"), tBr));
    bott = new HBars; turn = new HBars; cust = new HBars; vend = new HBars;
    auto* r1 = new QHBoxLayout; r1->addWidget(card(t("rep.bottleneck"), bott)); r1->addWidget(card(t("rep.turnaround"), turn)); il->addLayout(r1);
    auto* r2 = new QHBoxLayout; r2->addWidget(card(t("rep.topParties") + " · " + t("party.customer"), cust)); r2->addWidget(card(t("rep.topParties") + " · " + t("party.vendor"), vend)); il->addLayout(r2);
    il->addStretch();
}

void ReportsPage::reload() {
    Api::I().instances(this, [this](const QJsonValue& v) { fill(v.toArray()); }, [this](const QString&) { fill(QJsonArray()); });
}

QList<QStringList> ReportsPage::groupRows(bool byModule) const {
    QList<QStringList> out;
    for (const auto& g : Bi::groupBy(docs, byModule))
        out << QStringList{byModule ? t("module." + g.key) : g.key, QString::number(g.count), QString::number(g.pending), QString::number(g.approved), QString::number(g.rejected), QString::number(g.avgDays(), 'f', 1), Bi::money(g.value)};
    return out;
}

void ReportsPage::fill(const QJsonArray& instances) {
    docs = Bi::docsOf(instances);
    modRows = groupRows(true); brRows = groupRows(false);
    Ui::fill(tMod, modRows, QList<QJsonObject>(modRows.size())); Ui::fill(tBr, brRows, QList<QJsonObject>(brRows.size()));
    QList<BarRow> b;
    for (const auto& p : Bi::bottleneck(docs).mid(0, 8)) b << BarRow{p.first, double(p.second), "#f59e0b", QString::number(p.second)};
    bott->set(b);
    QList<BarRow> u;
    for (const auto& s : Bi::stepTurnaround(docs).mid(0, 8)) u << BarRow{s.step, s.avgHours, s.avgHours > 24 ? "#dc2626" : "#10b981", QString::number(s.avgHours, 'f', 1) + " " + t("rep.hours")};
    turn->set(u);
    QList<BarRow> c, v;
    for (const auto& p : Bi::topParties(docs, {"SO"})) c << BarRow{p.party, p.value, "#0ea5e9", Bi::money(p.value)};
    for (const auto& p : Bi::topParties(docs, {"PR", "PV"})) v << BarRow{p.party, p.value, "#8b5cf6", Bi::money(p.value)};
    cust->set(c); vend->set(v);
}

static QString csvLine(const QStringList& cells) {
    QStringList o; for (QString c : cells) { c.replace('"', "\"\""); o << '"' + c + '"'; }
    return o.join(',') + "\r\n";
}

QString ReportsPage::csv() const {
    QString s = csvLine({t("rep.byModule")});
    s += csvLine({t("col.module"), t("col.count"), t("filter.pending"), t("filter.approved"), t("filter.rejected"), t("col.avgDays"), t("col.value")});
    for (const auto& r : modRows) s += csvLine(r);
    s += "\r\n" + csvLine({t("rep.byBranch")});
    for (const auto& r : brRows) s += csvLine(r);
    s += "\r\n" + csvLine({t("rep.turnaround")});
    for (const auto& st : Bi::stepTurnaround(docs)) s += csvLine({st.step, QString::number(st.avgHours, 'f', 1), QString::number(st.count)});
    return s;
}

void ReportsPage::exportCsv() {
    const QString path = QFileDialog::getSaveFileName(this, t("rep.export"), "report.csv", "CSV (*.csv)");
    if (path.isEmpty()) return;
    QFile f(path);
    if (f.open(QIODevice::WriteOnly)) { f.write("\xEF\xBB\xBF"); f.write(csv().toUtf8()); }
}

void ReportsPage::designer() {
    static const char* keys[] = {"number", "type", "party", "date", "amount", "stage", "status", "step"};
    QList<ReportColumn> cols;
    for (int i = 0; i < 8; ++i) cols << ReportColumn{keys[i], t(kDocKeys[i]), i == 4};
    QList<ReportRow> rows;
    const auto dr = docRows(docs);
    for (int r = 0; r < dr.size(); ++r) {
        ReportRow row; for (int i = 0; i < 8; ++i) row[keys[i]] = dr[r][i];
        row["amount#"] = QString::number(docs[r].total);
        rows << row;
    }
    ReportDialog(this, "reports:documents", t("rep.title"), cols, rows, Api::I().displayName).exec();
}
