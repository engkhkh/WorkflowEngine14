#include "MuslimPage.h"

#include <QApplication>
#include <QCalendar>
#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFormLayout>
#include <QGridLayout>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QImage>
#include <QJsonDocument>
#include <QKeyEvent>
#include <QLineEdit>
#include <QLocale>
#include <QMessageBox>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPainter>
#include <QScrollBar>
#include <QStyle>
#include <QSettings>
#include <QShortcut>
#include <QStandardPaths>
#include <QTimeZone>
#include <QVBoxLayout>
#include <cmath>

#include "I18n.h"
#include "MushafText.h"
#include "QuranWords.h"
#include "Ui.h"

using I18n::t;

namespace {
// ---- shared spec
QJsonObject MF() { return Prayer::spec().value("mushaf").toObject(); }
int pages() { return MF().value("pages").toInt(604); }
QList<int> intList(const QJsonValue& v) { QList<int> r; for (const QJsonValue& x : v.toArray()) r << x.toInt(); return r; }
const QList<int>& surahStart() { static const QList<int> v = intList(MF().value("surahStart")); return v; }
const QList<int>& juzStart() { static const QList<int> v = intList(MF().value("juzStart")); return v; }
QString surahName(int n) { return MF().value("surahAr").toArray().at(n - 1).toString(); }
int clampPage(int p) { return std::min(pages(), std::max(1, p)); }
int surahOfPage(int p) { int n = 1; for (int i = 0; i < surahStart().size(); ++i) if (surahStart()[i] <= p) n = i + 1; return n; }
int juzOfPage(int p) { int n = 1; for (int i = 0; i < juzStart().size(); ++i) if (juzStart()[i] <= p) n = i + 1; return n; }
QJsonObject cities() { return Prayer::spec().value("cities").toObject(); }

// ---- settings (one JSON text in QSettings)
struct Store {
    QSettings q{"WorkflowEngine", "ErpQt"};
    QJsonObject s;
    Store() {
        QString cc = QLocale::system().name().section('_', 1, 1);
        QJsonArray list = cities().value(cc).toArray();
        QJsonArray c = list.isEmpty() ? QJsonArray() : list.at(0).toArray();
        bool has = !c.isEmpty();
        QJsonObject rem, adj;
        for (const QString& p : Prayer::prayers()) {
            adj[p] = 0;
            rem[p] = QJsonObject{{"on", p != "sunrise"}, {"before", p == "sunrise" ? 15 : 10}};
        }
        s = QJsonObject{{"cc", has ? cc : ""}, {"city", has ? c.at(0) : QJsonValue("")}, {"lat", has ? c.at(1) : QJsonValue(21.4225)}, {"lng", has ? c.at(2) : QJsonValue(39.8262)},
                        {"tz", has ? c.at(3) : QJsonValue("Asia/Riyadh")}, {"placeSet", has}, {"method", Prayer::defaultMethod(cc)}, {"hanafi", has && Prayer::defaultHanafi(cc)},
                        {"highLat", "angle"}, {"hijriAdjust", 0}, {"time24", false}, {"sound", "chime"}, {"adjust", adj}, {"remind", rem},
                        {"mpage", 1}, {"mzoom", 100}, {"mtwo", false}, {"mnight", false}, {"mbase", ""}, {"mmode", "img"}, {"mtheme", "rose"}, {"pmarks", QJsonArray()}};
        QJsonObject v = QJsonDocument::fromJson(q.value("muslim").toString().toUtf8()).object();
        for (auto it = v.begin(); it != v.end(); ++it) {
            if (it.key() == "remind" || it.key() == "adjust") {
                QJsonObject m = s.value(it.key()).toObject();
                QJsonObject o = it.value().toObject();
                for (auto k = o.begin(); k != o.end(); ++k) m[k.key()] = k.value();
                s[it.key()] = m;
            } else s[it.key()] = it.value();
        }
    }
    void save() { q.setValue("muslim", QString::fromUtf8(QJsonDocument(s).toJson(QJsonDocument::Compact))); }
    QString str(const char* k) const { return s.value(k).toString(); }
    double dbl(const char* k) const { return s.value(k).toDouble(); }
    int num(const char* k) const { return s.value(k).toInt(); }
    bool b(const char* k) const { return s.value(k).toBool(); }
    Prayer::Opts opts() const {
        Prayer::Opts o;
        o.method = str("method"); o.hanafi = b("hanafi"); o.highLat = str("highLat");
        QJsonObject a = s.value("adjust").toObject();
        for (auto it = a.begin(); it != a.end(); ++it) o.adjust[it.key()] = it.value().toInt();
        return o;
    }
    QJsonObject remind(const QString& p) const { return s.value("remind").toObject().value(p).toObject(); }
};
Store& ST() { static Store s; return s; }

QString pname(int i) { return t("mus." + Prayer::prayers().at(i)); }
QString countryName(const QString& cc) {
    QLocale loc(I18n::rtl() ? "ar" : "en");
    auto terr = QLocale::codeToTerritory(cc);
    return terr == QLocale::AnyTerritory ? cc : loc.territoryToString(terr);
}
QString fmtTime(const std::optional<qint64>& ms) {
    if (!ms) return QString::fromUtf8("—");
    QDateTime d = QDateTime::fromSecsSinceEpoch(qRound64(*ms / 60000.0) * 60, QTimeZone(ST().str("tz").toUtf8()));
    return ST().b("time24") ? d.toString("HH:mm") : d.toString("h:mm AP");
}
QString fillTokens(QString s, const QStringList& kv) { for (int i = 0; i + 1 < kv.size(); i += 2) s.replace("{" + kv[i] + "}", kv[i + 1]); return s; }
QString tk(const QString& key, const QStringList& kv) {
    // I18n::t returns the raw text, so substitute the tokens here
    return fillTokens(t(key), kv);
}

/// Hijri date; after Maghrib the Islamic day has begun, so it moves on by one. (Civil Islamic calendar: it can differ from Umm al-Qura by a day - use the adjust setting.)
QString hijri(const Prayer::Day& today) {
    qint64 now = QDateTime::currentMSecsSinceEpoch();
    bool after = today.at[4] && now >= *today.at[4];
    QDate d = Prayer::civil(now, ST().str("tz")).addDays((after ? 1 : 0) + ST().num("hijriAdjust"));
    QCalendar cal(QCalendar::System::IslamicCivil);
    auto p = cal.partsFromDate(d);
    if (!p.isValid()) return {};
    return QString("%1 %2 %3").arg(p.day).arg(cal.monthName(QLocale(I18n::rtl() ? "ar" : "en"), p.month, p.year)).arg(p.year);
}
}  // namespace

// ------------------------------------------------------------------ prayer times
class Dial : public QWidget {
public:
    double deg = 0;
    Dial() { setFixedSize(90, 90); }
protected:
    void paintEvent(QPaintEvent*) override {
        QPainter p(this);
        p.setRenderHint(QPainter::Antialiasing);
        p.setPen(QPen(QColor("#cbd5e1"), 2));
        p.drawEllipse(QPointF(45, 45), 40, 40);
        p.setPen(QColor("#64748b"));
        p.drawText(41, 14, "N");
        p.translate(45, 45);
        p.rotate(deg);
        p.setPen(QPen(QColor("#16a34a"), 4, Qt::SolidLine, Qt::RoundCap));
        p.drawLine(QPointF(0, 6), QPointF(0, -30));
        p.setBrush(QColor("#16a34a"));
        p.drawRect(-6, -38, 12, 12);
    }
};

PrayerTab::PrayerTab() {
    auto* outer = new QHBoxLayout(this);
    auto* left = new QVBoxLayout;
    outer->addLayout(left, 3);
    warn = new QLabel(t("mus.pickplace"));
    warn->setStyleSheet("background:#fef3c7;color:#92400e;padding:8px;border-radius:6px");
    warn->setWordWrap(true);
    left->addWidget(warn);
    auto* hero = new QFrame;
    hero->setProperty("card", true);
    auto* hl_ = new QHBoxLayout(hero);
    auto* col = new QVBoxLayout;
    place = Ui::label("", "title");
    date = Ui::label("", "dim");
    next = new QLabel;
    next->setStyleSheet("font-size:15px");
    next->setTextFormat(Qt::RichText);
    cd = new QLabel("--:--:--");
    cd->setStyleSheet("font-size:34px;font-weight:700;color:#2563eb");
    for (QWidget* w : {static_cast<QWidget*>(place), static_cast<QWidget*>(date), static_cast<QWidget*>(next), static_cast<QWidget*>(cd)}) col->addWidget(w);
    hl_->addLayout(col, 1);
    auto* qc = new QVBoxLayout;
    dial = new Dial;
    qibla = Ui::label("", "dim");
    qc->addWidget(dial, 0, Qt::AlignHCenter);
    qc->addWidget(qibla);
    hl_->addLayout(qc);
    left->addWidget(hero);
    auto* seg = new QHBoxLayout;
    seg->addWidget(Ui::label(t("mus.today"), "title"));
    seg->addStretch();
    dayB = Ui::button(t("mus.day"), [this] { setMonthly(false); });
    monB = Ui::button(t("mus.month"), [this] { setMonthly(true); }, "ghost");
    seg->addWidget(dayB);
    seg->addWidget(monB);
    left->addLayout(seg);
    table = Ui::table({"", "", ""});
    table->setAlternatingRowColors(false);
    left->addWidget(table, 1);
    connect(table, &QTableWidget::cellClicked, this, [this](int r, int c) { bell(r, c); });
    polar = Ui::label(t("mus.polar"), "dim");
    left->addWidget(polar);

    // ---- settings (right)
    auto* scroll = new QScrollArea;
    scroll->setWidgetResizable(true);
    scroll->setFrameShape(QFrame::NoFrame);
    auto* formW = new QWidget;
    auto* g = new QGridLayout(formW);
    scroll->setWidget(formW);
    outer->addWidget(scroll, 2);
    int r = 0;
    auto row = [&](const QString& text, QWidget* w) { g->addWidget(new QLabel(text), r, 0); g->addWidget(w, r, 1); ++r; };
    g->addWidget(Ui::label(t("mus.place"), "title"), r++, 0, 1, 2);
    country = new QComboBox; city = new QComboBox; tz = new QComboBox; method = new QComboBox; asr = new QComboBox; hl = new QComboBox; hj = new QComboBox; clock = new QComboBox; sound = new QComboBox;
    lat = new QDoubleSpinBox; lng = new QDoubleSpinBox;
    lat->setRange(-90, 90); lng->setRange(-180, 180);
    lat->setDecimals(4); lng->setDecimals(4);
    country->addItem(t("mus.custom"), "");
    QStringList ccs = cities().keys();
    std::sort(ccs.begin(), ccs.end(), [](const QString& a, const QString& b) { return countryName(a).localeAwareCompare(countryName(b)) < 0; });
    for (const QString& cc : ccs) country->addItem(countryName(cc), cc);
    QStringList zones;
    for (const QByteArray& z : QTimeZone::availableTimeZoneIds()) zones << QString::fromLatin1(z);
    zones.sort();
    tz->addItems(zones);
    for (const QJsonValue& m : Prayer::methods()) method->addItem(m.toObject().value("name").toString(), m.toObject().value("id").toString());
    asr->addItem(t("mus.asr.std"), false);
    asr->addItem(t("mus.asr.hanafi"), true);
    for (const char* k : {"angle", "seventh", "middle"}) hl->addItem(t(QString("mus.hl.") + k), k);
    for (int n = -2; n <= 2; ++n) hj->addItem(n > 0 ? QString("+%1").arg(n) : QString::number(n), n);
    clock->addItem("12 h", false);
    clock->addItem("24 h", true);
    sound->addItem(t("mus.sound.chime"), "chime");
    sound->addItem(t("mus.sound.none"), "none");
    row(t("mus.country"), country); row(t("mus.city"), city); row(t("mus.lat"), lat); row(t("mus.lng"), lng); row(t("mus.tz"), tz);
    row(t("mus.method"), method); row(t("mus.asr.label"), asr); row(t("mus.highlat"), hl); row(t("mus.hijriadj"), hj); row(t("mus.clock"), clock);
    g->addWidget(Ui::label(t("mus.adjhelp"), "dim"), r++, 0, 1, 2);
    for (int i = 0; i < 6; ++i) { adj[i] = new QSpinBox; adj[i]->setRange(-60, 60); row(pname(i), adj[i]); }
    g->addWidget(Ui::label(t("mus.reminders"), "title"), r++, 0, 1, 2);
    for (int i = 0; i < 6; ++i) {
        auto* h = new QHBoxLayout;
        remOn[i] = new QCheckBox(pname(i));
        remMin[i] = new QSpinBox;
        remMin[i]->setRange(0, 120);
        remMin[i]->setSuffix(" " + tk("mus.minbefore", {"n", ""}).trimmed());
        h->addWidget(remOn[i]);
        h->addWidget(remMin[i]);
        g->addLayout(h, r++, 0, 1, 2);
    }
    row(t("mus.sound"), sound);
    g->addWidget(Ui::button(t("mus.testremind"), [this] { fire(0, 10); }), r++, 0, 1, 2);
    g->setRowStretch(r, 1);

    loadForm();
    loading = false;
    for (QComboBox* c : {country, city, tz, method, asr, hl, hj, clock, sound}) connect(c, QOverload<int>::of(&QComboBox::currentIndexChanged), this, [this, c] { changed(c); });
    for (QDoubleSpinBox* s : {lat, lng}) connect(s, QOverload<double>::of(&QDoubleSpinBox::valueChanged), this, [this, s] { changed(s); });
    for (int i = 0; i < 6; ++i) {
        connect(adj[i], QOverload<int>::of(&QSpinBox::valueChanged), this, [this, i] { changed(adj[i]); });
        connect(remMin[i], QOverload<int>::of(&QSpinBox::valueChanged), this, [this, i] { changed(remMin[i]); });
        connect(remOn[i], &QCheckBox::toggled, this, [this, i] { changed(remOn[i]); });
    }
    auto* timer = new QTimer(this);
    connect(timer, &QTimer::timeout, this, [this] { tick(); });
    timer->start(1000);
    refresh();
}

void PrayerTab::setMonthly(bool m) {
    monthly = m;
    dayB->setProperty("kind", m ? "ghost" : "");
    monB->setProperty("kind", m ? "" : "ghost");
    for (QPushButton* b : {dayB, monB}) { b->style()->unpolish(b); b->style()->polish(b); }
    refresh();
}

void PrayerTab::fillCities() {
    city->blockSignals(true);
    city->clear();
    QString cc = country->currentData().toString();
    for (const QJsonValue& c : cities().value(cc).toArray()) city->addItem(c.toArray().at(0).toString());
    city->setEnabled(!cc.isEmpty());
    city->blockSignals(false);
}

void PrayerTab::loadForm() {
    Store& s = ST();
    country->setCurrentIndex(std::max(0, country->findData(s.str("cc"))));
    fillCities();
    city->setCurrentIndex(std::max(0, city->findText(s.str("city"))));
    lat->setValue(s.dbl("lat"));
    lng->setValue(s.dbl("lng"));
    tz->setCurrentText(s.str("tz"));
    method->setCurrentIndex(std::max(0, method->findData(s.str("method"))));
    asr->setCurrentIndex(s.b("hanafi") ? 1 : 0);
    hl->setCurrentIndex(std::max(0, hl->findData(s.str("highLat"))));
    hj->setCurrentIndex(std::max(0, hj->findData(s.num("hijriAdjust"))));
    clock->setCurrentIndex(s.b("time24") ? 1 : 0);
    for (int i = 0; i < 6; ++i) {
        QString p = Prayer::prayers().at(i);
        adj[i]->setValue(s.s.value("adjust").toObject().value(p).toInt());
        remOn[i]->setChecked(s.remind(p).value("on").toBool());
        remMin[i]->setValue(s.remind(p).value("before").toInt());
    }
    sound->setCurrentIndex(std::max(0, sound->findData(s.str("sound"))));
    warn->setVisible(!s.b("placeSet"));
}

void PrayerTab::changed(QObject* src) {
    if (loading) return;
    Store& st = ST();
    QJsonObject& s = st.s;
    if (src == country) {
        QString cc = country->currentData().toString();
        if (!cc.isEmpty()) {
            QJsonArray c = cities().value(cc).toArray().at(0).toArray();
            s["cc"] = cc; s["city"] = c.at(0); s["lat"] = c.at(1); s["lng"] = c.at(2); s["tz"] = c.at(3); s["placeSet"] = true;
            s["method"] = Prayer::defaultMethod(cc); s["hanafi"] = Prayer::defaultHanafi(cc);
        } else { s["cc"] = ""; s["city"] = ""; }
        apply();
        return;
    }
    if (src == city) {
        for (const QJsonValue& cv : cities().value(st.str("cc")).toArray()) {
            QJsonArray c = cv.toArray();
            if (c.at(0).toString() == city->currentText()) {
                s["city"] = c.at(0); s["lat"] = c.at(1); s["lng"] = c.at(2); s["tz"] = c.at(3); s["placeSet"] = true;
                apply();
                return;
            }
        }
    }
    s["lat"] = lat->value(); s["lng"] = lng->value(); s["tz"] = tz->currentText();
    s["method"] = method->currentData().toString(); s["hanafi"] = asr->currentData().toBool(); s["highLat"] = hl->currentData().toString();
    s["hijriAdjust"] = hj->currentData().toInt(); s["time24"] = clock->currentData().toBool(); s["sound"] = sound->currentData().toString();
    QJsonObject a, r;
    for (int i = 0; i < 6; ++i) {
        a[Prayer::prayers().at(i)] = adj[i]->value();
        r[Prayer::prayers().at(i)] = QJsonObject{{"on", remOn[i]->isChecked()}, {"before", remMin[i]->value()}};
    }
    s["adjust"] = a; s["remind"] = r;
    if (src == lat || src == lng) { s["placeSet"] = true; s["cc"] = ""; s["city"] = ""; }
    apply();
}

void PrayerTab::apply() {
    ST().save();
    loading = true;
    loadForm();
    loading = false;
    refresh();
}

Prayer::Day PrayerTab::today() const {
    QDate d = Prayer::civil(QDateTime::currentMSecsSinceEpoch(), ST().str("tz"));
    return Prayer::day(d.year(), d.month(), d.day(), ST().dbl("lat"), ST().dbl("lng"), ST().str("tz"), ST().opts());
}

void PrayerTab::refresh() {
    Store& s = ST();
    Prayer::Day td = today();
    qint64 now = QDateTime::currentMSecsSinceEpoch();
    auto nx = Prayer::next(now, s.dbl("lat"), s.dbl("lng"), s.str("tz"), s.opts());
    nextAt = nx.second;
    place->setText((s.str("city").isEmpty() ? t("mus.custom") : s.str("city")) + (s.str("cc").isEmpty() ? QString() : " · " + countryName(s.str("cc"))));
    QLocale loc(I18n::rtl() ? "ar" : "en");
    date->setText(QDateTime::fromMSecsSinceEpoch(now, QTimeZone(s.str("tz").toUtf8())).toString("dddd d MMMM yyyy").replace(QString("dddd"), "") + " · " + hijri(td));
    date->setText(loc.toString(QDateTime::fromMSecsSinceEpoch(now, QTimeZone(s.str("tz").toUtf8())).date(), "dddd d MMMM yyyy") + " · " + hijri(td));
    next->setText(QString("%1  <b>%2</b>  %3").arg(t("mus.next"), pname(nx.first), fmtTime(nx.second)));
    auto q = Prayer::qibla(s.dbl("lat"), s.dbl("lng"));
    static_cast<Dial*>(dial)->deg = q.first;
    dial->update();
    qibla->setText(QString("%1: %2° · %3 km").arg(t("mus.qibla")).arg(qRound(q.first)).arg(QLocale(QLocale::English).toString(qRound64(q.second))));
    warn->setVisible(!s.b("placeSet"));
    bool cut = false;
    for (auto& a : td.at) if (!a) cut = true;
    polar->setVisible(cut);
    if (!monthly) {
        table->setColumnCount(3);
        table->setHorizontalHeaderLabels({"", "", ""});
        table->horizontalHeader()->setVisible(false);
        table->clearContents();
        table->setRowCount(6);
        for (int i = 0; i < 6; ++i) {
            QList<QTableWidgetItem*> items{new QTableWidgetItem(pname(i)), new QTableWidgetItem(fmtTime(td.at[i])),
                                           new QTableWidgetItem(s.remind(Prayer::prayers().at(i)).value("on").toBool() ? QString::fromUtf8("🔔") : QString::fromUtf8("🔕"))};
            for (int j = 0; j < 3; ++j) {
                if (i == nx.first) { QFont f = items[j]->font(); f.setBold(true); items[j]->setFont(f); items[j]->setBackground(QColor("#dbeafe")); }
                table->setItem(i, j, items[j]);
            }
        }
    } else {
        int days = QDate(td.y, td.m, 1).daysInMonth();
        table->horizontalHeader()->setVisible(true);
        table->clearContents();
        table->setColumnCount(7);
        QStringList heads{"#"};
        for (int i = 0; i < 6; ++i) heads << pname(i);
        table->setHorizontalHeaderLabels(heads);
        table->setRowCount(days);
        for (int d = 1; d <= days; ++d) {
            Prayer::Day x = Prayer::day(td.y, td.m, d, s.dbl("lat"), s.dbl("lng"), s.str("tz"), s.opts());
            QStringList cells{QString::number(d)};
            for (int i = 0; i < 6; ++i) cells << fmtTime(x.at[i]);
            for (int j = 0; j < 7; ++j) {
                auto* it = new QTableWidgetItem(cells[j]);
                if (d == td.d) it->setBackground(QColor("#dbeafe"));
                table->setItem(d - 1, j, it);
            }
        }
    }
}

void PrayerTab::bell(int row, int col) {
    if (monthly || col != 2 || row < 0 || row > 5) return;
    QString p = Prayer::prayers().at(row);
    QJsonObject rem = ST().s.value("remind").toObject();
    QJsonObject one = rem.value(p).toObject();
    one["on"] = !one.value("on").toBool();
    rem[p] = one;
    ST().s["remind"] = rem;
    apply();
}

void PrayerTab::tick() {
    qint64 now = QDateTime::currentMSecsSinceEpoch();
    qint64 left = std::max<qint64>(0, (nextAt - now) / 1000);
    cd->setText(QString("%1:%2:%3").arg(left / 3600, 2, 10, QChar('0')).arg(left % 3600 / 60, 2, 10, QChar('0')).arg(left % 60, 2, 10, QChar('0')));
    if (left == 0) refresh();
    Prayer::Day td = today();
    for (int i = 0; i < 6; ++i) {
        QJsonObject r = ST().remind(Prayer::prayers().at(i));
        if (!r.value("on").toBool() || !td.at[i]) continue;
        int before = r.value("before").toInt();
        qint64 target = *td.at[i] - before * 60000LL;
        QString key = QString("%1-%2-%3|%4|%5").arg(td.y).arg(td.m).arg(td.d).arg(i).arg(before);
        if (target <= now && now < target + 120000 && !fired.contains(key)) { fired.insert(key); fire(i, before); }
    }
}

void PrayerTab::fire(int i, int before) {
    QString msg = before > 0 ? tk("mus.remind.in", {"name", pname(i), "n", QString::number(before)}) : tk("mus.remind.now", {"name", pname(i)});
    if (ST().str("sound") != "none")
        for (int k = 0; k < 3; ++k) QTimer::singleShot(k * 350, [] { QApplication::beep(); });
    auto* box = new QMessageBox(QMessageBox::Information, t("module.muslim"), msg, QMessageBox::Ok, window());
    box->setAttribute(Qt::WA_DeleteOnClose);
    box->setModal(false);
    box->show();
    QTimer::singleShot(120000, box, &QMessageBox::close);
}

// ------------------------------------------------------------------ Mushaf reader
static QString cacheDir() { return QStandardPaths::writableLocation(QStandardPaths::CacheLocation) + "/mushaf"; }

MushafReader::MushafReader(std::function<void()> onPage) : onPage_(std::move(onPage)) {
    setLayoutDirection(Qt::LeftToRight);   // physical layout: the next page is to the left, like an Arabic book
    auto* v = new QVBoxLayout(this);
    auto* bar = new QHBoxLayout;
    nextB = new QPushButton(QString::fromUtf8("❮")); prevB = new QPushButton(QString::fromUtf8("❯"));
    nextB->setToolTip(t("mus.q.next")); prevB->setToolTip(t("mus.q.prev"));
    pageSp = new QSpinBox; pageSp->setRange(1, pages());
    where = new QLabel; where->setStyleSheet("font-size:18px");
    juz = new QComboBox;
    for (int j = 1; j <= 30; ++j) juz->addItem(QString("%1 %2").arg(t("mus.q.juz")).arg(j), j);
    minus = new QPushButton(QString::fromUtf8("−")); zoomL = new QLabel("100%"); plus = new QPushButton("+"); fit = new QPushButton(QString::fromUtf8("⤢"));
    two = new QPushButton(QString::fromUtf8("▯▯")); mode = new QPushButton("Aa"); night = new QPushButton(QString::fromUtf8("☾")); theme = new QPushButton(QString::fromUtf8("🎨")); star = new QPushButton(QString::fromUtf8("★"));
    marks = new QComboBox; full = new QPushButton(QString::fromUtf8("⛶"));
    for (QPushButton* b : {two, mode, night, star}) b->setCheckable(true);
    for (QWidget* w : {static_cast<QWidget*>(nextB), static_cast<QWidget*>(new QLabel(t("mus.q.page"))), static_cast<QWidget*>(pageSp), static_cast<QWidget*>(new QLabel(QString("/ %1").arg(pages()))),
                       static_cast<QWidget*>(prevB), static_cast<QWidget*>(where), static_cast<QWidget*>(juz)}) bar->addWidget(w);
    bar->addStretch();
    for (QWidget* w : {static_cast<QWidget*>(minus), static_cast<QWidget*>(zoomL), static_cast<QWidget*>(plus), static_cast<QWidget*>(fit), static_cast<QWidget*>(two), static_cast<QWidget*>(mode), static_cast<QWidget*>(theme), static_cast<QWidget*>(night),
                       static_cast<QWidget*>(star), static_cast<QWidget*>(marks), static_cast<QWidget*>(full)}) bar->addWidget(w);
    v->addLayout(bar);
    area = new QScrollArea;
    area->setWidgetResizable(true);
    stage = new QWidget;
    stage->setLayoutDirection(Qt::LeftToRight);
    box = new QHBoxLayout(stage);
    box->setAlignment(Qt::AlignHCenter | Qt::AlignTop);
    area->setWidget(stage);
    v->addWidget(area, 1);
    auto* src = new QHBoxLayout;
    src->addWidget(new QLabel(t("mus.q.source")));
    base = new QLineEdit(ST().str("mbase"));
    base->setPlaceholderText(MF().value("base").toString());
    src->addWidget(base, 1);
    src->addWidget(Ui::button(t("mus.q.apply"), [this] { ST().s["mbase"] = base->text().trimmed(); ST().save(); pix.clear(); failed.clear(); render(); }));
    v->addLayout(src);

    connect(nextB, &QPushButton::clicked, this, [this] { go(page() + step()); });
    connect(prevB, &QPushButton::clicked, this, [this] { go(page() - step()); });
    connect(pageSp, &QSpinBox::editingFinished, this, [this] { if (!busy_) go(pageSp->value()); });
    connect(juz, QOverload<int>::of(&QComboBox::activated), this, [this](int i) { go(juzStart().at(i)); });
    connect(minus, &QPushButton::clicked, this, [this] { zoom(-10); });
    connect(plus, &QPushButton::clicked, this, [this] { zoom(10); });
    connect(fit, &QPushButton::clicked, this, [this] { ST().s["mzoom"] = 100; ST().save(); render(); });
    connect(two, &QPushButton::clicked, this, [this](bool c) { ST().s["mtwo"] = c; ST().save(); render(); });
    connect(mode, &QPushButton::clicked, this, [this](bool c) { ST().s["mmode"] = c ? "text" : "img"; ST().save(); render(); });
    connect(night, &QPushButton::clicked, this, [this](bool c) { ST().s["mnight"] = c; ST().save(); render(); });
    connect(theme, &QPushButton::clicked, this, [this] { ST().s["mtheme"] = ST().str("mtheme") == "blue" ? "rose" : "blue"; ST().save(); render(); });
    connect(star, &QPushButton::clicked, this, [this] { toggleMark(); });
    connect(marks, QOverload<int>::of(&QComboBox::activated), this, [this](int i) { if (i > 0) go(marks->itemData(i).toInt()); });
    connect(full, &QPushButton::clicked, this, [this] { window()->isFullScreen() ? window()->showNormal() : window()->showFullScreen(); });
    auto* l = new QShortcut(QKeySequence(Qt::Key_Left), this, [this] { go(page() + step()); });
    auto* r = new QShortcut(QKeySequence(Qt::Key_Right), this, [this] { go(page() - step()); });
    l->setContext(Qt::WidgetWithChildrenShortcut);
    r->setContext(Qt::WidgetWithChildrenShortcut);
    area->viewport()->installEventFilter(this);
    render();
}

int MushafReader::page() const { return clampPage(ST().num("mpage")); }
bool MushafReader::isTwo() const { return ST().b("mtwo") && area->viewport()->width() >= 760; }
void MushafReader::go(int p) { failed.clear(); ST().s["mpage"] = clampPage(p); ST().save(); render(); area->verticalScrollBar()->setValue(0); }
void MushafReader::zoom(int d) { ST().s["mzoom"] = std::min(220, std::max(50, ST().num("mzoom") + d)); ST().save(); render(); }

bool MushafReader::eventFilter(QObject* o, QEvent* e) {
    if (o == area->viewport() && e->type() == QEvent::Resize) QTimer::singleShot(0, this, [this] { layoutPages(); });
    return QWidget::eventFilter(o, e);
}

QList<int> MushafReader::shown() const {
    int p = page();
    if (!isTwo()) return {p};
    int o = p % 2 ? p : p - 1;
    QList<int> l;
    for (int x : {o, o + 1}) if (x >= 1 && x <= pages()) l << x;
    return l;
}

int MushafReader::widthPx() const {
    int avail = std::max(240, area->viewport()->width() - 40);
    double b = isTwo() ? std::min(560.0, (avail - 6) / 2.0) : std::min(640, avail);
    return int(b * ST().num("mzoom") / 100.0);
}

void MushafReader::render() {
    busy_ = true;
    Store& s = ST();
    int p = page();
    pageSp->setValue(p);
    where->setText(QString::fromUtf8("سورة ") + surahName(surahOfPage(p)) + QString(" · %1 %2").arg(t("mus.q.juz")).arg(juzOfPage(p)));
    juz->setCurrentIndex(juzOfPage(p) - 1);
    zoomL->setText(QString("%1%").arg(s.num("mzoom")));
    two->setChecked(s.b("mtwo")); night->setChecked(s.b("mnight"));
    mode->setChecked(s.str("mmode") == "text");
    theme->setVisible(s.str("mmode") == "text"); theme->setToolTip(t("mus.q.theme"));
    mode->setToolTip(s.str("mmode") == "text" ? t("mus.q.imgmode") : t("mus.q.textmode"));
    QJsonArray pm = s.s.value("pmarks").toArray();
    star->setChecked(pm.contains(p));
    marks->clear();
    marks->addItem(QString::fromUtf8("★ %1").arg(pm.size()), 0);
    QList<int> sorted;
    for (const QJsonValue& m : pm) sorted << m.toInt();
    std::sort(sorted.begin(), sorted.end());
    for (int m : sorted) marks->addItem(QString("%1 %2 · %3").arg(t("mus.q.page")).arg(m).arg(surahName(surahOfPage(m))), m);
    marks->setVisible(!pm.isEmpty());
    nextB->setEnabled(p + step() <= pages());
    prevB->setEnabled(p - step() >= 1);
    area->setStyleSheet(s.b("mnight") ? "background:#0d0d0d" : "background:#e5e9f0");
    busy_ = false;
    for (int q : shown()) load(q, false);
    for (int q : {p + 1, p + 2, p - 1}) if (q >= 1 && q <= pages()) load(q, true);
    layoutPages();
    if (onPage_) onPage_();
}

static QPixmap flatten(const QImage& src) {
    QImage out(src.size(), QImage::Format_RGB32);
    out.fill(Qt::white);   // the page images are transparent PNGs
    QPainter p(&out);
    p.drawImage(0, 0, src);
    return QPixmap::fromImage(out);
}

void MushafReader::load(int p, bool quiet) {
    if (pix.contains(p) || failed.contains(p) || loading.contains(p)) return;
    QString b = ST().str("mbase").isEmpty() ? MF().value("base").toString() : ST().str("mbase");
    QString name = QString("%1.png").arg(p, 3, 10, QChar('0'));
    auto done = [this, p, quiet](const QImage& img) {
        loading.remove(p);
        if (!img.isNull()) {
            pix.insert(p, flatten(img));
            if (pix.size() > 12) for (int k : pix.keys()) { if (pix.size() <= 8) break; if (!shown().contains(k)) pix.remove(k); }
        } else if (!quiet) failed.insert(p);
        if (shown().contains(p)) layoutPages();
    };
    loading.insert(p);
    if (b.startsWith("http", Qt::CaseInsensitive)) {
        QString dir = cacheDir() + "/" + QString::fromLatin1(QCryptographicHash::hash(b.toUtf8(), QCryptographicHash::Md5).toHex().left(8));
        QString f = dir + "/" + name;
        if (QFile::exists(f)) { done(QImage(f)); return; }
        QString url = b;
        while (url.endsWith('/')) url.chop(1);
        QNetworkRequest req(QUrl(url + "/" + name));
        req.setHeader(QNetworkRequest::UserAgentHeader, "WorkflowErp-Desktop");
        req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
        req.setTransferTimeout(30000);
        QNetworkReply* rep = nam_.get(req);
        connect(rep, &QNetworkReply::finished, this, [rep, done, dir, f] {
            QByteArray data = rep->readAll();
            QImage img;
            if (rep->error() == QNetworkReply::NoError) img.loadFromData(data);
            if (!img.isNull()) { QDir().mkpath(dir); QFile o(f); if (o.open(QIODevice::WriteOnly)) o.write(data); }
            rep->deleteLater();
            done(img);
        });
    } else {
        done(QImage(QDir(b).filePath(name)));
    }
}

void MushafReader::layoutPages() {
    while (QLayoutItem* it = box->takeAt(0)) { delete it->widget(); delete it; }
    int w = widthPx(), h = int(w * 4206.0 / 2600);
    bool nt = ST().b("mnight");
    QList<int> l = shown();
    std::sort(l.begin(), l.end(), std::greater<int>());   // left to right: the later (even) page, then the odd page on the right
    for (int p : l) {
        auto* lab = new MushafLabel;
        lab->page = p;
        lab->setAlignment(Qt::AlignCenter);
        lab->setFixedSize(w, h);
        lab->setLayoutDirection(Qt::LeftToRight);
        lab->setStyleSheet(QString("background:%1").arg(nt ? "#000" : "#fff"));
        if (ST().str("mmode") == "text") {
            lab->setPixmap(QPixmap::fromImage(MushafText::render(p, w, nt, ST().s.value("mtheme").toString("rose"), &lab->hits)));
            lab->setCursor(Qt::PointingHandCursor);
            connect(lab, &MushafLabel::wordClicked, this, [this](int pg, int li, int ti, const QString& wd) { WordDialog(this, pg, li, ti, wd).exec(); });
        } else if (pix.contains(p)) {
            QImage img = pix.value(p).toImage().scaledToWidth(w, Qt::SmoothTransformation);
            if (nt) img.invertPixels();
            lab->setPixmap(QPixmap::fromImage(img));
        } else if (failed.contains(p)) {
            lab->setWordWrap(true);
            lab->setAlignment(Qt::AlignTop | Qt::AlignLeft);
            lab->setText(t("mus.q.imgerr"));
            lab->setStyleSheet("background:#fff;color:#444;padding:20px");
        } else lab->setText(t("mus.loading"));
        box->addWidget(lab);
    }
}

void MushafReader::toggleMark() {
    int p = page();
    QJsonArray pm = ST().s.value("pmarks").toArray(), out;
    bool had = false;
    for (const QJsonValue& m : pm) { if (m.toInt() == p) had = true; else out.append(m); }
    if (!had) out.append(p);
    ST().s["pmarks"] = out;
    ST().save();
    render();
}

QuranTab::QuranTab() {
    auto* h = new QHBoxLayout(this);
    list = new QListWidget;
    list->setFixedWidth(230);
    for (int i = 1; i <= MF().value("surahAr").toArray().size(); ++i) list->addItem(QString("%1   %2").arg(i).arg(surahName(i)));
    h->addWidget(list);
    reader = new MushafReader([this] { sync(); });
    h->addWidget(reader, 1);
    connect(list, &QListWidget::currentRowChanged, this, [this](int r) { if (r >= 0 && surahOfPage(reader->page()) - 1 != r) reader->go(surahStart().at(r)); });
    sync();
}

void QuranTab::sync() {
    if (!reader) return;
    list->blockSignals(true);
    list->setCurrentRow(surahOfPage(reader->page()) - 1);
    list->blockSignals(false);
}

void QuranTab::showEvent(QShowEvent* e) {
    sync();
    QTimer::singleShot(0, reader, [this] { reader->render(); });
    QWidget::showEvent(e);
}

MuslimPage::MuslimPage() {
    lay->addWidget(Ui::label(t("module.muslim"), "title"));
    tabs = new QTabWidget;
    times = new PrayerTab;
    quran = new QuranTab;
    tabs->addTab(times, t("mus.tab.times"));
    tabs->addTab(quran, t("mus.tab.quran"));
    lay->addWidget(tabs, 1);
}

void MuslimPage::reload() { times->refresh(); }
