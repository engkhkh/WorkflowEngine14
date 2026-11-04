using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class ErpRecordDto
{
    public string Id { get; set; } = string.Empty;
    public string Module { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? Company { get; set; }
    public string? Branch { get; set; }
    public string? Status { get; set; }
    public string? Ref { get; set; }
    public string? Parent { get; set; }
    public JsonElement Data { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public static ErpRecordDto From(ErpRecord r) => new()
    {
        Id = r.Id, Module = r.Module, Kind = r.Kind, Code = r.Code, Company = r.Company, Branch = r.Branch, Status = r.Status, Ref = r.Ref, Parent = r.Parent,
        Data = FinJson.Obj(r.Data), CreatedBy = r.CreatedBy, CreatedAt = r.CreatedAt, UpdatedAt = r.UpdatedAt
    };
}
public class MfgCompleteDto { public decimal Qty { get; set; } public decimal Scrap { get; set; } public decimal Hours { get; set; } public string? Note { get; set; } }
public class PrjBillDto { public decimal TaxPct { get; set; } = 15; public string? Date { get; set; } public int TermsDays { get; set; } = 30; }
public class CrmConvertDto { public bool CreateOpportunity { get; set; } = true; public decimal Amount { get; set; } }

/// <summary>
/// Manufacturing (bills of materials, work orders with material issue + finished-goods receipt + costing, quality, maintenance),
/// Projects (budgets, tasks, resources, timesheets, costs, milestones, billing into receivables, profitability) and CRM
/// (leads, accounts, contacts, opportunities, activities, quotes, pipeline). Items are the Point-of-sale products, so stock moves
/// land in the same stock ledger; billing lands in Finance as a DRAFT invoice. Every endpoint checks the privilege that the
/// Admin module hands out (mfg.* / prj.* / crm.*) and everything is scoped to the caller's workspace.
/// </summary>
[ApiController]
[Route("api/erp/{module}")]
[Authorize]
public partial class ModulesController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;
    public ModulesController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant) { _db = db; _perms = perms; _tenant = tenant; }

    private string Username => User.FindFirstValue(ClaimTypes.Name)!;
    private Task<bool> Has(string p) => _perms.Has(User, p);
    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static decimal R2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    private static string J(Dictionary<string, object?> d) => JsonSerializer.Serialize(d);
    private BadRequestObjectResult Bad(string m) => BadRequest(new { message = m });

    private static readonly string[] Modules = { "mfg", "prj", "crm", "proc", "scm", "wh", "ast", "pay", "epm", "bpm", "int", "bi" };

    /// <summary>(view privilege, manage privilege) for a record kind, or null when the kind does not exist in that module.</summary>
    private static (string view, string manage)? KindPerms(string module, string kind) => (module, kind) switch
    {
        ("mfg", "bom" or "workcenter" or "machine") => ("mfg.view", "mfg.bom.manage"),
        ("mfg", "workorder") => ("mfg.view", "mfg.orders.manage"),
        ("mfg", "inspection") => ("mfg.view", "mfg.quality.manage"),
        ("mfg", "maintenance") => ("mfg.view", "mfg.maintenance.manage"),
        ("mfg", "plan") => ("mfg.view", "mfg.planning"),
        ("mfg", "setting") => ("mfg.view", "mfg.setup"),
        ("prj", "project" or "milestone") => ("prj.view", "prj.manage"),
        ("prj", "task") => ("prj.view", "prj.tasks.manage"),
        ("prj", "allocation") => ("prj.view", "prj.resources.manage"),
        ("prj", "timesheet") => ("prj.view", "prj.time.log"),
        ("prj", "cost") => ("prj.view", "prj.costs.manage"),
        ("prj", "setting") => ("prj.view", "prj.manage"),
        ("crm", "lead") => ("crm.view", "crm.leads.manage"),
        ("crm", "account" or "contact") => ("crm.view", "crm.accounts.manage"),
        ("crm", "opportunity") => ("crm.view", "crm.opps.manage"),
        ("crm", "activity") => ("crm.view", "crm.activities.manage"),
        ("crm", "quote") => ("crm.view", "crm.quotes.manage"),
        ("crm", "campaign") => ("crm.view", "crm.campaigns.manage"),
        ("crm", "setting") => ("crm.view", "crm.setup"),
        _ => KindPermsExt(module, kind)
    };

    private static string? AutoPrefix(string module, string kind) => (module, kind) switch
    {
        ("mfg", "workorder") => "WO", ("mfg", "inspection") => "QC", ("mfg", "maintenance") => "MT", ("mfg", "plan") => "MRP",
        ("prj", "project") => "PRJ", ("prj", "task") => "TSK", ("prj", "timesheet") => "TS", ("prj", "cost") => "PC", ("prj", "milestone") => "MS",
        ("crm", "lead") => "LD", ("crm", "account") => "AC", ("crm", "contact") => "CT", ("crm", "opportunity") => "OP", ("crm", "activity") => "ACT", ("crm", "quote") => "QT", ("crm", "campaign") => "CMP",
        _ => null
    };
    private static readonly string[] CodeRequired = { "bom", "workcenter", "machine", "setting" };

    private async Task<bool> HasAny(string module) => (await _perms.EffectiveFor(User)).Any(p => p.StartsWith(module + ".", StringComparison.OrdinalIgnoreCase));

    // ------------------------------------------------------------------ generic records

    [HttpGet("records/{kind}")]
    public async Task<IActionResult> List(string module, string kind, [FromQuery] string? company, [FromQuery] string? branch, [FromQuery] string? status,
        [FromQuery(Name = "ref")] string? reference, [FromQuery] int take = 3000)
    {
        var kp = KindPerms(module, kind);
        if (kp == null) return NotFound();
        // reference lists fill the drop-downs of the other screens: any holder of a privilege of the module may read them
        var refKind = kind is "bom" or "workcenter" or "machine" or "project" or "account" or "contact" or "setting";
        if (!(await Has(kp.Value.view) || (refKind && await HasAny(module)))) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var q = _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == module && r.Kind == kind);
        if (!string.IsNullOrWhiteSpace(company) && company != "ALL") q = q.Where(r => r.Company == company || r.Company == null || r.Company == "");
        if (!string.IsNullOrWhiteSpace(branch) && branch != "ALL") q = q.Where(r => r.Branch == branch || r.Branch == null || r.Branch == "");
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(r => r.Status == status);
        if (!string.IsNullOrWhiteSpace(reference)) q = q.Where(r => r.Ref == reference);
        // people who may only log their own time see just their own sheets
        if (module == "prj" && kind == "timesheet" && !(await Has("prj.time.approve") || await Has("prj.reports.view") || await Has("prj.manage")))
            q = q.Where(r => r.CreatedBy == Username);
        if (module == "pay" && kind == "payslip" && !(await Has("pay.payslips.view") || await Has("pay.run.manage"))) q = q.Where(r => r.Ref == Username);   // everybody may see their own payslips
        var list = await q.OrderByDescending(r => r.CreatedAt).Take(Math.Clamp(take, 1, 5000)).ToListAsync();
        return Ok(list.Select(ErpRecordDto.From));
    }

    [HttpPost("records/{kind}")]
    public async Task<IActionResult> Create(string module, string kind, [FromBody] ErpRecordDto body)
    {
        var kp = KindPerms(module, kind);
        if (kp == null) return NotFound();
        if (!await Has(kp.Value.manage)) return Forbid();
        if (SystemOnly(module, kind)) return Bad("This record is created by the system.");
        var guardNew = await GuardExt(module, kind, null, Clean(body.Status));
        if (guardNew != null) return guardNew == "403" ? Forbid() : Bad(guardNew);
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = new ErpRecord
        {
            TenantId = tenantId, Module = module, Kind = kind, CreatedBy = Username, Code = Clean(body.Code), Company = Clean(body.Company), Branch = Clean(body.Branch),
            Status = Clean(body.Status) ?? DefaultStatus(module, kind), Ref = Clean(body.Ref), Parent = Clean(body.Parent),
            Data = body.Data.ValueKind == JsonValueKind.Object ? body.Data.GetRawText() : "{}"
        };
        var pre = AutoPrefix(module, kind);
        if (pre != null && rec.Code == null) rec.Code = await NextCode(tenantId, module, kind, pre);
        if (rec.Code == null && CodeRequired.Contains(kind)) return Bad("Code is required.");
        if (rec.Code != null && await _db.ErpRecords.AnyAsync(r => r.TenantId == tenantId && r.Module == module && r.Kind == kind && r.Code == rec.Code)) return Conflict(new { message = "That code already exists." });
        var err = await Validate(tenantId, module, kind, rec, null);
        if (err != null) return Bad(err);
        _db.ErpRecords.Add(rec);
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(rec));
    }

    [HttpPut("records/{kind}/{id}")]
    public async Task<IActionResult> Update(string module, string kind, string id, [FromBody] ErpRecordDto body)
    {
        var kp = KindPerms(module, kind);
        if (kp == null) return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.ErpRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Module == module && r.Kind == kind);
        if (rec == null) return NotFound();
        var newStatus = Clean(body.Status) ?? rec.Status;
        var statusChanges = !string.Equals(newStatus, rec.Status, StringComparison.Ordinal);
        if (SystemOnly(module, kind)) return Bad("This record is created by the system and can't be edited.");
        var guard = await GuardExt(module, kind, rec.Status, newStatus);
        if (guard != null) return guard == "403" ? Forbid() : Bad(guard);

        // timesheets: a person edits their own draft; approving needs its own privilege; billing is done only by the billing action
        if (module == "prj" && kind == "timesheet")
        {
            var approving = statusChanges && newStatus is "Approved" or "Rejected";
            if (newStatus == "Billed" || rec.Status == "Billed") return Bad("A billed timesheet can't be changed.");
            if (approving) { if (!await Has("prj.time.approve")) return Forbid(); }
            else if (!await Has(kp.Value.manage) || (rec.CreatedBy != Username && !await Has("prj.time.approve"))) return Forbid();
            if (rec.Status == "Approved" && !approving && !await Has("prj.time.approve")) return Bad("An approved timesheet can't be edited.");
        }
        else if (!await Has(kp.Value.manage)) return Forbid();

        if (module == "mfg" && kind == "workorder" && statusChanges && newStatus != "Cancelled") return Bad("Use release, start and complete to move a work order along.");
        if (module == "mfg" && kind == "workorder" && rec.Status is "Completed" or "Cancelled") return Bad("A finished work order can't be changed.");
        if (module == "prj" && kind is "cost" or "milestone" && rec.Status == "Billed") return Bad("A billed item can't be changed.");
        if (module == "prj" && kind == "cost" && newStatus == "Billed") return Bad("Billing is done by the billing action.");
        if (module == "prj" && kind == "milestone" && newStatus == "Billed") return Bad("Billing is done by the billing action.");

        rec.Company = Clean(body.Company) ?? rec.Company; rec.Branch = Clean(body.Branch) ?? rec.Branch;
        rec.Status = newStatus; rec.Ref = Clean(body.Ref) ?? rec.Ref; rec.Parent = Clean(body.Parent) ?? rec.Parent;
        if (body.Data.ValueKind == JsonValueKind.Object) rec.Data = MergeDataExt(module, kind, rec.Data, body.Data.GetRawText());
        var err = await Validate(tenantId, module, kind, rec, rec.Id);
        if (err != null) return Bad(err);
        rec.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(rec));
    }

    [HttpDelete("records/{kind}/{id}")]
    public async Task<IActionResult> Delete(string module, string kind, string id)
    {
        var kp = KindPerms(module, kind);
        if (kp == null) return NotFound();
        if (!await Has(kp.Value.manage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.ErpRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Module == module && r.Kind == kind);
        if (rec == null) return NotFound();
        if (rec.Status is "Billed" or "Completed" or "Won" || IsFinalExt(module, kind, rec.Status) || (SystemOnly(module, kind) && kind != "log")) return Bad("This record is final and can't be deleted.");
        if (module == "prj" && kind == "timesheet" && rec.CreatedBy != Username && !await Has("prj.time.approve")) return Forbid();
        _db.ErpRecords.Remove(rec);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private static string DefaultStatus(string module, string kind) => (module, kind) switch
    {
        ("mfg", "workorder") => "Planned", ("mfg", "maintenance") => "Open", ("mfg", "inspection") => "Pending",
        ("prj", "project") => "Planning", ("prj", "task") => "Todo", ("prj", "timesheet") => "Draft", ("prj", "cost") => "Open", ("prj", "milestone") => "Pending",
        ("crm", "lead") => "New", ("crm", "opportunity") => "Open", ("crm", "quote") => "Draft", ("crm", "activity") => "Open",
        _ => DefaultStatusExt(module, kind)
    };

    private async Task<string> NextCode(string tenantId, string module, string kind, string prefix)
    {
        var year = DateTime.UtcNow.Year;
        var n = await _db.ErpRecords.CountAsync(r => r.TenantId == tenantId && r.Module == module && r.Kind == kind) + 1;
        string code;
        do { code = $"{prefix}-{year}-{n:0000}"; n++; }
        while (await _db.ErpRecords.AnyAsync(r => r.TenantId == tenantId && r.Module == module && r.Kind == kind && r.Code == code)
               || _db.ErpRecords.Local.Any(r => r.TenantId == tenantId && r.Module == module && r.Kind == kind && r.Code == code));
        return code;
    }

    /// <summary>Rules that must hold whatever the screen sends.</summary>
    private async Task<string?> Validate(string tenantId, string module, string kind, ErpRecord r, string? selfId)
    {
        var d = FinJson.Obj(r.Data);
        switch (module, kind)
        {
            case ("mfg", "bom"):
                // a BOM can't contain its own product, directly or through another BOM (cycle)
                var comps = FinJson.Lines(d).Select(l => FinJson.S(l, "sku")).Where(s => s != "").ToList();
                if (comps.Count == 0) return "A bill of materials needs at least one component.";
                if (comps.Any(c => string.Equals(c, r.Code, StringComparison.OrdinalIgnoreCase))) return "A product can't be a component of itself.";
                if (FinJson.D(d, "qty") <= 0) return "The quantity produced must be greater than zero.";
                if (FinJson.Lines(d).Any(l => FinJson.D(l, "qty") <= 0)) return "Component quantities must be greater than zero.";
                var boms = (await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "mfg" && x.Kind == "bom" && x.Id != selfId).ToListAsync())
                    .ToDictionary(x => x.Code ?? "", x => FinJson.Lines(FinJson.Obj(x.Data)).Select(l => FinJson.S(l, "sku")).ToList(), StringComparer.OrdinalIgnoreCase);
                if (Reaches(boms, comps, r.Code ?? "", new HashSet<string>(StringComparer.OrdinalIgnoreCase))) return "That would make the bill of materials circular.";
                break;
            case ("mfg", "workorder"):
                if (FinJson.D(d, "qty") <= 0) return "The quantity to produce must be greater than zero.";
                if (FinJson.S(d, "sku") == "") return "Choose the product to produce.";
                break;
            case ("prj", "timesheet"):
                var h = FinJson.D(d, "hours");
                if (h <= 0 || h > 24) return "Hours must be between 0 and 24.";
                if (FinJson.S(d, "date") == "") return "Enter the date.";
                if (Clean(r.Ref) == null) return "Choose the project.";
                break;
            case ("prj", "cost"):
                if (FinJson.D(d, "amount") <= 0) return "Enter the amount.";
                if (Clean(r.Ref) == null) return "Choose the project.";
                break;
            case ("prj", "milestone" or "task" or "allocation"):
                if (Clean(r.Ref) == null) return "Choose the project.";
                break;
            case ("crm", "opportunity"):
                if (FinJson.S(d, "name") == "") return "Enter a name for the opportunity.";
                break;
            default:
                return await ValidateExt(tenantId, module, kind, r, d);
        }
        return null;
    }
    private static bool Reaches(Dictionary<string, List<string>> boms, IEnumerable<string> from, string target, HashSet<string> seen)
    {
        foreach (var c in from)
        {
            if (string.Equals(c, target, StringComparison.OrdinalIgnoreCase)) return true;
            if (!seen.Add(c)) continue;
            if (boms.TryGetValue(c, out var sub) && Reaches(boms, sub, target, seen)) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ manufacturing

    private ErpRecordDto? Wrap(ErpRecord? r) => r == null ? null : ErpRecordDto.From(r);

    [HttpPost("workorders/{id}/{action}")]
    public async Task<IActionResult> WorkOrderAction(string module, string id, string action, [FromBody] MfgCompleteDto? b)
    {
        if (module != "mfg") return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        var wo = await _db.ErpRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Module == "mfg" && r.Kind == "workorder");
        if (wo == null) return NotFound();
        var completed = false;
        switch (action)
        {
            case "release":
                if (!await Has("mfg.orders.manage")) return Forbid();
                if (wo.Status != "Planned") return Bad("Only a planned work order can be released.");
                wo.Status = "Released"; break;
            case "start":
                if (!await Has("mfg.orders.execute")) return Forbid();
                if (wo.Status != "Released") return Bad("Release the work order first.");
                wo.Status = "InProgress"; wo.Data = FinJson.WithValues(wo.Data, new() { ["startedAt"] = DateTime.UtcNow, ["startedBy"] = Username }); break;
            case "complete":
                if (!await Has("mfg.orders.execute")) return Forbid();
                if (wo.Status != "InProgress") return Bad("Start the work order before completing it.");
                var err = await CompleteWorkOrder(tenantId, wo, b ?? new MfgCompleteDto());
                if (err != null) return Bad(err);
                completed = true;
                break;
            case "cancel":
                if (!await Has("mfg.orders.manage")) return Forbid();
                if (wo.Status is "Completed" or "Cancelled") return Bad("That work order is already finished.");
                if (wo.Status == "InProgress") return Bad("An order in progress must be completed.");
                wo.Status = "Cancelled"; break;
            default: return NotFound();
        }
        wo.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (completed) await Fire(tenantId, "workorder.completed", new { workOrder = wo.Code, product = FinJson.S(FinJson.Obj(wo.Data), "sku"), cost = FinJson.D(FinJson.Obj(wo.Data), "actualCost") });
        return Ok(ErpRecordDto.From(wo));
    }

    private async Task<PosRecord> StockRec(string tenantId, string? company, string? branch, string sku)
    {
        var code = $"{branch ?? ""}|{sku}";
        var loc = _db.PosRecords.Local.FirstOrDefault(r => r.TenantId == tenantId && r.Kind == "stock" && r.Code == code);
        if (loc != null) return loc;
        var rec = await _db.PosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "stock" && r.Code == code);
        if (rec == null)
        {
            rec = new PosRecord { TenantId = tenantId, Kind = "stock", Code = code, Company = company, Branch = branch, Status = "Active", CreatedBy = Username, Data = J(new() { ["sku"] = sku, ["qty"] = 0m }) };
            _db.PosRecords.Add(rec);
        }
        return rec;
    }
    private void StockMove(string tenantId, PosRecord st, string? company, string? branch, string sku, decimal delta, string type, string doc)
    {
        var bal = FinJson.D(FinJson.Obj(st.Data), "qty") + delta;
        st.Data = FinJson.WithValues(st.Data, new() { ["qty"] = bal }); st.UpdatedAt = DateTime.UtcNow;
        _db.PosRecords.Add(new PosRecord { TenantId = tenantId, Kind = "stockmove", Company = company, Branch = branch, Status = type, Parent = doc, CreatedBy = Username, Code = sku,
            Data = J(new() { ["sku"] = sku, ["delta"] = delta, ["type"] = type, ["balance"] = bal }) });
    }

    /// <summary>Issues the components, receives the finished goods, works out the actual cost against the standard.</summary>
    private async Task<string?> CompleteWorkOrder(string tenantId, ErpRecord wo, MfgCompleteDto b)
    {
        var d = FinJson.Obj(wo.Data);
        var planned = FinJson.D(d, "qty");
        var good = b.Qty > 0 ? b.Qty : planned;
        var scrap = Math.Max(0, b.Scrap);
        if (b.Hours < 0) return "Hours can't be negative.";
        var produced = good + scrap;
        var sku = FinJson.S(d, "sku");
        var bomQty = Math.Max(0.0001m, FinJson.D(d, "bomQty") == 0 ? 1 : FinJson.D(d, "bomQty"));
        var factor = produced / bomQty;

        var cfgRec = await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "mfg" && r.Kind == "setting" && r.Code == "defaults");
        var cfg = FinJson.Obj(cfgRec?.Data);
        var allowNeg = FinJson.B(cfg, "allowNegativeStock");
        var overheadPct = cfg.ValueKind == JsonValueKind.Object && cfg.TryGetProperty("overheadPct", out _) ? FinJson.D(cfg, "overheadPct") : 15m;

        decimal material = 0, standardMaterial = 0;
        var consumed = new List<object>();
        foreach (var l in FinJson.Lines(d))
        {
            var csku = FinJson.S(l, "sku");
            var perUnit = FinJson.D(l, "qty");
            var need = Math.Round(perUnit * factor * (1 + FinJson.D(l, "scrapPct") / 100m), 4);
            var prod = await _db.PosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "product" && r.Code == csku);
            var cost = prod == null ? 0m : FinJson.D(FinJson.Obj(prod.Data), "cost");
            var st = await StockRec(tenantId, wo.Company, wo.Branch, csku);
            var have = FinJson.D(FinJson.Obj(st.Data), "qty");
            if (!allowNeg && have < need) return $"Not enough {csku} in stock (need {need}, have {have}).";
            StockMove(tenantId, st, wo.Company, wo.Branch, csku, -need, "mfg-issue", wo.Code ?? "");
            material += need * cost; standardMaterial += perUnit * (produced / bomQty) * cost;
            consumed.Add(new { sku = csku, qty = need, cost });
        }
        var wc = await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "mfg" && r.Kind == "workcenter" && r.Code == FinJson.S(d, "workCenter"));
        var rate = wc == null ? 0m : FinJson.D(FinJson.Obj(wc.Data), "costPerHour");
        var labor = R2(b.Hours * rate);
        var overhead = R2(labor * overheadPct / 100m);
        var stdMinutes = FinJson.D(d, "routingMinutes") * (produced / bomQty);
        var standardLabor = R2(stdMinutes / 60m * rate);
        var total = R2(material + labor + overhead);
        var standard = R2(standardMaterial + standardLabor + R2(standardLabor * overheadPct / 100m));

        if (sku != "" && good > 0)
        {
            var fg = await StockRec(tenantId, wo.Company, wo.Branch, sku);
            var onHand = Math.Max(0, FinJson.D(FinJson.Obj(fg.Data), "qty"));
            StockMove(tenantId, fg, wo.Company, wo.Branch, sku, good, "mfg-receipt", wo.Code ?? "");
            var fgProd = await _db.PosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "product" && r.Code == sku);
            if (fgProd != null)
            {   // moving-average cost of the finished product
                var oldCost = FinJson.D(FinJson.Obj(fgProd.Data), "cost");
                var unit = good == 0 ? 0 : total / good;
                var avg = onHand + good == 0 ? unit : (onHand * oldCost + good * unit) / (onHand + good);
                fgProd.Data = FinJson.WithValues(fgProd.Data, new() { ["cost"] = R2(avg) }); fgProd.UpdatedAt = DateTime.UtcNow;
            }
        }
        wo.Data = FinJson.WithValues(wo.Data, new()
        {
            ["goodQty"] = good, ["scrapQty"] = scrap, ["hours"] = b.Hours, ["materialCost"] = R2(material), ["laborCost"] = labor, ["overheadCost"] = overhead,
            ["actualCost"] = total, ["standardCost"] = standard, ["variance"] = R2(total - standard), ["unitCost"] = good == 0 ? 0 : R2(total / good),
            ["consumed"] = consumed, ["completedAt"] = DateTime.UtcNow, ["completedBy"] = Username, ["completeNote"] = b.Note
        });
        wo.Status = "Completed";
        return null;
    }

    // ------------------------------------------------------------------ projects

    /// <summary>Bills what is ready (approved timesheets, billable costs, achieved milestones) as a DRAFT customer invoice in Finance.</summary>
    [HttpPost("projects/{id}/bill")]
    public async Task<IActionResult> Bill(string module, string id, [FromBody] PrjBillDto b)
    {
        if (module != "prj") return NotFound();
        if (!await Has("prj.billing")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var pr = await _db.ErpRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Module == "prj" && r.Kind == "project");
        if (pr == null) return NotFound();
        var pd = FinJson.Obj(pr.Data);
        var customer = FinJson.S(pd, "customer");
        if (customer == "") return Bad("Set the customer on the project first.");
        var model = FinJson.S(pd, "billingModel");
        var items = await _db.ErpRecords.Where(r => r.TenantId == tenantId && r.Module == "prj" && r.Ref == pr.Code && (r.Kind == "timesheet" || r.Kind == "cost" || r.Kind == "milestone")).ToListAsync();
        var lines = new List<object>(); decimal net = 0;
        var touched = new List<ErpRecord>();
        if (model == "tm")
        {
            foreach (var t in items.Where(x => x.Kind == "timesheet" && x.Status == "Approved" && FinJson.B(FinJson.Obj(x.Data), "billable")))
            {
                var td = FinJson.Obj(t.Data); var amt = R2(FinJson.D(td, "hours") * FinJson.D(td, "rate"));
                lines.Add(new { description = $"{FinJson.S(td, "employee")} {FinJson.S(td, "date")}", qty = FinJson.D(td, "hours"), price = FinJson.D(td, "rate"), amount = amt }); net += amt; touched.Add(t);
            }
            foreach (var c in items.Where(x => x.Kind == "cost" && x.Status == "Open" && FinJson.B(FinJson.Obj(x.Data), "billable")))
            {
                var cd = FinJson.Obj(c.Data); var amt = R2(FinJson.D(cd, "amount") * (1 + FinJson.D(cd, "markupPct") / 100m));
                lines.Add(new { description = $"{FinJson.S(cd, "type")} {FinJson.S(cd, "description")}", qty = 1, price = amt, amount = amt }); net += amt; touched.Add(c);
            }
        }
        if (model is "milestone" or "fixed")
        {
            foreach (var m in items.Where(x => x.Kind == "milestone" && x.Status == "Achieved"))
            {
                var md = FinJson.Obj(m.Data); var amt = R2(FinJson.D(md, "amount"));
                lines.Add(new { description = FinJson.S(md, "name"), qty = 1, price = amt, amount = amt }); net += amt; touched.Add(m);
            }
        }
        if (lines.Count == 0) return Bad("There is nothing ready to bill on this project.");
        net = R2(net); var tax = R2(net * b.TaxPct / 100m);
        var date = Clean(b.Date) ?? DateTime.UtcNow.ToString("yyyy-MM-dd");
        var due = DateTime.TryParse(date, out var dt) ? dt.AddDays(b.TermsDays).ToString("yyyy-MM-dd") : date;
        var year = DateTime.UtcNow.Year;
        var n = await _db.FinRecords.CountAsync(r => r.TenantId == tenantId && r.Kind == "arinvoice") + 1;
        string code;
        do { code = $"INV-{year}-{n:0000}"; n++; } while (await _db.FinRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "arinvoice" && r.Code == code));
        var inv = new FinRecord
        {
            TenantId = tenantId, Kind = "arinvoice", Code = code, Company = pr.Company, Status = "Draft", CreatedBy = Username,
            Data = JsonSerializer.Serialize(new { customer, date, dueDate = due, currency = "", rate = 1, amount = net, taxAmount = tax, total = R2(net + tax), project = pr.Code, notes = $"Project {pr.Code} {FinJson.S(pd, "name")}", lines, paid = 0 })
        };
        _db.FinRecords.Add(inv);
        _db.FinAudits.Add(new FinAudit { TenantId = tenantId, Kind = "arinvoice", RecordId = inv.Id, Code = code, Action = "Created", UserName = Username, Summary = "Drafted from project " + pr.Code });
        foreach (var t in touched)
        {
            t.Status = "Billed"; t.UpdatedAt = DateTime.UtcNow;
            t.Data = FinJson.WithValues(t.Data, new() { ["invoice"] = code });
        }
        var billed = FinJson.D(pd, "billed") + net;
        pr.Data = FinJson.WithValues(pr.Data, new() { ["billed"] = R2(billed) }); pr.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await Fire(tenantId, "project.billed", new { project = pr.Code, invoice = code, total = R2(net + tax) });
        return Ok(new { invoice = code, net, tax, total = R2(net + tax), lines = lines.Count });
    }

    // ------------------------------------------------------------------ CRM

    [HttpPost("leads/{id}/convert")]
    public async Task<IActionResult> Convert(string module, string id, [FromBody] CrmConvertDto b)
    {
        if (module != "crm") return NotFound();
        if (!await Has("crm.leads.manage") || !await Has("crm.accounts.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var lead = await _db.ErpRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Module == "crm" && r.Kind == "lead");
        if (lead == null) return NotFound();
        if (lead.Status == "Converted") return Bad("That lead was already converted.");
        var d = FinJson.Obj(lead.Data);
        var acct = new ErpRecord { TenantId = tenantId, Module = "crm", Kind = "account", Code = await NextCode(tenantId, "crm", "account", "AC"), Company = lead.Company, Status = "Active", CreatedBy = Username,
            Data = J(new() { ["name"] = string.IsNullOrEmpty(FinJson.S(d, "company")) ? FinJson.S(d, "name") : FinJson.S(d, "company"), ["phone"] = FinJson.S(d, "phone"), ["email"] = FinJson.S(d, "email"), ["industry"] = FinJson.S(d, "industry"), ["owner"] = FinJson.S(d, "owner"), ["fromLead"] = lead.Code }) };
        _db.ErpRecords.Add(acct);
        var ct = new ErpRecord { TenantId = tenantId, Module = "crm", Kind = "contact", Code = await NextCode(tenantId, "crm", "contact", "CT"), Company = lead.Company, Status = "Active", Ref = acct.Code, CreatedBy = Username,
            Data = J(new() { ["name"] = FinJson.S(d, "name"), ["email"] = FinJson.S(d, "email"), ["phone"] = FinJson.S(d, "phone"), ["account"] = acct.Code }) };
        _db.ErpRecords.Add(ct);
        string? opCode = null;
        if (b.CreateOpportunity)
        {
            var op = new ErpRecord { TenantId = tenantId, Module = "crm", Kind = "opportunity", Code = await NextCode(tenantId, "crm", "opportunity", "OP"), Company = lead.Company, Status = "Open", Ref = acct.Code, CreatedBy = Username,
                Data = J(new() { ["name"] = FinJson.S(d, "name") + " – opportunity", ["account"] = acct.Code, ["contact"] = ct.Code, ["amount"] = b.Amount, ["stage"] = "Qualified", ["probability"] = 25, ["owner"] = FinJson.S(d, "owner"),
                    ["closeDate"] = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-dd"), ["source"] = FinJson.S(d, "source") }) };
            _db.ErpRecords.Add(op); opCode = op.Code;
        }
        lead.Status = "Converted"; lead.UpdatedAt = DateTime.UtcNow;
        lead.Data = FinJson.WithValues(lead.Data, new() { ["account"] = acct.Code, ["contact"] = ct.Code, ["opportunity"] = opCode });
        await _db.SaveChangesAsync();
        await Fire(tenantId, "lead.converted", new { lead = lead.Code, account = acct.Code, opportunity = opCode });
        return Ok(new { account = acct.Code, contact = ct.Code, opportunity = opCode });
    }

    /// <summary>Closes an opportunity as won / lost. Winning makes sure the account exists as a finance customer so it can be invoiced.</summary>
    [HttpPost("opportunities/{id}/{result}")]
    public async Task<IActionResult> Close(string module, string id, string result, [FromBody] Dictionary<string, string>? body)
    {
        if (module != "crm" || result is not ("won" or "lost" or "reopen")) return NotFound();
        if (!await Has("crm.opps.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var op = await _db.ErpRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Module == "crm" && r.Kind == "opportunity");
        if (op == null) return NotFound();
        var d = FinJson.Obj(op.Data);
        if (result == "reopen") { op.Status = "Open"; op.Data = FinJson.WithValues(op.Data, new() { ["stage"] = "Negotiation", ["probability"] = 60, ["lostReason"] = null }); }
        else if (result == "lost") { op.Status = "Lost"; op.Data = FinJson.WithValues(op.Data, new() { ["stage"] = "Lost", ["probability"] = 0, ["lostReason"] = body != null && body.TryGetValue("reason", out var rs) ? rs : null, ["closedAt"] = DateTime.UtcNow }); }
        else
        {
            op.Status = "Won"; op.Data = FinJson.WithValues(op.Data, new() { ["stage"] = "Won", ["probability"] = 100, ["closedAt"] = DateTime.UtcNow });
            var acctCode = FinJson.S(d, "account");
            var acct = await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "crm" && r.Kind == "account" && r.Code == acctCode);
            if (acct != null && await Has("finance.ar.manage") && !await _db.FinRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "customer" && r.Code == acct.Code))
            {
                var ad = FinJson.Obj(acct.Data);
                _db.FinRecords.Add(new FinRecord { TenantId = tenantId, Kind = "customer", Code = acct.Code, Status = "Active", CreatedBy = Username,
                    Data = J(new() { ["name"] = FinJson.S(ad, "name"), ["email"] = FinJson.S(ad, "email"), ["phone"] = FinJson.S(ad, "phone"), ["termsDays"] = 30, ["fromCrm"] = true }) });
            }
        }
        op.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (result == "won") await Fire(tenantId, "opportunity.won", new { opportunity = op.Code, amount = FinJson.D(FinJson.Obj(op.Data), "amount") });
        return Ok(ErpRecordDto.From(op));
    }

    // ------------------------------------------------------------------ lookups shared with the stores (Point of sale items + stock)

    /// <summary>The items (Point-of-sale products) a bill of materials, work order, quote or plan can use.</summary>
    [HttpGet("items")]
    public async Task<IActionResult> Items(string module, [FromQuery] string? company)
    {
        if (!Modules.Contains(module)) return NotFound();
        if (!await HasAny(module)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var q = _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "product" && r.Status != "Inactive");
        if (!string.IsNullOrWhiteSpace(company) && company != "ALL") q = q.Where(r => r.Company == company || r.Company == null || r.Company == "");
        var list = await q.OrderBy(r => r.Code).Take(5000).ToListAsync();
        return Ok(list.Select(r => { var d = FinJson.Obj(r.Data); return new { sku = r.Code, name = FinJson.S(d, "name"), cost = FinJson.D(d, "cost"), price = FinJson.D(d, "price"), stocked = !d.TryGetProperty("trackStock", out var ts) || ts.ValueKind != JsonValueKind.False }; }));
    }

    /// <summary>On-hand quantity per item (summed over the branches, or for one branch) - what MRP nets the demand against.</summary>
    [HttpGet("stock")]
    public async Task<IActionResult> Stock(string module, [FromQuery] string? company, [FromQuery] string? branch)
    {
        if (module != "mfg" || !(await Has("mfg.view") || await Has("mfg.planning"))) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var q = _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "stock");
        if (!string.IsNullOrWhiteSpace(company) && company != "ALL") q = q.Where(r => r.Company == company || r.Company == null || r.Company == "");
        if (!string.IsNullOrWhiteSpace(branch) && branch != "ALL") q = q.Where(r => r.Branch == branch);
        var rows = (await q.ToListAsync()).Select(r => (sku: FinJson.S(FinJson.Obj(r.Data), "sku"), qty: FinJson.D(FinJson.Obj(r.Data), "qty")));
        return Ok(rows.GroupBy(x => x.sku).Select(g => new { sku = g.Key, qty = R2(g.Sum(x => x.qty)) }));
    }

    // ------------------------------------------------------------------ dashboards
}
