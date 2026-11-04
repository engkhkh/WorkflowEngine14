using System.Diagnostics;
using System.Globalization;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Calendar and meetings: agenda (day / week / month), events, meetings with a join link, RSVP, availability check, to-dos and settings.
/// The server keeps UTC; the screen shows the computer's own time zone.</summary>
internal static class CalEngine
{
    public const string Fmt = "yyyy-MM-dd HH:mm";
    private const string IsoFmt = "yyyy-MM-dd'T'HH:mm:ss'Z'";

    public static DateTime ToLocal(string iso) => DateTime.SpecifyKind(DateTime.ParseExact(iso[..19] + "Z", IsoFmt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal), DateTimeKind.Utc).ToLocalTime();
    public static string ToUtcIso(DateTime local) => local.ToUniversalTime().ToString(IsoFmt, CultureInfo.InvariantCulture);
    public static string FmtLocal(string? iso) => string.IsNullOrEmpty(iso) ? "" : ToLocal(iso).ToString(Fmt, CultureInfo.InvariantCulture);

    /// <summary>"yyyy-MM-dd HH:mm" in local time -> UTC ISO; "" when empty; FormatException when malformed</summary>
    public static string ParseLocal(string? s)
    {
        s = (s ?? "").Trim();
        if (s.Length == 0) return "";
        if (!DateTime.TryParseExact(s, Fmt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) throw new FormatException(Loc.T("cal.u.badtime"));
        return ToUtcIso(DateTime.SpecifyKind(d, DateTimeKind.Local));
    }

    public static (DateTime from, DateTime to) Period(string view, DateTime anchor)
    {
        var d = anchor.Date;
        if (view == "day") return (d, d.AddDays(1));
        if (view == "week") { var a = d.AddDays(-(((int)d.DayOfWeek + 6) % 7)); return (a, a.AddDays(7)); }
        var m = new DateTime(d.Year, d.Month, 1);
        return (m, m.AddMonths(1));
    }

    public static DateTime Shift(string view, DateTime anchor, int n) => view == "day" ? anchor.AddDays(n) : view == "week" ? anchor.AddDays(7 * n) : new DateTime(anchor.Year, anchor.Month, 1).AddMonths(n);

    public static string KindName(string k) => Loc.T(k == "meeting" ? "cal.u.meeting" : k == "todo" ? "cal.u.todo" : "cal.u.event");
    public static string Me => Api.I.Session?.Username ?? "";
    public static string S(JsonNode? n) => HosEngine.V(n);

    /// <summary>form values -> request body; FormatException carries the message for the user</summary>
    public static JsonObject EventPayload(Dictionary<string, object?> v)
    {
        string G(string k) => v.TryGetValue(k, out var x) ? x?.ToString() ?? "" : "";
        var kind = G("kind");
        if (G("title").Trim().Length == 0) throw new FormatException(Loc.T("cal.u.needtitle"));
        var start = ParseLocal(G("start")); var end = ParseLocal(G("end")); var until = G("until").Trim(); string? untilIso = null;
        if (until.Length > 0)
        {
            if (!DateTime.TryParseExact(until, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var ud)) throw new FormatException(Loc.T("cal.u.badtime"));
            untilIso = ToUtcIso(DateTime.SpecifyKind(ud, DateTimeKind.Local));
        }
        if (kind != "todo" && start.Length == 0) throw new FormatException(Loc.T("cal.u.badtime"));
        if (kind != "todo" && (end.Length == 0 || string.CompareOrdinal(end, start) <= 0)) end = ToUtcIso(ToLocal(start).AddHours(1));
        var guests = new JsonArray();
        foreach (var g in Regex.Split(G("guests"), @"[,;\s]+")) if (g.Trim().Length > 0) guests.Add(g.Trim());
        var att = new JsonArray();
        if (kind != "todo" && v.TryGetValue("attendees", out var al) && al is IEnumerable<string> names) foreach (var n in names) att.Add(n);
        var rem = G("remind").Trim();
        return new JsonObject
        {
            ["kind"] = kind, ["title"] = G("title").Trim(), ["start"] = start.Length == 0 ? null : start, ["end"] = kind == "todo" ? null : end, ["notes"] = G("notes"), ["location"] = G("location"),
            ["attendees"] = att, ["guests"] = guests, ["repeat"] = G("repeat").Length == 0 ? "none" : G("repeat"), ["repeatUntil"] = untilIso,
            ["remindMinutes"] = rem.Length > 0 && rem.All(char.IsDigit) ? long.Parse(rem, CultureInfo.InvariantCulture) : null, ["priority"] = G("priority").Length == 0 ? "normal" : G("priority")
        };
    }

    public static void OpenUrl(string url) { try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { /* no browser */ } }

    /// <summary>modal event form; returns the request body, or null when cancelled</summary>
    public static JsonObject? EventDialog(JsonObject item, bool isNew, JsonArray people)
    {
        JsonObject? result = null;
        var d = item["data"] as JsonObject ?? new JsonObject();
        var w = Ui.Dialog(isNew ? Loc.T("cal.u.new") : Loc.T("cal.u.edit"), 540, 820, out var body);
        var kind = new ComboBox { Margin = new Thickness(0, 0, 0, 8), Padding = new Thickness(6) };
        foreach (var k in new[] { "event", "meeting", "todo" }) kind.Items.Add(new HosEngine.Opt(k, KindName(k)));
        var kv = item["kind"]?.ToString() ?? "event"; kind.SelectedItem = kind.Items.OfType<HosEngine.Opt>().First(o => o.V == kv);
        var now = DateTime.Now.Date.AddHours(DateTime.Now.Hour + 1);
        var title = Ui.Input(S(item["title"]));
        var start = Ui.Input(item["start"] != null ? FmtLocal(S(item["start"])) : now.ToString(Fmt, CultureInfo.InvariantCulture));
        var end = Ui.Input(item["end"] != null ? FmtLocal(S(item["end"])) : now.AddHours(1).ToString(Fmt, CultureInfo.InvariantCulture));
        var location = Ui.Input(S(d["location"]));
        var notes = new TextBox { Text = S(d["notes"]), AcceptsReturn = true, Height = 56, TextWrapping = TextWrapping.Wrap, Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8) };
        var repeat = new ComboBox { Margin = new Thickness(0, 0, 0, 8), Padding = new Thickness(6) };
        foreach (var (k, key) in new[] { ("none", "cal.u.none"), ("daily", "cal.u.daily"), ("weekly", "cal.u.weekly"), ("monthly", "cal.u.monthly") }) repeat.Items.Add(new HosEngine.Opt(k, Loc.T(key)));
        var rv = S(d["repeat"]).Length == 0 ? "none" : S(d["repeat"]); repeat.SelectedItem = repeat.Items.OfType<HosEngine.Opt>().First(o => o.V == rv);
        var until = Ui.Input(S(d["repeatUntil"]).Length >= 10 ? S(d["repeatUntil"])[..10] : "");
        var remind = Ui.Input(isNew ? "10" : S(d["remind"]));
        var prio = new ComboBox { Margin = new Thickness(0, 0, 0, 8), Padding = new Thickness(6) };
        foreach (var k in new[] { "low", "normal", "high" }) prio.Items.Add(new HosEngine.Opt(k, k));
        var pv = S(d["priority"]).Length == 0 ? "normal" : S(d["priority"]); prio.SelectedItem = prio.Items.OfType<HosEngine.Opt>().First(o => o.V == pv);
        var guests = Ui.Input(string.Join(", ", (d["guests"] as JsonArray ?? new JsonArray()).Select(S)));
        var chosen = (d["attendees"] as JsonArray ?? new JsonArray()).Select(S).ToHashSet();
        var checks = new List<(CheckBox box, string user)>();
        var attPanel = new StackPanel();
        foreach (var p in people.OfType<JsonObject>())
        {
            var u = S(p["username"]);
            if (string.Equals(u, Me, StringComparison.OrdinalIgnoreCase)) continue;
            var cb = new CheckBox { Content = S(p["displayName"]) + " (" + u + ")", IsChecked = chosen.Contains(u), Margin = new Thickness(0, 2, 0, 2) };
            checks.Add((cb, u)); attPanel.Children.Add(cb);
        }
        var attScroll = new ScrollViewer { Content = attPanel, Height = 96, Margin = new Thickness(0, 0, 0, 8), VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var avail = Ui.Text("", 12, false, Ui.Dim); var err = Ui.Text("", 12, false, Ui.Danger);

        Dictionary<string, object?> Values() => new()
        {
            ["kind"] = (kind.SelectedItem as HosEngine.Opt)?.V, ["title"] = title.Text, ["start"] = start.Text, ["end"] = end.Text, ["location"] = location.Text, ["notes"] = notes.Text,
            ["repeat"] = (repeat.SelectedItem as HosEngine.Opt)?.V, ["until"] = until.Text, ["remind"] = remind.Text, ["priority"] = (prio.SelectedItem as HosEngine.Opt)?.V,
            ["attendees"] = checks.Where(c => c.box.IsChecked == true).Select(c => c.user).ToList(), ["guests"] = guests.Text
        };

        async void Check()
        {
            try
            {
                var s = ParseLocal(start.Text); var e = ParseLocal(end.Text);
                if (s.Length == 0) { avail.Text = Loc.T("cal.u.badtime"); return; }
                var users = new List<string> { Me }; users.AddRange(checks.Where(c => c.box.IsChecked == true).Select(c => c.user));
                var req = new JsonObject { ["users"] = new JsonArray(users.Select(u => (JsonNode)u).ToArray()), ["from"] = ToUtcIso(ToLocal(s).AddHours(-12)), ["to"] = ToUtcIso(ToLocal(e.Length == 0 ? s : e).AddHours(12)) };
                var res = await Api.I.Cal(HttpMethod.Post, "freebusy", req) as JsonObject ?? new JsonObject();
                var lines = new List<string>();
                foreach (var u in users)
                {
                    var clash = (res[u] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Where(x => string.CompareOrdinal(S(x["s"]), e) < 0 && string.CompareOrdinal(S(x["e"]), s) > 0)
                        .Select(x => FmtLocal(S(x["s"]))[11..] + "-" + FmtLocal(S(x["e"]))[11..]).ToList();
                    lines.Add(u + ": " + (clash.Count == 0 ? Loc.T("cal.u.free") : Loc.T("cal.u.busy") + " " + string.Join(", ", clash)));
                }
                avail.Text = string.Join("\n", lines);
            }
            catch (Exception ex) { avail.Text = ex.Message; }
        }

        foreach (var (key, el) in new (string, UIElement)[] { ("cal.u.type", kind), ("cal.u.title", title), ("cal.u.start", start), ("cal.u.end", end), ("cal.u.location", location), ("cal.u.notes", notes), ("cal.u.repeat", repeat),
                     ("cal.u.until", until), ("cal.u.remind", remind), ("cal.u.priority", prio), ("cal.u.attendees", attScroll), ("cal.u.guests", guests) })
            body.Children.Add(Ui.Labeled(Loc.T(key), el));
        body.Children.Add(avail); body.Children.Add(err);
        var canSave = isNew || string.Equals(S(item["owner"]), Me, StringComparison.OrdinalIgnoreCase) || Api.I.Can("cal.settings");
        var save = Ui.Btn(Loc.T("cal.u.save"), () =>
        {
            try { result = EventPayload(Values()); w.Close(); } catch (FormatException ex) { err.Text = ex.Message; }
        });
        save.IsEnabled = canSave;
        body.Children.Add(Ui.Row(save, Ui.Btn(Loc.T("cal.u.avail"), Check, "ghost"), Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog();
        return result;
    }
}

internal sealed class CalAgenda : StackPanel
{
    private string _view = "week"; private DateTime _anchor = DateTime.Today; private JsonArray _people = new();
    private readonly ComboBox _vsel = new() { Margin = new Thickness(0, 0, 8, 0), Padding = new Thickness(6) };
    private readonly TextBlock _rng = Ui.Text("", 12, false, Ui.Dim), _err = Ui.Text("", 12, false, Ui.Danger);
    private readonly DataGrid _grid = Ui.Grid(Loc.T("cal.u.when"), Loc.T("cal.u.title"), Loc.T("cal.u.type"), Loc.T("cal.u.where"), Loc.T("cal.u.rsvp"));
    private readonly Dictionary<string, Button> _btn = new();

    public CalAgenda()
    {
        foreach (var k in new[] { "day", "week", "month" }) _vsel.Items.Add(new HosEngine.Opt(k, Loc.T("cal.u." + k)));
        _vsel.SelectedIndex = 1;
        _vsel.SelectionChanged += async (_, _) => { _view = (_vsel.SelectedItem as HosEngine.Opt)?.V ?? "week"; await Reload(); };
        var bar = new WrapPanel();
        bar.Children.Add(Ui.Btn("‹", async () => { _anchor = CalEngine.Shift(_view, _anchor, -1); await Reload(); }, "ghost"));
        bar.Children.Add(Ui.Btn(Loc.T("cal.u.today"), async () => { _anchor = DateTime.Today; await Reload(); }, "ghost"));
        bar.Children.Add(Ui.Btn("›", async () => { _anchor = CalEngine.Shift(_view, _anchor, 1); await Reload(); }, "ghost"));
        bar.Children.Add(_vsel); bar.Children.Add(_rng);
        bar.Children.Add(Ui.Btn(Loc.T("cal.u.new"), async () => await Edit(new JsonObject(), true)));
        bar.Children.Add(Ui.Btn(Loc.T("cal.u.instant"), async () => await Instant(), "ghost"));
        Children.Add(bar); Children.Add(_err);
        _grid.Height = 340; _grid.SelectionChanged += (_, _) => Sel();
        Ui.OnOpen(_grid, async () => await Edit(Cur, false));
        Children.Add(_grid);
        var row = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
        void Add(string key, Action a) { var b = Ui.Btn(Loc.T("cal.u." + key), a, "ghost"); _btn[key] = b; row.Children.Add(b); }
        Add("edit", async () => await Edit(Cur, false));
        Add("join", async () => await JoinInfo(r => { CalEngine.OpenUrl(CalEngine.S(r["url"])); _err.Text = Loc.T("cal.u.opened"); }));
        Add("link", async () => await JoinInfo(r => { try { Clipboard.SetText(CalEngine.S(r["url"])); } catch { /* clipboard busy */ } _err.Text = Loc.T("cal.u.copied") + ": " + CalEngine.S(r["url"]); }));
        Add("ics", async () => await Ics());
        Add("accept", async () => await Rsvp("accepted")); Add("maybe", async () => await Rsvp("maybe")); Add("decline", async () => await Rsvp("declined"));
        Add("delete", async () => await Delete());
        Children.Add(row);
        Sel();
    }

    private JsonObject Cur => Ui.Selected<JsonObject>(_grid) ?? new JsonObject();

    public async Task Reload()
    {
        var (a, b) = CalEngine.Period(_view, _anchor);
        _rng.Text = a.ToString("yyyy-MM-dd") + " → " + b.AddDays(-1).ToString("yyyy-MM-dd"); _err.Text = "";
        try
        {
            var ev = await Api.I.Cal(HttpMethod.Get, $"events?from={CalEngine.ToUtcIso(DateTime.SpecifyKind(a, DateTimeKind.Local))}&to={CalEngine.ToUtcIso(DateTime.SpecifyKind(b, DateTimeKind.Local))}") as JsonArray ?? new JsonArray();
            _people = await Api.I.Cal(HttpMethod.Get, "people") as JsonArray ?? new JsonArray();
            var rows = ev.OfType<JsonObject>().Select(e =>
            {
                var d = e["data"] as JsonObject ?? new JsonObject();
                var when = CalEngine.FmtLocal(CalEngine.S(e["start"])) + (e["end"] != null ? " → " + CalEngine.FmtLocal(CalEngine.S(e["end"]))[11..] : "");
                var rsvp = CalEngine.S((d["rsvp"] as JsonObject)?[CalEngine.Me]);
                return (new[] { when, CalEngine.S(e["title"]) + (e["occurrence"]?.ToString() == "true" ? " ↻" : ""), CalEngine.KindName(CalEngine.S(e["kind"])), CalEngine.S(d["location"]), rsvp }, (object)e);
            });
            Ui.Fill(_grid, rows);
            Sel();
        }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private void Sel()
    {
        var e = Cur; var has = e.Count > 0;
        var mine = has && (string.Equals(CalEngine.S(e["owner"]), CalEngine.Me, StringComparison.OrdinalIgnoreCase) || Api.I.Can("cal.settings"));
        var invited = has && ((e["data"] as JsonObject)?["attendees"] as JsonArray ?? new JsonArray()).Any(a => CalEngine.S(a) == CalEngine.Me);
        var meeting = has && CalEngine.S(e["kind"]) == "meeting";
        _btn["edit"].IsEnabled = has; _btn["ics"].IsEnabled = has; _btn["join"].IsEnabled = meeting; _btn["link"].IsEnabled = meeting;
        foreach (var k in new[] { "accept", "maybe", "decline" }) _btn[k].IsEnabled = invited;
        _btn["delete"].IsEnabled = mine;
    }

    private async Task Edit(JsonObject item, bool isNew)
    {
        if (!isNew && item.Count == 0) return;
        var body = CalEngine.EventDialog(item, isNew, _people);
        if (body == null) return;
        try
        {
            if (isNew) await Api.I.Cal(HttpMethod.Post, "events", body); else await Api.I.Cal(HttpMethod.Put, "events/" + CalEngine.S(item["id"]), body);
            await Reload();
        }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async Task JoinInfo(Action<JsonObject> cb)
    {
        try { cb(await Api.I.Cal(HttpMethod.Post, "events/" + CalEngine.S(Cur["id"]) + "/join", new JsonObject()) as JsonObject ?? new JsonObject()); }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async Task Ics()
    {
        var e = Cur;
        var dlg = new Microsoft.Win32.SaveFileDialog { FileName = CalEngine.S(e["title"]) + ".ics", Filter = "iCalendar (*.ics)|*.ics" };
        if (dlg.ShowDialog() != true) return;
        try { await System.IO.File.WriteAllBytesAsync(dlg.FileName, await Api.I.Raw("/calendar/events/" + CalEngine.S(e["id"]) + "/ics")); }
        catch (Exception ex) { _err.Text = ex.Message; }
    }

    private async Task Rsvp(string r)
    {
        try { await Api.I.Cal(HttpMethod.Post, "events/" + CalEngine.S(Cur["id"]) + "/rsvp", new JsonObject { ["response"] = r }); await Reload(); }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async Task Delete()
    {
        var id = CalEngine.S(Cur["id"]);
        if (id.Length == 0 || !Ui.Ask(Loc.T("cal.u.confirmdel"), Loc.T("common.yes"), Loc.T("common.no"))) return;
        try { await Api.I.Cal(HttpMethod.Delete, "events/" + id); await Reload(); }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async Task Instant()
    {
        try
        {
            var r = await Api.I.Cal(HttpMethod.Post, "meetings/instant", new JsonObject { ["title"] = Loc.T("cal.u.instant"), ["attendees"] = new JsonArray() }) as JsonObject ?? new JsonObject();
            CalEngine.OpenUrl(CalEngine.S(r["url"])); await Reload();
        }
        catch (Exception e) { _err.Text = e.Message; }
    }
}

internal sealed class CalTodos : StackPanel
{
    private readonly TextBox _title = Ui.Input(), _due = Ui.Input();
    private readonly ComboBox _prio = new() { Margin = new Thickness(0, 0, 8, 8), Padding = new Thickness(6) };
    private readonly DataGrid _grid = Ui.Grid(Loc.T("cal.u.title"), Loc.T("cal.u.due"), Loc.T("cal.u.priority"), Loc.T("cal.u.done"));
    private readonly TextBlock _err = Ui.Text("", 12, false, Ui.Danger);

    public CalTodos()
    {
        foreach (var k in new[] { "low", "normal", "high" }) _prio.Items.Add(new HosEngine.Opt(k, k));
        _prio.SelectedIndex = 1;
        _title.Width = 220; _due.Width = 170;
        var bar = new WrapPanel();
        bar.Children.Add(Ui.Text(Loc.T("cal.u.title"), 12, false, Ui.Dim)); bar.Children.Add(_title); bar.Children.Add(Ui.Text(Loc.T("cal.u.due"), 12, false, Ui.Dim)); bar.Children.Add(_due); bar.Children.Add(_prio);
        bar.Children.Add(Ui.Btn(Loc.T("cal.u.add"), async () => await Add()));
        Children.Add(bar); Children.Add(_err);
        _grid.Height = 300; Children.Add(_grid);
        var row = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
        row.Children.Add(Ui.Btn(Loc.T("cal.u.toggle"), async () => await Act(HttpMethod.Post, "/done"), "ghost"));
        row.Children.Add(Ui.Btn(Loc.T("cal.u.delete"), async () => await Act(HttpMethod.Delete, ""), "ghost"));
        Children.Add(row);
    }

    public async Task Reload()
    {
        try
        {
            var l = await Api.I.Cal(HttpMethod.Get, "todos") as JsonArray ?? new JsonArray();
            Ui.Fill(_grid, l.OfType<JsonObject>().Select(x => (new[] { CalEngine.S(x["title"]), x["start"] != null ? CalEngine.FmtLocal(CalEngine.S(x["start"])) : "", CalEngine.S((x["data"] as JsonObject)?["priority"]), CalEngine.S(x["status"]) == "Done" ? "✓" : "" }, (object)x)));
            _err.Text = "";
        }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async Task Act(HttpMethod m, string suffix)
    {
        var x = Ui.Selected<JsonObject>(_grid); if (x == null) return;
        try { await Api.I.Cal(m, "events/" + CalEngine.S(x["id"]) + suffix, m == HttpMethod.Post ? new JsonObject() : null); await Reload(); }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async Task Add()
    {
        try
        {
            var body = CalEngine.EventPayload(new() { ["kind"] = "todo", ["title"] = _title.Text, ["start"] = _due.Text, ["priority"] = (_prio.SelectedItem as HosEngine.Opt)?.V, ["remind"] = "" });
            _title.Clear(); _due.Clear();
            await Api.I.Cal(HttpMethod.Post, "events", body); await Reload();
        }
        catch (Exception e) { _err.Text = e.Message; }
    }
}

internal sealed class CalSettingsPanel : StackPanel
{
    private readonly TextBox _jitsi = Ui.Input(), _ws = Ui.Input(), _we = Ui.Input();
    private readonly TextBlock _msg = Ui.Text("", 12, false, Ui.Dim);

    public CalSettingsPanel()
    {
        Children.Add(Ui.Labeled(Loc.T("cal.u.jitsi"), _jitsi)); Children.Add(Ui.Labeled(Loc.T("cal.u.ws"), _ws)); Children.Add(Ui.Labeled(Loc.T("cal.u.we"), _we));
        Children.Add(Ui.Btn(Loc.T("cal.u.save"), async () => await Save())); Children.Add(_msg);
    }

    public async Task Reload()
    {
        try
        {
            var s = await Api.I.Cal(HttpMethod.Get, "settings") as JsonObject ?? new JsonObject();
            _jitsi.Text = CalEngine.S(s["jitsiDomain"]); _ws.Text = CalEngine.S(s["workStart"]); _we.Text = CalEngine.S(s["workEnd"]);
        }
        catch (Exception e) { _msg.Text = e.Message; }
    }

    private async Task Save()
    {
        try
        {
            await Api.I.Cal(HttpMethod.Put, "settings", new JsonObject { ["jitsiDomain"] = _jitsi.Text.Trim(), ["workStart"] = _ws.Text.Trim(), ["workEnd"] = _we.Text.Trim() });
            _msg.Text = Loc.T("cal.u.saved");
        }
        catch (Exception e) { _msg.Text = e.Message; }
    }
}

public sealed class CalendarView : PageView
{
    private readonly TabControl _tabs = new() { Margin = new Thickness(0, 8, 0, 0) };
    private readonly List<FrameworkElement> _views = new();

    public CalendarView()
    {
        Root.Children.Add(Ui.Text(Loc.T("tab.cal"), 20, true));
        void Tab(string key, FrameworkElement v) { _views.Add(v); _tabs.Items.Add(new TabItem { Header = Loc.T(key), Content = new Border { Child = v, Padding = new Thickness(0, 10, 0, 0) } }); }
        Tab("cal.u.agenda", new CalAgenda()); Tab("cal.u.todos", new CalTodos());
        if (Api.I.Can("cal.settings")) Tab("cal.u.settings", new CalSettingsPanel());
        _tabs.SelectionChanged += async (_, e) => { if (ReferenceEquals(e.OriginalSource, _tabs)) await Safe(Reload); };
        Root.Children.Add(_tabs);
    }

    public override async Task Reload()
    {
        var i = _tabs.SelectedIndex;
        if (i < 0) return;
        switch (_views[i]) { case CalAgenda a: await a.Reload(); break; case CalTodos t: await t.Reload(); break; case CalSettingsPanel s: await s.Reload(); break; }
    }
}
