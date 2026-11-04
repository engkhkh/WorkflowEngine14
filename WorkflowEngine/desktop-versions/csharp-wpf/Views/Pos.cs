using System.Globalization;
using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using WorkflowErp.Services;
using static WorkflowErp.Services.PosCalc;

namespace WorkflowErp.Views;

/// <summary>Point of sale: the till, shifts and sales history with receipts (port of the portal's /pos/terminal, /pos/shifts, /pos/sales).</summary>
internal static class PosUi
{
    public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WorkflowErpWpf");
    public static string QueueFile => Path.Combine(Dir, "pos-queue.json");
    public static string HeldFile => Path.Combine(Dir, "pos-held-" + new string((Api.I.Session?.Username ?? "").Where(char.IsLetterOrDigit).ToArray()) + ".json");

    public static JsonArray ReadList(string file)
    {
        try { return File.Exists(file) ? JsonNode.Parse(File.ReadAllText(file)) as JsonArray ?? new JsonArray() : new JsonArray(); }
        catch { return new JsonArray(); }
    }

    public static void WriteList(string file, JsonArray a)
    {
        try { Directory.CreateDirectory(Dir); File.WriteAllText(file, a.ToJsonString()); } catch { /* optional */ }
    }

    public static TextBox NumBox(double v = 0) => new() { Text = v.ToString("0.##", CultureInfo.InvariantCulture), Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8), MinWidth = 90 };

    public static double Val(TextBox t) => double.TryParse((t.Text ?? "").Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;

    public static string At(string s) => s[..Math.Min(16, s.Length)].Replace('T', ' ');

    public static void ShowReceipt(JsonObject sale, JsonObject settings, string title)
    {
        var w = Ui.Dialog(title, 380, 620, out var body);
        var browser = new WebBrowser { Height = 470 };
        var html = ReceiptHtml(sale, settings);
        browser.Loaded += (_, _) => { try { browser.NavigateToString(html); } catch { /* browser not ready */ } };
        body.Children.Add(browser);
        body.Children.Add(Ui.Row(
            Ui.Btn(Loc.T("pos.print"), () => { try { browser.InvokeScript("execScript", new object[] { "window.print();" }); } catch (Exception e) { Ui.Warn(e.Message); } }, "ghost"),
            Ui.Btn(Loc.T("common.ok"), () => w.Close())));
        w.ShowDialog();
    }

    /// <summary>amount + note dialog; returns null when cancelled.</summary>
    public static (double amount, string note)? AmountDialog(string title, string amountLabel, string noteLabel, string? hint)
    {
        (double, string)? result = null;
        var w = Ui.Dialog(title, 380, hint == null ? 250 : 320, out var body);
        var amount = NumBox(); var note = Ui.Input();
        body.Children.Add(Ui.Labeled(amountLabel, amount));
        body.Children.Add(Ui.Labeled(noteLabel, note));
        if (hint != null) body.Children.Add(Ui.Text(hint, 12, false, Ui.Dim));
        body.Children.Add(Ui.Row(Ui.Btn(Loc.T("admin.save"), () => { result = (Val(amount), note.Text); w.Close(); }), Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog();
        return result;
    }

    public static bool Offline(Exception e) => e is ApiException a && a.Offline;
}

internal sealed class PosPayDialog
{
    public bool Ok;
    public readonly TextBox Cash = PosUi.NumBox(), Card = PosUi.NumBox(), Other = PosUi.NumBox(), Redeem = PosUi.NumBox();
    private readonly TextBlock _sum = Ui.Text("");
    private readonly double _total, _pointValue;
    private readonly Button _go;
    private readonly int _points;

    public PosPayDialog(double total, JsonNode? customer, JsonObject settings)
    {
        _total = total;
        _pointValue = N(settings["pointValue"]) == 0 ? 0.05 : N(settings["pointValue"]);
        _points = customer == null ? 0 : (int)N(D(customer)["points"]);
        var w = Ui.Dialog(Loc.T("pos.pay") + " · " + Money(total), 440, 470, out var body);
        body.Children.Add(Ui.Labeled(Loc.T("pos.pay.cash"), Cash));
        body.Children.Add(Ui.Labeled(Loc.T("pos.pay.card"), Card));
        body.Children.Add(Ui.Labeled(Loc.T("pos.pay.other"), Other));
        if (_points > 0) { Redeem.Text = "0"; body.Children.Add(Ui.Labeled(Loc.T("pos.redeem") + " (" + _points + ")", Redeem)); }
        foreach (var t in new[] { Cash, Card, Other, Redeem }) t.TextChanged += (_, _) => Recalc();
        var quick = new WrapPanel();
        quick.Children.Add(Ui.Btn(Loc.T("pos.exactCash"), () => Exact(Cash), "ghost"));
        quick.Children.Add(Ui.Btn(Loc.T("pos.exactCard"), () => Exact(Card), "ghost"));
        foreach (var n in new[] { 50, 100, 200, 500 })
        {
            var amount = n;
            quick.Children.Add(Ui.Btn(n.ToString(), () => { Card.Text = "0"; Other.Text = "0"; Cash.Text = amount.ToString(); }, "ghost"));
        }
        body.Children.Add(quick);
        body.Children.Add(_sum);
        _go = Ui.Btn(Loc.T("pos.complete"), () => { Ok = true; w.Close(); });
        body.Children.Add(Ui.Row(_go, Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        Recalc();
        w.ShowDialog();
    }

    public int RedeemPoints => Math.Min(_points, (int)PosUi.Val(Redeem));
    private double RedeemValue => R2(RedeemPoints * _pointValue);
    private double Due => R2(Math.Max(0, _total - Math.Min(RedeemValue, _total)));
    private double Tendered => R2(PosUi.Val(Cash) + PosUi.Val(Card) + PosUi.Val(Other));
    public double Remaining => R2(Due - Tendered);

    private void Exact(TextBox t) { Cash.Text = "0"; Card.Text = "0"; Other.Text = "0"; t.Text = Due.ToString("0.##", CultureInfo.InvariantCulture); }

    private void Recalc()
    {
        var rem = Remaining;
        _sum.Text = $"{Loc.T("pos.due")}: {Money(Due)}\n{Loc.T("pos.tendered")}: {Money(Tendered)}\n{(rem > 0 ? Loc.T("pos.remaining") : Loc.T("pos.change"))}: {Money(Math.Abs(rem))}";
        _sum.Foreground = rem > 0 ? Ui.Danger : new SolidColorBrush(Color.FromRgb(0x16, 0xA3, 0x4A));
        _sum.FontWeight = FontWeights.SemiBold;
        _go.IsEnabled = rem <= 0.004;
    }

    public JsonArray Payments()
    {
        var a = new JsonArray();
        if (PosUi.Val(Cash) > 0) a.Add(new JsonObject { ["method"] = "cash", ["amount"] = PosUi.Val(Cash) });
        if (PosUi.Val(Card) > 0) a.Add(new JsonObject { ["method"] = "card", ["amount"] = PosUi.Val(Card) });
        if (PosUi.Val(Other) > 0) a.Add(new JsonObject { ["method"] = "other", ["amount"] = PosUi.Val(Other) });
        return a;
    }
}

internal sealed class PosTill : StackPanel
{
    private readonly State _st;
    private readonly Func<Task> _onShift;
    private readonly List<JsonObject> _cart = new();
    private string _customer = "";
    private double _orderPct;
    private bool _busy, _updating;
    private readonly TextBlock _banner = Ui.Text("", 13, false, Ui.Danger), _queueLbl = Ui.Text("", 12, false, Ui.Dim), _custInfo = Ui.Text("", 12, false, Ui.Dim), _tot = Ui.Text("", 13), _shiftLbl = Ui.Text("", 12, false, Ui.Dim);
    private readonly Button _queueBtn, _holdB, _recallB, _clearB, _payB;
    private readonly StackPanel _gate = new();
    private readonly Grid _till = new();
    private readonly ComboBox _reg = new(), _cat = new(), _cust = new();
    private readonly TextBox _float = PosUi.NumBox(), _q = Ui.Input(), _lineDisc = PosUi.NumBox(), _order = PosUi.NumBox();
    private readonly WrapPanel _tiles = new();
    private readonly DataGrid _lines = Ui.Grid(Loc.T("pos.product"), "#", Loc.T("pos.total"));

    public PosTill(State st, Func<Task> onShift)
    {
        _st = st; _onShift = onShift;
        _queueBtn = Ui.Btn(Loc.T("pos.syncNow"), () => _ = Safe(Flush), "ghost");
        _holdB = Ui.Btn(Loc.T("pos.hold"), Hold, "ghost");
        _recallB = Ui.Btn(Loc.T("pos.recall"), Recall, "ghost");
        _clearB = Ui.Btn(Loc.T("pos.clear"), Clear, "ghost");
        _payB = Ui.Btn(Loc.T("pos.pay"), () => _ = Safe(() => Pay()));
        _payB.Padding = new Thickness(14, 10, 14, 10);

        Children.Add(_banner);
        var qrow = new DockPanel();
        DockPanel.SetDock(_queueBtn, Dock.Right);
        qrow.Children.Add(_queueBtn); qrow.Children.Add(_queueLbl);
        Children.Add(qrow);

        _gate.Children.Add(Ui.Text(Loc.T("pos.shift.none"), 18, true));
        _gate.Children.Add(Ui.Text(Loc.T("pos.shift.noneHint"), 12, false, Ui.Dim));
        _reg.Margin = new Thickness(0, 0, 0, 8);
        _gate.Children.Add(Ui.Labeled(Loc.T("pos.register"), _reg));
        _gate.Children.Add(Ui.Labeled(Loc.T("pos.shift.opening"), _float));
        _gate.Children.Add(Ui.Btn(Loc.T("pos.shift.open"), () => _ = Safe(() => OpenShift(PosUi.Val(_float)))));
        _gate.MaxWidth = 420; _gate.HorizontalAlignment = HorizontalAlignment.Left;
        Children.Add(_gate);

        _till.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _till.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(390) });
        _q.TextChanged += (_, _) => { if (!_updating) FillProducts(); };
        _q.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) Scan(); };
        _q.ToolTip = Loc.T("pos.scan");
        _cat.SelectionChanged += (_, _) => { if (!_updating) FillProducts(); };
        var bar = new DockPanel();
        var right0 = new StackPanel { Orientation = Orientation.Horizontal };
        _cat.MinWidth = 120; _cat.Margin = new Thickness(8, 0, 8, 8);
        right0.Children.Add(_cat); right0.Children.Add(_shiftLbl);
        DockPanel.SetDock(right0, Dock.Right);
        bar.Children.Add(right0); bar.Children.Add(_q);
        var left = new StackPanel { Margin = new Thickness(0, 0, 12, 0) };
        left.Children.Add(bar);
        left.Children.Add(new ScrollViewer { Content = _tiles, Height = 560, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        Grid.SetColumn(left, 0); _till.Children.Add(left);

        _cust.SelectionChanged += (_, _) => { if (!_updating) { _customer = (_cust.SelectedItem as ComboBoxItem)?.Tag as string ?? ""; Repaint(); } };
        _lines.Height = 260;
        _lines.SelectionChanged += (_, _) => { if (!_updating) SyncLineDisc(); };
        _lineDisc.TextChanged += (_, _) => { if (!_updating) SetLineDisc(_lines.SelectedIndex, (int)PosUi.Val(_lineDisc)); };
        _order.TextChanged += (_, _) => { if (!_updating) { _orderPct = Math.Min((int)PosUi.Val(_order), (int)N(_st.Settings["maxDiscountPct"])); Repaint(); } };
        var cart = new StackPanel();
        cart.Children.Add(_cust); cart.Children.Add(_custInfo); cart.Children.Add(_lines);
        cart.Children.Add(Ui.Row(Ui.Btn("−", () => Bump(-1), "ghost"), Ui.Btn("+", () => Bump(1), "ghost"), Ui.Btn("✕", RemoveLine, "ghost")));
        cart.Children.Add(Ui.Row(Ui.Text(Loc.T("pos.lineDisc"), 12, false, Ui.Dim), _lineDisc));
        cart.Children.Add(Ui.Row(Ui.Text(Loc.T("pos.orderDisc"), 12, false, Ui.Dim), _order));
        cart.Children.Add(_tot);
        cart.Children.Add(Ui.Row(_holdB, _recallB, _clearB));
        cart.Children.Add(_payB);
        var card = new Border { Child = cart, Background = Brushes.White, BorderBrush = Charts.LinePen.Brush, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), Padding = new Thickness(10) };
        Grid.SetColumn(card, 1); _till.Children.Add(card);
        Children.Add(_till);
    }

    private JsonNode? Customer() => _st.Customers.FirstOrDefault(c => S(c?["code"]) == _customer);
    private PosCalc.Priced Calc() => PriceCart(_cart, _st.Products.OfType<JsonNode>(), _st.Promos.OfType<JsonNode>(), Customer(), _orderPct, _st.Settings);
    private bool Tracked(JsonNode p) => D(p)["trackStock"]?.GetValue<bool>() == true;
    private double StockOf(JsonNode p) => _st.Stock.TryGetValue(S(p["code"]), out var v) ? v : 0;

    public void Refresh()
    {
        _updating = true;
        _reg.Items.Clear(); _reg.Items.Add(new ComboBoxItem { Content = "—", Tag = "" });
        foreach (var x in _st.Registers) _reg.Items.Add(new ComboBoxItem { Content = S(x?["code"]) + " · " + S(D(x)["name"]), Tag = S(x?["code"]) });
        _reg.SelectedIndex = 0;
        var gate = _st.Shift == null && (_st.Settings["requireShift"]?.GetValue<bool>() ?? true);
        _gate.Visibility = gate ? Visibility.Visible : Visibility.Collapsed;
        _till.Visibility = gate ? Visibility.Collapsed : Visibility.Visible;
        _shiftLbl.Text = _st.Shift == null ? "" : S(_st.Shift["code"]);
        _cat.Items.Clear(); _cat.Items.Add(new ComboBoxItem { Content = Loc.T("pos.all"), Tag = "" });
        foreach (var c in _st.Products.Select(p => S(D(p)["category"])).Where(c => c.Length > 0).Distinct().OrderBy(c => c, StringComparer.Ordinal))
        {
            var cr = _st.Categories.FirstOrDefault(x => S(x?["code"]) == c);
            var d = D(cr);
            var nm = Loc.Rtl && S(d["nameAr"]).Length > 0 ? S(d["nameAr"]) : S(d["name"]).Length > 0 ? S(d["name"]) : c;
            _cat.Items.Add(new ComboBoxItem { Content = nm, Tag = c });
        }
        _cat.SelectedIndex = 0;
        _cust.Items.Clear(); _cust.Items.Add(new ComboBoxItem { Content = Loc.T("pos.walkin"), Tag = "" });
        foreach (var c in _st.Customers) _cust.Items.Add(new ComboBoxItem { Content = S(D(c)["name"]) + " · " + S(c?["code"]), Tag = S(c?["code"]) });
        _cust.SelectedIndex = Math.Max(0, _cust.Items.Cast<ComboBoxItem>().ToList().FindIndex(i => (i.Tag as string) == _customer));
        _updating = false;
        FillProducts(); Repaint(); UpdateQueue();
    }

    private void UpdateQueue()
    {
        var n = PosUi.ReadList(PosUi.QueueFile).Count;
        _queueLbl.Text = n > 0 ? Loc.T("pos.queued").Replace("{n}", n.ToString()) : "";
        _queueBtn.Visibility = _queueLbl.Visibility = n > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void FillProducts()
    {
        var q = _q.Text.ToLowerInvariant().Trim();
        var c = (_cat.SelectedItem as ComboBoxItem)?.Tag as string ?? "";
        _tiles.Children.Clear();
        var n = 0;
        foreach (var p in _st.Products.OfType<JsonNode>())
        {
            var d = D(p);
            if (S(p["status"]) == "Inactive" || (c.Length > 0 && S(d["category"]) != c)) continue;
            if (q.Length > 0 && !S(d["name"]).ToLowerInvariant().Contains(q) && !S(p["code"]).ToLowerInvariant().Contains(q) && !S(d["barcode"]).ToLowerInvariant().Contains(q)) continue;
            var promo = _st.Promos.OfType<JsonNode>().Any(pr => S(pr["status"]) == "Active" && (S(D(pr)["scope"]) == "all" || string.Equals(S(D(pr)["target"]), S(p["code"]), StringComparison.OrdinalIgnoreCase)));
            var tracked = Tracked(p);
            var soldOut = tracked && StockOf(p) <= 0 && !(_st.Settings["allowNegativeStock"]?.GetValue<bool>() ?? false);
            var tx = new StackPanel();
            tx.Children.Add(Ui.Text(S(d["name"]), 13, true));
            tx.Children.Add(Ui.Text(Money(N(d["price"])) + (promo ? " %" : ""), 13, true, Ui.Primary));
            tx.Children.Add(Ui.Text(S(p["code"]) + (tracked ? " · " + Loc.T("pos.left").Replace("{n}", ((long)StockOf(p)).ToString()) : ""), 11, false, Ui.Dim));
            var code = S(p["code"]);
            var b = new Button { Content = tx, Width = 170, Height = 84, Margin = new Thickness(4), Background = Brushes.White, HorizontalContentAlignment = HorizontalAlignment.Left, IsEnabled = !soldOut };
            b.Click += (_, _) => Add(code);
            _tiles.Children.Add(b);
            if (++n >= 80) break;
        }
    }

    private void Scan()
    {
        var s = _q.Text.Trim().ToLowerInvariant();
        if (s.Length == 0) return;
        var p = _st.Products.OfType<JsonNode>().FirstOrDefault(x => S(x["code"]).ToLowerInvariant() == s || S(D(x)["barcode"]).ToLowerInvariant() == s);
        if (p != null) { Add(S(p["code"])); _q.Text = ""; }
        else if (_tiles.Children.Count == 1) { var only = _st.Products.OfType<JsonNode>().First(x => S(D(x)["name"]).ToLowerInvariant().Contains(s) || S(x["code"]).ToLowerInvariant().Contains(s)); Add(S(only["code"])); _q.Text = ""; }
        else _banner.Text = Loc.T("pos.notFound");
    }

    public void Add(string sku)
    {
        _banner.Text = "";
        var l = _cart.FirstOrDefault(x => S(x["sku"]) == sku);
        if (l != null) l["qty"] = N(l["qty"]) + 1; else _cart.Add(new JsonObject { ["sku"] = sku, ["qty"] = 1, ["discountPct"] = 0 });
        Repaint(_cart.Count - 1);
    }

    private void Bump(int d)
    {
        var i = _lines.SelectedIndex;
        if (i < 0 || i >= _cart.Count) return;
        var q = N(_cart[i]["qty"]) + d;
        if (q <= 0) _cart.RemoveAt(i); else _cart[i]["qty"] = q;
        Repaint(Math.Min(i, _cart.Count - 1));
    }

    private void RemoveLine() { var i = _lines.SelectedIndex; if (i >= 0 && i < _cart.Count) { _cart.RemoveAt(i); Repaint(Math.Min(i, _cart.Count - 1)); } }

    private void SetLineDisc(int row, int pct)
    {
        if (row < 0 || row >= _cart.Count) return;
        pct = Math.Min(pct, (int)N(_st.Settings["maxDiscountPct"]));
        if ((int)N(_cart[row]["discountPct"]) == pct) return;
        _cart[row]["discountPct"] = pct;
        Repaint(row);
    }

    private void SyncLineDisc()
    {
        var i = _lines.SelectedIndex;
        _updating = true;
        _lineDisc.Text = i >= 0 && i < _cart.Count ? ((int)N(_cart[i]["discountPct"])).ToString() : "0";
        _updating = false;
    }

    private void Repaint(int select = -1)
    {
        var p = Calc();
        _updating = true;
        Ui.Fill(_lines, p.Lines.Select(l => (new[] { S(l["name"]) + (S(l["promoCode"]).Length > 0 ? "  [" + S(l["promoCode"]) + "]" : ""), Num(N(l["qty"])), Money(N(l["total"])) }, (object)l)));
        if (select >= 0 && select < p.Lines.Count) _lines.SelectedIndex = select;
        var i = _lines.SelectedIndex;
        _lineDisc.Text = i >= 0 && i < _cart.Count ? ((int)N(_cart[i]["discountPct"])).ToString() : "0";
        _order.Text = ((int)_orderPct).ToString();
        _updating = false;
        var cu = Customer();
        _custInfo.Text = cu == null ? "" : Loc.T("pos.points") + ": " + (long)N(D(cu)["points"]) + (N(D(cu)["discountPct"]) != 0 ? " · " + Num(N(D(cu)["discountPct"])) + "%" : "");
        _tot.Text = $"{Loc.T("pos.subtotal")}: {Money(p.Subtotal)}\n" + (p.Discount != 0 ? $"{Loc.T("pos.discount")}: −{Money(p.Discount)}\n" : "") + $"{Loc.T("pos.tax")}: {Money(p.Tax)}\n{Loc.T("pos.total")}: {Money(p.Total)}";
        _tot.FontWeight = FontWeights.SemiBold; _tot.FontSize = 15; _tot.Margin = new Thickness(0, 8, 0, 8);
        var has = _cart.Count > 0;
        _payB.IsEnabled = _holdB.IsEnabled = _clearB.IsEnabled = has;
        var held = PosUi.ReadList(PosUi.HeldFile).Count;
        _recallB.Visibility = held > 0 ? Visibility.Visible : Visibility.Collapsed;
        _recallB.Content = Loc.T("pos.recall") + " (" + held + ")";
    }

    private void SetCustomer(string code)
    {
        _customer = code; _updating = true;
        _cust.SelectedIndex = Math.Max(0, _cust.Items.Cast<ComboBoxItem>().ToList().FindIndex(i => (i.Tag as string) == code));
        _updating = false;
        Repaint();
    }

    private void Clear() { _cart.Clear(); _orderPct = 0; SetCustomer(""); }

    // ---- held baskets
    private void Hold()
    {
        var h = PosUi.ReadList(PosUi.HeldFile);
        var cart = new JsonArray(); foreach (var l in _cart) cart.Add(l.DeepClone());
        h.Add(new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["at"] = DateTime.Now.ToString("HH:mm"), ["cart"] = cart, ["customer"] = _customer });
        PosUi.WriteList(PosUi.HeldFile, h);
        Clear();
    }

    private void Recall()
    {
        var h = PosUi.ReadList(PosUi.HeldFile);
        if (h.Count == 0) return;
        string? pick = null; var drop = false;
        var w = Ui.Dialog(Loc.T("pos.recall"), 380, 360, out var body);
        var list = new ListBox { Height = 200 };
        foreach (var x in h.OfType<JsonObject>()) list.Items.Add(new ListBoxItem { Content = S(x["at"]) + " · " + (x["cart"] as JsonArray)?.Count + " " + Loc.T("pos.items"), Tag = S(x["id"]) });
        list.SelectedIndex = 0;
        body.Children.Add(list);
        body.Children.Add(Ui.Row(
            Ui.Btn(Loc.T("pos.recallOne"), () => { if (list.SelectedItem is ListBoxItem i) { pick = i.Tag as string; drop = false; w.Close(); } }),
            Ui.Btn("🗑", () => { if (list.SelectedItem is ListBoxItem i) { pick = i.Tag as string; drop = true; w.Close(); } }, "danger"),
            Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog();
        if (pick == null) return;
        var got = h.OfType<JsonObject>().First(x => S(x["id"]) == pick);
        var rest = new JsonArray(); foreach (var x in h.OfType<JsonObject>().Where(x => S(x["id"]) != pick)) rest.Add(x.DeepClone());
        PosUi.WriteList(PosUi.HeldFile, rest);
        if (!drop)
        {
            _cart.Clear();
            foreach (var l in (got["cart"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()) _cart.Add((JsonObject)l.DeepClone());
            SetCustomer(S(got["customer"]));
        }
        Repaint();
    }

    // ---- shift
    private async Task OpenShift(double opening)
    {
        var b = new JsonObject { ["openingCash"] = opening };
        var reg = (_reg.SelectedItem as ComboBoxItem)?.Tag as string ?? "";
        if (reg.Length > 0) b["register"] = reg;
        try { _st.Shift = await Api.I.PosOpen(b); await _onShift(); }
        catch (Exception e) { _banner.Text = e.Message; }
    }

    // ---- checkout
    private async Task Pay()
    {
        if (_busy || _cart.Count == 0) return;
        var p = Calc();
        var dlg = new PosPayDialog(p.Total, Customer(), _st.Settings);
        if (!dlg.Ok) return;
        var cart = new JsonArray(); foreach (var l in _cart) cart.Add(l.DeepClone());
        var body = new JsonObject { ["lines"] = cart, ["payments"] = dlg.Payments(), ["discountPct"] = _orderPct, ["redeemPoints"] = dlg.RedeemPoints, ["localId"] = Guid.NewGuid().ToString() };
        if (_customer.Length > 0) body["customer"] = _customer;
        if (_st.Shift?["ref"] != null) body["register"] = S(_st.Shift["ref"]);
        _busy = true;
        try
        {
            var sale = await Api.I.PosCheckout(body);
            Clear(); UpdateQueue();
            PosUi.ShowReceipt(sale, _st.Settings, Loc.T("pos.saleDone"));
            await _onShift();
        }
        catch (Exception e) when (PosUi.Offline(e))
        {
            // the network is down: keep the sale, show a provisional receipt, send it later
            var q = PosUi.ReadList(PosUi.QueueFile); q.Add(body.DeepClone()); PosUi.WriteList(PosUi.QueueFile, q);
            var lines = new JsonArray(); foreach (var l in p.Lines) lines.Add(l.DeepClone());
            var sale = new JsonObject
            {
                ["code"] = Loc.T("pos.offlineCode"), ["status"] = "Queued", ["createdAt"] = DateTime.Now.ToString("s"),
                ["data"] = new JsonObject
                {
                    ["type"] = "Sale", ["lines"] = lines, ["subtotal"] = p.Subtotal, ["discount"] = p.Discount, ["tax"] = p.Tax, ["total"] = p.Total, ["payments"] = body["payments"]!.DeepClone(),
                    ["change"] = Math.Max(0, -dlg.Remaining), ["cashier"] = Api.I.Session?.Username ?? ""
                }
            };
            Clear(); UpdateQueue();
            PosUi.ShowReceipt(sale, _st.Settings, Loc.T("pos.saleDone"));
        }
        catch (Exception e) { _banner.Text = e.Message; }
        finally { _busy = false; }
    }

    private async Task Flush()
    {
        var q = PosUi.ReadList(PosUi.QueueFile);
        var left = new JsonArray();
        for (var i = 0; i < q.Count; i++)
        {
            try { await Api.I.PosCheckout((JsonObject)q[i]!.DeepClone()); }
            catch (Exception e) when (PosUi.Offline(e)) { for (var k = i; k < q.Count; k++) left.Add(q[k]!.DeepClone()); break; }
            catch { /* refused by the server: dropped from the queue */ }
        }
        PosUi.WriteList(PosUi.QueueFile, left);
        UpdateQueue();
        await _onShift();
    }

    private async Task Safe(Func<Task> work) { try { await work(); } catch (Exception e) { Ui.Warn(e.Message); } }
}

internal sealed class PosShifts : StackPanel
{
    private readonly State _st;
    private readonly Func<Task> _onChange;
    private readonly TextBlock _msg = Ui.Text("", 12, false, Ui.Dim), _head = Ui.Text("", 18, true), _kv = Ui.Text("");
    private readonly Button _in, _out, _close, _open;
    private readonly ComboBox _reg = new();
    private readonly TextBox _float = PosUi.NumBox();
    private readonly DataGrid _table = Ui.Grid(Loc.T("pos.code"), Loc.T("pos.cashier"), Loc.T("pos.opened"), Loc.T("pos.status"), Loc.T("pos.shift.sales"), Loc.T("pos.shift.expected"), Loc.T("pos.shift.counted"), Loc.T("pos.shift.variance"), Loc.T("pos.shift.journal"));

    public PosShifts(State st, Func<Task> onChange)
    {
        _st = st; _onChange = onChange;
        _in = Ui.Btn(Loc.T("pos.shift.cashIn"), () => _ = Safe(() => Cash("in")), "ghost");
        _out = Ui.Btn(Loc.T("pos.shift.cashOut"), () => _ = Safe(() => Cash("out")), "ghost");
        _close = Ui.Btn(Loc.T("pos.shift.close"), () => _ = Safe(Close));
        _open = Ui.Btn(Loc.T("pos.shift.open"), () => _ = Safe(Open));
        _reg.Margin = new Thickness(0, 0, 8, 0); _float.Margin = new Thickness(0, 0, 8, 0);
        var card = new StackPanel();
        card.Children.Add(_head); card.Children.Add(_kv);
        card.Children.Add(Ui.Row(_reg, _float, _open, _in, _out, _close));
        Children.Add(_msg);
        Children.Add(new Border { Child = card, Background = Brushes.White, BorderBrush = Charts.LinePen.Brush, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), Padding = new Thickness(12), Margin = new Thickness(0, 0, 0, 12) });
        Children.Add(Ui.Text(Loc.T("pos.shift.history"), 15, true));
        _table.Height = 300;
        Children.Add(_table);
    }

    public async Task Refresh()
    {
        _reg.Items.Clear(); _reg.Items.Add(new ComboBoxItem { Content = "—", Tag = "" });
        foreach (var x in _st.Registers) _reg.Items.Add(new ComboBoxItem { Content = S(x?["code"]) + " · " + S(D(x)["name"]), Tag = S(x?["code"]) });
        _reg.SelectedIndex = 0; _reg.MinWidth = 140;
        var open = _st.Shift != null;
        _reg.Visibility = _float.Visibility = _open.Visibility = open ? Visibility.Collapsed : Visibility.Visible;
        _in.Visibility = _out.Visibility = _close.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
        if (open)
        {
            var d = D(_st.Shift);
            _head.Text = Loc.T("pos.shift.current") + " · " + S(_st.Shift!["code"]);
            _kv.Text = $"{Loc.T("pos.shift.opening")}: {Money(N(d["opening"]))}    {Loc.T("pos.shift.cashSales")}: {Money(N(d["cashSales"]))}    {Loc.T("pos.shift.cardSales")}: {Money(N(d["cardSales"]) + N(d["otherSales"]))}\n"
                     + $"{Loc.T("pos.shift.refunds")}: {Money(N(d["returnsTotal"]))}    {Loc.T("pos.shift.cashIn")} / {Loc.T("pos.shift.cashOut")}: {Money(N(d["cashIn"]))} / {Money(N(d["cashOut"]))}    {Loc.T("pos.shift.sales")}: {(long)N(d["salesCount"])}";
        }
        else { _head.Text = Loc.T("pos.shift.none"); _kv.Text = ""; }
        var rows = (await Api.I.PosRecords("shift")).OfType<JsonObject>().OrderByDescending(r => S(r["createdAt"])).ToList();
        Ui.Fill(_table, rows.Select(r =>
        {
            var d = D(r);
            return (new[]
            {
                S(r["code"]), S(r["createdBy"]), PosUi.At(S(r["createdAt"])), Loc.T("pos.st." + (S(r["status"]).Length == 0 ? "Open" : S(r["status"]))), Money(N(d["salesTotal"])),
                d["expected"] != null ? Money(N(d["expected"])) : "", d["counted"] != null ? Money(N(d["counted"])) : "", S(r["status"]) == "Closed" ? Money(N(d["variance"])) : "", S(d["journal"])
            }, (object)r);
        }));
    }

    private async Task Open()
    {
        var b = new JsonObject { ["openingCash"] = PosUi.Val(_float) };
        var reg = (_reg.SelectedItem as ComboBoxItem)?.Tag as string ?? "";
        if (reg.Length > 0) b["register"] = reg;
        _st.Shift = await Api.I.PosOpen(b);
        _msg.Text = Loc.T("pos.shift.opened");
        await _onChange();
    }

    private async Task Cash(string type)
    {
        var r = PosUi.AmountDialog(Loc.T(type == "in" ? "pos.shift.cashIn" : "pos.shift.cashOut"), Loc.T("pos.amount"), Loc.T("pos.reason"), null);
        if (r == null) return;
        if (!(r.Value.amount > 0)) { Ui.Warn(Loc.T("pos.required")); return; }
        _st.Shift = await Api.I.PosCash(S(_st.Shift!["id"]), type, r.Value.amount, r.Value.note);
        _msg.Text = Loc.T("pos.saved");
        await _onChange();
    }

    private async Task Close()
    {
        var r = PosUi.AmountDialog(Loc.T("pos.shift.close"), Loc.T("pos.shift.countedCash"), Loc.T("pos.note"), Loc.T("pos.shift.closeHint"));
        if (r == null) return;
        var res = await Api.I.PosClose(S(_st.Shift!["id"]), r.Value.amount, r.Value.note);
        _st.Shift = null;
        var d = D(res);
        MessageBox.Show($"{Loc.T("pos.shift.expected")}: {Money(N(d["expected"]))}\n{Loc.T("pos.shift.counted")}: {Money(N(d["counted"]))}\n{Loc.T("pos.shift.variance")}: {Money(N(d["variance"]))}\n{Loc.T("pos.shift.journal")}: {S(d["journal"])}",
            Loc.T("pos.shift.closed") + " · " + S(res["code"]));
        await _onChange();
    }

    private async Task Safe(Func<Task> work) { try { await work(); } catch (Exception e) { Ui.Warn(e.Message); } }
}

internal sealed class PosSales : StackPanel
{
    private readonly State _st;
    private List<JsonObject> _rows = new();
    private readonly TextBox _q = Ui.Input();
    private readonly ComboBox _type = new(), _days = new();
    private readonly TextBlock _total = Ui.Text("", 12, false, Ui.Dim), _msg = Ui.Text("", 12, false, Ui.Dim);
    private readonly DataGrid _table = Ui.Grid(Loc.T("pos.code"), Loc.T("pos.date"), Loc.T("pos.cashier"), Loc.T("pos.customer"), Loc.T("pos.status"), Loc.T("pos.total"));
    private readonly Button _ret, _void;
    private bool _loading;

    public PosSales(State st)
    {
        _st = st;
        _q.ToolTip = Loc.T("pos.findReceipt"); _q.Width = 240; _q.Margin = new Thickness(0, 0, 8, 0);
        _q.TextChanged += (_, _) => Paint();
        foreach (var (t, v) in new[] { (Loc.T("pos.all"), ""), (Loc.T("pos.rc.receipt"), "Sale"), (Loc.T("pos.rc.return"), "Return") }) _type.Items.Add(new ComboBoxItem { Content = t, Tag = v });
        _type.SelectedIndex = 0; _type.SelectionChanged += (_, _) => Paint(); _type.Margin = new Thickness(0, 0, 8, 0); _type.MinWidth = 110;
        foreach (var n in new[] { 1, 7, 30, 365 }) _days.Items.Add(new ComboBoxItem { Content = n + " d", Tag = n });
        _days.SelectedIndex = 1; _days.SelectionChanged += async (_, _) => { if (!_loading) await Safe(Load); }; _days.MinWidth = 80;
        _ret = Ui.Btn(Loc.T("pos.rc.return"), () => _ = Safe(AskReturn), "ghost");
        _void = Ui.Btn(Loc.T("pos.void"), () => _ = Safe(DoVoid), "danger");
        _table.Height = 420;
        _table.SelectionChanged += (_, _) => Buttons();
        Ui.OnOpen(_table, View);
        Children.Add(Ui.Row(_q, _type, _days, _total));
        Children.Add(_msg);
        Children.Add(_table);
        Children.Add(Ui.Row(Ui.Btn(Loc.T("pos.print"), View, "ghost"), _ret, _void));
    }

    public async Task Load()
    {
        _loading = true;
        var days = (int)((_days.SelectedItem as ComboBoxItem)?.Tag ?? 7);
        _loading = false;
        var since = DateTime.Today.AddDays(-days).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        _rows = (await Api.I.PosRecords("sale", "from=" + since)).OfType<JsonObject>().OrderByDescending(r => S(r["createdAt"])).ToList();
        Paint();
    }

    private List<JsonObject> Shown()
    {
        var q = _q.Text.ToLowerInvariant().Trim(); var ty = (_type.SelectedItem as ComboBoxItem)?.Tag as string ?? "";
        return _rows.Where(s => (ty.Length == 0 || S(D(s)["type"]) == ty)
            && (q.Length == 0 || S(s["code"]).ToLowerInvariant().Contains(q) || S(s["parent"]).ToLowerInvariant().Contains(q) || S(D(s)["customerName"]).ToLowerInvariant().Contains(q) || S(s["createdBy"]).ToLowerInvariant().Contains(q))).ToList();
    }

    private void Paint()
    {
        var sh = Shown();
        Ui.Fill(_table, sh.Select(s => (new[]
        {
            S(s["code"]) + (S(s["parent"]).Length > 0 ? " ← " + S(s["parent"]) : ""), PosUi.At(S(s["createdAt"])), S(s["createdBy"]), S(D(s)["customerName"]).Length == 0 ? "—" : S(D(s)["customerName"]),
            Loc.T("pos.st." + (S(s["status"]).Length == 0 ? "Completed" : S(s["status"]))), Money(N(D(s)["total"]))
        }, (object)s)));
        _total.Text = "   " + sh.Count + " · " + Money(sh.Where(s => S(s["status"]) != "Voided").Sum(s => N(D(s)["total"])));
        Buttons();
    }

    private static bool CanReturn(JsonObject s) => Api.I.Can("pos.refund") && S(D(s)["type"]) == "Sale" && S(s["status"]) != "Voided" && S(s["status"]) != "Returned";
    private static bool CanVoid(JsonObject s) => Api.I.Can("pos.void") && S(D(s)["type"]) == "Sale" && S(s["status"]) == "Completed";

    private void Buttons()
    {
        var s = Ui.Selected<JsonObject>(_table);
        _ret.IsEnabled = s != null && CanReturn(s);
        _void.IsEnabled = s != null && CanVoid(s);
    }

    private void View()
    {
        var s = Ui.Selected<JsonObject>(_table);
        if (s != null) PosUi.ShowReceipt(s, _st.Settings, S(s["code"]));
    }

    private async Task AskReturn()
    {
        var sale = Ui.Selected<JsonObject>(_table);
        if (sale == null) return;
        var ok = false;
        var w = Ui.Dialog(Loc.T("pos.rc.return") + " · " + S(sale["code"]), 520, 520, out var body);
        var boxes = new List<(string sku, TextBox box)>();
        foreach (var l in (D(sale)["lines"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
        {
            var tb = PosUi.NumBox(0);
            boxes.Add((S(l["sku"]), tb));
            body.Children.Add(Ui.Labeled($"{S(l["name"])}  ({Loc.T("pos.sold")} {Num(N(l["qty"]))} / {Loc.T("pos.alreadyReturned")} {Num(N(l["returned"]))})", tb));
        }
        var method = new ComboBox { Margin = new Thickness(0, 0, 0, 8) };
        method.Items.Add(new ComboBoxItem { Content = Loc.T("pos.pay.cash"), Tag = "cash" }); method.Items.Add(new ComboBoxItem { Content = Loc.T("pos.pay.card"), Tag = "card" });
        method.SelectedIndex = 0;
        var reason = Ui.Input();
        body.Children.Add(Ui.Labeled(Loc.T("pos.refundMethod"), method));
        body.Children.Add(Ui.Labeled(Loc.T("pos.reason"), reason));
        var err = Ui.Text("", 12, false, Ui.Danger);
        body.Children.Add(err);
        body.Children.Add(Ui.Row(Ui.Btn(Loc.T("pos.rc.return"), () =>
        {
            if (!boxes.Any(b => PosUi.Val(b.box) > 0)) { err.Text = Loc.T("pos.pickReturn"); return; }
            ok = true; w.Close();
        }), Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog();
        if (!ok) return;
        var lines = new JsonArray();
        foreach (var (sku, box) in boxes) if (PosUi.Val(box) > 0) lines.Add(new JsonObject { ["sku"] = sku, ["qty"] = PosUi.Val(box) });
        var res = await Api.I.PosReturn(S(sale["id"]), lines, (method.SelectedItem as ComboBoxItem)?.Tag as string ?? "cash", reason.Text);
        _msg.Text = Loc.T("pos.returned");
        await Load();
        PosUi.ShowReceipt(res, _st.Settings, Loc.T("pos.returned"));
    }

    private async Task DoVoid()
    {
        var s = Ui.Selected<JsonObject>(_table);
        if (s == null || !Ui.Ask(Loc.T("pos.voidConfirm").Replace("{name}", S(s["code"])), Loc.T("pos.void"), Loc.T("common.cancel"))) return;
        await Api.I.PosVoid(S(s["id"]));
        await Load();
    }

    private async Task Safe(Func<Task> work) { try { await work(); } catch (Exception e) { Ui.Warn(e.Message); } }
}

public sealed class PosView : PageView
{
    private readonly State _state = new();
    private readonly PosTill _till;
    private readonly PosShifts _shifts;
    private readonly PosSales _sales;
    private readonly TabControl _tabs = new() { Margin = new Thickness(0, 8, 0, 0) };
    private readonly TextBlock _err = Ui.Text("", 12, false, Ui.Danger);

    public PosView()
    {
        _till = new PosTill(_state, Reload);
        _shifts = new PosShifts(_state, Reload);
        _sales = new PosSales(_state);
        Root.Children.Add(Ui.Text(Loc.T("tab.pos"), 20, true));
        Root.Children.Add(_err);
        _tabs.Items.Add(new TabItem { Header = Loc.T("pos.nav.terminal"), Content = new Border { Child = _till, Padding = new Thickness(0, 10, 0, 0) } });
        _tabs.Items.Add(new TabItem { Header = Loc.T("pos.nav.shifts"), Content = new Border { Child = _shifts, Padding = new Thickness(0, 10, 0, 0) } });
        _tabs.Items.Add(new TabItem { Header = Loc.T("pos.nav.sales"), Content = new Border { Child = _sales, Padding = new Thickness(0, 10, 0, 0) } });
        _tabs.SelectionChanged += async (s, e) => { if (ReferenceEquals(e.OriginalSource, _tabs)) await Safe(Paint); };
        Root.Children.Add(_tabs);
    }

    public override async Task Reload()
    {
        _err.Text = "";
        try { await _state.Load(); await Paint(); }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async Task Paint()
    {
        if (!_state.Loaded) return;
        switch (_tabs.SelectedIndex)
        {
            case 0: _till.Refresh(); break;
            case 1: await _shifts.Refresh(); break;
            default: await _sales.Load(); break;
        }
    }
}
