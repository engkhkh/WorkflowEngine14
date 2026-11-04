"""Usage: python patch.py <backend/WorkflowEngine.Api folder>
Odoo-style onboarding: one company + several branches per workspace at sign-up, setup wizard flag, branch access per user, invitation links.
Idempotent. Adds Services/InviteTokens.cs separately (copy the file)."""
import sys
base = sys.argv[1]
def rw(path, fn):
    s = open(path, encoding='utf-8-sig').read(); n = fn(s)
    if n != s: open(path, 'w', encoding='utf-8').write(n); print('patched  ', path)
    else: print('unchanged', path)
def need(s, old, new, count=1):
    if old not in s: raise SystemExit('anchor not found: ' + old[:70])
    return s.replace(old, new, count)

# ---- models
rw(base + '/Models/User.cs', lambda s: s if 'Branches' in s else need(s, "    public List<string>? Permissions { get; set; }",
   "    public List<string>? Permissions { get; set; }\n\n    // Branches this user may work in (Odoo's \"allowed companies\"). null / empty = every branch of the workspace. Column added by SchemaUpgrade.\n    public List<string>? Branches { get; set; }"))
def tenant(s):
    if 'SetupDone' in s: return s
    s = need(s, "    public int MaxBranches { get; set; }\n", "    public int MaxBranches { get; set; }\n    /// <summary>False after self-service sign-up until the administrator finishes the setup wizard (company, branches, team).</summary>\n    public bool SetupDone { get; set; } = true;\n")
    s = need(s, "    public string? TaxNo { get; set; }\n}", "    public string? TaxNo { get; set; }\n    public string? Country { get; set; }\n}")
    return s
rw(base + '/Models/Tenant.cs', tenant)

# ---- db
rw(base + '/Data/WorkflowDbContext.cs', lambda s: s if 'x.Branches' in s else need(s, "            e.Property(x => x.Permissions).HasJsonConversion();\n            e.Property(x => x.TenantId).HasMaxLength(64);",
   "            e.Property(x => x.Permissions).HasJsonConversion();\n            e.Property(x => x.Branches).HasJsonConversion();\n            e.Property(x => x.TenantId).HasMaxLength(64);"))
def su(s):
    if 'SetupDone' in s: return s
    add = '''
        // Onboarding: branch access per user, setup wizard flag, company country
        "IF OBJECT_ID('dbo.Users','U') IS NOT NULL AND COL_LENGTH('dbo.Users','Branches') IS NULL ALTER TABLE dbo.Users ADD [Branches] nvarchar(max) NULL;",
        "IF OBJECT_ID('dbo.Tenants','U') IS NOT NULL AND COL_LENGTH('dbo.Tenants','SetupDone') IS NULL ALTER TABLE dbo.Tenants ADD [SetupDone] bit NOT NULL CONSTRAINT DF_Tenants_SetupDone DEFAULT 1;",
        "IF OBJECT_ID('dbo.OrgCompanies','U') IS NOT NULL AND COL_LENGTH('dbo.OrgCompanies','Country') IS NULL ALTER TABLE dbo.OrgCompanies ADD [Country] nvarchar(max) NULL;",
'''
    i = s.index("    };\n\n    public static async Task Apply")
    return s[:i] + add + s[i:]
rw(base + '/Services/SchemaUpgrade.cs', su)

# ---- plan: a starter workspace = one company, many branches, a real team
rw(base + '/Services/TenantService.cs', lambda s: need(s, "_ => (5, 1, 3),            // starter", "_ => (25, 1, 10),          // starter: ONE company, up to 10 branches, 25 users") if '(25, 1, 10)' not in s else s)
rw(base + '/Services/PasswordHasher.cs', lambda s: s if 'IsNullOrEmpty(storedHash)' in s else need(s, "        var salt = Convert.FromBase64String(storedSalt);\n        var expected", "        if (string.IsNullOrEmpty(storedHash) || string.IsNullOrEmpty(storedSalt)) return false;   // invited, password not chosen yet\n        var salt = Convert.FromBase64String(storedSalt);\n        var expected"))

# ---- auth: login guard, branches in response, invitation endpoints
def auth(s):
    if 'accept-invite' in s: return s
    s = need(s, "    public string TenantName { get; set; } = string.Empty;\n}", "    public string TenantName { get; set; } = string.Empty;\n    /// <summary>Branches the user is limited to; null = all.</summary>\n    public List<string>? Branches { get; set; }\n}\n\npublic class AcceptInviteRequest { public string Token { get; set; } = string.Empty; public string Password { get; set; } = string.Empty; }")
    s = need(s, "    private readonly IJwtTokenService _jwt;\n\n    public AuthController(WorkflowDbContext db, IJwtTokenService jwt)\n    {\n        _db = db;\n        _jwt = jwt;\n    }",
             "    private readonly IJwtTokenService _jwt;\n    private readonly IConfiguration _config;\n\n    public AuthController(WorkflowDbContext db, IJwtTokenService jwt, IConfiguration config)\n    {\n        _db = db;\n        _jwt = jwt;\n        _config = config;\n    }")
    s = need(s, "        if (user == null || !PasswordHasher.Verify(", "        if (user != null && string.IsNullOrEmpty(user.PasswordHash)) return Unauthorized(\"Your invitation has not been accepted yet. Open the invitation link you received.\");\n        if (user == null || !PasswordHasher.Verify(")
    s = need(s, "            TenantId = user.TenantId,\n            TenantName = tenantName\n        });\n    }\n}", '''            TenantId = user.TenantId,
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
}''')
    return s
rw(base + '/Controllers/AuthController.cs', auth)

# ---- users: branches, invitations
def users(s):
    if 'InviteToken' in s: return s
    s = need(s, "    public List<string> EffectivePermissions { get; set; } = new();\n", "    public List<string> EffectivePermissions { get; set; } = new();\n    /// <summary>Branches the user is limited to; null = all.</summary>\n    public List<string>? Branches { get; set; }\n    /// <summary>Invited but has not chosen a password yet.</summary>\n    public bool InvitePending { get; set; }\n    /// <summary>Set only in the answer to create / invite: the token behind the invitation link.</summary>\n    public string? InviteToken { get; set; }\n")
    s = need(s, "        EffectivePermissions = WorkflowEngine.Api.Services.Permissions.Effective(u)\n    };", "        EffectivePermissions = WorkflowEngine.Api.Services.Permissions.Effective(u),\n        Branches = u.Branches != null && u.Branches.Count > 0 ? u.Branches : null, InvitePending = string.IsNullOrEmpty(u.PasswordHash)\n    };")
    s = need(s, "    public List<string>? Permissions { get; set; }\n}\n\npublic class ResetPasswordRequest", "    public List<string>? Permissions { get; set; }\n    /// <summary>Limit the user to these branches (null / empty = all).</summary>\n    public List<string>? Branches { get; set; }\n    /// <summary>Create the account without a password and return an invitation link instead (like Odoo's invite).</summary>\n    public bool Invite { get; set; }\n    /// <summary>Address of the web app, used to build the link in the invitation e-mail.</summary>\n    public string? AppUrl { get; set; }\n}\n\npublic class ResetPasswordRequest")
    s = need(s, "    private readonly ITenantScope _tenant;\n\n    public UsersController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant)\n    {\n        _db = db;\n        _perms = perms;\n        _tenant = tenant;\n    }",
             "    private readonly ITenantScope _tenant;\n    private readonly IConfiguration _config;\n    private readonly IEmailSender _email;\n\n    public UsersController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant, IConfiguration config, IEmailSender email)\n    {\n        _db = db;\n        _perms = perms;\n        _tenant = tenant;\n        _config = config;\n        _email = email;\n    }\n\n    /// <summary>Keeps only branch codes that exist in the workspace; empty = no restriction.</summary>\n    private async Task<List<string>?> CleanBranches(string tenantId, List<string>? wanted)\n    {\n        if (wanted == null || wanted.Count == 0) return null;\n        var known = await _db.OrgBranches.AsNoTracking().Where(b => b.TenantId == tenantId).Select(b => b.Code).ToListAsync();\n        var list = wanted.Select(w => (w ?? string.Empty).Trim()).Where(w => known.Contains(w)).Distinct().ToList();\n        return list.Count == 0 ? null : list;\n    }")
    s = need(s, '        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6) return BadRequest("Password must be at least 6 characters.");\n        if (await _db.Users.AnyAsync(u => u.Username == username))',
             '        if (!req.Invite && (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6)) return BadRequest("Password must be at least 6 characters.");\n        if (await _db.Users.AnyAsync(u => u.Username == username))')
    s = need(s, "        var (hash, salt) = PasswordHasher.Hash(req.Password);\n        var user = new User\n        {\n            Username = username,",
             "        var (hash, salt) = req.Invite ? (string.Empty, string.Empty) : PasswordHasher.Hash(req.Password!);\n        var user = new User\n        {\n            Username = username,")
    s = need(s, "            Permissions = req.Permissions == null ? null : Permissions.Sanitize(req.Permissions)\n        };\n        _db.Users.Add(user);\n        await _db.SaveChangesAsync();\n        return Ok(AdminUserDto.From(user));",
             "            Permissions = req.Permissions == null ? null : Permissions.Sanitize(req.Permissions),\n            Branches = await CleanBranches(tenantId, req.Branches)\n        };\n        _db.Users.Add(user);\n        await _db.SaveChangesAsync();\n        var dto = AdminUserDto.From(user);\n        if (req.Invite) { dto.InviteToken = InviteTokens.Create(_config, user); await TrySendInvite(user, dto.InviteToken, req.AppUrl); }\n        return Ok(dto);")
    s = need(s, "        user.Permissions = newPerms;\n        await _db.SaveChangesAsync();\n        return Ok(AdminUserDto.From(user));", "        user.Permissions = newPerms;\n        user.Branches = await CleanBranches(tenantId, req.Branches);\n        await _db.SaveChangesAsync();\n        return Ok(AdminUserDto.From(user));")
    s = need(s, "    [HttpPost(\"admin/{id}/reset-password\")]", '''    /// <summary>(Re)issues the invitation link of a user who has not chosen a password yet, and e-mails it when SMTP is configured.</summary>
    [HttpPost("admin/{id}/invite")]
    public async Task<ActionResult<AdminUserDto>> Invite(string id, [FromBody] SaveUserRequest req)
    {
        if (!await _perms.Has(User, Permissions.AdminUsers)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == id && u.TenantId == tenantId);
        if (user == null) return NotFound();
        if (!string.IsNullOrEmpty(user.PasswordHash)) return BadRequest("This user already has a password. Use reset password instead.");
        var dto = AdminUserDto.From(user);
        dto.InviteToken = InviteTokens.Create(_config, user);
        await TrySendInvite(user, dto.InviteToken, req?.AppUrl);
        return Ok(dto);
    }

    private async Task TrySendInvite(User user, string token, string? appUrl)
    {
        if (!_email.IsConfigured || string.IsNullOrWhiteSpace(user.Email) || string.IsNullOrWhiteSpace(appUrl)) return;
        try
        {
            var link = appUrl.TrimEnd('/') + "/accept-invite?token=" + Uri.EscapeDataString(token);
            await _email.SendAsync(user.Email, "You have been invited", "Hello " + user.DisplayName + ",\\n\\nYou have been invited to join. Open this link to choose your password (valid for 7 days):\\n" + link + "\\n\\nYour username is: " + user.Username, false);
        }
        catch { /* the link is also shown to the administrator, who can share it by hand */ }
    }

    [HttpPost("admin/{id}/reset-password")]''')
    return s
rw(base + '/Controllers/UsersController.cs', users)

# ---- sign-up: one company, several branches, wizard pending
def signup(s):
    if 'req.Branches' in s: return s
    s = need(s, "    public string? BranchName { get; set; }\n}", "    public string? BranchName { get; set; }\n    /// <summary>Names of the branches to create (the wizard can add more later). Empty = one \"Head Office\".</summary>\n    public List<string>? Branches { get; set; }\n    public string? Country { get; set; }\n    public string? TaxNo { get; set; }\n}")
    s = need(s, '''        var branchName = string.IsNullOrWhiteSpace(req.BranchName) ? "Head Office" : req.BranchName.Trim();
        var branchCode = string.IsNullOrWhiteSpace(req.BranchName) ? "HQ" : Initials(req.BranchName, 5);
''', '''        var branchNames = (req.Branches ?? new List<string>()).Append(req.BranchName ?? string.Empty).Select(b => (b ?? string.Empty).Trim()).Where(b => b.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(tenant.MaxBranches > 0 ? tenant.MaxBranches : 20).ToList();
        if (branchNames.Count == 0) branchNames.Add("Head Office");
        var usedCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var branches = new List<OrgBranch>();
        foreach (var name in branchNames)
        {
            var code = branchNames.Count == 1 && name == "Head Office" ? "HQ" : Initials(name, 5);
            var unique = code; var n = 2;
            while (!usedCodes.Add(unique)) unique = code + n++;
            branches.Add(new OrgBranch { TenantId = tenant.Id, Code = unique, CompanyCode = companyCode, Name = name, NameAr = name, Warehouse = "WH-" + unique });
        }
''')
    s = need(s, "        var tenant = new Tenant { Id = slug, Name = workspace };\n        Plans.Apply(tenant, \"starter\");", "        var tenant = new Tenant { Id = slug, Name = workspace, SetupDone = false };\n        Plans.Apply(tenant, \"starter\");")
    s = need(s, "Name = workspace, NameAr = workspace, Currency = currency });", "Name = workspace, NameAr = workspace, Currency = currency, Country = string.IsNullOrWhiteSpace(req.Country) ? null : req.Country.Trim(), TaxNo = string.IsNullOrWhiteSpace(req.TaxNo) ? null : req.TaxNo.Trim() });")
    s = need(s, '        _db.OrgBranches.Add(new OrgBranch { TenantId = tenant.Id, Code = branchCode, CompanyCode = companyCode, Name = branchName, NameAr = branchName, Warehouse = "WH-" + branchCode });\n', '        _db.OrgBranches.AddRange(branches);\n')
    return s
rw(base + '/Controllers/TenantsController.cs', signup)

# ---- org: country, setup flag
def org(s):
    if 'setup/complete' in s: return s
    s = need(s, "    public string? TaxNo { get; set; }\n    public static CompanyDto From(OrgCompany c) => new() { Code = c.Code, Name = c.Name, NameAr = c.NameAr, Currency = c.Currency, TaxNo = c.TaxNo };",
             "    public string? TaxNo { get; set; }\n    public string? Country { get; set; }\n    public static CompanyDto From(OrgCompany c) => new() { Code = c.Code, Name = c.Name, NameAr = c.NameAr, Currency = c.Currency, TaxNo = c.TaxNo, Country = c.Country };")
    s = need(s, "    public int Branches { get; set; }\n}", "    public int Branches { get; set; }\n    /// <summary>False until the administrator finishes the first-run setup wizard.</summary>\n    public bool SetupDone { get; set; } = true;\n}")
    s = need(s, "                Companies = companies.Count, Branches = branches.Count\n", "                Companies = companies.Count, Branches = branches.Count, SetupDone = tenant.SetupDone\n")
    s = need(s, "            TaxNo = string.IsNullOrWhiteSpace(dto.TaxNo) ? null : dto.TaxNo.Trim()\n        };\n        _db.OrgCompanies.Add(c);", "            TaxNo = string.IsNullOrWhiteSpace(dto.TaxNo) ? null : dto.TaxNo.Trim(),\n            Country = string.IsNullOrWhiteSpace(dto.Country) ? null : dto.Country.Trim()\n        };\n        _db.OrgCompanies.Add(c);")
    s = need(s, "        c.TaxNo = string.IsNullOrWhiteSpace(dto.TaxNo) ? null : dto.TaxNo.Trim();\n        await _db.SaveChangesAsync();", "        c.TaxNo = string.IsNullOrWhiteSpace(dto.TaxNo) ? null : dto.TaxNo.Trim();\n        c.Country = string.IsNullOrWhiteSpace(dto.Country) ? null : dto.Country.Trim();\n        await _db.SaveChangesAsync();")
    s = need(s, "    // ------------------------------------------------------------ companies\n", '''    /// <summary>The administrator finished (or skipped) the first-run setup wizard.</summary>
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
''')
    return s
rw(base + '/Controllers/OrgController.cs', org)

# ---- branch access enforcement
def sec(s):
    if 'AllowedBranchesAsync' in s: return s
    s = need(s, "    Task RequireAsync(params string[] anyOf);\n}", "    Task RequireAsync(params string[] anyOf);\n    /// <summary>Branches the user is limited to, or null when they may work in every branch.</summary>\n    Task<List<string>?> AllowedBranchesAsync();\n    /// <summary>May the user read / write records of this branch? Empty branch (company-wide) is always fine.</summary>\n    Task<bool> CanUseBranchAsync(string? branch);\n}")
    s = need(s, "    private readonly ITenantScope _tenant;\n    private string? _tenantId;", "    private readonly ITenantScope _tenant;\n    private readonly WorkflowDbContext _db;\n    private bool _branchesLoaded;\n    private List<string>? _branches;\n    private string? _tenantId;")
    s = need(s, "    public CurrentUser(IHttpContextAccessor http, IPermissionService perms, ITenantScope tenant) { _http = http; _perms = perms; _tenant = tenant; }",
             "    public CurrentUser(IHttpContextAccessor http, IPermissionService perms, ITenantScope tenant, WorkflowDbContext db) { _http = http; _perms = perms; _tenant = tenant; _db = db; }")
    s = need(s, "    public async Task RequireAsync(params string[] anyOf)", '''    public async Task<List<string>?> AllowedBranchesAsync()
    {
        if (!_branchesLoaded)
        {
            var name = Username;
            _branches = await _db.Users.AsNoTracking().Where(u => u.Username == name && u.IsActive).Select(u => u.Branches).FirstOrDefaultAsync();
            if (_branches != null && _branches.Count == 0) _branches = null;
            _branchesLoaded = true;
        }
        return _branches;
    }

    public async Task<bool> CanUseBranchAsync(string? branch)
    {
        if (string.IsNullOrWhiteSpace(branch) || branch == "ALL") return true;
        var allowed = await AllowedBranchesAsync();
        return allowed == null || allowed.Contains(branch, StringComparer.OrdinalIgnoreCase);
    }

    public async Task RequireAsync(params string[] anyOf)''')
    return s
rw(base + '/Security/Security.cs', sec)

def mod(s):
    if '_me.' in s: return s
    s = need(s, "using WorkflowEngine.Api.Services;", "using WorkflowEngine.Api.Security;\nusing WorkflowEngine.Api.Services;")
    s = need(s, "    public ModulesController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant) { _db = db; _perms = perms; _tenant = tenant; }",
             "    private readonly ICurrentUser _me;   // access layer: branch access of the caller\n    public ModulesController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant, ICurrentUser me) { _db = db; _perms = perms; _tenant = tenant; _me = me; }")
    s = need(s, "        if (!string.IsNullOrWhiteSpace(branch) && branch != \"ALL\") q = q.Where(r => r.Branch == branch || r.Branch == null || r.Branch == \"\");\n        if (!string.IsNullOrWhiteSpace(status))",
             "        if (!string.IsNullOrWhiteSpace(branch) && branch != \"ALL\") q = q.Where(r => r.Branch == branch || r.Branch == null || r.Branch == \"\");\n        var allowedBr = await _me.AllowedBranchesAsync();   // a user limited to some branches never sees the others\n        if (allowedBr != null) q = q.Where(r => r.Branch == null || r.Branch == \"\" || allowedBr.Contains(r.Branch));\n        if (!string.IsNullOrWhiteSpace(status))")
    s = need(s, "        if (SystemOnly(module, kind)) return Bad(\"This record is created by the system.\");\n", "        if (SystemOnly(module, kind)) return Bad(\"This record is created by the system.\");\n        if (!await _me.CanUseBranchAsync(Clean(body.Branch))) return Forbid();\n")
    s = need(s, "        var newStatus = Clean(body.Status) ?? rec.Status;\n", "        if (!await _me.CanUseBranchAsync(rec.Branch) || !await _me.CanUseBranchAsync(Clean(body.Branch))) return Forbid();\n        var newStatus = Clean(body.Status) ?? rec.Status;\n")
    return s
rw(base + '/Controllers/ModulesController.cs', mod)

def pos(s):
    if '_me.' in s: return s
    s = need(s, "using WorkflowEngine.Api.Services;", "using WorkflowEngine.Api.Security;\nusing WorkflowEngine.Api.Services;")
    s = need(s, "    public PosController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant) { _db = db; _perms = perms; _tenant = tenant; }",
             "    private readonly ICurrentUser _me;   // access layer: branch access of the caller\n    public PosController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant, ICurrentUser me) { _db = db; _perms = perms; _tenant = tenant; _me = me; }")
    s = need(s, "        if (!string.IsNullOrWhiteSpace(branch) && branch != \"ALL\") q = q.Where(r => r.Branch == branch || r.Branch == null || r.Branch == \"\");\n        if (!string.IsNullOrWhiteSpace(status))",
             "        if (!string.IsNullOrWhiteSpace(branch) && branch != \"ALL\") q = q.Where(r => r.Branch == branch || r.Branch == null || r.Branch == \"\");\n        var allowedBr = await _me.AllowedBranchesAsync();   // a user limited to some branches never sees the others\n        if (allowedBr != null) q = q.Where(r => r.Branch == null || r.Branch == \"\" || allowedBr.Contains(r.Branch));\n        if (!string.IsNullOrWhiteSpace(status))")
    s = need(s, "        if (!Configurable.Contains(kind)) return NotFound();\n        if (!await Has(KindPerms(kind)!.Value.manage)) return Forbid();\n        var tenantId = await _tenant.TenantIdOf(User);\n        var rec = Build(tenantId, kind, body);",
             "        if (!Configurable.Contains(kind)) return NotFound();\n        if (!await Has(KindPerms(kind)!.Value.manage)) return Forbid();\n        if (!await _me.CanUseBranchAsync(Clean(body.Branch))) return Forbid();\n        var tenantId = await _tenant.TenantIdOf(User);\n        var rec = Build(tenantId, kind, body);")
    s = need(s, "        var rec = await _db.PosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);\n        if (rec == null) return NotFound();\n        rec.Company = Clean(body.Company); rec.Branch = Clean(body.Branch);",
             "        var rec = await _db.PosRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == kind);\n        if (rec == null) return NotFound();\n        if (!await _me.CanUseBranchAsync(rec.Branch) || !await _me.CanUseBranchAsync(Clean(body.Branch))) return Forbid();\n        rec.Company = Clean(body.Company); rec.Branch = Clean(body.Branch);")
    s = need(s, "        if (!await Has(\"pos.sell\")) return Forbid();\n        var tenantId = await _tenant.TenantIdOf(User);\n        if (b.OpeningCash < 0)", "        if (!await Has(\"pos.sell\")) return Forbid();\n        if (!await _me.CanUseBranchAsync(Clean(b.Branch))) return Forbid();\n        var tenantId = await _tenant.TenantIdOf(User);\n        if (b.OpeningCash < 0)")
    s = need(s, "        if (!await Has(\"pos.sell\")) return Forbid();\n        var tenantId = await _tenant.TenantIdOf(User);\n        if (b.Lines.Count == 0) return Bad(\"The basket is empty.\");", "        if (!await Has(\"pos.sell\")) return Forbid();\n        if (!await _me.CanUseBranchAsync(Clean(b.Branch))) return Forbid();\n        var tenantId = await _tenant.TenantIdOf(User);\n        if (b.Lines.Count == 0) return Bad(\"The basket is empty.\");")
    return s
rw(base + '/Controllers/PosController.cs', pos)
