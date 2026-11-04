using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace WorkflowErp.Services;

/// <summary>Business-intelligence layer: workflow instances -> ERP documents, dashboard KPIs and report tables (port of the portal's erp-data.service.ts).
/// The stage / module mappings come from dashboard.json, shared by every desktop app.</summary>
public static class Bi
{
    private static readonly JsonObject Spec = (JsonNode.Parse(Loc.ReadData("dashboard.json")) as JsonObject) ?? new JsonObject();
    public static readonly string[] Stages = Spec["stages"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray();
    public static readonly Dictionary<string, string> ModuleColors = Spec["modules"]!.AsObject().ToDictionary(p => p.Key, p => p.Value!.GetValue<string>());

    public sealed class Doc
    {
        public string Id = "", Type = "", Module = "", Number = "", Title = "", Party = "", Currency = "", Branch = "", Stage = "", Step = "", Status = "", By = "";
        public double Total; public bool HasTotal;
        public DateTimeOffset Date; public DateTimeOffset? Completed;
        public double Age;
        public JsonObject Inst = new();
    }
    public sealed class Kpis { public double SalesMonth, PurchasesMonth, ExpensesMonth, Receivables, Payables, Pipeline, Committed, InTransit, AvgCycleDays, RejectRate; public int OpenDocs, CompletedMonth, MyApprovals; }
    public sealed class Month { public int Year, Mon; public double Sales, Purchases; }
    public sealed class StageCount { public int Count; public double Value; }
    public sealed class Group { public string Key = ""; public int Count, Pending, Approved, Rejected, NDone; public double Days, Value; public double AvgDays => NDone == 0 ? 0 : Days / NDone; }
    public sealed class Step { public string Name = ""; public double AvgHours; public int Count; }
    public sealed class Party { public string Name = ""; public double Value; public int Count; }

    private static string S(JsonNode? n) => n is null ? "" : n is JsonValue v ? (v.TryGetValue<string>(out var s) ? s : v.ToString()) : n.ToJsonString();
    private static DateTimeOffset? Dt(JsonNode? n) => DateTimeOffset.TryParse(S(n), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d : null;
    private static DateTimeOffset Now => DateTimeOffset.UtcNow;
    private static bool InMonth(DateTimeOffset? d) => d is { } x && x.Month == Now.Month && x.Year == Now.Year;

    private static string Outcome(JsonObject i)
    {
        var st = S(i["status"]);
        if (st == "Running") return "pending";
        if (st == "Terminated") return "canceled";
        var rej = new Regex(S(Spec["rejectActions"]), RegexOptions.IgnoreCase);
        foreach (var h in i["history"] as JsonArray ?? new JsonArray())
        {
            var a = S(h?["action"]);
            if (rej.IsMatch(a) || (a == "Entered" && S(h?["nodeName"]).Contains("reject", StringComparison.OrdinalIgnoreCase))) return "rejected";
        }
        return "approved";
    }

    private static string StageForNode(string? n)
    {
        if (string.IsNullOrEmpty(n)) return "request";
        var map = Spec["nodeStage"]!.AsObject();
        if (map.TryGetPropertyValue(n, out var d) && d != null) return S(d);
        var low = n.ToLowerInvariant();
        foreach (var k in Spec["stageKeywords"]!.AsArray()) if (Regex.IsMatch(low, S(k![1]))) return S(k[0]);
        return "request";
    }

    private static string ModuleFor(string wf)
    {
        foreach (var d in Spec["docTypes"]!.AsArray()) if (S(d!["workflow"]) == wf) return S(d["module"]);
        var low = wf.ToLowerInvariant();
        foreach (var k in Spec["moduleKeywords"]!.AsArray()) if (Regex.IsMatch(low, S(k![1]))) return S(k[0]);
        return "operations";
    }

    public static Doc ToDoc(JsonObject i)
    {
        var d = new Doc();
        var data = i["data"] as JsonObject ?? new JsonObject();
        JsonNode? dt = null;
        foreach (var o in Spec["docTypes"]!.AsArray()) if (S(o!["key"]) == S(data["docType"])) { dt = o; break; }
        if (dt == null) foreach (var o in Spec["docTypes"]!.AsArray()) if (S(o!["workflow"]) == S(i["definitionName"])) { dt = o; break; }
        d.Type = dt == null ? "" : S(dt["key"]);
        d.Module = dt == null ? ModuleFor(S(i["definitionName"])) : S(dt["module"]);
        d.Status = Outcome(i);
        var hist = i["history"] as JsonArray ?? new JsonArray();
        string? last = null;
        var skip = new Regex("^(start|end|completed|rejected)$", RegexOptions.IgnoreCase);
        for (var k = hist.Count - 1; k >= 0; k--)
            if (S(hist[k]?["action"]) == "Entered" && !skip.IsMatch(S(hist[k]?["nodeName"]))) { last = S(hist[k]?["nodeName"]); break; }
        if (d.Status == "approved") { d.Stage = "reporting"; d.Step = "Completed"; }
        else if (d.Status == "pending") { d.Stage = StageForNode(last); d.Step = last ?? "Start"; }
        else { d.Stage = StageForNode(last); d.Step = d.Status == "rejected" ? "Rejected" : "Canceled"; }
        d.Id = S(i["id"]); d.Inst = i; d.Title = S(i["definitionName"]);
        var dn = S(data["docNumber"]);
        d.Number = dn.Length > 0 ? dn : "WF-" + (d.Id.Length > 6 ? d.Id[..6] : d.Id).ToUpperInvariant();
        foreach (var k in new[] { "party", "employeeName", "candidateName" }) if (d.Party.Length == 0) d.Party = S(data[k]);
        if (data["total"] is JsonValue tv)
        {
            if (tv.TryGetValue<double>(out var dbl)) { d.Total = dbl; d.HasTotal = true; }
            else if (double.TryParse(S(tv), NumberStyles.Float, CultureInfo.InvariantCulture, out var p)) { d.Total = p; d.HasTotal = true; }
        }
        d.Currency = S(data["currency"]); d.Branch = S(data["branch"]); d.By = S(i["startedBy"]);
        d.Date = Dt(i["startedAt"]) ?? Now; d.Completed = Dt(i["completedAt"]);
        d.Age = Math.Max(0, ((d.Completed ?? Now) - d.Date).TotalDays);
        return d;
    }

    public static List<Doc> DocsOf(JsonArray instances) => instances.OfType<JsonObject>().Select(ToDoc).OrderByDescending(d => d.Date).ToList();

    public static Kpis ComputeKpis(List<Doc> docs, int myTasks)
    {
        var k = new Kpis { MyApprovals = myTasks };
        int done = 0, closed = 0, rejected = 0; double days = 0;
        foreach (var d in docs)
        {
            bool pend = d.Status == "pending", appr = d.Status == "approved";
            if (appr && InMonth(d.Completed))
            {
                if (d.Type == "SO") k.SalesMonth += d.Total;
                if (d.Type == "PR") k.PurchasesMonth += d.Total;
                if (d.Type == "EXP" || d.Type == "PV") k.ExpensesMonth += d.Total;
                k.CompletedMonth++;
            }
            if (pend)
            {
                k.OpenDocs++;
                if (d.Type == "SO") { k.Pipeline += d.Total; if (d.Stage == "accounting") k.Receivables += d.Total; }
                if (d.Stage == "accounting" && (d.Type == "PR" || d.Type == "PV" || d.Type == "EXP")) k.Payables += d.Total;
                if (d.Type == "PR" && (d.Stage == "purchase" || d.Stage == "inventory")) k.Committed += d.Total;
                if (d.Type == "TRF" && d.Stage == "inventory") k.InTransit += d.Total;
            }
            if (appr) { done++; days += d.Age; }
            if (appr || d.Status == "rejected") closed++;
            if (d.Status == "rejected") rejected++;
        }
        k.AvgCycleDays = done > 0 ? days / done : 0; k.RejectRate = closed > 0 ? (double)rejected / closed : 0;
        return k;
    }

    public static List<Month> MonthlyTrend(List<Doc> docs, int months = 6)
    {
        var first = new DateTime(Now.Year, Now.Month, 1);
        var list = new List<Month>();
        for (var k = months - 1; k >= 0; k--) { var d = first.AddMonths(-k); list.Add(new Month { Year = d.Year, Mon = d.Month }); }
        foreach (var d in docs)
        {
            if (d.Status != "approved" || d.Completed == null || !d.HasTotal) continue;
            foreach (var m in list)
                if (m.Year == d.Completed.Value.Year && m.Mon == d.Completed.Value.Month) { if (d.Type == "SO") m.Sales += d.Total; if (d.Type == "PR") m.Purchases += d.Total; }
        }
        return list;
    }

    public static Dictionary<string, StageCount> StageCounts(List<Doc> docs)
    {
        var r = Stages.ToDictionary(s => s, _ => new StageCount());
        var raised = new StageCount();
        foreach (var d in docs)
        {
            if (d.Status == "pending" || d.Status == "approved") { var c = r[d.Status == "pending" ? d.Stage : "reporting"]; c.Count++; c.Value += d.Total; }
            if (d.Date.Month == Now.Month && d.Date.Year == Now.Year) { raised.Count++; raised.Value += d.Total; }
        }
        r["request"] = raised;
        return r;
    }

    public static List<Step> StepTurnaround(List<Doc> docs)
    {
        var acc = new Dictionary<string, (double hours, int n)>();
        foreach (var d in docs)
        {
            var h = d.Inst["history"] as JsonArray ?? new JsonArray();
            for (var k = 0; k < h.Count; k++)
            {
                if (S(h[k]?["action"]) != "Entered") continue;
                for (var j = k + 1; j < h.Count; j++)
                {
                    var a = S(h[j]?["action"]);
                    if (S(h[j]?["nodeId"]) != S(h[k]?["nodeId"]) || a == "Entered" || a == "Logged" || S(h[j]?["actor"]) == "system") continue;
                    var t0 = Dt(h[k]?["timestamp"]); var t1 = Dt(h[j]?["timestamp"]);
                    if (t0 != null && t1 != null)
                    {
                        var name = S(h[k]?["nodeName"]);
                        acc.TryGetValue(name, out var cur);
                        acc[name] = (cur.hours + (t1.Value - t0.Value).TotalHours, cur.n + 1);
                    }
                    break;
                }
            }
        }
        return acc.Select(p => new Step { Name = p.Key, AvgHours = p.Value.hours / p.Value.n, Count = p.Value.n }).OrderByDescending(s => s.AvgHours).ToList();
    }

    public static List<Party> TopParties(List<Doc> docs, string[] types, int limit = 5)
    {
        var m = new Dictionary<string, Party>();
        foreach (var d in docs)
        {
            if (!types.Contains(d.Type) || d.Party.Length == 0 || d.Status == "canceled" || d.Status == "rejected") continue;
            if (!m.TryGetValue(d.Party, out var p)) m[d.Party] = p = new Party { Name = d.Party };
            p.Value += d.Total; p.Count++;
        }
        return m.Values.OrderByDescending(p => p.Value).Take(limit).ToList();
    }

    public static List<Group> GroupBy(List<Doc> docs, bool byModule)
    {
        var g = new Dictionary<string, Group>();
        foreach (var d in docs)
        {
            var k = byModule ? d.Module : d.Branch; if (k.Length == 0) k = "—";
            if (!g.TryGetValue(k, out var r)) g[k] = r = new Group { Key = k };
            r.Count++; r.Value += d.Total;
            switch (d.Status) { case "pending": r.Pending++; break; case "approved": r.Approved++; r.Days += d.Age; r.NDone++; break; case "rejected": r.Rejected++; break; }
        }
        return g.Values.OrderByDescending(r => r.Count).ToList();
    }

    public static List<(string step, int count)> Bottleneck(List<Doc> docs)
        => docs.Where(d => d.Status == "pending").GroupBy(d => d.Step).Select(x => (x.Key, x.Count())).OrderByDescending(x => x.Item2).ToList();

    public static string Money(double v, string cur = "") => Math.Round(v).ToString("N0", CultureInfo.InvariantCulture) + (cur.Length > 0 ? " " + cur : "");
}
