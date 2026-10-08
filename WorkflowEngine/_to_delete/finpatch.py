import sys
base=sys.argv[1]
def rw(path,fn):
    s=open(path,encoding='utf-8-sig').read()
    n=fn(s)
    if n==s: print('unchanged',path)
    open(path,'w',encoding='utf-8').write(n)

def ctx(s):
    if 'FinRecords' in s: return s
    s=s.replace("    public DbSet<HrRecord> HrRecords => Set<HrRecord>();","    public DbSet<HrRecord> HrRecords => Set<HrRecord>();\n    public DbSet<FinRecord> FinRecords => Set<FinRecord>();\n    public DbSet<FinAudit> FinAudits => Set<FinAudit>();",1)
    s=s.replace("        // Plain relational columns, no JSON needed","""        // Finance (tables created by SchemaUpgrade on startup)
        modelBuilder.Entity<FinRecord>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.Kind });
        });
        modelBuilder.Entity<FinAudit>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.At });
        });

        // Plain relational columns, no JSON needed""",1)
    return s
rw(base+'/Data/WorkflowDbContext.cs',ctx)

def su(s):
    if 'FinRecords' in s: return s
    add='''
        // Finance: one generic record table (accounts, periods, journals, invoices, bank, budgets, assets, ...) + audit trail
        "IF OBJECT_ID('dbo.FinRecords','U') IS NULL CREATE TABLE dbo.FinRecords (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_FinRecords PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Kind] nvarchar(450) NOT NULL, " +
            "[Code] nvarchar(450) NULL, [Company] nvarchar(450) NULL, [Status] nvarchar(max) NULL, [Data] nvarchar(max) NOT NULL, " +
            "[CreatedBy] nvarchar(max) NULL, [ApprovedBy] nvarchar(max) NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FinRecords_TenantId_Kind') CREATE INDEX IX_FinRecords_TenantId_Kind ON dbo.FinRecords ([TenantId], [Kind]);",
        "IF OBJECT_ID('dbo.FinAudits','U') IS NULL CREATE TABLE dbo.FinAudits (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_FinAudits PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Kind] nvarchar(450) NOT NULL, " +
            "[RecordId] nvarchar(450) NOT NULL, [Code] nvarchar(max) NULL, [Action] nvarchar(max) NOT NULL, [UserName] nvarchar(max) NOT NULL, " +
            "[At] datetime2 NOT NULL, [Summary] nvarchar(max) NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FinAudits_TenantId_At') CREATE INDEX IX_FinAudits_TenantId_At ON dbo.FinAudits ([TenantId], [At]);",
'''
    i=s.index("    };\n\n    public static async Task Apply")
    return s[:i]+add+s[i:]
rw(base+'/Services/SchemaUpgrade.cs',su)

FIN_KEYS=["finance.reports.view","finance.gl.view","finance.gl.manage","finance.gl.approve","finance.ap.view","finance.ap.manage","finance.ap.approve",
 "finance.ar.view","finance.ar.manage","finance.bank.view","finance.bank.manage","finance.budget.view","finance.budget.manage",
 "finance.assets.view","finance.assets.manage","finance.projects.view","finance.projects.manage","finance.setup","finance.audit.view"]
def q(keys): return ", ".join('"%s"'%k for k in keys)
def pm(s):
    if 'finance.gl.view' in s: return s
    s=s.replace('("finance",    new[] { "finance.view", "finance.create" }),','("finance",    new[] { "finance.view", "finance.create", %s }),' % q(FIN_KEYS))
    # finance officers get everything in the finance workspace
    s=s.replace('["finance"] = new[] { ','["finance"] = new[] { %s, ' % q(FIN_KEYS),1)
    s=s.replace('["procurement"] = new[] { ','["procurement"] = new[] { "finance.ap.view", "finance.ap.manage", ',1)
    s=s.replace('["sales"] = new[] { ','["sales"] = new[] { "finance.ar.view", "finance.ar.manage", ',1)
    return s
rw(base+'/Services/PermissionService.cs',pm)
