using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class FinRecordDto
{
    public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? Company { get; set; }
    public string? Status { get; set; }
    public JsonElement Data { get; set; }
    public string? CreatedBy { get; set; }
    public string? ApprovedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public static FinRecordDto From(FinRecord r) => new()
    {
        Id = r.Id, Kind = r.Kind, Code = r.Code, Company = r.Company, Status = r.Status, Data = FinJson.Obj(r.Data),
        CreatedBy = r.CreatedBy, ApprovedBy = r.ApprovedBy, CreatedAt = r.CreatedAt, UpdatedAt = r.UpdatedAt
    };
}

public class FinCount { public string Name { get; set; } = string.Empty; public decimal Value { get; set; } }
public class FinPoint { public string Name { get; set; } = string.Empty; public decimal A { get; set; } public decimal B { get; set; } }
public class FinBudgetRow { public string Name { get; set; } = string.Empty; public decimal Budget { get; set; } public decimal Actual { get; set; } }
public class FinDueRow { public string Code { get; set; } = string.Empty; public string Party { get; set; } = string.Empty; public string DueDate { get; set; } = string.Empty; public decimal Amount { get; set; } public bool Overdue { get; set; } }

public class FinSummaryDto
{
    public decimal RevenueYtd { get; set; }
    public decimal ExpenseYtd { get; set; }
    public decimal ProfitYtd { get; set; }
    public List<FinPoint> Monthly { get; set; } = new();      // last 12 months: A = revenue, B = expenses
    public decimal Cash { get; set; }
    public List<FinCount> CashByAccount { get; set; } = new();
    public decimal ArOutstanding { get; set; }
    public decimal ArOverdue { get; set; }
    public List<FinCount> ArAging { get; set; } = new();
    public decimal ApOutstanding { get; set; }
    public decimal ApOverdue { get; set; }
    public List<FinCount> ApAging { get; set; } = new();
    public List<FinDueRow> ApDue { get; set; } = new();
    public decimal BudgetTotal { get; set; }
    public decimal BudgetActual { get; set; }
    public List<FinBudgetRow> BudgetRows { get; set; } = new();
    public List<FinCount> DeptSpend { get; set; } = new();
    public int JournalsToApprove { get; set; }
    public int InvoicesToApprove { get; set; }
    public int AssetCount { get; set; }
    public decimal AssetCost { get; set; }
    public decimal AssetAccumulated { get; set; }
    public int ActiveProjects { get; set; }
    public string? CurrentPeriod { get; set; }
    public string? CurrentPeriodStatus { get; set; }
}

internal static class FinJson
{
    public static JsonElement Obj(string? json)
    {
        try { return JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json).RootElement.Clone(); }
        catch { return JsonDocument.Parse("{}").RootElement.Clone(); }
    }

    public static string S(JsonElement e, string key)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(key, out var v)) return "";
        if (v.ValueKind == JsonValueKind.String) return v.GetString() ?? "";
        if (v.ValueKind == JsonValueKind.Null || v.ValueKind == JsonValueKind.Undefined) return "";
        return v.ToString();
    }

    public static decimal D(JsonElement e, string key)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(key, out var v)) return 0m;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d)) return d;
        if (v.ValueKind == JsonValueKind.String && decimal.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var d2)) return d2;
        return 0m;
    }

    public static bool B(JsonElement e, string key)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(key, out var v)) return false;
        if (v.ValueKind == JsonValueKind.True) return true;
        if (v.ValueKind == JsonValueKind.String) return string.Equals(v.GetString(), "true", StringComparison.OrdinalIgnoreCase);
        return false;
    }

    public static bool TryDate(JsonElement e, string key, out DateTime dt)
    {
        dt = default;
        var s = S(e, key);
        return !string.IsNullOrWhiteSpace(s) && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out dt);
    }

    /// <summary>The conversion rate to the base currency stored on a record (1 when absent).</summary>
    public static decimal Rate(JsonElement e) { var r = D(e, "rate"); return r > 0 ? r : 1m; }

    public static IEnumerable<JsonElement> Lines(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty("lines", out var l) && l.ValueKind == JsonValueKind.Array)
            foreach (var x in l.EnumerateArray()) yield return x;
    }

    public static string WithValues(string json, Dictionary<string, object?> values)
    {
        var dict = new Dictionary<string, JsonElement>();
        var cur = Obj(json);
        if (cur.ValueKind == JsonValueKind.Object) foreach (var p in cur.EnumerateObject()) dict[p.Name] = p.Value.Clone();
        foreach (var kv in values) dict[kv.Key] = JsonSerializer.SerializeToElement(kv.Value);
        return JsonSerializer.Serialize(dict);
    }
}

/// <summary>
/// Finance: chart of accounts, periods and journals (general ledger), supplier invoices with 3-way matching (payables),
/// customer invoices and receipts (receivables), bank accounts and reconciliation, budgets, fixed assets, projects,
/// currencies, tax codes, cost centres, the CFO dashboard figures and the audit trail.
///
/// Every endpoint checks a privilege handed out in the Admin module (finance.gl.*, finance.ap.*, finance.ar.* ...).
/// Controls enforced here and not only in the screens: balanced journals, valid accounts, closed periods,
/// posted journals cannot be edited (they are reversed), duplicate supplier invoices, 3-way match before approval,
/// and - when the workspace turns it on - the person who created a journal / invoice cannot approve it
/// and the person who approved an invoice cannot pay it. Everything is scoped to the caller's workspace.
/// </summary>
[ApiController]
[Route("api/finance")]
[Authorize]
public class FinanceController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;

    public FinanceController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant)
    {
        _db = db; _perms = perms; _tenant = tenant;
    }

    private string Username => User.FindFirstValue(ClaimTypes.Name)!;
    private async Task<bool> Has(string p) => await _perms.Has(User, p);

    private static readonly string[] CodeRequired =
        { "account", "period", "vendor", "customer", "currency", "taxcode", "costcenter", "project", "bankaccount", "assetclass", "asset", "setting" };
    /// <summary>every holder of any finance.* privilege may read these (they fill the drop-downs of the other screens)</summary>
    private static readonly string[] RefKinds =
        { "account", "period", "vendor", "customer", "currency", "taxcode", "costcenter", "project", "setting", "assetclass" };
    private static readonly string[] AllKinds =
    {
        "account", "period", "journal", "vendor", "apinvoice", "customer", "arinvoice", "receipt", "bankaccount", "banktxn",
        "budget", "assetclass", "asset", "project", "currency", "taxcode", "costcenter", "setting"
    };

    private static (string view, string manage)? KindPerms(string kind) => kind switch
    {
        "account" or "period" or "journal" => ("finance.gl.view", "finance.gl.manage"),
        "vendor" or "apinvoice" => ("finance.ap.view", "finance.ap.manage"),
        "customer" or "arinvoice" or "receipt" => ("finance.ar.view", "finance.ar.manage"),
        "bankaccount" or "banktxn" => ("finance.bank.view", "finance.bank.manage"),
        "budget" => ("finance.budget.view", "finance.budget.manage"),
        "assetclass" or "asset" => ("finance.assets.view", "finance.assets.manage"),
        "project" => ("finance.projects.view", "finance.projects.manage"),
        "currency" or "taxcode" or "costcenter" or "setting" => ("finance.view", "finance.setup"),
        _ => null
    };

    private async Task<bool> HasAnyFin()
    {
        var mine = await _perms.EffectiveFor(User);
        return mine.Any(p => p.StartsWith("finance.", StringComparison.OrdinalIgnoreCase));
    }

    private async Task<bool> CanView(string kind)
    {
        var kp = KindPerms(kind);
        if (kp == null) return false;
        if (await Has(kp.Value.view)) return true;
        return RefKinds.Contains(kind) && await HasAnyFin();
    }

    // ------------------------------------------------------------------ records

    [HttpGet("records/{kind}")]
    public async Task<ActionResult<IEnumerable<FinRecordDto>>> List(string kind, [FromQuery] string? company, [FromQuery] string? status)
    {
        if (KindPerms(kind) == null) return NotFound();
        if (!await CanView(kind)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var q = _db.FinRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == kind);
        if (!string.IsNullOrWhiteSpace(company) && company != "ALL")
            q = q.Where(r => r.Company == company || r.Company == null || r.Company == "");
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(r => r.Status == status);
        var list = await q.OrderByDescending(r => r.CreatedAt).Take(5000).ToListAsync();
        return Ok(list.Select(FinRecordDto.From));
    }

    [HttpPost("records/{kind}")]
    public async Task<ActionResult<FinRecordDto>> Create(string kind, [FromBody] FinRecordDto body)
    {
        var kp = KindPerms(kind);
        if (kp == null) return NotFound();
        if (!await Has(kp.Value.manage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);

        var rec = new FinRecord
        {
            TenantId = tenantId, Kind = kind, CreatedBy = Username,
            Code = Clean(body.Code), Company = Clean(body.Company),
            Status = Clean(body.Status) ?? DefaultStatus(kind),
            Data = body.Data.ValueKind == JsonValueKind.Object ? body.Data.GetRawText() : "{}"
        };

        var auto = AutoPrefix(kind);
        if (auto != null && rec.Code == null) rec.Code = await NextCode(tenantId, kind, auto);
        if (CodeRequired.Contains(kind) && rec.Code == null) return BadRequest("Code is required.");
        if (rec.Code != null && await CodeTaken(tenantId, kind, rec.Code, rec.Company, null)) return Conflict("That code already exists.");

        var err = await Gate(tenantId, rec, null, rec.Status!);
        if (err != null) return Fail(err);

        _db.FinRecords.Add(rec);
        _db.FinAudits.Add(Audit(tenantId, rec, "Created", $"{kind} {rec.Code} created as {rec.Status}"));
        await _db.SaveChangesAsync();
        return Ok(FinRecordDto.From(rec));
    }

    [HttpPut("records/{kind}/{id}")]
    public async Task<ActionResult<FinRecordDto>> Update(string kind, string id, [FromBody] FinRecordDto body)
    {
        var kp = KindPerms(kind);
        if (kp == null) return NotFound();
        if (!await Has(kp.Value.manage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.FinRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);
        if (rec == null) return NotFound();

        var oldStatus = rec.Status ?? "";
        var oldData = rec.Data;
        var newStatus = Clean(body.Status) ?? oldStatus;
        var newData = body.Data.ValueKind == JsonValueKind.Object ? body.Data.GetRawText() : rec.Data;

        // posted journals and paid supplier invoices are final: they can only be reversed / left alone
        if (kind == "journal" && oldStatus == "Posted")
        {
            if (newStatus != "Reversed") return BadRequest("A posted journal can't be changed. Reverse it with a new journal instead.");
            newData = rec.Data;
        }
        else if (kind == "apinvoice" && oldStatus == "Paid") return BadRequest("A paid invoice can't be changed.");
        else if (kind == "period" && oldStatus == "Closed" && newStatus == "Closed") newData = rec.Data;

        var code = Clean(body.Code) ?? rec.Code;
        var company = body.Company != null ? Clean(body.Company) : rec.Company;
        if (code != null && (code != rec.Code || company != rec.Company) && await CodeTaken(tenantId, kind, code, company, rec.Id))
            return Conflict("That code already exists.");

        var probe = new FinRecord { TenantId = tenantId, Kind = kind, Code = code, Company = company, Status = newStatus, Data = newData, CreatedBy = rec.CreatedBy, ApprovedBy = rec.ApprovedBy, Id = rec.Id };
        var err = await Gate(tenantId, probe, oldStatus, newStatus);
        if (err != null) return Fail(err);

        var summary = Diff(oldStatus, newStatus, oldData, probe.Data);
        rec.Code = code; rec.Company = company; rec.Status = newStatus; rec.Data = probe.Data; rec.ApprovedBy = probe.ApprovedBy;
        rec.UpdatedAt = DateTime.UtcNow;
        _db.FinAudits.Add(Audit(tenantId, rec, oldStatus != newStatus ? "StatusChanged" : "Updated", summary));
        await _db.SaveChangesAsync();
        return Ok(FinRecordDto.From(rec));
    }

    [HttpDelete("records/{kind}/{id}")]
    public async Task<IActionResult> Delete(string kind, string id)
    {
        var kp = KindPerms(kind);
        if (kp == null) return NotFound();
        if (!await Has(kp.Value.manage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.FinRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);
        if (rec == null) return NotFound();

        var st = rec.Status ?? "";
        if (kind == "journal" && st is not ("Draft" or "Rejected")) return BadRequest("Only draft or rejected journals can be deleted. Reverse a posted journal instead.");
        if (kind == "apinvoice" && st is not ("Draft" or "Rejected" or "Held")) return BadRequest("Only draft, held or rejected invoices can be deleted.");
        if (kind == "arinvoice" && st is not ("Draft" or "Cancelled")) return BadRequest("Only draft or cancelled invoices can be deleted.");
        if (kind == "period" && st == "Closed") return BadRequest("Reopen the period before deleting it.");
        if (kind == "account" && rec.Code != null)
        {
            var needle = "\"" + rec.Code + "\"";
            var used = await _db.FinRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "journal" && r.Data.Contains(needle));
            if (used) return Conflict("This account is used in journals, so it can't be deleted. Mark it inactive instead.");
        }

        _db.FinAudits.Add(Audit(tenantId, rec, "Deleted", $"{kind} {rec.Code} deleted (was {st})"));
        _db.FinRecords.Remove(rec);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ------------------------------------------------------------------ chart of accounts starter set

    [HttpPost("accounts/seed")]
    public async Task<IActionResult> SeedAccounts()
    {
        if (!await Has("finance.gl.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        if (await _db.FinRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "account"))
            return Conflict("The chart of accounts already has accounts.");
        var rows = new (string code, string name, string ar, string type, bool header)[]
        {
            ("1000", "Assets", "الأصول", "Asset", true),
            ("1010", "Cash on hand", "النقدية بالصندوق", "Asset", false),
            ("1020", "Bank", "البنك", "Asset", false),
            ("1100", "Accounts receivable", "العملاء (ذمم مدينة)", "Asset", false),
            ("1150", "VAT input (recoverable)", "ضريبة القيمة المضافة - مدخلات", "Asset", false),
            ("1200", "Inventory", "المخزون", "Asset", false),
            ("1500", "Fixed assets - cost", "الأصول الثابتة - التكلفة", "Asset", false),
            ("1590", "Accumulated depreciation", "مجمع الإهلاك", "Asset", false),
            ("2000", "Liabilities", "الخصوم", "Liability", true),
            ("2100", "Accounts payable", "الموردون (ذمم دائنة)", "Liability", false),
            ("2150", "VAT output (payable)", "ضريبة القيمة المضافة - مخرجات", "Liability", false),
            ("2200", "Accrued expenses", "مصروفات مستحقة", "Liability", false),
            ("2300", "Intercompany payable", "مستحق لشركات المجموعة", "Liability", false),
            ("3000", "Equity", "حقوق الملكية", "Equity", true),
            ("3100", "Share capital", "رأس المال", "Equity", false),
            ("3200", "Retained earnings", "الأرباح المبقاة", "Equity", false),
            ("4000", "Revenue", "الإيرادات", "Revenue", true),
            ("4100", "Sales revenue", "إيرادات المبيعات", "Revenue", false),
            ("4200", "Service revenue", "إيرادات الخدمات", "Revenue", false),
            ("4900", "Intercompany revenue", "إيرادات بين شركات المجموعة", "Revenue", false),
            ("5000", "Cost of sales", "تكلفة المبيعات", "Expense", false),
            ("6000", "Operating expenses", "المصروفات التشغيلية", "Expense", true),
            ("6100", "Salaries & wages", "الرواتب والأجور", "Expense", false),
            ("6200", "Rent", "الإيجار", "Expense", false),
            ("6300", "Utilities", "المرافق", "Expense", false),
            ("6400", "Travel & entertainment", "السفر والضيافة", "Expense", false),
            ("6500", "Office & supplies", "المكتب والمستلزمات", "Expense", false),
            ("6600", "Depreciation expense", "مصروف الإهلاك", "Expense", false),
            ("6700", "Professional fees", "أتعاب مهنية", "Expense", false),
            ("6800", "Bank charges", "عمولات بنكية", "Expense", false),
        };
        foreach (var r in rows)
        {
            var data = new Dictionary<string, object?> { ["name"] = r.name, ["nameAr"] = r.ar, ["type"] = r.type, ["isHeader"] = r.header };
            var rec = new FinRecord { TenantId = tenantId, Kind = "account", Code = r.code, Status = "Active", Data = JsonSerializer.Serialize(data), CreatedBy = Username };
            _db.FinRecords.Add(rec);
        }
        _db.FinAudits.Add(new FinAudit { TenantId = tenantId, Kind = "account", RecordId = "-", Action = "Created", UserName = Username, Summary = $"Starter chart of accounts loaded ({rows.Length} accounts)" });
        await _db.SaveChangesAsync();
        return Ok(new { created = rows.Length });
    }

    // ------------------------------------------------------------------ audit trail

    [HttpGet("audit")]
    public async Task<ActionResult<IEnumerable<FinAudit>>> AuditTrail([FromQuery] string? kind, [FromQuery] string? recordId, [FromQuery] int limit = 200)
    {
        if (!await Has("finance.audit.view")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var q = _db.FinAudits.AsNoTracking().Where(a => a.TenantId == tenantId);
        if (!string.IsNullOrWhiteSpace(kind)) q = q.Where(a => a.Kind == kind);
        if (!string.IsNullOrWhiteSpace(recordId)) q = q.Where(a => a.RecordId == recordId);
        return Ok(await q.OrderByDescending(a => a.At).Take(Math.Clamp(limit, 1, 1000)).ToListAsync());
    }

    // ------------------------------------------------------------------ rules

    private ActionResult<FinRecordDto> Fail(object err)
    {
        if (err is ForbidResult) return Forbid();
        return BadRequest(err);
    }

    private static string? AutoPrefix(string kind) => kind switch { "journal" => "JV", "arinvoice" => "INV", "receipt" => "RC", "apinvoice" => "AP", _ => null };

    private static string DefaultStatus(string kind) => kind switch
    {
        "journal" or "apinvoice" or "arinvoice" => "Draft",
        "period" => "Open",
        "asset" => "Active",
        "account" or "vendor" or "customer" or "bankaccount" or "project" or "costcenter" or "currency" or "taxcode" => "Active",
        _ => "Active"
    };

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private async Task<bool> CodeTaken(string tenantId, string kind, string code, string? company, string? exceptId)
    {
        // journals / invoices are numbered per workspace; periods per company; the rest per workspace + company scope
        return await _db.FinRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == kind && r.Code == code && r.Id != exceptId
            && (kind != "period" || r.Company == company));
    }

    private async Task<string> NextCode(string tenantId, string kind, string prefix)
    {
        var year = DateTime.UtcNow.Year;
        var n = await _db.FinRecords.CountAsync(r => r.TenantId == tenantId && r.Kind == kind) + 1;
        string code;
        do { code = $"{prefix}-{year}-{n:0000}"; n++; }
        while (await _db.FinRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == kind && r.Code == code));
        return code;
    }

    private FinAudit Audit(string tenantId, FinRecord rec, string action, string? summary) => new()
    {
        TenantId = tenantId, Kind = rec.Kind, RecordId = rec.Id, Code = rec.Code, Action = action, UserName = Username, Summary = summary
    };

    private static string Diff(string oldStatus, string newStatus, string oldData, string newData)
    {
        var parts = new List<string>();
        if (oldStatus != newStatus) parts.Add($"status: {oldStatus} -> {newStatus}");
        var a = FinJson.Obj(oldData); var b = FinJson.Obj(newData);
        if (a.ValueKind == JsonValueKind.Object && b.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>();
            foreach (var p in a.EnumerateObject()) keys.Add(p.Name);
            foreach (var p in b.EnumerateObject()) keys.Add(p.Name);
            foreach (var k in keys)
            {
                var x = a.TryGetProperty(k, out var xv) ? xv.GetRawText() : "";
                var y = b.TryGetProperty(k, out var yv) ? yv.GetRawText() : "";
                if (x == y) continue;
                if (k == "lines") { parts.Add("lines changed"); continue; }
                parts.Add($"{k}: {Short(x)} -> {Short(y)}");
                if (parts.Count >= 8) break;
            }
        }
        return parts.Count == 0 ? "saved without changes" : string.Join("; ", parts);
    }
    private static string Short(string s) { s = s.Trim('"'); return s.Length > 40 ? s.Substring(0, 37) + "..." : s; }

    private async Task<(bool enforceSod, decimal tolerance)> Controls(string tenantId)
    {
        var rec = await _db.FinRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "setting" && r.Code == "controls");
        if (rec == null) return (false, 2m);
        var d = FinJson.Obj(rec.Data);
        var tol = d.ValueKind == JsonValueKind.Object && d.TryGetProperty("matchTolerancePct", out _) ? FinJson.D(d, "matchTolerancePct") : 2m;
        return (FinJson.B(d, "enforceSod"), tol);
    }

    /// <summary>Business rules for a create / update. Returns null when fine, a Forbid result or an error text otherwise.</summary>
    private async Task<object?> Gate(string tenantId, FinRecord rec, string? oldStatus, string newStatus)
    {
        var kind = rec.Kind;
        var statusChanged = oldStatus != newStatus;
        var data = FinJson.Obj(rec.Data);

        if (kind == "period")
        {
            var closing = newStatus == "Closed" && oldStatus != "Closed";
            var reopening = oldStatus == "Closed" && newStatus != "Closed";
            if ((closing || reopening) && !await Has("finance.gl.approve")) return new ForbidResult();
        }

        if (kind == "journal")
        {
            var final = newStatus is "Submitted" or "Posted" or "Reversed";
            if (final)
            {
                var err = await ValidateJournal(tenantId, data);
                if (err != null) return err;
            }
            if (statusChanged && newStatus is "Posted" or "Rejected" or "Reversed")
            {
                if (!await Has("finance.gl.approve")) return new ForbidResult();
            }
            if (statusChanged && newStatus == "Posted")
            {
                var (sod, _) = await Controls(tenantId);
                if (sod && string.Equals(rec.CreatedBy, Username, StringComparison.OrdinalIgnoreCase))
                    return "Segregation of duties: the person who created a journal can't post it. Ask another approver.";
                if (FinJson.TryDate(data, "date", out var dt))
                {
                    var period = dt.ToString("yyyy-MM", CultureInfo.InvariantCulture);
                    var closed = await _db.FinRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "period" && r.Code == period
                        && r.Status == "Closed" && (r.Company == rec.Company || r.Company == null || r.Company == ""));
                    if (closed) return $"The period {period} is closed. Reopen it or use a date in an open period.";
                }
                rec.ApprovedBy = Username;
            }
        }

        if (kind == "apinvoice")
        {
            var vendor = FinJson.S(data, "vendor");
            var no = FinJson.S(data, "invoiceNo");
            if (oldStatus == null || statusChanged == false)
            {
                if (vendor != "" && no != "")
                {
                    var rows = await _db.FinRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "apinvoice" && r.Id != rec.Id
                        && (r.Company == rec.Company)).Select(r => r.Data).ToListAsync();
                    foreach (var js in rows)
                    {
                        var o = FinJson.Obj(js);
                        if (string.Equals(FinJson.S(o, "vendor"), vendor, StringComparison.OrdinalIgnoreCase)
                            && string.Equals(FinJson.S(o, "invoiceNo"), no, StringComparison.OrdinalIgnoreCase))
                            return $"Duplicate invoice: supplier {vendor} already has invoice {no}.";
                    }
                }
            }
            // work out the match status and store it on the record
            var (_, tol) = await Controls(tenantId);
            var poNo = FinJson.S(data, "poNo");
            var total = FinJson.D(data, "total") > 0 ? FinJson.D(data, "total") : FinJson.D(data, "amount");
            string match;
            string? matchReason = null;
            if (poNo == "") match = "NoPO";
            else
            {
                var limit = Math.Min(FinJson.D(data, "poAmount"), FinJson.D(data, "receivedAmount"));
                if (limit <= 0) { match = "Mismatch"; matchReason = $"nothing received against {poNo}"; }
                else if (total <= limit * (1 + tol / 100m)) match = "Matched";
                else { match = "Mismatch"; matchReason = $"invoice {total:N2} is more than the received / ordered value {limit:N2} ({poNo})"; }
            }
            rec.Data = FinJson.WithValues(rec.Data, new Dictionary<string, object?> { ["matchStatus"] = match });

            if (statusChanged && newStatus is "Approved" or "Rejected" or "Paid")
            {
                if (!await Has("finance.ap.approve")) return new ForbidResult();
            }
            if (statusChanged && newStatus == "Approved")
            {
                if (match == "Mismatch" && !FinJson.B(data, "matchOverride")) return "3-way match failed: " + matchReason + ". Fix the invoice, or tick \"override the match\".";
                var (sod, _) = await Controls(tenantId);
                if (sod && string.Equals(rec.CreatedBy, Username, StringComparison.OrdinalIgnoreCase))
                    return "Segregation of duties: the person who entered an invoice can't approve it.";
                rec.ApprovedBy = Username;
            }
            if (statusChanged && newStatus == "Paid")
            {
                if (oldStatus != "Approved") return "Only an approved invoice can be paid.";
                var (sod, _) = await Controls(tenantId);
                if (sod && string.Equals(rec.ApprovedBy, Username, StringComparison.OrdinalIgnoreCase))
                    return "Segregation of duties: the person who approved an invoice can't also pay it.";
            }
        }

        return null;
    }

    private async Task<string?> ValidateJournal(string tenantId, JsonElement data)
    {
        if (!FinJson.TryDate(data, "date", out _)) return "The journal needs a valid date.";
        var lines = FinJson.Lines(data).ToList();
        if (lines.Count < 2) return "A journal needs at least two lines.";

        var accounts = await _db.FinRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "account")
            .Select(r => new { r.Code, r.Status, r.Data }).ToListAsync();
        var map = accounts.Where(a => a.Code != null).GroupBy(a => a.Code!).ToDictionary(g => g.Key, g => g.First());

        decimal dr = 0, cr = 0;
        var i = 0;
        foreach (var l in lines)
        {
            i++;
            var acc = FinJson.S(l, "account");
            if (acc == "") return $"Line {i}: choose an account.";
            if (!map.TryGetValue(acc, out var a)) return $"Line {i}: account {acc} doesn't exist.";
            if (a.Status == "Inactive") return $"Line {i}: account {acc} is inactive.";
            if (FinJson.B(FinJson.Obj(a.Data), "isHeader")) return $"Line {i}: account {acc} is a header and can't be posted to.";
            var d = FinJson.D(l, "debit"); var c = FinJson.D(l, "credit");
            if (d < 0 || c < 0) return $"Line {i}: amounts can't be negative.";
            if (d > 0 && c > 0) return $"Line {i}: use either debit or credit, not both.";
            dr += d; cr += c;
        }
        if (dr <= 0) return "The journal has no amounts.";
        if (Math.Abs(dr - cr) > 0.005m) return $"The journal isn't balanced: debits {dr:N2}, credits {cr:N2}.";
        return null;
    }

    // ------------------------------------------------------------------ CFO dashboard

    [HttpGet("summary")]
    public async Task<ActionResult<FinSummaryDto>> Summary([FromQuery] string? company)
    {
        if (!await Has("finance.reports.view")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var all = await _db.FinRecords.AsNoTracking().Where(r => r.TenantId == tenantId).ToListAsync();
        bool Mine(FinRecord r) => string.IsNullOrWhiteSpace(company) || company == "ALL" || r.Company == company || string.IsNullOrEmpty(r.Company);
        var recs = all.Where(Mine).ToList();
        var s = new FinSummaryDto();
        var today = DateTime.UtcNow.Date;
        var year = today.Year;

        // account types
        var type = new Dictionary<string, string>();
        foreach (var a in all.Where(r => r.Kind == "account" && r.Code != null)) type[a.Code!] = FinJson.S(FinJson.Obj(a.Data), "type");

        // revenue / expenses from posted journals
        var months = new Dictionary<string, FinPoint>();
        for (var i = 11; i >= 0; i--) { var m = new DateTime(today.Year, today.Month, 1).AddMonths(-i).ToString("yyyy-MM", CultureInfo.InvariantCulture); months[m] = new FinPoint { Name = m }; }
        var spend = new Dictionary<string, decimal>();
        var actualByCcAcc = new List<(string cc, string acc, decimal amt, int yr)>();
        foreach (var j in recs.Where(r => r.Kind == "journal" && r.Status == "Posted"))
        {
            var d = FinJson.Obj(j.Data);
            if (!FinJson.TryDate(d, "date", out var dt)) continue;
            var rate = FinJson.Rate(d);
            var key = dt.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            foreach (var l in FinJson.Lines(d))
            {
                var acc = FinJson.S(l, "account");
                type.TryGetValue(acc, out var t);
                var dr = FinJson.D(l, "debit") * rate; var cr = FinJson.D(l, "credit") * rate;
                if (t == "Revenue")
                {
                    if (dt.Year == year) s.RevenueYtd += cr - dr;
                    if (months.TryGetValue(key, out var p)) p.A += cr - dr;
                }
                else if (t == "Expense")
                {
                    if (dt.Year == year) s.ExpenseYtd += dr - cr;
                    if (months.TryGetValue(key, out var p)) p.B += dr - cr;
                    var cc = FinJson.S(l, "costCenter");
                    if (dt.Year == year) { spend[cc == "" ? "-" : cc] = (spend.TryGetValue(cc == "" ? "-" : cc, out var cur) ? cur : 0m) + dr - cr; }
                    actualByCcAcc.Add((cc, acc, dr - cr, dt.Year));
                }
            }
        }
        s.ProfitYtd = s.RevenueYtd - s.ExpenseYtd;
        s.Monthly = months.Values.ToList();
        s.DeptSpend = spend.OrderByDescending(x => x.Value).Take(8).Select(x => new FinCount { Name = x.Key, Value = x.Value }).ToList();

        // cash
        var txns = recs.Where(r => r.Kind == "banktxn").Select(r => FinJson.Obj(r.Data)).ToList();
        foreach (var b in recs.Where(r => r.Kind == "bankaccount" && r.Status != "Inactive"))
        {
            var d = FinJson.Obj(b.Data);
            var bal = FinJson.D(d, "openingBalance") + txns.Where(t => FinJson.S(t, "account") == b.Code).Sum(t => FinJson.D(t, "amount"));
            var baseBal = bal * FinJson.Rate(d);
            s.Cash += baseBal;
            s.CashByAccount.Add(new FinCount { Name = FinJson.S(d, "name") != "" ? FinJson.S(d, "name") : (b.Code ?? ""), Value = baseBal });
        }

        // receivables / payables
        s.ArAging = Aging(recs, "arinvoice", new[] { "Issued" }, today, out var arTotal, out var arOver, null);
        s.ArOutstanding = arTotal; s.ArOverdue = arOver;
        var due = new List<FinDueRow>();
        s.ApAging = Aging(recs, "apinvoice", new[] { "Submitted", "Approved", "Held" }, today, out var apTotal, out var apOver, due);
        s.ApOutstanding = apTotal; s.ApOverdue = apOver;
        s.ApDue = due.OrderBy(x => x.DueDate).Take(8).ToList();
        s.InvoicesToApprove = recs.Count(r => r.Kind == "apinvoice" && r.Status == "Submitted");
        s.JournalsToApprove = recs.Count(r => r.Kind == "journal" && r.Status == "Submitted");

        // budgets (current year) vs posted actuals
        foreach (var b in recs.Where(r => r.Kind == "budget"))
        {
            var d = FinJson.Obj(b.Data);
            if ((int)FinJson.D(d, "year") != year) continue;
            var cc = FinJson.S(d, "costCenter"); var acc = FinJson.S(d, "account");
            var amount = FinJson.D(d, "amount");
            var actual = actualByCcAcc.Where(x => x.yr == year && (cc == "" || x.cc == cc) && (acc == "" || x.acc == acc)).Sum(x => x.amt);
            s.BudgetTotal += amount; s.BudgetActual += actual;
            s.BudgetRows.Add(new FinBudgetRow { Name = (cc != "" ? cc : "-") + (acc != "" ? " / " + acc : ""), Budget = amount, Actual = actual });
        }
        s.BudgetRows = s.BudgetRows.OrderByDescending(x => x.Budget).Take(8).ToList();

        // assets, projects, period
        foreach (var a in recs.Where(r => r.Kind == "asset" && r.Status != "Disposed"))
        {
            var d = FinJson.Obj(a.Data);
            s.AssetCount++; s.AssetCost += FinJson.D(d, "cost"); s.AssetAccumulated += FinJson.D(d, "accumulated");
        }
        s.ActiveProjects = recs.Count(r => r.Kind == "project" && r.Status == "Active");
        var cur2 = today.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        var per = recs.FirstOrDefault(r => r.Kind == "period" && r.Code == cur2);
        s.CurrentPeriod = cur2; s.CurrentPeriodStatus = per?.Status ?? "Open";
        return Ok(s);
    }

    private static List<FinCount> Aging(List<FinRecord> recs, string kind, string[] openStatuses, DateTime today, out decimal total, out decimal overdue, List<FinDueRow>? dueList)
    {
        var buckets = new decimal[5];
        total = 0; overdue = 0;
        foreach (var r in recs.Where(x => x.Kind == kind && openStatuses.Contains(x.Status ?? "")))
        {
            var d = FinJson.Obj(r.Data);
            var amt = (FinJson.D(d, "total") > 0 ? FinJson.D(d, "total") : FinJson.D(d, "amount")) - FinJson.D(d, "paid");
            amt *= FinJson.Rate(d);
            if (amt <= 0) continue;
            DateTime due;
            if (!FinJson.TryDate(d, "dueDate", out due) && !FinJson.TryDate(d, "date", out due)) due = today;
            var late = (today - due.Date).Days;
            var idx = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
            buckets[idx] += amt; total += amt; if (late > 0) overdue += amt;
            dueList?.Add(new FinDueRow { Code = r.Code ?? "", Party = FinJson.S(d, "vendor") != "" ? FinJson.S(d, "vendor") : FinJson.S(d, "customer"), DueDate = due.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), Amount = amt, Overdue = late > 0 });
        }
        var names = new[] { "current", "1-30", "31-60", "61-90", "90+" };
        return names.Select((n, i) => new FinCount { Name = n, Value = buckets[i] }).ToList();
    }
}
