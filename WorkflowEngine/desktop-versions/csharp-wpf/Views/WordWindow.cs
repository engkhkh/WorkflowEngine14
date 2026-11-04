using System.Windows.Controls.Primitives;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Tap a word of the Quran text pages: meaning, verse translation and tafsir from the public Quran.com API.
/// Needs internet; the address can be changed with the environment variable QURAN_API.</summary>
public class WordWindow : Window
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly MushafText.WordLoc _loc;
    private readonly TextBlock _meaning = new() { Text = "…", FontSize = 16, FontWeight = FontWeights.Bold, TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 10, 0, 6) };
    private readonly TextBlock _verse = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 8) };
    private readonly TextBox _tafsir = new() { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Height = 170, Visibility = Visibility.Collapsed };

    public static string ApiBase => Environment.GetEnvironmentVariable("QURAN_API") is { Length: > 0 } e ? e : "https://api.quran.com/api/v4";

    public static string StripHtml(string? h)
    {
        h = Regex.Replace(h ?? "", @"<br\s*/?>|</p>", "\n", RegexOptions.IgnoreCase);
        h = Regex.Replace(h, "<[^>]+>", "");
        return h.Replace("&nbsp;", " ").Replace("&amp;", "&").Replace("&quot;", "\"").Replace("&#39;", "'").Replace("&lt;", "<").Replace("&gt;", ">").Trim();
    }

    public WordWindow(int page, int li, int ti, string word)
    {
        Title = Loc.T("mus.q.word");
        Width = 500; SizeToContent = SizeToContent.Height; MinHeight = 260;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        _loc = MushafText.Locate(page, li, ti);
        var panel = new StackPanel { Margin = new Thickness(16) };
        panel.Children.Add(new TextBlock { Text = word, FontSize = 34, TextAlignment = TextAlignment.Center });
        panel.Children.Add(new TextBlock { Text = $"{MushafText.SurahName(_loc.Surah)} · {_loc.Ayah}", TextAlignment = TextAlignment.Center });
        panel.Children.Add(_meaning);
        panel.Children.Add(_verse);
        var row = new UniformGrid { Columns = 2 };
        var ar = new Button { Content = "التفسير الميسر", Margin = new Thickness(0, 0, 4, 0), Padding = new Thickness(6) };
        var en = new Button { Content = "Tafsir Ibn Kathir", Margin = new Thickness(4, 0, 0, 0), Padding = new Thickness(6) };
        ar.Click += async (_, _) => await ShowTafsir("ar");
        en.Click += async (_, _) => await ShowTafsir("en");
        row.Children.Add(ar); row.Children.Add(en);
        panel.Children.Add(row);
        panel.Children.Add(new Border { Height = 6 });
        panel.Children.Add(_tafsir);
        var close = new Button { Content = Loc.T("common.close"), Margin = new Thickness(0, 10, 0, 0), Padding = new Thickness(10, 4, 10, 4), HorizontalAlignment = HorizontalAlignment.Center };
        close.Click += (_, _) => Close();
        panel.Children.Add(close);
        Content = panel;
        Loaded += async (_, _) => await LoadInfo();
    }

    private static async Task<JsonNode> Get(string url)
    {
        using var rq = new HttpRequestMessage(HttpMethod.Get, url);
        rq.Headers.Add("Accept", "application/json");
        rq.Headers.Add("User-Agent", "WorkflowErp-Desktop");
        using var r = await Http.SendAsync(rq);
        if (!r.IsSuccessStatusCode) throw new InvalidOperationException("HTTP " + (int)r.StatusCode);
        return JsonNode.Parse(await r.Content.ReadAsStringAsync()) ?? new JsonObject();
    }

    private async Task LoadInfo()
    {
        try
        {
            var o = await Get($"{ApiBase}/verses/by_key/{_loc.Surah}:{_loc.Ayah}?words=true&word_fields=transliteration&translations=20&language=en");
            var v = o["verse"];
            var words = (v?["words"]?.AsArray() ?? new JsonArray()).Where(w => (string?)w?["char_type_name"] is null or "word").ToList();
            string mean = "", tr = "";
            if (words.Count == _loc.Total && _loc.Pos > 0 && _loc.Pos <= words.Count)
            {
                var w = words[_loc.Pos - 1]!;
                mean = (string?)w["translation"]?["text"] ?? "";
                tr = (string?)w["transliteration"]?["text"] ?? "";
            }
            _meaning.Text = mean.Length == 0 ? Loc.T("mus.q.nomeaning") : mean + (tr.Length == 0 ? "" : "  ·  " + tr);
            _verse.Text = StripHtml((string?)v?["translations"]?[0]?["text"]);
        }
        catch (Exception ex) { _meaning.Text = Loc.T("mus.q.offline") + "\n" + ex.Message; }
    }

    private async Task ShowTafsir(string lang)
    {
        _tafsir.Visibility = Visibility.Visible;
        _tafsir.FlowDirection = lang == "ar" ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;
        _tafsir.Text = "…";
        try
        {
            var o = await Get($"{ApiBase}/tafsirs/{(lang == "ar" ? 16 : 169)}/by_ayah/{_loc.Surah}:{_loc.Ayah}");
            var s = StripHtml((string?)o["tafsir"]?["text"]);
            _tafsir.Text = s.Length == 0 ? "-" : s;
        }
        catch (Exception ex) { _tafsir.Text = Loc.T("mus.q.offline") + "\n" + ex.Message; }
    }
}
