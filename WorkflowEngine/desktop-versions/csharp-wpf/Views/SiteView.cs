using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using WorkflowErp.Services;

namespace WorkflowErp.Views;

/// <summary>Turns a site design (theme + pages of blocks) into one self-contained html document - a port of the portal's site-renderer.ts.
/// The css, the cart script and the labels come from website.json (shared by every desktop app); only the blocks are rendered here.</summary>
internal static class SiteEngine
{
    private static JsonObject? _spec;
    public static JsonObject Spec => _spec ??= (JsonObject)JsonNode.Parse(Loc.ReadData("website.json"))!;
    private static JsonArray A(JsonNode? n) => n as JsonArray ?? new JsonArray();
    private static JsonObject O(JsonNode? n) => n as JsonObject ?? new JsonObject();

    /// <summary>String(v ?? '') the way JavaScript prints a JSON value</summary>
    public static string Js(JsonNode? n)
    {
        if (n is null) return "";
        if (n is JsonValue v)
        {
            if (v.TryGetValue<string>(out var s)) return s;
            if (v.TryGetValue<bool>(out var b)) return b ? "true" : "false";
            if (TryD(v, out var d)) return NumStr(d);
        }
        return n.ToJsonString();
    }
    /// <summary>a number stored as double, long, int or decimal (values built in code are not element-backed)</summary>
    public static bool TryD(JsonValue v, out double d)
    {
        if (v.TryGetValue<double>(out d)) return true;
        if (v.TryGetValue<long>(out var l)) { d = l; return true; }
        if (v.TryGetValue<int>(out var i)) { d = i; return true; }
        if (v.TryGetValue<decimal>(out var m)) { d = (double)m; return true; }
        d = 0; return false;
    }
    public static string NumStr(double d) => d == Math.Floor(d) && Math.Abs(d) < 1e15 ? ((long)d).ToString(CultureInfo.InvariantCulture) : d.ToString("R", CultureInfo.InvariantCulture);
    public static double Num(JsonNode? n, double dv)
    {
        if (n is null) return dv;
        if (n is JsonValue v)
        {
            if (TryD(v, out var d)) return double.IsNaN(d) ? dv : d;
            if (v.TryGetValue<string>(out var s) && double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var x) && !double.IsNaN(x)) return x;
        }
        return dv;
    }
    public static string Esc(JsonNode? n) => EscS(Js(n));
    public static string EscS(string s) => s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&#39;");

    private static readonly Regex HrefRx = new("^(https?://|mailto:|tel:|#)", RegexOptions.IgnoreCase), ExtRx = new("^https?:", RegexOptions.IgnoreCase),
        ImgRx = new("^(https?://|data:image/(png|jpe?g|gif|webp|svg\\+xml);base64,)", RegexOptions.IgnoreCase),
        EmbRx = new("^https://(www\\.youtube\\.com/embed/|www\\.google\\.com/maps/embed|www\\.openstreetmap\\.org/export/embed)", RegexOptions.IgnoreCase);

    public static string Href(JsonNode? l)
    {
        var s = Js(l).Trim();
        if (s.Length == 0) return "#/";
        if (s.StartsWith("/")) return "#" + s;
        return HrefRx.IsMatch(s) ? s : "#";
    }
    private static string Img(JsonNode? v) { var s = Js(v).Trim(); return ImgRx.IsMatch(s) ? s : ""; }
    private static string Embed(JsonNode? v) { var s = Js(v).Trim(); return EmbRx.IsMatch(s) ? s : ""; }
    private static string Ext(string h) => ExtRx.IsMatch(h) ? " target=\"_blank\" rel=\"noopener\"" : "";
    private static string Paras(JsonNode? t)
    {
        var b = new StringBuilder();
        foreach (var p in Regex.Split(Js(t), "\n{2,}")) b.Append("<p>").Append(EscS(p.Trim()).Replace("\n", "<br>")).Append("</p>");
        return b.ToString();
    }
    private static string Money(double n, JsonNode? cur) => (Math.Floor(n * 100 + 1e-9 + 0.5) / 100).ToString("N2", CultureInfo.InvariantCulture) + " " + Esc(cur);
    private static string Heading(JsonNode? t) => Js(t).Length == 0 ? "" : "<h2 class=\"h2\">" + Esc(t) + "</h2>";
    private static JsonNode? G(JsonObject p, string k, string dv) => p[k] ?? JsonValue.Create(dv);
    private static JsonNode? G(JsonObject p, string k, double dv) => p[k] ?? JsonValue.Create(dv);
    private static bool IsTrue(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    private static string Section(JsonObject b, string inner)
    {
        var p = O(b["props"]);
        var bg = p["bgStyle"] ?? JsonValue.Create("none");
        var pad = p["pad"] is null ? "56px" : Js(p["pad"]) switch { "s" => "28px", "m" => "56px", "l" => "96px", _ => "56px" };
        return "<section class=\"blk bg-" + Esc(bg) + " \" style=\"padding-block:" + pad + "\"><div class=\"wrap\">" + inner + "</div></section>";
    }

    private static string Label(JsonObject labels, string k, string dv) => labels.ContainsKey(k) ? Js(labels[k]) : dv;

    private static string Block(JsonObject b, JsonObject d, JsonObject labels)
    {
        var p = O(b["props"]); var shop = O(d["shop"]);
        switch (Js(b["type"]))
        {
            case "nav":
            {
                var links = new StringBuilder();
                foreach (var pv in A(d["pages"])) { var pg = O(pv); links.Append("<a href=\"#").Append(Esc(pg["path"])).Append("\" data-nav=\"").Append(Esc(pg["path"])).Append("\">").Append(Esc(pg["title"])).Append("</a>"); }
                var logo = Img(G(p, "logo", ""));
                var cart = IsTrue(shop["enabled"]) ? "<button class=\"cartbtn\" type=\"button\" data-cart-open aria-label=\"cart\">\U0001F6D2 <b data-cart-count>0</b></button>" : "";
                return "<header class=\"nav" + (Js(G(p, "sticky", "")) == "yes" ? " sticky" : "") + "\"><div class=\"wrap navin\"><a class=\"brand\" href=\"#/\">" + (logo.Length == 0 ? "" : "<img src=\"" + EscS(logo) + "\" alt=\"\">")
                    + "<span>" + Esc(G(p, "brand", "")) + "</span></a>\n        <nav class=\"links\">" + links + "</nav>" + cart + "</div></header>";
            }
            case "hero":
            {
                var bg = Img(G(p, "image", ""));
                var ov = Math.Max(0, Math.Min(85, Num(G(p, "overlay", ""), 0))) / 100;
                var h = Js(G(p, "height", "")) switch { "s" => "320px", "m" => "460px", "l" => "620px", _ => "460px" };
                var l1 = Href(G(p, "link", "")); var l2 = Href(G(p, "link2", ""));
                var b1 = Js(G(p, "button", "")).Length == 0 ? "" : "<a class=\"btn\" href=\"" + EscS(l1) + "\"" + Ext(l1) + ">" + Esc(G(p, "button", "")) + "</a>";
                var b2 = Js(G(p, "button2", "")).Length == 0 ? "" : "<a class=\"btn ghost\" href=\"" + EscS(l2) + "\"" + Ext(l2) + ">" + Esc(G(p, "button2", "")) + "</a>";
                var ovs = NumStr(ov);
                var bgs = bg.Length == 0 ? "" : "background-image:linear-gradient(rgba(0,0,0," + ovs + "),rgba(0,0,0," + ovs + ")),url('" + EscS(bg) + "')";
                return "<section class=\"blk hero " + (bg.Length == 0 ? "" : "has-img") + "\" style=\"min-height:" + h + ";text-align:" + Esc(G(p, "align", "center")) + ";" + bgs + "\">\n        <div class=\"wrap\"><h1>"
                    + Esc(G(p, "title", "")) + "</h1><p class=\"lead\">" + Esc(G(p, "subtitle", "")) + "</p><div class=\"btns\">" + b1 + b2 + "</div></div></section>";
            }
            case "text":
                return Section(b, "<div style=\"text-align:" + Esc(G(p, "align", "start")) + "\">" + Heading(G(p, "heading", "")) + "<div class=\"prose\">" + Paras(G(p, "body", "")) + "</div></div>");
            case "image":
            {
                var s = Img(G(p, "image", ""));
                var body = s.Length == 0 ? "<div class=\"ph\">\U0001F5BC️</div>" : "<figure class=\"fig" + (Js(G(p, "width", "")) == "full" ? " full" : "") + "\"><img src=\"" + EscS(s) + "\" alt=\"" + Esc(G(p, "alt", "")) + "\">"
                    + (Js(G(p, "caption", "")).Length == 0 ? "" : "<figcaption>" + Esc(G(p, "caption", "")) + "</figcaption>") + "</figure>";
                return Section(b, body);
            }
            case "features":
            {
                var it = new StringBuilder();
                foreach (var iv in A(p["items"])) { var i = O(iv); it.Append("<div class=\"card feat\"><div class=\"ico\">").Append(Esc(i["icon"])).Append("</div><h3>").Append(Esc(i["title"])).Append("</h3><p>").Append(Esc(i["text"])).Append("</p></div>"); }
                return Section(b, Heading(G(p, "heading", "")) + "<div class=\"grid c" + Esc(G(p, "columns", "3")) + "\">" + it + "</div>");
            }
            case "products":
            {
                var lst = new List<JsonObject>();
                foreach (var x in A(shop["products"])) lst.Add(O(x));
                var cat = Js(G(p, "category", "")).Trim().ToLowerInvariant();
                if (cat.Length > 0) lst = lst.Where(x => Js(x["category"]).ToLowerInvariant() == cat).ToList();
                var lim = (int)Num(G(p, "limit", 8), 8);
                if (lim == 0) lim = 8;
                lim = Math.Max(1, lim);
                if (lst.Count > lim) lst = lst.Take(lim).ToList();
                var cards = new StringBuilder();
                foreach (var x in lst)
                {
                    var im = Img(x["image"]);
                    cards.Append("<div class=\"card prod\"><div class=\"pimg\">").Append(im.Length == 0 ? "<span>\U0001F6CD️</span>" : "<img src=\"" + EscS(im) + "\" alt=\"" + Esc(x["name"]) + "\" loading=\"lazy\">")
                        .Append("</div>\n        <h3>").Append(Esc(x["name"])).Append("</h3>").Append(Js(x["description"]).Length == 0 ? "" : "<p class=\"muted\">" + Esc(x["description"]) + "</p>")
                        .Append("<div class=\"price\">").Append(Money(Num(x["price"], 0), shop["currency"])).Append("</div>\n        <button class=\"btn sm\" type=\"button\" data-add=\"").Append(Esc(x["sku"])).Append("\">")
                        .Append(EscS(Label(labels, "add", "Add to cart"))).Append("</button></div>");
                }
                var empty = "<p class=\"muted center\">" + EscS(Label(labels, "noProducts", "No products yet. Sync products from the point of sale in the shop settings.")) + "</p>";
                return Section(b, Heading(G(p, "heading", "")) + (lst.Count == 0 ? empty : "<div class=\"grid c" + Esc(G(p, "columns", "4")) + "\">" + cards + "</div>"));
            }
            case "gallery":
            {
                var it = new StringBuilder();
                foreach (var iv in A(p["items"])) { var i = O(iv); var im = Img(i["image"]); it.Append(im.Length == 0 ? "<div class=\"ph\">\U0001F5BC️</div>" : "<img class=\"g\" src=\"" + EscS(im) + "\" alt=\"" + Esc(i["alt"]) + "\" loading=\"lazy\">"); }
                return Section(b, Heading(G(p, "heading", "")) + "<div class=\"grid c" + Esc(G(p, "columns", "3")) + "\">" + it + "</div>");
            }
            case "testimonials":
            {
                var it = new StringBuilder();
                foreach (var iv in A(p["items"]))
                {
                    var i = O(iv);
                    it.Append("<blockquote class=\"card\"><p>“").Append(Esc(i["text"])).Append("”</p><footer><b>").Append(Esc(i["name"])).Append("</b>")
                        .Append(Js(i["role"]).Length == 0 ? "" : " · <span class=\"muted\">" + Esc(i["role"]) + "</span>").Append("</footer></blockquote>");
                }
                return Section(b, Heading(G(p, "heading", "")) + "<div class=\"grid c2\">" + it + "</div>");
            }
            case "faq":
            {
                var it = new StringBuilder();
                foreach (var iv in A(p["items"])) { var i = O(iv); it.Append("<details class=\"card\"><summary>").Append(Esc(i["q"])).Append("</summary><p>").Append(Esc(i["a"])).Append("</p></details>"); }
                return Section(b, Heading(G(p, "heading", "")) + "<div class=\"faq\">" + it + "</div>");
            }
            case "cta":
            {
                var l = Href(G(p, "link", ""));
                var btn = Js(G(p, "button", "")).Length == 0 ? "" : "<a class=\"btn light\" href=\"" + EscS(l) + "\"" + Ext(l) + ">" + Esc(G(p, "button", "")) + "</a>";
                return Section(b, "<div class=\"center\"><h2 class=\"h2\">" + Esc(G(p, "heading", "")) + "</h2><p class=\"lead\">" + Esc(G(p, "text", "")) + "</p>" + btn + "</div>");
            }
            case "contact":
            {
                var ph = Js(G(p, "phone", "")); var em = Js(G(p, "email", "")); var ad = Js(G(p, "address", ""));
                var info = (ph.Length == 0 ? "" : "<div>\U0001F4DE <a href=\"tel:" + EscS(ph) + "\">" + EscS(ph) + "</a></div>") + (em.Length == 0 ? "" : "<div>✉️ <a href=\"mailto:" + EscS(em) + "\">" + EscS(em) + "</a></div>") + (ad.Length == 0 ? "" : "<div>\U0001F4CD " + EscS(ad) + "</div>");
                return Section(b, "<div class=\"two\"><div>" + Heading(G(p, "heading", "")) + "<p>" + Esc(G(p, "text", "")) + "</p><div class=\"info\">" + info + "</div></div>\n        <form class=\"card form\" data-contact><input name=\"name\" placeholder=\""
                    + EscS(Label(labels, "name", "Your name")) + "\" required maxlength=\"120\"><input name=\"email\" type=\"email\" placeholder=\"" + EscS(Label(labels, "email", "E-mail")) + "\" maxlength=\"160\">\n        "
                    + "<input name=\"phone\" placeholder=\"" + EscS(Label(labels, "phone", "Phone")) + "\" maxlength=\"40\"><textarea name=\"message\" rows=\"4\" placeholder=\"" + EscS(Label(labels, "message", "Message")) + "\" required maxlength=\"2000\"></textarea>\n        "
                    + "<input name=\"website\" class=\"hp\" tabindex=\"-1\" autocomplete=\"off\"><button class=\"btn\" type=\"submit\">" + Esc(G(p, "button", "")) + "</button><p class=\"status\" data-status></p></form></div>");
            }
            case "embed":
            {
                var u = Embed(G(p, "url", ""));
                var h = Math.Min(900, Num(G(p, "height", 360), 360));
                if (h == 0) h = 360;
                h = Math.Max(200, h);
                return Section(b, u.Length == 0 ? "<div class=\"ph\">\U0001F5FA️</div>" : "<iframe class=\"embed\" src=\"" + EscS(u) + "\" style=\"height:" + NumStr(h) + "px\" loading=\"lazy\" referrerpolicy=\"no-referrer\" allowfullscreen></iframe>");
            }
            case "spacer":
            {
                var h = Num(G(p, "height", 48), 48);
                if (h == 0) h = 48;
                return "<div style=\"height:" + NumStr(Math.Max(8, Math.Min(300, h))) + "px\"></div>";
            }
            case "footer":
            {
                var links = new StringBuilder();
                foreach (var iv in A(p["items"])) { var i = O(iv); var l = Href(i["link"]); links.Append("<a href=\"").Append(EscS(l)).Append('"').Append(Ext(l)).Append('>').Append(Esc(i["label"])).Append("</a>"); }
                return "<footer class=\"foot\"><div class=\"wrap\"><div class=\"flinks\">" + links + "</div><p>" + Esc(G(p, "text", "")) + "</p></div></footer>";
            }
            default: return "";
        }
    }

    private static string Q(string v)
    {
        var b = new StringBuilder("\"");
        foreach (var c in v)
        {
            switch (c)
            {
                case '"': b.Append("\\\""); break;
                case '\\': b.Append("\\\\"); break;
                case '\n': b.Append("\\n"); break;
                case '\r': b.Append("\\r"); break;
                case '\t': b.Append("\\t"); break;
                case '\b': b.Append("\\b"); break;
                case '\f': b.Append("\\f"); break;
                default: if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4")); else b.Append(c); break;
            }
        }
        return b.Append('"').ToString();
    }

    public static string Render(JsonObject d, string orderUrl = "", string messageUrl = "", string mode = "download")
    {
        var t = O(d["theme"]); var shop = O(d["shop"]); var s = O(d["settings"]);
        var dark = IsTrue(t["dark"]);
        var bg = dark ? "#0f172a" : Js(t["bg"]); var tx = dark ? "#e5e7eb" : Js(t["text"]); var soft = dark ? "#1e293b" : "rgba(0,0,0,.04)"; var line = dark ? "#334155" : "rgba(0,0,0,.1)";
        var en = O(Spec["enLabels"]); var labels = Js(s["dir"]) == "rtl" ? O(Spec["arLabels"]) : new JsonObject();
        string L(string k) => Js(labels.ContainsKey(k) ? labels[k] : en[k]);
        var pages = new StringBuilder();
        var pgs = A(d["pages"]);
        for (var i = 0; i < pgs.Count; i++)
        {
            var pg = O(pgs[i]);
            pages.Append("<main class=\"page\" data-path=\"").Append(Esc(pg["path"])).Append('"').Append(i == 0 ? " data-home=\"1\"" : "").Append('>');
            foreach (var bv in A(pg["blocks"])) pages.Append(Block(O(bv), d, labels));
            pages.Append("</main>");
        }
        var fonts = O(Spec["fonts"]);
        var fontKey = Js(t["font"]);
        var css = Js(Spec["css"]);
        var tok = new (string, string)[] { ("bg", bg), ("tx", tx), ("font", Js(fonts.ContainsKey(fontKey) ? fonts[fontKey] : fonts["sans"])), ("primary", Esc(t["primary"])),
            ("radius", NumStr(Math.Max(0, Math.Min(32, Num(t["radius"], 10))))), ("soft", soft), ("line", line), ("navbg", dark ? "#0b1220" : "#fff"), ("cardbg", dark ? "#1e293b" : "#fff"), ("panelbg", dark ? "#0f172a" : "#fff") };
        foreach (var (k, v) in tok) css = css.Replace("{{" + k + "}}", v);
        var cart = "";
        if (IsTrue(shop["enabled"]))
        {
            cart = Js(Spec["cart"]);
            var keys = new List<string>();
            foreach (Match m in Regex.Matches(cart, "\\{\\{L\\.(\\w+)\\}\\}")) if (!keys.Contains(m.Groups[1].Value)) keys.Add(m.Groups[1].Value);
            foreach (var k in keys) cart = cart.Replace("{{L." + k + "}}", EscS(Js(labels.ContainsKey(k) ? labels[k] : en[k])));
        }
        var data = new StringBuilder("{\"shop\":").Append(IsTrue(shop["enabled"]) ? "true" : "false").Append(",\"cur\":").Append(Q(Js(shop["currency"]))).Append(",\"prods\":[");
        var first = true;
        foreach (var pv in A(shop["products"]))
        {
            var p = O(pv);
            if (!first) data.Append(',');
            first = false;
            var price = p["price"] is JsonValue pj && TryD(pj, out var pd) ? NumStr(pd) : Q(Js(p["price"]));
            data.Append("{\"sku\":").Append(Q(Js(p["sku"]))).Append(",\"name\":").Append(Q(Js(p["name"]))).Append(",\"price\":").Append(price).Append('}');
        }
        data.Append("],\"order\":").Append(Q(orderUrl)).Append(",\"msg\":").Append(Q(messageUrl)).Append(",\"mode\":").Append(Q(mode)).Append(",\"page\":\"\",\"y\":0,\"t\":{\"empty\":").Append(Q(L("empty")))
            .Append(",\"thanks\":").Append(Q(L("thanks"))).Append(",\"sent\":").Append(Q(L("sent"))).Append(",\"fail\":").Append(Q(L("fail"))).Append(",\"nopub\":").Append(Q(L("nopub"))).Append("}}");
        var script = Js(Spec["js"]).Replace("{{data}}", data.ToString().Replace("<", "\\u003c"));
        return "<!doctype html><html lang=\"" + Esc(s["lang"]) + "\" dir=\"" + Esc(s["dir"]) + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>" + Esc(s["title"]) + "</title>"
            + (Js(s["description"]).Length == 0 ? "" : "<meta name=\"description\" content=\"" + Esc(s["description"]) + "\">") + "<style>" + css + "</style></head><body>" + pages + cart + "<script>" + script + "</script></body></html>";
    }

    // ------------------------------------------------------------ helpers shared by the editor
    public static JsonObject BlockDef(string type)
    {
        foreach (var b in A(Spec["blocks"])) if (Js(b!["type"]) == type) return (JsonObject)b!;
        return new JsonObject();
    }
    private static readonly Random Rnd = new();
    public static string Uid() { const string c = "abcdefghijklmnopqrstuvwxyz0123456789"; var b = new StringBuilder(); for (var i = 0; i < 7; i++) b.Append(c[Rnd.Next(c.Length)]); return b.ToString(); }
    public static JsonObject NewBlock(string kind) => new() { ["id"] = Uid(), ["type"] = kind, ["props"] = BlockDef(kind)["defaults"]?.DeepClone() ?? new JsonObject() };
    public static JsonObject TemplateDesign(string key, string name, string cur)
    {
        string Inner(string s) { var j = System.Text.Json.JsonSerializer.Serialize(s); return j.Substring(1, j.Length - 2); }
        var s = O(Spec["templates"])[key]!.ToJsonString(new System.Text.Json.JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        return (JsonObject)JsonNode.Parse(s.Replace("{{name}}", Inner(name)).Replace("{{cur}}", Inner(cur)))!;
    }
    public static string OptLabel(string v) => v.StartsWith("web.") ? Loc.T(v) : v;
    public static string Summary(JsonNode? v) { if (v is JsonArray a) return a.Count.ToString(); var s = Js(v); return s.Length > 60 ? s.Substring(0, 60) : s; }
    public static string[] PublicUrls(string slug)
    {
        var s = Api.I.Session?.Server?.Trim().TrimEnd('/') ?? "";
        if (s.EndsWith("/api", StringComparison.OrdinalIgnoreCase)) s = s.Substring(0, s.Length - 4);
        s += "/api";
        return new[] { s + "/public/sites/" + slug + "/orders", s + "/public/sites/" + slug + "/messages" };
    }
    public static void Preview(string html, string slug)
    {
        try
        {
            var path = Path.Combine(Path.GetTempPath(), (slug.Length == 0 ? "site" : slug) + "-preview.html");
            File.WriteAllText(path, html, new UTF8Encoding(false));
            CalEngine.OpenUrl(path);
        }
        catch { /* no browser */ }
    }
    public static JsonObject ProductFields() => new()
    {
        ["f"] = JsonNode.Parse("[{\"key\":\"sku\",\"label\":\"SKU\",\"kind\":\"text\"},{\"key\":\"name\",\"label\":\"web.f.name\",\"kind\":\"text\"},{\"key\":\"price\",\"label\":\"Price\",\"kind\":\"number\",\"min\":0},"
            + "{\"key\":\"category\",\"label\":\"web.f.category\",\"kind\":\"text\"},{\"key\":\"description\",\"label\":\"web.f.text\",\"kind\":\"text\"},{\"key\":\"image\",\"label\":\"web.f.image\",\"kind\":\"image\"}]")
    };
    public static string FieldLabel(string l) => l == "SKU" || l == "Price" ? l : Loc.T(l);
    public static async void Run(Func<Task> f) { try { await f(); } catch (Exception e) { Ui.Warn(e.Message); } }
}

/// <summary>Edits a list of items (features, gallery pictures, FAQ ...): add, edit, remove, move.</summary>
internal sealed class SiteListDialog
{
    private readonly JsonArray _fields; private readonly JsonObject _default; private readonly DataGrid _grid; public JsonArray Items = new(); public bool Accepted;
    private readonly Window _w;

    public SiteListDialog(string title, JsonArray fields, JsonArray items, JsonObject dflt)
    {
        _fields = fields; _default = dflt;
        foreach (var i in items) Items.Add(i?.DeepClone());
        _grid = Ui.Grid(fields.Select(f => SiteEngine.FieldLabel(SiteEngine.Js(f!["label"]))).ToArray());
        Ui.OnOpen(_grid, Edit);
        _w = Ui.Dialog(title, 640, 460, out var body);
        _grid.Height = 300;
        body.Children.Add(_grid);
        body.Children.Add(Ui.Row(Ui.Btn("+", Add, "ghost"), Ui.Btn(Loc.T("web.edit"), Edit, "ghost"), Ui.Btn("↑", () => Move(-1), "ghost"), Ui.Btn("↓", () => Move(1), "ghost"), Ui.Btn("✕", Remove, "ghost"),
            Ui.Btn(Loc.T("cal.save"), () => { Accepted = true; _w.Close(); })));
        Refresh(0);
    }
    public bool Show() { _w.ShowDialog(); return Accepted; }

    private void Refresh(int sel)
    {
        Ui.Fill(_grid, Items.Select((it, n) => (_fields.Select(f => SiteEngine.Summary(it?[SiteEngine.Js(f!["key"])])).ToArray(), (object)n)));
        if (Items.Count > 0) _grid.SelectedIndex = Math.Min(sel, Items.Count - 1);
    }
    private void Add() { Items.Add(_default.DeepClone()); Refresh(Items.Count - 1); Edit(); }
    private void Edit()
    {
        var i = _grid.SelectedIndex; if (i < 0 || i >= Items.Count) return;
        var d = new SitePropsDialog(Loc.T("web.edit"), _fields, (JsonObject)Items[i]!);
        if (d.Show()) { Items[i] = d.Values; Refresh(i); }
    }
    private void Move(int n)
    {
        var i = _grid.SelectedIndex; if (i < 0 || i + n < 0 || i + n >= Items.Count) return;
        var node = Items[i]; Items.RemoveAt(i); Items.Insert(i + n, node); Refresh(i + n);
    }
    private void Remove() { var i = _grid.SelectedIndex; if (i >= 0 && i < Items.Count) { Items.RemoveAt(i); Refresh(i); } }
}

/// <summary>A form generated from a list of field definitions (text, textarea, number, select, image, list).</summary>
internal sealed class SitePropsDialog
{
    private readonly JsonArray _fields; public JsonObject Values; public bool Accepted;
    private readonly Dictionary<string, Control> _w = new(); private readonly Window _win;

    public SitePropsDialog(string title, JsonArray fields, JsonObject props)
    {
        _fields = fields; Values = (JsonObject)props.DeepClone();
        _win = Ui.Dialog(title, 540, Math.Min(720, 160 + 62 * fields.Count), out var body);
        foreach (var fv in fields)
        {
            var f = (JsonObject)fv!; var k = SiteEngine.Js(f["key"]); var kind = SiteEngine.Js(f["kind"]); var v = Values[k];
            Control c;
            if (kind == "textarea") c = new TextBox { Text = v is null ? "" : SiteEngine.Js(v), AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 80, Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8) };
            else if (kind == "select")
            {
                var cb = new ComboBox { Margin = new Thickness(0, 0, 0, 8) };
                foreach (var o in (JsonArray)f["options"]!) cb.Items.Add(new ComboBoxItem { Content = SiteEngine.OptLabel(SiteEngine.Js(o!["l"])), Tag = SiteEngine.Js(o["v"]) });
                var cur = SiteEngine.Js(v);
                for (var i = 0; i < cb.Items.Count; i++) if ((string)((ComboBoxItem)cb.Items[i]).Tag == cur) cb.SelectedIndex = i;
                if (cb.SelectedIndex < 0 && cb.Items.Count > 0) cb.SelectedIndex = 0;
                c = cb;
            }
            else if (kind == "list")
            {
                var btn = new Button { Padding = new Thickness(8, 4, 8, 4), Margin = new Thickness(0, 0, 0, 8), HorizontalAlignment = HorizontalAlignment.Left };
                btn.Content = Loc.T(SiteEngine.Js(f["label"])) + " (" + (v as JsonArray ?? new JsonArray()).Count + ")…";
                btn.Click += (_, _) => EditList(f, btn);
                c = btn;
            }
            else c = Ui.Input(v is null ? "" : SiteEngine.Js(v));
            _w[k] = c;
            body.Children.Add(Ui.Labeled(Loc.T(SiteEngine.Js(f["label"])), c));
        }
        body.Children.Add(Ui.Btn(Loc.T("cal.save"), Ok));
    }
    public bool Show() { _win.ShowDialog(); return Accepted; }

    private void EditList(JsonObject f, Button btn)
    {
        var key = SiteEngine.Js(f["key"]);
        var d = new SiteListDialog(Loc.T(SiteEngine.Js(f["label"])), (JsonArray)f["itemFields"]!, Values[key] as JsonArray ?? new JsonArray(), (JsonObject)(f["itemDefault"] ?? new JsonObject()));
        if (d.Show()) { Values[key] = d.Items; btn.Content = Loc.T(SiteEngine.Js(f["label"])) + " (" + d.Items.Count + ")…"; }
    }

    private void Ok()
    {
        foreach (var fv in _fields)
        {
            var f = (JsonObject)fv!; var k = SiteEngine.Js(f["key"]); var kind = SiteEngine.Js(f["kind"]); var c = _w[k];
            if (kind == "select") Values[k] = (string)((ComboBoxItem)((ComboBox)c).SelectedItem).Tag;
            else if (kind == "number")
            {
                if (!double.TryParse(((TextBox)c).Text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var x)) x = f.ContainsKey("min") ? SiteEngine.Num(f["min"], 0) : 0;
                if (f.ContainsKey("min")) x = Math.Max(SiteEngine.Num(f["min"], 0), x);
                if (f.ContainsKey("max")) x = Math.Min(SiteEngine.Num(f["max"], 0), x);
                Values[k] = x == Math.Floor(x) ? JsonValue.Create((long)x) : JsonValue.Create(x);
            }
            else if (kind != "list") Values[k] = ((TextBox)c).Text;
        }
        Accepted = true; _win.Close();
    }
}

/// <summary>Pages and blocks, theme and settings, shop products of one site.</summary>
internal sealed class SiteEditor
{
    private readonly JsonObject _row, _d; private readonly Action _onSaved; private readonly Window _win;
    private readonly ListBox _pages = new() { MinHeight = 300 }, _blocks = new() { MinHeight = 300 };
    private readonly ComboBox _kind = new() { MinWidth = 150, Margin = new Thickness(0, 0, 6, 0) };
    private readonly TextBox _prim, _bg, _tx, _radius, _title, _lang, _desc, _cur;
    private readonly ComboBox _font = new() { Margin = new Thickness(0, 0, 0, 8) }, _dir = new() { Margin = new Thickness(0, 0, 0, 8) };
    private readonly CheckBox _dark = new() { Content = Loc.T("web.dark"), Margin = new Thickness(0, 0, 0, 8) }, _shopOn = new() { Content = Loc.T("web.shopOn"), Margin = new Thickness(0, 0, 12, 0) };
    private readonly DataGrid _prod;
    private readonly TextBlock _msg = new() { Margin = new Thickness(0, 6, 0, 0) };
    private int _pi;

    public SiteEditor(JsonObject row, JsonObject design, Action onSaved)
    {
        _row = row; _d = design; _onSaved = onSaved;
        var th = (JsonObject)_d["theme"]!; var st = (JsonObject)_d["settings"]!; var shop = (JsonObject)_d["shop"]!;
        _win = Ui.Dialog(Loc.T("web.design") + " · " + SiteEngine.Js(row["name"]), 940, 680, out var body);
        var tabs = new TabControl { Height = 520 };
        // pages and blocks
        var pp = new Grid(); pp.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); pp.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        var left = new StackPanel { Margin = new Thickness(8) }; left.Children.Add(Ui.Text(Loc.T("web.p.pages"), 12, true)); left.Children.Add(_pages);
        left.Children.Add(Ui.Row(Ui.Btn("+", AddPage, "ghost"), Ui.Btn(Loc.T("web.edit"), EditPage, "ghost"), Ui.Btn("✕", DelPage, "ghost")));
        var right = new StackPanel { Margin = new Thickness(8) }; right.Children.Add(Ui.Text(Loc.T("web.p.layers"), 12, true)); right.Children.Add(_blocks);
        foreach (var b in (JsonArray)SiteEngine.Spec["blocks"]!) _kind.Items.Add(new ComboBoxItem { Content = Loc.T(SiteEngine.Js(b!["label"])), Tag = SiteEngine.Js(b["type"]) });
        _kind.SelectedIndex = 0;
        right.Children.Add(Ui.Row(_kind, Ui.Btn("+", AddBlock, "ghost"), Ui.Btn(Loc.T("web.edit"), EditBlock, "ghost"), Ui.Btn(Loc.T("web.duplicate"), DupBlock, "ghost"), Ui.Btn("↑", () => MoveBlock(-1), "ghost"), Ui.Btn("↓", () => MoveBlock(1), "ghost"), Ui.Btn("✕", DelBlock, "ghost")));
        Grid.SetColumn(right, 1); pp.Children.Add(left); pp.Children.Add(right);
        _pages.SelectionChanged += (_, _) => { if (_pages.SelectedIndex >= 0 && _pages.SelectedIndex != _pi) { _pi = _pages.SelectedIndex; RefreshBlocks(0); } };
        _blocks.MouseDoubleClick += (_, _) => EditBlock();
        tabs.Items.Add(new TabItem { Header = Loc.T("web.p.pages"), Content = pp });
        // theme and settings
        _prim = Ui.Input(SiteEngine.Js(th["primary"])); _bg = Ui.Input(SiteEngine.Js(th["bg"])); _tx = Ui.Input(SiteEngine.Js(th["text"]));
        foreach (var kv in (JsonObject)SiteEngine.Spec["fonts"]!) _font.Items.Add(kv.Key);
        _font.SelectedItem = th["font"] is null ? "sans" : SiteEngine.Js(th["font"]);
        _radius = Ui.Input(SiteEngine.Js(th["radius"] ?? JsonValue.Create(10))); _dark.IsChecked = th["dark"] is JsonValue dv && dv.TryGetValue<bool>(out var db) && db;
        _title = Ui.Input(SiteEngine.Js(st["title"])); _lang = Ui.Input(SiteEngine.Js(st["lang"])); _desc = Ui.Input(SiteEngine.Js(st["description"]));
        _dir.Items.Add("ltr"); _dir.Items.Add("rtl"); _dir.SelectedItem = SiteEngine.Js(st["dir"]) == "rtl" ? "rtl" : "ltr";
        var f2 = new StackPanel { Margin = new Thickness(12) };
        f2.Children.Add(Ui.Labeled(Loc.T("web.colorPrimary"), _prim)); f2.Children.Add(Ui.Labeled(Loc.T("web.colorBg"), _bg)); f2.Children.Add(Ui.Labeled(Loc.T("web.colorText"), _tx));
        f2.Children.Add(Ui.Labeled(Loc.T("web.font"), _font)); f2.Children.Add(Ui.Labeled(Loc.T("web.radius"), _radius)); f2.Children.Add(_dark);
        f2.Children.Add(Ui.Labeled(Loc.T("web.siteTitle"), _title)); f2.Children.Add(Ui.Labeled(Loc.T("web.language"), _lang)); f2.Children.Add(Ui.Labeled("dir", _dir)); f2.Children.Add(Ui.Labeled(Loc.T("web.metaDesc"), _desc));
        tabs.Items.Add(new TabItem { Header = Loc.T("web.details"), Content = new ScrollViewer { Content = f2 } });
        // shop
        _shopOn.IsChecked = shop["enabled"] is JsonValue sv && sv.TryGetValue<bool>(out var sb) && sb; _cur = Ui.Input(SiteEngine.Js(shop["currency"])); _cur.Width = 80;
        var pf = (JsonArray)SiteEngine.ProductFields()["f"]!;
        _prod = Ui.Grid(pf.Select(f => SiteEngine.FieldLabel(SiteEngine.Js(f!["label"]))).ToArray()); _prod.Height = 330; Ui.OnOpen(_prod, EditProd);
        var f3 = new StackPanel { Margin = new Thickness(12) };
        f3.Children.Add(Ui.Row(_shopOn, Ui.Text(Loc.T("web.currency"), 12), _cur)); f3.Children.Add(_prod);
        f3.Children.Add(Ui.Row(Ui.Btn("+", AddProd, "ghost"), Ui.Btn(Loc.T("web.edit"), EditProd, "ghost"), Ui.Btn("✕", DelProd, "ghost"), Ui.Btn(Loc.T("web.sync"), () => SiteEngine.Run(Sync), "ghost")));
        tabs.Items.Add(new TabItem { Header = Loc.T("web.p.shop"), Content = f3 });
        body.Children.Add(tabs);
        body.Children.Add(_msg);
        body.Children.Add(Ui.Row(Ui.Btn(Loc.T("web.preview"), Preview, "ghost"), Ui.Btn(Loc.T("cal.save"), () => SiteEngine.Run(Save)), Ui.Btn(Loc.T("cal.close"), () => _win.Close(), "ghost")));
        RefreshPages(0); RefreshProducts(0);
    }
    public void Show() => _win.ShowDialog();

    private JsonArray PageList => (JsonArray)_d["pages"]!;
    private JsonObject Page => (JsonObject)PageList[_pi]!;
    private JsonArray Bl => (JsonArray)Page["blocks"]!;

    private void RefreshPages(int sel)
    {
        _pi = Math.Max(0, Math.Min(sel, PageList.Count - 1));
        _pages.Items.Clear();
        foreach (var p in PageList) _pages.Items.Add(SiteEngine.Js(p!["title"]) + "   " + SiteEngine.Js(p["path"]));
        _pages.SelectedIndex = _pi; RefreshBlocks(0);
    }
    private void AddPage()
    {
        PageList.Add(new JsonObject { ["id"] = SiteEngine.Uid(), ["path"] = "/page" + (PageList.Count + 1), ["title"] = Loc.T("web.newPage"), ["blocks"] = new JsonArray(SiteEngine.NewBlock("nav"), SiteEngine.NewBlock("footer")) });
        RefreshPages(PageList.Count - 1); EditPage();
    }
    private void EditPage()
    {
        var p = Page;
        var f = (JsonArray)JsonNode.Parse("[{\"key\":\"title\",\"label\":\"web.pageTitle\",\"kind\":\"text\"},{\"key\":\"path\",\"label\":\"web.pagePath\",\"kind\":\"text\"}]")!;
        var d = new SitePropsDialog(Loc.T("web.edit"), f, p);
        if (d.Show())
        {
            var path = SiteEngine.Js(d.Values["path"]).Trim(); if (path.Length == 0) path = "/";
            p["title"] = SiteEngine.Js(d.Values["title"]); p["path"] = path.StartsWith("/") ? path : "/" + path; RefreshPages(_pi);
        }
    }
    private void DelPage() { if (PageList.Count > 1) { PageList.RemoveAt(_pi); RefreshPages(0); } }

    private void RefreshBlocks(int sel)
    {
        _blocks.Items.Clear();
        foreach (var bv in Bl)
        {
            var b = (JsonObject)bv!; var p = (JsonObject)(b["props"] ?? new JsonObject()); var first = "";
            foreach (var k in new[] { "title", "heading", "brand", "text", "button" }) if (SiteEngine.Js(p[k]).Length > 0 && SiteEngine.Js(p[k]) != "false") { first = SiteEngine.Js(p[k]); break; }
            var def = SiteEngine.BlockDef(SiteEngine.Js(b["type"]));
            _blocks.Items.Add((def.Count == 0 ? SiteEngine.Js(b["type"]) : Loc.T(SiteEngine.Js(def["label"]))) + "   " + (first.Length > 50 ? first.Substring(0, 50) : first));
        }
        if (Bl.Count > 0) _blocks.SelectedIndex = Math.Max(0, Math.Min(sel, Bl.Count - 1));
    }
    private void AddBlock()
    {
        var b = SiteEngine.NewBlock((string)((ComboBoxItem)_kind.SelectedItem).Tag);
        var pos = Bl.Count > 0 && SiteEngine.Js(Bl[Bl.Count - 1]!["type"]) == "footer" ? Bl.Count - 1 : Bl.Count;
        Bl.Insert(pos, b); RefreshBlocks(pos);
    }
    private void EditBlock()
    {
        var i = _blocks.SelectedIndex; if (i < 0 || i >= Bl.Count) return;
        var b = (JsonObject)Bl[i]!; var def = SiteEngine.BlockDef(SiteEngine.Js(b["type"]));
        var d = new SitePropsDialog(Loc.T(SiteEngine.Js(def["label"])), (JsonArray)def["fields"]!, (JsonObject)b["props"]!);
        if (d.Show()) { b["props"] = d.Values; RefreshBlocks(i); }
    }
    private void DupBlock()
    {
        var i = _blocks.SelectedIndex; if (i < 0 || i >= Bl.Count) return;
        var c = (JsonObject)Bl[i]!.DeepClone(); c["id"] = SiteEngine.Uid(); Bl.Insert(i + 1, c); RefreshBlocks(i + 1);
    }
    private void MoveBlock(int n)
    {
        var i = _blocks.SelectedIndex; if (i < 0 || i + n < 0 || i + n >= Bl.Count) return;
        var node = Bl[i]; Bl.RemoveAt(i); Bl.Insert(i + n, node); RefreshBlocks(i + n);
    }
    private void DelBlock() { var i = _blocks.SelectedIndex; if (i >= 0 && i < Bl.Count) { Bl.RemoveAt(i); RefreshBlocks(i); } }

    private JsonArray Products => (JsonArray)((JsonObject)_d["shop"]!)["products"]!;
    private void RefreshProducts(int sel)
    {
        var pf = (JsonArray)SiteEngine.ProductFields()["f"]!;
        Ui.Fill(_prod, Products.Select((p, n) => (pf.Select(f => SiteEngine.Js(p?[SiteEngine.Js(f!["key"])])).ToArray(), (object)n)));
        if (Products.Count > 0) _prod.SelectedIndex = Math.Min(sel, Products.Count - 1);
    }
    private void AddProd()
    {
        Products.Add(new JsonObject { ["sku"] = "SKU" + (Products.Count + 1), ["name"] = "", ["price"] = 0, ["category"] = "", ["description"] = "", ["image"] = "" });
        RefreshProducts(Products.Count - 1); EditProd();
    }
    private void EditProd()
    {
        var i = _prod.SelectedIndex; if (i < 0 || i >= Products.Count) return;
        var d = new SitePropsDialog(Loc.T("web.edit"), (JsonArray)SiteEngine.ProductFields()["f"]!, (JsonObject)Products[i]!);
        if (d.Show()) { Products[i] = d.Values; RefreshProducts(i); }
    }
    private void DelProd() { var i = _prod.SelectedIndex; if (i >= 0 && i < Products.Count) { Products.RemoveAt(i); RefreshProducts(i); } }

    private async Task Sync()
    {
        JsonArray lst;
        try { lst = (await Api.I.Ops(HttpMethod.Get, "/pos/records/product")) as JsonArray ?? new JsonArray(); } catch { _msg.Text = Loc.T("web.syncFail"); return; }
        var old = new Dictionary<string, JsonNode>();
        foreach (var p in Products) old[SiteEngine.Js(p!["sku"])] = p!;
        var outp = new JsonArray();
        foreach (var rv in lst)
        {
            var r = (JsonObject)rv!; var dd = r["data"] as JsonObject ?? new JsonObject(); var code = SiteEngine.Js(r["code"]);
            if (code.Length == 0 || SiteEngine.Js(r["status"]) == "inactive") continue;
            old.TryGetValue(code, out var o);
            var image = o is not null && SiteEngine.Js(o["image"]).Length > 0 ? SiteEngine.Js(o["image"]) : (dd["image"] is JsonValue iv && iv.TryGetValue<string>(out var istr) ? istr : "");
            outp.Add(new JsonObject
            {
                ["sku"] = code, ["name"] = SiteEngine.Js(dd["name"]).Length == 0 ? code : SiteEngine.Js(dd["name"]), ["price"] = SiteEngine.Num(dd["price"], 0), ["category"] = SiteEngine.Js(dd["category"]),
                ["description"] = o is null ? "" : SiteEngine.Js(o["description"]), ["image"] = image
            });
        }
        ((JsonObject)_d["shop"]!)["products"] = outp; _shopOn.IsChecked = true; RefreshProducts(0); _msg.Text = outp.Count.ToString();
    }

    private JsonObject Collect()
    {
        var th = (JsonObject)_d["theme"]!; var st = (JsonObject)_d["settings"]!; var shop = (JsonObject)_d["shop"]!;
        if (_prim.Text.Trim().Length > 0) th["primary"] = _prim.Text.Trim();
        if (_bg.Text.Trim().Length > 0) th["bg"] = _bg.Text.Trim();
        if (_tx.Text.Trim().Length > 0) th["text"] = _tx.Text.Trim();
        th["font"] = (string)_font.SelectedItem; th["dark"] = _dark.IsChecked == true;
        if (double.TryParse(_radius.Text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var rd)) th["radius"] = (long)rd;
        st["title"] = _title.Text.Trim().Length == 0 ? SiteEngine.Js(_row["name"]) : _title.Text.Trim();
        st["lang"] = _lang.Text.Trim().Length == 0 ? "en" : _lang.Text.Trim(); st["dir"] = (string)_dir.SelectedItem;
        if (_desc.Text.Trim().Length > 0) st["description"] = _desc.Text.Trim(); else st.Remove("description");
        shop["enabled"] = _shopOn.IsChecked == true; shop["currency"] = _cur.Text.Trim().Length == 0 ? SiteEngine.Js(shop["currency"]) : _cur.Text.Trim();
        return _d;
    }
    private async Task Save()
    {
        var design = Collect();
        await Api.I.Ops(HttpMethod.Put, "/website/sites/" + SiteEngine.Js(_row["id"]), new JsonObject { ["name"] = SiteEngine.Js(_row["name"]), ["design"] = design.DeepClone() });
        _msg.Text = Loc.T("web.saved"); _onSaved();
    }
    private void Preview() => SiteEngine.Preview(SiteEngine.Render(Collect()), SiteEngine.Js(_row["slug"]));
}

/// <summary>Website builder: the list of sites, publish / unpublish and the orders and messages visitors sent.</summary>
public sealed class SiteView : PageView
{
    private readonly ComboBox _pick = new() { MinWidth = 180, Margin = new Thickness(0, 0, 8, 0) };
    private readonly List<string> _modes = new();
    private readonly Dictionary<string, Button> _btns = new();
    private readonly Border _host = new() { MinHeight = 340 };
    private DataGrid _grid = Ui.Grid();
    private readonly TextBlock _msg = new() { Margin = new Thickness(0, 6, 0, 0) };
    private string _pending = "";
    private bool _loading;

    public SiteView()
    {
        Root.Children.Add(Ui.Text(Loc.T("tab.web"), 20, true));
        _pick.Items.Add(Loc.T("web.sites")); _modes.Add("sites");
        if (Api.I.Can("web.orders.manage")) { _pick.Items.Add(Loc.T("web.orders")); _modes.Add("subs"); }
        _pick.SelectedIndex = 0;
        _pick.SelectionChanged += async (_, _) => { if (!_loading) await Safe(Reload); };
        var bar = new WrapPanel { Margin = new Thickness(0, 8, 0, 8) };
        bar.Children.Add(_pick);
        void Add(string key, string text, Action fn, string? kind = null) { var b = Ui.Btn(text, fn, kind); _btns[key] = b; bar.Children.Add(b); }
        Add("new", Loc.T("web.newSite"), () => _ = Safe(NewSite)); Add("design", Loc.T("web.design"), () => _ = Safe(Design)); Add("preview", Loc.T("web.preview"), () => _ = Safe(PreviewSel), "ghost");
        Add("save", Loc.T("web.download"), () => _ = Safe(SaveHtml), "ghost"); Add("pub", Loc.T("web.publish"), () => _ = Safe(Publish)); Add("unpub", Loc.T("web.unpublish"), () => _ = Safe(Unpublish), "ghost");
        Add("del", "✕", () => _ = Safe(Delete), "danger");
        Add("s_new", Loc.T("web.st.new"), () => _ = Safe(() => Status("new")), "ghost"); Add("s_conf", Loc.T("web.st.confirmed"), () => _ = Safe(() => Status("confirmed")), "ghost");
        Add("s_ship", Loc.T("web.st.shipped"), () => _ = Safe(() => Status("shipped")), "ghost"); Add("s_done", Loc.T("web.st.done"), () => _ = Safe(() => Status("done")), "ghost");
        Add("s_can", Loc.T("web.st.cancelled"), () => _ = Safe(() => Status("cancelled")), "ghost");
        Root.Children.Add(bar);
        _host.Child = _grid;
        Root.Children.Add(_host); Root.Children.Add(_msg);
    }

    private string Mode => _modes[Math.Max(0, _pick.SelectedIndex)];

    public override async Task Reload()
    {
        var subs = Mode == "subs";
        foreach (var (k, b) in _btns)
        {
            if (k.StartsWith("s_")) b.Visibility = subs ? Visibility.Visible : Visibility.Collapsed;
            else if (k == "new" || k == "design") b.Visibility = !subs && Api.I.Can("web.edit") ? Visibility.Visible : Visibility.Collapsed;
            else if (k == "pub" || k == "unpub" || k == "del") b.Visibility = !subs && Api.I.Can("web.publish") ? Visibility.Visible : Visibility.Collapsed;
            else b.Visibility = subs ? Visibility.Collapsed : Visibility.Visible;
        }
        var keep = _pending; _pending = "";
        _msg.Text = keep.Length == 0 ? "…" : keep;
        if (subs)
        {
            _grid = Ui.Grid("#", Loc.T("web.site"), "Type", Loc.T("web.customer"), "Total", "Status", "Date"); _host.Child = _grid;
            var subsList = await Api.I.Ops(HttpMethod.Get, "/website/submissions") as JsonArray ?? new JsonArray();
            var sites = await Api.I.Ops(HttpMethod.Get, "/website/sites") as JsonArray ?? new JsonArray();
            var names = new Dictionary<string, string>();
            foreach (var s in sites) names[SiteEngine.Js(s!["id"])] = SiteEngine.Js(s["name"]);
            Ui.Fill(_grid, subsList.Select(sv =>
            {
                var s = (JsonObject)sv!; var order = SiteEngine.Js(s["kind"]) == "order"; var note = SiteEngine.Js(s["note"]); var created = SiteEngine.Js(s["createdAt"]);
                return (new[] { SiteEngine.Js(s["number"]), names.TryGetValue(SiteEngine.Js(s["siteId"]), out var n) ? n : "", SiteEngine.Js(s["kind"]), SiteEngine.Js(s["name"]) + (SiteEngine.Js(s["email"]).Length == 0 ? "" : " · " + SiteEngine.Js(s["email"])),
                    order ? SiteEngine.Js(s["total"]) + " " + SiteEngine.Js(s["currency"]) : (note.Length > 40 ? note.Substring(0, 40) : note), SiteEngine.Js(s["status"]), created.Substring(0, Math.Min(16, created.Length)).Replace('T', ' ') }, (object)s);
            }));
            if (keep.Length == 0) _msg.Text = subsList.Count == 0 ? Loc.T("web.none") : "";
        }
        else
        {
            _grid = Ui.Grid(Loc.T("web.siteName"), "URL", "Status", "Currency", Loc.T("web.view")); _host.Child = _grid;
            var rows = await Api.I.Ops(HttpMethod.Get, "/website/sites") as JsonArray ?? new JsonArray();
            Ui.Fill(_grid, rows.Select(rv =>
            {
                var r = (JsonObject)rv!; var up = SiteEngine.Js(r["updatedAt"]);
                return (new[] { SiteEngine.Js(r["name"]), "/s/" + SiteEngine.Js(r["slug"]), r["published"] is JsonValue pv && pv.TryGetValue<bool>(out var pb) && pb ? Loc.T("web.live") : Loc.T("web.draft"), SiteEngine.Js(r["currency"]),
                    up.Substring(0, Math.Min(16, up.Length)).Replace('T', ' ') }, (object)r);
            }));
            if (keep.Length == 0) _msg.Text = rows.Count == 0 ? Loc.T("web.none") : "";
        }
    }

    private JsonObject? Sel() => Ui.Selected<JsonObject>(_grid);

    private async Task NewSite()
    {
        var name = Ui.Input(); var cur = Ui.Input("SAR"); var tpl = new ComboBox { Margin = new Thickness(0, 0, 0, 8) };
        var ks = new[] { "shop", "business", "blank" };
        foreach (var k in ks) tpl.Items.Add(Loc.T("web.t." + k));
        tpl.SelectedIndex = 0;
        var ok = false;
        var w = Ui.Dialog(Loc.T("web.newSite"), 400, 330, out var body);
        body.Children.Add(Ui.Labeled(Loc.T("web.siteName"), name)); body.Children.Add(Ui.Labeled(Loc.T("web.template"), tpl)); body.Children.Add(Ui.Labeled(Loc.T("web.currency"), cur));
        body.Children.Add(Ui.Btn(Loc.T("web.create"), () => { ok = true; w.Close(); }));
        w.ShowDialog();
        if (!ok || name.Text.Trim().Length == 0) return;
        var c = cur.Text.Trim().Length == 0 ? "SAR" : cur.Text.Trim();
        var row = await Api.I.Ops(HttpMethod.Post, "/website/sites", new JsonObject { ["name"] = name.Text.Trim(), ["design"] = SiteEngine.TemplateDesign(ks[tpl.SelectedIndex], name.Text.Trim(), c), ["currency"] = c }) as JsonObject;
        await Reload();
        if (row is not null) await OpenEditor(row);
    }

    private async Task OpenEditor(JsonObject row)
    {
        var full = await Api.I.Ops(HttpMethod.Get, "/website/sites/" + SiteEngine.Js(row["id"])) as JsonObject;
        if (full is null) return;
        new SiteEditor(full, (JsonObject)full["design"]!, () => _ = Safe(Reload)).Show();
    }
    private async Task Design() { var r = Sel(); if (r is not null) await OpenEditor(r); }

    private async Task<(JsonObject row, JsonObject design)?> Fetch()
    {
        var r = Sel(); if (r is null) return null;
        var full = await Api.I.Ops(HttpMethod.Get, "/website/sites/" + SiteEngine.Js(r["id"])) as JsonObject;
        return full is null ? null : (r, (JsonObject)full["design"]!);
    }
    private static string HtmlFor(JsonObject r, JsonObject d, bool publish)
    {
        if (!publish) return SiteEngine.Render(d);
        var u = SiteEngine.PublicUrls(SiteEngine.Js(r["slug"]));
        return SiteEngine.Render(d, u[0], u[1], "publish");
    }
    private async Task PreviewSel() { var f = await Fetch(); if (f is { } x) SiteEngine.Preview(HtmlFor(x.row, x.design, false), SiteEngine.Js(x.row["slug"])); }
    private async Task SaveHtml()
    {
        var f = await Fetch(); if (f is not { } x) return;
        var dlg = new Microsoft.Win32.SaveFileDialog { FileName = SiteEngine.Js(x.row["slug"]) + ".html", Filter = "HTML (*.html)|*.html" };
        if (dlg.ShowDialog() != true) return;
        File.WriteAllText(dlg.FileName, HtmlFor(x.row, x.design, false), new UTF8Encoding(false));
        _msg.Text = dlg.FileName;
    }
    private async Task Publish()
    {
        var f = await Fetch(); if (f is not { } x) return;
        var shop = (JsonObject)x.design["shop"]!;
        var prods = new JsonArray();
        foreach (var p in (JsonArray)shop["products"]!) prods.Add(new JsonObject { ["sku"] = p!["sku"]?.DeepClone(), ["name"] = p["name"]?.DeepClone(), ["price"] = p["price"]?.DeepClone() });
        await Api.I.Ops(HttpMethod.Post, "/website/sites/" + SiteEngine.Js(x.row["id"]) + "/publish", new JsonObject { ["html"] = HtmlFor(x.row, x.design, true), ["products"] = prods, ["currency"] = shop["currency"]?.DeepClone() });
        _pending = Loc.T("web.isLive"); await Reload();
    }
    private async Task Unpublish() { var r = Sel(); if (r is null) return; await Api.I.Ops(HttpMethod.Post, "/website/sites/" + SiteEngine.Js(r["id"]) + "/unpublish", new JsonObject()); await Reload(); }
    private async Task Delete()
    {
        var r = Sel(); if (r is null || !Ui.Ask(Loc.T("web.deleteAsk", ("n", SiteEngine.Js(r["name"]))), Loc.T("cal.delete"), Loc.T("cal.close"))) return;
        await Api.I.Ops(HttpMethod.Delete, "/website/sites/" + SiteEngine.Js(r["id"])); await Reload();
    }
    private async Task Status(string s)
    {
        var r = Sel(); if (r is null) return;
        await Api.I.Ops(HttpMethod.Put, "/website/submissions/" + SiteEngine.Js(r["id"]), new JsonObject { ["status"] = s }); await Reload();
    }
}
