using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class GovActDto { public string? Note { get; set; } public string? To { get; set; } }

/// <summary>
/// Governance (module "gov"): the audit trail of every ERP record (written by the database layer), the approval matrix
/// (rules by amount, multi-step approvals, delegation, escalation), the accounting period lock and custom fields.
///   gov/audit       - read only, one row per create / change / delete with the changed fields
///   gov/rule        - approval rule: target (module/kind), trigger status, amount range, steps, escalation
///   gov/approval    - an approval request opened by <see cref="ApprovalGate"/>; moved with approve / reject / reassign / cancel
///   gov/delegation  - "while I am away, X approves for me"
///   gov/customfield - extra fields on any record kind (stored under data.cf)
///   gov/setting     - code "lock": records dated up to a date can't be created, changed or deleted
/// </summary>
public partial class ModulesController
{
    private static readonly System.Text.Json.JsonSerializerOptions GovWeb = ApprovalGate.Web;

    private static (string view, string manage)? KindPermsGov(string module, string kind) => (module, kind) switch
    {
        ("gov", "audit") => ("gov.audit.view", "gov.audit.view"),
        ("gov", "rule") => ("gov.view", "gov.rules.manage"),
        ("gov", "approval") => ("gov.view", "gov.approvals.admin"),
        ("gov", "delegation") => ("gov.view", "gov.delegate"),
        ("gov", "customfield") => ("gov.view", "gov.fields.manage"),
        ("gov", "setting") => ("gov.view", "gov.lock.manage"),
        _ => null
    };

    private static string? AutoPrefixGov(string module, string kind) => (module, kind) switch
    {
        ("gov", "rule") => "AR", ("gov", "delegation") => "DL",
        _ => null
    };

    private static string DefaultStatusGov(string module, string kind) => (module, kind) switch
    {
        ("gov", "approval") => "Pending",
        _ => "Active"
    };

    private static bool GovSystemOnly(string module, string kind) => module == "gov" && kind is "audit" or "approval";
    private static bool GovFinal(string module, string kind, string? status) => module == "gov" && (kind == "audit" || (kind == "approval" && status != "Pending"));

    private static readonly Dictionary<(string, string), string[]> GovKeep = new()
    {
        [("gov", "delegation")] = new[] { "from", "privileges" },
    };

    private static readonly string[] GovFieldTypes = { "text", "number", "date", "select", "bool" };

    // ------------------------------------------------------------------ validation of the governance records

    private async Task<string?> ValidateGov(string tenantId, string kind, ErpRecord r, JsonElement d, bool isNew)
    {
        switch (kind)
        {
            case "rule":
                {
                    var target = FinJson.S(d, "target");
                    if (!target.Contains('/') || target.Split('/').Length != 2) return "Choose what the rule applies to (module/kind, for example proc/po).";
                    if (FinJson.S(d, "name") == "") return "Enter a name for the rule.";
                    var min = FinJson.D(d, "minAmount"); var max = FinJson.D(d, "maxAmount");
                    if (min < 0 || max < 0) return "Amounts can't be negative.";
                    if (max > 0 && max < min) return "The maximum amount must be greater than the minimum.";
                    var steps = ApprovalGate.Steps(d);
                    if (steps.Count == 0) return "Add at least one approval step (a privilege or a user).";
                    foreach (var s in steps)
                        if (s.User != "" && !await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Username == s.User)) return $"User {s.User} doesn't exist.";
                    var esc = FinJson.S(d, "escalateTo");
                    if (esc != "" && !await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Username == esc)) return $"User {esc} doesn't exist.";
                    if (FinJson.D(d, "escalateAfterHours") < 0) return "Escalation hours can't be negative.";
                    if (r.Status is not ("Active" or "Inactive")) return "Status must be Active or Inactive.";
                    break;
                }
            case "delegation":
                {
                    var to = FinJson.S(d, "to");
                    if (to == "") return "Choose who approves while you are away.";
                    if (!await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Username == to && u.IsActive)) return $"User {to} doesn't exist.";
                    if (!FinJson.TryDate(d, "fromDate", out var f) || !FinJson.TryDate(d, "toDate", out var t)) return "Enter the first and last day of the delegation.";
                    if (t < f) return "The last day can't be before the first day.";
                    if (isNew)
                    {   // a delegation always stands in for the person who creates it, with exactly the privileges that person has
                        var mine = (await _perms.EffectiveFor(User)).ToList();
                        if (string.Equals(to, Username, StringComparison.OrdinalIgnoreCase)) return "You can't delegate to yourself.";
                        r.Data = FinJson.WithValues(r.Data, new() { ["from"] = Username, ["privileges"] = mine });
                    }
                    else if (string.Equals(to, FinJson.S(d, "from"), StringComparison.OrdinalIgnoreCase)) return "You can't delegate to yourself.";
                    if (r.Status is not ("Active" or "Inactive")) return "Status must be Active or Inactive.";
                    break;
                }
            case "customfield":
                {
                    var target = FinJson.S(d, "target");
                    var parts = target.Split('/');
                    if (parts.Length != 2 || KindPerms(parts[0], parts[1]) == null || parts[0] == "gov") return "Choose the record type the field belongs to (module/kind).";
                    var key = FinJson.S(d, "key");
                    if (key.Length is < 2 or > 30 || !System.Text.RegularExpressions.Regex.IsMatch(key, "^[a-zA-Z][a-zA-Z0-9_]*$")) return "The key must start with a letter and contain only letters, digits and _ (2-30 characters).";
                    if (FinJson.S(d, "labelEn") == "") return "Enter the field label.";
                    if (!GovFieldTypes.Contains(FinJson.S(d, "type"))) return "Type must be text, number, date, select or bool.";
                    if (FinJson.S(d, "type") == "select" && FinJson.S(d, "options").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Length < 2) return "A select field needs at least two options, separated by commas.";
                    var dup = await _db.ErpRecords.AnyAsync(x => x.TenantId == tenantId && x.Module == "gov" && x.Kind == "customfield" && x.Id != r.Id && x.Parent == target && x.Ref == key);
                    if (dup) return "That key is already used on this record type.";
                    r.Parent = target; r.Ref = key;
                    if (string.IsNullOrWhiteSpace(r.Code)) r.Code = target.Replace('/', '.') + "." + key;
                    break;
                }
            case "setting":
                if (r.Code != "lock") return "Unknown setting.";
                if (FinJson.S(d, "lockedThrough") != "" && !FinJson.TryDate(d, "lockedThrough", out _)) return "Enter a valid date.";
                break;
        }
        return null;
    }

    // ------------------------------------------------------------------ period lock

    private static DateTime? GovDateOf(string module, string kind, string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        var d = FinJson.Obj(json);
        if ((module, kind) == ("pay", "run"))
        {
            var per = FinJson.S(d, "period");
            return DateTime.TryParse(per.Length == 7 ? per + "-01" : per, CultureInfo.InvariantCulture, DateTimeStyles.None, out var pd) ? pd : null;
        }
        return FinJson.TryDate(d, "date", out var dt) ? dt : null;
    }

    /// <summary>Blocks creating / changing / deleting a record whose date is in a locked period (the gov lock date or a closed Finance period).</summary>
    private async Task<string?> GovLockCheck(string tenantId, string module, string kind, string? company, string? oldData, string? newData)
    {
        if (module is "gov" or "int" or "arc" || kind is "setting" or "log") return null;
        var dates = new[] { GovDateOf(module, kind, oldData), GovDateOf(module, kind, newData) }.Where(x => x != null).Select(x => x!.Value).Distinct().ToList();
        if (dates.Count == 0) return null;
        var lockRec = await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "gov" && r.Kind == "setting" && r.Code == "lock");
        var cfg = FinJson.Obj(lockRec?.Data);
        DateTime? through = FinJson.TryDate(cfg, "lockedThrough", out var lt) ? lt.Date : null;
        var useFin = !(cfg.ValueKind == JsonValueKind.Object && cfg.TryGetProperty("useFinancePeriods", out var uf) && uf.ValueKind == JsonValueKind.False);
        bool? canOverride = null;
        foreach (var dt in dates)
        {
            string? msg = null;
            if (through != null && dt.Date <= through.Value) msg = $"{dt:yyyy-MM-dd} is in a locked period (locked through {through.Value:yyyy-MM-dd}).";
            else if (useFin)
            {
                var per = dt.ToString("yyyy-MM", CultureInfo.InvariantCulture);
                if (await _db.FinRecords.AsNoTracking().AnyAsync(r => r.TenantId == tenantId && r.Kind == "period" && r.Code == per && r.Status == "Closed"
                        && (r.Company == company || r.Company == null || r.Company == "")))
                    msg = $"The accounting period {per} is closed.";
            }
            if (msg == null) continue;
            canOverride ??= await Has("gov.lock.override");
            if (canOverride == false) return msg + " Ask someone with the period-lock override, or reopen the period.";
        }
        return null;
    }

    // ------------------------------------------------------------------ custom fields

    private class GovField { public string Key = ""; public string LabelEn = ""; public string LabelAr = ""; public string Type = "text"; public string Options = ""; public bool Required; public int Order; }

    private async Task<List<GovField>> GovFields(string tenantId, string target)
    {
        var rows = await _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "gov" && r.Kind == "customfield" && r.Status == "Active" && r.Parent == target).ToListAsync();
        return rows.Select(r => { var d = FinJson.Obj(r.Data); return new GovField { Key = FinJson.S(d, "key"), LabelEn = FinJson.S(d, "labelEn"), LabelAr = FinJson.S(d, "labelAr"), Type = FinJson.S(d, "type"), Options = FinJson.S(d, "options"), Required = FinJson.B(d, "required"), Order = (int)FinJson.D(d, "order") }; })
            .OrderBy(f => f.Order).ThenBy(f => f.Key).ToList();
    }

    private async Task<string?> GovCustomCheck(string tenantId, string module, string kind, string dataJson)
    {
        if (module == "gov") return null;
        var defs = await GovFields(tenantId, module + "/" + kind);
        if (defs.Count == 0) return null;
        var d = FinJson.Obj(dataJson);
        var cf = d.ValueKind == JsonValueKind.Object && d.TryGetProperty("cf", out var c) && c.ValueKind == JsonValueKind.Object ? c : default;
        foreach (var f in defs)
        {
            var v = cf.ValueKind == JsonValueKind.Object ? FinJson.S(cf, f.Key) : "";
            var label = string.IsNullOrWhiteSpace(f.LabelEn) ? f.Key : f.LabelEn;
            if (v == "") { if (f.Required && f.Type != "bool") return $"{label} is required."; continue; }
            switch (f.Type)
            {
                case "number": if (!decimal.TryParse(v, NumberStyles.Any, CultureInfo.InvariantCulture, out _)) return $"{label} must be a number."; break;
                case "date": if (!DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) return $"{label} must be a valid date."; break;
                case "select":
                    var opts = f.Options.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    if (!opts.Contains(v)) return $"{label}: choose one of {string.Join(", ", opts)}."; break;
            }
        }
        return null;
    }

    /// <summary>The custom fields defined for one record type (module/kind). Open to every signed-in user, because every form needs them.</summary>
    [HttpGet("customfields")]
    public async Task<IActionResult> GovCustomFields(string module, [FromQuery] string? target)
    {
        if (string.IsNullOrWhiteSpace(target)) return Ok(Array.Empty<object>());
        var tenantId = await _tenant.TenantIdOf(User);
        var list = await GovFields(tenantId, target);
        return Ok(list.Select(f => new { key = f.Key, labelEn = f.LabelEn, labelAr = f.LabelAr, type = f.Type, options = f.Options, required = f.Required, order = f.Order }));
    }

    // ------------------------------------------------------------------ approvals

    private bool GovDelegateCovers(IEnumerable<ErpRecord> delegations, GovStep step, string target)
    {
        var today = ClientClock.Today;
        foreach (var dl in delegations)
        {
            var x = FinJson.Obj(dl.Data);
            if (!string.Equals(FinJson.S(x, "to"), Username, StringComparison.OrdinalIgnoreCase)) continue;
            if (!FinJson.TryDate(x, "fromDate", out var f) || !FinJson.TryDate(x, "toDate", out var t) || today < f.Date || today > t.Date) continue;
            var scope = FinJson.S(x, "scope");
            if (scope != "" && scope != "*" && !string.Equals(scope, target, StringComparison.OrdinalIgnoreCase)) continue;
            if (step.User != "" && string.Equals(step.User, FinJson.S(x, "from"), StringComparison.OrdinalIgnoreCase)) return true;
            if (step.Privilege != "" && x.TryGetProperty("privileges", out var pv) && pv.ValueKind == JsonValueKind.Array
                && pv.EnumerateArray().Any(p => string.Equals(p.GetString(), step.Privilege, StringComparison.OrdinalIgnoreCase))) return true;
        }
        return false;
    }

    private bool GovCanAct(GovStep step, JsonElement d, string target, HashSet<string> myPrivs, List<ErpRecord> delegations)
    {
        if (step.User != "" && string.Equals(step.User, Username, StringComparison.OrdinalIgnoreCase)) return true;
        if (step.Privilege != "" && myPrivs.Contains(step.Privilege)) return true;
        if (myPrivs.Contains("gov.approvals.admin")) return true;
        var hrs = FinJson.D(d, "escalateAfterHours"); var esc = FinJson.S(d, "escalateTo");
        if (hrs > 0 && esc != "" && string.Equals(esc, Username, StringComparison.OrdinalIgnoreCase)
            && FinJson.TryDate(d, "stepAt", out var since) && DateTime.UtcNow - since >= TimeSpan.FromHours((double)hrs)) return true;
        return GovDelegateCovers(delegations, step, target);
    }

    /// <summary>Adds canAct / overdue to every approval and, for people who are not approvers or auditors, keeps only theirs.</summary>
    private async Task<List<ErpRecord>> GovApprovalView(string tenantId, List<ErpRecord> list)
    {
        var myPrivs = new HashSet<string>(await _perms.EffectiveFor(User), StringComparer.OrdinalIgnoreCase);
        var delegs = await _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "gov" && r.Kind == "delegation" && r.Status == "Active").ToListAsync();
        var seeAll = myPrivs.Contains("gov.approvals.admin") || myPrivs.Contains("gov.audit.view");
        var res = new List<ErpRecord>();
        foreach (var r in list)
        {
            var d = FinJson.Obj(r.Data); var steps = ApprovalGate.Steps(d); var cur = (int)FinJson.D(d, "current");
            var can = r.Status == "Pending" && cur < steps.Count && GovCanAct(steps[cur], d, r.Parent ?? "", myPrivs, delegs)
                      && (FinJson.B(d, "allowSelf") || !string.Equals(FinJson.S(d, "requestedBy"), Username, StringComparison.OrdinalIgnoreCase));
            var mine = string.Equals(FinJson.S(d, "requestedBy"), Username, StringComparison.OrdinalIgnoreCase);
            if (!seeAll && !can && !mine) continue;
            var hrs = FinJson.D(d, "escalateAfterHours");
            var over = r.Status == "Pending" && hrs > 0 && FinJson.TryDate(d, "stepAt", out var since) && DateTime.UtcNow - since >= TimeSpan.FromHours((double)hrs);
            r.Data = FinJson.WithValues(r.Data, new() { ["canAct"] = can, ["mine"] = mine, ["overdue"] = over });
            res.Add(r);
        }
        return res;
    }

    [HttpPost("approvals/{id}/{op}")]
    public async Task<IActionResult> GovApprovalAct(string module, string id, string op, [FromBody] GovActDto? b)
    {
        if (module != "gov") return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        var ap = await Find(tenantId, "gov", "approval", id);
        if (ap == null) return NotFound();
        if (ap.Status != "Pending") return Bad("This request is already " + (ap.Status ?? "").ToLowerInvariant() + ".");
        var d = FinJson.Obj(ap.Data); var steps = ApprovalGate.Steps(d); var cur = (int)FinJson.D(d, "current");
        if (cur >= steps.Count) return Bad("This request has no open step.");
        var note = Clean(b?.Note) ?? "";
        var requester = FinJson.S(d, "requestedBy");
        var isRequester = string.Equals(requester, Username, StringComparison.OrdinalIgnoreCase);
        var history = new List<object>();
        if (d.TryGetProperty("history", out var h) && h.ValueKind == JsonValueKind.Array) foreach (var x in h.EnumerateArray()) history.Add(x);
        var step = steps[cur];
        var vals = new Dictionary<string, object?>();

        if (op == "cancel")
        {
            if (!isRequester && !await Has("gov.approvals.admin")) return Forbid();
            ap.Status = "Cancelled";
        }
        else
        {
            var myPrivs = new HashSet<string>(await _perms.EffectiveFor(User), StringComparer.OrdinalIgnoreCase);
            var delegs = await _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "gov" && r.Kind == "delegation" && r.Status == "Active").ToListAsync();
            if (!GovCanAct(step, d, ap.Parent ?? "", myPrivs, delegs)) return Forbid();
            if (isRequester && !FinJson.B(d, "allowSelf") && op is "approve" or "reassign") return Bad("You can't approve a request you submitted. Somebody else must decide it.");
            switch (op)
            {
                case "approve":
                    step.Result = "Approved"; step.By = Username; step.At = DateTime.UtcNow; step.Note = note;
                    if (cur + 1 < steps.Count) { vals["current"] = cur + 1; vals["stepAt"] = DateTime.UtcNow; }
                    else { ap.Status = "Approved"; vals["approvedAt"] = DateTime.UtcNow; }
                    break;
                case "reject":
                    if (note == "") return Bad("Enter the reason for rejecting.");
                    step.Result = "Rejected"; step.By = Username; step.At = DateTime.UtcNow; step.Note = note;
                    ap.Status = "Rejected";
                    break;
                case "reassign":
                    {
                        var to = Clean(b?.To);
                        if (to == null) return Bad("Choose who should decide this step.");
                        if (!await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Username == to && u.IsActive)) return Bad($"User {to} doesn't exist.");
                        if (string.Equals(to, requester, StringComparison.OrdinalIgnoreCase) && !FinJson.B(d, "allowSelf")) return Bad("The requester can't decide their own request.");
                        step.User = to; step.Privilege = ""; step.Label = to;
                        vals["stepAt"] = DateTime.UtcNow;
                        break;
                    }
                default: return Bad("Unknown action.");
            }
        }
        history.Add(new { at = DateTime.UtcNow, by = Username, op, note, step = cur + 1, label = step.Label });
        vals["steps"] = JsonSerializer.SerializeToElement(steps, GovWeb);
        vals["history"] = history;
        ap.Data = FinJson.WithValues(ap.Data, vals);
        ap.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(ap));
    }

    /// <summary>The check the record actions call: null = go ahead, else a message (a request was opened, or one is still waiting).</summary>
    private Task<string?> GovGate(string tenantId, string module, string kind, ErpRecord rec, string trigger)
        => ApprovalGate.Check(_db, User, tenantId, module + "/" + kind, rec.Id, rec.Code, rec.Company, rec.Data, trigger);
}

public partial class ModulesController
{
    private async Task<SummaryDto> GovSummary(string tenantId, string? company)
    {
        var g = _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "gov");
        if (!string.IsNullOrWhiteSpace(company) && company != "ALL") g = g.Where(r => r.Company == company || r.Company == null || r.Company == "");
        var today = DateTime.UtcNow.Date; var week = today.AddDays(-6);
        var s = new SummaryDto { Module = "gov" };
        var pending = await g.Where(r => r.Kind == "approval" && r.Status == "Pending").ToListAsync();
        var overdue = pending.Count(r => { var d = FinJson.Obj(r.Data); var h = FinJson.D(d, "escalateAfterHours"); return h > 0 && FinJson.TryDate(d, "stepAt", out var at) && DateTime.UtcNow - at >= TimeSpan.FromHours((double)h); });
        s.Kpis.Add(K("pending", pending.Count));
        s.Kpis.Add(K("overdue", overdue));
        s.Kpis.Add(K("rules", await g.CountAsync(r => r.Kind == "rule" && r.Status == "Active")));
        s.Kpis.Add(K("delegations", await g.CountAsync(r => r.Kind == "delegation" && r.Status == "Active")));
        s.Kpis.Add(K("fields", await g.CountAsync(r => r.Kind == "customfield" && r.Status == "Active")));
        s.Kpis.Add(K("auditToday", await g.CountAsync(r => r.Kind == "audit" && r.CreatedAt >= today)));
        s.Lists.Add(S("pendingByTarget", pending.GroupBy(r => r.Parent ?? "").Select(x => (x.Key, (decimal)x.Count()))));
        var recent = await g.Where(r => r.Kind == "audit" && r.CreatedAt >= week).Select(r => new { r.Status, r.CreatedBy, r.Parent }).ToListAsync();
        s.Lists.Add(S("auditByAction", recent.GroupBy(x => x.Status ?? "").Select(x => (x.Key, (decimal)x.Count()))));
        s.Lists.Add(S("auditByUser", recent.GroupBy(x => x.CreatedBy ?? "").OrderByDescending(x => x.Count()).Take(8).Select(x => (x.Key, (decimal)x.Count()))));
        s.Lists.Add(S("auditByModule", recent.GroupBy(x => x.Parent ?? "").OrderByDescending(x => x.Count()).Take(8).Select(x => (x.Key, (decimal)x.Count()))));
        return s;
    }
}
