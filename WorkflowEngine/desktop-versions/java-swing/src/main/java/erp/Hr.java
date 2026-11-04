package erp;

import java.awt.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.*;
import java.util.List;
import java.util.regex.*;
import java.util.zip.*;
import javax.swing.*;
import javax.xml.stream.*;

/**
 * HR: overview, employees (with Excel / CSV import), leave requests and balances, recruitment, performance and the org structure.
 * The reports and the import fields are described by hr.json (shared by every desktop app).
 */
public final class Hr {
    private Hr() { }

    static Map<String, Object> SPEC;
    static synchronized Map<String, Object> spec() {
        if (SPEC == null) {
            try (InputStream in = Hr.class.getResourceAsStream("/hr.json")) {
                SPEC = Json.obj(Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8)));
            } catch (Exception e) { throw new RuntimeException(e); }
        }
        return SPEC;
    }
    static int ix() { return "ar".equals(I18n.lang) ? 1 : 0; }
    static String L(String key, Object... a) {
        String s = Json.str(Json.arr(Json.obj(spec().get("labels")).get(key)).get(ix()));
        for (int i = 0; i < a.length; i++) s = s.replace("{" + i + "}", String.valueOf(a[i]));
        return s;
    }
    static String I(String key, Object... kv) {
        String s = Json.str(Json.arr(Json.obj(spec().get("imp")).get(key)).get(ix()));
        for (int i = 0; i + 1 < kv.length; i += 2) s = s.replace("{" + kv[i] + "}", String.valueOf(kv[i + 1]));
        return s;
    }
    static String tx(Object o) { return Json.str(Json.obj(o).get(ix() == 1 ? "ar" : "en")); }
    static double num(Object v) {
        double n;
        if (v instanceof Number) n = ((Number) v).doubleValue();
        else { try { n = Double.parseDouble(String.valueOf(v)); } catch (Exception e) { n = 0; } }
        return Double.isFinite(n) ? n : 0;
    }
    static String money(double v) { return String.format(Locale.ENGLISH, v == Math.floor(v) ? "%,.0f" : "%,.2f", v); }
    static String norm(Object s) { return String.valueOf(s == null ? "" : s).trim().toLowerCase().replaceAll("[\\s_\\-.]+", " "); }

    // ------------------------------------------------------------ reading .xlsx / .csv (java.util.zip + StAX, no libraries)
    /** cells: String, Double or null */
    public static List<List<Object>> readTable(String path) throws Exception {
        String low = path.toLowerCase();
        List<List<Object>> rows;
        if (low.endsWith(".xlsx")) rows = readXlsx(path);
        else if (low.endsWith(".csv") || low.endsWith(".txt")) rows = parseCsv(new String(Files.readAllBytes(new File(path).toPath()), StandardCharsets.UTF_8));
        else throw new IllegalArgumentException("type");
        List<List<Object>> kept = new ArrayList<>();
        for (List<Object> r : rows) { boolean any = false; for (Object c : r) if (c != null && !String.valueOf(c).trim().isEmpty()) any = true; if (any) kept.add(r); }
        return kept;
    }

    static List<List<Object>> readXlsx(String path) throws Exception {
        try (ZipFile z = new ZipFile(path)) {
            List<String> shared = new ArrayList<>();
            ZipEntry se = z.getEntry("xl/sharedStrings.xml");
            XMLInputFactory f = XMLInputFactory.newFactory();
            f.setProperty(XMLInputFactory.SUPPORT_DTD, false);
            f.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
            if (se != null) {
                XMLStreamReader r = f.createXMLStreamReader(z.getInputStream(se));
                StringBuilder cur = null;
                while (r.hasNext()) {
                    int ev = r.next();
                    if (ev == XMLStreamConstants.START_ELEMENT) {
                        if (r.getLocalName().equals("si")) cur = new StringBuilder();
                        else if (r.getLocalName().equals("t") && cur != null) cur.append(r.getElementText());
                    } else if (ev == XMLStreamConstants.END_ELEMENT && r.getLocalName().equals("si") && cur != null) { shared.add(cur.toString()); cur = null; }
                }
            }
            ZipEntry sheet = z.getEntry("xl/worksheets/sheet1.xml");
            if (sheet == null) {
                List<String> names = new ArrayList<>();
                for (Enumeration<? extends ZipEntry> e = z.entries(); e.hasMoreElements(); ) { String n = e.nextElement().getName(); if (n.startsWith("xl/worksheets/") && n.endsWith(".xml")) names.add(n); }
                if (names.isEmpty()) throw new IOException("no sheet");
                Collections.sort(names);
                sheet = z.getEntry(names.get(0));
            }
            List<List<Object>> rows = new ArrayList<>();
            XMLStreamReader r = f.createXMLStreamReader(z.getInputStream(sheet));
            List<Object> row = null;
            String t = "";
            while (r.hasNext()) {
                int ev = r.next();
                if (ev == XMLStreamConstants.START_ELEMENT) {
                    String n = r.getLocalName();
                    if (n.equals("row")) {
                        row = new ArrayList<>();
                        String rr = r.getAttributeValue(null, "r");
                        int idx = rr == null ? rows.size() : Integer.parseInt(rr) - 1;
                        while (rows.size() < idx) rows.add(new ArrayList<>());
                    } else if (n.equals("c") && row != null) {
                        String ref = r.getAttributeValue(null, "r"); t = String.valueOf(r.getAttributeValue(null, "t"));
                        int ci = colIndex(ref == null ? "A" : ref);
                        while (row.size() < ci) row.add(null);
                        row.add(null);
                    } else if (n.equals("v") && row != null && !row.isEmpty()) {
                        String v = r.getElementText();
                        Object val;
                        if (t.equals("s")) val = shared.get(Integer.parseInt(v));
                        else if (t.equals("str") || t.equals("e")) val = v;
                        else if (t.equals("b")) val = v.equals("1") ? "TRUE" : "FALSE";
                        else val = Double.parseDouble(v);
                        row.set(row.size() - 1, val);
                    } else if (n.equals("is") && row != null && !row.isEmpty()) {
                        StringBuilder sb = new StringBuilder();
                        while (r.hasNext()) { int e2 = r.next(); if (e2 == XMLStreamConstants.START_ELEMENT && r.getLocalName().equals("t")) sb.append(r.getElementText()); else if (e2 == XMLStreamConstants.END_ELEMENT && r.getLocalName().equals("is")) break; }
                        row.set(row.size() - 1, sb.toString());
                    }
                } else if (ev == XMLStreamConstants.END_ELEMENT && r.getLocalName().equals("row") && row != null) { rows.add(row); row = null; }
            }
            return rows;
        }
    }
    static int colIndex(String ref) { int n = 0; for (char c : ref.toCharArray()) { if (Character.isLetter(c)) n = n * 26 + (Character.toUpperCase(c) - 'A' + 1); else break; } return n - 1; }

    static List<List<Object>> parseCsv(String text) {
        if (text.startsWith("﻿")) text = text.substring(1);
        int nl = text.indexOf('\n');
        String first = nl < 0 ? text : text.substring(0, nl);
        char delim = ','; int best = 0;
        for (char d : new char[]{',', ';', '\t'}) { int n = 0; for (char c : first.toCharArray()) if (c == d) n++; if (n > best) { best = n; delim = d; } }
        List<List<Object>> rows = new ArrayList<>(); List<Object> row = new ArrayList<>(); StringBuilder cur = new StringBuilder(); boolean q = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (q) { if (c == '"') { if (i + 1 < text.length() && text.charAt(i + 1) == '"') { cur.append('"'); i++; } else q = false; } else cur.append(c); }
            else if (c == '"') q = true;
            else if (c == delim) { row.add(cur.toString()); cur.setLength(0); }
            else if (c == '\n' || c == '\r') { if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++; row.add(cur.toString()); rows.add(row); row = new ArrayList<>(); cur.setLength(0); }
            else cur.append(c);
        }
        if (cur.length() > 0 || !row.isEmpty()) { row.add(cur.toString()); rows.add(row); }
        return rows;
    }

    // ------------------------------------------------------------ matching and validating
    static String cellText(Object v) {
        if (v == null) return "";
        if (v instanceof Double) { double d = (Double) v; return d == Math.floor(d) ? String.valueOf((long) d) : String.valueOf(d); }
        return String.valueOf(v).trim();
    }

    static String guessField(List<Map<String, Object>> fields, Object heading) {
        String h = norm(heading);
        if (h.isEmpty()) return null;
        String flat = h.replace(" ", "");
        for (Map<String, Object> f : fields) for (Object n : Json.arr(f.get("names"))) { String nn = norm(n); if (nn.equals(h) || nn.replace(" ", "").equals(flat)) return Json.str(f.get("key")); }
        return null;
    }

    static String valid(int y, int m, int d) { try { return LocalDate.of(y, m, d).toString(); } catch (Exception e) { return null; } }
    static String parseDate(Object v) {
        if (v == null) return null;
        if (v instanceof Double) { double d = (Double) v; return d > 20000 && d < 80000 ? LocalDate.of(1899, 12, 30).plusDays((long) d).toString() : null; }
        String s = String.valueOf(v).trim();
        Matcher m = Pattern.compile("^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})").matcher(s);
        if (m.find()) return valid(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
        m = Pattern.compile("^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})").matcher(s);
        if (m.find()) { int a = Integer.parseInt(m.group(1)), b = Integer.parseInt(m.group(2)), y = Integer.parseInt(m.group(3)); return a > 12 ? valid(y, b, a) : (b > 12 ? valid(y, a, b) : valid(y, b, a)); }   // day first
        return null;
    }

    public static final class Mapped { public int row; public Map<String, Object> data = new LinkedHashMap<>(); public List<String> errors = new ArrayList<>(); }

    public static List<Mapped> mapRows(List<List<Object>> rows, Map<Integer, String> mapping, int first, boolean canSalary) {
        List<Mapped> out = new ArrayList<>();
        Map<String, Integer> byField = new HashMap<>();
        mapping.forEach((c, f) -> { if (f != null && !f.isEmpty()) byField.put(f, c); });
        Map<String, Object> st = Json.obj(spec().get("status"));
        for (int i = first; i < rows.size(); i++) {
            List<Object> r = rows.get(i);
            boolean blank = true; for (Object c : r) if (c != null && !String.valueOf(c).trim().isEmpty()) blank = false;
            if (blank) continue;
            Mapped m = new Mapped(); m.row = i + 1;
            for (Object fo : Json.arr(spec().get("fields"))) {
                Map<String, Object> f = Json.obj(fo);
                String key = Json.str(f.get("key"));
                if (!byField.containsKey(key) || (Boolean.TRUE.equals(f.get("salary")) && !canSalary)) continue;
                int col = byField.get(key);
                Object raw = col < r.size() ? r.get(col) : null;
                if (raw == null || String.valueOf(raw).trim().isEmpty()) { if (Boolean.TRUE.equals(f.get("required"))) m.errors.add(key); continue; }
                String t = Json.str(f.get("type"));
                switch (t) {
                    case "date": { String d = parseDate(raw); if (d != null) m.data.put(key, d); else m.errors.add(key + ":date"); break; }
                    case "number": {
                        double n; boolean ok = true;
                        if (raw instanceof Double) n = (Double) raw; else { try { n = Double.parseDouble(String.valueOf(raw).replace(",", "").replace(" ", "")); } catch (Exception e) { n = 0; ok = false; } }
                        if (ok) m.data.put(key, n == Math.floor(n) ? (Object) (long) n : (Object) n); else m.errors.add(key + ":number");
                        break;
                    }
                    case "status": {
                        String s = norm(raw); String v = s.isEmpty() ? "Active" : (st.containsKey(s) ? Json.str(st.get(s)) : Json.str(st.get(s.replace(" ", ""))));
                        if (!v.isEmpty()) m.data.put(key, v); else m.errors.add(key + ":status");
                        break;
                    }
                    case "gender": {
                        String s = norm(raw);
                        if (Set.of("m", "male", "man", "ذكر", "رجل").contains(s)) m.data.put(key, "Male");
                        else if (Set.of("f", "female", "woman", "أنثى", "انثى", "امرأة").contains(s)) m.data.put(key, "Female");
                        else m.errors.add(key + ":gender");
                        break;
                    }
                    case "email": { String e = String.valueOf(raw).trim(); if (e.contains("@")) m.data.put(key, e); else m.errors.add(key + ":email"); break; }
                    default: m.data.put(key, cellText(raw));
                }
            }
            if (!m.data.containsKey("status") || Json.str(m.data.get("status")).isEmpty()) m.data.put("status", "Active");
            out.add(m);
        }
        return out;
    }
    static void markDuplicates(List<Mapped> ms) {
        Set<String> seen = new HashSet<>();
        for (Mapped m : ms) { String no = Json.str(m.data.get("empNo")).toLowerCase(); if (!no.isEmpty() && seen.contains(no)) m.errors.add("empNo:dup"); if (!no.isEmpty()) seen.add(no); }
    }

    // ------------------------------------------------------------ reports
    public static final class Built { public final List<String[]> rows = new ArrayList<>(); public final List<Object> payloads = new ArrayList<>(); public String foot = ""; }

    static String empName(Map<String, Object> e) {
        String ar = Json.str(e.get("fullNameAr"));
        String n = "ar".equals(I18n.lang) && !ar.isEmpty() ? ar : Json.str(e.get("fullName"));
        return n.isEmpty() ? Json.str(e.get("empNo")) : n;
    }

    static List<Object> visibleCols(Map<String, Object> rep) {
        List<Object> out = new ArrayList<>();
        for (Object c : Json.arr(rep.get("cols"))) {
            if ("employees".equals(rep.get("id")) && "Salary".equals(Json.obj(c).get("en")) && !Api.I.can("hr.employees.salary")) continue;
            out.add(c);
        }
        return out;
    }

    public static Built build(String rid, Map<String, Object> data, String today) {
        Built b = new Built();
        Map<String, Map<String, Object>> emps = new HashMap<>();
        for (Object e : Json.arr(data.get("employees"))) emps.put(Json.str(Json.obj(e).get("empNo")), Json.obj(e));
        java.util.function.Function<String, String> nm = no -> emps.containsKey(no) ? empName(emps.get(no)) : no;
        java.util.function.BiConsumer<String[], Object> add = (r, p) -> { b.rows.add(r); b.payloads.add(p); };
        switch (rid) {
            case "overview": {
                Map<String, Object> s = Json.obj(data.get("summary"));
                for (Object mo : Json.arr(spec().get("measures"))) {
                    List<Object> m = Json.arr(mo);
                    String key = Json.str(m.get(0));
                    if (s.get(key) == null) continue;
                    Object v = s.get(key);
                    add.accept(new String[]{Json.str(m.get(ix() + 1)), v instanceof Number ? money(((Number) v).doubleValue()) : Json.str(v)}, null);
                }
                break;
            }
            case "employees": {
                boolean sal = Api.I.can("hr.employees.salary");
                for (Object eo : Json.arr(data.get("employees"))) {
                    Map<String, Object> e = Json.obj(eo);
                    String hd = Json.str(e.get("hireDate")); hd = hd.length() > 10 ? hd.substring(0, 10) : hd;
                    List<String> r = new ArrayList<>(List.of(Json.str(e.get("empNo")), empName(e), Json.str(e.get("position")), Json.str(e.get("unit")), Json.str(e.get("status")), hd));
                    if (sal) r.add(money(num(e.get("basicSalary"))));
                    add.accept(r.toArray(new String[0]), e);
                }
                break;
            }
            case "leave":
                for (Object xo : Json.arr(data.get("leave"))) {
                    Map<String, Object> x = Json.obj(xo), d = Json.obj(x.get("data"));
                    add.accept(new String[]{nm.apply(Json.str(x.get("empNo"))), Json.str(d.get("type")), cut(d.get("from")), cut(d.get("to")), String.valueOf((long) num(d.get("days"))), Json.str(x.get("status"))}, x);
                }
                break;
            case "balances":
                for (Object eo : Json.arr(data.get("employees"))) {
                    Map<String, Object> e = Json.obj(eo);
                    if ("Terminated".equals(Json.str(e.get("status")))) continue;
                    for (Object to : Json.arr(data.get("leavetype"))) {
                        Map<String, Object> ty = Json.obj(to), td = Json.obj(ty.get("data"));
                        double total = num(td.get("days")), used = 0;
                        for (Object xo : Json.arr(data.get("leave"))) {
                            Map<String, Object> x = Json.obj(xo), d = Json.obj(x.get("data"));
                            if (Json.str(x.get("empNo")).equals(Json.str(e.get("empNo"))) && "Approved".equals(Json.str(x.get("status"))) && Json.str(d.get("type")).equals(Json.str(ty.get("code"))) && Json.str(d.get("from")).startsWith(today.substring(0, 4))) used += num(d.get("days"));
                        }
                        String name = Json.str(td.get("name")).isEmpty() ? Json.str(ty.get("code")) : Json.str(td.get("name"));
                        add.accept(new String[]{empName(e), name, money(total), money(used), money(total - used)}, null);
                    }
                }
                break;
            case "recruit": {
                Map<String, String> vac = new HashMap<>();
                for (Object vo : Json.arr(data.get("vacancy"))) { Map<String, Object> v = Json.obj(vo); String t = Json.str(Json.obj(v.get("data")).get("title")); vac.put(Json.str(v.get("code")), t.isEmpty() ? Json.str(v.get("code")) : t); }
                for (Object co : Json.arr(data.get("candidate"))) {
                    Map<String, Object> c = Json.obj(co), d = Json.obj(c.get("data"));
                    String vk = Json.str(d.get("vacancy"));
                    String name = Json.str(d.get("name")).isEmpty() ? Json.str(c.get("code")) : Json.str(d.get("name"));
                    add.accept(new String[]{name, vac.getOrDefault(vk, vk), Json.str(d.get("email")), Json.str(c.get("status")).isEmpty() ? "Applied" : Json.str(c.get("status"))}, c);
                }
                break;
            }
            case "perf": {
                List<Integer> rated = new ArrayList<>();
                for (Object xo : Json.arr(data.get("review"))) {
                    Map<String, Object> x = Json.obj(xo), d = Json.obj(x.get("data"));
                    int rating = (int) num(d.get("rating"));
                    add.accept(new String[]{nm.apply(Json.str(x.get("empNo"))), Json.str(d.get("stage")), rating > 0 ? String.valueOf(rating) : ""}, x);
                    if (rating > 0) rated.add(rating);
                }
                if (!rated.isEmpty()) {
                    double sum = 0; for (int r : rated) sum += r;
                    StringBuilder dist = new StringBuilder();
                    for (int n = 1; n <= 5; n++) dist.append(n).append("★ ").append(Collections.frequency(rated, n)).append("  ");
                    b.foot = L("avg") + ": " + String.format(Locale.ENGLISH, "%.2f", sum / rated.size()) + "   " + L("rated") + ": " + rated.size() + "   " + L("dist") + ": " + dist.toString().trim();
                }
                break;
            }
            case "org":
                for (Object uo : Json.arr(data.get("unit"))) {
                    Map<String, Object> u = Json.obj(uo), d = Json.obj(u.get("data"));
                    int head = 0;
                    for (Object eo : Json.arr(data.get("employees"))) { String un = Json.str(Json.obj(eo).get("unit")); if (un.equals(Json.str(u.get("code"))) || un.equals(Json.str(d.get("name")))) head++; }
                    String ar = Json.str(d.get("nameAr"));
                    add.accept(new String[]{Json.str(u.get("code")), "ar".equals(I18n.lang) && !ar.isEmpty() ? ar : Json.str(d.get("name")), Json.str(d.get("level")), Json.str(d.get("parent")), String.valueOf(head)}, u);
                }
                break;
            default:
        }
        return b;
    }
    static String cut(Object o) { String s = Json.str(o); return s.length() > 10 ? s.substring(0, 10) : s; }

    static final Map<String, String> VIEW = new LinkedHashMap<>();
    static {
        VIEW.put("overview", "hr.reports.view"); VIEW.put("employees", "hr.employees.view"); VIEW.put("leave", "hr.leave.view"); VIEW.put("balances", "hr.leave.view");
        VIEW.put("recruit", "hr.recruitment.view"); VIEW.put("perf", "hr.performance.view"); VIEW.put("org", "hr.org.view");
    }
    static String[] kindsOf(String id) {
        switch (id) {
            case "leave": return new String[]{"leave"};
            case "balances": return new String[]{"leave", "leavetype"};
            case "recruit": return new String[]{"candidate", "vacancy"};
            case "perf": return new String[]{"review"};
            case "org": return new String[]{"unit"};
            default: return new String[0];
        }
    }
    static Map<String, Object> fetch(String id) {
        Map<String, Object> out = new HashMap<>();
        if (id.equals("overview")) { out.put("summary", Api.I.hr("GET", "summary", null)); return out; }
        if (!id.equals("recruit")) out.put("employees", Api.I.hr("GET", "employees", null));
        for (String k : kindsOf(id)) {
            try { out.put(k, Api.I.hr("GET", "records/" + k, null)); } catch (Exception e) { out.put(k, new ArrayList<>()); }   // a list the user may not read stays empty
        }
        return out;
    }

    // ------------------------------------------------------------ import dialog
    public static final class ImportDialog extends JDialog {
        final List<Map<String, Object>> fields = new ArrayList<>();
        public final JTextField path = new JTextField();
        public final JCheckBox head = new JCheckBox(I("hasHeader"), true), upd = new JCheckBox(I("update"), true);
        public final JLabel summary = new JLabel(), msg = new JLabel();
        public final JButton runBtn = new JButton();
        public Ui.DataTable table = new Ui.DataTable();
        final JScrollPane tableScroll = new JScrollPane(table);
        final JPanel mapPanel = new JPanel();
        List<List<Object>> rows = new ArrayList<>();
        public Map<Integer, String> mapping = new TreeMap<>();
        public List<Mapped> mapped = new ArrayList<>();
        final Map<Integer, JComboBox<String>> combos = new TreeMap<>();
        final Runnable onDone;

        public ImportDialog(Window owner, Runnable onDone) {
            super(owner, I("title"), ModalityType.APPLICATION_MODAL);
            this.onDone = onDone;
            for (Object f : Json.arr(spec().get("fields"))) if (!Boolean.TRUE.equals(Json.obj(f).get("salary")) || Api.I.can("hr.employees.salary")) fields.add(Json.obj(f));
            setLayout(new BorderLayout(8, 8));
            JPanel top = new JPanel(); top.setLayout(new BoxLayout(top, BoxLayout.Y_AXIS)); top.setBorder(BorderFactory.createEmptyBorder(10, 12, 0, 12));
            JLabel intro = new JLabel("<html><body style='width:760px'>" + I("intro") + "</body></html>");
            top.add(intro);
            JPanel bar = new JPanel(new BorderLayout(6, 0)); path.setToolTipText(L("file"));
            JPanel btns = new JPanel(new FlowLayout(FlowLayout.LEADING, 4, 0));
            btns.add(Ui.button(L("pick"), this::choose, "ghost")); btns.add(Ui.button(L("load"), this::load, null)); btns.add(Ui.button(L("template"), this::template, "ghost"));
            bar.add(path, BorderLayout.CENTER); bar.add(btns, BorderLayout.EAST);
            top.add(Box.createVerticalStrut(6)); top.add(bar); top.add(head);
            mapPanel.setLayout(new GridLayout(0, 2, 8, 2));
            JScrollPane ms = new JScrollPane(mapPanel); ms.setPreferredSize(new Dimension(800, 130));
            top.add(ms); top.add(summary);
            add(top, BorderLayout.NORTH);
            add(tableScroll, BorderLayout.CENTER);
            JPanel bot = new JPanel(); bot.setLayout(new BoxLayout(bot, BoxLayout.Y_AXIS)); bot.setBorder(BorderFactory.createEmptyBorder(0, 12, 10, 12));
            runBtn.setEnabled(false); runBtn.addActionListener(e -> run());
            JButton close = new JButton(I("close")); close.addActionListener(e -> dispose());
            JPanel row = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0)); row.add(runBtn); row.add(close);
            bot.add(upd); bot.add(msg); bot.add(row);
            add(bot, BorderLayout.SOUTH);
            head.addActionListener(e -> remap());
            setSize(920, 700); setLocationRelativeTo(owner);
        }

        void choose() {
            JFileChooser fc = new JFileChooser();
            if (fc.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) { path.setText(fc.getSelectedFile().getAbsolutePath()); load(); }
        }

        void template() {
            JFileChooser fc = new JFileChooser(); fc.setSelectedFile(new File("employees-template.csv"));
            if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
            try (Writer w = new OutputStreamWriter(new FileOutputStream(fc.getSelectedFile()), StandardCharsets.UTF_8)) {
                StringBuilder h = new StringBuilder("﻿"), s = new StringBuilder();
                for (Map<String, Object> f : fields) { h.append(Json.str(f.get("key"))).append(','); s.append(Json.str(f.get("sample"))).append(','); }
                w.write(h.substring(0, h.length() - 1) + "\n" + s.substring(0, s.length() - 1) + "\n");
                msg.setText(L("templated", fc.getSelectedFile().getPath()));
            } catch (IOException e) { Ui.warn(this, String.valueOf(e.getMessage())); }
        }

        public void load() {
            String p = path.getText().trim();
            if (p.isEmpty()) { msg.setText(L("nofile")); return; }
            try { rows = readTable(p); }
            catch (IllegalArgumentException e) { msg.setText(I("badType")); return; }
            catch (Exception e) { msg.setText(I("readError")); return; }
            if (rows.isEmpty()) { msg.setText(I("empty")); return; }
            if (rows.size() > (int) num(spec().get("maxRows"))) { msg.setText(I("tooMany")); rows = new ArrayList<>(); return; }
            msg.setText("");
            autoMap();
        }

        void autoMap() {
            int width = 0; for (List<Object> r : rows) width = Math.max(width, r.size());
            mapping = new TreeMap<>(); Set<String> used = new HashSet<>();
            for (int c = 0; c < width; c++) {
                String g = guessField(fields, c < rows.get(0).size() ? rows.get(0).get(c) : null);
                if (g != null && !used.contains(g)) { mapping.put(c, g); used.add(g); }
            }
            head.setSelected(mapping.size() >= 2 || mapping.containsKey(0));
            buildMapUi(width);
            remap();
        }

        boolean building;
        void buildMapUi(int width) {
            building = true;
            mapPanel.removeAll(); combos.clear();
            for (int c = 0; c < width; c++) {
                String h = c < rows.get(0).size() ? cellText(rows.get(0).get(c)) : "";
                mapPanel.add(new JLabel(I("column") + " " + (c + 1) + "  " + h));
                JComboBox<String> cb = new JComboBox<>();
                cb.addItem(I("skip"));
                int sel = 0;
                for (int i = 0; i < fields.size(); i++) { cb.addItem(tx(fields.get(i))); if (Json.str(fields.get(i).get("key")).equals(mapping.get(c))) sel = i + 1; }
                cb.setSelectedIndex(sel);
                final int col = c;
                cb.addActionListener(e -> { if (!building) setMap(col); });
                combos.put(c, cb); mapPanel.add(cb);
            }
            mapPanel.revalidate(); mapPanel.repaint();
            building = false;
        }

        String keyOf(JComboBox<String> cb) { int i = cb.getSelectedIndex(); return i <= 0 ? "" : Json.str(fields.get(i - 1).get("key")); }

        void setMap(int col) {
            String key = keyOf(combos.get(col));
            building = true;
            if (!key.isEmpty()) for (Map.Entry<Integer, JComboBox<String>> e : combos.entrySet()) if (e.getKey() != col && keyOf(e.getValue()).equals(key)) e.getValue().setSelectedIndex(0);
            building = false;
            mapping = new TreeMap<>();
            for (Map.Entry<Integer, JComboBox<String>> e : combos.entrySet()) { String k = keyOf(e.getValue()); if (!k.isEmpty()) mapping.put(e.getKey(), k); }
            remap();
        }

        List<String> missing() {
            List<String> out = new ArrayList<>();
            for (Map<String, Object> f : fields) if (Boolean.TRUE.equals(f.get("required")) && !mapping.containsValue(Json.str(f.get("key")))) out.add(tx(f));
            return out;
        }

        String errText(Mapped m) {
            List<String> out = new ArrayList<>();
            for (String e : m.errors) {
                int i = e.indexOf(':'); String k = i < 0 ? e : e.substring(0, i), why = i < 0 ? "" : e.substring(i + 1);
                String label = k; for (Map<String, Object> f : fields) if (Json.str(f.get("key")).equals(k)) label = tx(f);
                out.add(label + ": " + I(why.isEmpty() ? "e.required" : "e." + why));
            }
            return String.join(" · ", out);
        }

        void remap() {
            if (rows.isEmpty()) return;
            mapped = mapRows(rows, mapping, head.isSelected() ? 1 : 0, Api.I.can("hr.employees.salary"));
            markDuplicates(mapped);
            List<Map<String, Object>> keys = new ArrayList<>();
            for (Map<String, Object> f : fields) if (mapping.containsValue(Json.str(f.get("key")))) keys.add(f);
            List<String> heads = new ArrayList<>(); heads.add("#"); for (Map<String, Object> f : keys) heads.add(tx(f)); heads.add(L("problem"));
            table = new Ui.DataTable(heads.toArray(new String[0]));
            tableScroll.setViewportView(table);
            List<String[]> cells = new ArrayList<>(); List<Object> pay = new ArrayList<>();
            for (int i = 0; i < Math.min(50, mapped.size()); i++) {
                Mapped m = mapped.get(i);
                List<String> r = new ArrayList<>(); r.add(String.valueOf(m.row));
                for (Map<String, Object> f : keys) r.add(Json.str(m.data.get(Json.str(f.get("key")))));
                r.add(errText(m));
                cells.add(r.toArray(new String[0])); pay.add(null);
            }
            table.fill(cells, pay);
            int good = 0; for (Mapped m : mapped) if (m.errors.isEmpty()) good++;
            summary.setText(I("rows", "n", mapped.size()) + "   " + I("valid", "n", good) + (mapped.size() > good ? "   " + I("invalid", "n", mapped.size() - good) : ""));
            List<String> miss = missing();
            msg.setText(!miss.isEmpty() ? L("needmap", String.join(", ", miss)) : (mapped.size() > 50 ? I("more", "n", mapped.size() - 50) : ""));
            runBtn.setText(I("run", "n", good));
            runBtn.setEnabled(good > 0 && miss.isEmpty());
        }

        void run() {
            List<Object> good = new ArrayList<>(); List<Mapped> bad = new ArrayList<>();
            for (Mapped m : mapped) { if (m.errors.isEmpty()) { Map<String, Object> r = new LinkedHashMap<>(); r.put("row", (long) m.row); r.put("data", m.data); good.add(r); } else bad.add(m); }
            if (good.isEmpty()) { msg.setText(L("nothing")); return; }
            runBtn.setEnabled(false); msg.setText("…");
            final boolean updExisting = upd.isSelected(); final int chunk = (int) num(spec().get("chunk"));
            Ui.async(() -> {
                long created = 0, updated = 0, skipped = 0; List<Object> errors = new ArrayList<>();
                for (int i = 0; i < good.size(); i += chunk) {
                    Map<String, Object> body = new LinkedHashMap<>(); body.put("rows", good.subList(i, Math.min(good.size(), i + chunk))); body.put("updateExisting", updExisting);
                    Map<String, Object> r = Json.obj(Api.I.hr("POST", "employees/import", body));
                    created += (long) num(r.get("created")); updated += (long) num(r.get("updated")); skipped += (long) num(r.get("skipped")); errors.addAll(Json.arr(r.get("errors")));
                }
                for (Mapped m : bad) { Map<String, Object> e = new LinkedHashMap<>(); e.put("row", (long) m.row); e.put("empNo", Json.str(m.data.get("empNo"))); e.put("message", errText(m)); errors.add(e); }
                Map<String, Object> res = new LinkedHashMap<>(); res.put("created", created); res.put("updated", updated); res.put("skipped", skipped); res.put("errors", errors);
                return res;
            }, r -> {
                List<Object> errs = Json.arr(r.get("errors"));
                StringBuilder sb = new StringBuilder("<html>" + I("done") + "<br>" + I("created") + ": " + r.get("created") + "   " + I("updated") + ": " + r.get("updated") + "   " + I("skipped") + ": " + r.get("skipped") + "   " + I("failed") + ": " + errs.size());
                for (int i = 0; i < Math.min(20, errs.size()); i++) sb.append("<br>").append(L("row")).append(' ').append(Json.obj(errs.get(i)).get("row")).append(": ").append(Json.str(Json.obj(errs.get(i)).get("message")));
                msg.setText(sb.toString());
                lastResult = r;
                if (onDone != null) onDone.run();
            }, m -> { msg.setText(m); runBtn.setEnabled(true); });
        }
        public Map<String, Object> lastResult;
    }

    // ------------------------------------------------------------ page
    public static final class HrPanel extends JPanel implements Reloadable {
        final List<Object> reports = new ArrayList<>();
        public final JComboBox<String> pick = new JComboBox<>();
        public Ui.DataTable table = new Ui.DataTable();
        final JScrollPane scroll = new JScrollPane(table);
        public final JLabel foot = new JLabel(), msg = new JLabel();
        final JButton bImport, bA, bB, bC, bD; Map<String, Object> lastData = new HashMap<>();
        public String current = "";
        boolean loading;
        Map<String, Object> rep;

        public HrPanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            for (Object r : Json.arr(spec().get("reports"))) if (Api.I.can(VIEW.get(Json.str(Json.obj(r).get("id"))))) { reports.add(r); pick.addItem(tx(r)); }
            add(Ui.label(L("title"), "title"), BorderLayout.NORTH);
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0));
            bar.add(pick); bar.add(Ui.button(L("refresh"), this::reload, null));
            bImport = Ui.button(L("import"), () -> new ImportDialog(SwingUtilities.getWindowAncestor(this), this::reload).setVisible(true), "ghost");
            bA = Ui.button("", () -> act(0), null); bB = Ui.button("", () -> act(1), null); bC = Ui.button("", () -> act(2), null); bD = Ui.button("", () -> act(3), null);
            bar.add(bImport); bar.add(bA); bar.add(bB); bar.add(bC); bar.add(bD);
            JPanel mid = new JPanel(new BorderLayout(0, 6));
            mid.add(bar, BorderLayout.NORTH); mid.add(scroll, BorderLayout.CENTER);
            JPanel bot = new JPanel(new BorderLayout()); bot.add(foot, BorderLayout.NORTH); bot.add(msg, BorderLayout.SOUTH);
            mid.add(bot, BorderLayout.SOUTH);
            add(mid);
            pick.addActionListener(e -> { if (!loading) reload(); });
        }

        @Override public void reload() {
            int i = pick.getSelectedIndex();
            if (i < 0) { msg.setText(L("noperm")); return; }
            rep = Json.obj(reports.get(i));
            final String id = Json.str(rep.get("id"));
            current = id;
            bImport.setVisible(id.equals("employees") && Api.I.can("hr.employees.import"));
            List<Object> acts = Json.arr(rep.get("actions"));
            boolean can = (id.equals("leave") && Api.I.can("hr.leave.approve")) || (id.equals("recruit") && Api.I.can("hr.recruitment.manage"));
            JButton[] bs = {bA, bB, bC, bD};
            for (int k = 0; k < 4; k++) { bs[k].setVisible(can && k < acts.size()); if (k < acts.size()) bs[k].setText(L(Json.str(acts.get(k)))); }
            List<String> heads = new ArrayList<>(); for (Object c : visibleCols(rep)) heads.add(tx(c));
            table = new Ui.DataTable(heads.toArray(new String[0]));
            scroll.setViewportView(table);
            msg.setText("…");
            final Map<String, Object> mine = rep;
            Ui.async(() -> fetch(id), data -> { if (id.equals(current)) show(mine, data); }, m -> msg.setText(m));
        }

        void show(Map<String, Object> r, Map<String, Object> data) {
            lastData = data;
            Built b = build(Json.str(r.get("id")), data, LocalDate.now().toString());
            table.fill(b.rows, b.payloads);
            javax.swing.table.DefaultTableCellRenderer right = new javax.swing.table.DefaultTableCellRenderer();
            right.setHorizontalAlignment(SwingConstants.RIGHT);
            List<Object> cols = visibleCols(r);
            for (int c = 0; c < cols.size(); c++) if (Boolean.TRUE.equals(Json.obj(cols.get(c)).get("num"))) table.getColumnModel().getColumn(c).setCellRenderer(right);
            foot.setText(b.foot);
            msg.setText(b.rows.isEmpty() ? L("empty") : "");
        }

        void act(int which) {
            Object sel = table.selected();
            if (sel == null || rep == null) return;
            Map<String, Object> rec = Json.obj(sel);
            String id = Json.str(rep.get("id")), name = Json.str(Json.arr(rep.get("actions")).get(which));
            String path; Map<String, Object> body = new LinkedHashMap<>();
            if (id.equals("leave")) {
                if (!"Pending".equals(Json.str(rec.get("status")))) return;
                body.put("status", name.equals("approve") ? "Approved" : "Rejected"); body.put("empNo", rec.get("empNo")); body.put("data", rec.get("data"));
                path = "records/leave/" + Json.str(rec.get("id"));
            } else if (name.equals("hire")) {
                if ("Offer".equals(Json.str(rec.get("status")))) hire(rec);
                return;
            } else if (name.equals("reject")) {
                String st = Json.str(rec.get("status"));
                if (st.equals("Hired") || st.equals("Rejected")) return;
                body.put("status", "Rejected"); body.put("data", rec.get("data"));
                path = "records/candidate/" + Json.str(rec.get("id"));
            } else {
                List<Object> stages = Json.arr(spec().get("stages"));
                int cur = stages.indexOf(Json.str(rec.get("status")).isEmpty() ? "Applied" : Json.str(rec.get("status")));
                int to = cur + (name.equals("next") ? 1 : -1);
                if (to < 0 || to >= stages.size()) return;
                body.put("status", stages.get(to)); body.put("data", rec.get("data"));
                path = "records/candidate/" + Json.str(rec.get("id"));
            }
            Ui.async(() -> Api.I.hr("PUT", path, body), r -> reload(), m -> Ui.warn(this, m));
        }

        /** Hire a candidate: creates the employee (prefilled from the candidate and the vacancy) and marks the candidate Hired. */
        public final Map<String, JTextField> hireFields = new LinkedHashMap<>();
        void hire(Map<String, Object> cand) {
            Map<String, Object> d = Json.obj(cand.get("data")), v = new HashMap<>();
            for (Object x : Json.arr(lastData.get("vacancy"))) if (Json.str(Json.obj(x).get("code")).equals(Json.str(d.get("vacancy")))) v = Json.obj(Json.obj(x).get("data"));
            Map<String, String> pre = new HashMap<>();
            pre.put("fullName", Json.str(d.get("name"))); pre.put("email", Json.str(d.get("email"))); pre.put("phone", Json.str(d.get("phone"))); pre.put("position", Json.str(v.get("title"))); pre.put("unit", Json.str(v.get("unit")));
            pre.put("location", Json.str(v.get("location"))); pre.put("grade", Json.str(v.get("grade"))); pre.put("hireDate", LocalDate.now().toString());
            Map<String, String> names = new HashMap<>(); for (Object f : Json.arr(spec().get("fields"))) names.put(Json.str(Json.obj(f).get("key")), tx(f));
            JPanel form = new JPanel(new GridLayout(0, 2, 6, 6)); hireFields.clear();
            for (String k : new String[]{"empNo", "fullName", "email", "phone", "position", "unit", "location", "grade", "hireDate"}) {
                JTextField f = new JTextField(pre.getOrDefault(k, ""), 20); hireFields.put(k, f);
                form.add(new JLabel(names.getOrDefault(k, k) + (k.equals("empNo") || k.equals("fullName") ? " *" : ""))); form.add(f);
            }
            if (JOptionPane.showConfirmDialog(this, form, L("hireTitle"), JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) return;
            submitHire(cand);
        }
        void submitHire(Map<String, Object> cand) {
            Map<String, Object> body = new LinkedHashMap<>();
            for (Map.Entry<String, JTextField> e : hireFields.entrySet()) if (!e.getValue().getText().trim().isEmpty()) body.put(e.getKey(), e.getValue().getText().trim());
            if (Json.str(body.get("empNo")).isEmpty() || Json.str(body.get("fullName")).isEmpty()) { Ui.warn(this, L("empNoReq")); return; }
            body.put("status", "Probation");
            Ui.async(() -> {
                Api.I.hr("POST", "employees", body);
                Map<String, Object> ub = new LinkedHashMap<>(); ub.put("status", "Hired"); ub.put("data", cand.get("data"));
                return Api.I.hr("PUT", "records/candidate/" + Json.str(cand.get("id")), ub);
            }, r -> reload(), m -> Ui.warn(this, m));
        }
    }
}
