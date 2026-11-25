using System.Text.Json.Serialization;

namespace WorkflowEngine.Api.Models;

/// <summary>
/// Calendar entry: Kind = "event" | "meeting" | "todo" | "setting". Times are UTC; the browser shows them in the user's own zone.
/// Attendees, external guests, repeat rule, reminder and RSVPs live in <see cref="Data"/> (JSON).
/// </summary>
public class CalEvent : WorkflowEngine.Api.Security.ITenantOwned
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [JsonIgnore] public string TenantId { get; set; } = Tenant.DefaultId;
    public string Kind { get; set; } = "event";
    public string Title { get; set; } = string.Empty;
    public string Owner { get; set; } = string.Empty;
    public DateTime? StartUtc { get; set; }
    public DateTime? EndUtc { get; set; }
    public string? Status { get; set; }
    public string? Room { get; set; }
    public string Data { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
