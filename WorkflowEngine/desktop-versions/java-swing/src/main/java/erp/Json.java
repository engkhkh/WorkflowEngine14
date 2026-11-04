package erp;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A small JSON reader/writer: objects are Map, arrays are List, numbers are Long or Double. No dependencies. */
public final class Json {
    private final String s;
    private int p;

    private Json(String s) { this.s = s; }

    public static Object parse(String text) {
        Json j = new Json(text);
        j.ws();
        Object v = j.value();
        j.ws();
        if (j.p != j.s.length()) throw new IllegalArgumentException("Unexpected data at " + j.p);
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Object o) { return o instanceof Map ? (Map<String, Object>) o : new LinkedHashMap<>(); }

    @SuppressWarnings("unchecked")
    public static List<Object> arr(Object o) { return o instanceof List ? (List<Object>) o : new ArrayList<>(); }

    public static String str(Object o) { return o == null ? "" : o instanceof String ? (String) o : write(o); }

    private void ws() { while (p < s.length() && Character.isWhitespace(s.charAt(p))) p++; }

    private Object value() {
        if (p >= s.length()) throw new IllegalArgumentException("Unexpected end");
        char c = s.charAt(p);
        switch (c) {
            case '{': return object();
            case '[': return array();
            case '"': return string();
            case 't': p += 4; return Boolean.TRUE;
            case 'f': p += 5; return Boolean.FALSE;
            case 'n': p += 4; return null;
            default: return number();
        }
    }

    private Map<String, Object> object() {
        Map<String, Object> m = new LinkedHashMap<>();
        p++; ws();
        if (s.charAt(p) == '}') { p++; return m; }
        while (true) {
            ws();
            String k = string();
            ws(); p++; ws();   // ':'
            m.put(k, value());
            ws();
            char c = s.charAt(p++);
            if (c == '}') return m;
            if (c != ',') throw new IllegalArgumentException("Expected , at " + p);
        }
    }

    private List<Object> array() {
        List<Object> l = new ArrayList<>();
        p++; ws();
        if (s.charAt(p) == ']') { p++; return l; }
        while (true) {
            ws();
            l.add(value());
            ws();
            char c = s.charAt(p++);
            if (c == ']') return l;
            if (c != ',') throw new IllegalArgumentException("Expected , at " + p);
        }
    }

    private String string() {
        StringBuilder b = new StringBuilder();
        p++;
        while (true) {
            char c = s.charAt(p++);
            if (c == '"') return b.toString();
            if (c != '\\') { b.append(c); continue; }
            char e = s.charAt(p++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 't': b.append('\t'); break;
                case 'r': b.append('\r'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u': b.append((char) Integer.parseInt(s.substring(p, p + 4), 16)); p += 4; break;
                default: b.append(e);
            }
        }
    }

    private Object number() {
        int st = p;
        while (p < s.length() && "+-0123456789.eE".indexOf(s.charAt(p)) >= 0) p++;
        String n = s.substring(st, p);
        if (n.isEmpty()) throw new IllegalArgumentException("Unexpected character at " + st);
        try { if (n.indexOf('.') < 0 && n.indexOf('e') < 0 && n.indexOf('E') < 0) return Long.parseLong(n); } catch (NumberFormatException ignored) { /* fall through to double */ }
        return Double.parseDouble(n);
    }

    public static String write(Object o) {
        StringBuilder b = new StringBuilder();
        write(b, o);
        return b.toString();
    }

    private static void write(StringBuilder b, Object o) {
        if (o == null) b.append("null");
        else if (o instanceof String) quote(b, (String) o);
        else if (o instanceof Boolean) b.append(o);
        else if (o instanceof Number) {
            double d = ((Number) o).doubleValue();
            if (d == Math.rint(d) && Math.abs(d) < 1e15) b.append((long) d); else b.append(o);
        } else if (o instanceof Map) {
            b.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                if (!first) b.append(',');
                first = false;
                quote(b, String.valueOf(e.getKey()));
                b.append(':');
                write(b, e.getValue());
            }
            b.append('}');
        } else if (o instanceof List) {
            b.append('[');
            boolean first = true;
            for (Object x : (List<?>) o) {
                if (!first) b.append(',');
                first = false;
                write(b, x);
            }
            b.append(']');
        } else quote(b, o.toString());
    }

    private static void quote(StringBuilder b, String v) {
        b.append('"');
        for (int i = 0; i < v.length(); i++) {
            char c = v.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        b.append('"');
    }
}
