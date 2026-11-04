#include "SitePage.h"

#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QMessageBox>
#include <QRandomGenerator>
#include <QStandardPaths>
#include <QUrl>

#include "Api.h"
#include "I18n.h"
#include "SiteRender.h"
#include "Ui.h"

using I18n::t;

namespace Site {
const QJsonObject& block(const QString& type) {
    static QMap<QString, QJsonObject> m = [] { QMap<QString, QJsonObject> r; for (const QJsonValue& b : SiteRender::spec().value("blocks").toArray()) r[b.toObject().value("type").toString()] = b.toObject(); return r; }();
    static QJsonObject none;
    return m.contains(type) ? *&m[type] : none;
}
QString uid() { static const char* c = "abcdefghijklmnopqrstuvwxyz0123456789"; QString s; for (int i = 0; i < 7; ++i) s += c[QRandomGenerator::global()->bounded(36)]; return s; }
QJsonObject newBlock(const QString& type) { return QJsonObject{{"id", uid()}, {"type", type}, {"props", block(type).value("defaults").toObject()}}; }
QJsonObject templateDesign(const QString& key, const QString& name, const QString& cur) {
    QString s = QString::fromUtf8(QJsonDocument(SiteRender::spec().value("templates").toObject().value(key).toObject()).toJson(QJsonDocument::Compact));
    auto q = [](const QString& v) { QString o = QString::fromUtf8(QJsonDocument(QJsonArray{v}).toJson(QJsonDocument::Compact)); return o.mid(2, o.size() - 4); };
    s.replace("{{name}}", q(name)).replace("{{cur}}", q(cur));
    return QJsonDocument::fromJson(s.toUtf8()).object();
}
QString publicBase() {
    QString s = Api::I().server.trimmed();
    while (s.endsWith('/')) s.chop(1);
    if (s.toLower().endsWith("/api")) s.chop(4);
    return s + "/api";
}
}  // namespace Site

static QString optLabel(const QString& v) { return v.startsWith("web.") ? t(v) : v; }
static QString summary(const QJsonValue& v) {
    if (v.isArray()) return QString::number(v.toArray().size());
    return SiteRender::js(v).left(60);
}
static QString fieldLabel(const QJsonObject& f) { return t(f.value("label").toString()) == f.value("label").toString() ? f.value("label").toString() : t(f.value("label").toString()); }

// ------------------------------------------------------------------ list + props dialogs
ListDialog::ListDialog(QWidget* parent, const QString& title, const QJsonArray& f, const QJsonArray& its, const QJsonObject& dflt) : QDialog(parent), fields(f), items(its), def(dflt) {
    setWindowTitle(title);
    resize(640, 420);
    auto* lay = new QVBoxLayout(this);
    QStringList heads;
    for (const QJsonValue& fv : fields) heads << fieldLabel(fv.toObject());
    table = Ui::table(heads);
    lay->addWidget(table, 1);
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button("+", [this] { add(); }, "ghost"));
    row->addWidget(Ui::button(t("web.edit"), [this] { edit(); }, "ghost"));
    row->addWidget(Ui::button(QString::fromUtf8("↑"), [this] { move(-1); }, "ghost"));
    row->addWidget(Ui::button(QString::fromUtf8("↓"), [this] { move(1); }, "ghost"));
    row->addWidget(Ui::button(QString::fromUtf8("✕"), [this] { remove(); }, "ghost"));
    row->addStretch(1);
    row->addWidget(Ui::button(t("cal.save"), [this] { accept(); }));
    lay->addLayout(row);
    connect(table, &QTableWidget::doubleClicked, this, [this] { edit(); });
    refresh();
}
void ListDialog::refresh(int sel) {
    QList<QStringList> rows; QList<QJsonObject> pay;
    for (const QJsonValue& iv : items) { QStringList r; for (const QJsonValue& fv : fields) r << summary(iv.toObject().value(fv.toObject().value("key").toString())); rows << r; pay << QJsonObject(); }
    Ui::fill(table, rows, pay);
    if (!items.isEmpty()) table->selectRow(std::min(sel, int(items.size()) - 1));
}
void ListDialog::add() { items.append(def); refresh(items.size() - 1); edit(); }
void ListDialog::edit() {
    const int i = table->currentRow();
    if (i < 0 || i >= items.size()) return;
    PropsDialog d(this, t("web.edit"), fields, items[i].toObject());
    if (d.exec()) { items[i] = d.values; refresh(i); }
}
void ListDialog::move(int n) {
    const int i = table->currentRow();
    if (i < 0 || i + n < 0 || i + n >= items.size()) return;
    const QJsonValue a = items[i]; items[i] = items[i + n]; items[i + n] = a; refresh(i + n);
}
void ListDialog::remove() { const int i = table->currentRow(); if (i >= 0 && i < items.size()) { items.removeAt(i); refresh(i); } }

PropsDialog::PropsDialog(QWidget* parent, const QString& title, const QJsonArray& f, const QJsonObject& props) : QDialog(parent), values(props), fields(f) {
    setWindowTitle(title);
    resize(520, 120 + 38 * fields.size());
    auto* form = new QFormLayout(this);
    for (const QJsonValue& fv : fields) {
        const QJsonObject fo = fv.toObject();
        const QString k = fo.value("key").toString(), kind = fo.value("kind").toString();
        const QJsonValue v = values.value(k);
        QWidget* wd;
        if (kind == "textarea") { auto* e = new QPlainTextEdit(SiteRender::js(v)); e->setFixedHeight(90); wd = e; }
        else if (kind == "select") {
            auto* c = new QComboBox;
            for (const QJsonValue& ov : fo.value("options").toArray()) c->addItem(optLabel(ov.toObject().value("l").toString()), ov.toObject().value("v").toString());
            c->setCurrentIndex(std::max(0, c->findData(SiteRender::js(v))));
            wd = c;
        }
        else if (kind == "list") wd = Ui::button(QString("%1 (%2)…").arg(fieldLabel(fo)).arg(v.toArray().size()), [this, fo] { editList(fo); }, "ghost");
        else { auto* e = new QLineEdit(SiteRender::js(v)); if (kind == "image") e->setPlaceholderText("https://…"); wd = e; }
        w[k] = wd;
        form->addRow(fieldLabel(fo), wd);
    }
    form->addRow(Ui::button(t("cal.save"), [this] { ok(); }));
}
void PropsDialog::editList(const QJsonObject& f) {
    ListDialog d(this, fieldLabel(f), f.value("itemFields").toArray(), values.value(f.value("key").toString()).toArray(), f.value("itemDefault").toObject());
    if (d.exec()) { values[f.value("key").toString()] = d.items; static_cast<QPushButton*>(w[f.value("key").toString()])->setText(QString("%1 (%2)…").arg(fieldLabel(f)).arg(d.items.size())); }
}
void PropsDialog::ok() {
    for (const QJsonValue& fv : fields) {
        const QJsonObject f = fv.toObject();
        const QString k = f.value("key").toString(), kind = f.value("kind").toString();
        if (kind == "textarea") values[k] = static_cast<QPlainTextEdit*>(w[k])->toPlainText();
        else if (kind == "select") values[k] = static_cast<QComboBox*>(w[k])->currentData().toString();
        else if (kind == "number") {
            bool ok = false; double x = static_cast<QLineEdit*>(w[k])->text().toDouble(&ok);
            if (!ok) x = f.value("min").toDouble(0);
            if (f.contains("min")) x = std::max(x, f.value("min").toDouble());
            if (f.contains("max")) x = std::min(x, f.value("max").toDouble());
            values[k] = x;
        }
        else if (kind != "list") values[k] = static_cast<QLineEdit*>(w[k])->text();
    }
    accept();
}

// ------------------------------------------------------------------ editor
static QJsonArray productFields() {
    QJsonArray a;
    auto add = [&](const char* k, const char* l, const char* kind) { QJsonObject o{{"key", k}, {"label", l}, {"kind", kind}}; if (QString(kind) == "number") o["min"] = 0; a.append(o); };
    add("sku", "SKU", "text"); add("name", "web.f.name", "text"); add("price", "Price", "number"); add("category", "web.f.category", "text"); add("description", "web.f.text", "text"); add("image", "web.f.image", "image");
    return a;
}

SiteEditor::SiteEditor(QWidget* parent, const QJsonObject& r, const QJsonObject& design, std::function<void()> saved) : QDialog(parent), row(r), d(design), onSaved(saved) {
    setWindowTitle(t("web.design") + " · " + row.value("name").toString());
    resize(900, 600);
    auto* lay = new QVBoxLayout(this);
    auto* tabs = new QTabWidget;
    lay->addWidget(tabs, 1);
    auto* w1 = new QWidget; auto* h = new QHBoxLayout(w1);
    auto* left = new QVBoxLayout;
    left->addWidget(Ui::label(t("web.p.pages")));
    pages = new QListWidget;
    connect(pages, &QListWidget::currentRowChanged, this, [this](int i) { if (i >= 0) { pi = i; refreshBlocks(); } });
    left->addWidget(pages, 1);
    auto* pr = new QHBoxLayout;
    pr->addWidget(Ui::button("+", [this] { addPage(); }, "ghost")); pr->addWidget(Ui::button(t("web.edit"), [this] { editPage(); }, "ghost")); pr->addWidget(Ui::button(QString::fromUtf8("✕"), [this] { delPage(); }, "ghost"));
    left->addLayout(pr);
    h->addLayout(left, 1);
    auto* right = new QVBoxLayout;
    right->addWidget(Ui::label(t("web.p.layers")));
    blocks = new QListWidget;
    connect(blocks, &QListWidget::itemDoubleClicked, this, [this] { editBlock(); });
    right->addWidget(blocks, 1);
    auto* br = new QHBoxLayout;
    kind = new QComboBox;
    for (const QJsonValue& b : SiteRender::spec().value("blocks").toArray()) kind->addItem(t(b.toObject().value("label").toString()), b.toObject().value("type").toString());
    br->addWidget(kind);
    br->addWidget(Ui::button("+", [this] { addBlock(); }, "ghost")); br->addWidget(Ui::button(t("web.edit"), [this] { editBlock(); }, "ghost")); br->addWidget(Ui::button(t("web.duplicate"), [this] { dupBlock(); }, "ghost"));
    br->addWidget(Ui::button(QString::fromUtf8("↑"), [this] { moveBlock(-1); }, "ghost")); br->addWidget(Ui::button(QString::fromUtf8("↓"), [this] { moveBlock(1); }, "ghost")); br->addWidget(Ui::button(QString::fromUtf8("✕"), [this] { delBlock(); }, "ghost"));
    right->addLayout(br);
    h->addLayout(right, 2);
    tabs->addTab(w1, t("web.p.pages"));
    // theme
    const QJsonObject th = d.value("theme").toObject(), st = d.value("settings").toObject(), shop = d.value("shop").toObject();
    auto* w2 = new QWidget; auto* f2 = new QFormLayout(w2);
    prim = new QLineEdit(th.value("primary").toString()); bg = new QLineEdit(th.value("bg").toString()); tx = new QLineEdit(th.value("text").toString());
    font = new QComboBox; for (const QString& k : SiteRender::spec().value("fonts").toObject().keys()) font->addItem(k, k);
    font->setCurrentIndex(std::max(0, font->findData(th.value("font").toString("sans"))));
    radius = new QLineEdit(SiteRender::js(th.value("radius"))); dark = new QCheckBox(t("web.dark")); dark->setChecked(th.value("dark").toBool());
    title = new QLineEdit(st.value("title").toString()); lang = new QLineEdit(st.value("lang").toString()); dir = new QComboBox; dir->addItem("ltr", "ltr"); dir->addItem("rtl", "rtl");
    dir->setCurrentIndex(st.value("dir").toString() == "rtl" ? 1 : 0); desc = new QLineEdit(st.value("description").toString());
    f2->addRow(t("web.colorPrimary"), prim); f2->addRow(t("web.colorBg"), bg); f2->addRow(t("web.colorText"), tx); f2->addRow(t("web.font"), font); f2->addRow(t("web.radius"), radius); f2->addRow("", dark);
    f2->addRow(t("web.siteTitle"), title); f2->addRow(t("web.language"), lang); f2->addRow("dir", dir); f2->addRow(t("web.metaDesc"), desc);
    tabs->addTab(w2, t("web.details"));
    // shop
    auto* w3 = new QWidget; auto* v3 = new QVBoxLayout(w3);
    auto* top = new QHBoxLayout;
    shopOn = new QCheckBox(t("web.shopOn")); shopOn->setChecked(shop.value("enabled").toBool());
    cur = new QLineEdit(shop.value("currency").toString()); cur->setMaximumWidth(80);
    top->addWidget(shopOn); top->addWidget(Ui::label(t("web.currency"))); top->addWidget(cur); top->addStretch(1);
    v3->addLayout(top);
    QStringList heads; for (const QJsonValue& f : productFields()) heads << fieldLabel(f.toObject());
    prod = Ui::table(heads);
    v3->addWidget(prod, 1);
    auto* pb = new QHBoxLayout;
    pb->addWidget(Ui::button("+", [this] { addProd(); }, "ghost")); pb->addWidget(Ui::button(t("web.edit"), [this] { editProd(); }, "ghost")); pb->addWidget(Ui::button(QString::fromUtf8("✕"), [this] { delProd(); }, "ghost")); pb->addWidget(Ui::button(t("web.sync"), [this] { sync(); }, "ghost"));
    pb->addStretch(1);
    v3->addLayout(pb);
    tabs->addTab(w3, t("web.p.shop"));
    auto* bottom = new QHBoxLayout;
    msg = new QLabel;
    bottom->addWidget(msg, 1);
    bottom->addWidget(Ui::button(t("web.preview"), [this] { preview(); }, "ghost")); bottom->addWidget(Ui::button(t("cal.save"), [this] { save(); })); bottom->addWidget(Ui::button(t("cal.close"), [this] { accept(); }, "ghost"));
    lay->addLayout(bottom);
    refreshPages(0);
    refreshProducts();
}
void SiteEditor::setPage(const QJsonObject& p) { QJsonArray a = d.value("pages").toArray(); a[pi] = p; d["pages"] = a; }
void SiteEditor::setBlocks(const QJsonArray& b) { QJsonObject p = page(); p["blocks"] = b; setPage(p); }
void SiteEditor::setProducts(const QJsonArray& p) { QJsonObject s = d.value("shop").toObject(); s["products"] = p; d["shop"] = s; }
void SiteEditor::refreshPages(int sel) {
    pages->blockSignals(true); pages->clear();
    for (const QJsonValue& pv : d.value("pages").toArray()) pages->addItem(pv.toObject().value("title").toString() + "   " + pv.toObject().value("path").toString());
    pages->blockSignals(false);
    pi = std::min(sel < 0 ? pi : sel, int(d.value("pages").toArray().size()) - 1);
    pages->setCurrentRow(pi);
    refreshBlocks();
}
void SiteEditor::refreshBlocks(int sel) {
    blocks->clear();
    for (const QJsonValue& bv : blockList()) {
        const QJsonObject b = bv.toObject(), p = b.value("props").toObject();
        QString first;
        for (const char* k : {"title", "heading", "brand", "text", "button"}) if (!SiteRender::js(p.value(k)).isEmpty()) { first = SiteRender::js(p.value(k)); break; }
        const QJsonObject def = Site::block(b.value("type").toString());
        blocks->addItem((def.isEmpty() ? b.value("type").toString() : t(def.value("label").toString())) + "   " + first.left(50));
    }
    if (blocks->count()) blocks->setCurrentRow(std::min(sel, blocks->count() - 1));
}
void SiteEditor::addPage() {
    QJsonArray a = d.value("pages").toArray();
    a.append(QJsonObject{{"id", Site::uid()}, {"path", QString("/page%1").arg(a.size() + 1)}, {"title", t("web.newPage")}, {"blocks", QJsonArray{Site::newBlock("nav"), Site::newBlock("footer")}}});
    d["pages"] = a; refreshPages(a.size() - 1); editPage();
}
void SiteEditor::editPage() {
    QJsonArray f{QJsonObject{{"key", "title"}, {"label", "web.pageTitle"}, {"kind", "text"}}, QJsonObject{{"key", "path"}, {"label", "web.pagePath"}, {"kind", "text"}}};
    PropsDialog dlg(this, t("web.edit"), f, page());
    if (!dlg.exec()) return;
    QString path = dlg.values.value("path").toString().trimmed(); if (path.isEmpty()) path = "/"; if (!path.startsWith('/')) path = "/" + path;
    QJsonObject p = page(); p["title"] = dlg.values.value("title"); p["path"] = path; setPage(p); refreshPages();
}
void SiteEditor::delPage() { QJsonArray a = d.value("pages").toArray(); if (a.size() > 1) { a.removeAt(pi); d["pages"] = a; pi = 0; refreshPages(0); } }
void SiteEditor::addBlock() {
    QJsonArray bl = blockList();
    const int pos = (!bl.isEmpty() && bl.last().toObject().value("type").toString() == "footer") ? int(bl.size()) - 1 : int(bl.size());
    bl.insert(pos, Site::newBlock(kind->currentData().toString()));
    setBlocks(bl); refreshBlocks(pos);
}
void SiteEditor::editBlock() {
    const int i = blocks->currentRow(); QJsonArray bl = blockList();
    if (i < 0 || i >= bl.size()) return;
    QJsonObject b = bl[i].toObject();
    const QJsonObject def = Site::block(b.value("type").toString());
    PropsDialog dlg(this, t(def.value("label").toString()), def.value("fields").toArray(), b.value("props").toObject());
    if (dlg.exec()) { b["props"] = dlg.values; bl[i] = b; setBlocks(bl); refreshBlocks(i); }
}
void SiteEditor::dupBlock() {
    const int i = blocks->currentRow(); QJsonArray bl = blockList();
    if (i < 0 || i >= bl.size()) return;
    QJsonObject c = bl[i].toObject(); c["id"] = Site::uid(); bl.insert(i + 1, c); setBlocks(bl); refreshBlocks(i + 1);
}
void SiteEditor::moveBlock(int n) {
    const int i = blocks->currentRow(); QJsonArray bl = blockList();
    if (i < 0 || i + n < 0 || i + n >= bl.size()) return;
    const QJsonValue a = bl[i]; bl[i] = bl[i + n]; bl[i + n] = a; setBlocks(bl); refreshBlocks(i + n);
}
void SiteEditor::delBlock() { const int i = blocks->currentRow(); QJsonArray bl = blockList(); if (i >= 0 && i < bl.size()) { bl.removeAt(i); setBlocks(bl); refreshBlocks(i); } }
void SiteEditor::refreshProducts(int sel) {
    QList<QStringList> rows; QList<QJsonObject> pay;
    const QJsonArray fs = productFields();
    for (const QJsonValue& pv : products()) { QStringList r; for (const QJsonValue& f : fs) r << SiteRender::js(pv.toObject().value(f.toObject().value("key").toString())); rows << r; pay << QJsonObject(); }
    Ui::fill(prod, rows, pay);
    if (!rows.isEmpty()) prod->selectRow(std::min(sel, int(rows.size()) - 1));
}
void SiteEditor::addProd() {
    QJsonArray ps = products();
    ps.append(QJsonObject{{"sku", QString("SKU%1").arg(ps.size() + 1)}, {"name", ""}, {"price", 0}, {"category", ""}, {"description", ""}, {"image", ""}});
    setProducts(ps); refreshProducts(ps.size() - 1); editProd();
}
void SiteEditor::editProd() {
    const int i = prod->currentRow(); QJsonArray ps = products();
    if (i < 0 || i >= ps.size()) return;
    PropsDialog dlg(this, t("web.edit"), productFields(), ps[i].toObject());
    if (dlg.exec()) { ps[i] = dlg.values; setProducts(ps); refreshProducts(i); }
}
void SiteEditor::delProd() { const int i = prod->currentRow(); QJsonArray ps = products(); if (i >= 0 && i < ps.size()) { ps.removeAt(i); setProducts(ps); refreshProducts(i); } }
void SiteEditor::sync() {
    Api::I().call("GET", "/pos/records/product", QJsonValue(), this, [this](const QJsonValue& v) {
        QMap<QString, QJsonObject> old; for (const QJsonValue& p : products()) old[p.toObject().value("sku").toString()] = p.toObject();
        QJsonArray out;
        for (const QJsonValue& rv : v.toArray()) {
            const QJsonObject r = rv.toObject(), data = r.value("data").toObject();
            const QString code = r.value("code").toString();
            if (code.isEmpty() || r.value("status").toString() == "inactive") continue;
            const QJsonObject prev = old.value(code);
            out.append(QJsonObject{{"sku", code}, {"name", data.value("name").toString(code)}, {"price", data.value("price").toDouble()}, {"category", data.value("category").toString()}, {"description", prev.value("description").toString()},
                {"image", prev.contains("image") && !prev.value("image").toString().isEmpty() ? prev.value("image").toString() : (data.value("image").isString() ? data.value("image").toString() : QString())}});
        }
        setProducts(out); shopOn->setChecked(true); refreshProducts(); msg->setText(QString::number(out.size()));
    }, [this](const QString&) { msg->setText(t("web.syncFail")); });
}
QJsonObject SiteEditor::collect() {
    QJsonObject th = d.value("theme").toObject(), st = d.value("settings").toObject(), shop = d.value("shop").toObject();
    if (!prim->text().trimmed().isEmpty()) th["primary"] = prim->text().trimmed();
    if (!bg->text().trimmed().isEmpty()) th["bg"] = bg->text().trimmed();
    if (!tx->text().trimmed().isEmpty()) th["text"] = tx->text().trimmed();
    th["font"] = font->currentData().toString(); th["dark"] = dark->isChecked();
    bool ok = false; const int rad = int(radius->text().toDouble(&ok)); if (ok) th["radius"] = rad;
    st["title"] = title->text().trimmed().isEmpty() ? row.value("name").toString() : title->text().trimmed();
    st["lang"] = lang->text().trimmed().isEmpty() ? QString("en") : lang->text().trimmed(); st["dir"] = dir->currentData().toString();
    if (!desc->text().trimmed().isEmpty()) st["description"] = desc->text().trimmed(); else st.remove("description");
    shop["enabled"] = shopOn->isChecked(); if (!cur->text().trimmed().isEmpty()) shop["currency"] = cur->text().trimmed();
    d["theme"] = th; d["settings"] = st; d["shop"] = shop;
    return d;
}
void SiteEditor::save() {
    const QJsonObject dd = collect();
    Api::I().call("PUT", "/website/sites/" + row.value("id").toString(), QJsonObject{{"name", row.value("name")}, {"design", dd}}, this, [this](const QJsonValue&) { msg->setText(t("web.saved")); onSaved(); }, [this](const QString& e) { msg->setText(e); });
}
static void previewHtml(const QString& html, const QString& slug) {
    const QString path = QDir(QStandardPaths::writableLocation(QStandardPaths::TempLocation)).filePath((slug.isEmpty() ? QString("site") : slug) + "-preview.html");
    QFile f(path);
    if (f.open(QIODevice::WriteOnly)) { f.write(html.toUtf8()); f.close(); QDesktopServices::openUrl(QUrl::fromLocalFile(path)); }
}
void SiteEditor::preview() { previewHtml(SiteRender::render(collect()), row.value("slug").toString()); }

// ------------------------------------------------------------------ page
SitePage::SitePage() {
    auto* l = new QVBoxLayout(this);
    l->addWidget(Ui::label(t("tab.web"), "title"));
    auto* bar = new QHBoxLayout;
    pick = new QComboBox;
    pick->addItem(t("web.sites"), "sites");
    if (Api::I().can("web.orders.manage")) pick->addItem(t("web.orders"), "subs");
    connect(pick, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this] { reload(); });
    bar->addWidget(pick);
    struct B { const char* key; QString text; std::function<void()> fn; const char* kind; };
    const QList<B> bs = {{"new", t("web.newSite"), [this] { newSite(); }, ""}, {"design", t("web.design"), [this] { design(); }, ""}, {"preview", t("web.preview"), [this] { preview(); }, "ghost"}, {"save", t("web.download"), [this] { saveHtml(); }, "ghost"},
        {"pub", t("web.publish"), [this] { publish(); }, ""}, {"unpub", t("web.unpublish"), [this] { unpublish(); }, "ghost"}, {"del", QString::fromUtf8("✕"), [this] { del(); }, "danger"},
        {"s_new", t("web.st.new"), [this] { status("new"); }, "ghost"}, {"s_conf", t("web.st.confirmed"), [this] { status("confirmed"); }, "ghost"}, {"s_ship", t("web.st.shipped"), [this] { status("shipped"); }, "ghost"},
        {"s_done", t("web.st.done"), [this] { status("done"); }, "ghost"}, {"s_can", t("web.st.cancelled"), [this] { status("cancelled"); }, "ghost"}};
    for (const B& b : bs) { auto* btn = Ui::button(b.text, b.fn, b.kind); btns[b.key] = btn; bar->addWidget(btn); }
    bar->addStretch(1);
    l->addLayout(bar);
    table = Ui::table({});
    l->addWidget(table, 1);
    msg = new QLabel;
    l->addWidget(msg);
}
void SitePage::reload() {
    const bool subs = mode() == "subs";
    for (auto it = btns.begin(); it != btns.end(); ++it) {
        const QString k = it.key();
        bool vis;
        if (k.startsWith("s_")) vis = subs;
        else if (k == "new" || k == "design") vis = !subs && Api::I().can("web.edit");
        else if (k == "pub" || k == "unpub" || k == "del") vis = !subs && Api::I().can("web.publish");
        else vis = !subs;
        it.value()->setVisible(vis);
    }
    msg->setText(QString::fromUtf8("…"));
    if (subs) {
        table->setColumnCount(7);
        table->setHorizontalHeaderLabels({"#", t("web.site"), "Type", t("web.customer"), "Total", "Status", "Date"});
        Api::I().call("GET", "/website/sites", QJsonValue(), this, [this](const QJsonValue& s) {
            Api::I().call("GET", "/website/submissions", QJsonValue(), this, [this, s](const QJsonValue& v) { showSubs(v.toArray(), s.toArray()); }, [this](const QString& e) { msg->setText(e); });
        }, [this](const QString& e) { msg->setText(e); });
    } else {
        table->setColumnCount(5);
        table->setHorizontalHeaderLabels({t("web.siteName"), "URL", "Status", "Currency", t("web.view")});
        Api::I().call("GET", "/website/sites", QJsonValue(), this, [this](const QJsonValue& v) { showSites(v.toArray()); }, [this](const QString& e) { msg->setText(e); });
    }
}
void SitePage::showSites(const QJsonArray& rows) {
    sites = rows;
    QList<QStringList> cells; QList<QJsonObject> pay;
    for (const QJsonValue& rv : rows) { const QJsonObject r = rv.toObject(); cells << QStringList{r.value("name").toString(), "/s/" + r.value("slug").toString(), r.value("published").toBool() ? t("web.live") : t("web.draft"), r.value("currency").toString(), r.value("updatedAt").toString().left(16).replace('T', ' ')}; pay << r; }
    Ui::fill(table, cells, pay);
    msg->setText(rows.isEmpty() ? t("web.none") : QString());
}
void SitePage::showSubs(const QJsonArray& subs, const QJsonArray& sitesArr) {
    QMap<QString, QString> names; for (const QJsonValue& s : sitesArr) names[s.toObject().value("id").toString()] = s.toObject().value("name").toString();
    QList<QStringList> cells; QList<QJsonObject> pay;
    for (const QJsonValue& sv : subs) {
        const QJsonObject s = sv.toObject();
        cells << QStringList{s.value("number").toString(), names.value(s.value("siteId").toString()), s.value("kind").toString(), s.value("name").toString() + (s.value("email").toString().isEmpty() ? "" : " · " + s.value("email").toString()),
            s.value("kind").toString() == "order" ? SiteRender::js(s.value("total")) + " " + s.value("currency").toString() : s.value("note").toString().left(40), s.value("status").toString(), s.value("createdAt").toString().left(16).replace('T', ' ')};
        pay << s;
    }
    Ui::fill(table, cells, pay);
    msg->setText(subs.isEmpty() ? t("web.none") : QString());
}
void SitePage::newSite() {
    QDialog d(this); d.setWindowTitle(t("web.newSite"));
    auto* f = new QFormLayout(&d);
    auto* name = new QLineEdit; auto* tpl = new QComboBox; auto* cur = new QLineEdit("SAR");
    for (const char* k : {"shop", "business", "blank"}) tpl->addItem(t(QString("web.t.") + k), k);
    f->addRow(t("web.siteName"), name); f->addRow(t("web.template"), tpl); f->addRow(t("web.currency"), cur);
    f->addRow(Ui::button(t("web.create"), [&d] { d.accept(); }));
    if (!d.exec() || name->text().trimmed().isEmpty()) return;
    const QString c = cur->text().trimmed().isEmpty() ? QString("SAR") : cur->text().trimmed();
    const QJsonObject design = Site::templateDesign(tpl->currentData().toString(), name->text().trimmed(), c);
    Api::I().call("POST", "/website/sites", QJsonObject{{"name", name->text().trimmed()}, {"design", design}, {"currency", c}}, this, [this](const QJsonValue& v) { reload(); openEditor(v.toObject()); }, [this](const QString& e) { Ui::warn(this, e); });
}
void SitePage::openEditor(const QJsonObject& row) {
    Api::I().call("GET", "/website/sites/" + row.value("id").toString(), QJsonValue(), this, [this](const QJsonValue& v) { SiteEditor ed(this, v.toObject(), v.toObject().value("design").toObject(), [this] { reload(); }); ed.exec(); }, [this](const QString& e) { Ui::warn(this, e); });
}
void SitePage::design() { QJsonObject r; if (Ui::selected(table, r) && !r.isEmpty()) openEditor(r); }
void SitePage::fetchDesign(std::function<void(const QJsonObject&, const QJsonObject&)> then) {
    QJsonObject r; if (!Ui::selected(table, r) || r.isEmpty()) return;
    Api::I().call("GET", "/website/sites/" + r.value("id").toString(), QJsonValue(), this, [r, then](const QJsonValue& v) { then(r, v.toObject().value("design").toObject()); }, [this](const QString& e) { Ui::warn(this, e); });
}
QString SitePage::htmlFor(const QJsonObject& row, const QJsonObject& d, bool pub) const {
    if (!pub) return SiteRender::render(d);
    const QString base = Site::publicBase(), slug = row.value("slug").toString();
    return SiteRender::render(d, base + "/public/sites/" + slug + "/orders", base + "/public/sites/" + slug + "/messages", "publish");
}
void SitePage::preview() { fetchDesign([this](const QJsonObject& r, const QJsonObject& d) { previewHtml(htmlFor(r, d, false), r.value("slug").toString()); }); }
void SitePage::saveHtml() {
    fetchDesign([this](const QJsonObject& r, const QJsonObject& d) {
        const QString path = QFileDialog::getSaveFileName(this, t("web.download"), r.value("slug").toString() + ".html", "HTML (*.html)");
        if (path.isEmpty()) return;
        QFile f(path); if (f.open(QIODevice::WriteOnly)) { f.write(htmlFor(r, d, false).toUtf8()); msg->setText(path); }
    });
}
void SitePage::publish() {
    fetchDesign([this](const QJsonObject& r, const QJsonObject& d) {
        QJsonArray prods;
        for (const QJsonValue& pv : d.value("shop").toObject().value("products").toArray()) prods.append(QJsonObject{{"sku", pv.toObject().value("sku")}, {"name", pv.toObject().value("name")}, {"price", pv.toObject().value("price")}});
        Api::I().call("POST", "/website/sites/" + r.value("id").toString() + "/publish", QJsonObject{{"html", htmlFor(r, d, true)}, {"products", prods}, {"currency", d.value("shop").toObject().value("currency")}}, this,
            [this](const QJsonValue&) { reload(); msg->setText(t("web.isLive")); }, [this](const QString& e) { Ui::warn(this, e); });
    });
}
void SitePage::unpublish() { QJsonObject r; if (Ui::selected(table, r) && !r.isEmpty()) Api::I().call("POST", "/website/sites/" + r.value("id").toString() + "/unpublish", QJsonObject(), this, [this](const QJsonValue&) { reload(); }, [this](const QString& e) { Ui::warn(this, e); }); }
void SitePage::del() {
    QJsonObject r; if (!Ui::selected(table, r) || r.isEmpty()) return;
    QString q = t("web.deleteAsk"); q.replace("{n}", r.value("name").toString());
    if (Ui::ask(this, q, t("cal.delete"), t("cal.close"))) Api::I().call("DELETE", "/website/sites/" + r.value("id").toString(), QJsonValue(), this, [this](const QJsonValue&) { reload(); }, [this](const QString& e) { Ui::warn(this, e); });
}
void SitePage::status(const QString& s) { QJsonObject r; if (Ui::selected(table, r) && !r.isEmpty()) Api::I().call("PUT", "/website/submissions/" + r.value("id").toString(), QJsonObject{{"status", s}}, this, [this](const QJsonValue&) { reload(); }, [this](const QString& e) { Ui::warn(this, e); }); }
