using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class ProcReceiveDto { public List<ProcReceiveLine>? Lines { get; set; } public string? Note { get; set; } }
public class ProcReceiveLine { public string Sku { get; set; } = ""; public decimal Qty { get; set; } }
public class ProcToPoDto { public string? Vendor { get; set; } }
public class AstCompleteDto { public decimal Cost { get; set; } public decimal Hours { get; set; } public string? Note { get; set; } }
public class IntKeyDto { public string Name { get; set; } = ""; public List<string>? Scopes { get; set; } }
public class Kpi { public string K { get; set; } = ""; public decimal V { get; set; } public string T { get; set; } = "n"; }
public class SeriesRow { public string Name { get; set; } = ""; public decimal Value { get; set; } }
public class SeriesDto { public string K { get; set; } = ""; public List<SeriesRow> Rows { get; set; } = new(); }
public class SummaryDto { public string Module { get; set; } = ""; public List<Kpi> Kpis { get; set; } = new(); public List<SeriesDto> Lists { get; set; } = new(); }
public class InsightDto { public string Code { get; set; } = ""; public string Module { get; set; } = ""; public string Level { get; set; } = "info"; public decimal N { get; set; } public string? Ref { get; set; } }

/// <summary>Procurement, supply chain, warehouse, assets, payroll, EPM, BPM, integration and BI - the same record table and privilege checks as the other modules.</summary>
public partial class ModulesController
{
    // ------------------------------------------------------------------ catalog of kinds

    private static (string view, string manage)? KindPermsExt(string module, string kind) => (module, kind) switch
    {
        ("proc", "requisition") => ("proc.view", "proc.req.manage"),
        ("proc", "rfq") => ("proc.view", "proc.rfq.manage"),
        ("proc", "po") => ("proc.view", "proc.po.manage"),
        ("proc", "contract") => ("proc.view", "proc.contracts.manage"),
        ("proc", "evaluation") => ("proc.view", "proc.suppliers.manage"),
        ("proc", "setting") => ("proc.view", "proc.setup"),
        ("scm", "forecast") => ("scm.view", "scm.planning"),
        ("scm", "shipment") => ("scm.view", "scm.shipments.manage"),
        ("scm", "carrier" or "setting") => ("scm.view", "scm.setup"),
        ("wh", "location" or "setting") => ("wh.view", "wh.setup"),
        ("wh", "pick") => ("wh.view", "wh.pick.manage"),
        ("wh", "count") => ("wh.view", "wh.count.manage"),
        ("ast", "asset") => ("ast.view", "ast.assets.manage"),
        ("ast", "plan") => ("ast.view", "ast.plans.manage"),
        ("ast", "workorder" or "meter") => ("ast.view", "ast.orders.manage"),
        ("ast", "setting") => ("ast.view", "ast.setup"),
        ("pay", "element" or "setting") => ("pay.view", "pay.setup"),
        ("pay", "adjustment" or "run") => ("pay.view", "pay.run.manage"),
        ("pay", "payslip") => ("pay.self", "pay.run.manage"),
        ("epm", "plan" or "line") => ("epm.view", "epm.plans.manage"),
        ("epm", "forecast") => ("epm.view", "epm.forecast.manage"),
        ("epm", "setting") => ("epm.view", "epm.setup"),
        ("bpm", "process" or "setting") => ("bpm.view", "bpm.manage"),
        ("int", "apikey") => ("int.view", "int.keys.manage"),
        ("int", "webhook" or "connector" or "log") => ("int.view", "int.hooks.manage"),
        ("bi", "report") => ("bi.view", "bi.reports.manage"),
        _ => null
    };

    private static string? AutoPrefixExt(string module, string kind) => (module, kind) switch
    {
        ("proc", "requisition") => "PR", ("proc", "rfq") => "RFQ", ("proc", "po") => "PO", ("proc", "contract") => "CON", ("proc", "evaluation") => "EV",
        ("scm", "forecast") => "FC", ("scm", "shipment") => "SH", ("wh", "pick") => "PK", ("wh", "count") => "CNT",
        ("ast", "plan") => "PM", ("ast", "workorder") => "AWO", ("ast", "meter") => "MR", ("pay", "adjustment") => "ADJ", ("pay", "run") => "RUN",
        ("epm", "plan") => "BP", ("epm", "line") => "BL", ("epm", "forecast") => "FCT", ("bpm", "process") => "PRC", ("int", "webhook") => "WH", ("int", "connector") => "CN", ("bi", "report") => "RPT",
        _ => null
    };

    private static string DefaultStatusExt(string module, string kind) => (module, kind) switch
    {
        ("proc", "requisition") => "Draft", ("proc", "rfq") => "Draft", ("proc", "po") => "Draft", ("proc", "contract") => "Active",
        ("scm", "shipment") => "Planned", ("scm", "forecast") => "Active",
        ("wh", "pick") => "Open", ("wh", "count") => "Draft",
        ("ast", "workorder") => "Open", ("ast", "plan") => "Active", ("ast", "asset") => "Active",
        ("pay", "run") => "Draft", ("epm", "plan") => "Draft", ("epm", "forecast") => "Draft",
        _ => "Active"
    };

    private static bool SystemOnly(string module, string kind) => (module, kind) is ("pay", "payslip") or ("int", "log");
    private static bool ActionOnly(string module, string kind) => (module, kind) is ("proc", "po") or ("pay", "run") or ("ast", "workorder") or ("wh", "pick") or ("wh", "count");
    private static bool IsFinalExt(string module, string kind, string? status) => (module, kind, status) switch
    {
        ("proc", "po", "Received" or "Invoiced" or "PartiallyReceived") => true,
        ("proc", "requisition", "Ordered") => true,
        ("wh", "pick", "Picked") => true, ("wh", "count", "Posted") => true,
        ("pay", "run", "Posted" or "Approved") => true,
        ("ast", "workorder", "Completed") => true,
        ("epm", "plan", "Published") => true,
        _ => false
    };

    private static readonly Dictionary<(string, string), string[]> Keep = new()
    {
        [("mfg", "workorder")] = new[] { "goodQty", "scrapQty", "materialCost", "laborCost", "overheadCost", "actualCost", "standardCost", "variance", "unitCost", "consumed", "completedAt", "completedBy", "startedAt", "startedBy" },
        [("prj", "project")] = new[] { "billed" },
        [("prj", "timesheet")] = new[] { "invoice", "approvedBy" }, [("prj", "cost")] = new[] { "invoice" }, [("prj", "milestone")] = new[] { "invoice" },
        [("crm", "lead")] = new[] { "account", "contact", "opportunity" },
        [("proc", "po")] = new[] { "receipts", "invoice", "amount", "taxAmount", "total" },
        [("proc", "requisition")] = new[] { "po" },
        [("ast", "workorder")] = new[] { "startedAt", "completedAt", "actualCost", "hours", "completeNote" },
        [("wh", "pick")] = new[] { "pickedAt", "pickedBy" }, [("wh", "count")] = new[] { "postedAt", "postedBy", "varianceQty", "varianceValue" },
        [("pay", "run")] = new[] { "gross", "deductions", "net", "count", "calculatedBy", "approvedBy", "journal" },
        [("epm", "plan")] = new[] { "approvedBy", "publishedAt" },
        [("int", "apikey")] = new[] { "hash", "prefix", "lastUsed" },
    };

    private static string MergeDataExt(string module, string kind, string existing, string incoming)
    {
        if (!Keep.TryGetValue((module, kind), out var keys)) return incoming;
        var o = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(existing) ?? new();
        var n = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(incoming) ?? new();
        foreach (var k in keys) { if (o.TryGetValue(k, out var v)) n[k] = v; else n.Remove(k); }
        return JsonSerializer.Serialize(n);
    }

    /// <summary>Status rules that need a privilege of their own, or that only the action buttons may change.</summary>
    private async Task<string?> GuardExt(string module, string kind, string? oldStatus, string? newStatus)
    {
        var creating = oldStatus == null;
        if (creating && (module, kind) == ("int", "apikey")) return "Use the key generator to create an API key.";
        if (ActionOnly(module, kind))
        {
            var def = DefaultStatusExt(module, kind);
            if (creating) { if (!string.IsNullOrEmpty(newStatus) && newStatus != def) return "A new record starts as " + def + "."; }
            else if (!string.IsNullOrEmpty(newStatus) && newStatus != oldStatus) return "Use the action buttons to move this record along.";
        }
        if (!string.IsNullOrEmpty(newStatus) && newStatus != oldStatus)
        {
            if ((module, kind) == ("proc", "requisition"))
            {
                if (newStatus is "Approved" or "Rejected" && !await Has("proc.req.approve")) return "403";
                if (newStatus == "Ordered") return "Use \"Create purchase order\" on an approved requisition.";
            }
            if ((module, kind) == ("epm", "plan"))
            {
                if (newStatus == "Approved" && !await Has("epm.plans.approve")) return "403";
                if (newStatus == "Published") return "Use the publish action.";
            }
            if ((module, kind) == ("epm", "forecast") && newStatus == "Approved" && !await Has("epm.plans.approve")) return "403";
        }
        return null;
    }

    private async Task<string?> ValidateExt(string tenantId, string module, string kind, ErpRecord r, JsonElement d)
    {
        switch (module, kind)
        {
            case ("proc", "requisition"):
                if (FinJson.Lines(d).Count() == 0) return "Add at least one item to the requisition.";
                break;
            case ("proc", "po"):
                if (FinJson.S(d, "vendor") == "") return "Choose the supplier.";
                var lines = FinJson.Lines(d).ToList();
                if (lines.Count == 0) return "Add at least one line.";
                if (lines.Any(l => FinJson.D(l, "qty") <= 0 || FinJson.D(l, "price") < 0)) return "Quantities must be above zero and prices can't be negative.";
                var net = R2(lines.Sum(l => FinJson.D(l, "qty") * FinJson.D(l, "price") * (1 - FinJson.D(l, "discountPct") / 100m)));
                var pct = d.ValueKind == JsonValueKind.Object && d.TryGetProperty("taxPct", out _) ? FinJson.D(d, "taxPct") : 15m;
                var tax = R2(net * pct / 100m);
                r.Data = FinJson.WithValues(r.Data, new() { ["amount"] = net, ["taxAmount"] = tax, ["total"] = R2(net + tax) });
                break;
            case ("ast", "workorder"):
                if (Clean(r.Ref) == null) return "Choose the asset.";
                break;
            case ("ast", "asset"):
                if (FinJson.S(d, "name") == "") return "Enter the asset name.";
                break;
            case ("pay", "adjustment"):
                if (FinJson.S(d, "empNo") == "" || FinJson.S(d, "period") == "") return "Choose the employee and the period.";
                break;
            case ("wh", "count" or "pick"):
                if (FinJson.Lines(d).Count() == 0) return "Add at least one line.";
                break;
            case ("epm", "line"):
                if (Clean(r.Ref) == null) return "Choose the plan.";
                if (FinJson.D(d, "amount") < 0) return "The amount can't be negative.";
                break;
        }
        await Task.CompletedTask;
        return null;
    }

    // ------------------------------------------------------------------ lookups (vendors, customers, employees, accounts ...)

    public class LookupRow { public string Code { get; set; } = ""; public string Name { get; set; } = ""; public string? Extra { get; set; } }

    [HttpGet("lookups/{what}")]
    public async Task<IActionResult> Lookup(string module, string what, [FromQuery] string? company)
    {
        if (!Modules.Contains(module)) return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        if (what == "users")   // workspace people for assignee / owner pickers (name + role only), open to every signed-in user
        {
            var people = await _db.Users.AsNoTracking().Where(u => u.TenantId == tenantId && u.IsActive).OrderBy(u => u.DisplayName).Take(3000).ToListAsync();
            return Ok(people.Select(u => new LookupRow { Code = u.Username, Name = u.DisplayName ?? u.Username, Extra = u.Role }));
        }
        if (!await HasAny(module)) return Forbid();
        if (what is "vendors" or "customers" or "costcenters" or "accounts" or "taxcodes")
        {
            var kind = what switch { "vendors" => "vendor", "customers" => "customer", "costcenters" => "costcenter", "accounts" => "account", _ => "taxcode" };
            var list = await _db.FinRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == kind).OrderBy(r => r.Code).Take(3000).ToListAsync();
            return Ok(list.Select(r => new LookupRow { Code = r.Code ?? "", Name = FinJson.S(FinJson.Obj(r.Data), "name") }));
        }
        if (what == "employees")
        {
            if (module == "pay" && !await Has("pay.run.manage")) return Forbid();
            var q = _db.HrEmployees.AsNoTracking().Where(e => e.TenantId == tenantId && e.Status != "Terminated");
            if (!string.IsNullOrWhiteSpace(company) && company != "ALL") q = q.Where(e => e.Company == company || e.Company == null || e.Company == "");
            var list = await q.OrderBy(e => e.FullName).Take(3000).ToListAsync();
            return Ok(list.Select(e => new LookupRow { Code = e.EmpNo, Name = e.FullName, Extra = e.Username }));
        }
        return NotFound();
    }

    // ------------------------------------------------------------------ webhooks

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(4) };

    /// <summary>Sends an event to the active webhooks that subscribed to it and logs every delivery. Never throws and never blocks longer than the timeout.</summary>
    private async Task Fire(string tenantId, string evt, object payload)
    {
        try
        {
            var hooks = await _db.ErpRecords.Where(r => r.TenantId == tenantId && r.Module == "int" && r.Kind == "webhook" && r.Status == "Active").ToListAsync();
            foreach (var h in hooks)
            {
                var hd = FinJson.Obj(h.Data);
                var events = FinJson.S(hd, "events").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                if (events.Length > 0 && !events.Contains("*") && !events.Contains(evt, StringComparer.OrdinalIgnoreCase)) continue;
                await Deliver(tenantId, h, evt, payload);
            }
        }
        catch { /* integrations must never break the business transaction */ }
    }

    private async Task<(bool ok, int status, string msg)> Deliver(string tenantId, ErpRecord hook, string evt, object payload)
    {
        var hd = FinJson.Obj(hook.Data);
        var url = FinJson.S(hd, "url");
        var body = JsonSerializer.Serialize(new { evt, tenant = tenantId, at = DateTime.UtcNow, data = payload });
        var ok = false; var code = 0; var msg = "";
        try
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)) throw new InvalidOperationException("Invalid URL");
            using var req = new HttpRequestMessage(HttpMethod.Post, uri) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            var secret = FinJson.S(hd, "secret");
            if (secret != "") req.Headers.Add("X-Signature", "sha256=" + System.Convert.ToHexString(new HMACSHA256(Encoding.UTF8.GetBytes(secret)).ComputeHash(Encoding.UTF8.GetBytes(body))).ToLowerInvariant());
            req.Headers.Add("X-Event", evt);
            using var resp = await Http.SendAsync(req);
            code = (int)resp.StatusCode; ok = resp.IsSuccessStatusCode; msg = ok ? "OK" : resp.ReasonPhrase ?? "Error";
        }
        catch (Exception ex) { msg = ex.Message.Length > 200 ? ex.Message[..200] : ex.Message; }
        _db.ErpRecords.Add(new ErpRecord { TenantId = tenantId, Module = "int", Kind = "log", Code = hook.Code, Ref = hook.Code, Status = ok ? "Success" : "Failed", CreatedBy = Username,
            Data = J(new() { ["event"] = evt, ["url"] = url, ["httpStatus"] = code, ["message"] = msg }) });
        await _db.SaveChangesAsync();
        return (ok, code, msg);
    }

    [HttpPost("webhooks/{id}/test")]
    public async Task<IActionResult> TestWebhook(string module, string id)
    {
        if (module != "int" || !await Has("int.hooks.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var h = await _db.ErpRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Module == "int" && r.Kind == "webhook");
        if (h == null) return NotFound();
        var (ok, status, msg) = await Deliver(tenantId, h, "ping", new { message = "Test event" });
        return Ok(new { ok, status, message = msg });
    }

    /// <summary>Creates an API key. The secret is shown ONCE; only its SHA-256 hash is stored.</summary>
    [HttpPost("apikeys")]
    public async Task<IActionResult> CreateKey(string module, [FromBody] IntKeyDto b)
    {
        if (module != "int" || !await Has("int.keys.manage")) return Forbid();
        if (string.IsNullOrWhiteSpace(b.Name)) return Bad("Enter a name for the key.");
        var tenantId = await _tenant.TenantIdOf(User);
        var secret = "wk_" + System.Convert.ToHexString(RandomNumberGenerator.GetBytes(20)).ToLowerInvariant();
        var hash = System.Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret))).ToLowerInvariant();
        var scopes = (b.Scopes ?? new()).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim().ToLowerInvariant()).Distinct().ToList();
        if (scopes.Count == 0) scopes.Add("*");
        var rec = new ErpRecord { TenantId = tenantId, Module = "int", Kind = "apikey", Code = secret[..11], Ref = hash, Status = "Active", CreatedBy = Username,
            Data = JsonSerializer.Serialize(new { name = b.Name.Trim(), scopes, prefix = secret[..11], hash }) };
        _db.ErpRecords.Add(rec);
        await _db.SaveChangesAsync();
        return Ok(new { id = rec.Id, key = secret, prefix = rec.Code });
    }

    // ------------------------------------------------------------------ procurement

    private async Task<ErpRecord?> Find(string tenantId, string module, string kind, string id)
        => await _db.ErpRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Module == module && r.Kind == kind);

    [HttpPost("requisitions/{id}/topo")]
    public async Task<IActionResult> RequisitionToPo(string module, string id, [FromBody] ProcToPoDto b)
    {
        if (module != "proc" || !await Has("proc.po.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rq = await Find(tenantId, "proc", "requisition", id);
        if (rq == null) return NotFound();
        if (rq.Status != "Approved") return Bad("Only an approved requisition can be turned into a purchase order.");
        var vendor = Clean(b.Vendor) ?? FinJson.S(FinJson.Obj(rq.Data), "vendor");
        if (vendor == "") return Bad("Choose the supplier.");
        var costs = (await _db.PosRecords.AsNoTracking().Where(p => p.TenantId == tenantId && p.Kind == "product").ToListAsync()).ToDictionary(p => p.Code ?? "", p => FinJson.D(FinJson.Obj(p.Data), "cost"));
        var lines = FinJson.Lines(FinJson.Obj(rq.Data)).Select(l => new { sku = FinJson.S(l, "sku"), desc = FinJson.S(l, "desc"), qty = FinJson.D(l, "qty"), price = FinJson.D(l, "price") > 0 ? FinJson.D(l, "price") : (costs.TryGetValue(FinJson.S(l, "sku"), out var c) ? c : 0m), discountPct = 0m, received = 0m }).ToList();
        var net = R2(lines.Sum(l => l.qty * l.price)); var tax = R2(net * 15m / 100m);
        var po = new ErpRecord { TenantId = tenantId, Module = "proc", Kind = "po", Code = await NextCode(tenantId, "proc", "po", "PO"), Company = rq.Company, Branch = rq.Branch, Status = "Draft", Ref = rq.Code, CreatedBy = Username,
            Data = JsonSerializer.Serialize(new { vendor, date = DateTime.UtcNow.ToString("yyyy-MM-dd"), expected = FinJson.S(FinJson.Obj(rq.Data), "needBy"), taxPct = 15, amount = net, taxAmount = tax, total = R2(net + tax), lines, requisition = rq.Code }) };
        _db.ErpRecords.Add(po);
        rq.Status = "Ordered"; rq.UpdatedAt = DateTime.UtcNow; rq.Data = FinJson.WithValues(rq.Data, new() { ["po"] = po.Code });
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(po));
    }

    [HttpPost("pos/{id}/{action}")]
    public async Task<IActionResult> PoAction(string module, string id, string action, [FromBody] ProcReceiveDto? b)
    {
        if (module != "proc") return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        var po = await Find(tenantId, "proc", "po", id);
        if (po == null) return NotFound();
        var d = FinJson.Obj(po.Data);
        switch (action)
        {
            case "approve":
                if (!await Has("proc.po.approve")) return Forbid();
                if (po.Status != "Draft") return Bad("Only a draft order can be approved.");
                if (string.Equals(po.CreatedBy, Username, StringComparison.OrdinalIgnoreCase) && !await Has("proc.po.selfApprove")) return Bad("Somebody else must approve the order you created.");
                po.Status = "Approved"; break;
            case "send":
                if (!await Has("proc.po.manage")) return Forbid();
                if (po.Status != "Approved") return Bad("Approve the order first.");
                po.Status = "Sent"; break;
            case "cancel":
                if (!await Has("proc.po.manage")) return Forbid();
                if (po.Status is not ("Draft" or "Approved" or "Sent")) return Bad("This order can no longer be cancelled.");
                po.Status = "Cancelled"; break;
            case "receive":
                {
                    if (!await Has("proc.receive")) return Forbid();
                    if (po.Status is not ("Approved" or "Sent" or "PartiallyReceived")) return Bad("The order is not open for receiving.");
                    var err = await ReceivePo(tenantId, po, b ?? new ProcReceiveDto());
                    if (err != null) return Bad(err);
                    break;
                }
            case "invoice":
                {
                    if (!await Has("proc.invoice") || !await Has("finance.ap.manage")) return Forbid();
                    if (po.Status != "Received") return Bad("Receive the order completely before invoicing.");
                    var net = R2(FinJson.Lines(d).Sum(l => FinJson.D(l, "received") * FinJson.D(l, "price") * (1 - FinJson.D(l, "discountPct") / 100m)));
                    var tax = R2(net * (d.TryGetProperty("taxPct", out _) ? FinJson.D(d, "taxPct") : 15m) / 100m);
                    var n = await _db.FinRecords.CountAsync(x => x.TenantId == tenantId && x.Kind == "apinvoice") + 1; string code;
                    do { code = $"BILL-{DateTime.UtcNow.Year}-{n:0000}"; n++; } while (await _db.FinRecords.AnyAsync(x => x.TenantId == tenantId && x.Kind == "apinvoice" && x.Code == code));
                    var date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                    var inv = new FinRecord { TenantId = tenantId, Kind = "apinvoice", Code = code, Company = po.Company, Status = "Draft", CreatedBy = Username,
                        Data = JsonSerializer.Serialize(new { vendor = FinJson.S(d, "vendor"), invoiceNo = po.Code, date, dueDate = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd"), currency = "", rate = 1, amount = net, taxCode = "", taxAmount = tax, total = R2(net + tax), po = po.Code, paid = 0 }) };
                    _db.FinRecords.Add(inv);
                    _db.FinAudits.Add(new FinAudit { TenantId = tenantId, Kind = "apinvoice", RecordId = inv.Id, Code = code, Action = "Created", UserName = Username, Summary = "Drafted from purchase order " + po.Code });
                    po.Status = "Invoiced"; po.Data = FinJson.WithValues(po.Data, new() { ["invoice"] = code });
                    break;
                }
            default: return NotFound();
        }
        po.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (action == "receive" && po.Status == "Received") await Fire(tenantId, "po.received", new { po = po.Code });
        return Ok(ErpRecordDto.From(po));
    }

    private async Task<string?> ReceivePo(string tenantId, ErpRecord po, ProcReceiveDto b)
    {
        var d = FinJson.Obj(po.Data);
        var cfg = FinJson.Obj((await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "proc" && r.Kind == "setting" && r.Code == "defaults"))?.Data);
        var tol = cfg.ValueKind == JsonValueKind.Object ? FinJson.D(cfg, "overReceiptPct") : 0m;
        var lines = FinJson.Lines(d).Select(l => JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(l.GetRawText())!).ToList();
        var wanted = b.Lines is { Count: > 0 } ? b.Lines.Where(x => x.Qty > 0).ToList()
            : lines.Select(l => new ProcReceiveLine { Sku = l["sku"].GetString() ?? "", Qty = Math.Max(0, JD(l, "qty") - JD(l, "received")) }).Where(x => x.Qty > 0).ToList();
        if (wanted.Count == 0) return "Nothing left to receive.";
        var done = new List<object>();
        foreach (var w in wanted)
        {
            var line = lines.FirstOrDefault(l => string.Equals(l["sku"].GetString(), w.Sku, StringComparison.OrdinalIgnoreCase));
            if (line == null) return $"{w.Sku} is not on this order.";
            var ordered = JD(line, "qty"); var got = JD(line, "received");
            if (got + w.Qty > ordered * (1 + tol / 100m) + 0.00001m) return $"Receiving {w.Qty} of {w.Sku} would exceed the ordered quantity.";
            line["received"] = JsonSerializer.SerializeToElement(got + w.Qty);
            var price = JD(line, "price");
            var st = await StockRec(tenantId, po.Company, po.Branch, w.Sku);
            var onHand = Math.Max(0, FinJson.D(FinJson.Obj(st.Data), "qty"));
            StockMove(tenantId, st, po.Company, po.Branch, w.Sku, w.Qty, "po-receipt", po.Code ?? "");
            var prod = await _db.PosRecords.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Kind == "product" && p.Code == w.Sku);
            if (prod != null)
            {   // moving-average cost
                var old = FinJson.D(FinJson.Obj(prod.Data), "cost");
                var avg = onHand + w.Qty == 0 ? price : (onHand * old + w.Qty * price) / (onHand + w.Qty);
                prod.Data = FinJson.WithValues(prod.Data, new() { ["cost"] = R2(avg) }); prod.UpdatedAt = DateTime.UtcNow;
            }
            done.Add(new { sku = w.Sku, qty = w.Qty, price });
        }
        var full = lines.All(l => JD(l, "received") + 0.00001m >= JD(l, "qty"));
        var receipts = new List<object>();
        if (d.TryGetProperty("receipts", out var rc) && rc.ValueKind == JsonValueKind.Array) foreach (var x in rc.EnumerateArray()) receipts.Add(x);
        receipts.Add(new { at = DateTime.UtcNow, by = Username, note = b.Note, lines = done });
        po.Data = FinJson.WithValues(po.Data, new() { ["lines"] = lines, ["receipts"] = receipts });
        po.Status = full ? "Received" : "PartiallyReceived";
        return null;
    }
    private static decimal JD(Dictionary<string, JsonElement> d, string k)
        => d.TryGetValue(k, out var v) ? (v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : decimal.TryParse(v.ToString(), out var x) ? x : 0m) : 0m;

    // ------------------------------------------------------------------ warehouse

    [HttpGet("wh-stock")]
    public async Task<IActionResult> WhStock(string module, [FromQuery] string? company, [FromQuery] string? branch)
    {
        if (module != "wh" || !await Has("wh.view")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var q = _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "stock");
        if (!string.IsNullOrWhiteSpace(company) && company != "ALL") q = q.Where(r => r.Company == company || r.Company == null || r.Company == "");
        if (!string.IsNullOrWhiteSpace(branch) && branch != "ALL") q = q.Where(r => r.Branch == branch);
        var rows = await q.ToListAsync();
        var prods = (await _db.PosRecords.AsNoTracking().Where(p => p.TenantId == tenantId && p.Kind == "product").ToListAsync()).ToDictionary(p => p.Code ?? "", p => FinJson.Obj(p.Data));
        return Ok(rows.Select(r => { var d = FinJson.Obj(r.Data); var sku = FinJson.S(d, "sku"); prods.TryGetValue(sku, out var pd); var qty = FinJson.D(d, "qty");
            return new { sku, name = pd.ValueKind == JsonValueKind.Object ? FinJson.S(pd, "name") : "", branch = r.Branch ?? "", qty, cost = pd.ValueKind == JsonValueKind.Object ? FinJson.D(pd, "cost") : 0m,
                value = R2(qty * (pd.ValueKind == JsonValueKind.Object ? FinJson.D(pd, "cost") : 0m)), reorder = pd.ValueKind == JsonValueKind.Object ? FinJson.D(pd, "reorder") : 0m }; }).OrderBy(x => x.sku));
    }

    [HttpPost("picks/{id}/confirm")]
    public async Task<IActionResult> ConfirmPick(string module, string id)
    {
        if (module != "wh" || !await Has("wh.pick.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var pk = await Find(tenantId, "wh", "pick", id);
        if (pk == null) return NotFound();
        if (pk.Status != "Open") return Bad("This pick list was already confirmed.");
        var cfg = FinJson.Obj((await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "wh" && r.Kind == "setting" && r.Code == "defaults"))?.Data);
        var neg = cfg.ValueKind == JsonValueKind.Object && FinJson.B(cfg, "allowNegativeStock");
        foreach (var l in FinJson.Lines(FinJson.Obj(pk.Data)))
        {
            var sku = FinJson.S(l, "sku"); var qty = FinJson.D(l, "qty");
            var st = await StockRec(tenantId, pk.Company, pk.Branch, sku);
            var have = FinJson.D(FinJson.Obj(st.Data), "qty");
            if (!neg && have < qty) return Bad($"Not enough {sku} in stock (need {qty}, have {have}).");
            StockMove(tenantId, st, pk.Company, pk.Branch, sku, -qty, "pick", pk.Code ?? "");
        }
        pk.Status = "Picked"; pk.UpdatedAt = DateTime.UtcNow; pk.Data = FinJson.WithValues(pk.Data, new() { ["pickedAt"] = DateTime.UtcNow, ["pickedBy"] = Username });
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(pk));
    }

    [HttpPost("counts/{id}/post")]
    public async Task<IActionResult> PostCount(string module, string id)
    {
        if (module != "wh" || !await Has("wh.count.approve")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var ct = await Find(tenantId, "wh", "count", id);
        if (ct == null) return NotFound();
        if (ct.Status != "Draft") return Bad("This count was already posted.");
        var outLines = new List<object>(); decimal vq = 0, vv = 0;
        foreach (var l in FinJson.Lines(FinJson.Obj(ct.Data)))
        {
            var sku = FinJson.S(l, "sku"); var counted = FinJson.D(l, "counted");
            var st = await StockRec(tenantId, ct.Company, ct.Branch, sku);
            var sys = FinJson.D(FinJson.Obj(st.Data), "qty"); var delta = counted - sys;
            var prod = await _db.PosRecords.AsNoTracking().FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Kind == "product" && p.Code == sku);
            var cost = prod == null ? 0m : FinJson.D(FinJson.Obj(prod.Data), "cost");
            if (delta != 0) StockMove(tenantId, st, ct.Company, ct.Branch, sku, delta, "count", ct.Code ?? "");
            vq += delta; vv += delta * cost;
            outLines.Add(new { sku, counted, system = sys, variance = delta, location = FinJson.S(l, "location") });
        }
        ct.Status = "Posted"; ct.UpdatedAt = DateTime.UtcNow;
        ct.Data = FinJson.WithValues(ct.Data, new() { ["lines"] = outLines, ["postedAt"] = DateTime.UtcNow, ["postedBy"] = Username, ["varianceQty"] = R2(vq), ["varianceValue"] = R2(vv) });
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(ct));
    }

    // ------------------------------------------------------------------ assets & maintenance

    [HttpPost("plans/{id}/generate")]
    public async Task<IActionResult> GenerateWo(string module, string id)
    {
        if (module != "ast" || !await Has("ast.orders.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var plan = await Find(tenantId, "ast", "plan", id);
        if (plan == null) return NotFound();
        var d = FinJson.Obj(plan.Data);
        var due = FinJson.TryDate(d, "nextDue", out var nd) ? nd : DateTime.UtcNow.Date;
        var freq = (int)FinJson.D(d, "frequencyDays");
        var wo = new ErpRecord { TenantId = tenantId, Module = "ast", Kind = "workorder", Code = await NextCode(tenantId, "ast", "workorder", "AWO"), Company = plan.Company, Branch = plan.Branch, Status = "Open", Ref = plan.Ref, Parent = plan.Code, CreatedBy = Username,
            Data = J(new() { ["type"] = "Preventive", ["plan"] = plan.Code, ["due"] = due.ToString("yyyy-MM-dd"), ["description"] = FinJson.S(d, "task") != "" ? FinJson.S(d, "task") : FinJson.S(d, "name"), ["priority"] = "Normal" }) };
        _db.ErpRecords.Add(wo);
        if (freq > 0) plan.Data = FinJson.WithValues(plan.Data, new() { ["nextDue"] = due.AddDays(freq).ToString("yyyy-MM-dd") });
        plan.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(wo));
    }

    [HttpPost("aworkorders/{id}/{action}")]
    public async Task<IActionResult> AssetWoAction(string module, string id, string action, [FromBody] AstCompleteDto? b)
    {
        if (module != "ast" || !await Has("ast.orders.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var wo = await Find(tenantId, "ast", "workorder", id);
        if (wo == null) return NotFound();
        switch (action)
        {
            case "start":
                if (wo.Status != "Open") return Bad("Only an open order can be started.");
                wo.Status = "InProgress"; wo.Data = FinJson.WithValues(wo.Data, new() { ["startedAt"] = DateTime.UtcNow }); break;
            case "complete":
                if (wo.Status is not ("Open" or "InProgress")) return Bad("This order is already finished.");
                b ??= new AstCompleteDto();
                if (b.Cost < 0 || b.Hours < 0) return Bad("Cost and hours can't be negative.");
                wo.Status = "Completed";
                wo.Data = FinJson.WithValues(wo.Data, new() { ["completedAt"] = DateTime.UtcNow, ["actualCost"] = R2(b.Cost), ["hours"] = b.Hours, ["completeNote"] = b.Note });
                var asset = await _db.ErpRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "ast" && r.Kind == "asset" && r.Code == wo.Ref);
                if (asset != null) { asset.Data = FinJson.WithValues(asset.Data, new() { ["lastService"] = DateTime.UtcNow.ToString("yyyy-MM-dd") }); asset.UpdatedAt = DateTime.UtcNow; }
                break;
            case "cancel":
                if (wo.Status is not ("Open" or "InProgress")) return Bad("This order is already finished.");
                wo.Status = "Cancelled"; break;
            default: return NotFound();
        }
        wo.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(wo));
    }

    // ------------------------------------------------------------------ payroll

    [HttpPost("runs/{id}/{action}")]
    public async Task<IActionResult> RunAction(string module, string id, string action)
    {
        if (module != "pay") return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        var run = await Find(tenantId, "pay", "run", id);
        if (run == null) return NotFound();
        var d = FinJson.Obj(run.Data);
        switch (action)
        {
            case "calculate":
                {
                    if (!await Has("pay.run.manage")) return Forbid();
                    if (run.Status is not ("Draft" or "Calculated")) return Bad("This run can't be recalculated.");
                    var period = FinJson.S(d, "period");
                    if (period.Length != 7) return Bad("Enter the pay period as yyyy-MM.");
                    var emps = _db.HrEmployees.AsNoTracking().Where(e => e.TenantId == tenantId && e.Status != "Terminated");
                    if (!string.IsNullOrEmpty(run.Company)) emps = emps.Where(e => e.Company == run.Company || e.Company == null || e.Company == "");
                    var list = await emps.OrderBy(e => e.EmpNo).ToListAsync();
                    if (list.Count == 0) return Bad("There are no employees to pay.");
                    var elements = (await _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "pay" && r.Kind == "element" && r.Status == "Active").ToListAsync()).Select(r => (code: r.Code ?? "", d: FinJson.Obj(r.Data))).ToList();
                    var adj = (await _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "pay" && r.Kind == "adjustment" && r.Status != "Cancelled").ToListAsync()).Select(r => FinJson.Obj(r.Data)).Where(a => FinJson.S(a, "period") == period).ToList();
                    var old = await _db.ErpRecords.Where(r => r.TenantId == tenantId && r.Module == "pay" && r.Kind == "payslip" && r.Parent == run.Id).ToListAsync();
                    _db.ErpRecords.RemoveRange(old);
                    decimal tg = 0, td = 0, tn = 0;
                    foreach (var e in list)
                    {
                        var basic = e.BasicSalary ?? 0m;
                        var earn = new List<object>(); var ded = new List<object>(); decimal ge = basic, de = 0;
                        foreach (var (code, ed) in elements)
                        {
                            var amt = FinJson.S(ed, "calc") == "pctBasic" ? R2(basic * FinJson.D(ed, "value") / 100m) : FinJson.D(ed, "value");
                            if (amt == 0) continue;
                            if (FinJson.S(ed, "type") == "deduction") { ded.Add(new { code, name = FinJson.S(ed, "name"), amount = amt }); de += amt; } else { earn.Add(new { code, name = FinJson.S(ed, "name"), amount = amt }); ge += amt; }
                        }
                        foreach (var a in adj.Where(a => FinJson.S(a, "empNo") == e.EmpNo))
                        {
                            var amt = FinJson.D(a, "amount"); if (amt == 0) continue;
                            var el = elements.FirstOrDefault(x => x.code == FinJson.S(a, "element"));
                            var isDed = el.d.ValueKind == JsonValueKind.Object ? FinJson.S(el.d, "type") == "deduction" : FinJson.S(a, "type") == "deduction";
                            if (isDed) { ded.Add(new { code = FinJson.S(a, "element"), name = FinJson.S(a, "note"), amount = amt }); de += amt; } else { earn.Add(new { code = FinJson.S(a, "element"), name = FinJson.S(a, "note"), amount = amt }); ge += amt; }
                        }
                        ge = R2(ge); de = R2(de); var net = R2(ge - de);
                        tg += ge; td += de; tn += net;
                        _db.ErpRecords.Add(new ErpRecord { TenantId = tenantId, Module = "pay", Kind = "payslip", Code = $"{run.Code}-{e.EmpNo}", Company = run.Company, Branch = e.Branch, Status = "Calculated", Ref = string.IsNullOrEmpty(e.Username) ? e.EmpNo : e.Username, Parent = run.Id, CreatedBy = Username,
                            Data = JsonSerializer.Serialize(new { empNo = e.EmpNo, name = e.FullName, period, basic, earnings = earn, deductions = ded, gross = ge, totalDeductions = de, net, costCenter = e.CostCenter }) });
                    }
                    run.Status = "Calculated";
                    run.Data = FinJson.WithValues(run.Data, new() { ["gross"] = R2(tg), ["deductions"] = R2(td), ["net"] = R2(tn), ["count"] = list.Count, ["calculatedBy"] = Username, ["approvedBy"] = null });
                    break;
                }
            case "approve":
                {
                    if (!await Has("pay.run.approve")) return Forbid();
                    if (run.Status != "Calculated") return Bad("Calculate the run first.");
                    if (string.Equals(FinJson.S(d, "calculatedBy"), Username, StringComparison.OrdinalIgnoreCase)) return Bad("A different person must approve the payroll run.");
                    run.Status = "Approved"; run.Data = FinJson.WithValues(run.Data, new() { ["approvedBy"] = Username });
                    var slips = await _db.ErpRecords.Where(r => r.TenantId == tenantId && r.Module == "pay" && r.Kind == "payslip" && r.Parent == run.Id).ToListAsync();
                    foreach (var s in slips) s.Status = "Approved";
                    break;
                }
            case "post":
                {
                    if (!await Has("pay.post") || !await Has("finance.gl.manage")) return Forbid();
                    if (run.Status != "Approved") return Bad("Approve the run first.");
                    var cfg = FinJson.Obj((await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "pay" && r.Kind == "setting" && r.Code == "defaults"))?.Data);
                    string exp = FinJson.S(cfg, "expenseAccount"), pay = FinJson.S(cfg, "payableAccount"), ded = FinJson.S(cfg, "deductionAccount");
                    var gross = FinJson.D(d, "gross"); var dd = FinJson.D(d, "deductions"); var net = FinJson.D(d, "net");
                    if (exp == "" || pay == "" || (dd > 0 && ded == "")) return Bad("Set the payroll accounts in Payroll setup first.");
                    var code = "PAY-" + run.Code;
                    if (!await _db.FinRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "journal" && r.Code == code))
                    {
                        var lines = new List<object> { new { account = exp, debit = gross, credit = 0m, memo = "Payroll " + FinJson.S(d, "period") }, new { account = pay, debit = 0m, credit = net, memo = "Net pay " + FinJson.S(d, "period") } };
                        if (dd > 0) lines.Add(new { account = ded, debit = 0m, credit = dd, memo = "Payroll deductions " + FinJson.S(d, "period") });
                        var j = new FinRecord { TenantId = tenantId, Kind = "journal", Code = code, Company = run.Company, Status = "Draft", CreatedBy = Username,
                            Data = JsonSerializer.Serialize(new { date = DateTime.UtcNow.ToString("yyyy-MM-dd"), memo = "Payroll " + FinJson.S(d, "period"), reference = run.Code, currency = "", rate = 1, lines }) };
                        _db.FinRecords.Add(j);
                        _db.FinAudits.Add(new FinAudit { TenantId = tenantId, Kind = "journal", RecordId = j.Id, Code = code, Action = "Created", UserName = Username, Summary = "Drafted from payroll run " + run.Code });
                    }
                    run.Status = "Posted"; run.Data = FinJson.WithValues(run.Data, new() { ["journal"] = code });
                    var slips = await _db.ErpRecords.Where(r => r.TenantId == tenantId && r.Module == "pay" && r.Kind == "payslip" && r.Parent == run.Id).ToListAsync();
                    foreach (var s in slips) s.Status = "Posted";
                    break;
                }
            default: return NotFound();
        }
        run.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (action == "post") await Fire(tenantId, "payroll.posted", new { run = run.Code });
        return Ok(ErpRecordDto.From(run));
    }

    // ------------------------------------------------------------------ EPM

    [HttpPost("plans/{id}/publish")]
    public async Task<IActionResult> PublishPlan(string module, string id)
    {
        if (module != "epm" || !await Has("epm.publish") || !await Has("finance.budget.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var plan = await Find(tenantId, "epm", "plan", id);
        if (plan == null) return NotFound();
        if (plan.Status != "Approved") return Bad("Approve the plan before publishing it to Finance budgets.");
        var d = FinJson.Obj(plan.Data); var year = FinJson.S(d, "year");
        var lines = (await _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "epm" && r.Kind == "line" && r.Ref == plan.Code).ToListAsync()).Select(r => FinJson.Obj(r.Data)).ToList();
        if (lines.Count == 0) return Bad("The plan has no lines.");
        var old = await _db.FinRecords.Where(r => r.TenantId == tenantId && r.Kind == "budget").ToListAsync();
        _db.FinRecords.RemoveRange(old.Where(b => FinJson.S(FinJson.Obj(b.Data), "plan") == plan.Code));
        foreach (var g in lines.GroupBy(l => (FinJson.S(l, "costCenter"), FinJson.S(l, "account"))))
            _db.FinRecords.Add(new FinRecord { TenantId = tenantId, Kind = "budget", Company = plan.Company, Status = "Active", CreatedBy = Username,
                Data = JsonSerializer.Serialize(new { year, costCenter = g.Key.Item1, account = g.Key.Item2, amount = R2(g.Sum(l => FinJson.D(l, "amount"))), plan = plan.Code, notes = "Published from plan " + plan.Code }) });
        plan.Status = "Published"; plan.UpdatedAt = DateTime.UtcNow; plan.Data = FinJson.WithValues(plan.Data, new() { ["publishedAt"] = DateTime.UtcNow });
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(plan));
    }

    [HttpPost("plans/{id}/approve")]
    public async Task<IActionResult> ApprovePlan(string module, string id)
    {
        if (module != "epm" || !await Has("epm.plans.approve")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var plan = await Find(tenantId, "epm", "plan", id);
        if (plan == null) return NotFound();
        if (plan.Status != "Draft") return Bad("Only a draft plan can be approved.");
        plan.Status = "Approved"; plan.UpdatedAt = DateTime.UtcNow; plan.Data = FinJson.WithValues(plan.Data, new() { ["approvedBy"] = Username });
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(plan));
    }
}
