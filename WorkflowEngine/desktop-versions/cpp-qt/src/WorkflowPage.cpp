#include "WorkflowPage.h"

#include <QCheckBox>
#include <QComboBox>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QGraphicsSceneMouseEvent>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QFile>
#include <QJsonDocument>
#include <QPainter>
#include <QPainterPathStroker>
#include <QPlainTextEdit>
#include <QSpinBox>
#include <QSplitter>
#include <QTimer>
#include <QToolBox>
#include <QUuid>
#include <QWheelEvent>
#include <cmath>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;
using I18n::t1;

namespace Wf {
namespace {
QJsonObject g_spec;
QHash<QString, QJsonObject> g_types;
void loadSpec() {
    if (!g_spec.isEmpty()) return;
    QFile f(":/workflow.json");
    f.open(QIODevice::ReadOnly);
    g_spec = QJsonDocument::fromJson(f.readAll()).object();
    for (const QJsonValue& v : g_spec.value("nodes").toArray()) g_types.insert(v.toObject().value("type").toString(), v.toObject());
}
QString short_(const QString& s, int n) { return s.size() <= n ? s : s.left(n - 1) + "…"; }
QString str(const QJsonValue& v) { return v.isString() ? v.toString() : v.isNull() || v.isUndefined() ? QString() : v.toVariant().toString(); }
}

QJsonObject spec() { loadSpec(); return g_spec; }
QJsonObject typeSpec(const QString& type) { loadSpec(); return g_types.value(type); }
QString shapeOf(const QString& type) { const QString s = typeSpec(type).value("shape").toString(); return s.isEmpty() ? "rect" : s; }
QSize sizeOf(const QString& type) {
    const QJsonArray a = spec().value("nodeSize").toObject().value(shapeOf(type)).toArray();
    return QSize(a.at(0).toInt(), a.at(1).toInt());
}
QString newId() { return QUuid::createUuid().toString(QUuid::WithoutBraces); }

QJsonObject newNode(const QString& type, int x, int y) {
    const QJsonObject sp = typeSpec(type);
    QJsonObject n{{"id", newId()}, {"type", type}, {"name", sp.value("label").toString()}, {"x", x}, {"y", y}};
    if (type == "FormTask" || type == "ApprovalTask") {
        n["assignee"] = "";
        n["priority"] = "Normal";
        n["escalationMode"] = "Reassign";
        n["form"] = QJsonObject{{"id", newId()}, {"title", sp.value("label").toString()}, {"fields", QJsonArray()}};
    }
    if (type == "Timer") n["durationSeconds"] = 60;
    if (type == "WebhookCall") n["webhookMethod"] = "POST";
    if (type == "FileOperations") n["fileOperation"] = "Read";
    if (type == "InvokeSoapService")
        n["soapEnvelope"] = "<?xml version=\"1.0\"?>\n<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\">\n  <soap:Body>\n\n  </soap:Body>\n</soap:Envelope>";
    return n;
}

void Model::fromJson(const QJsonObject& d) {
    meta = d;
    meta.remove("nodes");
    meta.remove("edges");
    nodes.clear();
    edges.clear();
    for (const QJsonValue& v : d.value("nodes").toArray()) nodes << v.toObject();
    for (const QJsonValue& v : d.value("edges").toArray()) edges << v.toObject();
}
QJsonObject Model::body() const {
    QJsonArray n, e;
    for (const QJsonObject& o : nodes) n << o;
    for (const QJsonObject& o : edges) e << o;
    return QJsonObject{{"name", meta.value("name")}, {"description", str(meta.value("description"))}, {"nodes", n}, {"edges", e}};
}
int Model::nodeIdx(const QString& id) const { for (int i = 0; i < nodes.size(); ++i) if (nodes[i].value("id").toString() == id) return i; return -1; }
int Model::edgeIdx(const QString& id) const { for (int i = 0; i < edges.size(); ++i) if (edges[i].value("id").toString() == id) return i; return -1; }

// ------------------------------------------------------------------------------------------ items
NodeItem::NodeItem(Canvas* c, const QString& nid) : id(nid), c_(c) {
    const QJsonObject n = c->m->nodes[c->m->nodeIdx(nid)];
    setPos(n.value("x").toDouble(), n.value("y").toDouble());
    setZValue(2);
    if (c->editable) {
        setFlag(ItemIsMovable, true);
        setFlag(ItemSendsGeometryChanges, true);
    }
    setFlag(ItemIsSelectable, true);
}
QRectF NodeItem::boundingRect() const {
    const int i = c_->m->nodeIdx(id);
    const QSize z = sizeOf(c_->m->nodes[i].value("type").toString());
    return QRectF(-6, -6, z.width() + 12, z.height() + 12);
}
void NodeItem::paint(QPainter* p, const QStyleOptionGraphicsItem*, QWidget*) {
    const int i = c_->m->nodeIdx(id);
    if (i < 0) return;
    const QJsonObject n = c_->m->nodes[i];
    const QString type = n.value("type").toString(), sh = shapeOf(type);
    const QSize z = sizeOf(type);
    p->setRenderHint(QPainter::Antialiasing);
    QColor pen(typeSpec(type).value("color").toString()), fill("#ffffff");
    int w = 2;
    if (state == "active") { fill = "#dcfce7"; pen = "#16a34a"; w = 4; }
    else if (state == "visited") { fill = "#f0fdf4"; pen = "#16a34a"; }
    else if (state == "rejected") { fill = "#fee2e2"; pen = "#dc2626"; }
    else if (state == "pending") p->setOpacity(0.5);
    if (isSelected() || c_->linkFrom == id) { pen = "#2563eb"; w = 4; }
    QPen pp(pen, w);
    if (c_->linkFrom == id) pp.setStyle(Qt::DashLine);
    p->setPen(pp);
    p->setBrush(fill);
    if (sh == "circle") p->drawEllipse(QRectF(0, 0, z.width(), z.height()));
    else if (sh == "diamond") {
        QPolygonF poly;
        poly << QPointF(z.width() / 2.0, 0) << QPointF(z.width(), z.height() / 2.0) << QPointF(z.width() / 2.0, z.height()) << QPointF(0, z.height() / 2.0);
        p->drawPolygon(poly);
    } else p->drawRoundedRect(QRectF(0, 0, z.width(), z.height()), 10, 10);
    p->setPen(QColor("#0f172a"));
    QFont f = p->font();
    f.setPointSize(13);
    p->setFont(f);
    const QString icon = typeSpec(type).value("icon").toString();
    if (sh == "circle") p->drawText(QRectF(0, 0, z.width(), z.height()), Qt::AlignCenter, icon);
    else {
        p->drawText(QRectF(0, sh == "rect" ? 4 : 12, z.width(), 22), Qt::AlignCenter, icon);
        f.setPointSize(9);
        f.setBold(true);
        p->setFont(f);
        p->drawText(QRectF(8, sh == "rect" ? 30 : 38, z.width() - 16, 24), Qt::AlignCenter, short_(n.value("name").toString(), 22));
    }
}
QVariant NodeItem::itemChange(GraphicsItemChange change, const QVariant& value) {
    if (change == ItemPositionHasChanged && c_->editable) {
        const int i = c_->m->nodeIdx(id);
        if (i >= 0) {
            c_->m->nodes[i]["x"] = qRound(value.toPointF().x());
            c_->m->nodes[i]["y"] = qRound(value.toPointF().y());
            c_->refreshEdges();
            c_->changed();
        }
    }
    return QGraphicsItem::itemChange(change, value);
}
void NodeItem::mousePressEvent(QGraphicsSceneMouseEvent* e) {
    if (c_->linkMode) { c_->handleLink(id); e->accept(); return; }
    QGraphicsItem::mousePressEvent(e);
}

EdgeItem::EdgeItem(Canvas* c, const QString& eid) : id(eid), c_(c) {
    setZValue(1);
    setFlag(ItemIsSelectable, true);
    txt_ = new QGraphicsSimpleTextItem(this);
    txt_->setBrush(QColor("#475569"));
    update_();
}
void EdgeItem::update_() {
    const int i = c_->m->edgeIdx(id);
    if (i < 0) return;
    const QJsonObject e = c_->m->edges[i];
    const int a = c_->m->nodeIdx(e.value("sourceNodeId").toString()), b = c_->m->nodeIdx(e.value("targetNodeId").toString());
    if (a < 0 || b < 0) return;
    prepareGeometryChange();
    const QPointF s = c_->center(c_->m->nodes[a]), t = c_->center(c_->m->nodes[b]);
    const double dx = (t.x() - s.x()) * 0.5;
    QPainterPath path(s);
    path.cubicTo(QPointF(s.x() + dx, s.y()), QPointF(t.x() - dx, t.y()), t);
    setPath(path);
    const QPointF mid = path.pointAtPercent(0.5);
    txt_->setText(e.value("label").toString());
    txt_->setPos(mid.x() - txt_->boundingRect().width() / 2, mid.y() - 18);
}
QPainterPath EdgeItem::shape() const {
    QPainterPathStroker st;
    st.setWidth(14);
    return st.createStroke(path());
}
void EdgeItem::paint(QPainter* p, const QStyleOptionGraphicsItem*, QWidget*) {
    p->setRenderHint(QPainter::Antialiasing);
    QColor col("#94a3b8");
    int w = 2;
    if (state == "ok") { col = "#16a34a"; w = 3; }
    else if (state == "rejected") { col = "#dc2626"; w = 3; }
    if (isSelected()) { col = "#2563eb"; w = 3; }
    p->setPen(QPen(col, w));
    p->setBrush(Qt::NoBrush);
    p->drawPath(path());
    const int i = c_->m->edgeIdx(id);
    if (i < 0) return;
    const int b = c_->m->nodeIdx(c_->m->edges[i].value("targetNodeId").toString());
    if (b < 0) return;
    const QJsonObject tgt = c_->m->nodes[b];
    const QSize z = sizeOf(tgt.value("type").toString());
    const QPointF c = c_->center(tgt);
    const double rad = std::max(z.width(), z.height()) / 2.0 + 4;
    double pct = 1.0;
    while (pct > 0.5 && QLineF(path().pointAtPercent(pct), c).length() < rad) pct -= 0.01;
    const QPointF tip = path().pointAtPercent(pct), prev = path().pointAtPercent(std::max(pct - 0.03, 0.0));
    const double ang = std::atan2(tip.y() - prev.y(), tip.x() - prev.x());
    QPolygonF poly;
    poly << tip << QPointF(tip.x() - 10 * std::cos(ang - 0.4), tip.y() - 10 * std::sin(ang - 0.4)) << QPointF(tip.x() - 10 * std::cos(ang + 0.4), tip.y() - 10 * std::sin(ang + 0.4));
    p->setBrush(col);
    p->setPen(Qt::NoPen);
    p->drawPolygon(poly);
}

// ------------------------------------------------------------------------------------------ canvas
Canvas::Canvas(Model* model, bool ed, QWidget* parent) : QGraphicsView(parent), m(model), editable(ed) {
    sc_ = new QGraphicsScene(this);
    setScene(sc_);
    setRenderHint(QPainter::Antialiasing);
    setBackgroundBrush(QColor("#f8fafc"));
    setDragMode(ed ? QGraphicsView::RubberBandDrag : QGraphicsView::ScrollHandDrag);
    connect(sc_, &QGraphicsScene::selectionChanged, this, [this] { if (!rebuilding_ && onSelect) onSelect(selectedNode(), selectedEdge()); });
    rebuild();
}
QPointF Canvas::center(const QJsonObject& n) const {
    const QSize z = sizeOf(n.value("type").toString());
    return QPointF(n.value("x").toDouble() + z.width() / 2.0, n.value("y").toDouble() + z.height() / 2.0);
}
void Canvas::rebuild() {
    const QString sel = selectedNode();
    rebuilding_ = true;
    sc_->clear();
    items.clear();
    edgeItems.clear();
    for (const QJsonObject& e : m->edges) {
        auto* it = new EdgeItem(this, e.value("id").toString());
        it->state = edgeStates.value(it->id);
        sc_->addItem(it);
        edgeItems << it;
    }
    for (const QJsonObject& n : m->nodes) {
        auto* it = new NodeItem(this, n.value("id").toString());
        it->state = states.value(it->id);
        sc_->addItem(it);
        items.insert(it->id, it);
    }
    const QRectF r = sc_->itemsBoundingRect();
    sc_->setSceneRect(m->nodes.isEmpty() ? QRectF(0, 0, 900, 600) : r.adjusted(-80, -80, 200, 200));
    rebuilding_ = false;
    if (!sel.isEmpty() && items.contains(sel)) items[sel]->setSelected(true);
}
void Canvas::refreshEdges() { for (EdgeItem* e : edgeItems) { e->update_(); e->update(); } }
QString Canvas::selectedNode() const { for (QGraphicsItem* i : sc_->selectedItems()) if (auto* n = dynamic_cast<NodeItem*>(i)) return n->id; return {}; }
QString Canvas::selectedEdge() const { for (QGraphicsItem* i : sc_->selectedItems()) if (auto* n = dynamic_cast<EdgeItem*>(i)) return n->id; return {}; }
void Canvas::selectNode(const QString& id) { sc_->clearSelection(); if (items.contains(id)) items[id]->setSelected(true); }
void Canvas::setLinkMode(bool on) {
    linkMode = on;
    linkFrom.clear();
    setDragMode(on ? QGraphicsView::NoDrag : QGraphicsView::RubberBandDrag);
    viewport()->setCursor(on ? Qt::CrossCursor : Qt::ArrowCursor);
    sc_->update();
}
void Canvas::handleLink(const QString& id) {
    if (linkFrom.isEmpty()) linkFrom = id;
    else if (linkFrom == id) linkFrom.clear();
    else {
        const QJsonObject src = m->nodes[m->nodeIdx(linkFrom)];
        auto has = [&](const QString& label) { for (const QJsonObject& e : m->edges) if (e.value("sourceNodeId").toString() == linkFrom && e.value("label").toString() == label) return true; return false; };
        QString label = spec().value("edgeDefaults").toObject().value("default").toString();
        const QString st = src.value("type").toString();
        if (st == "ApprovalTask") label = has("Approve") ? "Reject" : "Approve";
        else if (st == "Condition") label = has("True") ? "False" : "True";
        const QString eid = newId();
        m->edges << QJsonObject{{"id", eid}, {"sourceNodeId", linkFrom}, {"targetNodeId", id}, {"label", label}};
        linkFrom.clear();
        rebuild();
        changed();
    }
    sc_->update();
}
void Canvas::addNode(const QString& type) {
    const int k = m->nodes.size();
    const QJsonObject n = newNode(type, 40 + (k % 5) * 180, 40 + (k / 5) * 120);
    m->nodes << n;
    rebuild();
    selectNode(n.value("id").toString());
    changed();
}
void Canvas::deleteSelected() {
    const QString nid = selectedNode(), eid = selectedEdge();
    if (!nid.isEmpty()) {
        m->nodes.removeAt(m->nodeIdx(nid));
        for (int i = m->edges.size() - 1; i >= 0; --i)
            if (m->edges[i].value("sourceNodeId").toString() == nid || m->edges[i].value("targetNodeId").toString() == nid) m->edges.removeAt(i);
    } else if (!eid.isEmpty()) m->edges.removeAt(m->edgeIdx(eid));
    else return;
    rebuild();
    if (onSelect) onSelect({}, {});
    changed();
}
void Canvas::wheelEvent(QWheelEvent* e) {
    if (e->modifiers() & Qt::ControlModifier) { const double f = e->angleDelta().y() > 0 ? 1.15 : 1 / 1.15; scale(f, f); }
    else QGraphicsView::wheelEvent(e);
}

// ------------------------------------------------------------------------------------------ form builder
FormDialog::FormDialog(QWidget* parent, const QJsonObject& form) : QDialog(parent) {
    setWindowTitle(t("wf.form"));
    resize(840, 460);
    auto* lay = new QVBoxLayout(this);
    auto* top = new QHBoxLayout;
    top->addWidget(new QLabel(t("wf.formTitle")));
    title_ = new QLineEdit(form.value("title").toString());
    top->addWidget(title_);
    lay->addLayout(top);
    tbl_ = new QTableWidget(0, 6);
    tbl_->setHorizontalHeaderLabels({"Key", "Label", "Type", "Required", "Read-only", "Options (label=value; …)"});
    tbl_->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
    lay->addWidget(tbl_, 1);
    for (const QJsonValue& f : form.value("fields").toArray()) addRow(f.toObject());
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button("+ " + t("wf.addField"), [this] { addRow({}); }));
    row->addWidget(Ui::button(t("wf.removeField"), [this] { if (tbl_->currentRow() >= 0) tbl_->removeRow(tbl_->currentRow()); }, "ghost"));
    row->addStretch();
    lay->addLayout(row);
    auto* bb = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel);
    connect(bb, &QDialogButtonBox::accepted, this, &QDialog::accept);
    connect(bb, &QDialogButtonBox::rejected, this, &QDialog::reject);
    lay->addWidget(bb);
}
void FormDialog::addRow(const QJsonObject& f) {
    const int r = tbl_->rowCount();
    tbl_->insertRow(r);
    auto* k = new QTableWidgetItem(f.value("key").toString());
    k->setData(Qt::UserRole, f.value("id").toString().isEmpty() ? newId() : f.value("id").toString());
    tbl_->setItem(r, 0, k);
    tbl_->setItem(r, 1, new QTableWidgetItem(f.value("label").toString()));
    auto* c = new QComboBox;
    for (const QJsonValue& v : spec().value("fieldTypes").toArray()) c->addItem(v.toString());
    c->setCurrentText(f.value("type").toString().isEmpty() ? "Text" : f.value("type").toString());
    tbl_->setCellWidget(r, 2, c);
    for (auto [col, key] : {std::pair<int, const char*>{3, "required"}, {4, "readOnly"}}) {
        auto* ck = new QCheckBox;
        ck->setChecked(f.value(key).toBool());
        tbl_->setCellWidget(r, col, ck);
    }
    QStringList opts;
    for (const QJsonValue& o : f.value("options").toArray()) opts << o.toObject().value("label").toString() + "=" + o.toObject().value("value").toString();
    tbl_->setItem(r, 5, new QTableWidgetItem(opts.join("; ")));
}
QJsonObject FormDialog::result() const {
    QJsonArray fields;
    for (int r = 0; r < tbl_->rowCount(); ++r) {
        QJsonArray opts;
        for (QString part : (tbl_->item(r, 5) ? tbl_->item(r, 5)->text() : QString()).split(';')) {
            part = part.trimmed();
            if (part.isEmpty()) continue;
            const int i = part.indexOf('=');
            opts << QJsonObject{{"label", (i < 0 ? part : part.left(i)).trimmed()}, {"value", (i < 0 ? part : part.mid(i + 1)).trimmed()}};
        }
        fields << QJsonObject{{"id", tbl_->item(r, 0)->data(Qt::UserRole).toString()}, {"key", tbl_->item(r, 0)->text().trimmed()}, {"label", tbl_->item(r, 1)->text().trimmed()},
                              {"type", static_cast<QComboBox*>(tbl_->cellWidget(r, 2))->currentText()}, {"required", static_cast<QCheckBox*>(tbl_->cellWidget(r, 3))->isChecked()},
                              {"readOnly", static_cast<QCheckBox*>(tbl_->cellWidget(r, 4))->isChecked()}, {"options", opts}};
    }
    return QJsonObject{{"id", QString()}, {"title", title_->text().trimmed()}, {"fields", fields}};
}

// ------------------------------------------------------------------------------------------ designer
DesignerDialog::DesignerDialog(QWidget* parent, const QString& defId) : QDialog(parent) {
    setWindowTitle(t("wf.designer"));
    resize(1300, 800);
    canDesign_ = Api::I().can(spec().value("permissions").toObject().value("design").toString());
    model.meta = QJsonObject{{"id", ""}, {"name", "Untitled flow"}, {"description", ""}, {"isPublished", false}, {"version", 1}};
    auto* lay = new QVBoxLayout(this);
    auto* bar = new QHBoxLayout;
    name_ = new QLineEdit;
    name_->setPlaceholderText(t("wf.name"));
    desc_ = new QLineEdit;
    desc_->setPlaceholderText(t("wf.description"));
    connect(name_, &QLineEdit::textChanged, this, [this](const QString& s) { model.meta["name"] = s; });
    connect(desc_, &QLineEdit::textChanged, this, [this](const QString& s) { model.meta["description"] = s; });
    badge_ = new QLabel;
    bar->addWidget(name_, 2);
    bar->addWidget(desc_, 3);
    bar->addWidget(badge_);
    link_ = Ui::button(t("wf.link"), [this] { canvas->setLinkMode(link_->isChecked()); status_->setText(link_->isChecked() ? t("wf.linkHint") : t("wf.hint")); }, "ghost");
    link_->setCheckable(true);
    del_ = Ui::button(t("wf.delete"), [this] { canvas->deleteSelected(); }, "ghost");
    save_ = Ui::button(t("wf.save"), [this] { save(); });
    pub_ = Ui::button(t("wf.publish"), [this] { publish(); }, "ghost");
    run_ = Ui::button(t("wf.run"), [this] { run(); }, "ghost");
    for (QPushButton* b : {link_, del_, save_, pub_, run_}) bar->addWidget(b);
    lay->addLayout(bar);

    auto* split = new QSplitter;
    auto* box = new QToolBox;
    box->setMinimumWidth(210);
    box->setMaximumWidth(260);
    for (const QJsonValue& cat : spec().value("categories").toArray()) {
        auto* w = new QListWidget;
        for (const QJsonValue& nv : spec().value("nodes").toArray()) {
            const QJsonObject n = nv.toObject();
            if (n.value("category").toString() != cat.toString()) continue;
            auto* it = new QListWidgetItem(n.value("icon").toString() + "  " + n.value("label").toString());
            it->setData(Qt::UserRole, n.value("type").toString());
            it->setToolTip(n.value("note").toString());
            w->addItem(it);
        }
        connect(w, &QListWidget::itemDoubleClicked, this, [this](QListWidgetItem* it) { if (canDesign_) canvas->addNode(it->data(Qt::UserRole).toString()); });
        box->addItem(w, cat.toString());
    }
    split->addWidget(box);
    canvas = new Canvas(&model, true);
    canvas->onSelect = [this](const QString& n, const QString& e) { onSelect(n, e); };
    split->addWidget(canvas);
    panelScroll_ = new QScrollArea;
    panelScroll_->setWidgetResizable(true);
    panelScroll_->setMinimumWidth(330);
    panelScroll_->setMaximumWidth(430);
    split->addWidget(panelScroll_);
    split->setStretchFactor(1, 1);
    lay->addWidget(split, 1);
    status_ = Ui::label(t("wf.hint"), "dim");
    lay->addWidget(status_);
    for (QWidget* w : QList<QWidget*>{link_, del_, save_, name_, desc_}) w->setEnabled(canDesign_);
    pub_->setEnabled(false);
    run_->setEnabled(false);
    showEmpty();
    apply();

    Api::I().users(this, [this](const QJsonValue& v) {
        users_ = v.toArray();
        QSet<QString> rs;
        for (const QJsonValue& u : users_) if (!u.toObject().value("role").toString().isEmpty()) rs.insert(u.toObject().value("role").toString());
        roles_ = rs.values();
        roles_.sort();
    }, nullptr);
    Api::I().definitions(this, [this](const QJsonValue& v) {
        published_ = QJsonArray();
        for (const QJsonValue& d : v.toArray())
            if (d.toObject().value("isPublished").toBool() && d.toObject().value("id").toString() != model.meta.value("id").toString()) published_ << d;
    }, nullptr);
    if (!defId.isEmpty())
        Api::I().definition(defId, this, [this](const QJsonValue& v) {
            model.fromJson(v.toObject());
            canvas->rebuild();
            apply();
        }, [this](const QString& m) { Ui::warn(this, m); });
}

void DesignerDialog::apply() {
    name_->blockSignals(true);
    desc_->blockSignals(true);
    name_->setText(model.meta.value("name").toString());
    desc_->setText(str(model.meta.value("description")));
    name_->blockSignals(false);
    desc_->blockSignals(false);
    const bool pub = model.meta.value("isPublished").toBool();
    badge_->setText(pub ? "● " + t("wf.published") + " v" + str(model.meta.value("version")) : "○ " + t("wf.draft"));
    badge_->setStyleSheet(pub ? "color:#16a34a;font-weight:600" : "color:#d97706;font-weight:600");
    pub_->setEnabled(!model.meta.value("id").toString().isEmpty() && !pub && Api::I().can(spec().value("permissions").toObject().value("publish").toString()));
    run_->setEnabled(pub);
}

void DesignerDialog::setPanel(QWidget* w) { panelScroll_->setWidget(w); }
void DesignerDialog::showEmpty() {
    auto* w = new QWidget;
    auto* l = new QVBoxLayout(w);
    l->addWidget(Ui::label(t("wf.selectHint"), "dim"));
    l->addStretch();
    setPanel(w);
}
void DesignerDialog::onSelect(const QString& nid, const QString& eid) {
    if (!nid.isEmpty()) buildNode(nid);
    else if (!eid.isEmpty()) buildEdge(eid);
    else showEmpty();
}
void DesignerDialog::buildEdge(const QString& eid) {
    const int i = model.edgeIdx(eid);
    if (i < 0) return;
    auto* w = new QWidget;
    auto* l = new QVBoxLayout(w);
    l->addWidget(Ui::label(t("wf.edge"), "title"));
    const int s = model.nodeIdx(model.edges[i].value("sourceNodeId").toString());
    const QString st = s >= 0 ? model.nodes[s].value("type").toString() : QString();
    l->addWidget(new QLabel(t("wf.edgeLabel")));
    if (st == "Condition") {
        auto* c = new QComboBox;
        c->addItems({"True", "False"});
        c->setCurrentText(model.edges[i].value("label").toString());
        c->setEnabled(canDesign_);
        connect(c, &QComboBox::currentTextChanged, this, [this, eid](const QString& v) { const int k = model.edgeIdx(eid); if (k >= 0) { model.edges[k]["label"] = v; canvas->refreshEdges(); } });
        l->addWidget(c);
    } else {
        auto* e = new QLineEdit(model.edges[i].value("label").toString());
        e->setEnabled(canDesign_);
        connect(e, &QLineEdit::textChanged, this, [this, eid](const QString& v) { const int k = model.edgeIdx(eid); if (k >= 0) { model.edges[k]["label"] = v; canvas->refreshEdges(); } });
        l->addWidget(e);
    }
    if (st == "ApprovalTask") { auto* h = Ui::label(t("wf.edgeApprovalHint"), "dim"); l->addWidget(h); }
    l->addStretch();
    setPanel(w);
}

void DesignerDialog::setVal(const QString& nid, const QString& key, const QJsonValue& v, bool rebuild) {
    const int i = model.nodeIdx(nid);
    if (i < 0) return;
    if (v.isNull() || v.isUndefined() || (v.isString() && v.toString().isEmpty() && key != "name")) model.nodes[i].remove(key);
    else model.nodes[i][key] = v;
    canvas->viewport()->update();
    canvas->scene()->update();
    if (rebuild) QTimer::singleShot(0, this, [this, nid] { buildNode(nid); });
}

void DesignerDialog::buildNode(const QString& nid) {
    const int idx = model.nodeIdx(nid);
    if (idx < 0) return;
    const QJsonObject n = model.nodes[idx], sp = typeSpec(n.value("type").toString());
    auto* host = new QWidget;
    auto* lay = new QVBoxLayout(host);
    lay->addWidget(Ui::label(sp.value("icon").toString() + " " + sp.value("label").toString(), "title"));
    lay->addWidget(Ui::label(sp.value("note").toString(), "dim"));
    auto* form = new QFormLayout;
    form->setLabelAlignment(Qt::AlignTop);
    lay->addLayout(form);
    QSet<QString> referenced;
    for (const QJsonValue& nv : spec().value("nodes").toArray())
        for (const QJsonValue& pv : nv.toObject().value("props").toArray())
            if (pv.toObject().contains("showIf")) referenced.insert(pv.toObject().value("showIf").toObject().value("key").toString());
    QJsonArray props = spec().value("common").toArray();
    for (const QJsonValue& v : sp.value("props").toArray()) props << v;
    for (const QJsonValue& pv : props) {
        const QJsonObject p = pv.toObject();
        if (p.contains("showIf")) {
            const QJsonObject c = p.value("showIf").toObject();
            const QString cur = str(n.value(c.value("key").toString()));
            if ((c.contains("eq") && cur != c.value("eq").toString()) || (c.contains("ne") && cur == c.value("ne").toString())) continue;
        }
        QWidget* w = editor(nid, p, referenced.contains(p.value("key").toString()));
        if (!w) continue;
        w->setEnabled(canDesign_ || p.value("kind").toString() == "form");
        form->addRow(p.value("label").toString() + ":", w);
        if (!p.value("hint").toString().isEmpty() && p.value("kind").toString() != "form") {
            auto* h = Ui::label(p.value("hint").toString(), "dim");
            h->setStyleSheet("font-size:11px;");
            form->addRow("", h);
        }
    }
    lay->addStretch();
    setPanel(host);
}

QWidget* DesignerDialog::editor(const QString& nid, const QJsonObject& p, bool rebuild) {
    const QString k = p.value("key").toString(), kind = p.value("kind").toString();
    const QJsonObject n = model.nodes[model.nodeIdx(nid)];
    if (kind == "text") {
        auto* e = new QLineEdit(str(n.value(k)));
        connect(e, &QLineEdit::textChanged, this, [this, nid, k](const QString& v) { setVal(nid, k, v, false); });
        if (p.value("test").toString() != "condition") return e;
        auto* box = new QWidget;
        auto* v = new QVBoxLayout(box);
        v->setContentsMargins(0, 0, 0, 0);
        v->addWidget(e);
        auto* data = new QPlainTextEdit("{\n  \"days\": 6\n}");
        data->setFixedHeight(70);
        auto* out = new QLabel;
        out->setWordWrap(true);
        out->setTextFormat(Qt::RichText);
        v->addWidget(new QLabel(t("wf.sampleData")));
        v->addWidget(data);
        v->addWidget(Ui::button("▶ " + t("wf.test"), [this, nid, data, out] {
            QJsonParseError pe;
            const QJsonDocument d = QJsonDocument::fromJson(data->toPlainText().toUtf8(), &pe);
            if (pe.error != QJsonParseError::NoError || !d.isObject()) { out->setText(t("wf.badJson")); return; }
            const QString expr = str(model.nodes[model.nodeIdx(nid)].value("conditionExpression"));
            Api::I().testCondition(expr, d.object(), out, [out](const QJsonValue& rv) {
                const QJsonObject r = rv.toObject();
                const bool ok = r.value("result").toBool();
                QString html = QString("<b style='color:%1'>%2: %3</b>").arg(ok ? "#16a34a" : "#dc2626", t("wf.result"), ok ? "True" : "False");
                for (const QJsonValue& c : r.value("clauses").toArray()) html += "<br>" + QString(c.toObject().value("result").toBool() ? "✓ " : "✕ ") + c.toObject().value("clause").toString().toHtmlEscaped();
                out->setText(html);
            }, [out](const QString& m) { out->setText(m); });
        }, "ghost"));
        v->addWidget(out);
        return box;
    }
    if (kind == "textarea") {
        auto* e = new QPlainTextEdit(str(n.value(k)));
        e->setFixedHeight(90);
        connect(e, &QPlainTextEdit::textChanged, this, [this, nid, k, e] { setVal(nid, k, e->toPlainText(), false); });
        return e;
    }
    if (kind == "number") {
        auto* sbx = new QSpinBox;
        sbx->setRange(0, 10000000);
        sbx->setSpecialValueText("—");
        sbx->setValue(n.value(k).toInt());
        connect(sbx, QOverload<int>::of(&QSpinBox::valueChanged), this, [this, nid, k](int v) { setVal(nid, k, v ? QJsonValue(v) : QJsonValue(), false); });
        return sbx;
    }
    if (kind == "bool") {
        auto* c = new QCheckBox;
        c->setChecked(n.value(k).toBool());
        connect(c, &QCheckBox::toggled, this, [this, nid, k, rebuild](bool v) { setVal(nid, k, v, rebuild); });
        return c;
    }
    if (kind == "select") {
        auto* c = new QComboBox;
        const QJsonArray opts = p.value("options").toArray();
        QStringList vals;
        for (const QJsonValue& o : opts) { c->addItem(o.toString().isEmpty() ? QString("— none (stub) —") : o.toString()); vals << o.toString(); }
        const int cur = vals.indexOf(str(n.value(k)));
        c->setCurrentIndex(cur >= 0 ? cur : 0);
        connect(c, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this, nid, k, vals, rebuild](int i) { setVal(nid, k, vals.value(i), rebuild); });
        return c;
    }
    if (kind == "assignees") {
        auto* l = new QListWidget;
        l->setFixedHeight(130);
        QSet<QString> chosen;
        for (const QString& s : str(n.value(k)).split(',')) if (!s.trimmed().isEmpty()) chosen.insert(s.trimmed());
        auto add = [&](const QString& text, const QString& val) {
            auto* it = new QListWidgetItem(text);
            it->setData(Qt::UserRole, val);
            it->setFlags(it->flags() | Qt::ItemIsUserCheckable);
            it->setCheckState(chosen.contains(val) ? Qt::Checked : Qt::Unchecked);
            l->addItem(it);
        };
        for (const QString& r : roles_) add("role: " + r, r);
        for (const QJsonValue& u : users_) add(u.toObject().value("displayName").toString() + " (" + u.toObject().value("username").toString() + ")", u.toObject().value("username").toString());
        connect(l, &QListWidget::itemChanged, this, [this, nid, k, l] {
            QStringList vals;
            for (int i = 0; i < l->count(); ++i) if (l->item(i)->checkState() == Qt::Checked) vals << l->item(i)->data(Qt::UserRole).toString();
            setVal(nid, k, vals.join(","), false);
        });
        return l;
    }
    if (kind == "assignee1" || kind == "workflow") {
        auto* c = new QComboBox;
        c->addItem("", "");
        if (kind == "assignee1") {
            for (const QString& r : roles_) c->addItem("role: " + r, r);
            for (const QJsonValue& u : users_) c->addItem(u.toObject().value("displayName").toString() + " (" + u.toObject().value("username").toString() + ")", u.toObject().value("username").toString());
        } else {
            for (const QJsonValue& d : published_) c->addItem(d.toObject().value("name").toString(), d.toObject().value("id").toString());
        }
        const int i = c->findData(str(n.value(k)));
        c->setCurrentIndex(i >= 0 ? i : 0);
        connect(c, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this, nid, k, c, kind](int) {
            setVal(nid, k, c->currentData().toString(), false);
            if (kind == "workflow") setVal(nid, "subWorkflowDefinitionName", c->currentData().toString().isEmpty() ? QJsonValue() : QJsonValue(c->currentText()), false);
        });
        return c;
    }
    if (kind == "form") {
        auto* b = new QPushButton;
        auto label = [this, nid, b] { b->setText(t1("wf.editForm", "n", QString::number(model.nodes[model.nodeIdx(nid)].value("form").toObject().value("fields").toArray().size()))); };
        label();
        connect(b, &QPushButton::clicked, this, [this, nid, label] {
            QJsonObject form = model.nodes[model.nodeIdx(nid)].value("form").toObject();
            if (form.isEmpty()) form = QJsonObject{{"id", newId()}, {"title", model.nodes[model.nodeIdx(nid)].value("name")}, {"fields", QJsonArray()}};
            FormDialog d(this, form);
            if (d.exec()) {
                QJsonObject r = d.result();
                r["id"] = form.value("id");
                model.nodes[model.nodeIdx(nid)]["form"] = r;
                label();
            }
        });
        return b;
    }
    return nullptr;
}

void DesignerDialog::save(std::function<void()> then) {
    Api::I().saveDefinition(model.meta.value("id").toString(), model.body(), this, [this, then](const QJsonValue& v) {
        model.fromJson(v.toObject());
        canvas->rebuild();
        apply();
        status_->setText(t("wf.saved"));
        if (then) then();
    }, [this](const QString& m) { Ui::warn(this, m); });
}
void DesignerDialog::publish() {
    int starts = 0;
    bool end = false;
    for (const QJsonObject& n : model.nodes) { if (n.value("type").toString() == "Start") ++starts; if (n.value("type").toString() == "End") end = true; }
    if (starts != 1) { Ui::warn(this, t("wf.needStart")); return; }
    if (!end) { Ui::warn(this, t("wf.needEnd")); return; }
    save([this] {
        Api::I().publishDefinition(model.meta.value("id").toString(), this, [this](const QJsonValue& v) {
            const QJsonObject d = v.toObject();
            for (auto it = d.begin(); it != d.end(); ++it) if (it.key() != "nodes" && it.key() != "edges") model.meta[it.key()] = it.value();
            apply();
            status_->setText(t("wf.publishedMsg"));
        }, [this](const QString& m) { Ui::warn(this, m); });
    });
}
void DesignerDialog::run() {
    Api::I().startRun(model.meta.value("id").toString(), this, [this](const QJsonValue& v) {
        status_->setText(t1("wf.started", "id", v.toObject().value("id").toString()));
        InstanceDialog d(this, v.toObject().value("id").toString());
        d.exec();
    }, [this](const QString& m) { Ui::warn(this, m); });
}

// ------------------------------------------------------------------------------------------ instance monitor
InstanceDialog::InstanceDialog(QWidget* parent, const QString& id) : QDialog(parent), id_(id) {
    setWindowTitle(t("wf.instance"));
    resize(1100, 740);
    auto* lay = new QVBoxLayout(this);
    auto* top = new QHBoxLayout;
    head_ = Ui::label("…", "title");
    top->addWidget(head_, 1);
    cancel_ = Ui::button(t("wf.cancelReq"), [this] {
        if (Ui::ask(this, t("wf.cancelConfirm"), t("wf.yes"), t("wf.no")))
            Api::I().cancelInstance(id_, this, [this](const QJsonValue&) { refresh(); }, [this](const QString& m) { Ui::warn(this, m); });
    }, "danger");
    cancel_->setEnabled(false);
    top->addWidget(cancel_);
    lay->addLayout(top);
    meta_ = Ui::label(" ", "dim");
    lay->addWidget(meta_);
    auto* leg = new QLabel("<span style='color:#16a34a'>●</span> " + t("wf.legActive") + "  <span style='color:#86efac'>●</span> " + t("wf.legDone") + "  <span style='color:#dc2626'>●</span> " + t("wf.legRejected") + "  <span style='color:#94a3b8'>●</span> " + t("wf.legPending"));
    lay->addWidget(leg);
    holder_ = new QVBoxLayout;
    lay->addLayout(holder_, 2);
    auto* tabs = new QTabWidget;
    timeline_ = new QListWidget;
    log_ = new QListWidget;
    data_ = Ui::table({t("wf.key"), t("wf.value")});
    tabs->addTab(timeline_, t("wf.timeline"));
    tabs->addTab(data_, t("wf.data"));
    tabs->addTab(log_, t("wf.activityLog"));
    lay->addWidget(tabs, 1);
    connect(&timer_, &QTimer::timeout, this, [this] { refresh(); });
    timer_.start(3000);
    refresh();
}
void InstanceDialog::refresh() {
    Api::I().instance(id_, this, [this](const QJsonValue& v) {
        inst_ = v.toObject();
        if (!haveDef_ && !inst_.value("definitionId").toString().isEmpty()) {
            haveDef_ = true;
            Api::I().definition(inst_.value("definitionId").toString(), this, [this](const QJsonValue& d) { model_.fromJson(d.toObject()); paint(); }, nullptr);
        }
        paint();
        if (inst_.value("status").toString() != "Running") timer_.stop();
    }, nullptr);
}
void InstanceDialog::paint() {
    head_->setText(inst_.value("definitionName").toString() + " — " + inst_.value("status").toString());
    meta_->setText(t("wf.startedBy") + " " + inst_.value("startedBy").toString() + " · " + inst_.value("startedAt").toString());
    cancel_->setEnabled(inst_.value("status").toString() == "Running" && (Api::I().username == inst_.value("startedBy").toString() || Api::I().role == "admin"));
    timeline_->clear();
    QSet<QString> visited, rejected, active;
    for (const QJsonValue& hv : inst_.value("history").toArray()) {
        const QJsonObject h = hv.toObject();
        QString line = h.value("timestamp").toString().left(16).replace('T', ' ') + "   " + h.value("nodeName").toString() + " — " + h.value("action").toString();
        if (!h.value("actor").toString().isEmpty()) line += "  · " + h.value("actor").toString();
        if (!h.value("comment").toString().isEmpty()) line += "   “" + h.value("comment").toString() + "”";
        timeline_->addItem(line);
        const QString nid = h.value("nodeId").toString(), a = h.value("action").toString();
        if (!nid.isEmpty()) { visited.insert(nid); if (a == "Rejected" || a == "Canceled" || a == "Escalated") rejected.insert(nid); }
    }
    QList<QStringList> rows;
    QList<QJsonObject> pay;
    const QJsonObject data = inst_.value("data").toObject();
    for (auto it = data.begin(); it != data.end(); ++it) { rows << QStringList{it.key(), str(it.value())}; pay << QJsonObject(); }
    Ui::fill(data_, rows, pay);
    Api::I().activityLog(id_, this, [this](const QJsonValue& v) {
        log_->clear();
        for (const QJsonValue& lv : v.toArray()) {
            const QJsonObject l = lv.toObject();
            log_->addItem(l.value("timestamp").toString().left(16).replace('T', ' ') + "   " + l.value("nodeName").toString() + " — " + l.value("action").toString() + "   " + (l.value("actor").toString().isEmpty() ? "system" : l.value("actor").toString()));
        }
    }, nullptr);
    if (model_.nodes.isEmpty()) return;
    if (inst_.value("status").toString() == "Running") for (const QJsonValue& v : inst_.value("currentNodeIds").toArray()) active.insert(v.toString());
    if (!canvas_) { canvas_ = new Canvas(&model_, false); holder_->addWidget(canvas_); }
    canvas_->states.clear();
    canvas_->edgeStates.clear();
    for (const QJsonObject& n : model_.nodes) {
        const QString nid = n.value("id").toString();
        canvas_->states[nid] = rejected.contains(nid) ? "rejected" : active.contains(nid) ? "active" : visited.contains(nid) ? "visited" : "pending";
    }
    for (const QJsonObject& e : model_.edges) {
        const QString s = e.value("sourceNodeId").toString(), tg = e.value("targetNodeId").toString();
        if (visited.contains(s) && (visited.contains(tg) || active.contains(tg))) canvas_->edgeStates[e.value("id").toString()] = rejected.contains(tg) ? "rejected" : "ok";
    }
    canvas_->rebuild();
}
}  // namespace Wf

// ------------------------------------------------------------------------------------------ page
WorkflowPage::WorkflowPage() {
    lay->addWidget(Ui::label(t("tab.workflow"), "title"));
    tabs_ = new QTabWidget;
    lay->addWidget(tabs_, 1);
    auto* fw = new QWidget;
    auto* fl = new QVBoxLayout(fw);
    auto* row = new QHBoxLayout;
    const bool canDesign = Api::I().can(Wf::spec().value("permissions").toObject().value("design").toString());
    auto* nw = Ui::button("+ " + t("wf.new"), [this] { Wf::DesignerDialog d(this, QString()); d.exec(); reload(); });
    nw->setEnabled(canDesign);
    auto* del = Ui::button(t("wf.delete"), [this] { remove(); }, "ghost");
    del->setEnabled(canDesign);
    row->addWidget(nw);
    row->addWidget(Ui::button(t("wf.open"), [this] { open(); }, "ghost"));
    row->addWidget(Ui::button(t("wf.run"), [this] { start(); }, "ghost"));
    row->addWidget(del);
    row->addStretch();
    fl->addLayout(row);
    defs_ = Ui::table({t("wf.name"), t("wf.version"), t("wf.steps"), t("wf.status"), t("wf.description")});
    connect(defs_, &QTableWidget::cellDoubleClicked, this, [this] { open(); });
    fl->addWidget(defs_, 1);
    tabs_->addTab(fw, t("wf.flows"));
    for (const char* k : {"Running", "Completed", "Terminated"}) {
        auto* tb = Ui::table({t("wf.name"), t("wf.status"), t("wf.startedBy"), t("wf.startedAt")});
        connect(tb, &QTableWidget::cellDoubleClicked, this, [this, tb] {
            QJsonObject p;
            if (Ui::selected(tb, p)) { Wf::InstanceDialog d(this, p.value("id").toString()); d.exec(); reload(); }
        });
        inst_.insert(k, tb);
        instOrder_ << k;
        tabs_->addTab(tb, k);
    }
}

void WorkflowPage::reload() {
    if (Api::I().can(Wf::spec().value("permissions").toObject().value("view").toString()))
        Api::I().definitions(this, [this](const QJsonValue& v) {
            QList<QStringList> rows;
            QList<QJsonObject> pay;
            for (const QJsonValue& dv : v.toArray()) {
                const QJsonObject d = dv.toObject();
                rows << QStringList{d.value("name").toString(), "v" + QString::number(d.value("version").toInt(1)), QString::number(d.value("nodes").toArray().size()),
                                    d.value("isPublished").toBool() ? t("wf.published") : t("wf.draft"), d.value("description").toString()};
                pay << d;
            }
            Ui::fill(defs_, rows, pay);
        }, [this](const QString& m) { Ui::warn(this, m); });
    Api::I().instances(this, [this](const QJsonValue& v) {
        int tab = 1;
        for (const QString& key : instOrder_) {
            QList<QStringList> rows;
            QList<QJsonObject> pay;
            for (const QJsonValue& rv : v.toArray()) {
                const QJsonObject r = rv.toObject();
                if (r.value("status").toString() != key) continue;
                rows << QStringList{r.value("definitionName").toString(), r.value("status").toString(), r.value("startedBy").toString(), r.value("startedAt").toString().left(16).replace('T', ' ')};
                pay << r;
            }
            Ui::fill(inst_[key], rows, pay);
            tabs_->setTabText(tab++, t(key == "Running" ? "wf.running" : key == "Completed" ? "wf.completed" : "wf.canceled") + " (" + QString::number(rows.size()) + ")");
        }
    }, nullptr);
}
void WorkflowPage::open() {
    QJsonObject p;
    if (Ui::selected(defs_, p)) { Wf::DesignerDialog d(this, p.value("id").toString()); d.exec(); reload(); }
}
void WorkflowPage::start() {
    QJsonObject p;
    if (!Ui::selected(defs_, p)) return;
    if (!p.value("isPublished").toBool()) { Ui::warn(this, t("wf.notPublished")); return; }
    Api::I().startRun(p.value("id").toString(), this, [this](const QJsonValue& v) { Wf::InstanceDialog d(this, v.toObject().value("id").toString()); d.exec(); reload(); },
                      [this](const QString& m) { Ui::warn(this, m); });
}
void WorkflowPage::remove() {
    QJsonObject p;
    if (!Ui::selected(defs_, p)) return;
    if (Ui::ask(this, t1("wf.deleteConfirm", "name", p.value("name").toString()), t("wf.yes"), t("wf.no")))
        Api::I().deleteDefinition(p.value("id").toString(), this, [this](const QJsonValue&) { reload(); }, [this](const QString& m) { Ui::warn(this, m); });
}
