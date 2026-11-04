namespace WorkflowEngine.Api.Models;

/// <summary>
/// A monthly subscription invoice we send to a workspace (a client company with its branches).
/// Price is per active user per month (see Services/Billing.cs). Amounts are in USD; the card is charged in SAR
/// (mada only works in SAR) at the configured rate, which is stored on the invoice so it never changes afterwards.
/// </summary>
public class BillingInvoice
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string TenantId { get; set; } = string.Empty;
    public string Number { get; set; } = string.Empty;          // INV-202610-0001
    public string Period { get; set; } = string.Empty;          // "2026-10"
    public DateTime IssuedAt { get; set; } = DateTime.UtcNow;
    public DateTime DueAt { get; set; }
    public string Status { get; set; } = "open";                // open | paid | void
    public string Currency { get; set; } = "USD";
    public int Users { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Total { get; set; }
    public decimal SarPerUsd { get; set; } = 3.75m;
    public string CompanyName { get; set; } = string.Empty;
    public string? TaxNo { get; set; }
    /// <summary>JSON: [{ branch, branchName, users, amount }]</summary>
    public string LinesJson { get; set; } = "[]";
    public string? Provider { get; set; }                        // sandbox | moyasar
    public string? ProviderRef { get; set; }                     // id of the hosted invoice / payment at the provider
    public string? PaymentUrl { get; set; }
    public string? Method { get; set; }                          // visa | mada | mastercard ... as reported by the provider
    public DateTime? PaidAt { get; set; }
}
