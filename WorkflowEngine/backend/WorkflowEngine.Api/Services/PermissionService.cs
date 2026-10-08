using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

/// <summary>
/// User privileges for the ERP portal / mobile app (managed from the Admin module).
///
/// Each user has an optional <see cref="User.Permissions"/> list. When it is null the user
/// gets their ROLE's default privileges (<see cref="RoleDefaults"/>), so every existing user
/// keeps working without an admin doing anything. As soon as an admin saves a custom list for
/// someone, that list is used instead.
///
/// Privileges are read from the database on each check (not baked into the JWT), so a change
/// an admin makes applies on the user's very next request - no re-login needed. (A ROLE change
/// still needs a re-login, because task routing reads the role claim from the token.)
/// </summary>
public static class Permissions
{
    public const string AdminUsers = "admin.users";
    public const string OrgManage = "org.manage";
    public const string TasksAct = "tasks.act";
    public const string DocumentsViewAll = "documents.viewAll";
    public const string DocumentsCancelAny = "documents.cancelAny";

    /// <summary>Every privilege, grouped for the admin screen. Keys must match the portal/mobile apps.</summary>
    public static readonly (string Group, string[] Keys)[] Catalog =
    {
        ("dashboard",  new[] { "dashboard.view" }),
        ("sales",      new[] { "sales.view", "sales.create" }),
        ("purchasing", new[] { "purchasing.view", "purchasing.create" }),
        ("inventory",  new[] { "inventory.view", "inventory.create" }),
        ("finance",    new[] { "finance.view", "finance.create", "finance.reports.view", "finance.gl.view", "finance.gl.manage", "finance.gl.approve", "finance.ap.view", "finance.ap.manage", "finance.ap.approve", "finance.ar.view", "finance.ar.manage", "finance.bank.view", "finance.bank.manage", "finance.budget.view", "finance.budget.manage", "finance.assets.view", "finance.assets.manage", "finance.projects.view", "finance.projects.manage", "finance.setup", "finance.audit.view" }),
        ("hr",         new[] { "hr.view", "hr.create", "hr.reports.view", "hr.employees.view", "hr.employees.manage", "hr.employees.import", "hr.employees.salary",
                                       "hr.org.view", "hr.org.manage", "hr.leave.view", "hr.leave.approve", "hr.performance.view", "hr.performance.manage",
                                       "hr.recruitment.view", "hr.recruitment.manage", "hr.self" }),
        ("operations", new[] { "operations.view" }),
        ("documents",  new[] { TasksAct, DocumentsViewAll, DocumentsCancelAny }),
        ("reports",    new[] { "reports.view", "reports.export" }),
        ("assistant",  new[] { "assistant.use" }),
        ("org",        new[] { OrgManage }),
        ("admin",      new[] { AdminUsers }),
    };

    public static readonly HashSet<string> All = Catalog.SelectMany(g => g.Keys).ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static readonly string[] Everything = Catalog.SelectMany(g => g.Keys).ToArray();
    private static readonly string[] AllButAdmin = Everything.Where(k => k != AdminUsers && k != OrgManage).ToArray();

    private static readonly string[] EmployeeDefaults =
    {
        "dashboard.view", "purchasing.view", "purchasing.create", "finance.view", "finance.create",
        "hr.view", "hr.create", "hr.self", TasksAct, "assistant.use"
    };

    /// <summary>Everything in the HR workspace (HR officers and managers).</summary>
    private static readonly string[] HrAll =
    {
        "hr.view", "hr.create", "hr.reports.view", "hr.employees.view", "hr.employees.manage", "hr.employees.import", "hr.employees.salary",
        "hr.org.view", "hr.org.manage", "hr.leave.view", "hr.leave.approve", "hr.performance.view", "hr.performance.manage",
        "hr.recruitment.view", "hr.recruitment.manage", "hr.self"
    };

    /// <summary>Default privileges per role - used when a user has no custom list.</summary>
    public static readonly Dictionary<string, string[]> RoleDefaults = new(StringComparer.OrdinalIgnoreCase)
    {
        ["admin"] = Everything,
        ["manager"] = AllButAdmin,
        ["senior-manager"] = AllButAdmin,
        ["department-head"] = AllButAdmin,
        ["finance"] = new[] { "finance.reports.view", "finance.gl.view", "finance.gl.manage", "finance.gl.approve", "finance.ap.view", "finance.ap.manage", "finance.ap.approve", "finance.ar.view", "finance.ar.manage", "finance.bank.view", "finance.bank.manage", "finance.budget.view", "finance.budget.manage", "finance.assets.view", "finance.assets.manage", "finance.projects.view", "finance.projects.manage", "finance.setup", "finance.audit.view", "dashboard.view", "hr.self", "finance.view", "finance.create", "purchasing.view", "sales.view", "inventory.view",
                              TasksAct, DocumentsViewAll, "reports.view", "reports.export", "assistant.use" },
        ["procurement"] = new[] { "finance.ap.view", "finance.ap.manage", "dashboard.view", "hr.self", "purchasing.view", "purchasing.create", "inventory.view", "finance.view",
                                  TasksAct, DocumentsViewAll, "reports.view", "assistant.use" },
        ["sales"] = new[] { "finance.ar.view", "finance.ar.manage", "dashboard.view", "hr.self", "sales.view", "sales.create", "inventory.view", TasksAct, "reports.view", "assistant.use" },
        ["admin-stores"] = new[] { "dashboard.view", "hr.self", "inventory.view", "inventory.create", "purchasing.view", "sales.view",
                                   TasksAct, DocumentsViewAll, "reports.view", "assistant.use" },
        ["hr"] = HrAll.Concat(new[] { "dashboard.view", TasksAct, DocumentsViewAll, "reports.view", "assistant.use" }).ToArray(),
        ["it"] = new[] { "dashboard.view", "hr.view", "hr.create", "hr.self", "operations.view", TasksAct, "assistant.use" },
        ["employee"] = EmployeeDefaults,
    };

    public static string[] DefaultsFor(string? role)
        => role != null && RoleDefaults.TryGetValue(role, out var p) ? p : EmployeeDefaults;

    public static List<string> Effective(User user)
        => (user.Permissions ?? DefaultsFor(user.Role).ToList()).Where(All.Contains).Distinct().ToList();

    /// <summary>Drops unknown keys so a client can't invent privileges.</summary>
    public static List<string> Sanitize(IEnumerable<string>? keys)
        => (keys ?? Enumerable.Empty<string>()).Where(All.Contains).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
}

public interface IPermissionService
{
    Task<List<string>> EffectiveFor(ClaimsPrincipal principal);
    Task<bool> Has(ClaimsPrincipal principal, string permission);
}

public class PermissionService : IPermissionService
{
    private readonly WorkflowDbContext _db;
    public PermissionService(WorkflowDbContext db) { _db = db; }

    public async Task<List<string>> EffectiveFor(ClaimsPrincipal principal)
    {
        var username = principal.FindFirstValue(ClaimTypes.Name);
        if (string.IsNullOrEmpty(username)) return new List<string>();
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Username == username && u.IsActive);
        return user == null ? new List<string>() : Permissions.Effective(user);
    }

    public async Task<bool> Has(ClaimsPrincipal principal, string permission)
        => (await EffectiveFor(principal)).Contains(permission, StringComparer.OrdinalIgnoreCase);
}
