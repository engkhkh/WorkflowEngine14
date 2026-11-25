using System.Text.Json.Serialization;

namespace WorkflowEngine.Api.Models;

/// <summary>
/// Hospital records in one table: departments, doctors, wards, beds, price list, formulary, lab catalogue, patients, appointments,
/// visits, prescriptions, lab requests, admissions, invoices, stock movements and the access audit of patient files.
/// The varying fields live in <see cref="Data"/> (JSON); Kind / Code / Branch / Status / Ref / Parent are real columns so they can be filtered.
/// </summary>
public class HosRecord : WorkflowEngine.Api.Security.ITenantOwned
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [JsonIgnore] public string TenantId { get; set; } = Tenant.DefaultId;
    public string Kind { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? Company { get; set; }
    public string? Branch { get; set; }
    public string? Status { get; set; }
    public string? Ref { get; set; }
    public string? Parent { get; set; }
    public string Data { get; set; } = "{}";
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
