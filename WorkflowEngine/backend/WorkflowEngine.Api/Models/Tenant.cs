namespace WorkflowEngine.Api.Models;

/// <summary>
/// A SaaS workspace: one customer organisation with its own users, companies and branches.
/// Existing databases get a single "default" workspace (unlimited plan) that owns all the users
/// that already exist, so nothing changes for a single-organisation install.
/// </summary>
public class Tenant
{
    public const string DefaultId = "default";

    public string Id { get; set; } = string.Empty;          // url-safe slug, e.g. "acme-holdings"
    public string Name { get; set; } = string.Empty;
    public string Plan { get; set; } = "starter";           // starter | business | enterprise
    // 0 = unlimited
    public int MaxUsers { get; set; }
    public int MaxCompanies { get; set; }
    public int MaxBranches { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A legal entity inside a workspace (a workspace can run several companies).</summary>
public class OrgCompany
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string TenantId { get; set; } = Tenant.DefaultId;
    public string Code { get; set; } = string.Empty;        // unique per workspace, e.g. MAIN
    public string Name { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string Currency { get; set; } = "SAR";
    public string? TaxNo { get; set; }
}

/// <summary>A branch (with its warehouse) of a company - the "branches" users add from the Admin module.</summary>
public class OrgBranch
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string TenantId { get; set; } = Tenant.DefaultId;
    public string Code { get; set; } = string.Empty;        // unique per workspace, e.g. RUH
    public string CompanyCode { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string Warehouse { get; set; } = string.Empty;
    public string? City { get; set; }
}
