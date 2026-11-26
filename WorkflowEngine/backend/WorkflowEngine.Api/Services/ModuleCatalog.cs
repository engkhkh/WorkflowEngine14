using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

/// <summary>
/// The business modules a workspace (company) can switch on. A privilege belongs to a module by its prefix ("hos.view" -> hospital).
/// Privileges that belong to no module (dashboard, tasks, documents, reports, assistant, org, admin ...) are always available.
/// A workspace whose Modules list is null has every module (installs that predate module switching keep working).
/// </summary>
public static class ModuleCatalog
{
    public sealed record Def(string Key, string Prefix, string Group, string Icon);

    public static readonly Def[] All =
    {
        new("hr",        "hr",      "hr",          "users"),
        new("finance",   "finance", "finance",     "wallet"),
        new("pos",       "pos",     "pos",         "store"),
        new("mfg",       "mfg",     "manufacturing", "box"),
        new("prj",       "prj",     "projects",    "grid"),
        new("crm",       "crm",     "crm",         "users"),
        new("proc",      "proc",    "procurement", "cart"),
        new("scm",       "scm",     "supplychain", "box"),
        new("wh",        "wh",      "warehouse",   "box"),
        new("ast",       "ast",     "assets",      "shield"),
        new("arc",       "arc",     "archive",     "book"),
        new("re",        "re",      "realestate",  "building"),
        new("so",        "so",      "salesorders", "clipboard"),
        new("hd",        "hd",      "helpdesk",    "message"),
        new("sub",       "sub",     "subscriptions", "refresh"),
        new("exp",       "exp",     "expenses",    "credit-card"),
        new("qa",        "qa",      "quality",     "shield"),
        new("flt",       "flt",     "fleet",       "box"),
        new("gov",       "gov",     "governance",  "shield"),
        new("pay",       "pay",     "payroll",     "wallet"),
        new("epm",       "epm",     "epm",         "bar-chart"),
        new("bpm",       "bpm",     "bpm",         "grid"),
        new("int",       "int",     "integration", "send"),
        new("bi",        "bi",      "bi",          "bar-chart"),
        new("website",   "web",     "website",     "globe"),
        new("workflow",  "wf",      "workflow",    "grid"),
        new("hospital",  "hos",     "hospital",    "heart"),
        new("calendar",  "cal",     "calendar",    "clock"),
        new("muslim",    "mus",     "muslim",      "heart"),
        new("custom",    "cus",     "custom",      "layers"),
    };

    private static readonly Dictionary<string, string> ByPrefix = All.ToDictionary(d => d.Prefix, d => d.Key, StringComparer.OrdinalIgnoreCase);
    public static bool IsModule(string key) => All.Any(d => d.Key == key);

    /// <summary>Module that owns a privilege key, or null for the always-on core privileges.</summary>
    public static string? ModuleOf(string permissionKey)
    {
        var i = permissionKey.IndexOf('.');
        if (i <= 0) return null;
        return ByPrefix.TryGetValue(permissionKey[..i], out var m) ? m : null;
    }

    /// <summary>Is this privilege usable by a workspace that has switched on <paramref name="enabled"/> (null = everything)?</summary>
    public static bool Allowed(IReadOnlySet<string>? enabled, string permissionKey)
    {
        if (enabled == null) return true;
        var m = ModuleOf(permissionKey);
        return m == null || enabled.Contains(m);
    }

    public static List<string> Sanitize(IEnumerable<string>? keys)
        => (keys ?? Enumerable.Empty<string>()).Where(IsModule).Distinct().ToList();
}
