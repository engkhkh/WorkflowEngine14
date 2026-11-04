import sys
base=sys.argv[1]
def rw(path,fn):
    s=open(path,encoding='utf-8-sig').read()
    n=fn(s)
    if n==s: print('unchanged',path)
    open(path,'w',encoding='utf-8').write(n)

def ctx(s):
    if 'PosRecords' in s: return s
    s=s.replace("    public DbSet<FinRecord> FinRecords => Set<FinRecord>();","    public DbSet<FinRecord> FinRecords => Set<FinRecord>();\n    public DbSet<PosRecord> PosRecords => Set<PosRecord>();",1)
    s=s.replace("        // Plain relational columns, no JSON needed","""        // Point of sale (table created by SchemaUpgrade on startup)
        modelBuilder.Entity<PosRecord>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.Kind });
        });

        // Plain relational columns, no JSON needed""",1)
    return s
rw(base+'/Data/WorkflowDbContext.cs',ctx)

def su(s):
    if 'PosRecords' in s: return s
    add='''
        // Point of sale: products, customers, promotions, shifts, sales, stock ... in one generic record table
        "IF OBJECT_ID('dbo.PosRecords','U') IS NULL CREATE TABLE dbo.PosRecords (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_PosRecords PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Kind] nvarchar(450) NOT NULL, " +
            "[Code] nvarchar(450) NULL, [Company] nvarchar(450) NULL, [Branch] nvarchar(450) NULL, [Status] nvarchar(450) NULL, " +
            "[Ref] nvarchar(450) NULL, [Parent] nvarchar(450) NULL, [Data] nvarchar(max) NOT NULL, " +
            "[CreatedBy] nvarchar(450) NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PosRecords_TenantId_Kind') CREATE INDEX IX_PosRecords_TenantId_Kind ON dbo.PosRecords ([TenantId], [Kind]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PosRecords_Kind_Code') CREATE INDEX IX_PosRecords_Kind_Code ON dbo.PosRecords ([TenantId], [Kind], [Code]);",
'''
    i=s.index("    };\n\n    public static async Task Apply")
    return s[:i]+add+s[i:]
rw(base+'/Services/SchemaUpgrade.cs',su)

POS=["pos.view","pos.sell","pos.discount","pos.refund","pos.void","pos.shifts.manage","pos.products.manage","pos.customers.manage",
 "pos.promotions.manage","pos.stock.view","pos.stock.manage","pos.reports.view","pos.setup"]
def q(keys): return ", ".join('"%s"'%k for k in keys)
def pm(s):
    if 'pos.sell' in s: return s
    anchor='("finance",    new[] {'
    i=s.index(anchor)
    s=s[:i]+'("pos",        new[] { %s }),\n            '%q(POS)+s[i:]
    s=s.replace('["sales"] = new[] { ','["sales"] = new[] { "pos.view", "pos.sell", "pos.stock.view", ',1)
    s=s.replace('["finance"] = new[] { ','["finance"] = new[] { "pos.view", "pos.reports.view", ',1)
    s=s.replace('["admin-stores"] = new[] { ','["admin-stores"] = new[] { "pos.view", "pos.stock.view", "pos.stock.manage", "pos.products.manage", ',1)
    return s
rw(base+'/Services/PermissionService.cs',pm)
