using System.IO;
using System.Text.Json;
using System.Windows;

namespace WorkflowErp.Services;

/// <summary>Texts (English / Arabic) and the module catalog, read from the data folder next to the program.</summary>
public static class Loc
{
    private static Dictionary<string, Dictionary<string, string>> _dict = new();
    private static readonly string LangFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WorkflowErpWpf", "lang.txt");
    public static Catalog Catalog { get; private set; } = new();
    public static string Lang { get; private set; } = "en";
    public static bool Rtl => Lang == "ar";
    public static FlowDirection Flow => Rtl ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;

    public static void Init()
    {
        var opt = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        _dict = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(ReadData("i18n.json"), opt) ?? new();
        Catalog = JsonSerializer.Deserialize<Catalog>(ReadData("catalog.json"), opt) ?? new();
        try { Lang = File.Exists(LangFile) && File.ReadAllText(LangFile).Trim() == "ar" ? "ar" : "en"; } catch { Lang = "en"; }
    }

    /// <summary>The texts and the catalog are compiled into the program, so the single .exe runs on its own (a data folder next to it, if present, wins).</summary>
    public static string ReadData(string name)
    {
        var file = Path.Combine(AppContext.BaseDirectory, "data", name);
        if (File.Exists(file)) return File.ReadAllText(file);
        using var s = typeof(Loc).Assembly.GetManifestResourceStream(name) ?? throw new FileNotFoundException("Missing built-in resource " + name);
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    }

    public static void SetLang(string l)
    {
        Lang = l;
        try { Directory.CreateDirectory(Path.GetDirectoryName(LangFile)!); File.WriteAllText(LangFile, l); } catch { /* optional */ }
    }

    public static string T(string key, params (string k, string v)[] vars)
    {
        var s = (_dict.TryGetValue(Lang, out var d) && d.TryGetValue(key, out var v) ? v : null)
                ?? (_dict.TryGetValue("en", out var e) && e.TryGetValue(key, out var v2) ? v2 : null) ?? key;
        foreach (var (k, val) in vars) s = s.Replace("{" + k + "}", val);
        return s;
    }

    public static List<CatalogModule> VisibleModules() => Catalog.Modules.Where(m => m.Kinds.Any(k => Api.I.Can(k.View))).ToList();
}
