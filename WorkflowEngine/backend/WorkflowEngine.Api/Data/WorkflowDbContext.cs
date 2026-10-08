using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Data;

public class WorkflowDbContext : DbContext
{
    public WorkflowDbContext(DbContextOptions<WorkflowDbContext> options) : base(options) { }

    public DbSet<WorkflowDefinition> Definitions => Set<WorkflowDefinition>();
    public DbSet<WorkflowInstance> Instances => Set<WorkflowInstance>();
    public DbSet<WorkflowTask> Tasks => Set<WorkflowTask>();
    public DbSet<User> Users => Set<User>();
    public DbSet<ActivityLogEntry> ActivityLogs => Set<ActivityLogEntry>();
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<OrgCompany> OrgCompanies => Set<OrgCompany>();
    public DbSet<OrgBranch> OrgBranches => Set<OrgBranch>();
    public DbSet<HrEmployee> HrEmployees => Set<HrEmployee>();
    public DbSet<HrRecord> HrRecords => Set<HrRecord>();
    public DbSet<FinRecord> FinRecords => Set<FinRecord>();
    public DbSet<PosRecord> PosRecords => Set<PosRecord>();
    public DbSet<FinAudit> FinAudits => Set<FinAudit>();
    public DbSet<ErpRecord> ErpRecords => Set<ErpRecord>();
    public DbSet<PermissionDef> PermissionDefs => Set<PermissionDef>();
    public DbSet<RoleDef> RoleDefs => Set<RoleDef>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<WorkflowDefinition>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Nodes).HasJsonConversion();
            e.Property(x => x.Edges).HasJsonConversion();
        });

        modelBuilder.Entity<WorkflowInstance>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.CurrentNodeIds).HasJsonConversion();
            e.Property(x => x.JoinArrivalCounts).HasJsonConversion();
            e.Property(x => x.Data).HasJsonConversion();
            e.Property(x => x.History).HasJsonConversion();
            e.HasIndex(x => x.DefinitionId);
        });

        modelBuilder.Entity<WorkflowTask>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Form).HasJsonConversion();
            e.Property(x => x.SubmittedData).HasJsonConversion();
            e.Property(x => x.AvailableDecisions).HasJsonConversion();
            e.HasIndex(x => x.InstanceId);
            e.HasIndex(x => x.AssignedTo);
            e.HasIndex(x => x.Status);
        });

        modelBuilder.Entity<User>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Username).IsUnique();
            e.Property(x => x.Permissions).HasJsonConversion();
            e.Property(x => x.TenantId).HasMaxLength(64);
        });

        // SaaS workspaces and their companies / branches. Tables are created by SchemaUpgrade on startup.
        modelBuilder.Entity<Tenant>(e => { e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(64); });
        modelBuilder.Entity<OrgCompany>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
        });
        modelBuilder.Entity<OrgBranch>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
        });

        // Core HR (tables created by SchemaUpgrade on startup)
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

        // Finance (tables created by SchemaUpgrade on startup)
        // Manufacturing / Projects / CRM records and the database-stored privilege catalog + roles (tables created by SchemaUpgrade)
        modelBuilder.Entity<ErpRecord>(e => { e.HasKey(x => x.Id); e.HasIndex(x => new { x.TenantId, x.Module, x.Kind }); });
        modelBuilder.Entity<PermissionDef>(e => { e.HasKey(x => x.Id); e.HasIndex(x => new { x.TenantId, x.Key }).IsUnique(); });
        modelBuilder.Entity<RoleDef>(e => { e.HasKey(x => x.Id); e.HasIndex(x => new { x.TenantId, x.Role }).IsUnique(); });

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

        // Point of sale (table created by SchemaUpgrade on startup)
        modelBuilder.Entity<PosRecord>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.Kind });
        });

        // Plain relational columns, no JSON needed - this table is meant to be queried
        // directly with SQL (unlike WorkflowInstance.History, which is a JSON blob).
        modelBuilder.Entity<ActivityLogEntry>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedOnAdd();
            e.HasIndex(x => x.InstanceId);
            e.HasIndex(x => x.Timestamp);
        });
    }
}
