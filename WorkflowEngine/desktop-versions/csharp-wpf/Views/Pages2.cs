using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

// ------------------------------------------------------------------------------------------------ ERP browser
public sealed class ErpView : PageView
{
    private readonly TreeView _tree = new() { Width = 230, Margin = new Thickness(0, 0, 12, 0) };
    private readonly TextBlock _head = Ui.Text(Loc.T("erp.title"), 20, true);
    private readonly TextBox _search = new() { Padding = new Thickness(6), Margin = new Thickness(0, 0, 8, 0), MinWidth = 260 };
    private readonly System.Windows.Controls.DataGrid _grid = Ui.Grid(Loc.T("erp.code"), Loc.T("erp.name"), Loc.T("erp.status"), Loc.T("erp.company"));
    private readonly TextBlock _msg = Ui.Text("", 13, false, Ui.Dim);
    private readonly Button _btnNew, _btnDelF, _btnAct;
    private readonly ComboBox _status = new() { MinWidth = 120, Margin = new Thickness(0, 0, 8, 0), Padding = new Thickness(6) };
    private readonly ComboBox _saved = new() { MinWidth = 150, Margin = new Thickness(0, 0, 8, 0), Padding = new Thickness(6) };
    private bool _busy;
    private CatalogModule? _module;
    private CatalogKind? _kind;
    private List<ErpRec> _rows = new();

    public ErpView()
    {
        foreach (var m in Loc.VisibleModules())
        {
            var top = new TreeViewItem { Header = m.Name(Loc.Rtl), Tag = (m, (CatalogKind?)null) };
            foreach (var k in m.Kinds.Where(k => Api.I.Can(k.View)))
                top.Items.Add(new TreeViewItem { Header = k.Name(Loc.Rtl), Tag = (m, (CatalogKind?)k) });
            _tree.Items.Add(top);
        }
        _tree.SelectedItemChanged += (_, _) => Picked();

        _btnNew = Ui.Btn("+ " + Loc.T("erp.new"), New);
        _btnNew.IsEnabled = false;
        _btnAct = Ui.Btn(Loc.T("erp.actions"), ActMenu, "ghost");
        _btnAct.Visibility = Visibility.Collapsed;
        _search.TextChanged += (_, _) => { if (!_busy) Refill(); };
        _status.SelectionChanged += (_, _) => { if (!_busy) Refill(); };
        _saved.SelectionChanged += (_, _) => { if (!_busy) ApplySaved(); };
        _btnDelF = Ui.Btn("🗑", () => _ = DeleteFilter(), "ghost");
        _btnDelF.IsEnabled = false;
        SetStatuses(new List<string>(), "");
        SetSaved(new List<JsonObject>());
        _grid.Height = 520;
        Ui.OnOpen(_grid, Edit);
        if (Loc.VisibleModules().Count == 0) _msg.Text = Loc.T("erp.noModules");

        var right = new StackPanel { MinWidth = 600 };
        right.Children.Add(_head);
        var bar = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 8) };
        bar.Children.Add(_search); bar.Children.Add(_status); bar.Children.Add(_saved);
        bar.Children.Add(Ui.Btn("🔖", () => _ = SaveFilter(), "ghost")); bar.Children.Add(_btnDelF);
        bar.Children.Add(_btnNew); bar.Children.Add(_btnAct); bar.Children.Add(Ui.Btn("🖨", PrintReport, "ghost")); bar.Children.Add(Ui.Btn(Loc.T("common.refresh"), () => _ = Reload(), "ghost"));
        right.Children.Add(bar);
        right.Children.Add(_grid);
        right.Children.Add(_msg);

        var dock = new DockPanel();
        DockPanel.SetDock(_tree, Dock.Left);
        _tree.Height = 640;
        dock.Children.Add(_tree);
        dock.Children.Add(right);
        Root.Children.Add(dock);
    }

    public void Select(string moduleId, string? kindId)
    {
        foreach (TreeViewItem top in _tree.Items)
        {
            var (m, _) = ((CatalogModule, CatalogKind?))top.Tag;
            if (m.Id != moduleId) continue;
            top.IsExpanded = true;
            var target = top.Items.Count > 0 ? (TreeViewItem)top.Items[0] : top;
            if (kindId != null)
                foreach (TreeViewItem c in top.Items)
                    if (((CatalogModule, CatalogKind?))c.Tag is var (_, k) && k?.Kind == kindId) { target = c; break; }
            target.IsSelected = true;
            return;
        }
    }

    private void Picked()
    {
        if (_tree.SelectedItem is not TreeViewItem item) return;
        var (m, k) = ((CatalogModule, CatalogKind?))item.Tag;
        if (k == null)
        {
            item.IsExpanded = true;
            if (item.Items.Count > 0) ((TreeViewItem)item.Items[0]).IsSelected = true;
            return;
        }
        _module = m; _kind = k;
        _head.Text = $"{m.Name(Loc.Rtl)} › {k.Name(Loc.Rtl)}";
        _btnNew.IsEnabled = Api.I.Can(k.Manage) && !k.ReadOnly;
        _btnAct.Visibility = k.Actions.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        _busy = true; _search.Text = ""; SetStatuses(new List<string>(), ""); _busy = false;
        _ = LoadFilters();
        _ = Reload();
    }

    // ---- statuses and saved filters (same store as the portal: search text + status, optionally shared with the workspace)
    private sealed class Opt { public string Label { get; set; } = ""; public string Value { get; set; } = ""; public JsonObject? Data { get; set; } public override string ToString() => Label; }

    private string ViewKey => $"{_module?.Id}:{_kind?.Kind}";
    private string StatusValue => (_status.SelectedItem as Opt)?.Value ?? "";

    private void SetStatuses(List<string> have, string current)
    {
        var was = _busy; _busy = true;
        _status.Items.Clear();
        _status.Items.Add(new Opt { Label = Loc.T("collab.allStatus"), Value = "" });
        foreach (var s in have) _status.Items.Add(new Opt { Label = s, Value = s });
        _status.SelectedIndex = 0;
        foreach (var o in _status.Items.OfType<Opt>()) if (o.Value == current) { _status.SelectedItem = o; break; }
        _busy = was;
    }

    private void SetSaved(List<JsonObject> rows)
    {
        var was = _busy; _busy = true;
        _saved.Items.Clear();
        _saved.Items.Add(new Opt { Label = Loc.T("collab.savedFilters") });
        foreach (var c in rows)
        {
            var shared = c["shared"] is JsonValue sv && sv.TryGetValue<bool>(out var sh) && sh;
            var mine = c["mine"] is JsonValue mv && mv.TryGetValue<bool>(out var mi) && mi;
            _saved.Items.Add(new Opt { Label = (shared && !mine ? "👥 " : "") + (c["name"]?.ToString() ?? ""), Data = c });
        }
        _saved.SelectedIndex = 0;
        _btnDelF.IsEnabled = false;
        _busy = was;
    }

    private static bool Mine(JsonObject? c) => c?["mine"] is JsonValue mv && mv.TryGetValue<bool>(out var mi) && mi;

    private async Task LoadFilters()
    {
        var (m, k) = (_module, _kind);
        try
        {
            var rows = (await Api.I.Filters(ViewKey)).OfType<JsonObject>().ToList();
            if (m == _module && k == _kind) SetSaved(rows);
        }
        catch { /* saved filters are optional */ }
    }

    private void ApplySaved()
    {
        var c = (_saved.SelectedItem as Opt)?.Data;
        var d = c?["data"] as JsonObject;
        _busy = true;
        _search.Text = d?["q"]?.ToString() ?? "";
        var st = d?["status"]?.ToString() ?? "";
        _status.SelectedIndex = 0;
        foreach (var o in _status.Items.OfType<Opt>()) if (o.Value == st) { _status.SelectedItem = o; break; }
        _busy = false;
        _btnDelF.IsEnabled = Mine(c);
        Refill();
    }

    private async Task SaveFilter()
    {
        if (_module == null || _kind == null) return;
        var w = Ui.Dialog(Loc.T("collab.saveFilter"), 380, 230, out var body);
        var name = Ui.Input();
        var share = new CheckBox { Content = Loc.T("collab.shareWorkspace"), Margin = new Thickness(0, 0, 0, 10) };
        var ok = false;
        body.Children.Add(Ui.Labeled(Loc.T("collab.filterName"), name));
        body.Children.Add(share);
        body.Children.Add(Ui.Row(Ui.Btn(Loc.T("admin.save"), () => { ok = true; w.Close(); }), Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
        w.ShowDialog();
        if (!ok || string.IsNullOrWhiteSpace(name.Text)) return;
        try
        {
            await Api.I.SaveFilter(ViewKey, name.Text.Trim(), share.IsChecked == true, new JsonObject { ["q"] = _search.Text.Trim(), ["status"] = StatusValue });
            await LoadFilters();
        }
        catch (Exception e) { _msg.Text = e.Message; }
    }

    private async Task DeleteFilter()
    {
        var c = (_saved.SelectedItem as Opt)?.Data;
        if (!Mine(c)) return;
        try { await Api.I.DeleteFilter(c!["id"]!.ToString()); await LoadFilters(); }
        catch (Exception e) { _msg.Text = e.Message; }
    }

    public override async Task Reload()
    {
        if (_module == null || _kind == null) return;
        var (m, k) = (_module, _kind);
        _msg.Text = Loc.T("common.loading");
        try
        {
            var list = await Api.I.Records(m.Id, k.Kind);
            if (m != _module || k != _kind) return;
            _rows = list;
            Refill();
        }
        catch (Exception e) { _msg.Text = e.Message; }
    }

    private void Refill()
    {
        // the status list follows the statuses present in the loaded rows
        var cur = StatusValue;
        var have = _rows.Select(r => r.Status ?? "").Where(s => s != "").Distinct().OrderBy(s => s, StringComparer.Ordinal).ToList();
        if (!have.SequenceEqual(_status.Items.OfType<Opt>().Skip(1).Select(o => o.Value))) SetStatuses(have, cur);
        cur = StatusValue;
        var q = _search.Text.Trim().ToLowerInvariant();
        var shown = _rows.Where(r => (string.IsNullOrEmpty(q) || $"{r.Code} {r.Status} {r.Ref} {r.Data}".ToLowerInvariant().Contains(q))
                                      && (cur == "" || (r.Status ?? "") == cur)).ToList();
        Ui.Fill(_grid, shown.Select(r => (new[] { r.Code ?? "", r.Str("name") ?? r.Str("title") ?? r.Str("description") ?? r.Ref ?? "", r.Status ?? "", r.Company ?? "" }, (object)r)));
        _shown = shown;
        _msg.Text = shown.Count == 0 ? Loc.T("erp.none") : "";
    }

    private List<ErpRec> _shown = new();

    private void PrintReport()
    {
        if (_kind == null) return;
        var keys = new[] { "code", "name", "status", "company" };
        var labs = new[] { "erp.code", "erp.name", "erp.status", "erp.company" };
        var cols = keys.Select((k, i) => new Report.Column(k, Loc.T(labs[i]), false)).ToList();
        var rows = _shown.Select(r => new Dictionary<string, string>
        {
            ["code"] = r.Code ?? "", ["name"] = r.Str("name") ?? r.Str("title") ?? r.Str("description") ?? r.Ref ?? "", ["status"] = r.Status ?? "", ["company"] = r.Company ?? ""
        }).ToList();
        Report.Show(ViewKey, _kind.Name(Loc.Rtl), cols, rows, Api.I.Session?.DisplayName ?? "");
    }


    // ---- workflow actions of the newer modules (sales orders, helpdesk, subscriptions, expenses, quality, fleet)
    private void ActMenu()
    {
        var r = Ui.Selected<ErpRec>(_grid);
        if (r == null || _kind == null) return;
        var acts = _kind.Actions.Where(a => a.When.Contains(r.Status ?? "") && Api.I.Can(a.Priv)).ToList();
        if (acts.Count == 0) { Ui.Warn(Loc.T("erp.noActions")); return; }
        var menu = new ContextMenu { PlacementTarget = _btnAct, Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom };
        foreach (var a in acts)
        {
            var item = new MenuItem { Header = a.Name(Loc.Rtl) };
            var act = a;
            item.Click += (_, _) => RunAct(r, act);
            menu.Items.Add(item);
        }
        menu.IsOpen = true;
    }

    private async void RunAct(ErpRec r, CatalogAction a)
    {
        if (_module == null || _kind == null) return;
        var body = new JsonObject();
        if (a.Ask.Count > 0)
        {
            var w = Ui.Dialog(a.Name(Loc.Rtl), 420, 120 + 70 * a.Ask.Count, out var panel);
            var boxes = new Dictionary<string, TextBox>();
            foreach (var f in a.Ask)
            {
                var title = f == "note" ? (Loc.Rtl ? a.NoteAr : a.NoteEn) ?? Loc.T("erp.note") : Loc.T(f == "user" ? "erp.actUser" : f == "method" ? "erp.actMethod" : f == "amount" ? "erp.actHours" : "erp.actCost");
                var tb = Ui.Input(f == "method" ? "Transfer" : f == "amount" || f == "cost" ? "0" : "");
                boxes[f] = tb;
                panel.Children.Add(Ui.Labeled(title, tb));
            }
            var ok = false;
            panel.Children.Add(Ui.Row(Ui.Btn(Loc.T("common.save"), () => { ok = true; w.Close(); }), Ui.Btn(Loc.T("common.cancel"), () => w.Close(), "ghost")));
            w.ShowDialog();
            if (!ok) return;
            foreach (var kv in boxes)
            {
                var v = kv.Value.Text.Trim();
                if (kv.Key == "amount" || kv.Key == "cost") body[kv.Key] = double.TryParse(v, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0;
                else if (v.Length > 0) body[kv.Key] = v;
            }
        }
        else if (a.Danger && !Ui.Ask(a.Name(Loc.Rtl) + "?", Loc.T("common.yes"), Loc.T("common.no"))) return;
        try { await Api.I.BizAction(_module.Id, _kind.Kind, r.Id, a.Op, body); await Reload(); }
        catch (Exception ex) { Ui.Warn(ex.Message); }
    }

    private async void New()
    {
        if (_module != null && _kind != null && RecordEditor.Show(_module, _kind, null)) await Reload();
    }

    private async void Edit()
    {
        var r = Ui.Selected<ErpRec>(_grid);
        if (r != null && _module != null && _kind != null && RecordEditor.Show(_module, _kind, r)) await Reload();
    }
}

// ------------------------------------------------------------------------------------------------ record editor
/// <summary>Header fields plus one row per simple key of data (numbers and yes/no keep their type).</summary>
public sealed class RecordEditor
{
    private sealed class Field { public string Key = ""; public string Type = "str"; public string Value = ""; }

    private readonly CatalogModule _m;
    private readonly CatalogKind _k;
    private readonly ErpRec? _rec;
    private readonly bool _editable;
    private readonly TextBox _code, _status, _company, _ref, _newKey = Ui.Input();
    private readonly DataGrid _grid = new() { AutoGenerateColumns = false, CanUserAddRows = false, Height = 230, Margin = new Thickness(0, 0, 0, 8) };
    private readonly TextBlock _err = Ui.Text("", 13, false, Ui.Danger);
    private JsonObject _data;
    private List<Field> _fields = new();
    private Window _w = null!;
    private bool _changed;

    private RecordEditor(CatalogModule m, CatalogKind k, ErpRec? rec)
    {
        _m = m; _k = k; _rec = rec;
        _editable = Api.I.Can(k.Manage) && !k.ReadOnly;
        _data = rec == null ? (k.Template != null ? (JsonObject)k.Template.DeepClone() : new JsonObject()) : (JsonObject)JsonNode.Parse(rec.Data.ToJsonString())!;
        _code = Ui.Input(rec?.Code ?? "", _editable && rec == null);
        _status = Ui.Input(rec?.Status ?? "", _editable);
        _company = Ui.Input(rec?.Company ?? "", _editable);
        _ref = Ui.Input(rec?.Ref ?? "", _editable);
    }

    public static bool Show(CatalogModule m, CatalogKind k, ErpRec? rec) => new RecordEditor(m, k, rec).Run();

    private bool Run()
    {
        _w = Ui.Dialog(_rec?.Code ?? Loc.T("erp.new"), 580, 760, out var body);
        var tabs = new TabControl { Margin = new Thickness(0, 0, 0, 8) };
        var dataBody = new StackPanel { Margin = new Thickness(10) };
        tabs.Items.Add(new TabItem { Header = Loc.T("collab.tab.data"), Content = dataBody });
        if (_rec != null && !string.IsNullOrEmpty(_rec.Id))
            tabs.Items.Add(new TabItem { Header = Loc.T("collab.notes") + " / " + Loc.T("collab.files"), Content = new ChatterView(_m.Id, _k.Kind, _rec.Id) { Margin = new Thickness(6) } });
        body.Children.Add(tabs);
        var data = body;           // the editor's fields go on the Data tab; the error line and buttons stay below the tabs
        body = dataBody;
        if (!_editable) body.Children.Add(Ui.Text(Loc.T("erp.readOnly"), 12, false, Ui.Dim));
        body.Children.Add(Ui.Labeled(Loc.T("erp.code"), _code));
        body.Children.Add(Ui.Labeled(Loc.T("erp.status"), _status));
        body.Children.Add(Ui.Labeled(Loc.T("erp.company"), _company));
        body.Children.Add(Ui.Labeled(Loc.T("erp.ref"), _ref));
        body.Children.Add(Ui.Text(Loc.T("erp.data"), 15, true));

        _grid.IsReadOnly = !_editable;
        _grid.Columns.Add(new DataGridTextColumn { Header = Loc.T("erp.fieldName"), Binding = new System.Windows.Data.Binding(nameof(Field.Key)) { Mode = System.Windows.Data.BindingMode.OneWay }, IsReadOnly = true, Width = new DataGridLength(1, DataGridLengthUnitType.Star) });
        _grid.Columns.Add(new DataGridTextColumn { Header = Loc.T("erp.fieldValue"), Binding = new System.Windows.Data.Binding(nameof(Field.Value)), Width = new DataGridLength(2, DataGridLengthUnitType.Star) });
        Rebuild();
        body.Children.Add(_grid);

        if (_editable)
            body.Children.Add(Ui.Row(_newKey, Ui.Btn(Loc.T("erp.addField"), AddField, "ghost"), Ui.Btn(Loc.T("erp.removeField"), RemoveField, "ghost")));
        body = data;
        body.Children.Add(_err);
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        if (_editable)
        {
            row.Children.Add(Ui.Btn(Loc.T("erp.save"), Save));
            if (_rec != null) row.Children.Add(Ui.Btn(Loc.T("erp.delete"), Delete, "danger"));
        }
        row.Children.Add(Ui.Btn(Loc.T("common.close"), () => _w.Close(), "ghost"));
        body.Children.Add(row);
        _w.ShowDialog();
        return _changed;
    }

    private void Rebuild()
    {
        _fields = new List<Field>();
        foreach (var kv in _data)
        {
            var f = new Field { Key = kv.Key };
            if (kv.Value is JsonValue v)
            {
                if (v.TryGetValue<bool>(out var b)) { f.Type = "bool"; f.Value = b ? "true" : "false"; }
                else if (v.TryGetValue<double>(out var d)) { f.Type = "num"; f.Value = d.ToString(System.Globalization.CultureInfo.InvariantCulture); }
                else f.Value = v.TryGetValue<string>(out var s) ? s ?? "" : v.ToJsonString();
            }
            else if (kv.Value == null) f.Value = "";
            else { f.Type = "raw"; var js = kv.Value.ToJsonString(); f.Value = js.Length > 160 ? js[..160] : js; }
            _fields.Add(f);
        }
        _grid.ItemsSource = _fields.Select(f => new FieldRow(f.Key, f.Value, f.Type == "raw")).ToList();
        _view = (List<FieldRow>)_grid.ItemsSource;
    }

    private List<FieldRow> _view = new();

    /// <summary>One editable row of the grid.</summary>
    public sealed class FieldRow
    {
        public FieldRow(string key, string value, bool raw) { Key = key; Value = value; Raw = raw; }
        public string Key { get; }
        public string Value { get; set; }
        public bool Raw { get; }
    }

    private JsonObject Collect()
    {
        _grid.CommitEdit(DataGridEditingUnit.Row, true);
        var type = _fields.ToDictionary(f => f.Key, f => f.Type);
        var o = (JsonObject)JsonNode.Parse(_data.ToJsonString())!;
        foreach (var r in _view)
        {
            if (r.Raw) continue;
            switch (type[r.Key])
            {
                case "num":
                    if (double.TryParse(r.Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d)) o[r.Key] = d; else o[r.Key] = r.Value;
                    break;
                case "bool": o[r.Key] = new[] { "true", "1", "yes" }.Contains(r.Value.Trim().ToLowerInvariant()); break;
                default: o[r.Key] = r.Value; break;
            }
        }
        return o;
    }

    private void AddField()
    {
        var key = _newKey.Text.Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(key, @"^[A-Za-z]\w*$") || _data.ContainsKey(key)) return;
        _data = Collect();
        _data[key] = "";
        _newKey.Text = "";
        Rebuild();
    }

    private void RemoveField()
    {
        if (_grid.SelectedItem is not FieldRow r) return;
        _data = Collect();
        _data.Remove(r.Key);
        Rebuild();
    }

    private static JsonNode? Nz(TextBox t) => string.IsNullOrWhiteSpace(t.Text) ? null : JsonValue.Create(t.Text.Trim());

    private async void Save()
    {
        _err.Text = "";
        var body = new JsonObject { ["code"] = Nz(_code), ["status"] = Nz(_status), ["company"] = Nz(_company), ["ref"] = Nz(_ref), ["data"] = Collect() };
        try
        {
            if (_rec == null) await Api.I.CreateRecord(_m.Id, _k.Kind, body);
            else await Api.I.UpdateRecord(_m.Id, _k.Kind, _rec.Id, body);
            _changed = true; _w.Close();
        }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async void Delete()
    {
        if (_rec == null || !Ui.Ask(Loc.T("erp.confirmDelete"), Loc.T("erp.delete"), Loc.T("common.cancel"))) return;
        try { await Api.I.DeleteRecord(_m.Id, _k.Kind, _rec.Id); _changed = true; _w.Close(); }
        catch (Exception e) { _err.Text = e.Message; }
    }
}

// ------------------------------------------------------------------------------------------------ settings
public sealed class SettingsView : PageView
{
    public SettingsView(Action<string> setLang, Action signOut)
    {
        var s = Api.I.Session;
        Root.Children.Add(Ui.Text(Loc.T("tab.more"), 20, true));
        Root.Children.Add(Ui.Text(Loc.T("more.signedInAs"), 12, false, Ui.Dim));
        Root.Children.Add(Ui.Text($"{s?.DisplayName}  ({s?.Username} · {s?.Role})", 16, true));
        if (!string.IsNullOrEmpty(s?.TenantName)) Root.Children.Add(Ui.Text($"{Loc.T("more.workspace")}: {s!.TenantName}"));
        Root.Children.Add(Ui.Text($"{Loc.T("more.server")}: {s?.Server}", 13, false, Ui.Dim));
        Root.Children.Add(Ui.Text(Loc.T("more.language"), 12, false, Ui.Dim));
        Root.Children.Add(Ui.Row(Ui.Btn("English", () => setLang("en"), Loc.Lang == "en" ? null : "ghost"), Ui.Btn("العربية", () => setLang("ar"), Loc.Lang == "ar" ? null : "ghost")));
        Root.Children.Add(Ui.Row(Ui.Btn(Loc.T("more.signout"), signOut, "danger")));
    }

    public override Task Reload() => Task.CompletedTask;
}
