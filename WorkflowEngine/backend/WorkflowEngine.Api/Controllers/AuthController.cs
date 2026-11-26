using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class LoginRequest
{
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class LoginResponse
{
    public string Token { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public List<string> Permissions { get; set; } = new();
    /// <summary>SaaS workspace the user belongs to.</summary>
    public string TenantId { get; set; } = string.Empty;
    public string TenantName { get; set; } = string.Empty;
    /// <summary>Branches the user is limited to; null = all.</summary>
    public List<string>? Branches { get; set; }
}

public class AcceptInviteRequest { public string Token { get; set; } = string.Empty; public string Password { get; set; } = string.Empty; }

[ApiController]
[Route("api/auth")]
[AllowAnonymous]
public class AuthController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IJwtTokenService _jwt;
    private readonly IConfiguration _config;

    public AuthController(WorkflowDbContext db, IJwtTokenService jwt, IConfiguration config)
    {
        _db = db;
        _jwt = jwt;
        _config = config;
    }

    [HttpPost("login")]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == request.Username && u.IsActive);
        if (user != null && string.IsNullOrEmpty(user.PasswordHash)) return Unauthorized("Your invitation has not been accepted yet. Open the invitation link you received.");
        if (user == null || !PasswordHasher.Verify(request.Password, user.PasswordHash, user.PasswordSalt))
            return Unauthorized("Invalid username or password.");

        var tenantName = await _db.Tenants.Where(t => t.Id == user.TenantId).Select(t => t.Name).FirstOrDefaultAsync() ?? string.Empty;
        var token = _jwt.CreateToken(user);
        return Ok(new LoginResponse
        {
            Token = token,
            Id = user.Id,
            Username = user.Username,
            DisplayName = user.DisplayName,
            Role = user.Role,
            Permissions = WorkflowEngine.Api.Services.Permissions.Effective(user),
            TenantId = user.TenantId,
            TenantName = tenantName,
            Branches = user.Branches != null && user.Branches.Count > 0 ? user.Branches : null
        });
    }

    /// <summary>Who an invitation link is for (shown on the "choose your password" page).</summary>
    [HttpGet("invite")]
    public async Task<IActionResult> InviteInfo([FromQuery] string token)
    {
        var id = InviteTokens.ReadUserId(_config, token);
        var user = id == null ? null : await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id && u.IsActive && u.PasswordHash == "");
        if (user == null) return NotFound(new { message = "This invitation is invalid, expired or already used." });
        var tenantName = await _db.Tenants.Where(t => t.Id == user.TenantId).Select(t => t.Name).FirstOrDefaultAsync() ?? string.Empty;
        return Ok(new { username = user.Username, displayName = user.DisplayName, workspace = tenantName });
    }

    /// <summary>The invited person chooses a password and is signed in.</summary>
    [HttpPost("accept-invite")]
    public async Task<ActionResult<LoginResponse>> AcceptInvite([FromBody] AcceptInviteRequest req)
    {
        if (string.IsNullOrEmpty(req.Password) || req.Password.Length < 6) return BadRequest(new { message = "Password must be at least 6 characters." });
        var id = InviteTokens.ReadUserId(_config, req.Token);
        var user = id == null ? null : await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.IsActive && u.PasswordHash == "");
        if (user == null) return NotFound(new { message = "This invitation is invalid, expired or already used." });
        var (hash, salt) = PasswordHasher.Hash(req.Password);
        user.PasswordHash = hash; user.PasswordSalt = salt;
        await _db.SaveChangesAsync();
        var tenantName = await _db.Tenants.Where(t => t.Id == user.TenantId).Select(t => t.Name).FirstOrDefaultAsync() ?? string.Empty;
        return Ok(new LoginResponse
        {
            Token = _jwt.CreateToken(user), Id = user.Id, Username = user.Username, DisplayName = user.DisplayName, Role = user.Role,
            Permissions = WorkflowEngine.Api.Services.Permissions.Effective(user), TenantId = user.TenantId, TenantName = tenantName,
            Branches = user.Branches != null && user.Branches.Count > 0 ? user.Branches : null
        });
    }
}
