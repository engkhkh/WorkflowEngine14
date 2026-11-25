using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class BizLineDto { public string? Sku { get; set; } public decimal Qty { get; set; } }
public class BizActDto
{
    public string? Note { get; set; }          // reason / resolution / root cause
    public string? User { get; set; }          // assign: who handles it
    public decimal? Amount { get; set; }       // visit hours, service cost, payment amount
    public decimal? Cost { get; set; }         // visit / service final cost
    public string? Method { get; set; }        // payment method
    public string? Date { get; set; }          // reserved
    public List<BizLineDto>? Lines { get; set; }   // sales order delivery: quantities per item (empty = everything still open)
}

/// <summary>
/// Six business modules found in Oracle Fusion, SAP, Dynamics 365 and Odoo that the platform did not have yet. Same record table, branch scoping and privilege checks as every other ERP module.
///   so  : Sales orders      pricelist, order (Draft -> Confirmed -> PartiallyDelivered / Delivered -> Invoiced | Cancelled), delivery (created by the deliver action)
///   hd  : Helpdesk + field service  SLA policies, tickets with SLA due time, field visits, service contracts
///   sub : Subscriptions     plans, subscriptions (activate / pause / resume / cancel / bill), subscription invoices (paid / void)
///   exp : Expenses          categories with limits, expense claims (submit -> approve / reject -> pay; nobody approves their own claim)
///   qa  : Quality           inspection plans, inspections (pass / fail from measured values, a failed one raises a non-conformance), NCRs (investigate -> correct -> close)
///   flt : Fleet             vehicles, drivers, fuel logs (keep the odometer current), service jobs
/// </summary>
public partial class ModulesController
{
    private static bool IsBiz(string module) => module is "so" or "hd" or "sub" or "exp" or "qa" or "flt";

    private sealed record BK(string View, string Manage, string Prefix, string Default, string[] Statuses, string[]? Req = null, string[]? NonNeg = null,
        bool Act = false, bool Sys = false, string[]? Final = null, string[]? EditIn = null, string[]? Keep = null);

    private static readonly string[] BizPriorities = { "Low", "Normal", "High", "Urgent" };
    private static readonly string[] BizPeriods = { "Monthly", "Quarterly", "SemiAnnual", "Annual" };
    private static readonly string[] BizMethods = { "Cash", "Transfer", "Cheque", "Card" };

    private static readonly Dictionary<(string, string), BK> BizK = new()
    {
        // ---- sales orders
        [("so", "pricelist")] = new("so.view", "so.setup", "PL", "Active", new[] { "Active", "Inactive" }, new[] { "name" }, new[] { "discountPct" }),
        [("so", "order")] = new("so.view", "so.orders.manage", "SO", "Draft", new[] { "Draft", "Confirmed", "PartiallyDelivered", "Delivered", "Invoiced", "Cancelled" }, new[] { "customer" }, null,
            Act: true, Final: new[] { "Invoiced", "Cancelled" }, EditIn: new[] { "Draft" }, Keep: new[] { "amount", "taxAmount", "total", "confirmedAt", "confirmedBy", "deliveries", "invoicedAt", "invoicedBy", "invoiceNo", "cancelReason" }),
        [("so", "delivery")] = new("so.view", "so.orders.manage", "DLV", "Done", new[] { "Done", "Returned" }, Sys: true),
        // ---- helpdesk + field service
        [("hd", "sla")] = new("hd.view", "hd.setup", "SLA", "Active", new[] { "Active", "Inactive" }, new[] { "priority" }, new[] { "responseHours", "resolveHours" }),
        [("hd", "ticket")] = new("hd.view", "hd.tickets.manage", "TKT", "New", new[] { "New", "Assigned", "InProgress", "Waiting", "Resolved", "Closed", "Cancelled" }, new[] { "subject" }, null,
            Act: true, Final: new[] { "Closed", "Cancelled" }, Keep: new[] { "assignedTo", "dueAt", "slaHours", "firstResponseAt", "resolvedAt", "resolvedBy", "resolution", "closedAt", "breached", "waitNote" }),
        [("hd", "visit")] = new("hd.view", "hd.visits.manage", "FSV", "Scheduled", new[] { "Scheduled", "InProgress", "Done", "Cancelled" }, new[] { "date", "technician" }, new[] { "hours", "cost" },
            Act: true, Final: new[] { "Done", "Cancelled" }, EditIn: new[] { "Scheduled" }, Keep: new[] { "startedAt", "completedAt", "completedBy", "resolution", "hours", "cost" }),
        [("hd", "contract")] = new("hd.view", "hd.contracts.manage", "SVC", "Active", new[] { "Active", "Expired", "Cancelled" }, new[] { "customer", "startDate", "endDate" }, new[] { "value" }),
        // ---- subscriptions
        [("sub", "plan")] = new("sub.view", "sub.setup", "PLN", "Active", new[] { "Active", "Inactive" }, new[] { "name", "period" }, new[] { "price", "trialDays" }),
        [("sub", "subscription")] = new("sub.view", "sub.manage", "SUB", "Draft", new[] { "Draft", "Active", "Paused", "Cancelled" }, new[] { "customer", "plan", "startDate" }, new[] { "price" },
            Act: true, Final: new[] { "Cancelled" }, EditIn: new[] { "Draft", "Paused" }, Keep: new[] { "nextBillDate", "billedCount", "activatedAt", "cancelReason", "lastInvoice" }),
        [("sub", "invoice")] = new("sub.view", "sub.billing.manage", "SIN", "Unpaid", new[] { "Unpaid", "Paid", "Void" }, Sys: true, Final: new[] { "Paid", "Void" }),
        // ---- expenses
        [("exp", "category")] = new("exp.view", "exp.setup", "EXC", "Active", new[] { "Active", "Inactive" }, new[] { "name" }, new[] { "limit" }),
        [("exp", "claim")] = new("exp.view", "exp.claims.manage", "EXP", "Draft", new[] { "Draft", "Submitted", "Approved", "Rejected", "Paid" }, new[] { "title" }, null,
            Act: true, Final: new[] { "Paid" }, EditIn: new[] { "Draft", "Rejected" }, Keep: new[] { "total", "submittedAt", "approvedBy", "approvedAt", "rejectReason", "paidAt", "paidBy", "method" }),
        // ---- quality
        [("qa", "plan")] = new("qa.view", "qa.setup", "QP", "Active", new[] { "Active", "Inactive" }, new[] { "name" }, new[] { "sampleSize" }),
        [("qa", "inspection")] = new("qa.view", "qa.inspections.manage", "QIN", "Pending", new[] { "Pending", "Passed", "Failed" }, new[] { "plan" }, null,
            Act: true, Final: new[] { "Passed", "Failed" }, EditIn: new[] { "Pending" }, Keep: new[] { "inspectedAt", "inspectedBy", "failedChecks", "ncr", "note" }),
        [("qa", "ncr")] = new("qa.view", "qa.ncr.manage", "NCR", "Open", new[] { "Open", "Investigating", "Corrected", "Closed" }, new[] { "title" }, new[] { "cost" },
            Act: true, Final: new[] { "Closed" }, Keep: new[] { "owner", "correctiveAction", "correctedAt", "closedAt", "closedBy" }),
        // ---- fleet
        [("flt", "driver")] = new("flt.view", "flt.drivers.manage", "DRV", "Active", new[] { "Active", "Inactive" }, new[] { "name" }),
        [("flt", "vehicle")] = new("flt.view", "flt.vehicles.manage", "VEH", "Active", new[] { "Active", "InService", "Retired" }, new[] { "plate" }, new[] { "odometer" }, Keep: new string[0]),
        [("flt", "fuel")] = new("flt.view", "flt.logs.manage", "FUL", "Logged", new[] { "Logged" }, new[] { "vehicle", "date" }, new[] { "liters", "pricePerLiter", "odometer" }),
        [("flt", "service")] = new("flt.view", "flt.service.manage", "SRV", "Scheduled", new[] { "Scheduled", "InProgress", "Done", "Cancelled" }, new[] { "vehicle", "type" }, new[] { "cost", "odometer" },
            Act: true, Final: new[] { "Done", "Cancelled" }, EditIn: new[] { "Scheduled" }, Keep: new[] { "startedAt", "completedAt", "cost" }),
    };

    private static (string view, string manage)? KindPermsBiz(string module, string kind) => BizK.TryGetValue((module, kind), out var k) ? (k.View, k.Manage) : null;
    private static string? AutoPrefixBiz(string module, string kind) => BizK.TryGetValue((module, kind), out var k) ? k.Prefix : null;
    private static string DefaultStatusBiz(string module, string kind) => BizK.TryGetValue((module, kind), out var k) ? k.Default : "Active";
    private static bool BizActionOnly(string module, string kind) => BizK.TryGetValue((module, kind), out var k) && k.Act;
    private static bool BizSystemOnly(string module, string kind) => BizK.TryGetValue((module, kind), out var k) && k.Sys;
    private static bool IsFinalBiz(string module, string kind, string? status) => BizK.TryGetValue((module, kind), out var k) && k.Final != null && status != null && k.Final.Contains(status);
    private static bool BizKeepKeys(string module, string kind, out string[]? keys) { keys = null; return BizK.TryGetValue((module, kind), out var k) && (keys = k.Keep) != null; }

    /// <summary>Status / edit rules that hold whatever the screen sends. Called from GuardExt.</summary>
    private string? GuardBiz(string module, string kind, string? oldStatus, string? newStatus)
    {
        if (!BizK.TryGetValue((module, kind), out var k)) return null;
        if (!string.IsNullOrEmpty(newStatus) && !k.Statuses.Contains(newStatus)) return "Status must be " + string.Join(", ", k.Statuses) + ".";
        if (oldStatus != null && !k.Sys)
        {
            if (k.Final != null && k.Final.Contains(oldStatus)) return "A finished record can't be changed.";
            if (k.EditIn != null && !k.EditIn.Contains(oldStatus)) return "This record can't be edited in its current state (" + oldStatus + ").";
        }
        return null;
    }

    private async Task<ErpRecord?> BizByCode(string tenantId, string module, string kind, string? code, bool track = false)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var q = _db.ErpRecords.Where(x => x.TenantId == tenantId && x.Module == module && x.Kind == kind && x.Code == code);
        return track ? await q.FirstOrDefaultAsync() : await q.AsNoTracking().FirstOrDefaultAsync();
    }

    private static bool BizDate(string s, out DateTime dt) => DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out dt);
    private static string BizIso(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static decimal BizNum(JsonNode? n) => n != null && decimal.TryParse(n.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0m;
    private static int BizMonths(string period) => period switch { "Quarterly" => 3, "SemiAnnual" => 6, "Annual" => 12, _ => 1 };
    private static bool BizOpenTicket(string? s) => s is "New" or "Assigned" or "InProgress" or "Waiting";

    private async Task<bool> BizActiveUser(string tenantId, string? username)
        => !string.IsNullOrWhiteSpace(username) && await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Username == username && u.IsActive);

    // ------------------------------------------------------------------ validation

    private async Task<string?> ValidateBiz(string tenantId, string module, string kind, ErpRecord r, JsonElement d)
    {
        if (!BizK.TryGetValue((module, kind), out var k)) return null;
        if (k.Sys) return null;
        foreach (var key in k.Req ?? Array.Empty<string>())
            if (FinJson.S(d, key).Trim() == "" && !(key == "lines")) return $"Fill in the required field \"{key}\".";
        foreach (var key in k.NonNeg ?? Array.Empty<string>())
            if (FinJson.D(d, key) < 0) return $"\"{key}\" can't be negative.";
        if (r.Status != null && !k.Statuses.Contains(r.Status)) return "Status must be " + string.Join(", ", k.Statuses) + ".";
        var isNew = !await _db.ErpRecords.AnyAsync(x => x.Id == r.Id);
        switch (module, kind)
        {
            case ("so", "pricelist"):
                if (FinJson.D(d, "discountPct") > 100) return "The discount must be between 0 and 100 percent.";
                break;
            case ("so", "order"):
                {
                    var lines = FinJson.Lines(d).ToList();
                    if (lines.Count == 0) return "Add at least one item to the order.";
                    if (lines.Any(l => FinJson.S(l, "sku") == "" && FinJson.S(l, "name") == "")) return "Every line needs an item.";
                    if (lines.Any(l => FinJson.D(l, "qty") <= 0 || FinJson.D(l, "price") < 0)) return "Quantities must be above zero and prices can't be negative.";
                    if (lines.Any(l => FinJson.D(l, "discountPct") < 0 || FinJson.D(l, "discountPct") > 100)) return "Line discounts must be between 0 and 100 percent.";
                    var pl = FinJson.S(d, "pricelist");
                    if (pl != "" && await BizByCode(tenantId, "so", "pricelist", pl) == null) return $"Price list {pl} doesn't exist.";
                    var net = R2(lines.Sum(l => FinJson.D(l, "qty") * FinJson.D(l, "price") * (1 - FinJson.D(l, "discountPct") / 100m)));
                    var hdr = FinJson.D(d, "discountPct"); if (hdr < 0 || hdr > 100) return "The order discount must be between 0 and 100 percent.";
                    net = R2(net * (1 - hdr / 100m));
                    var pct = d.ValueKind == JsonValueKind.Object && d.TryGetProperty("taxPct", out _) ? FinJson.D(d, "taxPct") : 15m;
                    var tax = R2(net * pct / 100m);
                    r.Data = FinJson.WithValues(r.Data, new() { ["amount"] = net, ["taxAmount"] = tax, ["total"] = R2(net + tax) });
                    break;
                }
            case ("hd", "sla"):
                if (!BizPriorities.Contains(FinJson.S(d, "priority"))) return "Choose a priority: Low, Normal, High or Urgent.";
                if (FinJson.D(d, "resolveHours") > 0 && FinJson.D(d, "responseHours") > FinJson.D(d, "resolveHours")) return "The response time can't be longer than the resolution time.";
                break;
            case ("hd", "ticket"):
                {
                    var pr = FinJson.S(d, "priority");
                    if (pr == "") { pr = "Normal"; r.Data = FinJson.WithValues(r.Data, new() { ["priority"] = pr }); }
                    if (!BizPriorities.Contains(pr)) return "Choose a priority: Low, Normal, High or Urgent.";
                    var ct = FinJson.S(d, "contract");
                    if (ct != "" && await BizByCode(tenantId, "hd", "contract", ct) == null) return $"Service contract {ct} doesn't exist.";
                    if (isNew)
                    {
                        var slas = await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "hd" && x.Kind == "sla" && x.Status == "Active").ToListAsync();
                        var hours = 0m;
                        foreach (var s in slas) { var sd = FinJson.Obj(s.Data); if (FinJson.S(sd, "priority") == pr && FinJson.D(sd, "resolveHours") > 0) { hours = FinJson.D(sd, "resolveHours"); break; } }
                        if (hours <= 0) hours = pr switch { "Urgent" => 4m, "High" => 8m, "Normal" => 24m, _ => 72m };
                        r.Data = FinJson.WithValues(r.Data, new() { ["slaHours"] = hours, ["dueAt"] = DateTime.UtcNow.AddHours((double)hours) });
                    }
                    break;
                }
            case ("hd", "visit"):
                if (!BizDate(FinJson.S(d, "date"), out _)) return "Enter a valid visit date.";
                if (!await BizActiveUser(tenantId, FinJson.S(d, "technician"))) return "The technician must be an active user of this workspace.";
                if (FinJson.S(d, "ticket") != "" && await BizByCode(tenantId, "hd", "ticket", FinJson.S(d, "ticket")) == null) return $"Ticket {FinJson.S(d, "ticket")} doesn't exist.";
                break;
            case ("hd", "contract"):
                if (!BizDate(FinJson.S(d, "startDate"), out var cs) || !BizDate(FinJson.S(d, "endDate"), out var ce)) return "Enter valid start and end dates.";
                if (ce < cs) return "The end date can't be before the start date.";
                break;
            case ("sub", "plan"):
                if (!BizPeriods.Contains(FinJson.S(d, "period"))) return "Choose a billing period: Monthly, Quarterly, SemiAnnual or Annual.";
                break;
            case ("sub", "subscription"):
                {
                    var plan = await BizByCode(tenantId, "sub", "plan", FinJson.S(d, "plan"));
                    if (plan == null) return $"Plan {FinJson.S(d, "plan")} doesn't exist.";
                    if (plan.Status != "Active" && isNew) return "That plan isn't active.";
                    if (!BizDate(FinJson.S(d, "startDate"), out _)) return "Enter a valid start date.";
                    if (d.ValueKind == JsonValueKind.Object && d.TryGetProperty("qty", out _) && FinJson.D(d, "qty") <= 0) return "The quantity must be above zero.";
                    if (FinJson.D(d, "price") == 0m) r.Data = FinJson.WithValues(r.Data, new() { ["price"] = FinJson.D(FinJson.Obj(plan.Data), "price") });
                    if (FinJson.D(d, "qty") == 0m) r.Data = FinJson.WithValues(r.Data, new() { ["qty"] = 1 });
                    break;
                }
            case ("exp", "claim"):
                {
                    var lines = FinJson.Lines(d).ToList();
                    if (lines.Count == 0) return "Add at least one expense line.";
                    var cats = (await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "exp" && x.Kind == "category").ToListAsync()).ToDictionary(x => x.Code ?? "", x => x);
                    foreach (var l in lines)
                    {
                        if (FinJson.D(l, "amount") <= 0) return "Every expense amount must be above zero.";
                        if (!BizDate(FinJson.S(l, "date"), out var ld)) return "Every expense line needs a valid date.";
                        if (ld.Date > ClientClock.Today) return "An expense can't be dated in the future.";
                        var cat = FinJson.S(l, "category");
                        if (cat != "" && cats.TryGetValue(cat, out var cr))
                        {
                            var cd = FinJson.Obj(cr.Data);
                            if (cr.Status == "Inactive") return $"Category {cat} is inactive.";
                            if (FinJson.D(cd, "limit") > 0 && FinJson.D(l, "amount") > FinJson.D(cd, "limit")) return $"The limit for {cat} is {FinJson.D(cd, "limit")} per line.";
                            if (FinJson.B(cd, "requiresReceipt") && !FinJson.B(l, "receipt")) return $"{cat} needs a receipt: tick \"Receipt attached\" on the line.";
                        }
                        else if (cat != "" && cats.Count > 0) return $"Category {cat} doesn't exist.";
                    }
                    r.Data = FinJson.WithValues(r.Data, new() { ["total"] = R2(lines.Sum(l => FinJson.D(l, "amount"))) });
                    break;
                }
            case ("qa", "plan"):
                foreach (var c in FinJson.Lines(d))
                {
                    if (FinJson.S(c, "name") == "") return "Every check needs a name.";
                    if (FinJson.S(c, "min") != "" && FinJson.S(c, "max") != "" && FinJson.D(c, "min") > FinJson.D(c, "max")) return $"Check {FinJson.S(c, "name")}: the minimum is above the maximum.";
                }
                break;
            case ("qa", "inspection"):
                if (await BizByCode(tenantId, "qa", "plan", FinJson.S(d, "plan")) == null) return $"Inspection plan {FinJson.S(d, "plan")} doesn't exist.";
                if (d.ValueKind == JsonValueKind.Object && d.TryGetProperty("qty", out _) && FinJson.D(d, "qty") <= 0) return "The inspected quantity must be above zero.";
                break;
            case ("flt", "vehicle"):
                {
                    var plate = FinJson.S(d, "plate").Trim();
                    var others = await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "flt" && x.Kind == "vehicle" && x.Id != r.Id).ToListAsync();
                    if (others.Any(x => string.Equals(FinJson.S(FinJson.Obj(x.Data), "plate").Trim(), plate, StringComparison.OrdinalIgnoreCase))) return $"A vehicle with plate {plate} already exists.";
                    var yr = FinJson.D(d, "year"); if (yr != 0 && (yr < 1950 || yr > 2100)) return "Enter a valid model year.";
                    if (FinJson.S(d, "driver") != "" && await BizByCode(tenantId, "flt", "driver", FinJson.S(d, "driver")) == null) return $"Driver {FinJson.S(d, "driver")} doesn't exist.";
                    break;
                }
            case ("flt", "driver"):
                if (FinJson.S(d, "licenseExpiry") != "" && !BizDate(FinJson.S(d, "licenseExpiry"), out _)) return "Enter a valid licence expiry date.";
                break;
            case ("flt", "fuel"):
                {
                    var v = await BizByCode(tenantId, "flt", "vehicle", FinJson.S(d, "vehicle"), true);
                    if (v == null) return $"Vehicle {FinJson.S(d, "vehicle")} doesn't exist.";
                    if (!BizDate(FinJson.S(d, "date"), out _)) return "Enter a valid fuel date.";
                    if (FinJson.D(d, "liters") <= 0) return "The litres must be above zero.";
                    var odo = FinJson.D(d, "odometer"); var cur = FinJson.D(FinJson.Obj(v.Data), "odometer");
                    if (isNew && odo > 0 && odo < cur) return $"The odometer ({odo}) is lower than the vehicle's last reading ({cur}).";
                    r.Data = FinJson.WithValues(r.Data, new() { ["cost"] = R2(FinJson.D(d, "liters") * FinJson.D(d, "pricePerLiter")) });
                    if (isNew && odo > cur) v.Data = FinJson.WithValues(v.Data, new() { ["odometer"] = odo });
                    break;
                }
            case ("flt", "service"):
                if (await BizByCode(tenantId, "flt", "vehicle", FinJson.S(d, "vehicle")) == null) return $"Vehicle {FinJson.S(d, "vehicle")} doesn't exist.";
                if (FinJson.S(d, "date") != "" && !BizDate(FinJson.S(d, "date"), out _)) return "Enter a valid service date.";
                break;
        }
        return null;
    }

    // ------------------------------------------------------------------ actions

    [HttpPost("bizact/{kind}/{id}/{op}")]
    public async Task<IActionResult> BizAction(string module, string kind, string id, string op, [FromBody] BizActDto? b)
    {
        if (!IsBiz(module) || !BizK.TryGetValue((module, kind), out var bk)) return NotFound();
        b ??= new BizActDto();
        var need = (module, kind, op) switch
        {
            ("so", "order", "confirm") => "so.orders.approve",
            ("exp", "claim", "approve" or "reject") => "exp.approve",
            ("exp", "claim", "pay") => "exp.pay",
            ("qa", "ncr", "close") => "qa.ncr.approve",
            _ => bk.Manage
        };
        if (!await Has(need)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await Find(tenantId, module, kind, id);
        if (rec == null) return NotFound();
        if (!await _me.CanUseBranchAsync(rec.Branch)) return Forbid();
        var d = FinJson.Obj(rec.Data);
        var now = DateTime.UtcNow; var today = ClientClock.Today;
        var note = Clean(b.Note);
        IDisposable? numLock = null;
        try
        {
            switch (module, kind, op)
            {
                // ------------------------------------------------ sales orders
                case ("so", "order", "confirm"):
                    if (rec.Status != "Draft") return Bad("Only a draft order can be confirmed.");
                    if (!FinJson.Lines(d).Any()) return Bad("The order has no lines.");
                    rec.Status = "Confirmed"; rec.Data = FinJson.WithValues(rec.Data, new() { ["confirmedAt"] = now, ["confirmedBy"] = Username });
                    break;
                case ("so", "order", "deliver"):
                    {
                        if (rec.Status is not ("Confirmed" or "PartiallyDelivered")) return Bad("Only a confirmed order can be delivered.");
                        var root = JsonNode.Parse(rec.Data)!.AsObject();
                        var arr = root["lines"] as JsonArray; if (arr == null || arr.Count == 0) return Bad("The order has no lines.");
                        var ask = (b.Lines ?? new()).Where(x => x.Qty > 0 && !string.IsNullOrWhiteSpace(x.Sku)).GroupBy(x => x.Sku!).ToDictionary(g => g.Key, g => g.Sum(x => x.Qty));
                        var done = new List<object>(); var allDone = true; decimal total = 0;
                        foreach (var n in arr)
                        {
                            if (n is not JsonObject line) continue;
                            var sku = line["sku"]?.ToString() ?? ""; var qty = BizNum(line["qty"]); var got = BizNum(line["delivered"]); var left = qty - got;
                            var give = ask.Count > 0 ? (ask.TryGetValue(sku, out var q) ? q : 0m) : left;
                            if (give > left + 0.0001m) return Bad($"Only {left} of {sku} is still to deliver.");
                            if (give > 0) { line["delivered"] = got + give; done.Add(new { sku, name = line["name"]?.ToString() ?? "", qty = give }); total += give; }
                            if (qty - (got + give) > 0.0001m) allDone = false;
                        }
                        if (total <= 0) return Bad("Nothing to deliver.");
                        numLock = await NumberingLock.Enter(tenantId + "|erp|so|delivery");
                        var dn = await NextCode(tenantId, "so", "delivery", "DLV");
                        _db.ErpRecords.Add(new ErpRecord { TenantId = tenantId, Module = "so", Kind = "delivery", Code = dn, Company = rec.Company, Branch = rec.Branch, Status = "Done", Ref = rec.Code, CreatedBy = Username,
                            Data = J(new() { ["order"] = rec.Code, ["customer"] = FinJson.S(d, "customer"), ["lines"] = done, ["deliveredAt"] = now, ["deliveredBy"] = Username, ["note"] = note }) });
                        rec.Status = allDone ? "Delivered" : "PartiallyDelivered";
                        var dels = FinJson.S(d, "deliveries"); root["deliveries"] = dels == "" ? dn : dels + ", " + dn;
                        rec.Data = root.ToJsonString();
                        break;
                    }
                case ("so", "order", "invoice"):
                    if (rec.Status != "Delivered") return Bad("Deliver the whole order before invoicing it.");
                    rec.Status = "Invoiced"; rec.Data = FinJson.WithValues(rec.Data, new() { ["invoicedAt"] = now, ["invoicedBy"] = Username, ["invoiceNo"] = note });
                    break;
                case ("so", "order", "cancel"):
                    {
                        if (rec.Status is not ("Draft" or "Confirmed")) return Bad("An order that was delivered can't be cancelled.");
                        if (note == null) return Bad("Write the reason for cancelling.");
                        rec.Status = "Cancelled"; rec.Data = FinJson.WithValues(rec.Data, new() { ["cancelReason"] = note });
                        break;
                    }
                // ------------------------------------------------ helpdesk
                case ("hd", "ticket", "assign"):
                    {
                        if (!BizOpenTicket(rec.Status)) return Bad("This ticket is finished.");
                        var user = Clean(b.User); if (user == null) return Bad("Choose who will handle the ticket.");
                        if (!await BizActiveUser(tenantId, user)) return Bad("That person isn't an active user of this workspace.");
                        if (rec.Status == "New") rec.Status = "Assigned";
                        rec.Data = FinJson.WithValues(rec.Data, new() { ["assignedTo"] = user, ["firstResponseAt"] = FinJson.S(d, "firstResponseAt") == "" ? now : (object?)FinJson.S(d, "firstResponseAt") });
                        break;
                    }
                case ("hd", "ticket", "start"):
                    if (rec.Status is not ("New" or "Assigned" or "Waiting")) return Bad("Only a new, assigned or waiting ticket can be started.");
                    rec.Status = "InProgress"; rec.Data = FinJson.WithValues(rec.Data, new() { ["firstResponseAt"] = FinJson.S(d, "firstResponseAt") == "" ? now : (object?)FinJson.S(d, "firstResponseAt") });
                    break;
                case ("hd", "ticket", "wait"):
                    if (rec.Status != "InProgress") return Bad("Only a ticket in progress can wait for the customer.");
                    rec.Status = "Waiting"; rec.Data = FinJson.WithValues(rec.Data, new() { ["waitNote"] = note });
                    break;
                case ("hd", "ticket", "resolve"):
                    {
                        if (!BizOpenTicket(rec.Status)) return Bad("This ticket is finished already.");
                        if (note == null) return Bad("Write the resolution.");
                        var late = FinJson.TryDate(d, "dueAt", out var due) && now > due;
                        rec.Status = "Resolved"; rec.Data = FinJson.WithValues(rec.Data, new() { ["resolvedAt"] = now, ["resolvedBy"] = Username, ["resolution"] = note, ["breached"] = late });
                        break;
                    }
                case ("hd", "ticket", "close"):
                    if (rec.Status != "Resolved") return Bad("Resolve the ticket first.");
                    rec.Status = "Closed"; rec.Data = FinJson.WithValues(rec.Data, new() { ["closedAt"] = now });
                    break;
                case ("hd", "ticket", "reopen"):
                    if (rec.Status is not ("Resolved" or "Closed")) return Bad("Only a resolved or closed ticket can be reopened.");
                    rec.Status = "InProgress"; rec.Data = FinJson.WithValues(rec.Data, new() { ["resolvedAt"] = null, ["resolvedBy"] = null, ["closedAt"] = null, ["breached"] = null });
                    break;
                case ("hd", "ticket", "cancel"):
                    if (rec.Status is not ("New" or "Assigned" or "Waiting")) return Bad("Only a ticket that hasn't been worked on can be cancelled.");
                    if (note == null) return Bad("Write the reason for cancelling.");
                    rec.Status = "Cancelled"; rec.Data = FinJson.WithValues(rec.Data, new() { ["resolution"] = note });
                    break;
                case ("hd", "visit", "start"):
                    if (rec.Status != "Scheduled") return Bad("Only a scheduled visit can be started.");
                    rec.Status = "InProgress"; rec.Data = FinJson.WithValues(rec.Data, new() { ["startedAt"] = now });
                    break;
                case ("hd", "visit", "complete"):
                    {
                        if (rec.Status != "InProgress") return Bad("Start the visit before completing it.");
                        var hours = b.Amount ?? FinJson.D(d, "hours"); var cost = b.Cost ?? FinJson.D(d, "cost");
                        if (hours < 0 || cost < 0) return Bad("Hours and cost can't be negative.");
                        rec.Status = "Done"; rec.Data = FinJson.WithValues(rec.Data, new() { ["completedAt"] = now, ["completedBy"] = Username, ["hours"] = hours, ["cost"] = cost, ["resolution"] = note });
                        break;
                    }
                case ("hd", "visit", "cancel"):
                    if (rec.Status is not ("Scheduled" or "InProgress")) return Bad("This visit is finished already.");
                    if (note == null) return Bad("Write the reason for cancelling.");
                    rec.Status = "Cancelled"; rec.Data = FinJson.WithValues(rec.Data, new() { ["resolution"] = note });
                    break;
                // ------------------------------------------------ subscriptions
                case ("sub", "subscription", "activate"):
                    {
                        if (rec.Status != "Draft") return Bad("Only a draft subscription can be activated.");
                        var plan = await BizByCode(tenantId, "sub", "plan", FinJson.S(d, "plan")); if (plan == null || plan.Status != "Active") return Bad("The plan isn't available.");
                        if (!BizDate(FinJson.S(d, "startDate"), out var st)) return Bad("Enter the start date.");
                        rec.Status = "Active"; rec.Data = FinJson.WithValues(rec.Data, new() { ["activatedAt"] = now, ["nextBillDate"] = BizIso(st), ["billedCount"] = 0 });
                        break;
                    }
                case ("sub", "subscription", "pause"):
                    if (rec.Status != "Active") return Bad("Only an active subscription can be paused.");
                    rec.Status = "Paused"; break;
                case ("sub", "subscription", "resume"):
                    {
                        if (rec.Status != "Paused") return Bad("Only a paused subscription can be resumed.");
                        var nb = FinJson.TryDate(d, "nextBillDate", out var nd) ? nd.Date : today; if (nb < today) nb = today;
                        rec.Status = "Active"; rec.Data = FinJson.WithValues(rec.Data, new() { ["nextBillDate"] = BizIso(nb) });
                        break;
                    }
                case ("sub", "subscription", "cancel"):
                    if (rec.Status is not ("Draft" or "Active" or "Paused")) return Bad("This subscription is cancelled already.");
                    if (note == null) return Bad("Write the reason for cancelling.");
                    rec.Status = "Cancelled"; rec.Data = FinJson.WithValues(rec.Data, new() { ["cancelReason"] = note, ["nextBillDate"] = null });
                    break;
                case ("sub", "subscription", "bill"):
                    {
                        if (rec.Status != "Active") return Bad("Only an active subscription can be billed.");
                        if (!FinJson.TryDate(d, "nextBillDate", out var nb)) return Bad("The subscription has no next billing date.");
                        if (nb.Date > today) return Bad($"The next billing date is {BizIso(nb)}.");
                        var plan = await BizByCode(tenantId, "sub", "plan", FinJson.S(d, "plan")); var period = plan == null ? "Monthly" : FinJson.S(FinJson.Obj(plan.Data), "period");
                        var qty = FinJson.D(d, "qty"); if (qty <= 0) qty = 1;
                        var amount = R2(qty * FinJson.D(d, "price"));
                        numLock = await NumberingLock.Enter(tenantId + "|erp|sub|invoice");
                        var inv = await NextCode(tenantId, "sub", "invoice", "SIN");
                        var to = nb.Date.AddMonths(BizMonths(period));
                        _db.ErpRecords.Add(new ErpRecord { TenantId = tenantId, Module = "sub", Kind = "invoice", Code = inv, Company = rec.Company, Branch = rec.Branch, Status = "Unpaid", Ref = rec.Code, CreatedBy = Username,
                            Data = J(new() { ["subscription"] = rec.Code, ["customer"] = FinJson.S(d, "customer"), ["plan"] = FinJson.S(d, "plan"), ["periodFrom"] = BizIso(nb), ["periodTo"] = BizIso(to.AddDays(-1)), ["amount"] = amount, ["issuedAt"] = BizIso(today), ["dueDate"] = BizIso(today.AddDays(15)) }) });
                        rec.Data = FinJson.WithValues(rec.Data, new() { ["nextBillDate"] = BizIso(to), ["billedCount"] = (int)FinJson.D(d, "billedCount") + 1, ["lastInvoice"] = inv });
                        break;
                    }
                case ("sub", "invoice", "markpaid"):
                    {
                        if (rec.Status != "Unpaid") return Bad("Only an unpaid invoice can be marked as paid.");
                        var method = Clean(b.Method) ?? "Transfer"; if (!BizMethods.Contains(method)) return Bad("Choose Cash, Transfer, Cheque or Card.");
                        rec.Status = "Paid"; rec.Data = FinJson.WithValues(rec.Data, new() { ["paid"] = FinJson.D(d, "amount"), ["paidAt"] = now, ["method"] = method });
                        break;
                    }
                case ("sub", "invoice", "void"):
                    if (rec.Status != "Unpaid") return Bad("Only an unpaid invoice can be voided.");
                    if (note == null) return Bad("Write the reason.");
                    rec.Status = "Void"; rec.Data = FinJson.WithValues(rec.Data, new() { ["voidReason"] = note });
                    break;
                // ------------------------------------------------ expenses
                case ("exp", "claim", "submit"):
                    if (rec.Status is not ("Draft" or "Rejected")) return Bad("Only a draft or rejected claim can be submitted.");
                    if (rec.CreatedBy != Username && !await Has("exp.approve")) return Forbid();
                    if (!FinJson.Lines(d).Any()) return Bad("The claim has no expense lines.");
                    rec.Status = "Submitted"; rec.Data = FinJson.WithValues(rec.Data, new() { ["submittedAt"] = now, ["rejectReason"] = null });
                    break;
                case ("exp", "claim", "approve"):
                    if (rec.Status != "Submitted") return Bad("Only a submitted claim can be approved.");
                    if (rec.CreatedBy == Username) return Bad("You can't approve your own claim.");
                    rec.Status = "Approved"; rec.Data = FinJson.WithValues(rec.Data, new() { ["approvedBy"] = Username, ["approvedAt"] = now });
                    break;
                case ("exp", "claim", "reject"):
                    if (rec.Status != "Submitted") return Bad("Only a submitted claim can be rejected.");
                    if (note == null) return Bad("Write the reason for rejecting.");
                    rec.Status = "Rejected"; rec.Data = FinJson.WithValues(rec.Data, new() { ["rejectReason"] = note });
                    break;
                case ("exp", "claim", "pay"):
                    {
                        if (rec.Status != "Approved") return Bad("Only an approved claim can be paid.");
                        var method = Clean(b.Method) ?? "Transfer"; if (!BizMethods.Contains(method)) return Bad("Choose Cash, Transfer, Cheque or Card.");
                        rec.Status = "Paid"; rec.Data = FinJson.WithValues(rec.Data, new() { ["paidAt"] = now, ["paidBy"] = Username, ["method"] = method });
                        break;
                    }
                // ------------------------------------------------ quality
                case ("qa", "inspection", "evaluate"):
                case ("qa", "inspection", "pass"):
                case ("qa", "inspection", "fail"):
                    {
                        if (rec.Status != "Pending") return Bad("This inspection is finished already.");
                        var fails = new List<string>();
                        if (op == "evaluate")
                        {
                            var plan = await BizByCode(tenantId, "qa", "plan", FinJson.S(d, "plan")); if (plan == null) return Bad("The inspection plan doesn't exist any more.");
                            var results = FinJson.Lines(d).ToList();
                            if (results.Count == 0) return Bad("Enter the measured values first.");
                            foreach (var chk in FinJson.Lines(FinJson.Obj(plan.Data)))
                            {
                                var nm = FinJson.S(chk, "name"); var res = results.FirstOrDefault(x => string.Equals(FinJson.S(x, "check"), nm, StringComparison.OrdinalIgnoreCase));
                                if (res.ValueKind != JsonValueKind.Object || FinJson.S(res, "value") == "") { fails.Add(nm + " (not measured)"); continue; }
                                var v = FinJson.D(res, "value");
                                if (FinJson.S(chk, "min") != "" && v < FinJson.D(chk, "min")) fails.Add($"{nm} = {v} (min {FinJson.D(chk, "min")})");
                                else if (FinJson.S(chk, "max") != "" && v > FinJson.D(chk, "max")) fails.Add($"{nm} = {v} (max {FinJson.D(chk, "max")})");
                            }
                        }
                        else if (op == "fail") { if (note == null) return Bad("Write why it failed."); fails.Add(note); }
                        var failed = fails.Count > 0;
                        string? ncr = null;
                        if (failed)
                        {
                            numLock = await NumberingLock.Enter(tenantId + "|erp|qa|ncr");
                            ncr = await NextCode(tenantId, "qa", "ncr", "NCR");
                            _db.ErpRecords.Add(new ErpRecord { TenantId = tenantId, Module = "qa", Kind = "ncr", Code = ncr, Company = rec.Company, Branch = rec.Branch, Status = "Open", Ref = rec.Code, CreatedBy = Username,
                                Data = J(new() { ["title"] = "Failed inspection " + rec.Code, ["source"] = rec.Code, ["severity"] = "Major", ["description"] = string.Join("; ", fails), ["lotNo"] = FinJson.S(d, "lotNo") }) });
                        }
                        rec.Status = failed ? "Failed" : "Passed";
                        rec.Data = FinJson.WithValues(rec.Data, new() { ["inspectedAt"] = now, ["inspectedBy"] = Username, ["failedChecks"] = string.Join("; ", fails), ["ncr"] = ncr, ["note"] = note });
                        break;
                    }
                case ("qa", "ncr", "investigate"):
                    {
                        if (rec.Status != "Open") return Bad("Only an open report can be investigated.");
                        var user = Clean(b.User);
                        if (user != null && !await BizActiveUser(tenantId, user)) return Bad("That person isn't an active user of this workspace.");
                        rec.Status = "Investigating"; rec.Data = FinJson.WithValues(rec.Data, new() { ["owner"] = user ?? Username });
                        break;
                    }
                case ("qa", "ncr", "correct"):
                    if (rec.Status is not ("Open" or "Investigating")) return Bad("This report is corrected already.");
                    if (note == null) return Bad("Write the corrective action.");
                    rec.Status = "Corrected"; rec.Data = FinJson.WithValues(rec.Data, new() { ["correctiveAction"] = note, ["correctedAt"] = now });
                    break;
                case ("qa", "ncr", "close"):
                    if (rec.Status != "Corrected") return Bad("Record the corrective action before closing.");
                    rec.Status = "Closed"; rec.Data = FinJson.WithValues(rec.Data, new() { ["closedAt"] = now, ["closedBy"] = Username });
                    break;
                // ------------------------------------------------ fleet
                case ("flt", "service", "start"):
                    {
                        if (rec.Status != "Scheduled") return Bad("Only a scheduled job can be started.");
                        var v = await BizByCode(tenantId, "flt", "vehicle", FinJson.S(d, "vehicle"), true);
                        if (v != null && v.Status == "Active") { v.Status = "InService"; v.UpdatedAt = now; }
                        rec.Status = "InProgress"; rec.Data = FinJson.WithValues(rec.Data, new() { ["startedAt"] = now });
                        break;
                    }
                case ("flt", "service", "complete"):
                    {
                        if (rec.Status != "InProgress") return Bad("Start the job before completing it.");
                        var cost = b.Cost ?? FinJson.D(d, "cost"); if (cost < 0) return Bad("The cost can't be negative.");
                        var v = await BizByCode(tenantId, "flt", "vehicle", FinJson.S(d, "vehicle"), true);
                        if (v != null)
                        {
                            if (v.Status == "InService") v.Status = "Active";
                            var odo = FinJson.D(d, "odometer"); if (odo > FinJson.D(FinJson.Obj(v.Data), "odometer")) v.Data = FinJson.WithValues(v.Data, new() { ["odometer"] = odo });
                            v.UpdatedAt = now;
                        }
                        rec.Status = "Done"; rec.Data = FinJson.WithValues(rec.Data, new() { ["completedAt"] = now, ["cost"] = cost, ["resolution"] = note });
                        break;
                    }
                case ("flt", "service", "cancel"):
                    {
                        if (rec.Status is not ("Scheduled" or "InProgress")) return Bad("This job is finished already.");
                        if (note == null) return Bad("Write the reason for cancelling.");
                        var v = await BizByCode(tenantId, "flt", "vehicle", FinJson.S(d, "vehicle"), true);
                        if (v != null && v.Status == "InService" && rec.Status == "InProgress") { v.Status = "Active"; v.UpdatedAt = now; }
                        rec.Status = "Cancelled"; rec.Data = FinJson.WithValues(rec.Data, new() { ["resolution"] = note });
                        break;
                    }
                default:
                    return NotFound();
            }
            rec.UpdatedAt = now;
            await _db.SaveChangesAsync();
            return Ok(ErpRecordDto.From(rec));
        }
        finally { numLock?.Dispose(); }
    }

    // ------------------------------------------------------------------ overview

    private void BizSummary(SummaryDto s, string module, List<(ErpRecord r, JsonElement d)> all, DateTime today)
    {
        IEnumerable<(ErpRecord r, JsonElement d)> Kd(string k) => all.Where(x => x.r.Kind == k);
        IEnumerable<(string, decimal)> Cnt(string k) => Kd(k).GroupBy(x => x.r.Status ?? "").Select(g => (g.Key, (decimal)g.Count()));
        var now = DateTime.UtcNow; var month = new DateTime(now.Year, now.Month, 1);
        switch (module)
        {
            case "so":
                {
                    var o = Kd("order").ToList(); var live = o.Where(x => x.r.Status is not ("Draft" or "Cancelled")).ToList();
                    s.Kpis.AddRange(new[] { K("draft", o.Count(x => x.r.Status == "Draft")), K("toDeliver", o.Count(x => x.r.Status is "Confirmed" or "PartiallyDelivered")), K("toInvoice", o.Count(x => x.r.Status == "Delivered")),
                        K("salesMonth", R2(live.Where(x => x.r.CreatedAt >= month).Sum(x => FinJson.D(x.d, "total"))), "m"), K("openValue", R2(o.Where(x => x.r.Status is "Confirmed" or "PartiallyDelivered" or "Delivered").Sum(x => FinJson.D(x.d, "total"))), "m"),
                        K("deliveriesMonth", Kd("delivery").Count(x => x.r.CreatedAt >= month)) });
                    s.Lists.Add(S("byStatus", Cnt("order")));
                    s.Lists.Add(S("topCustomers", live.GroupBy(x => FinJson.S(x.d, "customer")).Select(g => (g.Key == "" ? "-" : g.Key, g.Sum(x => FinJson.D(x.d, "total")))).OrderByDescending(x => x.Item2).Take(8)));
                    break;
                }
            case "hd":
                {
                    var t = Kd("ticket").ToList(); var open = t.Where(x => BizOpenTicket(x.r.Status)).ToList();
                    var overdue = open.Count(x => FinJson.TryDate(x.d, "dueAt", out var du) && now > du);
                    var resolved = t.Where(x => x.r.Status is "Resolved" or "Closed").ToList();
                    s.Kpis.AddRange(new[] { K("open", open.Count), K("unassigned", t.Count(x => x.r.Status == "New")), K("overdue", overdue), K("urgent", open.Count(x => FinJson.S(x.d, "priority") == "Urgent")),
                        K("resolvedMonth", resolved.Count(x => FinJson.TryDate(x.d, "resolvedAt", out var ra) && ra >= month)),
                        K("slaPct", resolved.Count == 0 ? 100 : Math.Round(100m * resolved.Count(x => !FinJson.B(x.d, "breached")) / resolved.Count, 1), "p"),
                        K("visitsToday", Kd("visit").Count(x => x.r.Status is "Scheduled" or "InProgress" && FinJson.TryDate(x.d, "date", out var vd) && vd.Date == today.Date)) });
                    s.Lists.Add(S("byStatus", Cnt("ticket")));
                    s.Lists.Add(S("byPriority", open.GroupBy(x => FinJson.S(x.d, "priority")).Select(g => (g.Key, (decimal)g.Count()))));
                    s.Lists.Add(S("visitsByStatus", Cnt("visit")));
                    break;
                }
            case "sub":
                {
                    var act = Kd("subscription").Where(x => x.r.Status == "Active").ToList();
                    var periods = Kd("plan").ToDictionary(x => x.r.Code ?? "", x => FinJson.S(x.d, "period"));
                    decimal Mrr((ErpRecord r, JsonElement d) x) { var q = FinJson.D(x.d, "qty"); if (q <= 0) q = 1; var m = BizMonths(periods.TryGetValue(FinJson.S(x.d, "plan"), out var p) ? p : "Monthly"); return q * FinJson.D(x.d, "price") / m; }
                    var mrr = R2(act.Sum(Mrr));
                    s.Kpis.AddRange(new[] { K("active", act.Count), K("mrr", mrr, "m"), K("arr", R2(mrr * 12), "m"),
                        K("dueBilling", act.Count(x => FinJson.TryDate(x.d, "nextBillDate", out var nb) && nb.Date <= today.Date)),
                        K("unpaid", R2(Kd("invoice").Where(x => x.r.Status == "Unpaid").Sum(x => FinJson.D(x.d, "amount"))), "m"),
                        K("churnMonth", Kd("subscription").Count(x => x.r.Status == "Cancelled" && x.r.UpdatedAt >= month)) });
                    s.Lists.Add(S("byStatus", Cnt("subscription")));
                    s.Lists.Add(S("mrrByPlan", act.GroupBy(x => FinJson.S(x.d, "plan")).Select(g => (g.Key, g.Sum(Mrr)))));
                    break;
                }
            case "exp":
                {
                    var c = Kd("claim").ToList();
                    s.Kpis.AddRange(new[] { K("pending", c.Count(x => x.r.Status == "Submitted")), K("pendingAmount", R2(c.Where(x => x.r.Status == "Submitted").Sum(x => FinJson.D(x.d, "total"))), "m"),
                        K("toPay", R2(c.Where(x => x.r.Status == "Approved").Sum(x => FinJson.D(x.d, "total"))), "m"),
                        K("paidMonth", R2(c.Where(x => x.r.Status == "Paid" && FinJson.TryDate(x.d, "paidAt", out var pa) && pa >= month).Sum(x => FinJson.D(x.d, "total"))), "m"),
                        K("rejected", c.Count(x => x.r.Status == "Rejected")) });
                    s.Lists.Add(S("byStatus", Cnt("claim")));
                    s.Lists.Add(S("byCategory", c.Where(x => x.r.Status is "Approved" or "Paid").SelectMany(x => FinJson.Lines(x.d)).GroupBy(l => FinJson.S(l, "category") == "" ? "-" : FinJson.S(l, "category")).Select(g => (g.Key, g.Sum(l => FinJson.D(l, "amount")))).OrderByDescending(x => x.Item2).Take(8)));
                    break;
                }
            case "qa":
                {
                    var i = Kd("inspection").ToList(); var done = i.Where(x => x.r.Status != "Pending").ToList(); var n = Kd("ncr").ToList();
                    s.Kpis.AddRange(new[] { K("pending", i.Count(x => x.r.Status == "Pending")), K("passRate", done.Count == 0 ? 100 : Math.Round(100m * done.Count(x => x.r.Status == "Passed") / done.Count, 1), "p"),
                        K("openNcr", n.Count(x => x.r.Status != "Closed")), K("ncrCost", R2(n.Sum(x => FinJson.D(x.d, "cost"))), "m"), K("plans", Kd("plan").Count(x => x.r.Status == "Active")) });
                    s.Lists.Add(S("byStatus", Cnt("inspection"))); s.Lists.Add(S("ncrByStatus", Cnt("ncr")));
                    break;
                }
            case "flt":
                {
                    var v = Kd("vehicle").ToList(); var soon = today.AddDays(30);
                    decimal Cost(string kind) => Kd(kind).Where(x => x.r.Status != "Cancelled" && FinJson.TryDate(x.d, kind == "fuel" ? "date" : "date", out var dd) && dd >= month).Sum(x => FinJson.D(x.d, "cost"));
                    s.Kpis.AddRange(new[] { K("vehicles", v.Count(x => x.r.Status != "Retired")), K("inService", v.Count(x => x.r.Status == "InService")), K("fuelMonth", R2(Cost("fuel")), "m"), K("serviceMonth", R2(Cost("service")), "m"),
                        K("licenseExpiring", Kd("driver").Count(x => x.r.Status == "Active" && FinJson.TryDate(x.d, "licenseExpiry", out var le) && le.Date <= soon)),
                        K("serviceDue", Kd("service").Count(x => x.r.Status == "Scheduled" && FinJson.TryDate(x.d, "date", out var sd) && sd.Date <= today.AddDays(14))) });
                    s.Lists.Add(S("byStatus", v.GroupBy(x => x.r.Status ?? "").Select(g => (g.Key, (decimal)g.Count()))));
                    s.Lists.Add(S("costByVehicle", Kd("fuel").Concat(Kd("service").Where(x => x.r.Status != "Cancelled")).GroupBy(x => FinJson.S(x.d, "vehicle")).Select(g => (g.Key, g.Sum(x => FinJson.D(x.d, "cost")))).OrderByDescending(x => x.Item2).Take(8)));
                    break;
                }
        }
    }
}
