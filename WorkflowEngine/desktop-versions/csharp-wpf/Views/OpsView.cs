using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Operations: material requirements planning, standard cost and work order variance, project billing, the VAT return and the ZATCA seller profile.
/// The reports are described by ops.json (shared by every desktop app); the calculations are a port of erp.calc.ts.</summary>
internal static class OpsEngine
{
    private static JsonNode? _spec;
    public static JsonNode Spec => _spec ??= JsonNode.Parse(Loc.ReadData("ops.json"))!;
    private static int Ix => Loc.Lang == "ar" ? 1 : 0;
    private static JsonArray A(JsonNode? n) => n as JsonArray ?? new JsonArray();
    private static JsonObject O(JsonNode? n) => n as JsonObject ?? new JsonObject();
    public static string S(JsonNode? n) => FinEngine.S(n);
    public static double Num(JsonNode? n) => FinEngine.Num(n);
    public static double R2(double v) => Math.Round(v + 1e-9, 2, MidpointRounding.AwayFromZero);
    public static string Money(double v) => v.ToString("N2", CultureInfo.InvariantCulture);
    public static string L(string key, params object[] a)
    {
        var s = (string)Spec["labels"]![key]![Ix]!;
        for (var i = 0; i < a.Length; i++) s = s.Replace("{" + i + "}", a[i]?.ToString());
        return s;
    }
    public static string Tx(JsonNode? o) => (string?)o?[Loc.Lang == "ar" ? "ar" : "en"] ?? "";
    private static JsonObject D(JsonNode? rec) => O(O(rec)["data"]);

    public static bool Allowed(JsonNode rep) => A(rep["view"]).Any(p => Api.I.Can(S(p)));

    // ------------------------------------------------------------ calculations
    public static double[] BomCost(JsonNode bom, Dictionary<string, JsonNode> items, double rate, double overheadPct)
    {
        var d = D(bom);
        var qty = Num(d["qty"]); var outQ = Math.Max(0.0001, qty != 0 ? qty : 1);
        double mat = 0;
        foreach (var l in A(d["lines"]))
            mat += Num(l!["qty"]) * (1 + Num(l["scrapPct"]) / 100) * (items.TryGetValue(S(l["sku"]), out var it) ? Num(it["cost"]) : 0);
        var material = R2(mat); var labor = R2(Num(d["routingMinutes"]) / 60 * rate); var overhead = R2(labor * overheadPct / 100); var total = R2(material + labor + overhead);
        return new[] { material, labor, overhead, total, R2(total / outQ) };
    }

    public sealed class MrpRow { public string Sku = "", Name = "", Action = "ok", Due = ""; public double Gross, OnHand, Scheduled, Net; public int Level; }

    public static List<MrpRow> Mrp(List<(string sku, double qty, string due)> demands, JsonArray boms, Dictionary<string, double> onHand, Dictionary<string, double> scheduled, Dictionary<string, JsonNode> items)
    {
        var bomBy = new Dictionary<string, JsonNode>();
        foreach (var b in boms) if (S(b!["status"]) != "Inactive") bomBy[S(b["code"])] = b;
        var free = new Dictionary<string, double>(onHand); var sched = new Dictionary<string, double>(scheduled);
        var rows = new Dictionary<string, MrpRow>(); var order = new List<string>();
        double G(Dictionary<string, double> m, string k) => m.TryGetValue(k, out var v) ? v : 0;
        void Need(string sku, double qty, int level, string due)
        {
            if (qty <= 0 || level > 12) return;
            if (!rows.TryGetValue(sku, out var row))
            {
                row = new MrpRow { Sku = sku, Name = items.TryGetValue(sku, out var it) ? S(it["name"]) : "", OnHand = Math.Max(0, G(onHand, sku)), Scheduled = Math.Max(0, G(scheduled, sku)), Level = level, Due = due };
                rows[sku] = row; order.Add(sku);
            }
            row.Gross = R2(row.Gross + qty); row.Level = Math.Max(row.Level, level);
            var fromStock = Math.Min(Math.Max(0, G(free, sku)), qty); free[sku] = G(free, sku) - fromStock;
            var left = qty - fromStock;
            var fromOrders = Math.Min(Math.Max(0, G(sched, sku)), left); sched[sku] = G(sched, sku) - fromOrders;
            left = R2(left - fromOrders);
            if (left <= 0) return;
            row.Net = R2(row.Net + left);
            var has = bomBy.TryGetValue(sku, out var bom);
            row.Action = has ? "make" : "buy";
            if (has)
            {
                var d = D(bom); var q = Num(d["qty"]); var outQ = Math.Max(0.0001, q != 0 ? q : 1);
                foreach (var l in A(d["lines"])) Need(S(l!["sku"]), R2(left / outQ * Num(l["qty"]) * (1 + Num(l["scrapPct"]) / 100)), level + 1, due);
            }
        }
        foreach (var (sku, qty, due) in demands) Need(sku, qty, 0, due);
        return order.Select(k => rows[k]).OrderBy(r => r.Level).ThenBy(r => r.Sku, StringComparer.Ordinal).ToList();
    }

    public static (double ready, double billed) ProjectReady(JsonNode p, JsonArray ts, JsonArray cs, JsonArray ms)
    {
        var code = S(p["code"]); var d = D(p); double ready = 0;
        bool Flag(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var b) && b;
        if (S(d["billingModel"]) == "tm")
        {
            foreach (var t in ts) if (S(t!["ref"]) == code && S(t["status"]) == "Approved" && Flag(D(t)["billable"])) ready += Num(D(t)["hours"]) * Num(D(t)["rate"]);
            foreach (var c in cs) if (S(c!["ref"]) == code && S(c["status"]) == "Open" && Flag(D(c)["billable"])) ready += Num(D(c)["amount"]) * (1 + Num(D(c)["markupPct"]) / 100);
        }
        else foreach (var m in ms) if (S(m!["ref"]) == code && S(m["status"]) == "Achieved") ready += Num(D(m)["amount"]);
        return (R2(ready), R2(Num(d["billed"])));
    }

    public static Dictionary<string, double> Sched(JsonArray orders)
    {
        var m = new Dictionary<string, double>();
        foreach (var o in orders)
        {
            var s = S(o!["status"]);
            if (s is "Planned" or "Released" or "InProgress") { var k = S(D(o)["sku"]); m[k] = (m.TryGetValue(k, out var v) ? v : 0) + Num(D(o)["qty"]); }
        }
        return m;
    }

    // ------------------------------------------------------------ loading
    private static async Task<JsonArray> Records(string module, string kind)
    {
        try { return (await Api.I.Ops(HttpMethod.Get, $"/erp/{module}/records/{kind}?take=5000")) as JsonArray ?? new JsonArray(); } catch { return new JsonArray(); }
    }

    public static async Task<Dictionary<string, JsonNode?>> Fetch(string id, string from, string to)
    {
        var d = new Dictionary<string, JsonNode?>();
        if (id is "mrp" or "cost" or "variance")
        {
            d["bom"] = await Records("mfg", "bom");
            d["items"] = await Api.I.Ops(HttpMethod.Get, "/erp/mfg/items");
        }
        if (id == "mrp")
        {
            d["orders"] = await Records("mfg", "workorder");
            try { d["stock"] = await Api.I.Ops(HttpMethod.Get, "/erp/mfg/stock"); } catch { d["stock"] = new JsonArray(); }
        }
        if (id == "cost") { d["wc"] = await Records("mfg", "workcenter"); d["setting"] = await Records("mfg", "setting"); }
        if (id == "variance") d["orders"] = await Records("mfg", "workorder");
        if (id == "projbill") { d["p"] = await Records("prj", "project"); d["t"] = await Records("prj", "timesheet"); d["c"] = await Records("prj", "cost"); d["m"] = await Records("prj", "milestone"); }
        if (id == "vat") d["vat"] = await Api.I.Ops(HttpMethod.Get, $"/finance/zatca/vat-return?from={from}&to={to}");
        if (id == "zatca") d["profile"] = await Api.I.Ops(HttpMethod.Get, "/finance/zatca/profile");
        return d;
    }

    public static Dictionary<string, JsonNode> ItemMap(Dictionary<string, JsonNode?> d)
    {
        var m = new Dictionary<string, JsonNode>();
        foreach (var i in A(d.GetValueOrDefault("items"))) m[S(i!["sku"])] = i!;
        return m;
    }
    public static Dictionary<string, double> StockMap(Dictionary<string, JsonNode?> d)
    {
        var m = new Dictionary<string, double>();
        foreach (var s in A(d.GetValueOrDefault("stock"))) m[S(s!["sku"])] = Num(s["qty"]);
        return m;
    }

    public static (List<string[]> rows, List<object?> pay, string foot, List<MrpRow>? plan) Build(string id, Dictionary<string, JsonNode?> d, List<(string sku, double qty, string due)> demand, bool useStock)
    {
        var rows = new List<string[]>(); var pay = new List<object?>(); var foot = ""; List<MrpRow>? plan = null;
        switch (id)
        {
            case "mrp":
                plan = Mrp(demand, A(d["bom"]), useStock ? StockMap(d) : new(), useStock ? Sched(A(d["orders"])) : new(), ItemMap(d));
                foreach (var r in plan) { rows.Add(new[] { new string(' ', r.Level * 4) + r.Sku + (r.Name.Length > 0 ? "  " + r.Name : ""), Money(r.Gross), Money(r.OnHand), Money(r.Scheduled), Money(r.Net), L(r.Action) }); pay.Add(r); }
                break;
            case "cost":
            {
                var rates = new Dictionary<string, double>();
                foreach (var w in A(d["wc"])) rates[S(w!["code"])] = Num(D(w)["costPerHour"]);
                var pct = Num(Spec["defaultOverheadPct"]);
                foreach (var s in A(d["setting"])) { var v = D(s)["overheadPct"]; if (S(s!["code"]) == "defaults" && v != null && S(v).Length > 0) pct = Num(v); }
                var items = ItemMap(d);
                foreach (var b in A(d["bom"]))
                {
                    var c = BomCost(b!, items, rates.TryGetValue(S(D(b)["workCenter"]), out var rt) ? rt : 0, pct);
                    rows.Add(new[] { S(b!["code"]) + "  " + S(D(b)["name"]), Money(c[0]), Money(c[1]), Money(c[2]), Money(c[3]), Money(c[4]) }); pay.Add(b);
                }
                foot = L("overheadPct") + ": " + pct.ToString(CultureInfo.InvariantCulture) + "%";
                break;
            }
            case "variance":
                foreach (var o in A(d["orders"]))
                {
                    if (S(o!["status"]) != "Completed") continue;
                    var x = D(o);
                    rows.Add(new[] { S(o["code"]), S(x["sku"]), Money(Num(x["goodQty"])), Money(Num(x["materialCost"])), Money(Num(x["laborCost"])), Money(Num(x["overheadCost"])), Money(Num(x["actualCost"])), Money(Num(x["standardCost"])), Money(Num(x["variance"])) }); pay.Add(o);
                }
                break;
            case "projbill":
                foreach (var p in A(d["p"]))
                {
                    var (ready, billed) = ProjectReady(p!, A(d["t"]), A(d["c"]), A(d["m"]));
                    var x = D(p); var model = S(x["billingModel"]).Length == 0 ? "tm" : S(x["billingModel"]);
                    rows.Add(new[] { S(p!["code"]) + "  " + S(x["name"]), S(x["customer"]).Length == 0 ? "-" : S(x["customer"]), L("bm." + model), Money(ready), Money(billed) });
                    pay.Add(new JsonObject { ["id"] = p["id"]?.DeepClone(), ["code"] = p["code"]?.DeepClone(), ["customer"] = S(x["customer"]), ["ready"] = ready });
                }
                break;
            case "vat":
            {
                var v = O(d["vat"]);
                foreach (var side in new[] { "sales", "purchases" }) foreach (var b in A(v[side])) { rows.Add(new[] { L(side), S(b!["category"]), ((long)Num(b["count"])).ToString(), Money(Num(b["net"])), Money(Num(b["vat"])) }); pay.Add(null); }
                foreach (var (side, key) in new[] { ("sales", "salesByCode"), ("purchases", "purchasesByCode") }) foreach (var b in A(v[key])) { rows.Add(new[] { L(side) + " · " + L("byCode"), S(b!["code"]), ((long)Num(b["count"])).ToString(), Money(Num(b["net"])), Money(Num(b["vat"])) }); pay.Add(null); }
                rows.Add(new[] { L("total") + " · " + L("sales"), "", ((long)Num(v["salesInvoices"])).ToString(), Money(Num(v["salesNet"])), Money(Num(v["outputVat"])) }); pay.Add(null);
                rows.Add(new[] { L("total") + " · " + L("purchases"), "", ((long)Num(v["purchaseInvoices"])).ToString(), Money(Num(v["purchasesNet"])), Money(Num(v["inputVat"])) }); pay.Add(null);
                var nd = Num(v["netVatDue"]);
                foot = $"{L("out")}: {Money(Num(v["outputVat"]))}   {L("in")}: {Money(Num(v["inputVat"]))}   {(nd >= 0 ? L("netDue") : L("netRefund"))}: {Money(Math.Abs(nd))} / {L("einv")} {(long)Num(v["einvoiced"])}/{(long)Num(v["salesInvoices"])}";
                if (Num(v["notEinvoiced"]) > 0) foot += "\n" + L("notEinv", (long)Num(v["notEinvoiced"]));
                var miss = A(O(v["warnings"])["missingTaxCode"]).Count;
                if (miss > 0) foot += "\n" + L("missingCode", miss);
                break;
            }
        }
        return (rows, pay, foot, plan);
    }
}

public sealed class OpsView : PageView
{
    private readonly List<JsonNode> _reports = new();
    private readonly ComboBox _pick = new() { MinWidth = 240, Margin = new Thickness(0, 0, 8, 0) };
    private readonly TextBox _from = Ui.Input(DateTime.Today.ToString("yyyy-MM-01", CultureInfo.InvariantCulture)), _to = Ui.Input(DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    private readonly ComboBox _sku = new() { MinWidth = 220, Margin = new Thickness(0, 0, 6, 8) };
    private readonly TextBox _qty = Ui.Input("1"), _due = Ui.Input(DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    private readonly CheckBox _stock = new() { Content = OpsEngine.L("useStock"), IsChecked = true, Margin = new Thickness(8, 4, 0, 8) };
    private readonly TextBlock _list = new() { Margin = new Thickness(0, 0, 0, 6), TextWrapping = TextWrapping.Wrap }, _foot = new() { Margin = new Thickness(0, 6, 0, 0) }, _msg = new() { Margin = new Thickness(0, 4, 0, 0) };
    private readonly Button _bWo, _bBuy, _bBill, _bCsv, _bSave;
    private readonly WrapPanel _mrpBox = new();
    private readonly StackPanel _form = new();
    private readonly Dictionary<string, TextBox> _fields = new();
    private readonly Border _gridHost = new() { MinHeight = 340 };
    private DataGrid _grid = Ui.Grid();
    private readonly List<(string sku, double qty, string due)> _demand = new();
    private Dictionary<string, JsonNode?> _data = new();
    private List<OpsEngine.MrpRow> _plan = new();
    private string _current = "", _pending = "";
    private bool _loading;

    public OpsView()
    {
        foreach (var r in (JsonArray)OpsEngine.Spec["reports"]!)
            if (OpsEngine.Allowed(r!)) { _reports.Add(r!); _pick.Items.Add(OpsEngine.Tx(r)); }
        Root.Children.Add(Ui.Text(OpsEngine.L("title"), 20, true));
        _bWo = Ui.Btn("", () => _ = Safe(MakeOrders)); _bBuy = Ui.Btn(OpsEngine.L("exportBuy"), ExportBuy, "ghost");
        _bBill = Ui.Btn(OpsEngine.L("createInvoice"), () => _ = Safe(Bill)); _bCsv = Ui.Btn(OpsEngine.L("csv"), ExportVat, "ghost");
        _bSave = Ui.Btn(OpsEngine.L("save"), () => _ = Safe(SaveProfile));
        var bar = new WrapPanel { Margin = new Thickness(0, 8, 0, 8) };
        foreach (UIElement e in new UIElement[] { _pick, _from, _to, Ui.Btn(OpsEngine.L("refresh"), () => _ = Safe(Reload)), _bWo, _bBuy, _bBill, _bCsv }) bar.Children.Add(e);
        _from.Width = _to.Width = 110; _qty.Width = 80; _due.Width = 110;
        _pick.SelectionChanged += async (_, _) => { if (!_loading) await Safe(Reload); };
        Root.Children.Add(bar);
        foreach (UIElement e in new UIElement[] { _sku, _qty, _due, Ui.Btn(OpsEngine.L("add"), AddDemand), Ui.Btn(OpsEngine.L("remove"), DelDemand, "ghost"), _stock }) _mrpBox.Children.Add(e);
        _stock.Click += (_, _) => RefreshMrp();
        Root.Children.Add(_mrpBox); Root.Children.Add(_list);
        foreach (var z in (JsonArray)OpsEngine.Spec["zatca"]!)
        {
            var tb = Ui.Input(); if (OpsEngine.Num(z!["max"]) > 0) tb.MaxLength = (int)OpsEngine.Num(z["max"]);
            _fields[(string)z["key"]!] = tb;
            _form.Children.Add(Ui.Text(OpsEngine.Tx(z), 12, false)); _form.Children.Add(tb);
        }
        _form.Children.Add(_bSave);
        _gridHost.Child = _grid;
        Root.Children.Add(_gridHost); Root.Children.Add(_form);
        Root.Children.Add(_foot); Root.Children.Add(_msg);
    }


    public override async Task Reload()
    {
        _loading = true;
        if (_pick.SelectedIndex < 0 && _pick.Items.Count > 0) _pick.SelectedIndex = 0;
        _loading = false;
        if (_pick.SelectedIndex < 0 || _pick.SelectedIndex >= _reports.Count) { _msg.Text = OpsEngine.L("noperm"); return; }
        var rep = _reports[_pick.SelectedIndex];
        var id = (string)rep["id"]!; _current = id;
        var vis = (bool b) => b ? Visibility.Visible : Visibility.Collapsed;
        _from.Visibility = _to.Visibility = vis(id == "vat");
        _mrpBox.Visibility = _list.Visibility = vis(id == "mrp");
        _bWo.Visibility = _bBuy.Visibility = Visibility.Collapsed;
        _bBill.Visibility = vis(id == "projbill"); _bCsv.Visibility = vis(id == "vat");
        _form.Visibility = vis(id == "zatca"); _gridHost.Visibility = vis(id != "zatca");
        _grid = Ui.Grid(((JsonArray)rep["cols"]!).Select(c => OpsEngine.Tx(c)).ToArray());
        _gridHost.Child = _grid;
        _msg.Text = "…";
        var data = await OpsEngine.Fetch(id, _from.Text.Trim(), _to.Text.Trim());
        if (id != _current) return;
        _data = data; _msg.Text = "";
        if (id == "zatca")
        {
            var p = data["profile"] as JsonObject ?? new JsonObject();
            foreach (var (k, tb) in _fields) tb.Text = FinEngine.S(p[k]);
            _bSave.Visibility = vis(Api.I.Can("gov.zatca.manage") || Api.I.Can("finance.setup"));
            _foot.Text = OpsEngine.L("profileHint");
            return;
        }
        if (id == "mrp")
        {
            _sku.Items.Clear(); _skus.Clear();
            foreach (var b in (JsonArray)data["bom"]!) { _skus.Add(FinEngine.S(b!["code"])); _sku.Items.Add(FinEngine.S(b["code"]) + " · " + FinEngine.S((b["data"] as JsonObject)?["name"])); }
            if (_sku.Items.Count > 0) _sku.SelectedIndex = 0;
            RefreshMrp();
            return;
        }
        Paint();
    }
    private readonly List<string> _skus = new();

    private void Paint()
    {
        var (rows, pay, foot, plan) = OpsEngine.Build(_current, _data, _demand, _stock.IsChecked == true);
        if (plan != null) _plan = plan;
        Ui.Fill(_grid, rows.Select((r, i) => (r, (object)(pay[i] ?? ""))));
        _foot.Text = foot;
        _msg.Text = _pending.Length > 0 ? _pending : (rows.Count == 0 ? OpsEngine.L("empty") : "");
        _pending = "";
    }

    private void AddDemand()
    {
        var i = _sku.SelectedIndex; var q = double.TryParse(_qty.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var qq) ? qq : 0;
        if (i < 0 || q <= 0) return;
        _demand.Add((_skus[i], q, _due.Text.Trim()));
        RefreshMrp();
    }
    private void DelDemand() { if (_demand.Count > 0) { _demand.RemoveAt(_demand.Count - 1); RefreshMrp(); } }

    private void RefreshMrp()
    {
        if (_current != "mrp" || !_data.ContainsKey("bom")) return;
        _list.Text = _demand.Count == 0 ? OpsEngine.L("mrpHint") : string.Join("  |  ", _demand.Select(d => $"{d.sku} × {d.qty.ToString(CultureInfo.InvariantCulture)} ({d.due})"));
        Paint();
        var make = _plan.Count(r => r.Action == "make"); var buy = _plan.Count(r => r.Action == "buy");
        _bWo.Visibility = make > 0 && Api.I.Can("mfg.orders.manage") ? Visibility.Visible : Visibility.Collapsed;
        _bWo.Content = OpsEngine.L("createWo", make);
        _bBuy.Visibility = buy > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private async Task MakeOrders()
    {
        var boms = new Dictionary<string, JsonNode>();
        foreach (var b in (JsonArray)_data["bom"]!) boms[FinEngine.S(b!["code"])] = b!;
        var due = _demand.Select(d => d.due).FirstOrDefault(x => x.Length > 0) ?? DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var n = 0;
        foreach (var r in _plan.Where(r => r.Action == "make"))
        {
            var bd = boms[r.Sku]["data"] as JsonObject ?? new JsonObject();
            var wd = new JsonObject { ["sku"] = r.Sku, ["qty"] = r.Net, ["due"] = r.Due.Length > 0 ? r.Due : due, ["priority"] = "Normal", ["workCenter"] = FinEngine.S(bd["workCenter"]), ["lines"] = bd["lines"]?.DeepClone(), ["bomQty"] = bd["qty"]?.DeepClone(), ["routingMinutes"] = bd["routingMinutes"]?.DeepClone(), ["source"] = "MRP" };
            await Api.I.Ops(HttpMethod.Post, "/erp/mfg/records/workorder", new JsonObject { ["status"] = "Planned", ["data"] = wd });
            n++;
        }
        _data["orders"] = await Records2("workorder");
        RefreshMrp();
        _msg.Text = OpsEngine.L("created", n);
    }
    private static async Task<JsonNode?> Records2(string kind) { try { return await Api.I.Ops(HttpMethod.Get, $"/erp/mfg/records/{kind}?take=5000"); } catch { return new JsonArray(); } }

    private void ExportBuy()
    {
        var dlg = new Microsoft.Win32.SaveFileDialog { FileName = "purchase-requirements.csv", Filter = "CSV (*.csv)|*.csv" };
        if (dlg.ShowDialog() != true) return;
        var sb = new StringBuilder("sku,name,quantity\n");
        foreach (var r in _plan.Where(r => r.Action == "buy")) sb.Append(r.Sku).Append(",\"").Append(r.Name.Replace("\"", "\"\"")).Append("\",").Append(r.Net.ToString(CultureInfo.InvariantCulture)).Append('\n');
        File.WriteAllText(dlg.FileName, sb.ToString(), new UTF8Encoding(true));
        _msg.Text = dlg.FileName;
    }

    private async Task Bill()
    {
        if (Ui.Selected<JsonObject>(_grid) is not { } p) return;
        if (OpsEngine.Num(p["ready"]) <= 0 || FinEngine.S(p["customer"]).Length == 0) { _msg.Text = OpsEngine.L("noReady"); return; }
        var w = Ui.Dialog(OpsEngine.L("createInvoice") + " · " + FinEngine.S(p["code"]), 380, 330, out var body);
        var dt = Ui.Input(DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)); var terms = Ui.Input("30"); var tax = Ui.Input(OpsEngine.Num(OpsEngine.Spec["defaultTax"]).ToString(CultureInfo.InvariantCulture));
        body.Children.Add(Ui.Text(OpsEngine.L("date"), 12, false)); body.Children.Add(dt);
        body.Children.Add(Ui.Text(OpsEngine.L("terms"), 12, false)); body.Children.Add(terms);
        body.Children.Add(Ui.Text(OpsEngine.L("tax"), 12, false)); body.Children.Add(tax);
        var ok = false;
        body.Children.Add(Ui.Row(Ui.Btn(OpsEngine.L("createInvoice"), () => { ok = true; w.Close(); }), Ui.Btn("✕", () => w.Close(), "ghost")));
        w.ShowDialog();
        if (!ok) return;
        var r = await Api.I.Ops(HttpMethod.Post, "/erp/prj/projects/" + FinEngine.S(p["id"]) + "/bill",
            new JsonObject { ["taxPct"] = OpsEngine.Num(JsonValue.Create(tax.Text)), ["date"] = dt.Text.Trim(), ["termsDays"] = (int)OpsEngine.Num(JsonValue.Create(terms.Text)) });
        _pending = OpsEngine.L("billDone", FinEngine.S(r?["invoice"]), OpsEngine.Num(r?["total"]).ToString(CultureInfo.InvariantCulture));
        await Reload();
    }

    private void ExportVat()
    {
        if (_data.GetValueOrDefault("vat") is not JsonObject v) return;
        var dlg = new Microsoft.Win32.SaveFileDialog { FileName = $"vat-return-{FinEngine.S(v["from"])}-{FinEngine.S(v["to"])}.csv", Filter = "CSV (*.csv)|*.csv" };
        if (dlg.ShowDialog() != true) return;
        var sb = new StringBuilder("side,category,count,net,vat\n");
        foreach (var side in new[] { "sales", "purchases" }) foreach (var b in (v[side] as JsonArray) ?? new JsonArray()) sb.Append($"{side},{FinEngine.S(b!["category"])},{(long)OpsEngine.Num(b["count"])},{OpsEngine.Num(b["net"]).ToString(CultureInfo.InvariantCulture)},{OpsEngine.Num(b["vat"]).ToString(CultureInfo.InvariantCulture)}\n");
        sb.Append($"sales,TOTAL,{(long)OpsEngine.Num(v["salesInvoices"])},{OpsEngine.Num(v["salesNet"]).ToString(CultureInfo.InvariantCulture)},{OpsEngine.Num(v["outputVat"]).ToString(CultureInfo.InvariantCulture)}\n");
        sb.Append($"purchases,TOTAL,{(long)OpsEngine.Num(v["purchaseInvoices"])},{OpsEngine.Num(v["purchasesNet"]).ToString(CultureInfo.InvariantCulture)},{OpsEngine.Num(v["inputVat"]).ToString(CultureInfo.InvariantCulture)}\n");
        sb.Append($"net vat due,,,,{OpsEngine.Num(v["netVatDue"]).ToString(CultureInfo.InvariantCulture)}\n");
        File.WriteAllText(dlg.FileName, sb.ToString(), new UTF8Encoding(true));
        _msg.Text = dlg.FileName;
    }

    private async Task SaveProfile()
    {
        var b = new JsonObject();
        foreach (var (k, tb) in _fields) b[k] = tb.Text.Trim();
        if (FinEngine.S(b["sellerName"]).Length == 0) { _msg.Text = OpsEngine.L("sellerReq"); return; }
        if (FinEngine.S(b["vatNo"]).Length > 0 && FinEngine.S(b["vatNo"]).Length != 15) { _msg.Text = OpsEngine.L("vatLen"); return; }
        await Api.I.Ops(HttpMethod.Put, "/finance/zatca/profile", b);
        _msg.Text = OpsEngine.L("saved");
    }
}
