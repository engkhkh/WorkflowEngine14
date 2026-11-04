using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Xml.Linq;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>HR: overview, employees (with Excel / CSV import), leave requests and balances, recruitment, performance and the org structure.
/// The reports and the import fields are described by hr.json (shared by every desktop app).</summary>
internal static class HrEngine
{
    private static JsonNode? _spec;
    public static JsonNode Spec => _spec ??= JsonNode.Parse(Loc.ReadData("hr.json"))!;
    private static bool Ar => Loc.Lang == "ar";
    private static int Ix => Ar ? 1 : 0;
    private static JsonArray A(JsonNode? n) => n as JsonArray ?? new JsonArray();
    private static JsonObject O(JsonNode? n) => n as JsonObject ?? new JsonObject();
    private static string S(JsonNode? n) => FinEngine.S(n);
    private static double Num(JsonNode? n) => FinEngine.Num(n);

    public static string L(string key, params object[] a)
    {
        var s = (string)Spec["labels"]![key]![Ix]!;
        for (var i = 0; i < a.Length; i++) s = s.Replace("{" + i + "}", a[i]?.ToString());
        return s;
    }
    public static string I(string key, params (string k, object v)[] vars)
    {
        var s = (string)Spec["imp"]![key]![Ix]!;
        foreach (var (k, v) in vars) s = s.Replace("{" + k + "}", v?.ToString());
        return s;
    }
    public static string Tx(JsonNode? o) => (string?)o?[Ar ? "ar" : "en"] ?? "";
    public static string Money(double v) => v == Math.Floor(v) ? v.ToString("N0", CultureInfo.InvariantCulture) : v.ToString("N2", CultureInfo.InvariantCulture);
    private static string Norm(object? s) => Regex.Replace((s?.ToString() ?? "").Trim().ToLowerInvariant(), @"[\s_\-.]+", " ");

    // ------------------------------------------------------------ reading .xlsx / .csv (System.IO.Compression + LINQ to XML, no packages)
    /// <summary>cells: string, double or null</summary>
    public static List<List<object?>> ReadTable(string path)
    {
        var low = path.ToLowerInvariant();
        List<List<object?>> rows;
        if (low.EndsWith(".xlsx")) rows = ReadXlsx(path);
        else if (low.EndsWith(".csv") || low.EndsWith(".txt")) rows = ParseCsv(File.ReadAllText(path, Encoding.UTF8));
        else throw new NotSupportedException("type");
        return rows.Where(r => r.Any(c => c != null && c.ToString()!.Trim().Length > 0)).ToList();
    }

    private static List<List<object?>> ReadXlsx(string path)
    {
        using var z = ZipFile.OpenRead(path);
        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        var shared = new List<string>();
        if (z.GetEntry("xl/sharedStrings.xml") is { } se)
        {
            using var s = se.Open();
            foreach (var si in XDocument.Load(s).Descendants(ns + "si")) shared.Add(string.Concat(si.Descendants(ns + "t").Select(t => t.Value)));
        }
        var sheet = z.GetEntry("xl/worksheets/sheet1.xml") ?? z.Entries.Where(e => e.FullName.StartsWith("xl/worksheets/") && e.FullName.EndsWith(".xml")).OrderBy(e => e.FullName).First();
        XDocument doc;
        using (var s = sheet.Open()) doc = XDocument.Load(s);
        var rows = new List<List<object?>>();
        foreach (var r in doc.Descendants(ns + "row"))
        {
            var idx = (int?)r.Attribute("r") is int n ? n - 1 : rows.Count;
            while (rows.Count < idx) rows.Add(new List<object?>());
            var row = new List<object?>();
            foreach (var c in r.Elements(ns + "c"))
            {
                var ci = ColIndex((string?)c.Attribute("r") ?? "A1");
                while (row.Count < ci) row.Add(null);
                var t = (string?)c.Attribute("t");
                var v = c.Element(ns + "v")?.Value;
                object? val = null;
                if (t == "inlineStr") val = string.Concat(c.Descendants(ns + "t").Select(x => x.Value));
                else if (v != null)
                {
                    if (t == "s") val = shared[int.Parse(v, CultureInfo.InvariantCulture)];
                    else if (t is "str" or "e") val = v;
                    else if (t == "b") val = v == "1" ? "TRUE" : "FALSE";
                    else val = double.Parse(v, CultureInfo.InvariantCulture);
                }
                row.Add(val);
            }
            rows.Add(row);
        }
        return rows;
    }

    private static int ColIndex(string reference)
    {
        var n = 0;
        foreach (var ch in reference) { if (char.IsLetter(ch)) n = n * 26 + (char.ToUpperInvariant(ch) - 'A' + 1); else break; }
        return n - 1;
    }

    public static List<List<object?>> ParseCsv(string text)
    {
        text = text.TrimStart('﻿');
        var nl = text.IndexOf('\n');
        var first = nl < 0 ? text : text[..nl];
        var delim = new[] { ',', ';', '\t' }.OrderByDescending(d => first.Count(c => c == d)).First();
        var rows = new List<List<object?>>(); var row = new List<object?>(); var cur = new StringBuilder(); var q = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (q) { if (c == '"') { if (i + 1 < text.Length && text[i + 1] == '"') { cur.Append('"'); i++; } else q = false; } else cur.Append(c); }
            else if (c == '"') q = true;
            else if (c == delim) { row.Add(cur.ToString()); cur.Clear(); }
            else if (c is '\n' or '\r') { if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++; row.Add(cur.ToString()); rows.Add(row); row = new(); cur.Clear(); }
            else cur.Append(c);
        }
        if (cur.Length > 0 || row.Count > 0) { row.Add(cur.ToString()); rows.Add(row); }
        return rows;
    }

    // ------------------------------------------------------------ matching and validating
    public static string CellText(object? v) => v switch { null => "", double d => d == Math.Floor(d) ? ((long)d).ToString(CultureInfo.InvariantCulture) : d.ToString(CultureInfo.InvariantCulture), _ => v.ToString()!.Trim() };

    public static string? GuessField(List<JsonNode> fields, object? heading)
    {
        var h = Norm(heading);
        if (h.Length == 0) return null;
        var flat = h.Replace(" ", "");
        foreach (var f in fields)
            foreach (var n in A(f["names"]))
            {
                var nn = Norm(S(n));
                if (nn == h || nn.Replace(" ", "") == flat) return S(f["key"]);
            }
        return null;
    }

    private static string? Valid(int y, int m, int d) { try { return new DateTime(y, m, d).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); } catch { return null; } }
    public static string? ParseDate(object? v)
    {
        if (v is null) return null;
        if (v is double d) return d > 20000 && d < 80000 ? new DateTime(1899, 12, 30).AddDays((long)d).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null;
        var s = v.ToString()!.Trim();
        var m = Regex.Match(s, @"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})");
        if (m.Success) return Valid(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value));
        m = Regex.Match(s, @"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})");
        if (m.Success)
        {
            int a = int.Parse(m.Groups[1].Value), b = int.Parse(m.Groups[2].Value), y = int.Parse(m.Groups[3].Value);
            return a > 12 ? Valid(y, b, a) : (b > 12 ? Valid(y, a, b) : Valid(y, b, a));   // day first
        }
        return null;
    }

    public sealed class Mapped { public int Row; public JsonObject Data = new(); public List<string> Errors = new(); }

    public static List<Mapped> MapRows(List<List<object?>> rows, Dictionary<int, string> mapping, int first, bool canSalary)
    {
        var res = new List<Mapped>();
        var byField = mapping.Where(kv => kv.Value.Length > 0).ToDictionary(kv => kv.Value, kv => kv.Key);
        var st = O(Spec["status"]);
        string? Word(string key) => st.TryGetPropertyValue(key, out var n) ? S(n) : null;
        for (var i = first; i < rows.Count; i++)
        {
            var r = rows[i];
            if (r.All(c => c == null || c.ToString()!.Trim().Length == 0)) continue;
            var m = new Mapped { Row = i + 1 };
            foreach (var f in A(Spec["fields"]))
            {
                var key = S(f!["key"]);
                if (!byField.TryGetValue(key, out var col) || (f["salary"] is JsonValue sv && sv.TryGetValue<bool>(out var sb) && sb && !canSalary)) continue;
                var raw = col < r.Count ? r[col] : null;
                if (raw == null || raw.ToString()!.Trim().Length == 0) { if (f["required"] is JsonValue rv && rv.TryGetValue<bool>(out var rb) && rb) m.Errors.Add(key); continue; }
                switch (S(f["type"]))
                {
                    case "date": { var d = ParseDate(raw); if (d != null) m.Data[key] = d; else m.Errors.Add(key + ":date"); break; }
                    case "number":
                    {
                        double n; var ok = true;
                        if (raw is double dd) n = dd; else ok = double.TryParse(raw.ToString()!.Replace(",", "").Replace(" ", ""), NumberStyles.Float, CultureInfo.InvariantCulture, out n);
                        if (ok) { if (n == Math.Floor(n)) m.Data[key] = (long)n; else m.Data[key] = n; } else m.Errors.Add(key + ":number");
                        break;
                    }
                    case "status":
                    {
                        var s = Norm(raw);
                        var v = s.Length == 0 ? "Active" : (Word(s) ?? Word(s.Replace(" ", "")));
                        if (!string.IsNullOrEmpty(v)) m.Data[key] = v; else m.Errors.Add(key + ":status");
                        break;
                    }
                    case "gender":
                    {
                        var s = Norm(raw);
                        if (new[] { "m", "male", "man", "ذكر", "رجل" }.Contains(s)) m.Data[key] = "Male";
                        else if (new[] { "f", "female", "woman", "أنثى", "انثى", "امرأة" }.Contains(s)) m.Data[key] = "Female";
                        else m.Errors.Add(key + ":gender");
                        break;
                    }
                    case "email": { var e = raw.ToString()!.Trim(); if (e.Contains('@')) m.Data[key] = e; else m.Errors.Add(key + ":email"); break; }
                    default: m.Data[key] = CellText(raw); break;
                }
            }
            if (S(m.Data["status"]).Length == 0) m.Data["status"] = "Active";
            res.Add(m);
        }
        return res;
    }

    public static void MarkDuplicates(List<Mapped> ms)
    {
        var seen = new HashSet<string>();
        foreach (var m in ms)
        {
            var no = S(m.Data["empNo"]).ToLowerInvariant();
            if (no.Length > 0 && seen.Contains(no)) m.Errors.Add("empNo:dup");
            if (no.Length > 0) seen.Add(no);
        }
    }

    // ------------------------------------------------------------ reports
    private static string EmpName(JsonObject e)
    {
        var ar = S(e["fullNameAr"]);
        var n = Ar && ar.Length > 0 ? ar : S(e["fullName"]);
        return n.Length > 0 ? n : S(e["empNo"]);
    }
    private static string Cut(JsonNode? n) { var s = S(n); return s.Length > 10 ? s[..10] : s; }

    public static List<JsonNode> VisibleCols(JsonNode rep) =>
        A(rep["cols"]).Where(c => !(S(rep["id"]) == "employees" && S(c!["en"]) == "Salary" && !Api.I.Can("hr.employees.salary"))).Select(c => c!).ToList();

    public static (List<string[]> rows, List<object?> pay, string foot) Build(string rid, Dictionary<string, JsonNode?> data, string today)
    {
        var rows = new List<string[]>(); var pay = new List<object?>(); var foot = "";
        void Add(string[] r, object? p = null) { rows.Add(r); pay.Add(p); }
        JsonNode? Get(string k) => data.TryGetValue(k, out var v) ? v : null;
        var emps = new Dictionary<string, JsonObject>();
        foreach (var e in A(Get("employees"))) emps[S(O(e)["empNo"])] = O(e);
        string Nm(string no) => emps.TryGetValue(no, out var e) ? EmpName(e) : no;
        switch (rid)
        {
            case "overview":
            {
                var s = O(Get("summary"));
                foreach (var m in A(Spec["measures"]))
                {
                    var key = S(m![0]);
                    if (s[key] is null) continue;
                    Add(new[] { S(m[Ix + 1]), s[key] is JsonValue jv && jv.TryGetValue<double>(out var dv) ? Money(dv) : S(s[key]) });
                }
                break;
            }
            case "employees":
            {
                var sal = Api.I.Can("hr.employees.salary");
                foreach (var eo in A(Get("employees")))
                {
                    var e = O(eo);
                    var r = new List<string> { S(e["empNo"]), EmpName(e), S(e["position"]), S(e["unit"]), S(e["status"]), Cut(e["hireDate"]) };
                    if (sal) r.Add(Money(Num(e["basicSalary"])));
                    Add(r.ToArray(), e);
                }
                break;
            }
            case "leave":
                foreach (var xo in A(Get("leave")))
                {
                    var x = O(xo); var d = O(x["data"]);
                    Add(new[] { Nm(S(x["empNo"])), S(d["type"]), Cut(d["from"]), Cut(d["to"]), ((long)Num(d["days"])).ToString(CultureInfo.InvariantCulture), S(x["status"]) }, x);
                }
                break;
            case "balances":
                foreach (var eo in A(Get("employees")))
                {
                    var e = O(eo);
                    if (S(e["status"]) == "Terminated") continue;
                    foreach (var to in A(Get("leavetype")))
                    {
                        var ty = O(to); var td = O(ty["data"]);
                        double total = Num(td["days"]), used = 0;
                        foreach (var xo in A(Get("leave")))
                        {
                            var x = O(xo); var d = O(x["data"]);
                            if (S(x["empNo"]) == S(e["empNo"]) && S(x["status"]) == "Approved" && S(d["type"]) == S(ty["code"]) && S(d["from"]).StartsWith(today[..4])) used += Num(d["days"]);
                        }
                        Add(new[] { EmpName(e), S(td["name"]).Length > 0 ? S(td["name"]) : S(ty["code"]), Money(total), Money(used), Money(total - used) });
                    }
                }
                break;
            case "recruit":
            {
                var vac = new Dictionary<string, string>();
                foreach (var vo in A(Get("vacancy"))) { var v = O(vo); var t = S(O(v["data"])["title"]); vac[S(v["code"])] = t.Length > 0 ? t : S(v["code"]); }
                foreach (var co in A(Get("candidate")))
                {
                    var c = O(co); var d = O(c["data"]);
                    var vk = S(d["vacancy"]);
                    Add(new[] { S(d["name"]).Length > 0 ? S(d["name"]) : S(c["code"]), vac.TryGetValue(vk, out var vt) ? vt : vk, S(d["email"]), S(c["status"]).Length > 0 ? S(c["status"]) : "Applied" }, c);
                }
                break;
            }
            case "perf":
            {
                var rated = new List<int>();
                foreach (var xo in A(Get("review")))
                {
                    var x = O(xo); var d = O(x["data"]);
                    var rating = (int)Num(d["rating"]);
                    Add(new[] { Nm(S(x["empNo"])), S(d["stage"]), rating > 0 ? rating.ToString(CultureInfo.InvariantCulture) : "" }, x);
                    if (rating > 0) rated.Add(rating);
                }
                if (rated.Count > 0)
                    foot = $"{L("avg")}: {rated.Average().ToString("F2", CultureInfo.InvariantCulture)}   {L("rated")}: {rated.Count}   {L("dist")}: " + string.Join("  ", Enumerable.Range(1, 5).Select(n => $"{n}★ {rated.Count(r => r == n)}"));
                break;
            }
            case "org":
                foreach (var uo in A(Get("unit")))
                {
                    var u = O(uo); var d = O(u["data"]);
                    var head = A(Get("employees")).Count(eo => S(O(eo)["unit"]) == S(u["code"]) || S(O(eo)["unit"]) == S(d["name"]));
                    var ar = S(d["nameAr"]);
                    Add(new[] { S(u["code"]), Ar && ar.Length > 0 ? ar : S(d["name"]), S(d["level"]), S(d["parent"]), head.ToString(CultureInfo.InvariantCulture) }, u);
                }
                break;
        }
        return (rows, pay, foot);
    }

    public static readonly Dictionary<string, string> View = new()
    {
        ["overview"] = "hr.reports.view", ["employees"] = "hr.employees.view", ["leave"] = "hr.leave.view", ["balances"] = "hr.leave.view", ["recruit"] = "hr.recruitment.view", ["perf"] = "hr.performance.view", ["org"] = "hr.org.view"
    };
    private static string[] KindsOf(string id) => id switch
    {
        "leave" => new[] { "leave" }, "balances" => new[] { "leave", "leavetype" }, "recruit" => new[] { "candidate", "vacancy" }, "perf" => new[] { "review" }, "org" => new[] { "unit" }, _ => Array.Empty<string>()
    };

    public static async Task<Dictionary<string, JsonNode?>> Fetch(string id)
    {
        var res = new Dictionary<string, JsonNode?>();
        if (id == "overview") { res["summary"] = await Api.I.Hr(HttpMethod.Get, "summary"); return res; }
        if (id != "recruit") res["employees"] = await Api.I.Hr(HttpMethod.Get, "employees");
        foreach (var k in KindsOf(id))
        {
            try { res[k] = await Api.I.Hr(HttpMethod.Get, "records/" + k); }
            catch { res[k] = new JsonArray(); }   // a list the user may not read stays empty
        }
        return res;
    }
}

internal sealed class HrImportWindow : Window
{
    private readonly List<JsonNode> _fields = new();
    private readonly TextBox _path = Ui.Input();
    private readonly CheckBox _head = new() { Content = HrEngine.I("hasHeader"), IsChecked = true, Margin = new Thickness(0, 0, 0, 6) };
    private readonly CheckBox _upd = new() { Content = HrEngine.I("update"), IsChecked = true, Margin = new Thickness(0, 6, 0, 6) };
    private readonly StackPanel _mapPanel = new();
    private readonly TextBlock _summary = new() { Margin = new Thickness(0, 6, 0, 6) }, _msg = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 4) };
    private readonly Border _gridHost = new() { MinHeight = 200 };
    private DataGrid _grid = Ui.Grid();
    private readonly Button _run;
    private List<List<object?>> _rows = new();
    private Dictionary<int, string> _mapping = new();
    private List<HrEngine.Mapped> _mapped = new();
    private readonly Dictionary<int, ComboBox> _combos = new();
    private readonly Func<Task> _onDone;
    private bool _building;

    public HrImportWindow(Func<Task> onDone)
    {
        _onDone = onDone;
        Title = HrEngine.I("title"); Width = 940; Height = 760; WindowStartupLocation = WindowStartupLocation.CenterOwner; FlowDirection = Loc.Flow; Background = Ui.Bg;
        Owner = Application.Current.Windows.OfType<Window>().FirstOrDefault(x => x.IsActive) ?? Application.Current.MainWindow;
        foreach (var f in (JsonArray)HrEngine.Spec["fields"]!)
            if (!(f!["salary"] is JsonValue sv && sv.TryGetValue<bool>(out var sb) && sb) || Api.I.Can("hr.employees.salary")) _fields.Add(f!);
        var root = new StackPanel { Margin = new Thickness(16) };
        root.Children.Add(new TextBlock { Text = HrEngine.I("intro"), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 8) });
        var bar = new DockPanel();
        var btns = Ui.Row(Ui.Btn(HrEngine.L("pick"), Choose, "ghost"), Ui.Btn(HrEngine.L("load"), () => _ = Safe(Load)), Ui.Btn(HrEngine.L("template"), Template, "ghost"));
        DockPanel.SetDock(btns, Dock.Right);
        bar.Children.Add(btns); bar.Children.Add(_path);
        root.Children.Add(bar);
        _head.Click += (_, _) => Remap();
        root.Children.Add(_head);
        root.Children.Add(new ScrollViewer { Content = _mapPanel, MaxHeight = 150, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        root.Children.Add(_summary);
        _gridHost.Child = _grid;
        root.Children.Add(_gridHost);
        root.Children.Add(_upd); root.Children.Add(_msg);
        _run = Ui.Btn("", () => _ = Safe(Run));
        _run.IsEnabled = false;
        root.Children.Add(Ui.Row(_run, Ui.Btn(HrEngine.I("close"), Close, "ghost")));
        Content = new ScrollViewer { Content = root, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }

    private async Task Safe(Func<Task> work) { try { await work(); } catch (Exception e) { _msg.Text = e.Message; _run.IsEnabled = _mapped.Any(m => m.Errors.Count == 0); } }

    private void Choose()
    {
        var dlg = new Microsoft.Win32.OpenFileDialog { Filter = "Excel / CSV|*.xlsx;*.csv;*.txt" };
        if (dlg.ShowDialog(this) == true) { _path.Text = dlg.FileName; _ = Safe(Load); }
    }

    private void Template()
    {
        var dlg = new Microsoft.Win32.SaveFileDialog { Filter = "CSV|*.csv", FileName = "employees-template.csv" };
        if (dlg.ShowDialog(this) != true) return;
        File.WriteAllText(dlg.FileName, string.Join(",", _fields.Select(f => (string)f["key"]!)) + "\n" + string.Join(",", _fields.Select(f => HrEngine_S(f["sample"]))) + "\n", new UTF8Encoding(true));
        _msg.Text = HrEngine.L("templated", dlg.FileName);
    }
    private static string HrEngine_S(JsonNode? n) => FinEngine.S(n);

    private Task Load()
    {
        var p = _path.Text.Trim();
        if (p.Length == 0) { _msg.Text = HrEngine.L("nofile"); return Task.CompletedTask; }
        try { _rows = HrEngine.ReadTable(p); }
        catch (NotSupportedException) { _msg.Text = HrEngine.I("badType"); return Task.CompletedTask; }
        catch { _msg.Text = HrEngine.I("readError"); return Task.CompletedTask; }
        if (_rows.Count == 0) { _msg.Text = HrEngine.I("empty"); return Task.CompletedTask; }
        if (_rows.Count > (int)HrEngine.Spec["maxRows"]!) { _msg.Text = HrEngine.I("tooMany"); _rows = new(); return Task.CompletedTask; }
        _msg.Text = "";
        AutoMap();
        return Task.CompletedTask;
    }

    private void AutoMap()
    {
        var width = _rows.Max(r => r.Count);
        _mapping = new(); var used = new HashSet<string>();
        for (var c = 0; c < width; c++)
        {
            var g = HrEngine.GuessField(_fields, c < _rows[0].Count ? _rows[0][c] : null);
            if (g != null && !used.Contains(g)) { _mapping[c] = g; used.Add(g); }
        }
        _head.IsChecked = _mapping.Count >= 2 || _mapping.ContainsKey(0);
        BuildMapUi(width);
        Remap();
    }

    private void BuildMapUi(int width)
    {
        _building = true;
        _mapPanel.Children.Clear(); _combos.Clear();
        for (var c = 0; c < width; c++)
        {
            var h = c < _rows[0].Count ? HrEngine.CellText(_rows[0][c]) : "";
            var cb = new ComboBox { MinWidth = 260, Margin = new Thickness(0, 2, 0, 2) };
            cb.Items.Add(HrEngine.I("skip"));
            var sel = 0;
            for (var i = 0; i < _fields.Count; i++) { cb.Items.Add(HrEngine.Tx(_fields[i])); if ((string)_fields[i]["key"]! == (_mapping.TryGetValue(c, out var mk) ? mk : "")) sel = i + 1; }
            cb.SelectedIndex = sel;
            var col = c;
            cb.SelectionChanged += (_, _) => { if (!_building) SetMap(col); };
            _combos[c] = cb;
            var row = new DockPanel();
            DockPanel.SetDock(cb, Dock.Right);
            row.Children.Add(cb);
            row.Children.Add(new TextBlock { Text = HrEngine.I("column") + " " + (c + 1) + "  " + h, VerticalAlignment = VerticalAlignment.Center });
            _mapPanel.Children.Add(row);
        }
        _building = false;
    }

    private string KeyOf(ComboBox cb) => cb.SelectedIndex <= 0 ? "" : (string)_fields[cb.SelectedIndex - 1]["key"]!;

    private void SetMap(int col)
    {
        var key = KeyOf(_combos[col]);
        _building = true;
        if (key.Length > 0) foreach (var (c, other) in _combos) if (c != col && KeyOf(other) == key) other.SelectedIndex = 0;
        _building = false;
        _mapping = _combos.Where(kv => KeyOf(kv.Value).Length > 0).ToDictionary(kv => kv.Key, kv => KeyOf(kv.Value));
        Remap();
    }

    private List<string> Missing() => _fields.Where(f => f["required"] is JsonValue rv && rv.TryGetValue<bool>(out var rb) && rb && !_mapping.ContainsValue((string)f["key"]!)).Select(f => HrEngine.Tx(f)).ToList();

    private string ErrText(HrEngine.Mapped m) => string.Join(" · ", m.Errors.Select(e =>
    {
        var i = e.IndexOf(':'); var k = i < 0 ? e : e[..i]; var why = i < 0 ? "" : e[(i + 1)..];
        var f = _fields.FirstOrDefault(x => (string)x["key"]! == k);
        return (f != null ? HrEngine.Tx(f) : k) + ": " + HrEngine.I(why.Length == 0 ? "e.required" : "e." + why);
    }));

    private void Remap()
    {
        if (_rows.Count == 0) return;
        _mapped = HrEngine.MapRows(_rows, _mapping, _head.IsChecked == true ? 1 : 0, Api.I.Can("hr.employees.salary"));
        HrEngine.MarkDuplicates(_mapped);
        var keys = _fields.Where(f => _mapping.ContainsValue((string)f["key"]!)).ToList();
        _grid = Ui.Grid(new[] { "#" }.Concat(keys.Select(HrEngine.Tx)).Append(HrEngine.L("problem")).ToArray());
        _gridHost.Child = _grid;
        Ui.Fill(_grid, _mapped.Take(50).Select(m => (new[] { m.Row.ToString(CultureInfo.InvariantCulture) }.Concat(keys.Select(f => m.Data.TryGetPropertyValue((string)f["key"]!, out var v) ? FinEngine.S(v) : "")).Append(ErrText(m)).ToArray(), (object)m)));
        var good = _mapped.Count(m => m.Errors.Count == 0);
        _summary.Text = HrEngine.I("rows", ("n", _mapped.Count)) + "   " + HrEngine.I("valid", ("n", good)) + (_mapped.Count > good ? "   " + HrEngine.I("invalid", ("n", _mapped.Count - good)) : "");
        var miss = Missing();
        _msg.Text = miss.Count > 0 ? HrEngine.L("needmap", string.Join(", ", miss)) : (_mapped.Count > 50 ? HrEngine.I("more", ("n", _mapped.Count - 50)) : "");
        _run.Content = HrEngine.I("run", ("n", good));
        _run.IsEnabled = good > 0 && miss.Count == 0;
    }

    private async Task Run()
    {
        var good = _mapped.Where(m => m.Errors.Count == 0).ToList();
        var bad = _mapped.Where(m => m.Errors.Count > 0).ToList();
        if (good.Count == 0) { _msg.Text = HrEngine.L("nothing"); return; }
        _run.IsEnabled = false; _msg.Text = "…";
        long created = 0, updated = 0, skipped = 0; var errors = new List<(int row, string msg)>();
        var chunk = (int)HrEngine.Spec["chunk"]!; var upd = _upd.IsChecked == true;
        for (var i = 0; i < good.Count; i += chunk)
        {
            var rowsArr = new JsonArray();
            foreach (var m in good.Skip(i).Take(chunk)) rowsArr.Add(new JsonObject { ["row"] = m.Row, ["data"] = m.Data.DeepClone() });
            var r = await Api.I.Hr(HttpMethod.Post, "employees/import", new JsonObject { ["rows"] = rowsArr, ["updateExisting"] = upd });
            created += (long)FinEngine.Num(r?["created"]); updated += (long)FinEngine.Num(r?["updated"]); skipped += (long)FinEngine.Num(r?["skipped"]);
            foreach (var e in (r?["errors"] as JsonArray) ?? new JsonArray()) errors.Add(((int)FinEngine.Num(e?["row"]), FinEngine.S(e?["message"])));
        }
        foreach (var m in bad) errors.Add((m.Row, ErrText(m)));
        var lines = new List<string> { HrEngine.I("done"), $"{HrEngine.I("created")}: {created}   {HrEngine.I("updated")}: {updated}   {HrEngine.I("skipped")}: {skipped}   {HrEngine.I("failed")}: {errors.Count}" };
        lines.AddRange(errors.Take(20).Select(e => $"{HrEngine.L("row")} {e.row}: {e.msg}"));
        _msg.Text = string.Join("\n", lines);
        await _onDone();
    }
}

public sealed class HrView : PageView
{
    private readonly List<JsonNode> _reports = new();
    private readonly ComboBox _pick = new() { MinWidth = 240, Margin = new Thickness(0, 0, 8, 0) };
    private readonly TextBlock _foot = new() { Margin = new Thickness(0, 6, 0, 0) }, _msg = new() { Margin = new Thickness(0, 4, 0, 0) };
    private readonly Button _bImport, _bA, _bB, _bC, _bD; private Dictionary<string, JsonNode?> _lastData = new();
    private DataGrid _grid = Ui.Grid();
    private readonly Border _gridHost = new() { MinHeight = 360 };
    private string _current = "";
    private bool _loading;

    public HrView()
    {
        foreach (var r in (JsonArray)HrEngine.Spec["reports"]!)
            if (Api.I.Can(HrEngine.View[(string)r!["id"]!])) { _reports.Add(r!); _pick.Items.Add(HrEngine.Tx(r)); }
        Root.Children.Add(Ui.Text(HrEngine.L("title"), 20, true));
        _bImport = Ui.Btn(HrEngine.L("import"), () => { new HrImportWindow(Reload).ShowDialog(); }, "ghost");
        _bA = Ui.Btn("", () => _ = Safe(() => Act(0)));
        _bB = Ui.Btn("", () => _ = Safe(() => Act(1)));
        _bC = Ui.Btn("", () => _ = Safe(() => Act(2)));
        _bD = Ui.Btn("", () => _ = Safe(() => Act(3)));
        var bar = new WrapPanel { Margin = new Thickness(0, 8, 0, 8) };
        foreach (UIElement e in new UIElement[] { _pick, Ui.Btn(HrEngine.L("refresh"), () => _ = Safe(Reload)), _bImport, _bA, _bB, _bC, _bD }) bar.Children.Add(e);
        _pick.SelectionChanged += async (_, _) => { if (!_loading) await Safe(Reload); };
        Root.Children.Add(bar);
        _gridHost.Child = _grid;
        Root.Children.Add(_gridHost);
        Root.Children.Add(_foot); Root.Children.Add(_msg);
    }

    private JsonNode? Rep => _pick.SelectedIndex >= 0 && _pick.SelectedIndex < _reports.Count ? _reports[_pick.SelectedIndex] : null;

    public override async Task Reload()
    {
        _loading = true;
        if (_pick.SelectedIndex < 0 && _pick.Items.Count > 0) _pick.SelectedIndex = 0;
        _loading = false;
        var rep = Rep;
        if (rep is null) { _msg.Text = HrEngine.L("noperm"); return; }
        var id = (string)rep["id"]!;
        _current = id;
        _bImport.Visibility = id == "employees" && Api.I.Can("hr.employees.import") ? Visibility.Visible : Visibility.Collapsed;
        var acts = (rep["actions"] as JsonArray)?.Select(a => (string)a!).ToList() ?? new List<string>();
        var can = (id == "leave" && Api.I.Can("hr.leave.approve")) || (id == "recruit" && Api.I.Can("hr.recruitment.manage"));
        var bs = new[] { _bA, _bB, _bC, _bD };
        for (var i = 0; i < 4; i++) { bs[i].Visibility = can && i < acts.Count ? Visibility.Visible : Visibility.Collapsed; if (i < acts.Count) bs[i].Content = HrEngine.L(acts[i]); }
        var cols = HrEngine.VisibleCols(rep);
        _grid = Ui.Grid(cols.Select(c => HrEngine.Tx(c)).ToArray());
        _gridHost.Child = _grid;
        _msg.Text = "…";
        var data = await HrEngine.Fetch(id);
        if (id != _current) return;
        _lastData = data;
        var (rows, pay, foot) = HrEngine.Build(id, data, DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        Ui.Fill(_grid, rows.Select((r, i) => (r, (object)(pay[i] ?? ""))));
        _foot.Text = foot;
        _msg.Text = rows.Count == 0 ? HrEngine.L("empty") : "";
    }

    private async Task Act(int which)
    {
        if (Ui.Selected<JsonObject>(_grid) is not { } rec || Rep is not { } rep) return;
        var id = (string)rep["id"]!; var name = (string)rep["actions"]![which]!;
        string path; JsonObject body;
        if (id == "leave")
        {
            if (FinEngine.S(rec["status"]) != "Pending") return;
            body = new JsonObject { ["status"] = name == "approve" ? "Approved" : "Rejected", ["empNo"] = rec["empNo"]?.DeepClone(), ["data"] = rec["data"]?.DeepClone() };
            path = "records/leave/" + FinEngine.S(rec["id"]);
        }
        else if (name == "hire")
        {
            if (FinEngine.S(rec["status"]) == "Offer") await Hire(rec);
            return;
        }
        else if (name == "reject")
        {
            var st = FinEngine.S(rec["status"]); if (st is "Hired" or "Rejected") return;
            body = new JsonObject { ["status"] = "Rejected", ["data"] = rec["data"]?.DeepClone() };
            path = "records/candidate/" + FinEngine.S(rec["id"]);
        }
        else
        {
            var stages = ((JsonArray)HrEngine.Spec["stages"]!).Select(s => (string)s!).ToList();
            var cur = stages.IndexOf(FinEngine.S(rec["status"]).Length > 0 ? FinEngine.S(rec["status"]) : "Applied");
            var to = cur + (name == "next" ? 1 : -1);
            if (to < 0 || to >= stages.Count) return;
            body = new JsonObject { ["status"] = stages[to], ["data"] = rec["data"]?.DeepClone() };
            path = "records/candidate/" + FinEngine.S(rec["id"]);
        }
        await Api.I.Hr(HttpMethod.Put, path, body);
        await Reload();
    }

    /// <summary>Hire a candidate: creates the employee (prefilled from the candidate and the vacancy) and marks the candidate Hired.</summary>
    private async Task Hire(JsonObject cand)
    {
        var d = cand["data"] as JsonObject ?? new JsonObject(); var v = new JsonObject();
        foreach (var x in (_lastData.TryGetValue("vacancy", out var vn) ? vn as JsonArray : null) ?? new JsonArray())
            if (x is JsonObject xo && FinEngine.S(xo["code"]) == FinEngine.S(d["vacancy"])) v = xo["data"] as JsonObject ?? new JsonObject();
        var pre = new Dictionary<string, string> { ["fullName"] = FinEngine.S(d["name"]), ["email"] = FinEngine.S(d["email"]), ["phone"] = FinEngine.S(d["phone"]), ["position"] = FinEngine.S(v["title"]), ["unit"] = FinEngine.S(v["unit"]), ["location"] = FinEngine.S(v["location"]), ["grade"] = FinEngine.S(v["grade"]), ["hireDate"] = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) };
        var names = ((JsonArray)HrEngine.Spec["fields"]!).OfType<JsonObject>().ToDictionary(f => (string)f["key"]!, f => HrEngine.Tx(f));
        var boxes = new Dictionary<string, TextBox>(); var err = new TextBlock { Foreground = Ui.Danger }; var ok = false;
        var w = Ui.Dialog(HrEngine.L("hireTitle"), 420, 560, out var body);
        foreach (var k in new[] { "empNo", "fullName", "email", "phone", "position", "unit", "location", "grade", "hireDate" })
        {
            boxes[k] = Ui.Input(pre.TryGetValue(k, out var pv) ? pv : "");
            body.Children.Add(Ui.Labeled((names.TryGetValue(k, out var nm) ? nm : k) + (k is "empNo" or "fullName" ? " *" : ""), boxes[k]));
        }
        body.Children.Add(err);
        body.Children.Add(Ui.Row(Ui.Btn(HrEngine.L("hire"), () =>
        {
            if (boxes["empNo"].Text.Trim().Length == 0 || boxes["fullName"].Text.Trim().Length == 0) { err.Text = HrEngine.L("empNoReq"); return; }
            ok = true; w.Close();
        }), Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog(); if (!ok) return;
        var emp = new JsonObject(); foreach (var (k, b) in boxes) if (b.Text.Trim().Length > 0) emp[k] = b.Text.Trim();
        emp["status"] = "Probation";
        await Api.I.Hr(HttpMethod.Post, "employees", emp);
        await Api.I.Hr(HttpMethod.Put, "records/candidate/" + FinEngine.S(cand["id"]), new JsonObject { ["status"] = "Hired", ["data"] = cand["data"]?.DeepClone() });
        await Reload();
    }
}
