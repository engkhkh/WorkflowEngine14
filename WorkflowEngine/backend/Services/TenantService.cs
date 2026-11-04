using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

public enum PlanLimit { Users, Companies, Branches }

/// <summary>What each SaaS plan allows (0 = unlimited). There is no billing here - plan changes are made by whoever operates the platform.</summary>
public static class Plans
{
    public static void Apply(Tenant t, string plan)
    {
        t.Plan = plan;
        (t.MaxUsers, t.MaxCompanies, t.MaxBranches) = plan switch
        {
            "business" => (50, 5, 25),
            "enterprise" => (0, 0, 0),
            _ => (5, 1, 3),            // starter
        };
    }
}

public interface ITenantScope
{
    /// <summary>The workspace of the signed-in user ("default" for installs that predate workspaces).</summary>
    Task<string> TenantIdOf(ClaimsPrincipal principal);
    /// <summary>Does this workflow instance belong to the caller's workspace? (Decided by who started it.) Unknown ids return true so callers keep their normal 404 handling.</summary>
    Task<bool> OwnsInstance(ClaimsPrincipal principal, string instanceId);
    /// <summary>Ids of all instances started by users of the caller's workspace.</summary>
    Task<HashSet<string>> VisibleInstanceIds(ClaimsPrincipal principal);
    /// <summary>Is there room under the workspace's plan to add one more user / company / branch?</summary>
    Task<(bool ok, string message)> CheckLimit(string tenantId, PlanLimit what);
}

public class TenantScope : ITenantScope
{
    private readonly WorkflowDbContext _db;
    private string? _cached;
    public TenantScope(WorkflowDbContext db) { _db = db; }

    public async Task<string> TenantIdOf(ClaimsPrincipal principal)
    {
        if (_cached != null) return _cached;
        var username = principal.FindFirstValue(ClaimTypes.Name);
        var id = string.IsNullOrEmpty(username)
            ? null
            : await _db.Users.AsNoTracking().Where(u => u.Username == username).Select(u => u.TenantId).FirstOrDefaultAsync();
        return _cached = string.IsNullOrEmpty(id) ? Tenant.DefaultId : id;
    }

    private async Task<string> TenantOfUsername(string? username)
    {
        if (string.IsNullOrEmpty(username)) return Tenant.DefaultId;
        var id = await _db.Users.AsNoTracking().Where(u => u.Username == username).Select(u => u.TenantId).FirstOrDefaultAsync();
        return string.IsNullOrEmpty(id) ? Tenant.DefaultId : id;
    }

    public async Task<bool> OwnsInstance(ClaimsPrincipal principal, string instanceId)
    {
        var startedBy = await _db.Instances.AsNoTracking().Where(i => i.Id == instanceId).Select(i => i.StartedBy).FirstOrDefaultAsync();
        if (startedBy == null) return true;
        return await TenantOfUsername(startedBy) == await TenantIdOf(principal);
    }

    public async Task<HashSet<string>> VisibleInstanceIds(ClaimsPrincipal principal)
    {
        var mine = await TenantIdOf(principal);
        var tenantByUser = await _db.Users.AsNoTracking().Select(u => new { u.Username, u.TenantId }).ToListAsync();
        var map = tenantByUser.ToDictionary(u => u.Username, u => string.IsNullOrEmpty(u.TenantId) ? Tenant.DefaultId : u.TenantId, StringComparer.OrdinalIgnoreCase);
        var started = await _db.Instances.AsNoTracking().Select(i => new { i.Id, i.StartedBy }).ToListAsync();
        return started
            .Where(i => (i.StartedBy != null && map.TryGetValue(i.StartedBy, out var t) ? t : Tenant.DefaultId) == mine)
            .Select(i => i.Id)
            .ToHashSet();
    }

    public async Task<(bool ok, string message)> CheckLimit(string tenantId, PlanLimit what)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId);
        if (tenant == null) return (true, string.Empty);
        var (max, used, label) = what switch
        {
            PlanLimit.Users => (tenant.MaxUsers, await _db.Users.CountAsync(u => u.TenantId == tenantId), "users"),
            PlanLimit.Companies => (tenant.MaxCompanies, await _db.OrgCompanies.CountAsync(c => c.TenantId == tenantId), "companies"),
            _ => (tenant.MaxBranches, await _db.OrgBranches.CountAsync(b => b.TenantId == tenantId), "branches"),
        };
        return max > 0 && used >= max
            ? (false, $"Your {tenant.Plan} plan allows {max} {label}. Contact us to upgrade.")
            : (true, string.Empty);
    }

    /// <summary>First start: the "default" workspace (unlimited) with the demo companies/branches, so single-organisation installs behave exactly as before.</summary>
    public static async Task SeedDefaults(WorkflowDbContext db)
    {
        if (!await db.Tenants.AnyAsync(t => t.Id == Tenant.DefaultId))
        {
            var t = new Tenant { Id = Tenant.DefaultId, Name = "WorkflowEngine" };
            Plans.Apply(t, "enterprise");
            db.Tenants.Add(t);
        }
        if (!await db.OrgCompanies.AnyAsync(c => c.TenantId == Tenant.DefaultId))
        {
            db.OrgCompanies.AddRange(
                new OrgCompany { Code = "MAIN", Name = "Main Company", NameAr = "الشركة الرئيسية", Currency = "SAR" },
                new OrgCompany { Code = "TRD", Name = "Trading Co.", NameAr = "شركة التجارة", Currency = "SAR" });
            db.OrgBranches.AddRange(
                new OrgBranch { Code = "RUH", CompanyCode = "MAIN", Name = "Riyadh", NameAr = "الرياض", Warehouse = "WH-RUH Main", City = "Riyadh" },
                new OrgBranch { Code = "JED", CompanyCode = "MAIN", Name = "Jeddah", NameAr = "جدة", Warehouse = "WH-JED", City = "Jeddah" },
                new OrgBranch { Code = "DMM", CompanyCode = "MAIN", Name = "Dammam", NameAr = "الدمام", Warehouse = "WH-DMM", City = "Dammam" },
                new OrgBranch { Code = "RUH2", CompanyCode = "TRD", Name = "Riyadh – Trading", NameAr = "الرياض – التجارة", Warehouse = "WH-TRD Riyadh", City = "Riyadh" });
        }
        await db.SaveChangesAsync();
    }
}
