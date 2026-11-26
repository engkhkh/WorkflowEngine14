using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Controllers;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;

namespace WorkflowEngine.Api.Services;

/// <summary>One step of an approval chain: who must approve (a privilege or a named user) and what happened.</summary>
public class GovStep
{
    public string Label { get; set; } = "";
    public string Privilege { get; set; } = "";
    public string User { get; set; } = "";
    public string Result { get; set; } = "";     // "" | Approved | Rejected
    public string By { get; set; } = "";
    public DateTime? At { get; set; }
    public string Note { get; set; } = "";
}

/// <summary>
/// The approval matrix. An approval rule (gov/rule) says: for records of &lt;target&gt; (e.g. proc/po) whose amount is between min and max,
/// the action &lt;trigger&gt; (e.g. Approved) needs these approval steps. When somebody tries the action, <see cref="Check"/> either lets it
/// through (an approved, unused request exists), or opens a request (gov/approval) and returns the text that tells the user.
/// Used by the module controllers and by Finance, so one set of rules governs every module.
/// </summary>
public static class ApprovalGate
{
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public static List<GovStep> Steps(JsonElement d)
    {
        var res = new List<GovStep>();
        if (d.ValueKind != JsonValueKind.Object || !d.TryGetProperty("steps", out var s) || s.ValueKind != JsonValueKind.Array) return res;
        foreach (var x in s.EnumerateArray())
        {
            if (x.ValueKind != JsonValueKind.Object) continue;
            var st = new GovStep { Label = FinJson.S(x, "label"), Privilege = FinJson.S(x, "privilege"), User = FinJson.S(x, "user"), Result = FinJson.S(x, "result"), By = FinJson.S(x, "by"), Note = FinJson.S(x, "note") };
            if (FinJson.TryDate(x, "at", out var at)) st.At = at;
            if (st.Label == "") st.Label = st.User != "" ? st.User : st.Privilege;
            if (st.Privilege == "" && st.User == "") continue;
            res.Add(st);
        }
        return res;
    }

    public static decimal Amount(JsonElement d, string field)
    {
        if (!string.IsNullOrWhiteSpace(field)) return FinJson.D(d, field);
        foreach (var k in new[] { "total", "amount", "net", "gross", "value" }) { var v = FinJson.D(d, k); if (v != 0) return v; }
        return 0m;
    }

    /// <summary>Null when the action may go ahead, otherwise the message to show the user (a request was opened or is still waiting).</summary>
    public static async Task<string?> Check(WorkflowDbContext db, ClaimsPrincipal user, string tenantId, string target, string recId, string? code, string? company, string dataJson, string trigger)
    {
        var rules = await db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "gov" && r.Kind == "rule" && r.Status == "Active").ToListAsync();
        if (rules.Count == 0) return null;
        var d = FinJson.Obj(dataJson);
        ErpRecord? rule = null; JsonElement rd = default; decimal amount = 0m;
        foreach (var r in rules.OrderByDescending(x => FinJson.D(FinJson.Obj(x.Data), "minAmount")))
        {
            var x = FinJson.Obj(r.Data);
            if (!string.Equals(FinJson.S(x, "target"), target, StringComparison.OrdinalIgnoreCase)) continue;
            var trg = FinJson.S(x, "trigger"); if (trg == "") trg = "Approved";
            if (!string.Equals(trg, trigger, StringComparison.OrdinalIgnoreCase)) continue;
            if (!string.IsNullOrEmpty(r.Company) && !string.Equals(r.Company, company, StringComparison.OrdinalIgnoreCase)) continue;
            var a = Amount(d, FinJson.S(x, "amountField"));
            var min = FinJson.D(x, "minAmount"); var max = FinJson.D(x, "maxAmount");
            if (a < min || (max > 0 && a > max)) continue;
            if (Steps(x).Count == 0) continue;
            rule = r; rd = x; amount = a; break;
        }
        if (rule == null) return null;

        var mine = await db.ErpRecords.Where(r => r.TenantId == tenantId && r.Module == "gov" && r.Kind == "approval" && r.Ref == recId && r.Parent == target)
            .OrderByDescending(r => r.CreatedAt).Take(20).ToListAsync();
        foreach (var e in mine)
        {
            var ed = FinJson.Obj(e.Data);
            if (!string.Equals(FinJson.S(ed, "trigger"), trigger, StringComparison.OrdinalIgnoreCase)) continue;
            if (e.Status == "Approved" && FinJson.S(ed, "usedAt") == "" && FinJson.D(ed, "amount") + 0.005m >= amount)
            {   // an approved request covers this action: use it up (saved together with the caller's change)
                e.Data = FinJson.WithValues(e.Data, new() { ["usedAt"] = DateTime.UtcNow });
                e.UpdatedAt = DateTime.UtcNow;
                return null;
            }
            if (e.Status == "Pending")
            {
                var stp = Steps(ed); var cur = (int)FinJson.D(ed, "current");
                return $"Waiting for approval {e.Code}" + (cur < stp.Count ? $" (step {cur + 1} of {stp.Count}: {stp[cur].Label})." : ".");
            }
        }

        var steps = Steps(rd);
        var by = user.FindFirst(ClaimTypes.Name)?.Value ?? "";
        var rcode = "APR-" + DateTime.UtcNow.ToString("yyMMdd") + "-" + Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
        var req = new ErpRecord
        {
            TenantId = tenantId, Module = "gov", Kind = "approval", Code = rcode, Company = company, Status = "Pending", Ref = recId, Parent = target, CreatedBy = by,
            Data = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["target"] = target, ["recordId"] = recId, ["recordCode"] = code, ["trigger"] = trigger, ["amount"] = amount,
                ["rule"] = rule.Code, ["ruleName"] = FinJson.S(rd, "name"), ["steps"] = JsonSerializer.SerializeToElement(steps, Web), ["current"] = 0,
                ["requestedBy"] = by, ["requestedAt"] = DateTime.UtcNow, ["stepAt"] = DateTime.UtcNow,
                ["escalateAfterHours"] = FinJson.D(rd, "escalateAfterHours"), ["escalateTo"] = FinJson.S(rd, "escalateTo"), ["allowSelf"] = FinJson.B(rd, "allowSelf"),
                ["history"] = new object[0]
            })
        };
        db.ErpRecords.Add(req);
        await db.SaveChangesAsync();
        return $"Approval required ({FinJson.S(rd, "name")}, amount {amount:N2}). Request {rcode} was sent to {steps[0].Label}. Repeat this action after it is approved.";
    }
}
