using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class CompanyDto
{
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string Currency { get; set; } = "SAR";
    public string? TaxNo { get; set; }
    public string? Country { get; set; }
    public static CompanyDto From(OrgCompany c) => new() { Code = c.Code, Name = c.Name, NameAr = c.NameAr, Currency = c.Currency, TaxNo = c.TaxNo, Country = c.Country };
}

public class BranchDto
{
    public string Code { get; set; } = string.Empty;
    public string Company { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string Warehouse { get; set; } = string.Empty;
    public string? City { get; set; }
    public static BranchDto From(OrgBranch b) => new() { Code = b.Code, Company = b.CompanyCode, Name = b.Name, NameAr = b.NameAr, Warehouse = b.Warehouse, City = b.City };
}

public class TenantDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Plan { get; set; } = string.Empty;
    public int MaxUsers { get; set; }
    public int MaxCompanies { get; set; }
    public int MaxBranches { get; set; }
    public int Users { get; set; }
    public int Companies { get; set; }
    public int Branches { get; set; }
    /// <summary>False until the administrator finishes the first-run setup wizard.</summary>
    public bool SetupDone { get; set; } = true;
}

public class OrgSnapshotDto
{
    public TenantDto Tenant { get; set; } = new();
    public List<CompanyDto> Companies { get; set; } = new();
    public List<BranchDto> Branches { get; set; } = new();
}

/// <summary>
/// The signed-in user's workspace: its companies and branches. Anyone signed in can READ them (the apps
/// need them for the company/branch pickers); adding, editing and deleting needs the org.manage privilege.
/// </summary>
[ApiController]
[Route("api/org")]
[Authorize]
public class OrgController : ControllerBase
{
    private static readonly Regex CodeRx = new("^[A-Z0-9_-]{1,12}$", RegexOptions.Compiled);

    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;

    public OrgController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant)
    {
        _db = db;
        _perms = perms;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<ActionResult<OrgSnapshotDto>> Get()
    {
        var tenantId = await _tenant.TenantIdOf(User);
        var companies = await _db.OrgCompanies.AsNoTracking().Where(c => c.TenantId == tenantId).OrderBy(c => c.Code).ToListAsync();
        var branches = await _db.OrgBranches.AsNoTracking().Where(b => b.TenantId == tenantId).OrderBy(b => b.Code).ToListAsync();
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId) ?? new Tenant { Id = tenantId, Name = tenantId };
        return Ok(new OrgSnapshotDto
        {
            Tenant = new TenantDto
            {
                Id = tenant.Id, Name = tenant.Name, Plan = tenant.Plan,
                MaxUsers = tenant.MaxUsers, MaxCompanies = tenant.MaxCompanies, MaxBranches = tenant.MaxBranches,
                Users = await _db.Users.CountAsync(u => u.TenantId == tenantId),
                Companies = companies.Count, Branches = branches.Count, SetupDone = tenant.SetupDone
            },
            Companies = companies.Select(CompanyDto.From).ToList(),
            Branches = branches.Select(BranchDto.From).ToList()
        });
    }

    public class ModulesDto { public List<string> Enabled { get; set; } = new(); }

    /// <summary>The business modules and which of them this workspace uses (anyone signed in may read; switching needs org.manage).</summary>
    [HttpGet("modules")]
    public async Task<IActionResult> GetModules()
    {
        var tenantId = await _tenant.TenantIdOf(User);
        var t = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tenantId);
        var on = t?.Modules;
        return Ok(new { all = ModuleCatalog.All.Select(m => m.Key), enabled = on ?? ModuleCatalog.All.Select(m => m.Key).ToList(), restricted = on != null });
    }

    [HttpPut("modules")]
    public async Task<IActionResult> SetModules([FromBody] ModulesDto dto)
    {
        if (!await _perms.Has(User, Permissions.OrgManage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var t = await _db.Tenants.FirstOrDefaultAsync(x => x.Id == tenantId);
        if (t == null) return NotFound();
        t.Modules = ModuleCatalog.Sanitize(dto.Enabled);
        await _db.SaveChangesAsync();
        await RbacStore.Reload(_db);                         // privileges of switched-off modules disappear at once
        return Ok(new { enabled = t.Modules });
    }

    /// <summary>The administrator finished (or skipped) the first-run setup wizard.</summary>
    [HttpPost("setup/complete")]
    public async Task<IActionResult> CompleteSetup()
    {
        if (!await _perms.Has(User, Permissions.OrgManage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var t = await _db.Tenants.FirstOrDefaultAsync(x => x.Id == tenantId);
        if (t != null) { t.SetupDone = true; await _db.SaveChangesAsync(); }
        return NoContent();
    }

    // ------------------------------------------------------------ companies

    [HttpPost("companies")]
    public async Task<ActionResult<CompanyDto>> CreateCompany([FromBody] CompanyDto dto)
    {
        if (!await _perms.Has(User, Permissions.OrgManage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var code = (dto.Code ?? string.Empty).Trim().ToUpperInvariant();
        if (!CodeRx.IsMatch(code)) return BadRequest("Code must be 1-12 letters, digits, '-' or '_'.");
        if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest("Name is required.");
        if (await _db.OrgCompanies.AnyAsync(c => c.TenantId == tenantId && c.Code == code)) return Conflict("That company code already exists.");
        var (ok, message) = await _tenant.CheckLimit(tenantId, PlanLimit.Companies);
        if (!ok) return StatusCode(402, message);

        var c = new OrgCompany
        {
            TenantId = tenantId, Code = code, Name = dto.Name.Trim(),
            NameAr = string.IsNullOrWhiteSpace(dto.NameAr) ? dto.Name.Trim() : dto.NameAr.Trim(),
            Currency = string.IsNullOrWhiteSpace(dto.Currency) ? "SAR" : dto.Currency.Trim().ToUpperInvariant(),
            TaxNo = string.IsNullOrWhiteSpace(dto.TaxNo) ? null : dto.TaxNo.Trim(),
            Country = string.IsNullOrWhiteSpace(dto.Country) ? null : dto.Country.Trim()
        };
        _db.OrgCompanies.Add(c);
        await _db.SaveChangesAsync();
        return Ok(CompanyDto.From(c));
    }

    [HttpPut("companies/{code}")]
    public async Task<ActionResult<CompanyDto>> UpdateCompany(string code, [FromBody] CompanyDto dto)
    {
        if (!await _perms.Has(User, Permissions.OrgManage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var c = await _db.OrgCompanies.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Code == code);
        if (c == null) return NotFound();
        if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest("Name is required.");
        c.Name = dto.Name.Trim();
        c.NameAr = string.IsNullOrWhiteSpace(dto.NameAr) ? c.Name : dto.NameAr.Trim();
        c.Currency = string.IsNullOrWhiteSpace(dto.Currency) ? c.Currency : dto.Currency.Trim().ToUpperInvariant();
        c.TaxNo = string.IsNullOrWhiteSpace(dto.TaxNo) ? null : dto.TaxNo.Trim();
        c.Country = string.IsNullOrWhiteSpace(dto.Country) ? null : dto.Country.Trim();
        await _db.SaveChangesAsync();
        return Ok(CompanyDto.From(c));
    }

    /// <summary>Removes the company and its branches. Existing documents keep the code as plain text, so history stays readable.</summary>
    [HttpDelete("companies/{code}")]
    public async Task<IActionResult> DeleteCompany(string code)
    {
        if (!await _perms.Has(User, Permissions.OrgManage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var c = await _db.OrgCompanies.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Code == code);
        if (c == null) return NotFound();
        if (await _db.OrgCompanies.CountAsync(x => x.TenantId == tenantId) <= 1) return BadRequest("At least one company must remain.");
        _db.OrgBranches.RemoveRange(_db.OrgBranches.Where(b => b.TenantId == tenantId && b.CompanyCode == code));
        _db.OrgCompanies.Remove(c);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ------------------------------------------------------------ branches

    [HttpPost("branches")]
    public async Task<ActionResult<BranchDto>> CreateBranch([FromBody] BranchDto dto)
    {
        if (!await _perms.Has(User, Permissions.OrgManage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var code = (dto.Code ?? string.Empty).Trim().ToUpperInvariant();
        if (!CodeRx.IsMatch(code)) return BadRequest("Code must be 1-12 letters, digits, '-' or '_'.");
        if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest("Name is required.");
        if (!await _db.OrgCompanies.AnyAsync(c => c.TenantId == tenantId && c.Code == dto.Company)) return BadRequest("Unknown company.");
        if (await _db.OrgBranches.AnyAsync(b => b.TenantId == tenantId && b.Code == code)) return Conflict("That branch code already exists.");
        var (ok, message) = await _tenant.CheckLimit(tenantId, PlanLimit.Branches);
        if (!ok) return StatusCode(402, message);

        var b = new OrgBranch
        {
            TenantId = tenantId, Code = code, CompanyCode = dto.Company, Name = dto.Name.Trim(),
            NameAr = string.IsNullOrWhiteSpace(dto.NameAr) ? dto.Name.Trim() : dto.NameAr.Trim(),
            Warehouse = string.IsNullOrWhiteSpace(dto.Warehouse) ? "WH-" + code : dto.Warehouse.Trim(),
            City = string.IsNullOrWhiteSpace(dto.City) ? null : dto.City.Trim()
        };
        _db.OrgBranches.Add(b);
        await _db.SaveChangesAsync();
        return Ok(BranchDto.From(b));
    }

    [HttpPut("branches/{code}")]
    public async Task<ActionResult<BranchDto>> UpdateBranch(string code, [FromBody] BranchDto dto)
    {
        if (!await _perms.Has(User, Permissions.OrgManage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var b = await _db.OrgBranches.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Code == code);
        if (b == null) return NotFound();
        if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest("Name is required.");
        if (!string.IsNullOrWhiteSpace(dto.Company) && dto.Company != b.CompanyCode)
        {
            if (!await _db.OrgCompanies.AnyAsync(c => c.TenantId == tenantId && c.Code == dto.Company)) return BadRequest("Unknown company.");
            b.CompanyCode = dto.Company;
        }
        b.Name = dto.Name.Trim();
        b.NameAr = string.IsNullOrWhiteSpace(dto.NameAr) ? b.Name : dto.NameAr.Trim();
        b.Warehouse = string.IsNullOrWhiteSpace(dto.Warehouse) ? "WH-" + b.Code : dto.Warehouse.Trim();
        b.City = string.IsNullOrWhiteSpace(dto.City) ? null : dto.City.Trim();
        await _db.SaveChangesAsync();
        return Ok(BranchDto.From(b));
    }

    [HttpDelete("branches/{code}")]
    public async Task<IActionResult> DeleteBranch(string code)
    {
        if (!await _perms.Has(User, Permissions.OrgManage)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var b = await _db.OrgBranches.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Code == code);
        if (b == null) return NotFound();
        _db.OrgBranches.Remove(b);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
