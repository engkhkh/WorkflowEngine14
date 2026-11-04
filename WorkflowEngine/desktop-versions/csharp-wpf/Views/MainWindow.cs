using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

public sealed class MainWindow : Window
{
    private readonly ListBox _nav = new();
    private readonly ContentControl _host = new();
    private readonly PageView[] _pages;
    private readonly ErpView _erp = new();

    public MainWindow(Action relaunch)
    {
        Title = $"{Loc.T("app.title")} — {Api.I.Session?.DisplayName}";
        Width = 1240; Height = 780; Background = Ui.Bg; FlowDirection = Loc.Flow;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        _pages = new PageView[]
        {
            new DashboardView(Go, (m, k) => { Go(4); _erp.Select(m, k); }),
            new ApprovalsView(), new DocumentsView(), new ReportsView(), _erp,
            new ChatView((m, k) => { if (m == "gov" && k == "approval") Go(1); else { Go(4); _erp.Select(m, k); } }),
            new WorkflowView(), new MuslimView(), new PosView(), new HospitalView(), new CalendarView(), new FinanceView(), new HrView(), new OpsView(), new SiteView(), new CustomView(), new AdminView(), new ActionsView(),
            new SettingsView(l => { if (Loc.Lang != l) { Loc.SetLang(l); relaunch(); } }, () => { Api.I.SignOut(); relaunch(); })
        };

        _nav.Background = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A));
        _nav.BorderThickness = new Thickness(0);
        _nav.Width = 190;
        foreach (var k in new[] { "tab.home", "tab.approvals", "tab.documents", "tab.reports", "tab.erp", "tab.chat", "tab.workflow", "tab.muslim", "tab.pos", "tab.hos", "tab.cal", "tab.fin", "tab.hr", "tab.ops", "tab.web", "tab.cus", "tab.adm", "tab.act", "tab.more" })
            _nav.Items.Add(new ListBoxItem { Content = Loc.T(k), Foreground = Brushes.White, Padding = new Thickness(16, 12, 16, 12), FontSize = 14 });
        _nav.SelectionChanged += async (_, _) =>
        {
            var i = _nav.SelectedIndex;
            if (i < 0) return;
            _host.Content = _pages[i] is ChatView ? _pages[i] : new ScrollViewer { Content = _pages[i], VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            try { await _pages[i].Reload(); } catch (Exception e) { Ui.Warn(e.Message); }
        };

        var dock = new DockPanel();
        DockPanel.SetDock(_nav, Dock.Left);
        dock.Children.Add(_nav);
        dock.Children.Add(_host);
        Content = dock;
        Loaded += (_, _) => _nav.SelectedIndex = 0;
    }

    private void Go(int i) => _nav.SelectedIndex = i;
}
