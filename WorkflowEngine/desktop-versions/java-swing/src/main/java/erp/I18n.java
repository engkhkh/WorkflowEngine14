package erp;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.prefs.Preferences;

/** Texts (English / Arabic) and the module catalog, read from the JSON files in the resources folder. */
public final class I18n {
    private static final Preferences PREFS = Preferences.userNodeForPackage(I18n.class);
    private static Map<String, Object> dict;
    public static List<Object> modules;
    public static String lang = "en";

    private I18n() { }

    private static Object load(String name) {
        try (InputStream in = I18n.class.getResourceAsStream("/" + name)) {
            return Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException e) { throw new IllegalStateException(e); }
    }

    public static void init() {
        dict = Json.obj(load("i18n.json"));
        modules = Json.arr(Json.obj(load("catalog.json")).get("modules"));
        lang = "ar".equals(PREFS.get("lang", "en")) ? "ar" : "en";
    }

    public static void setLang(String l) { lang = l; PREFS.put("lang", l); }
    public static boolean rtl() { return "ar".equals(lang); }

    public static String t(String key, String... vars) {
        Object v = Json.obj(dict.get(lang)).get(key);
        if (v == null) v = Json.obj(dict.get("en")).get(key);
        String s = v == null ? key : (String) v;
        for (int i = 0; i + 1 < vars.length; i += 2) s = s.replace("{" + vars[i] + "}", vars[i + 1]);
        return s;
    }

    public static String name(Map<String, Object> o) { return Json.str(o.get(rtl() ? "ar" : "en")); }

    public static List<Map<String, Object>> visibleModules() {
        java.util.ArrayList<Map<String, Object>> out = new java.util.ArrayList<>();
        for (Object m : modules) {
            Map<String, Object> mm = Json.obj(m);
            for (Object k : Json.arr(mm.get("kinds"))) if (Api.I.can(Json.str(Json.obj(k).get("view")))) { out.add(mm); break; }
        }
        return out;
    }
}
