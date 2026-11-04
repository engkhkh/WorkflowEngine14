using System.Text.Json.Serialization;

namespace WorkflowEngine.Api.Models;

/// <summary>
/// One table for the point-of-sale records: products, categories, customers (loyalty), promotions, registers, shifts, cash movements,
/// sales and returns, stock per branch, stock movements, transfers and settings. The varying fields live in <see cref="Data"/> (JSON).
/// Kind / Code / Branch / Status / Ref / Parent are real columns so they can be filtered.
/// Branch is empty when the company works without branches (a single store).
/// </summary>
public class PosRecord : WorkflowEngine.Api.Security.ITenantOwned
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [JsonIgnore] public string TenantId { get; set; } = Tenant.DefaultId;
    public string Kind { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? Company { get; set; }
    public string? Branch { get; set; }
    public string? Status { get; set; }
    public string? Ref { get; set; }        // sale / cash movement -> shift code
    public string? Parent { get; set; }     // return -> original sale code, stock movement -> document code
    public string Data { get; set; } = "{}";
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
