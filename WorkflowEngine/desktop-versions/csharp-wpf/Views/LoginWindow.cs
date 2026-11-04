using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

public sealed class LoginWindow : Window
{
    public bool Ok { get; private set; }

    public LoginWindow()
    {
        Title = Loc.T("app.title");
        Width = 420; Height = 440; ResizeMode = ResizeMode.NoResize; Background = Ui.Bg; FlowDirection = Loc.Flow;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        var server = Ui.Input(Api.DefaultServer);
        var user = Ui.Input();
        var pass = new PasswordBox { Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8) };
        var err = Ui.Text("", 13, false, Ui.Danger);
        Button? go = null;

        async void Do()
        {
            err.Text = "";
            go!.IsEnabled = false;
            try { await Api.I.Login(server.Text, user.Text.Trim(), pass.Password); Ok = true; Close(); }
            catch { err.Text = Loc.T("login.failed"); go.IsEnabled = true; }
        }
        go = Ui.Btn(Loc.T("login.signin"), Do);
        go.Margin = new Thickness(0);
        pass.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) Do(); };

        var body = new StackPanel { Margin = new Thickness(24) };
        body.Children.Add(Ui.Text(Loc.T("app.name"), 26, true));
        body.Children.Add(Ui.Text(Loc.T("login.title"), 13, false, Ui.Dim));
        body.Children.Add(new Border { Height = 14 });
        body.Children.Add(Ui.Labeled(Loc.T("login.server"), server));
        body.Children.Add(Ui.Labeled(Loc.T("login.user"), user));
        body.Children.Add(Ui.Labeled(Loc.T("login.pass"), pass));
        body.Children.Add(err);
        body.Children.Add(go);
        Content = body;
    }
}
