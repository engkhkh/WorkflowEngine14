using System.Text.Json.Serialization;

namespace WorkflowEngine.Api.Models;

/// <summary>
/// Custom modules made by the company itself (from Custom modules or by telling the assistant).
/// Kind "_def" = the module definition (Code = module key, Data = title, icon, colour, fields); any other Kind = a record of that module (Kind = module key).
/// </summary>
public class CustRecord : WorkflowEngine.Api.Security.ITenantOwned
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [JsonIgnore] public string TenantId { get; set; } = Tenant.DefaultId;
    public string Kind { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? Status { get; set; }
    public string Data { get; set; } = "{}";
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
