using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Controllers;

/// <summary>
/// Read-only public API for other systems: GET /api/integration/v1/{module}/{kind} with the header X-Api-Key.
/// The key (created in Integration &gt; API keys) carries scopes like "mfg:workorder", "crm:*" or "*"; its workspace decides what can be read.
/// Payslips, API keys and integration logs are never exposed here.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/integration/v1")]
public class IntegrationApiController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    public IntegrationApiController(WorkflowDbContext db) { _db = db; }

    private static readonly string[] Open = { "mfg", "prj", "crm", "proc", "scm", "wh", "ast", "epm", "bpm" };

    [HttpGet("{module}/{kind}")]
    public async Task<IActionResult> List(string module, string kind, [FromQuery] string? status, [FromQuery] string? since, [FromQuery] int take = 200)
    {
        if (!Request.Headers.TryGetValue("X-Api-Key", out var key) || string.IsNullOrWhiteSpace(key)) return Unauthorized(new { message = "Missing X-Api-Key header." });
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key.ToString()))).ToLowerInvariant();
        var k = await _db.ErpRecords.FirstOrDefaultAsync(r => r.Module == "int" && r.Kind == "apikey" && r.Ref == hash && r.Status == "Active");
        if (k == null) return Unauthorized(new { message = "Invalid API key." });
        if (!Open.Contains(module)) return NotFound();
        var scopes = FinJson.Obj(k.Data).TryGetProperty("scopes", out var sc) && sc.ValueKind == JsonValueKind.Array ? sc.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : new List<string>();
        if (!scopes.Contains("*") && !scopes.Contains(module + ":*") && !scopes.Contains(module + ":" + kind)) return StatusCode(403, new { message = "The key has no access to " + module + ":" + kind + "." });
        var q = _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == k.TenantId && r.Module == module && r.Kind == kind);
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(r => r.Status == status);
        if (DateTime.TryParse(since, out var s)) q = q.Where(r => (r.UpdatedAt ?? r.CreatedAt) >= s.ToUniversalTime());
        var list = await q.OrderByDescending(r => r.CreatedAt).Take(Math.Clamp(take, 1, 1000)).ToListAsync();
        k.Data = FinJson.WithValues(k.Data, new() { ["lastUsed"] = DateTime.UtcNow });
        await _db.SaveChangesAsync();
        return Ok(list.Select(ErpRecordDto.From));
    }
}
