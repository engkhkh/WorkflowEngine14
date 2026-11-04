#include "Prayer.h"

#include <QDateTime>
#include <QFile>
#include <QJsonDocument>
#include <QTimeZone>
#include <cmath>
#include <functional>

namespace Prayer {
namespace {
const double R = M_PI / 180, NANV = std::nan("");
double sinD(double d) { return std::sin(d * R); }
double cosD(double d) { return std::cos(d * R); }
double tanD(double d) { return std::tan(d * R); }
double arcsin(double x) { return x >= -1 && x <= 1 ? std::asin(x) / R : NANV; }
double arccos(double x) { return x >= -1 && x <= 1 ? std::acos(x) / R : NANV; }
double arctan2(double y, double x) { return std::atan2(y, x) / R; }
double arccot(double x) { return std::atan(1 / x) / R; }
double fixAngle(double a) { return a - 360 * std::floor(a / 360); }
double fixHour(double a) { return std::isnan(a) ? NANV : a - 24 * std::floor(a / 24); }

double julian(int y, int m, int d) {
    if (m <= 2) { y -= 1; m += 12; }
    double a = std::floor(y / 100.0), b = 2 - a + std::floor(a / 4);
    return std::floor(365.25 * (y + 4716)) + std::floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

void sun(double jd, double& decl, double& eqt) {
    double dd = jd - 2451545.0, g = fixAngle(357.529 + 0.98560028 * dd), q = fixAngle(280.459 + 0.98564736 * dd);
    double L = fixAngle(q + 1.915 * sinD(g) + 0.020 * sinD(2 * g)), e = 23.439 - 0.00000036 * dd;
    double ra = arctan2(cosD(e) * sinD(L), cosD(L)) / 15;
    decl = arcsin(sinD(e) * sinD(L));
    eqt = q / 15 - fixHour(ra);
}

double portion(const QString& hl, double night, double a) { return hl == "middle" ? night / 2 : hl == "seventh" ? night / 7 : (a / 60) * night; }

qint64 utcMs(int y, int m, int d, int h = 0) { return QDateTime(QDate(y, m, d), QTime(h, 0), Qt::UTC).toMSecsSinceEpoch(); }

double tzOffsetHours(const QString& name, qint64 atMs) {
    QTimeZone z(name.toUtf8());
    if (!z.isValid()) return 0;
    return std::round(z.offsetFromUtc(QDateTime::fromMSecsSinceEpoch(atMs, Qt::UTC)) / 60.0) / 60.0;
}

QJsonObject load() {
    QFile f(":/muslim.json");
    f.open(QIODevice::ReadOnly);
    return QJsonDocument::fromJson(f.readAll()).object();
}
}  // namespace

const QStringList& prayers() { static const QStringList p{"fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"}; return p; }
const QJsonObject& spec() { static const QJsonObject s = load(); return s; }
QJsonArray methods() { return spec().value("methods").toArray(); }

QJsonObject method(const QString& id) {
    for (const QJsonValue& m : methods()) if (m.toObject().value("id").toString() == id) return m.toObject();
    return methods().at(0).toObject();
}
QString defaultMethod(const QString& cc) {
    QString v = spec().value("defaultMethod").toObject().value(cc.toUpper()).toString();
    return v.isEmpty() ? "mwl" : v;
}
bool defaultHanafi(const QString& cc) {
    for (const QJsonValue& v : spec().value("hanafi").toArray()) if (v.toString().compare(cc, Qt::CaseInsensitive) == 0) return true;
    return false;
}

static void computeHours(int year, int month, int day, double lat, double lng, double elev, double tz, const Opts& o, double out[6]) {
    QJsonObject m = method(o.method);
    const double jd = julian(year, month, day) - lng / (15 * 24);
    QJsonValue mg = m.value("maghrib"), ish = m.value("isha");
    double fajrA = m.value("fajr").toDouble();
    double riseSet = 0.0347 * std::sqrt(std::max(0.0, elev)) + 0.833;
    auto midDay = [&](double t) { double d, e; sun(jd + t, d, e); return fixHour(12 - e); };
    auto angleTime = [&](double angle, double t, bool ccw, double la) {
        double decl, e; sun(jd + t, decl, e);
        double v = (-sinD(angle) - sinD(decl) * sinD(la)) / (cosD(decl) * cosD(la));
        return midDay(t) + (arccos(v) / 15) * (ccw ? -1 : 1);
    };
    auto asr = [&](double factor, double t) {
        double decl, e; sun(jd + t, decl, e);
        return angleTime(-arccot(factor + tanD(std::fabs(lat - decl))), t, false, lat);
    };
    // fajr, sunrise, dhuhr, asr, sunset, maghrib, isha
    auto raw = [&](double la, double t[7]) {
        t[0] = angleTime(fajrA, 5 / 24.0, true, la);
        t[1] = angleTime(riseSet, 6 / 24.0, true, la);
        t[2] = midDay(12 / 24.0);
        t[3] = asr(o.hanafi ? 2 : 1, 13 / 24.0);
        t[4] = angleTime(riseSet, 18 / 24.0, false, la);
        t[5] = mg.isDouble() ? angleTime(mg.toDouble(), 18 / 24.0, false, la) : NANV;
        t[6] = ish.isDouble() ? angleTime(ish.toDouble(), 18 / 24.0, false, la) : NANV;
    };
    double t[7];
    raw(lat, t);
    if (std::isnan(t[1]) || std::isnan(t[4])) {
        double k[7];
        raw((lat >= 0 ? 1 : -1) * 48.6, k);
        k[2] = t[2];
        k[3] = std::isnan(t[3]) ? k[3] : t[3];
        for (int i = 0; i < 7; ++i) t[i] = k[i];
    }
    double sunrise = t[1], sunset = t[4];
    double maghrib = mg.isObject() ? sunset + mg.toObject().value("min").toDouble() / 60 : mg.isDouble() ? t[5] : sunset;
    double fajr = t[0];
    double isha = ish.isObject() ? maghrib + ish.toObject().value("min").toDouble() / 60 : t[6];
    if (std::fabs(lat) > 48) {
        double night = fixHour(sunrise - sunset);
        QString hl = o.highLat.isEmpty() ? "angle" : o.highLat;
        double fl = portion(hl, night, fajrA);
        if (std::isnan(fajr) || fixHour(sunrise - fajr) > fl) fajr = sunrise - fl;
        if (ish.isDouble()) {
            double il = portion(hl, night, ish.toDouble());
            if (std::isnan(isha) || fixHour(isha - sunset) > il) isha = sunset + il;
        }
    }
    double shift = tz - lng / 15;
    double v[6] = {fajr, sunrise, t[2], t[3], maghrib, isha};
    for (int i = 0; i < 6; ++i) out[i] = v[i] + shift + o.adjust.value(prayers().at(i), 0) / 60.0;
}

Day day(int y, int m, int d, double lat, double lng, const QString& tzName, const Opts& o) {
    qint64 noon = utcMs(y, m, d, 12);
    double tz = tzOffsetHours(tzName, noon - qRound64(tzOffsetHours(tzName, noon) * 3600000));
    Day r;
    r.y = y; r.m = m; r.d = d; r.tz = tz;
    computeHours(y, m, d, lat, lng, 0, tz, o, r.hours);
    qint64 base = utcMs(y, m, d);
    for (int i = 0; i < 6; ++i)
        if (!std::isnan(r.hours[i])) r.at[i] = base + qint64(std::llround((r.hours[i] - tz) * 3600)) * 1000;
    return r;
}

QDate civil(qint64 ms, const QString& tz) { return QDateTime::fromMSecsSinceEpoch(ms, QTimeZone(tz.toUtf8())).date(); }

std::pair<int, qint64> next(qint64 now, double lat, double lng, const QString& tz, const Opts& o) {
    QDate d0 = civil(now, tz);
    for (int k = 0; k < 3; ++k) {
        QDate d = d0.addDays(k);
        Day t = day(d.year(), d.month(), d.day(), lat, lng, tz, o);
        for (int i = 0; i < 6; ++i) if (t.at[i] && *t.at[i] > now) return {i, *t.at[i]};
    }
    return {0, now};
}

std::pair<double, double> qibla(double lat, double lng) {
    const double kLat = 21.422487, kLng = 39.826206, dl = (kLng - lng) * R;
    double y = std::sin(dl), x = std::cos(lat * R) * std::tan(kLat * R) - std::sin(lat * R) * std::cos(dl);
    double a = std::pow(std::sin((kLat - lat) * R / 2), 2) + std::cos(lat * R) * std::cos(kLat * R) * std::pow(std::sin(dl / 2), 2);
    return {std::fmod(std::atan2(y, x) / R + 360, 360), 12742 * std::asin(std::sqrt(a))};
}
}  // namespace Prayer
