using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Workflow designer, flows list and instance monitor - driven by data/workflow.json, the spec shared by every desktop client.</summary>
public static class Wf
{
    public static readonly JsonObject Spec = (JsonObject)JsonNode.Parse(Loc.ReadData("workflow.json"))!;
    public static readonly Dictionary<string, JsonObject> Types = Spec["nodes"]!.AsArray().Select(n => (JsonObject)n!).ToDictionary(n => n["type"]!.ToString());

    public static string S(JsonNode? n) => n == null ? "" : n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n.ToString();
    public static double D(JsonNode? n) { try { return n == null ? 0 : n.GetValue<double>(); } catch { return double.TryParse(S(n), out var d) ? d : 0; } }
    public static string NewId() => Guid.NewGuid().ToString();
    public static string Perm(string k) => S(Spec["permissions"]![k]);
    public static string Shape(string type) => Types.TryGetValue(type, out var t) && t["shape"] != null ? S(t["shape"]) : "rect";
    public static (double w, double h) Size(string type) { var a = Spec["nodeSize"]![Shape(type)]!.AsArray(); return (D(a[0]), D(a[1])); }
    public static Color Hex(string h) => (Color)ColorConverter.ConvertFromString(h);
    public static Point Center(JsonObject n) { var (w, h) = Size(S(n["type"])); return new Point(D(n["x"]) + w / 2, D(n["y"]) + h / 2); }
    public static JsonObject? Node(JsonObject def, string id) => def["nodes"]!.AsArray().OfType<JsonObject>().FirstOrDefault(n => S(n["id"]) == id);
    public static string Short(string s, int n) => s.Length <= n ? s : s[..(n - 1)] + "…";

    public static JsonObject NewNode(string type, double x, double y)
    {
        var sp = Types[type];
        var n = new JsonObject { ["id"] = NewId(), ["type"] = type, ["name"] = S(sp["label"]), ["x"] = Math.Round(x), ["y"] = Math.Round(y) };
        if (type is "FormTask" or "ApprovalTask")
        {
            n["assignee"] = ""; n["priority"] = "Normal"; n["escalationMode"] = "Reassign";
            n["form"] = new JsonObject { ["id"] = NewId(), ["title"] = S(sp["label"]), ["fields"] = new JsonArray() };
        }
        if (type == "Timer") n["durationSeconds"] = 60;
        if (type == "WebhookCall") n["webhookMethod"] = "POST";
        if (type == "FileOperations") n["fileOperation"] = "Read";
        if (type == "InvokeSoapService") n["soapEnvelope"] = "<?xml version=\"1.0\"?>\n<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\">\n  <soap:Body>\n\n  </soap:Body>\n</soap:Envelope>";
        return n;
    }

    public static JsonObject BlankDef() => new()
    {
        ["id"] = "", ["name"] = "Untitled flow", ["description"] = "", ["isPublished"] = false, ["version"] = 1, ["nodes"] = new JsonArray(), ["edges"] = new JsonArray()
    };

    public static JsonObject Body(JsonObject def) => new()
    {
        ["name"] = S(def["name"]), ["description"] = S(def["description"]),
        ["nodes"] = def["nodes"]!.DeepClone(), ["edges"] = def["edges"]!.DeepClone()
    };

    public static void EnsureArrays(JsonObject d) { d["nodes"] ??= new JsonArray(); d["edges"] ??= new JsonArray(); }
}

/// <summary>Diagram surface. Editable = designer (drag, link, select); otherwise the instance process map.</summary>
public sealed class WfCanvas : Canvas
{
    public JsonObject Def;
    public readonly bool Editable;
    public bool LinkMode;
    public string? SelNode, SelEdge, LinkFrom;
    public Dictionary<string, string> States = new(), EdgeStates = new();
    public Action<string?, string?>? OnSelect;
    public Action? OnChange;
    private readonly Dictionary<string, (FrameworkElement el, Shape shape)> _nodes = new();
    private readonly List<UIElement> _edgeVisuals = new();
    private string? _drag; private Point _dragOff;
    private readonly ScaleTransform _zoom = new(1, 1);

    public WfCanvas(JsonObject def, bool editable)
    {
        Def = def; Editable = editable;
        Background = new SolidColorBrush(Color.FromRgb(0xF8, 0xFA, 0xFC));
        LayoutTransform = _zoom;
        MouseMove += OnMove;
        MouseLeftButtonUp += (_, _) => { if (_drag != null) { _drag = null; ReleaseMouseCapture(); } };
        MouseLeftButtonDown += (_, e) => { if (e.OriginalSource == this && Editable && !LinkMode) Select(null, null); };
        MouseWheel += (_, e) =>
        {
            if ((Keyboard.Modifiers & ModifierKeys.Control) == 0) return;
            var f = e.Delta > 0 ? 1.1 : 1 / 1.1;
            _zoom.ScaleX = _zoom.ScaleY = Math.Max(0.3, Math.Min(2.5, _zoom.ScaleX * f));
            e.Handled = true;
        };
        Redraw();
    }

    private JsonArray Nodes => Def["nodes"]!.AsArray();
    private JsonArray Edges => Def["edges"]!.AsArray();

    public void Changed() => OnChange?.Invoke();

    public void Select(string? nid, string? eid)
    {
        SelNode = nid; SelEdge = eid;
        Redraw();   // rebuilds the visuals so the previous selection loses its highlight
        OnSelect?.Invoke(nid, eid);
    }

    public void Redraw()
    {
        Children.Clear(); _nodes.Clear(); _edgeVisuals.Clear();
        double w = 900, h = 600;
        foreach (var n in Nodes.OfType<JsonObject>()) { w = Math.Max(w, Wf.D(n["x"]) + 260); h = Math.Max(h, Wf.D(n["y"]) + 200); }
        Width = w; Height = h;
        foreach (var n in Nodes.OfType<JsonObject>()) AddNode(n);
        RedrawEdges();
        Highlight();
    }

    private void AddNode(JsonObject n)
    {
        var id = Wf.S(n["id"]); var type = Wf.S(n["type"]); var sp = Wf.Types[type];
        var (w, h) = Wf.Size(type); var sh = Wf.Shape(type);
        Shape shape;
        if (sh == "circle") shape = new Ellipse { Width = w, Height = h };
        else if (sh == "diamond") shape = new Polygon { Points = new PointCollection { new Point(w / 2, 0), new Point(w, h / 2), new Point(w / 2, h), new Point(0, h / 2) } };
        else shape = new Rectangle { Width = w, Height = h, RadiusX = 10, RadiusY = 10 };
        shape.StrokeThickness = 2; shape.Fill = Brushes.White; shape.Stroke = new SolidColorBrush(Wf.Hex(Wf.S(sp["color"])));
        var g = new Grid { Width = w, Height = h, Cursor = Editable ? Cursors.Hand : Cursors.Arrow };
        g.Children.Add(shape);
        var icon = Wf.S(sp["icon"]);
        if (sh == "circle") g.Children.Add(new TextBlock { Text = icon, FontSize = 16, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false });
        else
        {
            var sp2 = new StackPanel { VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false };
            sp2.Children.Add(new TextBlock { Text = icon, FontSize = 15, HorizontalAlignment = HorizontalAlignment.Center });
            sp2.Children.Add(new TextBlock { Text = Wf.Short(Wf.S(n["name"]), 22), FontSize = 11, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, Foreground = Ui.Ink });
            g.Children.Add(sp2);
        }
        if (States.TryGetValue(id, out var st))
        {
            switch (st)
            {
                case "active": shape.Fill = new SolidColorBrush(Color.FromRgb(0xDC, 0xFC, 0xE7)); shape.Stroke = new SolidColorBrush(Color.FromRgb(0x16, 0xA3, 0x4A)); shape.StrokeThickness = 4; break;
                case "visited": shape.Fill = new SolidColorBrush(Color.FromRgb(0xF0, 0xFD, 0xF4)); shape.Stroke = new SolidColorBrush(Color.FromRgb(0x16, 0xA3, 0x4A)); break;
                case "rejected": shape.Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xE2, 0xE2)); shape.Stroke = new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26)); break;
                case "pending": g.Opacity = 0.5; break;
            }
        }
        SetLeft(g, Wf.D(n["x"])); SetTop(g, Wf.D(n["y"])); SetZIndex(g, 2);
        if (Editable)
        {
            g.MouseLeftButtonDown += (_, e) =>
            {
                e.Handled = true;
                if (LinkMode) { HandleLink(id); return; }
                Select(id, null);
                var cur = Wf.Node(Def, id)!;
                _drag = id; var p = e.GetPosition(this); _dragOff = new Point(p.X - Wf.D(cur["x"]), p.Y - Wf.D(cur["y"]));
                CaptureMouse();
            };
        }
        Children.Add(g);
        _nodes[id] = (g, shape);
    }

    private void OnMove(object? sender, MouseEventArgs e)
    {
        if (_drag == null || e.LeftButton != MouseButtonState.Pressed) return;
        var n = Wf.Node(Def, _drag); if (n == null || !_nodes.TryGetValue(_drag, out var v)) return;
        var p = e.GetPosition(this);
        var x = Math.Max(0, Math.Round(p.X - _dragOff.X)); var y = Math.Max(0, Math.Round(p.Y - _dragOff.Y));
        n["x"] = x; n["y"] = y; SetLeft(v.el, x); SetTop(v.el, y);
        RedrawEdges(); Changed();
    }

    private void Highlight()
    {
        foreach (var (id, v) in _nodes)
        {
            if (id == SelNode || id == LinkFrom) { v.shape.Stroke = Ui.Primary; v.shape.StrokeThickness = 4; v.shape.StrokeDashArray = id == LinkFrom ? new DoubleCollection { 3, 2 } : null; }
        }
    }

    private static Point Bez(Point a, Point b, Point c, Point d, double t)
    {
        var m = 1 - t;
        return new Point(m * m * m * a.X + 3 * m * m * t * b.X + 3 * m * t * t * c.X + t * t * t * d.X, m * m * m * a.Y + 3 * m * m * t * b.Y + 3 * m * t * t * c.Y + t * t * t * d.Y);
    }

    public void RedrawEdges()
    {
        foreach (var v in _edgeVisuals) Children.Remove(v);
        _edgeVisuals.Clear();
        foreach (var e in Edges.OfType<JsonObject>())
        {
            var a = Wf.Node(Def, Wf.S(e["sourceNodeId"])); var b = Wf.Node(Def, Wf.S(e["targetNodeId"]));
            if (a == null || b == null) continue;
            var eid = Wf.S(e["id"]);
            var s = Wf.Center(a); var t = Wf.Center(b); var dx = (t.X - s.X) * 0.5;
            Point c1 = new(s.X + dx, s.Y), c2 = new(t.X - dx, t.Y);
            var col = Color.FromRgb(0x94, 0xA3, 0xB8); double th = 2;
            if (EdgeStates.TryGetValue(eid, out var es)) { col = es == "rejected" ? Color.FromRgb(0xDC, 0x26, 0x26) : Color.FromRgb(0x16, 0xA3, 0x4A); th = 3; }
            if (eid == SelEdge) { col = Color.FromRgb(0x25, 0x63, 0xEB); th = 3; }
            var fig = new PathFigure { StartPoint = s }; fig.Segments.Add(new BezierSegment(c1, c2, t, true));
            var geo = new PathGeometry(); geo.Figures.Add(fig);
            var brush = new SolidColorBrush(col);
            var path = new System.Windows.Shapes.Path { Data = geo, Stroke = brush, StrokeThickness = th, IsHitTestVisible = false };
            var hit = new System.Windows.Shapes.Path { Data = geo, Stroke = Brushes.Transparent, StrokeThickness = 14, Cursor = Editable ? Cursors.Hand : Cursors.Arrow };
            if (Editable) hit.MouseLeftButtonDown += (_, ev) => { ev.Handled = true; if (!LinkMode) Select(null, eid); };
            // arrow head where the curve leaves the target node
            var (tw, thh) = Wf.Size(Wf.S(b["type"])); var rad = Math.Max(tw, thh) / 2 + 4; double pct = 1;
            while (pct > 0.5 && (Bez(s, c1, c2, t, pct) - t).Length < rad) pct -= 0.01;
            var tip = Bez(s, c1, c2, t, pct); var prev = Bez(s, c1, c2, t, Math.Max(pct - 0.03, 0)); var ang = Math.Atan2(tip.Y - prev.Y, tip.X - prev.X);
            var head = new Polygon
            {
                Fill = brush, IsHitTestVisible = false,
                Points = new PointCollection { tip, new Point(tip.X - 10 * Math.Cos(ang - 0.4), tip.Y - 10 * Math.Sin(ang - 0.4)), new Point(tip.X - 10 * Math.Cos(ang + 0.4), tip.Y - 10 * Math.Sin(ang + 0.4)) }
            };
            var mid = Bez(s, c1, c2, t, 0.5);
            var lbl = new TextBlock { Text = Wf.S(e["label"]), FontSize = 11, Foreground = Ui.Dim, IsHitTestVisible = false, Background = new SolidColorBrush(Color.FromArgb(200, 0xF8, 0xFA, 0xFC)) };
            SetLeft(lbl, mid.X - 14); SetTop(lbl, mid.Y - 18);
            foreach (UIElement u in new UIElement[] { path, hit, head, lbl }) { SetZIndex(u, 1); Children.Add(u); _edgeVisuals.Add(u); }
        }
    }

    public void SetLinkMode(bool on) { LinkMode = on; LinkFrom = null; Cursor = on ? Cursors.Cross : Cursors.Arrow; }

    public void HandleLink(string id)
    {
        if (LinkFrom == null) LinkFrom = id;
        else if (LinkFrom == id) LinkFrom = null;
        else
        {
            var src = Wf.Node(Def, LinkFrom)!; var st = Wf.S(src["type"]);
            bool Has(string l) => Edges.OfType<JsonObject>().Any(e => Wf.S(e["sourceNodeId"]) == LinkFrom && Wf.S(e["label"]) == l);
            var label = Wf.S(Wf.Spec["edgeDefaults"]!["default"]);
            if (st == "ApprovalTask") label = Has("Approve") ? "Reject" : "Approve";
            else if (st == "Condition") label = Has("True") ? "False" : "True";
            Edges.Add(new JsonObject { ["id"] = Wf.NewId(), ["sourceNodeId"] = LinkFrom, ["targetNodeId"] = id, ["label"] = label });
            LinkFrom = null; Redraw(); Changed();
        }
        Highlight();
    }

    public void AddNodeOfType(string type)
    {
        var k = Nodes.Count; var n = Wf.NewNode(type, 40 + (k % 5) * 180, 40 + (k / 5) * 120);
        Nodes.Add(n); Redraw(); Select(Wf.S(n["id"]), null); Changed();
    }

    public void DeleteSelected()
    {
        if (SelNode != null)
        {
            var id = SelNode;
            foreach (var n in Nodes.OfType<JsonObject>().Where(n => Wf.S(n["id"]) == id).ToList()) Nodes.Remove(n);
            foreach (var e in Edges.OfType<JsonObject>().Where(e => Wf.S(e["sourceNodeId"]) == id || Wf.S(e["targetNodeId"]) == id).ToList()) Edges.Remove(e);
        }
        else if (SelEdge != null)
        {
            foreach (var e in Edges.OfType<JsonObject>().Where(e => Wf.S(e["id"]) == SelEdge).ToList()) Edges.Remove(e);
        }
        else return;
        SelNode = SelEdge = null; Redraw(); OnSelect?.Invoke(null, null); Changed();
    }
}

public sealed record WfItem(string Label, string Value) { public override string ToString() => Label; }

/// <summary>Task-form builder: title + fields (7 types, dropdown options, required, read-only).</summary>
public sealed class WfFormWindow
{
    private readonly JsonObject _form;
    private readonly TextBox _title;
    private readonly StackPanel _rows = new();
    private readonly Window _win;

    private sealed class Row
    {
        public string Id = ""; public TextBox Key = Ui.Input(), Label = Ui.Input(), Options = Ui.Input(); public ComboBox Type = new(); public CheckBox Req = new(), Ro = new();
    }
    private readonly List<Row> _list = new();

    public WfFormWindow(JsonObject form)
    {
        _form = form;
        _win = Ui.Dialog(Loc.T("wf.form"), 980, 520, out var body);
        _title = Ui.Input(Wf.S(form["title"]));
        body.Children.Add(Ui.Labeled(Loc.T("wf.formTitle"), _title));
        var head = new Grid();
        foreach (var w in new[] { 1.0, 1.4, 0.9, 0.6, 0.6, 2.0, 0.4 }) head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(w, GridUnitType.Star) });
        var heads = new[] { "Key", "Label", "Type", "Required", "Read-only", "Options (label=value; …)", "" };
        for (var i = 0; i < heads.Length; i++) { var t = Ui.Text(heads[i], 12, true, Ui.Dim); Grid.SetColumn(t, i); head.Children.Add(t); }
        body.Children.Add(head);
        body.Children.Add(_rows);
        foreach (var f in form["fields"]!.AsArray().OfType<JsonObject>()) AddRow(f);
        body.Children.Add(Ui.Row(Ui.Btn("+ " + Loc.T("wf.addField"), () => AddRow(null), "ghost"), Ui.Btn("OK", () => { Commit(); _win.Close(); }), Ui.Btn(Loc.T("wf.no"), () => _win.Close(), "ghost")));
    }

    public void Show() => _win.ShowDialog();

    private void AddRow(JsonObject? f)
    {
        var r = new Row { Id = f != null ? Wf.S(f["id"]) : Wf.NewId() };
        r.Key.Text = f != null ? Wf.S(f["key"]) : ""; r.Label.Text = f != null ? Wf.S(f["label"]) : "";
        foreach (var t in Wf.Spec["fieldTypes"]!.AsArray()) r.Type.Items.Add(Wf.S(t));
        r.Type.SelectedItem = f != null && Wf.S(f["type"]) != "" ? Wf.S(f["type"]) : "Text";
        r.Req.IsChecked = f?["required"]?.GetValue<bool>() == true; r.Ro.IsChecked = f?["readOnly"]?.GetValue<bool>() == true;
        r.Options.Text = f?["options"] is JsonArray oa ? string.Join("; ", oa.OfType<JsonObject>().Select(o => $"{Wf.S(o["label"])}={Wf.S(o["value"])}")) : "";
        var g = new Grid();
        foreach (var w in new[] { 1.0, 1.4, 0.9, 0.6, 0.6, 2.0, 0.4 }) g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(w, GridUnitType.Star) });
        var del = Ui.Btn("✕", () => { _rows.Children.Remove(g); _list.Remove(r); }, "danger");
        var cells = new UIElement[] { r.Key, r.Label, r.Type, r.Req, r.Ro, r.Options, del };
        for (var i = 0; i < cells.Length; i++)
        {
            if (cells[i] is FrameworkElement fe) fe.Margin = new Thickness(0, 0, 6, 8);
            Grid.SetColumn(cells[i], i); g.Children.Add(cells[i]);
        }
        _rows.Children.Add(g); _list.Add(r);
    }

    private void Commit()
    {
        var fields = new JsonArray();
        foreach (var r in _list)
        {
            var opts = new JsonArray();
            foreach (var part in r.Options.Text.Split(';').Select(p => p.Trim()).Where(p => p != ""))
            {
                var i = part.IndexOf('=');
                opts.Add(new JsonObject { ["label"] = (i < 0 ? part : part[..i]).Trim(), ["value"] = (i < 0 ? part : part[(i + 1)..]).Trim() });
            }
            fields.Add(new JsonObject
            {
                ["id"] = r.Id, ["key"] = r.Key.Text.Trim(), ["label"] = r.Label.Text.Trim(), ["type"] = r.Type.SelectedItem?.ToString() ?? "Text",
                ["required"] = r.Req.IsChecked == true, ["readOnly"] = r.Ro.IsChecked == true, ["options"] = opts
            });
        }
        _form["title"] = _title.Text.Trim(); _form["fields"] = fields;
    }
}

/// <summary>The designer window: palette, canvas, property panel, save / publish / run.</summary>
public sealed class WfDesigner
{
    private JsonObject _def = Wf.BlankDef();
    private readonly WfCanvas _canvas;
    private readonly TextBox _name = Ui.Input(), _desc = Ui.Input();
    private readonly TextBlock _badge = Ui.Text("", 13, true), _status = Ui.Text(Loc.T("wf.hint"), 12, false, Ui.Dim);
    private readonly StackPanel _panel = new() { Margin = new Thickness(10) };
    private readonly Button _save, _pub, _run, _del, _link;
    private readonly Window _win;
    private JsonArray _users = new(), _published = new();
    private List<string> _roles = new();
    private readonly bool _canDesign = Api.I.Can(Wf.Perm("design"));
    private readonly string? _defId;

    public WfDesigner(string? defId)
    {
        _defId = defId;
        _win = new Window
        {
            Title = Loc.T("wf.designer"), Width = 1400, Height = 860, WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = Ui.Bg, FlowDirection = Loc.Flow,
            Owner = Application.Current.Windows.OfType<Window>().FirstOrDefault(x => x.IsActive) ?? Application.Current.MainWindow
        };
        _canvas = new WfCanvas(_def, true) { OnSelect = OnSelect };
        _name.TextChanged += (_, _) => _def["name"] = _name.Text;
        _desc.TextChanged += (_, _) => _def["description"] = _desc.Text;
        _link = Ui.Btn(Loc.T("wf.link"), () => { _link!.Tag = _link.Tag == null ? "on" : null; _canvas.SetLinkMode(_link.Tag != null); _link.Background = _link.Tag != null ? Ui.Danger : Brushes.White; _status.Text = _link.Tag != null ? Loc.T("wf.linkHint") : Loc.T("wf.hint"); }, "ghost");
        _del = Ui.Btn(Loc.T("wf.delete"), () => _canvas.DeleteSelected(), "ghost");
        _save = Ui.Btn(Loc.T("wf.save"), () => _ = Safe(() => Save()));
        _pub = Ui.Btn(Loc.T("wf.publish"), () => _ = Safe(Publish), "ghost");
        _run = Ui.Btn(Loc.T("wf.run"), () => _ = Safe(Run), "ghost");

        var top = new DockPanel { Margin = new Thickness(10, 8, 10, 0) };
        var btns = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var b in new[] { _link, _del, _save, _pub, _run }) btns.Children.Add(b);
        DockPanel.SetDock(btns, Dock.Right); DockPanel.SetDock(_badge, Dock.Right);
        _name.Width = 260; _name.Margin = new Thickness(0, 0, 8, 0);
        _badge.Margin = new Thickness(8, 6, 12, 0);
        top.Children.Add(btns); top.Children.Add(_badge);
        DockPanel.SetDock(_name, Dock.Left); top.Children.Add(_name); top.Children.Add(_desc);

        var palette = new StackPanel();
        foreach (var cat in Wf.Spec["categories"]!.AsArray().Select(c => Wf.S(c)))
        {
            var list = new StackPanel();
            foreach (var n in Wf.Spec["nodes"]!.AsArray().OfType<JsonObject>().Where(n => Wf.S(n["category"]) == cat))
            {
                var type = Wf.S(n["type"]);
                var b = new Button { Content = $"{Wf.S(n["icon"])}  {Wf.S(n["label"])}", HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(8, 5, 8, 5), Margin = new Thickness(0, 1, 0, 1), Background = Brushes.White, BorderThickness = new Thickness(0), ToolTip = Wf.S(n["note"]) };
                b.Click += (_, _) => { if (_canDesign) _canvas.AddNodeOfType(type); };
                list.Children.Add(b);
            }
            palette.Children.Add(new Expander { Header = cat, Content = list, IsExpanded = cat is "Human Activities" or "BPMN Elements", Margin = new Thickness(0, 0, 0, 4) });
        }
        var left = new ScrollViewer { Content = palette, Width = 230, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Margin = new Thickness(8) };
        var right = new ScrollViewer { Content = _panel, Width = 380, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Brushes.White };
        var center = new ScrollViewer { Content = _canvas, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };

        var dock = new DockPanel();
        DockPanel.SetDock(top, Dock.Top); DockPanel.SetDock(_status, Dock.Bottom); DockPanel.SetDock(left, Dock.Left); DockPanel.SetDock(right, Dock.Right);
        _status.Margin = new Thickness(10, 4, 10, 6);
        dock.Children.Add(top); dock.Children.Add(_status); dock.Children.Add(left); dock.Children.Add(right); dock.Children.Add(center);
        _win.Content = dock;
        foreach (var c in new Control[] { _link, _del, _save, _name, _desc }) c.IsEnabled = _canDesign;
        _pub.IsEnabled = false; _run.IsEnabled = false;
        ShowEmpty(); Apply();
        _win.Loaded += async (_, _) => await Safe(LoadAll);
    }

    public void Show() => _win.ShowDialog();

    private async Task Safe(Func<Task> work) { try { await work(); } catch (Exception e) { Ui.Warn(e.Message); } }

    private async Task LoadAll()
    {
        try
        {
            _users = await Api.I.WfList("/users");
            _roles = _users.OfType<JsonObject>().Select(u => Wf.S(u["role"])).Where(r => r != "").Distinct().OrderBy(r => r).ToList();
        }
        catch { /* the assignee picker just stays empty */ }
        if (_defId != null) { _def = await Api.I.WfDefinition(_defId); Wf.EnsureArrays(_def); _canvas.Def = _def; _canvas.Redraw(); Apply(); }
        var all = await Api.I.WfList("/definitions");
        _published = new JsonArray(all.OfType<JsonObject>().Where(d => d["isPublished"]?.GetValue<bool>() == true && Wf.S(d["id"]) != Wf.S(_def["id"])).Select(d => (JsonNode)d.DeepClone()).ToArray());
    }

    private void Apply()
    {
        _name.Text = Wf.S(_def["name"]); _desc.Text = Wf.S(_def["description"]);
        var pub = _def["isPublished"]?.GetValue<bool>() == true;
        _badge.Text = pub ? $"● {Loc.T("wf.published")} v{Wf.S(_def["version"])}" : $"○ {Loc.T("wf.draft")}";
        _badge.Foreground = pub ? new SolidColorBrush(Color.FromRgb(0x16, 0xA3, 0x4A)) : new SolidColorBrush(Color.FromRgb(0xD9, 0x77, 0x06));
        _pub.IsEnabled = Wf.S(_def["id"]) != "" && !pub && Api.I.Can(Wf.Perm("publish"));
        _run.IsEnabled = pub;
    }

    // ---- property panel
    private void ShowEmpty() { _panel.Children.Clear(); _panel.Children.Add(Ui.Text(Loc.T("wf.selectHint"), 13, false, Ui.Dim)); }

    private void OnSelect(string? nid, string? eid)
    {
        if (nid != null) BuildNode(Wf.Node(_def, nid)!);
        else if (eid != null) BuildEdge(_def["edges"]!.AsArray().OfType<JsonObject>().First(e => Wf.S(e["id"]) == eid));
        else ShowEmpty();
    }

    private void BuildEdge(JsonObject e)
    {
        _panel.Children.Clear();
        _panel.Children.Add(Ui.Text(Loc.T("wf.edge"), 16, true));
        var src = Wf.Node(_def, Wf.S(e["sourceNodeId"])); var st = src == null ? "" : Wf.S(src["type"]);
        if (st == "Condition")
        {
            var c = new ComboBox { IsEnabled = _canDesign, Margin = new Thickness(0, 0, 0, 8) };
            c.Items.Add("True"); c.Items.Add("False"); c.SelectedItem = Wf.S(e["label"]);
            c.SelectionChanged += (_, _) => { e["label"] = c.SelectedItem?.ToString() ?? ""; _canvas.RedrawEdges(); };
            _panel.Children.Add(Ui.Labeled(Loc.T("wf.edgeLabel"), c));
        }
        else
        {
            var t = Ui.Input(Wf.S(e["label"]), _canDesign);
            t.TextChanged += (_, _) => { e["label"] = t.Text; _canvas.RedrawEdges(); };
            _panel.Children.Add(Ui.Labeled(Loc.T("wf.edgeLabel"), t));
        }
        if (st == "ApprovalTask") _panel.Children.Add(Ui.Text(Loc.T("wf.edgeApprovalHint"), 11, false, Ui.Dim));
    }

    private void SetVal(JsonObject n, string key, JsonNode? v, bool rebuild)
    {
        if (v == null || (v is JsonValue jv && jv.TryGetValue<string>(out var s) && s == "" && key != "name")) n.Remove(key); else n[key] = v;
        if (key == "name") _canvas.Redraw();
        if (rebuild) _win.Dispatcher.BeginInvoke(new Action(() => BuildNode(n)));
    }

    private void BuildNode(JsonObject n)
    {
        _panel.Children.Clear();
        var sp = Wf.Types[Wf.S(n["type"])];
        _panel.Children.Add(Ui.Text($"{Wf.S(sp["icon"])} {Wf.S(sp["label"])}", 16, true));
        _panel.Children.Add(Ui.Text(Wf.S(sp["note"]), 11, false, Ui.Dim));
        var referenced = Wf.Spec["nodes"]!.AsArray().OfType<JsonObject>().SelectMany(x => x["props"]!.AsArray().OfType<JsonObject>()).Where(p => p["showIf"] != null).Select(p => Wf.S(p["showIf"]!["key"])).ToHashSet();
        var props = Wf.Spec["common"]!.AsArray().OfType<JsonObject>().Concat(sp["props"]!.AsArray().OfType<JsonObject>());
        foreach (var p in props)
        {
            if (p["showIf"] is JsonObject si)
            {
                var cur = Wf.S(n[Wf.S(si["key"])]);
                if ((si["eq"] != null && cur != Wf.S(si["eq"])) || (si["ne"] != null && cur == Wf.S(si["ne"]))) continue;
            }
            var w = Editor(n, p, referenced.Contains(Wf.S(p["key"])));
            if (w == null) continue;
            w.IsEnabled = _canDesign || Wf.S(p["kind"]) == "form";
            _panel.Children.Add(Ui.Labeled(Wf.S(p["label"]), w));
            if (p["hint"] != null && Wf.S(p["kind"]) != "form") _panel.Children.Add(Ui.Text(Wf.S(p["hint"]), 11, false, Ui.Dim));
        }
    }

    private FrameworkElement? Editor(JsonObject n, JsonObject p, bool rebuild)
    {
        var k = Wf.S(p["key"]); var kind = Wf.S(p["kind"]);
        switch (kind)
        {
            case "text":
            {
                var t = Ui.Input(Wf.S(n[k]));
                t.TextChanged += (_, _) => SetVal(n, k, JsonValue.Create(t.Text), false);
                if (Wf.S(p["test"]) != "condition") return t;
                var box = new StackPanel();
                box.Children.Add(t);
                var data = new TextBox { Text = "{\n  \"days\": 6\n}", AcceptsReturn = true, Height = 70, Margin = new Thickness(0, 0, 0, 6) };
                var outp = Ui.Text("", 12);
                box.Children.Add(Ui.Text(Loc.T("wf.sampleData"), 12, false, Ui.Dim)); box.Children.Add(data);
                box.Children.Add(Ui.Btn("▶ " + Loc.T("wf.test"), async () =>
                {
                    JsonObject? d;
                    try { d = JsonNode.Parse(data.Text) as JsonObject; } catch { d = null; }
                    if (d == null) { outp.Text = Loc.T("wf.badJson"); return; }
                    try
                    {
                        var r = await Api.I.WfTest(Wf.S(n["conditionExpression"]), d);
                        var ok = r["result"]?.GetValue<bool>() == true;
                        outp.Text = $"{Loc.T("wf.result")}: {(ok ? "True" : "False")}\n" + string.Join("\n", (r["clauses"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Select(c => (c["result"]?.GetValue<bool>() == true ? "✓ " : "✕ ") + Wf.S(c["clause"])));
                        outp.Foreground = ok ? new SolidColorBrush(Color.FromRgb(0x16, 0xA3, 0x4A)) : Ui.Danger;
                    }
                    catch (Exception ex) { outp.Text = ex.Message; }
                }, "ghost"));
                box.Children.Add(outp);
                return box;
            }
            case "textarea":
            {
                var t = new TextBox { Text = Wf.S(n[k]), AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 90, Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8), VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
                t.TextChanged += (_, _) => SetVal(n, k, JsonValue.Create(t.Text), false);
                return t;
            }
            case "number":
            {
                var t = Ui.Input(n[k] == null ? "" : Wf.S(n[k]));
                t.TextChanged += (_, _) => SetVal(n, k, int.TryParse(t.Text, out var v) && v != 0 ? JsonValue.Create(v) : null, false);
                return t;
            }
            case "bool":
            {
                var c = new CheckBox { IsChecked = n[k]?.GetValue<bool>() == true, Margin = new Thickness(0, 2, 0, 8) };
                c.Click += (_, _) => SetVal(n, k, JsonValue.Create(c.IsChecked == true), rebuild);
                return c;
            }
            case "select":
            {
                var opts = p["options"]!.AsArray().Select(o => Wf.S(o)).ToList();
                var c = new ComboBox { Margin = new Thickness(0, 0, 0, 8) };
                foreach (var o in opts) c.Items.Add(new WfItem(o == "" ? "— none (stub) —" : o, o));
                var cur = Wf.S(n[k]);
                c.SelectedIndex = Math.Max(0, opts.IndexOf(cur));
                c.SelectionChanged += (_, _) => { if (c.SelectedItem is WfItem it) SetVal(n, k, JsonValue.Create(it.Value), rebuild); };
                return c;
            }
            case "assignees":
            {
                var chosen = Wf.S(n[k]).Split(',').Select(s => s.Trim()).Where(s => s != "").ToHashSet();
                var list = new StackPanel();
                void Upd() => SetVal(n, k, JsonValue.Create(string.Join(",", list.Children.OfType<CheckBox>().Where(c => c.IsChecked == true).Select(c => (string)c.Tag))), false);
                void Add(string text, string val)
                {
                    var c = new CheckBox { Content = text, Tag = val, IsChecked = chosen.Contains(val), Margin = new Thickness(0, 2, 0, 2) };
                    c.Click += (_, _) => Upd(); list.Children.Add(c);
                }
                foreach (var r in _roles) Add("role: " + r, r);
                foreach (var u in _users.OfType<JsonObject>()) Add($"{Wf.S(u["displayName"])} ({Wf.S(u["username"])})", Wf.S(u["username"]));
                return new ScrollViewer { Content = list, MaxHeight = 150, Margin = new Thickness(0, 0, 0, 8), BorderBrush = Brushes.LightGray, BorderThickness = new Thickness(1), VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            }
            case "assignee1":
            case "workflow":
            {
                var c = new ComboBox { Margin = new Thickness(0, 0, 0, 8) };
                c.Items.Add(new WfItem("", ""));
                if (kind == "assignee1")
                {
                    foreach (var r in _roles) c.Items.Add(new WfItem("role: " + r, r));
                    foreach (var u in _users.OfType<JsonObject>()) c.Items.Add(new WfItem($"{Wf.S(u["displayName"])} ({Wf.S(u["username"])})", Wf.S(u["username"])));
                }
                else foreach (var d in _published.OfType<JsonObject>()) c.Items.Add(new WfItem(Wf.S(d["name"]), Wf.S(d["id"])));
                var cur = Wf.S(n[k]);
                c.SelectedItem = c.Items.OfType<WfItem>().FirstOrDefault(i => i.Value == cur) ?? c.Items[0];
                c.SelectionChanged += (_, _) =>
                {
                    if (c.SelectedItem is not WfItem it) return;
                    SetVal(n, k, JsonValue.Create(it.Value), false);
                    if (kind == "workflow") SetVal(n, "subWorkflowDefinitionName", it.Value == "" ? null : JsonValue.Create(it.Label), false);
                };
                return c;
            }
            case "form":
            {
                if (n["form"] is not JsonObject) n["form"] = new JsonObject { ["id"] = Wf.NewId(), ["title"] = Wf.S(n["name"]), ["fields"] = new JsonArray() };
                var form = (JsonObject)n["form"]!;
                var b = new Button { Padding = new Thickness(8), Margin = new Thickness(0, 0, 0, 8), Background = Ui.Primary, Foreground = Brushes.White, BorderThickness = new Thickness(0) };
                void Label() => b.Content = Loc.T("wf.editForm", ("n", form["fields"]!.AsArray().Count.ToString()));
                Label();
                b.Click += (_, _) => { new WfFormWindow(form).Show(); Label(); };
                return b;
            }
        }
        return null;
    }

    // ---- server
    private async Task Save(Action? then = null)
    {
        var saved = await Api.I.WfSave(Wf.S(_def["id"]), Wf.Body(_def));
        Wf.EnsureArrays(saved); _def = saved; _canvas.Def = saved; _canvas.Redraw(); Apply();
        _status.Text = Loc.T("wf.saved");
        then?.Invoke();
    }

    private async Task Publish()
    {
        var nodes = _def["nodes"]!.AsArray().OfType<JsonObject>().ToList();
        if (nodes.Count(n => Wf.S(n["type"]) == "Start") != 1) { Ui.Warn(Loc.T("wf.needStart")); return; }
        if (!nodes.Any(n => Wf.S(n["type"]) == "End")) { Ui.Warn(Loc.T("wf.needEnd")); return; }
        await Save();
        var pub = await Api.I.WfPublish(Wf.S(_def["id"]));
        foreach (var kv in pub.ToList()) if (kv.Key is not ("nodes" or "edges")) _def[kv.Key] = kv.Value?.DeepClone();
        Apply(); _status.Text = Loc.T("wf.publishedMsg");
    }

    private async Task Run()
    {
        var inst = await Api.I.WfStart(Wf.S(_def["id"]));
        _status.Text = Loc.T("wf.started", ("id", Wf.S(inst["id"])));
        new WfInstanceWindow(Wf.S(inst["id"])).Show();
    }
}

/// <summary>One run: live process map (polls while running), timeline, collected data, activity log, cancel.</summary>
public sealed class WfInstanceWindow
{
    private readonly string _id;
    private JsonObject _inst = new(), _def = new();
    private bool _haveDef;
    private WfCanvas? _canvas;
    private readonly Window _win;
    private readonly TextBlock _head = Ui.Text("…", 20, true), _meta = Ui.Text("", 12, false, Ui.Dim);
    private readonly Button _cancel;
    private readonly ListBox _timeline = new(), _log = new();
    private readonly DataGrid _data = Ui.Grid(Loc.T("wf.key"), Loc.T("wf.value"));
    private readonly ContentControl _mapHost = new();
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(3) };

    public WfInstanceWindow(string id)
    {
        _id = id;
        _win = new Window
        {
            Title = Loc.T("wf.instance"), Width = 1100, Height = 780, WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = Ui.Bg, FlowDirection = Loc.Flow,
            Owner = Application.Current.Windows.OfType<Window>().FirstOrDefault(x => x.IsActive) ?? Application.Current.MainWindow
        };
        _cancel = Ui.Btn(Loc.T("wf.cancelReq"), async () =>
        {
            if (!Ui.Ask(Loc.T("wf.cancelConfirm"), Loc.T("wf.yes"), Loc.T("wf.no"))) return;
            try { await Api.I.WfCancel(_id); await Refresh(); } catch (Exception e) { Ui.Warn(e.Message); }
        }, "danger");
        _cancel.IsEnabled = false;
        var legend = Ui.Text($"● {Loc.T("wf.legActive")}   ● {Loc.T("wf.legDone")}   ● {Loc.T("wf.legRejected")}   ● {Loc.T("wf.legPending")}", 12, false, Ui.Dim);
        var tabs = new TabControl { Height = 230 };
        tabs.Items.Add(new TabItem { Header = Loc.T("wf.timeline"), Content = _timeline });
        tabs.Items.Add(new TabItem { Header = Loc.T("wf.data"), Content = _data });
        tabs.Items.Add(new TabItem { Header = Loc.T("wf.activityLog"), Content = _log });
        var top = new DockPanel { Margin = new Thickness(12, 8, 12, 0) };
        DockPanel.SetDock(_cancel, Dock.Right); top.Children.Add(_cancel); top.Children.Add(_head);
        var head = new StackPanel(); head.Children.Add(top); head.Children.Add(new Border { Child = _meta, Margin = new Thickness(12, 0, 12, 0) }); head.Children.Add(new Border { Child = legend, Margin = new Thickness(12, 0, 12, 4) });
        var dock = new DockPanel();
        DockPanel.SetDock(head, Dock.Top); DockPanel.SetDock(tabs, Dock.Bottom);
        dock.Children.Add(head); dock.Children.Add(tabs); dock.Children.Add(_mapHost);
        _win.Content = dock;
        _timer.Tick += async (_, _) => { try { await Refresh(); } catch { /* next tick */ } };
        _win.Closed += (_, _) => _timer.Stop();
        _win.Loaded += async (_, _) => { try { await Refresh(); } catch (Exception e) { Ui.Warn(e.Message); } _timer.Start(); };
    }

    public void Show() => _win.ShowDialog();

    private async Task Refresh()
    {
        _inst = await Api.I.WfInstance(_id);
        if (!_haveDef && Wf.S(_inst["definitionId"]) != "") { _haveDef = true; _def = await Api.I.WfDefinition(Wf.S(_inst["definitionId"])); Wf.EnsureArrays(_def); }
        Paint();
        try
        {
            var log = await Api.I.WfList($"/instances/{_id}/activity-log");
            _log.Items.Clear();
            foreach (var l in log.OfType<JsonObject>()) _log.Items.Add($"{Wf.S(l["timestamp"]).Replace('T', ' ')}   {Wf.S(l["nodeName"])} — {Wf.S(l["action"])}   {(Wf.S(l["actor"]) == "" ? "system" : Wf.S(l["actor"]))}");
        }
        catch { /* log is optional */ }
        if (Wf.S(_inst["status"]) != "Running") _timer.Stop();
    }

    private void Paint()
    {
        _head.Text = $"{Wf.S(_inst["definitionName"])} — {Wf.S(_inst["status"])}";
        _meta.Text = $"{Loc.T("wf.startedBy")} {Wf.S(_inst["startedBy"])} · {Wf.S(_inst["startedAt"])}";
        var me = Api.I.Session;
        _cancel.IsEnabled = Wf.S(_inst["status"]) == "Running" && me != null && (me.Username == Wf.S(_inst["startedBy"]) || me.Role == "admin");
        _timeline.Items.Clear();
        HashSet<string> visited = new(), rejected = new(), active = new();
        foreach (var h in (_inst["history"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
        {
            var ts = Wf.S(h["timestamp"]); ts = ts.Length > 16 ? ts[..16].Replace('T', ' ') : ts;
            _timeline.Items.Add($"{ts}   {Wf.S(h["nodeName"])} — {Wf.S(h["action"])}" + (Wf.S(h["actor"]) != "" ? $"  · {Wf.S(h["actor"])}" : "") + (Wf.S(h["comment"]) != "" ? $"   “{Wf.S(h["comment"])}”" : ""));
            var nid = Wf.S(h["nodeId"]); var a = Wf.S(h["action"]);
            if (nid != "") { visited.Add(nid); if (a is "Rejected" or "Canceled" or "Escalated") rejected.Add(nid); }
        }
        var rows = new List<(string[] cells, object payload)>();
        if (_inst["data"] is JsonObject d) foreach (var kv in d) rows.Add((new[] { kv.Key, Wf.S(kv.Value) }, kv.Key));
        Ui.Fill(_data, rows);
        if (!_haveDef || _def["nodes"] == null) return;
        if (Wf.S(_inst["status"]) == "Running" && _inst["currentNodeIds"] is JsonArray cur) foreach (var c in cur) active.Add(Wf.S(c));
        if (_canvas == null) { _canvas = new WfCanvas(_def, false); _mapHost.Content = new ScrollViewer { Content = _canvas, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }; }
        _canvas.States.Clear(); _canvas.EdgeStates.Clear();
        foreach (var n in _def["nodes"]!.AsArray().OfType<JsonObject>())
        {
            var nid = Wf.S(n["id"]);
            _canvas.States[nid] = rejected.Contains(nid) ? "rejected" : active.Contains(nid) ? "active" : visited.Contains(nid) ? "visited" : "pending";
        }
        foreach (var e in _def["edges"]!.AsArray().OfType<JsonObject>())
        {
            var s = Wf.S(e["sourceNodeId"]); var t = Wf.S(e["targetNodeId"]);
            if (visited.Contains(s) && (visited.Contains(t) || active.Contains(t))) _canvas.EdgeStates[Wf.S(e["id"])] = rejected.Contains(t) ? "rejected" : "ok";
        }
        _canvas.Redraw();
    }
}

/// <summary>The "Workflow designer" page: flows (open / new / run / delete) and running / completed / canceled instances.</summary>
public sealed class WorkflowView : PageView
{
    private readonly TabControl _tabs = new() { MinHeight = 480 };
    private readonly DataGrid _defs = Ui.Grid(Loc.T("wf.name"), Loc.T("wf.version"), Loc.T("wf.steps"), Loc.T("wf.status"), Loc.T("wf.description"));
    private readonly Dictionary<string, DataGrid> _inst = new();
    private readonly string[] _order = { "Running", "Completed", "Terminated" };

    public WorkflowView()
    {
        Root.Children.Add(Ui.Text(Loc.T("tab.workflow"), 20, true));
        var canDesign = Api.I.Can(Wf.Perm("design"));
        var nw = Ui.Btn("+ " + Loc.T("wf.new"), () => { new WfDesigner(null).Show(); _ = Safe(Reload); }); nw.IsEnabled = canDesign;
        var del = Ui.Btn(Loc.T("wf.delete"), () => _ = Safe(Remove), "ghost"); del.IsEnabled = canDesign;
        var flows = new StackPanel();
        flows.Children.Add(Ui.Row(nw, Ui.Btn(Loc.T("wf.open"), Open, "ghost"), Ui.Btn(Loc.T("wf.run"), () => _ = Safe(Start), "ghost"), del));
        flows.Children.Add(_defs);
        Ui.OnOpen(_defs, Open);
        _tabs.Items.Add(new TabItem { Header = Loc.T("wf.flows"), Content = flows });
        foreach (var k in _order)
        {
            var g = Ui.Grid(Loc.T("wf.name"), Loc.T("wf.status"), Loc.T("wf.startedBy"), Loc.T("wf.startedAt"));
            Ui.OnOpen(g, () => { var r = Ui.Selected<JsonObject>(g); if (r != null) { new WfInstanceWindow(Wf.S(r["id"])).Show(); _ = Safe(Reload); } });
            _inst[k] = g;
            _tabs.Items.Add(new TabItem { Header = k, Content = g });
        }
        Root.Children.Add(_tabs);
    }

    public override async Task Reload()
    {
        if (Api.I.Can(Wf.Perm("view")))
        {
            var defs = await Api.I.WfList("/definitions");
            Ui.Fill(_defs, defs.OfType<JsonObject>().Select(d => (new[]
            {
                Wf.S(d["name"]), "v" + (d["version"] == null ? "1" : Wf.S(d["version"])), (d["nodes"] as JsonArray)?.Count.ToString() ?? "0",
                d["isPublished"]?.GetValue<bool>() == true ? Loc.T("wf.published") : Loc.T("wf.draft"), Wf.S(d["description"])
            }, (object)d)));
        }
        try
        {
            var inst = (await Api.I.WfList("/instances")).OfType<JsonObject>().ToList();
            for (var i = 0; i < _order.Length; i++)
            {
                var key = _order[i];
                var sub = inst.Where(x => Wf.S(x["status"]) == key).ToList();
                Ui.Fill(_inst[key], sub.Select(r => (new[] { Wf.S(r["definitionName"]), Wf.S(r["status"]), Wf.S(r["startedBy"]), Wf.S(r["startedAt"]).Replace('T', ' ') }, (object)r)));
                ((TabItem)_tabs.Items[i + 1]).Header = $"{Loc.T(key == "Running" ? "wf.running" : key == "Completed" ? "wf.completed" : "wf.canceled")} ({sub.Count})";
            }
        }
        catch { /* instances are optional for this user */ }
    }

    private void Open()
    {
        var d = Ui.Selected<JsonObject>(_defs);
        if (d != null) { new WfDesigner(Wf.S(d["id"])).Show(); _ = Safe(Reload); }
    }

    private async Task Start()
    {
        var d = Ui.Selected<JsonObject>(_defs); if (d == null) return;
        if (d["isPublished"]?.GetValue<bool>() != true) { Ui.Warn(Loc.T("wf.notPublished")); return; }
        var i = await Api.I.WfStart(Wf.S(d["id"]));
        new WfInstanceWindow(Wf.S(i["id"])).Show();
        await Reload();
    }

    private async Task Remove()
    {
        var d = Ui.Selected<JsonObject>(_defs); if (d == null) return;
        if (!Ui.Ask(Loc.T("wf.deleteConfirm", ("name", Wf.S(d["name"]))), Loc.T("wf.yes"), Loc.T("wf.no"))) return;
        await Api.I.WfDelete(Wf.S(d["id"]));
        await Reload();
    }
}
