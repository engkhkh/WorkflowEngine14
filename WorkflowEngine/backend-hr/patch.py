import re,sys
base=sys.argv[1]
def rw(path,fn):
    s=open(path,encoding='utf-8-sig').read()
    n=fn(s)
    if n==s: print('unchanged',path)
    open(path,'w',encoding='utf-8').write(n)

# DbContext
def ctx(s):
    if 'HrEmployees' in s: return s
    s=s.replace("    public DbSet<OrgBranch> OrgBranches => Set<OrgBranch>();","    public DbSet<OrgBranch> OrgBranches => Set<OrgBranch>();\n    public DbSet<HrEmployee> HrEmployees => Set<HrEmployee>();\n    public DbSet<HrRecord> HrRecords => Set<HrRecord>();")
    s=s.replace("        // Plain relational columns, no JSON needed","""        // Core HR (tables created by SchemaUpgrade on startup)
        modelBuilder.Entity<HrEmployee>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.BasicSalary).HasPrecision(18, 2);
            e.HasIndex(x => new { x.TenantId, x.EmpNo }).IsUnique();
        });
        modelBuilder.Entity<HrRecord>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.Kind });
        });

        // Plain relational columns, no JSON needed""",1)
    return s
rw(base+'/Data/WorkflowDbContext.cs',ctx)

# SchemaUpgrade
def su(s):
    if 'HrEmployees' in s: return s
    add='''
        // Core HR: employee master + generic HR records (org units, reference data, leave, goals, reviews, vacancies, candidates)
        "IF OBJECT_ID('dbo.HrEmployees','U') IS NULL CREATE TABLE dbo.HrEmployees (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_HrEmployees PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [EmpNo] nvarchar(450) NOT NULL, " +
            "[FullName] nvarchar(max) NOT NULL, [FullNameAr] nvarchar(max) NULL, [Email] nvarchar(max) NULL, [Phone] nvarchar(max) NULL, " +
            "[Nationality] nvarchar(max) NULL, [Gender] nvarchar(max) NULL, [NationalId] nvarchar(max) NULL, " +
            "[BirthDate] datetime2 NULL, [HireDate] datetime2 NULL, [TerminationDate] datetime2 NULL, [Status] nvarchar(max) NOT NULL, " +
            "[Company] nvarchar(max) NULL, [Branch] nvarchar(max) NULL, [Unit] nvarchar(max) NULL, [Position] nvarchar(max) NULL, [Job] nvarchar(max) NULL, " +
            "[Grade] nvarchar(max) NULL, [ManagerEmpNo] nvarchar(max) NULL, [CostCenter] nvarchar(max) NULL, [Location] nvarchar(max) NULL, " +
            "[LegalEntity] nvarchar(max) NULL, [BusinessUnit] nvarchar(max) NULL, [BasicSalary] decimal(18,2) NULL, [Username] nvarchar(max) NULL, " +
            "[Notes] nvarchar(max) NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_HrEmployees_TenantId_EmpNo') CREATE UNIQUE INDEX IX_HrEmployees_TenantId_EmpNo ON dbo.HrEmployees ([TenantId], [EmpNo]);",

        "IF OBJECT_ID('dbo.HrRecords','U') IS NULL CREATE TABLE dbo.HrRecords (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_HrRecords PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Kind] nvarchar(450) NOT NULL, " +
            "[Code] nvarchar(max) NULL, [EmpNo] nvarchar(max) NULL, [Status] nvarchar(max) NULL, [Data] nvarchar(max) NOT NULL, " +
            "[CreatedBy] nvarchar(max) NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_HrRecords_TenantId_Kind') CREATE INDEX IX_HrRecords_TenantId_Kind ON dbo.HrRecords ([TenantId], [Kind]);",
'''
    i=s.index("    };\n\n    public static async Task Apply")
    return s[:i]+add+s[i:]
rw(base+'/Services/SchemaUpgrade.cs',su)

# Permissions
def pm(s):
    if 'hr.employees.view' in s: return s
    s=s.replace('("hr",         new[] { "hr.view", "hr.create" }),','''("hr",         new[] { "hr.view", "hr.create", "hr.reports.view", "hr.employees.view", "hr.employees.manage", "hr.employees.import", "hr.employees.salary",
                                       "hr.org.view", "hr.org.manage", "hr.leave.view", "hr.leave.approve", "hr.performance.view", "hr.performance.manage",
                                       "hr.recruitment.view", "hr.recruitment.manage", "hr.self" }),''')
    s=s.replace('''    private static readonly string[] EmployeeDefaults =
    {
        "dashboard.view", "purchasing.view", "purchasing.create", "finance.view", "finance.create",
        "hr.view", "hr.create", TasksAct, "assistant.use"
    };''','''    private static readonly string[] EmployeeDefaults =
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
    };''')
    s=s.replace('["hr"] = new[] { "dashboard.view", "hr.view", "hr.create", TasksAct, DocumentsViewAll, "reports.view", "assistant.use" },','["hr"] = HrAll.Concat(new[] { "dashboard.view", TasksAct, DocumentsViewAll, "reports.view", "assistant.use" }).ToArray(),')
    s=s.replace('["it"] = new[] { "dashboard.view", "hr.view", "hr.create", "operations.view", TasksAct, "assistant.use" },','["it"] = new[] { "dashboard.view", "hr.view", "hr.create", "hr.self", "operations.view", TasksAct, "assistant.use" },')
    for role in ('finance','procurement','sales','admin-stores'):
        s=s.replace('["%s"] = new[] { "dashboard.view",' % role, '["%s"] = new[] { "dashboard.view", "hr.self",' % role)
    return s
rw(base+'/Services/PermissionService.cs',pm)
