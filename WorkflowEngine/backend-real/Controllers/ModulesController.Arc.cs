using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class ArcActDto
{
    public string? User { get; set; }      // assign: the person who handles the letter
    public string? Due { get; set; }       // assign: yyyy-MM-dd
    public string? Note { get; set; }      // close / archive (folder) / complete
    public string? Reason { get; set; }    // hold / dispose
    public string? Badge { get; set; }     // visitor check-in
}

/// <summary>
/// Archive &amp; Secretary (module "arc"): incoming and outgoing correspondence, the document archive (categories with retention,
/// confidentiality, legal hold, disposal), the secretary's appointments, visitor log and to-dos. Same record table and privilege checks as the other ERP modules.
/// </summary>
public partial class ModulesController
{
    private static readonly string[] ArcConf = { "Public", "Internal", "Confidential", "Secret" };
    private static readonly string[] ArcChannels = { "Mail", "Email", "Fax", "Hand", "Courier" };
    private static readonly string[] ArcPriorities = { "Normal", "Urgent", "Very urgent" };
    private static readonly string[] ArcOpenIncoming = { "Received", "Assigned", "InProgress", "Replied" };

    private static (string view, string manage)? KindPermsArc(string module, string kind) => (module, kind) switch
    {
        ("arc", "category") => ("arc.view", "arc.setup"),
        ("arc", "incoming") => ("arc.view", "arc.incoming.manage"),
        ("arc", "outgoing") => ("arc.view", "arc.outgoing.manage"),
        ("arc", "document") => ("arc.view", "arc.docs.manage"),
        ("arc", "appointment" or "visitor" or "todo") => ("arc.view", "arc.secretary.manage"),
        _ => KindPermsRe(module, kind)
    };

    private static string? AutoPrefixArc(string module, string kind) => (module, kind) switch
    {
        ("arc", "incoming") => "IN", ("arc", "outgoing") => "OUT", ("arc", "document") => "DOC", ("arc", "appointment") => "APT", ("arc", "visitor") => "VIS", ("arc", "todo") => "TD",
        _ => AutoPrefixRe(module, kind)
    };

    private static string DefaultStatusArc(string module, string kind) => (module, kind) switch
    {
        ("arc", "incoming") => "Received", ("arc", "outgoing") => "Draft", ("arc", "appointment") => "Scheduled", ("arc", "visitor") => "Expected", ("arc", "todo") => "Open",
        _ => DefaultStatusRe(module, kind)
    };

    /// <summary>Kinds whose status only moves through the action buttons.</summary>
    private static bool ArcActionOnly(string module, string kind) => module == "arc" && kind is "incoming" or "outgoing" or "document" or "visitor";

    private static bool IsFinalArc(string module, string kind, string? status) => module == "arc" && (kind, status) switch
    {
        ("incoming", "Received") => false, ("incoming", _) => true,
        ("outgoing", "Draft") => false, ("outgoing", _) => true,
        ("document", _) => true,                       // archived papers are never deleted, only disposed of after their retention period
        ("appointment", "Done" or "NoShow") => true, ("visitor", "Out" or "In") => true,
        _ => false
    };

    private static readonly Dictionary<(string, string), string[]> ArcKeep = new()
    {
        [("arc", "incoming")] = new[] { "assignedTo", "assignedAt", "reply", "closedAt", "closedBy", "closeNote", "archivedAt", "document" },
        [("arc", "outgoing")] = new[] { "approvedBy", "approvedAt", "sentAt", "sentBy", "document", "archivedAt" },
        [("arc", "document")] = new[] { "holdReason", "destroyedAt", "destroyedBy", "destroyReason", "source" },
        [("arc", "visitor")] = new[] { "badge", "checkInAt", "checkOutAt" },
    };

    private static string? GuardArc(string kind, string? oldStatus, string? newStatus)
    {
        if (oldStatus == null) return null;
        if (kind == "incoming" && oldStatus is "Closed" or "Archived") return "A closed letter can't be edited.";
        if (kind == "outgoing" && oldStatus != "Draft") return "Only a draft letter can be edited.";
        if (kind == "document" && oldStatus == "Destroyed") return "A destroyed document can't be changed.";
        if (kind == "appointment" && oldStatus is "Done" or "NoShow" && newStatus != oldStatus) return "A finished appointment can't be changed.";
        return null;
    }

    // ------------------------------------------------------------------ confidentiality

    private async Task<bool> ArcCanSee(ErpRecord r)
    {
        if (r.Module != "arc" || r.Kind is not ("incoming" or "outgoing" or "document")) return true;
        var d = FinJson.Obj(r.Data); var c = FinJson.S(d, "confidentiality");
        if (c is not ("Confidential" or "Secret")) return true;
        return await Has("arc.confidential") || r.CreatedBy == Username || FinJson.S(d, "assignedTo") == Username;
    }

    private async Task<List<ErpRecord>> ArcFilter(List<ErpRecord> list)
    {
        if (list.Count == 0 || list[0].Module != "arc" || list[0].Kind is not ("incoming" or "outgoing" or "document")) return list;
        if (await Has("arc.confidential")) return list;
        var me = Username; var res = new List<ErpRecord>();
        foreach (var r in list)
        {
            var d = FinJson.Obj(r.Data); var c = FinJson.S(d, "confidentiality");
            if (c is not ("Confidential" or "Secret") || r.CreatedBy == me || FinJson.S(d, "assignedTo") == me) res.Add(r);
        }
        return res;
    }

    private async Task<bool> ArcCategoryInUse(string tenantId, string? code)
    {
        if (string.IsNullOrEmpty(code)) return false;
        var rows = await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "arc" && (x.Kind == "incoming" || x.Kind == "outgoing" || x.Kind == "document") && x.Data.Contains(code)).ToListAsync();
        return rows.Any(x => string.Equals(FinJson.S(FinJson.Obj(x.Data), "category"), code, StringComparison.OrdinalIgnoreCase));
    }

    // ------------------------------------------------------------------ rules

    private static bool ArcDate(JsonElement d, string key, out DateTime v) => FinJson.TryDate(d, key, out v);

    private async Task<string?> ValidateArc(string tenantId, string kind, ErpRecord r, JsonElement d)
    {
        var isNew = !await _db.ErpRecords.AnyAsync(x => x.Id == r.Id);
        var today = ClientClock.Today;
        var conf = FinJson.S(d, "confidentiality");
        if (conf != "" && !ArcConf.Contains(conf)) return "Confidentiality must be Public, Internal, Confidential or Secret.";
        var channel = FinJson.S(d, "channel");
        if (channel != "" && !ArcChannels.Contains(channel)) return "Choose a channel: Mail, Email, Fax, Hand or Courier.";
        var cat = FinJson.S(d, "category");
        ErpRecord? catRec = null;
        if (cat != "" && kind is "incoming" or "outgoing" or "document")
        {
            catRec = await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Module == "arc" && x.Kind == "category" && x.Code == cat);
            if (catRec == null) return $"Category {cat} doesn't exist.";
        }
        switch (kind)
        {
            case "category":
                if (FinJson.S(d, "name") == "") return "Enter the category name.";
                var ry = FinJson.D(d, "retentionYears");
                if (ry < 0 || ry > 100 || ry != Math.Floor(ry)) return "Retention must be a whole number of years between 0 (keep forever) and 100.";
                if (r.Status is not ("Active" or "Inactive")) return "Status must be Active or Inactive.";
                break;
            case "incoming":
                {
                    if (FinJson.S(d, "subject") == "") return "Enter the subject of the letter.";
                    if (FinJson.S(d, "sender") == "") return "Enter who sent the letter.";
                    var pr = FinJson.S(d, "priority");
                    if (pr != "" && !ArcPriorities.Contains(pr)) return "Priority must be Normal, Urgent or Very urgent.";
                    if (!ArcDate(d, "receivedDate", out var rd)) return "Enter the date the letter was received.";
                    if (rd.Date > today.AddDays(1)) return "The received date can't be in the future.";
                    if (FinJson.S(d, "dueDate") != "" && (!ArcDate(d, "dueDate", out var due) || due.Date < rd.Date)) return "The due date can't be before the received date.";
                    var refNo = FinJson.S(d, "senderRef");
                    if (refNo != "")
                    {
                        var cands = await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "arc" && x.Kind == "incoming" && x.Id != r.Id && x.Data.Contains(refNo)).ToListAsync();
                        var dup = cands.FirstOrDefault(x => { var o = FinJson.Obj(x.Data); return string.Equals(FinJson.S(o, "senderRef"), refNo, StringComparison.OrdinalIgnoreCase) && string.Equals(FinJson.S(o, "sender"), FinJson.S(d, "sender"), StringComparison.OrdinalIgnoreCase); });
                        if (dup != null) return $"This letter is already registered as {dup.Code}.";
                    }
                    var set = new Dictionary<string, object?>();
                    if (pr == "") set["priority"] = "Normal";
                    if (conf == "") set["confidentiality"] = "Internal";
                    if (isNew) { set["assignedTo"] = null; set["reply"] = null; set["document"] = null; }
                    if (set.Count > 0) r.Data = FinJson.WithValues(r.Data, set);
                    break;
                }
            case "outgoing":
                {
                    if (FinJson.S(d, "subject") == "") return "Enter the subject of the letter.";
                    if (FinJson.S(d, "recipient") == "") return "Enter who the letter is addressed to.";
                    if (!ArcDate(d, "date", out _)) return "Enter the letter date.";
                    var rt = FinJson.S(d, "replyTo");
                    if (rt != "" && !await _db.ErpRecords.AnyAsync(x => x.TenantId == tenantId && x.Module == "arc" && x.Kind == "incoming" && x.Code == rt)) return $"The incoming letter {rt} doesn't exist.";
                    if (conf == "") r.Data = FinJson.WithValues(r.Data, new() { ["confidentiality"] = "Internal" });
                    break;
                }
            case "document":
                {
                    if (FinJson.S(d, "title") == "") return "Enter the document title.";
                    if (cat == "" || catRec == null) return "Choose the category of the document.";
                    if (!ArcDate(d, "docDate", out var dd)) return "Enter the document date.";
                    var yrs = FinJson.S(d, "retentionYears") == "" ? FinJson.D(FinJson.Obj(catRec.Data), "retentionYears") : FinJson.D(d, "retentionYears");
                    if (yrs < 0 || yrs > 100 || yrs != Math.Floor(yrs)) return "Retention must be a whole number of years between 0 (keep forever) and 100.";
                    var set = new Dictionary<string, object?> { ["retentionYears"] = yrs, ["retentionEnd"] = yrs > 0 ? dd.Date.AddYears((int)yrs).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "" };
                    if (conf == "") set["confidentiality"] = "Internal";
                    if (isNew) { set["holdReason"] = null; set["destroyedAt"] = null; set["destroyedBy"] = null; }
                    r.Data = FinJson.WithValues(r.Data, set);
                    break;
                }
            case "appointment":
                {
                    if (FinJson.S(d, "title") == "") return "Enter the subject of the appointment.";
                    if (r.Status is not ("Scheduled" or "Done" or "Cancelled" or "NoShow")) return "Status must be Scheduled, Done, Cancelled or NoShow.";
                    if (!ArcDate(d, "date", out var ad)) return "Enter the date.";
                    if (!TimeSpan.TryParseExact(FinJson.S(d, "startTime"), "hh\\:mm", CultureInfo.InvariantCulture, out var st)) return "Enter the start time as HH:mm.";
                    if (!TimeSpan.TryParseExact(FinJson.S(d, "endTime"), "hh\\:mm", CultureInfo.InvariantCulture, out var en)) return "Enter the end time as HH:mm.";
                    if (en <= st) return "The end time must be after the start time.";
                    var owner = FinJson.S(d, "owner"); if (owner == "") { owner = r.CreatedBy ?? Username; r.Data = FinJson.WithValues(r.Data, new() { ["owner"] = owner }); }
                    if (r.Status == "Scheduled")
                    {
                        var key = ad.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                        var same = await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "arc" && x.Kind == "appointment" && x.Status == "Scheduled" && x.Id != r.Id && x.Data.Contains(key)).ToListAsync();
                        foreach (var x in same)
                        {
                            var o = FinJson.Obj(x.Data);
                            if (!string.Equals(FinJson.S(o, "owner"), owner, StringComparison.OrdinalIgnoreCase) || !ArcDate(o, "date", out var od) || od.Date != ad.Date) continue;
                            if (TimeSpan.TryParseExact(FinJson.S(o, "startTime"), "hh\\:mm", CultureInfo.InvariantCulture, out var s2) && TimeSpan.TryParseExact(FinJson.S(o, "endTime"), "hh\\:mm", CultureInfo.InvariantCulture, out var e2) && st < e2 && s2 < en)
                                return $"That time clashes with appointment {x.Code}.";
                        }
                    }
                    break;
                }
            case "visitor":
                if (FinJson.S(d, "name") == "") return "Enter the visitor's name.";
                if (FinJson.S(d, "purpose") == "") return "Enter the purpose of the visit.";
                if (!ArcDate(d, "date", out _)) return "Enter the visit date.";
                break;
            case "todo":
                {
                    if (FinJson.S(d, "title") == "") return "Enter the task.";
                    if (r.Status is not ("Open" or "InProgress" or "Done" or "Cancelled")) return "Status must be Open, InProgress, Done or Cancelled.";
                    var pr = FinJson.S(d, "priority"); if (pr != "" && pr is not ("Low" or "Normal" or "High")) return "Priority must be Low, Normal or High.";
                    if (FinJson.S(d, "due") != "" && !ArcDate(d, "due", out _)) return "Enter a valid due date.";
                    var done = FinJson.S(d, "completedAt");
                    if (r.Status == "Done" && done == "") r.Data = FinJson.WithValues(r.Data, new() { ["completedAt"] = DateTime.UtcNow });
                    if (r.Status != "Done" && done != "") r.Data = FinJson.WithValues(r.Data, new() { ["completedAt"] = null });
                    break;
                }
        }
        return null;
    }

    // ------------------------------------------------------------------ actions

    private async Task<ErpRecord?> ArcMakeDocument(string tenantId, ErpRecord src, string title, string docDate, string folder)
    {
        var d = FinJson.Obj(src.Data);
        var cat = FinJson.S(d, "category");
        var catRec = cat == "" ? null : await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Module == "arc" && x.Kind == "category" && x.Code == cat);
        if (catRec == null) return null;
        var yrs = (int)FinJson.D(FinJson.Obj(catRec.Data), "retentionYears");
        var dt = DateTime.TryParse(docDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out var p) ? p.Date : ClientClock.Today;
        var doc = new ErpRecord
        {
            TenantId = tenantId, Module = "arc", Kind = "document", Code = await NextCode(tenantId, "arc", "document", "DOC"), Company = src.Company, Branch = src.Branch, Status = "Active", CreatedBy = Username,
            Data = J(new() { ["title"] = title, ["category"] = cat, ["docDate"] = dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ["refNo"] = FinJson.S(d, "senderRef") != "" ? FinJson.S(d, "senderRef") : src.Code,
                ["confidentiality"] = FinJson.S(d, "confidentiality") == "" ? "Internal" : FinJson.S(d, "confidentiality"), ["retentionYears"] = yrs,
                ["retentionEnd"] = yrs > 0 ? dt.AddYears(yrs).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "", ["folder"] = folder, ["source"] = src.Code })
        };
        _db.ErpRecords.Add(doc);
        return doc;
    }

    [HttpPost("arcact/{kind}/{id}/{op}")]
    public async Task<IActionResult> ArcAction(string module, string kind, string id, string op, [FromBody] ArcActDto? b)
    {
        if (module != "arc") return NotFound();
        var kp = KindPermsArc(module, kind); if (kp == null) return NotFound();
        b ??= new ArcActDto();
        var need = (kind, op) switch { ("outgoing", "approve") => "arc.outgoing.approve", ("document", "dispose") => "arc.dispose", _ => kp.Value.manage };
        if (!await Has(need)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await Find(tenantId, "arc", kind, id);
        if (rec == null || !await ArcCanSee(rec)) return NotFound();
        var d = FinJson.Obj(rec.Data);
        var now = DateTime.UtcNow; var today = ClientClock.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        switch (kind, op)
        {
            case ("incoming", "assign"):
                {
                    if (rec.Status is not ("Received" or "Assigned" or "InProgress")) return Bad("This letter can't be assigned any more.");
                    var user = Clean(b.User); if (user == null) return Bad("Choose who will handle the letter.");
                    if (!await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Username == user && u.IsActive)) return Bad("That person isn't an active user of this workspace.");
                    var due = Clean(b.Due) ?? FinJson.S(d, "dueDate");
                    if (due != "" && (!DateTime.TryParse(due, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dv) || (FinJson.TryDate(d, "receivedDate", out var rcv) && dv.Date < rcv.Date))) return Bad("The due date can't be before the received date.");
                    rec.Status = "Assigned";
                    rec.Data = FinJson.WithValues(rec.Data, new() { ["assignedTo"] = user, ["assignedAt"] = now, ["dueDate"] = due });
                    _db.ErpRecords.Add(new ErpRecord { TenantId = tenantId, Module = "arc", Kind = "todo", Code = await NextCode(tenantId, "arc", "todo", "TD"), Company = rec.Company, Branch = rec.Branch, Status = "Open", Ref = rec.Code, CreatedBy = Username,
                        Data = J(new() { ["title"] = "Handle " + rec.Code + ": " + FinJson.S(d, "subject"), ["assignedTo"] = user, ["due"] = due, ["priority"] = FinJson.S(d, "priority") == "Normal" || FinJson.S(d, "priority") == "" ? "Normal" : "High", ["related"] = rec.Code }) });
                    break;
                }
            case ("incoming", "start"):
                if (rec.Status != "Assigned") return Bad("Only an assigned letter can be started.");
                if (FinJson.S(d, "assignedTo") != Username && !await Has("arc.setup")) return Bad("Only the person it is assigned to can start it.");
                rec.Status = "InProgress"; break;
            case ("incoming", "reply"):
                {
                    if (rec.Status is not ("Received" or "Assigned" or "InProgress")) return Bad("This letter has been replied to or closed already.");
                    if (!await Has("arc.outgoing.manage")) return Forbid();
                    var outg = new ErpRecord { TenantId = tenantId, Module = "arc", Kind = "outgoing", Code = await NextCode(tenantId, "arc", "outgoing", "OUT"), Company = rec.Company, Branch = rec.Branch, Status = "Draft", CreatedBy = Username,
                        Data = J(new() { ["subject"] = "Re: " + FinJson.S(d, "subject"), ["recipient"] = FinJson.S(d, "sender"), ["date"] = today, ["channel"] = FinJson.S(d, "channel"), ["replyTo"] = rec.Code, ["confidentiality"] = FinJson.S(d, "confidentiality"), ["category"] = FinJson.S(d, "category") }) };
                    _db.ErpRecords.Add(outg);
                    rec.Status = "Replied"; rec.Data = FinJson.WithValues(rec.Data, new() { ["reply"] = outg.Code });
                    break;
                }
            case ("incoming", "close"):
                if (rec.Status is "Closed" or "Archived") return Bad("This letter is already closed.");
                if (rec.Status != "Replied" && Clean(b.Note) == null) return Bad("Write why the letter is closed without a reply.");
                rec.Status = "Closed"; rec.Data = FinJson.WithValues(rec.Data, new() { ["closedAt"] = now, ["closedBy"] = Username, ["closeNote"] = Clean(b.Note) }); break;
            case ("incoming", "archive"):
                {
                    if (rec.Status != "Closed") return Bad("Close the letter before archiving it.");
                    if (!await Has("arc.docs.manage")) return Forbid();
                    var doc = await ArcMakeDocument(tenantId, rec, FinJson.S(d, "subject"), FinJson.S(d, "receivedDate"), Clean(b.Note) ?? "");
                    if (doc == null) return Bad("Choose a category on the letter before archiving it.");
                    rec.Status = "Archived"; rec.Data = FinJson.WithValues(rec.Data, new() { ["archivedAt"] = now, ["document"] = doc.Code });
                    break;
                }
            case ("outgoing", "approve"):
                if (rec.Status != "Draft") return Bad("Only a draft can be approved.");
                if (string.Equals(rec.CreatedBy, Username, StringComparison.OrdinalIgnoreCase)) return Bad("A different person must approve the letter.");
                rec.Status = "Approved"; rec.Data = FinJson.WithValues(rec.Data, new() { ["approvedBy"] = Username, ["approvedAt"] = now }); break;
            case ("outgoing", "send"):
                if (rec.Status != "Approved") return Bad("Only an approved letter can be sent.");
                if (FinJson.S(d, "channel") == "") return Bad("Choose how the letter is sent (channel).");
                rec.Status = "Sent"; rec.Data = FinJson.WithValues(rec.Data, new() { ["sentAt"] = now, ["sentBy"] = Username }); break;
            case ("outgoing", "archive"):
                {
                    if (rec.Status != "Sent") return Bad("Only a sent letter can be archived.");
                    if (!await Has("arc.docs.manage")) return Forbid();
                    var doc = await ArcMakeDocument(tenantId, rec, FinJson.S(d, "subject"), FinJson.S(d, "date"), Clean(b.Note) ?? "");
                    if (doc == null) return Bad("Choose a category on the letter before archiving it.");
                    rec.Status = "Archived"; rec.Data = FinJson.WithValues(rec.Data, new() { ["archivedAt"] = now, ["document"] = doc.Code });
                    break;
                }
            case ("document", "hold"):
                if (rec.Status != "Active") return Bad("Only an active document can be put on hold.");
                if (Clean(b.Reason) == null) return Bad("Write the reason for the legal hold.");
                rec.Status = "Hold"; rec.Data = FinJson.WithValues(rec.Data, new() { ["holdReason"] = Clean(b.Reason) }); break;
            case ("document", "release"):
                if (rec.Status != "Hold") return Bad("This document isn't on hold.");
                rec.Status = "Active"; rec.Data = FinJson.WithValues(rec.Data, new() { ["holdReason"] = null }); break;
            case ("document", "dispose"):
                {
                    if (rec.Status == "Hold") return Bad("A document under legal hold can't be destroyed.");
                    if (rec.Status != "Active") return Bad("This document has been destroyed already.");
                    var end = FinJson.S(d, "retentionEnd");
                    if (end == "") return Bad("This category is kept forever; the document can't be destroyed.");
                    if (!DateTime.TryParse(end, CultureInfo.InvariantCulture, DateTimeStyles.None, out var ed) || ed.Date > ClientClock.Today) return Bad($"The retention period ends on {end}; the document can't be destroyed before that.");
                    if (Clean(b.Reason) == null) return Bad("Write the reason for destroying the document.");
                    rec.Status = "Destroyed"; rec.Data = FinJson.WithValues(rec.Data, new() { ["destroyedAt"] = now, ["destroyedBy"] = Username, ["destroyReason"] = Clean(b.Reason) }); break;
                }
            case ("visitor", "checkin"):
                {
                    if (rec.Status != "Expected") return Bad("Only an expected visitor can be checked in.");
                    var badge = Clean(b.Badge); if (badge == null) return Bad("Enter the badge number.");
                    var inside = await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "arc" && x.Kind == "visitor" && x.Status == "In" && x.Data.Contains(badge)).ToListAsync();
                    if (inside.Any(x => string.Equals(FinJson.S(FinJson.Obj(x.Data), "badge"), badge, StringComparison.OrdinalIgnoreCase))) return Bad($"Badge {badge} is already in use.");
                    rec.Status = "In"; rec.Data = FinJson.WithValues(rec.Data, new() { ["badge"] = badge, ["checkInAt"] = now }); break;
                }
            case ("visitor", "checkout"):
                if (rec.Status != "In") return Bad("This visitor isn't inside.");
                rec.Status = "Out"; rec.Data = FinJson.WithValues(rec.Data, new() { ["checkOutAt"] = now }); break;
            case ("visitor", "cancel"):
                if (rec.Status != "Expected") return Bad("Only an expected visit can be cancelled.");
                rec.Status = "Cancelled"; break;
            default: return NotFound();
        }
        rec.UpdatedAt = now;
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(rec));
    }

    // ------------------------------------------------------------------ overview

    private void ArcSummary(SummaryDto s, List<(ErpRecord r, JsonElement d)> all, DateTime today)
    {
        IEnumerable<(ErpRecord r, JsonElement d)> Kd(string k) => all.Where(x => x.r.Kind == k);
        bool Late(JsonElement d, string key) => FinJson.TryDate(d, key, out var du) && du.Date < today;
        var inc = Kd("incoming").ToList(); var open = inc.Where(x => ArcOpenIncoming.Contains(x.r.Status ?? "")).ToList();
        var docs = Kd("document").Where(x => x.r.Status is "Active" or "Hold").ToList();
        var soon = today.AddDays(90).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var todayKey = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        s.Kpis.AddRange(new[] {
            K("incomingOpen", open.Count), K("incomingOverdue", open.Count(x => Late(x.d, "dueDate"))), K("urgent", open.Count(x => FinJson.S(x.d, "priority") is "Urgent" or "Very urgent")),
            K("unassigned", inc.Count(x => x.r.Status == "Received")), K("outgoingPending", Kd("outgoing").Count(x => x.r.Status is "Draft" or "Approved")),
            K("documents", docs.Count), K("retentionDue", docs.Count(x => x.r.Status == "Active" && FinJson.S(x.d, "retentionEnd") != "" && string.CompareOrdinal(FinJson.S(x.d, "retentionEnd"), soon) <= 0)),
            K("onHold", docs.Count(x => x.r.Status == "Hold")), K("appointmentsToday", Kd("appointment").Count(x => x.r.Status == "Scheduled" && FinJson.S(x.d, "date").StartsWith(todayKey))),
            K("visitorsIn", Kd("visitor").Count(x => x.r.Status == "In")), K("todosOpen", Kd("todo").Count(x => x.r.Status is "Open" or "InProgress")),
            K("todosOverdue", Kd("todo").Count(x => x.r.Status is "Open" or "InProgress" && Late(x.d, "due"))) });
        IEnumerable<(string, decimal)> Cnt(string k) => Kd(k).GroupBy(x => x.r.Status ?? "").Select(g => (g.Key, (decimal)g.Count()));
        s.Lists.Add(S("incomingByStatus", Cnt("incoming"))); s.Lists.Add(S("outgoingByStatus", Cnt("outgoing")));
        s.Lists.Add(S("docsByCategory", docs.GroupBy(x => FinJson.S(x.d, "category")).Select(g => (g.Key, (decimal)g.Count()))));
    }
}
