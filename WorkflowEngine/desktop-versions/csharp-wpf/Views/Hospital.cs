using System.Globalization;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Hospital: patients, appointments, visits, lab, pharmacy, wards and billing.
/// The screens are described by data/hospital.json (shared by every desktop app); this file is the engine that draws them.</summary>
internal static class HosEngine
{
    public static readonly JsonArray Sections = (JsonNode.Parse(Loc.ReadData("hospital.json")) as JsonObject)?["sections"] as JsonArray ?? new JsonArray();

    public static string Today => DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static string L(JsonObject o)
    {
        var s = o[Loc.Rtl ? "ar" : "en"]?.ToString();
        return string.IsNullOrEmpty(s) ? o["en"]?.ToString() ?? "" : s;
    }

    public static JsonNode? GetP(JsonNode? o, string path)
    {
        foreach (var part in path.Split('.'))
        {
            if (o is JsonObject jo) o = jo[part]; else return null;
        }
        return o;
    }

    public static void SetP(JsonObject o, string path, JsonNode? v)
    {
        var parts = path.Split('.');
        for (var i = 0; i < parts.Length - 1; i++)
        {
            if (o[parts[i]] is not JsonObject c) { c = new JsonObject(); o[parts[i]] = c; }
            o = c;
        }
        o[parts[^1]] = v;
    }

    /// <summary>text of any JSON value ("" for null, objects and arrays)</summary>
    public static string V(JsonNode? n)
    {
        if (n is not JsonValue jv) return "";
        if (jv.TryGetValue<string>(out var s)) return s;
        if (jv.TryGetValue<bool>(out var b)) return b ? "true" : "false";
        if (jv.TryGetValue<long>(out var l)) return l.ToString(CultureInfo.InvariantCulture);
        if (jv.TryGetValue<int>(out var i)) return i.ToString(CultureInfo.InvariantCulture);
        if (jv.TryGetValue<double>(out var d)) return d == Math.Floor(d) ? ((long)d).ToString(CultureInfo.InvariantCulture) : d.ToString(CultureInfo.InvariantCulture);
        if (jv.TryGetValue<decimal>(out var m)) return m.ToString(CultureInfo.InvariantCulture);
        return n.ToString();
    }

    public static double D(JsonNode? n) => double.TryParse(V(n), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;

    public static JsonNode? Templ(JsonNode? v, JsonObject row)
    {
        if (v is not JsonValue jv || !jv.TryGetValue<string>(out var s)) return v?.DeepClone();
        if (s == "$today") return Today;
        if (s.StartsWith('@')) return row["status"]?.ToString() == s[1..];
        if (s.StartsWith('{') && s.EndsWith('}') && s.IndexOf('{', 1) < 0) return GetP(row, s[1..^1])?.DeepClone();
        foreach (var k in new[] { "id", "code", "parent", "ref" }) s = s.Replace("{" + k + "}", V(row[k]));
        return s;
    }

    public static string Cell(JsonObject rec, JsonObject col)
    {
        var p = col["p"]?.ToString() ?? ""; var ty = col["t"]?.ToString();
        var v = GetP(rec, p);
        if (v == null) return "";
        if (ty == "items" && v is JsonArray items)
            return string.Join("; ", items.OfType<JsonObject>().Select(i => string.Join(" ", new[] { V(i["name"]), V(i["strength"]), V(i["dose"]), V(i["frequency"]) }.Where(x => x.Length > 0)) + " " + (V(i["dispensed"]) is { Length: > 0 } dd ? dd : "0") + "/" + V(i["qty"])));
        if (ty == "money") return D(v).ToString("N2", CultureInfo.InvariantCulture);
        if (v is JsonArray arr) return string.Join(", ", arr.Select(V));
        var str = V(v);
        return p is "createdAt" or "data.start" ? str[..Math.Min(16, str.Length)].Replace('T', ' ') : str;
    }

    /// <summary>A printable page for one hospital invoice (items, tax, insurance, payments, balance); opened in the browser.</summary>
    public static string InvoiceHtml(JsonObject r)
    {
        var d = r["data"] as JsonObject ?? new JsonObject();
        string E(JsonNode? n) => System.Net.WebUtility.HtmlEncode(SiteEngine.Js(n));
        string M(JsonNode? n) => SiteEngine.Num(n, 0).ToString("N2", CultureInfo.InvariantCulture);
        var rows = new System.Text.StringBuilder(); var o = new System.Text.StringBuilder();
        foreach (var l in (d["lines"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()) rows.Append("<tr><td>" + E(l["desc"]) + "</td><td class=\"n\">" + E(l["qty"]) + "</td><td class=\"n\">" + M(l["price"]) + "</td><td class=\"n\">" + M(l["amount"]) + "</td></tr>");
        void Tot(string label, string v, bool b = false) => o.Append("<tr><td colspan=\"3\" class=\"n\">" + (b ? "<b>" + label + "</b>" : label) + "</td><td class=\"n\">" + (b ? "<b>" + v + "</b>" : v) + "</td></tr>");
        if (SiteEngine.Num(d["tax"], 0) != 0) { Tot(Loc.T("hos.pr.subtotal"), M(d["gross"])); Tot((SiteEngine.Js(d["taxName"]).Length == 0 ? "VAT" : E(d["taxName"])) + " (" + E(d["taxPct"]) + "%)", M(d["tax"])); }
        Tot(Loc.T("hos.pr.total"), M(d["total"] ?? d["gross"]), true);
        if (SiteEngine.Num(d["insurance"], 0) != 0) Tot(E(d["insuranceName"]) + " (" + E(d["insurancePct"]) + "%)", "- " + M(d["insurance"]));
        Tot(Loc.T("hos.pr.due"), M(d["due"]), true);
        foreach (var p in (d["payments"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()) { var at = SiteEngine.Js(p["at"]); Tot(System.Net.WebUtility.HtmlEncode(at.Length > 10 ? at.Substring(0, 10) : at) + " - " + E(p["method"]) + " - " + E(p["by"]), "- " + M(p["amount"])); }
        Tot(Loc.T("hos.pr.balance"), M(d["balance"]), true);
        return "<!doctype html><meta charset=\"utf-8\"><title>" + E(r["code"]) + "</title><style>body{font:14px system-ui;margin:40px;color:#111}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}.n{text-align:end}</style><h1>" + E(r["code"]) + "</h1><p>" + E(d["patientName"])
            + "</p><table><tr><th>" + Loc.T("hos.pr.item") + "</th><th class=\"n\">" + Loc.T("hos.pr.qty") + "</th><th class=\"n\">" + Loc.T("hos.pr.price") + "</th><th class=\"n\">" + Loc.T("hos.pr.amount") + "</th></tr>" + rows + o + "</table><script>window.onload=function(){window.print()}</script>";
    }
    public static void OpenInvoice(JsonObject r)
    {
        var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "invoice-" + SiteEngine.Js(r["code"]) + ".html");
        System.IO.File.WriteAllText(path, InvoiceHtml(r), new System.Text.UTF8Encoding(false)); CalEngine.OpenUrl(new Uri(path).AbsoluteUri);
    }

    public static List<string> Flatten(JsonNode? o, int ind = 0)
    {
        var pad = new string(' ', ind * 2); var outl = new List<string>();
        if (o is JsonObject jo)
        {
            foreach (var kv in jo)
            {
                var v = kv.Value;
                var nested = (v is JsonObject vo && vo.Count > 0) || (v is JsonArray va && va.Count > 0);
                if (nested) { outl.Add(pad + kv.Key + ":"); outl.AddRange(Flatten(v, ind + 1)); }
                else if (v is JsonValue && V(v).Length > 0) outl.Add(pad + kv.Key + ": " + V(v));
            }
        }
        else if (o is JsonArray ja)
        {
            foreach (var i in ja)
            {
                if (i is JsonObject or JsonArray) { outl.Add(pad + "-"); outl.AddRange(Flatten(i, ind + 1)); }
                else outl.Add(pad + "- " + V(i));
            }
        }
        else if (o != null) outl.Add(pad + V(o));
        return outl;
    }

    public static string DxText(JsonNode? a) => string.Join("\n", (a as JsonArray ?? new JsonArray()).OfType<JsonObject>().Select(d => V(d["code"]).Length == 0 ? V(d["name"]) : V(d["code"]) + " | " + V(d["name"])));

    public static JsonArray DxList(string txt)
    {
        var res = new JsonArray();
        foreach (var raw in (txt ?? "").Split('\n'))
        {
            var ln = raw.Trim();
            if (ln.Length == 0) continue;
            var i = ln.IndexOf('|');
            res.Add(i >= 0 ? new JsonObject { ["code"] = ln[..i].Trim(), ["name"] = ln[(i + 1)..].Trim() } : new JsonObject { ["code"] = "", ["name"] = ln });
        }
        return res;
    }

    /// <summary>the request body one action describes; vals: field key -> string / bool / selected value</summary>
    public static JsonObject BuildBody(JsonObject act, Dictionary<string, object?> vals, JsonObject row, bool keepEmpty = false)
    {
        var body = new JsonObject();
        var joins = new Dictionary<string, List<string>>();
        foreach (var f in (act["fields"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
        {
            var k = f["k"]!.ToString(); var ty = f["t"]?.ToString() ?? "text";
            vals.TryGetValue(k, out var raw);
            var rs = raw is bool ? "" : raw?.ToString() ?? "";
            JsonNode? v = null;
            if (ty == "num") { if (double.TryParse(rs.Trim().Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) v = d == Math.Floor(d) ? JsonValue.Create((long)d) : JsonValue.Create(d); }
            else if (ty == "check") v = JsonValue.Create(raw is true);
            else if (ty == "dx") { var a = DxList(rs); if (a.Count > 0 || keepEmpty) v = a; }
            else { var s = rs.Trim(); if (s.Length > 0 || keepEmpty) v = JsonValue.Create(s); }
            if (f["join"] != null) { var j = f["join"]!.ToString(); if (!joins.ContainsKey(j)) joins[j] = new(); joins[j].Add(rs.Trim()); }
            else if (v == null) continue;
            else if (k.EndsWith("[]")) { var b = k[..^2]; if (body[b] is not JsonArray a) { a = new JsonArray(); body[b] = a; } a.Add(v); }
            else if (k.Contains("[]."))
            {
                var idx = k.IndexOf("[].", StringComparison.Ordinal); var b = k[..idx]; var sub = k[(idx + 3)..];
                if (body[b] is not JsonArray a) { a = new JsonArray { new JsonObject() }; body[b] = a; }
                ((JsonObject)a[0]!)[sub] = v;
            }
            else SetP(body, k, v);
        }
        foreach (var j in joins) body[j.Key] = string.Join("T", j.Value.Where(p => p.Length > 0));
        foreach (var kv in (act["body"] as JsonObject ?? new JsonObject())) body[kv.Key] = Templ(kv.Value, row);
        return body;
    }

    public sealed class Outcome
    {
        public JsonNode? Result; public string Message = ""; public List<string> Warnings = new();
        public bool Ok => Message.Length == 0;
    }

    /// <summary>runs one action; a 409 with warnings (allergy, interaction) comes back as Warnings so the caller can ask for a reason</summary>
    public static async Task<Outcome> Run(JsonObject sec, JsonObject act, JsonObject row, Dictionary<string, object?> vals, JsonObject? extra = null)
    {
        var o = new Outcome();
        try
        {
            var kind = sec["kind"]!.ToString(); var id = V(row["id"]);
            if (act["get"] != null) o.Result = await Api.I.Hos(HttpMethod.Get, V(Templ(act["get"], row)));
            else if (act["toggle"] != null)
            {
                var st = V(row["status"]) == act["toggle"]!.ToString() ? act["back"]!.ToString() : act["toggle"]!.ToString();
                o.Result = await Api.I.Hos(HttpMethod.Put, $"records/{kind}/{id}", new JsonObject { ["data"] = row["data"]?.DeepClone(), ["branch"] = row["branch"]?.DeepClone(), ["status"] = st });
            }
            else if (act["record"]?.ToString() == "update")
            {
                var data = row["data"]?.DeepClone() as JsonObject ?? new JsonObject();
                if (BuildBody(act, vals, row, true)["data"] is JsonObject nd) foreach (var kv in nd.ToList()) data[kv.Key] = kv.Value?.DeepClone();
                o.Result = await Api.I.Hos(HttpMethod.Put, $"records/{kind}/{id}", new JsonObject { ["data"] = data, ["status"] = row["status"]?.DeepClone(), ["branch"] = row["branch"]?.DeepClone() });
            }
            else if (act["record"]?.ToString() == "create")
                o.Result = await Api.I.Hos(HttpMethod.Post, $"records/{kind}", new JsonObject { ["data"] = BuildBody(act, vals, new JsonObject(), true)["data"]?.DeepClone() ?? new JsonObject() });
            else
            {
                var body = BuildBody(act, vals, row);
                if (extra != null) foreach (var kv in extra) body[kv.Key] = kv.Value?.DeepClone();
                var put = act["put"] != null;
                o.Result = await Api.I.Hos(put ? HttpMethod.Put : HttpMethod.Post, V(Templ(put ? act["put"] : act["post"], row)), body);
            }
        }
        catch (ApiException e)
        {
            o.Message = string.IsNullOrEmpty(e.Message) ? "error" : e.Message;
            if (e.Status == 409 && e.Body?["warnings"] is JsonArray w) o.Warnings.AddRange(w.Select(V));
        }
        return o;
    }

    public static async Task<JsonArray> Fetch(string kind, int take, IDictionary<string, string> q)
    {
        var path = $"records/{kind}?take={take}" + string.Concat(q.Where(kv => !string.IsNullOrEmpty(kv.Value)).Select(kv => "&" + kv.Key + "=" + Uri.EscapeDataString(kv.Value)));
        return await Api.I.Hos(HttpMethod.Get, path) as JsonArray ?? new JsonArray();
    }

    public sealed record Opt(string V, string Label) { public override string ToString() => Label; }

    public static List<Opt> OptionsOf(JsonObject f, JsonArray? recs)
    {
        var res = new List<Opt>();
        if (f["opts"] is JsonArray ops) { foreach (var o in ops) res.Add(new Opt(V(o), V(o))); return res; }
        var s = f["src"] as JsonObject ?? new JsonObject();
        res.Add(new Opt("", ""));
        foreach (var r in (recs ?? new JsonArray()).OfType<JsonObject>())
        {
            if (V(r["status"]) == "Inactive") continue;
            res.Add(new Opt(V(GetP(r, s["v"]?.ToString() ?? "code")), V(GetP(r, s["l"]?.ToString() ?? "data.name")) + " · " + V(r["code"])));
        }
        return res;
    }

    /// <summary>modal form; returns the values, or null when cancelled</summary>
    public static Dictionary<string, object?>? Form(string title, JsonArray fields, JsonObject row, Dictionary<string, JsonArray> recs)
    {
        Dictionary<string, object?>? result = null;
        var w = Ui.Dialog(title, 480, Math.Min(760, 150 + fields.Count * 62), out var body);
        var inputs = new Dictionary<string, FrameworkElement>();
        var err = Ui.Text("", 12, false, Ui.Danger);
        foreach (var f in fields.OfType<JsonObject>())
        {
            var ty = f["t"]?.ToString() ?? "text"; var k = f["k"]!.ToString();
            var d = f["from"] != null ? GetP(row, f["from"]!.ToString()) : null;
            if (d == null && f["def"] != null) d = Templ(f["def"], row);
            FrameworkElement c;
            if (ty == "select")
            {
                var cb = new ComboBox { Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8) };
                var opts = OptionsOf(f, recs.GetValueOrDefault(k));
                foreach (var o in opts) cb.Items.Add(o);
                cb.SelectedItem = opts.FirstOrDefault(o => d != null && o.V == V(d)) ?? opts.FirstOrDefault();
                c = cb;
            }
            else if (ty == "check") c = new CheckBox { IsChecked = d is JsonValue && V(d) == "true", Margin = new Thickness(0, 0, 0, 8) };
            else if (ty is "area" or "dx") c = new TextBox { Text = ty == "dx" ? DxText(d) : V(d), AcceptsReturn = true, Height = 64, TextWrapping = TextWrapping.Wrap, Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8) };
            else c = Ui.Input(V(d));
            inputs[k] = c;
            body.Children.Add(Ui.Labeled(L(f) + (f["req"]?.GetValue<bool>() == true ? " *" : ""), c));
        }
        body.Children.Add(err);
        Dictionary<string, object?> Values() => fields.OfType<JsonObject>().ToDictionary(f => f["k"]!.ToString(), f =>
        {
            var c = inputs[f["k"]!.ToString()];
            return c switch { ComboBox cb => (object?)((cb.SelectedItem as Opt)?.V ?? ""), CheckBox ck => ck.IsChecked == true, TextBox tb => tb.Text, _ => null };
        });
        body.Children.Add(Ui.Row(
            Ui.Btn(Loc.T("hos.ui.run"), () =>
            {
                var v = Values();
                foreach (var f in fields.OfType<JsonObject>())
                    if (f["req"]?.GetValue<bool>() == true && (v[f["k"]!.ToString()] is null or "" or false)) { err.Text = L(f) + " *"; return; }
                result = v; w.Close();
            }),
            Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog();
        return result;
    }

    /// <summary>one-line text prompt (the reason for overriding a safety warning)</summary>
    public static string? AskText(string title, string message)
    {
        string? result = null;
        var w = Ui.Dialog(title, 460, 330, out var body);
        var tb = Ui.Input();
        body.Children.Add(Ui.Text(message, 13));
        body.Children.Add(tb);
        body.Children.Add(Ui.Row(Ui.Btn(Loc.T("hos.ui.run"), () => { result = tb.Text.Trim(); w.Close(); }), Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog();
        return string.IsNullOrEmpty(result) ? null : result;
    }
}

/// <summary>one section: a table with the actions of the spec</summary>
internal sealed class HosSection : StackPanel
{
    private readonly JsonObject _sec;
    private readonly TextBox _q = Ui.Input(), _day = Ui.Input(HosEngine.Today);
    private readonly ComboBox _status = new() { Margin = new Thickness(0, 0, 8, 8), Padding = new Thickness(6), MinWidth = 120 };
    private readonly DataGrid _grid;
    private readonly Dictionary<string, Button> _btns = new();
    private readonly TextBox _detail = new() { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, Height = 150, Visibility = Visibility.Collapsed, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Margin = new Thickness(0, 8, 0, 0) };
    private readonly TextBlock _err = Ui.Text("", 12, false, Ui.Danger);
    public JsonArray Rows { get; private set; } = new();

    public HosSection(JsonObject sec)
    {
        _sec = sec;
        var bar = new StackPanel { Orientation = Orientation.Horizontal };
        _q.Width = 200; _q.Visibility = sec["search"]?.GetValue<bool>() == true ? Visibility.Visible : Visibility.Collapsed;
        _q.KeyDown += async (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) await Reload(); };
        _day.Width = 110; _day.Visibility = sec["day"]?.GetValue<bool>() == true ? Visibility.Visible : Visibility.Collapsed;
        _day.KeyDown += async (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) await Reload(); };
        foreach (var s in (sec["status"] as JsonArray ?? new JsonArray())) _status.Items.Add(new HosEngine.Opt(s!.ToString(), s.ToString().Length == 0 ? Loc.T("hos.ui.all") : s.ToString()));
        if (_status.Items.Count > 0) _status.SelectedIndex = 0; else _status.Visibility = Visibility.Collapsed;
        _status.SelectionChanged += async (_, _) => await Reload();
        bar.Children.Add(_q); bar.Children.Add(_day); bar.Children.Add(_status);
        bar.Children.Add(Ui.Btn(Loc.T("common.refresh"), async () => await Reload(), "ghost"));
        if (sec["create"] is JsonObject cr) bar.Children.Add(Ui.Btn(HosEngine.L(cr), async () => await Act(cr, true)));
        Children.Add(bar); Children.Add(_err);
        _grid = Ui.Grid((sec["columns"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Select(HosEngine.L).ToArray());
        _grid.Height = 360; _grid.SelectionChanged += (_, _) => SelChanged();
        Children.Add(_grid);
        var ab = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
        foreach (var a in (sec["actions"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
        {
            var act = a; var b = Ui.Btn(HosEngine.L(act), async () => await Act(act, false), "ghost");
            _btns[act["id"]!.ToString()] = b; ab.Children.Add(b);
        }
        Children.Add(ab); Children.Add(_detail);
        SelChanged();
    }

    public async Task Reload()
    {
        _err.Text = "";
        try
        {
            var q = new Dictionary<string, string>();
            if (_q.Visibility == Visibility.Visible) q["q"] = _q.Text.Trim();
            if (_day.Visibility == Visibility.Visible) q["ref"] = _day.Text.Trim();
            if (_status.Visibility == Visibility.Visible && _status.SelectedItem is HosEngine.Opt o) q["status"] = o.V;
            Rows = await HosEngine.Fetch(_sec["kind"]!.ToString(), _sec["take"]?.GetValue<int>() ?? 200, q);
            var cols = (_sec["columns"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToList();
            Ui.Fill(_grid, Rows.OfType<JsonObject>().Select(r => (cols.Select(c => HosEngine.Cell(r, c)).ToArray(), (object)r)));
            SelChanged();
        }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private JsonObject? Cur => Ui.Selected<JsonObject>(_grid);

    private void SelChanged()
    {
        var r = Cur;
        foreach (var a in (_sec["actions"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
        {
            var ok = r != null;
            if (ok && a["when"] is JsonArray w) ok = w.Any(x => x!.ToString() == HosEngine.V(r!["status"]));
            _btns[a["id"]!.ToString()].IsEnabled = ok;
        }
    }

    private async Task Act(JsonObject a, bool creating)
    {
        var row = creating ? new JsonObject() : Cur;
        if (row == null) return;
        if (a["confirm"]?.GetValue<bool>() == true && !Ui.Ask(Loc.T("hos.ui.confirm"), Loc.T("common.yes"), Loc.T("common.no"))) return;
        var fields = a["fields"] as JsonArray ?? new JsonArray();
        if (fields.Count == 0) { await Perform(a, row, new(), null); return; }
        try
        {
            var recs = new Dictionary<string, JsonArray>();
            foreach (var f in fields.OfType<JsonObject>())
            {
                if (f["t"]?.ToString() != "select" || f["src"] is not JsonObject s) continue;
                var pq = (s["params"] as JsonObject ?? new JsonObject()).ToDictionary(kv => kv.Key, kv => HosEngine.V(kv.Value));
                recs[f["k"]!.ToString()] = await HosEngine.Fetch(s["kind"]!.ToString(), s["take"]?.GetValue<int>() ?? 200, pq);
            }
            var vals = HosEngine.Form(HosEngine.L(a), fields, row, recs);
            if (vals != null) await Perform(a, row, vals, null);
        }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async Task Perform(JsonObject a, JsonObject row, Dictionary<string, object?> vals, JsonObject? extra)
    {
        _err.Text = "";
        var o = await HosEngine.Run(_sec, a, row, vals, extra);
        if (!o.Ok)
        {
            if (a["warn"] != null && o.Warnings.Count > 0)
            {
                var reason = HosEngine.AskText(Loc.T("hos.ui.warnings"), o.Message + "\n\n• " + string.Join("\n• ", o.Warnings) + "\n\n" + Loc.T("hos.ui.override"));
                if (reason != null) await Perform(a, row, vals, new JsonObject { ["overrideReason"] = reason });
                return;
            }
            _err.Text = o.Message; return;
        }
        if (a["print"] != null) { if (o.Result is JsonObject ro) HosEngine.OpenInvoice(ro); _err.Text = Loc.T("hos.pr.saved"); }
        else if (a["show"] != null) { _detail.Text = string.Join("\n", HosEngine.Flatten(o.Result)); _detail.Visibility = Visibility.Visible; }
        else { _detail.Visibility = Visibility.Collapsed; await Reload(); }
    }
}

internal sealed class HosDashboard : StackPanel
{
    private readonly TextBlock _err = Ui.Text("", 12, false, Ui.Danger);
    private readonly TextBlock _body = Ui.Text("", 15);

    public HosDashboard()
    {
        Children.Add(_err); Children.Add(_body);
        Children.Add(Ui.Btn(Loc.T("common.refresh"), async () => await Reload(), "ghost"));
    }

    public async Task Reload()
    {
        try
        {
            var d = await Api.I.Hos(HttpMethod.Get, $"dashboard?today={HosEngine.Today}&tz=0") as JsonObject ?? new JsonObject();
            var ap = d["appointmentsToday"] as JsonObject ?? new JsonObject(); var bd = d["beds"] as JsonObject ?? new JsonObject();
            string N(JsonNode? x) => HosEngine.V(x);
            string M(JsonNode? x) => HosEngine.D(x).ToString("N2", CultureInfo.InvariantCulture);
            var lines = new List<string>
            {
                $"{Loc.T("hos.ui.patients")}: {N(d["patients"])}", $"{Loc.T("hos.ui.openVisits")}: {N(d["openVisits"])}", $"{Loc.T("hos.ui.admitted")}: {N(d["admitted"])}",
                $"{Loc.T("hos.ui.labs")}: {N(d["pendingLabs"])}", $"{Loc.T("hos.ui.rx")}: {N(d["pendingRx"])}",
                $"{Loc.T("hos.ui.appts")}: {N(ap["total"])} ({N(ap["booked"])}/{N(ap["checkedIn"])}/{N(ap["completed"])}/{N(ap["cancelled"])})",
                $"{Loc.T("hos.ui.beds")}: {N(bd["occupied"])}/{N(bd["total"])} · {N(bd["occupancyPct"])}%",
                $"{Loc.T("hos.ui.revenue")}: {M(d["revenueToday"])}", $"{Loc.T("hos.ui.outstanding")}: {M(d["outstanding"])}"
            };
            if (d["lowStock"] is JsonArray low && low.Count > 0)
            {
                lines.Add(""); lines.Add(Loc.T("hos.ui.lowstock"));
                lines.AddRange(low.OfType<JsonObject>().Select(x => $"  {N(x["name"])} — {N(x["stock"])} / {N(x["reorder"])}"));
            }
            _body.Text = string.Join("\n", lines); _err.Text = "";
        }
        catch (Exception e) { _err.Text = e.Message; }
    }
}

public sealed class HospitalView : PageView
{
    private readonly TabControl _tabs = new() { Margin = new Thickness(0, 8, 0, 0) };
    private readonly List<FrameworkElement> _views = new();

    public HospitalView()
    {
        Root.Children.Add(Ui.Text(Loc.T("tab.hos"), 20, true));
        foreach (var s in HosEngine.Sections.OfType<JsonObject>())
        {
            if (!(s["perm"] as JsonArray ?? new JsonArray()).Any(p => Api.I.Can(p!.ToString()))) continue;
            FrameworkElement v = s["type"]?.ToString() == "dashboard" ? new HosDashboard() : new HosSection(s);
            _views.Add(v);
            _tabs.Items.Add(new TabItem { Header = HosEngine.L(s), Content = new Border { Child = v, Padding = new Thickness(0, 10, 0, 0) } });
        }
        _tabs.SelectionChanged += async (_, e) => { if (ReferenceEquals(e.OriginalSource, _tabs)) await Safe(Reload); };
        Root.Children.Add(_tabs);
    }

    public override async Task Reload()
    {
        var i = _tabs.SelectedIndex;
        if (i < 0) return;
        if (_views[i] is HosSection s) await s.Reload();
        else if (_views[i] is HosDashboard d) await d.Reload();
    }
}
