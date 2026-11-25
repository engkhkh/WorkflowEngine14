using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Security;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class ChatTurn { public string From { get; set; } = ""; public string Text { get; set; } = ""; }
public class ChatRequest { public string? Message { get; set; } public string? Lang { get; set; } public List<ChatTurn>? History { get; set; } }
public class ChatAction { public string Label { get; set; } = ""; public string Module { get; set; } = ""; public string Kind { get; set; } = ""; public string? Id { get; set; } }
public class ChatReply
{
    public string Reply { get; set; } = "";
    public List<ChatAction> Actions { get; set; } = new();
    public List<string> Suggestions { get; set; } = new();
    /// <summary>rules = answered from the workspace's data; llm = free-form answer from the language model (only when ANTHROPIC_API_KEY is set)</summary>
    public string Source { get; set; } = "rules";
}

/// <summary>
/// The ERP chatbot, one brain for the web, mobile and desktop apps. It answers from the live data of the caller's workspace and only
/// from what the caller may see (the same privileges and branch limits as the screens): pending approvals and tasks, counts and latest
/// records of any record type, lookups by code (PO-0001), lots near expiry, the CRM pipeline, the audit trail and a workspace summary.
/// A sentence it does not understand goes to a language model when the environment variable ANTHROPIC_API_KEY is set (it gets no data,
/// only the question and the module names); otherwise the reply is a short help text.
/// </summary>
[ApiController]
[Route("api/assistant")]
[Authorize]
public class AssistantController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;
    private readonly ICurrentUser _me;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    public AssistantController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant, ICurrentUser me) { _db = db; _perms = perms; _tenant = tenant; _me = me; }

    private string Username => User.FindFirstValue(ClaimTypes.Name)!;

    [HttpPost("chat")]
    public async Task<IActionResult> Chat([FromBody] ChatRequest b)
    {
        var message = (b?.Message ?? "").Trim();
        if (message.Length == 0) return BadRequest(new { message = "Write a question." });
        if (message.Length > 500) message = message[..500];
        if (!await _perms.Has(User, "assistant.use")) return Forbid();
        var ctx = new Ctx
        {
            Ar = string.Equals(b?.Lang, "ar", StringComparison.OrdinalIgnoreCase),
            TenantId = await _tenant.TenantIdOf(User),
            Eff = (await _perms.EffectiveFor(User)).ToHashSet(StringComparer.OrdinalIgnoreCase),
            Branches = await _me.AllowedBranchesAsync(),
        };
        var reply = await Answer(ctx, message, b?.History);
        reply.Suggestions = Suggestions(ctx);
        return Ok(reply);
    }

    private sealed class Ctx
    {
        public bool Ar; public string TenantId = ""; public HashSet<string> Eff = new(); public List<string>? Branches;
        public string T(string en, string ar) => Ar ? ar : en;
    }

    private static List<string> Suggestions(Ctx c)
    {
        var l = new List<string> { c.T("What is waiting for me?", "ما الذي ينتظرني؟"), c.T("Give me a summary", "أعطني ملخصًا") };
        if (c.Eff.Contains("proc.view")) l.Add(c.T("Show purchase orders", "اعرض أوامر الشراء"));
        if (c.Eff.Contains("crm.view")) l.Add(c.T("How is the sales pipeline?", "كيف حال خط المبيعات؟"));
        if (c.Eff.Contains("wh.view")) l.Add(c.T("Which lots are expiring?", "أي الدفعات تنتهي قريبًا؟"));
        if (c.Eff.Contains("gov.audit.view")) l.Add(c.T("What changed this week?", "ماذا تغيّر هذا الأسبوع؟"));
        return l;
    }

    // ------------------------------------------------------------------ language helpers

    private static string NormAr(string s)
    {
        var t = s.ToLowerInvariant().Replace('أ', 'ا').Replace('إ', 'ا').Replace('آ', 'ا').Replace('ة', 'ه').Replace('ى', 'ي');
        return Regex.Replace(t, @"(^|\s)ال", "$1");
    }

    private static bool Any(string q, params string[] words) => words.Any(w => q.Contains(w, StringComparison.Ordinal));

    private static string Num(decimal v) => v == Math.Floor(v) ? ((long)v).ToString("N0", CultureInfo.InvariantCulture) : v.ToString("N2", CultureInfo.InvariantCulture);

    private IQueryable<ErpRecord> Q(Ctx c, string module, string kind)
    {
        var q = _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == c.TenantId && r.Module == module && r.Kind == kind);
        if (c.Branches != null) q = q.Where(r => r.Branch == null || r.Branch == "" || c.Branches.Contains(r.Branch));
        return q;
    }

    private static string Label(ErpRecord r)
    {
        if (!string.IsNullOrEmpty(r.Code)) return r.Code!;
        var d = FinJson.Obj(r.Data);
        foreach (var k in new[] { "name", "title", "nameEn", "description" }) { var v = FinJson.S(d, k); if (v != "") return v; }
        return r.Id.Length >= 8 ? r.Id[..8] : r.Id;
    }

    private static string Name(ErpRecord r)
    {
        var d = FinJson.Obj(r.Data);
        foreach (var k in new[] { "name", "title", "nameEn", "description" }) { var v = FinJson.S(d, k); if (v != "") return v; }
        return "";
    }

    private static decimal Amount(ErpRecord r)
    {
        var d = FinJson.Obj(r.Data);
        foreach (var k in new[] { "total", "amount", "value", "price" }) { var v = FinJson.D(d, k); if (v != 0) return v; }
        return 0;
    }

    private static string Line(Ctx c, ErpRecord r)
    {
        var sb = new StringBuilder("• " + Label(r));
        var nm = Name(r);
        if (nm != "" && nm != Label(r)) sb.Append(" — " + nm);
        if (!string.IsNullOrEmpty(r.Status)) sb.Append(" (" + r.Status + ")");
        var a = Amount(r);
        if (a != 0) sb.Append(" · " + Num(a));
        return sb.ToString();
    }

    private static ChatAction Open(string label, string module, string kind, string? id = null) => new() { Label = label, Module = module, Kind = kind, Id = id };

    // ------------------------------------------------------------------ the engine

    private async Task<ChatReply> Answer(Ctx c, string message, List<ChatTurn>? history)
    {
        var q = message.ToLowerInvariant();
        var qa = NormAr(message);
        bool Has(params string[] words) => Any(q, words) || Any(qa, words.Select(NormAr).ToArray());

        if (q.Length <= 14 && Has("hi", "hello", "hey", "help", "مرحبا", "اهلا", "السلام", "مساعدة", "ساعد"))
            return Text(c.T("Hello! I can tell you what is waiting for you, count and list records (for example purchase orders or leads), find a record by its number such as PO-0001, show lots near expiry, the sales pipeline and recent changes. What would you like to know?",
                            "مرحبًا! أستطيع إخبارك بما ينتظرك، وعدّ وعرض السجلات (مثل أوامر الشراء أو العملاء المحتملين)، والبحث عن سجل برقمه مثل PO-0001، وعرض الدفعات القريبة من الانتهاء وخط المبيعات وآخر التغييرات. ماذا تريد أن تعرف؟"));

        // 1. a record number
        var m = Regex.Match(q, @"\b([a-z]{1,6}-[a-z0-9]{3,})\b");
        if (m.Success)
        {
            var found = await FindByCode(c, m.Groups[1].Value);
            if (found != null) return found;
        }

        // 2. what is waiting for me
        var kinds = MatchKinds(c, q, qa);
        var wantsAppr = Has("approval", "approve", "موافقة", "موافقات", "اعتماد");
        var wantsWait = Has("waiting", "pending", "for me", "to do", "inbox", "ينتظر", "معلق", "بانتظار", "مهام");
        if (wantsAppr || (wantsWait && kinds.Count == 0)) return await Waiting(c);

        // 3. specific business questions
        if (Has("expir", "shelf life", "منتهي", "صلاحي", "انتهاء") && c.Eff.Contains("wh.view")) return await Expiring(c);
        if (Has("audit", "who changed", "what changed", "changes", "تدقيق", "تغيير", "تغيّر", "من غير") && c.Eff.Contains("gov.audit.view")) return await Audit(c);
        if (Has("pipeline", "forecast", "خط المبيعات", "الفرص") && c.Eff.Contains("crm.view")) return await Pipeline(c);
        if (kinds.Count == 0 && Has("summary", "overview", "how are we", "status", "ملخص", "نظرة", "الوضع")) return await Summary(c);

        // 4. count / list a record type
        if (kinds.Count > 0)
        {
            var parts = new List<string>();
            var actions = new List<ChatAction>();
            foreach (var k in kinds.Take(3)) { parts.Add(await Describe(c, k, q, qa, actions)); }
            return new ChatReply { Reply = string.Join("\n\n", parts), Actions = actions };
        }

        // 5. everything else: the language model when configured, otherwise help
        var llm = await AskModel(c, message, history);
        if (llm != null) return new ChatReply { Reply = llm, Source = "llm" };
        return Text(c.T("I did not understand that. Try: \"What is waiting for me?\", \"Show purchase orders\", \"How many leads?\", \"Find PO-0001\", \"Which lots are expiring?\" or \"Give me a summary\".",
                        "لم أفهم ذلك. جرّب: «ما الذي ينتظرني؟» أو «اعرض أوامر الشراء» أو «كم عدد العملاء المحتملين؟» أو «ابحث عن PO-0001» أو «أي الدفعات تنتهي قريبًا؟» أو «أعطني ملخصًا»."));
    }

    private static ChatReply Text(string t) => new() { Reply = t };

    private static List<AssistantCatalog.Entry> MatchKinds(Ctx c, string q, string qa)
    {
        var list = new List<AssistantCatalog.Entry>();
        foreach (var e in AssistantCatalog.All)
        {
            if (!c.Eff.Contains(e.View)) continue;
            var hit = q.Contains(e.Stem, StringComparison.Ordinal) || q.Contains(e.En.ToLowerInvariant(), StringComparison.Ordinal) || qa.Contains(NormAr(e.Ar), StringComparison.Ordinal);
            if (hit) list.Add(e);
        }
        // "purchase orders" also contains "order": prefer the longest matching names when one match contains another
        return list.Where(x => !list.Any(y => y != x && y.Stem.Length > x.Stem.Length && y.Stem.Contains(x.Stem))).ToList();
    }

    private async Task<string> Describe(Ctx c, AssistantCatalog.Entry e, string q, string qa, List<ChatAction> actions)
    {
        var rows = await Q(c, e.Module, e.Kind).OrderByDescending(r => r.CreatedAt).Take(2000).ToListAsync();
        var title = c.Ar ? e.Ar : e.En;
        actions.Add(Open(title, e.Module, e.Kind));
        if (rows.Count == 0) return c.T($"There are no {e.En.ToLowerInvariant()} yet.", $"لا توجد سجلات في «{e.Ar}» بعد.");
        var sb = new StringBuilder(c.T($"{title}: {rows.Count} record(s).", $"{title}: {rows.Count} سجل."));
        var by = rows.GroupBy(r => r.Status ?? "-").OrderByDescending(g => g.Count()).Take(6).ToList();
        if (by.Count > 1 || by[0].Key != "-") sb.Append("\n" + string.Join(" · ", by.Select(g => $"{g.Key}: {g.Count()}")));
        var total = rows.Sum(Amount);
        if (total != 0 && Has2(q, qa)) sb.Append("\n" + c.T("Total value: ", "إجمالي القيمة: ") + Num(total));
        else if (total != 0) sb.Append("\n" + c.T("Total value: ", "إجمالي القيمة: ") + Num(total));
        // a status word in the question narrows the latest list
        var status = by.Select(g => g.Key).FirstOrDefault(s => s != "-" && q.Contains(s.ToLowerInvariant(), StringComparison.Ordinal));
        var latest = (status == null ? rows : rows.Where(r => r.Status == status).ToList()).Take(5).ToList();
        if (latest.Count > 0) sb.Append("\n" + c.T(status == null ? "Latest:" : $"Latest {status}:", status == null ? "الأحدث:" : $"الأحدث ({status}):") + "\n" + string.Join("\n", latest.Select(r => Line(c, r))));
        foreach (var r in latest.Take(3)) actions.Add(Open(Label(r), e.Module, e.Kind, r.Id));
        return sb.ToString();
    }

    private static bool Has2(string q, string qa) => Any(q, "total", "sum", "worth", "value") || Any(qa, "اجمالي", "مجموع", "قيمه");

    private async Task<ChatReply?> FindByCode(Ctx c, string code)
    {
        var hits = await _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == c.TenantId && r.Code != null && r.Code.ToLower() == code).Take(10).ToListAsync();
        var lines = new List<string>();
        var actions = new List<ChatAction>();
        foreach (var r in hits)
        {
            var e = AssistantCatalog.All.FirstOrDefault(x => x.Module == r.Module && x.Kind == r.Kind);
            if (e == null || !c.Eff.Contains(e.View)) continue;
            if (c.Branches != null && !string.IsNullOrEmpty(r.Branch) && !c.Branches.Contains(r.Branch!)) continue;
            var d = FinJson.Obj(r.Data);
            var sb = new StringBuilder($"{(c.Ar ? e.Ar : e.En)} · {r.Code}");
            if (!string.IsNullOrEmpty(r.Status)) sb.Append($" — {r.Status}");
            var nm = Name(r);
            if (nm != "") sb.Append($"\n{nm}");
            var a = Amount(r);
            if (a != 0) sb.Append("\n" + c.T("Amount: ", "المبلغ: ") + Num(a));
            if (!string.IsNullOrEmpty(r.CreatedBy)) sb.Append("\n" + c.T("Created by ", "أنشأه ") + r.CreatedBy);
            if (FinJson.S(d, "date") != "") sb.Append("\n" + c.T("Date: ", "التاريخ: ") + FinJson.S(d, "date"));
            lines.Add(sb.ToString());
            actions.Add(Open(r.Code!, r.Module, r.Kind, r.Id));
        }
        return lines.Count == 0 ? null : new ChatReply { Reply = string.Join("\n\n", lines), Actions = actions };
    }

    private async Task<ChatReply> Waiting(Ctx c)
    {
        var sb = new StringBuilder();
        var actions = new List<ChatAction>();
        var tasks = await _db.Tasks.AsNoTracking().Where(t => t.AssignedTo == Username && t.Status == WorkflowEngine.Api.Models.TaskStatus.Pending).OrderByDescending(t => t.CreatedAt).Take(50).ToListAsync();
        sb.Append(tasks.Count == 0 ? c.T("No workflow tasks are waiting for you.", "لا توجد مهام سير عمل بانتظارك.") : c.T($"{tasks.Count} workflow task(s) are waiting for you:", $"لديك {tasks.Count} مهمة سير عمل بانتظارك:"));
        foreach (var t in tasks.Take(5)) sb.Append($"\n• {t.NodeName}" + (string.IsNullOrEmpty(t.Priority) ? "" : $" ({t.Priority})"));
        if (c.Eff.Contains("gov.view"))
        {
            var ap = await Q(c, "gov", "approval").Where(r => r.Status == "Pending").OrderByDescending(r => r.CreatedAt).Take(200).ToListAsync();
            var mine = c.Eff.Contains("gov.approvals.admin") || c.Eff.Contains("gov.audit.view") ? ap : ap.Where(r => FinJson.S(FinJson.Obj(r.Data), "requestedBy") == Username).ToList();
            sb.Append("\n\n" + (mine.Count == 0 ? c.T("No ERP approval requests are pending.", "لا توجد طلبات موافقة معلقة في النظام.") : c.T($"{mine.Count} ERP approval request(s) are pending:", $"{mine.Count} طلب موافقة معلق في النظام:")));
            foreach (var r in mine.Take(5))
            {
                var d = FinJson.Obj(r.Data);
                sb.Append($"\n• {FinJson.S(d, "target")} {FinJson.S(d, "code")}");
                var am = FinJson.D(d, "amount");
                if (am != 0) sb.Append(" · " + Num(am));
                var by = FinJson.S(d, "requestedBy");
                if (by != "") sb.Append(c.T(" · by ", " · من ") + by);
            }
            actions.Add(Open(c.T("Approvals", "الموافقات"), "gov", "approval"));
        }
        return new ChatReply { Reply = sb.ToString(), Actions = actions };
    }

    private async Task<ChatReply> Expiring(Ctx c)
    {
        var lots = await Q(c, "wh", "lot").Take(3000).ToListAsync();
        var today = ClientClock.Today;
        var rows = new List<(ErpRecord r, DateTime exp, decimal qty)>();
        foreach (var r in lots)
        {
            var d = FinJson.Obj(r.Data);
            if (!FinJson.TryDate(d, "expiry", out var exp)) continue;
            var qty = FinJson.D(d, "qty");
            if (qty <= 0 || r.Status == "Depleted") continue;
            rows.Add((r, exp.Date, qty));
        }
        var expired = rows.Where(x => x.exp < today).OrderBy(x => x.exp).ToList();
        var soon = rows.Where(x => x.exp >= today && x.exp <= today.AddDays(30)).OrderBy(x => x.exp).ToList();
        var sb = new StringBuilder(c.T($"{expired.Count} lot(s) are expired but still in stock, {soon.Count} expire within 30 days.", $"{expired.Count} دفعة منتهية الصلاحية ما زالت في المخزون، و{soon.Count} تنتهي خلال 30 يومًا."));
        foreach (var x in expired.Take(4).Concat(soon.Take(6)))
        {
            var d = FinJson.Obj(x.r.Data);
            sb.Append($"\n• {FinJson.S(d, "sku")} · {FinJson.S(d, "batchNo")} · {x.exp:yyyy-MM-dd} · {c.T("qty", "الكمية")} {Num(x.qty)}");
        }
        return new ChatReply { Reply = sb.ToString(), Actions = { Open(c.T("Batches & serials", "الدفعات والأرقام التسلسلية"), "wh", "lot") } };
    }

    private async Task<ChatReply> Audit(Ctx c)
    {
        var since = DateTime.UtcNow.AddDays(-7);
        var rows = await Q(c, "gov", "audit").Where(r => r.CreatedAt >= since).OrderByDescending(r => r.CreatedAt).Take(3000).ToListAsync();
        if (rows.Count == 0) return Text(c.T("Nothing was changed in the last 7 days.", "لم يتغير شيء خلال آخر 7 أيام."));
        var todayStart = DateTime.UtcNow.Date;
        var sb = new StringBuilder(c.T($"{rows.Count} change(s) in the last 7 days, {rows.Count(r => r.CreatedAt >= todayStart)} today.", $"{rows.Count} تغيير خلال آخر 7 أيام، منها {rows.Count(r => r.CreatedAt >= todayStart)} اليوم."));
        var byUser = rows.GroupBy(r => FinJson.S(FinJson.Obj(r.Data), "by")).OrderByDescending(g => g.Count()).Take(5);
        sb.Append("\n" + c.T("By user: ", "حسب المستخدم: ") + string.Join(" · ", byUser.Select(g => $"{(g.Key == "" ? "?" : g.Key)} {g.Count()}")));
        var byAct = rows.GroupBy(r => r.Status ?? "").OrderByDescending(g => g.Count());
        sb.Append("\n" + c.T("By action: ", "حسب الإجراء: ") + string.Join(" · ", byAct.Select(g => $"{g.Key} {g.Count()}")));
        sb.Append("\n" + c.T("Latest:", "الأحدث:"));
        foreach (var r in rows.Take(5))
        {
            var d = FinJson.Obj(r.Data);
            sb.Append($"\n• {FinJson.S(d, "module")}/{FinJson.S(d, "kind")} {FinJson.S(d, "code")} — {r.Status} {c.T("by", "بواسطة")} {FinJson.S(d, "by")}");
        }
        return new ChatReply { Reply = sb.ToString(), Actions = { Open(c.T("Audit trail", "سجل التدقيق"), "gov", "audit") } };
    }

    private async Task<ChatReply> Pipeline(Ctx c)
    {
        var opps = await Q(c, "crm", "opportunity").Take(3000).ToListAsync();
        if (opps.Count == 0) return Text(c.T("There are no opportunities yet.", "لا توجد فرص بعد."));
        var sb = new StringBuilder(c.T($"{opps.Count} opportunities, worth {Num(opps.Sum(Amount))} in total.", $"{opps.Count} فرصة بقيمة إجمالية {Num(opps.Sum(Amount))}."));
        foreach (var g in opps.GroupBy(r => r.Status ?? "-").OrderByDescending(g => g.Sum(Amount)))
            sb.Append($"\n• {g.Key}: {g.Count()} · {Num(g.Sum(Amount))}");
        return new ChatReply { Reply = sb.ToString(), Actions = { Open(c.T("Opportunities", "الفرص"), "crm", "opportunity") } };
    }

    private async Task<ChatReply> Summary(Ctx c)
    {
        var visible = AssistantCatalog.All.Where(e => c.Eff.Contains(e.View)).ToList();
        var mods = visible.Select(e => e.Module).Distinct().ToList();
        var kinds = visible.Select(e => e.Kind).Distinct().ToList();
        var q = _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == c.TenantId && mods.Contains(r.Module) && kinds.Contains(r.Kind));
        if (c.Branches != null) q = q.Where(r => r.Branch == null || r.Branch == "" || c.Branches.Contains(r.Branch));
        var counts = await q.GroupBy(r => new { r.Module, r.Kind }).Select(g => new { g.Key.Module, g.Key.Kind, N = g.Count() }).ToListAsync();
        var lines = new List<(int n, string text)>();
        var actions = new List<ChatAction>();
        foreach (var x in counts)
        {
            var e = visible.FirstOrDefault(v => v.Module == x.Module && v.Kind == x.Kind);
            if (e == null || x.N == 0) continue;
            lines.Add((x.N, $"• {(c.Ar ? e.ModuleAr : e.ModuleEn)} › {(c.Ar ? e.Ar : e.En)}: {x.N}"));
        }
        if (lines.Count == 0) return Text(c.T("There is no data yet in the modules you can see.", "لا توجد بيانات بعد في الوحدات المتاحة لك."));
        var sb = new StringBuilder(c.T("Records in your workspace (largest first):", "السجلات في مساحة عملك (الأكبر أولًا):"));
        foreach (var l in lines.OrderByDescending(l => l.n).Take(10)) sb.Append("\n" + l.text);
        var w = await Waiting(c);
        sb.Append("\n\n" + w.Reply);
        return new ChatReply { Reply = sb.ToString(), Actions = w.Actions };
    }

    // ------------------------------------------------------------------ language model fallback (optional)

    private async Task<string?> AskModel(Ctx c, string message, List<ChatTurn>? history)
    {
        var key = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
        if (string.IsNullOrWhiteSpace(key)) return null;
        try
        {
            var modules = string.Join(", ", AssistantCatalog.All.Where(e => c.Eff.Contains(e.View)).Select(e => c.Ar ? e.ModuleAr : e.ModuleEn).Distinct());
            var system = "You are the assistant inside a workflow ERP. Answer briefly in " + (c.Ar ? "Arabic" : "English") + ". "
                       + "You have no access to the company's data in this mode: for questions about specific records or numbers, tell the user to ask for them by name (for example 'show purchase orders' or 'find PO-0001'). "
                       + "You may explain ERP concepts and how to use these modules: " + modules + ".";
            var msgs = new List<object>();
            foreach (var t in (history ?? new()).TakeLast(6))
                if (!string.IsNullOrWhiteSpace(t.Text)) msgs.Add(new { role = t.From == "user" ? "user" : "assistant", content = t.Text.Length > 800 ? t.Text[..800] : t.Text });
            msgs.Add(new { role = "user", content = message });
            var body = JsonSerializer.Serialize(new { model = Environment.GetEnvironmentVariable("WF_LLM_MODEL") ?? "claude-sonnet-5-5", max_tokens = 500, system, messages = msgs });
            var req = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            req.Headers.Add("x-api-key", key);
            req.Headers.Add("anthropic-version", "2023-06-01");
            var res = await Http.SendAsync(req);
            if (!res.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            foreach (var part in doc.RootElement.GetProperty("content").EnumerateArray())
                if (part.TryGetProperty("text", out var t)) return t.GetString();
            return null;
        }
        catch { return null; }
    }
}
