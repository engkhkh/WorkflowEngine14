using Microsoft.Extensions.Caching.Memory;
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
    public static readonly (string Group, string[] Keys)[] CodeCatalog =
    {
        ("dashboard",  new[] { "dashboard.view" }),
        ("sales",      new[] { "sales.view", "sales.create" }),
        ("purchasing", new[] { "purchasing.view", "purchasing.create" }),
        ("inventory",  new[] { "inventory.view", "inventory.create" }),
        ("pos",        new[] { "pos.view", "pos.sell", "pos.discount", "pos.refund", "pos.void", "pos.shifts.manage", "pos.products.manage", "pos.customers.manage", "pos.promotions.manage", "pos.stock.view", "pos.stock.manage", "pos.reports.view", "pos.setup" }),
            ("manufacturing", new[] { "mfg.view", "mfg.bom.manage", "mfg.orders.manage", "mfg.orders.execute", "mfg.planning", "mfg.quality.manage", "mfg.maintenance.manage", "mfg.costing.view", "mfg.reports.view", "mfg.setup" }),
        ("projects",   new[] { "prj.view", "prj.manage", "prj.tasks.manage", "prj.resources.manage", "prj.time.log", "prj.time.approve", "prj.costs.manage", "prj.billing", "prj.reports.view" }),
        ("crm",        new[] { "crm.view", "crm.leads.manage", "crm.accounts.manage", "crm.opps.manage", "crm.activities.manage", "crm.quotes.manage", "crm.campaigns.manage", "crm.reports.view", "crm.setup" }),
        ("procurement", new[] { "proc.view", "proc.req.manage", "proc.req.approve", "proc.rfq.manage", "proc.po.manage", "proc.po.approve", "proc.po.selfApprove", "proc.receive", "proc.invoice", "proc.contracts.manage", "proc.suppliers.manage", "proc.reports.view", "proc.setup" }),
        ("supplychain", new[] { "scm.view", "scm.planning", "scm.shipments.manage", "scm.reports.view", "scm.setup" }),
        ("warehouse",  new[] { "wh.view", "wh.pick.manage", "wh.count.manage", "wh.count.approve", "wh.lots.manage", "wh.reports.view", "wh.setup" }),
        ("assets",     new[] { "ast.view", "ast.assets.manage", "ast.plans.manage", "ast.orders.manage", "ast.reports.view", "ast.setup" }),
        ("payroll",    new[] { "pay.self", "pay.view", "pay.payslips.view", "pay.run.manage", "pay.run.approve", "pay.post", "pay.reports.view", "pay.setup" }),
        ("archive",    new[] { "arc.view", "arc.incoming.manage", "arc.outgoing.manage", "arc.outgoing.approve", "arc.docs.manage", "arc.confidential", "arc.dispose", "arc.secretary.manage", "arc.reports.view", "arc.setup" }),
        ("realestate", new[] { "re.view", "re.properties.manage", "re.units.manage", "re.leases.manage", "re.leases.approve", "re.collect", "re.sales.manage", "re.maintenance.manage", "re.reports.view", "re.setup" }),
        ("governance", new[] { "gov.view", "gov.audit.view", "gov.rules.manage", "gov.approvals.admin", "gov.delegate", "gov.fields.manage", "gov.lock.manage", "gov.lock.override", "gov.zatca.manage", "gov.vat.view" }),
        ("epm",        new[] { "epm.view", "epm.plans.manage", "epm.plans.approve", "epm.forecast.manage", "epm.publish", "epm.reports.view", "epm.setup" }),
        ("bpm",        new[] { "bpm.view", "bpm.manage", "bpm.monitor" }),
        ("integration", new[] { "int.view", "int.keys.manage", "int.hooks.manage" }),
        ("bi",         new[] { "bi.view", "bi.reports.manage", "bi.ai.use" }),
        ("finance",    new[] { "finance.view", "finance.create", "finance.reports.view", "finance.gl.view", "finance.gl.manage", "finance.gl.approve", "finance.ap.view", "finance.ap.manage", "finance.ap.approve", "finance.ar.view", "finance.ar.manage", "finance.bank.view", "finance.bank.manage", "finance.budget.view", "finance.budget.manage", "finance.assets.view", "finance.assets.manage", "finance.projects.view", "finance.projects.manage", "finance.setup", "finance.audit.view" }),
        ("hr",         new[] { "hr.view", "hr.create", "hr.reports.view", "hr.employees.view", "hr.employees.manage", "hr.employees.import", "hr.employees.salary",
                                       "hr.org.view", "hr.org.manage", "hr.leave.view", "hr.leave.approve", "hr.performance.view", "hr.performance.manage",
                                       "hr.recruitment.view", "hr.recruitment.manage", "hr.self" }),
        ("operations", new[] { "operations.view" }),
        ("documents",  new[] { TasksAct, DocumentsViewAll, DocumentsCancelAny }),
        ("reports",    new[] { "reports.view", "reports.export" }),
        ("assistant",  new[] { "assistant.use" }),
        ("website",    new[] { "web.view", "web.edit", "web.publish", "web.orders.manage" }),
        ("workflow",   new[] { "wf.view", "wf.design", "wf.publish", "wf.instances.view" }),
        ("hospital",   new[] { "hos.view", "hos.patients.view", "hos.patients.manage", "hos.appointments.view", "hos.appointments.manage", "hos.clinical.view", "hos.clinical.manage", "hos.prescribe",
                               "hos.lab.view", "hos.lab.order", "hos.lab.result", "hos.pharmacy.view", "hos.pharmacy.dispense", "hos.pharmacy.stock", "hos.wards.view", "hos.wards.manage",
                               "hos.billing.view", "hos.billing.manage", "hos.reports.view", "hos.setup" }),
        ("calendar",   new[] { "cal.view", "cal.events.manage", "cal.meetings.host", "cal.meetings.join", "cal.settings" }),
        ("muslim",     new[] { "mus.view" }),
        ("custom",     new[] { "cus.view", "cus.manage", "cus.design" }),
        ("org",        new[] { OrgManage }),
        ("admin",      new[] { AdminUsers }),
    };

    private static readonly HashSet<string> CodeAll = CodeCatalog.SelectMany(g => g.Keys).ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>Every privilege that exists (from the database once loaded, else the built-in list).</summary>
    public static HashSet<string> All => RbacStore.Current?.Active ?? CodeAll;

    /// <summary>The built-in catalog (kept for callers that do not know the workspace; the Admin module uses <see cref="RbacStore.CatalogFor"/>).</summary>
    public static (string Group, string[] Keys)[] Catalog => CodeCatalog;

    private static readonly string[] Everything = CodeCatalog.SelectMany(g => g.Keys).ToArray();
    // approving anything / overriding a locked period stay with the administrator unless a role is given them on purpose
    private static readonly string[] AllButAdmin = Everything.Where(k => k != AdminUsers && k != OrgManage && k != "gov.approvals.admin" && k != "gov.lock.override").ToArray();

    // everybody can see their approval requests and hand their approvals to a colleague while away
    static Permissions()
    {
        foreach (var role in CodeRoleDefaults.Keys.ToList())
            CodeRoleDefaults[role] = CodeRoleDefaults[role].Concat(new[] { "gov.view", "gov.delegate" }).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        CodeRoleDefaults["finance"] = CodeRoleDefaults["finance"].Concat(new[] { "gov.audit.view", "gov.vat.view", "gov.zatca.manage" }).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static readonly string[] EmployeeDefaults =
    {
        "dashboard.view", "purchasing.view", "purchasing.create", "finance.view", "finance.create", "prj.view", "prj.time.log", "pay.self",
        "hr.view", "hr.create", "hr.self", TasksAct, "assistant.use",
        "cal.view", "cal.events.manage", "cal.meetings.host", "cal.meetings.join", "mus.view", "cus.view"
    };

    /// <summary>Everything in the HR workspace (HR officers and managers).</summary>
    private static readonly string[] HrAll =
    {
        "hr.view", "hr.create", "hr.reports.view", "hr.employees.view", "hr.employees.manage", "hr.employees.import", "hr.employees.salary",
        "hr.org.view", "hr.org.manage", "hr.leave.view", "hr.leave.approve", "hr.performance.view", "hr.performance.manage",
        "hr.recruitment.view", "hr.recruitment.manage", "hr.self"
    };

    /// <summary>Default privileges per role - used when a user has no custom list.</summary>
    public static readonly Dictionary<string, string[]> CodeRoleDefaults = new(StringComparer.OrdinalIgnoreCase)
    {
        ["admin"] = Everything,
        ["manager"] = AllButAdmin,
        ["senior-manager"] = AllButAdmin,
        ["department-head"] = AllButAdmin,
        ["finance"] = new[] { "proc.view", "proc.invoice", "proc.reports.view", "wh.view", "wh.reports.view", "ast.view", "ast.reports.view", "pay.self", "pay.view", "pay.payslips.view", "pay.run.approve", "pay.post", "pay.reports.view", "epm.view", "epm.plans.manage", "epm.plans.approve", "epm.forecast.manage", "epm.publish", "epm.reports.view", "bi.view", "bi.ai.use", "scm.view", "prj.view", "prj.billing", "prj.reports.view", "prj.costs.manage", "mfg.view", "mfg.costing.view", "mfg.reports.view", "crm.view", "pos.view", "pos.reports.view", "finance.reports.view", "finance.gl.view", "finance.gl.manage", "finance.gl.approve", "finance.ap.view", "finance.ap.manage", "finance.ap.approve", "finance.ar.view", "finance.ar.manage", "finance.bank.view", "finance.bank.manage", "finance.budget.view", "finance.budget.manage", "finance.assets.view", "finance.assets.manage", "finance.projects.view", "finance.projects.manage", "finance.setup", "finance.audit.view", "dashboard.view", "hr.self", "finance.view", "finance.create", "purchasing.view", "sales.view", "inventory.view",
                              TasksAct, DocumentsViewAll, "reports.view", "reports.export", "assistant.use" },
        ["procurement"] = new[] { "proc.view", "proc.req.manage", "proc.req.approve", "proc.rfq.manage", "proc.po.manage", "proc.po.approve", "proc.receive", "proc.invoice", "proc.contracts.manage", "proc.suppliers.manage", "proc.reports.view", "scm.view", "scm.planning", "scm.shipments.manage", "scm.reports.view", "scm.setup", "wh.view", "wh.reports.view", "bi.view", "mfg.view", "mfg.planning", "mfg.bom.manage", "prj.view", "prj.costs.manage", "finance.ap.view", "finance.ap.manage", "dashboard.view", "hr.self", "purchasing.view", "purchasing.create", "inventory.view", "finance.view",
                                  TasksAct, DocumentsViewAll, "reports.view", "assistant.use" },
        ["sales"] = new[] { "scm.view", "bi.view", "crm.view", "crm.leads.manage", "crm.accounts.manage", "crm.opps.manage", "crm.activities.manage", "crm.quotes.manage", "crm.campaigns.manage", "crm.reports.view", "prj.view", "pos.view", "pos.sell", "pos.stock.view", "finance.ar.view", "finance.ar.manage", "dashboard.view", "hr.self", "sales.view", "sales.create", "inventory.view", TasksAct, "reports.view", "assistant.use" },
        ["admin-stores"] = new[] { "proc.view", "proc.receive", "scm.view", "scm.shipments.manage", "wh.view", "wh.pick.manage", "wh.count.manage", "wh.count.approve", "wh.lots.manage", "wh.reports.view", "ast.view", "ast.orders.manage", "ast.assets.manage", "ast.plans.manage", "ast.reports.view", "mfg.view", "mfg.orders.execute", "mfg.quality.manage", "mfg.maintenance.manage", "pos.view", "pos.stock.view", "pos.stock.manage", "pos.products.manage", "dashboard.view", "hr.self", "inventory.view", "inventory.create", "purchasing.view", "sales.view",
                                   TasksAct, DocumentsViewAll, "reports.view", "assistant.use" },
        ["hr"] = HrAll.Concat(new[] { "prj.view", "prj.time.log", "pay.self", "pay.view", "pay.payslips.view", "pay.run.manage", "pay.reports.view", "pay.setup", "dashboard.view", TasksAct, DocumentsViewAll, "reports.view", "assistant.use" }).ToArray(),
        ["it"] = new[] { "prj.view", "prj.time.log", "int.view", "int.keys.manage", "int.hooks.manage", "bpm.view", "dashboard.view", "hr.view", "hr.create", "hr.self", "operations.view", TasksAct, "assistant.use" },
        ["employee"] = EmployeeDefaults,
        // real estate: manager (everything) and leasing agent (units, tenants, leases, collection; no approvals)
        ["realestate"] = new[] { "re.view", "re.properties.manage", "re.units.manage", "re.leases.manage", "re.leases.approve", "re.collect", "re.sales.manage", "re.maintenance.manage", "re.reports.view", "re.setup", "dashboard.view", "hr.self", "cal.view", "crm.view", "reports.view", "assistant.use", TasksAct, DocumentsViewAll },
        ["leasing-agent"] = new[] { "re.view", "re.units.manage", "re.leases.manage", "re.collect", "re.sales.manage", "re.maintenance.manage", "re.reports.view", "dashboard.view", "hr.self", "cal.view", TasksAct },
        // secretary / archivist: mail in and out, the archive (not confidential papers, not disposal), appointments, visitors, to-dos
        ["secretary"] = new[] { "arc.view", "arc.incoming.manage", "arc.outgoing.manage", "arc.docs.manage", "arc.secretary.manage", "arc.reports.view", "dashboard.view", "hr.self", "cal.view", "cal.events.manage", "cal.meetings.host", "cal.meetings.join", TasksAct, DocumentsViewAll, "reports.view", "assistant.use" },
        // hospital staff presets (an admin can still tailor every user's privileges one by one)
        ["doctor"] = new[] { "hos.view", "hos.patients.view", "hos.appointments.view", "hos.clinical.view", "hos.clinical.manage", "hos.prescribe", "hos.lab.view", "hos.lab.order", "hos.pharmacy.view", "hos.wards.view", "hos.reports.view", "dashboard.view", "hr.self", TasksAct, "assistant.use" },
        ["nurse"] = new[] { "hos.view", "hos.patients.view", "hos.appointments.view", "hos.clinical.view", "hos.clinical.manage", "hos.lab.view", "hos.pharmacy.view", "hos.wards.view", "hos.wards.manage", "dashboard.view", "hr.self", TasksAct },
        ["pharmacist"] = new[] { "hos.view", "hos.patients.view", "hos.pharmacy.view", "hos.pharmacy.dispense", "hos.pharmacy.stock", "dashboard.view", "hr.self", TasksAct },
        ["lab-technician"] = new[] { "hos.view", "hos.patients.view", "hos.lab.view", "hos.lab.result", "dashboard.view", "hr.self", TasksAct },
        ["receptionist"] = new[] { "hos.view", "hos.patients.view", "hos.patients.manage", "hos.appointments.view", "hos.appointments.manage", "hos.billing.view", "hos.billing.manage", "dashboard.view", "hr.self", TasksAct },
    };

    /// <summary>The platform-default roles as shipped in code (the seed of the RoleDefs table).</summary>
    public static Dictionary<string, string[]> RoleDefaults => RbacStore.RolesFor(Tenant.DefaultId);

    public static string[] CodeDefaultsFor(string? role)
        => role != null && CodeRoleDefaults.TryGetValue(role, out var p) ? p : EmployeeDefaults;

    /// <summary>What a role gets by default in a workspace - read from the database.</summary>
    public static string[] DefaultsFor(string? role, string tenantId = Tenant.DefaultId) => RbacStore.RoleFor(tenantId, role);

    public static List<string> Effective(User user)
        => (user.Permissions ?? DefaultsFor(user.Role, user.TenantId).ToList()).Where(k => All.Contains(k) && RbacStore.IsOn(user.TenantId, k)).Distinct().ToList();

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
    private readonly IMemoryCache _cache;
    public PermissionService(WorkflowDbContext db, IMemoryCache cache) { _db = db; _cache = cache; }

    public async Task<List<string>> EffectiveFor(ClaimsPrincipal principal)
    {
        var username = principal.FindFirstValue(ClaimTypes.Name);
        if (string.IsNullOrEmpty(username)) return new List<string>();
        var key = "perm-eff:" + username;
        if (_cache.TryGetValue(key, out List<string>? hit) && hit != null) return hit;
        await RbacStore.EnsureFresh(_db);
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Username == username && u.IsActive);
        var res = user == null ? new List<string>() : Permissions.Effective(user);
        _cache.Set(key, res, TimeSpan.FromSeconds(10));
        return res;
    }

    public async Task<bool> Has(ClaimsPrincipal principal, string permission)
        => (await EffectiveFor(principal)).Contains(permission, StringComparer.OrdinalIgnoreCase);
}
