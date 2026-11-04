#pragma once
#include <QDate>
#include <QJsonArray>
#include <QJsonObject>
#include <QMap>
#include <QString>
#include <QStringList>
#include <optional>

/// Prayer times (the "PrayTimes" astronomical algorithm) - a line-by-line port of the portal's prayer-times.ts so every client gives the same minutes.
/// Times are epoch milliseconds; a missing value means the sun does not reach the angle.
namespace Prayer {
const QStringList& prayers();                 // fajr, sunrise, dhuhr, asr, maghrib, isha
const QJsonObject& spec();                    // muslim.json
QJsonArray methods();
QJsonObject method(const QString& id);
QString defaultMethod(const QString& cc);
bool defaultHanafi(const QString& cc);

struct Opts {
    QString method = "mwl", highLat = "angle";
    bool hanafi = false;
    QMap<QString, int> adjust;
};
struct Day {
    int y = 0, m = 0, d = 0;
    double tz = 0;
    std::optional<qint64> at[6];
    double hours[6] = {0, 0, 0, 0, 0, 0};
};

Day day(int y, int m, int d, double lat, double lng, const QString& tz, const Opts& o);
QDate civil(qint64 ms, const QString& tz);
/// index of the next prayer and its time
std::pair<int, qint64> next(qint64 nowMs, double lat, double lng, const QString& tz, const Opts& o);
/// bearing (degrees) and distance (km) to the Kaaba
std::pair<double, double> qibla(double lat, double lng);
}
