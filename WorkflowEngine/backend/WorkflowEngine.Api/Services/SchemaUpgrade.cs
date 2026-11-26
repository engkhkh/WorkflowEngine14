using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;

namespace WorkflowEngine.Api.Services;

/// <summary>
/// Adds the columns/tables introduced by the Admin module and SaaS workspaces to an EXISTING database,
/// so no EF migration has to be generated. Every statement is idempotent (guarded by OBJECT_ID /
/// COL_LENGTH / sys.indexes) and safe to run on every startup.
///
/// If you later generate a real EF migration that includes these tables/columns, delete the matching
/// statements here (or the migration's CreateTable calls will fail because the tables already exist).
/// </summary>
public static class SchemaUpgrade
{
    private static readonly string[] Statements =
    {
        // Admin module: per-user privileges (null = role defaults)
        "IF OBJECT_ID('dbo.Users','U') IS NOT NULL AND COL_LENGTH('dbo.Users','Permissions') IS NULL ALTER TABLE dbo.Users ADD [Permissions] nvarchar(max) NULL;",

        // SaaS: every user belongs to a workspace; existing users go to 'default'
        "IF OBJECT_ID('dbo.Users','U') IS NOT NULL AND COL_LENGTH('dbo.Users','TenantId') IS NULL ALTER TABLE dbo.Users ADD [TenantId] nvarchar(64) NOT NULL CONSTRAINT DF_Users_TenantId DEFAULT 'default';",

        "IF OBJECT_ID('dbo.Tenants','U') IS NULL CREATE TABLE dbo.Tenants (" +
            "[Id] nvarchar(64) NOT NULL CONSTRAINT PK_Tenants PRIMARY KEY, [Name] nvarchar(max) NOT NULL, [Plan] nvarchar(max) NOT NULL, " +
            "[MaxUsers] int NOT NULL, [MaxCompanies] int NOT NULL, [MaxBranches] int NOT NULL, [CreatedAt] datetime2 NOT NULL);",

        "IF OBJECT_ID('dbo.OrgCompanies','U') IS NULL CREATE TABLE dbo.OrgCompanies (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_OrgCompanies PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Code] nvarchar(450) NOT NULL, " +
            "[Name] nvarchar(max) NOT NULL, [NameAr] nvarchar(max) NOT NULL, [Currency] nvarchar(max) NOT NULL, [TaxNo] nvarchar(max) NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrgCompanies_TenantId_Code') CREATE UNIQUE INDEX IX_OrgCompanies_TenantId_Code ON dbo.OrgCompanies ([TenantId], [Code]);",

        "IF OBJECT_ID('dbo.OrgBranches','U') IS NULL CREATE TABLE dbo.OrgBranches (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_OrgBranches PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Code] nvarchar(450) NOT NULL, " +
            "[CompanyCode] nvarchar(max) NOT NULL, [Name] nvarchar(max) NOT NULL, [NameAr] nvarchar(max) NOT NULL, [Warehouse] nvarchar(max) NOT NULL, [City] nvarchar(max) NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrgBranches_TenantId_Code') CREATE UNIQUE INDEX IX_OrgBranches_TenantId_Code ON dbo.OrgBranches ([TenantId], [Code]);",

        // Modules switched on per workspace (null = all) and the owner workspace of every workflow definition
        "IF OBJECT_ID('dbo.Tenants','U') IS NOT NULL AND COL_LENGTH('dbo.Tenants','Modules') IS NULL ALTER TABLE dbo.Tenants ADD [Modules] nvarchar(max) NULL;",
        "IF OBJECT_ID('dbo.Definitions','U') IS NOT NULL AND COL_LENGTH('dbo.Definitions','TenantId') IS NULL ALTER TABLE dbo.Definitions ADD [TenantId] nvarchar(64) NOT NULL CONSTRAINT DF_Definitions_TenantId DEFAULT 'default';",

        // Billing: monthly subscription invoices (one per workspace and month)
        "IF OBJECT_ID('dbo.BillingInvoices','U') IS NULL CREATE TABLE dbo.BillingInvoices (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_BillingInvoices PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Number] nvarchar(max) NOT NULL, [Period] nvarchar(450) NOT NULL, " +
            "[IssuedAt] datetime2 NOT NULL, [DueAt] datetime2 NOT NULL, [Status] nvarchar(max) NOT NULL, [Currency] nvarchar(max) NOT NULL, [Users] int NOT NULL, " +
            "[UnitPrice] decimal(18,2) NOT NULL, [Total] decimal(18,2) NOT NULL, [SarPerUsd] decimal(18,4) NOT NULL, [CompanyName] nvarchar(max) NOT NULL, [TaxNo] nvarchar(max) NULL, " +
            "[LinesJson] nvarchar(max) NOT NULL, [Provider] nvarchar(max) NULL, [ProviderRef] nvarchar(450) NULL, [PaymentUrl] nvarchar(max) NULL, [Method] nvarchar(max) NULL, [PaidAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_BillingInvoices_TenantId_Period') CREATE UNIQUE INDEX IX_BillingInvoices_TenantId_Period ON dbo.BillingInvoices ([TenantId], [Period]);",

        // Website module: sites (design + published page) and the orders / messages visitors send
        "IF OBJECT_ID('dbo.WebSites','U') IS NULL CREATE TABLE dbo.WebSites (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_WebSites PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Name] nvarchar(max) NOT NULL, [Slug] nvarchar(450) NOT NULL, " +
            "[DraftJson] nvarchar(max) NOT NULL, [PublishedHtml] nvarchar(max) NULL, [ProductsJson] nvarchar(max) NOT NULL, [Currency] nvarchar(max) NOT NULL, " +
            "[Published] bit NOT NULL, [PublishedAt] datetime2 NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NOT NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebSites_Slug') CREATE UNIQUE INDEX IX_WebSites_Slug ON dbo.WebSites ([Slug]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebSites_TenantId') CREATE INDEX IX_WebSites_TenantId ON dbo.WebSites ([TenantId]);",
        "IF OBJECT_ID('dbo.WebSubmissions','U') IS NULL CREATE TABLE dbo.WebSubmissions (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_WebSubmissions PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [SiteId] nvarchar(450) NOT NULL, [Kind] nvarchar(max) NOT NULL, " +
            "[Number] nvarchar(max) NOT NULL, [Name] nvarchar(max) NOT NULL, [Email] nvarchar(max) NULL, [Phone] nvarchar(max) NULL, [Address] nvarchar(max) NULL, [Note] nvarchar(max) NULL, " +
            "[LinesJson] nvarchar(max) NOT NULL, [Total] decimal(18,2) NOT NULL, [Currency] nvarchar(max) NOT NULL, [Status] nvarchar(max) NOT NULL, [CreatedAt] datetime2 NOT NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebSubmissions_TenantId_SiteId') CREATE INDEX IX_WebSubmissions_TenantId_SiteId ON dbo.WebSubmissions ([TenantId], [SiteId]);",

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
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FinAudits_TenantId_RecordId') CREATE INDEX IX_FinAudits_TenantId_RecordId ON dbo.FinAudits ([TenantId], [RecordId]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'IX_Users_Username_Perf' ) AND NOT EXISTS (SELECT 1 FROM sys.indexes i JOIN sys.index_columns c ON c.object_id=i.object_id AND c.index_id=i.index_id JOIN sys.columns k ON k.object_id=c.object_id AND k.column_id=c.column_id WHERE i.object_id = OBJECT_ID('dbo.Users') AND k.name='Username' AND c.key_ordinal=1) CREATE INDEX IX_Users_Username_Perf ON dbo.Users ([Username]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpRecords_Tenant_Module_Kind_Id') CREATE INDEX IX_ErpRecords_Tenant_Module_Kind_Id ON dbo.ErpRecords ([TenantId], [Module], [Kind], [Status]) INCLUDE ([Code]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FinAudits_TenantId_At') CREATE INDEX IX_FinAudits_TenantId_At ON dbo.FinAudits ([TenantId], [At]);",

        // Point of sale: products, customers, promotions, shifts, sales, stock ... in one generic record table
        "IF OBJECT_ID('dbo.PosRecords','U') IS NULL CREATE TABLE dbo.PosRecords (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_PosRecords PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Kind] nvarchar(450) NOT NULL, " +
            "[Code] nvarchar(450) NULL, [Company] nvarchar(450) NULL, [Branch] nvarchar(450) NULL, [Status] nvarchar(450) NULL, " +
            "[Ref] nvarchar(450) NULL, [Parent] nvarchar(450) NULL, [Data] nvarchar(max) NOT NULL, " +
            "[CreatedBy] nvarchar(450) NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PosRecords_TenantId_Kind') CREATE INDEX IX_PosRecords_TenantId_Kind ON dbo.PosRecords ([TenantId], [Kind]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PosRecords_Kind_Code') CREATE INDEX IX_PosRecords_Kind_Code ON dbo.PosRecords ([TenantId], [Kind], [Code]);",

        // Hospital: patients, appointments, visits, prescriptions, lab, wards, invoices ... in one generic record table
        "IF OBJECT_ID('dbo.HosRecords','U') IS NULL CREATE TABLE dbo.HosRecords (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_HosRecords PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Kind] nvarchar(450) NOT NULL, " +
            "[Code] nvarchar(450) NULL, [Company] nvarchar(450) NULL, [Branch] nvarchar(450) NULL, [Status] nvarchar(450) NULL, " +
            "[Ref] nvarchar(450) NULL, [Parent] nvarchar(450) NULL, [Data] nvarchar(max) NOT NULL, " +
            "[CreatedBy] nvarchar(450) NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_HosRecords_TenantId_Kind') CREATE INDEX IX_HosRecords_TenantId_Kind ON dbo.HosRecords ([TenantId], [Kind]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_HosRecords_Kind_Code') CREATE INDEX IX_HosRecords_Kind_Code ON dbo.HosRecords ([TenantId], [Kind], [Code]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_HosRecords_Kind_Parent') CREATE INDEX IX_HosRecords_Kind_Parent ON dbo.HosRecords ([TenantId], [Kind], [Parent]);",

        // Custom modules (definitions + their records)
        "IF OBJECT_ID('dbo.CustRecords','U') IS NULL CREATE TABLE dbo.CustRecords (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_CustRecords PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Kind] nvarchar(450) NOT NULL, " +
            "[Code] nvarchar(450) NULL, [Status] nvarchar(450) NULL, [Data] nvarchar(max) NOT NULL, [CreatedBy] nvarchar(450) NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CustRecords_Tenant_Kind') CREATE INDEX IX_CustRecords_Tenant_Kind ON dbo.CustRecords ([TenantId], [Kind]);",

        // Calendar & meetings: events, meetings, to-dos and per-workspace settings
        "IF OBJECT_ID('dbo.CalEvents','U') IS NULL CREATE TABLE dbo.CalEvents (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_CalEvents PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Kind] nvarchar(50) NOT NULL, " +
            "[Title] nvarchar(500) NOT NULL, [Owner] nvarchar(450) NOT NULL, [StartUtc] datetime2 NULL, [EndUtc] datetime2 NULL, [Status] nvarchar(50) NULL, " +
            "[Room] nvarchar(450) NULL, [Data] nvarchar(max) NOT NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CalEvents_Tenant_Kind_Start') CREATE INDEX IX_CalEvents_Tenant_Kind_Start ON dbo.CalEvents ([TenantId], [Kind], [StartUtc]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CalEvents_Room') CREATE INDEX IX_CalEvents_Room ON dbo.CalEvents ([Room]);",

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

        // Onboarding: branch access per user, setup wizard flag, company country
        "IF OBJECT_ID('dbo.Users','U') IS NOT NULL AND COL_LENGTH('dbo.Users','Branches') IS NULL ALTER TABLE dbo.Users ADD [Branches] nvarchar(max) NULL;",
        "IF OBJECT_ID('dbo.Tenants','U') IS NOT NULL AND COL_LENGTH('dbo.Tenants','SetupDone') IS NULL ALTER TABLE dbo.Tenants ADD [SetupDone] bit NOT NULL CONSTRAINT DF_Tenants_SetupDone DEFAULT 1;",
        "IF OBJECT_ID('dbo.OrgCompanies','U') IS NOT NULL AND COL_LENGTH('dbo.OrgCompanies','Country') IS NULL ALTER TABLE dbo.OrgCompanies ADD [Country] nvarchar(max) NULL;",
    };

    private static bool IsOptional(string sql) => sql.Contains(" CREATE INDEX ");

    /// <summary>Tables, columns and unique indexes: needed before the app starts.</summary>
    public static async Task Apply(WorkflowDbContext db)
    {
        foreach (var sql in Statements)
            if (!IsOptional(sql)) await db.Database.ExecuteSqlRawAsync(sql);
    }

    /// <summary>
    /// Plain performance indexes. Built quietly in the background after the app is listening, on their own
    /// connection: a busy or locked table never delays startup and never writes an error to the log.
    /// A skipped index is simply tried again a minute later (a few times) and on the next start.
    /// </summary>
    public static async Task ApplyOptionalIndexes(string connectionString)
    {
        // READ_COMMITTED_SNAPSHOT is NOT switched on automatically: ALTER DATABASE needs exclusive access and can leave a shared dev database
        // unusable if it is interrupted. Run EnableSnapshotReads manually (see uat/sql/enable-snapshot.sql) when nobody else is connected.
        var pending = Statements.Where(IsOptional).ToList();
        for (var round = 0; round < 5 && pending.Count > 0; round++)
        {
            if (round > 0) await Task.Delay(TimeSpan.FromSeconds(60));
            var left = new List<string>();
            foreach (var sql in pending)
            {
                try
                {
                    await using var con = new Microsoft.Data.SqlClient.SqlConnection(connectionString);
                    await con.OpenAsync();
                    await using var cmd = con.CreateCommand();
                    cmd.CommandTimeout = 120;
                    cmd.CommandText = "SET LOCK_TIMEOUT 5000; " + sql;
                    await cmd.ExecuteNonQueryAsync();
                }
                catch { left.Add(sql); }
            }
            pending = left;
        }
    }

    /// <summary>
    /// Readers must never wait for writers (a list/COUNT query blocked 90 s behind another session's open transaction and
    /// exhausted the connection pool). READ_COMMITTED_SNAPSHOT makes the default isolation level row-versioned.
    /// ROLLBACK IMMEDIATE also clears orphaned sessions that still hold an open transaction. Runs once (skipped when already on).
    /// </summary>
    public static async Task EnableSnapshotReads(string connectionString)
    {
        try
        {
            await using var con = new Microsoft.Data.SqlClient.SqlConnection(connectionString);
            await con.OpenAsync();
            await using var cmd = con.CreateCommand();
            cmd.CommandTimeout = 120;
            cmd.CommandText = "IF EXISTS (SELECT 1 FROM sys.databases WHERE database_id = DB_ID() AND is_read_committed_snapshot_on = 0) " +
                              "BEGIN DECLARE @n sysname = DB_NAME(); DECLARE @q nvarchar(400) = N'ALTER DATABASE ' + QUOTENAME(@n) + N' SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE'; EXEC(@q); END";
            await cmd.ExecuteNonQueryAsync();
        }
        catch { /* needs ALTER DATABASE permission; the app works without it */ }
    }
}
