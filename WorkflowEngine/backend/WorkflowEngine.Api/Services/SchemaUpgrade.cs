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
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FinAudits_TenantId_At') CREATE INDEX IX_FinAudits_TenantId_At ON dbo.FinAudits ([TenantId], [At]);",

        // Point of sale: products, customers, promotions, shifts, sales, stock ... in one generic record table
        "IF OBJECT_ID('dbo.PosRecords','U') IS NULL CREATE TABLE dbo.PosRecords (" +
            "[Id] nvarchar(450) NOT NULL CONSTRAINT PK_PosRecords PRIMARY KEY, [TenantId] nvarchar(450) NOT NULL, [Kind] nvarchar(450) NOT NULL, " +
            "[Code] nvarchar(450) NULL, [Company] nvarchar(450) NULL, [Branch] nvarchar(450) NULL, [Status] nvarchar(450) NULL, " +
            "[Ref] nvarchar(450) NULL, [Parent] nvarchar(450) NULL, [Data] nvarchar(max) NOT NULL, " +
            "[CreatedBy] nvarchar(450) NULL, [CreatedAt] datetime2 NOT NULL, [UpdatedAt] datetime2 NULL);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PosRecords_TenantId_Kind') CREATE INDEX IX_PosRecords_TenantId_Kind ON dbo.PosRecords ([TenantId], [Kind]);",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PosRecords_Kind_Code') CREATE INDEX IX_PosRecords_Kind_Code ON dbo.PosRecords ([TenantId], [Kind], [Code]);",

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
    };

    public static async Task Apply(WorkflowDbContext db)
    {
        foreach (var sql in Statements)
            await db.Database.ExecuteSqlRawAsync(sql);
    }
}
