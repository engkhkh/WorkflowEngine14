using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Security;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class HosRecordDto
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

    public static HosRecordDto From(HosRecord r) => new()
    {
        Id = r.Id, Kind = r.Kind, Code = r.Code, Company = r.Company, Branch = r.Branch, Status = r.Status, Ref = r.Ref, Parent = r.Parent,
        Data = FinJson.Obj(r.Data), CreatedBy = r.CreatedBy, CreatedAt = r.CreatedAt, UpdatedAt = r.UpdatedAt
    };
}

/// <summary>
/// Hospital. The rules that matter in a hospital are enforced HERE, not in the screens:
///  - an appointment cannot overlap another one of the same doctor and must fall inside the doctor's working hours;
///  - a prescription is checked against the patient's allergies and against the other active medicines (interactions) and
///    cannot be saved over a warning without a written reason that stays on the record;
///  - the pharmacy can only dispense what is in stock, and every stock change leaves a movement;
///  - a lab result is flagged (low / high / critical) from the test's reference range;
///  - a bed has one patient at a time (admit, transfer, discharge free and take beds);
///  - the invoice is built from what really happened in the visit (consultation, lab, dispensed medicines, bed days),
///    insurance covers its percentage only while the policy is valid, and payments cannot exceed what is due;
///  - opening a patient file is written to an audit trail, and clinical data needs its own privilege.
/// </summary>
[ApiController]
[Route("api/hospital")]
[Authorize]
public class HospitalController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;
    private readonly ICurrentUser _me;

    public HospitalController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant, ICurrentUser me) { _db = db; _perms = perms; _tenant = tenant; _me = me; }

    // ------------------------------------------------------------------ small helpers

    private string Username => User.FindFirstValue(ClaimTypes.Name) ?? "";
    private Task<bool> Has(string p) => _perms.Has(User, p);
    private async Task<bool> HasAny(params string[] ps) { var eff = await _perms.EffectiveFor(User); return ps.Any(p => eff.Contains(p, StringComparer.OrdinalIgnoreCase)); }
    private BadRequestObjectResult Bad(string m) => BadRequest(new { message = m });
    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static decimal R2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    private static JsonObject D(HosRecord r) => JsonNode.Parse(string.IsNullOrWhiteSpace(r.Data) ? "{}" : r.Data) as JsonObject ?? new JsonObject();
    private static void Put(HosRecord r, JsonObject d) { r.Data = d.ToJsonString(); r.UpdatedAt = DateTime.UtcNow; }

    private static string S(JsonObject o, string k)
    {
        if (!o.TryGetPropertyValue(k, out var n) || n == null) return "";
        if (n is JsonValue v && v.TryGetValue<string>(out var s)) return s ?? "";
        return n.ToString();
    }
    private static decimal N(JsonObject o, string k)
    {
        if (!o.TryGetPropertyValue(k, out var n) || n is not JsonValue v) return 0m;
        if (v.TryGetValue<decimal>(out var d)) return d;
        if (v.TryGetValue<double>(out var db)) return (decimal)db;
        return decimal.TryParse(v.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var p) ? p : 0m;
    }
    private static decimal? NN(JsonObject o, string k) => o.TryGetPropertyValue(k, out var n) && n != null && !string.IsNullOrWhiteSpace(n.ToString()) ? N(o, k) : null;
    private static JsonArray A(JsonObject o, string k) => o.TryGetPropertyValue(k, out var n) && n is JsonArray a ? a : new JsonArray();
    private static JsonObject Obj(JsonObject o, string k) => o.TryGetPropertyValue(k, out var n) && n is JsonObject x ? x : new JsonObject();
    private static List<string> Strs(JsonObject o, string k) => A(o, k).Select(x => x?.ToString() ?? "").Where(x => x != "").ToList();

    private async Task<string> Tid() => await _tenant.TenantIdOf(User);

    /// <summary>Hospital settings of the workspace (currency, tax, payment methods, weekend ...). Nothing here is tied to one country.</summary>
    private async Task<JsonObject> Cfg(string tenantId)
    {
        var r = await _db.HosRecords.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Kind == "setting" && x.Code == "main");
        return r == null ? new JsonObject() : D(r);
    }
    private static readonly string[] DefaultMethods = { "cash", "card", "transfer", "other" };
    /// <summary>The caller's local calendar day (the browser knows its time zone, the server does not): yyyy-MM-dd, validated.</summary>
    private static string LocalDay(string? s) => DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d.ToString("yyyy-MM-dd") : ClientClock.Today.ToString("yyyy-MM-dd");

    private IQueryable<HosRecord> Q(string tenantId, string kind) => _db.HosRecords.Where(r => r.TenantId == tenantId && r.Kind == kind);

    private async Task<HosRecord?> ByCode(string tenantId, string kind, string? code)
        => string.IsNullOrWhiteSpace(code) ? null : await _db.HosRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == kind && r.Code == code);

    private async Task<string> NextCode(string tenantId, string kind, string prefix, bool withYear = true)
    {
        var year = DateTime.UtcNow.Year;
        var n = await _db.HosRecords.CountAsync(r => r.TenantId == tenantId && r.Kind == kind) + 1;
        string code;
        do { code = withYear ? $"{prefix}-{year}-{n:000000}" : $"{prefix}-{n:000000}"; n++; }
        while (await _db.HosRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == kind && r.Code == code)
               || _db.HosRecords.Local.Any(r => r.TenantId == tenantId && r.Kind == kind && r.Code == code));
        return code;
    }

    private HosRecord New(string tenantId, string kind, string code, string status, JsonObject data, string? branch = null, string? parent = null, string? @ref = null)
        => new() { TenantId = tenantId, Kind = kind, Code = code, Status = status, Branch = Clean(branch), Parent = parent, Ref = @ref, CreatedBy = Username, Data = data.ToJsonString() };

    private async Task Audit(string tenantId, string patientCode, string action)
    {
        _db.HosRecords.Add(New(tenantId, "audit", await NextCode(tenantId, "audit", "AU", false), "Logged",
            new JsonObject { ["action"] = action, ["by"] = Username, ["at"] = DateTime.UtcNow.ToString("o") }, null, patientCode));
    }

    // ------------------------------------------------------------------ privileges per kind

    private static readonly string[] Config = { "department", "doctor", "ward", "bed", "service", "labtest", "drug", "setting" };

    private static string[] ViewPerms(string kind) => kind switch
    {
        "department" or "doctor" or "ward" or "service" or "labtest" or "setting" => new[] { "hos.view" },
        "bed" => new[] { "hos.wards.view", "hos.clinical.view", "hos.view" },
        "drug" => new[] { "hos.pharmacy.view", "hos.prescribe", "hos.view" },
        "drugmove" => new[] { "hos.pharmacy.view" },
        "patient" => new[] { "hos.patients.view", "hos.appointments.view", "hos.clinical.view", "hos.pharmacy.view", "hos.lab.view", "hos.billing.view", "hos.wards.view" },
        "appointment" => new[] { "hos.appointments.view", "hos.clinical.view" },
        "visit" => new[] { "hos.clinical.view", "hos.appointments.view", "hos.billing.view" },
        "prescription" => new[] { "hos.clinical.view", "hos.pharmacy.view" },
        "labrequest" => new[] { "hos.lab.view", "hos.clinical.view" },
        "admission" => new[] { "hos.wards.view", "hos.clinical.view" },
        "invoice" => new[] { "hos.billing.view" },
        "audit" => new[] { "hos.setup" },
        _ => Array.Empty<string>()
    };

    private static string ManagePerm(string kind) => kind switch
    {
        "drug" => "hos.pharmacy.stock",
        "patient" => "hos.patients.manage",
        _ => "hos.setup"
    };

    // ------------------------------------------------------------------ generic read

    [HttpGet("records/{kind}")]
    public async Task<IActionResult> List(string kind, [FromQuery] string? q, [FromQuery] string? status, [FromQuery] string? parent, [FromQuery(Name = "ref")] string? refCode,
        [FromQuery] string? branch, [FromQuery(Name = "from")] string? dateFrom, [FromQuery(Name = "to")] string? dateTo, [FromQuery] int take = 500)
    {
        var vp = ViewPerms(kind);
        if (vp.Length == 0) return NotFound();
        if (!await HasAny(vp)) return Forbid();
        var tenantId = await Tid();
        var qry = _db.HosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == kind);
        if (!string.IsNullOrWhiteSpace(branch) && branch != "ALL") qry = qry.Where(r => r.Branch == branch || r.Branch == null || r.Branch == "");
        var allowedBr = await _me.AllowedBranchesAsync();
        if (allowedBr != null) qry = qry.Where(r => r.Branch == null || r.Branch == "" || allowedBr.Contains(r.Branch));
        if (!string.IsNullOrWhiteSpace(status)) qry = qry.Where(r => r.Status == status);
        if (!string.IsNullOrWhiteSpace(parent)) qry = qry.Where(r => r.Parent == parent);
        if (!string.IsNullOrWhiteSpace(refCode)) qry = qry.Where(r => r.Ref == refCode);
        if (DateTime.TryParse(dateFrom, out var f)) qry = qry.Where(r => r.CreatedAt >= f.Date);
        if (DateTime.TryParse(dateTo, out var t)) qry = qry.Where(r => r.CreatedAt < t.Date.AddDays(1));
        if (!string.IsNullOrWhiteSpace(q)) { var s = q.Trim(); qry = qry.Where(r => (r.Code != null && r.Code.Contains(s)) || r.Data.Contains(s)); }
        // clinical content is not for everybody: those who may only see the patient list get no clinical kinds (already blocked by ViewPerms)
        var list = await qry.OrderByDescending(r => r.CreatedAt).Take(Math.Clamp(take, 1, 5000)).ToListAsync();
        return Ok(list.Select(HosRecordDto.From));
    }

    [HttpGet("records/{kind}/{id}")]
    public async Task<IActionResult> GetOne(string kind, string id)
    {
        var vp = ViewPerms(kind);
        if (vp.Length == 0) return NotFound();
        if (!await HasAny(vp)) return Forbid();
        var tenantId = await Tid();
        var rec = await _db.HosRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == kind && (r.Id == id || r.Code == id));
        if (rec == null) return NotFound();
        if (!await _me.CanUseBranchAsync(rec.Branch)) return Forbid();
        return Ok(HosRecordDto.From(rec));
    }

    // ------------------------------------------------------------------ catalogue / setup records (department, doctor, ward, bed, service, labtest, drug, setting)

    [HttpPost("records/{kind}")]
    public async Task<IActionResult> Create(string kind, [FromBody] HosRecordDto body)
    {
        if (!Config.Contains(kind) && kind != "patient") return NotFound();
        if (!await Has(ManagePerm(kind))) return Forbid();
        if (!await _me.CanUseBranchAsync(Clean(body.Branch))) return Forbid();
        var tenantId = await Tid();
        var data = body.Data.ValueKind == JsonValueKind.Object ? (JsonNode.Parse(body.Data.GetRawText()) as JsonObject ?? new JsonObject()) : new JsonObject();
        string code;
        if (kind == "patient")
        {
            if (string.IsNullOrWhiteSpace(S(data, "name"))) return Bad("Patient name is required.");
            var nid = Clean(S(data, "nationalId"));
            if (nid != null && await _db.HosRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == "patient" && r.Data.Contains(nid) && r.Status != "Merged"))
            {   // same national id already registered -> do not create a duplicate file
                var dup = (await _db.HosRecords.Where(r => r.TenantId == tenantId && r.Kind == "patient" && r.Data.Contains(nid)).ToListAsync()).FirstOrDefault(r => S(D(r), "nationalId") == nid);
                if (dup != null) return Conflict(new { message = $"This national id is already registered ({dup.Code}).", code = dup.Code });
            }
            code = await NextCode(tenantId, "patient", "MRN", false);
        }
        else
        {
            code = Clean(body.Code) ?? "";
            if (code == "") return Bad("Code is required.");
            if (await _db.HosRecords.AnyAsync(r => r.TenantId == tenantId && r.Kind == kind && r.Code == code)) return Conflict(new { message = "That code already exists." });
            if (kind == "bed" && await ByCode(tenantId, "ward", body.Parent) == null) return Bad("Choose the ward of the bed.");
            if (kind == "drug" && !data.ContainsKey("stock")) data["stock"] = 0;
        }
        var rec = New(tenantId, kind, code, Clean(body.Status) ?? (kind == "bed" ? "Available" : kind == "patient" ? "Active" : "Active"), data, body.Branch, Clean(body.Parent));
        _db.HosRecords.Add(rec);
        if (kind == "patient") await Audit(tenantId, code, "registered");
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(rec));
    }

    [HttpPut("records/{kind}/{id}")]
    public async Task<IActionResult> Update(string kind, string id, [FromBody] HosRecordDto body)
    {
        if (!Config.Contains(kind) && kind != "patient") return NotFound();
        if (!await Has(ManagePerm(kind))) return Forbid();
        var tenantId = await Tid();
        var rec = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);
        if (rec == null) return NotFound();
        if (!await _me.CanUseBranchAsync(rec.Branch) || !await _me.CanUseBranchAsync(Clean(body.Branch))) return Forbid();
        if (body.Data.ValueKind == JsonValueKind.Object)
        {
            var data = JsonNode.Parse(body.Data.GetRawText()) as JsonObject ?? new JsonObject();
            // stock is only changed through stock movements, a bed's status only through admissions
            if (kind == "drug") data["stock"] = N(D(rec), "stock");
            rec.Data = data.ToJsonString();
        }
        if (kind == "bed")
        {   // an occupied bed is freed only by discharging / transferring the patient
            if (rec.Status != "Occupied" && (body.Status == "Available" || body.Status == "Maintenance")) rec.Status = body.Status;
        }
        else rec.Status = Clean(body.Status) ?? rec.Status;
        rec.Branch = Clean(body.Branch);
        rec.UpdatedAt = DateTime.UtcNow;
        if (kind == "patient") await Audit(tenantId, rec.Code ?? "", "updated");
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(rec));
    }

    [HttpDelete("records/{kind}/{id}")]
    public async Task<IActionResult> Delete(string kind, string id)
    {
        if (!Config.Contains(kind)) return NotFound();   // clinical, financial and patient records are never deleted
        if (!await Has(ManagePerm(kind))) return Forbid();
        var tenantId = await Tid();
        var rec = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);
        if (rec == null) return NotFound();
        if (kind == "bed" && rec.Status == "Occupied") return Bad("The bed is occupied.");
        if (kind == "ward" && await Q(tenantId, "bed").AnyAsync(b => b.Parent == rec.Code)) return Bad("Delete or move the beds of this ward first.");
        _db.HosRecords.Remove(rec);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ------------------------------------------------------------------ patient file

    [HttpGet("patients/{code}/file")]
    public async Task<IActionResult> PatientFile(string code)
    {
        if (!await HasAny(ViewPerms("patient"))) return Forbid();
        var tenantId = await Tid();
        var p = await ByCode(tenantId, "patient", code);
        if (p == null) return NotFound();
        var clinical = await Has("hos.clinical.view");
        await Audit(tenantId, code, clinical ? "opened clinical file" : "opened");
        await _db.SaveChangesAsync();

        async Task<List<HosRecordDto>> Of(string kind, string field, bool allow = true)
        {
            if (!allow) return new();
            var list = await _db.HosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == kind && (field == "parent" ? r.Parent == code : r.Ref == code)).OrderByDescending(r => r.CreatedAt).Take(500).ToListAsync();
            return list.Select(HosRecordDto.From).ToList();
        }
        return Ok(new
        {
            patient = HosRecordDto.From(p),
            appointments = (await _db.HosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "appointment" && r.Data.Contains("\"patient\":\"" + code + "\"")).OrderByDescending(r => r.CreatedAt).Take(200).ToListAsync())
                .Where(r => S(D(r), "patient") == code).Select(HosRecordDto.From).ToList(),
            visits = await Of("visit", "parent", clinical),
            prescriptions = await Of("prescription", "ref", clinical || await Has("hos.pharmacy.view")),
            labs = await Of("labrequest", "ref", clinical || await Has("hos.lab.view")),
            admissions = await Of("admission", "parent", clinical || await Has("hos.wards.view")),
            invoices = await Of("invoice", "ref", await Has("hos.billing.view")),
            audit = await Has("hos.setup") ? await Of("audit", "parent") : new List<HosRecordDto>(),
            canClinical = clinical
        });
    }

    // ------------------------------------------------------------------ appointments

    private static bool TryStart(string? s, out DateTime dt)
        => DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out dt);

    [HttpPost("appointments")]
    public async Task<IActionResult> Book([FromBody] JsonObject b)
    {
        if (!await Has("hos.appointments.manage")) return Forbid();
        var tenantId = await Tid();
        var patient = await ByCode(tenantId, "patient", S(b, "patient"));
        if (patient == null) return Bad("Choose the patient.");
        var doctor = await ByCode(tenantId, "doctor", S(b, "doctor"));
        if (doctor == null || doctor.Status == "Inactive") return Bad("Choose an active doctor.");
        if (!TryStart(S(b, "start"), out var start)) return Bad("The appointment time is not valid.");
        var minutes = (int)Math.Clamp(N(b, "minutes") == 0 ? (N(D(doctor), "slot") == 0 ? 20 : N(D(doctor), "slot")) : N(b, "minutes"), 5, 240);
        var end = start.AddMinutes(minutes);
        if (start < DateTime.UtcNow.AddHours(-14) && S(b, "walkin") != "true") return Bad("The appointment is in the past.");

        var dd = D(doctor);
        var days = A(dd, "days").Select(x => (int)N(new JsonObject { ["v"] = x?.DeepClone() }, "v")).ToList();
        if (days.Count > 0 && !days.Contains((int)start.DayOfWeek)) return Bad("The doctor does not work on this day.");
        var from = S(dd, "from"); var to = S(dd, "to");
        if (TimeSpan.TryParse(from, CultureInfo.InvariantCulture, out var tf) && TimeSpan.TryParse(to, CultureInfo.InvariantCulture, out var tt))
        {
            if (start.TimeOfDay < tf || end.TimeOfDay > tt) return Bad($"The doctor works {from} - {to}.");
        }
        var day = start.ToString("yyyy-MM-dd");
        var same = await _db.HosRecords.Where(r => r.TenantId == tenantId && r.Kind == "appointment" && r.Parent == doctor.Code && r.Ref == day && (r.Status == "Booked" || r.Status == "CheckedIn")).ToListAsync();
        foreach (var o in same)
        {
            var od = D(o);
            if (TryStart(S(od, "start"), out var os) && TryStart(S(od, "end"), out var oe) && start < oe && os < end)
                return Conflict(new { message = $"The doctor already has an appointment {os:HH:mm}-{oe:HH:mm} ({S(od, "patientName")}).", conflict = o.Code });
        }
        // the same patient cannot be in two places at once either
        var theirs = await _db.HosRecords.Where(r => r.TenantId == tenantId && r.Kind == "appointment" && r.Ref == day && (r.Status == "Booked" || r.Status == "CheckedIn")).ToListAsync();
        foreach (var o in theirs.Where(o => S(D(o), "patient") == patient.Code))
        {
            var od = D(o);
            if (TryStart(S(od, "start"), out var os) && TryStart(S(od, "end"), out var oe) && start < oe && os < end)
                return Conflict(new { message = $"The patient already has an appointment at {os:HH:mm} ({S(od, "doctorName")}).", conflict = o.Code });
        }
        var d = new JsonObject
        {
            ["patient"] = patient.Code, ["patientName"] = S(D(patient), "name"), ["doctor"] = doctor.Code, ["doctorName"] = S(dd, "name"),
            ["department"] = S(dd, "department"), ["start"] = start.ToString("yyyy-MM-ddTHH:mm"), ["end"] = end.ToString("yyyy-MM-ddTHH:mm"),
            ["minutes"] = minutes, ["reason"] = S(b, "reason"), ["phone"] = S(D(patient), "phone")
        };
        var rec = New(tenantId, "appointment", await NextCode(tenantId, "appointment", "APT"), "Booked", d, S(b, "branch"), doctor.Code, day);
        _db.HosRecords.Add(rec);
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(rec));
    }

    public class StatusBody { public string Status { get; set; } = string.Empty; public string? Note { get; set; } public string? Today { get; set; } }

    [HttpPost("appointments/{id}/status")]
    public async Task<IActionResult> AppointmentStatus(string id, [FromBody] StatusBody b)
    {
        if (!await Has("hos.appointments.manage")) return Forbid();
        var tenantId = await Tid();
        var a = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "appointment");
        if (a == null) return NotFound();
        if (a.Status is "Completed" or "Cancelled" or "NoShow") return Bad($"The appointment is already {a.Status}.");
        var d = D(a);
        if (b.Status == "CheckedIn")
        {
            if (a.Status != "Booked") return Bad("Only a booked appointment can be checked in.");
            var visit = await OpenVisit(tenantId, S(d, "patient"), S(d, "doctor"), "OPD", S(d, "reason"), a.Code, a.Branch, b.Today);
            if (visit.err != null) return Bad(visit.err);
            d["visit"] = visit.rec!.Code; a.Status = "CheckedIn"; Put(a, d);
            await _db.SaveChangesAsync();
            return Ok(new { appointment = HosRecordDto.From(a), visit = HosRecordDto.From(visit.rec!) });
        }
        if (b.Status is "Cancelled" or "NoShow")
        {
            if (a.Status == "CheckedIn") return Bad("The patient is already checked in.");
            a.Status = b.Status; d["note"] = b.Note ?? ""; Put(a, d);
            await _db.SaveChangesAsync();
            return Ok(HosRecordDto.From(a));
        }
        return Bad("Unknown status.");
    }

    // ------------------------------------------------------------------ visits (encounters)

    private async Task<(HosRecord? rec, string? err)> OpenVisit(string tenantId, string patientCode, string doctorCode, string type, string complaint, string? appointment, string? branch, string? today = null)
    {
        var patient = await ByCode(tenantId, "patient", patientCode);
        if (patient == null) return (null, "Choose the patient.");
        var doctor = await ByCode(tenantId, "doctor", doctorCode);
        if (doctor == null) return (null, "Choose the doctor.");
        if (patient.Status == "Deceased") return (null, "The patient file is closed (deceased).");
        var open = await Q(tenantId, "visit").FirstOrDefaultAsync(v => v.Parent == patientCode && v.Status == "Open" && v.Ref == doctorCode);
        if (open != null && type != "ER") return (null, $"The patient already has an open visit with this doctor ({open.Code}).");
        var day = LocalDay(today);
        var queue = await Q(tenantId, "visit").CountAsync(v => v.Ref == doctorCode && v.Data.Contains("\"day\":\"" + day + "\"")) + 1;
        var dd = D(doctor);
        var d = new JsonObject
        {
            ["patient"] = patientCode, ["patientName"] = S(D(patient), "name"), ["doctor"] = doctorCode, ["doctorName"] = S(dd, "name"), ["department"] = S(dd, "department"),
            ["type"] = type, ["day"] = day, ["queue"] = queue, ["complaint"] = complaint, ["appointment"] = appointment ?? "", ["startedAt"] = DateTime.UtcNow.ToString("o"),
            ["vitals"] = new JsonObject(), ["diagnoses"] = new JsonArray(), ["notes"] = new JsonObject { ["s"] = "", ["o"] = "", ["a"] = "", ["p"] = "" }, ["services"] = new JsonArray()
        };
        var rec = New(tenantId, "visit", await NextCode(tenantId, "visit", "VIS"), "Open", d, branch, patientCode, doctorCode);
        _db.HosRecords.Add(rec);
        await Audit(tenantId, patientCode, $"visit {rec.Code} opened");
        return (rec, null);
    }

    [HttpPost("visits")]
    public async Task<IActionResult> StartVisit([FromBody] JsonObject b)
    {
        if (!await HasAny("hos.appointments.manage", "hos.clinical.manage")) return Forbid();
        var tenantId = await Tid();
        var type = S(b, "type") is "ER" or "IPD" ? S(b, "type") : "OPD";
        var v = await OpenVisit(tenantId, S(b, "patient"), S(b, "doctor"), type, S(b, "complaint"), null, S(b, "branch"), S(b, "today"));
        if (v.err != null) return Bad(v.err);
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(v.rec!));
    }

    [HttpPut("visits/{id}")]
    public async Task<IActionResult> UpdateVisit(string id, [FromBody] JsonObject b)
    {
        if (!await Has("hos.clinical.manage")) return Forbid();
        var tenantId = await Tid();
        var v = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "visit");
        if (v == null) return NotFound();
        if (v.Status != "Open") return Bad("A closed visit cannot be changed.");
        var d = D(v);
        if (b.ContainsKey("complaint")) d["complaint"] = S(b, "complaint");
        if (b.ContainsKey("vitals") && b["vitals"] is JsonObject vit)
        {   // plausibility: a typo like temperature 370 must not become part of the record
            string? bad = null;
            void Range(string k, decimal lo, decimal hi, string label) { var x = NN(vit, k); if (x != null && (x < lo || x > hi)) bad ??= $"{label} looks wrong ({x})."; }
            Range("temp", 25, 45, "Temperature"); Range("pulse", 20, 300, "Pulse"); Range("spo2", 30, 100, "SpO2"); Range("rr", 3, 80, "Respiratory rate");
            Range("weight", 0.3m, 500, "Weight"); Range("height", 20, 260, "Height"); Range("sys", 40, 300, "Systolic pressure"); Range("dia", 20, 200, "Diastolic pressure");
            if (bad != null) return Bad(bad);
            vit["by"] = Username; vit["at"] = DateTime.UtcNow.ToString("o");
            d["vitals"] = vit.DeepClone();
        }
        if (b.ContainsKey("diagnoses") && b["diagnoses"] is JsonArray dx) d["diagnoses"] = dx.DeepClone();
        if (b.ContainsKey("notes") && b["notes"] is JsonObject nt) d["notes"] = nt.DeepClone();
        Put(v, d);
        await Audit(tenantId, v.Parent ?? "", $"visit {v.Code} updated");
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(v));
    }

    /// <summary>Adds a priced service (procedure, dressing, ...) to the visit; the price is the one in the price list at this moment.</summary>
    [HttpPost("visits/{id}/services")]
    public async Task<IActionResult> AddService(string id, [FromBody] JsonObject b)
    {
        if (!await Has("hos.clinical.manage")) return Forbid();
        var tenantId = await Tid();
        var v = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "visit");
        if (v == null) return NotFound();
        if (v.Status != "Open") return Bad("The visit is closed.");
        var svc = await ByCode(tenantId, "service", S(b, "service"));
        if (svc == null) return Bad("Unknown service.");
        var qty = Math.Clamp(N(b, "qty") == 0 ? 1 : N(b, "qty"), 1, 1000);
        var d = D(v); var arr = A(d, "services");
        arr.Add(new JsonObject { ["code"] = svc.Code, ["name"] = S(D(svc), "name"), ["qty"] = qty, ["price"] = N(D(svc), "price"), ["by"] = Username });
        d["services"] = arr; Put(v, d);
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(v));
    }

    [HttpPost("visits/{id}/close")]
    public async Task<IActionResult> CloseVisit(string id)
    {
        if (!await Has("hos.clinical.manage")) return Forbid();
        var tenantId = await Tid();
        var v = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "visit");
        if (v == null) return NotFound();
        if (v.Status != "Open") return Bad("The visit is already closed.");
        if (await Q(tenantId, "admission").AnyAsync(a => a.Ref == v.Code && a.Status == "Admitted")) return Bad("The patient is still admitted. Discharge first.");
        var d = D(v);
        if (A(d, "diagnoses").Count == 0) return Bad("Add at least one diagnosis before closing the visit.");
        d["closedAt"] = DateTime.UtcNow.ToString("o"); d["closedBy"] = Username;
        v.Status = "Closed"; Put(v, d);
        if (!string.IsNullOrEmpty(S(d, "appointment")))
        {
            var ap = await ByCode(tenantId, "appointment", S(d, "appointment"));
            if (ap != null && ap.Status == "CheckedIn") ap.Status = "Completed";
        }
        var inv = await BuildInvoice(tenantId, v);
        await _db.SaveChangesAsync();
        return Ok(new { visit = HosRecordDto.From(v), invoice = HosRecordDto.From(inv) });
    }

    // ------------------------------------------------------------------ prescriptions (allergy + interaction checks)

    private static bool NameHit(string allergy, JsonObject drug)
    {
        var a = allergy.Trim().ToLowerInvariant();
        if (a == "") return false;
        return new[] { S(drug, "name"), S(drug, "brand"), S(drug, "class") }.Any(x => x != "" && (x.ToLowerInvariant().Contains(a) || a.Contains(x.ToLowerInvariant())));
    }

    [HttpPost("visits/{id}/prescriptions")]
    public async Task<IActionResult> Prescribe(string id, [FromBody] JsonObject b)
    {
        if (!await Has("hos.prescribe")) return Forbid();
        var tenantId = await Tid();
        var v = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "visit");
        if (v == null) return NotFound();
        if (v.Status != "Open") return Bad("The visit is closed.");
        var patient = await ByCode(tenantId, "patient", v.Parent);
        if (patient == null) return Bad("Patient file not found.");
        var pd = D(patient);
        var allergies = Strs(pd, "allergies");
        var items = A(b, "items");
        if (items.Count == 0) return Bad("Add at least one medicine.");

        var outItems = new JsonArray(); var warnings = new List<string>(); var chosen = new List<(string code, JsonObject d)>();
        foreach (var it in items.OfType<JsonObject>())
        {
            var drug = await ByCode(tenantId, "drug", S(it, "drug"));
            if (drug == null || drug.Status == "Inactive") return Bad($"Unknown medicine '{S(it, "drug")}'.");
            var dd = D(drug);
            var days = N(it, "days"); var qty = N(it, "qty");
            if (qty <= 0) return Bad($"Quantity of {S(dd, "name")} must be more than zero.");
            if (qty > 1000) return Bad($"Quantity of {S(dd, "name")} is too large.");
            if (S(it, "dose") == "" || S(it, "frequency") == "") return Bad($"Dose and frequency of {S(dd, "name")} are required.");
            foreach (var al in allergies.Where(a => NameHit(a, dd))) warnings.Add($"ALLERGY: patient is allergic to '{al}' - {S(dd, "name")}.");
            chosen.Add((drug.Code!, dd));
            outItems.Add(new JsonObject
            {
                ["drug"] = drug.Code, ["name"] = S(dd, "name"), ["strength"] = S(dd, "strength"), ["form"] = S(dd, "form"),
                ["dose"] = S(it, "dose"), ["frequency"] = S(it, "frequency"), ["days"] = days, ["qty"] = qty, ["dispensed"] = 0, ["instructions"] = S(it, "instructions")
            });
        }
        // interactions: inside this prescription and against medicines still being taken (prescribed in the last 30 days and not cancelled)
        var active = new List<(string name, JsonObject d)>();
        var recent = await Q(tenantId, "prescription").Where(p => p.Ref == patient.Code && p.Status != "Cancelled" && p.CreatedAt >= DateTime.UtcNow.AddDays(-30)).ToListAsync();
        foreach (var rx in recent)
            foreach (var it in A(D(rx), "items").OfType<JsonObject>())
            {
                var dr = await ByCode(tenantId, "drug", S(it, "drug"));
                if (dr != null) active.Add((S(D(dr), "name"), D(dr)));
            }
        foreach (var (code, dd) in chosen)
        {
            var inter = Strs(dd, "interactsWith").Select(x => x.ToLowerInvariant()).ToList();
            foreach (var other in chosen.Where(o => o.code != code).Concat(active.Select(a => ("", a.d))))
            {
                var on = S(other.Item2, "name").ToLowerInvariant();
                var oc = S(other.Item2, "class").ToLowerInvariant();
                var back = Strs(other.Item2, "interactsWith").Select(x => x.ToLowerInvariant());
                if (on != "" && (inter.Contains(on) || (oc != "" && inter.Contains(oc)) || back.Contains(S(dd, "name").ToLowerInvariant()) || back.Contains(S(dd, "class").ToLowerInvariant())))
                    warnings.Add($"INTERACTION: {S(dd, "name")} with {S(other.Item2, "name")}.");
            }
            if (Strs(dd, "contraindications").Any(c => A(pd, "conditions").Select(x => x?.ToString()?.ToLowerInvariant() ?? "").Contains(c.ToLowerInvariant())))
                warnings.Add($"CONTRAINDICATION: {S(dd, "name")} is contraindicated by a condition of the patient.");
        }
        warnings = warnings.Distinct().ToList();
        var reason = Clean(S(b, "overrideReason"));
        if (warnings.Count > 0 && (reason == null || reason.Length < 5))
            return Conflict(new { message = "Safety warnings were found. Review them, or enter a reason to prescribe anyway.", warnings });

        var d = new JsonObject
        {
            ["patient"] = patient.Code, ["patientName"] = S(pd, "name"), ["visit"] = v.Code, ["doctor"] = S(D(v), "doctor"), ["doctorName"] = S(D(v), "doctorName"),
            ["items"] = outItems, ["warnings"] = new JsonArray(warnings.Select(w => (JsonNode?)JsonValue.Create(w)).ToArray()),
            ["overrideReason"] = warnings.Count > 0 ? reason : "", ["prescribedBy"] = Username
        };
        var rec = New(tenantId, "prescription", await NextCode(tenantId, "prescription", "RX"), "Pending", d, v.Branch, v.Code, patient.Code);
        _db.HosRecords.Add(rec);
        await Audit(tenantId, patient.Code!, $"prescription {rec.Code}" + (warnings.Count > 0 ? " (warnings overridden)" : ""));
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(rec));
    }

    [HttpPost("prescriptions/{id}/cancel")]
    public async Task<IActionResult> CancelRx(string id)
    {
        if (!await Has("hos.prescribe")) return Forbid();
        var tenantId = await Tid();
        var rx = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "prescription");
        if (rx == null) return NotFound();
        if (rx.Status != "Pending") return Bad("Only a prescription that was not dispensed can be cancelled.");
        rx.Status = "Cancelled"; rx.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(rx));
    }

    /// <summary>The pharmacy dispenses what is in stock. With allowPartial the available quantity is given and the prescription stays open for the rest.</summary>
    [HttpPost("prescriptions/{id}/dispense")]
    public async Task<IActionResult> Dispense(string id, [FromBody] JsonObject? b)
    {
        if (!await Has("hos.pharmacy.dispense")) return Forbid();
        var tenantId = await Tid();
        var rx = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "prescription");
        if (rx == null) return NotFound();
        if (rx.Status is "Dispensed" or "Cancelled") return Bad($"The prescription is {rx.Status}.");
        var allowPartial = b != null && S(b, "allowPartial") == "true";
        var d = D(rx); var items = A(d, "items");
        var plan = new List<(JsonObject item, HosRecord drug, decimal give)>();
        var short_ = new List<string>();
        foreach (var it in items.OfType<JsonObject>())
        {
            var need = N(it, "qty") - N(it, "dispensed");
            if (need <= 0) continue;
            var drug = await ByCode(tenantId, "drug", S(it, "drug"));
            if (drug == null) { short_.Add($"{S(it, "name")} (not in the formulary)"); continue; }
            var stock = N(D(drug), "stock");
            var give = Math.Min(need, Math.Max(0, stock));
            if (give < need) short_.Add($"{S(it, "name")}: need {need}, in stock {stock}");
            plan.Add((it, drug, give));
        }
        if (short_.Count > 0 && !allowPartial) return Conflict(new { message = "Not enough stock for: " + string.Join("; ", short_), shortages = short_ });
        if (plan.All(p => p.give <= 0)) return Bad("Nothing can be dispensed.");
        foreach (var (item, drug, give) in plan.Where(p => p.give > 0))
        {
            var dd = D(drug); var bal = N(dd, "stock") - give; dd["stock"] = bal; Put(drug, dd);
            item["dispensed"] = N(item, "dispensed") + give;
            _db.HosRecords.Add(New(tenantId, "drugmove", await NextCode(tenantId, "drugmove", "DM", false), "Posted",
                new JsonObject { ["delta"] = -give, ["balance"] = bal, ["reason"] = "dispensed", ["ref"] = rx.Code, ["by"] = Username }, rx.Branch, drug.Code, rx.Code));
        }
        var all = items.OfType<JsonObject>().All(i => N(i, "dispensed") >= N(i, "qty"));
        rx.Status = all ? "Dispensed" : "Partial"; d["dispensedBy"] = Username; d["dispensedAt"] = DateTime.UtcNow.ToString("o"); Put(rx, d);
        // the invoice of the visit follows what was really given
        var visit = await ByCode(tenantId, "visit", rx.Parent);
        if (visit != null) await BuildInvoice(tenantId, visit);
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(rx));
    }

    public class StockBody { public decimal Delta { get; set; } public string? Reason { get; set; } public string? Batch { get; set; } public string? Expiry { get; set; } }

    [HttpPost("drugs/{id}/stock")]
    public async Task<IActionResult> Stock(string id, [FromBody] StockBody b)
    {
        if (!await Has("hos.pharmacy.stock")) return Forbid();
        if (b.Delta == 0) return Bad("Enter the quantity.");
        if (string.IsNullOrWhiteSpace(b.Reason)) return Bad("Give the reason (purchase, damage, count ...).");
        var tenantId = await Tid();
        var drug = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "drug");
        if (drug == null) return NotFound();
        var d = D(drug); var bal = N(d, "stock") + b.Delta;
        if (bal < 0) return Bad($"Stock cannot go below zero (now {N(d, "stock")}).");
        d["stock"] = bal;
        if (b.Delta > 0 && !string.IsNullOrWhiteSpace(b.Expiry)) d["expiry"] = b.Expiry;
        Put(drug, d);
        _db.HosRecords.Add(New(tenantId, "drugmove", await NextCode(tenantId, "drugmove", "DM", false), "Posted",
            new JsonObject { ["delta"] = b.Delta, ["balance"] = bal, ["reason"] = b.Reason, ["batch"] = b.Batch ?? "", ["expiry"] = b.Expiry ?? "", ["by"] = Username }, drug.Branch, drug.Code));
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(drug));
    }

    // ------------------------------------------------------------------ laboratory

    [HttpPost("visits/{id}/labs")]
    public async Task<IActionResult> OrderLabs(string id, [FromBody] JsonObject b)
    {
        if (!await Has("hos.lab.order")) return Forbid();
        var tenantId = await Tid();
        var v = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "visit");
        if (v == null) return NotFound();
        if (v.Status != "Open") return Bad("The visit is closed.");
        var tests = Strs(b, "tests").Distinct().ToList();
        if (tests.Count == 0) return Bad("Choose at least one test.");
        var created = new List<HosRecord>();
        foreach (var tc in tests)
        {
            var t = await ByCode(tenantId, "labtest", tc);
            if (t == null) return Bad($"Unknown test '{tc}'.");
            var td = D(t);
            var dup = await Q(tenantId, "labrequest").AnyAsync(l => l.Parent == v.Code && l.Status == "Ordered" && l.Data.Contains("\"test\":\"" + tc + "\""));
            if (dup) continue;   // not ordered twice while the first is still waiting
            var d = new JsonObject
            {
                ["patient"] = v.Parent, ["patientName"] = S(D(v), "patientName"), ["visit"] = v.Code, ["test"] = tc, ["name"] = S(td, "name"), ["unit"] = S(td, "unit"),
                ["price"] = N(td, "price"), ["sample"] = S(td, "sample"), ["urgent"] = S(b, "urgent") == "true", ["orderedBy"] = Username
            };
            var rec = New(tenantId, "labrequest", await NextCode(tenantId, "labrequest", "LAB"), "Ordered", d, v.Branch, v.Code, v.Parent);
            _db.HosRecords.Add(rec); created.Add(rec);
        }
        await _db.SaveChangesAsync();
        return Ok(created.Select(HosRecordDto.From));
    }

    [HttpPost("labrequests/{id}/result")]
    public async Task<IActionResult> LabResult(string id, [FromBody] JsonObject b)
    {
        if (!await Has("hos.lab.result")) return Forbid();
        var tenantId = await Tid();
        var l = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "labrequest");
        if (l == null) return NotFound();
        if (l.Status == "Cancelled") return Bad("The request was cancelled.");
        if (l.Status == "Resulted" && S(b, "amend") != "true") return Bad("A released result is not edited. Send it as an amendment.");
        var d = D(l);
        var test = await ByCode(tenantId, "labtest", S(d, "test"));
        var td = test != null ? D(test) : new JsonObject();
        var raw = S(b, "value").Trim();
        if (raw == "") return Bad("Enter the result.");
        string flag = "Normal";
        if (decimal.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var val))
        {
            var low = NN(td, "low"); var high = NN(td, "high"); var cl = NN(td, "critLow"); var ch = NN(td, "critHigh");
            if (cl != null && val <= cl) flag = "Critical low";
            else if (ch != null && val >= ch) flag = "Critical high";
            else if (low != null && val < low) flag = "Low";
            else if (high != null && val > high) flag = "High";
        }
        if (l.Status == "Resulted") { var hist = A(d, "history"); hist.Add(new JsonObject { ["value"] = S(d, "value"), ["flag"] = S(d, "flag"), ["by"] = S(d, "resultedBy"), ["at"] = S(d, "resultedAt") }); d["history"] = hist; }
        d["value"] = raw; d["flag"] = flag; d["note"] = S(b, "note");
        d["range"] = test != null && (NN(td, "low") != null || NN(td, "high") != null) ? $"{S(td, "low")} - {S(td, "high")} {S(td, "unit")}" : "";
        d["resultedBy"] = Username; d["resultedAt"] = DateTime.UtcNow.ToString("o");
        l.Status = "Resulted"; Put(l, d);
        var v = await ByCode(tenantId, "visit", l.Parent);
        if (v != null) await BuildInvoice(tenantId, v);
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(l));
    }

    // ------------------------------------------------------------------ wards, beds and admissions

    [HttpPost("admissions")]
    public async Task<IActionResult> Admit([FromBody] JsonObject b)
    {
        if (!await Has("hos.wards.manage")) return Forbid();
        var tenantId = await Tid();
        var patient = await ByCode(tenantId, "patient", S(b, "patient"));
        if (patient == null) return Bad("Choose the patient.");
        if (patient.Status == "Deceased") return Bad("The patient file is closed.");
        if (await Q(tenantId, "admission").AnyAsync(a => a.Parent == patient.Code && a.Status == "Admitted")) return Bad("The patient is already admitted.");
        var bed = await ByCode(tenantId, "bed", S(b, "bed"));
        if (bed == null) return Bad("Choose a bed.");
        if (bed.Status != "Available") return Conflict(new { message = $"Bed {bed.Code} is {bed.Status}." });
        var ward = await ByCode(tenantId, "ward", bed.Parent);
        var wd = ward != null ? D(ward) : new JsonObject();
        var visit = await ByCode(tenantId, "visit", S(b, "visit"));
        if (visit == null) visit = await Q(tenantId, "visit").FirstOrDefaultAsync(x => x.Parent == patient.Code && x.Status == "Open");
        if (visit == null)
        {   // an admission always belongs to a visit (that is what the invoice is built from)
            var doc = S(b, "doctor");
            var nv = await OpenVisit(tenantId, patient.Code!, doc, "IPD", S(b, "reason"), null, bed.Branch);
            if (nv.err != null) return Bad(nv.err);
            visit = nv.rec;
        }
        var d = new JsonObject
        {
            ["patient"] = patient.Code, ["patientName"] = S(D(patient), "name"), ["visit"] = visit!.Code, ["ward"] = bed.Parent, ["wardName"] = S(wd, "name"), ["bed"] = bed.Code,
            ["doctor"] = S(b, "doctor") != "" ? S(b, "doctor") : S(D(visit), "doctor"), ["reason"] = S(b, "reason"), ["dailyRate"] = N(wd, "rate"),
            ["admittedAt"] = DateTime.UtcNow.ToString("o"), ["transfers"] = new JsonArray()
        };
        var rec = New(tenantId, "admission", await NextCode(tenantId, "admission", "ADM"), "Admitted", d, bed.Branch, patient.Code, visit.Code);
        _db.HosRecords.Add(rec);
        var bd = D(bed); bd["admission"] = rec.Code; bd["patient"] = patient.Code; bd["patientName"] = S(D(patient), "name"); Put(bed, bd); bed.Status = "Occupied";
        await Audit(tenantId, patient.Code!, $"admitted to {bed.Code}");
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(rec));
    }

    private static decimal BedDays(JsonObject ad, DateTime? to = null)
    {
        if (!DateTime.TryParse(S(ad, "admittedAt"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var from)) return 1;
        var end = to ?? (DateTime.TryParse(S(ad, "dischargedAt"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dd) ? dd : DateTime.UtcNow);
        return Math.Max(1, Math.Ceiling((decimal)(end - from).TotalDays));   // every started day is charged, minimum one
    }

    [HttpPost("admissions/{id}/transfer")]
    public async Task<IActionResult> Transfer(string id, [FromBody] JsonObject b)
    {
        if (!await Has("hos.wards.manage")) return Forbid();
        var tenantId = await Tid();
        var a = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "admission");
        if (a == null) return NotFound();
        if (a.Status != "Admitted") return Bad("The patient is not admitted.");
        var to = await ByCode(tenantId, "bed", S(b, "bed"));
        if (to == null) return Bad("Choose a bed.");
        if (to.Status != "Available") return Conflict(new { message = $"Bed {to.Code} is {to.Status}." });
        var d = D(a);
        var from = await ByCode(tenantId, "bed", S(d, "bed"));
        if (from != null) { var fd = D(from); fd.Remove("admission"); fd.Remove("patient"); fd.Remove("patientName"); Put(from, fd); from.Status = "Available"; }
        var ward = await ByCode(tenantId, "ward", to.Parent); var wd = ward != null ? D(ward) : new JsonObject();
        // days in the previous bed are kept at the previous rate
        var tr = A(d, "transfers");
        tr.Add(new JsonObject { ["from"] = S(d, "bed"), ["ward"] = S(d, "ward"), ["rate"] = N(d, "dailyRate"), ["at"] = DateTime.UtcNow.ToString("o"), ["since"] = S(d, "sinceAt") != "" ? S(d, "sinceAt") : S(d, "admittedAt") });
        d["transfers"] = tr; d["sinceAt"] = DateTime.UtcNow.ToString("o");
        d["bed"] = to.Code; d["ward"] = to.Parent; d["wardName"] = S(wd, "name"); d["dailyRate"] = N(wd, "rate");
        Put(a, d);
        var td = D(to); td["admission"] = a.Code; td["patient"] = S(d, "patient"); td["patientName"] = S(d, "patientName"); Put(to, td); to.Status = "Occupied";
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(a));
    }

    [HttpPost("admissions/{id}/discharge")]
    public async Task<IActionResult> Discharge(string id, [FromBody] JsonObject b)
    {
        if (!await HasAny("hos.wards.manage", "hos.clinical.manage")) return Forbid();
        var tenantId = await Tid();
        var a = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "admission");
        if (a == null) return NotFound();
        if (a.Status != "Admitted") return Bad("The patient is not admitted.");
        var d = D(a);
        if (S(b, "summary").Trim().Length < 5) return Bad("Write the discharge summary.");
        var now = DateTime.UtcNow;
        var bed = await ByCode(tenantId, "bed", S(d, "bed"));
        if (bed != null) { var bd = D(bed); bd.Remove("admission"); bd.Remove("patient"); bd.Remove("patientName"); Put(bed, bd); bed.Status = "Available"; }
        d["dischargedAt"] = now.ToString("o"); d["summary"] = S(b, "summary"); d["outcome"] = S(b, "outcome") == "" ? "Recovered" : S(b, "outcome"); d["dischargedBy"] = Username;
        d["days"] = BedDays(d, now);
        a.Status = "Discharged"; Put(a, d);
        if (S(d, "outcome") == "Deceased")
        {
            var p = await ByCode(tenantId, "patient", a.Parent); if (p != null) p.Status = "Deceased";
        }
        var v = await ByCode(tenantId, "visit", a.Ref);
        if (v != null) await BuildInvoice(tenantId, v);
        await Audit(tenantId, a.Parent ?? "", $"discharged ({S(d, "outcome")})");
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(a));
    }

    // ------------------------------------------------------------------ billing

    /// <summary>(Re)builds the invoice of a visit from what happened in it. Payments already taken are kept.</summary>
    private async Task<HosRecord> BuildInvoice(string tenantId, HosRecord visit)
    {
        var vd = D(visit);
        var lines = new JsonArray();
        decimal gross = 0;
        void Add(string type, string desc, decimal qty, decimal price)
        {
            var amt = R2(qty * price);
            if (amt == 0 && type != "consult") return;
            lines.Add(new JsonObject { ["type"] = type, ["desc"] = desc, ["qty"] = qty, ["price"] = price, ["amount"] = amt }); gross += amt;
        }
        var doctor = await ByCode(tenantId, "doctor", S(vd, "doctor"));
        var fee = doctor != null ? N(D(doctor), "fee") : 0;
        if (fee == 0) { var cs = await ByCode(tenantId, "service", "CONSULT"); if (cs != null) fee = N(D(cs), "price"); }
        if (S(vd, "type") != "IPD") Add("consult", "Consultation - " + S(vd, "doctorName"), 1, fee);
        foreach (var s in A(vd, "services").OfType<JsonObject>()) Add("service", S(s, "name"), N(s, "qty"), N(s, "price"));
        foreach (var l in await Q(tenantId, "labrequest").Where(x => x.Parent == visit.Code && x.Status != "Cancelled").ToListAsync())
        { var ld = D(l); Add("lab", S(ld, "name"), 1, N(ld, "price")); }
        foreach (var rx in await Q(tenantId, "prescription").Where(x => x.Parent == visit.Code && x.Status != "Cancelled").ToListAsync())
            foreach (var it in A(D(rx), "items").OfType<JsonObject>().Where(i => N(i, "dispensed") > 0))
            {
                var drug = await ByCode(tenantId, "drug", S(it, "drug"));
                Add("drug", S(it, "name") + " " + S(it, "strength"), N(it, "dispensed"), drug != null ? N(D(drug), "price") : 0);
            }
        foreach (var ad in await Q(tenantId, "admission").Where(x => x.Ref == visit.Code).ToListAsync())
        {
            var adm = D(ad);
            foreach (var tr in A(adm, "transfers").OfType<JsonObject>())
            {
                if (DateTime.TryParse(S(tr, "since"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var sf) && DateTime.TryParse(S(tr, "at"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var st))
                    Add("bed", $"Bed {S(tr, "from")} ({S(tr, "ward")})", Math.Max(1, Math.Ceiling((decimal)(st - sf).TotalDays)), N(tr, "rate"));
            }
            var sinceTxt = S(adm, "sinceAt");
            var fromD = DateTime.TryParse(sinceTxt != "" ? sinceTxt : S(adm, "admittedAt"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var f0) ? f0 : DateTime.UtcNow;
            var endD = DateTime.TryParse(S(adm, "dischargedAt"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var e0) ? e0 : DateTime.UtcNow;
            Add("bed", $"Bed {S(adm, "bed")} ({S(adm, "wardName")})", Math.Max(1, Math.Ceiling((decimal)(endD - fromD).TotalDays)), N(adm, "dailyRate"));
        }
        gross = R2(gross);
        var cfg = await Cfg(tenantId);
        var taxPct = Math.Clamp(N(cfg, "taxPct"), 0, 100);
        var exempt = Strs(cfg, "taxExemptTypes");   // line types that carry no tax in this country (e.g. consult, lab)
        var taxable = lines.OfType<JsonObject>().Where(l => !exempt.Contains(S(l, "type"))).Sum(l => N(l, "amount"));
        var tax = R2(taxable * taxPct / 100m);
        var total = R2(gross + tax);

        var patient = await ByCode(tenantId, "patient", visit.Parent);
        var ins = patient != null ? Obj(D(patient), "insurance") : new JsonObject();
        decimal pct = 0; string insName = "";
        if (S(ins, "company") != "" && N(ins, "coveragePct") > 0)
        {
            var until = S(ins, "validUntil");
            if (until == "" || (DateTime.TryParse(until, CultureInfo.InvariantCulture, DateTimeStyles.None, out var u) && u.ToString("yyyy-MM-dd").CompareTo(S(vd, "day") != "" ? S(vd, "day") : ClientClock.Today.ToString("yyyy-MM-dd")) >= 0)) { pct = Math.Min(100, N(ins, "coveragePct")); insName = S(ins, "company"); }
        }
        var insurance = R2(total * pct / 100m);
        var due = R2(total - insurance);

        var inv = await Q(tenantId, "invoice").FirstOrDefaultAsync(i => i.Parent == visit.Code && i.Status != "Cancelled");
        JsonObject id;
        if (inv == null)
        {
            id = new JsonObject { ["patient"] = visit.Parent, ["patientName"] = S(vd, "patientName"), ["visit"] = visit.Code, ["payments"] = new JsonArray(), ["paid"] = 0 };
            inv = New(tenantId, "invoice", await NextCode(tenantId, "invoice", "INV"), "Unpaid", id, visit.Branch, visit.Code, visit.Parent);
            _db.HosRecords.Add(inv);
        }
        else id = D(inv);
        var paid = R2(A(id, "payments").OfType<JsonObject>().Sum(p => N(p, "amount")));
        id["lines"] = lines; id["gross"] = gross; id["taxName"] = S(cfg, "taxName"); id["taxPct"] = taxPct; id["tax"] = tax; id["total"] = total; id["insuranceName"] = insName; id["insurancePct"] = pct; id["insurance"] = insurance; id["due"] = due;
        id["paid"] = paid; id["balance"] = R2(due - paid);
        inv.Status = due <= 0 ? (total > 0 ? "Paid" : "Unpaid")   // fully covered by insurance = nothing left to collect
                   : paid >= due ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
        Put(inv, id);
        return inv;
    }

    [HttpPost("visits/{id}/invoice")]
    public async Task<IActionResult> RebuildInvoice(string id)
    {
        if (!await HasAny("hos.billing.manage", "hos.clinical.manage")) return Forbid();
        var tenantId = await Tid();
        var v = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "visit");
        if (v == null) return NotFound();
        var inv = await BuildInvoice(tenantId, v);
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(inv));
    }

    [HttpPost("invoices/{id}/pay")]
    public async Task<IActionResult> Pay(string id, [FromBody] JsonObject b)
    {
        if (!await Has("hos.billing.manage")) return Forbid();
        var tenantId = await Tid();
        var inv = await _db.HosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "invoice");
        if (inv == null) return NotFound();
        if (inv.Status == "Cancelled") return Bad("The invoice is cancelled.");
        var d = D(inv);
        var amount = R2(N(b, "amount"));
        var balance = R2(N(d, "due") - N(d, "paid"));
        if (amount <= 0) return Bad("Enter the amount.");
        if (amount > balance) return Bad($"The amount is more than the balance ({balance}).");
        var cfg = await Cfg(tenantId);
        var allowed = Strs(cfg, "paymentMethods"); if (allowed.Count == 0) allowed = DefaultMethods.ToList();
        var method = allowed.FirstOrDefault(x => string.Equals(x, S(b, "method"), StringComparison.OrdinalIgnoreCase));
        if (method == null) return Bad("This payment method is not enabled.");
        var pays = A(d, "payments");
        pays.Add(new JsonObject { ["at"] = DateTime.UtcNow.ToString("o"), ["method"] = method, ["amount"] = amount, ["ref"] = S(b, "ref"), ["by"] = Username });
        d["payments"] = pays; d["paid"] = R2(N(d, "paid") + amount); d["balance"] = R2(N(d, "due") - N(d, "paid"));
        inv.Status = N(d, "balance") <= 0 ? "Paid" : "Partial";
        Put(inv, d);
        await _db.SaveChangesAsync();
        return Ok(HosRecordDto.From(inv));
    }

    // ------------------------------------------------------------------ dashboard

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard([FromQuery] string? today = null, [FromQuery] int tz = 0)
    {
        if (!await HasAny("hos.view", "hos.reports.view", "hos.clinical.view", "hos.appointments.view")) return Forbid();
        var tenantId = await Tid();
        tz = Math.Clamp(tz, -840, 840);   // minutes east of UTC of the person looking at the screen
        var todayS = LocalDay(today);
        var todayD = DateTime.ParseExact(todayS, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var since = todayD.AddDays(-6);
        var sinceUtc = since.AddMinutes(-tz);
        var recs = await _db.HosRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind != "audit" && r.Kind != "drugmove" &&
            (r.Kind == "bed" || r.Kind == "drug" || r.Kind == "patient" || r.CreatedAt >= sinceUtc || r.Status == "Open" || r.Status == "Unpaid" || r.Status == "Partial" || r.UpdatedAt >= sinceUtc || r.Status == "Ordered" || r.Status == "Pending" || r.Status == "Partial" || r.Status == "Admitted" || r.Status == "Booked" || r.Status == "CheckedIn")).ToListAsync();
        var apps = recs.Where(r => r.Kind == "appointment" && r.Ref == todayS).ToList();
        var beds = recs.Where(r => r.Kind == "bed").ToList();
        var bedsTotal = beds.Count(b => b.Status != "Maintenance");
        var occupied = beds.Count(b => b.Status == "Occupied");
        var invoices = recs.Where(r => r.Kind == "invoice" && r.Status != "Cancelled").ToList();
        decimal revenueToday = 0, revenueWeek = 0, outstanding = 0;
        foreach (var i in invoices)
        {
            var d = D(i);
            foreach (var p in A(d, "payments").OfType<JsonObject>())
                if (DateTime.TryParse(S(p, "at"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at))
                { var local = at.ToUniversalTime().AddMinutes(tz); if (local.Date == todayD) revenueToday += N(p, "amount"); if (local.Date >= since) revenueWeek += N(p, "amount"); }
            outstanding += Math.Max(0, N(d, "due") - N(d, "paid"));
        }
        var lowStock = recs.Where(r => r.Kind == "drug" && r.Status != "Inactive").Select(r => (r, d: D(r))).Where(x => N(x.d, "stock") <= N(x.d, "reorder")).Select(x => new { code = x.r.Code, name = S(x.d, "name"), stock = N(x.d, "stock"), reorder = N(x.d, "reorder") }).Take(20).ToList();
        var days = Enumerable.Range(0, 7).Select(i => since.AddDays(i)).Select(dt => new
        {
            day = dt.ToString("yyyy-MM-dd"),
            visits = recs.Count(r => r.Kind == "visit" && r.CreatedAt.AddMinutes(tz).Date == dt.Date),
            appointments = recs.Count(r => r.Kind == "appointment" && r.Ref == dt.ToString("yyyy-MM-dd") && r.Status != "Cancelled")
        }).ToList();
        var dx = recs.Where(r => r.Kind == "visit" && r.CreatedAt >= sinceUtc).SelectMany(r => A(D(r), "diagnoses").OfType<JsonObject>().Select(x => S(x, "name"))).Where(x => x != "")
            .GroupBy(x => x).OrderByDescending(g => g.Count()).Take(5).Select(g => new { name = g.Key, count = g.Count() }).ToList();
        return Ok(new
        {
            patients = recs.Count(r => r.Kind == "patient" && r.Status != "Merged"),
            appointmentsToday = new { total = apps.Count, booked = apps.Count(a => a.Status == "Booked"), checkedIn = apps.Count(a => a.Status == "CheckedIn"), completed = apps.Count(a => a.Status == "Completed"), cancelled = apps.Count(a => a.Status is "Cancelled" or "NoShow") },
            openVisits = recs.Count(r => r.Kind == "visit" && r.Status == "Open"),
            admitted = recs.Count(r => r.Kind == "admission" && r.Status == "Admitted"),
            beds = new { total = bedsTotal, occupied, available = beds.Count(b => b.Status == "Available"), maintenance = beds.Count(b => b.Status == "Maintenance"), occupancyPct = bedsTotal == 0 ? 0 : Math.Round(100m * occupied / bedsTotal, 1) },
            pendingLabs = recs.Count(r => r.Kind == "labrequest" && r.Status == "Ordered"),
            pendingRx = recs.Count(r => r.Kind == "prescription" && r.Status is "Pending" or "Partial"),
            revenueToday = R2(revenueToday), revenueWeek = R2(revenueWeek), outstanding = R2(outstanding),
            lowStock, days, topDiagnoses = dx
        });
    }

    // ------------------------------------------------------------------ demo data

    /// <summary>Fills an empty hospital with a small working setup (departments, doctors, wards and beds, price list, formulary, lab catalogue, three patients).</summary>
    [HttpPost("seed-demo")]
    public async Task<IActionResult> SeedDemo([FromBody] JsonObject? b)
    {
        if (!await Has("hos.setup")) return Forbid();
        var tenantId = await Tid();
        if (await Q(tenantId, "department").AnyAsync()) return Bad("The hospital already has data.");
        void Add(string kind, string code, JsonObject d, string? parent = null, string status = "Active")
            => _db.HosRecords.Add(New(tenantId, kind, code, status, d, null, parent));
        // nothing here is tied to one country: the currency and the weekend come from the caller (the company's own settings)
        var currency = S(b ?? new JsonObject(), "currency"); if (currency == "") currency = "USD";
        var weekend = A(b ?? new JsonObject(), "weekend").Select(x => (int)N(new JsonObject { ["v"] = x?.DeepClone() }, "v")).ToList(); if (weekend.Count == 0) weekend = new List<int> { 0, 6 };
        JsonArray Work(params int[] only) => new(Enumerable.Range(0, 7).Where(d => !weekend.Contains(d) && (only.Length == 0 || only.Contains(d))).Select(d => (JsonNode?)JsonValue.Create(d)).ToArray());
        Add("setting", "main", new JsonObject { ["name"] = "General Hospital", ["currency"] = currency, ["taxName"] = "", ["taxPct"] = 0, ["paymentMethods"] = new JsonArray("cash", "card", "transfer", "other"), ["weekend"] = new JsonArray(weekend.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()) });
        foreach (var (c, n) in new[] { ("GEN", "General Medicine"), ("PED", "Pediatrics"), ("CAR", "Cardiology"), ("ER", "Emergency"), ("OBG", "Obstetrics & Gynecology") })
            Add("department", c, new JsonObject { ["name"] = n });
        var week = Work();
        Add("doctor", "DR-001", new JsonObject { ["name"] = "Dr. Sara Miller", ["department"] = "GEN", ["specialty"] = "Family medicine", ["fee"] = 150, ["days"] = week.DeepClone(), ["from"] = "08:00", ["to"] = "16:00", ["slot"] = 20 });
        Add("doctor", "DR-002", new JsonObject { ["name"] = "Dr. Omar Khan", ["department"] = "CAR", ["specialty"] = "Cardiologist", ["fee"] = 300, ["days"] = week.DeepClone(), ["from"] = "10:00", ["to"] = "18:00", ["slot"] = 30 });
        Add("doctor", "DR-003", new JsonObject { ["name"] = "Dr. Lina Rossi", ["department"] = "PED", ["specialty"] = "Pediatrician", ["fee"] = 180, ["days"] = week.DeepClone(), ["from"] = "09:00", ["to"] = "17:00", ["slot"] = 20 });
        Add("ward", "W1", new JsonObject { ["name"] = "General ward", ["rate"] = 250 });
        Add("ward", "ICU", new JsonObject { ["name"] = "Intensive care", ["rate"] = 1200 });
        Add("ward", "PV", new JsonObject { ["name"] = "Private rooms", ["rate"] = 600 });
        for (var i = 1; i <= 6; i++) Add("bed", $"W1-{i:00}", new JsonObject { ["label"] = $"Bed {i}" }, "W1", "Available");
        for (var i = 1; i <= 3; i++) Add("bed", $"ICU-{i:00}", new JsonObject { ["label"] = $"ICU {i}" }, "ICU", "Available");
        for (var i = 1; i <= 4; i++) Add("bed", $"PV-{i:00}", new JsonObject { ["label"] = $"Room {i}" }, "PV", "Available");
        Add("service", "CONSULT", new JsonObject { ["name"] = "Consultation", ["category"] = "consult", ["price"] = 150 });
        Add("service", "DRESS", new JsonObject { ["name"] = "Wound dressing", ["category"] = "procedure", ["price"] = 60 });
        Add("service", "INJ", new JsonObject { ["name"] = "Injection (administration)", ["category"] = "procedure", ["price"] = 25 });
        Add("service", "ECG", new JsonObject { ["name"] = "ECG", ["category"] = "procedure", ["price"] = 120 });
        Add("service", "XRAY-C", new JsonObject { ["name"] = "Chest X-ray", ["category"] = "imaging", ["price"] = 200 });
        Add("labtest", "HGB", new JsonObject { ["name"] = "Hemoglobin", ["unit"] = "g/dL", ["low"] = 12, ["high"] = 17, ["critLow"] = 7, ["critHigh"] = 20, ["price"] = 30, ["sample"] = "Blood" });
        Add("labtest", "GLU", new JsonObject { ["name"] = "Glucose (fasting)", ["unit"] = "mg/dL", ["low"] = 70, ["high"] = 100, ["critLow"] = 50, ["critHigh"] = 400, ["price"] = 25, ["sample"] = "Blood" });
        Add("labtest", "CREA", new JsonObject { ["name"] = "Creatinine", ["unit"] = "mg/dL", ["low"] = 0.6, ["high"] = 1.3, ["critHigh"] = 5, ["price"] = 40, ["sample"] = "Blood" });
        Add("labtest", "CHOL", new JsonObject { ["name"] = "Total cholesterol", ["unit"] = "mg/dL", ["high"] = 200, ["price"] = 45, ["sample"] = "Blood" });
        Add("labtest", "WBC", new JsonObject { ["name"] = "White blood cells", ["unit"] = "10^3/uL", ["low"] = 4, ["high"] = 11, ["critLow"] = 1, ["critHigh"] = 30, ["price"] = 30, ["sample"] = "Blood" });
        JsonObject Drug(string name, string cls, string strength, string form, decimal price, decimal stock, decimal reorder, params string[] inter)
            => new() { ["name"] = name, ["class"] = cls, ["strength"] = strength, ["form"] = form, ["price"] = price, ["stock"] = stock, ["reorder"] = reorder, ["interactsWith"] = new JsonArray(inter.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()) };
        Add("drug", "AMOX500", Drug("Amoxicillin", "penicillin", "500 mg", "Capsule", 1.5m, 400, 100));
        Add("drug", "PARA500", Drug("Paracetamol", "analgesic", "500 mg", "Tablet", 0.4m, 1000, 200));
        Add("drug", "IBU400", Drug("Ibuprofen", "nsaid", "400 mg", "Tablet", 0.8m, 600, 150, "Warfarin", "Aspirin"));
        Add("drug", "ASA100", Drug("Aspirin", "nsaid", "100 mg", "Tablet", 0.3m, 800, 150, "Warfarin", "Ibuprofen"));
        Add("drug", "WARF5", Drug("Warfarin", "anticoagulant", "5 mg", "Tablet", 1.2m, 120, 50, "Aspirin", "Ibuprofen"));
        Add("drug", "METF500", Drug("Metformin", "antidiabetic", "500 mg", "Tablet", 0.6m, 500, 100));
        Add("drug", "OMEP20", Drug("Omeprazole", "ppi", "20 mg", "Capsule", 1.1m, 80, 100));
        async Task Pat(string name, string sex, string dob, string phone, string[] allergies, string nid, JsonObject? ins)
        {
            var d = new JsonObject { ["name"] = name, ["sex"] = sex, ["dob"] = dob, ["phone"] = phone, ["nationalId"] = nid, ["allergies"] = new JsonArray(allergies.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()), ["conditions"] = new JsonArray() };
            if (ins != null) d["insurance"] = ins;
            var code = await NextCode(tenantId, "patient", "MRN", false);
            _db.HosRecords.Add(New(tenantId, "patient", code, "Active", d));
            await _db.SaveChangesAsync();
        }
        await _db.SaveChangesAsync();
        await Pat("John Carter", "M", "1985-04-12", "+1 555 0100", new[] { "penicillin" }, "ID-100001", new JsonObject { ["company"] = "Sample Insurance Co.", ["policyNo"] = "POL-7788", ["coveragePct"] = 80, ["validUntil"] = DateTime.UtcNow.AddYears(1).ToString("yyyy-MM-dd") });
        await Pat("Maria Santos", "F", "1992-09-30", "+1 555 0101", Array.Empty<string>(), "ID-100002", null);
        await Pat("Omar Ali", "M", "2018-02-02", "+1 555 0102", Array.Empty<string>(), "", null);
        return Ok(new { ok = true });
    }
}
