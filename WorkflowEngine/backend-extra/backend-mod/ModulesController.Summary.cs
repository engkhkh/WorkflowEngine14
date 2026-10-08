using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Controllers;

public partial class ModulesController
{
    private static Kpi K(string k, decimal v, string t = "n") => new() { K = k, V = v, T = t };
    private static SeriesDto S(string k, IEnumerable<(string name, decimal value)> rows) => new() { K = k, Rows = rows.Select(r => new SeriesRow { Name = r.name, Value = R2(r.value) }).ToList() };

    private async Task<SummaryDto?> BuildSummary(string tenantId, string module, string? company)
    {
        var q = _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == module);
        if (!string.IsNullOrWhiteSpace(company) && company != "ALL") q = q.Where(r => r.Company == company || r.Company == null || r.Company == "");
        var all = (await q.ToListAsync()).Select(r => (r, d: FinJson.Obj(r.Data))).ToList();
        IEnumerable<(ErpRecord r, JsonElement d)> Kd(string k) => all.Where(x => x.r.Kind == k);
        IEnumerable<(string, decimal)> Cnt(string k) => Kd(k).GroupBy(x => x.r.Status ?? "").Select(g => (g.Key, (decimal)g.Count()));
        var now = DateTime.UtcNow; var today = now.Date; var month = new DateTime(now.Year, now.Month, 1);
        bool Late(JsonElement d, string key) => FinJson.TryDate(d, key, out var du) && du.Date < today;
        var s = new SummaryDto { Module = module };

        switch (module)
        {
            case "mfg":
                {
                    var wos = Kd("workorder").ToList(); var done = wos.Where(x => x.r.Status == "Completed").ToList(); var dm = done.Where(x => x.r.UpdatedAt >= month).ToList();
                    var insp = Kd("inspection").Where(x => x.r.Status != "Pending").ToList();
                    s.Kpis.AddRange(new[] {
                        K("open", wos.Count(x => x.r.Status is "Planned" or "Released" or "InProgress")), K("inProgress", wos.Count(x => x.r.Status == "InProgress")),
                        K("late", wos.Count(x => x.r.Status is "Planned" or "Released" or "InProgress" && Late(x.d, "due"))), K("producedMonth", R2(dm.Sum(x => FinJson.D(x.d, "goodQty")))),
                        K("scrapMonth", R2(dm.Sum(x => FinJson.D(x.d, "scrapQty")))), K("costMonth", R2(dm.Sum(x => FinJson.D(x.d, "actualCost"))), "m"), K("variance", R2(done.Sum(x => FinJson.D(x.d, "variance"))), "m"),
                        K("passRate", insp.Count == 0 ? 100 : Math.Round(100m * insp.Count(x => x.r.Status == "Passed") / insp.Count, 1), "p"), K("maintenanceOpen", Kd("maintenance").Count(x => x.r.Status == "Open")) });
                    s.Lists.Add(S("byStatus", Cnt("workorder"))); s.Lists.Add(S("byProduct", done.GroupBy(x => FinJson.S(x.d, "sku")).Select(g => (g.Key, g.Sum(x => FinJson.D(x.d, "goodQty")))).OrderByDescending(x => x.Item2).Take(8)));
                    break;
                }
            case "prj":
                {
                    var projects = Kd("project").ToList();
                    var rows = projects.Select(p =>
                    {
                        var code = p.r.Code;
                        var ts = Kd("timesheet").Where(x => x.r.Ref == code && x.r.Status != "Rejected").ToList(); var cost = Kd("cost").Where(x => x.r.Ref == code).ToList();
                        var actual = ts.Sum(x => FinJson.D(x.d, "hours") * FinJson.D(x.d, "costRate")) + cost.Sum(x => FinJson.D(x.d, "amount"));
                        return (code: code ?? "", budget: FinJson.Lines(p.d).Sum(l => FinJson.D(l, "amount")), actual, billed: FinJson.D(p.d, "billed"));
                    }).ToList();
                    s.Kpis.AddRange(new[] { K("active", projects.Count(x => x.r.Status == "Active")), K("budget", R2(rows.Sum(x => x.budget)), "m"), K("actual", R2(rows.Sum(x => x.actual)), "m"), K("billed", R2(rows.Sum(x => x.billed)), "m"),
                        K("margin", R2(rows.Sum(x => x.billed) - rows.Sum(x => x.actual)), "m"), K("hoursMonth", R2(Kd("timesheet").Where(x => FinJson.TryDate(x.d, "date", out var dd) && dd >= month).Sum(x => FinJson.D(x.d, "hours")))),
                        K("pendingTimesheets", Kd("timesheet").Count(x => x.r.Status == "Submitted")), K("overBudget", rows.Count(x => x.budget > 0 && x.actual > x.budget)) });
                    s.Lists.Add(S("byStatus", Cnt("project"))); s.Lists.Add(S("margin", rows.Select(x => (x.code, x.billed - x.actual)).OrderByDescending(x => Math.Abs(x.Item2)).Take(8)));
                    break;
                }
            case "crm":
                {
                    var opps = Kd("opportunity").ToList(); var open = opps.Where(x => x.r.Status == "Open").ToList(); var won = opps.Where(x => x.r.Status == "Won").ToList(); var lost = opps.Where(x => x.r.Status == "Lost").ToList();
                    s.Kpis.AddRange(new[] { K("openCount", open.Count), K("pipeline", R2(open.Sum(x => FinJson.D(x.d, "amount"))), "m"), K("weighted", R2(open.Sum(x => FinJson.D(x.d, "amount") * FinJson.D(x.d, "probability") / 100m)), "m"),
                        K("wonMonth", R2(won.Where(x => x.r.UpdatedAt >= month).Sum(x => FinJson.D(x.d, "amount"))), "m"), K("winRate", won.Count + lost.Count == 0 ? 0 : Math.Round(100m * won.Count / (won.Count + lost.Count), 1), "p"),
                        K("leadsNew", Kd("lead").Count(x => x.r.Status == "New")), K("activitiesDue", Kd("activity").Count(x => x.r.Status == "Open" && FinJson.TryDate(x.d, "due", out var du) && du.Date <= today)) });
                    s.Lists.Add(S("byStage", open.GroupBy(x => FinJson.S(x.d, "stage")).Select(g => (g.Key, g.Sum(x => FinJson.D(x.d, "amount")))))); s.Lists.Add(S("leadsByStatus", Cnt("lead")));
                    s.Lists.Add(S("bySource", Kd("lead").GroupBy(x => FinJson.S(x.d, "source") is "" ? "—" : FinJson.S(x.d, "source")).Select(g => (g.Key, (decimal)g.Count())).OrderByDescending(x => x.Item2)));
                    s.Lists.Add(S("topOpen", open.OrderByDescending(x => FinJson.D(x.d, "amount")).Take(6).Select(x => (FinJson.S(x.d, "name"), FinJson.D(x.d, "amount")))));
                    break;
                }
            case "proc":
                {
                    var pos = Kd("po").ToList();
                    s.Kpis.AddRange(new[] { K("pendingReq", Kd("requisition").Count(x => x.r.Status == "Submitted")), K("openPo", pos.Count(x => x.r.Status is "Draft" or "Approved" or "Sent" or "PartiallyReceived")),
                        K("awaitingReceipt", pos.Count(x => x.r.Status is "Sent" or "Approved" or "PartiallyReceived")), K("latePo", pos.Count(x => x.r.Status is "Sent" or "Approved" or "PartiallyReceived" && Late(x.d, "expected"))),
                        K("spendMonth", R2(pos.Where(x => x.r.Status != "Cancelled" && x.r.CreatedAt >= month).Sum(x => FinJson.D(x.d, "total"))), "m"), K("contractsExpiring", Kd("contract").Count(x => x.r.Status == "Active" && FinJson.TryDate(x.d, "end", out var e) && e.Date <= today.AddDays(60))) });
                    s.Lists.Add(S("poByStatus", Cnt("po"))); s.Lists.Add(S("spendByVendor", pos.Where(x => x.r.Status != "Cancelled").GroupBy(x => FinJson.S(x.d, "vendor")).Select(g => (g.Key, g.Sum(x => FinJson.D(x.d, "total")))).OrderByDescending(x => x.Item2).Take(8)));
                    break;
                }
            case "scm":
                {
                    var sh = Kd("shipment").ToList(); var dl = sh.Where(x => x.r.Status == "Delivered").ToList();
                    var onTime = dl.Count(x => !FinJson.TryDate(x.d, "eta", out var eta) || !FinJson.TryDate(x.d, "delivered", out var dv) || dv.Date <= eta.Date);
                    s.Kpis.AddRange(new[] { K("inTransit", sh.Count(x => x.r.Status is "Dispatched" or "InTransit")), K("delayed", sh.Count(x => x.r.Status == "Delayed" || (x.r.Status is "Dispatched" or "InTransit" && Late(x.d, "eta")))),
                        K("onTimePct", dl.Count == 0 ? 100 : Math.Round(100m * onTime / dl.Count, 1), "p"), K("forecastQty", R2(Kd("forecast").Where(x => x.r.Status != "Cancelled").Sum(x => FinJson.D(x.d, "qty")))), K("carriers", Kd("carrier").Count(x => x.r.Status == "Active")) });
                    s.Lists.Add(S("shipments", Cnt("shipment"))); s.Lists.Add(S("forecast", Kd("forecast").GroupBy(x => FinJson.S(x.d, "sku")).Select(g => (g.Key, g.Sum(x => FinJson.D(x.d, "qty")))).OrderByDescending(x => x.Item2).Take(8)));
                    break;
                }
            case "wh":
                {
                    var sq = _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "stock");
                    if (!string.IsNullOrWhiteSpace(company) && company != "ALL") sq = sq.Where(r => r.Company == company || r.Company == null || r.Company == "");
                    var stock = (await sq.ToListAsync()).Select(r => (r, d: FinJson.Obj(r.Data))).ToList();
                    var prods = (await _db.PosRecords.AsNoTracking().Where(p => p.TenantId == tenantId && p.Kind == "product").ToListAsync()).ToDictionary(p => p.Code ?? "", p => FinJson.Obj(p.Data));
                    decimal val(JsonElement d) => FinJson.D(d, "qty") * (prods.TryGetValue(FinJson.S(d, "sku"), out var pd) ? FinJson.D(pd, "cost") : 0m);
                    s.Kpis.AddRange(new[] { K("skus", stock.Select(x => FinJson.S(x.d, "sku")).Distinct().Count()), K("stockValue", R2(stock.Sum(x => val(x.d))), "m"),
                        K("lowStock", stock.Count(x => prods.TryGetValue(FinJson.S(x.d, "sku"), out var pd) && FinJson.D(pd, "reorder") > 0 && FinJson.D(x.d, "qty") <= FinJson.D(pd, "reorder"))),
                        K("openPicks", Kd("pick").Count(x => x.r.Status == "Open")), K("openCounts", Kd("count").Count(x => x.r.Status == "Draft")), K("locations", Kd("location").Count(x => x.r.Status == "Active")) });
                    s.Lists.Add(S("valueByBranch", stock.GroupBy(x => x.r.Branch ?? "").Select(g => (g.Key == "" ? "—" : g.Key, g.Sum(x => val(x.d)))))); s.Lists.Add(S("picks", Cnt("pick")));
                    break;
                }
            case "ast":
                {
                    var wos = Kd("workorder").ToList();
                    s.Kpis.AddRange(new[] { K("assets", Kd("asset").Count(x => x.r.Status != "Retired")), K("down", Kd("asset").Count(x => x.r.Status == "Down")), K("dueMaintenance", Kd("plan").Count(x => x.r.Status == "Active" && FinJson.TryDate(x.d, "nextDue", out var nd) && nd.Date <= today)),
                        K("openWo", wos.Count(x => x.r.Status is "Open" or "InProgress")), K("maintCostMonth", R2(wos.Where(x => x.r.Status == "Completed" && x.r.UpdatedAt >= month).Sum(x => FinJson.D(x.d, "actualCost"))), "m"),
                        K("assetValue", R2(Kd("asset").Where(x => x.r.Status != "Retired").Sum(x => FinJson.D(x.d, "cost"))), "m") });
                    s.Lists.Add(S("woByStatus", Cnt("workorder"))); s.Lists.Add(S("byCategory", Kd("asset").GroupBy(x => FinJson.S(x.d, "category") is "" ? "—" : FinJson.S(x.d, "category")).Select(g => (g.Key, (decimal)g.Count()))));
                    break;
                }
            case "pay":
                {
                    var runs = Kd("run").OrderByDescending(x => FinJson.S(x.d, "period")).ToList(); var last = runs.FirstOrDefault(x => x.r.Status is "Posted" or "Approved" or "Calculated");
                    s.Kpis.AddRange(new[] { K("lastNet", last.r == null ? 0 : FinJson.D(last.d, "net"), "m"), K("lastGross", last.r == null ? 0 : FinJson.D(last.d, "gross"), "m"), K("lastCount", last.r == null ? 0 : FinJson.D(last.d, "count")), K("openRuns", runs.Count(x => x.r.Status is "Draft" or "Calculated" or "Approved")), K("elements", Kd("element").Count(x => x.r.Status == "Active")) });
                    s.Lists.Add(S("netByPeriod", runs.Where(x => x.r.Status != "Draft").Take(12).Reverse().Select(x => (FinJson.S(x.d, "period"), FinJson.D(x.d, "net")))));
                    break;
                }
            case "epm":
                {
                    var plans = Kd("plan").ToList(); var lines = Kd("line").ToList();
                    s.Kpis.AddRange(new[] { K("plans", plans.Count), K("approved", plans.Count(x => x.r.Status is "Approved" or "Published")), K("planTotal", R2(lines.Sum(x => FinJson.D(x.d, "amount"))), "m"), K("forecastTotal", R2(Kd("forecast").Sum(x => FinJson.D(x.d, "amount"))), "m") });
                    s.Lists.Add(S("byCostCenter", lines.GroupBy(x => FinJson.S(x.d, "costCenter") is "" ? "—" : FinJson.S(x.d, "costCenter")).Select(g => (g.Key, g.Sum(x => FinJson.D(x.d, "amount")))).OrderByDescending(x => x.Item2).Take(10)));
                    s.Lists.Add(S("plansByStatus", Cnt("plan")));
                    break;
                }
            case "bpm":
                s.Kpis.AddRange(new[] { K("processes", Kd("process").Count(x => x.r.Status == "Active")), K("avgSla", Kd("process").Any() ? Math.Round(Kd("process").Average(x => FinJson.D(x.d, "slaHours")), 1) : 0) });
                s.Lists.Add(S("byOwner", Kd("process").GroupBy(x => FinJson.S(x.d, "owner") is "" ? "—" : FinJson.S(x.d, "owner")).Select(g => (g.Key, (decimal)g.Count()))));
                break;
            case "int":
                {
                    var logs = Kd("log").Where(x => x.r.CreatedAt >= now.AddDays(-7)).ToList();
                    s.Kpis.AddRange(new[] { K("keys", Kd("apikey").Count(x => x.r.Status == "Active")), K("hooks", Kd("webhook").Count(x => x.r.Status == "Active")), K("deliveries", logs.Count), K("failures", logs.Count(x => x.r.Status == "Failed")) });
                    s.Lists.Add(S("byEvent", logs.GroupBy(x => FinJson.S(x.d, "event")).Select(g => (g.Key, (decimal)g.Count()))));
                    break;
                }
            case "bi":
                s.Kpis.Add(K("reports", Kd("report").Count()));
                break;
            default: return null;
        }
        return s;
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(string module, [FromQuery] string? company)
    {
        if (!Modules.Contains(module) || module == "bi") return NotFound();
        if (!await Has(module + ".reports.view") && !(module is "bpm" or "int" && await Has(module + ".view"))) return Forbid();
        var s = await BuildSummary(await _tenant.TenantIdOf(User), module, company);
        return s == null ? NotFound() : Ok(s);
    }

    /// <summary>Headline numbers of every module the caller may see - the BI home page.</summary>
    [HttpGet("overview")]
    public async Task<IActionResult> BiOverview(string module, [FromQuery] string? company)
    {
        if (module != "bi" || !await Has("bi.view")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var list = new List<SummaryDto>();
        foreach (var m in Modules.Where(x => x != "bi"))
            if (await Has(m + ".reports.view") || (m is "bpm" or "int" && await Has(m + ".view")))
            { var s = await BuildSummary(tenantId, m, company); if (s != null) list.Add(s); }
        return Ok(list);
    }

    /// <summary>Rule-based findings across the modules the caller can see (AI insights): each is a code the client turns into a sentence.</summary>
    [HttpGet("insights")]
    public async Task<IActionResult> Insights(string module, [FromQuery] string? company)
    {
        if (module != "bi" || !await Has("bi.view")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var res = new List<InsightDto>();
        void Add(string code, string m, string level, decimal n, string? r = null) { if (n > 0) res.Add(new InsightDto { Code = code, Module = m, Level = level, N = n, Ref = r }); }
        var today = DateTime.UtcNow.Date;
        foreach (var m in Modules.Where(x => x != "bi"))
        {
            if (!await Has(m + ".reports.view") && !(m is "bpm" or "int" && await Has(m + ".view"))) continue;
            var s = await BuildSummary(tenantId, m, company); if (s == null) continue;
            decimal V(string k) => s.Kpis.FirstOrDefault(x => x.K == k)?.V ?? 0;
            switch (m)
            {
                case "mfg": Add("mfg.late", m, "warn", V("late")); if (V("passRate") < 95) Add("mfg.quality", m, "warn", V("passRate")); if (V("variance") > 0) Add("mfg.variance", m, "info", V("variance")); Add("mfg.maintenance", m, "info", V("maintenanceOpen")); break;
                case "prj": Add("prj.overBudget", m, "bad", V("overBudget")); Add("prj.pendingTs", m, "info", V("pendingTimesheets")); if (V("margin") < 0) Add("prj.negativeMargin", m, "warn", V("margin")); break;
                case "crm": Add("crm.activitiesDue", m, "warn", V("activitiesDue")); Add("crm.newLeads", m, "info", V("leadsNew")); if (V("winRate") > 0 && V("winRate") < 25) Add("crm.lowWin", m, "warn", V("winRate")); break;
                case "proc": Add("proc.latePo", m, "warn", V("latePo")); Add("proc.pendingReq", m, "info", V("pendingReq")); Add("proc.contracts", m, "info", V("contractsExpiring")); break;
                case "scm": Add("scm.delayed", m, "warn", V("delayed")); if (V("onTimePct") < 90) Add("scm.onTime", m, "warn", V("onTimePct")); break;
                case "wh": Add("wh.lowStock", m, "warn", V("lowStock")); Add("wh.openCounts", m, "info", V("openCounts")); break;
                case "ast": Add("ast.dueMaintenance", m, "warn", V("dueMaintenance")); Add("ast.down", m, "bad", V("down")); break;
                case "pay": Add("pay.openRuns", m, "info", V("openRuns")); break;
                case "int": Add("int.failures", m, "warn", V("failures")); break;
            }
        }
        // stale opportunities: open, not touched for 30 days
        if (await Has("crm.reports.view"))
        {
            var cutoff = DateTime.UtcNow.AddDays(-30);
            var stale = await _db.ErpRecords.AsNoTracking().CountAsync(r => r.TenantId == tenantId && r.Module == "crm" && r.Kind == "opportunity" && r.Status == "Open" && (r.UpdatedAt ?? r.CreatedAt) < cutoff);
            Add("crm.stale", "crm", "warn", stale);
        }
        return Ok(res.OrderBy(x => x.Level == "bad" ? 0 : x.Level == "warn" ? 1 : 2));
    }
}
