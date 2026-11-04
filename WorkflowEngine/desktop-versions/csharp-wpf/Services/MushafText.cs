using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace WorkflowErp.Services;

/// <summary>
/// The Madinah Mushaf drawn as text (ornate frame, surah / juz header, 15 justified lines, verse medallions) - the same look as the portal's text pages.
/// Data: data/mushaf-text.json (per page: ["H", surah] banner, ["B"] basmala, ["L", tokens] where a token is a word, a verse number or "*").
/// Font: Amiri Quran (SIL OFL, data/OFL.txt), embedded as a WPF resource.
/// </summary>
public static class MushafText
{
    private static JsonArray? _pages;
    private static readonly FontFamily Family = new(new Uri("pack://application:,,,/"), "./data/#Amiri Quran");
    private static readonly Typeface Face = new(Family, FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
    private static readonly Regex Strip = new("[ً-ٰٟۖ-ۭـ]");
    private static readonly Regex Red = new("^[وفبتك]?(?:الله|لله|رب(?:نا|كم|هم|ك|ي|ه|ها|هما|كما|هن)?)$");
    private static readonly CultureInfo Ar = CultureInfo.GetCultureInfo("ar");

    private static JsonArray Pages => _pages ??= JsonNode.Parse(Loc.ReadData("mushaf-text.json"))!.AsArray();

    public static string ArNum(int n)
    {
        var b = new StringBuilder();
        foreach (var c in n.ToString(CultureInfo.InvariantCulture)) b.Append((char)(0x0660 + (c - '0')));
        return b.ToString();
    }

    public static bool IsRed(string w) => Red.IsMatch(Strip.Replace(w, "").Replace('ٱ', 'ا'));

    /// <summary>Page colours: rose (default) or blue. Every colour is written once as its rose value and mapped here for the blue theme (the text itself stays black, Allah / Rabb red).</summary>
    private static bool _blue;
    private static readonly Dictionary<string, string> BlueMap = new()
    {
        ["#fffdf6"] = "#f5f9ff", ["#f2c6d6"] = "#b9d3f3", ["#7a1f4b"] = "#1b4a86", ["#c2185b"] = "#1565c0", ["#9a2f63"] = "#2f6db5", ["#fbe4ee"] = "#e1eeff", ["#4a1030"] = "#0c2a55",
        ["#6b2a4a"] = "#1d3d6b", ["#f6d3e1"] = "#cde1fb", ["#8a3a63"] = "#2a63ad", ["#fbe3ec"] = "#e4efff"
    };
    private static Brush B(string hex)
    {
        if (_blue && BlueMap.TryGetValue(hex, out var m)) hex = m;
        var b = (Brush)new BrushConverter().ConvertFromString(hex)!; b.Freeze(); return b;
    }

    private static FormattedText Fmt(string text, double size, Brush brush)
        => new(text, Ar, FlowDirection.RightToLeft, Face, Math.Max(4, Math.Round(size)), brush, 1.0);

    /// <summary>Text centred in the box (the baseline comes from the font metrics, Amiri's tall line box would otherwise push it down).</summary>
    private static void Center(DrawingContext dc, Rect r, string text, double size, Brush brush)
    {
        var ft = Fmt(text, size, brush);
        dc.DrawText(ft, new Point(r.X + r.Width / 2 - ft.Width / 2, r.Y + r.Height / 2 - ft.Height / 2 - size * .05));
    }

    private static void Cartouche(DrawingContext dc, Rect r, string text, double u)
    {
        dc.DrawRoundedRectangle(B("#fbe4ee"), new Pen(B("#9a2f63"), .35 * u), r, 1.2 * u, 1.2 * u);
        Center(dc, r, text, 3.5 * u, B("#4a1030"));
    }

    private static void Heart(DrawingContext dc, double cx, double cy, double u, Brush brush)
    {
        var r = .72 * u;
        if (_blue)
        {
            var dg = new StreamGeometry();
            using (var dcx = dg.Open())
            {
                dcx.BeginFigure(new Point(cx, cy - r * 1.05), true, true);
                dcx.LineTo(new Point(cx + r * .8, cy), false, false); dcx.LineTo(new Point(cx, cy + r * 1.05), false, false); dcx.LineTo(new Point(cx - r * .8, cy), false, false);
            }
            dc.DrawGeometry(brush, null, dg);
            return;
        }
        dc.DrawEllipse(brush, null, new Point(cx - r * .5, cy - r * .25), r * .55, r * .55);
        dc.DrawEllipse(brush, null, new Point(cx + r * .5, cy - r * .25), r * .55, r * .55);
        var g = new StreamGeometry();
        using (var c = g.Open())
        {
            c.BeginFigure(new Point(cx - r * 1.02, cy - r * .05), true, true);
            c.LineTo(new Point(cx + r * 1.02, cy - r * .05), false, false);
            c.LineTo(new Point(cx, cy + r * 1.1), false, false);
        }
        dc.DrawGeometry(brush, null, g);
    }

    private sealed class Item { public char Kind; public string Text = ""; public int Num; public double W; public int Ti; }

    /// <summary>Where a word was painted, so a tap can be mapped to it (line index, token index in that line).</summary>
    public sealed record Hit(Rect R, int Li, int Ti, string Word);
    /// <summary>A token's verse: surah, verse, word number (from 1) and the number of words in that verse.</summary>
    public sealed record WordLoc(int Surah, int Ayah, int Pos, int Total);

    private static JsonNode? _index;
    public static string SurahName(int surah) => (string)Prayer.Spec["mushaf"]!["surahAr"]![surah - 1]!;

    public static WordLoc Locate(int page, int li, int ti)
    {
        _index ??= JsonNode.Parse(Loc.ReadData("mushaf-index.json"))!;
        var st = _index["start"]![page - 1]!.AsArray();
        int surah = (int)st[0]!, ayah = (int)st[1]!, wi = (int)st[2]!;
        var cnt = _index["count"]!.AsObject();
        var lines = Pages[page - 1]!.AsArray();
        for (var i = 0; i <= li && i < lines.Count; i++)
        {
            var ln = lines[i]!.AsArray();
            var k = (string)ln[0]!;
            if (k == "H") { surah = (int)ln[1]!; ayah = 1; wi = 0; continue; }
            if (k != "L") continue;
            var toks = ln[1]!.AsArray();
            for (var j = 0; j < toks.Count; j++)
            {
                if (i == li && j == ti) return new WordLoc(surah, ayah, wi + 1, cnt[$"{surah}:{ayah}"] is JsonNode c ? (int)c : 0);
                var v = toks[j]!;
                if (v is JsonValue jv && jv.TryGetValue<string>(out var s))
                {
                    if (s == "*") continue;
                    wi++;
                }
                else { ayah = (int)v + 1; wi = 0; }
            }
        }
        return new WordLoc(surah, ayah, wi + 1, 0);
    }

    public static BitmapSource Render(int page, int width, bool night, string theme = "rose", List<Hit>? hits = null)
    {
        hits?.Clear();
        _blue = theme == "blue";
        var H = (int)(width * 4206.0 / 2600);
        double u = width / 100.0, W = width;
        var mf = Prayer.Spec["mushaf"]!;
        var surahAr = mf["surahAr"]!.AsArray();
        var vis = new DrawingVisual();
        using (var dc = vis.RenderOpen())
        {
            dc.DrawRectangle(B("#fffdf6"), null, new Rect(0, 0, W, H));
            double fo = 1.4 * u, bw = 3.4 * u;
            var outer = new Rect(fo, fo, W - 2 * fo, H - 2 * fo);
            var inner = new Rect(outer.X + bw, outer.Y + bw, outer.Width - 2 * bw, outer.Height - 2 * bw);
            dc.DrawRectangle(B("#f2c6d6"), null, outer);
            dc.DrawRectangle(B("#fffdf6"), null, inner);
            dc.DrawRectangle(null, new Pen(B("#7a1f4b"), .5 * u), new Rect(outer.X + .25 * u, outer.Y + .25 * u, outer.Width - .5 * u, outer.Height - .5 * u));
            dc.DrawRectangle(null, new Pen(B("#7a1f4b"), .4 * u), inner);
            var pink = B("#c2185b");
            double mid = bw / 2, step = 4.2 * u;
            for (var x = outer.Left + bw + step / 2; x < outer.Right - bw - step / 4; x += step) { Heart(dc, x, outer.Top + mid, u, pink); Heart(dc, x, outer.Bottom - mid, u, pink); }
            for (var y = outer.Top + bw + step / 2; y < outer.Bottom - bw - step / 4; y += step) { Heart(dc, outer.Left + mid, y, u, pink); Heart(dc, outer.Right - mid, y, u, pink); }
            foreach (var c in new[] { new Point(outer.Left + mid, outer.Top + mid), new Point(outer.Right - mid, outer.Top + mid), new Point(outer.Left + mid, outer.Bottom - mid), new Point(outer.Right - mid, outer.Bottom - mid) })
                dc.DrawEllipse(Brushes.White, null, c, 1.25 * u, 1.25 * u);

            double left = inner.Left + 1.2 * u, right = inner.Right - 1.2 * u, top = inner.Top + .4 * u, hh = 6.2 * u;
            var jt = "الجزء " + (string)mf["juzAr"]![Views.MuslimView.JuzOf(page) - 1]!;
            var st = "سورة " + (string)surahAr[Views.MuslimView.SurahOf(page) - 1]!;
            var jw = Fmt(jt, 3.5 * u, Brushes.Black).Width + 4.8 * u;
            var sw = Fmt(st, 3.5 * u, Brushes.Black).Width + 4.8 * u;
            Cartouche(dc, new Rect(right - jw, top + .7 * u, jw, hh - 1.4 * u), jt, u);
            Cartouche(dc, new Rect(left, top + .7 * u, sw, hh - 1.4 * u), st, u);
            Center(dc, new Rect(left, inner.Bottom - 4.8 * u, right - left, 4.4 * u), ArNum(page), 3.2 * u, B("#6b2a4a"));

            var data = Pages[page - 1]!.AsArray();
            double bodyTop = top + hh, bodyBot = inner.Bottom - 4.8 * u, row = (bodyBot - bodyTop) / 15, y0 = bodyTop + (15 - data.Count) * row / 2, w2 = right - left;
            for (var i = 0; i < data.Count; i++)
            {
                var ln = data[i]!.AsArray();
                var kind = (string)ln[0]!;
                var ry = y0 + i * row;
                if (kind == "H")
                {
                    var r = new Rect(left, ry + .5 * u, w2, row - 1.0 * u);
                    dc.DrawRoundedRectangle(B("#f6d3e1"), new Pen(B("#9a2f63"), .35 * u), r, 1.6 * u, 1.6 * u);
                    Center(dc, r, "سُورَةُ " + (string)surahAr[(int)ln[1]! - 1]!, 4.9 * u, B("#4a1030"));
                }
                else if (kind == "B")
                    Center(dc, new Rect(left, ry, w2, row), "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ", 4.9 * u, B("#14110f"));
                else DrawLine(dc, ln[1]!.AsArray(), left, ry, w2, row, 5.6 * u, hits, i);
            }
        }
        var rtb = new RenderTargetBitmap(width, H, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(vis);
        if (!night) { rtb.Freeze(); return rtb; }
        var stride = width * 4;
        var px = new byte[stride * H];
        rtb.CopyPixels(px, stride, 0);
        for (var i = 0; i < px.Length; i += 4) { px[i] = (byte)(255 - px[i]); px[i + 1] = (byte)(255 - px[i + 1]); px[i + 2] = (byte)(255 - px[i + 2]); }
        var wb = BitmapSource.Create(width, H, 96, 96, PixelFormats.Pbgra32, null, px, stride);
        wb.Freeze();
        return wb;
    }

    private static void DrawLine(DrawingContext dc, JsonArray toks, double left, double ry, double W, double row, double S, List<Hit>? hits, int li)
    {
        double k = 1, fs = S, tot = 0, nat = 0;
        var items = new List<Item>();
        for (var pass = 0; pass < 2; pass++)
        {
            fs = S * k;
            items.Clear(); tot = 0;
            var tix = -1;
            foreach (var v in toks)
            {
                var it = new Item { Ti = ++tix };
                if (v is JsonValue jv && jv.TryGetValue<string>(out var s))
                {
                    if (s == "*") { it.Kind = 'q'; it.W = Fmt("۞", fs * .62, Brushes.Black).Width; }
                    else { it.Kind = 'w'; it.Text = s; it.W = Fmt(s, fs, Brushes.Black).Width; }
                }
                else { it.Kind = 'n'; it.Num = (int)v!; it.W = fs * .74 * 1.45; }
                tot += it.W; items.Add(it);
            }
            nat = tot + fs * .22 * Math.Max(0, items.Count - 1);
            if (nat > W && pass == 0) { k = Math.Max(.6, W / nat * .985); continue; }
            break;
        }
        var n = items.Count;
        double gap, x;
        if (nat < W * .72) { gap = fs * .32; x = left + (W - (tot + gap * (n - 1))) / 2 + tot + gap * (n - 1); }
        else { gap = n > 1 ? (W - tot) / (n - 1) : 0; x = left + W; }
        var cy = ry + row / 2;
        foreach (var it in items)
        {
            x -= it.W;
            if (it.Kind == 'w')
            {
                hits?.Add(new Hit(new Rect(x - gap / 2, ry, it.W + gap, row), li, it.Ti, it.Text));
                var ft = Fmt(it.Text, fs, B(IsRed(it.Text) ? "#c0143c" : "#14110f"));
                dc.DrawText(ft, new Point(x, cy - ft.Height / 2 - fs * .05));
            }
            else if (it.Kind == 'q')
            {
                var ft = Fmt("۞", fs * .62, B("#9a2f63"));
                dc.DrawText(ft, new Point(x, cy - ft.Height / 2 - fs * .05));
            }
            else
            {
                var d = fs * .74 * 1.45;
                dc.DrawEllipse(B("#fbe3ec"), new Pen(B("#8a3a63"), fs * .045), new Point(x + d / 2, cy), d / 2, d / 2);
                Center(dc, new Rect(x, cy - d / 2, d, d), ArNum(it.Num), fs * .49, B("#4a1030"));
            }
            x -= gap;
        }
    }
}
