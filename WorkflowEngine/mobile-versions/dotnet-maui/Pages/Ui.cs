using WorkflowErp.Services;

namespace WorkflowErp.Pages;

public static class Ui
{
    public static readonly Color Primary = Color.FromArgb("#2563EB");
    public static readonly Color Dim = Color.FromArgb("#64748B");
    public static readonly Color Bg = Color.FromArgb("#F4F6FA");
    public static readonly Color Danger = Color.FromArgb("#DC2626");
    public static readonly Color Ok = Color.FromArgb("#16A34A");
    public static readonly Color Line = Color.FromArgb("#E2E8F0");
    public static readonly Color Ink = Color.FromArgb("#0F172A");

    public static Color StatusColor(string? st) => st switch
    {
        "Approved" or "Active" or "Completed" or "Posted" or "Paid" => Ok,
        "Rejected" or "Cancelled" or "Terminated" or "Expired" => Danger,
        "Pending" or "Draft" or "Running" => Color.FromArgb("#D97706"),
        _ => Primary
    };

    public static Label Text(string text, double size = 14, bool bold = false, Color? color = null) => new()
    {
        Text = text, FontSize = size, FontAttributes = bold ? FontAttributes.Bold : FontAttributes.None, TextColor = color ?? Ink
    };

    public static View Chip(string text, Color? color = null)
    {
        var c = color ?? Primary;
        return new Border
        {
            BackgroundColor = c.WithAlpha(0.14f), StrokeThickness = 0, StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 99 },
            Padding = new Thickness(8, 3), HorizontalOptions = LayoutOptions.Start, VerticalOptions = LayoutOptions.Center,
            Content = new Label { Text = text, FontSize = 12, FontAttributes = FontAttributes.Bold, TextColor = c }
        };
    }

    public static Border Card(View content, Action? onTap = null)
    {
        var b = new Border
        {
            BackgroundColor = Colors.White, Stroke = Line, StrokeThickness = 1, Padding = 14, Margin = new Thickness(14, 5),
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 12 }, Content = content
        };
        if (onTap != null) b.GestureRecognizers.Add(new TapGestureRecognizer { Command = new Command(onTap) });
        return b;
    }

    public static Button Btn(string text, Action onClick, bool danger = false, bool ghost = false)
    {
        var b = new Button
        {
            Text = text, Margin = new Thickness(14, 4), CornerRadius = 10,
            BackgroundColor = ghost ? Colors.Transparent : (danger ? Danger : Primary),
            TextColor = ghost ? Primary : Colors.White, BorderColor = Primary, BorderWidth = ghost ? 1 : 0
        };
        b.Clicked += (_, _) => onClick();
        return b;
    }

    public static Entry Input(string placeholder, string text = "", bool password = false, bool enabled = true) => new()
    {
        Placeholder = placeholder, Text = text, IsPassword = password, IsEnabled = enabled, TextColor = Ink, PlaceholderColor = Dim,
        HorizontalTextAlignment = Loc.Rtl ? TextAlignment.End : TextAlignment.Start
    };

    public static View Labeled(string label, View input) => new VerticalStackLayout
    {
        Spacing = 2, Margin = new Thickness(14, 4), Children = { new Label { Text = label, FontSize = 12, TextColor = Dim }, input }
    };

    public static Label Empty(string text) => new()
    {
        Text = text, TextColor = Dim, HorizontalTextAlignment = TextAlignment.Center, Margin = new Thickness(24, 40)
    };
}

/// <summary>A pull-to-refresh page that rebuilds its content every time it appears.</summary>
public abstract class ListPage : ContentPage
{
    protected readonly VerticalStackLayout Body = new() { Spacing = 0, Padding = new Thickness(0, 8, 0, 90) };
    private readonly RefreshView _refresh;

    protected ListPage()
    {
        BackgroundColor = Ui.Bg;
        FlowDirection = Loc.Flow;
        _refresh = new RefreshView { Content = new ScrollView { Content = Body } };
        _refresh.Refreshing += async (_, _) => { await SafeReload(); _refresh.IsRefreshing = false; };
        Content = _refresh;
    }

    protected abstract Task Reload();

    protected async Task SafeReload()
    {
        try { await Reload(); }
        catch (Exception e) { Body.Children.Clear(); Body.Children.Add(new Label { Text = e.Message, TextColor = Ui.Danger, Margin = 14 }); }
    }

    protected override async void OnAppearing() { base.OnAppearing(); await SafeReload(); }
}
