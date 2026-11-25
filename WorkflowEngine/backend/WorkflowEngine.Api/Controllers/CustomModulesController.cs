using System.Globalization;
using System.Security.Claims;
using System.Text;
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

/// <summary>
/// Custom modules: a company defines its own module (name, icon, fields) and gets list + form pages and an API for the records.
/// Rules enforced here: only cus.design changes a module; cus.manage creates / edits / deletes records, cus.view reads;
/// every record is checked against the module's fields (required, number, date, list options, e-mail) and unknown fields are dropped;
/// removing a field from the definition hides it but keeps the stored values; deleting a module deletes its records too.
/// </summary>
[ApiController]
[Route("api/custom")]
[Authorize]
public class CustomModulesController : ControllerBase
{
    private static readonly string[] Types = { "text", "textarea", "number", "date", "select", "checkbox", "email", "phone" };
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;

    public CustomModulesController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant) { _db = db; _perms = perms; _tenant = tenant; }

    private string Me => User.FindFirstValue(ClaimTypes.Name) ?? "";
    private Task<bool> Has(string p) => _perms.Has(User, p);
    private Task<string> Tid() => _tenant.TenantIdOf(User);
    private BadRequestObjectResult Bad(string m) => BadRequest(new { message = m });
    private static JsonObject D(CustRecord r) => JsonNode.Parse(string.IsNullOrWhiteSpace(r.Data) ? "{}" : r.Data) as JsonObject ?? new JsonObject();
    private static object Dto(CustRecord r) => new { r.Id, r.Kind, r.Code, r.Status, Data = JsonDocument.Parse(string.IsNullOrWhiteSpace(r.Data) ? "{}" : r.Data).RootElement.Clone(), r.CreatedBy, CreatedAt = DateTime.SpecifyKind(r.CreatedAt, DateTimeKind.Utc), UpdatedAt = r.UpdatedAt == null ? (DateTime?)null : DateTime.SpecifyKind(r.UpdatedAt.Value, DateTimeKind.Utc) };

    private static string Slug(string s)
    {
        var sb = new StringBuilder();
        foreach (var c in s.Trim().ToLowerInvariant()) { if (c is >= 'a' and <= 'z' or >= '0' and <= '9') sb.Append(c); else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-'); }
        return sb.ToString().Trim('-');
    }

    // ---------------------------------------------------------------- definitions

    /// <summary>Checks and cleans a definition from the client. Field keys are stable (assigned once), labels can change freely.</summary>
    private static (JsonObject? def, string? error) Clean(JsonElement body, JsonObject? old)
    {
        string? Str(string k) => body.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()?.Trim() : null;
        var title = Str("title"); if (string.IsNullOrEmpty(title)) return (null, "The module needs a name.");
        if (title.Length > 80) return (null, "The module name is too long.");
        var d = new JsonObject { ["title"] = title, ["titleAr"] = Str("titleAr"), ["icon"] = Str("icon") ?? old?["icon"]?.GetValue<string>() ?? "grid", ["color"] = Str("color") ?? old?["color"]?.GetValue<string>() ?? "#6366f1" };
        var fields = new JsonArray(); var seen = new HashSet<string>();
        if (!body.TryGetProperty("fields", out var fl) || fl.ValueKind != JsonValueKind.Array || fl.GetArrayLength() == 0) return (null, "Add at least one field.");
        if (fl.GetArrayLength() > 40) return (null, "A module can have at most 40 fields.");
        foreach (var f in fl.EnumerateArray())
        {
            string? FS(string k) => f.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()?.Trim() : null;
            var label = FS("label"); if (string.IsNullOrEmpty(label)) return (null, "Every field needs a name.");
            var type = FS("type") ?? "text"; if (!Types.Contains(type)) return (null, $"Unknown field type '{type}'.");
            var key = Slug(FS("key") ?? ""); if (key == "") key = Slug(label); if (key == "") key = "f" + (seen.Count + 1);
            if (key.Length > 40) key = key[..40];
            var k0 = key; var n = 2; while (!seen.Add(key)) key = k0 + n++;
            var fo = new JsonObject { ["key"] = key, ["label"] = label, ["labelAr"] = FS("labelAr"), ["type"] = type, ["required"] = f.TryGetProperty("required", out var rq) && rq.ValueKind == JsonValueKind.True };
            if (type == "select")
            {
                var opts = new JsonArray();
                if (f.TryGetProperty("options", out var ol) && ol.ValueKind == JsonValueKind.Array) foreach (var o in ol.EnumerateArray()) { var t = o.GetString()?.Trim(); if (!string.IsNullOrEmpty(t) && t.Length <= 60 && !opts.Any(x => x!.GetValue<string>() == t)) opts.Add(t); }
                if (opts.Count == 0) return (null, $"The list field '{label}' needs options.");
                fo["options"] = opts;
            }
            fields.Add(fo);
        }
        d["fields"] = fields;
        return (d, null);
    }

    [HttpGet("modules")]
    public async Task<IActionResult> Modules()
    {
        if (!await Has("cus.view")) return Forbid();
        var tid = await Tid();
        var l = await _db.CustRecords.AsNoTracking().Where(r => r.TenantId == tid && r.Kind == "_def").OrderBy(r => r.CreatedAt).ToListAsync();
        return Ok(l.Select(r => new { key = r.Code, def = JsonDocument.Parse(r.Data).RootElement.Clone(), r.CreatedAt }));
    }

    [HttpPost("modules")]
    public async Task<IActionResult> CreateModule([FromBody] JsonElement body)
    {
        if (!await Has("cus.design")) return Forbid();
        var tid = await Tid();
        var (def, err) = Clean(body, null); if (def == null) return Bad(err!);
        if (await _db.CustRecords.CountAsync(r => r.TenantId == tid && r.Kind == "_def") >= 50) return Bad("A workspace can have at most 50 custom modules.");
        var key = Slug(def["title"]!.GetValue<string>()); if (key == "") key = "module"; if (key.Length > 30) key = key[..30]; key = key.Trim('-');
        var k0 = key; var n = 2; while (key.StartsWith('_') || await _db.CustRecords.AnyAsync(r => r.TenantId == tid && r.Kind == "_def" && r.Code == key)) key = k0 + "-" + n++;
        var rec = new CustRecord { TenantId = tid, Kind = "_def", Code = key, Status = "Active", Data = def.ToJsonString(), CreatedBy = Me };
        _db.CustRecords.Add(rec); await _db.SaveChangesAsync();
        return Ok(new { key, def = JsonDocument.Parse(rec.Data).RootElement.Clone(), rec.CreatedAt });
    }

    [HttpPut("modules/{key}")]
    public async Task<IActionResult> UpdateModule(string key, [FromBody] JsonElement body)
    {
        if (!await Has("cus.design")) return Forbid();
        var tid = await Tid();
        var rec = await _db.CustRecords.FirstOrDefaultAsync(r => r.TenantId == tid && r.Kind == "_def" && r.Code == key);
        if (rec == null) return NotFound();
        var (def, err) = Clean(body, D(rec)); if (def == null) return Bad(err!);
        rec.Data = def.ToJsonString(); rec.UpdatedAt = DateTime.UtcNow; await _db.SaveChangesAsync();
        return Ok(new { key, def = JsonDocument.Parse(rec.Data).RootElement.Clone(), rec.CreatedAt });
    }

    [HttpDelete("modules/{key}")]
    public async Task<IActionResult> DeleteModule(string key)
    {
        if (!await Has("cus.design")) return Forbid();
        var tid = await Tid();
        var rows = await _db.CustRecords.Where(r => r.TenantId == tid && (r.Kind == "_def" || r.Kind == key)).ToListAsync();
        if (!rows.Any(r => r.Kind == "_def" && r.Code == key)) return NotFound();
        _db.CustRecords.RemoveRange(rows.Where(r => (r.Kind == "_def" && r.Code == key) || r.Kind == key));
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ---------------------------------------------------------------- records

    private async Task<JsonObject?> DefOf(string tid, string key)
    {
        if (key.StartsWith('_')) return null;
        var rec = await _db.CustRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tid && r.Kind == "_def" && r.Code == key);
        return rec == null ? null : D(rec);
    }

    [HttpGet("records/{key}")]
    public async Task<IActionResult> List(string key, [FromQuery] string? q, [FromQuery] int take = 500)
    {
        if (!await Has("cus.view")) return Forbid();
        var tid = await Tid();
        if (await DefOf(tid, key) == null) return NotFound();
        var qry = _db.CustRecords.AsNoTracking().Where(r => r.TenantId == tid && r.Kind == key);
        if (!string.IsNullOrWhiteSpace(q)) { var s = q.Trim(); qry = qry.Where(r => (r.Code != null && r.Code.Contains(s)) || r.Data.Contains(s)); }
        var l = await qry.OrderByDescending(r => r.CreatedAt).Take(Math.Clamp(take, 1, 5000)).ToListAsync();
        return Ok(l.Select(Dto));
    }

    /// <summary>Validates the submitted values against the module's fields and returns the cleaned data.</summary>
    private static (JsonObject? data, string? error) Check(JsonObject def, JsonElement body, JsonObject? old)
    {
        var data = new JsonObject();
        var src = body.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object ? d : body;
        foreach (var f in (JsonArray)def["fields"]!)
        {
            var fo = (JsonObject)f!; var key = fo["key"]!.GetValue<string>(); var label = fo["label"]!.GetValue<string>(); var type = fo["type"]!.GetValue<string>();
            JsonElement v = default; var has = src.ValueKind == JsonValueKind.Object && src.TryGetProperty(key, out v);
            var empty = !has || v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined || (v.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(v.GetString()));
            if (empty)
            {
                if (type == "checkbox") { data[key] = false; continue; }
                if (fo["required"]?.GetValue<bool>() == true) return (null, $"'{label}' is required.");
                continue;
            }
            switch (type)
            {
                case "number":
                    decimal num;
                    if (v.ValueKind == JsonValueKind.Number) num = v.GetDecimal();
                    else if (!decimal.TryParse(v.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out num)) return (null, $"'{label}' must be a number.");
                    data[key] = num; break;
                case "date":
                    if (!DateTime.TryParseExact(v.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt)) return (null, $"'{label}' must be a date.");
                    data[key] = dt.ToString("yyyy-MM-dd"); break;
                case "checkbox": data[key] = v.ValueKind == JsonValueKind.True || (v.ValueKind == JsonValueKind.String && v.GetString() == "true"); break;
                case "select":
                    var sv = v.GetString()?.Trim() ?? ""; if (!((JsonArray)fo["options"]!).Any(o => o!.GetValue<string>() == sv)) return (null, $"'{label}' must be one of the list.");
                    data[key] = sv; break;
                case "email":
                    var em = v.GetString()?.Trim() ?? ""; if (!em.Contains('@') || em.Contains(' ') || em.Length > 200) return (null, $"'{label}' is not a valid e-mail address.");
                    data[key] = em; break;
                default:
                    var t = v.ValueKind == JsonValueKind.String ? v.GetString()!.Trim() : v.ToString();
                    if (t.Length > 4000) return (null, $"'{label}' is too long.");
                    data[key] = t; break;
            }
        }
        // values of fields that were removed from the definition stay on the record
        if (old != null) foreach (var p in old.ToList()) if (!data.ContainsKey(p.Key) && !((JsonArray)def["fields"]!).Any(f => f!["key"]!.GetValue<string>() == p.Key)) data[p.Key] = p.Value?.DeepClone();
        return (data, null);
    }

    [HttpPost("records/{key}")]
    public async Task<IActionResult> Create(string key, [FromBody] JsonElement body)
    {
        if (!await Has("cus.manage")) return Forbid();
        var tid = await Tid(); var def = await DefOf(tid, key); if (def == null) return NotFound();
        var (data, err) = Check(def, body, null); if (data == null) return Bad(err!);
        var prefix = new string(key.Where(char.IsLetterOrDigit).Take(3).ToArray()).ToUpperInvariant(); if (prefix == "") prefix = "REC";
        var n = await _db.CustRecords.CountAsync(r => r.TenantId == tid && r.Kind == key) + 1; string code;
        do { code = $"{prefix}-{n:000000}"; n++; } while (await _db.CustRecords.AnyAsync(r => r.TenantId == tid && r.Kind == key && r.Code == code));
        var rec = new CustRecord { TenantId = tid, Kind = key, Code = code, Status = "Active", Data = data.ToJsonString(), CreatedBy = Me };
        _db.CustRecords.Add(rec); await _db.SaveChangesAsync();
        return Ok(Dto(rec));
    }

    [HttpPut("records/{key}/{id}")]
    public async Task<IActionResult> Update(string key, string id, [FromBody] JsonElement body)
    {
        if (!await Has("cus.manage")) return Forbid();
        var tid = await Tid(); var def = await DefOf(tid, key); if (def == null) return NotFound();
        var rec = await _db.CustRecords.FirstOrDefaultAsync(r => r.TenantId == tid && r.Kind == key && r.Id == id); if (rec == null) return NotFound();
        var (data, err) = Check(def, body, D(rec)); if (data == null) return Bad(err!);
        rec.Data = data.ToJsonString(); rec.UpdatedAt = DateTime.UtcNow; await _db.SaveChangesAsync();
        return Ok(Dto(rec));
    }

    [HttpDelete("records/{key}/{id}")]
    public async Task<IActionResult> Remove(string key, string id)
    {
        if (!await Has("cus.manage")) return Forbid();
        var tid = await Tid(); if (await DefOf(tid, key) == null) return NotFound();
        var rec = await _db.CustRecords.FirstOrDefaultAsync(r => r.TenantId == tid && r.Kind == key && r.Id == id); if (rec == null) return NotFound();
        _db.CustRecords.Remove(rec); await _db.SaveChangesAsync();
        return NoContent();
    }
}
