using System.Text.Json.Serialization;
namespace WorkflowEngine.Api.Models;

/// <summary>
/// One table for the records of the Manufacturing, Projects and CRM modules (bills of materials, work orders, inspections,
/// projects, timesheets, costs, leads, opportunities, quotes ...). Module / Kind / Code / Company / Branch / Status are real
/// columns so they can be filtered; the varying fields live in <see cref="Data"/> (JSON).
/// </summary>
public class ErpRecord : WorkflowEngine.Api.Security.ITenantOwned
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [JsonIgnore] public string TenantId { get; set; } = Tenant.DefaultId;
    public string Module { get; set; } = string.Empty;     // mfg | prj | crm
    public string Kind { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? Company { get; set; }
    public string? Branch { get; set; }
    public string? Status { get; set; }
    public string? Ref { get; set; }                       // work order -> bom / project; timesheet, cost, task, milestone -> project code; opportunity -> account code
    public string? Parent { get; set; }
    public string Data { get; set; } = "{}";
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
