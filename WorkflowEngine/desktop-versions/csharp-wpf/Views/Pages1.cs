using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

// ------------------------------------------------------------------------------------------------ home
public sealed class HomeView : PageView
{
    private readonly Action<int> _go;
    private readonly Action<string, string?> _openKind;
    private readonly TextBlock _hello = Ui.Text("", 22, true);
    private readonly TextBlock _tasks = new(), _appr = new(), _docs = new();

    public HomeView(Action<int> go, Action<string, string?> openKind)
    {
        _go = go; _openKind = openKind;
        Root.Children.Add(_hello);
        var cards = new UniformGrid { Columns = 3, Margin = new Thickness(0, 10, 0, 10) };
        cards.Children.Add(Card(_tasks, Loc.T("home.pendingTasks"), 1));
        cards.Children.Add(Card(_appr, Loc.T("home.pendingApprovals"), 1));
        cards.Children.Add(Card(_docs, Loc.T("home.myDocs"), 2));
        Root.Children.Add(cards);
        Root.Children.Add(Ui.Text(Loc.T("home.modules"), 16, true));
        var grid = new UniformGrid { Columns = 4, Margin = new Thickness(0, 6, 0, 0) };
        foreach (var m in Loc.VisibleModules())
        {
            var id = m.Id;
            var b = Ui.Btn(m.Name(Loc.Rtl), () => _openKind(id, null), "ghost");
            b.Margin = new Thickness(0, 0, 8, 8);
            grid.Children.Add(b);
        }
        Root.Children.Add(grid);
    }

    private Border Card(TextBlock big, string small, int page)
    {
        big.FontSize = 30; big.FontWeight = FontWeights.Bold; big.Foreground = Ui.Primary; big.Text = "–";
        var st = new StackPanel();
        st.Children.Add(big);
        st.Children.Add(Ui.Text(small, 13, false, Ui.Dim));
        var b = new Border
        {
            Child = st, Background = System.Windows.Media.Brushes.White, BorderBrush = System.Windows.Media.Brushes.LightGray, BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8), Padding = new Thickness(14), Margin = new Thickness(0, 0, 10, 0), Cursor = Cursors.Hand
        };
        b.MouseLeftButtonUp += (_, _) => _go(page);
        return b;
    }

    public override async Task Reload()
    {
        _hello.Text = Loc.T("home.hello", ("name", Api.I.Session?.DisplayName ?? ""));
        var api = Api.I;
        async Task<List<T>> Try<T>(Task<List<T>> t) { try { return await t; } catch { return new List<T>(); } }
        var tk = Try(api.Tasks());
        var dc = Try(api.Instances());
        var ap = api.Can("gov.view") ? Try(api.Records("gov", "approval")) : Task.FromResult(new List<ErpRec>());
        _tasks.Text = (await tk).Count.ToString();
        _docs.Text = (await dc).Count.ToString();
        _appr.Text = (await ap).Count(a => a.Status == "Pending" && a.Data["canAct"] is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<bool>(out var b) && b).ToString();
    }
}

// ------------------------------------------------------------------------------------------------ approvals
public sealed class ApprovalsView : PageView
{
    private readonly System.Windows.Controls.DataGrid _grid = Ui.Grid(Loc.T("appr.type"), Loc.T("appr.target"), Loc.T("appr.requestedBy"), Loc.T("erp.status"));
    private readonly TextBlock _empty = Ui.Text(Loc.T("appr.none"), 13, false, Ui.Dim);

    public ApprovalsView()
    {
        Root.Children.Add(Ui.Text(Loc.T("tab.approvals"), 20, true));
        Root.Children.Add(Ui.Row(Ui.Btn(Loc.T("common.refresh"), () => _ = Reload(), "ghost")));
        _grid.Height = 480;
        Ui.OnOpen(_grid, Open);
        Root.Children.Add(_grid);
        Root.Children.Add(_empty);
    }

    public override async Task Reload() => await Safe(async () =>
    {
        var tk = await Api.I.Tasks();
        var ap = Api.I.Can("gov.view") ? (await Api.I.Records("gov", "approval")).Where(a => a.Status == "Pending").ToList() : new List<ErpRec>();
        var rows = new List<(string[], object)>();
        foreach (var t in tk) rows.Add((new[] { Loc.T("appr.workflow"), t.NodeName, t.Priority ?? "Normal", "Pending" }, t));
        foreach (var a in ap) rows.Add((new[] { Loc.T("appr.erp"), $"{a.Str("target")} {a.Str("code") ?? a.Code}", a.Str("requestedBy") ?? a.CreatedBy ?? "", a.Status ?? "" }, a));
        Ui.Fill(_grid, rows);
        _empty.Visibility = rows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    });

    private async void Open()
    {
        var sel = (_grid.SelectedItem as Ui.Row2)?.Payload;
        if (sel == null) return;
        var done = sel is WfTask t ? ApprovalDialog.Show(t, null) : ApprovalDialog.Show(null, (ErpRec)sel);
        if (done) await Reload();
    }
}

public static class ApprovalDialog
{
    public static bool Show(WfTask? task, ErpRec? appr)
    {
        var done = false;
        var title = task?.NodeName ?? $"{appr?.Str("target")} {appr?.Str("code") ?? appr?.Code}";
        var hasForm = task?.Form?["fields"] is JsonArray fa && fa.Count > 0;
        var w = Ui.Dialog(title, hasForm ? 520 : 460, hasForm ? 640 : 420, out var body);
        body.Children.Add(Ui.Text(title, 18, true));
        var canAct = true;
        if (appr != null)
        {
            body.Children.Add(Ui.Text($"{Loc.T("appr.amount")}: {appr.Str("amount") ?? appr.Data["amount"]?.ToString() ?? "-"}"));
            body.Children.Add(Ui.Text($"{Loc.T("appr.requestedBy")}: {appr.Str("requestedBy") ?? appr.CreatedBy}"));
            if (appr.Data["canAct"] is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<bool>(out var b) && !b) { canAct = false; body.Children.Add(Ui.Text(Loc.T("appr.cantAct"), 13, false, Ui.Danger)); }
        }
        TypedForm? form = null;
        if (hasForm && task != null)
        {
            if (!string.IsNullOrEmpty(task.Form!["title"]?.ToString())) body.Children.Add(Ui.Text(task.Form!["title"]!.ToString(), 13, false, Ui.Dim));
            form = new TypedForm(task.Form!);
            body.Children.Add(form);
            // pre-fill the step's form from the data already collected on this document
            if (!string.IsNullOrEmpty(task.InstanceId))
                w.Loaded += async (_, _) =>
                {
                    try { form.SetValues((await Api.I.WfInstance(task.InstanceId))["data"] as JsonObject); }
                    catch { /* the form simply starts empty */ }
                };
        }
        var comment = new TextBox { AcceptsReturn = true, Height = 70, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 8) };
        body.Children.Add(Ui.Labeled(Loc.T("appr.comment"), comment));
        var err = Ui.Text("", 13, false, Ui.Danger);
        body.Children.Add(err);
        var buttons = new List<Button>();
        var row = new WrapPanel();

        async void Act(Func<Task> call)
        {
            err.Text = "";
            foreach (var x in buttons) x.IsEnabled = false;
            try { await call(); done = true; w.Close(); }
            catch (Exception e) { err.Text = e.Message; foreach (var x in buttons) x.IsEnabled = true; }
        }

        if (task != null)
            foreach (var d in task.AvailableDecisions)
            {
                var dec = d;
                var bad = System.Text.RegularExpressions.Regex.IsMatch(dec, "reject|deny|decline", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                var btn = Ui.Btn(dec, () =>
                {
                    JsonObject? fd = null;
                    if (form != null)
                    {
                        if (!TypedForm.IsNegative(dec) && form.Missing().Count > 0) { err.Text = Loc.T("tasks.missing"); return; }
                        fd = form.Values();
                    }
                    Act(() => Api.I.CompleteTask(task.Id, dec, comment.Text, fd));
                }, bad ? "danger" : null);
                buttons.Add(btn); row.Children.Add(btn);
            }
        else if (appr != null)
        {
            var a = Ui.Btn(Loc.T("appr.approve"), () => Act(() => Api.I.ApprovalAct(appr.Id, "approve", comment.Text)));
            var r = Ui.Btn(Loc.T("appr.reject"), () => Act(() => Api.I.ApprovalAct(appr.Id, "reject", comment.Text)), "danger");
            a.IsEnabled = r.IsEnabled = canAct;
            buttons.Add(a); buttons.Add(r); row.Children.Add(a); row.Children.Add(r);
        }
        row.Children.Add(Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost"));
        body.Children.Add(row);
        w.ShowDialog();
        return Task.FromResult((done, follow));
    }
}

// ------------------------------------------------------------------------------------------------ documents
public sealed class DocumentsView : PageView
{
    private readonly System.Windows.Controls.DataGrid _grid = Ui.Grid(Loc.T("erp.name"), Loc.T("docs.status"), Loc.T("docs.when"));
    private readonly TextBlock _empty = Ui.Text(Loc.T("docs.none"), 13, false, Ui.Dim);

    public DocumentsView()
    {
        Root.Children.Add(Ui.Text(Loc.T("docs.title"), 20, true));
        Root.Children.Add(Ui.Row(Ui.Btn("+ " + Loc.T("docs.new"), New), Ui.Btn(Loc.T("common.refresh"), () => _ = Reload(), "ghost")));
        _grid.Height = 480;
        Ui.OnOpen(_grid, Open);
        Root.Children.Add(_grid);
        Root.Children.Add(_empty);
    }

    public override async Task Reload() => await Safe(async () =>
    {
        var list = await Api.I.Instances();
        Ui.Fill(_grid, list.Select(i => (new[] { i.DefinitionName, i.Status, i.StartedAt.Length >= 16 ? i.StartedAt[..16].Replace('T', ' ') : i.StartedAt }, (object)i)));
        _empty.Visibility = list.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    });

    private async void New()
    {
        await Safe(async () =>
        {
            var defs = await Api.I.Definitions();
            var (ok, follow) = await NewRequest(defs);
            if (ok)
            {
                // a flow that begins with a form step asks for it right away, like the portal's Submit screen
                if (follow != null) ApprovalDialog.Show(follow, null);
                await Reload();
            }
        });
    }

    private async void Open()
    {
        var sel = Ui.Selected<WfInstance>(_grid);
        if (sel == null) return;
        await Safe(async () =>
        {
            var full = await Api.I.Instance(sel.Id) ?? sel;
            if (Detail(full)) await Reload();
        });
    }

    private static bool Detail(WfInstance inst)
    {
        var changed = false;
        var w = Ui.Dialog(inst.DefinitionName, 600, 480, out var body);
        body.Children.Add(Ui.Text(inst.DefinitionName, 18, true));
        body.Children.Add(Ui.Text($"{Loc.T("docs.status")}: {inst.Status}"));
        body.Children.Add(Ui.Text(Loc.T("docs.history"), 15, true));
        var g = Ui.Grid(Loc.T("erp.name"), Loc.T("docs.status"), Loc.T("appr.requestedBy"), Loc.T("appr.comment"));
        g.Height = 250;
        Ui.Fill(g, inst.History.Select(h => (new[] { h.NodeName, h.Action, h.Actor ?? "", h.Comment ?? "" }, (object)h)));
        body.Children.Add(g);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 0) };
        if (inst.Status == "Running")
            row.Children.Add(Ui.Btn(Loc.T("docs.cancel"), async () =>
            {
                if (!Ui.Ask(Loc.T("docs.cancel") + "?", Loc.T("common.yes"), Loc.T("common.no"))) return;
                try { await Api.I.CancelInstance(inst.Id); changed = true; w.Close(); }
                catch (Exception e) { Ui.Warn(e.Message); }
            }, "danger"));
        row.Children.Add(Ui.Btn(Loc.T("common.close"), () => w.Close(), "ghost"));
        body.Children.Add(row);
        w.ShowDialog();
        return changed;
    }

    private static Task<(bool, WfTask?)> NewRequest(List<WfDefinition> defs)
    {
        var done = false;
        WfTask? follow = null;
        var w = Ui.Dialog(Loc.T("docs.choose"), 440, 340, out var body);
        body.Children.Add(Ui.Text(Loc.T("docs.choose"), 18, true));
        var combo = new ComboBox { ItemsSource = defs, DisplayMemberPath = nameof(WfDefinition.Name), SelectedIndex = defs.Count > 0 ? 0 : -1, Margin = new Thickness(0, 6, 0, 8) };
        body.Children.Add(combo);
        var note = new TextBox { AcceptsReturn = true, Height = 70, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 8) };
        body.Children.Add(Ui.Labeled(Loc.T("appr.comment"), note));
        var err = Ui.Text("", 13, false, Ui.Danger);
        body.Children.Add(err);
        body.Children.Add(Ui.Row(
            Ui.Btn(Loc.T("docs.start"), async () =>
            {
                if (combo.SelectedItem is not WfDefinition d) return;
                err.Text = "";
                try
                {
                    var data = new Dictionary<string, object>();
                    if (!string.IsNullOrWhiteSpace(note.Text)) data["note"] = note.Text.Trim();
                    var inst = await Api.I.StartInstance(d.Id, data);
                    var iid = inst?["id"]?.ToString();
                    try
                    {
                        if (!string.IsNullOrEmpty(iid))
                            follow = (await Api.I.Tasks()).FirstOrDefault(tk => tk.InstanceId == iid && tk.Form?["fields"] is JsonArray fl && fl.Count > 0);
                    }
                    catch { /* no follow-up form */ }
                    done = true; w.Close();
                }
                catch (Exception e) { err.Text = e.Message; }
            }),
            Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog();
        return done;
    }
}
