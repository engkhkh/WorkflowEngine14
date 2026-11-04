using WorkflowErp.Pages;
using WorkflowErp.Services;

namespace WorkflowErp;

public class App : Application
{
    public App()
    {
        MainPage = new ContentPage { Content = new ActivityIndicator { IsRunning = true, VerticalOptions = LayoutOptions.Center } };
        Api.I.SignedOut += () => MainThread.BeginInvokeOnMainThread(ShowRoot);
        _ = Start();
    }

    private async Task Start()
    {
        try
        {
            await Loc.Init();
            Api.I.Load();
            if (Api.I.Session != null) await Api.I.RefreshMe();
        }
        catch (Exception e) { MainPage = new ContentPage { Content = new Label { Text = e.Message, Margin = 20 } }; return; }
        MainThread.BeginInvokeOnMainThread(ShowRoot);
    }

    private void ShowRoot() => MainPage = Api.I.Session == null ? new LoginPage(ShowRoot) : BuildTabs();

    private TabbedPage BuildTabs()
    {
        TabbedPage? tabs = null;
        void Go(int i) { if (tabs != null) tabs.CurrentPage = tabs.Children[i]; }
        tabs = new TabbedPage { FlowDirection = Loc.Flow, BarBackgroundColor = Colors.White, SelectedTabColor = Ui.Primary };
        tabs.Children.Add(new NavigationPage(new HomePage(Go)) { Title = Loc.T("tab.home") });
        tabs.Children.Add(new NavigationPage(new ApprovalsPage()) { Title = Loc.T("tab.approvals") });
        tabs.Children.Add(new NavigationPage(new DocumentsPage()) { Title = Loc.T("tab.documents") });
        tabs.Children.Add(new NavigationPage(new ErpModulesPage()) { Title = Loc.T("tab.erp") });
        tabs.Children.Add(new NavigationPage(new ChatPage()) { Title = Loc.T("tab.chat") });
        tabs.Children.Add(new NavigationPage(new MorePage(ShowRoot)) { Title = Loc.T("tab.more") });
        return tabs;
    }
}
