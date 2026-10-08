using System.Security.Claims;
using System.Text.RegularExpressions;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class RbacPermissionDto { public string Key { get; set; } = ""; public string Group { get; set; } = ""; public string? Label { get; set; } public string? Route { get; set; } public int SortOrder { get; set; } public bool IsActive { get; set; } = true; public bool IsCustom { get; set; } }
public class RbacRoleDto { public string Role { get; set; } = ""; public string? Name { get; set; } public List<string> Permissions { get; set; } = new(); public bool IsSystem { get; set; } public bool Customised { get; set; } public int Users { get; set; } }
public class RbacCatalogDto { public List<RbacPermissionDto> Permissions { get; set; } = new(); public List<RbacRoleDto> Roles { get; set; } = new(); }
public class RbacSaveRole { public string? Name { get; set; } public List<string>? Permissions { get; set; } public string? CopyFrom { get; set; } public string? Role { get; set; } }
public class RbacSavePerm { public string? Key { get; set; } public string? Group { get; set; } public string? Label { get; set; } public string? Route { get; set; } public int? SortOrder { get; set; } public bool? IsActive { get; set; } }

/// <summary>
/// Admin module: the privilege / page catalog and the roles are stored in the database. Everything here needs admin.users and is
/// scoped to the caller's workspace (a workspace's changes never affect another one).
/// </summary>
[ApiController]
[Route("api/admin/rbac")]
[Authorize]
public class RbacController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;
    public RbacController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant) { _db = db; _perms = perms; _tenant = tenant; }

    private static readonly Regex KeyRx = new(@"^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,3}$", RegexOptions.Compiled);
    private static readonly Regex RoleRx = new(@"^[a-z][a-z0-9-]{1,30}$", RegexOptions.Compiled);
    private static readonly string[] Locked = { Permissions.AdminUsers, "dashboard.view" };
    private BadRequestObjectResult Bad(string m) => BadRequest(new { message = m });

    private async Task<RbacCatalogDto> Build(string tenantId)
    {
        await RbacStore.Reload(_db);
        var dto = new RbacCatalogDto
        {
            Permissions = RbacStore.DefsFor(tenantId).OrderBy(d => d.SortOrder).Select(d => new RbacPermissionDto { Key = d.Key, Group = d.Group, Label = d.Label, Route = d.Route, SortOrder = d.SortOrder, IsActive = d.IsActive, IsCustom = d.IsCustom }).ToList()
        };
        var userRoles = await _db.Users.Where(u => u.TenantId == tenantId).GroupBy(u => u.Role).Select(g => new { Role = g.Key, N = g.Count() }).ToListAsync();
        var own = await _db.RoleDefs.AsNoTracking().Where(r => r.TenantId == tenantId).ToListAsync();
        foreach (var kv in RbacStore.RolesFor(tenantId).OrderBy(k => k.Key))
        {
            var row = own.FirstOrDefault(r => string.Equals(r.Role, kv.Key, StringComparison.OrdinalIgnoreCase));
            dto.Roles.Add(new RbacRoleDto { Role = kv.Key, Name = row?.Name, Permissions = kv.Value.ToList(), IsSystem = Permissions.CodeRoleDefaults.ContainsKey(kv.Key), Customised = row != null,
                Users = userRoles.Where(u => string.Equals(u.Role, kv.Key, StringComparison.OrdinalIgnoreCase)).Sum(u => u.N) });
        }
        return dto;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        return Ok(await Build(await _tenant.TenantIdOf(User)));
    }

    /// <summary>Saves what a role gets by default (creates this workspace's own copy of a platform role).</summary>
    [HttpPut("roles/{role}")]
    public async Task<IActionResult> SaveRole(string role, [FromBody] RbacSaveRole b)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        if (string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase)) return Bad("The admin role always has every privilege.");
        var tenantId = await _tenant.TenantIdOf(User);
        var allowed = RbacStore.AllActiveFor(tenantId).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var keys = (b.Permissions ?? new()).Where(allowed.Contains).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var known = RbacStore.RolesFor(tenantId).ContainsKey(role);
        if (!known) return NotFound();
        var row = await _db.RoleDefs.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Role == role);
        if (row == null) { row = new RoleDef { TenantId = tenantId, Role = role, IsSystem = Permissions.CodeRoleDefaults.ContainsKey(role) }; _db.RoleDefs.Add(row); }
        row.Permissions = JsonSerializer.Serialize(keys); row.UpdatedAt = DateTime.UtcNow;
        if (b.Name != null) row.Name = b.Name.Trim();
        await _db.SaveChangesAsync();
        return Ok(await Build(tenantId));
    }

    /// <summary>Creates a new role for this workspace (optionally copied from another one).</summary>
    [HttpPost("roles")]
    public async Task<IActionResult> CreateRole([FromBody] RbacSaveRole b)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var role = (b.Role ?? "").Trim().ToLowerInvariant();
        if (!RoleRx.IsMatch(role)) return Bad("Use lowercase letters, digits and dashes for the role code.");
        var tenantId = await _tenant.TenantIdOf(User);
        if (RbacStore.RolesFor(tenantId).ContainsKey(role)) return Conflict(new { message = "That role already exists." });
        var allowed = RbacStore.AllActiveFor(tenantId).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var src = b.Permissions ?? (b.CopyFrom != null && RbacStore.RolesFor(tenantId).TryGetValue(b.CopyFrom, out var c) ? c.ToList() : new List<string>());
        _db.RoleDefs.Add(new RoleDef { TenantId = tenantId, Role = role, Name = b.Name?.Trim(), IsSystem = false, Permissions = JsonSerializer.Serialize(src.Where(allowed.Contains).Distinct(StringComparer.OrdinalIgnoreCase)) });
        await _db.SaveChangesAsync();
        return Ok(await Build(tenantId));
    }

    /// <summary>Deletes a custom role (only when nobody has it) or restores a built-in role to the platform default.</summary>
    [HttpDelete("roles/{role}")]
    public async Task<IActionResult> DeleteRole(string role)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var row = await _db.RoleDefs.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Role == role);
        if (row == null) return NotFound();
        if (!Permissions.CodeRoleDefaults.ContainsKey(role) && await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Role == role))
            return Bad("Move the users of this role to another role first.");
        _db.RoleDefs.Remove(row);
        await _db.SaveChangesAsync();
        return Ok(await Build(tenantId));
    }

    /// <summary>Adds a privilege of the workspace's own, to protect an extra page.</summary>
    [HttpPost("permissions")]
    public async Task<IActionResult> AddPermission([FromBody] RbacSavePerm b)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var key = (b.Key ?? "").Trim().ToLowerInvariant();
        if (!KeyRx.IsMatch(key)) return Bad("Use a key like \"sales.discounts\" (lowercase, dot separated).");
        var tenantId = await _tenant.TenantIdOf(User);
        if (RbacStore.DefsFor(tenantId).Any(d => string.Equals(d.Key, key, StringComparison.OrdinalIgnoreCase))) return Conflict(new { message = "That privilege already exists." });
        var group = string.IsNullOrWhiteSpace(b.Group) ? key.Split('.')[0] : b.Group.Trim().ToLowerInvariant();
        var max = RbacStore.DefsFor(tenantId).Select(d => d.SortOrder).DefaultIfEmpty(0).Max();
        _db.PermissionDefs.Add(new PermissionDef { TenantId = tenantId, Key = key, Group = group, Label = b.Label?.Trim(), Route = b.Route?.Trim(), SortOrder = max + 10, IsActive = true, IsCustom = true });
        await _db.SaveChangesAsync();
        return Ok(await Build(tenantId));
    }

    /// <summary>Switches a privilege / page on or off, or edits its label, route and group. Built-in keys can be switched but not renamed.</summary>
    [HttpPut("permissions/{key}")]
    public async Task<IActionResult> SavePermission(string key, [FromBody] RbacSavePerm b)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        // a built-in privilege is shared by every workspace, so a workspace switches it off through its own override row
        var own = await _db.PermissionDefs.FirstOrDefaultAsync(d => d.Key == key && d.TenantId == tenantId);
        var builtin = await _db.PermissionDefs.AsNoTracking().FirstOrDefaultAsync(d => d.Key == key && d.TenantId == "");
        if (own == null && builtin == null) return NotFound();
        if (b.IsActive == false && Locked.Contains(key, StringComparer.OrdinalIgnoreCase)) return Bad("This privilege can't be switched off.");
        if (own == null)
        {   // workspace-level override of a built-in key
            own = new PermissionDef { TenantId = tenantId, Key = key, Group = builtin!.Group, SortOrder = builtin.SortOrder, IsActive = builtin.IsActive, IsCustom = false, Label = builtin.Label, Route = builtin.Route };
            _db.PermissionDefs.Add(own);
        }
        if (b.IsActive != null) own.IsActive = b.IsActive.Value;
        if (b.Label != null) own.Label = b.Label.Trim();
        if (b.Route != null) own.Route = b.Route.Trim();
        if (own.IsCustom)
        {
            if (!string.IsNullOrWhiteSpace(b.Group)) own.Group = b.Group.Trim().ToLowerInvariant();
            if (b.SortOrder != null) own.SortOrder = b.SortOrder.Value;
        }
        await _db.SaveChangesAsync();
        return Ok(await Build(tenantId));
    }

    [HttpDelete("permissions/{key}")]
    public async Task<IActionResult> DeletePermission(string key)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var row = await _db.PermissionDefs.FirstOrDefaultAsync(d => d.Key == key && d.TenantId == tenantId);
        if (row == null) return NotFound();
        _db.PermissionDefs.Remove(row);   // a custom key is deleted; the override of a built-in key is simply reset
        await _db.SaveChangesAsync();
        return Ok(await Build(tenantId));
    }
}
