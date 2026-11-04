"""Usage: python patch.py <backend/WorkflowEngine.Api folder>
Adds Manufacturing / Projects / CRM and the database-stored privilege catalog + roles. Idempotent; run after backend-pos/patch.py."""
import sys, re
base = sys.argv[1]

def rw(path, fn):
    s = open(path, encoding='utf-8-sig').read()
    n = fn(s)
    if n != s:
        open(path, 'w', encoding='utf-8').write(n); print('patched  ', path)
    else:
        print('unchanged', path)

def need(s, a, what):
    if a not in s: raise SystemExit('anchor not found (%s): %s' % (what, a[:60]))

def q(keys): return ", ".join('"%s"' % k for k in keys)

# ------------------------------------------------------------------ DbContext
def ctx(s):
    if 'ErpRecords' in s: return s
    a = "    public DbSet<FinAudit> FinAudits => Set<FinAudit>();"
    need(s, a, 'FinAudits')
    s = s.replace(a, a + "\n    public DbSet<ErpRecord> ErpRecords => Set<ErpRecord>();\n    public DbSet<PermissionDef> PermissionDefs => Set<PermissionDef>();\n    public DbSet<RoleDef> RoleDefs => Set<RoleDef>();", 1)
    a = "        modelBuilder.Entity<FinRecord>(e =>"
    need(s, a, 'FinRecord entity')
    s = s.replace(a, """        // Manufacturing / Projects / CRM records and the database-stored privilege catalog + roles (tables created by SchemaUpgrade)
        modelBuilder.Entity<ErpRecord>(e => { e.HasKey(x => x.Id); e.HasIndex(x => new { x.TenantId, x.Module, x.Kind }); });
        modelBuilder.Entity<PermissionDef>(e => { e.HasKey(x => x.Id); e.HasIndex(x => new { x.TenantId, x.Key }).IsUnique(); });
        modelBuilder.Entity<RoleDef>(e => { e.HasKey(x => x.Id); e.HasIndex(x => new { x.TenantId, x.Role }).IsUnique(); });

""" + a, 1)
    return s
rw(base + '/Data/WorkflowDbContext.cs', ctx)

# ------------------------------------------------------------------ SchemaUpgrade
def su(s):
    if 'ErpRecords' in s: return s
    add = '''
        // Manufacturing / Projects / CRM: one generic record table
        "IF OBJECT_ID('dbo.ErpRecords','U') IS NULL CREATE TABLE dbo.ErpRecords (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_ErpRecords PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Module] nvarchar(450) NOT NULL, [Kind] nvarchar(450) NOT NULL, " +
            "[Code] nvarchar(450) NULL, [Company] nvarchar(450) NULL, [Branch] nvarchar(450) NULL, [Status] nvarchar(450) NULL, " +
            "[Ref] nvarchar(450) NULL, [Parent] nvarchar(450) NULL, [Data] nvarchar(max) NOT NULL, " +
            "[CreatedBy] nvarchar(450) NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpRecords_Tenant_Module_Kind') CREATE INDEX IX_ErpRecords_Tenant_Module_Kind ON dbo.ErpRecords ([TenantId], [Module], [Kind]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpRecords_Ref') CREATE INDEX IX_ErpRecords_Ref ON dbo.ErpRecords ([TenantId], [Ref]);",

        // Admin module: privilege / page catalog and role defaults stored in the database
        "IF OBJECT_ID('dbo.PermissionDefs','U') IS NULL CREATE TABLE dbo.PermissionDefs (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_PermissionDefs PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Key] nvarchar(450) NOT NULL, " +
            "[Group] nvarchar(450) NOT NULL, [Label] nvarchar(max) NULL, [Route] nvarchar(max) NULL, [SortOrder] int NOT NULL, [IsActive] bit NOT NULL, [IsCustom] bit NOT NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PermissionDefs_TenantId_Key') CREATE UNIQUE INDEX IX_PermissionDefs_TenantId_Key ON dbo.PermissionDefs ([TenantId], [Key]);",
        "IF OBJECT_ID('dbo.RoleDefs','U') IS NULL CREATE TABLE dbo.RoleDefs (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_RoleDefs PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Role] nvarchar(450) NOT NULL, " +
            "[Name] nvarchar(max) NULL, [Permissions] nvarchar(max) NOT NULL, [IsSystem] bit NOT NULL, [UpdatedAt] datetime2 NOT NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RoleDefs_TenantId_Role') CREATE UNIQUE INDEX IX_RoleDefs_TenantId_Role ON dbo.RoleDefs ([TenantId], [Role]);",
'''
    i = s.index("    };\n\n    public static async Task Apply")
    return s[:i] + add + s[i:]
rw(base + '/Services/SchemaUpgrade.cs', su)

# ------------------------------------------------------------------ PermissionService
MFG = ["mfg.view","mfg.bom.manage","mfg.orders.manage","mfg.orders.execute","mfg.planning","mfg.quality.manage","mfg.maintenance.manage","mfg.costing.view","mfg.reports.view","mfg.setup"]
PRJ = ["prj.view","prj.manage","prj.tasks.manage","prj.resources.manage","prj.time.log","prj.time.approve","prj.costs.manage","prj.billing","prj.reports.view"]
CRM = ["crm.view","crm.leads.manage","crm.accounts.manage","crm.opps.manage","crm.activities.manage","crm.quotes.manage","crm.campaigns.manage","crm.reports.view","crm.setup"]
CRM_SALES = [k for k in CRM if k != "crm.setup"]
PROC = ["proc.view","proc.req.manage","proc.req.approve","proc.rfq.manage","proc.po.manage","proc.po.approve","proc.po.selfApprove","proc.receive","proc.invoice","proc.contracts.manage","proc.suppliers.manage","proc.reports.view","proc.setup"]
SCM = ["scm.view","scm.planning","scm.shipments.manage","scm.reports.view","scm.setup"]
WH = ["wh.view","wh.pick.manage","wh.count.manage","wh.count.approve","wh.reports.view","wh.setup"]
AST = ["ast.view","ast.assets.manage","ast.plans.manage","ast.orders.manage","ast.reports.view","ast.setup"]
PAY = ["pay.self","pay.view","pay.payslips.view","pay.run.manage","pay.run.approve","pay.post","pay.reports.view","pay.setup"]
EPM = ["epm.view","epm.plans.manage","epm.plans.approve","epm.forecast.manage","epm.publish","epm.reports.view","epm.setup"]
BPM = ["bpm.view","bpm.manage","bpm.monitor"]
INT = ["int.view","int.keys.manage","int.hooks.manage"]
BI = ["bi.view","bi.reports.manage","bi.ai.use"]

def pm(s):
    if 'CodeCatalog' in s: return s
    need(s, "public static readonly (string Group, string[] Keys)[] Catalog =", 'Catalog')
    s = s.replace("public static readonly (string Group, string[] Keys)[] Catalog =", "public static readonly (string Group, string[] Keys)[] CodeCatalog =", 1)
    a = '("finance",    new[] {'
    need(s, a, 'finance group')
    i = s.index(a)
    s = s[:i] + '("manufacturing", new[] { %s }),\n        ("projects",   new[] { %s }),\n        ("crm",        new[] { %s }),\n        ("procurement", new[] { %s }),\n        ("supplychain", new[] { %s }),\n        ("warehouse",  new[] { %s }),\n        ("assets",     new[] { %s }),\n        ("payroll",    new[] { %s }),\n        ("epm",        new[] { %s }),\n        ("bpm",        new[] { %s }),\n        ("integration", new[] { %s }),\n        ("bi",         new[] { %s }),\n        ' % (q(MFG), q(PRJ), q(CRM), q(PROC), q(SCM), q(WH), q(AST), q(PAY), q(EPM), q(BPM), q(INT), q(BI)) + s[i:]
    # catalog / All / defaults now come from the database (RbacStore) with the code lists as the seed + fallback
    a = "    public static readonly HashSet<string> All = Catalog.SelectMany(g => g.Keys).ToHashSet(StringComparer.OrdinalIgnoreCase);"
    need(s, a, 'All')
    s = s.replace(a, """    private static readonly HashSet<string> CodeAll = CodeCatalog.SelectMany(g => g.Keys).ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>Every privilege that exists (from the database once loaded, else the built-in list).</summary>
    public static HashSet<string> All => RbacStore.Current?.Active ?? CodeAll;

    /// <summary>The built-in catalog (kept for callers that do not know the workspace; the Admin module uses <see cref="RbacStore.CatalogFor"/>).</summary>
    public static (string Group, string[] Keys)[] Catalog => CodeCatalog;""", 1)
    s = s.replace("Everything = Catalog.SelectMany", "Everything = CodeCatalog.SelectMany", 1)
    s = s.replace("public static readonly Dictionary<string, string[]> RoleDefaults = new(StringComparer.OrdinalIgnoreCase)", "public static readonly Dictionary<string, string[]> CodeRoleDefaults = new(StringComparer.OrdinalIgnoreCase)", 1)
    need(s, "    public static string[] DefaultsFor(string? role)", 'DefaultsFor')
    s = re.sub(r"    public static string\[\] DefaultsFor\(string\? role\)\n        => role != null && RoleDefaults\.TryGetValue\(role, out var p\) \? p : EmployeeDefaults;",
        """    /// <summary>The platform-default roles as shipped in code (the seed of the RoleDefs table).</summary>
    public static Dictionary<string, string[]> RoleDefaults => RbacStore.RolesFor(Tenant.DefaultId);

    public static string[] CodeDefaultsFor(string? role)
        => role != null && CodeRoleDefaults.TryGetValue(role, out var p) ? p : EmployeeDefaults;

    /// <summary>What a role gets by default in a workspace - read from the database.</summary>
    public static string[] DefaultsFor(string? role, string tenantId = Tenant.DefaultId) => RbacStore.RoleFor(tenantId, role);""", s, count=1)
    s = s.replace("=> (user.Permissions ?? DefaultsFor(user.Role).ToList()).Where(All.Contains).Distinct().ToList();",
                  "=> (user.Permissions ?? DefaultsFor(user.Role, user.TenantId).ToList()).Where(k => All.Contains(k) && RbacStore.IsOn(user.TenantId, k)).Distinct().ToList();", 1)
    s = s.replace("        var username = principal.FindFirstValue(ClaimTypes.Name);\n        if (string.IsNullOrEmpty(username)) return new List<string>();",
                  "        var username = principal.FindFirstValue(ClaimTypes.Name);\n        if (string.IsNullOrEmpty(username)) return new List<string>();\n        await RbacStore.EnsureFresh(_db);", 1)
    # role defaults for the new modules
    def add(role, keys):
        nonlocal_s[0] = nonlocal_s[0].replace('["%s"] = new[] { ' % role, '["%s"] = new[] { %s, ' % (role, q(keys)), 1)
    nonlocal_s = [s]
    add("finance", ["prj.view","prj.billing","prj.reports.view","prj.costs.manage","mfg.view","mfg.costing.view","mfg.reports.view","crm.view"])
    add("procurement", ["mfg.view","mfg.planning","mfg.bom.manage","prj.view","prj.costs.manage"])
    add("sales", CRM_SALES + ["prj.view"])
    add("admin-stores", ["mfg.view","mfg.orders.execute","mfg.quality.manage","mfg.maintenance.manage"])
    add("it", ["prj.view","prj.time.log"] + INT + ["bpm.view"])
    add("finance", ["proc.view","proc.invoice","proc.reports.view","wh.view","wh.reports.view","ast.view","ast.reports.view","pay.self","pay.view","pay.payslips.view","pay.run.approve","pay.post","pay.reports.view","epm.view","epm.plans.manage","epm.plans.approve","epm.forecast.manage","epm.publish","epm.reports.view","bi.view","bi.ai.use","scm.view"])
    add("procurement", [k for k in PROC if k not in ("proc.po.selfApprove","proc.setup")] + SCM + ["wh.view","wh.reports.view","bi.view"])
    add("admin-stores", ["proc.view","proc.receive","scm.view","scm.shipments.manage"] + [k for k in WH if k != "wh.setup"] + ["ast.view","ast.orders.manage","ast.assets.manage","ast.plans.manage","ast.reports.view"])
    add("sales", ["scm.view","bi.view"])
    s = nonlocal_s[0]
    s = s.replace('["hr"] = HrAll.Concat(new[] { ', '["hr"] = HrAll.Concat(new[] { "pay.self", "pay.view", "pay.payslips.view", "pay.run.manage", "pay.reports.view", "pay.setup", ', 1)
    s = s.replace('["hr"] = HrAll.Concat(new[] { ', '["hr"] = HrAll.Concat(new[] { "prj.view", "prj.time.log", ', 1)
    s = s.replace('"dashboard.view", "purchasing.view", "purchasing.create", "finance.view", "finance.create",\n        "hr.view"', '"dashboard.view", "purchasing.view", "purchasing.create", "finance.view", "finance.create", "prj.view", "prj.time.log", "pay.self",\n        "hr.view"', 1)
    return s
rw(base + '/Services/PermissionService.cs', pm)

# ------------------------------------------------------------------ UsersController (catalog from the database)
def uc(s):
    if 'RbacStore' in s: return s
    need(s, "roles.AddRange(Permissions.RoleDefaults.Keys);", 'roles.AddRange')
    s = s.replace("        var tenantId = await _tenant.TenantIdOf(User);\n        var roles = await _db.Users.Where(u => u.TenantId == tenantId).Select(u => u.Role).Distinct().ToListAsync();\n        roles.AddRange(Permissions.RoleDefaults.Keys);",
                  "        var tenantId = await _tenant.TenantIdOf(User);\n        await RbacStore.EnsureFresh(_db);\n        var roles = await _db.Users.Where(u => u.TenantId == tenantId).Select(u => u.Role).Distinct().ToListAsync();\n        var roleDefaults = RbacStore.RolesFor(tenantId);\n        roles.AddRange(roleDefaults.Keys);", 1)
    s = s.replace("Groups = Permissions.Catalog.Select(g =>", "Groups = RbacStore.CatalogFor(tenantId).Select(g =>", 1)
    s = s.replace("RoleDefaults = Permissions.RoleDefaults.ToDictionary(k => k.Key, v => v.Value),", "RoleDefaults = roleDefaults,", 1)
    return s
rw(base + '/Controllers/UsersController.cs', uc)

# ------------------------------------------------------------------ Program.cs
def prog(s):
    if 'RbacStore' in s: return s
    a = "    await SchemaUpgrade.Apply(db);"
    need(s, a, 'SchemaUpgrade.Apply')
    return s.replace(a, a + "\n    await RbacStore.Seed(db);   // privilege catalog + role defaults -> database (admin edits them from then on)", 1)
rw(base + '/Program.cs', prog)
