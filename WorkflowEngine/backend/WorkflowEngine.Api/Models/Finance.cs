using System.Text.Json.Serialization;

namespace WorkflowEngine.Api.Models;

/// <summary>
/// One table for the finance records (chart of accounts, periods, journals, supplier / customer invoices, bank accounts and
/// transactions, budgets, fixed assets, projects, currencies, tax codes, cost centres, settings).
/// The varying fields live in <see cref="Data"/> (JSON); Kind / Code / Company / Status are real columns so they can be filtered.
/// </summary>
public class FinRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [JsonIgnore] public string TenantId { get; set; } = Tenant.DefaultId;
    public string Kind { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? Company { get; set; }          // OrgCompany code; empty = shared by every company of the workspace
    public string? Status { get; set; }
    public string Data { get; set; } = "{}";
    public string? CreatedBy { get; set; }
    public string? ApprovedBy { get; set; }       // who approved / posted it (segregation of duties)
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>Who did what to which finance record, and when (the audit trail).</summary>
public class FinAudit
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [JsonIgnore] public string TenantId { get; set; } = Tenant.DefaultId;
    public string Kind { get; set; } = string.Empty;
    public string RecordId { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string Action { get; set; } = string.Empty;     // Created | Updated | StatusChanged | Deleted
    public string UserName { get; set; } = string.Empty;
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string? Summary { get; set; }
}
