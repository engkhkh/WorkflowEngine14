using WorkflowErp.Services;

namespace WorkflowErp.Pages;

public class ApprovalsPage : ListPage
{
    public ApprovalsPage() { Title = Loc.T("tab.approvals"); }

    protected override async Task Reload()
    {
        var api = Api.I;
        var tk = await api.Tasks().ContinueWith(t => t.IsCompletedSuccessfully ? t.Result : new List<WfTask>());
        var ap = api.Can("gov.view") ? await api.Records("gov", "approval").ContinueWith(t => t.IsCompletedSuccessfully ? t.Result : new List<ErpRec>()) : new List<ErpRec>();
        ap = ap.Where(a => a.Status == "Pending").ToList();

        Body.Children.Clear();
        if (tk.Count == 0 && ap.Count == 0) Body.Children.Add(Ui.Empty(Loc.T("appr.none")));
        foreach (var t in tk)
        {
            var task = t;
            Body.Children.Add(Ui.Card(new VerticalStackLayout
            {
                Spacing = 4,
                Children = { Ui.Text(task.NodeName, 15, true), Ui.Text(task.Priority ?? "Normal", 13, false, Ui.Dim), Ui.Chip(Loc.T("appr.workflow")) }
            }, () => _ = Navigation.PushAsync(new ApprovalActPage(task, null))));
        }
        foreach (var a in ap)
        {
            var rec = a;
            Body.Children.Add(Ui.Card(new VerticalStackLayout
            {
                Spacing = 4,
                Children =
                {
                    Ui.Text($"{rec.Str("target")} {rec.Str("code") ?? rec.Code}", 15, true),
                    Ui.Text($"{Loc.T("appr.requestedBy")}: {rec.Str("requestedBy") ?? rec.CreatedBy}", 13, false, Ui.Dim),
                    Ui.Chip(Loc.T("appr.erp"), Color.FromArgb("#7C3AED"))
                }
            }, () => _ = Navigation.PushAsync(new ApprovalActPage(null, rec))));
        }
    }
}

public class ApprovalActPage : ContentPage
{
    public ApprovalActPage(WfTask? task, ErpRec? appr)
    {
        BackgroundColor = Ui.Bg;
        FlowDirection = Loc.Flow;
        Title = task?.NodeName ?? $"{appr?.Str("target")} {appr?.Str("code") ?? appr?.Code}";
        var comment = new Editor { Placeholder = Loc.T("appr.comment"), AutoSize = EditorAutoSizeOption.TextChanges, TextColor = Ui.Ink };
        var err = new Label { TextColor = Ui.Danger, Margin = new Thickness(14, 4) };
        var stack = new VerticalStackLayout { Spacing = 4, Padding = new Thickness(0, 12) };

        if (appr != null)
        {
            stack.Children.Add(Ui.Card(new VerticalStackLayout
            {
                Spacing = 4,
                Children =
                {
                    Ui.Text($"{Loc.T("appr.amount")}: {appr.Str("amount") ?? appr.Data["amount"]?.ToString() ?? "-"}"),
                    Ui.Text($"{Loc.T("appr.requestedBy")}: {appr.Str("requestedBy") ?? appr.CreatedBy}"),
                }
            }));
        }
        stack.Children.Add(Ui.Labeled(Loc.T("appr.comment"), comment));
        stack.Children.Add(err);

        async void Act(Func<Task> call)
        {
            err.Text = "";
            try { await call(); await Navigation.PopAsync(); }
            catch (Exception e) { err.Text = e.Message; }
        }
        if (task != null)
        {
            foreach (var d in task.AvailableDecisions)
            {
                var dec = d;
                var bad = System.Text.RegularExpressions.Regex.IsMatch(dec, "reject|deny|decline", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                stack.Children.Add(Ui.Btn(dec, () => Act(() => Api.I.CompleteTask(task.Id, dec, comment.Text ?? "")), danger: bad));
            }
        }
        else if (appr != null)
        {
            stack.Children.Add(Ui.Btn(Loc.T("appr.approve"), () => Act(() => Api.I.ApprovalAct(appr.Id, "approve", comment.Text ?? ""))));
            stack.Children.Add(Ui.Btn(Loc.T("appr.reject"), () => Act(() => Api.I.ApprovalAct(appr.Id, "reject", comment.Text ?? "")), danger: true));
        }
        Content = new ScrollView { Content = stack };
    }
}
