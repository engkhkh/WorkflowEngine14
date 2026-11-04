package erp;

import java.awt.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.List;
import javax.swing.*;

import static erp.I18n.t;

/** Custom modules: design a module (name, icon, fields) and keep its records. Everything is generated from the module definition. */
public final class Custom {
    private Custom() { }

    static Map<String, Object> SPEC;
    static synchronized Map<String, Object> spec() {
        if (SPEC == null) {
            try (java.io.InputStream in = Custom.class.getResourceAsStream("/custom.json")) { SPEC = Json.obj(Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8))); } catch (Exception e) { throw new RuntimeException(e); }
        }
        return SPEC;
    }
    static String title(Map<String, Object> m) { Map<String, Object> d = Json.obj(m.get("def")); return I18n.rtl() && !Json.str(d.get("titleAr")).isEmpty() ? Json.str(d.get("titleAr")) : Json.str(d.get("title")); }
    static String flabel(Map<String, Object> f) { return I18n.rtl() && !Json.str(f.get("labelAr")).isEmpty() ? Json.str(f.get("labelAr")) : Json.str(f.get("label")); }
    static String cell(Map<String, Object> f, Map<String, Object> r) {
        Object v = Json.obj(r.get("data")).get(Json.str(f.get("key")));
        if ("checkbox".equals(Json.str(f.get("type")))) return Boolean.TRUE.equals(v) ? "✓" : "";
        return v == null ? "" : SiteRender.js(v);
    }
    static Window win(Component c) { return SwingUtilities.getWindowAncestor(c); }

    public static final class FieldDialog extends JDialog {
        public Map<String, Object> f; public boolean accepted;
        public final JTextField name, ar, opt; public final JComboBox<String> type = new JComboBox<>(); public final JCheckBox req = new JCheckBox(t("cus.required"));
        final List<String> types = new ArrayList<>();
        public FieldDialog(Window parent, Map<String, Object> fo) {
            super(parent, t("cus.fields"), ModalityType.APPLICATION_MODAL);
            f = Site.copy(fo);
            name = new JTextField(Json.str(f.get("label")), 24); ar = new JTextField(Json.str(f.get("labelAr")), 24);
            List<String> o = new ArrayList<>(); for (Object x : Json.arr(f.get("options"))) o.add(Json.str(x));
            opt = new JTextField(String.join(", ", o), 24);
            for (Object k : Json.arr(spec().get("types"))) { type.addItem(t("cus.t." + k)); types.add(Json.str(k)); }
            type.setSelectedIndex(Math.max(0, types.indexOf(f.get("type") == null ? "text" : Json.str(f.get("type"))))); req.setSelected(Boolean.TRUE.equals(f.get("required")));
            JPanel p = new JPanel(new GridLayout(0, 2, 6, 6));
            p.add(new JLabel(t("cus.fieldName"))); p.add(name); p.add(new JLabel(t("cus.fieldNameAr"))); p.add(ar); p.add(new JLabel("")); p.add(type); p.add(new JLabel("")); p.add(req); p.add(new JLabel(t("cus.options"))); p.add(opt);
            setLayout(new BorderLayout()); add(p); add(Ui.row(Ui.button(t("cal.save"), this::ok, null)), BorderLayout.SOUTH);
            pack(); setLocationRelativeTo(parent);
        }
        void ok() {
            f.put("label", name.getText().trim()); f.put("labelAr", ar.getText().trim().isEmpty() ? null : ar.getText().trim());
            String ty = types.get(Math.max(0, type.getSelectedIndex())); f.put("type", ty); f.put("required", req.isSelected());
            List<Object> o = new ArrayList<>();
            if (ty.equals("select")) for (String s : opt.getText().split("[,،;]")) if (!s.trim().isEmpty()) o.add(s.trim());
            f.put("options", o); accepted = true; dispose();
        }
    }

    public static final class Designer extends JDialog {
        final Map<String, Object> mod; public final Map<String, Object> d; final java.util.function.Consumer<Map<String, Object>> onSaved;
        public final JTextField name, ar, color; public final JComboBox<String> icon = new JComboBox<>(); final List<String> icons = new ArrayList<>();
        public final Ui.DataTable table = new Ui.DataTable(t("cus.fieldName"), t("cus.fieldNameAr"), "Type", t("cus.required"), t("cus.options"));
        public final JLabel err = Ui.label("", "error");
        public Designer(Window parent, Map<String, Object> mod, java.util.function.Consumer<Map<String, Object>> onSaved) {
            super(parent, mod == null ? t("cus.newModule") : t("cus.design"), ModalityType.APPLICATION_MODAL);
            this.mod = mod; this.onSaved = onSaved;
            d = mod != null ? Site.copy(Json.obj(mod.get("def"))) : Json.obj(Json.parse("{\"title\":\"\",\"titleAr\":\"\",\"icon\":\"grid\",\"color\":\"#6366f1\",\"fields\":[{\"key\":\"\",\"label\":\"\",\"type\":\"text\",\"required\":true}]}"));
            name = new JTextField(Json.str(d.get("title")), 24); ar = new JTextField(Json.str(d.get("titleAr")), 24); color = new JTextField(d.get("color") == null ? "#6366f1" : Json.str(d.get("color")), 10);
            for (Object i : Json.arr(spec().get("icons"))) { icon.addItem(Json.str(i)); icons.add(Json.str(i)); }
            icon.setSelectedIndex(Math.max(0, icons.indexOf(d.get("icon") == null ? "grid" : Json.str(d.get("icon")))));
            JPanel form = new JPanel(new GridLayout(0, 2, 6, 6));
            form.add(new JLabel(t("cus.name") + " *")); form.add(name); form.add(new JLabel(t("cus.nameAr"))); form.add(ar); form.add(new JLabel(t("cus.icon"))); form.add(icon); form.add(new JLabel(t("cus.color"))); form.add(color);
            JPanel mid = new JPanel(new BorderLayout()); mid.add(Ui.label(t("cus.fields"), null), BorderLayout.NORTH); mid.add(new JScrollPane(table));
            mid.add(Ui.row(Ui.button("+ " + t("cus.addField"), this::add, "plain"), Ui.button(t("web.edit"), this::edit, "plain"), Ui.button("↑", () -> move(-1), "plain"), Ui.button("↓", () -> move(1), "plain"), Ui.button("✕", this::remove, "plain")), BorderLayout.SOUTH);
            table.onOpen(this::edit);
            JPanel bot = new JPanel(new BorderLayout()); bot.add(err); bot.add(Ui.row(Ui.button(t("cal.close"), this::dispose, "plain"), Ui.button(t("cal.save"), this::save, null)), BorderLayout.EAST);
            setLayout(new BorderLayout(0, 8)); add(form, BorderLayout.NORTH); add(mid); add(bot, BorderLayout.SOUTH);
            setSize(660, 540); setLocationRelativeTo(parent); refresh(0);
        }
        List<Object> fields() { return Json.arr(d.get("fields")); }
        void refresh(int sel) {
            List<String[]> rows = new ArrayList<>(); List<Object> pay = new ArrayList<>(); int n = 0;
            for (Object fv : fields()) {
                Map<String, Object> f = Json.obj(fv); List<String> o = new ArrayList<>(); for (Object x : Json.arr(f.get("options"))) o.add(Json.str(x));
                rows.add(new String[]{Json.str(f.get("label")), Json.str(f.get("labelAr")), t("cus.t." + (f.get("type") == null ? "text" : Json.str(f.get("type")))), Boolean.TRUE.equals(f.get("required")) ? "✓" : "", String.join(", ", o)}); pay.add(n++);
            }
            table.fill(rows, pay); if (!rows.isEmpty()) table.setRowSelectionInterval(Math.min(sel, rows.size() - 1), Math.min(sel, rows.size() - 1));
        }
        public void add() {
            FieldDialog dl = new FieldDialog(this, Json.obj(Json.parse("{\"key\":\"\",\"label\":\"\",\"type\":\"text\"}"))); dl.setVisible(true);
            if (dl.accepted) { fields().add(dl.f); refresh(fields().size() - 1); }
        }
        public void edit() {
            int i = table.getSelectedRow(); if (i < 0 || i >= fields().size()) return;
            FieldDialog dl = new FieldDialog(this, Json.obj(fields().get(i))); dl.setVisible(true);
            if (dl.accepted) { fields().set(i, dl.f); refresh(i); }
        }
        public void move(int n) { int i = table.getSelectedRow(); if (i < 0 || i + n < 0 || i + n >= fields().size()) return; Collections.swap(fields(), i, i + n); refresh(i + n); }
        public void remove() { int i = table.getSelectedRow(); if (i >= 0 && i < fields().size()) { fields().remove(i); refresh(i); } }
        public void save() {
            Map<String, Object> body = new LinkedHashMap<>(d);
            body.put("title", name.getText().trim()); body.put("titleAr", ar.getText().trim().isEmpty() ? null : ar.getText().trim()); body.put("icon", icons.get(Math.max(0, icon.getSelectedIndex())));
            body.put("color", color.getText().trim().isEmpty() ? "#6366f1" : color.getText().trim());
            List<Object> fs = new ArrayList<>(); for (Object f : fields()) if (!Json.str(Json.obj(f).get("label")).trim().isEmpty()) fs.add(f);
            body.put("fields", fs);
            Ui.async(() -> mod == null ? Api.I.ops("POST", "/custom/modules", body) : Api.I.ops("PUT", "/custom/modules/" + Json.str(mod.get("key")), body), m -> { onSaved.accept(Json.obj(m)); dispose(); }, e -> err.setText(e));
        }
    }

    public static final class RecordDialog extends JDialog {
        final Map<String, Object> mod, rec; final Runnable onSaved; public final Map<String, JComponent> w = new LinkedHashMap<>(); public final JLabel err = Ui.label("", "error");
        public RecordDialog(Window parent, Map<String, Object> mod, Map<String, Object> rec, boolean canEdit, Runnable onSaved) {
            super(parent, rec == null ? t("cus.new") : Json.str(rec.get("code")), ModalityType.APPLICATION_MODAL);
            this.mod = mod; this.rec = rec; this.onSaved = onSaved;
            List<Object> fs = Json.arr(Json.obj(mod.get("def")).get("fields")); Map<String, Object> data = rec == null ? new HashMap<>() : Json.obj(rec.get("data"));
            JPanel form = new JPanel(new GridBagLayout()); GridBagConstraints g = new GridBagConstraints(); g.insets = new Insets(4, 4, 4, 4); g.anchor = GridBagConstraints.WEST; g.fill = GridBagConstraints.HORIZONTAL; int row = 0;
            for (Object fv : fs) {
                Map<String, Object> f = Json.obj(fv); String k = Json.str(f.get("key")), ty = Json.str(f.get("type")); Object v = data.get(k); JComponent c;
                if (ty.equals("textarea")) { JTextArea a = new JTextArea(v == null ? "" : SiteRender.js(v), 3, 26); a.setLineWrap(true); w.put(k, a); c = new JScrollPane(a); }
                else if (ty.equals("select")) {
                    JComboBox<String> cb = new JComboBox<>(); cb.addItem(""); for (Object o : Json.arr(f.get("options"))) cb.addItem(Json.str(o));
                    cb.setSelectedItem(v == null ? "" : SiteRender.js(v)); cb.setEnabled(canEdit); w.put(k, cb); c = cb;
                } else if (ty.equals("checkbox")) { JCheckBox cb = new JCheckBox(); cb.setSelected(Boolean.TRUE.equals(v)); w.put(k, cb); c = cb; }
                else { JTextField tf = new JTextField(v == null ? "" : SiteRender.js(v), 26); if (ty.equals("date")) tf.setToolTipText("yyyy-mm-dd"); w.put(k, tf); c = tf; }
                if (!(c instanceof JScrollPane)) c.setEnabled(canEdit); else ((JScrollPane) c).getViewport().getView().setEnabled(canEdit);
                g.gridx = 0; g.gridy = row; g.weightx = 0; form.add(new JLabel(flabel(f) + (Boolean.TRUE.equals(f.get("required")) ? " *" : "")), g); g.gridx = 1; g.weightx = 1; form.add(c, g); row++;
            }
            List<Component> btns = new ArrayList<>();
            if (canEdit) { btns.add(Ui.button(t("cal.save"), this::save, null)); if (rec != null) btns.add(Ui.button(t("cal.delete"), this::del, "danger")); }
            btns.add(Ui.button(t("cal.close"), this::dispose, "plain"));
            JPanel bot = new JPanel(new BorderLayout()); bot.add(err); bot.add(Ui.row(btns.toArray(new Component[0])), BorderLayout.EAST);
            setLayout(new BorderLayout()); add(new JScrollPane(form)); add(bot, BorderLayout.SOUTH);
            setSize(500, Math.min(700, 150 + 42 * fs.size())); setLocationRelativeTo(parent);
        }
        @SuppressWarnings("unchecked") public Map<String, Object> values() {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Object fv : Json.arr(Json.obj(mod.get("def")).get("fields"))) {
                Map<String, Object> f = Json.obj(fv); String k = Json.str(f.get("key")), ty = Json.str(f.get("type")); JComponent c = w.get(k);
                if (ty.equals("textarea")) out.put(k, ((JTextArea) c).getText());
                else if (ty.equals("select")) out.put(k, String.valueOf(((JComboBox<String>) c).getSelectedItem()));
                else if (ty.equals("checkbox")) out.put(k, ((JCheckBox) c).isSelected());
                else {
                    String s = ((JTextField) c).getText().trim(); Object v = s;
                    if (ty.equals("number") && !s.isEmpty()) { try { double x = Double.parseDouble(s); v = x == Math.rint(x) ? (Object) (long) x : (Object) x; } catch (Exception e) { /* keep text */ } }
                    out.put(k, v);
                }
            }
            return out;
        }
        public void save() {
            Map<String, Object> body = new LinkedHashMap<>(); body.put("data", values()); String key = Json.str(mod.get("key"));
            Ui.async(() -> rec == null ? Api.I.ops("POST", "/custom/records/" + key, body) : Api.I.ops("PUT", "/custom/records/" + key + "/" + Json.str(rec.get("id")), body), x -> { onSaved.run(); dispose(); }, e -> err.setText(e));
        }
        public void del() {
            if (!Ui.ask(this, t("cal.delete") + "?", t("cal.delete"), t("cal.close"))) return;
            Ui.async(() -> Api.I.ops("DELETE", "/custom/records/" + Json.str(mod.get("key")) + "/" + Json.str(rec.get("id")), null), x -> { onSaved.run(); dispose(); }, e -> err.setText(e));
        }
    }

    public static final class CustomPanel extends JPanel implements Reloadable {
        public final JComboBox<String> pick = new JComboBox<>(); public final JTextField search = new JTextField(14);
        public final JButton bNew, bMod, bDes, bDel; public Ui.DataTable table = new Ui.DataTable(); final JScrollPane scroll = new JScrollPane(table); public final JLabel msg = new JLabel();
        public List<Object> mods = new ArrayList<>(); final List<String> keys = new ArrayList<>(); boolean quiet;

        public CustomPanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            bNew = Ui.button(t("cus.new"), () -> openRec(null), null); bMod = Ui.button(t("cus.newModule"), () -> design(null), "plain");
            bDes = Ui.button(t("cus.design"), () -> design(cur()), "plain"); bDel = Ui.button("✕ " + t("cus.name"), this::delModule, "danger");
            pick.addActionListener(e -> { if (!quiet) loadRecords(); });
            search.addActionListener(e -> loadRecords());
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0)); bar.add(pick); bar.add(search); bar.add(bNew); bar.add(bMod); bar.add(bDes); bar.add(bDel);
            JPanel head = new JPanel(new BorderLayout()); head.add(Ui.label(t("tab.cus"), "title"), BorderLayout.NORTH); head.add(bar);
            add(head, BorderLayout.NORTH); add(scroll); add(msg, BorderLayout.SOUTH);
        }
        public Map<String, Object> cur() { int i = pick.getSelectedIndex(); return i >= 0 && i < mods.size() ? Json.obj(mods.get(i)) : null; }
        @Override public void reload() { reload(keys.isEmpty() || pick.getSelectedIndex() < 0 ? "" : keys.get(pick.getSelectedIndex())); }
        void reload(String keep) {
            bMod.setVisible(Api.I.can("cus.design"));
            Ui.async(() -> Json.arr(Api.I.ops("GET", "/custom/modules", null)), l -> gotModules(l, keep), e -> msg.setText(e));
        }
        void gotModules(List<Object> m, String keep) {
            mods = m; keys.clear(); quiet = true; pick.removeAllItems();
            for (Object mv : m) { pick.addItem(title(Json.obj(mv))); keys.add(Json.str(Json.obj(mv).get("key"))); }
            pick.setSelectedIndex(keys.isEmpty() ? -1 : Math.max(0, keys.indexOf(keep))); quiet = false;
            loadRecords();
        }
        public void loadRecords() {
            Map<String, Object> m = cur();
            bNew.setVisible(m != null && Api.I.can("cus.manage")); bDes.setVisible(m != null && Api.I.can("cus.design")); bDel.setVisible(m != null && Api.I.can("cus.design"));
            if (m == null) { table = new Ui.DataTable(); scroll.setViewportView(table); msg.setText(t("cus.empty")); return; }
            List<Object> cols = new ArrayList<>(Json.arr(Json.obj(m.get("def")).get("fields"))); if (cols.size() > 6) cols = cols.subList(0, 6);
            List<String> heads = new ArrayList<>(); heads.add("#"); for (Object f : cols) heads.add(flabel(Json.obj(f)));
            table = new Ui.DataTable(heads.toArray(new String[0])); scroll.setViewportView(table); table.onOpen(() -> openRec(table.selected() == null ? null : Json.obj(table.selected())));
            final Ui.DataTable mine = table; final List<Object> fcols = cols; final String key = Json.str(m.get("key"));
            Ui.async(() -> Json.arr(Api.I.ops("GET", "/custom/records/" + key + "?q=" + URLEncoder.encode(search.getText().trim(), StandardCharsets.UTF_8), null)), rows -> {
                if (mine != table) return;
                List<String[]> out = new ArrayList<>();
                for (Object rv : rows) { Map<String, Object> r = Json.obj(rv); List<String> c = new ArrayList<>(); c.add(Json.str(r.get("code"))); for (Object f : fcols) c.add(cell(Json.obj(f), r)); out.add(c.toArray(new String[0])); }
                table.fill(out, rows); msg.setText(rows.isEmpty() ? t("cus.none") : t("cus.sub", "n", String.valueOf(rows.size())));
            }, e -> msg.setText(e));
        }
        public void openRec(Map<String, Object> rec) {
            Map<String, Object> m = cur(); if (m == null || (rec == null && !Api.I.can("cus.manage"))) return;
            new RecordDialog(win(this), m, rec, Api.I.can("cus.manage"), this::loadRecords).setVisible(true);
        }
        public void design(Map<String, Object> mod) {
            if (mod == null && !bMod.isVisible()) return;
            new Designer(win(this), mod, saved -> reload(Json.str(saved.get("key")))).setVisible(true);
        }
        public void delModule() {
            Map<String, Object> m = cur(); if (m == null || !Ui.ask(this, t("cal.delete") + " " + title(m) + "?", t("cal.delete"), t("cal.close"))) return;
            Ui.async(() -> Api.I.ops("DELETE", "/custom/modules/" + Json.str(m.get("key")), null), x -> reload(""), e -> Ui.warn(this, e));
        }
    }
}
