#include <QCheckBox>
#include <QComboBox>
#include <QSignalBlocker>
#include "Forms.h"
#include "Pages.h"

#include <QComboBox>
#include <QFrame>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QSplitter>

#include "Api.h"
#include "I18n.h"
#include "RecordDialog.h"
#include "ReportDialog.h"
#include "Ui.h"

using I18n::t;
using I18n::t1;

Page::Page(QWidget* parent) : QWidget(parent) {
    lay = new QVBoxLayout(this);
    lay->setContentsMargins(20, 16, 20, 16);
}

static QString s(const QJsonValue& v) { return v.isString() ? v.toString() : v.isNull() || v.isUndefined() ? QString() : v.toVariant().toString(); }

// ----------------------------------------------------------------------------- home
namespace {
class Card : public QFrame {
public:
    Card(const QString& small, std::function<void()> click, QLabel*& bigOut) : click_(std::move(click)) {
        setProperty("card", true);
        setCursor(Qt::PointingHandCursor);
        auto* l = new QVBoxLayout(this);
        auto* big = new QLabel("–");
        big->setStyleSheet("font-size: 30px; font-weight: 700; color: #2563eb; border: none;");
        auto* sm = new QLabel(small);
        sm->setStyleSheet("color: #64748b; border: none;");
        sm->setWordWrap(true);
        l->addWidget(big);
        l->addWidget(sm);
        bigOut = big;
    }
protected:
    void mousePressEvent(QMouseEvent*) override { click_(); }
private:
    std::function<void()> click_;
};
}

HomePage::HomePage(std::function<void(int)> goPage, std::function<void(const QString&, const QString&)> openKind) {
    hello = Ui::label({}, "title");
    lay->addWidget(hello);
    auto* row = new QHBoxLayout;
    row->addWidget(new Card(t("home.pendingTasks"), [goPage] { goPage(1); }, tasks));
    row->addWidget(new Card(t("home.pendingApprovals"), [goPage] { goPage(1); }, appr));
    row->addWidget(new Card(t("home.myDocs"), [goPage] { goPage(2); }, docs));
    lay->addLayout(row);
    lay->addSpacing(10);
    lay->addWidget(Ui::label(t("home.modules"), "title"));
    auto* grid = new QGridLayout;
    int i = 0;
    for (const QJsonValue& mv : I18n::visibleModules()) {
        const QJsonObject m = mv.toObject();
        const QString id = m.value("id").toString();
        grid->addWidget(Ui::button(I18n::name(m), [openKind, id] { openKind(id, QString()); }, "ghost"), i / 4, i % 4);
        ++i;
    }
    lay->addLayout(grid);
    lay->addStretch();
}

void HomePage::reload() {
    hello->setText(t1("home.hello", "name", Api::I().displayName));
    // the three counts are independent calls
    Api::I().tasks(this, [this](const QJsonValue& v) { tasks->setText(QString::number(v.toArray().size())); }, [this](const QString&) { tasks->setText("0"); });
    Api::I().instances(this, [this](const QJsonValue& v) { docs->setText(QString::number(v.toArray().size())); }, [this](const QString&) { docs->setText("0"); });
    if (Api::I().can("gov.view"))
        Api::I().records("gov", "approval", this, [this](const QJsonValue& v) {
            int n = 0;
            for (const QJsonValue& a : v.toArray()) {
                const QJsonObject o = a.toObject();
                if (o.value("status").toString() == "Pending" && o.value("data").toObject().value("canAct").toBool()) ++n;
            }
            appr->setText(QString::number(n));
        }, [this](const QString&) { appr->setText("0"); });
    else appr->setText("0");
}

// ----------------------------------------------------------------------------- approvals
namespace {
class ApprovalDialog : public QDialog {
public:
    ApprovalDialog(QWidget* parent, const QJsonObject& item, bool isTask) : QDialog(parent), item_(item), isTask_(isTask) {
        const QJsonObject d = item.value("data").toObject();
        const QString title = isTask ? item.value("nodeName").toString() : (s(d.value("target")) + " " + (d.contains("code") ? s(d.value("code")) : s(item.value("code"))));
        setWindowTitle(title);
        setMinimumWidth(440);
        auto* lay = new QVBoxLayout(this);
        lay->addWidget(Ui::label(title, "title"));
        bool can = true;
        if (!isTask) {
            lay->addWidget(Ui::label(t("appr.amount") + ": " + (d.contains("amount") ? s(d.value("amount")) : "-")));
            lay->addWidget(Ui::label(t("appr.requestedBy") + ": " + (d.contains("requestedBy") ? s(d.value("requestedBy")) : s(item.value("createdBy")))));
            can = !(d.contains("canAct") && !d.value("canAct").toBool());
            if (!can) lay->addWidget(Ui::label(t("appr.cantAct"), "error"));
        }
        const QJsonObject frm = item.value("form").toObject();
        if (isTask && !frm.value("fields").toArray().isEmpty()) {
            setMinimumWidth(480);
            if (!frm.value("title").toString().isEmpty()) lay->addWidget(Ui::label(frm.value("title").toString(), "dim"));
            form = new TypedForm(frm);
            lay->addWidget(form);
            // pre-fill the step's form from the data already collected on this document
            Api::I().instance(item.value("instanceId").toString(), this,
                              [this](const QJsonValue& v) { form->setValues(v.toObject().value("data").toObject()); }, [](const QString&) {});
        }
        comment = new QTextEdit;
        comment->setPlaceholderText(t("appr.comment"));
        comment->setFixedHeight(80);
        lay->addWidget(comment);
        err = Ui::label({}, "error");
        lay->addWidget(err);
        auto* row = new QHBoxLayout;
        if (isTask) {
            for (const QJsonValue& dv : item.value("availableDecisions").toArray()) {
                const QString dec = dv.toString();
                const bool bad = QRegularExpression("reject|deny|decline", QRegularExpression::CaseInsensitiveOption).match(dec).hasMatch();
                auto* b = Ui::button(dec, [this, dec] { act(dec); }, bad ? "danger" : QString());
                btns << b;
                row->addWidget(b);
            }
        } else {
            auto* a = Ui::button(t("appr.approve"), [this] { act("approve"); });
            auto* r = Ui::button(t("appr.reject"), [this] { act("reject"); }, "danger");
            a->setEnabled(can);
            r->setEnabled(can);
            btns << a << r;
            row->addWidget(a);
            row->addWidget(r);
        }
        row->addWidget(Ui::button(t("common.cancel"), [this] { reject(); }, "ghost"));
        lay->addLayout(row);
    }
    void act(const QString& decision) {
        err->clear();
        QJsonObject fd;
        if (form) {
            if (!Forms::isNegative(decision) && !form->missing().isEmpty()) { err->setText(t("tasks.missing")); return; }
            fd = form->values();
        }
        for (auto* b : btns) b->setEnabled(false);
        auto ok = [this](const QJsonValue&) { accept(); };
        auto bad = [this](const QString& m) { err->setText(m); for (auto* b : btns) b->setEnabled(true); };
        if (isTask_) Api::I().completeTask(item_.value("id").toString(), decision, comment->toPlainText(), this, ok, bad, fd);
        else Api::I().approvalAct(item_.value("id").toString(), decision == "reject" ? "reject" : "approve", comment->toPlainText(), this, ok, bad);
    }
private:
    QJsonObject item_;
    bool isTask_;
    QTextEdit* comment;
    TypedForm* form = nullptr;
    QLabel* err;
    QList<QPushButton*> btns;
};
}

ApprovalsPage::ApprovalsPage() {
    lay->addWidget(Ui::label(t("tab.approvals"), "title"));
    auto* bar = new QHBoxLayout;
    bar->addStretch();
    bar->addWidget(Ui::button(t("common.refresh"), [this] { reload(); }, "ghost"));
    lay->addLayout(bar);
    table = Ui::table({t("appr.type"), t("appr.target"), t("appr.requestedBy"), t("erp.status")});
    connect(table, &QTableWidget::cellDoubleClicked, this, [this] { open(); });
    lay->addWidget(table);
    empty = Ui::label(t("appr.none"), "dim");
    lay->addWidget(empty);
}

void ApprovalsPage::reload() {
    struct State { QJsonArray tasks, appr; int pending = 2; };
    auto st = std::make_shared<State>();
    auto finish = [this, st] {
        if (--st->pending > 0) return;
        QList<QStringList> rows;
        QList<QJsonObject> pay;
        for (const QJsonValue& v : st->tasks) {
            QJsonObject o = v.toObject();
            o["__kind"] = "wf";
            rows << QStringList{t("appr.workflow"), s(o.value("nodeName")), o.contains("priority") ? s(o.value("priority")) : "Normal", "Pending"};
            pay << o;
        }
        for (const QJsonValue& v : st->appr) {
            QJsonObject o = v.toObject();
            if (o.value("status").toString() != "Pending") continue;
            o["__kind"] = "erp";
            const QJsonObject d = o.value("data").toObject();
            rows << QStringList{t("appr.erp"), s(d.value("target")) + " " + (d.contains("code") ? s(d.value("code")) : s(o.value("code"))),
                                d.contains("requestedBy") ? s(d.value("requestedBy")) : s(o.value("createdBy")), s(o.value("status"))};
            pay << o;
        }
        Ui::fill(table, rows, pay);
        empty->setVisible(rows.isEmpty());
    };
    Api::I().tasks(this, [st, finish](const QJsonValue& v) { st->tasks = v.toArray(); finish(); }, [this, finish](const QString& m) { Ui::warn(this, m); finish(); });
    if (Api::I().can("gov.view"))
        Api::I().records("gov", "approval", this, [st, finish](const QJsonValue& v) { st->appr = v.toArray(); finish(); }, [finish](const QString&) { finish(); });
    else finish();
}

void ApprovalsPage::open() {
    QJsonObject o;
    if (!Ui::selected(table, o)) return;
    ApprovalDialog dlg(this, o, o.value("__kind").toString() == "wf");
    if (dlg.exec()) reload();
}

// ----------------------------------------------------------------------------- documents
namespace {
class InstanceDialog : public QDialog {
public:
    InstanceDialog(QWidget* parent, const QJsonObject& inst) : QDialog(parent), inst_(inst) {
        setWindowTitle(s(inst.value("definitionName")));
        resize(560, 440);
        auto* lay = new QVBoxLayout(this);
        lay->addWidget(Ui::label(s(inst.value("definitionName")), "title"));
        lay->addWidget(Ui::label(t("docs.status") + ": " + s(inst.value("status"))));
        lay->addWidget(Ui::label(t("docs.history"), "title"));
        auto* tb = Ui::table({t("erp.name"), t("docs.status"), t("appr.requestedBy"), t("appr.comment")});
        QList<QStringList> rows;
        QList<QJsonObject> pay;
        for (const QJsonValue& hv : inst.value("history").toArray()) {
            const QJsonObject h = hv.toObject();
            rows << QStringList{s(h.value("nodeName")), s(h.value("action")), s(h.value("actor")), s(h.value("comment"))};
            pay << h;
        }
        Ui::fill(tb, rows, pay);
        lay->addWidget(tb);
        auto* row = new QHBoxLayout;
        if (s(inst.value("status")) == "Running")
            row->addWidget(Ui::button(t("docs.cancel"), [this] {
                if (!Ui::ask(this, t("docs.cancel") + "?", t("common.yes"), t("common.no"))) return;
                Api::I().cancelInstance(inst_.value("id").toString(), this, [this](const QJsonValue&) { accept(); }, [this](const QString& m) { Ui::warn(this, m); });
            }, "danger"));
        row->addStretch();
        row->addWidget(Ui::button(t("common.close"), [this] { reject(); }, "ghost"));
        lay->addLayout(row);
    }
private:
    QJsonObject inst_;
};

class NewRequestDialog : public QDialog {
public:
    NewRequestDialog(QWidget* parent, const QJsonArray& defs) : QDialog(parent) {
        setWindowTitle(t("docs.choose"));
        setMinimumWidth(420);
        auto* lay = new QVBoxLayout(this);
        lay->addWidget(Ui::label(t("docs.choose"), "title"));
        combo = new QComboBox;
        for (const QJsonValue& d : defs) combo->addItem(d.toObject().value("name").toString(), d.toObject().value("id").toString());
        lay->addWidget(combo);
        note = new QTextEdit;
        note->setPlaceholderText(t("appr.comment"));
        note->setFixedHeight(80);
        lay->addWidget(note);
        err = Ui::label({}, "error");
        lay->addWidget(err);
        auto* row = new QHBoxLayout;
        go = Ui::button(t("docs.start"), [this] {
            QJsonObject data;
            if (!note->toPlainText().trimmed().isEmpty()) data["note"] = note->toPlainText().trimmed();
            go->setEnabled(false);
            Api::I().startInstance(combo->currentData().toString(), data, this, [this](const QJsonValue& inst) {
                // a flow that begins with a form step asks for it right away, like the portal's Submit screen
                const QString iid = inst.toObject().value("id").toString();
                Api::I().tasks(this, [this, iid](const QJsonValue& tv) {
                    for (const QJsonValue& x : tv.toArray()) {
                        const QJsonObject tk = x.toObject();
                        if (tk.value("instanceId").toString() == iid && !tk.value("form").toObject().value("fields").toArray().isEmpty()) { followUp = tk; break; }
                    }
                    accept();
                }, [this](const QString&) { accept(); });
            }, [this](const QString& m) { err->setText(m); go->setEnabled(true); });
        });
        go->setEnabled(combo->count() > 0);
        row->addWidget(go);
        row->addWidget(Ui::button(t("common.cancel"), [this] { reject(); }, "ghost"));
        lay->addLayout(row);
    }
    QJsonObject followUp;
private:
    QComboBox* combo;
    QTextEdit* note;
    QLabel* err;
    QPushButton* go;
};
}

DocumentsPage::DocumentsPage() {
    lay->addWidget(Ui::label(t("docs.title"), "title"));
    auto* bar = new QHBoxLayout;
    bar->addWidget(Ui::button("+ " + t("docs.new"), [this] { create(); }));
    bar->addStretch();
    bar->addWidget(Ui::button(t("common.refresh"), [this] { reload(); }, "ghost"));
    lay->addLayout(bar);
    table = Ui::table({t("erp.name"), t("docs.status"), t("docs.when")});
    connect(table, &QTableWidget::cellDoubleClicked, this, [this] { open(); });
    lay->addWidget(table);
    empty = Ui::label(t("docs.none"), "dim");
    lay->addWidget(empty);
}

void DocumentsPage::reload() {
    Api::I().instances(this, [this](const QJsonValue& v) {
        QList<QStringList> rows;
        QList<QJsonObject> pay;
        for (const QJsonValue& iv : v.toArray()) {
            const QJsonObject i = iv.toObject();
            rows << QStringList{s(i.value("definitionName")), s(i.value("status")), s(i.value("startedAt")).left(16).replace('T', ' ')};
            pay << i;
        }
        Ui::fill(table, rows, pay);
        empty->setVisible(rows.isEmpty());
    }, [this](const QString& m) { Ui::warn(this, m); });
}

void DocumentsPage::create() {
    Api::I().definitions(this, [this](const QJsonValue& v) {
        NewRequestDialog dlg(this, v.toArray());
        if (dlg.exec()) {
            if (!dlg.followUp.isEmpty()) { ApprovalDialog f(this, dlg.followUp, true); f.exec(); }
            reload();
        }
    }, [this](const QString& m) { Ui::warn(this, m); });
}

void DocumentsPage::open() {
    QJsonObject sel;
    if (!Ui::selected(table, sel)) return;
    Api::I().instance(sel.value("id").toString(), this, [this, sel](const QJsonValue& v) {
        InstanceDialog dlg(this, v.isObject() ? v.toObject() : sel);
        if (dlg.exec()) reload();
    }, [this](const QString& m) { Ui::warn(this, m); });
}

// ----------------------------------------------------------------------------- ERP
ErpPage::ErpPage() {
    auto* split = new QSplitter;
    tree = new QTreeWidget;
    tree->setHeaderHidden(true);
    tree->setMaximumWidth(240);
    for (const QJsonValue& mv : I18n::visibleModules()) {
        const QJsonObject m = mv.toObject();
        auto* top = new QTreeWidgetItem(QStringList{I18n::name(m)});
        top->setData(0, Qt::UserRole, QVariant::fromValue(QJsonObject{{"module", m}}));
        for (const QJsonValue& kv : m.value("kinds").toArray()) {
            const QJsonObject k = kv.toObject();
            if (!Api::I().can(k.value("view").toString())) continue;
            auto* ch = new QTreeWidgetItem(QStringList{I18n::name(k)});
            ch->setData(0, Qt::UserRole, QVariant::fromValue(QJsonObject{{"module", m}, {"kind", k}}));
            top->addChild(ch);
        }
        tree->addTopLevelItem(top);
    }
    connect(tree, &QTreeWidget::itemClicked, this, [this](QTreeWidgetItem* it) { picked(it); });
    split->addWidget(tree);
    auto* right = new QWidget;
    auto* rl = new QVBoxLayout(right);
    rl->setContentsMargins(12, 0, 0, 0);
    head = Ui::label(t("erp.title"), "title");
    rl->addWidget(head);
    auto* bar = new QHBoxLayout;
    search = new QLineEdit;
    search->setPlaceholderText(t("erp.search"));
    connect(search, &QLineEdit::textChanged, this, [this] { refill(); });
    bar->addWidget(search);
    status = new QComboBox;
    status->addItem(t("collab.allStatus"), QString());
    connect(status, &QComboBox::currentIndexChanged, this, [this] { refill(); });
    bar->addWidget(status);
    // saved filters (same store as the portal: search text + status, optionally shared with the workspace)
    saved = new QComboBox;
    saved->setMinimumWidth(150);
    connect(saved, &QComboBox::activated, this, [this](int i) { applySaved(i); });
    bar->addWidget(saved);
    bar->addWidget(Ui::button(QString::fromUtf8("🔖"), [this] { saveFilter(); }, "ghost"));
    btnDelF = Ui::button(QString::fromUtf8("🗑"), [this] { deleteFilter(); }, "ghost");
    btnDelF->setEnabled(false);
    bar->addWidget(btnDelF);
    btnNew = Ui::button("+ " + t("erp.new"), [this] { create(); });
    btnNew->setEnabled(false);
    bar->addWidget(btnNew);
    bar->addWidget(Ui::button(QString::fromUtf8("🖨"), [this] { printReport(); }, "ghost"));
    bar->addWidget(Ui::button(t("common.refresh"), [this] { load(); }, "ghost"));
    rl->addLayout(bar);
    table = Ui::table({t("erp.code"), t("erp.name"), t("erp.status"), t("erp.company")});
    connect(table, &QTableWidget::cellDoubleClicked, this, [this] { edit(); });
    rl->addWidget(table);
    msg = Ui::label(I18n::visibleModules().isEmpty() ? t("erp.noModules") : QString(), "dim");
    rl->addWidget(msg);
    split->addWidget(right);
    split->setStretchFactor(1, 1);
    lay->addWidget(split);
}

void ErpPage::select(const QString& moduleId, const QString& kindId) {
    for (int i = 0; i < tree->topLevelItemCount(); ++i) {
        QTreeWidgetItem* top = tree->topLevelItem(i);
        if (top->data(0, Qt::UserRole).toJsonObject().value("module").toObject().value("id").toString() != moduleId) continue;
        top->setExpanded(true);
        QTreeWidgetItem* target = top;
        for (int j = 0; j < top->childCount(); ++j) {
            const QString kid = top->child(j)->data(0, Qt::UserRole).toJsonObject().value("kind").toObject().value("kind").toString();
            if (kindId.isEmpty() || kid == kindId) { target = top->child(j); break; }
        }
        tree->setCurrentItem(target);
        picked(target);
        return;
    }
}

void ErpPage::picked(QTreeWidgetItem* item) {
    const QJsonObject o = item->data(0, Qt::UserRole).toJsonObject();
    if (!o.contains("kind")) {
        item->setExpanded(true);
        if (item->childCount() > 0) picked(item->child(0));
        return;
    }
    module = o.value("module").toObject();
    kind = o.value("kind").toObject();
    hasKind = true;
    head->setText(I18n::name(module) + " › " + I18n::name(kind));
    btnNew->setEnabled(Api::I().can(kind.value("manage").toString()) && !kind.value("readOnly").toBool());
    { QSignalBlocker b1(search), b2(status); search->clear(); status->setCurrentIndex(0); }
    loadFilters();
    load();
}

void ErpPage::load() {
    if (!hasKind) return;
    const QString m = module.value("id").toString(), k = kind.value("kind").toString();
    msg->setText(t("common.loading"));
    Api::I().records(m, k, this, [this, m, k](const QJsonValue& v) {
        if (m != module.value("id").toString() || k != kind.value("kind").toString()) return;
        rows = v.toArray();
        refill();
    }, [this](const QString& e) { msg->setText(e); });
}

QString ErpPage::viewKey() const { return module.value("id").toString() + ":" + kind.value("kind").toString(); }

void ErpPage::loadFilters() {
    const QString key = viewKey();
    Api::I().filters(key, this, [this, key](const QJsonValue& v) {
        if (key != viewKey()) return;
        saved->clear();
        saved->addItem(t("collab.savedFilters"), QVariant());
        for (const QJsonValue& x : v.toArray()) {
            const QJsonObject c = x.toObject();
            saved->addItem((c.value("shared").toBool() && !c.value("mine").toBool() ? QString::fromUtf8("👥 ") : QString()) + c.value("name").toString(), QVariant::fromValue(c));
        }
        btnDelF->setEnabled(false);
    }, [](const QString&) {});
}

void ErpPage::applySaved(int i) {
    const QJsonObject c = saved->itemData(i).toJsonObject();
    const QJsonObject d = c.value("data").toObject();
    {
        QSignalBlocker b1(search), b2(status);
        search->setText(d.value("q").toString());
        status->setCurrentIndex(qMax(0, status->findData(d.value("status").toString())));
    }
    btnDelF->setEnabled(c.value("mine").toBool());
    refill();
}

void ErpPage::saveFilter() {
    if (!hasKind) return;
    QDialog dlg(this);
    dlg.setWindowTitle(t("collab.saveFilter"));
    auto* l = new QVBoxLayout(&dlg);
    auto* nm = new QLineEdit;
    nm->setPlaceholderText(t("collab.filterName"));
    auto* share = new QCheckBox(t("collab.shareWorkspace"));
    l->addWidget(nm);
    l->addWidget(share);
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button(t("admin.save"), [&dlg] { dlg.accept(); }));
    row->addWidget(Ui::button(t("common.cancel"), [&dlg] { dlg.reject(); }, "ghost"));
    l->addLayout(row);
    if (!dlg.exec() || nm->text().trimmed().isEmpty()) return;
    const QJsonObject data{{"q", search->text().trimmed()}, {"status", status->currentData().toString()}};
    Api::I().saveFilter(viewKey(), nm->text().trimmed(), share->isChecked(), data, this, [this](const QJsonValue&) { loadFilters(); }, [this](const QString& e) { msg->setText(e); });
}

void ErpPage::deleteFilter() {
    const QJsonObject c = saved->currentData().toJsonObject();
    if (!c.value("mine").toBool()) return;
    Api::I().deleteFilter(c.value("id").toString(), this, [this](const QJsonValue&) { loadFilters(); }, [this](const QString& e) { msg->setText(e); });
}

void ErpPage::refill() {
    {   // the status list follows the statuses present in the loaded rows
        const QString cur = status->currentData().toString();
        QStringList have;
        for (const QJsonValue& rv : rows) { const QString st = rv.toObject().value("status").toString(); if (!st.isEmpty() && !have.contains(st)) have << st; }
        have.sort();
        QStringList now;
        for (int i = 1; i < status->count(); ++i) now << status->itemData(i).toString();
        if (now != have) {
            QSignalBlocker b(status);
            status->clear();
            status->addItem(t("collab.allStatus"), QString());
            for (const QString& v : have) status->addItem(v, v);
            status->setCurrentIndex(qMax(0, status->findData(cur)));
        }
    }
    const QString curSt = status->currentData().toString();
    const QString q = search->text().trimmed().toLower();
    QList<QStringList> out;
    QList<QJsonObject> pay;
    for (const QJsonValue& rv : rows) {
        const QJsonObject r = rv.toObject();
        const QJsonObject d = r.value("data").toObject();
        const QString hay = (s(r.value("code")) + " " + s(r.value("status")) + " " + s(r.value("ref")) + " " + QString::fromUtf8(QJsonDocument(d).toJson(QJsonDocument::Compact))).toLower();
        if (!q.isEmpty() && !hay.contains(q)) continue;
        if (!curSt.isEmpty() && s(r.value("status")) != curSt) continue;
        QString nm = s(d.value("name"));
        if (nm.isEmpty()) nm = s(d.value("title"));
        if (nm.isEmpty()) nm = s(d.value("description"));
        if (nm.isEmpty()) nm = s(r.value("ref"));
        out << QStringList{s(r.value("code")), nm, s(r.value("status")), s(r.value("company"))};
        pay << r;
    }
    Ui::fill(table, out, pay);
    shownRows = out;
    msg->setText(out.isEmpty() ? t("erp.none") : QString());
}

void ErpPage::printReport() {
    if (!hasKind) return;
    static const char* keys[] = {"code", "name", "status", "company"};
    static const char* labs[] = {"erp.code", "erp.name", "erp.status", "erp.company"};
    QList<ReportColumn> cols;
    for (int i = 0; i < 4; ++i) cols << ReportColumn{keys[i], t(labs[i]), false};
    QList<ReportRow> rws;
    for (const QStringList& r : shownRows) { ReportRow row; for (int i = 0; i < 4; ++i) row[keys[i]] = r.value(i); rws << row; }
    ReportDialog(this, viewKey(), I18n::name(kind), cols, rws, Api::I().displayName).exec();
}

void ErpPage::create() {
    if (!hasKind) return;
    RecordDialog dlg(this, module, kind, QJsonObject(), true);
    if (dlg.exec()) load();
}

void ErpPage::edit() {
    QJsonObject r;
    if (!hasKind || !Ui::selected(table, r)) return;
    RecordDialog dlg(this, module, kind, r, false);
    if (dlg.exec()) load();
}

void ErpPage::reload() { if (hasKind) load(); }

// ----------------------------------------------------------------------------- settings
SettingsPage::SettingsPage(std::function<void(const QString&)> setLang, std::function<void()> signOut) {
    lay->addWidget(Ui::label(t("tab.more"), "title"));
    Api& a = Api::I();
    lay->addWidget(Ui::label(t("more.signedInAs"), "dim"));
    lay->addWidget(Ui::label(a.displayName + "  (" + a.username + " · " + a.role + ")", "title"));
    if (!a.tenant.isEmpty()) lay->addWidget(Ui::label(t("more.workspace") + ": " + a.tenant));
    lay->addWidget(Ui::label(t("more.server") + ": " + a.server, "dim"));
    lay->addSpacing(12);
    lay->addWidget(Ui::label(t("more.language"), "dim"));
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button("English", [setLang] { setLang("en"); }, I18n::lang() == "en" ? QString() : "ghost"));
    row->addWidget(Ui::button(QString::fromUtf8("العربية"), [setLang] { setLang("ar"); }, I18n::lang() == "ar" ? QString() : "ghost"));
    row->addStretch();
    lay->addLayout(row);
    lay->addSpacing(12);
    auto* row2 = new QHBoxLayout;
    row2->addWidget(Ui::button(t("more.signout"), signOut, "danger"));
    row2->addStretch();
    lay->addLayout(row2);
    lay->addStretch();
}
