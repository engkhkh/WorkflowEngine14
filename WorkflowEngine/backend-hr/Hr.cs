using System.Text.Json.Serialization;

namespace WorkflowEngine.Api.Models;

/// <summary>
/// Core HR employee master record (one row per employee, per workspace).
/// Department / position / job / grade / cost centre / location / legal entity / business unit are stored as the
/// code or name text (so spreadsheets can be imported as they are); the Organization page maintains the allowed values.
/// </summary>
public class HrEmployee
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [JsonIgnore] public string TenantId { get; set; } = Tenant.DefaultId;

    public string EmpNo { get; set; } = string.Empty;               // unique per workspace
    public string FullName { get; set; } = string.Empty;
    public string? FullNameAr { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Nationality { get; set; }
    public string? Gender { get; set; }                              // Male | Female
    public string? NationalId { get; set; }
    public DateTime? BirthDate { get; set; }
    public DateTime? HireDate { get; set; }
    public DateTime? TerminationDate { get; set; }
    public string Status { get; set; } = "Active";                   // Active | Probation | OnLeave | Terminated

    public string? Company { get; set; }                             // OrgCompany code
    public string? Branch { get; set; }                              // OrgBranch code
    public string? Unit { get; set; }                                // division / department / section / team
    public string? Position { get; set; }
    public string? Job { get; set; }
    public string? Grade { get; set; }
    public string? ManagerEmpNo { get; set; }
    public string? CostCenter { get; set; }
    public string? Location { get; set; }
    public string? LegalEntity { get; set; }
    public string? BusinessUnit { get; set; }

    public decimal? BasicSalary { get; set; }                        // only returned to users with hr.employees.salary
    public string? Username { get; set; }                            // links the employee to a portal login (self-service)
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>
/// One table for the smaller HR lists: org units, reference data (positions, jobs, grades, cost centres, locations,
/// legal entities, business units, leave types), leave requests, goals, reviews, vacancies and candidates.
/// The varying fields live in <see cref="Data"/> (JSON); Kind / Code / EmpNo / Status are real columns so they can be filtered.
/// </summary>
public class HrRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [JsonIgnore] public string TenantId { get; set; } = Tenant.DefaultId;
    public string Kind { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? EmpNo { get; set; }
    public string? Status { get; set; }
    public string Data { get; set; } = "{}";
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
