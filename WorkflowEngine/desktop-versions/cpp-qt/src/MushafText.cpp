#include "MushafText.h"

#include <QFile>
#include <QFontDatabase>
#include <QFontMetricsF>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPainter>
#include <QPolygonF>
#include <QRegularExpression>

#include "Prayer.h"

struct Pal { const char *bg, *band, *line, *orn, *edge, *cfill, *ctext, *num, *hfill, *mstroke, *mfill; bool hearts; };
static const Pal kRose{"#fffdf6", "#f2c6d6", "#7a1f4b", "#c2185b", "#9a2f63", "#fbe4ee", "#4a1030", "#6b2a4a", "#f6d3e1", "#8a3a63", "#fbe3ec", true};
static const Pal kBlue{"#f5f9ff", "#b9d3f3", "#1b4a86", "#1565c0", "#2f6db5", "#e1eeff", "#0c2a55", "#1d3d6b", "#cde1fb", "#2a63ad", "#e4efff", false};
static const Pal* g_pal = &kRose;


namespace {
QJsonArray& pages() {
    static QJsonArray a;
    if (a.isEmpty()) { QFile f(":/mushaf-text.json"); if (f.open(QIODevice::ReadOnly)) a = QJsonDocument::fromJson(f.readAll()).array(); }
    return a;
}
QString family() {
    static QString fam;
    if (fam.isEmpty()) {
        QFile f(":/AmiriQuran-Regular.ttf");
        int id = f.open(QIODevice::ReadOnly) ? QFontDatabase::addApplicationFontFromData(f.readAll()) : -1;
        const QStringList l = id >= 0 ? QFontDatabase::applicationFontFamilies(id) : QStringList();
        fam = l.isEmpty() ? QStringLiteral("Amiri") : l.first();
    }
    return fam;
}
QJsonObject MF() { return Prayer::spec().value("mushaf").toObject(); }
int pageOf(const QJsonArray& starts, int p) { int n = 1; for (int i = 0; i < starts.size(); ++i) if (starts.at(i).toInt() <= p) n = i + 1; return n; }
QString arNum(int n) { QString s = QString::number(n); for (QChar& c : s) c = QChar(0x0660 + c.digitValue()); return s; }
bool isRed(QString w) {
    static const QRegularExpression strip(QString::fromUtf8("[ً-ٰٟۖ-ۭـ]"));
    static const QRegularExpression red(QString::fromUtf8("^[وفبتك]?(?:الله|لله|رب(?:نا|كم|هم|ك|ي|ه|ها|هما|كما|هن)?)$"));
    w.remove(strip);
    w.replace(QChar(0x0671), QChar(0x0627));
    return red.match(w).hasMatch();
}
QFont font(double px) { QFont f(family()); f.setPixelSize(qMax(4, int(px + .5))); return f; }

/// text centred in r on a baseline from the font metrics (Amiri's tall line box would push it down)
void center(QPainter& p, const QRectF& r, const QString& t) {
    QFontMetricsF fm(p.font());
    const double w = fm.horizontalAdvance(t);
    p.drawText(QPointF(r.center().x() - w / 2, r.center().y() + (fm.ascent() - fm.descent()) / 2 - p.font().pixelSize() * .05), t);
}
void cartouche(QPainter& p, const QRectF& r, const QString& t, double u) {
    p.setPen(QPen(QColor(g_pal->edge), .35 * u));
    p.setBrush(QColor(g_pal->cfill));
    p.drawRoundedRect(r, 1.2 * u, 1.2 * u);
    p.setPen(QColor(g_pal->ctext));
    p.setFont(font(3.5 * u));
    center(p, r, t);
}
struct Item { char kind; QString text; int num; double w; int ti = 0; };

void drawLine(QPainter& p, const QJsonArray& toks, double left, double ry, double W, double row, double S, QVector<MushafText::Hit>* hits, int li) {
    double k = 1, fs = S, tot = 0, nat = 0;
    QList<Item> items;
    QFont fnt, small;
    for (int pass = 0; pass < 2; ++pass) {
        fs = S * k;
        fnt = font(fs);
        small = font(fs * .62);
        QFontMetricsF fm(fnt), fms(small);
        items.clear();
        tot = 0;
        int ti = -1;
        for (const QJsonValue& v : toks) {
            Item it;
            ++ti;
            if (v.isString() && v.toString() == "*") it = {'q', "*", 0, fms.horizontalAdvance(QString::fromUtf8("۞"))};
            else if (v.isDouble()) it = {'n', {}, v.toInt(), fs * .74 * 1.45};
            else it = {'w', v.toString(), 0, fm.horizontalAdvance(v.toString())};
            it.ti = ti;
            tot += it.w;
            items << it;
        }
        nat = tot + fs * .22 * qMax(0, int(items.size()) - 1);
        if (nat > W && pass == 0) { k = qMax(.6, W / nat * .985); continue; }
        break;
    }
    const int n = items.size();
    double gap, x;
    if (nat < W * .72) { gap = fs * .32; x = left + (W - (tot + gap * (n - 1))) / 2 + tot + gap * (n - 1); }
    else { gap = n > 1 ? (W - tot) / (n - 1) : 0; x = left + W; }
    QFontMetricsF fm(fnt);
    const double cy = ry + row / 2, base = cy + (fm.ascent() - fm.descent()) / 2 - fs * .05;
    for (const Item& it : items) {
        x -= it.w;
        if (it.kind == 'w') { if (hits) hits->append({QRectF(x - gap / 2, ry, it.w + gap, row), li, it.ti, it.text}); p.setFont(fnt); p.setPen(QColor(isRed(it.text) ? "#c0143c" : "#14110f")); p.drawText(QPointF(x, base), it.text); }
        else if (it.kind == 'q') { p.setFont(small); p.setPen(QColor(g_pal->edge)); p.drawText(QPointF(x, base), QString::fromUtf8("۞")); }
        else {
            const double d = fs * .74 * 1.45;
            p.setPen(QPen(QColor(g_pal->mstroke), fs * .045));
            p.setBrush(QColor(g_pal->mfill));
            p.drawEllipse(QRectF(x, cy - d / 2, d, d));
            p.setPen(QColor(g_pal->ctext));
            p.setFont(font(fs * .49));
            center(p, QRectF(x, cy - d / 2, d, d), arNum(it.num));
        }
        x -= gap;
    }
}
}  // namespace

QImage MushafText::render(int page, int width, bool night, const QString& theme, QVector<Hit>* hits) {
    if (hits) hits->clear();
    g_pal = theme == "blue" ? &kBlue : &kRose;
    const int H = int(width * 4206.0 / 2600);
    QImage img(width, H, QImage::Format_ARGB32_Premultiplied);
    img.fill(QColor(g_pal->bg));
    QPainter p(&img);
    p.setRenderHint(QPainter::Antialiasing);
    p.setRenderHint(QPainter::TextAntialiasing);
    const double u = width / 100.0, W = width;
    const QJsonObject mf = MF();
    const QJsonArray surahAr = mf.value("surahAr").toArray();
    const double fo = 1.4 * u, bw = 3.4 * u;
    const QRectF outer(fo, fo, W - 2 * fo, H - 2 * fo), inner = outer.adjusted(bw, bw, -bw, -bw);
    p.setPen(Qt::NoPen);
    p.setBrush(QColor(g_pal->band));
    p.drawRect(outer);
    p.setBrush(QColor(g_pal->bg));
    p.drawRect(inner);
    p.setBrush(Qt::NoBrush);
    p.setPen(QPen(QColor(g_pal->line), .5 * u));
    p.drawRect(outer.adjusted(.25 * u, .25 * u, -.25 * u, -.25 * u));
    p.setPen(QPen(QColor(g_pal->line), .4 * u));
    p.drawRect(inner);
    p.setPen(Qt::NoPen);
    p.setBrush(QColor(g_pal->orn));
    const double mid = bw / 2;
    auto heart = [&](double cx, double cy) {
        const double r = .72 * u;
        if (!g_pal->hearts) { p.drawPolygon(QPolygonF({QPointF(cx, cy - r * 1.05), QPointF(cx + r * .8, cy), QPointF(cx, cy + r * 1.05), QPointF(cx - r * .8, cy)})); return; }
        p.drawEllipse(QPointF(cx - r * .5, cy - r * .25), r * .55, r * .55);
        p.drawEllipse(QPointF(cx + r * .5, cy - r * .25), r * .55, r * .55);
        p.drawPolygon(QPolygonF({QPointF(cx - r * 1.02, cy - r * .05), QPointF(cx + r * 1.02, cy - r * .05), QPointF(cx, cy + r * 1.1)}));
    };
    const double step = 4.2 * u;
    for (double x = outer.left() + bw + step / 2; x < outer.right() - bw - step / 4; x += step) { heart(x, outer.top() + mid); heart(x, outer.bottom() - mid); }
    for (double y = outer.top() + bw + step / 2; y < outer.bottom() - bw - step / 4; y += step) { heart(outer.left() + mid, y); heart(outer.right() - mid, y); }
    p.setBrush(Qt::white);
    for (QPointF c : {QPointF(outer.left() + mid, outer.top() + mid), QPointF(outer.right() - mid, outer.top() + mid), QPointF(outer.left() + mid, outer.bottom() - mid), QPointF(outer.right() - mid, outer.bottom() - mid)})
        p.drawEllipse(c, 1.25 * u, 1.25 * u);
    const double left = inner.left() + 1.2 * u, right = inner.right() - 1.2 * u, top = inner.top() + .4 * u, hh = 6.2 * u;
    p.setFont(font(3.5 * u));
    const QString jt = QString::fromUtf8("الجزء ") + mf.value("juzAr").toArray().at(pageOf(mf.value("juzStart").toArray(), page) - 1).toString();
    const QString st = QString::fromUtf8("سورة ") + surahAr.at(pageOf(mf.value("surahStart").toArray(), page) - 1).toString();
    for (int side = 0; side < 2; ++side) {
        const QString& text = side == 0 ? jt : st;
        const double w = QFontMetricsF(p.font()).horizontalAdvance(text) + 4.8 * u;
        cartouche(p, QRectF(side == 0 ? right - w : left, top + .7 * u, w, hh - 1.4 * u), text, u);
    }
    p.setPen(QColor(g_pal->num));
    p.setFont(font(3.2 * u));
    center(p, QRectF(left, inner.bottom() - 4.8 * u, right - left, 4.4 * u), arNum(page));
    const QJsonArray data = pages().at(page - 1).toArray();
    const double bodyTop = top + hh, bodyBot = inner.bottom() - 4.8 * u, row = (bodyBot - bodyTop) / 15, y0 = bodyTop + (15 - data.size()) * row / 2, W2 = right - left;
    for (int i = 0; i < data.size(); ++i) {
        const QJsonArray ln = data.at(i).toArray();
        const QString kind = ln.at(0).toString();
        const double ry = y0 + i * row;
        if (kind == "H") {
            const QRectF r(left, ry + .5 * u, W2, row - 1.0 * u);
            p.setPen(QPen(QColor(g_pal->edge), .35 * u));
            p.setBrush(QColor(g_pal->hfill));
            p.drawRoundedRect(r, 1.6 * u, 1.6 * u);
            p.setPen(QColor(g_pal->ctext));
            p.setFont(font(4.9 * u));
            center(p, r, QString::fromUtf8("سُورَةُ ") + surahAr.at(ln.at(1).toInt() - 1).toString());
        } else if (kind == "B") {
            p.setPen(QColor("#14110f"));
            p.setFont(font(4.9 * u));
            center(p, QRectF(left, ry, W2, row), QString::fromUtf8("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ"));
        } else drawLine(p, ln.at(1).toArray(), left, ry, W2, row, 5.6 * u, hits, i);
    }
    p.end();
    if (night) img.invertPixels();
    return img;
}

QString MushafText::surahName(int surah) { return MF().value("surahAr").toArray().at(surah - 1).toString(); }

MushafText::Loc MushafText::locate(int page, int li, int ti) {
    static QJsonObject idx;
    if (idx.isEmpty()) { QFile f(":/mushaf-index.json"); if (f.open(QIODevice::ReadOnly)) idx = QJsonDocument::fromJson(f.readAll()).object(); }
    const QJsonArray st = idx.value("start").toArray().at(page - 1).toArray();
    int surah = st.at(0).toInt(), ayah = st.at(1).toInt(), wi = st.at(2).toInt();
    const QJsonObject cnt = idx.value("count").toObject();
    const QJsonArray lines = pages().at(page - 1).toArray();
    for (int i = 0; i <= li && i < lines.size(); ++i) {
        const QJsonArray ln = lines.at(i).toArray();
        const QString k = ln.at(0).toString();
        if (k == "H") { surah = ln.at(1).toInt(); ayah = 1; wi = 0; continue; }
        if (k != "L") continue;
        const QJsonArray toks = ln.at(1).toArray();
        for (int j = 0; j < toks.size(); ++j) {
            if (i == li && j == ti) return {surah, ayah, wi + 1, cnt.value(QString("%1:%2").arg(surah).arg(ayah)).toInt()};
            const QJsonValue v = toks.at(j);
            if (v.isString() && v.toString() == "*") continue;
            if (v.isDouble()) { ayah = v.toInt() + 1; wi = 0; } else ++wi;
        }
    }
    return {surah, ayah, wi + 1, 0};
}
