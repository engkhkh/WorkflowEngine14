using WorkflowErp.Services;

namespace WorkflowErp.Pages;

public class MorePage : ListPage
{
    private readonly Action _onLangChanged;
    public MorePage(Action onLangChanged) { _onLangChanged = onLangChanged; Title = Loc.T("tab.more"); }

    protected override Task Reload()
    {
        var s = Api.I.Session;
        Body.Children.Clear();
        Body.Children.Add(Ui.Card(new VerticalStackLayout
        {
            Spacing = 2,
            Children = { Ui.Text(Loc.T("more.signedInAs"), 12, false, Ui.Dim), Ui.Text(s?.DisplayName ?? "", 17, true), Ui.Text($"{s?.Username} · {s?.Role}", 13, false, Ui.Dim) }
        }));
        if (!string.IsNullOrEmpty(s?.TenantName)) Body.Children.Add(Ui.Card(Ui.Text($"{Loc.T("more.workspace")}: {s!.TenantName}")));
        var row = new HorizontalStackLayout { Spacing = 8 };
        row.Children.Add(Ui.Btn("English", () => Switch("en"), ghost: Loc.Lang != "en"));
        row.Children.Add(Ui.Btn("العربية", () => Switch("ar"), ghost: Loc.Lang != "ar"));
        Body.Children.Add(Ui.Card(new VerticalStackLayout { Children = { Ui.Text(Loc.T("more.language"), 12, false, Ui.Dim), row } }));
        Body.Children.Add(Ui.Card(new VerticalStackLayout { Children = { Ui.Text(Loc.T("more.server"), 12, false, Ui.Dim), Ui.Text(s?.Server ?? "") } }));
        Body.Children.Add(Ui.Btn(Loc.T("more.signout"), () => Api.I.SignOut(), danger: true));
        return Task.CompletedTask;
    }

    private void Switch(string l) { if (Loc.Lang == l) return; Loc.SetLang(l); _onLangChanged(); }
}
