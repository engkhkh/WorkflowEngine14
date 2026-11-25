using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Security;

namespace WorkflowEngine.Api.Controllers;

public class SiteCreateRequest { public string Name { get; set; } = string.Empty; public JsonElement? Design { get; set; } public string? Currency { get; set; } }
public class SiteSaveRequest { public string? Name { get; set; } public JsonElement Design { get; set; } }
public class SitePublishRequest { public string Html { get; set; } = string.Empty; public List<ShopProduct> Products { get; set; } = new(); public string? Currency { get; set; } }
public class ShopProduct { public string Sku { get; set; } = string.Empty; public string Name { get; set; } = string.Empty; public decimal Price { get; set; } }
public class OrderLineIn { public string Sku { get; set; } = string.Empty; public int Qty { get; set; } }
public class PublicOrderRequest
{
    public string Name { get; set; } = string.Empty; public string? Email { get; set; } public string? Phone { get; set; }
    public string? Address { get; set; } public string? Note { get; set; } public string? Website { get; set; }   // Website = honeypot, must stay empty
    public List<OrderLineIn> Lines { get; set; } = new();
}
public class PublicMessageRequest { public string Name { get; set; } = string.Empty; public string? Email { get; set; } public string? Phone { get; set; } public string Message { get; set; } = string.Empty; public string? Website { get; set; } }
public class SubmissionStatusRequest { public string Status { get; set; } = "new"; }

/// <summary>
/// Admin side of the Website module. Everything is scoped to the caller's workspace and guarded by web.* privileges
/// (web.view see, web.edit design, web.publish publish / unpublish / delete, web.orders.manage handle orders and messages).
/// </summary>
[ApiController]
[Route("api/website")]
[Authorize]
public class WebsiteController : ControllerBase
{
    private const int MaxDesignChars = 3_000_000, MaxHtmlChars = 4_000_000;
    private static readonly string[] Statuses = { "new", "confirmed", "shipped", "done", "cancelled" };
    private readonly WorkflowDbContext _db; private readonly ICurrentUser _me;
    public WebsiteController(WorkflowDbContext db, ICurrentUser me) { _db = db; _me = me; }

    private async Task<WebSite?> Mine(string id) { var t = await _me.TenantIdAsync(); return await _db.WebSites.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == t); }
    private static object Row(WebSite s) => new { s.Id, s.Name, s.Slug, s.Published, s.PublishedAt, s.UpdatedAt, s.Currency };

    [HttpGet("sites")]
    public async Task<IActionResult> List()
    {
        await _me.RequireAsync("web.view");
        var t = await _me.TenantIdAsync();
        var rows = await _db.WebSites.Where(s => s.TenantId == t).OrderByDescending(s => s.UpdatedAt).ToListAsync();
        return Ok(rows.Select(Row));
    }

    [HttpGet("sites/{id}")]
    public async Task<IActionResult> Get(string id)
    {
        await _me.RequireAsync("web.view");
        var s = await Mine(id); if (s == null) return NotFound();
        return Ok(new { s.Id, s.Name, s.Slug, s.Published, s.PublishedAt, s.UpdatedAt, s.Currency, design = JsonDocument.Parse(s.DraftJson).RootElement });
    }

    [HttpPost("sites")]
    public async Task<IActionResult> Create([FromBody] SiteCreateRequest req)
    {
        await _me.RequireAsync("web.edit");
        var t = await _me.TenantIdAsync();
        var name = (req.Name ?? "").Trim(); if (name.Length == 0 || name.Length > 80) return BadRequest("A site name is needed.");
        var design = req.Design?.GetRawText() ?? "{}";
        if (design.Length > MaxDesignChars) return BadRequest("The design is too large.");
        var s = new WebSite { TenantId = t, Name = name, Slug = await NewSlug(name), DraftJson = design, Currency = string.IsNullOrWhiteSpace(req.Currency) ? "SAR" : req.Currency!.Trim().ToUpperInvariant() };
        _db.WebSites.Add(s); await _db.SaveChangesAsync();
        return Ok(Row(s));
    }

    [HttpPut("sites/{id}")]
    public async Task<IActionResult> Save(string id, [FromBody] SiteSaveRequest req)
    {
        await _me.RequireAsync("web.edit");
        var s = await Mine(id); if (s == null) return NotFound();
        var raw = req.Design.GetRawText(); if (raw.Length > MaxDesignChars) return BadRequest("The design is too large (reduce image sizes).");
        if (!string.IsNullOrWhiteSpace(req.Name)) s.Name = req.Name!.Trim()[..Math.Min(80, req.Name!.Trim().Length)];
        s.DraftJson = raw; s.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(Row(s));
    }

    [HttpDelete("sites/{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        await _me.RequireAsync("web.publish");
        var s = await Mine(id); if (s == null) return NotFound();
        _db.WebSubmissions.RemoveRange(_db.WebSubmissions.Where(x => x.SiteId == s.Id));
        _db.WebSites.Remove(s); await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("sites/{id}/publish")]
    public async Task<IActionResult> Publish(string id, [FromBody] SitePublishRequest req)
    {
        await _me.RequireAsync("web.publish");
        var s = await Mine(id); if (s == null) return NotFound();
        if (string.IsNullOrWhiteSpace(req.Html) || req.Html.Length > MaxHtmlChars) return BadRequest("The page is empty or too large.");
        s.PublishedHtml = req.Html;
        s.ProductsJson = JsonSerializer.Serialize(req.Products.Where(p => !string.IsNullOrWhiteSpace(p.Sku) && p.Price >= 0).Take(2000)
            .Select(p => new ShopProduct { Sku = p.Sku.Trim(), Name = p.Name?.Trim() ?? p.Sku, Price = Math.Round(p.Price, 2) }));
        if (!string.IsNullOrWhiteSpace(req.Currency)) s.Currency = req.Currency!.Trim().ToUpperInvariant();
        s.Published = true; s.PublishedAt = DateTime.UtcNow; s.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(Row(s));
    }

    [HttpPost("sites/{id}/unpublish")]
    public async Task<IActionResult> Unpublish(string id)
    {
        await _me.RequireAsync("web.publish");
        var s = await Mine(id); if (s == null) return NotFound();
        s.Published = false; s.UpdatedAt = DateTime.UtcNow; await _db.SaveChangesAsync();
        return Ok(Row(s));
    }

    // ---- orders and messages ----
    [HttpGet("submissions")]
    public async Task<IActionResult> Submissions([FromQuery] string? siteId, [FromQuery] string? kind)
    {
        await _me.RequireAsync("web.orders.manage");
        var t = await _me.TenantIdAsync();
        var q = _db.WebSubmissions.Where(x => x.TenantId == t);
        if (!string.IsNullOrEmpty(siteId)) q = q.Where(x => x.SiteId == siteId);
        if (!string.IsNullOrEmpty(kind)) q = q.Where(x => x.Kind == kind);
        var rows = await q.OrderByDescending(x => x.CreatedAt).Take(500).ToListAsync();
        return Ok(rows.Select(x => new { x.Id, x.SiteId, x.Kind, x.Number, x.Name, x.Email, x.Phone, x.Address, x.Note, lines = JsonDocument.Parse(x.LinesJson).RootElement, x.Total, x.Currency, x.Status, x.CreatedAt }));
    }

    [HttpPut("submissions/{id}")]
    public async Task<IActionResult> SetStatus(string id, [FromBody] SubmissionStatusRequest req)
    {
        await _me.RequireAsync("web.orders.manage");
        var t = await _me.TenantIdAsync();
        var x = await _db.WebSubmissions.FirstOrDefaultAsync(o => o.Id == id && o.TenantId == t); if (x == null) return NotFound();
        if (!Statuses.Contains(req.Status)) return BadRequest("Unknown status.");
        x.Status = req.Status; await _db.SaveChangesAsync();
        return Ok(new { x.Id, x.Status });
    }

    private async Task<string> NewSlug(string name)
    {
        var baseSlug = Regex.Replace(name.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (baseSlug.Length < 3) baseSlug = "site";
        if (baseSlug.Length > 40) baseSlug = baseSlug[..40].Trim('-');
        var slug = baseSlug;
        while (await _db.WebSites.AnyAsync(s => s.Slug == slug)) slug = baseSlug + "-" + Guid.NewGuid().ToString("N")[..4];
        return slug;
    }
}

/// <summary>
/// What the visitors of a published site reach, with no sign-in: the page itself (/s/{slug}) and its shop / contact form.
/// The page is customer-authored HTML, so it is served with a CSP "sandbox" (an opaque origin: it cannot read this server's storage or call
/// its authenticated API) and the order total is always recomputed here from the price list frozen at publish time.
/// </summary>
[ApiController]
[AllowAnonymous]
public class PublicSiteController : ControllerBase
{
    private static readonly ConcurrentDictionary<string, Queue<DateTime>> Hits = new();
    private readonly WorkflowDbContext _db;
    public PublicSiteController(WorkflowDbContext db) { _db = db; }

    /// <summary>At most 6 submissions per address and 10 minutes.</summary>
    private bool Limited()
    {
        var key = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "?";
        var q = Hits.GetOrAdd(key, _ => new Queue<DateTime>());
        lock (q)
        {
            var now = DateTime.UtcNow;
            while (q.Count > 0 && now - q.Peek() > TimeSpan.FromMinutes(10)) q.Dequeue();
            if (q.Count >= 6) return true;
            q.Enqueue(now); return false;
        }
    }

    [HttpGet("s/{slug}")]
    public async Task<IActionResult> Page(string slug)
    {
        var s = await _db.WebSites.AsNoTracking().Where(x => x.Slug == slug && x.Published).Select(x => new { x.PublishedHtml }).FirstOrDefaultAsync();
        if (s?.PublishedHtml == null) return NotFound();
        Response.Headers["Content-Security-Policy"] = "sandbox allow-scripts allow-forms allow-popups; default-src 'none'; img-src * data: blob:; media-src * data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; script-src 'unsafe-inline'; connect-src *; frame-src https://www.google.com https://www.openstreetmap.org https://www.youtube.com";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        Response.Headers["Cache-Control"] = "public, max-age=60";
        return Content(s.PublishedHtml, "text/html; charset=utf-8");
    }

    private static string Clip(string? v, int n) { v = (v ?? "").Trim(); return v.Length > n ? v[..n] : v; }

    [HttpPost("api/public/sites/{slug}/orders")]
    public async Task<IActionResult> Order(string slug, [FromBody] PublicOrderRequest req)
    {
        if (!string.IsNullOrEmpty(req.Website)) return Ok(new { number = "WO-0" });                 // bot: pretend it worked
        if (Limited()) return StatusCode(429, "Too many requests, try again later.");
        var site = await _db.WebSites.FirstOrDefaultAsync(x => x.Slug == slug && x.Published); if (site == null) return NotFound();
        var name = Clip(req.Name, 120); var phone = Clip(req.Phone, 40); var email = Clip(req.Email, 160);
        if (name.Length < 2 || (phone.Length < 5 && email.Length < 5)) return BadRequest("Name and a phone or e-mail are needed.");
        if (req.Lines == null || req.Lines.Count == 0 || req.Lines.Count > 50) return BadRequest("The cart is empty.");

        var price = (JsonSerializer.Deserialize<List<ShopProduct>>(site.ProductsJson, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new()).GroupBy(p => p.Sku).ToDictionary(g => g.Key, g => g.First());
        var lines = new List<object>(); decimal total = 0;
        foreach (var l in req.Lines.GroupBy(l => l.Sku).Select(g => new OrderLineIn { Sku = g.Key, Qty = g.Sum(x => x.Qty) }))
        {
            if (!price.TryGetValue(l.Sku, out var p) || l.Qty < 1 || l.Qty > 999) return BadRequest("A product in the cart is not available.");
            lines.Add(new { sku = p.Sku, name = p.Name, qty = l.Qty, price = p.Price }); total += p.Price * l.Qty;
        }
        var count = await _db.WebSubmissions.CountAsync(x => x.SiteId == site.Id && x.Kind == "order") + 1;
        var sub = new WebSubmission
        {
            TenantId = site.TenantId, SiteId = site.Id, Kind = "order", Number = $"WO-{DateTime.UtcNow:yyyyMMdd}-{count:0000}",
            Name = name, Email = email, Phone = phone, Address = Clip(req.Address, 300), Note = Clip(req.Note, 500),
            LinesJson = JsonSerializer.Serialize(lines), Total = Math.Round(total, 2), Currency = site.Currency
        };
        _db.WebSubmissions.Add(sub); await _db.SaveChangesAsync();
        return Ok(new { number = sub.Number, total = sub.Total });
    }

    [HttpPost("api/public/sites/{slug}/messages")]
    public async Task<IActionResult> Message(string slug, [FromBody] PublicMessageRequest req)
    {
        if (!string.IsNullOrEmpty(req.Website)) return Ok(new { ok = true });
        if (Limited()) return StatusCode(429, "Too many requests, try again later.");
        var site = await _db.WebSites.FirstOrDefaultAsync(x => x.Slug == slug && x.Published); if (site == null) return NotFound();
        var name = Clip(req.Name, 120); var msg = Clip(req.Message, 2000);
        if (name.Length < 2 || msg.Length < 2) return BadRequest("Name and message are needed.");
        var count = await _db.WebSubmissions.CountAsync(x => x.SiteId == site.Id && x.Kind == "message") + 1;
        _db.WebSubmissions.Add(new WebSubmission
        {
            TenantId = site.TenantId, SiteId = site.Id, Kind = "message", Number = $"MSG-{DateTime.UtcNow:yyyyMMdd}-{count:0000}",
            Name = name, Email = Clip(req.Email, 160), Phone = Clip(req.Phone, 40), Note = msg, Currency = site.Currency
        });
        await _db.SaveChangesAsync();
        return Ok(new { ok = true });
    }
}
