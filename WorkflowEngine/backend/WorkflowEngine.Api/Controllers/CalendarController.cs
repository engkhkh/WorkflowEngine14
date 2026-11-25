using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Security;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class CalEventInput
{
    public string Kind { get; set; } = "event";                 // event | meeting | todo
    public string Title { get; set; } = string.Empty;
    public DateTime? Start { get; set; }                        // UTC (a to-do's due date/time may be empty)
    public DateTime? End { get; set; }
    public bool AllDay { get; set; }
    public string? Notes { get; set; }
    public string? Location { get; set; }
    public List<string>? Attendees { get; set; }                // usernames of this workspace
    public List<string>? Guests { get; set; }                   // outside e-mail addresses (meetings)
    public string? Repeat { get; set; }                         // none | daily | weekly | monthly
    public DateTime? RepeatUntil { get; set; }
    public int? RemindMinutes { get; set; }                     // null = no reminder
    public string? Priority { get; set; }                       // todo: low | normal | high
    public bool? Done { get; set; }                             // todo
}

public class FreeBusyInput { public List<string> Users { get; set; } = new(); public DateTime From { get; set; } public DateTime To { get; set; } }
public class RsvpInput { public string Response { get; set; } = "yes"; }
public class InstantInput { public string? Title { get; set; } public List<string>? Attendees { get; set; } public int? Minutes { get; set; } }

/// <summary>
/// Calendar, to-dos and meetings. The rules live here:
///  - you see your own entries and the ones you are invited to; nobody else's titles (the scheduling assistant only gets busy/free blocks);
///  - only the owner (or a calendar administrator) changes or deletes an entry, an invited person can only answer yes / no / maybe;
///  - a meeting gets an unguessable room name, joining is limited to the owner, the invited people and (through the e-mailed link) the guests;
///  - the video itself runs on Jitsi Meet (public meet.jit.si or the company's own server, set in the calendar settings).
/// </summary>
[ApiController]
[Route("api/calendar")]
[Authorize]
public class CalendarController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;
    private readonly IEmailSender _mail;

    public CalendarController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant, IEmailSender mail) { _db = db; _perms = perms; _tenant = tenant; _mail = mail; }

    private string Me => User.FindFirstValue(ClaimTypes.Name) ?? "";
    private Task<bool> Has(string p) => _perms.Has(User, p);
    private Task<string> Tid() => _tenant.TenantIdOf(User);
    private BadRequestObjectResult Bad(string m) => BadRequest(new { message = m });
    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static JsonObject D(CalEvent e) => JsonNode.Parse(string.IsNullOrWhiteSpace(e.Data) ? "{}" : e.Data) as JsonObject ?? new JsonObject();
    private static List<string> Strs(JsonObject d, string key) => d[key] is JsonArray a ? a.Select(x => x?.GetValue<string>() ?? "").Where(x => x != "").ToList() : new List<string>();
    private static DateTime Utc(DateTime d) => d.Kind == DateTimeKind.Utc ? d : DateTime.SpecifyKind(d, d.Kind == DateTimeKind.Local ? DateTimeKind.Local : DateTimeKind.Utc).ToUniversalTime();
    private static bool Invited(CalEvent e, string me) => string.Equals(e.Owner, me, StringComparison.OrdinalIgnoreCase) || Strs(D(e), "attendees").Contains(me, StringComparer.OrdinalIgnoreCase);

    // ---------------------------------------------------------------- settings

    private async Task<JsonObject> Settings(string tid)
    {
        var s = await _db.CalEvents.AsNoTracking().FirstOrDefaultAsync(e => e.TenantId == tid && e.Kind == "setting");
        var d = s == null ? new JsonObject() : D(s);
        d["jitsiDomain"] ??= "meet.jit.si";
        d["workStart"] ??= "09:00";
        d["workEnd"] ??= "17:00";
        return d;
    }

    [HttpGet("settings")]
    public async Task<IActionResult> GetSettings()
    {
        if (!await Has("cal.view")) return Forbid();
        return Content((await Settings(await Tid())).ToJsonString(), "application/json");
    }

    [HttpPut("settings")]
    public async Task<IActionResult> PutSettings([FromBody] JsonElement body)
    {
        if (!await Has("cal.settings")) return Forbid();
        var tid = await Tid();
        var domain = (body.TryGetProperty("jitsiDomain", out var j) ? j.GetString() : null)?.Trim().ToLowerInvariant() ?? "meet.jit.si";
        domain = domain.Replace("https://", "").Replace("http://", "").TrimEnd('/');
        if (domain.Length == 0 || domain.Any(c => !(char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == ':'))) return Bad("The video server must be a plain host name such as meet.jit.si.");
        var d = new JsonObject
        {
            ["jitsiDomain"] = domain,
            ["workStart"] = body.TryGetProperty("workStart", out var ws) ? ws.GetString() ?? "09:00" : "09:00",
            ["workEnd"] = body.TryGetProperty("workEnd", out var we) ? we.GetString() ?? "17:00" : "17:00",
        };
        var rec = await _db.CalEvents.FirstOrDefaultAsync(e => e.TenantId == tid && e.Kind == "setting");
        if (rec == null) { rec = new CalEvent { TenantId = tid, Kind = "setting", Title = "settings", Owner = Me }; _db.CalEvents.Add(rec); }
        rec.Data = d.ToJsonString(); rec.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Content(d.ToJsonString(), "application/json");
    }

    // ---------------------------------------------------------------- people

    [HttpGet("people")]
    public async Task<IActionResult> People()
    {
        if (!await Has("cal.view")) return Forbid();
        var tid = await Tid();
        var users = await _db.Users.AsNoTracking().Where(u => u.TenantId == tid && u.IsActive).OrderBy(u => u.DisplayName).Select(u => new { u.Username, u.DisplayName }).ToListAsync();
        return Ok(users);
    }

    // ---------------------------------------------------------------- reading

    private static DateTime? U(DateTime? d) => d == null ? null : DateTime.SpecifyKind(d.Value, DateTimeKind.Utc);   // the database returns 'unspecified' kind; the browser must see a trailing Z

    private static object Shape(CalEvent e, DateTime? start = null, DateTime? end = null) => new
    {
        e.Id, e.Kind, e.Title, e.Owner, Start = U(start ?? e.StartUtc), End = U(end ?? e.EndUtc), e.Status, e.Room, Data = JsonDocument.Parse(string.IsNullOrWhiteSpace(e.Data) ? "{}" : e.Data).RootElement.Clone(),
        Occurrence = start != null && start != e.StartUtc
    };

    /// <summary>The (start, end) pairs of an entry that fall inside [from, to], with its repeat rule applied.</summary>
    private static IEnumerable<(DateTime s, DateTime e)> Expand(CalEvent ev, DateTime from, DateTime to)
    {
        if (ev.StartUtc == null) yield break;
        var s0 = ev.StartUtc.Value; var len = (ev.EndUtc ?? s0.AddHours(1)) - s0; if (len < TimeSpan.Zero) len = TimeSpan.Zero;
        var d = D(ev); var rep = d["repeat"]?.GetValue<string>() ?? "none";
        DateTime? until = DateTime.TryParse(d["repeatUntil"]?.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var u) ? u : null;
        if (rep == "none" || rep == "") { if (s0 < to && s0 + len >= from) yield return (s0, s0 + len); yield break; }
        var n = 0;
        for (var i = 0; i < 1500 && n < 400; i++)
        {
            var s = rep switch { "daily" => s0.AddDays(i), "weekly" => s0.AddDays(7 * i), "monthly" => s0.AddMonths(i), _ => s0.AddDays(i * 3650) };
            if (s >= to || (until != null && s > until.Value.AddDays(1))) break;
            if (s + len >= from) { yield return (s, s + len); n++; }
        }
    }

    [HttpGet("events")]
    public async Task<IActionResult> Events([FromQuery] DateTime from, [FromQuery] DateTime to)
    {
        if (!await Has("cal.view")) return Forbid();
        if (to <= from) return Bad("The end of the range must be after its start.");
        if ((to - from).TotalDays > 400) return Bad("Ask for at most about a year at a time.");
        from = Utc(from); to = Utc(to);
        var tid = await Tid(); var me = Me;
        var mine = (await _db.CalEvents.AsNoTracking().Where(e => e.TenantId == tid && (e.Kind == "event" || e.Kind == "meeting") && e.Status != "Cancelled"
                    && (e.Owner == me || e.Data.Contains(me))).ToListAsync()).Where(e => Invited(e, me));
        var res = new List<(DateTime s, object o)>();
        foreach (var e in mine) foreach (var (s, en) in Expand(e, from, to)) res.Add((s, Shape(e, s, en)));
        return Ok(res.OrderBy(r => r.s).Select(r => r.o));
    }

    [HttpGet("todos")]
    public async Task<IActionResult> Todos()
    {
        if (!await Has("cal.view")) return Forbid();
        var tid = await Tid(); var me = Me;
        var l = await _db.CalEvents.AsNoTracking().Where(e => e.TenantId == tid && e.Kind == "todo" && e.Owner == me).OrderBy(e => e.Status).ThenBy(e => e.StartUtc).ToListAsync();
        return Ok(l.Select(e => Shape(e)));
    }

    [HttpPost("freebusy")]
    public async Task<IActionResult> FreeBusy([FromBody] FreeBusyInput b)
    {
        if (!await Has("cal.view")) return Forbid();
        if (b.To <= b.From || (b.To - b.From).TotalDays > 60) return Bad("Choose a range of up to 60 days.");
        var tid = await Tid(); var from = Utc(b.From); var to = Utc(b.To);
        var users = b.Users.Select(x => x.Trim()).Where(x => x != "").Distinct(StringComparer.OrdinalIgnoreCase).Take(30).ToList();
        var all = (await _db.CalEvents.AsNoTracking().Where(e => e.TenantId == tid && (e.Kind == "event" || e.Kind == "meeting") && e.Status != "Cancelled").ToListAsync());
        var res = new Dictionary<string, List<object>>();
        foreach (var u in users)
        {
            var l = new List<object>();
            foreach (var e in all.Where(e => Invited(e, u))) foreach (var (s, en) in Expand(e, from, to)) l.Add(new { s = U(s), e = U(en) });   // blocks only, no titles
            res[u] = l;
        }
        return Ok(res);
    }

    // ---------------------------------------------------------------- writing

    private async Task<(CalEvent? ev, IActionResult? err)> Apply(CalEvent? ev, CalEventInput i, string tid)
    {
        var kind = i.Kind is "meeting" or "todo" or "event" ? i.Kind : "event";
        if (kind == "meeting" && !await Has("cal.meetings.host")) return (null, Forbid());
        if (kind != "meeting" && !await Has("cal.events.manage")) return (null, Forbid());
        var title = Clean(i.Title); if (title == null) return (null, Bad("A title is required."));
        if (kind != "todo")
        {
            if (i.Start == null) return (null, Bad("A start time is required."));
            var s = Utc(i.Start.Value); var e = i.End != null ? Utc(i.End.Value) : s.AddHours(1);
            if (e < s) return (null, Bad("The end cannot be before the start."));
            if ((e - s).TotalDays > 31) return (null, Bad("An entry cannot be longer than 31 days."));
        }
        var rep = i.Repeat is "daily" or "weekly" or "monthly" ? i.Repeat : "none";
        if (i.RemindMinutes is < 0 or > 10080) return (null, Bad("The reminder must be between 0 minutes and 7 days before."));
        var users = (i.Attendees ?? new()).Select(x => x.Trim()).Where(x => x != "").Distinct(StringComparer.OrdinalIgnoreCase).Take(100).ToList();
        if (users.Count > 0)
        {
            var known = await _db.Users.AsNoTracking().Where(u => u.TenantId == tid && users.Contains(u.Username)).Select(u => u.Username).ToListAsync();
            var unknown = users.Except(known, StringComparer.OrdinalIgnoreCase).ToList();
            if (unknown.Count > 0) return (null, Bad("Unknown people: " + string.Join(", ", unknown)));
        }
        var guests = (i.Guests ?? new()).Select(x => x.Trim()).Where(x => x != "").Distinct(StringComparer.OrdinalIgnoreCase).Take(100).ToList();
        if (guests.Any(g => !g.Contains('@') || g.Contains(' ') || g.Length > 200)) return (null, Bad("A guest e-mail address looks wrong."));

        if (ev == null) { ev = new CalEvent { TenantId = tid, Owner = Me }; _db.CalEvents.Add(ev); }
        else ev.UpdatedAt = DateTime.UtcNow;
        ev.Kind = kind; ev.Title = title.Length > 500 ? title[..500] : title;
        ev.StartUtc = i.Start == null ? null : Utc(i.Start.Value);
        ev.EndUtc = kind == "todo" ? null : (i.End != null ? Utc(i.End.Value) : ev.StartUtc?.AddHours(1));
        if (kind == "meeting") ev.Room ??= "we-" + new string(tid.Where(char.IsLetterOrDigit).Take(6).ToArray()).ToLowerInvariant() + "-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
        if (kind == "todo") ev.Status = i.Done == true ? "Done" : "Open"; else ev.Status ??= "Scheduled";
        var d = ev.Id != null && ev.Data != "{}" ? D(ev) : new JsonObject();
        var rsvp = d["rsvp"] as JsonObject ?? new JsonObject();
        foreach (var k in rsvp.Select(p => p.Key).ToList()) if (!users.Contains(k, StringComparer.OrdinalIgnoreCase)) rsvp.Remove(k);   // removed people lose their answer
        d["notes"] = Clean(i.Notes); d["location"] = Clean(i.Location); d["allDay"] = i.AllDay;
        d["attendees"] = new JsonArray(users.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());
        d["guests"] = new JsonArray(guests.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());
        d["repeat"] = rep; d["repeatUntil"] = rep == "none" || i.RepeatUntil == null ? null : Utc(i.RepeatUntil.Value).ToString("o", CultureInfo.InvariantCulture);
        d["remind"] = i.RemindMinutes; d["priority"] = i.Priority is "low" or "high" ? i.Priority : "normal"; d["rsvp"] = rsvp;
        ev.Data = d.ToJsonString();
        return (ev, null);
    }

    [HttpPost("events")]
    public async Task<IActionResult> Create([FromBody] CalEventInput i)
    {
        var tid = await Tid();
        var (ev, err) = await Apply(null, i, tid); if (err != null) return err;
        await _db.SaveChangesAsync();
        var sent = ev!.Kind == "meeting" ? await Invite(ev, tid, "invitation") : 0;
        return Ok(new { ev = Shape(ev), emailed = sent });
    }

    [HttpPut("events/{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] CalEventInput i)
    {
        var tid = await Tid();
        var cur = await _db.CalEvents.FirstOrDefaultAsync(e => e.TenantId == tid && e.Id == id && e.Kind != "setting");
        if (cur == null) return NotFound();
        if (!string.Equals(cur.Owner, Me, StringComparison.OrdinalIgnoreCase) && !await Has("cal.settings")) return Forbid();
        i.Kind = cur.Kind;                                        // an entry never changes type
        var (ev, err) = await Apply(cur, i, tid); if (err != null) return err;
        await _db.SaveChangesAsync();
        var sent = ev!.Kind == "meeting" ? await Invite(ev, tid, "update") : 0;
        return Ok(new { ev = Shape(ev), emailed = sent });
    }

    [HttpPost("events/{id}/done")]
    public async Task<IActionResult> ToggleDone(string id, [FromBody] RsvpInput? b)
    {
        if (!await Has("cal.view")) return Forbid();
        var tid = await Tid();
        var ev = await _db.CalEvents.FirstOrDefaultAsync(e => e.TenantId == tid && e.Id == id && e.Kind == "todo" && e.Owner == Me);
        if (ev == null) return NotFound();
        ev.Status = ev.Status == "Done" ? "Open" : "Done"; ev.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(Shape(ev));
    }

    [HttpDelete("events/{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var tid = await Tid();
        var ev = await _db.CalEvents.FirstOrDefaultAsync(e => e.TenantId == tid && e.Id == id && e.Kind != "setting");
        if (ev == null) return NotFound();
        if (!string.Equals(ev.Owner, Me, StringComparison.OrdinalIgnoreCase) && !await Has("cal.settings")) return Forbid();
        if (ev.Kind == "meeting")
        {
            ev.Status = "Cancelled"; ev.UpdatedAt = DateTime.UtcNow;      // invited people are told, the row stays as a record
            await _db.SaveChangesAsync(); await Invite(ev, tid, "cancellation");
        }
        else { _db.CalEvents.Remove(ev); await _db.SaveChangesAsync(); }
        return NoContent();
    }

    [HttpPost("events/{id}/rsvp")]
    public async Task<IActionResult> Rsvp(string id, [FromBody] RsvpInput b)
    {
        if (!await Has("cal.view")) return Forbid();
        if (b.Response is not ("yes" or "no" or "maybe")) return Bad("Answer yes, no or maybe.");
        var tid = await Tid();
        var ev = await _db.CalEvents.FirstOrDefaultAsync(e => e.TenantId == tid && e.Id == id && e.Kind != "setting" && e.Kind != "todo");
        if (ev == null) return NotFound();
        var d = D(ev);
        if (!Strs(d, "attendees").Contains(Me, StringComparer.OrdinalIgnoreCase)) return Bad("You are not invited to this entry.");
        var rsvp = d["rsvp"] as JsonObject ?? new JsonObject(); rsvp[Me] = b.Response; d["rsvp"] = rsvp;
        ev.Data = d.ToJsonString(); await _db.SaveChangesAsync();
        return Ok(Shape(ev));
    }

    // ---------------------------------------------------------------- meetings

    private static string MeetingUrl(JsonObject settings, string room) => $"https://{settings["jitsiDomain"]?.GetValue<string>() ?? "meet.jit.si"}/{room}";

    [HttpPost("meetings/instant")]
    public async Task<IActionResult> Instant([FromBody] InstantInput? b)
    {
        if (!await Has("cal.meetings.host")) return Forbid();
        var tid = await Tid();
        var now = DateTime.UtcNow;
        var (ev, err) = await Apply(null, new CalEventInput { Kind = "meeting", Title = Clean(b?.Title) ?? "Quick meeting", Start = now, End = now.AddMinutes(Math.Clamp(b?.Minutes ?? 60, 15, 480)), Attendees = b?.Attendees, RemindMinutes = null }, tid);
        if (err != null) return err;
        await _db.SaveChangesAsync();
        await Invite(ev!, tid, "invitation");
        return Ok(new { ev = Shape(ev!), url = MeetingUrl(await Settings(tid), ev!.Room!) });
    }

    [HttpPost("events/{id}/join")]
    public async Task<IActionResult> Join(string id)
    {
        if (!await Has("cal.meetings.join")) return Forbid();
        var tid = await Tid();
        var ev = await _db.CalEvents.AsNoTracking().FirstOrDefaultAsync(e => e.TenantId == tid && e.Id == id && e.Kind == "meeting");
        if (ev == null || ev.Room == null) return NotFound();
        if (ev.Status == "Cancelled") return Bad("This meeting was cancelled.");
        if (!Invited(ev, Me)) return Forbid();
        var owner = string.Equals(ev.Owner, Me, StringComparison.OrdinalIgnoreCase);
        var rep = (D(ev)["repeat"]?.GetValue<string>() ?? "none") != "none";
        if (!owner && !rep && ev.StartUtc != null)
        {
            var now = DateTime.UtcNow; var end = ev.EndUtc ?? ev.StartUtc.Value.AddHours(1);
            if (now < ev.StartUtc.Value.AddMinutes(-15)) return Bad("The meeting room opens 15 minutes before the start.");
            if (now > end.AddHours(12)) return Bad("This meeting is over.");
        }
        var s = await Settings(tid);
        return Ok(new { url = MeetingUrl(s, ev.Room), room = ev.Room, domain = s["jitsiDomain"]!.GetValue<string>(), title = ev.Title });
    }

    // ---------------------------------------------------------------- invitations and .ics

    private async Task<int> Invite(CalEvent ev, string tid, string kind)
    {
        if (!_mail.IsConfigured) return 0;
        var d = D(ev); var sent = 0;
        var emails = Strs(d, "guests");
        var names = Strs(d, "attendees").Where(x => !string.Equals(x, Me, StringComparison.OrdinalIgnoreCase)).ToList();
        if (names.Count > 0) emails.AddRange(await _db.Users.AsNoTracking().Where(u => u.TenantId == tid && names.Contains(u.Username) && u.Email != "").Select(u => u.Email).ToListAsync());
        var url = MeetingUrl(await Settings(tid), ev.Room ?? "");
        var when = ev.StartUtc == null ? "" : ev.StartUtc.Value.ToString("yyyy-MM-dd HH:mm 'UTC'", CultureInfo.InvariantCulture);
        var subject = (kind == "cancellation" ? "Cancelled: " : kind == "update" ? "Updated: " : "Invitation: ") + ev.Title;
        var body = $"<p><b>{System.Net.WebUtility.HtmlEncode(ev.Title)}</b></p><p>{when}</p>" + (kind == "cancellation" ? "<p>This meeting was cancelled.</p>" : $"<p>Join the video meeting: <a href=\"{url}\">{url}</a></p>");
        foreach (var to in emails.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try { if (await _mail.SendAsync(to, subject, body, true)) sent++; } catch { /* a bad address must not break saving the meeting */ }
        }
        return sent;
    }

    [HttpGet("events/{id}/ics")]
    public async Task<IActionResult> Ics(string id)
    {
        if (!await Has("cal.view")) return Forbid();
        var tid = await Tid();
        var ev = await _db.CalEvents.AsNoTracking().FirstOrDefaultAsync(e => e.TenantId == tid && e.Id == id && e.Kind != "setting" && e.Kind != "todo");
        if (ev == null || ev.StartUtc == null) return NotFound();
        if (!Invited(ev, Me)) return Forbid();
        var d = D(ev);
        static string F(DateTime t) => (t.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : t.ToUniversalTime()).ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
        static string Esc(string? s) => (s ?? "").Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\r", "").Replace("\n", "\\n");
        var sb = new StringBuilder();
        sb.Append("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WorkflowEngine//Calendar//EN\r\nBEGIN:VEVENT\r\n");
        sb.Append($"UID:{ev.Id}@workflowengine\r\nDTSTAMP:{F(DateTime.UtcNow)}\r\nDTSTART:{F(ev.StartUtc.Value)}\r\nDTEND:{F(ev.EndUtc ?? ev.StartUtc.Value.AddHours(1))}\r\nSUMMARY:{Esc(ev.Title)}\r\n");
        var desc = d["notes"]?.GetValue<string>() ?? ""; if (ev.Room != null) desc += (desc == "" ? "" : "\n") + MeetingUrl(await Settings(tid), ev.Room);
        if (desc != "") sb.Append($"DESCRIPTION:{Esc(desc)}\r\n");
        if (ev.Room != null) sb.Append($"URL:{MeetingUrl(await Settings(tid), ev.Room)}\r\n");
        var loc = d["location"]?.GetValue<string>(); if (!string.IsNullOrEmpty(loc)) sb.Append($"LOCATION:{Esc(loc)}\r\n");
        var rep = d["repeat"]?.GetValue<string>() ?? "none";
        if (rep != "none") { sb.Append($"RRULE:FREQ={rep.ToUpperInvariant()}"); if (DateTime.TryParse(d["repeatUntil"]?.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var u)) sb.Append($";UNTIL={F(u.Date.AddDays(1).AddSeconds(-1))}"); sb.Append("\r\n"); }
        sb.Append("END:VEVENT\r\nEND:VCALENDAR\r\n");
        return File(Encoding.UTF8.GetBytes(sb.ToString()), "text/calendar; charset=utf-8", "event.ics");
    }
}
