using WorkflowErp.Services;

namespace WorkflowErp.Pages;

public class HomePage : ListPage
{
    private readonly Action<int> _goTab;
    public HomePage(Action<int> goTab) { _goTab = goTab; Title = Loc.T("tab.home"); }

    protected override async Task Reload()
    {
        var api = Api.I;
        var tk = await api.Tasks().ContinueWith(t => t.IsCompletedSuccessfully ? t.Result : new List<WfTask>());
        var ap = api.Can("gov.view") ? await api.Records("gov", "approval").ContinueWith(t => t.IsCompletedSuccessfully ? t.Result : new List<ErpRec>()) : new List<ErpRec>();
        var dc = await api.Instances().ContinueWith(t => t.IsCompletedSuccessfully ? t.Result : new List<WfInstance>());
        var canAct = ap.Count(a => a.Status == "Pending" && a.Data["canAct"] is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<bool>(out var b) && b);

        Body.Children.Clear();
        Body.Children.Add(new Label { Text = Loc.T("home.hello", ("name", api.Session?.DisplayName ?? "")), FontSize = 22, FontAttributes = FontAttributes.Bold, TextColor = Ui.Ink, Margin = new Thickness(14, 8) });
        View Stat(int n, string label, int tab) => Ui.Card(new VerticalStackLayout { Children = { new Label { Text = n.ToString(), FontSize = 30, FontAttributes = FontAttributes.Bold, TextColor = Ui.Primary }, new Label { Text = label, TextColor = Ui.Dim } } }, () => _goTab(tab));
        Body.Children.Add(Stat(tk.Count, Loc.T("home.pendingTasks"), 1));
        Body.Children.Add(Stat(canAct, Loc.T("home.pendingApprovals"), 1));
        Body.Children.Add(Stat(dc.Count, Loc.T("home.myDocs"), 2));
        Body.Children.Add(new Label { Text = Loc.T("home.modules"), FontAttributes = FontAttributes.Bold, TextColor = Ui.Ink, Margin = new Thickness(14, 14, 14, 0) });
        foreach (var m in Loc.VisibleModules())
        {
            var mod = m;
            Body.Children.Add(Ui.Card(new Label { Text = mod.Name(Loc.Rtl), FontAttributes = FontAttributes.Bold, TextColor = Ui.Ink }, () => _ = Navigation.PushAsync(new ErpKindsPage(mod))));
        }
    }
}
