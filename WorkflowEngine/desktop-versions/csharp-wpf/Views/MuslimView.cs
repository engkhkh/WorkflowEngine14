using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Muslim workspace: prayer times (reminders, Qibla, Hijri date) and the Holy Quran as Mushaf page images.
/// Same behaviour as the portal's Muslim module; the settings live on this computer.</summary>
public sealed class MuslimView : PageView
{
    private readonly PrayerTab _times = new();
    private readonly QuranTab _quran = new();

    public MuslimView()
    {
        Root.Margin = new Thickness(0);
        var tabs = new TabControl { Margin = new Thickness(20, 8, 20, 16), Height = 720 };
        tabs.Items.Add(new TabItem { Header = Loc.T("mus.tab.times"), Content = _times, Padding = new Thickness(12, 6, 12, 6) });
        tabs.Items.Add(new TabItem { Header = Loc.T("mus.tab.quran"), Content = _quran, Padding = new Thickness(12, 6, 12, 6) });
        Root.Children.Add(Ui.Text(Loc.T("module.muslim"), 20, true));
        ((TextBlock)Root.Children[0]).Margin = new Thickness(20, 16, 20, 0);
        Root.Children.Add(tabs);
    }

    public override Task Reload() { _times.Refresh(); return Task.CompletedTask; }

    // ------------------------------------------------------------------ shared helpers
    internal static JsonNode Mushaf => Prayer.Spec["mushaf"]!;
    internal static int Pages => (int)Mushaf["pages"]!;
    internal static int[] SurahStart = Mushaf["surahStart"]!.AsArray().Select(x => (int)x!).ToArray();
    internal static int[] JuzStart = Mushaf["juzStart"]!.AsArray().Select(x => (int)x!).ToArray();
    internal static string SurahName(int n) => (string)Mushaf["surahAr"]![n - 1]!;
    internal static int Clamp(int p) => Math.Min(Pages, Math.Max(1, p));
    internal static int SurahOf(int p) { var n = 1; for (var i = 0; i < SurahStart.Length; i++) if (SurahStart[i] <= p) n = i + 1; return n; }
    internal static int JuzOf(int p) { var n = 1; for (var i = 0; i < JuzStart.Length; i++) if (JuzStart[i] <= p) n = i + 1; return n; }

    /// <summary>Everything the page remembers, kept in one JSON file next to the session.</summary>
    internal static class Settings
    {
        private static readonly string File_ = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WorkflowErpWpf", "muslim.json");
        public static JsonObject S = Load();

        private static JsonObject Defaults()
        {
            var cc = RegionInfo.CurrentRegion.TwoLetterISORegionName.ToUpperInvariant();
            var list = Prayer.Spec["cities"]![cc]?.AsArray();
            var c = list != null && list.Count > 0 ? list[0]!.AsArray() : null;
            var rem = new JsonObject();
            var adj = new JsonObject();
            foreach (var p in Prayer.Names)
            {
                adj[p] = 0;
                rem[p] = new JsonObject { ["on"] = p != "sunrise", ["before"] = p == "sunrise" ? 15 : 10 };
            }
            return new JsonObject
            {
                ["cc"] = c != null ? cc : "", ["city"] = c != null ? (string)c[0]! : "", ["lat"] = c != null ? (double)c[1]! : 21.4225, ["lng"] = c != null ? (double)c[2]! : 39.8262,
                ["tz"] = c != null ? (string)c[3]! : "Asia/Riyadh", ["placeSet"] = c != null, ["method"] = Prayer.DefaultMethod(cc), ["hanafi"] = c != null && Prayer.DefaultHanafi(cc),
                ["highLat"] = "angle", ["hijriAdjust"] = 0, ["time24"] = false, ["sound"] = "chime", ["adjust"] = adj, ["remind"] = rem,
                ["mpage"] = 1, ["mzoom"] = 100, ["mtwo"] = false, ["mnight"] = false, ["mbase"] = "", ["mmode"] = "img", ["mtheme"] = "rose", ["pmarks"] = new JsonArray()
            };
        }

        private static JsonObject Load()
        {
            var d = Defaults();
            try
            {
                if (System.IO.File.Exists(File_) && JsonNode.Parse(System.IO.File.ReadAllText(File_)) is JsonObject v)
                    foreach (var kv in v.ToList())
                    {
                        v.Remove(kv.Key);
                        if ((kv.Key == "remind" || kv.Key == "adjust") && kv.Value is JsonObject o && d[kv.Key] is JsonObject m)
                            foreach (var k in o.ToList()) { o.Remove(k.Key); m[k.Key] = k.Value; }
                        else d[kv.Key] = kv.Value;
                    }
            }
            catch { /* keep the defaults */ }
            return d;
        }

        public static void Save()
        {
            try { Directory.CreateDirectory(Path.GetDirectoryName(File_)!); System.IO.File.WriteAllText(File_, S.ToJsonString()); } catch { /* not fatal */ }
        }

        public static string Str(string k) => (string?)S[k] ?? "";
        public static double Dbl(string k) => (double?)S[k] ?? 0;
        public static int Int(string k) => (int?)S[k] ?? 0;
        public static bool Bool(string k) => (bool?)S[k] ?? false;
        public static JsonObject Remind(string p) => (JsonObject)((JsonObject)S["remind"]!)[p]!;

        public static Prayer.Opts Opts()
        {
            var o = new Prayer.Opts { Method = Str("method"), Hanafi = Bool("hanafi"), HighLat = Str("highLat") };
            foreach (var kv in (JsonObject)S["adjust"]!) o.Adjust[kv.Key] = (int?)kv.Value ?? 0;
            return o;
        }
    }

    internal static string PName(int i) => Loc.T("mus." + Prayer.Names[i]);
    internal static long NowMs => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    internal static string CountryName(string cc)
    {
        try { var r = new RegionInfo(cc); return Loc.Rtl ? r.NativeName : r.EnglishName; }
        catch { return cc; }
    }

    internal static string FmtTime(long? ms)
    {
        if (ms == null) return "—";
        var d = Prayer.Civil((long)Math.Round(ms.Value / 60000.0) * 60000, Settings.Str("tz"));
        return Settings.Bool("time24") ? d.ToString("HH:mm", CultureInfo.InvariantCulture) : d.ToString("h:mm tt", CultureInfo.InvariantCulture);
    }

    private static readonly string[] HijriEn = { "Muharram", "Safar", "Rabi' al-awwal", "Rabi' al-thani", "Jumada al-ula", "Jumada al-akhira", "Rajab", "Sha'ban", "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah" };
    private static readonly string[] HijriAr = { "محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة" };

    /// <summary>Hijri (Umm al-Qura) date in the place's zone; after Maghrib the Islamic day has begun, so it moves on by one.</summary>
    internal static string Hijri(Prayer.Day today)
    {
        try
        {
            var after = today.At[4] is long mg && NowMs >= mg;
            var d = Prayer.Civil(NowMs, Settings.Str("tz")).Date.AddDays((after ? 1 : 0) + Settings.Int("hijriAdjust"));
            var cal = new UmAlQuraCalendar();
            var m = cal.GetMonth(d);
            return $"{cal.GetDayOfMonth(d)} {(Loc.Rtl ? HijriAr : HijriEn)[m - 1]} {cal.GetYear(d)}";
        }
        catch { return ""; }
    }

    internal static ComboBox Combo(IEnumerable<(string text, object value)> items)
    {
        var c = new ComboBox { Margin = new Thickness(0, 0, 0, 6), Padding = new Thickness(6, 4, 6, 4) };
        foreach (var (text, value) in items) c.Items.Add(new ComboBoxItem { Content = text, Tag = value });
        return c;
    }

    internal static void Select(ComboBox c, object? value)
    {
        for (var i = 0; i < c.Items.Count; i++)
            if (Equals(((ComboBoxItem)c.Items[i]).Tag, value)) { c.SelectedIndex = i; return; }
        c.SelectedIndex = c.Items.Count > 0 ? 0 : -1;
    }

    internal static object? Value(ComboBox c) => (c.SelectedItem as ComboBoxItem)?.Tag;

    /// <summary>A text box for a number: the value is taken on Enter or when the box loses focus.</summary>
    internal sealed class NumBox : TextBox
    {
        public event Action? Changed;
        private readonly double _min, _max;
        private readonly bool _int;
        public NumBox(double min, double max, bool isInt) { _min = min; _max = max; _int = isInt; Padding = new Thickness(6, 4, 6, 4); Margin = new Thickness(0, 0, 0, 6); MinWidth = 70; }
        public double Number
        {
            get => double.TryParse(Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? Math.Min(_max, Math.Max(_min, v)) : 0;
            set => Text = _int ? ((int)value).ToString(CultureInfo.InvariantCulture) : value.ToString("0.####", CultureInfo.InvariantCulture);
        }
        protected override void OnLostKeyboardFocus(KeyboardFocusChangedEventArgs e) { base.OnLostKeyboardFocus(e); Changed?.Invoke(); }
        protected override void OnKeyDown(KeyEventArgs e) { base.OnKeyDown(e); if (e.Key == Key.Enter) Changed?.Invoke(); }
        protected override void OnMouseWheel(MouseWheelEventArgs e)
        {
            if (!IsKeyboardFocusWithin) return;
            Number = Number + (e.Delta > 0 ? 1 : -1) * (_int ? 1 : 0.01);
            Changed?.Invoke();
            e.Handled = true;
        }
    }

    // ------------------------------------------------------------------ prayer times
    private sealed class PrayerTab : Grid
    {
        private readonly TextBlock _warn = new() { Text = Loc.T("mus.pickplace"), TextWrapping = TextWrapping.Wrap, Padding = new Thickness(10), Background = new SolidColorBrush(Color.FromRgb(0xFE, 0xF3, 0xC7)), Foreground = new SolidColorBrush(Color.FromRgb(0x92, 0x40, 0x0E)), Margin = new Thickness(0, 0, 0, 8) };
        private readonly TextBlock _place = Ui.Text("", 20, true), _date = Ui.Text("", 13, false, Ui.Dim), _next = Ui.Text("", 15), _cd = Ui.Text("--:--:--", 34, true, Ui.Primary), _qibla = Ui.Text("", 12, false, Ui.Dim), _polar = Ui.Text(Loc.T("mus.polar"), 12, false, Ui.Dim);
        private readonly Canvas _dial = new() { Width = 90, Height = 90 };
        private readonly RotateTransform _needle = new(0, 45, 45);
        private readonly DataGrid _grid = new() { AutoGenerateColumns = false, IsReadOnly = true, HeadersVisibility = DataGridHeadersVisibility.Column, CanUserAddRows = false, Background = Brushes.White, RowHeight = 30, GridLinesVisibility = DataGridGridLinesVisibility.Horizontal, SelectionMode = DataGridSelectionMode.Single };
        private readonly Button _dayB, _monB;
        private bool _monthly, _loading = true;
        private long _nextAt;
        private readonly HashSet<string> _fired = new();
        private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };
        private readonly ComboBox _country, _city, _tz, _method, _asr, _hl, _hj, _clock, _sound;
        private readonly NumBox _lat = new(-90, 90, false), _lng = new(-180, 180, false);
        private readonly NumBox[] _adj = new NumBox[6], _remMin = new NumBox[6];
        private readonly CheckBox[] _remOn = new CheckBox[6];

        public PrayerTab()
        {
            Margin = new Thickness(12);
            ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
            ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star), MinWidth = 340 });

            // ---- left
            var left = new DockPanel { Margin = new Thickness(0, 0, 14, 0), LastChildFill = true };
            DockPanel.SetDock(_warn, Dock.Top);
            left.Children.Add(_warn);
            var hero = new Border { Background = Brushes.White, BorderBrush = new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10), Padding = new Thickness(14) };
            var heroGrid = new Grid();
            heroGrid.ColumnDefinitions.Add(new ColumnDefinition());
            heroGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var info = new StackPanel();
            foreach (var e in new UIElement[] { _place, _date, _next, _cd }) info.Children.Add(e);
            var qb = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
            BuildDial();
            qb.Children.Add(_dial);
            qb.Children.Add(_qibla);
            SetColumn(qb, 1);
            heroGrid.Children.Add(info);
            heroGrid.Children.Add(qb);
            hero.Child = heroGrid;
            DockPanel.SetDock(hero, Dock.Top);
            left.Children.Add(hero);
            _dayB = Ui.Btn(Loc.T("mus.day"), () => SetMonthly(false));
            _monB = Ui.Btn(Loc.T("mus.month"), () => SetMonthly(true), "ghost");
            var seg = new DockPanel { Margin = new Thickness(0, 10, 0, 6) };
            var segBtns = Ui.Row(_dayB, _monB);
            DockPanel.SetDock(segBtns, Dock.Right);
            seg.Children.Add(segBtns);
            seg.Children.Add(Ui.Text(Loc.T("mus.today"), 18, true));
            DockPanel.SetDock(seg, Dock.Top);
            left.Children.Add(seg);
            DockPanel.SetDock(_polar, Dock.Bottom);
            left.Children.Add(_polar);
            left.Children.Add(_grid);
            _grid.MouseLeftButtonUp += (_, _) => Bell();
            Children.Add(left);

            // ---- settings (right)
            _country = Combo(new[] { (Loc.T("mus.custom"), (object)"") }.Concat(((JsonObject)Prayer.Spec["cities"]!).Select(k => k.Key).OrderBy(CountryName).Select(cc => (CountryName(cc), (object)cc))));
            _city = Combo(Array.Empty<(string, object)>());
            var zones = ((JsonObject)Prayer.Spec["cities"]!).SelectMany(k => k.Value!.AsArray().Select(c => (string)c![3]!)).Concat(TimeZoneInfo.GetSystemTimeZones().Select(z => z.Id)).Distinct().OrderBy(z => z);
            _tz = Combo(zones.Select(z => (z, (object)z)));
            _method = Combo(Prayer.Spec["methods"]!.AsArray().Select(m => ((string)m!["name"]!, (object)(string)m["id"]!)));
            _asr = Combo(new[] { (Loc.T("mus.asr.std"), (object)false), (Loc.T("mus.asr.hanafi"), (object)true) });
            _hl = Combo(new[] { "angle", "seventh", "middle" }.Select(k => (Loc.T("mus.hl." + k), (object)k)));
            _hj = Combo(Enumerable.Range(-2, 5).Select(n => (n > 0 ? "+" + n : n.ToString(), (object)n)));
            _clock = Combo(new[] { ("12 h", (object)false), ("24 h", (object)true) });
            _sound = Combo(new[] { (Loc.T("mus.sound.chime"), (object)"chime"), (Loc.T("mus.sound.none"), (object)"none") });
            var form = new StackPanel { Margin = new Thickness(0, 0, 8, 0) };
            form.Children.Add(Ui.Text(Loc.T("mus.place"), 18, true));
            foreach (var (label, input) in new (string, UIElement)[]
            {
                (Loc.T("mus.country"), _country), (Loc.T("mus.city"), _city), (Loc.T("mus.lat"), _lat), (Loc.T("mus.lng"), _lng), (Loc.T("mus.tz"), _tz), (Loc.T("mus.method"), _method),
                (Loc.T("mus.asr.label"), _asr), (Loc.T("mus.highlat"), _hl), (Loc.T("mus.hijriadj"), _hj), (Loc.T("mus.clock"), _clock)
            }) form.Children.Add(Ui.Labeled(label, input));
            form.Children.Add(Ui.Text(Loc.T("mus.adjhelp"), 12, false, Ui.Dim));
            for (var i = 0; i < 6; i++) { _adj[i] = new NumBox(-60, 60, true); form.Children.Add(Ui.Labeled(PName(i), _adj[i])); }
            form.Children.Add(Ui.Text(Loc.T("mus.reminders"), 18, true));
            for (var i = 0; i < 6; i++)
            {
                _remOn[i] = new CheckBox { Content = PName(i), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
                _remMin[i] = new NumBox(0, 120, true);
                var line = new StackPanel { Orientation = Orientation.Horizontal };
                line.Children.Add(new Border { Width = 130, Child = _remOn[i] });
                line.Children.Add(_remMin[i]);
                line.Children.Add(new TextBlock { Text = " " + Loc.T("mus.minbefore", ("n", "")).Trim(), VerticalAlignment = VerticalAlignment.Center, Foreground = Ui.Dim });
                form.Children.Add(line);
            }
            form.Children.Add(Ui.Labeled(Loc.T("mus.sound"), _sound));
            form.Children.Add(Ui.Btn(Loc.T("mus.testremind"), () => Fire(0, 10)));
            var scroll = new ScrollViewer { Content = form, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            SetColumn(scroll, 1);
            Children.Add(scroll);

            LoadForm();
            _loading = false;
            foreach (var c in new[] { _country, _city, _tz, _method, _asr, _hl, _hj, _clock, _sound }) { var cb = c; cb.SelectionChanged += (_, _) => Changed(cb); }
            foreach (var n in new[] { _lat, _lng }) { var nb = n; nb.Changed += () => Changed(nb); }
            for (var i = 0; i < 6; i++)
            {
                var a = _adj[i]; a.Changed += () => Changed(a);
                var r = _remMin[i]; r.Changed += () => Changed(r);
                var o = _remOn[i]; o.Click += (_, _) => Changed(o);
            }
            _timer.Tick += (_, _) => Tick();
            _timer.Start();
            Refresh();
        }

        private void BuildDial()
        {
            _dial.Children.Add(new System.Windows.Shapes.Ellipse { Width = 80, Height = 80, Stroke = new SolidColorBrush(Color.FromRgb(0xCB, 0xD5, 0xE1)), StrokeThickness = 2, Margin = new Thickness(5) });
            var n = new TextBlock { Text = "N", Foreground = Ui.Dim, FontSize = 11 };
            Canvas.SetLeft(n, 41); Canvas.SetTop(n, 0);
            _dial.Children.Add(n);
            var green = new SolidColorBrush(Color.FromRgb(0x16, 0xA3, 0x4A));
            var needle = new Canvas { Width = 90, Height = 90, RenderTransform = _needle };
            needle.Children.Add(new System.Windows.Shapes.Line { X1 = 45, Y1 = 51, X2 = 45, Y2 = 17, Stroke = green, StrokeThickness = 4, StrokeStartLineCap = PenLineCap.Round });
            var head = new System.Windows.Shapes.Rectangle { Width = 12, Height = 12, Fill = green };
            Canvas.SetLeft(head, 39); Canvas.SetTop(head, 7);
            needle.Children.Add(head);
            _dial.Children.Add(needle);
        }

        private void SetMonthly(bool m)
        {
            _monthly = m;
            _dayB.Background = m ? Brushes.White : Ui.Primary; _dayB.Foreground = m ? Ui.Primary : Brushes.White; _dayB.BorderThickness = new Thickness(m ? 1 : 0);
            _monB.Background = m ? Ui.Primary : Brushes.White; _monB.Foreground = m ? Brushes.White : Ui.Primary; _monB.BorderThickness = new Thickness(m ? 0 : 1);
            Refresh();
        }

        private void FillCities()
        {
            var cc = (string)(Value(_country) ?? "");
            _city.Items.Clear();
            if (cc != "" && Prayer.Spec["cities"]![cc] is JsonArray list)
                foreach (var c in list) _city.Items.Add(new ComboBoxItem { Content = (string)c![0]!, Tag = (string)c[0]! });
            _city.IsEnabled = cc != "";
        }

        private void LoadForm()
        {
            var was = _loading;
            _loading = true;
            Select(_country, Settings.Str("cc"));
            FillCities();
            Select(_city, Settings.Str("city"));
            _lat.Number = Settings.Dbl("lat"); _lng.Number = Settings.Dbl("lng");
            Select(_tz, Settings.Str("tz")); Select(_method, Settings.Str("method")); Select(_asr, Settings.Bool("hanafi"));
            Select(_hl, Settings.Str("highLat")); Select(_hj, Settings.Int("hijriAdjust")); Select(_clock, Settings.Bool("time24")); Select(_sound, Settings.Str("sound"));
            for (var i = 0; i < 6; i++)
            {
                var p = Prayer.Names[i];
                _adj[i].Number = (int?)((JsonObject)Settings.S["adjust"]!)[p] ?? 0;
                _remOn[i].IsChecked = (bool?)Settings.Remind(p)["on"] ?? false;
                _remMin[i].Number = (int?)Settings.Remind(p)["before"] ?? 0;
            }
            _warn.Visibility = Settings.Bool("placeSet") ? Visibility.Collapsed : Visibility.Visible;
            _loading = was;
        }

        private void Changed(object src)
        {
            if (_loading) return;
            var s = Settings.S;
            if (src == _country)
            {
                var cc = (string)(Value(_country) ?? "");
                if (cc != "" && Prayer.Spec["cities"]![cc] is JsonArray list && list.Count > 0)
                {
                    var c = list[0]!.AsArray();
                    s["cc"] = cc; s["city"] = (string)c[0]!; s["lat"] = (double)c[1]!; s["lng"] = (double)c[2]!; s["tz"] = (string)c[3]!; s["placeSet"] = true;
                    s["method"] = Prayer.DefaultMethod(cc); s["hanafi"] = Prayer.DefaultHanafi(cc);
                }
                else { s["cc"] = ""; s["city"] = ""; }
                Apply();
                return;
            }
            if (src == _city && Value(_city) is string cityName && Prayer.Spec["cities"]![Settings.Str("cc")] is JsonArray cl)
            {
                foreach (var cv in cl)
                {
                    var c = cv!.AsArray();
                    if ((string)c[0]! != cityName) continue;
                    s["city"] = cityName; s["lat"] = (double)c[1]!; s["lng"] = (double)c[2]!; s["tz"] = (string)c[3]!; s["placeSet"] = true;
                    Apply();
                    return;
                }
            }
            s["lat"] = _lat.Number; s["lng"] = _lng.Number; s["tz"] = (string)(Value(_tz) ?? "UTC");
            s["method"] = (string)(Value(_method) ?? "mwl"); s["hanafi"] = (bool)(Value(_asr) ?? false); s["highLat"] = (string)(Value(_hl) ?? "angle");
            s["hijriAdjust"] = (int)(Value(_hj) ?? 0); s["time24"] = (bool)(Value(_clock) ?? false); s["sound"] = (string)(Value(_sound) ?? "chime");
            var a = new JsonObject();
            var r = new JsonObject();
            for (var i = 0; i < 6; i++)
            {
                a[Prayer.Names[i]] = (int)_adj[i].Number;
                r[Prayer.Names[i]] = new JsonObject { ["on"] = _remOn[i].IsChecked == true, ["before"] = (int)_remMin[i].Number };
            }
            s["adjust"] = a; s["remind"] = r;
            if (src == _lat || src == _lng) { s["placeSet"] = true; s["cc"] = ""; s["city"] = ""; }
            Apply();
        }

        private void Apply() { Settings.Save(); LoadForm(); Refresh(); }

        private Prayer.Day Today()
        {
            var d = Prayer.Civil(NowMs, Settings.Str("tz"));
            return Prayer.ForDay(d.Year, d.Month, d.Day, Settings.Dbl("lat"), Settings.Dbl("lng"), Settings.Str("tz"), Settings.Opts());
        }

        public void Refresh()
        {
            var td = Today();
            var (nxIndex, nxAt) = Prayer.Next(NowMs, Settings.Dbl("lat"), Settings.Dbl("lng"), Settings.Str("tz"), Settings.Opts());
            _nextAt = nxAt;
            _place.Text = (Settings.Str("city") == "" ? Loc.T("mus.custom") : Settings.Str("city")) + (Settings.Str("cc") == "" ? "" : " · " + CountryName(Settings.Str("cc")));
            var ci = new CultureInfo(Loc.Rtl ? "ar" : "en");
            _date.Text = Prayer.Civil(NowMs, Settings.Str("tz")).ToString("dddd d MMMM yyyy", ci) + " · " + Hijri(td);
            _next.Text = $"{Loc.T("mus.next")}  {PName(nxIndex)}  {FmtTime(nxAt)}";
            var (bearing, km) = Prayer.Qibla(Settings.Dbl("lat"), Settings.Dbl("lng"));
            _needle.Angle = bearing;
            _qibla.Text = $"{Loc.T("mus.qibla")}: {bearing:0}° · {km:N0} km";
            _warn.Visibility = Settings.Bool("placeSet") ? Visibility.Collapsed : Visibility.Visible;
            _polar.Visibility = td.At.Any(a => a == null) ? Visibility.Visible : Visibility.Collapsed;
            _grid.Columns.Clear();
            if (!_monthly)
            {
                _grid.HeadersVisibility = DataGridHeadersVisibility.None;
                for (var j = 0; j < 3; j++) _grid.Columns.Add(new DataGridTextColumn { Binding = new System.Windows.Data.Binding($"[{j}]"), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
                _grid.ItemsSource = Enumerable.Range(0, 6).Select(i => new Ui.Row2
                {
                    Cells = new[] { (i == nxIndex ? "▶ " : "") + PName(i), FmtTime(td.At[i]), (bool?)Settings.Remind(Prayer.Names[i])["on"] == true ? "🔔" : "🔕" }
                }).ToList();
            }
            else
            {
                _grid.HeadersVisibility = DataGridHeadersVisibility.Column;
                var heads = new[] { "#" }.Concat(Enumerable.Range(0, 6).Select(PName)).ToArray();
                for (var j = 0; j < heads.Length; j++) _grid.Columns.Add(new DataGridTextColumn { Header = heads[j], Binding = new System.Windows.Data.Binding($"[{j}]"), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
                var days = DateTime.DaysInMonth(td.Y, td.M);
                var rows = new List<Ui.Row2>();
                for (var d = 1; d <= days; d++)
                {
                    var x = Prayer.ForDay(td.Y, td.M, d, Settings.Dbl("lat"), Settings.Dbl("lng"), Settings.Str("tz"), Settings.Opts());
                    rows.Add(new Ui.Row2 { Cells = new[] { (d == td.D ? "▶ " : "") + d }.Concat(Enumerable.Range(0, 6).Select(i => FmtTime(x.At[i]))).ToArray() });
                }
                _grid.ItemsSource = rows;
            }
        }

        private void Bell()
        {
            if (_monthly || _grid.SelectedIndex < 0 || _grid.SelectedIndex > 5) return;
            var col = _grid.CurrentCell.Column;
            if (col == null || col.DisplayIndex != 2) return;
            var p = Prayer.Names[_grid.SelectedIndex];
            var r = Settings.Remind(p);
            r["on"] = !((bool?)r["on"] ?? false);
            Apply();
        }

        private void Tick()
        {
            var now = NowMs;
            var left = Math.Max(0, (_nextAt - now) / 1000);
            _cd.Text = $"{left / 3600:00}:{left % 3600 / 60:00}:{left % 60:00}";
            if (left == 0) Refresh();
            var td = Today();
            for (var i = 0; i < 6; i++)
            {
                var r = Settings.Remind(Prayer.Names[i]);
                if ((bool?)r["on"] != true || td.At[i] is not long at) continue;
                var before = (int?)r["before"] ?? 0;
                var target = at - before * 60000L;
                var key = $"{td.Y}-{td.M}-{td.D}|{i}|{before}";
                if (target <= now && now < target + 120000 && _fired.Add(key)) Fire(i, before);
            }
        }

        private void Fire(int i, int before)
        {
            var msg = before > 0 ? Loc.T("mus.remind.in", ("name", PName(i)), ("n", before.ToString())) : Loc.T("mus.remind.now", ("name", PName(i)));
            if (Settings.Str("sound") != "none")
            {
                var beeps = 0;
                var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(450) };
                t.Tick += (_, _) => { System.Media.SystemSounds.Asterisk.Play(); if (++beeps >= 3) t.Stop(); };
                t.Start();
            }
            var w = new Window
            {
                Title = Loc.T("module.muslim"), Width = 340, Height = 150, Topmost = true, WindowStartupLocation = WindowStartupLocation.CenterScreen, FlowDirection = Loc.Flow, Background = Ui.Bg,
                Owner = Application.Current.MainWindow
            };
            var body = new StackPanel { Margin = new Thickness(18) };
            body.Children.Add(Ui.Text(msg, 18, true));
            body.Children.Add(Ui.Btn("OK", () => w.Close()));
            w.Content = body;
            w.Show();
            var close = new DispatcherTimer { Interval = TimeSpan.FromMinutes(2) };
            close.Tick += (_, _) => { close.Stop(); if (w.IsLoaded) w.Close(); };
            close.Start();
        }
    }

    // ------------------------------------------------------------------ Mushaf reader
    private sealed class QuranTab : Grid
    {
        private readonly ListBox _list = new() { Width = 220, Margin = new Thickness(0, 0, 10, 0) };
        private readonly Reader _reader;
        private bool _sync;

        public QuranTab()
        {
            Margin = new Thickness(12);
            ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            ColumnDefinitions.Add(new ColumnDefinition());
            for (var i = 1; i <= SurahStart.Length; i++) _list.Items.Add(new ListBoxItem { Content = $"{i}   {SurahName(i)}", Padding = new Thickness(6, 3, 6, 3) });
            _reader = new Reader(SyncList);
            SetColumn(_reader, 1);
            Children.Add(_list);
            Children.Add(_reader);
            _list.SelectionChanged += (_, _) => { if (!_sync && _list.SelectedIndex >= 0) _reader.Go(SurahStart[_list.SelectedIndex]); };
            SyncList();
        }

        private void SyncList()
        {
            _sync = true;
            _list.SelectedIndex = SurahOf(Clamp(Settings.Int("mpage"))) - 1;
            if (_list.SelectedItem != null) _list.ScrollIntoView(_list.SelectedItem);
            _sync = false;
        }
    }

    private sealed class Reader : DockPanel
    {
        private readonly Button _next = new() { Content = "❮" }, _prev = new() { Content = "❯" }, _minus = new() { Content = "−" }, _plus = new() { Content = "+" }, _fit = new() { Content = "⤢" }, _full = new() { Content = "⛶" };
        private readonly ToggleButton_ _two = new("▯▯"), _mode = new("Aa"), _night = new("☾"), _theme = new("🎨"), _star = new("★");
        private readonly NumBox _pageBox = new(1, 604, true) { Width = 56 };
        private readonly TextBlock _where = new() { FontSize = 16, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 8, 0) }, _zoomL = new() { Text = "100%", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(6, 0, 6, 0) };
        private readonly ComboBox _juz = new(), _marks = new();
        private readonly StackPanel _stage = new() { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top, FlowDirection = FlowDirection.LeftToRight, Margin = new Thickness(8) };
        private readonly ScrollViewer _area;
        private readonly TextBox _base = new() { Padding = new Thickness(6), Margin = new Thickness(6, 0, 6, 0) };
        private readonly Dictionary<int, BitmapSource> _pix = new();
        private readonly HashSet<int> _failed = new(), _loading = new();
        private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(40) };
        private readonly Action _onPage;
        private bool _busy;

        /// <summary>A toggle button that looks like the others.</summary>
        private sealed class ToggleButton_ : System.Windows.Controls.Primitives.ToggleButton
        {
            public ToggleButton_(string text) { Content = text; }
        }

        public Reader(Action onPage)
        {
            _onPage = onPage;
            FlowDirection = FlowDirection.LeftToRight;   // physical layout: the next page is to the left, like an Arabic book
            LastChildFill = true;
            var bar = new WrapPanel { Margin = new Thickness(0, 0, 0, 6) };
            _next.ToolTip = Loc.T("mus.q.next"); _prev.ToolTip = Loc.T("mus.q.prev");
            for (var j = 1; j <= 30; j++) _juz.Items.Add(new ComboBoxItem { Content = $"{Loc.T("mus.q.juz")} {j}", Tag = j });
            foreach (var b in new Control[] { _next, _prev, _minus, _plus, _fit, _two, _mode, _theme, _night, _star, _full, _juz, _marks })
            {
                b.Margin = new Thickness(2); b.MinWidth = 34; b.Padding = new Thickness(8, 4, 8, 4);
            }
            _juz.MinWidth = 90; _marks.MinWidth = 120;
            foreach (UIElement e in new UIElement[]
            {
                _next, Ui.Text(Loc.T("mus.q.page"), 13), _pageBox, Ui.Text("/ " + Pages, 13), _prev, _where, _juz, _minus, _zoomL, _plus, _fit, _two, _mode, _theme, _night, _star, _marks, _full
            }) bar.Children.Add(e);
            SetDock(bar, Dock.Top);
            Children.Add(bar);
            var src = new DockPanel { Margin = new Thickness(0, 6, 0, 0) };
            var apply = Ui.Btn(Loc.T("mus.q.apply"), ApplyBase);
            apply.Margin = new Thickness(0);
            SetDock(apply, Dock.Right);
            var lbl = Ui.Text(Loc.T("mus.q.source"), 13);
            lbl.VerticalAlignment = VerticalAlignment.Center;
            SetDock(lbl, Dock.Left);
            src.Children.Add(apply); src.Children.Add(lbl); src.Children.Add(_base);
            _base.Text = Settings.Str("mbase");
            SetDock(src, Dock.Bottom);
            Children.Add(src);
            _area = new ScrollViewer { Content = _stage, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, Focusable = false };
            Children.Add(_area);

            _next.Click += (_, _) => Go(Page + Step); _prev.Click += (_, _) => Go(Page - Step);
            _pageBox.Changed += () => { if (!_busy) Go((int)_pageBox.Number); };
            _juz.SelectionChanged += (_, _) => { if (!_busy && _juz.SelectedIndex >= 0) Go(JuzStart[_juz.SelectedIndex]); };
            _minus.Click += (_, _) => Zoom(-10); _plus.Click += (_, _) => Zoom(10);
            _fit.Click += (_, _) => { Settings.S["mzoom"] = 100; Settings.Save(); Render(); };
            _two.Click += (_, _) => { Settings.S["mtwo"] = _two.IsChecked == true; Settings.Save(); Render(); };
            _mode.Click += (_, _) => { Settings.S["mmode"] = _mode.IsChecked == true ? "text" : "img"; Settings.Save(); Render(); };
            _theme.Click += (_, _) => { Settings.S["mtheme"] = Settings.Str("mtheme") == "blue" ? "rose" : "blue"; Settings.Save(); Render(); };
            _night.Click += (_, _) => { Settings.S["mnight"] = _night.IsChecked == true; Settings.Save(); Render(); };
            _star.Click += (_, _) => ToggleMark();
            _marks.SelectionChanged += (_, _) => { if (!_busy && _marks.SelectedItem is ComboBoxItem { Tag: int p } && p > 0) Go(p); };
            _full.Click += (_, _) =>
            {
                var w = Window.GetWindow(this);
                if (w == null) return;
                if (w.WindowStyle == WindowStyle.None) { w.WindowStyle = WindowStyle.SingleBorderWindow; w.WindowState = WindowState.Normal; }
                else { w.WindowStyle = WindowStyle.None; w.WindowState = WindowState.Maximized; }
            };
            _area.SizeChanged += (_, _) => LayoutPages();
            Focusable = true;
            PreviewKeyDown += (_, e) =>
            {
                if (Keyboard.FocusedElement is TextBox) return;
                if (e.Key == Key.Left) { Go(Page + Step); e.Handled = true; }
                else if (e.Key == Key.Right) { Go(Page - Step); e.Handled = true; }
            };
            Loaded += (_, _) => Render();
            Render();
        }

        private static int Page => Clamp(Settings.Int("mpage"));
        private bool IsTwo => Settings.Bool("mtwo") && _area.ViewportWidth >= 760;
        private int Step => IsTwo ? 2 : 1;

        public void Go(int p)
        {
            _failed.Clear();
            Settings.S["mpage"] = Clamp(p);
            Settings.Save();
            Render();
            _area.ScrollToTop();
        }

        private void Zoom(int d) { Settings.S["mzoom"] = Math.Min(220, Math.Max(50, Settings.Int("mzoom") + d)); Settings.Save(); Render(); }

        private void ApplyBase()
        {
            Settings.S["mbase"] = _base.Text.Trim();
            Settings.Save();
            _pix.Clear(); _failed.Clear();
            Render();
        }

        private List<int> Shown()
        {
            var p = Page;
            if (!IsTwo) return new List<int> { p };
            var o = p % 2 == 1 ? p : p - 1;
            return new[] { o, o + 1 }.Where(x => x >= 1 && x <= Pages).ToList();
        }

        private int WidthPx()
        {
            var vw = _area.ViewportWidth > 0 ? _area.ViewportWidth : 900;
            var avail = Math.Max(240, vw - 40);
            var b = IsTwo ? Math.Min(560, (avail - 6) / 2.0) : Math.Min(640, avail);
            return (int)(b * Settings.Int("mzoom") / 100.0);
        }

        private async Task<BitmapSource?> Fetch(int p)
        {
            var b = Settings.Str("mbase") == "" ? (string)Mushaf["base"]! : Settings.Str("mbase");
            var name = $"{p:000}.png";
            byte[] data;
            if (b.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                var hash = Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(b)))[..8];
                var file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WorkflowErpWpf", "mushaf", hash, name);
                if (File.Exists(file)) data = await File.ReadAllBytesAsync(file);
                else
                {
                    using var req = new HttpRequestMessage(HttpMethod.Get, b.TrimEnd('/') + "/" + name);
                    req.Headers.UserAgent.ParseAdd("WorkflowErp-Desktop");
                    using var res = await _http.SendAsync(req);
                    res.EnsureSuccessStatusCode();
                    data = await res.Content.ReadAsByteArrayAsync();
                    Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                    await File.WriteAllBytesAsync(file, data);
                }
            }
            else data = await File.ReadAllBytesAsync(Path.Combine(b, name));
            var bmp = new BitmapImage();
            using (var ms = new MemoryStream(data))
            {
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.StreamSource = ms;
                bmp.EndInit();
            }
            bmp.Freeze();
            return bmp;
        }

        private void Load(int p, bool quiet)
        {
            if (_pix.ContainsKey(p) || _failed.Contains(p) || !_loading.Add(p)) return;
            _ = LoadAsync(p, quiet);
        }

        private async Task LoadAsync(int p, bool quiet)
        {
            try
            {
                var img = await Fetch(p);
                _loading.Remove(p);
                if (img != null)
                {
                    _pix[p] = img;
                    if (_pix.Count > 12) foreach (var k in _pix.Keys.ToList()) { if (_pix.Count <= 8) break; if (!Shown().Contains(k)) _pix.Remove(k); }
                }
                else if (!quiet) _failed.Add(p);
            }
            catch
            {
                _loading.Remove(p);
                if (!quiet) _failed.Add(p);
            }
            if (Shown().Contains(p)) LayoutPages();
        }

        public void Render()
        {
            _busy = true;
            var p = Page;
            _pageBox.Number = p;
            _where.Text = "سورة " + SurahName(SurahOf(p)) + $" · {Loc.T("mus.q.juz")} {JuzOf(p)}";
            _juz.SelectedIndex = JuzOf(p) - 1;
            _zoomL.Text = Settings.Int("mzoom") + "%";
            _two.IsChecked = Settings.Bool("mtwo"); _night.IsChecked = Settings.Bool("mnight");
            _theme.IsChecked = Settings.Str("mtheme") == "blue"; _theme.Visibility = Settings.Str("mmode") == "text" ? Visibility.Visible : Visibility.Collapsed; _theme.ToolTip = Loc.T("mus.q.theme");
            _mode.IsChecked = Settings.Str("mmode") == "text"; _mode.ToolTip = Loc.T(_mode.IsChecked == true ? "mus.q.imgmode" : "mus.q.textmode");
            var marks = ((JsonArray)Settings.S["pmarks"]!).Select(x => (int)x!).OrderBy(x => x).ToList();
            _star.IsChecked = marks.Contains(p);
            _marks.Items.Clear();
            _marks.Items.Add(new ComboBoxItem { Content = "★ " + marks.Count, Tag = 0 });
            foreach (var m in marks) _marks.Items.Add(new ComboBoxItem { Content = $"{Loc.T("mus.q.page")} {m} · {SurahName(SurahOf(m))}", Tag = m });
            _marks.SelectedIndex = 0;
            _marks.Visibility = marks.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            _next.IsEnabled = p + Step <= Pages; _prev.IsEnabled = p - Step >= 1;
            _area.Background = Settings.Bool("mnight") ? new SolidColorBrush(Color.FromRgb(0x0D, 0x0D, 0x0D)) : new SolidColorBrush(Color.FromRgb(0xE5, 0xE9, 0xF0));
            _busy = false;
            foreach (var q in Shown()) Load(q, false);
            foreach (var q in new[] { p + 1, p + 2, p - 1 }) if (q >= 1 && q <= Pages) Load(q, true);
            LayoutPages();
            _onPage();
        }

        /// <summary>Draws the page on white (the images are transparent) at the shown size; night mode inverts it.</summary>
        private static BitmapSource Flatten(BitmapSource src, int w, int h, bool invert)
        {
            var vis = new DrawingVisual();
            RenderOptions.SetBitmapScalingMode(vis, BitmapScalingMode.HighQuality);
            using (var dc = vis.RenderOpen())
            {
                dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, w, h));
                dc.DrawImage(src, new Rect(0, 0, w, h));
            }
            var rtb = new RenderTargetBitmap(w, h, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(vis);
            if (!invert) { rtb.Freeze(); return rtb; }
            var stride = w * 4;
            var px = new byte[stride * h];
            rtb.CopyPixels(px, stride, 0);
            for (var i = 0; i < px.Length; i += 4) { px[i] = (byte)(255 - px[i]); px[i + 1] = (byte)(255 - px[i + 1]); px[i + 2] = (byte)(255 - px[i + 2]); }
            var wb = BitmapSource.Create(w, h, 96, 96, PixelFormats.Pbgra32, null, px, stride);
            wb.Freeze();
            return wb;
        }

        private void LayoutPages()
        {
            _stage.Children.Clear();
            var w = WidthPx();
            var h = (int)(w * 4206.0 / 2600);
            var night = Settings.Bool("mnight");
            foreach (var p in Shown().OrderByDescending(x => x))   // left to right: the later (even) page, then the odd page on the right
            {
                var host = new Border { Width = w, Height = h, Margin = new Thickness(3), Background = night ? Brushes.Black : Brushes.White };
                if (Settings.Str("mmode") == "text")
                {
                    var hits = new List<MushafText.Hit>();
                    host.Child = new Image { Source = MushafText.Render(p, w, night, Settings.Str("mtheme"), hits), Stretch = Stretch.Uniform };
                    host.Cursor = Cursors.Hand;
                    var pg = p;
                    host.MouseLeftButtonDown += (_, e) =>
                    {
                        var pt = e.GetPosition(host);
                        var hit = hits.FirstOrDefault(x => x.R.Contains(pt));
                        if (hit != null) new WordWindow(pg, hit.Li, hit.Ti, hit.Word) { Owner = Window.GetWindow(host) }.ShowDialog();
                    };
                }
                else if (_pix.TryGetValue(p, out var img)) host.Child = new Image { Source = Flatten(img, w, h, night), Stretch = Stretch.Uniform };
                else if (_failed.Contains(p)) host.Child = new TextBlock { Text = Loc.T("mus.q.imgerr"), TextWrapping = TextWrapping.Wrap, Padding = new Thickness(20), Foreground = Brushes.DimGray };
                else host.Child = new TextBlock { Text = Loc.T("mus.loading"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Foreground = night ? Brushes.LightGray : Brushes.Gray };
                _stage.Children.Add(host);
            }
        }

        private void ToggleMark()
        {
            var p = Page;
            var arr = (JsonArray)Settings.S["pmarks"]!;
            var had = arr.Any(x => (int)x! == p);
            var next = new JsonArray();
            foreach (var x in arr) if ((int)x! != p) next.Add((int)x!);
            if (!had) next.Add(p);
            Settings.S["pmarks"] = next;
            Settings.Save();
            Render();
        }
    }
}
