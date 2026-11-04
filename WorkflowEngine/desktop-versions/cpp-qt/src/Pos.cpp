#include "Pos.h"

#include <QApplication>
#include <QDate>
#include <QHeaderView>
#include <QDateTime>
#include <QFormLayout>
#include <QFrame>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QPrintDialog>
#include <QPrinter>
#include <QSettings>
#include <QTextBrowser>
#include <QTextDocument>
#include <QUuid>
#include <cmath>
#include <memory>

#include "Api.h"
#include "I18n.h"
#include "Ui.h"

using I18n::t;

namespace Pos {
double r2(double n) { return std::round((n + 1e-9) * 100.0) / 100.0; }
QString money(double v) { return QLocale(QLocale::English).toString(v, 'f', 2); }

static QString str(const QJsonValue& v) { return v.isString() ? v.toString() : v.isNull() || v.isUndefined() ? QString() : v.toVariant().toString(); }
static QJsonObject defaults() {
    return QJsonObject{{"taxRate", 15}, {"pricesIncludeTax", true}, {"pointsPerCurrency", 1}, {"pointValue", 0.05}, {"requireShift", true}, {"allowNegativeStock", false}, {"maxDiscountPct", 20}};
}
static QJsonObject cfgOf(const QJsonObject& c) { QJsonObject o = defaults(); for (auto it = c.begin(); it != c.end(); ++it) o[it.key()] = it.value(); return o; }

static void bestPromo(const QJsonArray& promos, const QString& sku, const QString& category, double qty, double price, double& disc, QString& code) {
    disc = 0; code.clear();
    const QString today = QDate::currentDate().toString("yyyy-MM-dd");
    for (const QJsonValue& v : promos) {
        const QJsonObject pr = v.toObject(), p = pr.value("data").toObject();
        if (!pr.value("status").toString().isEmpty() && pr.value("status").toString() != "Active") continue;
        if (!str(p.value("from")).isEmpty() && today < str(p.value("from")).left(10)) continue;
        if (!str(p.value("to")).isEmpty() && today > str(p.value("to")).left(10)) continue;
        const QString scope = p.value("scope").toString("all"), target = str(p.value("target")).toLower();
        if (scope == "sku" && target != sku.toLower()) continue;
        if (scope == "category" && target != category.toLower()) continue;
        const double gross = price * qty, val = p.value("value").toDouble();
        double d = 0;
        const QString ty = p.value("type").toString();
        if (ty == "pct") d = gross * val / 100;
        else if (ty == "amount") d = std::min(gross, val * qty);
        else if (ty == "qty" && qty >= std::max(1.0, p.value("minQty").toDouble(1))) d = gross * val / 100;
        if (d > disc) { disc = d; code = str(pr.value("code")); }
    }
    disc = r2(disc);
}

Priced priceCart(const QJsonArray& items, const QJsonArray& products, const QJsonArray& promos, const QJsonObject& customer, double orderPct, const QJsonObject& cfgIn) {
    const QJsonObject s = cfgOf(cfgIn);
    const double custPct = customer.value("data").toObject().value("discountPct").toDouble();
    Priced out;
    for (const QJsonValue& iv : items) {
        const QJsonObject it = iv.toObject();
        const QString sku = it.value("sku").toString();
        QJsonObject p;
        for (const QJsonValue& pv : products) if (pv.toObject().value("code").toString().compare(sku, Qt::CaseInsensitive) == 0) { p = pv.toObject(); break; }
        if (p.isEmpty()) continue;
        const QJsonObject d = p.value("data").toObject();
        const double qty = it.value("qty").toDouble(), price = d.value("price").toDouble();
        const double gross = r2(price * qty);
        double pd; QString pcode;
        bestPromo(promos, p.value("code").toString(), str(d.value("category")), qty, price, pd, pcode);
        double rest = gross - pd;
        const double manual = r2(rest * it.value("discountPct").toDouble() / 100); rest -= manual;
        const double cust = r2(rest * custPct / 100); rest -= cust;
        const double ord = r2(rest * orderPct / 100); rest -= ord;
        double net = r2(rest), tax;
        const QJsonValue tr = d.value("taxRate");
        const double rate = (tr.isNull() || tr.isUndefined() || str(tr).isEmpty()) ? s.value("taxRate").toDouble() : tr.toDouble();
        if (s.value("pricesIncludeTax").toBool()) tax = r2(net - net / (1 + rate / 100));
        else { tax = r2(net * rate / 100); net = r2(net + tax); }
        out.lines << QJsonObject{{"sku", p.value("code")}, {"name", d.value("name").toString(p.value("code").toString())}, {"qty", qty}, {"price", price}, {"gross", gross}, {"promo", pd},
                                 {"promoCode", pcode}, {"discount", r2(pd + manual + cust + ord)}, {"tax", tax}, {"total", net}, {"discountPct", it.value("discountPct").toDouble()}};
    }
    for (const auto& l : out.lines) { out.subtotal += l["gross"].toDouble(); out.discount += l["discount"].toDouble(); out.tax += l["tax"].toDouble(); out.total += l["total"].toDouble(); }
    out.subtotal = r2(out.subtotal); out.discount = r2(out.discount); out.tax = r2(out.tax); out.total = r2(out.total);
    return out;
}

static QString esc(const QString& s) { return s.toHtmlEscaped(); }

QString receiptHtml(const QJsonObject& sale, const QJsonObject& settings) {
    const QJsonObject d = sale.value("data").toObject();
    QString rows;
    for (const QJsonValue& v : d.value("lines").toArray()) {
        const QJsonObject l = v.toObject();
        rows += "<tr><td>" + esc(l["name"].toString()) + "<br><small>" + QString::number(l["qty"].toDouble()) + " × " + money(l["price"].toDouble()) +
                (l["discount"].toDouble() ? " · −" + money(l["discount"].toDouble()) : QString()) + "</small></td><td align='right'>" + money(l["total"].toDouble()) + "</td></tr>";
    }
    QString pays;
    for (const QJsonValue& v : d.value("payments").toArray()) pays += "<tr><td>" + t("pos.pay." + v.toObject()["method"].toString()) + "</td><td align='right'>" + money(v.toObject()["amount"].toDouble()) + "</td></tr>";
    const QString title = d.value("type").toString() == "Return" ? t("pos.rc.return") : t("pos.rc.receipt");
    QString h = "<div style='font-family:Consolas,monospace;font-size:12px;width:290px'><div align='center'><b>" + esc(Api::I().tenant) + "</b><br>" + esc(settings.value("receiptHeader").toString()) + "</div><hr>";
    h += "<table width='100%'><tr><td>" + title + "</td><td align='right'>" + esc(sale.value("code").toString()) + "</td></tr>";
    if (!str(sale.value("parent")).isEmpty()) h += "<tr><td>" + t("pos.rc.original") + "</td><td align='right'>" + esc(str(sale.value("parent"))) + "</td></tr>";
    h += "<tr><td>" + esc(str(sale.value("createdAt")).left(16).replace('T', ' ')) + "</td><td align='right'>" + esc(str(d.value("cashier"))) + "</td></tr>";
    if (!str(d.value("customerName")).isEmpty()) h += "<tr><td>" + t("pos.customer") + "</td><td align='right'>" + esc(str(d.value("customerName"))) + "</td></tr>";
    h += "</table><hr><table width='100%'>" + rows + "</table><hr><table width='100%'>";
    if (d.value("subtotal").toDouble()) h += "<tr><td>" + t("pos.subtotal") + "</td><td align='right'>" + money(d["subtotal"].toDouble()) + "</td></tr>";
    if (d.value("discount").toDouble()) h += "<tr><td>" + t("pos.discount") + "</td><td align='right'>−" + money(d["discount"].toDouble()) + "</td></tr>";
    h += "<tr><td>" + t("pos.tax") + "</td><td align='right'>" + money(d["tax"].toDouble()) + "</td></tr><tr><td><b>" + t("pos.total") + "</b></td><td align='right'><b>" + money(d["total"].toDouble()) + "</b></td></tr>" + pays;
    if (d.value("change").toDouble()) h += "<tr><td>" + t("pos.change") + "</td><td align='right'>" + money(d["change"].toDouble()) + "</td></tr>";
    if (d.value("earned").toDouble()) h += "<tr><td>" + t("pos.pointsEarned") + "</td><td align='right'>" + QString::number(d["earned"].toInt()) + "</td></tr>";
    h += "</table><hr><div align='center'>" + esc(settings.value("receiptFooter").toString()) + "<br><small>" + t("pos.rc.thanks") + "</small></div></div>";
    return h;
}

void State::load(QObject* ctx, std::function<void()> done, std::function<void(const QString&)> err) {
    struct Job { int left = 7; bool failed = false; };
    auto job = std::make_shared<Job>();
    auto one = [this, job, done] { if (--job->left == 0) { loaded = true; done(); } };
    auto list = [this, ctx, err, job, one](const QString& kind, std::function<void(const QJsonArray&)> set, bool must) {
        Api::I().call("GET", "/pos/records/" + kind + "?take=5000", QJsonValue(), ctx, [set, one](const QJsonValue& v) { set(v.toArray()); one(); },
                      [err, job, one, must](const QString& m) { if (must && !job->failed) { job->failed = true; err(m); } one(); });
    };
    list("product", [this](const QJsonArray& a) { products = a; }, true);
    list("category", [this](const QJsonArray& a) { categories = a; }, false);
    list("customer", [this](const QJsonArray& a) { customers = a; }, false);
    list("promotion", [this](const QJsonArray& a) { promos = a; }, false);
    list("register", [this](const QJsonArray& a) { registers = a; }, false);
    list("setting", [this](const QJsonArray& a) { settings = QJsonObject(); for (const auto& v : a) if (v.toObject()["code"].toString() == "pos") settings = v.toObject()["data"].toObject(); settings = cfgOf(settings); }, false);
    // the stock list and the open shift arrive together
    Api::I().call("GET", "/pos/shifts/current", QJsonValue(), ctx, [this, ctx, one](const QJsonValue& v) {
        shift = v.isObject() ? v.toObject() : QJsonObject();
        Api::I().call("GET", "/pos/records/stock?take=5000", QJsonValue(), ctx, [this, one](const QJsonValue& s) {
            stock.clear();
            for (const auto& x : s.toArray()) stock[str(x.toObject()["data"].toObject()["sku"])] = x.toObject()["data"].toObject()["qty"].toDouble();
            one();
        }, [one](const QString&) { one(); });
    }, [err, job, one](const QString& m) { if (!job->failed) { job->failed = true; err(m); } one(); });
    job->left = 7;   // product, category, customer, promotion, register, setting, shift+stock
}
}  // namespace Pos

using Pos::money;

static QDoubleSpinBox* numEdit() {
    auto* s = new QDoubleSpinBox;
    s->setDecimals(2); s->setRange(0, 1e9); s->setSingleStep(1);
    return s;
}

static bool looksOffline(const QString& m) {
    const QString l = m.toLower();
    for (const char* k : {"refused", "unreachable", "timed out", "host", "closed", "network", "connection"}) if (l.contains(k)) return true;
    return false;
}

static QJsonArray offlineQueue() {
    return QJsonDocument::fromJson(QSettings("WorkflowEngine", "ErpQt").value("pos_queue", "[]").toString().toUtf8()).array();
}
static void saveQueue(const QJsonArray& a) { QSettings("WorkflowEngine", "ErpQt").setValue("pos_queue", QString::fromUtf8(QJsonDocument(a).toJson(QJsonDocument::Compact))); }

// ---------------------------------------------------------------- dialogs
static void showReceipt(QWidget* parent, const QJsonObject& sale, const Pos::State* st, const QString& title) {
    QDialog d(parent);
    d.setWindowTitle(title);
    d.setMinimumSize(360, 520);
    auto* lay = new QVBoxLayout(&d);
    auto* view = new QTextBrowser;
    const QString html = Pos::receiptHtml(sale, st->settings);
    view->setHtml(html);
    lay->addWidget(view, 1);
    auto* row = new QHBoxLayout;
    row->addStretch(1);
    row->addWidget(Ui::button(t("pos.print"), [&d, html] {
        QPrinter pr(QPrinter::HighResolution);
        if (QPrintDialog(&pr, &d).exec()) { QTextDocument doc; doc.setHtml(html); doc.print(&pr); }
    }, "ghost"));
    row->addWidget(Ui::button(t("common.ok"), [&d] { d.accept(); }));
    lay->addLayout(row);
    d.exec();
}

namespace {
struct PayDlg : QDialog {
    QDoubleSpinBox *cash, *card, *other;
    QSpinBox* redeem;
    QLabel* sum;
    QPushButton* ok;
    double total, pointValue;
    PayDlg(double tot, const QJsonObject& customer, const QJsonObject& settings, QWidget* parent) : QDialog(parent), total(tot), pointValue(settings.value("pointValue").toDouble(0.05)) {
        setWindowTitle(t("pos.pay") + " · " + money(tot));
        setMinimumWidth(380);
        auto* lay = new QVBoxLayout(this);
        auto* form = new QFormLayout;
        cash = numEdit(); card = numEdit(); other = numEdit();
        for (auto* w : {cash, card, other}) connect(w, &QDoubleSpinBox::valueChanged, this, [this] { recalc(); });
        form->addRow(t("pos.pay.cash"), cash); form->addRow(t("pos.pay.card"), card); form->addRow(t("pos.pay.other"), other);
        const int pts = customer.value("data").toObject().value("points").toInt();
        redeem = new QSpinBox; redeem->setRange(0, pts);
        connect(redeem, &QSpinBox::valueChanged, this, [this] { recalc(); });
        if (pts > 0) form->addRow(t("pos.redeem") + " (" + QString::number(pts) + ")", redeem);
        lay->addLayout(form);
        auto* quick = new QHBoxLayout;
        quick->addWidget(Ui::button(t("pos.exactCash"), [this] { exact(cash); }, "ghost"));
        quick->addWidget(Ui::button(t("pos.exactCard"), [this] { exact(card); }, "ghost"));
        for (int n : {50, 100, 200, 500}) quick->addWidget(Ui::button(QString::number(n), [this, n] { card->setValue(0); other->setValue(0); cash->setValue(n); }, "ghost"));
        lay->addLayout(quick);
        sum = new QLabel; sum->setTextFormat(Qt::RichText);
        lay->addWidget(sum);
        auto* row = new QHBoxLayout;
        row->addStretch(1);
        row->addWidget(Ui::button(t("common.cancel"), [this] { reject(); }, "ghost"));
        ok = Ui::button(t("pos.complete"), [this] { accept(); });
        row->addWidget(ok);
        lay->addLayout(row);
        recalc();
    }
    double redeemValue() const { return Pos::r2(redeem->value() * pointValue); }
    double due() const { return Pos::r2(std::max(0.0, total - std::min(redeemValue(), total))); }
    double tendered() const { return Pos::r2(cash->value() + card->value() + other->value()); }
    double remaining() const { return Pos::r2(due() - tendered()); }
    void exact(QDoubleSpinBox* w) { cash->setValue(0); card->setValue(0); other->setValue(0); w->setValue(due()); }
    void recalc() {
        const double rem = remaining();
        sum->setText(t("pos.due") + ": <b>" + money(due()) + "</b><br>" + t("pos.tendered") + ": <b>" + money(tendered()) + "</b><br><span style='color:" + (rem > 0 ? "#dc2626" : "#16a34a") + "'>" +
                     (rem > 0 ? t("pos.remaining") : t("pos.change")) + ": <b>" + money(std::fabs(rem)) + "</b></span>");
        ok->setEnabled(rem <= 0.004);
    }
    QJsonArray payments() const {
        QJsonArray a;
        if (cash->value() > 0) a.append(QJsonObject{{"method", "cash"}, {"amount", cash->value()}});
        if (card->value() > 0) a.append(QJsonObject{{"method", "card"}, {"amount", card->value()}});
        if (other->value() > 0) a.append(QJsonObject{{"method", "other"}, {"amount", other->value()}});
        return a;
    }
};

struct AmountDlg : QDialog {
    QDoubleSpinBox* amount;
    QLineEdit* note;
    AmountDlg(const QString& title, const QString& al, const QString& nl, const QString& hint, QWidget* parent) : QDialog(parent) {
        setWindowTitle(title);
        setMinimumWidth(340);
        auto* lay = new QVBoxLayout(this);
        auto* form = new QFormLayout;
        amount = numEdit(); note = new QLineEdit;
        form->addRow(al, amount); form->addRow(nl, note);
        lay->addLayout(form);
        if (!hint.isEmpty()) lay->addWidget(Ui::label(hint, "dim"));
        auto* row = new QHBoxLayout;
        row->addStretch(1);
        row->addWidget(Ui::button(t("common.cancel"), [this] { reject(); }, "ghost"));
        row->addWidget(Ui::button(t("admin.save"), [this] { accept(); }));
        lay->addLayout(row);
    }
};

struct ReturnDlg : QDialog {
    QList<QPair<QString, QSpinBox*>> spins;
    QComboBox* method;
    QLineEdit* reason;
    QLabel* err;
    ReturnDlg(const QJsonObject& sale, QWidget* parent) : QDialog(parent) {
        setWindowTitle(t("pos.rc.return") + " · " + sale.value("code").toString());
        setMinimumWidth(480);
        auto* lay = new QVBoxLayout(this);
        auto* form = new QFormLayout;
        for (const QJsonValue& v : sale.value("data").toObject().value("lines").toArray()) {
            const QJsonObject l = v.toObject();
            auto* sp = new QSpinBox;
            sp->setRange(0, std::max(0, int(l["qty"].toDouble() - l["returned"].toDouble())));
            spins << qMakePair(l["sku"].toString(), sp);
            form->addRow(l["name"].toString() + "  (" + t("pos.sold") + " " + QString::number(l["qty"].toDouble()) + " / " + t("pos.alreadyReturned") + " " + QString::number(l["returned"].toDouble()) + ")", sp);
        }
        lay->addLayout(form);
        auto* f2 = new QFormLayout;
        method = new QComboBox; method->addItem(t("pos.pay.cash"), "cash"); method->addItem(t("pos.pay.card"), "card");
        reason = new QLineEdit;
        f2->addRow(t("pos.refundMethod"), method); f2->addRow(t("pos.reason"), reason);
        lay->addLayout(f2);
        err = Ui::label("", "error");
        lay->addWidget(err);
        auto* row = new QHBoxLayout;
        row->addStretch(1);
        row->addWidget(Ui::button(t("common.cancel"), [this] { reject(); }, "ghost"));
        row->addWidget(Ui::button(t("pos.rc.return"), [this] { if (lines().isEmpty()) err->setText(t("pos.pickReturn")); else accept(); }));
        lay->addLayout(row);
    }
    QJsonArray lines() const {
        QJsonArray a;
        for (const auto& p : spins) if (p.second->value() > 0) a.append(QJsonObject{{"sku", p.first}, {"qty", p.second->value()}});
        return a;
    }
};
}  // namespace

// ---------------------------------------------------------------- till
TillView::TillView(Pos::State* s, std::function<void()> shiftCb) : st(s), onShift(std::move(shiftCb)) {
    auto* root = new QVBoxLayout(this);
    banner = Ui::label("", "error");
    root->addWidget(banner);
    auto* qrow = new QHBoxLayout;
    queueLbl = Ui::label("", "dim");
    queueBtn = Ui::button(t("pos.syncNow"), [this] { flush(); }, "ghost");
    qrow->addWidget(queueLbl, 1); qrow->addWidget(queueBtn);
    root->addLayout(qrow);
    auto* g = new QFrame; g->setProperty("card", true);
    gate = g;
    auto* gl = new QVBoxLayout(g);
    gl->addWidget(Ui::label(t("pos.shift.none"), "title"));
    gl->addWidget(Ui::label(t("pos.shift.noneHint"), "dim"));
    auto* gf = new QFormLayout;
    reg = new QComboBox; floatBox = numEdit();
    gf->addRow(t("pos.register"), reg); gf->addRow(t("pos.shift.opening"), floatBox);
    gl->addLayout(gf);
    gl->addWidget(Ui::button(t("pos.shift.open"), [this] { openShift(floatBox->value()); }));
    root->addWidget(gate);
    till = new QWidget;
    auto* h = new QHBoxLayout(till);
    auto* left = new QVBoxLayout;
    auto* bar = new QHBoxLayout;
    q = new QLineEdit; q->setPlaceholderText(t("pos.scan"));
    connect(q, &QLineEdit::textChanged, this, [this] { fillProducts(); });
    connect(q, &QLineEdit::returnPressed, this, [this] { scan(); });
    cat = new QComboBox;
    connect(cat, &QComboBox::currentIndexChanged, this, [this] { fillProducts(); });
    shiftLbl = Ui::label("", "dim");
    bar->addWidget(q, 1); bar->addWidget(cat); bar->addWidget(shiftLbl);
    left->addLayout(bar);
    grid = new QListWidget;
    grid->setViewMode(QListWidget::IconMode); grid->setResizeMode(QListWidget::Adjust); grid->setMovement(QListWidget::Static);
    grid->setSpacing(6); grid->setWordWrap(true); grid->setUniformItemSizes(true); grid->setGridSize(QSize(196, 104)); grid->setTextElideMode(Qt::ElideNone);
    connect(grid, &QListWidget::itemClicked, this, [this](QListWidgetItem* it) { add(it->data(Qt::UserRole).toString()); });
    left->addWidget(grid, 1);
    h->addLayout(left, 3);
    auto* right = new QFrame; right->setProperty("card", true); right->setMinimumWidth(360);
    auto* r = new QVBoxLayout(right);
    cust = new QComboBox;
    connect(cust, &QComboBox::currentIndexChanged, this, [this] { customerCode = cust->currentData().toString(); repaintCart(); });
    r->addWidget(cust);
    custInfo = Ui::label("", "dim");
    r->addWidget(custInfo);
    lines = Ui::table({t("pos.product"), "#", t("pos.total")});
    lines->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
    r->addWidget(lines, 1);
    auto* br = new QHBoxLayout;
    br->addWidget(Ui::button("−", [this] { const int i = sel(); if (i < 0) return; QJsonObject l = cart[i].toObject(); l["qty"] = l["qty"].toDouble() - 1; if (l["qty"].toDouble() <= 0) cart.removeAt(i); else cart[i] = l; repaintCart(); }, "ghost"));
    br->addWidget(Ui::button("+", [this] { const int i = sel(); if (i < 0) return; QJsonObject l = cart[i].toObject(); l["qty"] = l["qty"].toDouble() + 1; cart[i] = l; repaintCart(); }, "ghost"));
    br->addWidget(Ui::button("✕", [this] { const int i = sel(); if (i >= 0) { cart.removeAt(i); repaintCart(); } }, "ghost"));
    lineDisc = new QSpinBox; lineDisc->setRange(0, 100); lineDisc->setSuffix(" %"); lineDisc->setToolTip(t("pos.lineDisc"));
    connect(lineDisc, &QSpinBox::valueChanged, this, [this](int v) { setLineDisc(sel(), v); });
    br->addWidget(lineDisc);
    r->addLayout(br);
    auto* orow = new QHBoxLayout;
    orow->addWidget(new QLabel(t("pos.orderDisc")));
    order = new QSpinBox; order->setRange(0, 100); order->setSuffix(" %");
    connect(order, &QSpinBox::valueChanged, this, [this](int v) { orderPct = std::min(v, st->settings.value("maxDiscountPct").toInt(20)); repaintCart(); });
    orow->addWidget(order);
    r->addLayout(orow);
    tot = new QLabel; tot->setTextFormat(Qt::RichText); tot->setMinimumHeight(96);
    r->addWidget(tot);
    auto* b = new QHBoxLayout;
    holdB = Ui::button(t("pos.hold"), [this] { hold(); }, "ghost");
    recallB = Ui::button(t("pos.recall"), [this] { recall(); }, "ghost");
    clearB = Ui::button(t("pos.clear"), [this] { clear(); }, "ghost");
    payB = Ui::button(t("pos.pay"), [this] { pay(); });
    b->addWidget(holdB); b->addWidget(recallB); b->addWidget(clearB);
    r->addLayout(b);
    r->addWidget(payB);
    h->addWidget(right, 2);
    root->addWidget(till, 1);
}

int TillView::sel() const { const int r = lines->currentRow(); return r >= 0 && r < cart.size() ? r : -1; }

static bool isAr() { return I18n::rtl(); }

void TillView::refresh() {
    reg->clear(); reg->addItem("—", QString());
    for (const auto& v : st->registers) reg->addItem(v.toObject()["code"].toString() + " · " + v.toObject()["data"].toObject()["name"].toString(), v.toObject()["code"].toString());
    const bool g = st->shift.isEmpty() && st->settings.value("requireShift").toBool(true);
    gate->setVisible(g); till->setVisible(!g);
    shiftLbl->setText(st->shift.value("code").toString());
    QSignalBlocker b1(cat);
    cat->clear(); cat->addItem(t("pos.all"), QString());
    QStringList cats;
    for (const auto& v : st->products) { const QString c = Pos::str(v.toObject()["data"].toObject()["category"]); if (!c.isEmpty() && !cats.contains(c)) cats << c; }
    cats.sort();
    for (const QString& c : cats) {
        QString nm = c;
        for (const auto& cv : st->categories) if (cv.toObject()["code"].toString() == c) {
            const QJsonObject d = cv.toObject()["data"].toObject();
            nm = (isAr() && !d["nameAr"].toString().isEmpty()) ? d["nameAr"].toString() : d["name"].toString(c);
        }
        cat->addItem(nm, c);
    }
    QSignalBlocker b2(cust);
    cust->clear(); cust->addItem(t("pos.walkin"), QString());
    for (const auto& v : st->customers) cust->addItem(v.toObject()["data"].toObject()["name"].toString() + " · " + v.toObject()["code"].toString(), v.toObject()["code"].toString());
    cust->setCurrentIndex(std::max(0, cust->findData(customerCode)));
    fillProducts();
    repaintCart();
    updateQueue();
}

void TillView::updateQueue() {
    const int n = offlineQueue().size();
    queueLbl->setText(n ? t("pos.queued").replace("{n}", QString::number(n)) : QString());
    queueLbl->setVisible(n > 0); queueBtn->setVisible(n > 0);
}

double TillView::stockOf(const QJsonObject& p, bool& tracked) const {
    tracked = p["data"].toObject()["trackStock"].toBool();
    return tracked ? st->stock.value(p["code"].toString(), 0) : 0;
}

void TillView::fillProducts() {
    const QString qq = q->text().toLower().trimmed(), c = cat->currentData().toString();
    grid->clear();
    int n = 0;
    for (const auto& v : st->products) {
        const QJsonObject p = v.toObject(), d = p["data"].toObject();
        if (p["status"].toString() == "Inactive" || (!c.isEmpty() && Pos::str(d["category"]) != c)) continue;
        if (!qq.isEmpty() && !d["name"].toString().toLower().contains(qq) && !p["code"].toString().toLower().contains(qq) && !Pos::str(d["barcode"]).toLower().contains(qq)) continue;
        bool tr; const double s = stockOf(p, tr);
        bool promo = false;
        for (const auto& pv : st->promos) { const QJsonObject pr = pv.toObject(), pd = pr["data"].toObject(); if (pr["status"].toString() == "Active" && (pd["scope"].toString() == "all" || Pos::str(pd["target"]).toLower() == p["code"].toString().toLower())) promo = true; }
        auto* it = new QListWidgetItem(d["name"].toString() + "\n" + money(d["price"].toDouble()) + (promo ? " %" : "") + "\n" + p["code"].toString() + (tr ? " · " + t("pos.left").replace("{n}", QString::number(int(s))) : QString()));
        it->setData(Qt::UserRole, p["code"].toString());
        if (tr && s <= 0 && !st->settings.value("allowNegativeStock").toBool()) it->setFlags(Qt::NoItemFlags);
        grid->addItem(it);
        if (++n >= 80) break;
    }
}

Pos::Priced TillView::priced() const {
    QJsonObject cu;
    for (const auto& v : st->customers) if (v.toObject()["code"].toString() == customerCode) cu = v.toObject();
    return Pos::priceCart(cart, st->products, st->promos, cu, orderPct, st->settings);
}

void TillView::scan() {
    const QString s = q->text().trimmed().toLower();
    if (s.isEmpty()) return;
    for (const auto& v : st->products) {
        const QJsonObject p = v.toObject();
        if (p["code"].toString().toLower() == s || Pos::str(p["data"].toObject()["barcode"]).toLower() == s) { add(p["code"].toString()); q->clear(); return; }
    }
    if (grid->count() == 1) { add(grid->item(0)->data(Qt::UserRole).toString()); q->clear(); }
    else banner->setText(t("pos.notFound"));
}

void TillView::add(const QString& sku) {
    banner->clear();
    bool found = false;
    for (int i = 0; i < cart.size(); ++i) { QJsonObject l = cart[i].toObject(); if (l["sku"].toString() == sku) { l["qty"] = l["qty"].toDouble() + 1; cart[i] = l; found = true; break; } }
    if (!found) cart.append(QJsonObject{{"sku", sku}, {"qty", 1}, {"discountPct", 0}});
    repaintCart();
    lines->selectRow(lines->rowCount() - 1);
}

void TillView::setLineDisc(int row, int pct) {
    if (row < 0 || row >= cart.size()) return;
    QJsonObject l = cart[row].toObject();
    pct = std::min(pct, st->settings.value("maxDiscountPct").toInt(20));
    if (int(l["discountPct"].toDouble()) == pct) return;
    l["discountPct"] = pct; cart[row] = l;
    repaintCart();
    lines->selectRow(row);
}

void TillView::setCustomer(const QString& code) { customerCode = code; QSignalBlocker b(cust); cust->setCurrentIndex(std::max(0, cust->findData(code))); repaintCart(); }

void TillView::repaintCart() {
    const int keep = lines->currentRow();
    const Pos::Priced p = priced();
    QList<QStringList> rows;
    for (const auto& l : p.lines) rows << QStringList{l["name"].toString() + (l["promoCode"].toString().isEmpty() ? QString() : "  [" + l["promoCode"].toString() + "]"), QString::number(l["qty"].toDouble()), money(l["total"].toDouble())};
    Ui::fill(lines, rows, QList<QJsonObject>(rows.size()));
    if (keep >= 0 && keep < rows.size()) lines->selectRow(keep);
    const int i = sel();
    { QSignalBlocker b(lineDisc); lineDisc->setValue(i >= 0 ? int(cart[i].toObject()["discountPct"].toDouble()) : 0); }
    { QSignalBlocker b(order); order->setValue(int(orderPct)); }
    QJsonObject cu;
    for (const auto& v : st->customers) if (v.toObject()["code"].toString() == customerCode) cu = v.toObject();
    custInfo->setText(cu.isEmpty() ? QString() : t("pos.points") + ": " + QString::number(cu["data"].toObject()["points"].toInt()) + (cu["data"].toObject()["discountPct"].toDouble() ? " · " + QString::number(cu["data"].toObject()["discountPct"].toDouble()) + "%" : QString()));
    QString h = t("pos.subtotal") + ": " + money(p.subtotal) + "<br>";
    if (p.discount) h += t("pos.discount") + ": −" + money(p.discount) + "<br>";
    h += t("pos.tax") + ": " + money(p.tax) + "<br><span style='font-size:18px'><b>" + t("pos.total") + ": " + money(p.total) + "</b></span>";
    tot->setText(h);
    const bool has = !cart.isEmpty();
    payB->setEnabled(has); holdB->setEnabled(has); clearB->setEnabled(has);
    recallB->setVisible(heldCount() > 0);
    recallB->setText(t("pos.recall") + " (" + QString::number(heldCount()) + ")");
}

void TillView::clear() { cart = QJsonArray(); orderPct = 0; setCustomer(QString()); }

static QString heldKey() { return "pos_held:" + Api::I().username; }
static QJsonArray heldList() { return QJsonDocument::fromJson(QSettings("WorkflowEngine", "ErpQt").value(heldKey(), "[]").toString().toUtf8()).array(); }
static void saveHeld(const QJsonArray& a) { QSettings("WorkflowEngine", "ErpQt").setValue(heldKey(), QString::fromUtf8(QJsonDocument(a).toJson(QJsonDocument::Compact))); }
int TillView::heldCount() const { return heldList().size(); }

void TillView::hold() {
    QJsonArray h = heldList();
    h.append(QJsonObject{{"id", QUuid::createUuid().toString(QUuid::WithoutBraces)}, {"at", QTime::currentTime().toString("HH:mm")}, {"cart", cart}, {"customer", customerCode}});
    saveHeld(h);
    clear();
}

void TillView::recall() {
    const QJsonArray h = heldList();
    if (h.isEmpty()) return;
    QDialog d(this);
    d.setWindowTitle(t("pos.recall"));
    auto* lay = new QVBoxLayout(&d);
    auto* lst = new QListWidget;
    for (const auto& v : h) { auto* it = new QListWidgetItem(v.toObject()["at"].toString() + " · " + QString::number(v.toObject()["cart"].toArray().size()) + " " + t("pos.items")); it->setData(Qt::UserRole, v.toObject()["id"].toString()); lst->addItem(it); }
    lst->setCurrentRow(0);
    lay->addWidget(lst);
    QString pick; bool drop = false;
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button(t("pos.recallOne"), [&] { if (lst->currentItem()) { pick = lst->currentItem()->data(Qt::UserRole).toString(); drop = false; d.accept(); } }));
    row->addWidget(Ui::button("🗑", [&] { if (lst->currentItem()) { pick = lst->currentItem()->data(Qt::UserRole).toString(); drop = true; d.accept(); } }, "danger"));
    row->addWidget(Ui::button(t("common.cancel"), [&] { d.reject(); }, "ghost"));
    lay->addLayout(row);
    if (!d.exec() || pick.isEmpty()) return;
    QJsonArray rest; QJsonObject got;
    for (const auto& v : h) { if (v.toObject()["id"].toString() == pick) got = v.toObject(); else rest.append(v); }
    saveHeld(rest);
    if (!drop) { cart = got["cart"].toArray(); setCustomer(got["customer"].toString()); }
    repaintCart();
}

void TillView::openShift(double opening) {
    QJsonObject b{{"openingCash", opening}};
    if (!reg->currentData().toString().isEmpty()) b["register"] = reg->currentData().toString();
    Api::I().call("POST", "/pos/shifts/open", b, this, [this](const QJsonValue& v) { st->shift = v.toObject(); onShift(); }, [this](const QString& m) { banner->setText(m); });
}

void TillView::pay(bool autoExact) {
    if (busy || cart.isEmpty()) return;
    const Pos::Priced p = priced();
    QJsonObject cu;
    for (const auto& v : st->customers) if (v.toObject()["code"].toString() == customerCode) cu = v.toObject();
    QJsonArray payments; int redeem = 0; double remaining = 0;
    if (autoExact) {
        payments.append(QJsonObject{{"method", "cash"}, {"amount", p.total}});
    } else {
        PayDlg dlg(p.total, cu, st->settings, this);
        if (!dlg.exec()) return;
        payments = dlg.payments(); redeem = dlg.redeem->value(); remaining = dlg.remaining();
    }
    QJsonObject body{{"lines", cart}, {"payments", payments}, {"discountPct", orderPct}, {"redeemPoints", redeem}, {"localId", QUuid::createUuid().toString(QUuid::WithoutBraces)}};
    if (!customerCode.isEmpty()) body["customer"] = customerCode;
    if (!st->shift.value("ref").isNull() && st->shift.contains("ref")) body["register"] = st->shift.value("ref");
    checkout(body, remaining, autoExact);
}

void TillView::checkout(const QJsonObject& body, double remaining, bool autoExact) {
    busy = true;
    const Pos::Priced pp = priced();
    auto done = [this](const QJsonObject& sale) {
        clear(); updateQueue();
        lastReceipt = Pos::receiptHtml(sale, st->settings);
        busy = false;
        onShift();
    };
    Api::I().call("POST", "/pos/sales/checkout", body, this, [this, done, autoExact](const QJsonValue& v) {
        const QJsonObject sale = v.toObject();
        if (!autoExact) { clear(); showReceipt(this, sale, st, t("pos.saleDone")); busy = false; updateQueue(); onShift(); lastReceipt = Pos::receiptHtml(sale, st->settings); }
        else done(sale);
    }, [this, body, pp, remaining](const QString& m) {
        busy = false;
        if (!looksOffline(m)) { banner->setText(m); return; }
        // the network is down: keep the sale, show a provisional receipt, send it later
        QJsonArray q = offlineQueue(); q.append(body); saveQueue(q);
        QJsonArray ls; for (const auto& l : pp.lines) ls.append(l);
        const QJsonObject sale{{"code", t("pos.offlineCode")}, {"status", "Queued"}, {"createdAt", QDateTime::currentDateTime().toString(Qt::ISODate)},
                               {"data", QJsonObject{{"type", "Sale"}, {"lines", ls}, {"subtotal", pp.subtotal}, {"discount", pp.discount}, {"tax", pp.tax}, {"total", pp.total}, {"payments", body["payments"]},
                                                    {"change", std::max(0.0, -remaining)}, {"cashier", Api::I().username}}}};
        clear(); updateQueue(); lastReceipt = Pos::receiptHtml(sale, st->settings);
        showReceipt(this, sale, st, t("pos.saleDone"));
    });
}

void TillView::flush() {
    QJsonArray q = offlineQueue();
    if (q.isEmpty()) return;
    auto step = std::make_shared<std::function<void(int)>>();
    *step = [this, q, step](int i) {
        if (i >= q.size()) { saveQueue(QJsonArray()); updateQueue(); onShift(); return; }
        Api::I().call("POST", "/pos/sales/checkout", q[i].toObject(), this, [step, i](const QJsonValue&) { (*step)(i + 1); }, [this, q, step, i](const QString& m) {
            if (looksOffline(m)) { QJsonArray left; for (int k = i; k < q.size(); ++k) left.append(q[k]); saveQueue(left); updateQueue(); return; }
            (*step)(i + 1);     // refused by the server: dropped from the queue
        });
    };
    (*step)(0);
}

// ---------------------------------------------------------------- shifts
ShiftsView::ShiftsView(Pos::State* s, std::function<void()> cb) : st(s), onChange(std::move(cb)) {
    auto* root = new QVBoxLayout(this);
    msg = Ui::label("", "dim");
    root->addWidget(msg);
    auto* card = new QFrame; card->setProperty("card", true);
    auto* cl = new QVBoxLayout(card);
    head = Ui::label("", "title");
    cl->addWidget(head);
    kv = new QLabel; kv->setTextFormat(Qt::RichText);
    cl->addWidget(kv);
    auto* row = new QHBoxLayout;
    bIn = Ui::button(t("pos.shift.cashIn"), [this] {
        AmountDlg d(t("pos.shift.cashIn"), t("pos.amount"), t("pos.reason"), QString(), this);
        if (!d.exec()) return; if (!(d.amount->value() > 0)) { Ui::warn(this, t("pos.required")); return; } cashMove("in", d.amount->value()); }, "ghost");
    bOut = Ui::button(t("pos.shift.cashOut"), [this] {
        AmountDlg d(t("pos.shift.cashOut"), t("pos.amount"), t("pos.reason"), QString(), this);
        if (!d.exec()) return; if (!(d.amount->value() > 0)) { Ui::warn(this, t("pos.required")); return; } cashMove("out", d.amount->value()); }, "ghost");
    bClose = Ui::button(t("pos.shift.close"), [this] {
        AmountDlg d(t("pos.shift.close"), t("pos.shift.countedCash"), t("pos.note"), t("pos.shift.closeHint"), this);
        if (d.exec()) closeShift(d.amount->value()); });
    reg = new QComboBox; floatBox = numEdit();
    bOpen = Ui::button(t("pos.shift.open"), [this] {
        QJsonObject b{{"openingCash", floatBox->value()}};
        if (!reg->currentData().toString().isEmpty()) b["register"] = reg->currentData().toString();
        Api::I().call("POST", "/pos/shifts/open", b, this, [this](const QJsonValue& v) { st->shift = v.toObject(); msg->setText(t("pos.shift.opened")); onChange(); }, [this](const QString& m) { Ui::warn(this, m); }); });
    for (QWidget* w : QList<QWidget*>{reg, floatBox, bOpen, bIn, bOut, bClose}) row->addWidget(w);
    row->addStretch(1);
    cl->addLayout(row);
    root->addWidget(card);
    root->addWidget(Ui::label(t("pos.shift.history"), "title"));
    table = Ui::table({t("pos.code"), t("pos.cashier"), t("pos.opened"), t("pos.status"), t("pos.shift.sales"), t("pos.shift.expected"), t("pos.shift.counted"), t("pos.shift.variance"), t("pos.shift.journal")});
    root->addWidget(table, 1);
}

void ShiftsView::refresh() {
    reg->clear(); reg->addItem("—", QString());
    for (const auto& v : st->registers) reg->addItem(v.toObject()["code"].toString() + " · " + v.toObject()["data"].toObject()["name"].toString(), v.toObject()["code"].toString());
    const bool open = !st->shift.isEmpty();
    for (QWidget* w : QList<QWidget*>{reg, floatBox, bOpen}) w->setVisible(!open);
    for (QWidget* w : QList<QWidget*>{bIn, bOut, bClose}) w->setVisible(open);
    if (open) {
        const QJsonObject d = st->shift["data"].toObject();
        head->setText(t("pos.shift.current") + " · " + st->shift["code"].toString());
        kv->setText(QStringList{t("pos.shift.opening") + ": <b>" + money(d["opening"].toDouble()) + "</b>", t("pos.shift.cashSales") + ": <b>" + money(d["cashSales"].toDouble()) + "</b>",
                                t("pos.shift.cardSales") + ": <b>" + money(d["cardSales"].toDouble() + d["otherSales"].toDouble()) + "</b>", t("pos.shift.refunds") + ": <b>" + money(d["returnsTotal"].toDouble()) + "</b>",
                                t("pos.shift.cashIn") + " / " + t("pos.shift.cashOut") + ": <b>" + money(d["cashIn"].toDouble()) + " / " + money(d["cashOut"].toDouble()) + "</b>",
                                t("pos.shift.sales") + ": <b>" + QString::number(d["salesCount"].toInt()) + "</b>"}.join(" &nbsp;&nbsp; "));
    } else { head->setText(t("pos.shift.none")); kv->clear(); }
    Api::I().call("GET", "/pos/records/shift?take=200", QJsonValue(), this, [this](const QJsonValue& v) { fill(v.toArray()); }, [this](const QString& m) { msg->setText(m); });
}

void ShiftsView::fill(const QJsonArray& rowsIn) {
    QList<QJsonObject> rs;
    for (const auto& v : rowsIn) rs << v.toObject();
    std::sort(rs.begin(), rs.end(), [](const QJsonObject& a, const QJsonObject& b) { return a["createdAt"].toString() > b["createdAt"].toString(); });
    QList<QStringList> out;
    for (const auto& r : rs) {
        const QJsonObject d = r["data"].toObject();
        out << QStringList{r["code"].toString(), r["createdBy"].toString(), r["createdAt"].toString().left(16).replace('T', ' '), t("pos.st." + r["status"].toString("Open")), money(d["salesTotal"].toDouble()),
                           d.contains("expected") ? money(d["expected"].toDouble()) : QString(), d.contains("counted") ? money(d["counted"].toDouble()) : QString(),
                           r["status"].toString() == "Closed" ? money(d["variance"].toDouble()) : QString(), Pos::str(d["journal"])};
    }
    Ui::fill(table, out, rs);
}

void ShiftsView::cashMove(const QString& type, double amount) {
    Api::I().call("POST", "/pos/shifts/" + st->shift["id"].toString() + "/cash", QJsonObject{{"type", type}, {"amount", amount}}, this,
                  [this](const QJsonValue& v) { st->shift = v.toObject(); msg->setText(t("pos.saved")); onChange(); }, [this](const QString& m) { Ui::warn(this, m); });
}

void ShiftsView::closeShift(double counted) {
    Api::I().call("POST", "/pos/shifts/" + st->shift["id"].toString() + "/close", QJsonObject{{"countedCash", counted}}, this, [this](const QJsonValue& v) {
        st->shift = QJsonObject();
        const QJsonObject r = v.toObject(), d = r["data"].toObject();
        msg->setText(t("pos.shift.closed") + " · " + r["code"].toString() + " — " + t("pos.shift.expected") + " " + money(d["expected"].toDouble()) + ", " + t("pos.shift.counted") + " " + money(d["counted"].toDouble()) + ", " + t("pos.shift.variance") + " " + money(d["variance"].toDouble()));
        onChange();
    }, [this](const QString& m) { Ui::warn(this, m); });
}

// ---------------------------------------------------------------- sales
SalesView::SalesView(Pos::State* s) : st(s) {
    auto* root = new QVBoxLayout(this);
    auto* bar = new QHBoxLayout;
    q = new QLineEdit; q->setPlaceholderText(t("pos.findReceipt"));
    connect(q, &QLineEdit::textChanged, this, [this] { paint(); });
    type = new QComboBox; type->addItem(t("pos.all"), QString()); type->addItem(t("pos.rc.receipt"), "Sale"); type->addItem(t("pos.rc.return"), "Return");
    connect(type, &QComboBox::currentIndexChanged, this, [this] { paint(); });
    days = new QComboBox;
    for (int n : {1, 7, 30, 365}) days->addItem(QString::number(n) + " d", n);
    days->setCurrentIndex(1);
    connect(days, &QComboBox::currentIndexChanged, this, [this] { load(); });
    total = Ui::label("", "dim");
    bar->addWidget(q); bar->addWidget(type); bar->addWidget(days); bar->addStretch(1); bar->addWidget(total);
    root->addLayout(bar);
    msg = Ui::label("", "dim");
    root->addWidget(msg);
    table = Ui::table({t("pos.code"), t("pos.date"), t("pos.cashier"), t("pos.customer"), t("pos.status"), t("pos.total")});
    connect(table, &QTableWidget::itemSelectionChanged, this, [this] { buttons(); });
    connect(table, &QTableWidget::cellDoubleClicked, this, [this] { QJsonObject s; if (Ui::selected(table, s)) showReceipt(this, s, st, s["code"].toString()); });
    root->addWidget(table, 1);
    auto* row = new QHBoxLayout;
    row->addWidget(Ui::button(t("pos.print"), [this] { QJsonObject s; if (Ui::selected(table, s)) showReceipt(this, s, st, s["code"].toString()); }, "ghost"));
    bRet = Ui::button(t("pos.rc.return"), [this] {
        QJsonObject s; if (!Ui::selected(table, s)) return;
        ReturnDlg d(s, this);
        if (d.exec()) doReturn(s, d.lines(), d.method->currentData().toString(), d.reason->text()); }, "ghost");
    bVoid = Ui::button(t("pos.void"), [this] {
        QJsonObject s; if (!Ui::selected(table, s)) return;
        if (Ui::ask(this, t("pos.voidConfirm").replace("{name}", s["code"].toString()), t("pos.void"), t("common.cancel"))) doVoid(s); }, "danger");
    row->addWidget(bRet); row->addWidget(bVoid); row->addStretch(1);
    root->addLayout(row);
}

void SalesView::load() {
    const QString since = QDate::currentDate().addDays(-days->currentData().toInt()).toString("yyyy-MM-dd");
    Api::I().call("GET", "/pos/records/sale?take=1000&from=" + since, QJsonValue(), this, [this](const QJsonValue& v) {
        QList<QJsonObject> rs;
        for (const auto& x : v.toArray()) rs << x.toObject();
        std::sort(rs.begin(), rs.end(), [](const QJsonObject& a, const QJsonObject& b) { return a["createdAt"].toString() > b["createdAt"].toString(); });
        rows = QJsonArray();
        for (const auto& r : rs) rows.append(r);
        paint();
    }, [this](const QString& m) { msg->setText(m); });
}

QJsonArray SalesView::shown() const {
    const QString qq = q->text().toLower().trimmed(), ty = type->currentData().toString();
    QJsonArray out;
    for (const auto& v : rows) {
        const QJsonObject s = v.toObject(), d = s["data"].toObject();
        if (!ty.isEmpty() && d["type"].toString() != ty) continue;
        if (!qq.isEmpty() && !s["code"].toString().toLower().contains(qq) && !Pos::str(s["parent"]).toLower().contains(qq) && !Pos::str(d["customerName"]).toLower().contains(qq) && !s["createdBy"].toString().toLower().contains(qq)) continue;
        out.append(s);
    }
    return out;
}

void SalesView::paint() {
    const QJsonArray sh = shown();
    QList<QStringList> out; QList<QJsonObject> pl; double sum = 0;
    for (const auto& v : sh) {
        const QJsonObject s = v.toObject(), d = s["data"].toObject();
        out << QStringList{s["code"].toString() + (Pos::str(s["parent"]).isEmpty() ? QString() : " ← " + Pos::str(s["parent"])), s["createdAt"].toString().left(16).replace('T', ' '), s["createdBy"].toString(),
                           d["customerName"].toString("—"), t("pos.st." + s["status"].toString("Completed")), money(d["total"].toDouble())};
        pl << s;
        if (s["status"].toString() != "Voided") sum += d["total"].toDouble();
    }
    Ui::fill(table, out, pl);
    total->setText(QString::number(sh.size()) + " · " + money(sum));
    buttons();
}

bool SalesView::canReturn(const QJsonObject& s) const { return Api::I().can("pos.refund") && s["data"].toObject()["type"].toString() == "Sale" && s["status"].toString() != "Voided" && s["status"].toString() != "Returned"; }
bool SalesView::canVoid(const QJsonObject& s) const { return Api::I().can("pos.void") && s["data"].toObject()["type"].toString() == "Sale" && s["status"].toString() == "Completed"; }

void SalesView::buttons() {
    QJsonObject s;
    const bool has = Ui::selected(table, s);
    bRet->setEnabled(has && canReturn(s)); bVoid->setEnabled(has && canVoid(s));
}

QJsonObject SalesView::first() const { return table->rowCount() && table->item(0, 0) ? table->item(0, 0)->data(Qt::UserRole).toJsonObject() : QJsonObject(); }

void SalesView::doReturn(const QJsonObject& sale, const QJsonArray& lines, const QString& method, const QString& reason) {
    Api::I().call("POST", "/pos/sales/" + sale["id"].toString() + "/return", QJsonObject{{"lines", lines}, {"method", method}, {"reason", reason}}, this, [this](const QJsonValue& v) {
        msg->setText(t("pos.returned")); load();
        if (QApplication::platformName() != "offscreen") showReceipt(this, v.toObject(), st, t("pos.returned"));
    }, [this](const QString& m) { Ui::warn(this, m); });
}

void SalesView::doVoid(const QJsonObject& sale) {
    Api::I().call("POST", "/pos/sales/" + sale["id"].toString() + "/void", QJsonObject(), this, [this](const QJsonValue&) { load(); }, [this](const QString& m) { Ui::warn(this, m); });
}

// ---------------------------------------------------------------- page
PosPage::PosPage() {
    auto* top = new QHBoxLayout;
    top->addWidget(Ui::label(t("tab.pos"), "title"));
    err = Ui::label("", "error");
    top->addWidget(err, 1);
    lay->addLayout(top);
    tabs = new QTabWidget;
    till = new TillView(&state, [this] { reload(); });
    shifts = new ShiftsView(&state, [this] { reload(); });
    sales = new SalesView(&state);
    tabs->addTab(till, t("pos.nav.terminal")); tabs->addTab(shifts, t("pos.nav.shifts")); tabs->addTab(sales, t("pos.nav.sales"));
    connect(tabs, &QTabWidget::currentChanged, this, [this] { paint(); });
    lay->addWidget(tabs, 1);
}

void PosPage::reload() {
    err->clear();
    state.load(this, [this] { paint(); }, [this](const QString& m) { err->setText(m); });
}

void PosPage::paint() {
    if (!state.loaded) return;
    switch (tabs->currentIndex()) { case 0: till->refresh(); break; case 1: shifts->refresh(); break; default: sales->load(); }
}
