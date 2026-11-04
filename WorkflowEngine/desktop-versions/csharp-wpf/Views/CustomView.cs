using System.Globalization;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Custom modules: design a module (name, icon, fields) and keep its records. Everything is generated from the module definition,
/// exactly as in the portal; the validation and the privileges (cus.view / cus.manage / cus.design) are on the server.</summary>
internal static class CusEngine
{
    private static JsonObject? _spec;
    public static JsonObject Spec => _spec ??= (JsonObject)JsonNode.Parse(Loc.ReadData("custom.json"))!;
    public static string S(JsonNode? n) => SiteEngine.Js(n);
    public static string Title(JsonObject m) { var d = (JsonObject)(m["def"] ?? new JsonObject()); return Loc.Lang == "ar" && S(d["titleAr"]).Length > 0 ? S(d["titleAr"]) : S(d["title"]); }
    public static string FLabel(JsonObject f) => Loc.Lang == "ar" && S(f["labelAr"]).Length > 0 ? S(f["labelAr"]) : S(f["label"]);
    public static string Cell(JsonObject f, JsonObject r)
    {
        var v = (r["data"] as JsonObject)?[S(f["key"])];
        if (S(f["type"]) == "checkbox") return v is JsonValue b && b.TryGetValue<bool>(out var x) && x ? "✓" : "";
        return v is null ? "" : S(v);
    }
}

internal sealed class CusFieldDialog
{
    public JsonObject F; public bool Accepted; private readonly Window _w;
    private readonly TextBox _name, _ar, _opt; private readonly ComboBox _type = new() { Margin = new Thickness(0, 0, 0, 8) }; private readonly CheckBox _req = new() { Content = Loc.T("cus.required"), Margin = new Thickness(0, 0, 0, 8) };
    private readonly List<string> _types = new();

    public CusFieldDialog(JsonObject fo)
    {
        F = (JsonObject)fo.DeepClone();
        _name = Ui.Input(CusEngine.S(F["label"])); _ar = Ui.Input(CusEngine.S(F["labelAr"]));
        var opts = (F["options"] as JsonArray ?? new JsonArray()).Select(o => CusEngine.S(o));
        _opt = Ui.Input(string.Join(", ", opts));
        foreach (var k in (JsonArray)CusEngine.Spec["types"]!) { _type.Items.Add(Loc.T("cus.t." + CusEngine.S(k))); _types.Add(CusEngine.S(k)); }
        var cur = F["type"] is null ? "text" : CusEngine.S(F["type"]);
        _type.SelectedIndex = Math.Max(0, _types.IndexOf(cur)); _req.IsChecked = F["required"] is JsonValue rv && rv.TryGetValue<bool>(out var rb) && rb;
        _w = Ui.Dialog(Loc.T("cus.fields"), 420, 420, out var body);
        body.Children.Add(Ui.Labeled(Loc.T("cus.fieldName"), _name)); body.Children.Add(Ui.Labeled(Loc.T("cus.fieldNameAr"), _ar)); body.Children.Add(_type); body.Children.Add(_req);
        body.Children.Add(Ui.Labeled(Loc.T("cus.options"), _opt)); body.Children.Add(Ui.Btn(Loc.T("cal.save"), Ok));
    }
    public bool Show() { _w.ShowDialog(); return Accepted; }
    private void Ok()
    {
        F["label"] = _name.Text.Trim(); F["labelAr"] = _ar.Text.Trim().Length == 0 ? null : _ar.Text.Trim();
        var ty = _types[Math.Max(0, _type.SelectedIndex)]; F["type"] = ty; F["required"] = _req.IsChecked == true;
        var o = new JsonArray();
        if (ty == "select") foreach (var s in Regex.Split(_opt.Text, "[,،;]")) if (s.Trim().Length > 0) o.Add(s.Trim());
        F["options"] = o; Accepted = true; _w.Close();
    }
}

internal sealed class CusDesigner
{
    private readonly JsonObject? _mod; private readonly JsonObject _d; private readonly Func<JsonObject, Task> _onSaved; private readonly Window _w;
    private readonly TextBox _name, _ar, _color; private readonly ComboBox _icon = new() { Margin = new Thickness(0, 0, 0, 8) }; private readonly List<string> _icons = new();
    private readonly DataGrid _grid; private readonly TextBlock _err = new() { Foreground = Ui.Danger, TextWrapping = TextWrapping.Wrap };

    public CusDesigner(JsonObject? mod, Func<JsonObject, Task> onSaved)
    {
        _mod = mod; _onSaved = onSaved;
        _d = mod is null ? (JsonObject)JsonNode.Parse("{\"title\":\"\",\"titleAr\":\"\",\"icon\":\"grid\",\"color\":\"#6366f1\",\"fields\":[{\"key\":\"\",\"label\":\"\",\"type\":\"text\",\"required\":true}]}")! : (JsonObject)mod["def"]!.DeepClone();
        _name = Ui.Input(CusEngine.S(_d["title"])); _ar = Ui.Input(CusEngine.S(_d["titleAr"])); _color = Ui.Input(_d["color"] is null ? "#6366f1" : CusEngine.S(_d["color"]));
        foreach (var i in (JsonArray)CusEngine.Spec["icons"]!) { _icon.Items.Add(CusEngine.S(i)); _icons.Add(CusEngine.S(i)); }
        _icon.SelectedIndex = Math.Max(0, _icons.IndexOf(_d["icon"] is null ? "grid" : CusEngine.S(_d["icon"])));
        _grid = Ui.Grid(Loc.T("cus.fieldName"), Loc.T("cus.fieldNameAr"), "Type", Loc.T("cus.required"), Loc.T("cus.options")); _grid.Height = 240; Ui.OnOpen(_grid, Edit);
        _w = Ui.Dialog(mod is null ? Loc.T("cus.newModule") : Loc.T("cus.design"), 700, 640, out var body);
        body.Children.Add(Ui.Labeled(Loc.T("cus.name") + " *", _name)); body.Children.Add(Ui.Labeled(Loc.T("cus.nameAr"), _ar)); body.Children.Add(Ui.Labeled(Loc.T("cus.icon"), _icon)); body.Children.Add(Ui.Labeled(Loc.T("cus.color"), _color));
        body.Children.Add(Ui.Text(Loc.T("cus.fields"), 13, true)); body.Children.Add(_grid);
        body.Children.Add(Ui.Row(Ui.Btn("+ " + Loc.T("cus.addField"), Add, "ghost"), Ui.Btn(Loc.T("web.edit"), Edit, "ghost"), Ui.Btn("↑", () => Move(-1), "ghost"), Ui.Btn("↓", () => Move(1), "ghost"), Ui.Btn("✕", Remove, "ghost")));
        body.Children.Add(_err);
        body.Children.Add(Ui.Row(Ui.Btn(Loc.T("cal.close"), () => _w.Close(), "ghost"), Ui.Btn(Loc.T("cal.save"), () => SiteEngine.Run(Save))));
        Refresh(0);
    }
    public void Show() => _w.ShowDialog();

    private JsonArray Fields => (JsonArray)_d["fields"]!;
    private void Refresh(int sel)
    {
        Ui.Fill(_grid, Fields.Select((fv, n) =>
        {
            var f = (JsonObject)fv!; var o = string.Join(", ", (f["options"] as JsonArray ?? new JsonArray()).Select(x => CusEngine.S(x)));
            return (new[] { CusEngine.S(f["label"]), CusEngine.S(f["labelAr"]), Loc.T("cus.t." + (f["type"] is null ? "text" : CusEngine.S(f["type"]))), f["required"] is JsonValue rv && rv.TryGetValue<bool>(out var rb) && rb ? "✓" : "", o }, (object)n);
        }));
        if (Fields.Count > 0) _grid.SelectedIndex = Math.Min(sel, Fields.Count - 1);
    }
    private void Add()
    {
        var d = new CusFieldDialog((JsonObject)JsonNode.Parse("{\"key\":\"\",\"label\":\"\",\"type\":\"text\"}")!);
        if (d.Show()) { Fields.Add(d.F); Refresh(Fields.Count - 1); }
    }
    private void Edit()
    {
        var i = _grid.SelectedIndex; if (i < 0 || i >= Fields.Count) return;
        var d = new CusFieldDialog((JsonObject)Fields[i]!);
        if (d.Show()) { Fields[i] = d.F; Refresh(i); }
    }
    private void Move(int n)
    {
        var i = _grid.SelectedIndex; if (i < 0 || i + n < 0 || i + n >= Fields.Count) return;
        var node = Fields[i]; Fields.RemoveAt(i); Fields.Insert(i + n, node); Refresh(i + n);
    }
    private void Remove() { var i = _grid.SelectedIndex; if (i >= 0 && i < Fields.Count) { Fields.RemoveAt(i); Refresh(i); } }

    private async Task Save()
    {
        var body = (JsonObject)_d.DeepClone();
        body["title"] = _name.Text.Trim(); body["titleAr"] = _ar.Text.Trim().Length == 0 ? null : _ar.Text.Trim(); body["icon"] = _icons[Math.Max(0, _icon.SelectedIndex)];
        body["color"] = _color.Text.Trim().Length == 0 ? "#6366f1" : _color.Text.Trim();
        var fs = new JsonArray();
        foreach (var f in Fields) if (CusEngine.S(f!["label"]).Trim().Length > 0) fs.Add(f.DeepClone());
        body["fields"] = fs;
        try
        {
            var res = (_mod is null ? await Api.I.Ops(HttpMethod.Post, "/custom/modules", body) : await Api.I.Ops(HttpMethod.Put, "/custom/modules/" + CusEngine.S(_mod["key"]), body)) as JsonObject ?? new JsonObject();
            _w.Close(); await _onSaved(res);
        }
        catch (Exception e) { _err.Text = e.Message; }
    }
}

internal sealed class CusRecordDialog
{
    private readonly JsonObject _mod; private readonly JsonObject? _rec; private readonly Func<Task> _onSaved; private readonly Window _w;
    private readonly Dictionary<string, Control> _c = new(); private readonly TextBlock _err = new() { Foreground = Ui.Danger, TextWrapping = TextWrapping.Wrap };

    public CusRecordDialog(JsonObject mod, JsonObject? rec, bool canEdit, Func<Task> onSaved)
    {
        _mod = mod; _rec = rec; _onSaved = onSaved;
        var fs = (JsonArray)((JsonObject)mod["def"]!)["fields"]!; var data = rec?["data"] as JsonObject ?? new JsonObject();
        _w = Ui.Dialog(rec is null ? Loc.T("cus.new") : CusEngine.S(rec["code"]), 500, Math.Min(760, 180 + 66 * fs.Count), out var body);
        foreach (var fv in fs)
        {
            var f = (JsonObject)fv!; var k = CusEngine.S(f["key"]); var ty = CusEngine.S(f["type"]); var v = data[k]; Control c;
            if (ty == "textarea") c = new TextBox { Text = v is null ? "" : CusEngine.S(v), AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 70, Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8) };
            else if (ty == "select")
            {
                var cb = new ComboBox { Margin = new Thickness(0, 0, 0, 8) }; cb.Items.Add("");
                foreach (var o in (f["options"] as JsonArray ?? new JsonArray())) cb.Items.Add(CusEngine.S(o));
                cb.SelectedItem = v is null ? "" : CusEngine.S(v); if (cb.SelectedIndex < 0) cb.SelectedIndex = 0; c = cb;
            }
            else if (ty == "checkbox") c = new CheckBox { IsChecked = v is JsonValue bv && bv.TryGetValue<bool>(out var bb) && bb, Margin = new Thickness(0, 0, 0, 8) };
            else c = Ui.Input(v is null ? "" : CusEngine.S(v));
            c.IsEnabled = canEdit; _c[k] = c;
            body.Children.Add(Ui.Labeled(CusEngine.FLabel(f) + (f["required"] is JsonValue rv && rv.TryGetValue<bool>(out var rb) && rb ? " *" : ""), c));
        }
        body.Children.Add(_err);
        var row = new List<UIElement>();
        if (canEdit) { row.Add(Ui.Btn(Loc.T("cal.save"), () => SiteEngine.Run(Save))); if (rec is not null) row.Add(Ui.Btn(Loc.T("cal.delete"), () => SiteEngine.Run(Del), "danger")); }
        row.Add(Ui.Btn(Loc.T("cal.close"), () => _w.Close(), "ghost"));
        body.Children.Add(Ui.Row(row.ToArray()));
    }
    public void Show() => _w.ShowDialog();

    public JsonObject Values()
    {
        var o = new JsonObject();
        foreach (var fv in (JsonArray)((JsonObject)_mod["def"]!)["fields"]!)
        {
            var f = (JsonObject)fv!; var k = CusEngine.S(f["key"]); var ty = CusEngine.S(f["type"]); var c = _c[k];
            if (ty == "select") o[k] = ((ComboBox)c).SelectedItem as string ?? "";
            else if (ty == "checkbox") o[k] = ((CheckBox)c).IsChecked == true;
            else
            {
                var s = ((TextBox)c).Text; if (ty != "textarea") s = s.Trim();
                if (ty == "number" && s.Length > 0 && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var x)) o[k] = x == Math.Floor(x) ? JsonValue.Create((long)x) : JsonValue.Create(x);
                else o[k] = s;
            }
        }
        return o;
    }
    private async Task Save()
    {
        var key = CusEngine.S(_mod["key"]); var body = new JsonObject { ["data"] = Values() };
        try
        {
            if (_rec is null) await Api.I.Ops(HttpMethod.Post, "/custom/records/" + key, body);
            else await Api.I.Ops(HttpMethod.Put, "/custom/records/" + key + "/" + CusEngine.S(_rec["id"]), body);
            _w.Close(); await _onSaved();
        }
        catch (Exception e) { _err.Text = e.Message; }
    }
    private async Task Del()
    {
        if (!Ui.Ask(Loc.T("cal.delete") + "?", Loc.T("cal.delete"), Loc.T("cal.close"))) return;
        try { await Api.I.Ops(HttpMethod.Delete, "/custom/records/" + CusEngine.S(_mod["key"]) + "/" + CusEngine.S(_rec!["id"])); _w.Close(); await _onSaved(); }
        catch (Exception e) { _err.Text = e.Message; }
    }
}

public sealed class CustomView : PageView
{
    private readonly ComboBox _pick = new() { MinWidth = 220, Margin = new Thickness(0, 0, 8, 0) };
    private readonly TextBox _search = Ui.Input(); private readonly Button _bNew, _bMod, _bDes, _bDel;
    private readonly Border _host = new() { MinHeight = 340 }; private DataGrid _grid = Ui.Grid();
    private readonly TextBlock _msg = new() { Margin = new Thickness(0, 6, 0, 0) };
    private JsonArray _mods = new(); private bool _quiet;

    public CustomView()
    {
        Root.Children.Add(Ui.Text(Loc.T("tab.cus"), 20, true));
        _bNew = Ui.Btn(Loc.T("cus.new"), () => OpenRec(null)); _bMod = Ui.Btn(Loc.T("cus.newModule"), () => Design(null), "ghost");
        _bDes = Ui.Btn(Loc.T("cus.design"), () => Design(Cur()), "ghost"); _bDel = Ui.Btn("✕ " + Loc.T("cus.name"), () => _ = Safe(DelModule), "danger");
        _search.Width = 200; _search.Margin = new Thickness(0, 0, 8, 0); _search.ToolTip = Loc.T("cus.search");
        _search.KeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) _ = Safe(LoadRecords); };
        _pick.SelectionChanged += async (_, _) => { if (!_quiet) await Safe(LoadRecords); };
        var bar = new WrapPanel { Margin = new Thickness(0, 8, 0, 8) };
        foreach (UIElement e in new UIElement[] { _pick, _search, _bNew, _bMod, _bDes, _bDel }) bar.Children.Add(e);
        Root.Children.Add(bar);
        _host.Child = _grid; Root.Children.Add(_host); Root.Children.Add(_msg);
    }

    private JsonObject? Cur() { var i = _pick.SelectedIndex; return i >= 0 && i < _mods.Count ? _mods[i] as JsonObject : null; }

    public override Task Reload() => ReloadKeep(Cur() is { } c ? CusEngine.S(c["key"]) : "");

    private async Task ReloadKeep(string keep)
    {
        _bMod.Visibility = Api.I.Can("cus.design") ? Visibility.Visible : Visibility.Collapsed;
        _mods = await Api.I.Ops(HttpMethod.Get, "/custom/modules") as JsonArray ?? new JsonArray();
        _quiet = true; _pick.Items.Clear();
        var sel = 0; var n = 0;
        foreach (var m in _mods) { _pick.Items.Add(CusEngine.Title((JsonObject)m!)); if (CusEngine.S(m!["key"]) == keep) sel = n; n++; }
        _pick.SelectedIndex = _mods.Count == 0 ? -1 : sel; _quiet = false;
        await LoadRecords();
    }

    private async Task LoadRecords()
    {
        var m = Cur();
        var can = m is not null;
        _bNew.Visibility = can && Api.I.Can("cus.manage") ? Visibility.Visible : Visibility.Collapsed;
        _bDes.Visibility = _bDel.Visibility = can && Api.I.Can("cus.design") ? Visibility.Visible : Visibility.Collapsed;
        if (m is null) { _grid = Ui.Grid(); _host.Child = _grid; _msg.Text = Loc.T("cus.empty"); return; }
        var cols = ((JsonArray)((JsonObject)m["def"]!)["fields"]!).Take(6).Select(f => (JsonObject)f!).ToList();
        _grid = Ui.Grid(new[] { "#" }.Concat(cols.Select(CusEngine.FLabel)).ToArray()); _host.Child = _grid;
        Ui.OnOpen(_grid, () => OpenRec(Ui.Selected<JsonObject>(_grid)));
        var rows = await Api.I.Ops(HttpMethod.Get, "/custom/records/" + CusEngine.S(m["key"]) + "?q=" + Uri.EscapeDataString(_search.Text.Trim())) as JsonArray ?? new JsonArray();
        Ui.Fill(_grid, rows.Select(rv => { var r = (JsonObject)rv!; return (new[] { CusEngine.S(r["code"]) }.Concat(cols.Select(f => CusEngine.Cell(f, r))).ToArray(), (object)r); }));
        _msg.Text = rows.Count == 0 ? Loc.T("cus.none") : Loc.T("cus.sub", ("n", rows.Count.ToString()));
    }

    private void OpenRec(JsonObject? rec)
    {
        var m = Cur(); if (m is null || (rec is null && !Api.I.Can("cus.manage"))) return;
        new CusRecordDialog(m, rec, Api.I.Can("cus.manage"), LoadRecords).Show();
    }

    private void Design(JsonObject? mod)
    {
        if (mod is null && !Api.I.Can("cus.design")) return;
        new CusDesigner(mod, saved => ReloadKeep(CusEngine.S(saved["key"]))).Show();
    }

    private async Task DelModule()
    {
        var m = Cur(); if (m is null || !Ui.Ask(Loc.T("cal.delete") + " " + CusEngine.Title(m) + "?", Loc.T("cal.delete"), Loc.T("cal.close"))) return;
        await Api.I.Ops(HttpMethod.Delete, "/custom/modules/" + CusEngine.S(m["key"]));
        await ReloadKeep("");
    }
}
