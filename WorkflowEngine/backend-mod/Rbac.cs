namespace WorkflowEngine.Api.Models;

/// <summary>
/// One privilege (a page / action key such as "finance.ar.manage") stored in the database. The built-in keys are seeded from code on
/// startup; an admin can switch a privilege off (hides the page / refuses the action for everyone), move it to another group,
/// or add keys of their own to protect extra pages. TenantId "" = built-in (all workspaces), otherwise a workspace's own key.
/// </summary>
public class PermissionDef
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string TenantId { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string Group { get; set; } = string.Empty;
    public string? Label { get; set; }
    public string? Route { get; set; }          // the portal / mobile page this privilege opens, e.g. "/pos/terminal"
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsCustom { get; set; }
}

/// <summary>The default privileges of a role. TenantId "" = platform default (seeded), otherwise this workspace's own version.</summary>
public class RoleDef
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string TenantId { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string? Name { get; set; }
    public string Permissions { get; set; } = "[]";   // JSON array of keys
    public bool IsSystem { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
