package erp;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Prayer times (the "PrayTimes" astronomical algorithm) - a line-by-line port of the portal's prayer-times.ts so both give the same minutes.
 *  Times are epoch milliseconds (null when the sun does not reach the angle). */
public final class Prayer {
    public static final Map<String, Object> SPEC;
    public static final List<Object> METHODS;
    public static final String[] PRAYERS = {"fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"};
    private static final double R = Math.PI / 180, NAN = Double.NaN;

    static {
        try (InputStream in = Prayer.class.getResourceAsStream("/muslim.json")) {
            SPEC = Json.obj(Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
        METHODS = Json.arr(SPEC.get("methods"));
    }

    private Prayer() { }

    /** Options: method id, hanafi, high-latitude rule and per-prayer adjustment in minutes. */
    public static final class Opts {
        public String method = "mwl", highLat = "angle";
        public boolean hanafi;
        public Map<String, Integer> adjust = new LinkedHashMap<>();
    }

    public static final class Day {
        public int y, m, d;
        public double tz;
        public Long[] at = new Long[6];
        public double[] hours = new double[6];
        public long get(String p) { return at[idx(p)]; }
    }

    public static int idx(String p) { for (int i = 0; i < PRAYERS.length; i++) if (PRAYERS[i].equals(p)) return i; return -1; }

    public static Map<String, Object> method(String id) {
        for (Object m : METHODS) if (Json.str(Json.obj(m).get("id")).equals(id)) return Json.obj(m);
        return Json.obj(METHODS.get(0));
    }

    public static String defaultMethod(String cc) {
        Object v = Json.obj(SPEC.get("defaultMethod")).get(cc == null ? "" : cc.toUpperCase());
        return v == null ? "mwl" : (String) v;
    }

    public static boolean defaultHanafi(String cc) {
        for (Object o : Json.arr(SPEC.get("hanafi"))) if (Json.str(o).equalsIgnoreCase(cc == null ? "" : cc)) return true;
        return false;
    }

    private static double sin(double d) { return Math.sin(d * R); }
    private static double cos(double d) { return Math.cos(d * R); }
    private static double tan(double d) { return Math.tan(d * R); }
    private static double arcsin(double x) { return x >= -1 && x <= 1 ? Math.asin(x) / R : NAN; }
    private static double arccos(double x) { return x >= -1 && x <= 1 ? Math.acos(x) / R : NAN; }
    private static double arctan2(double y, double x) { return Math.atan2(y, x) / R; }
    private static double arccot(double x) { return Math.atan(1 / x) / R; }
    private static double fixAngle(double a) { return a - 360 * Math.floor(a / 360); }
    private static double fixHour(double a) { return Double.isNaN(a) ? NAN : a - 24 * Math.floor(a / 24); }

    private static double julian(int y, int m, int d) {
        if (m <= 2) { y -= 1; m += 12; }
        double a = Math.floor(y / 100.0), b = 2 - a + Math.floor(a / 4);
        return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
    }

    private static double[] sun(double jd) {
        double dd = jd - 2451545.0, g = fixAngle(357.529 + 0.98560028 * dd), q = fixAngle(280.459 + 0.98564736 * dd);
        double L = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g)), e = 23.439 - 0.00000036 * dd;
        double ra = arctan2(cos(e) * sin(L), cos(L)) / 15;
        return new double[]{arcsin(sin(e) * sin(L)), q / 15 - fixHour(ra)};
    }

    private interface Raw { double[] of(double lat); }

    public static double[] computeHours(int year, int month, int day, double lat, double lng, double elev, double tz, Opts o) {
        Map<String, Object> m = method(o.method);
        final double jd = julian(year, month, day) - lng / (15 * 24);
        Object mg = m.get("maghrib"), ish = m.get("isha");
        double fajrA = num(m.get("fajr"));
        double riseSet = 0.0347 * Math.sqrt(Math.max(0, elev)) + 0.833;
        java.util.function.DoubleUnaryOperator midDay = t -> fixHour(12 - sun(jd + t)[1]);
        class Calc {
            double angleTime(double angle, double t, boolean ccw, double la) {
                double decl = sun(jd + t)[0];
                double v = (-sin(angle) - sin(decl) * sin(la)) / (cos(decl) * cos(la));
                return midDay.applyAsDouble(t) + (arccos(v) / 15) * (ccw ? -1 : 1);
            }
            double asr(double factor, double t) {
                double decl = sun(jd + t)[0];
                return angleTime(-arccot(factor + tan(Math.abs(lat - decl))), t, false, lat);
            }
            // fajr, sunrise, dhuhr, asr, sunset, maghrib, isha
            double[] raw(double la) {
                return new double[]{angleTime(fajrA, 5 / 24.0, true, la), angleTime(riseSet, 6 / 24.0, true, la), midDay.applyAsDouble(12 / 24.0),
                        asr(o.hanafi ? 2 : 1, 13 / 24.0), angleTime(riseSet, 18 / 24.0, false, la),
                        mg instanceof Number ? angleTime(((Number) mg).doubleValue(), 18 / 24.0, false, la) : NAN,
                        ish instanceof Number ? angleTime(((Number) ish).doubleValue(), 18 / 24.0, false, la) : NAN};
            }
        }
        Calc c = new Calc();
        double[] t = c.raw(lat);
        if (Double.isNaN(t[1]) || Double.isNaN(t[4])) {
            double[] k = c.raw((lat >= 0 ? 1 : -1) * 48.6);
            k[2] = t[2];
            k[3] = Double.isNaN(t[3]) ? k[3] : t[3];
            t = k;
        }
        double sunrise = t[1], sunset = t[4];
        double maghrib = mg instanceof Map ? sunset + num(Json.obj(mg).get("min")) / 60 : mg instanceof Number ? t[5] : sunset;
        double fajr = t[0];
        double isha = ish instanceof Map ? maghrib + num(Json.obj(ish).get("min")) / 60 : t[6];
        if (Math.abs(lat) > 48) {
            double night = fixHour(sunrise - sunset);
            String hl = o.highLat == null ? "angle" : o.highLat;
            double fl = portion(hl, night, fajrA);
            if (Double.isNaN(fajr) || fixHour(sunrise - fajr) > fl) fajr = sunrise - fl;
            if (ish instanceof Number) {
                double il = portion(hl, night, ((Number) ish).doubleValue());
                if (Double.isNaN(isha) || fixHour(isha - sunset) > il) isha = sunset + il;
            }
        }
        double shift = tz - lng / 15;
        double[] out = {fajr, sunrise, t[2], t[3], maghrib, isha};
        for (int i = 0; i < 6; i++) {
            Integer a = o.adjust == null ? null : o.adjust.get(PRAYERS[i]);
            out[i] = out[i] + shift + (a == null ? 0 : a) / 60.0;
        }
        return out;
    }

    private static double portion(String hl, double night, double a) { return "middle".equals(hl) ? night / 2 : "seventh".equals(hl) ? night / 7 : (a / 60) * night; }
    private static double num(Object o) { return o instanceof Number ? ((Number) o).doubleValue() : 0; }

    public static double tzOffsetHours(String tz, long atMs) {
        try {
            int s = ZoneId.of(tz).getRules().getOffset(Instant.ofEpochMilli(atMs)).getTotalSeconds();
            return Math.round(s / 60.0) / 60.0;
        } catch (Exception e) { return 0; }
    }

    private static long utcMs(int y, int m, int d, int h) { return LocalDate.of(y, m, d).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() + h * 3600000L; }

    public static Day day(int y, int m, int d, double lat, double lng, String tzName, Opts o) {
        long noon = utcMs(y, m, d, 12);
        double tz = tzOffsetHours(tzName, noon - Math.round(tzOffsetHours(tzName, noon) * 3600000));
        Day r = new Day();
        r.y = y; r.m = m; r.d = d; r.tz = tz;
        r.hours = computeHours(y, m, d, lat, lng, 0, tz, o);
        long base = utcMs(y, m, d, 0);
        for (int i = 0; i < 6; i++) r.at[i] = Double.isNaN(r.hours[i]) ? null : base + Math.round((r.hours[i] - tz) * 3600) * 1000L;
        return r;
    }

    public static int[] civil(long ms, String tz) {
        ZonedDateTime z = Instant.ofEpochMilli(ms).atZone(ZoneId.of(tz));
        return new int[]{z.getYear(), z.getMonthValue(), z.getDayOfMonth()};
    }

    /** Returns {index of the next prayer, its time in ms}. */
    public static long[] next(long now, double lat, double lng, String tz, Opts o) {
        int[] c = civil(now, tz);
        LocalDate d0 = LocalDate.of(c[0], c[1], c[2]);
        for (int k = 0; k < 3; k++) {
            LocalDate d = d0.plusDays(k);
            Day t = day(d.getYear(), d.getMonthValue(), d.getDayOfMonth(), lat, lng, tz, o);
            for (int i = 0; i < 6; i++) if (t.at[i] != null && t.at[i] > now) return new long[]{i, t.at[i]};
        }
        return new long[]{0, now};
    }

    /** Returns {bearing in degrees, distance in km} to the Kaaba. */
    public static double[] qibla(double lat, double lng) {
        double kLat = 21.422487, kLng = 39.826206, dl = (kLng - lng) * R;
        double y = Math.sin(dl), x = Math.cos(lat * R) * Math.tan(kLat * R) - Math.sin(lat * R) * Math.cos(dl);
        double a = Math.pow(Math.sin((kLat - lat) * R / 2), 2) + Math.cos(lat * R) * Math.cos(kLat * R) * Math.pow(Math.sin(dl / 2), 2);
        return new double[]{((Math.atan2(y, x) / R) + 360) % 360, 12742 * Math.asin(Math.sqrt(a))};
    }
}
