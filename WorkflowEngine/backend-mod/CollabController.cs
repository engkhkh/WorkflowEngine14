using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Security;

namespace WorkflowEngine.Api.Controllers;

public class CollabNoteDto { public string Text { get; set; } = string.Empty; public bool System { get; set; } }
public class CollabFileDto { public string Name { get; set; } = string.Empty; public string? Type { get; set; } public string Content { get; set; } = string.Empty; }
public class CollabConfigDto { public string Name { get; set; } = string.Empty; public bool Shared { get; set; } public JsonElement Data { get; set; } }

/// <summary>
/// Cross-module collaboration: chatter notes + activity log and file attachments on any record, plus saved list filters and saved report layouts.
/// Everything is stored in the ErpRecords table under Module = "collab" (so no extra table), scoped to the caller's workspace.
/// A caller may touch the notes / files of a record only when they hold a (non self-service) privilege of the record's module; filters and reports belong
/// to their author (or are shared with the workspace). Deleting somebody else's note / file / shared item needs admin.users.
/// </summary>
[ApiController]
[Route("api/collab")]
[Authorize]
public class CollabController : ControllerBase
{
    private const long MaxFileBytes = 4 * 1024 * 1024;       // per attachment (stored as base64 text in the database)
    private const int MaxFilesPerRecord = 25;
    private static readonly Dictionary<string, string> Prefix = new(StringComparer.OrdinalIgnoreCase)
    {
        ["mfg"] = "mfg", ["prj"] = "prj", ["crm"] = "crm", ["proc"] = "proc", ["scm"] = "scm", ["wh"] = "wh", ["ast"] = "ast", ["pay"] = "pay",
        ["epm"] = "epm", ["bpm"] = "bpm", ["int"] = "int", ["bi"] = "bi", ["hr"] = "hr", ["fin"] = "finance", ["pos"] = "pos"
    };

    private readonly WorkflowDbContext _db;
    private readonly ICurrentUser _me;          // access layer: who is calling, workspace, privileges
    private readonly ISecureData _data;         // access layer: workspace-scoped reads / stamped writes
    public CollabController(WorkflowDbContext db, ICurrentUser me, ISecureData data) { _db = db; _me = me; _data = data; }

    private string Username => _me.Username;
    private static readonly string[] HrPrivs = { "hr.employees.view", "hr.employees.manage", "hr.leave.view", "hr.performance.view", "hr.recruitment.view", "hr.org.view" };
    /// <summary>
    /// May the caller see / write the chatter of a record of this module? Needs a privilege of the module, but not just a self-service one
    /// (hr.self, pay.self), and for HR / Finance one of the granular list privileges (the generic hr.view / finance.view are handed to every employee).
    /// </summary>
    private async Task<bool> CanTouch(string module)
    {
        if (!Prefix.TryGetValue(module, out var p)) return false;
        var eff = await _me.PermissionsAsync();
        return module.ToLowerInvariant() switch
        {
            "hr" => eff.Any(x => HrPrivs.Contains(x, StringComparer.OrdinalIgnoreCase)),
            "fin" => eff.Any(x => x.StartsWith("finance.", StringComparison.OrdinalIgnoreCase) && x.Count(c => c == '.') >= 2),
            _ => eff.Any(x => x.StartsWith(p + ".", StringComparison.OrdinalIgnoreCase) && !x.EndsWith(".self", StringComparison.OrdinalIgnoreCase))
        };
    }
    private Task<bool> IsAdmin() => _me.HasAsync("admin.users");
    private BadRequestObjectResult Bad(string m) => BadRequest(new { message = m });
    private static string Target(string module, string kind) => module + ":" + kind;
    private static string Clip(string? s, int n) { s = (s ?? "").Trim(); return s.Length <= n ? s : s[..n]; }

    private static object NoteOut(ErpRecord r)
    {
        using var d = JsonDocument.Parse(r.Data);
        return new { id = r.Id, text = d.RootElement.TryGetProperty("text", out var t) ? t.GetString() : "", system = r.Status == "Log", author = r.CreatedBy, createdAt = r.CreatedAt };
    }
    private static object FileOut(ErpRecord r)
    {
        using var d = JsonDocument.Parse(r.Data);
        var e = d.RootElement;
        return new { id = r.Id, name = e.GetProperty("name").GetString(), type = e.TryGetProperty("type", out var t) ? t.GetString() : "", size = e.TryGetProperty("size", out var s) ? s.GetInt64() : 0, author = r.CreatedBy, createdAt = r.CreatedAt };
    }

    // ------------------------------------------------------------------ chatter

    [HttpGet("{module}/{kind}/{recordId}/notes")]
    public async Task<IActionResult> Notes(string module, string kind, string recordId)
    {
        if (!await CanTouch(module)) return Forbid();
        var tenantId = await _me.TenantIdAsync();
        var t = Target(module, kind);
        var list = await (await _data.ReadAsync<ErpRecord>()).Where(r => r.Module == "collab" && r.Kind == "note" && r.Parent == t && r.Ref == recordId)
            .OrderByDescending(r => r.CreatedAt).Take(300).ToListAsync();
        return Ok(list.Select(NoteOut));
    }

    [HttpPost("{module}/{kind}/{recordId}/notes")]
    public async Task<IActionResult> AddNote(string module, string kind, string recordId, [FromBody] CollabNoteDto b)
    {
        if (!await CanTouch(module)) return Forbid();
        var text = Clip(b.Text, 4000);
        if (text == "") return Bad("Write a note first.");
        var rec = new ErpRecord
        {
            TenantId = await _me.TenantIdAsync(), Module = "collab", Kind = "note", Parent = Target(module, kind), Ref = recordId,
            Status = b.System ? "Log" : "Note", CreatedBy = Username, Data = JsonSerializer.Serialize(new { text })
        };
        _db.ErpRecords.Add(rec);
        await _db.SaveChangesAsync();
        return Ok(NoteOut(rec));
    }

    [HttpDelete("notes/{id}")]
    public async Task<IActionResult> DeleteNote(string id)
    {
        var tenantId = await _me.TenantIdAsync();
        var r = await _db.ErpRecords.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId && x.Module == "collab" && x.Kind == "note");
        if (r == null) return NotFound();
        if (r.CreatedBy != Username && !await IsAdmin()) return Forbid();
        _db.ErpRecords.Remove(r);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ------------------------------------------------------------------ attachments

    [HttpGet("{module}/{kind}/{recordId}/files")]
    public async Task<IActionResult> Files(string module, string kind, string recordId)
    {
        if (!await CanTouch(module)) return Forbid();
        var tenantId = await _me.TenantIdAsync();
        var t = Target(module, kind);
        var list = await (await _data.ReadAsync<ErpRecord>()).Where(r => r.Module == "collab" && r.Kind == "file" && r.Parent == t && r.Ref == recordId)
            .OrderByDescending(r => r.CreatedAt).Take(100).ToListAsync();
        return Ok(list.Select(FileOut));
    }

    [HttpPost("{module}/{kind}/{recordId}/files")]
    [RequestSizeLimit(8 * 1024 * 1024)]
    public async Task<IActionResult> AddFile(string module, string kind, string recordId, [FromBody] CollabFileDto b)
    {
        if (!await CanTouch(module)) return Forbid();
        var name = Clip(Path.GetFileName(b.Name ?? ""), 200);
        if (name == "" || string.IsNullOrEmpty(b.Content)) return Bad("Choose a file.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(b.Content); } catch { return Bad("The file could not be read."); }
        if (bytes.Length > MaxFileBytes) return Bad($"The file is larger than {MaxFileBytes / 1024 / 1024} MB.");
        var tenantId = await _me.TenantIdAsync();
        var t = Target(module, kind);
        if (await _db.ErpRecords.CountAsync(r => r.TenantId == tenantId && r.Module == "collab" && r.Kind == "file" && r.Parent == t && r.Ref == recordId) >= MaxFilesPerRecord)
            return Bad("Too many attachments on this record.");
        var rec = new ErpRecord
        {
            TenantId = tenantId, Module = "collab", Kind = "file", Parent = t, Ref = recordId, Status = "File", CreatedBy = Username,
            Data = JsonSerializer.Serialize(new { name, type = Clip(b.Type, 120), size = bytes.LongLength, content = b.Content })
        };
        _db.ErpRecords.Add(rec);
        await _db.SaveChangesAsync();
        return Ok(FileOut(rec));
    }

    [HttpGet("files/{id}")]
    public async Task<IActionResult> Download(string id)
    {
        var tenantId = await _me.TenantIdAsync();
        var r = await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId && x.Module == "collab" && x.Kind == "file");
        if (r == null) return NotFound();
        var module = (r.Parent ?? "").Split(':')[0];
        if (!await CanTouch(module)) return Forbid();
        using var d = JsonDocument.Parse(r.Data);
        var e = d.RootElement;
        var type = e.TryGetProperty("type", out var t) && !string.IsNullOrWhiteSpace(t.GetString()) ? t.GetString()! : "application/octet-stream";
        return File(Convert.FromBase64String(e.GetProperty("content").GetString() ?? ""), type, e.GetProperty("name").GetString());
    }

    [HttpDelete("files/{id}")]
    public async Task<IActionResult> DeleteFile(string id)
    {
        var tenantId = await _me.TenantIdAsync();
        var r = await _db.ErpRecords.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId && x.Module == "collab" && x.Kind == "file");
        if (r == null) return NotFound();
        if (r.CreatedBy != Username && !await IsAdmin()) return Forbid();
        _db.ErpRecords.Remove(r);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ------------------------------------------------------------------ saved filters / report layouts   (kind = filter | report)

    private static bool OkKind(string kind) => kind is "filter" or "report";

    [HttpGet("configs/{kind}")]
    public async Task<IActionResult> Configs(string kind, [FromQuery] string view)
    {
        if (!OkKind(kind)) return NotFound();
        var tenantId = await _me.TenantIdAsync();
        var list = await (await _data.ReadAsync<ErpRecord>())
            .Where(r => r.Module == "collab" && r.Kind == kind && r.Ref == view && (r.CreatedBy == Username || r.Status == "Shared"))
            .OrderBy(r => r.Code).Take(200).ToListAsync();
        return Ok(list.Select(r => new { id = r.Id, name = r.Code, shared = r.Status == "Shared", author = r.CreatedBy, mine = r.CreatedBy == Username, data = FinJson.Obj(r.Data) }));
    }

    [HttpPost("configs/{kind}")]
    public async Task<IActionResult> SaveConfig(string kind, [FromQuery] string view, [FromBody] CollabConfigDto b)
    {
        if (!OkKind(kind)) return NotFound();
        var name = Clip(b.Name, 120);
        if (name == "" || string.IsNullOrWhiteSpace(view)) return Bad("Enter a name.");
        var tenantId = await _me.TenantIdAsync();
        var raw = b.Data.ValueKind == JsonValueKind.Undefined ? "{}" : b.Data.GetRawText();
        if (raw.Length > 60_000) return Bad("Too large.");
        var rec = await _db.ErpRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "collab" && r.Kind == kind && r.Ref == view && r.Code == name && r.CreatedBy == Username);
        if (rec == null) { rec = new ErpRecord { TenantId = tenantId, Module = "collab", Kind = kind, Ref = view, Code = name, CreatedBy = Username }; _db.ErpRecords.Add(rec); }
        rec.Status = b.Shared ? "Shared" : "Private";
        rec.Data = raw; rec.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { id = rec.Id, name = rec.Code, shared = b.Shared, author = rec.CreatedBy, mine = true, data = FinJson.Obj(rec.Data) });
    }

    [HttpDelete("configs/{kind}/{id}")]
    public async Task<IActionResult> DeleteConfig(string kind, string id)
    {
        if (!OkKind(kind)) return NotFound();
        var tenantId = await _me.TenantIdAsync();
        var r = await _db.ErpRecords.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId && x.Module == "collab" && x.Kind == kind);
        if (r == null) return NotFound();
        if (r.CreatedBy != Username && !await IsAdmin()) return Forbid();
        _db.ErpRecords.Remove(r);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
