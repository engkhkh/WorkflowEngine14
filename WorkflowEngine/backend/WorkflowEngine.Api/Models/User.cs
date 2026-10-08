namespace WorkflowEngine.Api.Models;

public class User
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Username { get; set; } = string.Empty;     // login name, also usable as a node Assignee
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;

    // Role doubles as a "queue": a node's Assignee can be set to a specific Username
    // (goes to exactly that person) or to a Role (goes to everyone with that role) -
    // the task inbox matches on either, same as Skelta's user/role assignment.
    public string Role { get; set; } = string.Empty;

    public string PasswordHash { get; set; } = string.Empty;
    public string PasswordSalt { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;

    // ERP privileges managed from the Admin module (see Services/PermissionService.cs).
    // null = follow the role's default privileges. Stored as a JSON text column; Program.cs adds
    // the column to an existing database automatically on startup (no migration needed).
    public List<string>? Permissions { get; set; }

    // SaaS workspace this user belongs to (Tenant.Id). Existing users belong to "default".
    // Column is added automatically on startup (Services/SchemaUpgrade.cs).
    public string TenantId { get; set; } = Tenant.DefaultId;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
