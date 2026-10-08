using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class SignupRequest
{
    public string WorkspaceName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string Currency { get; set; } = "SAR";
    public string? BranchName { get; set; }
}

/// <summary>
/// SaaS self-service sign-up: creates a private workspace (Starter plan) with its first company and branch, and its
/// administrator account - then signs that administrator in. Anonymous on purpose; if you don't want open sign-ups,
/// set "Signup:Enabled": false in appsettings.json.
/// </summary>
[ApiController]
[Route("api/tenants")]
[AllowAnonymous]
public class TenantsController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IJwtTokenService _jwt;
    private readonly IConfiguration _config;

    public TenantsController(WorkflowDbContext db, IJwtTokenService jwt, IConfiguration config)
    {
        _db = db;
        _jwt = jwt;
        _config = config;
    }

    [HttpPost("signup")]
    public async Task<ActionResult<LoginResponse>> Signup([FromBody] SignupRequest req)
    {
        if (!_config.GetValue("Signup:Enabled", true)) return StatusCode(403, "Sign-up is disabled.");

        var workspace = (req.WorkspaceName ?? string.Empty).Trim();
        var username = (req.Username ?? string.Empty).Trim();
        if (workspace.Length < 2) return BadRequest("Company name is required.");
        if (username.Length < 2) return BadRequest("Username is required.");
        if (string.IsNullOrWhiteSpace(req.DisplayName)) return BadRequest("Your name is required.");
        if (string.IsNullOrEmpty(req.Password) || req.Password.Length < 6) return BadRequest("Password must be at least 6 characters.");
        if (await _db.Users.AnyAsync(u => u.Username == username)) return Conflict("That username already exists.");

        // workspace id = slug of the name, made unique with a short suffix if needed
        var slug = Regex.Replace(workspace.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (slug.Length == 0) slug = "workspace";
        if (slug.Length > 40) slug = slug[..40];
        if (await _db.Tenants.AnyAsync(t => t.Id == slug)) slug += "-" + Guid.NewGuid().ToString("N")[..5];

        var tenant = new Tenant { Id = slug, Name = workspace };
        Plans.Apply(tenant, "starter");

        var companyCode = Initials(workspace, 4);
        var currency = string.IsNullOrWhiteSpace(req.Currency) ? "SAR" : req.Currency.Trim().ToUpperInvariant();
        var branchName = string.IsNullOrWhiteSpace(req.BranchName) ? "Head Office" : req.BranchName.Trim();
        var branchCode = string.IsNullOrWhiteSpace(req.BranchName) ? "HQ" : Initials(req.BranchName, 5);

        var (hash, salt) = PasswordHasher.Hash(req.Password);
        var admin = new User
        {
            Username = username,
            DisplayName = req.DisplayName.Trim(),
            Email = req.Email?.Trim() ?? string.Empty,
            Role = "admin",
            PasswordHash = hash,
            PasswordSalt = salt,
            TenantId = tenant.Id
        };

        _db.Tenants.Add(tenant);
        _db.OrgCompanies.Add(new OrgCompany { TenantId = tenant.Id, Code = companyCode, Name = workspace, NameAr = workspace, Currency = currency });
        _db.OrgBranches.Add(new OrgBranch { TenantId = tenant.Id, Code = branchCode, CompanyCode = companyCode, Name = branchName, NameAr = branchName, Warehouse = "WH-" + branchCode });
        _db.Users.Add(admin);
        await _db.SaveChangesAsync();

        return Ok(new LoginResponse
        {
            Token = _jwt.CreateToken(admin),
            Id = admin.Id,
            Username = admin.Username,
            DisplayName = admin.DisplayName,
            Role = admin.Role,
            Permissions = Permissions.Effective(admin),
            TenantId = tenant.Id,
            TenantName = tenant.Name
        });
    }

    /// <summary>Upper-case initials of the words (letters/digits only), e.g. "Acme Trading Co" -> "ATC"; falls back to "MAIN".</summary>
    private static string Initials(string name, int max)
    {
        var sb = new StringBuilder();
        foreach (var word in Regex.Split(name.Trim(), "[^A-Za-z0-9]+"))
        {
            if (word.Length > 0) sb.Append(char.ToUpperInvariant(word[0]));
            if (sb.Length >= max) break;
        }
        if (sb.Length < 2)
        {
            var letters = Regex.Replace(name, "[^A-Za-z0-9]", string.Empty).ToUpperInvariant();
            sb.Clear();
            sb.Append(letters.Length >= 2 ? letters[..Math.Min(letters.Length, max)] : "MAIN");
        }
        return sb.ToString();
    }
}
