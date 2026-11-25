using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

public class BillingLine { public string Branch { get; set; } = ""; public string BranchName { get; set; } = ""; public int Users { get; set; } public decimal Amount { get; set; } }
public class BillingQuote { public int Users { get; set; } public decimal UnitPrice { get; set; } public decimal Total { get; set; } public List<BillingLine> Lines { get; set; } = new(); }

/// <summary>
/// Pricing: every ACTIVE user costs Billing:PricePerUser (default 5 USD) a month; a workspace with MORE than Billing:VolumeFrom (default 100) users
/// pays Billing:VolumePrice (default 3 USD) for every user. The invoice lists the users per branch (a user is counted once, under the first branch he is
/// limited to, or under "All branches").
/// </summary>
public interface IBillingService
{
    Task<BillingQuote> QuoteAsync(string tenantId);
    Task<BillingInvoice?> EnsureInvoiceAsync(string tenantId, string period);
    Task<int> GenerateForAllAsync(string period);
    string CurrentPeriod();
}

public class BillingService : IBillingService
{
    private readonly WorkflowDbContext _db;
    private readonly IConfiguration _cfg;
    public BillingService(WorkflowDbContext db, IConfiguration cfg) { _db = db; _cfg = cfg; }

    public string CurrentPeriod() => DateTime.UtcNow.ToString("yyyy-MM");

    public async Task<BillingQuote> QuoteAsync(string tenantId)
    {
        var price = _cfg.GetValue<decimal?>("Billing:PricePerUser") ?? 5m;
        var volPrice = _cfg.GetValue<decimal?>("Billing:VolumePrice") ?? 3m;
        var volFrom = _cfg.GetValue<int?>("Billing:VolumeFrom") ?? 100;

        var users = await _db.Users.Where(u => u.TenantId == tenantId && u.IsActive).ToListAsync();
        var branches = await _db.OrgBranches.Where(b => b.TenantId == tenantId).ToListAsync();
        var unit = users.Count > volFrom ? volPrice : price;

        var lines = users
            .GroupBy(u => (u.Branches != null && u.Branches.Count > 0) ? u.Branches[0] : "*")
            .Select(g => new BillingLine
            {
                Branch = g.Key,
                BranchName = g.Key == "*" ? "All branches" : (branches.FirstOrDefault(b => b.Code == g.Key)?.Name ?? g.Key),
                Users = g.Count(),
                Amount = g.Count() * unit
            }).OrderByDescending(l => l.Users).ToList();
        return new BillingQuote { Users = users.Count, UnitPrice = unit, Total = users.Count * unit, Lines = lines };
    }

    public async Task<BillingInvoice?> EnsureInvoiceAsync(string tenantId, string period)
    {
        var existing = await _db.BillingInvoices.FirstOrDefaultAsync(i => i.TenantId == tenantId && i.Period == period);
        if (existing != null) return existing;
        var tenant = await _db.Tenants.FindAsync(tenantId);
        if (tenant == null) return null;

        var q = await QuoteAsync(tenantId);
        if (q.Users == 0) return null;
        var company = await _db.OrgCompanies.Where(c => c.TenantId == tenantId).OrderBy(c => c.Code).FirstOrDefaultAsync();
        var seq = await _db.BillingInvoices.CountAsync(i => i.Period == period) + 1;
        var inv = new BillingInvoice
        {
            TenantId = tenantId,
            Period = period,
            Number = $"INV-{period.Replace("-", "")}-{seq:0000}",
            IssuedAt = DateTime.UtcNow,
            DueAt = DateTime.UtcNow.AddDays(_cfg.GetValue<int?>("Billing:DueDays") ?? 7),
            Users = q.Users, UnitPrice = q.UnitPrice, Total = q.Total,
            SarPerUsd = _cfg.GetValue<decimal?>("Billing:SarPerUsd") ?? 3.75m,
            CompanyName = company?.Name ?? tenant.Name,
            TaxNo = company?.TaxNo,
            LinesJson = JsonSerializer.Serialize(q.Lines, new JsonSerializerOptions(JsonSerializerDefaults.Web))
        };
        _db.BillingInvoices.Add(inv);
        try { await _db.SaveChangesAsync(); }
        catch (DbUpdateException) { /* another request created it first (unique index) */ _db.Entry(inv).State = EntityState.Detached; return await _db.BillingInvoices.FirstOrDefaultAsync(i => i.TenantId == tenantId && i.Period == period); }
        return inv;
    }

    public async Task<int> GenerateForAllAsync(string period)
    {
        var ids = await _db.Tenants.Where(t => t.Id != Tenant.DefaultId).Select(t => t.Id).ToListAsync();
        var made = 0;
        foreach (var id in ids)
        {
            if (await _db.BillingInvoices.AnyAsync(i => i.TenantId == id && i.Period == period)) continue;
            if (await EnsureInvoiceAsync(id, period) != null) made++;
        }
        return made;
    }
}

/// <summary>Creates the monthly invoice of every client workspace (checks once an hour, so a server that was off on the 1st catches up).</summary>
public class BillingHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes; private readonly ILogger<BillingHostedService> _log;
    public BillingHostedService(IServiceScopeFactory scopes, ILogger<BillingHostedService> log) { _scopes = scopes; _log = log; }
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromSeconds(20), ct).ContinueWith(_ => { });
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var billing = scope.ServiceProvider.GetRequiredService<IBillingService>();
                var n = await billing.GenerateForAllAsync(billing.CurrentPeriod());
                if (n > 0) _log.LogInformation("Created {N} monthly invoices.", n);
            }
            catch (Exception ex) { _log.LogError(ex, "Monthly invoicing failed."); }
            try { await Task.Delay(TimeSpan.FromHours(1), ct); } catch (TaskCanceledException) { }
        }
    }
}

// ---------------------------------------------------------------- payment gateways
public class CheckoutResult { public string Ref { get; set; } = ""; public string Url { get; set; } = ""; }
public class PaymentStatus { public bool Paid { get; set; } public string? Method { get; set; } }

/// <summary>
/// Card data is NEVER sent to or stored by this system: the customer pays on the provider's hosted page (Visa, Mastercard and mada) and we only
/// keep the provider's reference. The payment is always confirmed by asking the provider, never by trusting the browser's redirect.
/// </summary>
public interface IPaymentGateway
{
    string Name { get; }
    Task<CheckoutResult> CreateCheckoutAsync(BillingInvoice invoice, string successUrl, string backUrl);
    Task<PaymentStatus> GetStatusAsync(string providerRef);
}

/// <summary>Test mode (no keys): the "payment page" is our own portal page and the payment is confirmed by a button. Disabled in production by choosing Billing:Provider = moyasar.</summary>
public class SandboxGateway : IPaymentGateway
{
    public string Name => "sandbox";
    public Task<CheckoutResult> CreateCheckoutAsync(BillingInvoice invoice, string successUrl, string backUrl)
        => Task.FromResult(new CheckoutResult { Ref = "sbx_" + invoice.Id, Url = "" });
    public Task<PaymentStatus> GetStatusAsync(string providerRef) => Task.FromResult(new PaymentStatus { Paid = false });
}

/// <summary>Moyasar (Saudi provider: Visa, Mastercard, mada, Apple Pay). Uses its hosted invoice page. Config: Billing:Moyasar:SecretKey.</summary>
public class MoyasarGateway : IPaymentGateway
{
    private readonly HttpClient _http; private readonly IConfiguration _cfg;
    public MoyasarGateway(HttpClient http, IConfiguration cfg)
    {
        _http = http; _cfg = cfg;
        _http.BaseAddress = new Uri("https://api.moyasar.com/v1/");
        var key = cfg["Billing:Moyasar:SecretKey"] ?? "";
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(key + ":")));
    }
    public string Name => "moyasar";

    public async Task<CheckoutResult> CreateCheckoutAsync(BillingInvoice invoice, string successUrl, string backUrl)
    {
        var halalas = (long)Math.Round(invoice.Total * invoice.SarPerUsd * 100m, MidpointRounding.AwayFromZero);
        var payload = new Dictionary<string, object?>
        {
            ["amount"] = halalas, ["currency"] = "SAR",
            ["description"] = $"{invoice.Number} - {invoice.Users} users ({invoice.Period})",
            ["success_url"] = successUrl, ["back_url"] = backUrl,
            ["metadata"] = new Dictionary<string, string> { ["invoice"] = invoice.Id, ["tenant"] = invoice.TenantId }
        };
        if (!string.IsNullOrWhiteSpace(_cfg["Billing:WebhookUrl"])) payload["callback_url"] = _cfg["Billing:WebhookUrl"];
        var body = JsonSerializer.Serialize(payload);
        var res = await _http.PostAsync("invoices", new StringContent(body, Encoding.UTF8, "application/json"));
        var txt = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException("Payment provider refused the request.");
        using var doc = JsonDocument.Parse(txt);
        return new CheckoutResult { Ref = doc.RootElement.GetProperty("id").GetString() ?? "", Url = doc.RootElement.GetProperty("url").GetString() ?? "" };
    }

    public async Task<PaymentStatus> GetStatusAsync(string providerRef)
    {
        var res = await _http.GetAsync("invoices/" + Uri.EscapeDataString(providerRef));
        if (!res.IsSuccessStatusCode) return new PaymentStatus();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        var paid = root.TryGetProperty("status", out var s) && s.GetString() == "paid";
        string? method = null;
        if (paid && root.TryGetProperty("payments", out var pays) && pays.ValueKind == JsonValueKind.Array)
            foreach (var p in pays.EnumerateArray())
                if (p.TryGetProperty("status", out var ps) && ps.GetString() == "paid" && p.TryGetProperty("source", out var src) && src.TryGetProperty("company", out var co))
                { method = co.GetString(); break; }
        return new PaymentStatus { Paid = paid, Method = method };
    }
}
