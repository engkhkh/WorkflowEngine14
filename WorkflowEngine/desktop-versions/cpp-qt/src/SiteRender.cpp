#include "SiteRender.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLocale>
#include <QRegularExpression>
#include <cmath>

namespace SiteRender {
const QJsonObject& spec() {
    static QJsonObject s = [] { QFile f(":/website.json"); f.open(QIODevice::ReadOnly); return QJsonDocument::fromJson(f.readAll()).object(); }();
    return s;
}

QString js(const QJsonValue& v) {
    if (v.isNull() || v.isUndefined()) return {};
    if (v.isBool()) return v.toBool() ? "true" : "false";
    if (v.isDouble()) { const double d = v.toDouble(); return (d == std::floor(d) && std::fabs(d) < 1e15) ? QString::number(qint64(d)) : QString::number(d, 'g', QLocale::FloatingPointShortest); }
    if (v.isString()) return v.toString();
    return {};
}
static double num(const QJsonValue& v, double d = 0) {
    if (v.isDouble()) return v.toDouble();
    bool ok = false; const double x = v.toString().toDouble(&ok);
    return ok && std::isfinite(x) ? x : d;
}
static QString esc(const QJsonValue& v) {
    QString s = js(v);
    s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
    return s;
}
static QString escS(const QString& s) { return esc(QJsonValue(s)); }
static QString href(const QJsonValue& l) {
    const QString s = js(l).trimmed();
    if (s.isEmpty()) return "#/";
    if (s.startsWith('/')) return "#" + s;
    static const QRegularExpression re("^(https?://|mailto:|tel:|#)", QRegularExpression::CaseInsensitiveOption);
    return re.match(s).hasMatch() ? s : "#";
}
static bool isExt(const QString& h) { static const QRegularExpression re("^https?:", QRegularExpression::CaseInsensitiveOption); return re.match(h).hasMatch(); }
static QString img(const QJsonValue& v) {
    const QString s = js(v).trimmed();
    static const QRegularExpression re("^(https?://|data:image/(png|jpe?g|gif|webp|svg\\+xml);base64,)", QRegularExpression::CaseInsensitiveOption);
    return re.match(s).hasMatch() ? s : QString();
}
static QString embedUrl(const QJsonValue& v) {
    const QString s = js(v).trimmed();
    static const QRegularExpression re("^https://(www\\.youtube\\.com/embed/|www\\.google\\.com/maps/embed|www\\.openstreetmap\\.org/export/embed)", QRegularExpression::CaseInsensitiveOption);
    return re.match(s).hasMatch() ? s : QString();
}
static QString paras(const QJsonValue& t) {
    QString out;
    static const QRegularExpression re("\\n{2,}");
    for (const QString& p : js(t).split(re)) out += "<p>" + escS(p.trimmed()).replace("\n", "<br>") + "</p>";
    return out;
}
static QString money(double n, const QString& cur) {
    return QLocale(QLocale::English).toString(std::round(n * 100 + 1e-9) / 100, 'f', 2) + " " + escS(cur);
}
static QString heading(const QJsonValue& t) { return js(t).isEmpty() ? QString() : "<h2 class=\"h2\">" + esc(t) + "</h2>"; }
static QString extAttr(const QString& h) { return isExt(h) ? " target=\"_blank\" rel=\"noopener\"" : QString(); }

static QString section(const QJsonObject& b, const QString& inner) {
    const QJsonObject p = b.value("props").toObject();
    const QJsonValue bgV = p.value("bgStyle"), padV = p.value("pad");
    const QString bg = bgV.isNull() || bgV.isUndefined() ? "none" : js(bgV);
    const QString padKey = padV.isNull() || padV.isUndefined() ? "m" : js(padV);
    const QString pad = padKey == "s" ? "28px" : padKey == "l" ? "96px" : "56px";
    return "<section class=\"blk bg-" + escS(bg) + " \" style=\"padding-block:" + pad + "\"><div class=\"wrap\">" + inner + "</div></section>";
}

static QString renderBlock(const QJsonObject& b, const QJsonObject& d, const QJsonObject& labels) {
    const QJsonObject p = b.value("props").toObject();
    auto g = [&](const char* k, const QJsonValue& dv = QJsonValue(QString())) { const QJsonValue v = p.value(k); return v.isNull() || v.isUndefined() ? dv : v; };
    const QString t = b.value("type").toString();
    const QJsonObject shop = d.value("shop").toObject();
    auto L = [&](const char* k, const char* dv) { return labels.contains(k) ? esc(labels.value(k)) : escS(dv); };
    if (t == "nav") {
        QString links;
        for (const QJsonValue& pgv : d.value("pages").toArray()) { const QJsonObject pg = pgv.toObject(); links += "<a href=\"#" + esc(pg.value("path")) + "\" data-nav=\"" + esc(pg.value("path")) + "\">" + esc(pg.value("title")) + "</a>"; }
        const QString logo = img(g("logo"));
        const QString cart = shop.value("enabled").toBool() ? "<button class=\"cartbtn\" type=\"button\" data-cart-open aria-label=\"cart\">🛒 <b data-cart-count>0</b></button>" : QString();
        return QString("<header class=\"nav%1\"><div class=\"wrap navin\"><a class=\"brand\" href=\"#/\">%2<span>%3</span></a>\n        <nav class=\"links\">%4</nav>%5</div></header>")
            .arg(js(g("sticky")) == "yes" ? " sticky" : "", logo.isEmpty() ? "" : "<img src=\"" + escS(logo) + "\" alt=\"\">", esc(g("brand")), links, cart);
    }
    if (t == "hero") {
        const QString bg = img(g("image"));
        const double ov = std::max(0.0, std::min(85.0, num(g("overlay")))) / 100;
        const QString hk = js(g("height"));
        const QString h = hk == "s" ? "320px" : hk == "l" ? "620px" : "460px";
        const QString l1 = href(g("link")), l2 = href(g("link2"));
        const QString b1 = js(g("button")).isEmpty() ? "" : "<a class=\"btn\" href=\"" + escS(l1) + "\"" + extAttr(l1) + ">" + esc(g("button")) + "</a>";
        const QString b2 = js(g("button2")).isEmpty() ? "" : "<a class=\"btn ghost\" href=\"" + escS(l2) + "\"" + extAttr(l2) + ">" + esc(g("button2")) + "</a>";
        const QString ovs = js(QJsonValue(ov));
        const QString bgs = bg.isEmpty() ? "" : "background-image:linear-gradient(rgba(0,0,0," + ovs + "),rgba(0,0,0," + ovs + ")),url('" + escS(bg) + "')";
        return QString("<section class=\"blk hero %1\" style=\"min-height:%2;text-align:%3;%4\">\n        <div class=\"wrap\"><h1>%5</h1><p class=\"lead\">%6</p><div class=\"btns\">%7%8</div></div></section>")
            .arg(bg.isEmpty() ? "" : "has-img", h, esc(g("align", "center")), bgs, esc(g("title")), esc(g("subtitle")), b1, b2);
    }
    if (t == "text") return section(b, "<div style=\"text-align:" + esc(g("align", "start")) + "\">" + heading(g("heading")) + "<div class=\"prose\">" + paras(g("body")) + "</div></div>");
    if (t == "image") {
        const QString s = img(g("image"));
        const QString body = s.isEmpty() ? "<div class=\"ph\">🖼️</div>"
            : "<figure class=\"fig" + QString(js(g("width")) == "full" ? " full" : "") + "\"><img src=\"" + escS(s) + "\" alt=\"" + esc(g("alt")) + "\">" + (js(g("caption")).isEmpty() ? "" : "<figcaption>" + esc(g("caption")) + "</figcaption>") + "</figure>";
        return section(b, body);
    }
    if (t == "features") {
        QString items;
        for (const QJsonValue& iv : g("items", QJsonArray()).toArray()) { const QJsonObject i = iv.toObject(); items += "<div class=\"card feat\"><div class=\"ico\">" + esc(i.value("icon")) + "</div><h3>" + esc(i.value("title")) + "</h3><p>" + esc(i.value("text")) + "</p></div>"; }
        return section(b, heading(g("heading")) + "<div class=\"grid c" + esc(g("columns", "3")) + "\">" + items + "</div>");
    }
    if (t == "products") {
        QList<QJsonObject> lst;
        const QString cat = js(g("category")).trimmed().toLower();
        for (const QJsonValue& xv : shop.value("products").toArray()) { const QJsonObject x = xv.toObject(); if (cat.isEmpty() || x.value("category").toString().toLower() == cat) lst << x; }
        int lim = int(num(g("limit", 8), 8)); if (lim == 0) lim = 8; lim = std::max(1, lim);
        while (lst.size() > lim) lst.removeLast();
        QString cards;
        for (const QJsonObject& x : lst) {
            const QString im = img(x.value("image"));
            cards += "<div class=\"card prod\"><div class=\"pimg\">" + (im.isEmpty() ? QString("<span>🛍️</span>") : "<img src=\"" + escS(im) + "\" alt=\"" + esc(x.value("name")) + "\" loading=\"lazy\">") + "</div>\n        <h3>" + esc(x.value("name")) + "</h3>"
                + (js(x.value("description")).isEmpty() ? "" : "<p class=\"muted\">" + esc(x.value("description")) + "</p>") + "<div class=\"price\">" + money(num(x.value("price")), shop.value("currency").toString()) + "</div>\n        <button class=\"btn sm\" type=\"button\" data-add=\""
                + esc(x.value("sku")) + "\">" + L("add", "Add to cart") + "</button></div>";
        }
        const QString empty = "<p class=\"muted center\">" + L("noProducts", "No products yet. Sync products from the point of sale in the shop settings.") + "</p>";
        return section(b, heading(g("heading")) + (lst.isEmpty() ? empty : "<div class=\"grid c" + esc(g("columns", "4")) + "\">" + cards + "</div>"));
    }
    if (t == "gallery") {
        QString items;
        for (const QJsonValue& iv : g("items", QJsonArray()).toArray()) { const QJsonObject i = iv.toObject(); const QString im = img(i.value("image")); items += im.isEmpty() ? QString("<div class=\"ph\">🖼️</div>") : "<img class=\"g\" src=\"" + escS(im) + "\" alt=\"" + esc(i.value("alt")) + "\" loading=\"lazy\">"; }
        return section(b, heading(g("heading")) + "<div class=\"grid c" + esc(g("columns", "3")) + "\">" + items + "</div>");
    }
    if (t == "testimonials") {
        QString items;
        for (const QJsonValue& iv : g("items", QJsonArray()).toArray()) { const QJsonObject i = iv.toObject(); items += "<blockquote class=\"card\"><p>“" + esc(i.value("text")) + "”</p><footer><b>" + esc(i.value("name")) + "</b>" + (js(i.value("role")).isEmpty() ? "" : " · <span class=\"muted\">" + esc(i.value("role")) + "</span>") + "</footer></blockquote>"; }
        return section(b, heading(g("heading")) + "<div class=\"grid c2\">" + items + "</div>");
    }
    if (t == "faq") {
        QString items;
        for (const QJsonValue& iv : g("items", QJsonArray()).toArray()) { const QJsonObject i = iv.toObject(); items += "<details class=\"card\"><summary>" + esc(i.value("q")) + "</summary><p>" + esc(i.value("a")) + "</p></details>"; }
        return section(b, heading(g("heading")) + "<div class=\"faq\">" + items + "</div>");
    }
    if (t == "cta") {
        const QString l = href(g("link"));
        const QString btn = js(g("button")).isEmpty() ? "" : "<a class=\"btn light\" href=\"" + escS(l) + "\"" + extAttr(l) + ">" + esc(g("button")) + "</a>";
        return section(b, "<div class=\"center\"><h2 class=\"h2\">" + esc(g("heading")) + "</h2><p class=\"lead\">" + esc(g("text")) + "</p>" + btn + "</div>");
    }
    if (t == "contact") {
        QString info;
        if (!js(g("phone")).isEmpty()) info += "<div>📞 <a href=\"tel:" + esc(g("phone")) + "\">" + esc(g("phone")) + "</a></div>";
        if (!js(g("email")).isEmpty()) info += "<div>✉️ <a href=\"mailto:" + esc(g("email")) + "\">" + esc(g("email")) + "</a></div>";
        if (!js(g("address")).isEmpty()) info += "<div>📍 " + esc(g("address")) + "</div>";
        return section(b, QString("<div class=\"two\"><div>%1<p>%2</p><div class=\"info\">%3</div></div>\n        <form class=\"card form\" data-contact><input name=\"name\" placeholder=\"%4\" required maxlength=\"120\"><input name=\"email\" type=\"email\" placeholder=\"%5\" maxlength=\"160\">\n        "
            "<input name=\"phone\" placeholder=\"%6\" maxlength=\"40\"><textarea name=\"message\" rows=\"4\" placeholder=\"%7\" required maxlength=\"2000\"></textarea>\n        "
            "<input name=\"website\" class=\"hp\" tabindex=\"-1\" autocomplete=\"off\"><button class=\"btn\" type=\"submit\">%8</button><p class=\"status\" data-status></p></form></div>")
            .arg(heading(g("heading")), esc(g("text")), info, L("name", "Your name"), L("email", "E-mail"), L("phone", "Phone"), L("message", "Message"), esc(g("button"))));
    }
    if (t == "embed") {
        const QString u = embedUrl(g("url"));
        double h = num(g("height"), 360); if (h == 0) h = 360; h = std::max(200.0, std::min(900.0, h));
        return section(b, u.isEmpty() ? QString("<div class=\"ph\">🗺️</div>") : "<iframe class=\"embed\" src=\"" + escS(u) + "\" style=\"height:" + js(QJsonValue(h)) + "px\" loading=\"lazy\" referrerpolicy=\"no-referrer\" allowfullscreen></iframe>");
    }
    if (t == "spacer") {
        double h = num(g("height"), 48); if (h == 0) h = 48; h = std::max(8.0, std::min(300.0, h));
        return "<div style=\"height:" + js(QJsonValue(h)) + "px\"></div>";
    }
    if (t == "footer") {
        QString links;
        for (const QJsonValue& iv : g("items", QJsonArray()).toArray()) { const QJsonObject i = iv.toObject(); const QString l = href(i.value("link")); links += "<a href=\"" + escS(l) + "\"" + extAttr(l) + ">" + esc(i.value("label")) + "</a>"; }
        return "<footer class=\"foot\"><div class=\"wrap\"><div class=\"flinks\">" + links + "</div><p>" + esc(g("text")) + "</p></div></footer>";
    }
    return {};
}

static QString jstr(const QString& s) {   // JSON.stringify of a string
    QString out = QJsonDocument(QJsonArray{s}).toJson(QJsonDocument::Compact);
    return out.mid(1, out.size() - 2);
}

QString render(const QJsonObject& d, const QString& orderUrl, const QString& messageUrl, const QString& mode) {
    const QJsonObject sp = spec(), t = d.value("theme").toObject(), settings = d.value("settings").toObject(), shop = d.value("shop").toObject();
    const bool dark = t.value("dark").toBool();
    const QString bg = dark ? "#0f172a" : t.value("bg").toString(), tx = dark ? "#e5e7eb" : t.value("text").toString();
    const QString soft = dark ? "#1e293b" : "rgba(0,0,0,.04)", line = dark ? "#334155" : "rgba(0,0,0,.1)";
    const QJsonObject labels = settings.value("dir").toString() == "rtl" ? sp.value("arLabels").toObject() : QJsonObject();
    auto Lb = [&](const char* k) { return labels.contains(k) ? labels.value(k).toString() : sp.value("enLabels").toObject().value(k).toString(); };
    QString pages;
    const QJsonArray pgs = d.value("pages").toArray();
    for (int i = 0; i < pgs.size(); ++i) {
        const QJsonObject pg = pgs[i].toObject();
        QString blocks;
        for (const QJsonValue& b : pg.value("blocks").toArray()) blocks += renderBlock(b.toObject(), d, labels);
        pages += "<main class=\"page\" data-path=\"" + esc(pg.value("path")) + "\"" + (i == 0 ? " data-home=\"1\"" : "") + ">" + blocks + "</main>";
    }
    QString css = sp.value("css").toString();
    const QJsonObject fonts = sp.value("fonts").toObject();
    double radius = std::max(0.0, std::min(32.0, num(t.value("radius"), 10)));
    const QList<QPair<QString, QString>> reps = {{"bg", bg}, {"tx", tx}, {"font", fonts.contains(t.value("font").toString()) ? fonts.value(t.value("font").toString()).toString() : fonts.value("sans").toString()}, {"primary", esc(t.value("primary"))}, {"radius", js(QJsonValue(radius))},
        {"soft", soft}, {"line", line}, {"navbg", dark ? "#0b1220" : "#fff"}, {"cardbg", dark ? "#1e293b" : "#fff"}, {"panelbg", dark ? "#0f172a" : "#fff"}};
    for (const auto& r : reps) css.replace("{{" + r.first + "}}", r.second);
    QString cart;
    if (shop.value("enabled").toBool()) {
        cart = sp.value("cart").toString();
        static const QRegularExpression re("\\{\\{L\\.(\\w+)\\}\\}");
        QRegularExpressionMatch m;
        while ((m = re.match(cart)).hasMatch()) cart.replace(m.captured(0), escS(Lb(m.captured(1).toUtf8().constData())));
    }
    QString prods;
    for (const QJsonValue& pv : shop.value("products").toArray()) {
        const QJsonObject p = pv.toObject();
        if (!prods.isEmpty()) prods += ",";
        prods += "{\"sku\":" + jstr(p.value("sku").toString()) + ",\"name\":" + jstr(p.value("name").toString()) + ",\"price\":" + js(p.value("price")) + "}";
    }
    QString data = QString("{\"shop\":%1,\"cur\":%2,\"prods\":[%3],\"order\":%4,\"msg\":%5,\"mode\":%6,\"page\":\"\",\"y\":0,\"t\":{\"empty\":%7,\"thanks\":%8,\"sent\":%9,\"fail\":%10,\"nopub\":%11}}")
        .arg(shop.value("enabled").toBool() ? "true" : "false", jstr(shop.value("currency").toString()), prods, jstr(orderUrl), jstr(messageUrl), jstr(mode), jstr(Lb("empty")), jstr(Lb("thanks")), jstr(Lb("sent")), jstr(Lb("fail")), jstr(Lb("nopub")));
    data.replace("<", "\\u003c");
    QString script = sp.value("js").toString();
    script.replace("{{data}}", data);
    return "<!doctype html><html lang=\"" + esc(settings.value("lang")) + "\" dir=\"" + esc(settings.value("dir")) + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>" + esc(settings.value("title")) + "</title>"
        + (js(settings.value("description")).isEmpty() ? "" : "<meta name=\"description\" content=\"" + esc(settings.value("description")) + "\">") + "<style>" + css + "</style></head><body>" + pages + cart + "<script>" + script + "</script></body></html>";
}
}  // namespace SiteRender
