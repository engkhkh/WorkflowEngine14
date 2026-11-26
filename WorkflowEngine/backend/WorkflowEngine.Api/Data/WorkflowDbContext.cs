using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Data;

public class WorkflowDbContext : DbContext
{
    private readonly IHttpContextAccessor? _http;
    public WorkflowDbContext(DbContextOptions<WorkflowDbContext> options, IHttpContextAccessor? http = null) : base(options) { _http = http; }

    /// <summary>Set to true by bulk jobs (seeding, imports) that should not write an audit row per record.</summary>
    public bool AuditOff { get; set; }
    private static readonly bool AuditDisabled = string.Equals(Environment.GetEnvironmentVariable("WF_AUDIT"), "off", StringComparison.OrdinalIgnoreCase);   // WF_AUDIT=off switches the audit trail off (e.g. for a bulk load)

    // ---- audit trail: every create / change / delete of an ERP record is written as a gov/audit record in the same save ----
    public override int SaveChanges(bool acceptAllChangesOnSuccess) { CaptureAudit(); return base.SaveChanges(acceptAllChangesOnSuccess); }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default) { CaptureAudit(); return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken); }

    private void CaptureAudit()
    {
        if (AuditOff || AuditDisabled) return;
        try
        {
            ChangeTracker.DetectChanges();
            var entries = ChangeTracker.Entries<ErpRecord>()
                .Where(e => (e.State == EntityState.Added || e.State == EntityState.Modified || e.State == EntityState.Deleted)
                            && e.Entity.Module != "gov" && e.Entity.Module != "collab" && e.Entity.Kind != "log")
                .ToList();
            if (entries.Count == 0) return;
            var who = _http?.HttpContext?.User?.FindFirst(ClaimTypes.Name)?.Value ?? "system";
            var now = DateTime.UtcNow;
            foreach (var e in entries)
            {
                var r = e.Entity;
                string action; List<Dictionary<string, string?>> changes;
                if (e.State == EntityState.Added) { action = "Created"; changes = new() { new() { ["f"] = "status", ["from"] = null, ["to"] = r.Status } }; }
                else if (e.State == EntityState.Deleted) { action = "Deleted"; changes = new() { new() { ["f"] = "status", ["from"] = e.OriginalValues.GetValue<string>(nameof(ErpRecord.Status)), ["to"] = null } }; }
                else
                {
                    var oldData = e.OriginalValues.GetValue<string>(nameof(ErpRecord.Data));
                    var list = AuditDiff.Diff(oldData, r.Data);
                    var oldSt = e.OriginalValues.GetValue<string>(nameof(ErpRecord.Status));
                    if (!string.Equals(oldSt, r.Status, StringComparison.Ordinal)) list.Insert(0, new() { ["f"] = "status", ["from"] = oldSt, ["to"] = r.Status });
                    foreach (var col in new[] { nameof(ErpRecord.Company), nameof(ErpRecord.Branch), nameof(ErpRecord.Ref), nameof(ErpRecord.Parent), nameof(ErpRecord.Code) })
                    {
                        if (!e.Property(col).IsModified) continue;
                        var a = e.OriginalValues.GetValue<string>(col); var b = e.CurrentValues.GetValue<string>(col);
                        if (!string.Equals(a, b, StringComparison.Ordinal)) list.Add(new() { ["f"] = col.ToLowerInvariant(), ["from"] = a, ["to"] = b });
                    }
                    if (list.Count == 0) continue;     // touched but nothing really changed
                    action = list.Any(x => x["f"] == "status") ? "StatusChanged" : "Updated";
                    // confidential letters, payslips and API keys: the trail says WHICH fields changed, never their values
                    if (r.Module == "arc" || (r.Module == "pay" && r.Kind == "payslip") || (r.Module == "int" && r.Kind == "apikey"))
                        foreach (var x in list) if (x["f"] != "status") { x["from"] = "(hidden)"; x["to"] = "(hidden)"; }
                    changes = list;
                }
                Set<ErpRecord>().Add(new ErpRecord
                {
                    TenantId = r.TenantId, Module = "gov", Kind = "audit", Code = r.Code, Company = r.Company, Branch = r.Branch,
                    Status = action, Ref = r.Id, Parent = r.Module + "/" + r.Kind, CreatedBy = who, CreatedAt = now,
                    Data = JsonSerializer.Serialize(new { module = r.Module, kind = r.Kind, recordId = r.Id, code = r.Code, action, by = who, at = now, changes })
                });
            }
        }
        catch { /* the audit trail must never stop a business save */ }
    }

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
    public DbSet<HosRecord> HosRecords => Set<HosRecord>();
    public DbSet<CalEvent> CalEvents => Set<CalEvent>();
    public DbSet<CustRecord> CustRecords => Set<CustRecord>();
    public DbSet<FinAudit> FinAudits => Set<FinAudit>();
    public DbSet<ErpRecord> ErpRecords => Set<ErpRecord>();
    public DbSet<PermissionDef> PermissionDefs => Set<PermissionDef>();
    public DbSet<RoleDef> RoleDefs => Set<RoleDef>();
    public DbSet<BillingInvoice> BillingInvoices => Set<BillingInvoice>();
    public DbSet<WebSite> WebSites => Set<WebSite>();
    public DbSet<WebSubmission> WebSubmissions => Set<WebSubmission>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<WebSite>(e => { e.HasKey(x => x.Id); e.HasIndex(x => x.Slug).IsUnique(); e.HasIndex(x => x.TenantId); });
        modelBuilder.Entity<WebSubmission>(e => { e.HasKey(x => x.Id); e.HasIndex(x => new { x.TenantId, x.SiteId }); e.Property(x => x.Total).HasPrecision(18, 2); });

        modelBuilder.Entity<BillingInvoice>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.Period }).IsUnique();
            e.Property(x => x.Total).HasPrecision(18, 2);
            e.Property(x => x.UnitPrice).HasPrecision(18, 2);
            e.Property(x => x.SarPerUsd).HasPrecision(18, 4);
        });

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
            e.Property(x => x.Branches).HasJsonConversion();
            e.Property(x => x.TenantId).HasMaxLength(64);
        });

        // SaaS workspaces and their companies / branches. Tables are created by SchemaUpgrade on startup.
        modelBuilder.Entity<Tenant>(e => { e.HasKey(x => x.Id); e.Property(x => x.Id).HasMaxLength(64); e.Property(x => x.Modules).HasJsonConversion(); });
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

        // Hospital (table created by SchemaUpgrade on startup)
        modelBuilder.Entity<HosRecord>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.TenantId, x.Kind });
        });

        modelBuilder.Entity<CustRecord>(e => { e.HasKey(x => x.Id); e.HasIndex(x => new { x.TenantId, x.Kind }); });
        modelBuilder.Entity<CalEvent>(e => { e.HasKey(x => x.Id); e.HasIndex(x => new { x.TenantId, x.Kind, x.StartUtc }); });

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
