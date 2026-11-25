using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Security;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class InvoiceDto
{
    public string Id { get; set; } = ""; public string Number { get; set; } = ""; public string Period { get; set; } = "";
    public DateTime IssuedAt { get; set; } public DateTime DueAt { get; set; }
    public string Status { get; set; } = ""; public bool Overdue { get; set; }
    public string Currency { get; set; } = "USD"; public int Users { get; set; } public decimal UnitPrice { get; set; } public decimal Total { get; set; }
    public decimal SarPerUsd { get; set; } public decimal TotalSar { get; set; }
    public string CompanyName { get; set; } = ""; public string? TaxNo { get; set; }
    public List<BillingLine> Lines { get; set; } = new();
    public string? Method { get; set; } public DateTime? PaidAt { get; set; }

    public static InvoiceDto From(BillingInvoice i) => new()
    {
        Id = i.Id, Number = i.Number, Period = i.Period, IssuedAt = i.IssuedAt, DueAt = i.DueAt, Status = i.Status,
        Overdue = i.Status == "open" && i.DueAt < DateTime.UtcNow, Currency = i.Currency, Users = i.Users, UnitPrice = i.UnitPrice, Total = i.Total,
        SarPerUsd = i.SarPerUsd, TotalSar = Math.Round(i.Total * i.SarPerUsd, 2), CompanyName = i.CompanyName, TaxNo = i.TaxNo,
        Lines = JsonSerializer.Deserialize<List<BillingLine>>(i.LinesJson, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new(),
        Method = i.Method, PaidAt = i.PaidAt
    };
}
public class PayRequest { public string? ReturnUrl { get; set; } }

/// <summary>
/// The workspace administrator (org.manage) sees the subscription price, the monthly invoices and pays them online (Visa / mada through the provider's hosted page).
/// Everything is scoped to the caller's workspace.
/// </summary>
[ApiController]
[Route("api/billing")]
[Authorize]
public class BillingController : ControllerBase
{
    private readonly WorkflowDbContext _db; private readonly ICurrentUser _me; private readonly IBillingService _billing;
    private readonly IEnumerable<IPaymentGateway> _gateways; private readonly IConfiguration _cfg;
    public BillingController(WorkflowDbContext db, ICurrentUser me, IBillingService billing, IEnumerable<IPaymentGateway> gateways, IConfiguration cfg)
    { _db = db; _me = me; _billing = billing; _gateways = gateways; _cfg = cfg; }

    private IPaymentGateway Gateway => _gateways.FirstOrDefault(g => g.Name == (_cfg["Billing:Provider"] ?? "sandbox")) ?? _gateways.First(g => g.Name == "sandbox");

    [HttpGet("summary")]
    public async Task<IActionResult> Summary()
    {
        await _me.RequireAsync(Permissions.OrgManage);
        var t = await _me.TenantIdAsync();
        var q = await _billing.QuoteAsync(t);
        var open = await _db.BillingInvoices.Where(i => i.TenantId == t && i.Status == "open").ToListAsync();
        return Ok(new
        {
            users = q.Users, unitPrice = q.UnitPrice, estimate = q.Total, currency = "USD", lines = q.Lines,
            pricePerUser = _cfg.GetValue<decimal?>("Billing:PricePerUser") ?? 5m, volumePrice = _cfg.GetValue<decimal?>("Billing:VolumePrice") ?? 3m, volumeFrom = _cfg.GetValue<int?>("Billing:VolumeFrom") ?? 100,
            sarPerUsd = _cfg.GetValue<decimal?>("Billing:SarPerUsd") ?? 3.75m,
            balance = open.Sum(i => i.Total), openInvoices = open.Count, provider = Gateway.Name,
            nextInvoice = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1)
        });
    }

    [HttpGet("invoices")]
    public async Task<IActionResult> List()
    {
        await _me.RequireAsync(Permissions.OrgManage);
        var t = await _me.TenantIdAsync();
        await _billing.EnsureInvoiceAsync(t, _billing.CurrentPeriod());           // the current month's invoice exists as soon as the admin looks
        var rows = await _db.BillingInvoices.Where(i => i.TenantId == t).OrderByDescending(i => i.Period).ToListAsync();
        return Ok(rows.Select(InvoiceDto.From));
    }

    private async Task<BillingInvoice?> Mine(string id)
    {
        var t = await _me.TenantIdAsync();
        return await _db.BillingInvoices.FirstOrDefaultAsync(i => i.Id == id && i.TenantId == t);
    }

    /// <summary>Starts a payment: returns the address of the provider's hosted payment page (sandbox: empty url, the portal shows its test page).</summary>
    [HttpPost("invoices/{id}/pay")]
    public async Task<IActionResult> Pay(string id, [FromBody] PayRequest req)
    {
        await _me.RequireAsync(Permissions.OrgManage);
        var inv = await Mine(id); if (inv == null) return NotFound();
        if (inv.Status != "open") return BadRequest("This invoice is not open.");
        var gw = Gateway;
        var back = (req?.ReturnUrl ?? "").Trim();
        if (!Uri.TryCreate(back, UriKind.Absolute, out var u) || (u.Scheme != "https" && u.Scheme != "http")) return BadRequest("A valid return address is needed.");
        var allowed = _cfg.GetSection("Billing:AllowedReturnHosts").Get<string[]>();
        if (allowed is { Length: > 0 } && !allowed.Contains(u.Host, StringComparer.OrdinalIgnoreCase)) return BadRequest("Return address is not allowed.");
        var sep = back.Contains('?') ? "&" : "?";
        var co = await gw.CreateCheckoutAsync(inv, $"{back}{sep}invoice={inv.Id}", back);
        inv.Provider = gw.Name; inv.ProviderRef = co.Ref; inv.PaymentUrl = co.Url;
        await _db.SaveChangesAsync();
        return Ok(new { url = co.Url, provider = gw.Name });
    }

    /// <summary>Called when the customer comes back from the payment page: asks the provider whether it is really paid.</summary>
    [HttpPost("invoices/{id}/confirm")]
    public async Task<IActionResult> Confirm(string id)
    {
        await _me.RequireAsync(Permissions.OrgManage);
        var inv = await Mine(id); if (inv == null) return NotFound();
        await Settle(inv);
        return Ok(InvoiceDto.From(inv));
    }

    /// <summary>Test mode only: marks the invoice paid without a card.</summary>
    [HttpPost("invoices/{id}/sandbox-pay")]
    public async Task<IActionResult> SandboxPay(string id)
    {
        await _me.RequireAsync(Permissions.OrgManage);
        if (Gateway.Name != "sandbox") return NotFound();
        var inv = await Mine(id); if (inv == null) return NotFound();
        if (inv.Status == "open") { inv.Status = "paid"; inv.PaidAt = DateTime.UtcNow; inv.Method = "test"; inv.Provider = "sandbox"; await _db.SaveChangesAsync(); }
        return Ok(InvoiceDto.From(inv));
    }

    /// <summary>Provider notification. The body is NOT trusted: we only use it to know which invoice to re-check with the provider.</summary>
    [HttpPost("webhook")]
    [AllowAnonymous]
    public async Task<IActionResult> Webhook([FromQuery] string? s, [FromBody] JsonElement body)
    {
        var secret = _cfg["Billing:WebhookSecret"];
        if (string.IsNullOrEmpty(secret) || s != secret) return Unauthorized();
        string? reference = null;
        if (body.ValueKind == JsonValueKind.Object)
        {
            if (body.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object)
            {
                if (d.TryGetProperty("invoice_id", out var ii) && ii.ValueKind == JsonValueKind.String) reference = ii.GetString();
                else if (d.TryGetProperty("id", out var di) && di.ValueKind == JsonValueKind.String) reference = di.GetString();
            }
        }
        if (reference == null) return Ok();
        var inv = await _db.BillingInvoices.FirstOrDefaultAsync(i => i.ProviderRef == reference);
        if (inv != null) await Settle(inv);
        return Ok();
    }

    private async Task Settle(BillingInvoice inv)
    {
        if (inv.Status != "open" || string.IsNullOrEmpty(inv.ProviderRef) || inv.Provider == "sandbox") return;
        var gw = _gateways.FirstOrDefault(g => g.Name == inv.Provider); if (gw == null) return;
        var st = await gw.GetStatusAsync(inv.ProviderRef);
        if (st.Paid) { inv.Status = "paid"; inv.PaidAt = DateTime.UtcNow; inv.Method = st.Method ?? "card"; await _db.SaveChangesAsync(); }
    }
}
