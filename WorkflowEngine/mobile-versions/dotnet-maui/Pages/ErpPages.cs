using System.Text.Json.Nodes;
using WorkflowErp.Services;

namespace WorkflowErp.Pages;

public class ErpModulesPage : ListPage
{
    public ErpModulesPage() { Title = Loc.T("tab.erp"); }

    protected override Task Reload()
    {
        Body.Children.Clear();
        var mods = Loc.VisibleModules();
        if (mods.Count == 0) Body.Children.Add(Ui.Empty(Loc.T("erp.noModules")));
        foreach (var m in mods)
        {
            var mod = m;
            Body.Children.Add(Ui.Card(Ui.Text(mod.Name(Loc.Rtl), 15, true), () => _ = Navigation.PushAsync(new ErpKindsPage(mod))));
        }
        return Task.CompletedTask;
    }
}

public class ErpKindsPage : ListPage
{
    private readonly CatalogModule _m;
    public ErpKindsPage(CatalogModule m) { _m = m; Title = m.Name(Loc.Rtl); }

    protected override Task Reload()
    {
        Body.Children.Clear();
        foreach (var k in _m.Kinds.Where(k => Api.I.Can(k.View)))
        {
            var kind = k;
            Body.Children.Add(Ui.Card(Ui.Text(kind.Name(Loc.Rtl), 15, true), () => _ = Navigation.PushAsync(new ErpListPage(_m, kind))));
        }
        return Task.CompletedTask;
    }
}

public class ErpListPage : ListPage
{
    private readonly CatalogModule _m;
    private readonly CatalogKind _k;
    private List<ErpRec> _rows = new();
    private string _q = "";
    private readonly VerticalStackLayout _items = new();

    public ErpListPage(CatalogModule m, CatalogKind k)
    {
        _m = m; _k = k; Title = k.Name(Loc.Rtl);
    }

    private bool CanManage => Api.I.Can(_k.Manage) && !_k.ReadOnly;

    protected override async Task Reload()
    {
        _rows = await Api.I.Records(_m.Id, _k.Kind);
        Body.Children.Clear();
        var search = Ui.Input(Loc.T("erp.search"), _q);
        search.TextChanged += (_, e) => { _q = e.NewTextValue ?? ""; Fill(); };
        Body.Children.Add(Ui.Labeled(Loc.T("erp.search"), search));
        if (CanManage) Body.Children.Add(Ui.Btn("+ " + Loc.T("erp.new"), () => _ = Navigation.PushAsync(new ErpFormPage(_m, _k, null))));
        Body.Children.Add(_items);
        Fill();
    }

    private void Fill()
    {
        _items.Children.Clear();
        var s = _q.Trim().ToLowerInvariant();
        var shown = string.IsNullOrEmpty(s) ? _rows : _rows.Where(r => $"{r.Code} {r.Status} {r.Ref} {r.Data}".ToLowerInvariant().Contains(s)).ToList();
        if (shown.Count == 0) _items.Children.Add(Ui.Empty(Loc.T("erp.none")));
        foreach (var r in shown)
        {
            var rec = r;
            var col = new VerticalStackLayout { Spacing = 4, Children = { Ui.Text(rec.Label, 15, true) } };
            if (!string.IsNullOrEmpty(rec.Sub)) col.Children.Add(Ui.Text(rec.Sub, 13, false, Ui.Dim));
            if (!string.IsNullOrEmpty(rec.Status)) col.Children.Add(Ui.Chip(rec.Status!, Ui.StatusColor(rec.Status)));
            _items.Children.Add(Ui.Card(col, () => _ = Navigation.PushAsync(new ErpFormPage(_m, _k, rec))));
        }
    }
}

/// <summary>Free-form record editor: header fields plus one row per simple key of data. Numbers and yes/no values keep their type.</summary>
public class ErpFormPage : ContentPage
{
    private static View Pad(View v) { v.Margin = new Thickness(14, 0); return v; }
    private readonly CatalogModule _m;
    private readonly CatalogKind _k;
    private readonly ErpRec? _rec;
    private readonly Entry _code, _status, _company, _ref;
    private readonly Dictionary<string, View> _inputs = new();
    private readonly JsonObject _data;
    private readonly VerticalStackLayout _fields = new();
    private readonly Label _err = new() { TextColor = Ui.Danger, Margin = new Thickness(14, 4) };
    private bool Editable => Api.I.Can(_k.Manage) && !_k.ReadOnly;

    public ErpFormPage(CatalogModule m, CatalogKind k, ErpRec? rec)
    {
        _m = m; _k = k; _rec = rec;
        BackgroundColor = Ui.Bg;
        FlowDirection = Loc.Flow;
        Title = rec?.Code ?? Loc.T("erp.new");
        _data = rec == null ? new JsonObject() : (JsonObject)JsonNode.Parse(rec.Data.ToJsonString())!;
        _code = Ui.Input(Loc.T("erp.code"), rec?.Code ?? "", enabled: rec == null && Editable);
        _status = Ui.Input(Loc.T("erp.status"), rec?.Status ?? "", enabled: Editable);
        _company = Ui.Input(Loc.T("erp.company"), rec?.Company ?? "", enabled: Editable);
        _ref = Ui.Input(Loc.T("erp.ref"), rec?.Ref ?? "", enabled: Editable);

        var stack = new VerticalStackLayout { Spacing = 2, Padding = new Thickness(0, 12) };
        if (!Editable) stack.Children.Add(Pad(Ui.Chip(Loc.T("erp.readOnly"), Ui.Dim)));
        stack.Children.Add(Ui.Labeled(Loc.T("erp.code"), _code));
        stack.Children.Add(Ui.Labeled(Loc.T("erp.status"), _status));
        stack.Children.Add(Ui.Labeled(Loc.T("erp.company"), _company));
        stack.Children.Add(Ui.Labeled(Loc.T("erp.ref"), _ref));
        stack.Children.Add(new Label { Text = Loc.T("erp.data"), FontAttributes = FontAttributes.Bold, TextColor = Ui.Ink, Margin = new Thickness(14, 10, 14, 0) });
        stack.Children.Add(_fields);
        BuildFields();

        if (Editable)
        {
            var newKey = Ui.Input(Loc.T("erp.fieldName"));
            stack.Children.Add(Ui.Labeled(Loc.T("erp.fieldName"), newKey));
            stack.Children.Add(Ui.Btn(Loc.T("erp.addField"), () =>
            {
                var key = (newKey.Text ?? "").Trim();
                if (!System.Text.RegularExpressions.Regex.IsMatch(key, @"^[A-Za-z]\w*$") || _data.ContainsKey(key)) return;
                CollectInto(_data);
                _data[key] = "";
                newKey.Text = "";
                BuildFields();
            }, ghost: true));
        }
        // workflow actions of the newer modules (sales orders, helpdesk, subscriptions, expenses, quality, fleet)
        var acts = rec == null ? new List<CatalogAction>() : k.Actions.Where(a => a.When.Contains(rec.Status ?? "") && Api.I.Can(a.Priv)).ToList();
        if (acts.Count > 0)
        {
            var extra = new Dictionary<string, Entry>();
            foreach (var key in acts.SelectMany(a => a.Ask).Distinct())
            {
                var e = Ui.Input(Loc.T(key == "note" ? "erp.note" : key == "user" ? "erp.actUser" : key == "method" ? "erp.actMethod" : key == "amount" ? "erp.actHours" : "erp.actCost"),
                    key == "method" ? "Transfer" : key == "amount" || key == "cost" ? "0" : "");
                extra[key] = e;
                stack.Children.Add(Ui.Labeled(Loc.T(key == "note" ? "erp.note" : key == "user" ? "erp.actUser" : key == "method" ? "erp.actMethod" : key == "amount" ? "erp.actHours" : "erp.actCost"), e));
            }
            foreach (var a in acts)
            {
                var act = a;
                stack.Children.Add(Ui.Btn(act.Name(Loc.Rtl), async () =>
                {
                    if (act.Danger && !await DisplayAlert(act.Name(Loc.Rtl) + "?", "", act.Name(Loc.Rtl), Loc.T("common.cancel"))) return;
                    var body = new JsonObject();
                    foreach (var key in act.Ask)
                    {
                        var v = (extra[key].Text ?? "").Trim();
                        if (key == "amount" || key == "cost") body[key] = double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0;
                        else if (v.Length > 0) body[key] = v;
                    }
                    try { await Api.I.BizAction(_m.Id, _k.Kind, rec!.Id, act.Op, body); await Navigation.PopAsync(); }
                    catch (Exception ex) { _err.Text = ex.Message; }
                }, ghost: true));
            }
        }
        stack.Children.Add(_err);
        if (Editable) stack.Children.Add(Ui.Btn(Loc.T("erp.save"), Save));
        if (Editable && rec != null) stack.Children.Add(Ui.Btn(Loc.T("erp.delete"), Delete, danger: true));
        Content = new ScrollView { Content = stack };
    }

    private static bool Simple(JsonNode? n) => n == null || n is JsonValue;

    private void BuildFields()
    {
        _fields.Children.Clear();
        _inputs.Clear();
        foreach (var kv in _data.ToList())
        {
            if (!Simple(kv.Value)) { _fields.Children.Add(new Label { Text = $"{kv.Key}: {Trim(kv.Value!.ToJsonString())}", TextColor = Ui.Dim, Margin = new Thickness(14, 4) }); continue; }
            var v = kv.Value as JsonValue;
            if (v != null && v.TryGetValue<bool>(out var b))
            {
                var sw = new Switch { IsToggled = b, IsEnabled = Editable };
                _inputs[kv.Key] = sw;
                _fields.Children.Add(Ui.Labeled(kv.Key, sw));
            }
            else
            {
                var isNum = v != null && v.TryGetValue<double>(out _);
                var text = v == null ? "" : (v.TryGetValue<string>(out var s) ? s : v.ToJsonString());
                var e = Ui.Input(kv.Key, text, enabled: Editable);
                if (isNum) e.Keyboard = Keyboard.Numeric;
                e.ClassId = isNum ? "num" : "txt";
                _inputs[kv.Key] = e;
                _fields.Children.Add(Ui.Labeled(kv.Key, e));
            }
        }
    }

    private static string Trim(string s) => s.Length > 160 ? s[..160] : s;

    private void CollectInto(JsonObject target)
    {
        foreach (var (key, view) in _inputs)
        {
            if (view is Switch sw) target[key] = sw.IsToggled;
            else if (view is Entry e)
            {
                var t = e.Text ?? "";
                if (e.ClassId == "num" && double.TryParse(t, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d)) target[key] = d;
                else target[key] = t;
            }
        }
    }

    private static string? N(Entry e) => string.IsNullOrEmpty(e.Text) ? null : e.Text;

    private async void Save()
    {
        _err.Text = "";
        CollectInto(_data);
        var body = new JsonObject { ["code"] = N(_code), ["status"] = N(_status), ["company"] = N(_company), ["ref"] = N(_ref), ["data"] = JsonNode.Parse(_data.ToJsonString()) };
        try
        {
            if (_rec == null) await Api.I.CreateRecord(_m.Id, _k.Kind, body);
            else await Api.I.UpdateRecord(_m.Id, _k.Kind, _rec.Id, body);
            await Navigation.PopAsync();
        }
        catch (Exception e) { _err.Text = e.Message; }
    }

    private async void Delete()
    {
        if (_rec == null || !await DisplayAlert(Loc.T("erp.confirmDelete"), "", Loc.T("erp.delete"), Loc.T("common.cancel"))) return;
        try { await Api.I.DeleteRecord(_m.Id, _k.Kind, _rec.Id); await Navigation.PopAsync(); }
        catch (Exception e) { _err.Text = e.Message; }
    }
}
