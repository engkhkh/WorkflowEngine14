using System.Text.Json;

namespace WorkflowErp.Services;

/// <summary>Texts (English / Arabic) and the module catalog, both read from the files in Resources/Raw.</summary>
public static class Loc
{
    private static Dictionary<string, Dictionary<string, string>> _dict = new();
    public static Catalog Catalog { get; private set; } = new();
    public static string Lang { get; private set; } = "en";
    public static bool Rtl => Lang == "ar";
    public static FlowDirection Flow => Rtl ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;

    public static async Task Init()
    {
        var opt = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        await using (var s = await FileSystem.OpenAppPackageFileAsync("i18n.json"))
            _dict = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(s, opt) ?? new();
        await using (var s = await FileSystem.OpenAppPackageFileAsync("catalog.json"))
            Catalog = JsonSerializer.Deserialize<Catalog>(s, opt) ?? new();
        Lang = Preferences.Default.Get("wfe_maui_lang", "en") == "ar" ? "ar" : "en";
    }

    public static void SetLang(string l) { Lang = l; Preferences.Default.Set("wfe_maui_lang", l); }

    public static string T(string key, params (string k, string v)[] vars)
    {
        var s = (_dict.TryGetValue(Lang, out var d) && d.TryGetValue(key, out var v) ? v : null)
                ?? (_dict.TryGetValue("en", out var e) && e.TryGetValue(key, out var v2) ? v2 : null) ?? key;
        foreach (var (k, val) in vars) s = s.Replace("{" + k + "}", val);
        return s;
    }

    public static List<CatalogModule> VisibleModules() => Catalog.Modules.Where(m => m.Kinds.Any(k => Api.I.Can(k.View))).ToList();
}
