package erp;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.*;

/**
 * Turns a site design (theme + pages of blocks) into one self-contained html document - a port of the portal's site-renderer.ts.
 * The css, the cart script and the labels come from website.json (shared by every desktop app); only the blocks are rendered here.
 */
public final class SiteRender {
    private SiteRender() { }

    static Map<String, Object> SPEC;
    public static synchronized Map<String, Object> spec() {
        if (SPEC == null) {
            try (InputStream in = SiteRender.class.getResourceAsStream("/website.json")) {
                SPEC = Json.obj(Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8)));
            } catch (Exception e) { throw new RuntimeException(e); }
        }
        return SPEC;
    }

    /** String(v ?? '') the way JavaScript prints a JSON value */
    static String js(Object v) {
        if (v == null) return "";
        if (v instanceof Boolean) return v.toString();
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (d == Math.rint(d) && Math.abs(d) < 1e15) return String.valueOf((long) d);
            return String.valueOf(v);
        }
        return v.toString();
    }
    static double num(Object v, double d) {
        if (v == null) return d;
        try {
            double x = v instanceof Number ? ((Number) v).doubleValue() : Double.parseDouble(v.toString().trim());
            return Double.isNaN(x) ? d : x;
        } catch (Exception e) { return d; }
    }
    static String esc(Object v) { return js(v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;"); }

    static final Pattern HREF = Pattern.compile("^(https?://|mailto:|tel:|#)", Pattern.CASE_INSENSITIVE), EXT = Pattern.compile("^https?:", Pattern.CASE_INSENSITIVE),
        IMG = Pattern.compile("^(https?://|data:image/(png|jpe?g|gif|webp|svg\\+xml);base64,)", Pattern.CASE_INSENSITIVE),
        EMB = Pattern.compile("^https://(www\\.youtube\\.com/embed/|www\\.google\\.com/maps/embed|www\\.openstreetmap\\.org/export/embed)", Pattern.CASE_INSENSITIVE);

    static String href(Object l) {
        String s = js(l).strip();
        if (s.isEmpty()) return "#/";
        if (s.startsWith("/")) return "#" + s;
        return HREF.matcher(s).find() ? s : "#";
    }
    static String img(Object v) { String s = js(v).strip(); return IMG.matcher(s).find() ? s : ""; }
    static String embed(Object v) { String s = js(v).strip(); return EMB.matcher(s).find() ? s : ""; }
    static String ext(String h) { return EXT.matcher(h).find() ? " target=\"_blank\" rel=\"noopener\"" : ""; }
    static String paras(Object t) {
        StringBuilder b = new StringBuilder();
        for (String p : js(t).split("\n{2,}", -1)) b.append("<p>").append(esc(p.strip()).replace("\n", "<br>")).append("</p>");
        return b.toString();
    }
    static String money(double n, Object cur) { return String.format(Locale.ENGLISH, "%,.2f", Math.round(n * 100 + 1e-9) / 100.0) + " " + esc(cur); }
    static String heading(Object t) { return js(t).isEmpty() ? "" : "<h2 class=\"h2\">" + esc(t) + "</h2>"; }

    static String section(Map<String, Object> b, String inner) {
        Map<String, Object> p = Json.obj(b.get("props"));
        Object bg = p.get("bgStyle") != null ? p.get("bgStyle") : "none";
        String pad = p.get("pad") == null ? "56px" : switch (js(p.get("pad"))) { case "s" -> "28px"; case "m" -> "56px"; case "l" -> "96px"; default -> "56px"; };
        return "<section class=\"blk bg-" + esc(bg) + " \" style=\"padding-block:" + pad + "\"><div class=\"wrap\">" + inner + "</div></section>";
    }

    private static Object g(Map<String, Object> p, String k, Object dv) { return p.get(k) != null ? p.get(k) : dv; }
    private static String ph(String icon) { return "<div class=\"ph\">" + icon + "</div>"; }

    static String block(Map<String, Object> b, Map<String, Object> d, Map<String, Object> labels) {
        Map<String, Object> p = Json.obj(b.get("props")), shop = Json.obj(d.get("shop"));
        String t = js(b.get("type"));
        switch (t) {
            case "nav": {
                StringBuilder links = new StringBuilder();
                for (Object pv : Json.arr(d.get("pages"))) { Map<String, Object> pg = Json.obj(pv); links.append("<a href=\"#").append(esc(pg.get("path"))).append("\" data-nav=\"").append(esc(pg.get("path"))).append("\">").append(esc(pg.get("title"))).append("</a>"); }
                String logo = img(g(p, "logo", ""));
                String cart = Boolean.TRUE.equals(shop.get("enabled")) ? "<button class=\"cartbtn\" type=\"button\" data-cart-open aria-label=\"cart\">🛒 <b data-cart-count>0</b></button>" : "";
                return "<header class=\"nav" + ("yes".equals(js(g(p, "sticky", ""))) ? " sticky" : "") + "\"><div class=\"wrap navin\"><a class=\"brand\" href=\"#/\">"
                    + (logo.isEmpty() ? "" : "<img src=\"" + esc(logo) + "\" alt=\"\">") + "<span>" + esc(g(p, "brand", "")) + "</span></a>\n        <nav class=\"links\">" + links + "</nav>" + cart + "</div></header>";
            }
            case "hero": {
                String bg = img(g(p, "image", ""));
                double ov = Math.max(0, Math.min(85, num(g(p, "overlay", ""), 0))) / 100;
                String h = switch (js(g(p, "height", ""))) { case "s" -> "320px"; case "m" -> "460px"; case "l" -> "620px"; default -> "460px"; };
                String l1 = href(g(p, "link", "")), l2 = href(g(p, "link2", ""));
                String b1 = js(g(p, "button", "")).isEmpty() ? "" : "<a class=\"btn\" href=\"" + esc(l1) + "\"" + ext(l1) + ">" + esc(g(p, "button", "")) + "</a>";
                String b2 = js(g(p, "button2", "")).isEmpty() ? "" : "<a class=\"btn ghost\" href=\"" + esc(l2) + "\"" + ext(l2) + ">" + esc(g(p, "button2", "")) + "</a>";
                String ovs = ov == Math.rint(ov) ? String.valueOf((long) ov) : String.valueOf(ov);
                String bgs = bg.isEmpty() ? "" : "background-image:linear-gradient(rgba(0,0,0," + ovs + "),rgba(0,0,0," + ovs + ")),url('" + esc(bg) + "')";
                return "<section class=\"blk hero " + (bg.isEmpty() ? "" : "has-img") + "\" style=\"min-height:" + h + ";text-align:" + esc(g(p, "align", "center")) + ";" + bgs + "\">\n        <div class=\"wrap\"><h1>"
                    + esc(g(p, "title", "")) + "</h1><p class=\"lead\">" + esc(g(p, "subtitle", "")) + "</p><div class=\"btns\">" + b1 + b2 + "</div></div></section>";
            }
            case "text":
                return section(b, "<div style=\"text-align:" + esc(g(p, "align", "start")) + "\">" + heading(g(p, "heading", "")) + "<div class=\"prose\">" + paras(g(p, "body", "")) + "</div></div>");
            case "image": {
                String s = img(g(p, "image", ""));
                String body = s.isEmpty() ? ph("🖼️") : "<figure class=\"fig" + ("full".equals(js(g(p, "width", ""))) ? " full" : "") + "\"><img src=\"" + esc(s) + "\" alt=\"" + esc(g(p, "alt", "")) + "\">"
                    + (js(g(p, "caption", "")).isEmpty() ? "" : "<figcaption>" + esc(g(p, "caption", "")) + "</figcaption>") + "</figure>";
                return section(b, body);
            }
            case "features": {
                StringBuilder it = new StringBuilder();
                for (Object iv : Json.arr(g(p, "items", null))) { Map<String, Object> i = Json.obj(iv); it.append("<div class=\"card feat\"><div class=\"ico\">").append(esc(i.get("icon"))).append("</div><h3>").append(esc(i.get("title"))).append("</h3><p>").append(esc(i.get("text"))).append("</p></div>"); }
                return section(b, heading(g(p, "heading", "")) + "<div class=\"grid c" + esc(g(p, "columns", "3")) + "\">" + it + "</div>");
            }
            case "products": {
                List<Object> lst = new ArrayList<>(Json.arr(shop.get("products")));
                String cat = js(g(p, "category", "")).strip().toLowerCase();
                if (!cat.isEmpty()) lst.removeIf(x -> !js(Json.obj(x).get("category")).toLowerCase().equals(cat));
                int lim = (int) num(g(p, "limit", 8), 8);
                if (lim == 0) lim = 8;
                lim = Math.max(1, lim);
                if (lst.size() > lim) lst = lst.subList(0, lim);
                StringBuilder cards = new StringBuilder();
                Object cur = shop.get("currency");
                for (Object xv : lst) {
                    Map<String, Object> x = Json.obj(xv);
                    String im = img(x.get("image"));
                    cards.append("<div class=\"card prod\"><div class=\"pimg\">").append(im.isEmpty() ? "<span>🛍️</span>" : "<img src=\"" + esc(im) + "\" alt=\"" + esc(x.get("name")) + "\" loading=\"lazy\">")
                        .append("</div>\n        <h3>").append(esc(x.get("name"))).append("</h3>").append(js(x.get("description")).isEmpty() ? "" : "<p class=\"muted\">" + esc(x.get("description")) + "</p>")
                        .append("<div class=\"price\">").append(money(num(x.get("price"), 0), cur)).append("</div>\n        <button class=\"btn sm\" type=\"button\" data-add=\"").append(esc(x.get("sku"))).append("\">")
                        .append(esc(labels.getOrDefault("add", "Add to cart"))).append("</button></div>");
                }
                String empty = "<p class=\"muted center\">" + esc(labels.getOrDefault("noProducts", "No products yet. Sync products from the point of sale in the shop settings.")) + "</p>";
                return section(b, heading(g(p, "heading", "")) + (lst.isEmpty() ? empty : "<div class=\"grid c" + esc(g(p, "columns", "4")) + "\">" + cards + "</div>"));
            }
            case "gallery": {
                StringBuilder it = new StringBuilder();
                for (Object iv : Json.arr(g(p, "items", null))) { Map<String, Object> i = Json.obj(iv); String im = img(i.get("image")); it.append(im.isEmpty() ? ph("🖼️") : "<img class=\"g\" src=\"" + esc(im) + "\" alt=\"" + esc(i.get("alt")) + "\" loading=\"lazy\">"); }
                return section(b, heading(g(p, "heading", "")) + "<div class=\"grid c" + esc(g(p, "columns", "3")) + "\">" + it + "</div>");
            }
            case "testimonials": {
                StringBuilder it = new StringBuilder();
                for (Object iv : Json.arr(g(p, "items", null))) { Map<String, Object> i = Json.obj(iv); it.append("<blockquote class=\"card\"><p>“").append(esc(i.get("text"))).append("”</p><footer><b>").append(esc(i.get("name"))).append("</b>")
                    .append(js(i.get("role")).isEmpty() ? "" : " · <span class=\"muted\">" + esc(i.get("role")) + "</span>").append("</footer></blockquote>"); }
                return section(b, heading(g(p, "heading", "")) + "<div class=\"grid c2\">" + it + "</div>");
            }
            case "faq": {
                StringBuilder it = new StringBuilder();
                for (Object iv : Json.arr(g(p, "items", null))) { Map<String, Object> i = Json.obj(iv); it.append("<details class=\"card\"><summary>").append(esc(i.get("q"))).append("</summary><p>").append(esc(i.get("a"))).append("</p></details>"); }
                return section(b, heading(g(p, "heading", "")) + "<div class=\"faq\">" + it + "</div>");
            }
            case "cta": {
                String l = href(g(p, "link", ""));
                String btn = js(g(p, "button", "")).isEmpty() ? "" : "<a class=\"btn light\" href=\"" + esc(l) + "\"" + ext(l) + ">" + esc(g(p, "button", "")) + "</a>";
                return section(b, "<div class=\"center\"><h2 class=\"h2\">" + esc(g(p, "heading", "")) + "</h2><p class=\"lead\">" + esc(g(p, "text", "")) + "</p>" + btn + "</div>");
            }
            case "contact": {
                String ph = js(g(p, "phone", "")), em = js(g(p, "email", "")), ad = js(g(p, "address", ""));
                String info = (ph.isEmpty() ? "" : "<div>📞 <a href=\"tel:" + esc(ph) + "\">" + esc(ph) + "</a></div>") + (em.isEmpty() ? "" : "<div>✉️ <a href=\"mailto:" + esc(em) + "\">" + esc(em) + "</a></div>") + (ad.isEmpty() ? "" : "<div>📍 " + esc(ad) + "</div>");
                return section(b, "<div class=\"two\"><div>" + heading(g(p, "heading", "")) + "<p>" + esc(g(p, "text", "")) + "</p><div class=\"info\">" + info + "</div></div>\n        <form class=\"card form\" data-contact><input name=\"name\" placeholder=\""
                    + esc(labels.getOrDefault("name", "Your name")) + "\" required maxlength=\"120\"><input name=\"email\" type=\"email\" placeholder=\"" + esc(labels.getOrDefault("email", "E-mail")) + "\" maxlength=\"160\">\n        "
                    + "<input name=\"phone\" placeholder=\"" + esc(labels.getOrDefault("phone", "Phone")) + "\" maxlength=\"40\"><textarea name=\"message\" rows=\"4\" placeholder=\"" + esc(labels.getOrDefault("message", "Message")) + "\" required maxlength=\"2000\"></textarea>\n        "
                    + "<input name=\"website\" class=\"hp\" tabindex=\"-1\" autocomplete=\"off\"><button class=\"btn\" type=\"submit\">" + esc(g(p, "button", "")) + "</button><p class=\"status\" data-status></p></form></div>");
            }
            case "embed": {
                String u = embed(g(p, "url", ""));
                double h = Math.min(900, num(g(p, "height", 360), 360));
                if (h == 0) h = 360;
                h = Math.max(200, h);
                return section(b, u.isEmpty() ? ph("🗺️") : "<iframe class=\"embed\" src=\"" + esc(u) + "\" style=\"height:" + js(h) + "px\" loading=\"lazy\" referrerpolicy=\"no-referrer\" allowfullscreen></iframe>");
            }
            case "spacer": {
                double h = num(g(p, "height", 48), 48);
                if (h == 0) h = 48;
                return "<div style=\"height:" + js(Math.max(8, Math.min(300, h))) + "px\"></div>";
            }
            case "footer": {
                StringBuilder links = new StringBuilder();
                for (Object iv : Json.arr(g(p, "items", null))) { Map<String, Object> i = Json.obj(iv); String l = href(i.get("link")); links.append("<a href=\"").append(esc(l)).append("\"").append(ext(l)).append(">").append(esc(i.get("label"))).append("</a>"); }
                return "<footer class=\"foot\"><div class=\"wrap\"><div class=\"flinks\">" + links + "</div><p>" + esc(g(p, "text", "")) + "</p></div></footer>";
            }
            default: return "";
        }
    }

    static String q(Object s) {
        String v = js(s);
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < v.length(); i++) {
            char c = v.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                default: if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    public static String render(Map<String, Object> d) { return render(d, "", "", "download"); }

    public static String render(Map<String, Object> d, String orderUrl, String messageUrl, String mode) {
        Map<String, Object> sp = spec(), t = Json.obj(d.get("theme")), shop = Json.obj(d.get("shop")), s = Json.obj(d.get("settings"));
        boolean dark = Boolean.TRUE.equals(t.get("dark"));
        String bg = dark ? "#0f172a" : js(t.get("bg")), tx = dark ? "#e5e7eb" : js(t.get("text")), soft = dark ? "#1e293b" : "rgba(0,0,0,.04)", line = dark ? "#334155" : "rgba(0,0,0,.1)";
        Map<String, Object> en = Json.obj(sp.get("enLabels")), labels = "rtl".equals(js(s.get("dir"))) ? Json.obj(sp.get("arLabels")) : new LinkedHashMap<>();
        java.util.function.Function<String, String> L = k -> js(labels.containsKey(k) ? labels.get(k) : en.get(k));
        StringBuilder pages = new StringBuilder();
        List<Object> pgs = Json.arr(d.get("pages"));
        for (int i = 0; i < pgs.size(); i++) {
            Map<String, Object> pg = Json.obj(pgs.get(i));
            pages.append("<main class=\"page\" data-path=\"").append(esc(pg.get("path"))).append("\"").append(i == 0 ? " data-home=\"1\"" : "").append(">");
            for (Object bv : Json.arr(pg.get("blocks"))) pages.append(block(Json.obj(bv), d, labels));
            pages.append("</main>");
        }
        Map<String, Object> fonts = Json.obj(sp.get("fonts"));
        String css = js(sp.get("css"));
        String[][] tok = {{"bg", bg}, {"tx", tx}, {"font", js(fonts.containsKey(js(t.get("font"))) ? fonts.get(js(t.get("font"))) : fonts.get("sans"))}, {"primary", esc(t.get("primary"))},
            {"radius", js(Math.max(0, Math.min(32, num(t.get("radius"), 10))))}, {"soft", soft}, {"line", line}, {"navbg", dark ? "#0b1220" : "#fff"}, {"cardbg", dark ? "#1e293b" : "#fff"}, {"panelbg", dark ? "#0f172a" : "#fff"}};
        for (String[] k : tok) css = css.replace("{{" + k[0] + "}}", k[1]);
        String cart = "";
        if (Boolean.TRUE.equals(shop.get("enabled"))) {
            cart = js(sp.get("cart"));
            Matcher m = Pattern.compile("\\{\\{L\\.(\\w+)\\}\\}").matcher(cart);
            LinkedHashSet<String> ks = new LinkedHashSet<>();
            while (m.find()) ks.add(m.group(1));
            for (String k : ks) cart = cart.replace("{{L." + k + "}}", esc(labels.containsKey(k) ? labels.get(k) : en.get(k)));
        }
        StringBuilder data = new StringBuilder("{\"shop\":").append(Boolean.TRUE.equals(shop.get("enabled"))).append(",\"cur\":").append(q(shop.get("currency"))).append(",\"prods\":[");
        boolean first = true;
        for (Object pv : Json.arr(shop.get("products"))) {
            Map<String, Object> p = Json.obj(pv);
            if (!first) data.append(',');
            first = false;
            data.append("{\"sku\":").append(q(p.get("sku"))).append(",\"name\":").append(q(p.get("name"))).append(",\"price\":").append(p.get("price") instanceof Number ? js(p.get("price")) : q(p.get("price"))).append('}');
        }
        data.append("],\"order\":").append(q(orderUrl)).append(",\"msg\":").append(q(messageUrl)).append(",\"mode\":").append(q(mode)).append(",\"page\":\"\",\"y\":0,\"t\":{\"empty\":").append(q(L.apply("empty")))
            .append(",\"thanks\":").append(q(L.apply("thanks"))).append(",\"sent\":").append(q(L.apply("sent"))).append(",\"fail\":").append(q(L.apply("fail"))).append(",\"nopub\":").append(q(L.apply("nopub"))).append("}}");
        String script = js(sp.get("js")).replace("{{data}}", data.toString().replace("<", "\\u003c"));
        return "<!doctype html><html lang=\"" + esc(s.get("lang")) + "\" dir=\"" + esc(s.get("dir")) + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>" + esc(s.get("title")) + "</title>"
            + (js(s.get("description")).isEmpty() ? "" : "<meta name=\"description\" content=\"" + esc(s.get("description")) + "\">") + "<style>" + css + "</style></head><body>" + pages + cart + "<script>" + script + "</script></body></html>";
    }
}
