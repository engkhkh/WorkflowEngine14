using WorkflowErp.Services;

namespace WorkflowErp.Pages;

/// <summary>The ERP assistant: ask in plain words, get answers from the live data this user may see, with buttons that open the matching list.</summary>
public class ChatPage : ContentPage
{
    private readonly VerticalStackLayout _log = new() { Spacing = 8, Padding = new Thickness(12) };
    private readonly ScrollView _scroll;
    private readonly HorizontalStackLayout _sugs = new() { Spacing = 6, Padding = new Thickness(10, 4) };
    private readonly Entry _input;
    private readonly Button _send;
    private readonly List<ChatTurn> _history = new();
    private bool _busy;

    public ChatPage()
    {
        Title = Loc.T("tab.chat");
        BackgroundColor = Ui.Bg;
        FlowDirection = Loc.Flow;
        _scroll = new ScrollView { Content = _log };
        _input = new Entry { Placeholder = Loc.T("chat.placeholder"), TextColor = Ui.Ink, HorizontalOptions = LayoutOptions.Fill, ReturnType = ReturnType.Send };
        _input.Completed += (_, _) => _ = Ask(_input.Text);
        _send = Ui.Btn(Loc.T("chat.send"), () => _ = Ask(_input.Text));
        var bar = new Grid { Padding = new Thickness(10, 6), ColumnSpacing = 8, ColumnDefinitions = { new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto) } };
        bar.Add(_input, 0); bar.Add(_send, 1);
        var grid = new Grid { RowDefinitions = { new RowDefinition(GridLength.Star), new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto) } };
        grid.Add(_scroll, 0, 0);
        grid.Add(new ScrollView { Orientation = ScrollOrientation.Horizontal, Content = _sugs }, 0, 1);
        grid.Add(bar, 0, 2);
        Content = grid;
        AddBubble(false, Loc.T("chat.greet"), null);
    }

    private void AddBubble(bool mine, string text, List<ChatAction>? actions)
    {
        var inner = new VerticalStackLayout { Spacing = 6 };
        inner.Children.Add(new Label { Text = text, TextColor = mine ? Colors.White : Ui.Ink, FontSize = 14 });
        if (actions != null && actions.Count > 0)
        {
            var wrap = new FlexLayout { Wrap = Microsoft.Maui.Layouts.FlexWrap.Wrap };
            foreach (var a in actions)
            {
                var act = a;
                var b = new Button { Text = act.Label + " ›", FontSize = 12, Padding = new Thickness(10, 2), Margin = new Thickness(0, 0, 6, 4), BackgroundColor = Colors.Transparent, TextColor = Ui.Primary, BorderColor = Ui.Primary, BorderWidth = 1, CornerRadius = 14, HeightRequest = 30 };
                b.Clicked += (_, _) => _ = Open(act);
                wrap.Children.Add(b);
            }
            inner.Children.Add(wrap);
        }
        var bubble = new Border
        {
            Content = inner,
            Padding = new Thickness(12, 8),
            BackgroundColor = mine ? Ui.Primary : Colors.White,
            Stroke = mine ? Ui.Primary : Ui.Line,
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 14 },
            HorizontalOptions = mine ? LayoutOptions.End : LayoutOptions.Start,
            MaximumWidthRequest = 320
        };
        _log.Children.Add(bubble);
    }

    private async Task Ask(string? q)
    {
        q = (q ?? "").Trim();
        if (q.Length == 0 || _busy) return;
        _busy = true; _send.IsEnabled = false;
        var hist = _history.TakeLast(6).ToList();
        _history.Add(new ChatTurn { From = "user", Text = q });
        _input.Text = "";
        AddBubble(true, q, null);
        var thinking = Ui.Text(Loc.T("chat.thinking"), 13, false, Ui.Dim);
        _log.Children.Add(thinking);
        try
        {
            var r = await Api.I.Chat(q, Loc.Lang, hist);
            _log.Children.Remove(thinking);
            AddBubble(false, r.Reply, r.Actions);
            _history.Add(new ChatTurn { From = "ai", Text = r.Reply });
            _sugs.Children.Clear();
            foreach (var s in r.Suggestions)
            {
                var text = s;
                var b = new Button { Text = text, FontSize = 12, Padding = new Thickness(12, 2), HeightRequest = 32, CornerRadius = 16, BackgroundColor = Colors.White, TextColor = Ui.Ink, BorderColor = Ui.Line, BorderWidth = 1 };
                b.Clicked += (_, _) => _ = Ask(text);
                _sugs.Children.Add(b);
            }
        }
        catch
        {
            _log.Children.Remove(thinking);
            AddBubble(false, Loc.T("chat.error"), null);
        }
        _busy = false; _send.IsEnabled = true;
        await Task.Delay(60);
        await _scroll.ScrollToAsync(0, _log.Height, true);
    }

    private async Task Open(ChatAction a)
    {
        if (a.Module == "gov" && a.Kind == "approval") { await Navigation.PushAsync(new ApprovalsPage()); return; }
        var m = Loc.Catalog.Modules.FirstOrDefault(x => x.Id == a.Module);
        var k = m?.Kinds.FirstOrDefault(x => x.Kind == a.Kind);
        if (m != null && k != null) await Navigation.PushAsync(new ErpListPage(m, k));
    }
}
