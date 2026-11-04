using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Administration: workspace plan and usage, the first-run setup wizard, invitations, billing and the module switches.</summary>
internal static class AdmEngine
{
    private static JsonObject? _spec;
    public static JsonObject Spec => _spec ??= (JsonObject)JsonNode.Parse(Loc.ReadData("admin.json"))!;
    public static string S(JsonNode? n) => SiteEngine.Js(n);
    public static string WebOrigin()
    {
        var s = (Api.I.Session?.Server ?? "").Trim().TrimEnd('/');
        return s.EndsWith("/api", StringComparison.OrdinalIgnoreCase) ? s.Substring(0, s.Length - 4) : s;
    }
    public static string InviteLink(string token) => WebOrigin() + "/accept-invite?token=" + Uri.EscapeDataString(token);
    public static string Money(JsonNode? v) => "$" + SiteEngine.Num(v, 0).ToString("N2", CultureInfo.InvariantCulture);
    public static string Rep(string s, string k, string v) => s.Replace("{" + k + "}", v);
    public static string Trunc(string s, int n) => s.Length > n ? s.Substring(0, n) : s;
    public static string InvoiceHtml(JsonObject i)
    {
        var rows = new StringBuilder();
        foreach (var lv in i["lines"] as JsonArray ?? new JsonArray())
        {
            var l = (JsonObject)lv!;
            rows.Append("<tr><td>").Append(SiteEngine.Esc(l["branchName"])).Append("</td><td>").Append(S(l["users"])).Append("</td><td>$").Append(SiteEngine.Num(i["unitPrice"], 0).ToString("F2", CultureInfo.InvariantCulture))
                .Append("</td><td>$").Append(SiteEngine.Num(l["amount"], 0).ToString("F2", CultureInfo.InvariantCulture)).Append("</td></tr>");
        }
        return "<!doctype html><meta charset=\"utf-8\"><title>" + SiteEngine.Esc(i["number"]) + "</title><style>body{font:14px system-ui;margin:40px;color:#111}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}.r{text-align:end}</style>"
            + "<h1>" + SiteEngine.Esc(i["number"]) + "</h1><p>" + SiteEngine.Esc(i["companyName"]) + (S(i["taxNo"]).Length == 0 ? "" : " · " + SiteEngine.Esc(i["taxNo"])) + "<br>" + SiteEngine.Esc(i["period"]) + " · " + SiteEngine.EscS(Trunc(S(i["issuedAt"]), 10))
            + "</p><table><tr><th>Branch</th><th>Users</th><th>Price</th><th>Amount</th></tr>" + rows + "<tr><th colspan=\"3\" class=\"r\">Total (USD)</th><th>$" + SiteEngine.Num(i["total"], 0).ToString("F2", CultureInfo.InvariantCulture)
            + "</th></tr></table><p>≈ " + SiteEngine.Num(i["totalSar"], 0).ToString("F2", CultureInfo.InvariantCulture) + " SAR (rate " + S(i["sarPerUsd"]) + ") · " + SiteEngine.EscS(S(i["status"]).ToUpperInvariant())
            + (S(i["method"]).Length == 0 ? "" : " · " + SiteEngine.Esc(i["method"])) + "</p>";
    }
}

/// <summary>Which modules the company uses (checkboxes); saving needs org.manage.</summary>
internal sealed class AdmModulesBox : StackPanel
{
    private readonly WrapPanel _grid = new(); public readonly Dictionary<string, CheckBox> Boxes = new(); private readonly TextBlock _msg = new() { Margin = new Thickness(0, 6, 0, 0) };

    public AdmModulesBox()
    {
        Children.Add(Ui.Text(Loc.T("mods.hint"), 12, false, Ui.Dim));
        Children.Add(_grid);
        Children.Add(Ui.Row(Ui.Btn(Loc.T("mods.all"), () => SetAll(true), "ghost"), Ui.Btn(Loc.T("mods.none"), () => SetAll(false), "ghost"), Ui.Btn(Loc.T("adm.save"), () => SiteEngine.Run(Save))));
        Children.Add(_msg);
    }
    public async Task Reload() { try { Show(await Api.I.Ops(HttpMethod.Get, "/org/modules") as JsonObject ?? new JsonObject()); } catch (Exception e) { _msg.Text = e.Message; } }
    private void Show(JsonObject r)
    {
        _grid.Children.Clear(); Boxes.Clear();
        var on = new HashSet<string>((r["enabled"] as JsonArray ?? new JsonArray()).Select(x => AdmEngine.S(x)));
        foreach (var mv in r["all"] as JsonArray ?? new JsonArray())
        {
            var m = AdmEngine.S(mv); var name = Loc.T("module." + m);
            var cb = new CheckBox { Content = name == "module." + m ? m : name, IsChecked = on.Contains(m), Margin = new Thickness(0, 4, 18, 4), Width = 190 };
            Boxes[m] = cb; _grid.Children.Add(cb);
        }
    }
    public void SetAll(bool v) { foreach (var c in Boxes.Values) c.IsChecked = v; }
    public List<string> Selected() => Boxes.Where(kv => kv.Value.IsChecked == true).Select(kv => kv.Key).ToList();
    private async Task Save()
    {
        var arr = new JsonArray(); foreach (var m in Selected()) arr.Add(m);
        Show(await Api.I.Ops(HttpMethod.Put, "/org/modules", new JsonObject { ["enabled"] = arr }) as JsonObject ?? new JsonObject()); _msg.Text = Loc.T("adm.saved");
    }
}

/// <summary>Name, e-mail, login, role and branch access; creates the user without a password and returns the invitation link.</summary>
internal sealed class AdmInviteForm : StackPanel
{
    private readonly TextBox _name = Ui.Input(), _email = Ui.Input(), _user = Ui.Input(); private readonly ComboBox _role = new() { Margin = new Thickness(0, 0, 0, 8) };
    private readonly ListBox _branches = new() { SelectionMode = SelectionMode.Multiple, MaxHeight = 90, Margin = new Thickness(0, 0, 0, 8) };
    private readonly TextBlock _err = new() { Foreground = Ui.Danger, TextWrapping = TextWrapping.Wrap }; private readonly List<string> _codes = new(); private readonly Func<JsonObject, Task> _onDone;

    public AdmInviteForm(Func<JsonObject, Task> onDone)
    {
        _onDone = onDone;
        Children.Add(Ui.Labeled(Loc.T("admin.displayName"), _name)); Children.Add(Ui.Labeled(Loc.T("admin.email"), _email)); Children.Add(Ui.Labeled(Loc.T("admin.username"), _user));
        Children.Add(Ui.Labeled(Loc.T("admin.role"), _role)); Children.Add(Ui.Labeled(Loc.T("invite.branchAccess"), _branches));
        Children.Add(Ui.Btn(Loc.T("setup.invite"), () => SiteEngine.Run(Invite))); Children.Add(_err);
    }
    public void Load(IEnumerable<string> roles, JsonArray branches)
    {
        _role.Items.Clear(); foreach (var r in roles) if (r != "admin") _role.Items.Add(r);
        if (_role.Items.Count > 0) _role.SelectedIndex = 0;
        _branches.Items.Clear(); _codes.Clear();
        foreach (var bv in branches) { _branches.Items.Add(AdmEngine.S(bv!["name"])); _codes.Add(AdmEngine.S(bv["code"])); }
    }
    private async Task Invite()
    {
        if (_name.Text.Trim().Length == 0 || _user.Text.Trim().Length == 0) { _err.Text = Loc.T("signup.fill"); return; }
        var br = new JsonArray(); foreach (var i in _branches.SelectedIndices()) br.Add(_codes[i]);
        var body = new JsonObject
        {
            ["username"] = _user.Text.Trim(), ["displayName"] = _name.Text.Trim(), ["email"] = _email.Text.Trim(), ["role"] = _role.SelectedItem as string ?? "employee", ["isActive"] = true, ["permissions"] = null,
            ["branches"] = br.Count == 0 ? null : br, ["invite"] = true, ["appUrl"] = AdmEngine.WebOrigin()
        };
        try
        {
            var u = await Api.I.Ops(HttpMethod.Post, "/users/admin", body) as JsonObject ?? new JsonObject();
            _err.Text = ""; _name.Text = _email.Text = _user.Text = ""; await _onDone(u);
        }
        catch (Exception e) { _err.Text = e.Message; }
    }
}

internal static class ListBoxExt
{
    public static IEnumerable<int> SelectedIndices(this ListBox lb) { foreach (var o in lb.SelectedItems) yield return lb.Items.IndexOf(o); }
}

/// <summary>Company -> branches -> team -> finish (with the module switches), like the portal's first-run wizard.</summary>
internal sealed class AdmWizard : StackPanel
{
    private readonly Func<Task> _onFinished; private JsonObject? _company; private JsonArray _branches = new(); private readonly JsonArray _users = new(); private List<string> _roles = new() { "employee" };
    private int _step; private readonly TextBlock _head = new() { Margin = new Thickness(0, 0, 0, 8) }, _msg = new() { Margin = new Thickness(0, 6, 0, 0) };
    private readonly TextBox _name = Ui.Input(), _ar = Ui.Input(), _country = Ui.Input(), _tax = Ui.Input(), _brn = Ui.Input(), _brc = Ui.Input(); private readonly ComboBox _cur = new() { Margin = new Thickness(0, 0, 0, 8) };
    private readonly DataGrid _brt = Ui.Grid(Loc.T("org.branches"), "Code", Loc.T("org.city")), _invited = Ui.Grid(Loc.T("admin.displayName"), Loc.T("admin.role"), Loc.T("adm.link"));
    private readonly AdmInviteForm _form; private readonly AdmModulesBox _mods = new(); private readonly StackPanel[] _pages = { new(), new(), new(), new() }; private readonly Button _bBack, _bSkip, _bNext;

    public AdmWizard(Func<Task> onFinished)
    {
        _onFinished = onFinished;
        foreach (var c in (JsonArray)AdmEngine.Spec["currencies"]!) _cur.Items.Add(AdmEngine.S(c));
        _pages[0].Children.Add(Ui.Labeled(Loc.T("signup.company"), _name)); _pages[0].Children.Add(Ui.Labeled(Loc.T("org.nameAr"), _ar)); _pages[0].Children.Add(Ui.Labeled(Loc.T("signup.currency"), _cur));
        _pages[0].Children.Add(Ui.Labeled(Loc.T("setup.country"), _country)); _pages[0].Children.Add(Ui.Labeled(Loc.T("setup.taxNo"), _tax)); _pages[0].Children.Add(Ui.Text(Loc.T("setup.oneCompany"), 12, false, Ui.Dim));
        _brt.Height = 220; _pages[1].Children.Add(_brt);
        _brn.Width = 200; _brc.Width = 140; _brn.ToolTip = Loc.T("setup.branchName"); _brc.ToolTip = Loc.T("org.city");
        _pages[1].Children.Add(Ui.Row(_brn, _brc, Ui.Btn(Loc.T("org.addBranch"), () => SiteEngine.Run(AddBranch)), Ui.Btn(Loc.T("adm.delete"), () => SiteEngine.Run(DelBranch), "ghost")));
        _pages[2].Children.Add(Ui.Text(Loc.T("setup.teamHint"), 12, false, Ui.Dim)); _invited.Height = 120; _pages[2].Children.Add(_invited); _pages[2].Children.Add(Ui.Btn(Loc.T("invite.copy"), CopySel, "ghost"));
        _form = new AdmInviteForm(InvitedOne); _pages[2].Children.Add(_form);
        _pages[3].Children.Add(Ui.Text(Loc.T("setup.ready"), 18, true)); _pages[3].Children.Add(Ui.Text(Loc.T("setup.readyHint"), 12, false, Ui.Dim)); _pages[3].Children.Add(_mods);
        Children.Add(_head); foreach (var p in _pages) Children.Add(p);
        _bBack = Ui.Btn(Loc.T("setup.back"), () => Go(_step - 1), "ghost"); _bSkip = Ui.Btn(Loc.T("setup.skip"), () => Go(3), "ghost"); _bNext = Ui.Btn(Loc.T("setup.next"), () => SiteEngine.Run(Next));
        Children.Add(Ui.Row(_bBack, _bSkip, _bNext)); Children.Add(_msg);
        Go(0);
    }

    public async Task Reload()
    {
        var org = await Api.I.Ops(HttpMethod.Get, "/org") as JsonObject ?? new JsonObject();
        var cat = await Api.I.Ops(HttpMethod.Get, "/users/permissions") as JsonObject ?? new JsonObject();
        var cs = org["companies"] as JsonArray ?? new JsonArray();
        _company = cs.Count > 0 ? (JsonObject)cs[0]!.DeepClone() : null; _branches = (JsonArray)(org["branches"] as JsonArray ?? new JsonArray()).DeepClone();
        if (_company is not null)
        {
            _name.Text = AdmEngine.S(_company["name"]); _ar.Text = AdmEngine.S(_company["nameAr"]); _cur.SelectedItem = AdmEngine.S(_company["currency"]); _country.Text = AdmEngine.S(_company["country"]); _tax.Text = AdmEngine.S(_company["taxNo"]);
        }
        _roles = (cat["roles"] as JsonArray ?? new JsonArray()).Select(r => AdmEngine.S(r)).ToList(); if (_roles.Count == 0) _roles.Add("employee");
        ShowBranches(); _form.Load(_roles, _branches); await _mods.Reload();
    }

    private void Go(int n)
    {
        _step = n; for (var i = 0; i < _pages.Length; i++) _pages[i].Visibility = i == n ? Visibility.Visible : Visibility.Collapsed;
        _head.Text = AdmEngine.Rep(AdmEngine.Rep(Loc.T("adm.step"), "n", (n + 1).ToString()), "t", "4") + "   " + Loc.T("setup.s" + (n + 1)); _head.FontWeight = FontWeights.Bold;
        _bBack.Visibility = n > 0 ? Visibility.Visible : Visibility.Collapsed; _bSkip.Visibility = n == 2 ? Visibility.Visible : Visibility.Collapsed;
        _bNext.Content = n == 3 ? Loc.T("setup.finish") : Loc.T("setup.next"); _msg.Text = "";
    }

    private async Task Next()
    {
        if (_step == 0)
        {
            if (_name.Text.Trim().Length == 0) { _msg.Text = Loc.T("adm.mustName"); return; }
            if (_company is null) { Go(1); return; }
            var c = (JsonObject)_company.DeepClone();
            c["name"] = _name.Text.Trim(); c["nameAr"] = _ar.Text.Trim(); c["currency"] = _cur.SelectedItem as string ?? "SAR"; c["country"] = _country.Text.Trim(); c["taxNo"] = _tax.Text.Trim();
            _company = await Api.I.Ops(HttpMethod.Put, "/org/companies/" + AdmEngine.S(_company["code"]), c) as JsonObject ?? _company; Go(1);
        }
        else if (_step < 3) Go(_step + 1);
        else { await Api.I.Ops(HttpMethod.Post, "/org/setup/complete", new JsonObject()); _msg.Text = Loc.T("adm.setupDone"); await _onFinished(); }
    }

    private void ShowBranches() => Ui.Fill(_brt, _branches.Select(b => (new[] { AdmEngine.S(b!["name"]), AdmEngine.S(b["code"]), AdmEngine.S(b["city"]) }, (object)b!)));
    private async Task AddBranch()
    {
        if (_brn.Text.Trim().Length == 0 || _company is null) return;
        const string chars = "abcdefghijklmnopqrstuvwxyz0123456789"; var rnd = new Random(); var sb = new StringBuilder(); for (var i = 0; i < 3; i++) sb.Append(chars[rnd.Next(chars.Length)]);
        var body = new JsonObject { ["code"] = ("BR" + (_branches.Count + 1).ToString("00") + "-" + sb).ToUpperInvariant(), ["company"] = AdmEngine.S(_company["code"]), ["name"] = _brn.Text.Trim(), ["nameAr"] = "", ["warehouse"] = "", ["city"] = _brc.Text.Trim() };
        var b = await Api.I.Ops(HttpMethod.Post, "/org/branches", body);
        if (b is not null) _branches.Add(b.DeepClone());
        _brn.Text = _brc.Text = ""; ShowBranches(); _form.Load(_roles, _branches);
    }
    private async Task DelBranch()
    {
        var b = Ui.Selected<JsonObject>(_brt); if (b is null || _branches.Count < 2) return;
        var code = AdmEngine.S(b["code"]);
        await Api.I.Ops(HttpMethod.Delete, "/org/branches/" + code);
        for (var i = _branches.Count - 1; i >= 0; i--) if (AdmEngine.S(_branches[i]!["code"]) == code) _branches.RemoveAt(i);
        ShowBranches();
    }
    private Task InvitedOne(JsonObject u)
    {
        _users.Add(u.DeepClone());
        Ui.Fill(_invited, _users.Select(x => (new[] { AdmEngine.S(x!["displayName"]), AdmEngine.S(x["role"]), AdmEngine.S(x["inviteToken"]).Length == 0 ? "" : AdmEngine.InviteLink(AdmEngine.S(x["inviteToken"])) }, (object)x!)));
        return Task.CompletedTask;
    }
    private void CopySel()
    {
        var u = Ui.Selected<JsonObject>(_invited);
        if (u is not null && AdmEngine.S(u["inviteToken"]).Length > 0) { Clipboard.SetText(AdmEngine.InviteLink(AdmEngine.S(u["inviteToken"]))); _msg.Text = Loc.T("invite.copied"); }
    }
}

public sealed class AdminView : PageView
{
    private readonly TabControl _tabs = new() { MinHeight = 520 };
    private readonly TextBlock _msg = new() { Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap }, _wsHead = new() { Margin = new Thickness(0, 4, 0, 8) }, _kpi = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 8) };
    private readonly DataGrid _ws = Ui.Grid(Loc.T("adm.v.ws"), Loc.T("bill.users"), "Max");
    private DataGrid _inv = Ui.Grid(), _lines = Ui.Grid(), _invs = Ui.Grid();
    private AdmWizard? _wiz; private AdmInviteForm? _form; private AdmModulesBox? _mods; private readonly List<Func<Task>> _views = new();

    public AdminView()
    {
        Root.Children.Add(Ui.Text(Loc.T("adm.title"), 20, true));
        var w = new StackPanel { Margin = new Thickness(12) }; w.Children.Add(_wsHead); _ws.Height = 130; w.Children.Add(_ws); w.Children.Add(Ui.Text(Loc.T("ws.note"), 12, false, Ui.Dim));
        _tabs.Items.Add(new TabItem { Header = Loc.T("adm.v.ws"), Content = w }); _views.Add(LoadWs);
        if (Api.I.Can("org.manage")) { _wiz = new AdmWizard(Reload); _tabs.Items.Add(new TabItem { Header = Loc.T("adm.v.setup"), Content = new ScrollViewer { Content = new StackPanel { Margin = new Thickness(12), Children = { _wiz } } } }); _views.Add(_wiz.Reload); }
        if (Api.I.Can("admin.users"))
        {
            _inv = Ui.Grid(Loc.T("admin.displayName"), Loc.T("admin.username"), Loc.T("admin.role"), Loc.T("adm.status"), Loc.T("adm.link")); _inv.Height = 200;
            _form = new AdmInviteForm(_ => LoadInvites());
            var p = new StackPanel { Margin = new Thickness(12) };
            p.Children.Add(_inv); p.Children.Add(Ui.Row(Ui.Btn(Loc.T("invite.resend"), () => SiteEngine.Run(Resend)), Ui.Btn(Loc.T("invite.copy"), CopyLink, "ghost")));
            p.Children.Add(Ui.Text(Loc.T("adm.newInvite"), 16, true)); p.Children.Add(_form);
            _tabs.Items.Add(new TabItem { Header = Loc.T("adm.v.invites"), Content = new ScrollViewer { Content = p } }); _views.Add(LoadInvites);
        }
        if (Api.I.Can("org.manage"))
        {
            _lines = Ui.Grid(Loc.T("bill.byBranch"), Loc.T("bill.usersShort"), Loc.T("bill.total")); _lines.Height = 100;
            _invs = Ui.Grid(Loc.T("bill.number"), Loc.T("bill.period"), Loc.T("bill.usersShort"), Loc.T("bill.total"), Loc.T("bill.due"), Loc.T("adm.status")); _invs.Height = 220;
            var p = new StackPanel { Margin = new Thickness(12) };
            p.Children.Add(_kpi); p.Children.Add(_lines); p.Children.Add(_invs);
            p.Children.Add(Ui.Row(Ui.Btn(Loc.T("bill.pay"), () => SiteEngine.Run(Pay)), Ui.Btn(Loc.T("bill.check"), () => SiteEngine.Run(Check), "ghost"), Ui.Btn(Loc.T("bill.print"), PrintInv, "ghost"), Ui.Btn(Loc.T("adm.sandbox"), () => SiteEngine.Run(Sandbox), "ghost")));
            _tabs.Items.Add(new TabItem { Header = Loc.T("bill.tab"), Content = new ScrollViewer { Content = p } }); _views.Add(LoadBilling);
            _mods = new AdmModulesBox(); _tabs.Items.Add(new TabItem { Header = Loc.T("mods.tab"), Content = new ScrollViewer { Content = new StackPanel { Margin = new Thickness(12), Children = { _mods } } } }); _views.Add(_mods.Reload);
        }
        _tabs.SelectionChanged += async (s, e) => { if (e.OriginalSource == _tabs) await Safe(Reload); };
        Root.Children.Add(_tabs); Root.Children.Add(_msg);
    }

    public override async Task Reload() { var i = _tabs.SelectedIndex; if (i >= 0 && i < _views.Count) await _views[i](); }

    private async Task LoadWs()
    {
        var o = await Api.I.Ops(HttpMethod.Get, "/org") as JsonObject ?? new JsonObject(); var tn = o["tenant"] as JsonObject ?? new JsonObject();
        var plan = AdmEngine.S(tn["plan"]).Length == 0 ? "starter" : AdmEngine.S(tn["plan"]);
        _wsHead.Text = AdmEngine.S(tn["name"]) + "    " + Loc.T("ws.id") + ": " + AdmEngine.S(tn["id"]) + "    " + Loc.T("ws.plan") + ": " + Loc.T("ws.plan." + plan);
        string Lim(string k) { var mx = SiteEngine.Num(tn["max" + k], 0); return mx != 0 ? SiteEngine.NumStr(mx) : Loc.T("ws.unlimited"); }
        Ui.Fill(_ws, new[] { (new[] { Loc.T("ws.users"), AdmEngine.S(tn["users"]), Lim("Users") }, (object)"u"), (new[] { Loc.T("org.companies"), AdmEngine.S(tn["companies"]), Lim("Companies") }, (object)"c"), (new[] { Loc.T("org.branches"), AdmEngine.S(tn["branches"]), Lim("Branches") }, (object)"b") });
        _msg.Text = tn["setupDone"] is JsonValue sv && sv.TryGetValue<bool>(out var sd) && !sd ? Loc.T("setup.banner") : "";
    }

    private async Task LoadInvites()
    {
        var users = await Api.I.Ops(HttpMethod.Get, "/users/admin") as JsonArray ?? new JsonArray();
        Ui.Fill(_inv, users.Select(uv =>
        {
            var u = (JsonObject)uv!;
            return (new[] { AdmEngine.S(u["displayName"]), AdmEngine.S(u["username"]), AdmEngine.S(u["role"]), u["invitePending"] is JsonValue pv && pv.TryGetValue<bool>(out var pb) && pb ? Loc.T("invite.pending") : (u["isActive"] is JsonValue av && av.TryGetValue<bool>(out var ab) && ab ? "✓" : "-"),
                AdmEngine.S(u["inviteToken"]).Length == 0 ? "" : AdmEngine.InviteLink(AdmEngine.S(u["inviteToken"])) }, (object)u);
        }));
        _msg.Text = users.Count == 0 ? Loc.T("adm.noInvites") : "";
        var org = await Api.I.Ops(HttpMethod.Get, "/org") as JsonObject ?? new JsonObject(); var cat = await Api.I.Ops(HttpMethod.Get, "/users/permissions") as JsonObject ?? new JsonObject();
        var roles = (cat["roles"] as JsonArray ?? new JsonArray()).Select(r => AdmEngine.S(r)).ToList(); if (roles.Count == 0) roles.Add("employee");
        _form?.Load(roles, org["branches"] as JsonArray ?? new JsonArray());
    }
    private async Task Resend()
    {
        var u = Ui.Selected<JsonObject>(_inv); if (u is null) return;
        await Api.I.Ops(HttpMethod.Post, "/users/admin/" + AdmEngine.S(u["id"]) + "/invite", new JsonObject { ["appUrl"] = AdmEngine.WebOrigin() }); _msg.Text = Loc.T("adm.accept"); await LoadInvites();
    }
    private void CopyLink()
    {
        var u = Ui.Selected<JsonObject>(_inv); if (u is null) return;
        if (AdmEngine.S(u["inviteToken"]).Length > 0) { Clipboard.SetText(AdmEngine.InviteLink(AdmEngine.S(u["inviteToken"]))); _msg.Text = Loc.T("invite.copied"); } else _msg.Text = Loc.T("invite.resend");
    }

    private async Task LoadBilling()
    {
        var s = await Api.I.Ops(HttpMethod.Get, "/billing/summary") as JsonObject ?? new JsonObject();
        _kpi.Text = Loc.T("bill.users") + ": " + AdmEngine.S(s["users"]) + "    " + Loc.T("bill.rate") + ": " + AdmEngine.Money(s["unitPrice"]) + " (" + Loc.T("bill.perUserMonth") + ")    " + Loc.T("bill.estimate") + ": " + AdmEngine.Money(s["estimate"])
            + "    " + Loc.T("bill.balance") + ": " + AdmEngine.Money(s["balance"]) + " (" + AdmEngine.S(s["openInvoices"]) + " " + Loc.T("bill.open") + ")\n"
            + AdmEngine.Rep(AdmEngine.Rep(AdmEngine.Rep(Loc.T("bill.pricing"), "p", AdmEngine.S(s["pricePerUser"])), "v", AdmEngine.S(s["volumePrice"])), "n", AdmEngine.S(s["volumeFrom"]));
        Ui.Fill(_lines, (s["lines"] as JsonArray ?? new JsonArray()).Select(lv => (new[] { AdmEngine.S(lv!["branchName"]), AdmEngine.S(lv["users"]), AdmEngine.Money(lv["amount"]) }, (object)lv!)));
        var inv = await Api.I.Ops(HttpMethod.Get, "/billing/invoices") as JsonArray ?? new JsonArray();
        Ui.Fill(_invs, inv.Select(iv =>
        {
            var i = (JsonObject)iv!; var due = AdmEngine.S(i["dueAt"]);
            var st = AdmEngine.S(i["status"]) == "paid" ? Loc.T("bill.paid") : (i["overdue"] is JsonValue ov && ov.TryGetValue<bool>(out var ob) && ob ? Loc.T("bill.overdue") : Loc.T("bill.unpaid"));
            return (new[] { AdmEngine.S(i["number"]), AdmEngine.S(i["period"]), AdmEngine.S(i["users"]) + " x " + AdmEngine.Money(i["unitPrice"]), AdmEngine.Money(i["total"]) + " (~" + SiteEngine.Num(i["totalSar"], 0).ToString("F2", CultureInfo.InvariantCulture) + " SAR)", AdmEngine.Trunc(due, 10), st }, (object)i);
        }));
        _msg.Text = "";
    }
    private async Task Pay()
    {
        var i = Ui.Selected<JsonObject>(_invs); if (i is null || AdmEngine.S(i["status"]) != "open") return;
        var r = await Api.I.Ops(HttpMethod.Post, "/billing/invoices/" + AdmEngine.S(i["id"]) + "/pay", new JsonObject { ["returnUrl"] = AdmEngine.WebOrigin() + "/admin?tab=billing" }) as JsonObject ?? new JsonObject();
        var url = AdmEngine.S(r["url"]);
        if (url.Length > 0) { CalEngine.OpenUrl(url); _msg.Text = Loc.T("adm.payOpened"); } else _msg.Text = Loc.T("bill.testMode") + ": " + Loc.T("bill.testHint");
    }
    private async Task Check()
    {
        var i = Ui.Selected<JsonObject>(_invs); if (i is null) return;
        var r = await Api.I.Ops(HttpMethod.Post, "/billing/invoices/" + AdmEngine.S(i["id"]) + "/confirm", new JsonObject()) as JsonObject ?? new JsonObject();
        _msg.Text = AdmEngine.S(r["status"]) == "paid" ? Loc.T("bill.thanks") : Loc.T("bill.notPaid"); await LoadBilling();
    }
    private async Task Sandbox()
    {
        var i = Ui.Selected<JsonObject>(_invs); if (i is null || AdmEngine.S(i["status"]) != "open") return;
        await Api.I.Ops(HttpMethod.Post, "/billing/invoices/" + AdmEngine.S(i["id"]) + "/sandbox-pay", new JsonObject()); _msg.Text = Loc.T("bill.thanks"); await LoadBilling();
    }
    private void PrintInv()
    {
        var i = Ui.Selected<JsonObject>(_invs); if (i is null) return;
        var path = Path.Combine(Path.GetTempPath(), AdmEngine.S(i["number"]) + ".html");
        File.WriteAllText(path, AdmEngine.InvoiceHtml(i), new UTF8Encoding(false)); CalEngine.OpenUrl(path); _msg.Text = path;
    }
}
