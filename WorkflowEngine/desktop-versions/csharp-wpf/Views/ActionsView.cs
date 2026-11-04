using System.Globalization;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Operations and finance actions: work orders, accounting periods and the monthly depreciation run. Same endpoints and rules as the portal.</summary>
internal static class ActEngine
{
    public static string S(JsonNode? n) => SiteEngine.Js(n);
    public static double N(JsonNode? n) => SiteEngine.Num(n, 0);
    public static double R2(double v) => Math.Round(v * 100, MidpointRounding.AwayFromZero) / 100.0;
    public static JsonObject Data(JsonObject r) => r["data"] as JsonObject ?? new JsonObject();
    /// <summary>A list the user may not read just stays empty.</summary>
    public static async Task<JsonArray> Fetch(string path) { try { return await Api.I.Ops(HttpMethod.Get, path) as JsonArray ?? new JsonArray(); } catch (Exception) { return new JsonArray(); } }
    public static string NextMonth(string p) { var y = int.Parse(p.Substring(0, 4)); var m = int.Parse(p.Substring(5, 2)); return m == 12 ? (y + 1) + "-01" : y + "-" + (m + 1).ToString("00"); }
    public static List<string> PeriodsDue(JsonObject d, string upTo)
    {
        var last = S(d["lastPeriod"]); var ins = S(d["inServiceDate"]);
        var start = last.Length > 0 ? NextMonth(last) : (ins.Length >= 7 ? ins.Substring(0, 7) : "");
        var o = new List<string>();
        if (start.Length != 7 || string.CompareOrdinal(start, upTo) > 0) return o;
        for (var p = start; string.CompareOrdinal(p, upTo) <= 0 && o.Count < 600; p = NextMonth(p)) o.Add(p);
        return o;
    }
    /// <summary>Depreciation for every month still due; stops at the salvage value.</summary>
    public static (double amount, int months, string last) DepreciationDue(JsonObject d, string upTo)
    {
        double acc = N(d["accumulated"]), cost = N(d["cost"]), salvage = N(d["salvage"]), total = 0; var last = ""; var n = 0;
        var life = (int)Math.Max(1, Math.Round(N(d["lifeMonths"]) == 0 ? 60 : N(d["lifeMonths"])));
        foreach (var p in PeriodsDue(d, upTo))
        {
            var nbv = cost - acc; var m = S(d["method"]) == "DB" ? nbv * (2.0 / life) : (cost - salvage) / life;
            m = Math.Max(0, Math.Min(m, nbv - salvage));
            if (m <= 0.004) break;
            acc += m; total += m; last = p; n++;
        }
        return (R2(total), n, last);
    }
    public static double InvoiceTotal(JsonObject d) => N(d["total"]) > 0 ? N(d["total"]) : N(d["amount"]) + N(d["taxAmount"]);
    /// <summary>3-way match: the total must not exceed the smaller of the PO and the received amount (plus the tolerance).</summary>
    public static string MatchInvoice(JsonObject d, double tol)
    {
        if (S(d["poNo"]).Trim().Length == 0) return "NoPO";
        var limit = Math.Min(N(d["poAmount"]), N(d["receivedAmount"]));
        if (limit <= 0) return "Mismatch";
        return InvoiceTotal(d) <= limit * (1 + tol / 100) ? "Matched" : "Mismatch";
    }
    private static JsonObject Line(string acc, double dr, double cr, string memo, JsonObject? dims)
    {
        var l = new JsonObject { ["account"] = acc, ["debit"] = dr, ["credit"] = cr, ["memo"] = memo };
        if (dims != null) { l["costCenter"] = S(dims["costCenter"]); l["project"] = S(dims["project"]); }
        return l;
    }
    /// <summary>Journal lines for an invoice (same rules as the portal's posting service); null when the default accounts are missing.</summary>
    public static JsonArray? LedgerLines(string side, JsonObject d, JsonObject df)
    {
        double total = R2(InvoiceTotal(d)), tax = R2(N(d["taxAmount"])), net = R2(total - tax); var o = new JsonArray();
        if (side == "ap")
        {
            var exp = S(d["account"]).Length > 0 ? S(d["account"]) : S(df["expenseAccount"]);
            if (S(df["apAccount"]).Length == 0 || exp.Length == 0) return null;
            var vat = tax != 0 && S(df["vatInput"]).Length > 0;
            o.Add(Line(exp, vat ? net : total, 0, S(d["vendor"]), d)); if (vat) o.Add(Line(S(df["vatInput"]), tax, 0, "VAT", null)); o.Add(Line(S(df["apAccount"]), 0, total, S(d["vendor"]), null));
            return o;
        }
        var rev = S(d["account"]).Length > 0 ? S(d["account"]) : S(df["revenueAccount"]);
        if (S(df["arAccount"]).Length == 0 || rev.Length == 0) return null;
        var vo = tax != 0 && S(df["vatOutput"]).Length > 0;
        o.Add(Line(S(df["arAccount"]), total, 0, S(d["customer"]), null)); o.Add(Line(rev, 0, vo ? net : total, S(d["customer"]), d)); if (vo) o.Add(Line(S(df["vatOutput"]), 0, tax, "VAT", null));
        return o;
    }
    public static string Fmt(double v) => v.ToString("F2", CultureInfo.InvariantCulture);
}

public sealed class ActionsView : PageView
{
    private readonly TabControl _tabs = new() { MinHeight = 520 };
    private readonly TextBlock _msg = new() { Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap };
    private readonly List<Func<Task>> _views = new();
    // work orders
    private DataGrid _wo = Ui.Grid(), _per = Ui.Grid(), _dep = Ui.Grid();
    private readonly ComboBox _bom = new() { MinWidth = 200, Margin = new Thickness(0, 0, 8, 0) };
    private readonly TextBox _qty = Ui.Input("1"), _due = Ui.Input(DateTime.Today.AddDays(7).ToString("yyyy-MM-dd")), _year = Ui.Input(DateTime.Today.Year.ToString()), _month = Ui.Input(DateTime.Today.ToString("yyyy-MM"));
    private Button _bRel = null!, _bStart = null!, _bDone = null!, _bCancel = null!, _bClose = null!, _bOpen = null!, _bRun = null!;
    private readonly TextBlock _total = new() { Margin = new Thickness(0, 6, 0, 6) };
    private DataGrid _inv = Ui.Grid(); private readonly ComboBox _side = new() { Width = 220, Margin = new Thickness(0, 0, 0, 8) }; private Button _bPost = null!, _bEinv = null!; private JsonArray _invRows = new(); private JsonObject _invDefaults = new(); private double _tol = 2;
    private JsonArray _boms = new(), _perRows = new(), _assets = new(); private readonly Dictionary<string, double> _stock = new(); private JsonObject _defaults = new();
    private readonly List<(JsonObject asset, (double amount, int months, string last) d)> _items = new();

    public ActionsView()
    {
        Root.Children.Add(Ui.Text(Loc.T("act.title"), 20, true));
        if (Api.I.Can("mfg.view")) { _tabs.Items.Add(new TabItem { Header = Loc.T("act.v.wo"), Content = BuildWo() }); _views.Add(LoadWo); }
        if (Api.I.Can("finance.gl.view")) { _tabs.Items.Add(new TabItem { Header = Loc.T("act.v.per"), Content = BuildPer() }); _views.Add(LoadPer); }
        if (Api.I.Can("finance.assets.view")) { _tabs.Items.Add(new TabItem { Header = Loc.T("act.v.depr"), Content = BuildDep() }); _views.Add(LoadDep); }
        if (Api.I.Can("finance.ar.view")) { _tabs.Items.Add(new TabItem { Header = Loc.T("act.v.inv"), Content = BuildInv() }); _views.Add(LoadInv); }
        _tabs.SelectionChanged += async (s, e) => { if (e.OriginalSource == _tabs) await Safe(Reload); };
        Root.Children.Add(_tabs); Root.Children.Add(_msg);
    }
    public override async Task Reload() { var i = _tabs.SelectedIndex; if (i >= 0 && i < _views.Count) await _views[i](); }

    // ---------------------------------------------------------------- work orders
    private UIElement BuildWo()
    {
        _wo = Ui.Grid(Loc.T("act.code"), Loc.T("act.sku"), Loc.T("act.qty"), Loc.T("act.due"), Loc.T("act.status"), Loc.T("mfg.wo.actual"), Loc.T("mfg.wo.variance")); _wo.Height = 260;
        _bRel = Ui.Btn(Loc.T("mfg.wo.release"), () => SiteEngine.Run(() => Step("release"))); _bStart = Ui.Btn(Loc.T("mfg.wo.start"), () => SiteEngine.Run(() => Step("start")));
        _bDone = Ui.Btn(Loc.T("mfg.wo.complete"), () => SiteEngine.Run(Complete)); _bCancel = Ui.Btn(Loc.T("mfg.wo.cancel"), () => SiteEngine.Run(() => Step("cancel")), "danger");
        _wo.SelectionChanged += (_, _) => GateWo();
        var p = new StackPanel { Margin = new Thickness(12) };
        p.Children.Add(_wo); p.Children.Add(Ui.Row(_bRel, _bStart, _bDone, _bCancel, Ui.Btn(Loc.T("act.refresh"), () => SiteEngine.Run(LoadWo), "ghost")));
        if (Api.I.Can("mfg.orders.manage"))
        {
            _qty.Width = 70; _due.Width = 110;
            p.Children.Add(Ui.Row(new TextBlock { Text = Loc.T("act.bom") + " ", VerticalAlignment = VerticalAlignment.Center }, _bom, new TextBlock { Text = Loc.T("act.qty") + " ", VerticalAlignment = VerticalAlignment.Center }, _qty,
                new TextBlock { Text = Loc.T("act.due") + " ", VerticalAlignment = VerticalAlignment.Center }, _due, Ui.Btn(Loc.T("act.create"), () => SiteEngine.Run(CreateWo))));
        }
        GateWo();
        return new ScrollViewer { Content = p };
    }
    private void GateWo()
    {
        var st = ActEngine.S(Ui.Selected<JsonObject>(_wo)?["status"]); bool mg = Api.I.Can("mfg.orders.manage"), ex = Api.I.Can("mfg.orders.execute");
        _bRel.IsEnabled = st == "Planned" && mg; _bStart.IsEnabled = st == "Released" && ex; _bDone.IsEnabled = st == "InProgress" && ex; _bCancel.IsEnabled = (st == "Planned" || st == "Released") && mg;
    }
    private async Task LoadWo()
    {
        var rows = await ActEngine.Fetch("/erp/mfg/records/workorder?take=5000"); _boms = await ActEngine.Fetch("/erp/mfg/records/bom?take=5000"); var st = await ActEngine.Fetch("/erp/mfg/stock");
        _stock.Clear(); foreach (var x in st.OfType<JsonObject>()) _stock[ActEngine.S(x["sku"])] = ActEngine.N(x["qty"]);
        Ui.Fill(_wo, rows.OfType<JsonObject>().Select(r => { var d = ActEngine.Data(r); return (new[] { ActEngine.S(r["code"]), ActEngine.S(d["sku"]), ActEngine.S(d["qty"]), ActEngine.S(d["due"]), ActEngine.S(r["status"]), ActEngine.S(d["actualCost"]), ActEngine.S(d["variance"]) }, (object)r); }));
        _bom.Items.Clear();
        foreach (var b in _boms.OfType<JsonObject>().Where(b => ActEngine.S(b["status"]) != "Inactive")) _bom.Items.Add(new ComboBoxItem { Content = ActEngine.S(b["code"]) + " · " + ActEngine.S(ActEngine.Data(b)["name"]), Tag = b });
        if (_bom.Items.Count > 0 && _bom.SelectedIndex < 0) _bom.SelectedIndex = 0;
        GateWo();
    }
    private async Task Step(string a)
    {
        var r = Ui.Selected<JsonObject>(_wo); if (r is null) return;
        await Api.I.Ops(HttpMethod.Post, "/mfg/workorders/" + ActEngine.S(r["id"]) + "/" + a, new JsonObject()); _msg.Text = Loc.T("act.done"); await LoadWo();
    }
    private async Task Complete()
    {
        var r = Ui.Selected<JsonObject>(_wo); if (r is null) return;
        var d = ActEngine.Data(r); var bq = ActEngine.N(d["bomQty"]) > 0 ? ActEngine.N(d["bomQty"]) : 1;
        var q = Ui.Input(ActEngine.S(d["qty"])); var sc = Ui.Input("0"); var hr = Ui.Input(ActEngine.Fmt(ActEngine.R2(ActEngine.N(d["routingMinutes"]) / 60 * (ActEngine.N(d["qty"]) / bq)))); var note = Ui.Input();
        var mat = Ui.Grid(Loc.T("act.sku"), Loc.T("mfg.wo.need"), Loc.T("mfg.wo.have")); mat.Height = 130;
        double V(TextBox t) => double.TryParse(t.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var x) ? x : 0;
        void Paint()
        {
            var f = (V(q) + V(sc)) / bq;
            Ui.Fill(mat, (d["lines"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Select(l => (new[] { ActEngine.S(l["sku"]), ActEngine.Fmt(ActEngine.R2(ActEngine.N(l["qty"]) * f * (1 + ActEngine.N(l["scrapPct"]) / 100))), (_stock.TryGetValue(ActEngine.S(l["sku"]), out var h) ? h : 0).ToString(CultureInfo.InvariantCulture) }, (object)l)));
        }
        q.TextChanged += (_, _) => Paint(); sc.TextChanged += (_, _) => Paint(); Paint();
        var ok = false; var w = Ui.Dialog(Loc.T("mfg.wo.complete") + " " + ActEngine.S(r["code"]), 460, 520, out var body);
        body.Children.Add(Ui.Labeled(Loc.T("mfg.wo.good"), q)); body.Children.Add(Ui.Labeled(Loc.T("mfg.wo.scrap"), sc)); body.Children.Add(Ui.Labeled(Loc.T("mfg.wo.hours"), hr)); body.Children.Add(Ui.Labeled(Loc.T("erp.f.notes"), note));
        body.Children.Add(Ui.Text(Loc.T("mfg.wo.materials"), 15, true)); body.Children.Add(mat);
        body.Children.Add(Ui.Row(Ui.Btn(Loc.T("mfg.wo.complete"), () => { ok = true; w.Close(); }), Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog(); if (!ok) return;
        await Api.I.Ops(HttpMethod.Post, "/mfg/workorders/" + ActEngine.S(r["id"]) + "/complete", new JsonObject { ["qty"] = V(q), ["scrap"] = V(sc), ["hours"] = V(hr), ["note"] = note.Text });
        _msg.Text = Loc.T("act.done"); await LoadWo();
    }
    private async Task CreateWo()
    {
        if ((_bom.SelectedItem as ComboBoxItem)?.Tag is not JsonObject b) return;
        var bd = ActEngine.Data(b);
        double.TryParse(_qty.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var qty);
        var d = new JsonObject { ["sku"] = ActEngine.S(b["code"]), ["qty"] = qty, ["due"] = _due.Text, ["priority"] = "Normal", ["workCenter"] = ActEngine.S(bd["workCenter"]), ["lines"] = bd["lines"]?.DeepClone() ?? new JsonArray(), ["bomQty"] = bd["qty"]?.DeepClone() ?? 1, ["routingMinutes"] = bd["routingMinutes"]?.DeepClone() ?? 0 };
        var res = await Api.I.Ops(HttpMethod.Post, "/erp/mfg/records/workorder", new JsonObject { ["status"] = "Planned", ["data"] = d }) as JsonObject;
        _msg.Text = Loc.T("act.created").Replace("{n}", ActEngine.S(res?["code"])); await LoadWo();
    }

    // ---------------------------------------------------------------- accounting periods
    private UIElement BuildPer()
    {
        _per = Ui.Grid(Loc.T("fin.per.code"), Loc.T("act.status")); _per.Height = 300; var ok = Api.I.Can("finance.gl.approve");
        _bClose = Ui.Btn(Loc.T("fin.per.close"), () => SiteEngine.Run(() => SetPer("Closed"))); _bOpen = Ui.Btn(Loc.T("fin.per.reopen"), () => SiteEngine.Run(() => SetPer("Open")), "ghost");
        _per.SelectionChanged += (_, _) => GatePer(); _year.Width = 70;
        var gen = Ui.Btn(Loc.T("fin.per.generate"), () => SiteEngine.Run(Generate)); gen.Visibility = ok ? Visibility.Visible : Visibility.Collapsed;
        var p = new StackPanel { Margin = new Thickness(12) }; p.Children.Add(_per);
        p.Children.Add(Ui.Row(_bClose, _bOpen, new TextBlock { Text = Loc.T("act.year") + " ", VerticalAlignment = VerticalAlignment.Center }, _year, gen)); GatePer();
        return new ScrollViewer { Content = p };
    }
    private void GatePer()
    {
        var r = Ui.Selected<JsonObject>(_per); var st = ActEngine.S(r?["status"]); var ok = Api.I.Can("finance.gl.approve");
        _bClose.IsEnabled = ok && r != null && st != "Closed"; _bOpen.IsEnabled = ok && st == "Closed";
    }
    private async Task LoadPer()
    {
        _perRows = new JsonArray(); foreach (var r in (await ActEngine.Fetch("/finance/records/period")).OfType<JsonObject>().OrderBy(x => ActEngine.S(x["code"]), StringComparer.Ordinal)) _perRows.Add(r.DeepClone());
        Ui.Fill(_per, _perRows.OfType<JsonObject>().Select(r => { var st = ActEngine.S(r["status"]); return (new[] { ActEngine.S(r["code"]), Loc.T("fin.st." + (st.Length == 0 ? "Open" : st)) }, (object)r); })); GatePer();
    }
    private async Task SetPer(string status)
    {
        var r = Ui.Selected<JsonObject>(_per); if (r is null) return;
        await Api.I.Ops(HttpMethod.Put, "/finance/records/period/" + ActEngine.S(r["id"]), new JsonObject { ["status"] = status, ["data"] = r["data"]?.DeepClone() ?? new JsonObject() }); await LoadPer();
    }
    private async Task Generate()
    {
        var have = _perRows.OfType<JsonObject>().Select(x => ActEngine.S(x["code"])).ToHashSet(); int.TryParse(_year.Text, out var y); var n = 0;
        try
        {
            for (var m = 1; m <= 12; m++)
            {
                var c = y + "-" + m.ToString("00"); if (have.Contains(c)) continue;
                await Api.I.Ops(HttpMethod.Post, "/finance/records/period", new JsonObject { ["code"] = c, ["status"] = "Open", ["data"] = new JsonObject() }); n++;
            }
            _msg.Text = Loc.T("act.perCreated").Replace("{n}", n.ToString());
        }
        finally { await LoadPer(); }
    }

    // ---------------------------------------------------------------- depreciation
    private UIElement BuildDep()
    {
        _dep = Ui.Grid(Loc.T("act.asset"), Loc.T("act.months"), Loc.T("act.amount")); _dep.Height = 260; _month.Width = 100;
        _month.LostFocus += (_, _) => PaintDep();
        _bRun = Ui.Btn(Loc.T("fin.asset.run"), () => SiteEngine.Run(RunDep)); _bRun.Visibility = Api.I.Can("finance.assets.manage") && Api.I.Can("finance.gl.manage") ? Visibility.Visible : Visibility.Collapsed;
        var p = new StackPanel { Margin = new Thickness(12) };
        p.Children.Add(Ui.Row(new TextBlock { Text = Loc.T("fin.asset.upTo") + " ", VerticalAlignment = VerticalAlignment.Center }, _month)); p.Children.Add(_dep); p.Children.Add(_total); p.Children.Add(_bRun);
        return new ScrollViewer { Content = p };
    }
    private async Task LoadDep()
    {
        _assets = await ActEngine.Fetch("/finance/records/asset"); _defaults = new JsonObject();
        foreach (var s in (await ActEngine.Fetch("/finance/records/setting")).OfType<JsonObject>()) if (ActEngine.S(s["code"]) == "defaults") _defaults = ActEngine.Data(s);
        PaintDep();
    }
    private void PaintDep()
    {
        _items.Clear(); double tot = 0;
        foreach (var a in _assets.OfType<JsonObject>().Where(x => ActEngine.S(x["status"]) == "Active"))
        {
            var d = ActEngine.DepreciationDue(ActEngine.Data(a), _month.Text.Trim()); if (d.amount <= 0) continue; _items.Add((a, d)); tot += d.amount;
        }
        Ui.Fill(_dep, _items.Select(i => { var nm = ActEngine.S(ActEngine.Data(i.asset)["name"]); return (new[] { nm.Length == 0 ? ActEngine.S(i.asset["code"]) : nm, i.d.months.ToString(), ActEngine.Fmt(i.d.amount) }, (object)i.asset); }));
        _total.Text = _items.Count == 0 ? Loc.T("fin.asset.nothingDue") : Loc.T("act.total") + ": " + ActEngine.Fmt(ActEngine.R2(tot)); _bRun.IsEnabled = _items.Count > 0;
    }
    private async Task RunDep()
    {
        var m = _month.Text.Trim();
        if (ActEngine.S(_defaults["deprExpense"]).Length == 0 || ActEngine.S(_defaults["deprAccum"]).Length == 0) { Ui.Warn(Loc.T("fin.needDefaults")); return; }
        var total = ActEngine.R2(_items.Sum(i => i.d.amount)); var its = _items.ToList();
        var lines = new JsonArray { new JsonObject { ["account"] = ActEngine.S(_defaults["deprExpense"]), ["debit"] = total, ["credit"] = 0, ["memo"] = m }, new JsonObject { ["account"] = ActEngine.S(_defaults["deprAccum"]), ["debit"] = 0, ["credit"] = total, ["memo"] = m } };
        var last = DateTime.DaysInMonth(int.Parse(m.Substring(0, 4)), int.Parse(m.Substring(5, 2)));
        var data = new JsonObject { ["date"] = m + "-" + last.ToString("00"), ["memo"] = Loc.T("fin.asset.deprMemo") + " " + m, ["reference"] = "DEPR-" + m, ["rate"] = 1, ["lines"] = lines };
        var j = await Api.I.Ops(HttpMethod.Post, "/finance/records/journal", new JsonObject { ["status"] = "Draft", ["data"] = data }) as JsonObject;
        foreach (var (a, d) in its)
        {
            var nd = (JsonObject)ActEngine.Data(a).DeepClone(); nd["accumulated"] = ActEngine.R2(ActEngine.N(nd["accumulated"]) + d.amount); nd["lastPeriod"] = d.last;
            await Api.I.Ops(HttpMethod.Put, "/finance/records/asset/" + ActEngine.S(a["id"]), new JsonObject { ["status"] = ActEngine.S(a["status"]), ["data"] = nd });
        }
        _msg.Text = Loc.T("fin.asset.runDone").Replace("{n}", ActEngine.S(j?["code"])); await LoadDep();
    }

    // ---------------------------------------------------------------- invoices
    private string Side => _side.SelectedIndex == 1 ? "ap" : "ar";
    private string InvKind => Side == "ap" ? "apinvoice" : "arinvoice";
    private UIElement BuildInv()
    {
        _inv = Ui.Grid(Loc.T("act.code"), Loc.T("act.party"), Loc.T("act.inv.total"), Loc.T("act.status"), Loc.T("fin.ap.match"), Loc.T("act.gl")); _inv.Height = 300;
        _side.Items.Add(Loc.T("act.ar")); _side.Items.Add(Loc.T("act.ap")); _side.SelectedIndex = 0; _side.SelectionChanged += (_, _) => SiteEngine.Run(LoadInv);
        _bPost = Ui.Btn(Loc.T("act.post"), () => SiteEngine.Run(PostInv)); _bEinv = Ui.Btn(Loc.T("act.einv"), () => SiteEngine.Run(EInvoice), "ghost");
        _inv.SelectionChanged += (_, _) => GateInv();
        var p = new StackPanel { Margin = new Thickness(12) }; p.Children.Add(_side); p.Children.Add(_inv); p.Children.Add(Ui.Row(_bPost, _bEinv)); GateInv();
        return new ScrollViewer { Content = p };
    }
    private void GateInv()
    {
        var r = Ui.Selected<JsonObject>(_inv); var st = ActEngine.S(r?["status"]); var ap = Side == "ap";
        var postable = r != null && ActEngine.S(ActEngine.Data(r)["glJournal"]).Length == 0 && (ap ? st is "Approved" or "Paid" : st is "Issued" or "Paid");
        _bPost.IsEnabled = postable && Api.I.Can("finance.gl.manage");
        _bEinv.Visibility = !ap && (Api.I.Can("finance.ar.view") || Api.I.Can("gov.zatca.manage")) ? Visibility.Visible : Visibility.Collapsed; _bEinv.IsEnabled = st is "Issued" or "Paid";
    }
    private async Task LoadInv()
    {
        _invRows = await ActEngine.Fetch("/finance/records/" + InvKind); _invDefaults = new JsonObject(); _tol = 2;
        foreach (var s in (await ActEngine.Fetch("/finance/records/setting")).OfType<JsonObject>())
        {
            var c = ActEngine.S(s["code"]); if (c == "defaults") _invDefaults = ActEngine.Data(s);
            if (c == "controls" && ActEngine.Data(s)["matchTolerancePct"] != null) _tol = ActEngine.N(ActEngine.Data(s)["matchTolerancePct"]);
        }
        var ap = Side == "ap";
        Ui.Fill(_inv, _invRows.OfType<JsonObject>().Select(r =>
        {
            var d = ActEngine.Data(r); var st = ActEngine.S(r["status"]); if (st.Length == 0) st = "Draft";
            return (new[] { ActEngine.S(r["code"]), ActEngine.S(d[ap ? "vendor" : "customer"]), ActEngine.Fmt(ActEngine.R2(ActEngine.InvoiceTotal(d))), Loc.T("fin.st." + st), ap ? Loc.T("fin.match." + ActEngine.MatchInvoice(d, _tol)) : "", ActEngine.S(d["glJournal"]) }, (object)r);
        }));
        GateInv();
    }
    private async Task PostInv()
    {
        var r = Ui.Selected<JsonObject>(_inv); if (r is null) return;
        var d = ActEngine.Data(r); var side = Side; var ls = ActEngine.LedgerLines(side, d, _invDefaults);
        if (ls is null) { Ui.Warn(Loc.T("fin.needDefaults")); return; }
        var lines = new JsonArray(); foreach (var l in ls.OfType<JsonObject>()) if (ActEngine.N(l["debit"]) != 0 || ActEngine.N(l["credit"]) != 0) lines.Add(l.DeepClone());
        var date = ActEngine.S(d["date"]); var rate = ActEngine.N(d["rate"]) > 0 ? ActEngine.N(d["rate"]) : 1;
        var jd = new JsonObject { ["date"] = date.Length >= 10 ? date.Substring(0, 10) : date, ["memo"] = ActEngine.S(d[side == "ap" ? "vendor" : "customer"]) + " · " + (side == "ap" ? ActEngine.S(d["invoiceNo"]) : ActEngine.S(r["code"])), ["reference"] = ActEngine.S(r["code"]), ["currency"] = ActEngine.S(d["currency"]), ["rate"] = rate, ["lines"] = lines };
        var j = await Api.I.Ops(HttpMethod.Post, "/finance/records/journal", new JsonObject { ["status"] = "Draft", ["data"] = jd }) as JsonObject;
        var nd = (JsonObject)d.DeepClone(); nd["glJournal"] = ActEngine.S(j?["code"]);
        await Api.I.Ops(HttpMethod.Put, "/finance/records/" + InvKind + "/" + ActEngine.S(r["id"]), new JsonObject { ["status"] = ActEngine.S(r["status"]), ["data"] = nd });
        _msg.Text = Loc.T("fin.inv.glDone").Replace("{n}", ActEngine.S(j?["code"])); await LoadInv();
    }
    private async Task EInvoice()
    {
        var r = Ui.Selected<JsonObject>(_inv); if (r is null) return;
        var id = ActEngine.S(r["id"]); var code = ActEngine.S(r["code"]);
        var z = await Api.I.Ops(HttpMethod.Get, "/finance/zatca/invoice/" + id) as JsonObject ?? new JsonObject();
        var info = new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, AcceptsReturn = true, Height = 240, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Button? bIssue = null, bXml = null; var w = Ui.Dialog(Loc.T("gov.zatca.title") + " · " + code, 560, 420, out var body);
        void Paint()
        {
            var issued = z["issued"] is JsonValue iv && iv.TryGetValue<bool>(out var ib) && ib;
            info.Text = !issued ? Loc.T("gov.zatca.notIssued") + "\n\n" + Loc.T("gov.zatca.phaseNote")
                : string.Join("\n", Loc.T("gov.zatca.type") + ": " + ActEngine.S(z["type"]), Loc.T("gov.zatca.icv") + ": " + ActEngine.S(z["icv"]), "UUID: " + ActEngine.S(z["uuid"]), Loc.T("gov.zatca.hash") + ": " + ActEngine.S(z["hash"]), Loc.T("gov.zatca.pih") + ": " + ActEngine.S(z["pih"]),
                    Loc.T("gov.zatca.issued") + ": " + ActEngine.S(z["issuedAt"]) + " · " + ActEngine.S(z["issuedBy"]), Loc.T(z["signed"] is JsonValue sv && sv.TryGetValue<bool>(out var sb) && sb ? "gov.zatca.signed" : "gov.zatca.unsigned"), "", Loc.T("act.qr") + ":\n" + ActEngine.S(z["qr"]));
            if (bIssue != null) bIssue.IsEnabled = !issued; if (bXml != null) bXml.IsEnabled = ActEngine.S(z["xml"]).Length > 0;
        }
        bIssue = Ui.Btn(Loc.T("gov.zatca.issue"), () => SiteEngine.Run(async () => { z = await Api.I.Ops(HttpMethod.Post, "/finance/zatca/issue/" + id, new JsonObject()) as JsonObject ?? z; Paint(); }));
        bXml = Ui.Btn(Loc.T("act.xml"), () =>
        {
            var dlg = new Microsoft.Win32.SaveFileDialog { FileName = code + ".xml", Filter = "XML (*.xml)|*.xml" };
            if (dlg.ShowDialog() == true) System.IO.File.WriteAllText(dlg.FileName, ActEngine.S(z["xml"]));
        }, "ghost");
        body.Children.Add(info); body.Children.Add(Ui.Row(bIssue, bXml, Ui.Btn(Loc.T("act.close"), () => w.Close(), "ghost"))); Paint(); w.ShowDialog(); await LoadInv();
    }
}
