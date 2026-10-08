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

public class HrRecordDto
{
    public string Id { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? EmpNo { get; set; }
    public string? Status { get; set; }
    public JsonElement Data { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }

    public static HrRecordDto From(HrRecord r)
    {
        JsonElement data;
        try { data = JsonDocument.Parse(string.IsNullOrWhiteSpace(r.Data) ? "{}" : r.Data).RootElement.Clone(); }
        catch { data = JsonDocument.Parse("{}").RootElement.Clone(); }
        return new HrRecordDto { Id = r.Id, Kind = r.Kind, Code = r.Code, EmpNo = r.EmpNo, Status = r.Status, Data = data, CreatedBy = r.CreatedBy, CreatedAt = r.CreatedAt };
    }
}

public class HrImportRow { public int Row { get; set; } public HrEmployee Data { get; set; } = new(); }
public class HrImportRequest { public List<HrImportRow> Rows { get; set; } = new(); public bool UpdateExisting { get; set; } = true; }
public class HrImportError { public int Row { get; set; } public string EmpNo { get; set; } = string.Empty; public string Message { get; set; } = string.Empty; }
public class HrImportResult
{
    public int Created { get; set; }
    public int Updated { get; set; }
    public int Skipped { get; set; }
    public List<HrImportError> Errors { get; set; } = new();
}

public class HrCount { public string Name { get; set; } = string.Empty; public int Count { get; set; } }

public class HrSummaryDto
{
    public int Total { get; set; }
    public int Active { get; set; }
    public int OnLeave { get; set; }
    public int Probation { get; set; }
    public int Terminated { get; set; }
    public int NewHires12m { get; set; }
    public int Terminations12m { get; set; }
    public double TurnoverPct { get; set; }
    public double AvgTenureYears { get; set; }
    public decimal? MonthlyPayroll { get; set; }
    public int OnLeaveToday { get; set; }
    public int PendingLeave { get; set; }
    public int OpenVacancies { get; set; }
    public int OpenPositions { get; set; }
    public int CandidatesInPipeline { get; set; }
    public List<HrCount> ByUnit { get; set; } = new();
    public List<HrCount> ByNationality { get; set; } = new();
    public List<HrCount> ByLocation { get; set; } = new();
    public List<HrCount> ByGender { get; set; } = new();
    public List<HrCount> Hires { get; set; } = new();          // last 12 months, name = yyyy-MM
    public List<HrCount> Ratings { get; set; } = new();        // performance distribution
}

/// <summary>
/// Core HR: employee master data (add / edit / import from Excel or CSV), organization structure and reference data,
/// leave & absence, performance, recruitment and the HR dashboard figures.
/// Every endpoint checks a privilege that the Admin module hands out (hr.employees.*, hr.org.*, hr.leave.*, ...).
/// Everything is scoped to the caller's workspace.
/// </summary>
[ApiController]
[Route("api/hr")]
[Authorize]
public class HrController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;

    public HrController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant)
    {
        _db = db; _perms = perms; _tenant = tenant;
    }

    private string Username => User.FindFirstValue(ClaimTypes.Name)!;

    private static readonly string[] Statuses = { "Active", "Probation", "OnLeave", "Terminated" };
    private static readonly string[] OrgKinds = { "unit", "position", "job", "grade", "costcenter", "location", "entity", "bu", "leavetype" };

    /// <summary>kind -> (privilege to see all records, privilege to change them)</summary>
    private static (string view, string manage)? KindPerms(string kind)
    {
        if (OrgKinds.Contains(kind)) return ("hr.org.view", "hr.org.manage");
        return kind switch
        {
            "leave" => ("hr.leave.view", "hr.leave.approve"),
            "goal" or "review" => ("hr.performance.view", "hr.performance.manage"),
            "vacancy" or "candidate" => ("hr.recruitment.view", "hr.recruitment.manage"),
            _ => null
        };
    }

    private async Task<bool> Has(string p) => await _perms.Has(User, p);

    private async Task<bool> HasAnyHr()
    {
        var mine = await _perms.EffectiveFor(User);
        return mine.Any(p => p.StartsWith("hr.", StringComparison.OrdinalIgnoreCase));
    }

    // ------------------------------------------------------------------ employees

    [HttpGet("employees")]
    public async Task<ActionResult<IEnumerable<HrEmployee>>> Employees()
    {
        // The org-wide list is also what the leave / performance / recruitment screens use for names.
        if (!await Has("hr.employees.view") && !await Has("hr.leave.view") && !await Has("hr.performance.view") && !await Has("hr.recruitment.view") && !await Has("hr.org.view"))
            return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var list = await _db.HrEmployees.AsNoTracking().Where(e => e.TenantId == tenantId).OrderBy(e => e.EmpNo).ToListAsync();
        if (!await Has("hr.employees.salary")) foreach (var e in list) e.BasicSalary = null;
        return Ok(list);
    }

    /// <summary>The employee record linked to the signed-in portal user (by Username, then by e-mail) - for self-service.</summary>
    [HttpGet("employees/me")]
    public async Task<ActionResult<HrEmployee>> Me()
    {
        if (!await Has("hr.self")) return Forbid();
        var me = await MyEmployee();
        if (me == null) return NotFound();
        return Ok(me);
    }

    private async Task<HrEmployee?> MyEmployee()
    {
        var tenantId = await _tenant.TenantIdOf(User);
        var emp = await _db.HrEmployees.AsNoTracking().FirstOrDefaultAsync(e => e.TenantId == tenantId && e.Username == Username);
        if (emp != null) return emp;
        var email = await _db.Users.AsNoTracking().Where(u => u.Username == Username).Select(u => u.Email).FirstOrDefaultAsync();
        if (string.IsNullOrWhiteSpace(email)) return null;
        return await _db.HrEmployees.AsNoTracking().FirstOrDefaultAsync(e => e.TenantId == tenantId && e.Email == email);
    }

    [HttpPost("employees")]
    public async Task<ActionResult<HrEmployee>> CreateEmployee([FromBody] HrEmployee body)
    {
        if (!await Has("hr.employees.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var error = Validate(body);
        if (error != null) return BadRequest(error);
        if (await _db.HrEmployees.AnyAsync(e => e.TenantId == tenantId && e.EmpNo == body.EmpNo.Trim()))
            return Conflict("That employee number already exists.");
        var emp = new HrEmployee { TenantId = tenantId };
        Apply(emp, body, await Has("hr.employees.salary"));
        _db.HrEmployees.Add(emp);
        await _db.SaveChangesAsync();
        return Ok(emp);
    }

    [HttpPut("employees/{id}")]
    public async Task<ActionResult<HrEmployee>> UpdateEmployee(string id, [FromBody] HrEmployee body)
    {
        if (!await Has("hr.employees.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var emp = await _db.HrEmployees.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
        if (emp == null) return NotFound();
        var error = Validate(body);
        if (error != null) return BadRequest(error);
        var no = body.EmpNo.Trim();
        if (no != emp.EmpNo && await _db.HrEmployees.AnyAsync(e => e.TenantId == tenantId && e.EmpNo == no))
            return Conflict("That employee number already exists.");
        Apply(emp, body, await Has("hr.employees.salary"));
        emp.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        if (!await Has("hr.employees.salary")) emp.BasicSalary = null;
        return Ok(emp);
    }

    [HttpDelete("employees/{id}")]
    public async Task<IActionResult> DeleteEmployee(string id)
    {
        if (!await Has("hr.employees.manage")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var emp = await _db.HrEmployees.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
        if (emp == null) return NotFound();
        _db.HrEmployees.Remove(emp);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Bulk add / update from an Excel or CSV file (the portal parses the file and sends the mapped rows in chunks).</summary>
    [HttpPost("employees/import")]
    public async Task<ActionResult<HrImportResult>> Import([FromBody] HrImportRequest req)
    {
        if (!await Has("hr.employees.import")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var canSalary = await Has("hr.employees.salary");
        var result = new HrImportResult();
        var existing = await _db.HrEmployees.Where(e => e.TenantId == tenantId).ToDictionaryAsync(e => e.EmpNo, StringComparer.OrdinalIgnoreCase);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var row in req.Rows.Take(1000))
        {
            var d = row.Data;
            var error = Validate(d);
            if (error != null) { result.Errors.Add(new HrImportError { Row = row.Row, EmpNo = d.EmpNo, Message = error }); continue; }
            var no = d.EmpNo.Trim();
            if (!seen.Add(no)) { result.Errors.Add(new HrImportError { Row = row.Row, EmpNo = no, Message = "Duplicate employee number in the file." }); continue; }

            if (existing.TryGetValue(no, out var emp))
            {
                if (!req.UpdateExisting) { result.Skipped++; continue; }
                Apply(emp, d, canSalary);
                emp.UpdatedAt = DateTime.UtcNow;
                result.Updated++;
            }
            else
            {
                emp = new HrEmployee { TenantId = tenantId };
                Apply(emp, d, canSalary);
                _db.HrEmployees.Add(emp);
                existing[no] = emp;
                result.Created++;
            }
        }
        await _db.SaveChangesAsync();
        return Ok(result);
    }

    private static string? Validate(HrEmployee e)
    {
        if (string.IsNullOrWhiteSpace(e.EmpNo)) return "Employee number is required.";
        if (string.IsNullOrWhiteSpace(e.FullName)) return "Full name is required.";
        if (e.EmpNo.Trim().Length > 60) return "Employee number is too long.";
        if (!string.IsNullOrWhiteSpace(e.Status) && !Statuses.Contains(e.Status, StringComparer.OrdinalIgnoreCase)) return "Status must be Active, Probation, OnLeave or Terminated.";
        if (!string.IsNullOrWhiteSpace(e.Email) && !e.Email.Contains('@')) return "E-mail is not valid.";
        return null;
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>Copies the editable fields; salary only when the caller may see/change it.</summary>
    private static void Apply(HrEmployee to, HrEmployee from, bool canSalary)
    {
        to.EmpNo = from.EmpNo.Trim();
        to.FullName = from.FullName.Trim();
        to.FullNameAr = Clean(from.FullNameAr);
        to.Email = Clean(from.Email);
        to.Phone = Clean(from.Phone);
        to.Nationality = Clean(from.Nationality);
        to.Gender = Clean(from.Gender);
        to.NationalId = Clean(from.NationalId);
        to.BirthDate = from.BirthDate;
        to.HireDate = from.HireDate;
        to.TerminationDate = from.TerminationDate;
        to.Status = Statuses.FirstOrDefault(s => s.Equals(from.Status ?? "Active", StringComparison.OrdinalIgnoreCase)) ?? "Active";
        to.Company = Clean(from.Company);
        to.Branch = Clean(from.Branch);
        to.Unit = Clean(from.Unit);
        to.Position = Clean(from.Position);
        to.Job = Clean(from.Job);
        to.Grade = Clean(from.Grade);
        to.ManagerEmpNo = Clean(from.ManagerEmpNo);
        to.CostCenter = Clean(from.CostCenter);
        to.Location = Clean(from.Location);
        to.LegalEntity = Clean(from.LegalEntity);
        to.BusinessUnit = Clean(from.BusinessUnit);
        to.Username = Clean(from.Username);
        to.Notes = Clean(from.Notes);
        if (canSalary) to.BasicSalary = from.BasicSalary;
    }

    // ------------------------------------------------------------------ records (org, leave, performance, recruitment)

    [HttpGet("records/{kind}")]
    public async Task<ActionResult<IEnumerable<HrRecordDto>>> Records(string kind, [FromQuery] string? empNo = null)
    {
        var kp = KindPerms(kind);
        if (kp == null) return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        var q = _db.HrRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == kind);

        var seeAll = await Has(kp.Value.view) || await Has(kp.Value.manage);
        if (OrgKinds.Contains(kind))
        {
            // reference lists feed dropdowns on every HR screen
            if (!seeAll && !await HasAnyHr()) return Forbid();
        }
        else if (!seeAll)
        {
            // everyone with self-service sees their own leave / goals / reviews only
            if (!await Has("hr.self") || kind is "vacancy" or "candidate") return Forbid();
            var me = await MyEmployee();
            if (me == null) return Ok(new List<HrRecordDto>());
            q = q.Where(r => r.EmpNo == me.EmpNo);
        }
        if (!string.IsNullOrWhiteSpace(empNo)) q = q.Where(r => r.EmpNo == empNo);
        var list = await q.OrderByDescending(r => r.CreatedAt).ToListAsync();
        return Ok(list.Select(HrRecordDto.From));
    }

    [HttpPost("records/{kind}")]
    public async Task<ActionResult<HrRecordDto>> CreateRecord(string kind, [FromBody] HrRecordDto body)
    {
        var kp = KindPerms(kind);
        if (kp == null) return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        var manage = await Has(kp.Value.manage);
        var rec = new HrRecord { TenantId = tenantId, Kind = kind, CreatedBy = Username };

        if (!manage)
        {
            // self-service: employees can only file their own leave requests
            if (kind != "leave" || !await Has("hr.self")) return Forbid();
            var me = await MyEmployee();
            if (me == null) return BadRequest("Your user is not linked to an employee record. Ask HR to set your username on your employee profile.");
            body.EmpNo = me.EmpNo;
            body.Status = "Pending";
        }

        if (OrgKinds.Contains(kind) || kind == "vacancy")
        {
            if (string.IsNullOrWhiteSpace(body.Code)) return BadRequest("Code is required.");
            body.Code = body.Code.Trim();
            if (await _db.HrRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == kind && r.Code == body.Code))
                return Conflict("That code already exists.");
        }
        if ((kind is "leave" or "goal" or "review") && string.IsNullOrWhiteSpace(body.EmpNo)) return BadRequest("Employee is required.");

        rec.Code = Clean(body.Code);
        rec.EmpNo = Clean(body.EmpNo);
        rec.Status = Clean(body.Status) ?? DefaultStatus(kind);
        rec.Data = body.Data.ValueKind == JsonValueKind.Object ? body.Data.GetRawText() : "{}";
        _db.HrRecords.Add(rec);
        await _db.SaveChangesAsync();
        return Ok(HrRecordDto.From(rec));
    }

    [HttpPut("records/{kind}/{id}")]
    public async Task<ActionResult<HrRecordDto>> UpdateRecord(string kind, string id, [FromBody] HrRecordDto body)
    {
        var kp = KindPerms(kind);
        if (kp == null) return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.HrRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);
        if (rec == null) return NotFound();

        if (!await Has(kp.Value.manage))
        {
            // the only thing an employee may change is cancelling their own pending leave request
            if (kind != "leave" || !await Has("hr.self")) return Forbid();
            var me = await MyEmployee();
            if (me == null || rec.EmpNo != me.EmpNo || rec.Status != "Pending" || body.Status != "Cancelled") return Forbid();
            rec.Status = "Cancelled";
            rec.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return Ok(HrRecordDto.From(rec));
        }

        if (OrgKinds.Contains(kind) || kind == "vacancy")
        {
            var code = Clean(body.Code);
            if (code == null) return BadRequest("Code is required.");
            if (code != rec.Code && await _db.HrRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == kind && r.Code == code))
                return Conflict("That code already exists.");
            rec.Code = code;
        }
        if (kind == "leave" && body.Status != rec.Status && (body.Status == "Approved" || body.Status == "Rejected"))
        {
            // stamp who decided - merged into the JSON so the screens can show it
            var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(body.Data.ValueKind == JsonValueKind.Object ? body.Data.GetRawText() : "{}") ?? new();
            var merged = new Dictionary<string, object?>();
            foreach (var kv in dict) merged[kv.Key] = kv.Value;
            merged["decidedBy"] = Username;
            merged["decidedAt"] = DateTime.UtcNow;
            rec.Data = JsonSerializer.Serialize(merged);
        }
        else rec.Data = body.Data.ValueKind == JsonValueKind.Object ? body.Data.GetRawText() : rec.Data;

        if (!string.IsNullOrWhiteSpace(body.EmpNo)) rec.EmpNo = body.EmpNo.Trim();
        if (!string.IsNullOrWhiteSpace(body.Status)) rec.Status = body.Status.Trim();
        rec.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(HrRecordDto.From(rec));
    }

    [HttpDelete("records/{kind}/{id}")]
    public async Task<IActionResult> DeleteRecord(string kind, string id)
    {
        var kp = KindPerms(kind);
        if (kp == null) return NotFound();
        if (!await Has(kp.Value.manage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.HrRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);
        if (rec == null) return NotFound();
        _db.HrRecords.Remove(rec);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private static string DefaultStatus(string kind) => kind switch
    {
        "leave" => "Pending", "vacancy" => "Open", "candidate" => "Applied", "review" => "Draft", "goal" => "Active", _ => "Active"
    };

    // ------------------------------------------------------------------ dashboard

    [HttpGet("summary")]
    public async Task<ActionResult<HrSummaryDto>> Summary()
    {
        if (!await Has("hr.reports.view")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var emps = await _db.HrEmployees.AsNoTracking().Where(e => e.TenantId == tenantId).ToListAsync();
        var recs = await _db.HrRecords.AsNoTracking()
            .Where(r => r.TenantId == tenantId && (r.Kind == "leave" || r.Kind == "vacancy" || r.Kind == "candidate" || r.Kind == "review")).ToListAsync();

        var now = DateTime.UtcNow;
        var yearAgo = now.AddMonths(-12);
        var current = emps.Where(e => e.Status != "Terminated").ToList();
        var s = new HrSummaryDto
        {
            Total = emps.Count,
            Active = emps.Count(e => e.Status == "Active"),
            OnLeave = emps.Count(e => e.Status == "OnLeave"),
            Probation = emps.Count(e => e.Status == "Probation"),
            Terminated = emps.Count(e => e.Status == "Terminated"),
            NewHires12m = emps.Count(e => e.HireDate != null && e.HireDate >= yearAgo),
            Terminations12m = emps.Count(e => e.TerminationDate != null && e.TerminationDate >= yearAgo),
        };
        s.TurnoverPct = current.Count == 0 ? 0 : Math.Round(100.0 * s.Terminations12m / current.Count, 1);
        var withHire = current.Where(e => e.HireDate != null).ToList();
        s.AvgTenureYears = withHire.Count == 0 ? 0 : Math.Round(withHire.Average(e => (now - e.HireDate!.Value).TotalDays / 365.25), 1);
        if (await Has("hr.employees.salary")) s.MonthlyPayroll = current.Sum(e => e.BasicSalary ?? 0);

        List<HrCount> Group(Func<HrEmployee, string?> key) =>
            current.GroupBy(e => string.IsNullOrWhiteSpace(key(e)) ? "-" : key(e)!.Trim())
                   .Select(g => new HrCount { Name = g.Key, Count = g.Count() }).OrderByDescending(c => c.Count).Take(12).ToList();
        s.ByUnit = Group(e => e.Unit);
        s.ByNationality = Group(e => e.Nationality);
        s.ByLocation = Group(e => e.Location);
        s.ByGender = Group(e => e.Gender);
        for (var i = 11; i >= 0; i--)
        {
            var m = new DateTime(now.Year, now.Month, 1).AddMonths(-i);
            s.Hires.Add(new HrCount { Name = m.ToString("yyyy-MM", CultureInfo.InvariantCulture), Count = emps.Count(e => e.HireDate != null && e.HireDate.Value.Year == m.Year && e.HireDate.Value.Month == m.Month) });
        }

        var today = now.Date;
        foreach (var r in recs.Where(r => r.Kind == "leave"))
        {
            if (r.Status == "Pending") s.PendingLeave++;
            if (r.Status == "Approved" && TryDate(r.Data, "from", out var f) && TryDate(r.Data, "to", out var t) && f.Date <= today && today <= t.Date) s.OnLeaveToday++;
        }
        foreach (var r in recs.Where(r => r.Kind == "vacancy" && r.Status == "Open"))
        {
            s.OpenVacancies++;
            s.OpenPositions += TryInt(r.Data, "openings", 1);
        }
        s.CandidatesInPipeline = recs.Count(r => r.Kind == "candidate" && r.Status != "Hired" && r.Status != "Rejected");
        s.Ratings = recs.Where(r => r.Kind == "review" && TryInt(r.Data, "rating", 0) > 0)
            .GroupBy(r => TryInt(r.Data, "rating", 0)).OrderBy(g => g.Key)
            .Select(g => new HrCount { Name = g.Key.ToString(), Count = g.Count() }).ToList();
        return Ok(s);
    }

    private static bool TryDate(string json, string prop, out DateTime value)
    {
        value = default;
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty(prop, out var p) && DateTime.TryParse(p.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.None, out value);
        }
        catch { return false; }
    }

    private static int TryInt(string json, string prop, int fallback)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty(prop, out var p)) return fallback;
            if (p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out var n)) return n;
            if (p.ValueKind == JsonValueKind.String && int.TryParse(p.GetString(), out var m)) return m;
        }
        catch { /* ignore */ }
        return fallback;
    }
}
