using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class PosRecordDto
{
    public string Id { get; set; } = string.Empty;
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

    public static PosRecordDto From(PosRecord r) => new()
    {
        Id = r.Id, Kind = r.Kind, Code = r.Code, Company = r.Company, Branch = r.Branch, Status = r.Status, Ref = r.Ref, Parent = r.Parent,
        Data = FinJson.Obj(r.Data), CreatedBy = r.CreatedBy, CreatedAt = r.CreatedAt, UpdatedAt = r.UpdatedAt
    };
}

public class PosLineDto { public string Sku { get; set; } = string.Empty; public decimal Qty { get; set; } = 1; public decimal DiscountPct { get; set; } }
public class PosPayDto { public string Method { get; set; } = "cash"; public decimal Amount { get; set; } public string? Ref { get; set; } }
public class PosCheckoutDto
{
    public string? Company { get; set; }
    public string? Branch { get; set; }
    public string? Register { get; set; }
    public string? Customer { get; set; }
    public List<PosLineDto> Lines { get; set; } = new();
    public List<PosPayDto> Payments { get; set; } = new();
    public decimal DiscountPct { get; set; }
    public decimal RedeemPoints { get; set; }
    public string? Note { get; set; }
    public string? LocalId { get; set; }
}
public class PosReturnDto { public List<PosLineDto> Lines { get; set; } = new(); public string? Method { get; set; } public string? Reason { get; set; } }
public class PosOpenShiftDto { public string? Company { get; set; } public string? Branch { get; set; } public string? Register { get; set; } public decimal OpeningCash { get; set; } }
public class PosCashDto { public string Type { get; set; } = "in"; public decimal Amount { get; set; } public string? Reason { get; set; } }
public class PosCloseDto { public decimal CountedCash { get; set; } public string? Note { get; set; } }
public class PosAdjustDto { public string? Company { get; set; } public string? Branch { get; set; } public string Sku { get; set; } = string.Empty; public decimal? Delta { get; set; } public decimal? Counted { get; set; } public string? Reason { get; set; } }
public class PosTransferDto { public string? Company { get; set; } public string FromBranch { get; set; } = string.Empty; public string ToBranch { get; set; } = string.Empty; public List<PosLineDto> Lines { get; set; } = new(); public string? Note { get; set; } }

/// <summary>
/// Point of sale. Works for a company with branches (every sale, till, shift and stock level belongs to a branch) and for a
/// company without any (the branch stays empty and there is one stock location).
///
/// Prices, promotions, tax, loyalty and stock are all worked out HERE from the catalogue - the till only sends what was scanned
/// and what was tendered - so a modified client cannot change a price. Refunds, voids and manual discounts need their own
/// privileges, a till must have an open shift, and closing the shift counts the cash, records the variance and (when the
/// finance defaults are set) drafts the journal for finance to review and post.
/// </summary>
[ApiController]
[Route("api/pos")]
[Authorize]
public class PosController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;

    public PosController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant) { _db = db; _perms = perms; _tenant = tenant; }

    private string Username => User.FindFirstValue(ClaimTypes.Name)!;
    private Task<bool> Has(string p) => _perms.Has(User, p);
    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static decimal R2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
    private static string Json(Dictionary<string, object?> d) => JsonSerializer.Serialize(d);
    private BadRequestObjectResult Bad(string m) => BadRequest(new { message = m });

    private static readonly string[] Configurable = { "product", "category", "customer", "promotion", "register", "setting" };
    private static readonly string[] ReadOnly = { "shift", "sale", "cashmove", "stock", "stockmove", "transfer" };

    private static (string view, string manage)? KindPerms(string kind) => kind switch
    {
        "product" or "category" => ("pos.view", "pos.products.manage"),
        "customer" => ("pos.view", "pos.customers.manage"),
        "promotion" => ("pos.view", "pos.promotions.manage"),
        "register" or "setting" => ("pos.view", "pos.setup"),
        "stock" or "stockmove" or "transfer" => ("pos.stock.view", "pos.stock.manage"),
        "sale" or "cashmove" or "shift" => ("pos.view", "pos.shifts.manage"),
        _ => null
    };

    private async Task<bool> HasAnyPos() => (await _perms.EffectiveFor(User)).Any(p => p.StartsWith("pos.", StringComparison.OrdinalIgnoreCase));

    // ------------------------------------------------------------------ generic records

    [HttpGet("records/{kind}")]
    public async Task<IActionResult> List(string kind, [FromQuery] string? company, [FromQuery] string? branch, [FromQuery] string? status,
        [FromQuery(Name = "from")] string? dateFrom, [FromQuery(Name = "to")] string? dateTo, [FromQuery] int take = 2000)
    {
        var kp = KindPerms(kind);
        if (kp == null) return NotFound();
        // catalogue kinds fill the till's drop-downs: any POS holder may read them
        var ok = await Has(kp.Value.view) || ((kind is "product" or "category" or "customer" or "promotion" or "register" or "setting") && await HasAnyPos());
        if (!ok) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var q = _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == kind);
        if (!string.IsNullOrWhiteSpace(company) && company != "ALL") q = q.Where(r => r.Company == company || r.Company == null || r.Company == "");
        if (!string.IsNullOrWhiteSpace(branch) && branch != "ALL") q = q.Where(r => r.Branch == branch || r.Branch == null || r.Branch == "");
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(r => r.Status == status);
        if (DateTime.TryParse(dateFrom, out var f)) q = q.Where(r => r.CreatedAt >= f.Date);
        if (DateTime.TryParse(dateTo, out var t)) q = q.Where(r => r.CreatedAt < t.Date.AddDays(1));
        // a cashier sees their own sales / shifts; supervisors and report readers see all
        if ((kind is "sale" or "shift" or "cashmove") && !(await Has("pos.shifts.manage") || await Has("pos.reports.view")))
            q = q.Where(r => r.CreatedBy == Username);
        var list = await q.OrderByDescending(r => r.CreatedAt).Take(Math.Clamp(take, 1, 5000)).ToListAsync();
        return Ok(list.Select(PosRecordDto.From));
    }

    [HttpPost("records/{kind}")]
    public async Task<IActionResult> Create(string kind, [FromBody] PosRecordDto body)
    {
        if (!Configurable.Contains(kind)) return NotFound();
        if (!await Has(KindPerms(kind)!.Value.manage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = Build(tenantId, kind, body);
        if (kind == "customer" && rec.Code == null) rec.Code = await NextCode(tenantId, "customer", "C");
        if (kind == "promotion" && rec.Code == null) rec.Code = await NextCode(tenantId, "promotion", "PR");
        if (rec.Code == null) return Bad("Code is required.");
        if (await _db.PosRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == kind && r.Code == rec.Code && (kind != "register" || r.Branch == rec.Branch)))
            return Conflict(new { message = "That code already exists." });
        _db.PosRecords.Add(rec);
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(rec));
    }

    /// <summary>Import: creates or updates by code (used for the Excel / CSV product and customer import).</summary>
    [HttpPost("records/{kind}/bulk")]
    public async Task<IActionResult> Bulk(string kind, [FromBody] List<PosRecordDto> rows)
    {
        if (kind is not ("product" or "customer" or "category")) return NotFound();
        if (!await Has(KindPerms(kind)!.Value.manage)) return Forbid();
        if (rows.Count > 5000) return Bad("At most 5000 rows per import.");
        var tenantId = await _tenant.TenantIdOf(User);
        var existing = await _db.PosRecords.Where(r => r.TenantId == tenantId && r.Kind == kind).ToListAsync();
        int created = 0, updated = 0, skipped = 0;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            var code = Clean(row.Code);
            if (code == null || !seen.Add(code)) { skipped++; continue; }
            var cur = existing.FirstOrDefault(r => string.Equals(r.Code, code, StringComparison.OrdinalIgnoreCase));
            if (cur != null)
            {
                cur.Data = row.Data.ValueKind == JsonValueKind.Object ? row.Data.GetRawText() : cur.Data;
                cur.Status = Clean(row.Status) ?? cur.Status; cur.UpdatedAt = DateTime.UtcNow; updated++;
            }
            else { _db.PosRecords.Add(Build(tenantId, kind, row)); created++; }
        }
        await _db.SaveChangesAsync();
        return Ok(new { created, updated, skipped });
    }

    [HttpPut("records/{kind}/{id}")]
    public async Task<IActionResult> Update(string kind, string id, [FromBody] PosRecordDto body)
    {
        if (!Configurable.Contains(kind)) return NotFound();
        if (!await Has(KindPerms(kind)!.Value.manage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.PosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);
        if (rec == null) return NotFound();
        rec.Company = Clean(body.Company); rec.Branch = Clean(body.Branch);
        rec.Status = Clean(body.Status) ?? rec.Status;
        if (body.Data.ValueKind == JsonValueKind.Object) rec.Data = body.Data.GetRawText();
        rec.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(rec));
    }

    [HttpDelete("records/{kind}/{id}")]
    public async Task<IActionResult> Delete(string kind, string id)
    {
        if (!Configurable.Contains(kind)) return NotFound();
        if (!await Has(KindPerms(kind)!.Value.manage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.PosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);
        if (rec == null) return NotFound();
        _db.PosRecords.Remove(rec);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private PosRecord Build(string tenantId, string kind, PosRecordDto b) => new()
    {
        TenantId = tenantId, Kind = kind, CreatedBy = Username, Code = Clean(b.Code), Company = Clean(b.Company), Branch = Clean(b.Branch),
        Status = Clean(b.Status) ?? "Active", Data = b.Data.ValueKind == JsonValueKind.Object ? b.Data.GetRawText() : "{}"
    };

    private async Task<string> NextCode(string tenantId, string kind, string prefix)
    {
        var year = DateTime.UtcNow.Year;
        var n = await _db.PosRecords.CountAsync(r => r.TenantId == tenantId && r.Kind == kind) + 1;
        string code;
        do { code = $"{prefix}-{year}-{n:000000}"; n++; }
        while (await _db.PosRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == kind && r.Code == code)
               || _db.PosRecords.Local.Any(r => r.TenantId == tenantId && r.Kind == kind && r.Code == code));
        return code;
    }

    // ------------------------------------------------------------------ settings / stock helpers

    private class Cfg { public decimal TaxRate = 15; public bool PricesIncludeTax = true; public decimal PointsPerCurrency = 1; public decimal PointValue = 0.05m; public bool RequireShift = true; public bool AllowNegativeStock; public decimal MaxDiscountPct = 20; }

    private async Task<Cfg> LoadCfg(string tenantId)
    {
        var s = await _db.PosRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "setting" && r.Code == "pos");
        var d = FinJson.Obj(s?.Data);
        var c = new Cfg();
        void N(string k, Action<decimal> set) { if (d.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null) set(FinJson.D(d, k)); }
        void Bo(string k, Action<bool> set) { if (d.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null) set(FinJson.B(d, k)); }
        N("taxRate", v => c.TaxRate = v); N("pointsPerCurrency", v => c.PointsPerCurrency = v); N("pointValue", v => c.PointValue = v); N("maxDiscountPct", v => c.MaxDiscountPct = v);
        Bo("pricesIncludeTax", v => c.PricesIncludeTax = v); Bo("requireShift", v => c.RequireShift = v); Bo("allowNegativeStock", v => c.AllowNegativeStock = v);
        return c;
    }

    private static IEnumerable<JsonElement> Arr(JsonElement e, string key)
    {
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Array) foreach (var x in v.EnumerateArray()) yield return x;
    }

    private static string StockCode(string? branch, string sku) => $"{branch ?? ""}|{sku}";

    private async Task<PosRecord> StockRec(string tenantId, string? company, string? branch, string sku)
    {
        var code = StockCode(branch, sku);
        var loc = _db.PosRecords.Local.FirstOrDefault(r => r.TenantId == tenantId && r.Kind == "stock" && r.Code == code);
        if (loc != null) return loc;
        var rec = await _db.PosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "stock" && r.Code == code);
        if (rec == null)
        {
            rec = new PosRecord { TenantId = tenantId, Kind = "stock", Code = code, Company = company, Branch = branch, Status = "Active", CreatedBy = Username, Data = Json(new() { ["sku"] = sku, ["qty"] = 0m }) };
            _db.PosRecords.Add(rec);
        }
        return rec;
    }
    private async Task<decimal> StockQty(string tenantId, string? branch, string sku)
    {
        var code = StockCode(branch, sku);
        var r = await _db.PosRecords.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Kind == "stock" && x.Code == code);
        return r == null ? 0m : Qty(r);
    }
    private static decimal Qty(PosRecord r) => FinJson.D(FinJson.Obj(r.Data), "qty");
    private static void SetQty(PosRecord r, decimal q) { r.Data = FinJson.WithValues(r.Data, new() { ["qty"] = q }); r.UpdatedAt = DateTime.UtcNow; }

    private async Task Move(string tenantId, string? company, string? branch, string sku, decimal delta, string type, string? doc, string? reason)
    {
        var st = await StockRec(tenantId, company, branch, sku);
        SetQty(st, Qty(st) + delta);
        _db.PosRecords.Add(new PosRecord
        {
            TenantId = tenantId, Kind = "stockmove", Company = company, Branch = branch, Status = type, Parent = doc, CreatedBy = Username,
            Code = sku, Data = Json(new() { ["sku"] = sku, ["delta"] = delta, ["type"] = type, ["reason"] = reason, ["balance"] = Qty(st) })
        });
    }

    private static void Bump(PosRecord shift, params (string key, decimal by)[] deltas)
    {
        var vals = new Dictionary<string, object?>();
        var d = FinJson.Obj(shift.Data);
        foreach (var (key, by) in deltas) vals[key] = R2(FinJson.D(d, key) + by);
        shift.Data = FinJson.WithValues(shift.Data, vals); shift.UpdatedAt = DateTime.UtcNow;
    }

    // ------------------------------------------------------------------ shifts

    [HttpGet("shifts/current")]
    public async Task<IActionResult> CurrentShift([FromQuery] string? register)
    {
        if (!await HasAnyPos()) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var sh = await OpenShift(tenantId, register);
        return sh == null ? Ok(null) : Ok(PosRecordDto.From(sh));
    }

    private Task<PosRecord?> OpenShift(string tenantId, string? register)
        => _db.PosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "shift" && r.Status == "Open" && r.CreatedBy == Username
            && (register == null || register == "" || r.Ref == register));

    [HttpPost("shifts/open")]
    public async Task<IActionResult> Open([FromBody] PosOpenShiftDto b)
    {
        if (!await Has("pos.sell")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        if (b.OpeningCash < 0) return Bad("Opening cash can't be negative.");
        if (await OpenShift(tenantId, null) != null) return Conflict(new { message = "You already have an open shift. Close it first." });
        var reg = Clean(b.Register);
        if (reg != null && await _db.PosRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "shift" && r.Status == "Open" && r.Ref == reg && (r.Branch ?? "") == (Clean(b.Branch) ?? "")))
            return Conflict(new { message = "That register already has an open shift." });
        var sh = new PosRecord
        {
            TenantId = tenantId, Kind = "shift", Company = Clean(b.Company), Branch = Clean(b.Branch), Ref = reg, Status = "Open", CreatedBy = Username,
            Code = await NextCode(tenantId, "shift", "SH"),
            Data = Json(new() { ["opening"] = R2(b.OpeningCash), ["cashier"] = Username, ["openedAt"] = DateTime.UtcNow, ["register"] = reg })
        };
        _db.PosRecords.Add(sh);
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(sh));
    }

    [HttpPost("shifts/{id}/cash")]
    public async Task<IActionResult> Cash(string id, [FromBody] PosCashDto b)
    {
        if (!await Has("pos.sell")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var sh = await _db.PosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "shift");
        if (sh == null) return NotFound();
        if (sh.Status != "Open") return Bad("The shift is closed.");
        if (sh.CreatedBy != Username && !await Has("pos.shifts.manage")) return Forbid();
        var type = b.Type == "out" ? "out" : "in";
        if (b.Amount <= 0) return Bad("Enter an amount.");
        _db.PosRecords.Add(new PosRecord
        {
            TenantId = tenantId, Kind = "cashmove", Company = sh.Company, Branch = sh.Branch, Ref = sh.Code, Status = type, CreatedBy = Username,
            Code = await NextCode(tenantId, "cashmove", "CM"), Data = Json(new() { ["type"] = type, ["amount"] = R2(b.Amount), ["reason"] = b.Reason })
        });
        Bump(sh, (type == "in" ? "cashIn" : "cashOut", R2(b.Amount)));
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(sh));
    }

    [HttpPost("shifts/{id}/close")]
    public async Task<IActionResult> Close(string id, [FromBody] PosCloseDto b)
    {
        if (!await Has("pos.sell")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var sh = await _db.PosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "shift");
        if (sh == null) return NotFound();
        if (sh.Status != "Open") return Bad("The shift is already closed.");
        if (sh.CreatedBy != Username && !await Has("pos.shifts.manage")) return Forbid();
        if (b.CountedCash < 0) return Bad("Counted cash can't be negative.");
        var d = FinJson.Obj(sh.Data);
        var expected = R2(FinJson.D(d, "opening") + FinJson.D(d, "cashSales") - FinJson.D(d, "refundCash") + FinJson.D(d, "cashIn") - FinJson.D(d, "cashOut"));
        var counted = R2(b.CountedCash);
        var values = new Dictionary<string, object?>
        {
            ["expected"] = expected, ["counted"] = counted, ["variance"] = R2(counted - expected), ["closedAt"] = DateTime.UtcNow, ["closeNote"] = b.Note, ["closedBy"] = Username
        };
        var journal = await DraftJournal(tenantId, sh, d);
        if (journal != null) values["journal"] = journal;
        sh.Data = FinJson.WithValues(sh.Data, values);
        sh.Status = "Closed"; sh.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(sh));
    }

    /// <summary>Drafts the shift's sales as a finance journal (never posts it - finance reviews and posts). Needs the finance defaults.</summary>
    private async Task<string?> DraftJournal(string tenantId, PosRecord sh, JsonElement d)
    {
        var def = await _db.FinRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "setting" && r.Code == "defaults" && (r.Company == sh.Company || r.Company == null || r.Company == ""));
        if (def == null) return null;
        var dd = FinJson.Obj(def.Data);
        string bank = FinJson.S(dd, "bankAccount"), rev = FinJson.S(dd, "revenueAccount"), vat = FinJson.S(dd, "vatOutput");
        if (bank == "" || rev == "" || vat == "") return null;
        var gross = FinJson.D(d, "salesTotal") - FinJson.D(d, "returnsTotal");
        var tax = FinJson.D(d, "salesTax") - FinJson.D(d, "returnsTax");
        var loyalty = FinJson.D(d, "loyaltyValue");
        var received = R2(gross - loyalty);
        if (gross == 0) return null;
        var lines = new List<object>
        {
            new { account = bank, debit = received, credit = 0m, memo = "POS takings " + sh.Code },
            new { account = rev, debit = 0m, credit = R2(gross - tax), memo = "POS sales " + sh.Code },
            new { account = vat, debit = 0m, credit = R2(tax), memo = "Output VAT " + sh.Code }
        };
        if (loyalty != 0) lines.Add(new { account = rev, debit = R2(loyalty), credit = 0m, memo = "Loyalty redeemed " + sh.Code });
        var code = "POS-" + sh.Code;
        if (await _db.FinRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "journal" && r.Code == code)) return code;
        var j = new FinRecord
        {
            TenantId = tenantId, Kind = "journal", Code = code, Company = sh.Company, Status = "Draft", CreatedBy = Username,
            Data = JsonSerializer.Serialize(new { date = DateTime.UtcNow.ToString("yyyy-MM-dd"), memo = "Point of sale " + sh.Code + (string.IsNullOrEmpty(sh.Branch) ? "" : " / " + sh.Branch), reference = sh.Code, currency = "", rate = 1, lines })
        };
        _db.FinRecords.Add(j);
        _db.FinAudits.Add(new FinAudit { TenantId = tenantId, Kind = "journal", RecordId = j.Id, Code = j.Code, Action = "Created", UserName = Username, Summary = "Drafted from POS shift " + sh.Code });
        return code;
    }

    // ------------------------------------------------------------------ checkout

    private class Pricing
    {
        public JsonElement Product; public string Sku = ""; public decimal Qty, Price, Gross, Promo, Manual, Cust, Order, Net, TaxRate, Tax; public string? PromoCode; public decimal ManualPct; public bool Track;
    }

    private static bool InWindow(JsonElement p)
    {
        var now = DateTime.UtcNow.Date;
        if (FinJson.TryDate(p, "from", out var f) && now < f.Date) return false;
        if (FinJson.TryDate(p, "to", out var t) && now > t.Date) return false;
        return true;
    }

    private static (decimal disc, string? code) BestPromo(IEnumerable<PosRecord> promos, string? branch, string sku, string category, decimal qty, decimal price)
    {
        decimal best = 0; string? code = null;
        foreach (var pr in promos)
        {
            var p = FinJson.Obj(pr.Data);
            if (!InWindow(p)) continue;
            var br = FinJson.S(p, "branches");
            if (br != "" && !string.IsNullOrEmpty(branch) && !br.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Contains(branch)) continue;
            var scope = FinJson.S(p, "scope"); var target = FinJson.S(p, "target");
            if (scope == "sku" && !string.Equals(target, sku, StringComparison.OrdinalIgnoreCase)) continue;
            if (scope == "category" && !string.Equals(target, category, StringComparison.OrdinalIgnoreCase)) continue;
            var value = FinJson.D(p, "value"); var gross = price * qty; decimal disc = 0;
            switch (FinJson.S(p, "type"))
            {
                case "pct": disc = gross * value / 100m; break;
                case "amount": disc = Math.Min(gross, value * qty); break;
                case "qty": if (qty >= Math.Max(1, FinJson.D(p, "minQty"))) disc = gross * value / 100m; break;
            }
            if (disc > best) { best = disc; code = pr.Code; }
        }
        return (R2(best), code);
    }

    [HttpPost("sales/checkout")]
    public async Task<IActionResult> Checkout([FromBody] PosCheckoutDto b)
    {
        if (!await Has("pos.sell")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        if (b.Lines.Count == 0) return Bad("The basket is empty.");
        if (b.Lines.Any(l => l.Qty <= 0)) return Bad("Quantities must be positive.");
        var cfg = await LoadCfg(tenantId);
        var branch = Clean(b.Branch); var company = Clean(b.Company);

        if (!string.IsNullOrWhiteSpace(b.LocalId))
        {
            var dup = await _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "sale" && r.Data.Contains(b.LocalId)).ToListAsync();
            var hit = dup.FirstOrDefault(r => FinJson.S(FinJson.Obj(r.Data), "localId") == b.LocalId);
            if (hit != null) return Ok(PosRecordDto.From(hit));       // the till re-sent a sale it already had accepted
        }

        var shift = await OpenShift(tenantId, Clean(b.Register));
        if (shift == null && cfg.RequireShift) return Bad("Open a shift before selling.");

        var manualAny = b.DiscountPct > 0 || b.Lines.Any(l => l.DiscountPct > 0);
        if (manualAny)
        {
            if (!await Has("pos.discount")) return Forbid();
            if (b.DiscountPct > cfg.MaxDiscountPct || b.Lines.Any(l => l.DiscountPct > cfg.MaxDiscountPct)) return Bad($"A discount above {cfg.MaxDiscountPct}% is not allowed.");
            if (b.DiscountPct < 0 || b.Lines.Any(l => l.DiscountPct < 0)) return Bad("Invalid discount.");
        }

        var skus = b.Lines.Select(l => l.Sku.Trim()).Distinct().ToList();
        var products = await _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "product" && skus.Contains(r.Code!)).ToListAsync();
        var promos = (await _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "promotion" && r.Status == "Active").ToListAsync()).ToList();
        PosRecord? cust = null;
        if (Clean(b.Customer) != null)
            cust = await _db.PosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "customer" && r.Code == b.Customer!.Trim());
        var custPct = cust == null ? 0m : FinJson.D(FinJson.Obj(cust.Data), "discountPct");

        var rows = new List<Pricing>();
        foreach (var l in b.Lines)
        {
            var sku = l.Sku.Trim();
            var pr = products.FirstOrDefault(p => string.Equals(p.Code, sku, StringComparison.OrdinalIgnoreCase));
            if (pr == null || pr.Status == "Inactive") return Bad($"Unknown or inactive product {sku}.");
            var pd = FinJson.Obj(pr.Data);
            var price = FinJson.D(pd, "price");
            var row = new Pricing { Product = pd, Sku = pr.Code!, Qty = l.Qty, Price = price, Gross = R2(price * l.Qty), ManualPct = l.DiscountPct, Track = FinJson.B(pd, "trackStock") };
            var (pdisc, pcode) = BestPromo(promos, branch, pr.Code!, FinJson.S(pd, "category"), l.Qty, price);
            row.Promo = pdisc; row.PromoCode = pcode;
            var rest = row.Gross - row.Promo;
            row.Manual = R2(rest * l.DiscountPct / 100m); rest -= row.Manual;
            row.Cust = R2(rest * custPct / 100m); rest -= row.Cust;
            row.Order = R2(rest * b.DiscountPct / 100m); rest -= row.Order;
            row.Net = R2(rest);
            row.TaxRate = FinJson.S(pd, "taxRate") != "" ? FinJson.D(pd, "taxRate") : cfg.TaxRate;      // blank = the workspace default rate
            if (cfg.PricesIncludeTax) row.Tax = R2(row.Net - row.Net / (1 + row.TaxRate / 100m));
            else { row.Tax = R2(row.Net * row.TaxRate / 100m); row.Net = R2(row.Net + row.Tax); }
            rows.Add(row);
        }

        // stock
        foreach (var g in rows.Where(r => r.Track).GroupBy(r => r.Sku, StringComparer.OrdinalIgnoreCase))
        {
            var have = await StockQty(tenantId, branch, g.Key);
            if (!cfg.AllowNegativeStock && have < g.Sum(x => x.Qty)) return Bad($"Not enough stock for {g.Key} (have {have}).");
        }

        var subtotal = R2(rows.Sum(r => r.Gross));
        var total = R2(rows.Sum(r => r.Net));
        var tax = R2(rows.Sum(r => r.Tax));
        var discount = R2(rows.Sum(r => r.Promo + r.Manual + r.Cust + r.Order));

        // loyalty
        decimal redeemPts = 0, redeemValue = 0;
        if (b.RedeemPoints > 0)
        {
            if (cust == null) return Bad("Pick a customer to redeem points.");
            var bal = FinJson.D(FinJson.Obj(cust.Data), "points");
            redeemPts = Math.Min(Math.Floor(b.RedeemPoints), bal);
            if (cfg.PointValue > 0) redeemPts = Math.Min(redeemPts, Math.Floor(total / cfg.PointValue));
            redeemValue = R2(redeemPts * cfg.PointValue);
        }
        var due = R2(total - redeemValue);

        // payments
        var pays = b.Payments.Where(p => p.Amount > 0).ToList();
        if (pays.Any(p => p.Method is not ("cash" or "card" or "other"))) return Bad("Unknown payment method.");
        var tendered = R2(pays.Sum(p => p.Amount));
        if (tendered < due) return Bad("The payment is less than the amount due.");
        var cashTendered = R2(pays.Where(p => p.Method == "cash").Sum(p => p.Amount));
        var change = R2(tendered - due);
        if (change > cashTendered) return Bad("Only cash can be given back as change.");
        var cashApplied = R2(cashTendered - change);
        var cardApplied = R2(pays.Where(p => p.Method == "card").Sum(p => p.Amount));
        var otherApplied = R2(pays.Where(p => p.Method == "other").Sum(p => p.Amount));

        var earned = cust == null || cfg.PointsPerCurrency <= 0 ? 0m : Math.Floor(due * cfg.PointsPerCurrency);
        var code = await NextCode(tenantId, "sale", "S");
        var lineOut = rows.Select(r => new
        {
            sku = r.Sku, name = FinJson.S(r.Product, "name"), category = FinJson.S(r.Product, "category"), qty = r.Qty, price = r.Price, promo = r.PromoCode,
            promoDisc = r.Promo, discPct = r.ManualPct, discount = R2(r.Promo + r.Manual + r.Cust + r.Order), taxRate = r.TaxRate, tax = r.Tax, total = r.Net, returned = 0m
        }).ToList();
        var payOut = pays.Select(p => (object)new { method = p.Method, amount = p.Amount, reference = p.Ref }).ToList();
        if (redeemValue > 0) payOut.Add(new { method = "loyalty", amount = redeemValue, reference = (string?)null });
        var sale = new PosRecord
        {
            TenantId = tenantId, Kind = "sale", Code = code, Company = company, Branch = branch, Ref = shift?.Code, Status = "Completed", CreatedBy = Username,
            Data = JsonSerializer.Serialize(new
            {
                type = "Sale", localId = b.LocalId, register = Clean(b.Register), customer = cust?.Code, customerName = cust == null ? null : FinJson.S(FinJson.Obj(cust.Data), "name"),
                lines = lineOut, subtotal, discount, tax, total, redeemValue,
                payments = payOut,
                tendered, change, earned, redeemedPoints = redeemPts, note = b.Note, cashier = Username, date = DateTime.UtcNow
            })
        };
        _db.PosRecords.Add(sale);

        foreach (var r in rows.Where(r => r.Track)) await Move(tenantId, company, branch, r.Sku, -r.Qty, "sale", code, null);
        if (cust != null)
        {
            var pts = FinJson.D(FinJson.Obj(cust.Data), "points") - redeemPts + earned;
            var spent = FinJson.D(FinJson.Obj(cust.Data), "spent") + total;
            cust.Data = FinJson.WithValues(cust.Data, new() { ["points"] = pts, ["spent"] = R2(spent), ["lastVisit"] = DateTime.UtcNow }); cust.UpdatedAt = DateTime.UtcNow;
        }
        if (shift != null)
            Bump(shift, ("salesTotal", total), ("salesTax", tax), ("salesCount", 1), ("cashSales", cashApplied), ("cardSales", cardApplied), ("otherSales", otherApplied), ("loyaltyValue", redeemValue), ("discountTotal", discount));
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(sale));
    }

    // ------------------------------------------------------------------ returns / void

    [HttpPost("sales/{id}/return")]
    public async Task<IActionResult> Return(string id, [FromBody] PosReturnDto b)
    {
        if (!await Has("pos.refund")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var orig = await _db.PosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "sale");
        if (orig == null) return NotFound();
        var od = FinJson.Obj(orig.Data);
        if (FinJson.S(od, "type") != "Sale" || orig.Status == "Voided") return Bad("Only a completed sale can be returned.");
        if (b.Lines.Count == 0 || b.Lines.Any(l => l.Qty <= 0)) return Bad("Choose what is being returned.");
        var method = b.Method == "card" ? "card" : "cash";
        var shift = await OpenShift(tenantId, null);
        if (shift == null && (await LoadCfg(tenantId)).RequireShift) return Bad("Open a shift before refunding.");

        var origLines = FinJson.Lines(od).ToList();
        var newLines = new List<Dictionary<string, object?>>();
        var returnedMap = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        decimal refund = 0, refundTax = 0;
        foreach (var l in b.Lines)
        {
            var ol = origLines.FirstOrDefault(x => string.Equals(FinJson.S(x, "sku"), l.Sku.Trim(), StringComparison.OrdinalIgnoreCase));
            if (ol.ValueKind != JsonValueKind.Object) return Bad($"{l.Sku} is not on that sale.");
            var sold = FinJson.D(ol, "qty"); var done = FinJson.D(ol, "returned");
            if (l.Qty + done > sold) return Bad($"Only {sold - done} of {l.Sku} can still be returned.");
            var share = l.Qty / sold;
            var amt = R2(FinJson.D(ol, "total") * share); var tx = R2(FinJson.D(ol, "tax") * share);
            refund += amt; refundTax += tx;
            returnedMap[l.Sku.Trim()] = (returnedMap.TryGetValue(l.Sku.Trim(), out var q0) ? q0 : 0) + l.Qty;
            newLines.Add(new() { ["sku"] = FinJson.S(ol, "sku"), ["name"] = FinJson.S(ol, "name"), ["qty"] = l.Qty, ["price"] = FinJson.D(ol, "price"), ["tax"] = tx, ["total"] = amt });
        }
        refund = R2(refund); refundTax = R2(refundTax);
        var code = await NextCode(tenantId, "sale", "R");
        var ret = new PosRecord
        {
            TenantId = tenantId, Kind = "sale", Code = code, Company = orig.Company, Branch = orig.Branch, Parent = orig.Code, Ref = shift?.Code, Status = "Completed", CreatedBy = Username,
            Data = JsonSerializer.Serialize(new { type = "Return", register = FinJson.S(od, "register"), customer = FinJson.S(od, "customer"), lines = newLines, total = -refund, tax = -refundTax, method, reason = b.Reason, cashier = Username, date = DateTime.UtcNow })
        };
        _db.PosRecords.Add(ret);

        // update the original: per-line returned quantities
        var rebuilt = origLines.Select(x =>
        {
            var d = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(x.GetRawText())!;
            var sku = FinJson.S(x, "sku");
            var extra = returnedMap.FirstOrDefault(kv => string.Equals(kv.Key, sku, StringComparison.OrdinalIgnoreCase)).Value;
            var o = new Dictionary<string, object?>();
            foreach (var kv in d) o[kv.Key] = kv.Value;
            o["returned"] = FinJson.D(x, "returned") + extra;
            return o;
        }).ToList();
        orig.Data = FinJson.WithValues(orig.Data, new() { ["lines"] = rebuilt });
        orig.Status = origLines.All(x => FinJson.D(x, "returned") + returnedMap.FirstOrDefault(kv => string.Equals(kv.Key, FinJson.S(x, "sku"), StringComparison.OrdinalIgnoreCase)).Value >= FinJson.D(x, "qty")) ? "Returned" : "PartlyReturned";
        orig.UpdatedAt = DateTime.UtcNow;

        var products = await _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "product" && returnedMap.Keys.Contains(r.Code!)).ToListAsync();
        foreach (var kv in returnedMap)
        {
            var p = products.FirstOrDefault(x => string.Equals(x.Code, kv.Key, StringComparison.OrdinalIgnoreCase));
            if (p != null && FinJson.B(FinJson.Obj(p.Data), "trackStock")) await Move(tenantId, orig.Company, orig.Branch, p.Code!, kv.Value, "return", code, b.Reason);
        }
        var cust = Clean(FinJson.S(od, "customer"));
        if (cust != null)
        {
            var c = await _db.PosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "customer" && r.Code == cust);
            var total = FinJson.D(od, "total"); var earned = FinJson.D(od, "earned");
            if (c != null && total > 0 && earned > 0)
            {
                var take = Math.Floor(earned * refund / total);
                c.Data = FinJson.WithValues(c.Data, new() { ["points"] = Math.Max(0, FinJson.D(FinJson.Obj(c.Data), "points") - take) }); c.UpdatedAt = DateTime.UtcNow;
            }
        }
        if (shift != null)
            Bump(shift, ("returnsTotal", refund), ("returnsTax", refundTax), ("returnCount", 1), (method == "cash" ? "refundCash" : "refundOther", refund));
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(ret));
    }

    [HttpPost("sales/{id}/void")]
    public async Task<IActionResult> Void(string id)
    {
        if (!await Has("pos.void")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var sale = await _db.PosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "sale");
        if (sale == null) return NotFound();
        var d = FinJson.Obj(sale.Data);
        if (FinJson.S(d, "type") != "Sale" || sale.Status != "Completed") return Bad("Only an untouched sale can be voided.");
        var shift = await _db.PosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "shift" && r.Code == sale.Ref);
        if (shift == null || shift.Status != "Open") return Bad("A sale can only be voided while its shift is still open. Use a return instead.");

        foreach (var l in FinJson.Lines(d))
        {
            var p = await _db.PosRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "product" && r.Code == FinJson.S(l, "sku"));
            if (p != null && FinJson.B(FinJson.Obj(p.Data), "trackStock")) await Move(tenantId, sale.Company, sale.Branch, p.Code!, FinJson.D(l, "qty"), "void", sale.Code, null);
        }
        var cust = Clean(FinJson.S(d, "customer"));
        if (cust != null)
        {
            var c = await _db.PosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "customer" && r.Code == cust);
            if (c != null)
            {
                var pts = FinJson.D(FinJson.Obj(c.Data), "points") - FinJson.D(d, "earned") + FinJson.D(d, "redeemedPoints");
                c.Data = FinJson.WithValues(c.Data, new() { ["points"] = Math.Max(0, pts), ["spent"] = Math.Max(0, FinJson.D(FinJson.Obj(c.Data), "spent") - FinJson.D(d, "total")) }); c.UpdatedAt = DateTime.UtcNow;
            }
        }
        decimal cash = 0, card = 0, other = 0;
        foreach (var p in Arr(d, "payments"))
        {
            var m = FinJson.S(p, "method"); var a = FinJson.D(p, "amount");
            if (m == "cash") cash += a; else if (m == "card") card += a; else if (m == "other") other += a;
        }
        cash -= FinJson.D(d, "change");
        Bump(shift, ("salesTotal", -FinJson.D(d, "total")), ("salesTax", -FinJson.D(d, "tax")), ("salesCount", -1), ("cashSales", -R2(cash)), ("cardSales", -R2(card)), ("otherSales", -R2(other)),
            ("loyaltyValue", -FinJson.D(d, "redeemValue")), ("discountTotal", -FinJson.D(d, "discount")), ("voidCount", 1));
        sale.Status = "Voided"; sale.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(sale));
    }

    // ------------------------------------------------------------------ stock / transfers

    [HttpPost("stock/adjust")]
    public async Task<IActionResult> Adjust([FromBody] PosAdjustDto b)
    {
        if (!await Has("pos.stock.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var sku = b.Sku.Trim();
        if (sku == "" || (b.Delta == null && b.Counted == null)) return Bad("Enter a product and a quantity.");
        if (!await _db.PosRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "product" && r.Code == sku)) return Bad("Unknown product.");
        var st = await StockRec(tenantId, Clean(b.Company), Clean(b.Branch), sku);
        var delta = b.Counted != null ? b.Counted.Value - Qty(st) : b.Delta!.Value;
        await Move(tenantId, Clean(b.Company), Clean(b.Branch), sku, delta, b.Counted != null ? "count" : "adjust", null, b.Reason);
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(st));
    }

    [HttpPost("transfers")]
    public async Task<IActionResult> Transfer([FromBody] PosTransferDto b)
    {
        if (!await Has("pos.stock.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var fromBr = Clean(b.FromBranch); var toBr = Clean(b.ToBranch);
        if (fromBr == null || toBr == null || fromBr == toBr) return Bad("Choose two different branches.");
        if (b.Lines.Count == 0 || b.Lines.Any(l => l.Qty <= 0)) return Bad("Add at least one product.");
        var cfg = await LoadCfg(tenantId);
        var code = await NextCode(tenantId, "transfer", "TR");
        foreach (var l in b.Lines)
        {
            var have = await StockQty(tenantId, fromBr, l.Sku.Trim());
            if (!cfg.AllowNegativeStock && have < l.Qty) return Bad($"Not enough {l.Sku} in {fromBr} (have {have}).");
            await Move(tenantId, Clean(b.Company), fromBr, l.Sku.Trim(), -l.Qty, "transfer-out", code, toBr);
        }
        var tr = new PosRecord
        {
            TenantId = tenantId, Kind = "transfer", Code = code, Company = Clean(b.Company), Branch = fromBr, Ref = toBr, Status = "InTransit", CreatedBy = Username,
            Data = JsonSerializer.Serialize(new { from = fromBr, to = toBr, lines = b.Lines.Select(l => new { sku = l.Sku.Trim(), qty = l.Qty }), note = b.Note })
        };
        _db.PosRecords.Add(tr);
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(tr));
    }

    [HttpPost("transfers/{id}/receive")]
    public async Task<IActionResult> Receive(string id)
    {
        if (!await Has("pos.stock.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var tr = await _db.PosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "transfer");
        if (tr == null) return NotFound();
        if (tr.Status != "InTransit") return Bad("That transfer was already received.");
        foreach (var l in FinJson.Lines(FinJson.Obj(tr.Data)))
            await Move(tenantId, tr.Company, tr.Ref, FinJson.S(l, "sku"), FinJson.D(l, "qty"), "transfer-in", tr.Code, tr.Branch);
        tr.Status = "Received"; tr.UpdatedAt = DateTime.UtcNow;
        tr.Data = FinJson.WithValues(tr.Data, new() { ["receivedBy"] = Username, ["receivedAt"] = DateTime.UtcNow });
        await _db.SaveChangesAsync();
        return Ok(PosRecordDto.From(tr));
    }

    // ------------------------------------------------------------------ dashboard

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] string? company, [FromQuery] string? branch, [FromQuery] int days = 14)
    {
        if (!await Has("pos.reports.view")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        days = Math.Clamp(days, 1, 90);
        var since = DateTime.UtcNow.Date.AddDays(-(days - 1));
        IQueryable<PosRecord> Scope(string kind)
        {
            var q = _db.PosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == kind);
            if (!string.IsNullOrWhiteSpace(company) && company != "ALL") q = q.Where(r => r.Company == company || r.Company == null || r.Company == "");
            if (!string.IsNullOrWhiteSpace(branch) && branch != "ALL") q = q.Where(r => r.Branch == branch);
            return q;
        }
        var sales = (await Scope("sale").Where(r => r.CreatedAt >= since && r.Status != "Voided").ToListAsync()).Select(r => (r, d: FinJson.Obj(r.Data))).ToList();
        var today = DateTime.UtcNow.Date;
        decimal Sum(IEnumerable<(PosRecord r, JsonElement d)> x, string type) => x.Where(s => FinJson.S(s.d, "type") == type).Sum(s => FinJson.D(s.d, "total"));
        var todaySales = sales.Where(s => s.r.CreatedAt >= today).ToList();
        var salesToday = Sum(todaySales, "Sale"); var returnsToday = -Sum(todaySales, "Return");
        var cnt = todaySales.Count(s => FinJson.S(s.d, "type") == "Sale");

        var daily = Enumerable.Range(0, days).Select(i => since.AddDays(i)).Select(day => new
        {
            name = day.ToString("MM-dd"),
            a = sales.Where(s => s.r.CreatedAt.Date == day && FinJson.S(s.d, "type") == "Sale").Sum(s => FinJson.D(s.d, "total")),
            b = -sales.Where(s => s.r.CreatedAt.Date == day && FinJson.S(s.d, "type") == "Return").Sum(s => FinJson.D(s.d, "total"))
        }).ToList();

        var pay = new Dictionary<string, decimal>();
        var top = new Dictionary<string, (string name, decimal qty, decimal amount)>();
        foreach (var (r, d) in sales.Where(s => FinJson.S(s.d, "type") == "Sale"))
        {
            foreach (var p in Arr(d, "payments")) pay[FinJson.S(p, "method")] = pay.GetValueOrDefault(FinJson.S(p, "method")) + FinJson.D(p, "amount");
            foreach (var l in FinJson.Lines(d))
            {
                var k = FinJson.S(l, "sku"); var cur = top.GetValueOrDefault(k, (FinJson.S(l, "name"), 0m, 0m));
                top[k] = (cur.name, cur.qty + FinJson.D(l, "qty"), cur.amount + FinJson.D(l, "total"));
            }
        }
        pay["cash"] = pay.GetValueOrDefault("cash") - sales.Where(s => FinJson.S(s.d, "type") == "Sale").Sum(s => FinJson.D(s.d, "change"));
        var byBranch = sales.Where(s => FinJson.S(s.d, "type") == "Sale").GroupBy(s => s.r.Branch ?? "").Select(g => new { name = g.Key, value = g.Sum(s => FinJson.D(s.d, "total")) }).OrderByDescending(x => x.value).ToList();

        var stock = (await Scope("stock").ToListAsync()).Select(r => (r, d: FinJson.Obj(r.Data))).ToList();
        var products = (await Scope("product").ToListAsync()).ToDictionary(p => p.Code ?? "", p => FinJson.Obj(p.Data), StringComparer.OrdinalIgnoreCase);
        var low = stock.Where(s => FinJson.D(s.d, "qty") <= FinJson.D(products.GetValueOrDefault(FinJson.S(s.d, "sku")), "reorder"))
            .Select(s => new { sku = FinJson.S(s.d, "sku"), name = FinJson.S(products.GetValueOrDefault(FinJson.S(s.d, "sku")), "name"), branch = s.r.Branch ?? "", qty = FinJson.D(s.d, "qty") })
            .Where(x => products.ContainsKey(x.sku)).Take(25).ToList();
        decimal stockValue = stock.Sum(s => FinJson.D(s.d, "qty") * FinJson.D(products.GetValueOrDefault(FinJson.S(s.d, "sku")), "cost"));

        var openShifts = await Scope("shift").Where(r => r.Status == "Open").CountAsync();
        var variance = (await Scope("shift").Where(r => r.Status == "Closed" && r.CreatedAt >= since).ToListAsync()).Sum(r => FinJson.D(FinJson.Obj(r.Data), "variance"));

        return Ok(new
        {
            salesToday = R2(salesToday), returnsToday = R2(returnsToday), countToday = cnt, avgBasket = cnt == 0 ? 0 : R2(salesToday / cnt),
            salesPeriod = R2(Sum(sales, "Sale")), returnsPeriod = R2(-Sum(sales, "Return")), openShifts, cashVariance = R2(variance), stockValue = R2(stockValue),
            daily, payments = pay.Select(kv => new { name = kv.Key, value = R2(kv.Value) }), byBranch,
            topProducts = top.OrderByDescending(kv => kv.Value.amount).Take(8).Select(kv => new { name = kv.Value.name == "" ? kv.Key : kv.Value.name, value = R2(kv.Value.amount), qty = kv.Value.qty }),
            lowStock = low
        });
    }
}
