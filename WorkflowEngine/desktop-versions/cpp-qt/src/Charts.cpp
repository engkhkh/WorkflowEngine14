#include "Charts.h"

#include <QMouseEvent>
#include <QPainter>
#include <QVBoxLayout>
#include <QtMath>

#include "I18n.h"

namespace {
const QColor kDim("#64748b"), kLine("#e2e8f0");
}

QString compactNum(double v) {
    const double a = qAbs(v);
    if (a >= 1e6) return QString::number(v / 1e6, 'f', 1) + "M";
    if (a >= 1e3) return QString::number(v / 1e3, 'f', 1) + "k";
    return QString::number(qRound(v));
}

KpiCard::KpiCard(const QString& label, const QString& color, std::function<void()> click) : click_(std::move(click)) {
    setProperty("card", true);
    setCursor(Qt::PointingHandCursor);
    setStyleSheet(QString("QFrame[card=\"true\"] { background:white; border:1px solid #e2e8f0; border-left:4px solid %1; border-radius:10px; }").arg(color));
    auto* l = new QVBoxLayout(this);
    auto* lab = new QLabel(label);
    lab->setStyleSheet("color:#64748b; border:none; font-size:12px;");
    val = new QLabel("–");
    val->setStyleSheet(QString("font-size:22px; font-weight:700; border:none; color:%1;").arg(color));
    hint = new QLabel;
    hint->setStyleSheet("color:#94a3b8; border:none; font-size:11px;");
    hint->setWordWrap(true);
    l->addWidget(lab); l->addWidget(val); l->addWidget(hint);
}
void KpiCard::set(const QString& value, const QString& h) { val->setText(value); hint->setText(h); }

FlowStrip::FlowStrip() { setMinimumHeight(100); }

void FlowStrip::mousePressEvent(QMouseEvent* e) {
    if (data.isEmpty()) return;
    const double w = double(width()) / data.size();
    const double x = I18n::rtl() ? width() - e->position().x() : e->position().x();
    const int i = int(x / w);
    if (i < 0 || i >= data.size()) return;
    active = active == data[i].key ? QString() : data[i].key;
    emit picked(active);
    update();
}

void FlowStrip::paintEvent(QPaintEvent*) {
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);
    const int n = data.size();
    if (!n) return;
    const double w = double(width()) / n;
    for (int i = 0; i < n; ++i) {
        const double x = I18n::rtl() ? width() - (i + 1) * w : i * w;
        const QRectF r(x + 4, 4, w - 8, height() - 8);
        const bool on = data[i].key == active;
        p.setPen(QPen(on ? QColor("#2563eb") : kLine, 1.5));
        p.setBrush(on ? QColor("#eff6ff") : QColor("#ffffff"));
        p.drawRoundedRect(r, 10, 10);
        QFont f = font(); f.setPointSize(16); f.setBold(true); p.setFont(f);
        p.setPen(QColor("#0f172a"));
        p.drawText(QRectF(r.x(), r.y() + 4, r.width(), 28), Qt::AlignCenter, QString::number(data[i].count));
        f.setPointSize(9); f.setBold(false); p.setFont(f);
        p.setPen(kDim);
        p.drawText(QRectF(r.x() + 2, r.y() + 34, r.width() - 4, 18), Qt::AlignCenter, data[i].label);
        p.drawText(QRectF(r.x() + 2, r.y() + 54, r.width() - 4, 18), Qt::AlignCenter, data[i].value);
    }
}

TrendChart::TrendChart(const QString& a_, const QString& b_) : a(a_), b(b_) { setMinimumHeight(190); setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding); }

void TrendChart::paintEvent(QPaintEvent*) {
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);
    const int W = width(), H = height(), L = 46, R = 8, T = 22, B = 26;
    double mx = 1;
    for (const auto& q : pts) mx = qMax(mx, qMax(q.sales, q.purchases));
    QFont f = font(); f.setPointSize(8); p.setFont(f);
    for (int k = 0; k < 5; ++k) {
        const double y = T + (H - T - B) * (1 - k / 4.0);
        p.setPen(QPen(kLine, 1)); p.drawLine(L, int(y), W - R, int(y));
        p.setPen(kDim); p.drawText(QRectF(0, y - 8, L - 4, 16), Qt::AlignRight | Qt::AlignVCenter, compactNum(mx * k / 4));
    }
    const int n = qMax<int>(pts.size(), 1);
    const double slot = double(W - L - R) / n;
    static const char* en[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    static const char16_t* ar[] = {u"يناير", u"فبراير", u"مارس", u"أبريل", u"مايو", u"يونيو", u"يوليو", u"أغسطس", u"سبتمبر", u"أكتوبر", u"نوفمبر", u"ديسمبر"};
    for (int i = 0; i < pts.size(); ++i) {
        const int j = I18n::rtl() ? n - 1 - i : i;
        const double x0 = L + j * slot, bw = slot * 0.32;
        const double vals[2] = {pts[i].sales, pts[i].purchases};
        const char* cols[2] = {"#0ea5e9", "#8b5cf6"};
        for (int k = 0; k < 2; ++k) {
            const double h = (H - T - B) * vals[k] / mx;
            p.setPen(Qt::NoPen); p.setBrush(QColor(cols[k]));
            p.drawRoundedRect(QRectF(x0 + slot * 0.15 + k * (bw + 2), H - B - h, bw, qMax(h, 0.0)), 3, 3);
        }
        p.setPen(kDim);
        p.drawText(QRectF(x0, H - B + 4, slot, 16), Qt::AlignCenter, I18n::rtl() ? QString::fromUtf16(ar[pts[i].month - 1]) : QString(en[pts[i].month - 1]));
    }
    double x = I18n::rtl() ? L + 4 : W - R - 250;
    const QString labs[2] = {a, b};
    const char* cols[2] = {"#0ea5e9", "#8b5cf6"};
    for (int k = 0; k < 2; ++k) {
        p.setBrush(QColor(cols[k])); p.setPen(Qt::NoPen); p.drawRoundedRect(QRectF(x, 5, 10, 10), 2, 2);
        p.setPen(kDim); p.drawText(QRectF(x + 14, 2, 105, 16), Qt::AlignLeft | Qt::AlignVCenter, labs[k]); x += 125;
    }
}

HBars::HBars() { setMinimumHeight(40); }

void HBars::paintEvent(QPaintEvent*) {
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);
    if (rows.isEmpty()) { p.setPen(kDim); p.drawText(rect(), Qt::AlignCenter, I18n::t("common.noData")); return; }
    double mx = 0; for (const auto& r : rows) mx = qMax(mx, r.value);
    if (mx <= 0) mx = 1;
    const double lw = qMin(150.0, width() * 0.34);
    const bool rtl = I18n::rtl();
    for (int i = 0; i < rows.size(); ++i) {
        const double y = 4 + i * 26;
        p.setPen(QColor("#0f172a"));
        p.drawText(QRectF(rtl ? width() - lw : 0, y, lw - 6, 20), (rtl ? Qt::AlignLeft : Qt::AlignRight) | Qt::AlignVCenter, p.fontMetrics().elidedText(rows[i].label, Qt::ElideRight, int(lw - 8)));
        const double span = width() - lw - 70, bw = qMax(3.0, span * rows[i].value / mx);
        const double x = rtl ? width() - lw - bw : lw;
        p.setPen(Qt::NoPen); p.setBrush(QColor(rows[i].color)); p.drawRoundedRect(QRectF(x, y + 3, bw, 14), 4, 4);
        p.setPen(kDim);
        p.drawText(rtl ? QRectF(x - 66, y, 60, 20) : QRectF(x + bw + 6, y, 64, 20), Qt::AlignVCenter | (rtl ? Qt::AlignRight : Qt::AlignLeft), rows[i].text);
    }
}
