using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>The ERP assistant: questions go to POST api/assistant/chat, which answers from the live data this user may see.</summary>
public sealed class ChatView : PageView
{
    private readonly Action<string, string> _open;
    private readonly StackPanel _log = new() { Margin = new Thickness(0, 8, 0, 8) };
    private readonly ScrollViewer _scroll;
    private readonly WrapPanel _sugs = new() { Margin = new Thickness(0, 4, 0, 4) };
    private readonly TextBox _input = new() { Padding = new Thickness(8), VerticalContentAlignment = VerticalAlignment.Center };
    private readonly Button _send;
    private readonly List<ChatTurn> _history = new();
    private bool _busy;

    public ChatView(Action<string, string> open)
    {
        _open = open;
        _scroll = new ScrollViewer { Content = _log, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        _send = Ui.Btn(Loc.T("chat.send"), () => _ = Ask(_input.Text));
        _send.Margin = new Thickness(8, 0, 0, 0);
        _input.KeyDown += (_, e) => { if (e.Key == Key.Enter) _ = Ask(_input.Text); };

        var bottom = new DockPanel { Margin = new Thickness(0, 4, 0, 0) };
        DockPanel.SetDock(_send, Dock.Right);
        bottom.Children.Add(_send);
        bottom.Children.Add(_input);

        var title = Ui.Text(Loc.T("chat.title"), 20, true);
        var layout = new DockPanel { Margin = new Thickness(20, 16, 20, 16), LastChildFill = true };
        DockPanel.SetDock(title, Dock.Top);
        DockPanel.SetDock(bottom, Dock.Bottom);
        DockPanel.SetDock(_sugs, Dock.Bottom);
        layout.Children.Add(title);
        layout.Children.Add(bottom);
        layout.Children.Add(_sugs);
        layout.Children.Add(_scroll);
        Content = layout;
        AddBubble(false, Loc.T("chat.greet"), null);
    }

    public override Task Reload() { _input.Focus(); return Task.CompletedTask; }

    private FrameworkElement AddBubble(bool mine, string text, List<ChatAction>? actions)
    {
        var inner = new StackPanel();
        inner.Children.Add(new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, Foreground = Ui.Ink, FontSize = 13 });
        if (actions != null && actions.Count > 0)
        {
            var row = new WrapPanel { Margin = new Thickness(0, 8, 0, 0) };
            foreach (var a in actions)
            {
                var act = a;
                row.Children.Add(Ui.Btn(act.Label + " ›", () => _open(act.Module, act.Kind), "ghost"));
            }
            inner.Children.Add(row);
        }
        var bubble = new Border
        {
            Child = inner, Padding = new Thickness(12, 8, 12, 8), Margin = new Thickness(0, 0, 0, 8), CornerRadius = new CornerRadius(10),
            MaxWidth = 620, HorizontalAlignment = mine ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            Background = mine ? new SolidColorBrush(Color.FromRgb(0xDB, 0xEA, 0xFE)) : Brushes.White,
            BorderBrush = new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0)), BorderThickness = new Thickness(1)
        };
        _log.Children.Add(bubble);
        _scroll.ScrollToEnd();
        return bubble;
    }

    private async Task Ask(string? text)
    {
        var q = (text ?? "").Trim();
        if (q.Length == 0 || _busy) return;
        _busy = true; _send.IsEnabled = false;
        var past = _history.TakeLast(6).ToList();
        _history.Add(new ChatTurn { From = "user", Text = q });
        _input.Text = "";
        AddBubble(true, q, null);
        var thinking = AddBubble(false, Loc.T("chat.thinking"), null);
        try
        {
            var r = await Api.I.Chat(q, Loc.Lang, past);
            _log.Children.Remove(thinking);
            AddBubble(false, r.Reply, r.Actions);
            _history.Add(new ChatTurn { From = "ai", Text = r.Reply });
            _sugs.Children.Clear();
            foreach (var s in r.Suggestions)
            {
                var sug = s;
                _sugs.Children.Add(Ui.Btn(sug, () => _ = Ask(sug), "ghost"));
            }
        }
        catch
        {
            _log.Children.Remove(thinking);
            AddBubble(false, Loc.T("chat.error"), null);
        }
        _busy = false; _send.IsEnabled = true;
    }
}
