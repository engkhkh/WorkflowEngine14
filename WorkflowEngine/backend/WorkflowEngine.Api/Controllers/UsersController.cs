using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class UserSummary
{
    public string Id { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
}

/// <summary>Full user record for the Admin module - still never includes password fields.</summary>
public class AdminUserDto
{
    public string Id { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    /// <summary>null = the user follows their role's default privileges.</summary>
    public List<string>? Permissions { get; set; }
    public List<string> EffectivePermissions { get; set; } = new();

    public static AdminUserDto From(User u) => new()
    {
        Id = u.Id, Username = u.Username, DisplayName = u.DisplayName, Email = u.Email, Role = u.Role,
        IsActive = u.IsActive, CreatedAt = u.CreatedAt, Permissions = u.Permissions,
        EffectivePermissions = WorkflowEngine.Api.Services.Permissions.Effective(u)
    };
}

public class SaveUserRequest
{
    public string? Username { get; set; }          // create only
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Role { get; set; } = "employee";
    public bool IsActive { get; set; } = true;
    public string? Password { get; set; }          // create only (use reset-password afterwards)
    /// <summary>null = use role defaults; a list (even empty) = custom privileges.</summary>
    public List<string>? Permissions { get; set; }
}

public class ResetPasswordRequest { public string Password { get; set; } = string.Empty; }

public class PermissionCatalogDto
{
    public List<PermissionGroupDto> Groups { get; set; } = new();
    public Dictionary<string, string[]> RoleDefaults { get; set; } = new();
    public List<string> Roles { get; set; } = new();
}
public class PermissionGroupDto { public string Group { get; set; } = string.Empty; public string[] Keys { get; set; } = Array.Empty<string>(); }

[ApiController]
[Route("api/users")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;

    public UsersController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant)
    {
        _db = db;
        _perms = perms;
        _tenant = tenant;
    }

    private string Username => User.FindFirstValue(ClaimTypes.Name)!;

    // Deliberately returns no password fields - this is the directory the designer's
    // assignee picker and any "who is this task with" display uses.
    [HttpGet]
    public async Task<ActionResult<IEnumerable<UserSummary>>> GetAll()
    {
        var tenantId = await _tenant.TenantIdOf(User);
        return Ok(await _db.Users.Where(u => u.IsActive && u.TenantId == tenantId)
            .Select(u => new UserSummary { Id = u.Id, Username = u.Username, DisplayName = u.DisplayName, Role = u.Role })
            .OrderBy(u => u.DisplayName)
            .ToListAsync());
    }

    /// <summary>The signed-in user with their current effective privileges (apps refresh this on start).</summary>
    [HttpGet("me")]
    public async Task<ActionResult<AdminUserDto>> Me()
    {
        var u = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Username == Username && x.IsActive);
        return u == null ? Unauthorized() : Ok(AdminUserDto.From(u));
    }

    // ------------------------------------------------------------ admin module

    [HttpGet("permissions")]
    public async Task<ActionResult<PermissionCatalogDto>> Catalog()
    {
        var tenantId = await _tenant.TenantIdOf(User);
        var roles = await _db.Users.Where(u => u.TenantId == tenantId).Select(u => u.Role).Distinct().ToListAsync();
        roles.AddRange(Permissions.RoleDefaults.Keys);
        return Ok(new PermissionCatalogDto
        {
            Groups = Permissions.Catalog.Select(g => new PermissionGroupDto { Group = g.Group, Keys = g.Keys }).ToList(),
            RoleDefaults = Permissions.RoleDefaults.ToDictionary(k => k.Key, v => v.Value),
            Roles = roles.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(r => r).ToList()
        });
    }

    [HttpGet("admin")]
    public async Task<ActionResult<IEnumerable<AdminUserDto>>> AdminList()
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var users = await _db.Users.AsNoTracking().Where(u => u.TenantId == tenantId).OrderBy(u => u.DisplayName).ToListAsync();
        return Ok(users.Select(AdminUserDto.From));
    }

    [HttpPost("admin")]
    public async Task<ActionResult<AdminUserDto>> Create([FromBody] SaveUserRequest req)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var username = (req.Username ?? string.Empty).Trim();
        if (username.Length < 2) return BadRequest("Username is required.");
        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6) return BadRequest("Password must be at least 6 characters.");
        if (await _db.Users.AnyAsync(u => u.Username == username)) return Conflict("That username already exists.");

        var tenantId = await _tenant.TenantIdOf(User);
        var (withinLimit, limitMessage) = await _tenant.CheckLimit(tenantId, PlanLimit.Users);
        if (!withinLimit) return StatusCode(402, limitMessage);

        var (hash, salt) = PasswordHasher.Hash(req.Password);
        var user = new User
        {
            Username = username,
            DisplayName = string.IsNullOrWhiteSpace(req.DisplayName) ? username : req.DisplayName.Trim(),
            Email = req.Email?.Trim() ?? string.Empty,
            Role = string.IsNullOrWhiteSpace(req.Role) ? "employee" : req.Role.Trim(),
            IsActive = req.IsActive,
            TenantId = tenantId,
            PasswordHash = hash,
            PasswordSalt = salt,
            Permissions = req.Permissions == null ? null : Permissions.Sanitize(req.Permissions)
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        return Ok(AdminUserDto.From(user));
    }

    [HttpPut("admin/{id}")]
    public async Task<ActionResult<AdminUserDto>> Update(string id, [FromBody] SaveUserRequest req)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.TenantId == tenantId);
        if (user == null) return NotFound();

        var newPerms = req.Permissions == null ? null : Permissions.Sanitize(req.Permissions);
        var candidate = new User { Role = string.IsNullOrWhiteSpace(req.Role) ? user.Role : req.Role.Trim(), Permissions = newPerms, IsActive = req.IsActive };

        // Guard rails: never lock the last administrator (or yourself) out of the Admin module.
        var keepsAdmin = candidate.IsActive && Permissions.Effective(candidate).Contains(Permissions.AdminUsers);
        if (user.Username == Username && !keepsAdmin)
            return BadRequest("You can't remove your own admin access or deactivate yourself.");
        if (!keepsAdmin && Permissions.Effective(user).Contains(Permissions.AdminUsers) && user.IsActive && !await OtherActiveAdminExists(user.Id, tenantId))
            return BadRequest("At least one active user must keep the 'Manage users & privileges' privilege.");

        user.DisplayName = string.IsNullOrWhiteSpace(req.DisplayName) ? user.DisplayName : req.DisplayName.Trim();
        user.Email = req.Email?.Trim() ?? string.Empty;
        user.Role = candidate.Role;
        user.IsActive = req.IsActive;
        user.Permissions = newPerms;
        await _db.SaveChangesAsync();
        return Ok(AdminUserDto.From(user));
    }

    [HttpPost("admin/{id}/reset-password")]
    public async Task<IActionResult> ResetPassword(string id, [FromBody] ResetPasswordRequest req)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6) return BadRequest("Password must be at least 6 characters.");
        var tenantId = await _tenant.TenantIdOf(User);
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.TenantId == tenantId);
        if (user == null) return NotFound();
        var (hash, salt) = PasswordHasher.Hash(req.Password);
        user.PasswordHash = hash;
        user.PasswordSalt = salt;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Deletes the account. Tasks/instances keep the username as plain text, so history stays readable.
    /// Prefer deactivating (IsActive = false) when you might need the account again.</summary>
    [HttpDelete("admin/{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.TenantId == tenantId);
        if (user == null) return NotFound();
        if (user.Username == Username) return BadRequest("You can't delete your own account.");
        if (user.IsActive && Permissions.Effective(user).Contains(Permissions.AdminUsers) && !await OtherActiveAdminExists(user.Id, tenantId))
            return BadRequest("At least one active user must keep the 'Manage users & privileges' privilege.");
        _db.Users.Remove(user);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<bool> OtherActiveAdminExists(string exceptId, string tenantId)
    {
        var others = await _db.Users.AsNoTracking().Where(u => u.IsActive && u.Id != exceptId && u.TenantId == tenantId).ToListAsync();
        return others.Any(u => Permissions.Effective(u).Contains(Permissions.AdminUsers));
    }
}
