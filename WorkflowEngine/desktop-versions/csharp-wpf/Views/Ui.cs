using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

public static class Ui
{
    public static readonly Brush Primary = new SolidColorBrush(Color.FromRgb(0x25, 0x63, 0xEB));
    public static readonly Brush Danger = new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26));
    public static readonly Brush Dim = new SolidColorBrush(Color.FromRgb(0x64, 0x74, 0x8B));
    public static readonly Brush Bg = new SolidColorBrush(Color.FromRgb(0xF4, 0xF6, 0xFA));
    public static readonly Brush Ink = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A));

    public static TextBlock Text(string text, double size = 13, bool bold = false, Brush? color = null) => new()
    {
        Text = text, FontSize = size, FontWeight = bold ? FontWeights.Bold : FontWeights.Normal, Foreground = color ?? Ink, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 2)
    };

    public static Button Btn(string text, Action onClick, string? kind = null)
    {
        var ghost = kind == "ghost";
        var b = new Button
        {
            Content = text, Padding = new Thickness(14, 6, 14, 6), Margin = new Thickness(0, 0, 8, 0), Cursor = System.Windows.Input.Cursors.Hand,
            Background = ghost ? Brushes.White : kind == "danger" ? Danger : Primary,
            Foreground = ghost ? Primary : Brushes.White, BorderBrush = Primary, BorderThickness = new Thickness(ghost ? 1 : 0)
        };
        b.Click += (_, _) => onClick();
        return b;
    }

    public static StackPanel Row(params UIElement[] items)
    {
        var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 4) };
        foreach (var i in items) p.Children.Add(i);
        return p;
    }

    public sealed class Row2
    {
        public string[] Cells { get; set; } = Array.Empty<string>();
        public object? Payload { get; set; }
        public string this[int i] => i < Cells.Length ? Cells[i] : "";
    }

    public static DataGrid Grid(params string[] headers)
    {
        var g = new DataGrid
        {
            AutoGenerateColumns = false, IsReadOnly = true, SelectionMode = DataGridSelectionMode.Single, HeadersVisibility = DataGridHeadersVisibility.Column,
            GridLinesVisibility = DataGridGridLinesVisibility.Horizontal, CanUserAddRows = false, Background = Brushes.White, RowHeight = 28,
            AlternatingRowBackground = new SolidColorBrush(Color.FromRgb(0xF8, 0xFA, 0xFC))
        };
        for (var i = 0; i < headers.Length; i++)
            g.Columns.Add(new DataGridTextColumn { Header = headers[i], Binding = new Binding($"[{i}]"), Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        return g;
    }

    public static void Fill(DataGrid g, IEnumerable<(string[] cells, object payload)> rows)
        => g.ItemsSource = rows.Select(r => new Row2 { Cells = r.cells, Payload = r.payload }).ToList();

    public static T? Selected<T>(DataGrid g) where T : class => (g.SelectedItem as Row2)?.Payload as T;

    public static void OnOpen(DataGrid g, Action a) => g.MouseDoubleClick += (_, _) => { if (g.SelectedItem != null) a(); };

    public static void Warn(string text) => MessageBox.Show(text, "", MessageBoxButton.OK, MessageBoxImage.Warning);

    public static bool Ask(string text, string yes, string no)
    {
        var r = false;
        var w = Dialog(text, 360, 150, out var body);
        body.Children.Add(Row(Btn(yes, () => { r = true; w.Close(); }, "danger"), Btn(no, () => w.Close(), "ghost")));
        w.ShowDialog();
        return r;
    }

    /// <summary>A modal window with a padded vertical body.</summary>
    public static Window Dialog(string title, double width, double height, out StackPanel body)
    {
        body = new StackPanel { Margin = new Thickness(16) };
        var w = new Window
        {
            Title = title, Width = width, Height = height, WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = Bg, FlowDirection = Loc.Flow,
            Owner = Application.Current.Windows.OfType<Window>().FirstOrDefault(x => x.IsActive) ?? Application.Current.MainWindow,
            Content = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }
        };
        return w;
    }

    public static TextBox Input(string text = "", bool enabled = true) => new() { Text = text, IsEnabled = enabled, Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8) };

    public static StackPanel Labeled(string label, UIElement input)
    {
        var p = new StackPanel();
        p.Children.Add(Text(label, 12, false, Dim));
        p.Children.Add(input);
        return p;
    }

    public static Brush StatusBrush(string? st) => st switch
    {
        "Approved" or "Active" or "Completed" or "Posted" or "Paid" => new SolidColorBrush(Color.FromRgb(0x16, 0xA3, 0x4A)),
        "Rejected" or "Cancelled" or "Terminated" or "Expired" => Danger,
        "Pending" or "Draft" or "Running" => new SolidColorBrush(Color.FromRgb(0xD9, 0x77, 0x06)),
        _ => Primary
    };
}

/// <summary>A page that reloads whenever it is shown.</summary>
public abstract class PageView : UserControl
{
    protected readonly StackPanel Root = new() { Margin = new Thickness(20, 16, 20, 16) };

    protected PageView() { Content = Root; }

    public abstract Task Reload();

    protected async Task Safe(Func<Task> work)
    {
        try { await work(); }
        catch (Exception e) { Ui.Warn(e.Message); }
    }
}
