package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;

/** Hospital: patients, appointments, visits, lab, pharmacy, wards and billing.
 *  The screens are described by hospital.json (shared by every desktop app); this file is the engine that draws them. */
public final class Hospital {
    private Hospital() { }

    // ------------------------------------------------------------ spec + small helpers
    static List<Object> sections;
    static synchronized List<Object> sections() {
        if (sections == null) {
            try (InputStream in = Hospital.class.getResourceAsStream("/hospital.json")) { sections = Json.arr(Json.obj(Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8))).get("sections")); }
            catch (Exception e) { sections = new ArrayList<>(); }
        }
        return sections;
    }

    static String L(Map<String, Object> o) { String s = Json.str(o.get(I18n.rtl() ? "ar" : "en")); return s.isEmpty() ? Json.str(o.get("en")) : s; }
    static String today() { return LocalDate.now().toString(); }

    static Object getp(Object o, String path) {
        for (String p : path.split("\\.")) { if (o instanceof Map) o = ((Map<?, ?>) o).get(p); else return null; }
        return o;
    }

    @SuppressWarnings("unchecked")
    static void setp(Map<String, Object> o, String path, Object v) {
        String[] parts = path.split("\\.");
        for (int i = 0; i < parts.length - 1; i++) {
            Object c = o.get(parts[i]);
            if (!(c instanceof Map)) { c = new LinkedHashMap<String, Object>(); o.put(parts[i], c); }
            o = (Map<String, Object>) c;
        }
        o.put(parts[parts.length - 1], v);
    }

    static Object templ(Object v, Map<String, Object> row) {
        if (!(v instanceof String)) return v;
        String s = (String) v;
        if (s.equals("$today")) return today();
        if (s.startsWith("@")) return s.substring(1).equals(Json.str(row.get("status")));
        if (s.startsWith("{") && s.endsWith("}") && s.indexOf('{', 1) < 0) return getp(row, s.substring(1, s.length() - 1));
        for (String k : new String[]{"id", "code", "parent", "ref"}) s = s.replace("{" + k + "}", Json.str(row.get(k)));
        return s;
    }

    static String val(Object v) {
        if (v == null) return "";
        if (v instanceof Double) { double d = (Double) v; return d == Math.floor(d) && !Double.isInfinite(d) ? String.valueOf((long) d) : String.valueOf(d); }
        if (v instanceof Number || v instanceof Boolean || v instanceof String) return String.valueOf(v);
        return "";
    }

    static String cell(Map<String, Object> rec, Map<String, Object> col) {
        String p = Json.str(col.get("p")), ty = Json.str(col.get("t"));
        Object v = getp(rec, p);
        if (v == null) return "";
        if (ty.equals("items")) {
            List<String> out = new ArrayList<>();
            for (Object x : Json.arr(v)) {
                Map<String, Object> i = Json.obj(x);
                String disp = val(i.get("dispensed")); if (disp.isEmpty()) disp = "0";
                out.add((val(i.get("name")) + " " + val(i.get("strength")) + " " + val(i.get("dose")) + " " + val(i.get("frequency")) + " " + disp + "/" + val(i.get("qty"))).trim().replaceAll("\\s+", " "));
            }
            return String.join("; ", out);
        }
        if (ty.equals("money")) return String.format(java.util.Locale.ENGLISH, "%,.2f", v instanceof Number ? ((Number) v).doubleValue() : 0.0);
        if (v instanceof List) { List<String> o = new ArrayList<>(); for (Object x : (List<?>) v) o.add(val(x)); return String.join(", ", o); }
        String s = val(v);
        return p.equals("createdAt") || p.equals("data.start") ? s.replace('T', ' ').substring(0, Math.min(16, s.length())) : s;
    }

    /** A printable page for one hospital invoice (items, tax, insurance, payments, balance); opened in the browser. */
    static String invoiceHtml(Map<String, Object> r) {
        Map<String, Object> d = Json.obj(r.get("data"));
        java.util.function.Function<Object, String> e = v -> SiteRender.esc(v == null ? "" : v);
        java.util.function.Function<Object, String> m = v -> String.format(java.util.Locale.ENGLISH, "%,.2f", SiteRender.num(v, 0));
        java.util.function.Function<Object, String> str = v -> v == null ? "" : v instanceof Double && (Double) v == Math.rint((Double) v) ? String.valueOf((long) (double) (Double) v) : String.valueOf(v);
        StringBuilder rows = new StringBuilder();
        for (Object lo : Json.arr(d.get("lines"))) { Map<String, Object> l = Json.obj(lo); rows.append("<tr><td>").append(e.apply(l.get("desc"))).append("</td><td class=\"n\">").append(e.apply(str.apply(l.get("qty")))).append("</td><td class=\"n\">").append(m.apply(l.get("price"))).append("</td><td class=\"n\">").append(m.apply(l.get("amount"))).append("</td></tr>"); }
        StringBuilder out = new StringBuilder();
        java.util.function.BiConsumer<String[], Boolean> tot = (kv, b) -> out.append("<tr><td colspan=\"3\" class=\"n\">").append(b ? "<b>" + kv[0] + "</b>" : kv[0]).append("</td><td class=\"n\">").append(b ? "<b>" + kv[1] + "</b>" : kv[1]).append("</td></tr>");
        if (SiteRender.num(d.get("tax"), 0) != 0) { tot.accept(new String[]{t("hos.pr.subtotal"), m.apply(d.get("gross"))}, false); tot.accept(new String[]{e.apply(d.get("taxName") == null || d.get("taxName").toString().isEmpty() ? "VAT" : d.get("taxName")) + " (" + e.apply(str.apply(d.get("taxPct"))) + "%)", m.apply(d.get("tax"))}, false); }
        tot.accept(new String[]{t("hos.pr.total"), m.apply(d.get("total") != null ? d.get("total") : d.get("gross"))}, true);
        if (SiteRender.num(d.get("insurance"), 0) != 0) tot.accept(new String[]{e.apply(d.get("insuranceName")) + " (" + e.apply(str.apply(d.get("insurancePct"))) + "%)", "- " + m.apply(d.get("insurance"))}, false);
        tot.accept(new String[]{t("hos.pr.due"), m.apply(d.get("due"))}, true);
        for (Object po : Json.arr(d.get("payments"))) { Map<String, Object> p = Json.obj(po); String at = str.apply(p.get("at")); tot.accept(new String[]{e.apply(at.length() > 10 ? at.substring(0, 10) : at) + " - " + e.apply(p.get("method")) + " - " + e.apply(p.get("by")), "- " + m.apply(p.get("amount"))}, false); }
        tot.accept(new String[]{t("hos.pr.balance"), m.apply(d.get("balance"))}, true);
        return "<!doctype html><meta charset=\"utf-8\"><title>" + e.apply(r.get("code")) + "</title><style>body{font:14px system-ui;margin:40px;color:#111}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}.n{text-align:end}</style><h1>" + e.apply(r.get("code")) + "</h1><p>" + e.apply(d.get("patientName"))
            + "</p><table><tr><th>" + t("hos.pr.item") + "</th><th class=\"n\">" + t("hos.pr.qty") + "</th><th class=\"n\">" + t("hos.pr.price") + "</th><th class=\"n\">" + t("hos.pr.amount") + "</th></tr>" + rows + out + "</table><script>window.onload=function(){window.print()}</script>";
    }
    static void openInvoice(Map<String, Object> r) {
        try { java.nio.file.Path p = java.nio.file.Paths.get(System.getProperty("java.io.tmpdir"), "invoice-" + r.get("code") + ".html"); java.nio.file.Files.writeString(p, invoiceHtml(r)); Admin.openFile(p); } catch (Exception ex) { /* no browser */ }
    }

    static List<String> flatten(Object o, int ind) {
        String pad = "  ".repeat(ind);
        List<String> out = new ArrayList<>();
        if (o instanceof Map) {
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                Object v = e.getValue();
                boolean nested = (v instanceof Map && !((Map<?, ?>) v).isEmpty()) || (v instanceof List && !((List<?>) v).isEmpty());
                if (nested) { out.add(pad + e.getKey() + ":"); out.addAll(flatten(v, ind + 1)); }
                else if (v != null && !"".equals(v) && !(v instanceof Map) && !(v instanceof List)) out.add(pad + e.getKey() + ": " + val(v));
            }
        } else if (o instanceof List) {
            for (Object i : (List<?>) o) {
                if (i instanceof Map || i instanceof List) { out.add(pad + "-"); out.addAll(flatten(i, ind + 1)); } else out.add(pad + "- " + val(i));
            }
        } else out.add(pad + val(o));
        return out;
    }

    static String dxText(Object a) {
        List<String> l = new ArrayList<>();
        for (Object x : Json.arr(a)) { Map<String, Object> d = Json.obj(x); l.add(Json.str(d.get("code")).isEmpty() ? Json.str(d.get("name")) : Json.str(d.get("code")) + " | " + Json.str(d.get("name"))); }
        return String.join("\n", l);
    }

    static List<Object> dxList(String txt) {
        List<Object> out = new ArrayList<>();
        for (String ln : (txt == null ? "" : txt).split("\n")) {
            ln = ln.trim();
            if (ln.isEmpty()) continue;
            int i = ln.indexOf('|');
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("code", i >= 0 ? ln.substring(0, i).trim() : ""); d.put("name", i >= 0 ? ln.substring(i + 1).trim() : ln);
            out.add(d);
        }
        return out;
    }

    static Object num(Object v) {
        try { double d = Double.parseDouble(String.valueOf(v).trim()); return d == Math.floor(d) ? (Object) (long) d : (Object) d; } catch (Exception e) { return null; }
    }

    /** the request body one action describes; vals: field key -> String / Boolean / selected value */
    @SuppressWarnings("unchecked")
    static Map<String, Object> buildBody(Map<String, Object> act, Map<String, Object> vals, Map<String, Object> row, boolean keepEmpty) {
        Map<String, Object> body = new LinkedHashMap<>();
        Map<String, List<String>> joins = new LinkedHashMap<>();
        for (Object fo : Json.arr(act.get("fields"))) {
            Map<String, Object> f = Json.obj(fo);
            String k = Json.str(f.get("k")), ty = f.get("t") == null ? "text" : Json.str(f.get("t"));
            Object raw = vals.get(k), v = null;
            if (ty.equals("num")) v = raw == null || String.valueOf(raw).isBlank() ? null : num(raw);
            else if (ty.equals("check")) v = Boolean.TRUE.equals(raw);
            else if (ty.equals("dx")) { List<Object> a = dxList(raw == null ? "" : String.valueOf(raw)); if (!a.isEmpty() || keepEmpty) v = a; }
            else { String s = raw == null ? "" : String.valueOf(raw).trim(); if (!s.isEmpty() || keepEmpty) v = s; }
            if (f.get("join") != null) joins.computeIfAbsent(Json.str(f.get("join")), x -> new ArrayList<>()).add(raw == null ? "" : String.valueOf(raw).trim());
            else if (v == null) continue;
            else if (k.endsWith("[]")) ((List<Object>) body.computeIfAbsent(k.substring(0, k.length() - 2), x -> new ArrayList<>())).add(v);
            else if (k.contains("[].")) {
                String base = k.substring(0, k.indexOf("[].")), sub = k.substring(k.indexOf("[].") + 3);
                List<Object> a = (List<Object>) body.computeIfAbsent(base, x -> { List<Object> l = new ArrayList<>(); l.add(new LinkedHashMap<String, Object>()); return l; });
                ((Map<String, Object>) a.get(0)).put(sub, v);
            } else setp(body, k, v);
        }
        for (Map.Entry<String, List<String>> j : joins.entrySet()) { List<String> parts = new ArrayList<>(); for (String p : j.getValue()) if (!p.isEmpty()) parts.add(p); body.put(j.getKey(), String.join("T", parts)); }
        for (Map.Entry<String, Object> e : Json.obj(act.get("body")).entrySet()) body.put(e.getKey(), templ(e.getValue(), row));
        return body;
    }

    /** result of one action: the server's answer, or the safety warnings of a 409 */
    public static final class Outcome { public Object result; public List<String> warnings = new ArrayList<>(); public String message = ""; public boolean ok() { return message.isEmpty(); } }

    /** runs one action (blocking; call it off the UI thread) */
    @SuppressWarnings("unchecked")
    public static Outcome run(Map<String, Object> sec, Map<String, Object> act, Map<String, Object> row, Map<String, Object> vals, Map<String, Object> extra) {
        Outcome o = new Outcome();
        try {
            String kind = Json.str(sec.get("kind"));
            if (act.containsKey("get")) o.result = Api.I.hos("GET", Json.str(templ(act.get("get"), row)), null);
            else if (act.containsKey("toggle")) {
                String st = Json.str(row.get("status")).equals(Json.str(act.get("toggle"))) ? Json.str(act.get("back")) : Json.str(act.get("toggle"));
                Map<String, Object> b = new LinkedHashMap<>(); b.put("data", row.get("data")); b.put("branch", row.get("branch")); b.put("status", st);
                o.result = Api.I.hos("PUT", "records/" + kind + "/" + Json.str(row.get("id")), b);
            } else if ("update".equals(act.get("record"))) {
                Map<String, Object> data = new LinkedHashMap<>(Json.obj(row.get("data")));
                data.putAll(Json.obj(buildBody(act, vals, row, true).get("data")));
                Map<String, Object> b = new LinkedHashMap<>(); b.put("data", data); b.put("status", row.get("status")); b.put("branch", row.get("branch"));
                o.result = Api.I.hos("PUT", "records/" + kind + "/" + Json.str(row.get("id")), b);
            } else if ("create".equals(act.get("record"))) {
                Map<String, Object> b = new LinkedHashMap<>(); b.put("data", Json.obj(buildBody(act, vals, new LinkedHashMap<>(), true).get("data")));
                o.result = Api.I.hos("POST", "records/" + kind, b);
            } else {
                Map<String, Object> body = buildBody(act, vals, row, false);
                if (extra != null) body.putAll(extra);
                o.result = act.containsKey("put") ? Api.I.hos("PUT", Json.str(templ(act.get("put"), row)), body) : Api.I.hos("POST", Json.str(templ(act.get("post"), row)), body);
            }
        } catch (Api.ApiException e) {
            o.message = e.getMessage() == null || e.getMessage().isEmpty() ? "error" : e.getMessage();
            if (e.status == 409) for (Object w : Json.arr(e.body.get("warnings"))) o.warnings.add(String.valueOf(w));
        }
        return o;
    }

    static List<Map<String, Object>> fetch(String kind, int take, Map<String, String> q) {
        StringBuilder b = new StringBuilder("records/" + kind + "?take=" + take);
        for (Map.Entry<String, String> e : q.entrySet()) if (e.getValue() != null && !e.getValue().isEmpty()) b.append('&').append(e.getKey()).append('=').append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : Json.arr(Api.I.hos("GET", b.toString(), null))) out.add(Json.obj(o));
        return out;
    }

    // ------------------------------------------------------------ form dialog
    static final class Opt {
        final String v, l;
        Opt(String v, String l) { this.v = v; this.l = l; }
        @Override public String toString() { return l; }
    }

    static List<Opt> optionsOf(Map<String, Object> f, List<Map<String, Object>> recs) {
        List<Opt> out = new ArrayList<>();
        if (f.get("opts") != null) { for (Object o : Json.arr(f.get("opts"))) out.add(new Opt(String.valueOf(o), String.valueOf(o))); return out; }
        Map<String, Object> s = Json.obj(f.get("src"));
        out.add(new Opt("", ""));
        for (Map<String, Object> r : recs) {
            if ("Inactive".equals(r.get("status"))) continue;
            out.add(new Opt(Json.str(getp(r, s.get("v") == null ? "code" : Json.str(s.get("v")))), Json.str(getp(r, s.get("l") == null ? "data.name" : Json.str(s.get("l")))) + " · " + Json.str(r.get("code"))));
        }
        return out;
    }

    static final class FormDlg extends JDialog {
        final Map<String, JComponent> w = new LinkedHashMap<>();
        final List<Object> fields;
        boolean accepted;
        final JLabel err = Ui.label(" ", "error");

        FormDlg(Component parent, String title, List<Object> fields, Map<String, Object> row, Map<String, List<Map<String, Object>>> recs) {
            super(javax.swing.SwingUtilities.getWindowAncestor(parent), title, ModalityType.APPLICATION_MODAL);
            this.fields = fields;
            JPanel form = new JPanel(new GridBagLayout());
            form.setBorder(BorderFactory.createEmptyBorder(14, 14, 6, 14));
            int y = 0;
            for (Object fo : fields) {
                Map<String, Object> f = Json.obj(fo);
                String ty = f.get("t") == null ? "text" : Json.str(f.get("t")), k = Json.str(f.get("k"));
                Object d = f.get("from") != null ? getp(row, Json.str(f.get("from"))) : null;
                if (d == null && f.get("def") != null) d = templ(f.get("def"), row);
                JComponent c;
                if (ty.equals("select")) {
                    JComboBox<Opt> cb = new JComboBox<>();
                    Opt sel = null;
                    for (Opt o : optionsOf(f, recs.getOrDefault(k, new ArrayList<>()))) { cb.addItem(o); if (d != null && o.v.equals(val(d))) sel = o; }
                    if (sel != null) cb.setSelectedItem(sel); else if (cb.getItemCount() > 0) cb.setSelectedIndex(0);
                    c = cb;
                } else if (ty.equals("check")) { JCheckBox cb = new JCheckBox(); cb.setSelected(Boolean.TRUE.equals(d)); c = cb; }
                else if (ty.equals("area") || ty.equals("dx")) { JTextArea ta = new JTextArea(ty.equals("dx") ? dxText(d) : val(d), 3, 28); c = new JScrollPane(ta); w.put(k + "#ta", ta); }
                else { JTextField tf = new JTextField(val(d), 28); c = tf; }
                w.put(k, c);
                GridBagConstraints g = new GridBagConstraints(); g.gridx = 0; g.gridy = y; g.anchor = GridBagConstraints.NORTHWEST; g.insets = new java.awt.Insets(4, 0, 4, 10);
                form.add(new JLabel(L(f) + (Boolean.TRUE.equals(f.get("req")) ? " *" : "")), g);
                g = new GridBagConstraints(); g.gridx = 1; g.gridy = y++; g.fill = GridBagConstraints.HORIZONTAL; g.weightx = 1; g.insets = new java.awt.Insets(4, 0, 4, 0);
                form.add(c, g);
            }
            JButton ok = Ui.button(t("hos.ui.run"), this::submit, "primary"), cancel = Ui.button(t("common.cancel"), this::dispose, null);
            JPanel foot = new JPanel(new FlowLayout(FlowLayout.RIGHT)); foot.add(err); foot.add(cancel); foot.add(ok);
            setLayout(new BorderLayout()); add(form); add(foot, BorderLayout.SOUTH);
            pack(); setLocationRelativeTo(parent);
        }

        Map<String, Object> values() {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Object fo : fields) {
                String k = Json.str(Json.obj(fo).get("k"));
                JComponent c = w.get(k);
                if (c instanceof JComboBox) { Object s = ((JComboBox<?>) c).getSelectedItem(); out.put(k, s == null ? "" : ((Opt) s).v); }
                else if (c instanceof JCheckBox) out.put(k, ((JCheckBox) c).isSelected());
                else if (c instanceof JScrollPane) out.put(k, ((JTextArea) w.get(k + "#ta")).getText());
                else out.put(k, ((JTextField) c).getText());
            }
            return out;
        }

        void submit() {
            Map<String, Object> v = values();
            for (Object fo : fields) {
                Map<String, Object> f = Json.obj(fo);
                Object x = v.get(Json.str(f.get("k")));
                if (Boolean.TRUE.equals(f.get("req")) && (x == null || String.valueOf(x).isEmpty() || Boolean.FALSE.equals(x))) { err.setText(L(f) + " *"); return; }
            }
            accepted = true; dispose();
        }
    }

    // ------------------------------------------------------------ one section (a table with actions)
    public static final class SectionPanel extends JPanel implements Reloadable {
        public final Map<String, Object> sec;
        public List<Map<String, Object>> rows = new ArrayList<>();
        public final JTextField q = new JTextField(14), day = new JTextField(today(), 9);
        public final JComboBox<Opt> status = new JComboBox<>();
        public final Ui.DataTable table;
        public final Map<String, JButton> btns = new LinkedHashMap<>();
        final JTextArea detail = new JTextArea(7, 40);
        final JScrollPane detailScroll = new JScrollPane(detail);
        final JLabel err = Ui.label(" ", "error");

        public SectionPanel(Map<String, Object> sec) {
            super(new BorderLayout(0, 6));
            this.sec = sec;
            setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            q.setVisible(Boolean.TRUE.equals(sec.get("search"))); q.addActionListener(e -> reload());
            day.setVisible(Boolean.TRUE.equals(sec.get("day"))); day.addActionListener(e -> reload());
            for (Object s : Json.arr(sec.get("status"))) status.addItem(new Opt(String.valueOf(s), String.valueOf(s).isEmpty() ? t("hos.ui.all") : String.valueOf(s)));
            status.setVisible(sec.get("status") != null); status.addActionListener(e -> reload());
            bar.add(q); bar.add(day); bar.add(status); bar.add(Ui.button(t("common.refresh"), this::reload, null));
            if (sec.get("create") != null) { Map<String, Object> c = Json.obj(sec.get("create")); bar.add(Ui.button(L(c), () -> act(c, true), "primary")); }
            JPanel top = new JPanel(new BorderLayout()); top.add(bar); top.add(err, BorderLayout.SOUTH);
            List<String> heads = new ArrayList<>();
            for (Object c : Json.arr(sec.get("columns"))) heads.add(L(Json.obj(c)));
            table = new Ui.DataTable(heads.toArray(new String[0]));
            table.getSelectionModel().addListSelectionListener(e -> selChanged());
            JPanel actions = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 4));
            for (Object ao : Json.arr(sec.get("actions"))) {
                Map<String, Object> a = Json.obj(ao);
                JButton b = Ui.button(L(a), () -> act(a, false), null);
                btns.put(Json.str(a.get("id")), b); actions.add(b);
            }
            detail.setEditable(false); detail.setLineWrap(true); detailScroll.setVisible(false);
            JPanel south = new JPanel(new BorderLayout()); south.add(actions); south.add(detailScroll, BorderLayout.SOUTH);
            add(top, BorderLayout.NORTH); add(new JScrollPane(table)); add(south, BorderLayout.SOUTH);
            selChanged();
        }

        Map<String, String> query() {
            Map<String, String> m = new LinkedHashMap<>();
            if (q.isVisible()) m.put("q", q.getText().trim());
            if (day.isVisible()) m.put("ref", day.getText().trim());
            if (status.isVisible() && status.getSelectedItem() != null) m.put("status", ((Opt) status.getSelectedItem()).v);
            return m;
        }

        @Override public void reload() {
            err.setText(" ");
            int take = sec.get("take") == null ? 200 : ((Number) sec.get("take")).intValue();
            Ui.async(() -> fetch(Json.str(sec.get("kind")), take, query()), this::paint, err::setText);
        }

        public void paint(List<Map<String, Object>> r) {
            rows = r;
            List<String[]> cells = new ArrayList<>();
            for (Map<String, Object> rec : r) {
                List<String> c = new ArrayList<>();
                for (Object col : Json.arr(sec.get("columns"))) c.add(cell(rec, Json.obj(col)));
                cells.add(c.toArray(new String[0]));
            }
            table.fill(cells, r);
            selChanged();
        }

        @SuppressWarnings("unchecked") Map<String, Object> cur() { Object o = table.selected(); return o == null ? null : (Map<String, Object>) o; }

        void selChanged() {
            Map<String, Object> r = cur();
            for (Object ao : Json.arr(sec.get("actions"))) {
                Map<String, Object> a = Json.obj(ao);
                boolean ok = r != null;
                if (ok && a.get("when") != null) { ok = false; for (Object w : Json.arr(a.get("when"))) if (String.valueOf(w).equals(Json.str(r.get("status")))) ok = true; }
                btns.get(Json.str(a.get("id"))).setEnabled(ok);
            }
        }

        public boolean enabledFor(String id) { return btns.get(id).isEnabled(); }

        void act(Map<String, Object> a, boolean creating) {
            Map<String, Object> row = creating ? new LinkedHashMap<>() : cur();
            if (row == null) return;
            if (Boolean.TRUE.equals(a.get("confirm")) && !Ui.ask(this, t("hos.ui.confirm"), t("common.yes"), t("common.no"))) return;
            List<Object> fields = Json.arr(a.get("fields"));
            if (fields.isEmpty()) { perform(a, row, new LinkedHashMap<>(), null); return; }
            Ui.async(() -> {
                Map<String, List<Map<String, Object>>> recs = new LinkedHashMap<>();
                for (Object fo : fields) {
                    Map<String, Object> f = Json.obj(fo);
                    if ("select".equals(f.get("t")) && f.get("src") != null) {
                        Map<String, Object> s = Json.obj(f.get("src"));
                        Map<String, String> pq = new LinkedHashMap<>();
                        for (Map.Entry<String, Object> e : Json.obj(s.get("params")).entrySet()) pq.put(e.getKey(), String.valueOf(e.getValue()));
                        recs.put(Json.str(f.get("k")), fetch(Json.str(s.get("kind")), s.get("take") == null ? 200 : ((Number) s.get("take")).intValue(), pq));
                    }
                }
                return recs;
            }, recs -> {
                FormDlg d = new FormDlg(this, L(a), fields, row, recs);
                d.setVisible(true);
                if (d.accepted) perform(a, row, d.values(), null);
            }, err::setText);
        }

        void perform(Map<String, Object> a, Map<String, Object> row, Map<String, Object> vals, Map<String, Object> extra) {
            err.setText(" ");
            Ui.async(() -> run(sec, a, row, vals, extra), o -> {
                if (!o.ok()) {
                    if (a.get("warn") != null && !o.warnings.isEmpty()) {
                        String reason = JOptionPane.showInputDialog(this, o.message + "\n\n• " + String.join("\n• ", o.warnings) + "\n\n" + t("hos.ui.override"), t("hos.ui.warnings"), JOptionPane.WARNING_MESSAGE);
                        if (reason != null && !reason.trim().isEmpty()) { Map<String, Object> ex = new LinkedHashMap<>(); ex.put("overrideReason", reason.trim()); perform(a, row, vals, ex); }
                        return;
                    }
                    err.setText(o.message); return;
                }
                if (a.get("print") != null) { openInvoice(Json.obj(o.result)); err.setText(t("hos.pr.saved")); }
                else if (a.get("show") != null) { detail.setText(String.join("\n", flatten(o.result, 0))); detail.setCaretPosition(0); detailScroll.setVisible(true); revalidate(); }
                else { detailScroll.setVisible(false); reload(); }
            }, err::setText);
        }
    }

    // ------------------------------------------------------------ overview
    public static final class DashPanel extends JPanel implements Reloadable {
        public final JTextArea body = new JTextArea();
        final JLabel err = Ui.label(" ", "error");

        DashPanel() {
            super(new BorderLayout(0, 6));
            setBorder(BorderFactory.createEmptyBorder(10, 10, 10, 10));
            body.setEditable(false); body.setFont(body.getFont().deriveFont(15f));
            add(err, BorderLayout.NORTH); add(new JScrollPane(body)); add(Ui.button(t("common.refresh"), this::reload, null), BorderLayout.SOUTH);
        }

        static String n(Object v) { return val(v); }

        @Override public void reload() {
            Ui.async(() -> Json.obj(Api.I.hos("GET", "dashboard?today=" + today() + "&tz=0", null)), d -> {
                Map<String, Object> ap = Json.obj(d.get("appointmentsToday")), bd = Json.obj(d.get("beds"));
                StringBuilder b = new StringBuilder();
                b.append(t("hos.ui.patients")).append(": ").append(n(d.get("patients"))).append('\n');
                b.append(t("hos.ui.openVisits")).append(": ").append(n(d.get("openVisits"))).append('\n');
                b.append(t("hos.ui.admitted")).append(": ").append(n(d.get("admitted"))).append('\n');
                b.append(t("hos.ui.labs")).append(": ").append(n(d.get("pendingLabs"))).append('\n');
                b.append(t("hos.ui.rx")).append(": ").append(n(d.get("pendingRx"))).append('\n');
                b.append(t("hos.ui.appts")).append(": ").append(n(ap.get("total"))).append(" (").append(n(ap.get("booked"))).append('/').append(n(ap.get("checkedIn"))).append('/').append(n(ap.get("completed"))).append('/').append(n(ap.get("cancelled"))).append(")\n");
                b.append(t("hos.ui.beds")).append(": ").append(n(bd.get("occupied"))).append('/').append(n(bd.get("total"))).append(" · ").append(n(bd.get("occupancyPct"))).append("%\n");
                b.append(t("hos.ui.revenue")).append(": ").append(String.format(java.util.Locale.ENGLISH, "%,.2f", ((Number) d.getOrDefault("revenueToday", 0)).doubleValue())).append('\n');
                b.append(t("hos.ui.outstanding")).append(": ").append(String.format(java.util.Locale.ENGLISH, "%,.2f", ((Number) d.getOrDefault("outstanding", 0)).doubleValue())).append('\n');
                List<Object> low = Json.arr(d.get("lowStock"));
                if (!low.isEmpty()) { b.append('\n').append(t("hos.ui.lowstock")).append('\n'); for (Object x : low) { Map<String, Object> m = Json.obj(x); b.append("  ").append(n(m.get("name"))).append(" — ").append(n(m.get("stock"))).append(" / ").append(n(m.get("reorder"))).append('\n'); } }
                body.setText(b.toString());
            }, err::setText);
        }
    }

    // ------------------------------------------------------------ the page
    public static final class HospitalPanel extends JPanel implements Reloadable {
        public final JTabbedPane tabs = new JTabbedPane();
        public final List<Map<String, Object>> secs = new ArrayList<>();
        public final List<Component> views = new ArrayList<>();

        public HospitalPanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            add(Ui.label(t("tab.hos"), "title"), BorderLayout.NORTH);
            for (Object so : sections()) {
                Map<String, Object> s = Json.obj(so);
                boolean allowed = false;
                for (Object p : Json.arr(s.get("perm"))) if (Api.I.can(String.valueOf(p))) allowed = true;
                if (!allowed) continue;
                Component c = "dashboard".equals(s.get("type")) ? new DashPanel() : new SectionPanel(s);
                secs.add(s); views.add(c); tabs.addTab(L(s), c);
            }
            tabs.addChangeListener(e -> reload());
            add(tabs);
        }

        @Override public void reload() {
            int i = tabs.getSelectedIndex();
            if (i >= 0 && views.get(i) instanceof Reloadable) ((Reloadable) views.get(i)).reload();
        }
    }
}
