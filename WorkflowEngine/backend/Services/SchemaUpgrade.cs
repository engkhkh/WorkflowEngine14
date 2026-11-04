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
    };

    public static async Task Apply(WorkflowDbContext db)
    {
        foreach (var sql in Statements)
            await db.Database.ExecuteSqlRawAsync(sql);
    }
}
