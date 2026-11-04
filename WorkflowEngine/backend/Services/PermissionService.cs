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
        ("finance",    new[] { "finance.view", "finance.create" }),
        ("hr",         new[] { "hr.view", "hr.create" }),
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
        "hr.view", "hr.create", TasksAct, "assistant.use"
    };

    /// <summary>Default privileges per role - used when a user has no custom list.</summary>
    public static readonly Dictionary<string, string[]> RoleDefaults = new(StringComparer.OrdinalIgnoreCase)
    {
        ["admin"] = Everything,
        ["manager"] = AllButAdmin,
        ["senior-manager"] = AllButAdmin,
        ["department-head"] = AllButAdmin,
        ["finance"] = new[] { "dashboard.view", "finance.view", "finance.create", "purchasing.view", "sales.view", "inventory.view",
                              TasksAct, DocumentsViewAll, "reports.view", "reports.export", "assistant.use" },
        ["procurement"] = new[] { "dashboard.view", "purchasing.view", "purchasing.create", "inventory.view", "finance.view",
                                  TasksAct, DocumentsViewAll, "reports.view", "assistant.use" },
        ["sales"] = new[] { "dashboard.view", "sales.view", "sales.create", "inventory.view", TasksAct, "reports.view", "assistant.use" },
        ["admin-stores"] = new[] { "dashboard.view", "inventory.view", "inventory.create", "purchasing.view", "sales.view",
                                   TasksAct, DocumentsViewAll, "reports.view", "assistant.use" },
        ["hr"] = new[] { "dashboard.view", "hr.view", "hr.create", TasksAct, DocumentsViewAll, "reports.view", "assistant.use" },
        ["it"] = new[] { "dashboard.view", "hr.view", "hr.create", "operations.view", TasksAct, "assistant.use" },
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
