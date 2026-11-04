using System.Windows;
using WorkflowErp.Services;
using WorkflowErp.Views;

namespace WorkflowErp;

public static class Program
{
    [STAThread]
    public static void Main()
    {
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        // Show every unexpected error (and keep a copy in %APPDATA%\WorkflowErpWpf\error.log) instead of closing silently.
        app.DispatcherUnhandledException += (_, e) => { Report(e.Exception); e.Handled = true; };
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Report(e.ExceptionObject as Exception);
        app.Startup += async (_, _) =>
        {
            try
            {
                Loc.Init();
                Api.I.Load();
                if (Api.I.Session != null) await Api.I.RefreshMe();
            }
            catch (Exception e) { Report(e); app.Shutdown(); return; }
            ShowRoot(app);
        };
        app.Run();
    }

    private static void Report(Exception? e)
    {
        var text = e?.ToString() ?? "Unknown error";
        try
        {
            var dir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WorkflowErpWpf");
            System.IO.Directory.CreateDirectory(dir);
            System.IO.File.AppendAllText(System.IO.Path.Combine(dir, "error.log"), DateTime.Now + "\r\n" + text + "\r\n\r\n");
        }
        catch { /* the message box below still shows it */ }
        MessageBox.Show((e?.Message ?? "Unknown error") + "\n\n" + text, "Workflow ERP", MessageBoxButton.OK, MessageBoxImage.Error);
    }

    /// <summary>The login window when signed out, otherwise the main window. Called again after a language change or sign-out.</summary>
    private static void ShowRoot(Application app)
    {
        if (Api.I.Session == null)
        {
            var login = new LoginWindow();
            login.ShowDialog();
            if (!login.Ok) { app.Shutdown(); return; }
        }
        var main = new MainWindow(() => { var old = app.MainWindow; app.MainWindow = null; old?.Close(); ShowRoot(app); });
        app.MainWindow = main;
        main.Closed += (_, _) => { if (app.MainWindow == main) app.Shutdown(); };   // closing the window ends the program (a relaunch clears MainWindow first)
        main.Show();
    }
}
