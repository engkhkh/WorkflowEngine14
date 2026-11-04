#include "CalendarPage.h"

#include <QCheckBox>
#include <QClipboard>
#include <QDesktopServices>
#include <QDialog>
#include <QDialogButtonBox>
#include <QFile>
#include <QFileDialog>
#include <QFormLayout>
#include <QGuiApplication>
#include <QHBoxLayout>
#include <QListWidget>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QRegularExpression>
#include <QUrl>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

namespace Cal {
const char* kFmt = "yyyy-MM-dd HH:mm";

QDateTime toLocal(const QString& iso) { return QDateTime::fromString(iso.left(19) + "Z", Qt::ISODate).toLocalTime(); }
QString toUtcIso(const QDateTime& dt) { return dt.toUTC().toString("yyyy-MM-ddTHH:mm:ss") + "Z"; }
QString fmtLocal(const QString& iso) { return iso.isEmpty() ? QString() : toLocal(iso).toString(kFmt); }

QString parseLocal(const QString& s, bool* ok) {
    *ok = true;
    const QString x = s.trimmed();
    if (x.isEmpty()) return {};
    const QDateTime d = QDateTime::fromString(x, kFmt);
    if (!d.isValid()) { *ok = false; return {}; }
    return toUtcIso(d);   // fromString gives local time
}

void period(const QString& view, const QDate& anchor, QDateTime& from, QDateTime& to) {
    QDate a, b;
    if (view == "day") { a = anchor; b = a.addDays(1); }
    else if (view == "week") { a = anchor.addDays(-(anchor.dayOfWeek() - 1)); b = a.addDays(7); }
    else { a = QDate(anchor.year(), anchor.month(), 1); b = a.addMonths(1); }
    from = QDateTime(a, QTime(0, 0)); to = QDateTime(b, QTime(0, 0));
}

QDate shift(const QString& view, const QDate& anchor, int n) {
    if (view == "day") return anchor.addDays(n);
    if (view == "week") return anchor.addDays(7 * n);
    return QDate(anchor.year(), anchor.month(), 1).addMonths(n);
}

QJsonObject eventPayload(const QJsonObject& v, QString& err) {
    err.clear();
    const QString kind = v["kind"].toString();
    if (v["title"].toString().trimmed().isEmpty()) { err = t("cal.u.needtitle"); return {}; }
    bool ok1, ok2;
    QString start = parseLocal(v["start"].toString(), &ok1), end = parseLocal(v["end"].toString(), &ok2);
    QString untilIso;
    const QString until = v["until"].toString().trimmed();
    bool ok3 = true;
    if (!until.isEmpty()) { const QDate d = QDate::fromString(until, "yyyy-MM-dd"); ok3 = d.isValid(); if (ok3) untilIso = toUtcIso(QDateTime(d, QTime(0, 0))); }
    if (!ok1 || !ok2 || !ok3 || (kind != "todo" && start.isEmpty())) { err = t("cal.u.badtime"); return {}; }
    if (kind != "todo" && (end.isEmpty() || end <= start)) end = toUtcIso(toLocal(start).addSecs(3600));
    QJsonArray guests;
    for (const QString& g : v["guests"].toString().split(QRegularExpression("[,;\\s]+"), Qt::SkipEmptyParts)) guests.append(g.trimmed());
    const QString rem = v["remind"].toString().trimmed();
    bool isNum = false; const int rm = rem.toInt(&isNum);
    return QJsonObject{{"kind", kind}, {"title", v["title"].toString().trimmed()}, {"start", start.isEmpty() ? QJsonValue() : QJsonValue(start)}, {"end", kind == "todo" ? QJsonValue() : QJsonValue(end)},
                       {"notes", v["notes"]}, {"location", v["location"]}, {"attendees", kind == "todo" ? QJsonArray() : v["attendees"].toArray()}, {"guests", guests},
                       {"repeat", v["repeat"].toString("none")}, {"repeatUntil", untilIso.isEmpty() ? QJsonValue() : QJsonValue(untilIso)}, {"remindMinutes", isNum ? QJsonValue(rm) : QJsonValue()}, {"priority", v["priority"].toString("normal")}};
}
}  // namespace Cal

namespace {
QString kindName(const QString& k) { return t(k == "meeting" ? "cal.u.meeting" : k == "todo" ? "cal.u.todo" : "cal.u.event"); }
QString me() { return Api::I().username; }

class EventDlg : public QDialog {
public:
    QJsonObject body;
    EventDlg(QWidget* parent, const QJsonObject& item, bool isNew, const QJsonArray& people) : QDialog(parent) {
        setWindowTitle(isNew ? t("cal.u.new") : t("cal.u.edit"));
        setMinimumWidth(520);
        const QJsonObject d = item["data"].toObject();
        auto* lay = new QVBoxLayout(this);
        auto* form = new QFormLayout;
        kind = new QComboBox;
        for (const char* k : {"event", "meeting", "todo"}) kind->addItem(kindName(k), k);
        kind->setCurrentIndex(qMax(0, kind->findData(item["kind"].toString("event"))));
        title = new QLineEdit(item["title"].toString());
        const QDateTime now = QDateTime(QDate::currentDate(), QTime(QTime::currentTime().hour(), 0)).addSecs(3600);
        start = new QLineEdit(item.contains("start") && !item["start"].isNull() ? Cal::fmtLocal(item["start"].toString()) : now.toString(Cal::kFmt));
        end = new QLineEdit(item.contains("end") && !item["end"].isNull() ? Cal::fmtLocal(item["end"].toString()) : now.addSecs(3600).toString(Cal::kFmt));
        location = new QLineEdit(d["location"].toString());
        notes = new QPlainTextEdit(d["notes"].toString()); notes->setFixedHeight(60);
        repeat = new QComboBox;
        for (auto kv : {std::pair<const char*, const char*>{"none", "cal.u.none"}, {"daily", "cal.u.daily"}, {"weekly", "cal.u.weekly"}, {"monthly", "cal.u.monthly"}}) repeat->addItem(t(kv.second), kv.first);
        repeat->setCurrentIndex(qMax(0, repeat->findData(d["repeat"].toString("none"))));
        until = new QLineEdit(d["repeatUntil"].toString().left(10));
        remind = new QLineEdit(isNew ? "10" : (d["remind"].isNull() || !d.contains("remind") ? "" : QString::number(d["remind"].toInt())));
        prio = new QComboBox;
        for (const char* k : {"low", "normal", "high"}) prio->addItem(k, k);
        prio->setCurrentIndex(qMax(0, prio->findData(d["priority"].toString("normal"))));
        guests = new QLineEdit;
        QStringList gl; for (const QJsonValue& g : d["guests"].toArray()) gl << g.toString();
        guests->setText(gl.join(", "));
        att = new QListWidget; att->setMaximumHeight(110);
        QStringList chosen; for (const QJsonValue& a : d["attendees"].toArray()) chosen << a.toString();
        for (const QJsonValue& pv : people) {
            const QJsonObject p = pv.toObject();
            if (p["username"].toString().toLower() == me().toLower()) continue;
            auto* it = new QListWidgetItem(p["displayName"].toString() + " (" + p["username"].toString() + ")");
            it->setFlags(it->flags() | Qt::ItemIsUserCheckable);
            it->setCheckState(chosen.contains(p["username"].toString()) ? Qt::Checked : Qt::Unchecked);
            it->setData(Qt::UserRole, p["username"].toString());
            att->addItem(it);
        }
        form->addRow(t("cal.u.type"), kind); form->addRow(t("cal.u.title"), title); form->addRow(t("cal.u.start"), start); form->addRow(t("cal.u.end"), end);
        form->addRow(t("cal.u.location"), location); form->addRow(t("cal.u.notes"), notes); form->addRow(t("cal.u.repeat"), repeat); form->addRow(t("cal.u.until"), until);
        form->addRow(t("cal.u.remind"), remind); form->addRow(t("cal.u.priority"), prio); form->addRow(t("cal.u.attendees"), att); form->addRow(t("cal.u.guests"), guests);
        lay->addLayout(form);
        avail = Ui::label("", "dim");
        lay->addWidget(Ui::button(t("cal.u.avail"), [this] { check(); }, "ghost"));
        lay->addWidget(avail);
        err = Ui::label("", "error");
        lay->addWidget(err);
        auto* bb = new QDialogButtonBox;
        saveBtn = bb->addButton(t("cal.u.save"), QDialogButtonBox::AcceptRole);
        bb->addButton(t("common.cancel"), QDialogButtonBox::RejectRole);
        connect(bb, &QDialogButtonBox::accepted, this, [this] {
            QString e;
            body = Cal::eventPayload(values(), e);
            if (!e.isEmpty()) { err->setText(e); return; }
            accept();
        });
        connect(bb, &QDialogButtonBox::rejected, this, &QDialog::reject);
        lay->addWidget(bb);
        if (!isNew && item["owner"].toString().toLower() != me().toLower() && !Api::I().can("cal.settings"))
            for (QWidget* w : QList<QWidget*>{kind, title, start, end, location, notes, repeat, until, remind, prio, att, guests}) w->setEnabled(false), saveBtn->setEnabled(false);
    }
    QJsonArray attendees() const {
        QJsonArray a;
        for (int i = 0; i < att->count(); ++i) if (att->item(i)->checkState() == Qt::Checked) a.append(att->item(i)->data(Qt::UserRole).toString());
        return a;
    }
    QJsonObject values() const {
        return QJsonObject{{"kind", kind->currentData().toString()}, {"title", title->text()}, {"start", start->text()}, {"end", end->text()}, {"location", location->text()}, {"notes", notes->toPlainText()},
                           {"repeat", repeat->currentData().toString()}, {"until", until->text()}, {"remind", remind->text()}, {"priority", prio->currentData().toString()}, {"attendees", attendees()}, {"guests", guests->text()}};
    }
    void check() {
        bool o1, o2;
        const QString s = Cal::parseLocal(start->text(), &o1), e = Cal::parseLocal(end->text(), &o2);
        if (!o1 || !o2 || s.isEmpty()) { avail->setText(t("cal.u.badtime")); return; }
        QJsonArray users{me()};
        for (const QJsonValue& a : attendees()) users.append(a);
        const QString a = Cal::toUtcIso(Cal::toLocal(s).addSecs(-43200)), b = Cal::toUtcIso(Cal::toLocal(e.isEmpty() ? s : e).addSecs(43200));
        Api::I().call("POST", "/calendar/freebusy", QJsonObject{{"users", users}, {"from", a}, {"to", b}}, this, [=](const QJsonValue& v) {
            QStringList lines;
            for (const QJsonValue& uv : users) {
                const QString u = uv.toString(); QStringList clash;
                for (const QJsonValue& xv : v.toObject()[u].toArray()) {
                    const QJsonObject x = xv.toObject();
                    if (x["s"].toString() < e && x["e"].toString() > s) clash << Cal::fmtLocal(x["s"].toString()).mid(11) + "-" + Cal::fmtLocal(x["e"].toString()).mid(11);
                }
                lines << u + ": " + (clash.isEmpty() ? t("cal.u.free") : t("cal.u.busy") + " " + clash.join(", "));
            }
            avail->setText(lines.join("\n"));
        }, [this](const QString& m) { avail->setText(m); });
    }
private:
    QComboBox *kind, *repeat, *prio;
    QLineEdit *title, *start, *end, *location, *until, *remind, *guests;
    QPlainTextEdit* notes;
    QListWidget* att;
    QLabel *avail, *err;
    QPushButton* saveBtn;
};
}  // namespace

// ---------------------------------------------------------------- agenda
CalAgenda::CalAgenda() {
    auto* lay = new QVBoxLayout(this);
    auto* bar = new QHBoxLayout;
    bar->addWidget(Ui::button("‹", [this] { anchor = Cal::shift(view, anchor, -1); reload(); }, "ghost"));
    bar->addWidget(Ui::button(t("cal.u.today"), [this] { anchor = QDate::currentDate(); reload(); }, "ghost"));
    bar->addWidget(Ui::button("›", [this] { anchor = Cal::shift(view, anchor, 1); reload(); }, "ghost"));
    vsel = new QComboBox;
    for (const char* k : {"day", "week", "month"}) vsel->addItem(t(QString("cal.u.") + k), k);
    vsel->setCurrentIndex(1);
    connect(vsel, &QComboBox::currentIndexChanged, this, [this] { view = vsel->currentData().toString(); reload(); });
    bar->addWidget(vsel);
    rng = Ui::label("", "dim");
    bar->addWidget(rng, 1);
    bar->addWidget(Ui::button(t("cal.u.new"), [this] { edit({}, true); }, "primary"));
    bar->addWidget(Ui::button(t("cal.u.instant"), [this] {
        Api::I().call("POST", "/calendar/meetings/instant", QJsonObject{{"title", t("cal.u.instant")}, {"attendees", QJsonArray()}}, this,
                      [this](const QJsonValue& v) { QDesktopServices::openUrl(QUrl(v.toObject()["url"].toString())); reload(); }, [this](const QString& m) { err->setText(m); });
    }, "ghost"));
    lay->addLayout(bar);
    err = Ui::label("", "error");
    lay->addWidget(err);
    table = Ui::table({t("cal.u.when"), t("cal.u.title"), t("cal.u.type"), t("cal.u.where"), t("cal.u.rsvp")});
    connect(table, &QTableWidget::itemSelectionChanged, this, [this] { sel(); });
    connect(table, &QTableWidget::cellDoubleClicked, this, [this] { QJsonObject r; if (Ui::selected(table, r)) edit(r, false); });
    lay->addWidget(table, 1);
    auto* row = new QHBoxLayout;
    auto selected = [this] { QJsonObject r; Ui::selected(table, r); return r; };
    auto mk = [&](const QString& key, std::function<void()> fn) { btn[key] = Ui::button(t("cal.u." + key), fn, "ghost"); row->addWidget(btn[key]); };
    auto joinInfo = [this, selected](std::function<void(const QJsonObject&)> cb) {
        Api::I().call("POST", "/calendar/events/" + selected()["id"].toString() + "/join", QJsonObject(), this, [cb](const QJsonValue& v) { cb(v.toObject()); }, [this](const QString& m) { err->setText(m); });
    };
    auto rsvp = [this, selected](const QString& r) {
        Api::I().call("POST", "/calendar/events/" + selected()["id"].toString() + "/rsvp", QJsonObject{{"response", r}}, this, [this](const QJsonValue&) { reload(); }, [this](const QString& m) { err->setText(m); });
    };
    mk("edit", [this, selected] { edit(selected(), false); });
    mk("join", [this, joinInfo] { joinInfo([this](const QJsonObject& r) { QDesktopServices::openUrl(QUrl(r["url"].toString())); err->setText(t("cal.u.opened")); }); });
    mk("link", [this, joinInfo] { joinInfo([this](const QJsonObject& r) { QGuiApplication::clipboard()->setText(r["url"].toString()); err->setText(t("cal.u.copied") + ": " + r["url"].toString()); }); });
    mk("ics", [this, selected] {
        const QJsonObject e = selected();
        const QString path = QFileDialog::getSaveFileName(this, t("cal.u.ics"), e["title"].toString() + ".ics", "iCalendar (*.ics)");
        if (path.isEmpty()) return;
        Api::I().raw("/calendar/events/" + e["id"].toString() + "/ics", this, [path](const QByteArray& b) { QFile f(path); if (f.open(QIODevice::WriteOnly)) f.write(b); }, [this](const QString& m) { err->setText(m); });
    });
    mk("accept", [rsvp] { rsvp("accepted"); });
    mk("maybe", [rsvp] { rsvp("maybe"); });
    mk("decline", [rsvp] { rsvp("declined"); });
    mk("delete", [this, selected] {
        if (!Ui::ask(this, t("cal.u.confirmdel"), t("common.yes"), t("common.no"))) return;
        Api::I().call("DELETE", "/calendar/events/" + selected()["id"].toString(), QJsonValue(), this, [this](const QJsonValue&) { reload(); }, [this](const QString& m) { err->setText(m); });
    });
    row->addStretch(1);
    lay->addLayout(row);
    sel();
}

void CalAgenda::reload() {
    QDateTime a, b;
    Cal::period(view, anchor, a, b);
    rng->setText(a.toString("yyyy-MM-dd") + " → " + b.addDays(-1).toString("yyyy-MM-dd"));
    err->clear();
    Api::I().call("GET", "/calendar/events?from=" + Cal::toUtcIso(a) + "&to=" + Cal::toUtcIso(b), QJsonValue(), this, [this](const QJsonValue& v) {
        items = v.toArray();
        Api::I().call("GET", "/calendar/people", QJsonValue(), this, [this](const QJsonValue& p) { people = p.toArray(); paint(); }, [this](const QString& m) { err->setText(m); });
    }, [this](const QString& m) { err->setText(m); });
}

void CalAgenda::paint() {
    QList<QStringList> rows; QList<QJsonObject> pay;
    for (const QJsonValue& v : items) {
        const QJsonObject e = v.toObject(), d = e["data"].toObject();
        rows << QStringList{Cal::fmtLocal(e["start"].toString()) + (e["end"].isNull() ? "" : " → " + Cal::fmtLocal(e["end"].toString()).mid(11)), e["title"].toString() + (e["occurrence"].toBool() ? " ↻" : ""),
                            kindName(e["kind"].toString()), d["location"].toString(), d["rsvp"].toObject()[me()].toString()};
        pay << e;
    }
    Ui::fill(table, rows, pay);
    sel();
}

void CalAgenda::sel() {
    QJsonObject e;
    const bool has = Ui::selected(table, e);
    const bool mine = has && (e["owner"].toString().toLower() == me().toLower() || Api::I().can("cal.settings"));
    bool invited = false;
    if (has) for (const QJsonValue& a : e["data"].toObject()["attendees"].toArray()) if (a.toString() == me()) invited = true;
    btn["edit"]->setEnabled(has); btn["ics"]->setEnabled(has);
    btn["join"]->setEnabled(has && e["kind"].toString() == "meeting"); btn["link"]->setEnabled(has && e["kind"].toString() == "meeting");
    for (const char* k : {"accept", "maybe", "decline"}) btn[k]->setEnabled(invited);
    btn["delete"]->setEnabled(mine);
}

void CalAgenda::edit(const QJsonObject& item, bool isNew) {
    EventDlg d(this, item, isNew, people);
    if (!d.exec()) return;
    auto done = [this](const QJsonValue&) { reload(); };
    auto fail = [this](const QString& m) { err->setText(m); };
    if (isNew) Api::I().call("POST", "/calendar/events", d.body, this, done, fail);
    else Api::I().call("PUT", "/calendar/events/" + item["id"].toString(), d.body, this, done, fail);
}

// ---------------------------------------------------------------- to-dos
CalTodos::CalTodos() {
    auto* lay = new QVBoxLayout(this);
    auto* bar = new QHBoxLayout;
    title = new QLineEdit; title->setPlaceholderText(t("cal.u.title"));
    due = new QLineEdit; due->setPlaceholderText(t("cal.u.due"));
    prio = new QComboBox;
    for (const char* k : {"low", "normal", "high"}) prio->addItem(k, k);
    prio->setCurrentIndex(1);
    bar->addWidget(title); bar->addWidget(due); bar->addWidget(prio);
    bar->addWidget(Ui::button(t("cal.u.add"), [this] { add(); }, "primary"));
    lay->addLayout(bar);
    err = Ui::label("", "error");
    lay->addWidget(err);
    table = Ui::table({t("cal.u.title"), t("cal.u.due"), t("cal.u.priority"), t("cal.u.done")});
    lay->addWidget(table, 1);
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button(t("cal.u.toggle"), [this] {
        QJsonObject x; if (!Ui::selected(table, x)) return;
        Api::I().call("POST", "/calendar/events/" + x["id"].toString() + "/done", QJsonObject(), this, [this](const QJsonValue&) { reload(); }, [this](const QString& m) { err->setText(m); });
    }, "ghost"));
    row->addWidget(Ui::button(t("cal.u.delete"), [this] {
        QJsonObject x; if (!Ui::selected(table, x)) return;
        Api::I().call("DELETE", "/calendar/events/" + x["id"].toString(), QJsonValue(), this, [this](const QJsonValue&) { reload(); }, [this](const QString& m) { err->setText(m); });
    }, "ghost"));
    row->addStretch(1);
    lay->addLayout(row);
}

void CalTodos::reload() {
    Api::I().call("GET", "/calendar/todos", QJsonValue(), this, [this](const QJsonValue& v) { paint(v.toArray()); }, [this](const QString& m) { err->setText(m); });
}

void CalTodos::paint(const QJsonArray& a) {
    items = a;
    QList<QStringList> rows; QList<QJsonObject> pay;
    for (const QJsonValue& v : a) {
        const QJsonObject x = v.toObject();
        rows << QStringList{x["title"].toString(), x["start"].isNull() ? "" : Cal::fmtLocal(x["start"].toString()), x["data"].toObject()["priority"].toString(), x["status"].toString() == "Done" ? "✓" : ""};
        pay << x;
    }
    Ui::fill(table, rows, pay);
}

void CalTodos::add() {
    QString e;
    const QJsonObject body = Cal::eventPayload(QJsonObject{{"kind", "todo"}, {"title", title->text()}, {"start", due->text()}, {"priority", prio->currentData().toString()}, {"remind", ""}}, e);
    if (!e.isEmpty()) { err->setText(e); return; }
    title->clear(); due->clear();
    Api::I().call("POST", "/calendar/events", body, this, [this](const QJsonValue&) { reload(); }, [this](const QString& m) { err->setText(m); });
}

// ---------------------------------------------------------------- settings + page
CalSettings::CalSettings() {
    auto* lay = new QVBoxLayout(this);
    auto* form = new QFormLayout;
    jitsi = new QLineEdit; ws = new QLineEdit; we = new QLineEdit;
    form->addRow(t("cal.u.jitsi"), jitsi); form->addRow(t("cal.u.ws"), ws); form->addRow(t("cal.u.we"), we);
    lay->addLayout(form);
    msg = Ui::label("", "dim");
    lay->addWidget(Ui::button(t("cal.u.save"), [this] { save(); }, "primary"));
    lay->addWidget(msg);
    lay->addStretch(1);
}

void CalSettings::reload() {
    Api::I().call("GET", "/calendar/settings", QJsonValue(), this, [this](const QJsonValue& v) {
        const QJsonObject s = v.toObject();
        jitsi->setText(s["jitsiDomain"].toString()); ws->setText(s["workStart"].toString()); we->setText(s["workEnd"].toString());
    }, [this](const QString& m) { msg->setText(m); });
}

void CalSettings::save() {
    Api::I().call("PUT", "/calendar/settings", QJsonObject{{"jitsiDomain", jitsi->text().trimmed()}, {"workStart", ws->text().trimmed()}, {"workEnd", we->text().trimmed()}}, this,
                  [this](const QJsonValue&) { msg->setText(t("cal.u.saved")); }, [this](const QString& m) { msg->setText(m); });
}

CalendarPage::CalendarPage() {
    lay->addWidget(Ui::label(t("tab.cal"), "title"));
    tabs = new QTabWidget;
    agenda = new CalAgenda; todos = new CalTodos;
    views << agenda << todos;
    tabs->addTab(agenda, t("cal.u.agenda")); tabs->addTab(todos, t("cal.u.todos"));
    if (Api::I().can("cal.settings")) { settings = new CalSettings; views << settings; tabs->addTab(settings, t("cal.u.settings")); }
    connect(tabs, &QTabWidget::currentChanged, this, [this](int) { reload(); });
    lay->addWidget(tabs, 1);
}

void CalendarPage::reload() {
    QWidget* w = views[tabs->currentIndex()];
    if (auto* a = qobject_cast<CalAgenda*>(w)) a->reload();
    else if (auto* t2 = qobject_cast<CalTodos*>(w)) t2->reload();
    else if (auto* s = qobject_cast<CalSettings*>(w)) s->reload();
}
