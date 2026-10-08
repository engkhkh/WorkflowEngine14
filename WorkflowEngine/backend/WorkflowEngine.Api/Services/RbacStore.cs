using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

/// <summary>
/// The privilege catalog and the role defaults live in the database (tables PermissionDefs and RoleDefs); the code only
/// provides the first seed. This class keeps an in-memory snapshot (refreshed every 30 s and whenever an admin saves) so the
/// static <see cref="Permissions"/> helpers stay synchronous.
/// </summary>
public static class RbacStore
{
    public sealed class Snapshot
    {
        public List<PermissionDef> Defs { get; init; } = new();
        public HashSet<string> Active { get; init; } = new(StringComparer.OrdinalIgnoreCase);     // built-in active keys + every custom key
        public HashSet<string> Disabled { get; init; } = new(StringComparer.OrdinalIgnoreCase);   // "tenant|key" switched off by a workspace
        public Dictionary<string, string[]> Roles { get; init; } = new(StringComparer.OrdinalIgnoreCase);   // "tenant|role"
        public DateTime LoadedAt { get; init; } = DateTime.UtcNow;
    }

    private static volatile Snapshot? _snap;
    private static readonly SemaphoreSlim Gate = new(1, 1);
    public static Snapshot? Current => _snap;

    private static string RoleKey(string tenant, string role) => tenant + "|" + role;

    /// <summary>Inserts the built-in privileges and role defaults that are missing. Safe to run on every start.</summary>
    public static async Task Seed(WorkflowDbContext db)
    {
        var have = await db.PermissionDefs.Where(d => d.TenantId == "").ToListAsync();
        var haveKeys = have.Select(d => d.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var added = new List<string>();
        var order = 0;
        foreach (var (group, keys) in Permissions.CodeCatalog)
            foreach (var k in keys)
            {
                order += 10;
                if (haveKeys.Contains(k)) continue;
                db.PermissionDefs.Add(new PermissionDef { Key = k, Group = group, SortOrder = order, IsActive = true, IsCustom = false });
                added.Add(k);
            }
        var roles = await db.RoleDefs.Where(r => r.TenantId == "").ToListAsync();
        foreach (var (role, keys) in Permissions.CodeRoleDefaults)
        {
            var row = roles.FirstOrDefault(r => string.Equals(r.Role, role, StringComparison.OrdinalIgnoreCase));
            if (row == null)
                db.RoleDefs.Add(new RoleDef { Role = role, IsSystem = true, Permissions = JsonSerializer.Serialize(keys.Distinct().ToArray()) });
            else if (added.Count > 0)
            {   // a privilege that is new in this release goes to the roles that get it by default - never touches the admin's own choices
                var cur = JsonSerializer.Deserialize<List<string>>(row.Permissions) ?? new();
                var extra = keys.Where(k => added.Contains(k, StringComparer.OrdinalIgnoreCase) && !cur.Contains(k, StringComparer.OrdinalIgnoreCase)).ToList();
                if (extra.Count > 0) { cur.AddRange(extra); row.Permissions = JsonSerializer.Serialize(cur); row.UpdatedAt = DateTime.UtcNow; }
            }
        }
        await db.SaveChangesAsync();
        await Reload(db);
    }

    public static async Task Reload(WorkflowDbContext db)
    {
        await Gate.WaitAsync();
        try
        {
            var defs = await db.PermissionDefs.AsNoTracking().OrderBy(d => d.SortOrder).ToListAsync();
            var roles = await db.RoleDefs.AsNoTracking().ToListAsync();
            var snap = new Snapshot
            {
                Defs = defs,
                Active = defs.Where(d => (d.TenantId == "" && d.IsActive) || d.IsCustom).Select(d => d.Key).ToHashSet(StringComparer.OrdinalIgnoreCase),
                Disabled = defs.Where(d => d.TenantId != "" && !d.IsActive).Select(d => d.TenantId + "|" + d.Key).ToHashSet(StringComparer.OrdinalIgnoreCase),
                Roles = roles.ToDictionary(r => RoleKey(r.TenantId, r.Role), r => (JsonSerializer.Deserialize<string[]>(r.Permissions) ?? Array.Empty<string>()), StringComparer.OrdinalIgnoreCase),
            };
            _snap = snap;
        }
        finally { Gate.Release(); }
    }

    public static async Task EnsureFresh(WorkflowDbContext db)
    {
        var s = _snap;
        if (s == null || DateTime.UtcNow - s.LoadedAt > TimeSpan.FromSeconds(30)) await Reload(db);
    }

    /// <summary>The workspace's view of the catalog: a workspace's own row for a key wins over the built-in one.</summary>
    public static IEnumerable<PermissionDef> DefsFor(string tenantId)
        => (_snap?.Defs ?? new List<PermissionDef>()).Where(d => d.TenantId == "" || d.TenantId == tenantId)
            .GroupBy(d => d.Key, StringComparer.OrdinalIgnoreCase).Select(g => g.OrderByDescending(x => x.TenantId == tenantId && tenantId != "").First())
            .OrderBy(d => d.SortOrder);

    /// <summary>Keeps only privileges that exist and that the workspace has not switched off.</summary>
    public static bool IsOn(string tenantId, string key)
        => _snap == null || (_snap.Active.Contains(key) && !_snap.Disabled.Contains(tenantId + "|" + key));

    /// <summary>Active privileges of a workspace grouped for the admin screen.</summary>
    public static List<(string Group, string[] Keys)> CatalogFor(string tenantId)
    {
        if (_snap == null) return Permissions.CodeCatalog.ToList();
        return DefsFor(tenantId).Where(d => d.IsActive).GroupBy(d => d.Group)
            .OrderBy(g => g.Min(x => x.SortOrder))
            .Select(g => (g.Key, g.OrderBy(x => x.SortOrder).Select(x => x.Key).ToArray())).ToList();
    }

    public static string[] AllActiveFor(string tenantId)
        => _snap == null ? Permissions.CodeCatalog.SelectMany(g => g.Keys).ToArray() : DefsFor(tenantId).Where(d => d.IsActive).Select(d => d.Key).ToArray();

    /// <summary>Default privileges of one role for a workspace: its own version, else the platform default, else the code default.</summary>
    public static string[] RoleFor(string tenantId, string? role)
    {
        if (string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase)) return AllActiveFor(tenantId);   // an admin can never be locked out
        if (role != null && _snap != null)
        {
            if (_snap.Roles.TryGetValue(RoleKey(tenantId, role), out var own)) return own;
            if (_snap.Roles.TryGetValue(RoleKey("", role), out var def)) return def;
        }
        return Permissions.CodeDefaultsFor(role);
    }

    public static Dictionary<string, string[]> RolesFor(string tenantId)
    {
        var d = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
        if (_snap == null) { foreach (var kv in Permissions.CodeRoleDefaults) d[kv.Key] = kv.Value; return d; }
        foreach (var kv in _snap.Roles.Where(k => k.Key.StartsWith("|"))) d[kv.Key[1..]] = kv.Value;
        foreach (var kv in _snap.Roles.Where(k => k.Key.StartsWith(tenantId + "|") && tenantId != "")) d[kv.Key[(tenantId.Length + 1)..]] = kv.Value;
        d["admin"] = AllActiveFor(tenantId);
        return d;
    }
}
