using System.Globalization;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Finance reports: overview, trial balance, income statement, balance sheet, receivables / payables ageing, budgets, projects, fixed assets,
/// bank reconciliation and the audit trail. Described by finance.json (shared by every desktop app); the figures are calculated from the same
/// finance records as the portal (port of fin.calc.ts).</summary>
internal static class FinEngine
{
    private static JsonNode? _spec;
    public static JsonNode Spec => _spec ??= JsonNode.Parse(Loc.ReadData("finance.json"))!;
    private static bool Ar => Loc.Lang == "ar";

    public static string L(string key, params object[] args)
    {
        var s = (string)Spec["labels"]![key]![Ar ? 1 : 0]!;
        for (var i = 0; i < args.Length; i++) s = s.Replace("{" + i + "}", args[i]?.ToString());
        return s;
    }
    public static string Tx(JsonNode? o) => (string?)o?[Ar ? "ar" : "en"] ?? "";
    public static string Money(double v) => v.ToString("N2", CultureInfo.InvariantCulture);
    public static string S(JsonNode? n) => n is null ? "" : n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n.ToJsonString().Trim('"');
    public static double Num(JsonNode? n)
    {
        if (n is JsonValue v)
        {
            if (v.TryGetValue<double>(out var d)) return double.IsFinite(d) ? d : 0;
            if (v.TryGetValue<string>(out var s) && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var x) && double.IsFinite(x)) return x;
        }
        return 0;
    }
    public static double R2(double v) => Math.Round(v + (v >= 0 ? 1e-7 : -1e-7), 2, MidpointRounding.AwayFromZero);
    private static JsonArray A(JsonNode? n) => n as JsonArray ?? new JsonArray();
    private static JsonObject O(JsonNode? n) => n as JsonObject ?? new JsonObject();
    private static string Day(string s) => s.Length > 10 ? s[..10] : s;

    public sealed record Filters(string From, string To, string Company);
    private sealed record Line(string Date, string Account, string Cc, string Project, double Debit, double Credit);
    private sealed record Tb(string Account, string Name, string Type, double Debit, double Credit, double Balance);

    private static List<Line> Posted(JsonArray journals, Filters f)
    {
        var res = new List<Line>();
        foreach (var jn in journals)
        {
            var j = O(jn); var d = O(j["data"]);
            if (S(j["status"]) != "Posted") continue;
            var dt = Day(S(d["date"]));
            if (dt.Length == 0 || (f.From.Length > 0 && string.CompareOrdinal(dt, f.From) < 0) || (f.To.Length > 0 && string.CompareOrdinal(dt, f.To) > 0)) continue;
            var co = S(j["company"]);
            if (f.Company.Length > 0 && f.Company != "ALL" && co.Length > 0 && co != f.Company) continue;
            var rate = Num(d["rate"]) > 0 ? Num(d["rate"]) : 1;
            foreach (var ln in A(d["lines"]))
            {
                var l = O(ln);
                res.Add(new Line(dt, S(l["account"]), S(l["costCenter"]), S(l["project"]), R2(Num(l["debit"]) * rate), R2(Num(l["credit"]) * rate)));
            }
        }
        return res;
    }

    private static string AccName(JsonObject a)
    {
        var d = O(a["data"]);
        var n = Ar && S(d["nameAr"]).Length > 0 ? S(d["nameAr"]) : S(d["name"]);
        return n.Length > 0 ? n : S(a["code"]);
    }

    private static List<Tb> TrialBalance(List<Line> lines, JsonArray accounts)
    {
        var sums = new Dictionary<string, double[]>();
        foreach (var l in lines)
        {
            if (!sums.TryGetValue(l.Account, out var s)) sums[l.Account] = s = new double[2];
            s[0] += l.Debit; s[1] += l.Credit;
        }
        var rows = new List<Tb>(); var seen = new HashSet<string>();
        foreach (var a in accounts.Select(O).OrderBy(x => S(x["code"]), StringComparer.Ordinal))
        {
            var code = S(a["code"]); seen.Add(code);
            if (!sums.TryGetValue(code, out var s)) continue;
            var type = S(O(a["data"])["type"]);
            var dn = type == "Asset" || type == "Expense";
            rows.Add(new Tb(code, AccName(a), type, R2(s[0]), R2(s[1]), R2(dn ? s[0] - s[1] : s[1] - s[0])));
        }
        foreach (var (code, s) in sums) if (!seen.Contains(code)) rows.Add(new Tb(code, code, "", R2(s[0]), R2(s[1]), R2(s[0] - s[1])));
        return rows;
    }

    private static double SumType(List<Tb> tb, string type) => R2(tb.Where(r => r.Type == type).Sum(r => r.Balance));
    private static double InvoiceTotal(JsonObject d) => Num(d["total"]) > 0 ? Num(d["total"]) : Num(d["amount"]) + Num(d["taxAmount"]);
    private static double Outstanding(JsonObject r)
    {
        var d = O(r["data"]);
        return R2((InvoiceTotal(d) - Num(d["paid"])) * (Num(d["rate"]) > 0 ? Num(d["rate"]) : 1));
    }
    private static int BucketOf(int late) => late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;

    /// <summary>data: record kind -> array of finance rows ("summary" -> the summary object, "audit" -> the audit rows)</summary>
    public static (List<string[]> rows, List<object?> payloads, string foot) Build(string rid, Dictionary<string, JsonNode?> data, Filters f, string today)
    {
        var rows = new List<string[]>(); var pay = new List<object?>(); var foot = "";
        void Add(params string[] r) { rows.Add(r); pay.Add(null); }
        JsonNode? Get(string k) => data.TryGetValue(k, out var v) ? v : null;
        if (rid == "overview")
        {
            var s = O(Get("summary"));
            foreach (var m in A(Spec["measures"]))
            {
                var key = (string)m![0]!; string v;
                if (key == "currentPeriod") v = (s[key] is null ? "-" : S(s[key])) + (S(s["currentPeriodStatus"]).Length > 0 ? " (" + S(s["currentPeriodStatus"]) + ")" : "");
                else if (!s.ContainsKey(key)) v = "-";
                else if (key is "assetCount" or "activeProjects" or "journalsToApprove" or "invoicesToApprove") v = ((int)Num(s[key])).ToString(CultureInfo.InvariantCulture);
                else v = Money(Num(s[key]));
                Add((string)m[Ar ? 2 : 1]!, v);
            }
            return (rows, pay, foot);
        }
        var accs = A(Get("account"));
        var types = new Dictionary<string, string>();
        foreach (var a in accs) types[S(O(a)["code"])] = S(O(O(a)["data"])["type"]);
        string Typ(string c) => types.TryGetValue(c, out var t) ? t : "";
        if (rid is "tb" or "income" or "balance" or "budgets" or "projects")
        {
            var lines = Posted(A(Get("journal")), f);
            var tb = TrialBalance(lines, accs);
            switch (rid)
            {
                case "tb":
                    foreach (var r in tb) Add(r.Account, r.Name, r.Type, Money(r.Debit), Money(r.Credit), Money(r.Balance));
                    Add(L("totals"), "", "", Money(R2(tb.Sum(r => r.Debit))), Money(R2(tb.Sum(r => r.Credit))), "");
                    break;
                case "income":
                {
                    double tr = SumType(tb, "Revenue"), te = SumType(tb, "Expense");
                    foreach (var r in tb.Where(r => r.Type == "Revenue")) Add(L("revenue"), r.Account, r.Name, Money(r.Balance));
                    Add(L("totalrev"), "", "", Money(tr));
                    foreach (var r in tb.Where(r => r.Type == "Expense")) Add(L("expense"), r.Account, r.Name, Money(r.Balance));
                    Add(L("totalexp"), "", "", Money(te));
                    Add(L("net"), "", "", Money(R2(tr - te)));
                    break;
                }
                case "balance":
                {
                    double ta = SumType(tb, "Asset"), tl = SumType(tb, "Liability"), ni = R2(SumType(tb, "Revenue") - SumType(tb, "Expense")), te = R2(SumType(tb, "Equity") + ni);
                    foreach (var r in tb.Where(r => r.Type == "Asset")) Add(L("assets"), r.Account, r.Name, Money(r.Balance));
                    Add(L("totass"), "", "", Money(ta));
                    foreach (var r in tb.Where(r => r.Type == "Liability")) Add(L("liab"), r.Account, r.Name, Money(r.Balance));
                    Add(L("totliab"), "", "", Money(tl));
                    foreach (var r in tb.Where(r => r.Type == "Equity")) Add(L("equity"), r.Account, r.Name, Money(r.Balance));
                    Add(L("netincome"), "", "", Money(ni));
                    Add(L("toteq"), "", "", Money(te));
                    Add(L("check"), "", "", Money(R2(ta - tl - te)));
                    break;
                }
                case "budgets":
                    foreach (var bn in A(Get("budget")))
                    {
                        var d = O(O(bn)["data"]);
                        var year = (int)Num(d["year"]); string cc = S(d["costCenter"]), acc = S(d["account"]);
                        var actual = R2(lines.Where(l => l.Date.StartsWith(year.ToString(CultureInfo.InvariantCulture)) && Typ(l.Account) == "Expense" && (cc.Length == 0 || l.Cc == cc) && (acc.Length == 0 || l.Account == acc)).Sum(l => l.Debit - l.Credit));
                        var budget = Num(d["amount"]);
                        Add(cc, acc, year.ToString(CultureInfo.InvariantCulture), Money(budget), Money(actual), Money(R2(budget - actual)), (budget > 0 ? (int)Math.Round(actual / budget * 100, MidpointRounding.AwayFromZero) : 0).ToString(CultureInfo.InvariantCulture));
                    }
                    break;
                default:
                    foreach (var pn in A(Get("project")))
                    {
                        var code = S(O(pn)["code"]);
                        var mine = lines.Where(l => l.Project == code).ToList();
                        var rev = R2(mine.Where(l => Typ(l.Account) == "Revenue").Sum(l => l.Credit - l.Debit));
                        var cost = R2(mine.Where(l => Typ(l.Account) == "Expense").Sum(l => l.Debit - l.Credit));
                        Add(code, Money(rev), Money(cost), Money(R2(rev - cost)), (rev > 0 ? (int)Math.Round((rev - cost) / rev * 100, MidpointRounding.AwayFromZero) : 0).ToString(CultureInfo.InvariantCulture));
                    }
                    break;
            }
            return (rows, pay, foot);
        }
        if (rid is "ar" or "ap")
        {
            var isAr = rid == "ar";
            var open = isAr ? new[] { "Issued" } : new[] { "Submitted", "Approved", "Held" };
            var key = isAr ? "customer" : "vendor";
            var m = new Dictionary<string, double[]>();
            foreach (var rn in A(Get(isAr ? "arinvoice" : "apinvoice")))
            {
                var r = O(rn); var d = O(r["data"]);
                if (!open.Contains(S(r["status"]))) continue;
                var amt = Outstanding(r);
                if (amt <= 0) continue;
                var due = S(d["dueDate"]).Length > 0 ? S(d["dueDate"]) : S(d["date"]);
                due = due.Length == 0 ? today : Day(due);
                var late = (DateTime.ParseExact(today, "yyyy-MM-dd", CultureInfo.InvariantCulture) - DateTime.ParseExact(due, "yyyy-MM-dd", CultureInfo.InvariantCulture)).Days;
                var p = S(d[key]); if (p.Length == 0) p = "—";
                if (!m.TryGetValue(p, out var b)) m[p] = b = new double[5];
                b[BucketOf(late)] += amt;
            }
            var totals = new double[5]; double all = 0;
            foreach (var kv in m.OrderByDescending(x => x.Value.Sum()))
            {
                var row = new List<string> { kv.Key };
                for (var i = 0; i < 5; i++) { var v = R2(kv.Value[i]); row.Add(Money(v)); totals[i] += v; }
                var t = R2(kv.Value.Sum()); row.Add(Money(t)); all += t;
                Add(row.ToArray());
            }
            Add(new[] { L("totals") }.Concat(totals.Select(x => Money(R2(x)))).Append(Money(R2(all))).ToArray());
            return (rows, pay, foot);
        }
        if (rid == "assets")
        {
            foreach (var an in A(Get("asset")))
            {
                var a = O(an); var d = O(a["data"]);
                double cost = Num(d["cost"]), salvage = Num(d["salvage"]), acc = Num(d["accumulated"]);
                var life = Math.Max(1, (int)Math.Round(Num(d["lifeMonths"]) != 0 ? Num(d["lifeMonths"]) : 60, MidpointRounding.AwayFromZero));
                var nbv = R2(cost - acc);
                var monthly = S(d["method"]) == "DB" ? nbv * (2.0 / life) : (cost - salvage) / life;
                monthly = Math.Max(0, Math.Min(monthly, nbv - salvage));
                var left = monthly > 0 ? (long)Math.Ceiling((nbv - salvage) / Math.Max(monthly, 0.01)) : 0;
                Add(S(a["code"]), S(d["name"]), Money(cost), Money(acc), Money(nbv), Money(R2(monthly)), left.ToString(CultureInfo.InvariantCulture));
            }
            return (rows, pay, foot);
        }
        if (rid == "bank")
        {
            double opening = 0, rec = 0; var un = 0;
            foreach (var an in A(Get("bankaccount")))
            {
                var a = O(an);
                if (f.Company.Length == 0 || S(a["code"]) == f.Company) opening += Num(O(a["data"])["openingBalance"]);
            }
            foreach (var tn in A(Get("banktxn")))
            {
                var t = O(tn); var d = O(t["data"]);
                if (f.Company.Length > 0 && S(d["account"]) != f.Company) continue;
                var done = d["reconciled"] is JsonValue rv && rv.TryGetValue<bool>(out var bb) && bb;
                rows.Add(new[] { S(d["account"]), Day(S(d["date"])), S(d["description"]), Money(Num(d["amount"])), done ? L("yes") : "" }); pay.Add(t);
                if (done) rec += Num(d["amount"]); else un++;
            }
            foot = $"{L("opening")}: {Money(opening)}   {L("reconciledbal")}: {Money(R2(opening + rec))}   {L("unrec")}: {un}";
            return (rows, pay, foot);
        }
        if (rid == "audit")
        {
            foreach (var an in A(Get("audit")))
            {
                var a = O(an);
                var at = S(a["at"]); at = (at.Length > 19 ? at[..19] : at).Replace('T', ' ');
                Add(at, S(a["userName"]), S(a["action"]), S(a["kind"]), S(a["code"]), S(a["summary"]));
            }
        }
        return (rows, pay, foot);
    }

    public static readonly Dictionary<string, string> View = new()
    {
        ["overview"] = "finance.reports.view", ["tb"] = "finance.gl.view", ["income"] = "finance.gl.view", ["balance"] = "finance.gl.view", ["ar"] = "finance.ar.view", ["ap"] = "finance.ap.view",
        ["budgets"] = "finance.budget.view", ["projects"] = "finance.projects.view", ["assets"] = "finance.assets.view", ["bank"] = "finance.bank.view", ["audit"] = "finance.audit.view"
    };

    public static string[] KindsOf(string id) => id switch
    {
        "tb" or "income" or "balance" => new[] { "account", "journal" },
        "ar" => new[] { "arinvoice" }, "ap" => new[] { "apinvoice" },
        "budgets" => new[] { "account", "journal", "budget" }, "projects" => new[] { "account", "journal", "project" },
        "assets" => new[] { "asset" }, "bank" => new[] { "bankaccount", "banktxn" }, _ => Array.Empty<string>()
    };

    public static async Task<Dictionary<string, JsonNode?>> Fetch(string id, string company)
    {
        var res = new Dictionary<string, JsonNode?>();
        if (id == "overview") { res["summary"] = await Api.I.Fin(HttpMethod.Get, "summary" + (company.Length > 0 ? "?company=" + Uri.EscapeDataString(company) : "")); return res; }
        if (id == "audit") { res["audit"] = await Api.I.Fin(HttpMethod.Get, "audit"); return res; }
        foreach (var k in KindsOf(id))
        {
            var scoped = id != "bank" && k is "journal" or "arinvoice" or "apinvoice" or "budget" or "asset";
            try { res[k] = await Api.I.Fin(HttpMethod.Get, "records/" + k + "?take=2000" + (scoped && company.Length > 0 ? "&company=" + Uri.EscapeDataString(company) : "")); }
            catch { res[k] = new JsonArray(); }   // a list the user may not read stays empty
        }
        return res;
    }
}

public sealed class FinanceView : PageView
{
    private readonly List<JsonNode> _reports = new();
    private readonly ComboBox _pick = new() { MinWidth = 220, Margin = new Thickness(0, 0, 8, 0) };
    private readonly TextBox _from = Ui.Input(DateTime.Today.ToString("yyyy-01-01")), _to = Ui.Input(), _company = Ui.Input();
    private readonly TextBlock _foot = new() { Margin = new Thickness(0, 6, 0, 0) }, _msg = new() { Margin = new Thickness(0, 4, 0, 0) };
    private readonly Button _bRec, _bUnrec, _bSeed;
    private DataGrid _grid = Ui.Grid();
    private readonly Border _gridHost = new() { MinHeight = 360 };
    private string _current = "";
    private bool _loading;

    public FinanceView()
    {
        foreach (var r in (JsonArray)FinEngine.Spec["reports"]!)
            if (Api.I.Can(FinEngine.View[(string)r!["id"]!])) { _reports.Add(r!); _pick.Items.Add(FinEngine.Tx(r)); }
        Root.Children.Add(Ui.Text(FinEngine.L("title"), 20, true));
        _from.Width = _to.Width = 120; _company.Width = 100;
        _from.ToolTip = FinEngine.L("from") + " yyyy-mm-dd"; _to.ToolTip = FinEngine.L("to") + " yyyy-mm-dd"; _company.ToolTip = FinEngine.L("company");
        _bRec = Ui.Btn(FinEngine.L("reconcile"), () => _ = Safe(() => Mark(true)));
        _bUnrec = Ui.Btn(FinEngine.L("unreconcile"), () => _ = Safe(() => Mark(false)));
        _bSeed = Ui.Btn(FinEngine.L("seed"), () => _ = Safe(Seed), "ghost");
        var bar = new WrapPanel { Margin = new Thickness(0, 8, 0, 8) };
        foreach (UIElement e in new UIElement[] { _pick, _from, _to, _company, Ui.Btn(FinEngine.L("refresh"), () => _ = Safe(Reload)), _bRec, _bUnrec, _bSeed }) bar.Children.Add(e);
        _pick.SelectionChanged += async (_, _) => { if (!_loading) await Safe(Reload); };
        Root.Children.Add(bar);
        _gridHost.Child = _grid;
        Root.Children.Add(_gridHost);
        Root.Children.Add(_foot);
        Root.Children.Add(_msg);
    }

    private JsonNode? Rep => _pick.SelectedIndex >= 0 && _pick.SelectedIndex < _reports.Count ? _reports[_pick.SelectedIndex] : null;

    public override async Task Reload()
    {
        _loading = true;
        if (_pick.SelectedIndex < 0 && _pick.Items.Count > 0) _pick.SelectedIndex = 0;
        _loading = false;
        var rep = Rep;
        if (rep is null) { _msg.Text = FinEngine.L("noperm"); return; }
        var id = (string)rep["id"]!;
        _current = id;
        var dates = rep["dates"] is JsonValue dv && dv.TryGetValue<bool>(out var db) && db;
        _from.Visibility = _to.Visibility = dates ? Visibility.Visible : Visibility.Collapsed;
        var manage = id == "bank" && Api.I.Can("finance.bank.manage");
        _bRec.Visibility = _bUnrec.Visibility = manage ? Visibility.Visible : Visibility.Collapsed;
        _bSeed.Visibility = id == "tb" && Api.I.Can("finance.setup") ? Visibility.Visible : Visibility.Collapsed;
        _grid = Ui.Grid(((JsonArray)rep["cols"]!).Select(c => FinEngine.Tx(c)).ToArray());
        _gridHost.Child = _grid;
        _msg.Text = "…";
        var f = new FinEngine.Filters(_from.Text.Trim(), _to.Text.Trim(), _company.Text.Trim());
        var data = await FinEngine.Fetch(id, f.Company);
        if (id != _current) return;
        var (rows, pay, foot) = FinEngine.Build(id, data, f, DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        Ui.Fill(_grid, rows.Select((r, i) => (r, (object)(pay[i] ?? "")))) ;
        _foot.Text = foot;
        _msg.Text = rows.Count == 0 ? FinEngine.L("empty") : "";
    }

    private async Task Mark(bool value)
    {
        if (Ui.Selected<JsonObject>(_grid) is not { } rec) return;
        var d = rec["data"]?.DeepClone() as JsonObject ?? new JsonObject();
        d["reconciled"] = value;
        var body = new JsonObject { ["code"] = rec["code"]?.DeepClone(), ["company"] = rec["company"]?.DeepClone(), ["status"] = rec["status"]?.DeepClone(), ["data"] = d };
        await Api.I.Fin(HttpMethod.Put, "records/banktxn/" + FinEngine.S(rec["id"]), body);
        await Reload();
    }

    private async Task Seed()
    {
        var r = await Api.I.Fin(HttpMethod.Post, "accounts/seed", new JsonObject());
        _msg.Text = FinEngine.L("seeded", (int)FinEngine.Num(r?["created"]));
        await Reload();
    }
}
