using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Report designer: choose columns, title, header / footer, orientation, grouping and totals for the rows of a list, preview it and print it
/// (choose "Microsoft Print to PDF" in the print dialog for a PDF). Layouts can be saved per list and shared with the workspace.</summary>
public static class Report
{
    public sealed record Column(string Key, string Label, bool Numeric);
    public sealed class Layout
    {
        public string Title = "", Subtitle = "", Header = "", Footer = "", Orientation = "portrait", GroupBy = "";
        public List<string> Columns = new(), Order = new();
        public bool Totals = true, ShowDate = true, ShowUser = true, RowNumbers;
    }

    private static string Esc(string? s) => WebUtility.HtmlEncode(s ?? "");
    private static string Pre(string? s) => Esc(s).Replace("\n", "<br>");
    private static string Nf(double n) => n.ToString("#,##0.##", CultureInfo.InvariantCulture);
    private static double Raw(Dictionary<string, string> r, string k)
    {
        var v = r.TryGetValue(k + "#", out var a) ? a : r.TryGetValue(k, out var b) ? b : "";
        return double.TryParse(v.Replace(",", ""), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;
    }

    /// <summary>The printable document (escaped values only). Rows hold the shown text per column key; "key#" holds the raw number used for totals.</summary>
    public static string Html(Layout L, List<Column> columns, List<Dictionary<string, string>> rows, string user)
    {
        var cols = new List<Column>();
        foreach (var k in L.Order) if (L.Columns.Contains(k)) { var c = columns.FirstOrDefault(x => x.Key == k); if (c != null) cols.Add(c); }
        var ncol = cols.Count + (L.RowNumbers ? 1 : 0);
        var head = new StringBuilder("<tr>");
        if (L.RowNumbers) head.Append("<th class=\"n\">#</th>");
        foreach (var c in cols) head.Append($"<th class=\"{(c.Numeric ? "n" : "")}\">{Esc(c.Label)}</th>");
        head.Append("</tr>");
        var idx = 0;
        string Row(Dictionary<string, string> r)
        {
            var s = new StringBuilder("<tr>");
            if (L.RowNumbers) s.Append($"<td class=\"n\">{++idx}</td>");
            foreach (var c in cols) s.Append($"<td class=\"{(c.Numeric ? "n" : "")}\">{Esc(r.TryGetValue(c.Key, out var v) ? v : "")}</td>");
            return s.Append("</tr>").ToString();
        }
        string Total(List<Dictionary<string, string>> rs, string label)
        {
            if (!L.Totals || !cols.Any(c => c.Numeric)) return "";
            var s = new StringBuilder("<tr class=\"tot\">");
            if (L.RowNumbers) s.Append("<td></td>");
            for (var i = 0; i < cols.Count; i++)
                s.Append(cols[i].Numeric ? $"<td class=\"n\">{Nf(rs.Sum(r => Raw(r, cols[i].Key)))}</td>" : $"<td>{(i == 0 ? Esc(label) : "")}</td>");
            return s.Append("</tr>").ToString();
        }
        var body = new StringBuilder();
        if (L.GroupBy.Length > 0 && cols.Count > 0)
        {
            var glabel = columns.FirstOrDefault(c => c.Key == L.GroupBy)?.Label ?? "";
            var order = new List<string>(); var groups = new Dictionary<string, List<Dictionary<string, string>>>();
            foreach (var r in rows)
            {
                var g = r.TryGetValue(L.GroupBy, out var gv) && gv.Length > 0 ? gv : "—";
                if (!groups.ContainsKey(g)) { groups[g] = new(); order.Add(g); }
                groups[g].Add(r);
            }
            foreach (var g in order)
            {
                body.Append($"<tr class=\"grp\"><td colspan=\"{ncol}\">{Esc(glabel)}: {Esc(g)} ({groups[g].Count})</td></tr>");
                foreach (var r in groups[g]) body.Append(Row(r));
                body.Append(Total(groups[g], Loc.T("collab.rep.subtotal")));
            }
            body.Append(Total(rows, Loc.T("collab.rep.total")));
        }
        else { foreach (var r in rows) body.Append(Row(r)); body.Append(Total(rows, Loc.T("collab.rep.total"))); }
        var meta = new List<string>();
        if (L.ShowDate) meta.Add(DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture));
        if (L.ShowUser && user.Length > 0) meta.Add(user);
        meta.Add($"{rows.Count} {Loc.T("collab.rep.rows")}");
        var o = L.Orientation == "landscape" ? "landscape" : "portrait";
        var dir = Loc.Rtl ? "rtl" : "ltr";
        var al = Loc.Rtl ? "right" : "left";
        var alEnd = Loc.Rtl ? "left" : "right";
        var sub = L.Subtitle.Length > 0 ? "<div class='sub'>" + Esc(L.Subtitle) + "</div>" : "";
        var hdr = L.Header.Length > 0 ? "<div class='hdr'>" + Pre(L.Header) + "</div>" : "";
        var ftr = L.Footer.Length > 0 ? "<div class='ftr'>" + Pre(L.Footer) + "</div>" : "";
        var css = "@page { size: A4 " + o + "; margin: 14mm; }"
            + " body { font: 12px/1.45 'Segoe UI', Tahoma, Arial, sans-serif; color: #111; margin: 0; padding: 14px; }"
            + " h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #555; margin-bottom: 4px; } .hdr { margin: 6px 0; }"
            + " .meta { color: #666; font-size: 11px; margin-bottom: 10px; border-bottom: 2px solid #111; padding-bottom: 6px; }"
            + " table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ddd; padding: 5px 7px; text-align: " + al + "; vertical-align: top; }"
            + " th { background: #f1f3f5; font-weight: 600; border-bottom: 1px solid #999; } .n { text-align: " + alEnd + "; }"
            + " tr.grp td { background: #e8ecf1; font-weight: 600; } tr.tot td { font-weight: 700; border-top: 1px solid #333; background: #fafafa; }"
            + " thead { display: table-header-group; } tr { page-break-inside: avoid; } .ftr { margin-top: 14px; color: #444; border-top: 1px solid #ccc; padding-top: 6px; }";
        return "<!doctype html><html dir='" + dir + "'><head><meta charset='utf-8'><meta http-equiv='X-UA-Compatible' content='IE=edge'><title>" + Esc(L.Title) + "</title><style>" + css + "</style></head><body>"
            + "<h1>" + Esc(L.Title) + "</h1>" + sub + hdr + "<div class='meta'>" + Esc(string.Join(" · ", meta)) + "</div>"
            + "<table><thead>" + head + "</thead><tbody>" + body + "</tbody></table>" + ftr + "</body></html>";
    }

    public static void Show(string view, string title, List<Column> cols, List<Dictionary<string, string>> rows, string user)
    {
        var w = new Window { Title = Loc.T("collab.reportDesigner"), Width = 1120, Height = 720, WindowStartupLocation = WindowStartupLocation.CenterScreen, FlowDirection = Loc.Flow, Background = Ui.Bg };
        var saved = new ComboBox { Margin = new Thickness(0, 0, 0, 6) };
        var delBtn = Ui.Btn("🗑", () => { }, "ghost"); delBtn.IsEnabled = false;
        var eTitle = Ui.Input(title); var eSub = Ui.Input();
        var eHead = new TextBox { Height = 48, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 8) };
        var eFoot = new TextBox { Height = 48, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 8) };
        var orient = new ComboBox { Margin = new Thickness(0, 0, 0, 8) }; orient.Items.Add(Loc.T("collab.rep.portrait")); orient.Items.Add(Loc.T("collab.rep.landscape")); orient.SelectedIndex = cols.Count > 6 ? 1 : 0;
        var group = new ComboBox { Margin = new Thickness(0, 0, 0, 8) }; group.Items.Add("—"); foreach (var c in cols) group.Items.Add(c.Label); group.SelectedIndex = 0;
        CheckBox Chk(string text, bool on) => new() { Content = text, IsChecked = on, Margin = new Thickness(0, 2, 0, 2) };
        var kTot = Chk(Loc.T("collab.rep.totals"), true); var kNum = Chk(Loc.T("collab.rep.rowNumbers"), false); var kDate = Chk(Loc.T("collab.rep.showDate"), true); var kUser = Chk(Loc.T("collab.rep.showUser"), true);
        var list = new ListBox { Height = 150, Margin = new Thickness(0, 0, 0, 6) };
        var eName = Ui.Input(); var kShare = Chk(Loc.T("collab.shareWorkspace"), false);
        var err = Ui.Text("", 12, false, Ui.Danger);
        var browser = new WebBrowser();
        var quiet = true;

        void FillList(List<string> order, List<string> on)
        {
            list.Items.Clear();
            foreach (var k in order)
            {
                var c = cols.First(x => x.Key == k);
                var cb = new CheckBox { Content = c.Label, Tag = k, IsChecked = on.Contains(k) };
                cb.Click += (_, _) => Refresh();
                list.Items.Add(cb);
            }
        }
        Layout Current()
        {
            var L = new Layout
            {
                Title = eTitle.Text, Subtitle = eSub.Text, Header = eHead.Text, Footer = eFoot.Text, Orientation = orient.SelectedIndex == 1 ? "landscape" : "portrait",
                GroupBy = group.SelectedIndex > 0 ? cols[group.SelectedIndex - 1].Key : "", Totals = kTot.IsChecked == true, ShowDate = kDate.IsChecked == true, ShowUser = kUser.IsChecked == true, RowNumbers = kNum.IsChecked == true
            };
            foreach (CheckBox cb in list.Items) { L.Order.Add((string)cb.Tag); if (cb.IsChecked == true) L.Columns.Add((string)cb.Tag); }
            return L;
        }
        void Refresh() { if (quiet) return; try { browser.NavigateToString(Html(Current(), cols, rows, user)); } catch { /* browser not ready yet */ } }
        void Apply(JsonObject d)
        {
            quiet = true;
            var on = (d["columns"] as JsonArray)?.Select(x => x?.ToString() ?? "").Where(k => cols.Any(c => c.Key == k)).ToList() ?? new List<string>();
            if (on.Count == 0) on = cols.Select(c => c.Key).ToList();
            var order = on.Concat(cols.Select(c => c.Key).Where(k => !on.Contains(k))).ToList();
            FillList(order, on);
            eTitle.Text = d["title"]?.ToString() ?? ""; eSub.Text = d["subtitle"]?.ToString() ?? ""; eHead.Text = d["header"]?.ToString() ?? ""; eFoot.Text = d["footer"]?.ToString() ?? "";
            orient.SelectedIndex = d["orientation"]?.ToString() == "landscape" ? 1 : 0;
            var gi = cols.FindIndex(c => c.Key == (d["groupBy"]?.ToString() ?? "")); group.SelectedIndex = gi + 1;
            bool B(string k, bool def) => d[k] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : def;
            kTot.IsChecked = B("totals", true); kDate.IsChecked = B("showDate", true); kUser.IsChecked = B("showUser", true); kNum.IsChecked = B("rowNumbers", false);
            quiet = false; Refresh();
        }
        void Move(int d)
        {
            var i = list.SelectedIndex; var j = i + d;
            if (i < 0 || j < 0 || j >= list.Items.Count) return;
            var it = (CheckBox)list.Items[i]; list.Items.RemoveAt(i); list.Items.Insert(j, it); list.SelectedIndex = j; Refresh();
        }
        async void LoadSaved()
        {
            try
            {
                var arr = await Api.I.Configs("report", view);
                saved.Items.Clear(); saved.Items.Add(new ComboBoxItem { Content = Loc.T("collab.savedReports"), Tag = null });
                foreach (var c in arr.OfType<JsonObject>())
                    saved.Items.Add(new ComboBoxItem { Content = ((c["shared"]?.GetValue<bool>() == true && c["mine"]?.GetValue<bool>() != true) ? "👥 " : "") + (c["name"]?.ToString() ?? ""), Tag = c });
                saved.SelectedIndex = 0;
            }
            catch { /* no saved layouts */ }
        }

        FillList(cols.Select(c => c.Key).ToList(), cols.Select(c => c.Key).ToList());
        quiet = false;
        eTitle.TextChanged += (_, _) => Refresh(); eSub.TextChanged += (_, _) => Refresh(); eHead.TextChanged += (_, _) => Refresh(); eFoot.TextChanged += (_, _) => Refresh();
        orient.SelectionChanged += (_, _) => Refresh(); group.SelectionChanged += (_, _) => Refresh();
        foreach (var k in new[] { kTot, kNum, kDate, kUser }) k.Click += (_, _) => Refresh();
        saved.SelectionChanged += (_, _) =>
        {
            if (saved.SelectedItem is ComboBoxItem { Tag: JsonObject c }) { delBtn.IsEnabled = c["mine"]?.GetValue<bool>() == true; Apply(c["data"] as JsonObject ?? new JsonObject()); }
            else delBtn.IsEnabled = false;
        };
        delBtn.Click += async (_, _) =>
        {
            if (saved.SelectedItem is ComboBoxItem { Tag: JsonObject c } && c["mine"]?.GetValue<bool>() == true)
            { try { await Api.I.DeleteConfig("report", c["id"]!.ToString()); LoadSaved(); } catch (Exception e) { err.Text = e.Message; } }
        };

        var side = new StackPanel { Margin = new Thickness(10) };
        side.Children.Add(new DockPanel { Children = { saved } });
        side.Children.Add(delBtn);
        void Add(string label, UIElement el) { side.Children.Add(Ui.Text(label, 12, false, Ui.Dim)); side.Children.Add(el); }
        Add(Loc.T("collab.rep.title"), eTitle); Add(Loc.T("collab.rep.subtitle"), eSub); Add(Loc.T("collab.rep.header"), eHead); Add(Loc.T("collab.rep.footer"), eFoot);
        Add(Loc.T("collab.rep.orientation"), orient); Add(Loc.T("collab.rep.groupBy"), group);
        side.Children.Add(kTot); side.Children.Add(kNum); side.Children.Add(kDate); side.Children.Add(kUser);
        Add(Loc.T("collab.rep.columns"), list);
        side.Children.Add(Ui.Row(Ui.Btn("▲", () => Move(-1), "ghost"), Ui.Btn("▼", () => Move(1), "ghost")));
        Add(Loc.T("collab.rep.layoutName"), eName); side.Children.Add(kShare);
        side.Children.Add(Ui.Btn(Loc.T("collab.rep.saveLayout"), async () =>
        {
            var n = eName.Text.Trim(); if (n.Length == 0) return;
            var L = Current(); var data = new JsonObject
            {
                ["title"] = L.Title, ["subtitle"] = L.Subtitle, ["header"] = L.Header, ["footer"] = L.Footer, ["orientation"] = L.Orientation, ["groupBy"] = L.GroupBy,
                ["totals"] = L.Totals, ["showDate"] = L.ShowDate, ["showUser"] = L.ShowUser, ["rowNumbers"] = L.RowNumbers,
                ["columns"] = new JsonArray(L.Order.Where(k => L.Columns.Contains(k)).Select(k => (JsonNode)JsonValue.Create(k)!).ToArray())
            };
            err.Text = "";
            try { await Api.I.SaveConfig("report", view, n, kShare.IsChecked == true, data); eName.Text = ""; LoadSaved(); } catch (Exception e) { err.Text = e.Message; }
        }));
        side.Children.Add(err);

        void Print() { try { browser.InvokeScript("execScript", new object[] { "window.print();" }); } catch (Exception e) { Ui.Warn(e.Message); } }
        void SaveHtml()
        {
            var dlg = new Microsoft.Win32.SaveFileDialog { FileName = (Current().Title.Length > 0 ? Current().Title : "report") + ".html", Filter = "HTML (*.html)|*.html" };
            if (dlg.ShowDialog() == true) File.WriteAllText(dlg.FileName, Html(Current(), cols, rows, user), new UTF8Encoding(true));
        }
        var bar = Ui.Row(Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost"), Ui.Btn("HTML", SaveHtml, "ghost"), Ui.Btn("🖨 " + Loc.T("collab.rep.print"), Print));
        bar.HorizontalAlignment = HorizontalAlignment.Right; bar.Margin = new Thickness(0, 6, 10, 8);
        var right = new DockPanel();
        DockPanel.SetDock(bar, Dock.Bottom); right.Children.Add(bar); right.Children.Add(browser);
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(330) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var sv = new ScrollViewer { Content = side, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Grid.SetColumn(sv, 0); Grid.SetColumn(right, 1);
        grid.Children.Add(sv); grid.Children.Add(right);
        w.Content = grid;
        w.Loaded += (_, _) => { Refresh(); LoadSaved(); };
        w.ShowDialog();
    }
}
