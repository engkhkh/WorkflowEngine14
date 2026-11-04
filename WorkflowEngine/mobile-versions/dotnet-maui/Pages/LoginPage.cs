using WorkflowErp.Services;

namespace WorkflowErp.Pages;

public class LoginPage : ContentPage
{
    public LoginPage(Action onDone)
    {
        BackgroundColor = Ui.Bg;
        FlowDirection = Loc.Flow;
        var server = Ui.Input(Loc.T("login.server"), Api.DefaultServer);
        server.Keyboard = Keyboard.Url;
        var user = Ui.Input(Loc.T("login.user"));
        var pass = Ui.Input(Loc.T("login.pass"), password: true);
        var err = new Label { TextColor = Ui.Danger, Margin = new Thickness(14, 4) };
        var busy = new ActivityIndicator { IsRunning = false, Color = Ui.Primary };

        async void Go()
        {
            err.Text = ""; busy.IsRunning = true;
            try { await Api.I.Login(server.Text ?? "", (user.Text ?? "").Trim(), pass.Text ?? ""); onDone(); }
            catch { err.Text = Loc.T("login.failed"); }
            finally { busy.IsRunning = false; }
        }
        pass.Completed += (_, _) => Go();

        Content = new ScrollView
        {
            Content = new VerticalStackLayout
            {
                Padding = new Thickness(10, 80, 10, 20), Spacing = 6,
                Children =
                {
                    new Label { Text = Loc.T("app.name"), FontSize = 28, FontAttributes = FontAttributes.Bold, TextColor = Ui.Ink, Margin = new Thickness(14, 0) },
                    new Label { Text = Loc.T("login.title"), TextColor = Ui.Dim, Margin = new Thickness(14, 0, 14, 20) },
                    Ui.Labeled(Loc.T("login.server"), server), Ui.Labeled(Loc.T("login.user"), user), Ui.Labeled(Loc.T("login.pass"), pass),
                    err, busy, Ui.Btn(Loc.T("login.signin"), Go)
                }
            }
        };
    }
}
