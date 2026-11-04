using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Dashboard (KPIs, six-stage flow, trend, queue, recent documents) and Reports &amp; Analytics, computed client-side from the workflow instances
/// exactly like the portal does (see Services/Bi.cs).</summary>
internal static class DashUi
{
    public static readonly string[] DocKeys = { "col.number", "col.type", "col.party", "col.date", "col.amount", "col.stage", "col.status", "col.step" };
    public static string[] DocHeaders() => DocKeys.Select(Loc.T).ToArray();

    public static List<string[]> DocRows(IEnumerable<Bi.Doc> docs) => docs.Select(d => new[]
    {
        d.Number, d.Type.Length == 0 ? d.Title : Loc.T("doc." + d.Type), d.Party, d.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), d.HasTotal ? Bi.Money(d.Total) : "",
        Loc.T("stage." + d.Stage), d.Status == "pending" ? Loc.T("filter.pending") : d.Status == "approved" ? Loc.T("filter.approved") : Loc.T("filter.rejected"), d.Step
    }).ToList();

    public static string CurOf(List<Bi.Doc> docs) => docs.Select(d => d.Currency).FirstOrDefault(c => c.Length > 0) ?? "";

    public static Border Card(string title, UIElement body, UIElement? extra = null)
    {
        var head = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
        if (extra != null) { DockPanel.SetDock(extra, Dock.Right); head.Children.Add(extra); }
        head.Children.Add(Ui.Text(title, 15, true));
        var st = new StackPanel(); st.Children.Add(head); st.Children.Add(body);
        return new Border { Child = st, Background = Brushes.White, BorderBrush = Charts.LinePen.Brush, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 8, 12, 10), Margin = new Thickness(0, 0, 0, 12) };
    }

    public static Grid Two(UIElement a, UIElement b, double wa)
    {
        var g = new Grid();
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(wa, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - wa, GridUnitType.Star) });
        Grid.SetColumn(a, 0); Grid.SetColumn(b, 1);
        ((FrameworkElement)a).Margin = new Thickness(0, 0, 12, 12);
        g.Children.Add(a); g.Children.Add(b);
        return g;
    }

    public static DataGrid Table(string[] headers, double height)
    {
        var g = Ui.Grid(headers); g.Height = height; return g;
    }
}

// ------------------------------------------------------------------------------------------------ dashboard
public sealed class DashboardView : PageView
{
    private readonly Action<int> _go;
    private readonly TextBlock _hello = Ui.Text("", 22, true);
    private readonly Dictionary<string, Charts.KpiCard> _k = new();
    private readonly Charts.FlowStrip _flow = new();
    private readonly DataGrid _stageTbl = DashUi.Table(DashUi.DocHeaders(), 180), _queue, _recent = DashUi.Table(DashUi.DocHeaders(), 240);
    private readonly Charts.TrendChart _trend = new(Loc.T("module.sales"), Loc.T("chart.purchases"));
    private readonly Charts.HBars _mods = new();
    private List<Bi.Doc> _docs = new();
    private string _stage = "";

    public DashboardView(Action<int> go, Action<string, string?> openKind)
    {
        _go = go;
        _queue = DashUi.Table(new[] { Loc.T("col.step"), Loc.T("col.number"), Loc.T("col.party"), Loc.T("col.priority") }, 140);
        var top = new DockPanel();
        var refresh = Ui.Btn(Loc.T("common.refresh"), () => _ = Reload(), "ghost");
        DockPanel.SetDock(refresh, Dock.Right);
        top.Children.Add(refresh); top.Children.Add(_hello);
        Root.Children.Add(top);

        var grid = new UniformGrid { Columns = 3, Margin = new Thickness(0, 10, 0, 0) };
        foreach (var (key, color, page) in new[] { ("kpi.sales", "#0EA5E9", 4), ("kpi.purchases", "#8B5CF6", 4), ("kpi.receivables", "#10B981", 4), ("kpi.payables", "#F59E0B", 4), ("kpi.myApprovals", "#EF4444", 1), ("kpi.cycle", "#64748B", 3) })
        {
            var p = page;
            var c = new Charts.KpiCard(Loc.T(key), color, () => _go(p));
            _k[key] = c; grid.Children.Add(c);
        }
        Root.Children.Add(grid);

        _flow.Picked += PickStage;
        _stageTbl.Visibility = Visibility.Collapsed;
        var fw = new StackPanel();
        fw.Children.Add(Ui.Text(Loc.T("dash.flowSub"), 12, false, Ui.Dim)); fw.Children.Add(_flow); fw.Children.Add(_stageTbl);
        Root.Children.Add(DashUi.Card(Loc.T("dash.flow"), fw));
        Root.Children.Add(DashUi.Two(DashUi.Card(Loc.T("dash.trend"), _trend), DashUi.Card(Loc.T("dash.byModule"), _mods), 0.6));

        Root.Children.Add(DashUi.Card(Loc.T("dash.myQueue"), _queue, Ui.Btn(Loc.T("dash.viewAll"), () => _go(1), "ghost")));
        Ui.OnOpen(_recent, () => _go(2));
        Root.Children.Add(DashUi.Card(Loc.T("dash.recent"), _recent, Ui.Btn(Loc.T("dash.viewAll"), () => _go(2), "ghost")));
        Root.Children.Add(Ui.Text(Loc.T("home.modules"), 16, true));
        var mg = new UniformGrid { Columns = 4, Margin = new Thickness(0, 6, 0, 0) };
        foreach (var m in Loc.VisibleModules())
        {
            var id = m.Id;
            var b = Ui.Btn(m.Name(Loc.Rtl), () => openKind(id, null), "ghost");
            b.Margin = new Thickness(0, 0, 8, 8);
            mg.Children.Add(b);
        }
        Root.Children.Add(mg);
    }

    public override async Task Reload() => await Safe(async () =>
    {
        _hello.Text = Loc.T("dash.hello") + ", " + (Api.I.Session?.DisplayName ?? "");
        async Task<JsonArray> Try(Task<JsonArray> t) { try { return await t; } catch { return new JsonArray(); } }
        var inst = Try(Api.I.InstancesRaw()); var tk = Try(Api.I.TasksRaw());
        Fill(await inst, await tk);
    });

    public void Fill(JsonArray instances, JsonArray tasks)
    {
        _docs = Bi.DocsOf(instances);
        var K = Bi.ComputeKpis(_docs, tasks.Count);
        var cur = DashUi.CurOf(_docs);
        string M(double v) => Bi.Money(v, cur);
        _k["kpi.sales"].Set(M(K.SalesMonth), Loc.T("kpi.pipeline") + ": " + M(K.Pipeline));
        _k["kpi.purchases"].Set(M(K.PurchasesMonth), Loc.T("kpi.committed") + ": " + M(K.Committed));
        _k["kpi.receivables"].Set(M(K.Receivables));
        _k["kpi.payables"].Set(M(K.Payables), Loc.T("kpi.expenses") + ": " + M(K.ExpensesMonth));
        _k["kpi.myApprovals"].Set(K.MyApprovals.ToString(CultureInfo.InvariantCulture));
        _k["kpi.cycle"].Set(K.AvgCycleDays.ToString("0.0", CultureInfo.InvariantCulture) + " " + Loc.T("kpi.days"),
            $"{Loc.T("kpi.openDocs")}: {K.OpenDocs} · {Loc.T("kpi.rejectRate")}: {Math.Round(K.RejectRate * 100)}%");
        var sc = Bi.StageCounts(_docs);
        _flow.Set(Bi.Stages.Select(s => new Charts.FlowItem(s, Loc.T("stage." + s), Bi.Money(sc[s].Value), sc[s].Count)).ToList());
        _trend.Set(Bi.MonthlyTrend(_docs));
        _mods.Set(Bi.ModuleColors.Select(p => (p.Key, p.Value, n: _docs.Count(d => d.Status == "pending" && d.Module == p.Key)))
            .Where(x => x.n > 0).OrderByDescending(x => x.n).Select(x => new Charts.BarRow(Loc.T("module." + x.Key), x.n, x.Value, x.n.ToString(CultureInfo.InvariantCulture))).ToList());
        var byId = _docs.ToDictionary(d => d.Id, d => d);
        var qr = new List<(string[], object)>();
        foreach (var t in tasks.OfType<JsonObject>().Take(6))
        {
            byId.TryGetValue(t["instanceId"]?.ToString() ?? "", out var d);
            qr.Add((new[] { t["nodeName"]?.ToString() ?? "", d?.Number ?? "", d?.Party ?? "", t["priority"]?.ToString() is { Length: > 0 } pr ? pr : "Normal" }, t));
        }
        Ui.Fill(_queue, qr);
        var top = _docs.Take(8).ToList();
        Ui.Fill(_recent, DashUi.DocRows(top).Select((r, i) => (r, (object)top[i])));
        PickStage(_stage);
    }

    private void PickStage(string s)
    {
        _stage = s;
        if (s.Length == 0) { _stageTbl.Visibility = Visibility.Collapsed; return; }
        var sel = _docs.Where(d => s == "reporting" ? d.Status == "approved" : d.Status == "pending" && d.Stage == s).Take(50).ToList();
        Ui.Fill(_stageTbl, DashUi.DocRows(sel).Select((r, i) => (r, (object)sel[i])));
        _stageTbl.Visibility = Visibility.Visible;
    }
}

// ------------------------------------------------------------------------------------------------ reports
public sealed class ReportsView : PageView
{
    private List<Bi.Doc> _docs = new();
    private List<string[]> _modRows = new(), _brRows = new();
    private readonly DataGrid _tMod, _tBr;
    private readonly Charts.HBars _bott = new(), _turn = new(), _cust = new(), _vend = new();

    public ReportsView()
    {
        var hd = new[] { Loc.T("col.module"), Loc.T("col.count"), Loc.T("filter.pending"), Loc.T("filter.approved"), Loc.T("filter.rejected"), Loc.T("col.avgDays"), Loc.T("col.value") };
        var hb = (string[])hd.Clone(); hb[0] = Loc.T("col.branch");
        _tMod = DashUi.Table(hd, 170); _tBr = DashUi.Table(hb, 130);
        var top = new DockPanel();
        var bar = Ui.Row(Ui.Btn(Loc.T("common.refresh"), () => _ = Reload(), "ghost"), Ui.Btn("🖨 " + Loc.T("collab.rep.print"), Designer, "ghost"), Ui.Btn(Loc.T("rep.export"), ExportCsv));
        DockPanel.SetDock(bar, Dock.Right);
        top.Children.Add(bar); top.Children.Add(Ui.Text(Loc.T("rep.title"), 20, true));
        Root.Children.Add(top);
        Root.Children.Add(Ui.Text(Loc.T("rep.sub"), 12, false, Ui.Dim));
        Root.Children.Add(DashUi.Card(Loc.T("rep.byModule"), _tMod));
        Root.Children.Add(DashUi.Card(Loc.T("rep.byBranch"), _tBr));
        Root.Children.Add(DashUi.Two(DashUi.Card(Loc.T("rep.bottleneck"), _bott), DashUi.Card(Loc.T("rep.turnaround"), _turn), 0.5));
        Root.Children.Add(DashUi.Two(DashUi.Card(Loc.T("rep.topParties") + " · " + Loc.T("party.customer"), _cust), DashUi.Card(Loc.T("rep.topParties") + " · " + Loc.T("party.vendor"), _vend), 0.5));
    }

    public override async Task Reload() => await Safe(async () =>
    {
        try { Fill(await Api.I.InstancesRaw()); } catch { Fill(new JsonArray()); }
    });

    private List<string[]> GroupRows(bool byModule) => Bi.GroupBy(_docs, byModule).Select(g => new[]
    {
        byModule ? Loc.T("module." + g.Key) : g.Key, g.Count.ToString(CultureInfo.InvariantCulture), g.Pending.ToString(CultureInfo.InvariantCulture), g.Approved.ToString(CultureInfo.InvariantCulture),
        g.Rejected.ToString(CultureInfo.InvariantCulture), g.AvgDays.ToString("0.0", CultureInfo.InvariantCulture), Bi.Money(g.Value)
    }).ToList();

    public void Fill(JsonArray instances)
    {
        _docs = Bi.DocsOf(instances);
        _modRows = GroupRows(true); _brRows = GroupRows(false);
        Ui.Fill(_tMod, _modRows.Select(r => (r, (object)r))); Ui.Fill(_tBr, _brRows.Select(r => (r, (object)r)));
        _bott.Set(Bi.Bottleneck(_docs).Take(8).Select(p => new Charts.BarRow(p.step, p.count, "#F59E0B", p.count.ToString(CultureInfo.InvariantCulture))).ToList());
        _turn.Set(Bi.StepTurnaround(_docs).Take(8).Select(s => new Charts.BarRow(s.Name, s.AvgHours, s.AvgHours > 24 ? "#DC2626" : "#10B981", s.AvgHours.ToString("0.0", CultureInfo.InvariantCulture) + " " + Loc.T("rep.hours"))).ToList());
        _cust.Set(Bi.TopParties(_docs, new[] { "SO" }).Select(p => new Charts.BarRow(p.Name, p.Value, "#0EA5E9", Bi.Money(p.Value))).ToList());
        _vend.Set(Bi.TopParties(_docs, new[] { "PR", "PV" }).Select(p => new Charts.BarRow(p.Name, p.Value, "#8B5CF6", Bi.Money(p.Value))).ToList());
    }

    private static string Line(IEnumerable<string> cells) => string.Join(",", cells.Select(c => "\"" + c.Replace("\"", "\"\"") + "\"")) + "\r\n";

    public string Csv()
    {
        var s = new StringBuilder(Line(new[] { Loc.T("rep.byModule") }));
        s.Append(Line(new[] { Loc.T("col.module"), Loc.T("col.count"), Loc.T("filter.pending"), Loc.T("filter.approved"), Loc.T("filter.rejected"), Loc.T("col.avgDays"), Loc.T("col.value") }));
        foreach (var r in _modRows) s.Append(Line(r));
        s.Append("\r\n").Append(Line(new[] { Loc.T("rep.byBranch") }));
        foreach (var r in _brRows) s.Append(Line(r));
        s.Append("\r\n").Append(Line(new[] { Loc.T("rep.turnaround") }));
        foreach (var st in Bi.StepTurnaround(_docs)) s.Append(Line(new[] { st.Name, st.AvgHours.ToString("0.0", CultureInfo.InvariantCulture), st.Count.ToString(CultureInfo.InvariantCulture) }));
        return s.ToString();
    }

    private void ExportCsv()
    {
        var dlg = new Microsoft.Win32.SaveFileDialog { FileName = "report.csv", Filter = "CSV (*.csv)|*.csv" };
        if (dlg.ShowDialog() == true) File.WriteAllText(dlg.FileName, Csv(), new UTF8Encoding(true));
    }

    private void Designer()
    {
        var keys = new[] { "number", "type", "party", "date", "amount", "stage", "status", "step" };
        var cols = keys.Select((k, i) => new Report.Column(k, Loc.T(DashUi.DocKeys[i]), i == 4)).ToList();
        var rows = new List<Dictionary<string, string>>();
        var dr = DashUi.DocRows(_docs);
        for (var r = 0; r < dr.Count; r++)
        {
            var row = new Dictionary<string, string>();
            for (var i = 0; i < keys.Length; i++) row[keys[i]] = dr[r][i];
            row["amount#"] = _docs[r].Total.ToString(CultureInfo.InvariantCulture);
            rows.Add(row);
        }
        Report.Show("reports:documents", Loc.T("rep.title"), cols, rows, Api.I.Session?.DisplayName ?? "");
    }
}
