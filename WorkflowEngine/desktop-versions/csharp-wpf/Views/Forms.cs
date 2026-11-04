using System.IO;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Typed forms for workflow steps (Text, Email, Number, Date, TextArea, Select, Checkbox).</summary>
public sealed class TypedForm : StackPanel
{
    public sealed class Opt { public string Label { get; set; } = ""; public string? Value { get; set; } public override string ToString() => Label; }

    private readonly List<JsonObject> _fields;
    private readonly Dictionary<string, FrameworkElement> _w = new();

    public static bool IsNegative(string decision) => Regex.IsMatch(decision ?? "", "reject|cancel|deny|return|out of stock|write off", RegexOptions.IgnoreCase);

    private static string Prop(JsonObject f, string k) => f[k]?.ToString() ?? "";
    private static string TypeOf(JsonObject f) => Prop(f, "type") is { Length: > 0 } t ? t : "Text";
    private static bool Flag(JsonObject f, string k) => f[k] is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    public TypedForm(JsonObject form)
    {
        _fields = (form["fields"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        foreach (var f in _fields)
        {
            var key = Prop(f, "key");
            var ty = TypeOf(f);
            var ro = Flag(f, "readOnly");
            FrameworkElement w;
            switch (ty)
            {
                case "TextArea":
                    w = new TextBox { AcceptsReturn = true, Height = 70, TextWrapping = TextWrapping.Wrap, IsReadOnly = ro, Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8) };
                    break;
                case "Select":
                    var cb = new ComboBox { IsEnabled = !ro, Margin = new Thickness(0, 0, 0, 8), Padding = new Thickness(6) };
                    cb.Items.Add(new Opt { Label = Loc.T("common.select"), Value = null });
                    foreach (var o in (f["options"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                        cb.Items.Add(new Opt { Label = Prop(o, "label") is { Length: > 0 } l ? l : Prop(o, "value"), Value = Prop(o, "value") });
                    cb.SelectedIndex = 0;
                    w = cb;
                    break;
                case "Checkbox":
                    w = new CheckBox { Content = Prop(f, "placeholder") is { Length: > 0 } p ? p : Loc.T("common.yes"), IsEnabled = !ro, Margin = new Thickness(0, 2, 0, 10) };
                    break;
                case "Date":
                    w = new DatePicker { IsEnabled = !ro, Margin = new Thickness(0, 0, 0, 8) };
                    break;
                default:
                    w = new TextBox { IsReadOnly = ro, Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8) };
                    break;
            }
            _w[key] = w;
            var cap = (Prop(f, "label") is { Length: > 0 } lab ? lab : key) + (Flag(f, "required") && !ro ? " *" : "");
            Children.Add(Ui.Labeled(cap, w));
        }
    }

    public void SetValues(JsonObject? data)
    {
        if (data == null) return;
        foreach (var f in _fields)
        {
            var k = Prop(f, "key");
            if (!data.TryGetPropertyValue(k, out var node) || node == null) continue;
            var s = node is JsonValue jv && jv.TryGetValue<bool>(out var bb) ? (bb ? "true" : "false") : node is JsonValue ? node.ToString() : node.ToJsonString();
            switch (_w[k])
            {
                case ComboBox cb:
                    foreach (var o in cb.Items.OfType<Opt>()) if (o.Value == s) { cb.SelectedItem = o; break; }
                    break;
                case CheckBox ch: ch.IsChecked = s == "true" || s == "1" || s.ToLowerInvariant() == "yes"; break;
                case DatePicker dp:
                    if (DateTime.TryParse(s.Length >= 10 ? s[..10] : s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d)) dp.SelectedDate = d;
                    break;
                case TextBox tb: tb.Text = s; break;
            }
        }
    }

    private JsonNode? ValueOf(JsonObject f)
    {
        switch (_w[Prop(f, "key")])
        {
            case ComboBox cb: return (cb.SelectedItem as Opt)?.Value is { } v ? JsonValue.Create(v) : null;
            case CheckBox ch: return JsonValue.Create(ch.IsChecked == true);
            case DatePicker dp: return dp.SelectedDate is { } d ? JsonValue.Create(d.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)) : null;
            case TextBox tb:
                var txt = TypeOf(f) == "TextArea" ? tb.Text : tb.Text.Trim();
                if (TypeOf(f) == "Number")
                {
                    if (txt == "") return null;
                    if (long.TryParse(txt, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var n)) return JsonValue.Create(n);
                    return double.TryParse(txt, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var dd) ? JsonValue.Create(dd) : null;
                }
                return JsonValue.Create(txt);
        }
        return null;
    }

    /// <summary>Required, editable fields that are still empty.</summary>
    public List<string> Missing()
    {
        var o = new List<string>();
        foreach (var f in _fields)
        {
            if (!Flag(f, "required") || Flag(f, "readOnly")) continue;
            var v = ValueOf(f);
            if (v == null || (v is JsonValue jv && jv.TryGetValue<string>(out var s) && s == "")) o.Add(Prop(f, "key"));
        }
        return o;
    }

    /// <summary>Only the fields this step owns (read-only echoes of earlier data are not sent back).</summary>
    public JsonObject Values()
    {
        var o = new JsonObject();
        foreach (var f in _fields)
        {
            if (Flag(f, "readOnly")) continue;
            var v = ValueOf(f);
            if (v != null) o[Prop(f, "key")] = v;
        }
        return o;
    }
}

/// <summary>Notes and file attachments of one record; the server checks the caller's module privileges.</summary>
public sealed class ChatterView : StackPanel
{
    private sealed class Item { public string Text { get; set; } = ""; public JsonObject Data { get; set; } = new(); }

    private const int Max = 4 * 1024 * 1024;
    private readonly string _m, _k, _id;
    private readonly TabItem _tNotes = new(), _tFiles = new();
    private readonly ListBox _notes = new() { Height = 150, DisplayMemberPath = nameof(Item.Text) };
    private readonly ListBox _files = new() { Height = 150, DisplayMemberPath = nameof(Item.Text) };
    private readonly TextBox _text = new() { AcceptsReturn = true, Height = 56, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 6) };
    private readonly TextBlock _err = Ui.Text("", 13, false, Ui.Danger);

    public ChatterView(string module, string kind, string rid)
    {
        _m = module; _k = kind; _id = rid;
        var tabs = new TabControl();
        var nb = new StackPanel { Margin = new Thickness(8) };
        nb.Children.Add(_notes);
        nb.Children.Add(Ui.Labeled(Loc.T("collab.notePh"), _text));
        nb.Children.Add(Ui.Row(Ui.Btn(Loc.T("collab.send"), () => _ = Send()), Ui.Btn(Loc.T("collab.delete"), () => _ = DelNote(), "ghost")));
        _tNotes.Content = nb;
        var fb = new StackPanel { Margin = new Thickness(8) };
        fb.Children.Add(_files);
        fb.Children.Add(Ui.Text(Loc.T("collab.maxSize"), 12, false, Ui.Dim));
        fb.Children.Add(Ui.Row(Ui.Btn(Loc.T("collab.choose"), () => _ = Pick()), Ui.Btn(Loc.T("collab.download"), () => _ = Download(), "ghost"), Ui.Btn(Loc.T("collab.delete"), () => _ = DelFile(), "ghost")));
        _tFiles.Content = fb;
        _tNotes.Header = Loc.T("collab.notes");
        _tFiles.Header = Loc.T("collab.files");
        tabs.Items.Add(_tNotes);
        tabs.Items.Add(_tFiles);
        Children.Add(tabs);
        Children.Add(_err);
        Loaded += async (_, _) => await Load();
    }

    private async Task Fail(Func<Task> work)
    {
        try { _err.Text = ""; await work(); }
        catch (Exception e) { _err.Text = e.Message; }
    }

    public Task Load() => Fail(async () =>
    {
        var notes = (await Api.I.Notes(_m, _k, _id)).OfType<JsonObject>().OrderByDescending(n => n["createdAt"]?.ToString() ?? "").ToList();
        _notes.ItemsSource = notes.Select(n => new Item
        {
            Data = n,
            Text = $"{n["author"]}  ·  {(n["createdAt"]?.ToString() ?? "").Replace('T', ' ')[..Math.Min(16, (n["createdAt"]?.ToString() ?? "").Length)]}\n{n["text"]}"
        }).ToList();
        _tNotes.Header = $"{Loc.T("collab.notes")} ({notes.Count})";
        try
        {
            var files = (await Api.I.Files(_m, _k, _id)).OfType<JsonObject>().ToList();
            _files.ItemsSource = files.Select(f =>
            {
                var kb = Math.Max(1, (int)Math.Round((f["size"] is JsonValue sv && sv.TryGetValue<double>(out var sz) ? sz : 0) / 1024));
                var when = f["createdAt"]?.ToString() ?? "";
                return new Item { Data = f, Text = $"{f["name"]}   —   {kb} KB · {f["author"]} · {when[..Math.Min(10, when.Length)]}" };
            }).ToList();
            _tFiles.Header = $"{Loc.T("collab.files")} ({files.Count})";
        }
        catch { /* files are optional */ }
    });

    private Task Send() => Fail(async () =>
    {
        var txt = _text.Text.Trim();
        if (txt == "") return;
        await Api.I.AddNote(_m, _k, _id, txt);
        _text.Text = "";
        await Load();
    });

    private Task DelNote() => Fail(async () =>
    {
        if (_notes.SelectedItem is not Item it) return;
        if (it.Data["system"] is JsonValue sv && sv.TryGetValue<bool>(out var sys) && sys) return;
        await Api.I.DeleteNote(it.Data["id"]!.ToString());
        await Load();
    });

    private Task Pick() => Fail(async () =>
    {
        var dlg = new Microsoft.Win32.OpenFileDialog { Multiselect = true, Title = Loc.T("collab.attach") };
        if (dlg.ShowDialog() != true) return;
        foreach (var p in dlg.FileNames)
        {
            var bytes = await File.ReadAllBytesAsync(p);
            var name = Path.GetFileName(p);
            if (bytes.Length > Max) { _err.Text = Loc.T("collab.tooBig", ("name", name)); continue; }
            await Api.I.AddFile(_m, _k, _id, name, "application/octet-stream", Convert.ToBase64String(bytes));
        }
        await Load();
    });

    private Task Download() => Fail(async () =>
    {
        if (_files.SelectedItem is not Item it) return;
        var dlg = new Microsoft.Win32.SaveFileDialog { FileName = it.Data["name"]?.ToString() ?? "file", Title = Loc.T("collab.download") };
        if (dlg.ShowDialog() != true) return;
        await File.WriteAllBytesAsync(dlg.FileName, await Api.I.FileBytes(it.Data["id"]!.ToString()));
    });

    private Task DelFile() => Fail(async () =>
    {
        if (_files.SelectedItem is not Item it) return;
        await Api.I.DeleteFile(it.Data["id"]!.ToString());
        await Load();
    });
}
