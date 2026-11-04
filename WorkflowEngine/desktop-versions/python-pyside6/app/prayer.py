"""Prayer times (the "PrayTimes" astronomical algorithm) - a line-by-line port of the portal's prayer-times.ts so both give the same minutes.
Times are epoch milliseconds (None when the sun does not reach the angle)."""
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SPEC = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'muslim.json').read_text(encoding='utf-8'))
METHODS = SPEC['methods']
PRAYERS = SPEC['prayers']
NAN = float('nan')
R = math.pi / 180


def method(mid):
    return next((m for m in METHODS if m['id'] == mid), METHODS[0])


def default_method(cc):
    return SPEC['defaultMethod'].get((cc or '').upper(), 'mwl')


def default_hanafi(cc):
    return (cc or '').upper() in SPEC['hanafi']


def _sin(d): return math.sin(d * R)
def _cos(d): return math.cos(d * R)
def _tan(d): return math.tan(d * R)
def _arcsin(x): return math.asin(x) / R if -1 <= x <= 1 else NAN
def _arccos(x): return math.acos(x) / R if -1 <= x <= 1 else NAN
def _arctan2(y, x): return math.atan2(y, x) / R
def _arccot(x): return math.atan(1 / x) / R
def _fix_angle(a): return a - 360 * math.floor(a / 360)
def _fix_hour(a): return a - 24 * math.floor(a / 24) if not math.isnan(a) else NAN


def _julian(y, m, d):
    if m <= 2:
        y -= 1
        m += 12
    a = math.floor(y / 100)
    b = 2 - a + math.floor(a / 4)
    return math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + b - 1524.5


def _sun(jd):
    dd = jd - 2451545.0
    g = _fix_angle(357.529 + 0.98560028 * dd)
    q = _fix_angle(280.459 + 0.98564736 * dd)
    L = _fix_angle(q + 1.915 * _sin(g) + 0.020 * _sin(2 * g))
    e = 23.439 - 0.00000036 * dd
    ra = _arctan2(_cos(e) * _sin(L), _cos(L)) / 15
    return _arcsin(_sin(e) * _sin(L)), q / 15 - _fix_hour(ra)


def compute_hours(year, month, day, place, tz, o):
    m = method(o.get('method'))
    lat, lng, elev = place['lat'], place['lng'], place.get('elevation', 0)
    jd = _julian(year, month, day) - lng / (15 * 24)

    def mid_day(t):
        return _fix_hour(12 - _sun(jd + t)[1])

    def angle_time(angle, t, ccw, la=None):
        la = lat if la is None else la
        decl = _sun(jd + t)[0]
        v = (-_sin(angle) - _sin(decl) * _sin(la)) / (_cos(decl) * _cos(la))
        return mid_day(t) + (_arccos(v) / 15) * (-1 if ccw else 1)

    def asr_time(factor, t):
        decl = _sun(jd + t)[0]
        return angle_time(-_arccot(factor + _tan(abs(lat - decl))), t, False)

    rise_set = 0.0347 * math.sqrt(max(0, elev)) + 0.833

    def raw(la):
        mg, ish = m.get('maghrib'), m['isha']
        return {
            'fajr': angle_time(m['fajr'], 5 / 24, True, la), 'sunrise': angle_time(rise_set, 6 / 24, True, la), 'dhuhr': mid_day(12 / 24),
            'asr': asr_time(2 if o.get('hanafi') else 1, 13 / 24), 'sunset': angle_time(rise_set, 18 / 24, False, la),
            'maghrib': angle_time(mg, 18 / 24, False, la) if isinstance(mg, (int, float)) else NAN,
            'isha': angle_time(ish, 18 / 24, False, la) if isinstance(ish, (int, float)) else NAN,
        }

    t = raw(lat)
    if math.isnan(t['sunrise']) or math.isnan(t['sunset']):
        c = raw((1 if lat >= 0 else -1) * 48.6)
        c['dhuhr'] = t['dhuhr']
        c['asr'] = c['asr'] if math.isnan(t['asr']) else t['asr']
        t = c
    mg, ish = m.get('maghrib'), m['isha']
    maghrib = t['sunset'] + mg['min'] / 60 if isinstance(mg, dict) else (t['maghrib'] if isinstance(mg, (int, float)) else t['sunset'])
    fajr = t['fajr']
    isha = maghrib + ish['min'] / 60 if isinstance(ish, dict) else t['isha']
    if abs(lat) > 48:
        night = _fix_hour(t['sunrise'] - t['sunset'])
        hl = o.get('highLat') or 'angle'

        def portion(a):
            return night / 2 if hl == 'middle' else night / 7 if hl == 'seventh' else (a / 60) * night
        fl = portion(m['fajr'])
        if math.isnan(fajr) or _fix_hour(t['sunrise'] - fajr) > fl:
            fajr = t['sunrise'] - fl
        if isinstance(ish, (int, float)):
            il = portion(ish)
            if math.isnan(isha) or _fix_hour(isha - t['sunset']) > il:
                isha = t['sunset'] + il
    shift = tz - lng / 15
    out = {'fajr': fajr, 'sunrise': t['sunrise'], 'dhuhr': t['dhuhr'], 'asr': t['asr'], 'maghrib': maghrib, 'isha': isha}
    adj = o.get('adjust') or {}
    return {p: out[p] + shift + (adj.get(p) or 0) / 60 for p in PRAYERS}


def tz_offset_hours(tz_name, at_ms):
    try:
        off = datetime.fromtimestamp(at_ms / 1000, ZoneInfo(tz_name)).utcoffset()
        return round(off.total_seconds() / 60) / 60
    except Exception:  # noqa: BLE001
        return 0.0


def prayer_day(y, m, d, place, tz_name, o):
    noon = datetime(y, m, d, 12, tzinfo=timezone.utc).timestamp() * 1000
    tz = tz_offset_hours(tz_name, noon - tz_offset_hours(tz_name, noon) * 3600000)
    hours = compute_hours(y, m, d, place, tz, o)
    base = datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1000
    at = {p: (None if math.isnan(hours[p]) else base + round((hours[p] - tz) * 3600) * 1000) for p in PRAYERS}
    return {'ymd': (y, m, d), 'tz': tz, 'at': at, 'hours': hours}


def civil_date(at_ms, tz_name):
    d = datetime.fromtimestamp(at_ms / 1000, ZoneInfo(tz_name))
    return d.year, d.month, d.day


def next_prayer(now_ms, place, tz_name, o):
    y, m, d = civil_date(now_ms, tz_name)
    for k in range(3):
        day = datetime(y, m, d, tzinfo=timezone.utc).toordinal() + k
        dd = datetime.fromordinal(day)
        t = prayer_day(dd.year, dd.month, dd.day, place, tz_name, o)
        for p in PRAYERS:
            a = t['at'][p]
            if a and a > now_ms:
                return p, a
    return 'fajr', now_ms


def qibla(lat, lng):
    k_lat, k_lng = 21.422487, 39.826206
    dl = (k_lng - lng) * R
    y = math.sin(dl)
    x = math.cos(lat * R) * math.tan(k_lat * R) - math.sin(lat * R) * math.cos(dl)
    a = math.sin((k_lat - lat) * R / 2) ** 2 + math.cos(lat * R) * math.cos(k_lat * R) * math.sin(dl / 2) ** 2
    return (math.atan2(y, x) / R + 360) % 360, 12742 * math.asin(math.sqrt(a))
