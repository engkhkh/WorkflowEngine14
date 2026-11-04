using System.Text.Json.Nodes;

namespace WorkflowErp.Services;

/// <summary>Prayer times (the "PrayTimes" astronomical algorithm) - a line-by-line port of the portal's prayer-times.ts so every client gives the same minutes.
/// Times are epoch milliseconds; null means the sun does not reach the angle.</summary>
public static class Prayer
{
    public static readonly string[] Names = { "fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha" };
    private static JsonNode? _spec;
    public static JsonNode Spec => _spec ??= JsonNode.Parse(Loc.ReadData("muslim.json"))!;
    private const double R = Math.PI / 180;

    public sealed class Opts
    {
        public string Method = "mwl";
        public string HighLat = "angle";
        public bool Hanafi;
        public Dictionary<string, int> Adjust = new();
    }

    public sealed class Day
    {
        public int Y, M, D;
        public double Tz;
        public long?[] At = new long?[6];
        public double[] Hours = new double[6];
    }

    public static JsonNode Method(string id)
    {
        foreach (var m in Spec["methods"]!.AsArray()) if ((string?)m!["id"] == id) return m!;
        return Spec["methods"]![0]!;
    }

    public static string DefaultMethod(string cc) => (string?)Spec["defaultMethod"]![(cc ?? "").ToUpperInvariant()] ?? "mwl";

    public static bool DefaultHanafi(string cc)
    {
        foreach (var c in Spec["hanafi"]!.AsArray()) if (string.Equals((string?)c, cc, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static double Sin(double d) => Math.Sin(d * R);
    private static double Cos(double d) => Math.Cos(d * R);
    private static double Tan(double d) => Math.Tan(d * R);
    private static double ArcSin(double x) => x >= -1 && x <= 1 ? Math.Asin(x) / R : double.NaN;
    private static double ArcCos(double x) => x >= -1 && x <= 1 ? Math.Acos(x) / R : double.NaN;
    private static double ArcTan2(double y, double x) => Math.Atan2(y, x) / R;
    private static double ArcCot(double x) => Math.Atan(1 / x) / R;
    private static double FixAngle(double a) => a - 360 * Math.Floor(a / 360);
    private static double FixHour(double a) => double.IsNaN(a) ? double.NaN : a - 24 * Math.Floor(a / 24);

    private static double Julian(int y, int m, int d)
    {
        if (m <= 2) { y -= 1; m += 12; }
        double a = Math.Floor(y / 100.0), b = 2 - a + Math.Floor(a / 4);
        return Math.Floor(365.25 * (y + 4716)) + Math.Floor(30.6001 * (m + 1)) + d + b - 1524.5;
    }

    private static (double decl, double eqt) Sun(double jd)
    {
        double dd = jd - 2451545.0, g = FixAngle(357.529 + 0.98560028 * dd), q = FixAngle(280.459 + 0.98564736 * dd);
        double L = FixAngle(q + 1.915 * Sin(g) + 0.020 * Sin(2 * g)), e = 23.439 - 0.00000036 * dd;
        double ra = ArcTan2(Cos(e) * Sin(L), Cos(L)) / 15;
        return (ArcSin(Sin(e) * Sin(L)), q / 15 - FixHour(ra));
    }

    private static double Portion(string hl, double night, double a) => hl == "middle" ? night / 2 : hl == "seventh" ? night / 7 : a / 60 * night;

    private static double[] ComputeHours(int year, int month, int day, double lat, double lng, double elev, double tz, Opts o)
    {
        var m = Method(o.Method);
        double jd = Julian(year, month, day) - lng / (15 * 24);
        var mgNode = m["maghrib"];
        var ishNode = m["isha"];
        bool mgIsNum = mgNode is JsonValue, mgIsObj = mgNode is JsonObject, ishIsNum = ishNode is JsonValue, ishIsObj = ishNode is JsonObject;
        double mgVal = mgIsNum ? (double)mgNode! : 0, ishVal = ishIsNum ? (double)ishNode! : 0;
        double mgMin = mgIsObj ? (double)mgNode!["min"]! : 0, ishMin = ishIsObj ? (double)ishNode!["min"]! : 0;
        double fajrA = (double)m["fajr"]!;
        double riseSet = 0.0347 * Math.Sqrt(Math.Max(0, elev)) + 0.833;

        double MidDay(double t) => FixHour(12 - Sun(jd + t).eqt);
        double AngleTime(double angle, double t, bool ccw, double la)
        {
            double decl = Sun(jd + t).decl;
            double v = (-Sin(angle) - Sin(decl) * Sin(la)) / (Cos(decl) * Cos(la));
            return MidDay(t) + ArcCos(v) / 15 * (ccw ? -1 : 1);
        }
        double AsrTime(double factor, double t)
        {
            double decl = Sun(jd + t).decl;
            return AngleTime(-ArcCot(factor + Tan(Math.Abs(lat - decl))), t, false, lat);
        }
        // fajr, sunrise, dhuhr, asr, sunset, maghrib, isha
        double[] Raw(double la) => new[]
        {
            AngleTime(fajrA, 5 / 24.0, true, la), AngleTime(riseSet, 6 / 24.0, true, la), MidDay(12 / 24.0), AsrTime(o.Hanafi ? 2 : 1, 13 / 24.0),
            AngleTime(riseSet, 18 / 24.0, false, la),
            mgIsNum ? AngleTime(mgVal, 18 / 24.0, false, la) : double.NaN,
            ishIsNum ? AngleTime(ishVal, 18 / 24.0, false, la) : double.NaN
        };

        var raw = Raw(lat);
        if (double.IsNaN(raw[1]) || double.IsNaN(raw[4]))
        {
            var k = Raw((lat >= 0 ? 1 : -1) * 48.6);
            k[2] = raw[2];
            k[3] = double.IsNaN(raw[3]) ? k[3] : raw[3];
            raw = k;
        }
        double sunrise = raw[1], sunset = raw[4];
        double maghrib = mgIsObj ? sunset + mgMin / 60 : mgIsNum ? raw[5] : sunset;
        double fajr = raw[0];
        double isha = ishIsObj ? maghrib + ishMin / 60 : raw[6];
        if (Math.Abs(lat) > 48)
        {
            double night = FixHour(sunrise - sunset);
            var hl = string.IsNullOrEmpty(o.HighLat) ? "angle" : o.HighLat;
            double fl = Portion(hl, night, fajrA);
            if (double.IsNaN(fajr) || FixHour(sunrise - fajr) > fl) fajr = sunrise - fl;
            if (ishIsNum)
            {
                double il = Portion(hl, night, ishVal);
                if (double.IsNaN(isha) || FixHour(isha - sunset) > il) isha = sunset + il;
            }
        }
        double shift = tz - lng / 15;
        var v = new[] { fajr, sunrise, raw[2], raw[3], maghrib, isha };
        for (var i = 0; i < 6; i++) v[i] = v[i] + shift + (o.Adjust.TryGetValue(Names[i], out var a) ? a : 0) / 60.0;
        return v;
    }

    public static double TzOffsetHours(string tzName, long atMs)
    {
        try
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById(tzName);
            return Math.Round(tz.GetUtcOffset(DateTimeOffset.FromUnixTimeMilliseconds(atMs)).TotalMinutes) / 60.0;
        }
        catch { return 0; }
    }

    private static long UtcMs(int y, int m, int d, int h = 0) => new DateTimeOffset(new DateTime(y, m, d, h, 0, 0, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    public static Day ForDay(int y, int m, int d, double lat, double lng, string tzName, Opts o)
    {
        long noon = UtcMs(y, m, d, 12);
        double tz = TzOffsetHours(tzName, noon - (long)Math.Round(TzOffsetHours(tzName, noon) * 3600000, MidpointRounding.AwayFromZero));
        var r = new Day { Y = y, M = m, D = d, Tz = tz };
        r.Hours = ComputeHours(y, m, d, lat, lng, 0, tz, o);
        long b = UtcMs(y, m, d);
        for (var i = 0; i < 6; i++) r.At[i] = double.IsNaN(r.Hours[i]) ? null : b + (long)Math.Round((r.Hours[i] - tz) * 3600, MidpointRounding.AwayFromZero) * 1000;
        return r;
    }

    public static DateTime Civil(long ms, string tzName)
    {
        try { return TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(ms), TimeZoneInfo.FindSystemTimeZoneById(tzName)).DateTime; }
        catch { return DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime; }
    }

    /// <summary>The next prayer (index) and its time.</summary>
    public static (int index, long at) Next(long now, double lat, double lng, string tzName, Opts o)
    {
        var d0 = Civil(now, tzName).Date;
        for (var k = 0; k < 3; k++)
        {
            var d = d0.AddDays(k);
            var t = ForDay(d.Year, d.Month, d.Day, lat, lng, tzName, o);
            for (var i = 0; i < 6; i++) if (t.At[i] is long a && a > now) return (i, a);
        }
        return (0, now);
    }

    /// <summary>Bearing in degrees and distance in km to the Kaaba.</summary>
    public static (double bearing, double km) Qibla(double lat, double lng)
    {
        double kLat = 21.422487, kLng = 39.826206, dl = (kLng - lng) * R;
        double y = Math.Sin(dl), x = Math.Cos(lat * R) * Math.Tan(kLat * R) - Math.Sin(lat * R) * Math.Cos(dl);
        double a = Math.Pow(Math.Sin((kLat - lat) * R / 2), 2) + Math.Cos(lat * R) * Math.Cos(kLat * R) * Math.Pow(Math.Sin(dl / 2), 2);
        return ((Math.Atan2(y, x) / R + 360) % 360, 12742 * Math.Asin(Math.Sqrt(a)));
    }
}
