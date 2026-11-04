package erp;

import java.awt.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.List;
import javax.swing.*;

import static erp.I18n.t;

/** Website builder: sites, a block editor (pages, blocks, theme, shop), publish / unpublish and the orders and messages visitors sent. */
public final class Site {
    private Site() { }

    static Map<String, Object> blockDef(String type) {
        for (Object b : Json.arr(SiteRender.spec().get("blocks"))) if (type.equals(Json.str(Json.obj(b).get("type")))) return Json.obj(b);
        return new LinkedHashMap<>();
    }
    @SuppressWarnings("unchecked") static <T> T copy(T o) { return (T) Json.parse(Json.write(o)); }
    static String uid() { String c = "abcdefghijklmnopqrstuvwxyz0123456789"; Random r = new Random(); StringBuilder b = new StringBuilder(); for (int i = 0; i < 7; i++) b.append(c.charAt(r.nextInt(c.length()))); return b.toString(); }
    public static Map<String, Object> newBlock(String kind) {
        Map<String, Object> b = new LinkedHashMap<>(); b.put("id", uid()); b.put("type", kind); b.put("props", copy(Json.obj(blockDef(kind).get("defaults")))); return b;
    }
    public static Map<String, Object> templateDesign(String key, String name, String cur) {
        String s = Json.write(Json.obj(SiteRender.spec().get("templates")).get(key));
        String n = Json.write(name), c = Json.write(cur);
        return Json.obj(Json.parse(s.replace("{{name}}", n.substring(1, n.length() - 1)).replace("{{cur}}", c.substring(1, c.length() - 1))));
    }
    static String optLabel(String v) { return v.startsWith("web.") ? t(v) : v; }
    static String summary(Object v) { if (v instanceof List) return String.valueOf(((List<?>) v).size()); String s = Json.str(v); return s.length() > 60 ? s.substring(0, 60) : s; }
    static String[] publicUrls(String slug) {
        String s = Api.I.server.trim().replaceAll("/+$", "");
        if (s.toLowerCase().endsWith("/api")) s = s.substring(0, s.length() - 4);
        s += "/api";
        return new String[]{s + "/public/sites/" + slug + "/orders", s + "/public/sites/" + slug + "/messages"};
    }
    static void preview(String html, String slug) {
        try {
            Path p = Path.of(System.getProperty("java.io.tmpdir"), (slug.isEmpty() ? "site" : slug) + "-preview.html");
            Files.writeString(p, html, StandardCharsets.UTF_8);
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) Desktop.getDesktop().browse(p.toUri());
        } catch (Exception e) { /* headless */ }
    }
    static Window win(Component c) { return SwingUtilities.getWindowAncestor(c); }

    // ------------------------------------------------------------------ field forms
    /** Edits a list of items (features, gallery pictures, FAQ ...). */
    public static final class ListDialog extends JDialog {
        final List<Object> fields; public final List<Object> items = new ArrayList<>(); final Map<String, Object> deflt; public boolean accepted;
        final Ui.DataTable table;
        public ListDialog(Window parent, String title, List<Object> fields, List<Object> items, Map<String, Object> deflt) {
            super(parent, title, ModalityType.APPLICATION_MODAL);
            this.fields = fields; this.deflt = deflt;
            for (Object i : items) this.items.add(copy(i));
            String[] heads = new String[fields.size()];
            for (int i = 0; i < heads.length; i++) heads[i] = t(Json.str(Json.obj(fields.get(i)).get("label")));
            table = new Ui.DataTable(heads);
            table.onOpen(this::edit);
            JPanel bar = Ui.row(Ui.button("+", this::add, "plain"), Ui.button(t("web.edit"), this::edit, "plain"), Ui.button("↑", () -> move(-1), "plain"), Ui.button("↓", () -> move(1), "plain"), Ui.button("✕", this::remove, "plain"),
                Ui.button(t("cal.save"), () -> { accepted = true; dispose(); }, null));
            setLayout(new BorderLayout()); add(new JScrollPane(table)); add(bar, BorderLayout.SOUTH);
            setSize(640, 420); setLocationRelativeTo(parent);
            refresh(0);
        }
        void refresh(int sel) {
            List<String[]> rows = new ArrayList<>(); List<Object> pay = new ArrayList<>();
            for (int n = 0; n < items.size(); n++) { String[] r = new String[fields.size()]; for (int i = 0; i < r.length; i++) r[i] = summary(Json.obj(items.get(n)).get(Json.str(Json.obj(fields.get(i)).get("key")))); rows.add(r); pay.add(n); }
            table.fill(rows, pay);
            if (!items.isEmpty()) table.setRowSelectionInterval(Math.min(sel, items.size() - 1), Math.min(sel, items.size() - 1));
        }
        public void add() { items.add(copy(deflt)); refresh(items.size() - 1); edit(); }
        public void edit() {
            int i = table.getSelectedRow(); if (i < 0 || i >= items.size()) return;
            PropsDialog d = new PropsDialog(this, t("web.edit"), fields, Json.obj(items.get(i)));
            d.setVisible(true);
            if (d.accepted) { items.set(i, d.values); refresh(i); }
        }
        public void move(int n) { int i = table.getSelectedRow(); if (i < 0 || i + n < 0 || i + n >= items.size()) return; Collections.swap(items, i, i + n); refresh(i + n); }
        public void remove() { int i = table.getSelectedRow(); if (i >= 0 && i < items.size()) { items.remove(i); refresh(i); } }
    }

    /** A form generated from a list of field definitions (text, textarea, number, select, image, list). */
    public static final class PropsDialog extends JDialog {
        final List<Object> fields; public Map<String, Object> values; public boolean accepted;
        public final Map<String, JComponent> w = new LinkedHashMap<>();
        public PropsDialog(Window parent, String title, List<Object> fields, Map<String, Object> props) {
            super(parent, title, ModalityType.APPLICATION_MODAL);
            this.fields = fields; this.values = copy(props);
            JPanel form = new JPanel(new GridBagLayout());
            form.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
            GridBagConstraints g = new GridBagConstraints(); g.insets = new Insets(3, 3, 3, 3); g.anchor = GridBagConstraints.WEST; g.fill = GridBagConstraints.HORIZONTAL; int row = 0;
            for (Object fv : fields) {
                Map<String, Object> f = Json.obj(fv); String k = Json.str(f.get("key")), kind = Json.str(f.get("kind")); Object v = values.get(k);
                JComponent c;
                switch (kind) {
                    case "textarea": { JTextArea a = new JTextArea(v == null ? "" : Json.str(v), 4, 30); a.setLineWrap(true); c = new JScrollPane(a); w.put(k, a); break; }
                    case "select": {
                        JComboBox<String> cb = new JComboBox<>(); List<String> vals = new ArrayList<>();
                        for (Object o : Json.arr(f.get("options"))) { cb.addItem(optLabel(Json.str(Json.obj(o).get("l")))); vals.add(Json.str(Json.obj(o).get("v"))); }
                        cb.putClientProperty("vals", vals); cb.setSelectedIndex(Math.max(0, vals.indexOf(SiteRender.js(v)))); c = cb; w.put(k, cb); break;
                    }
                    case "list": {
                        JButton b = new JButton(t(Json.str(f.get("label"))) + " (" + Json.arr(v).size() + ")…");
                        b.addActionListener(e -> editList(f, b)); c = b; w.put(k, b); break;
                    }
                    default: { JTextField tf = new JTextField(v == null ? "" : SiteRender.js(v), 30); c = tf; w.put(k, tf); }
                }
                g.gridx = 0; g.gridy = row; g.weightx = 0; form.add(new JLabel(t(Json.str(f.get("label")))), g);
                g.gridx = 1; g.weightx = 1; form.add(c, g); row++;
            }
            JPanel bot = Ui.row(Ui.button(t("cal.save"), this::ok, null));
            setLayout(new BorderLayout()); add(new JScrollPane(form)); add(bot, BorderLayout.SOUTH);
            setSize(560, Math.min(700, 140 + 40 * fields.size())); setLocationRelativeTo(parent);
        }
        void editList(Map<String, Object> f, JButton b) {
            ListDialog d = new ListDialog(this, t(Json.str(f.get("label"))), Json.arr(f.get("itemFields")), Json.arr(values.get(Json.str(f.get("key")))), Json.obj(f.get("itemDefault")));
            d.setVisible(true);
            if (d.accepted) { values.put(Json.str(f.get("key")), new ArrayList<>(d.items)); b.setText(t(Json.str(f.get("label"))) + " (" + d.items.size() + ")…"); }
        }
        @SuppressWarnings("unchecked") void ok() {
            for (Object fv : fields) {
                Map<String, Object> f = Json.obj(fv); String k = Json.str(f.get("key")), kind = Json.str(f.get("kind")); JComponent c = w.get(k);
                if (kind.equals("textarea")) values.put(k, ((JTextArea) c).getText());
                else if (kind.equals("select")) { JComboBox<String> cb = (JComboBox<String>) c; values.put(k, ((List<String>) cb.getClientProperty("vals")).get(Math.max(0, cb.getSelectedIndex()))); }
                else if (kind.equals("number")) {
                    double x; try { x = Double.parseDouble(((JTextField) c).getText().trim()); } catch (Exception e) { x = f.containsKey("min") ? SiteRender.num(f.get("min"), 0) : 0; }
                    if (f.containsKey("min")) x = Math.max(SiteRender.num(f.get("min"), 0), x);
                    if (f.containsKey("max")) x = Math.min(SiteRender.num(f.get("max"), 0), x);
                    values.put(k, x == Math.rint(x) ? (Object) (long) x : (Object) x);
                } else if (!kind.equals("list")) values.put(k, ((JTextField) c).getText());
            }
            accepted = true; dispose();
        }
    }

    static List<Object> productFields() {
        String s = "[{\"key\":\"sku\",\"label\":\"SKU\",\"kind\":\"text\"},{\"key\":\"name\",\"label\":\"web.f.name\",\"kind\":\"text\"},{\"key\":\"price\",\"label\":\"Price\",\"kind\":\"number\",\"min\":0},"
            + "{\"key\":\"category\",\"label\":\"web.f.category\",\"kind\":\"text\"},{\"key\":\"description\",\"label\":\"web.f.text\",\"kind\":\"text\"},{\"key\":\"image\",\"label\":\"web.f.image\",\"kind\":\"image\"}]";
        return Json.arr(Json.parse(s));
    }

    // ------------------------------------------------------------------ the editor
    public static final class Editor extends JDialog {
        public final Map<String, Object> row; public final Map<String, Object> d; final Runnable onSaved;
        public final DefaultListModel<String> pageModel = new DefaultListModel<>(), blockModel = new DefaultListModel<>();
        public final JList<String> pages = new JList<>(pageModel), blocks = new JList<>(blockModel);
        public final JComboBox<String> kind = new JComboBox<>();
        final List<String> kinds = new ArrayList<>();
        public final JTextField prim, bg, tx, radius, title, lang, desc, cur;
        public final JComboBox<String> font = new JComboBox<>(), dir = new JComboBox<>(new String[]{"ltr", "rtl"});
        public final JCheckBox dark = new JCheckBox(t("web.dark")), shopOn = new JCheckBox(t("web.shopOn"));
        public final Ui.DataTable prod;
        public final JLabel msg = new JLabel();
        int pi = 0;

        public Editor(Window parent, Map<String, Object> row, Map<String, Object> design, Runnable onSaved) {
            super(parent, t("web.design") + " · " + Json.str(row.get("name")), ModalityType.APPLICATION_MODAL);
            this.row = row; this.d = design; this.onSaved = onSaved;
            Map<String, Object> th = Json.obj(d.get("theme")), st = Json.obj(d.get("settings")), shop = Json.obj(d.get("shop"));
            JTabbedPane tabs = new JTabbedPane();
            // pages and blocks
            JPanel pp = new JPanel(new BorderLayout(8, 8));
            JPanel left = new JPanel(new BorderLayout()); left.add(Ui.label(t("web.p.pages"), null), BorderLayout.NORTH); left.add(new JScrollPane(pages));
            left.add(Ui.row(Ui.button("+", this::addPage, "plain"), Ui.button(t("web.edit"), this::editPage, "plain"), Ui.button("✕", this::delPage, "plain")), BorderLayout.SOUTH);
            JPanel right = new JPanel(new BorderLayout()); right.add(Ui.label(t("web.p.layers"), null), BorderLayout.NORTH); right.add(new JScrollPane(blocks));
            for (Object b : Json.arr(SiteRender.spec().get("blocks"))) { kind.addItem(t(Json.str(Json.obj(b).get("label")))); kinds.add(Json.str(Json.obj(b).get("type"))); }
            right.add(Ui.row(kind, Ui.button("+", this::addBlock, "plain"), Ui.button(t("web.edit"), this::editBlock, "plain"), Ui.button(t("web.duplicate"), this::dupBlock, "plain"),
                Ui.button("↑", () -> moveBlock(-1), "plain"), Ui.button("↓", () -> moveBlock(1), "plain"), Ui.button("✕", this::delBlock, "plain")), BorderLayout.SOUTH);
            left.setPreferredSize(new Dimension(260, 400));
            pp.add(left, BorderLayout.WEST); pp.add(right);
            pages.addListSelectionListener(e -> { if (!e.getValueIsAdjusting() && pages.getSelectedIndex() >= 0) { pi = pages.getSelectedIndex(); refreshBlocks(0); } });
            blocks.addMouseListener(new java.awt.event.MouseAdapter() { @Override public void mouseClicked(java.awt.event.MouseEvent e) { if (e.getClickCount() == 2) editBlock(); } });
            tabs.addTab(t("web.p.pages"), pp);
            // theme and settings
            prim = new JTextField(Json.str(th.get("primary")), 12); bg = new JTextField(Json.str(th.get("bg")), 12); tx = new JTextField(Json.str(th.get("text")), 12);
            for (String f : Json.obj(SiteRender.spec().get("fonts")).keySet()) font.addItem(f);
            font.setSelectedItem(th.get("font") == null ? "sans" : Json.str(th.get("font")));
            radius = new JTextField(SiteRender.js(th.get("radius") == null ? 10 : th.get("radius")), 6); dark.setSelected(Boolean.TRUE.equals(th.get("dark")));
            title = new JTextField(Json.str(st.get("title")), 24); lang = new JTextField(Json.str(st.get("lang")), 6); desc = new JTextField(Json.str(st.get("description")), 30);
            dir.setSelectedItem("rtl".equals(Json.str(st.get("dir"))) ? "rtl" : "ltr");
            JPanel f2 = new JPanel(new GridBagLayout()); GridBagConstraints g = new GridBagConstraints(); g.insets = new Insets(4, 4, 4, 4); g.anchor = GridBagConstraints.WEST; int r = 0;
            Object[][] rows = {{t("web.colorPrimary"), prim}, {t("web.colorBg"), bg}, {t("web.colorText"), tx}, {t("web.font"), font}, {t("web.radius"), radius}, {"", dark}, {t("web.siteTitle"), title}, {t("web.language"), lang}, {"dir", dir}, {t("web.metaDesc"), desc}};
            for (Object[] x : rows) { g.gridx = 0; g.gridy = r; f2.add(new JLabel((String) x[0]), g); g.gridx = 1; f2.add((Component) x[1], g); r++; }
            JPanel w2 = new JPanel(new BorderLayout()); w2.add(f2, BorderLayout.NORTH);
            tabs.addTab(t("web.details"), w2);
            // shop
            shopOn.setSelected(Boolean.TRUE.equals(shop.get("enabled"))); cur = new JTextField(Json.str(shop.get("currency")), 6);
            List<Object> pf = productFields(); String[] heads = new String[pf.size()];
            for (int i = 0; i < heads.length; i++) { String l = Json.str(Json.obj(pf.get(i)).get("label")); heads[i] = l.equals("SKU") || l.equals("Price") ? l : t(l); }
            prod = new Ui.DataTable(heads); prod.onOpen(this::editProd);
            JPanel w3 = new JPanel(new BorderLayout());
            w3.add(Ui.row(shopOn, new JLabel(t("web.currency")), cur), BorderLayout.NORTH); w3.add(new JScrollPane(prod));
            w3.add(Ui.row(Ui.button("+", this::addProd, "plain"), Ui.button(t("web.edit"), this::editProd, "plain"), Ui.button("✕", this::delProd, "plain"), Ui.button(t("web.sync"), this::sync, "plain")), BorderLayout.SOUTH);
            tabs.addTab(t("web.p.shop"), w3);
            setLayout(new BorderLayout()); add(tabs);
            JPanel bottom = new JPanel(new BorderLayout()); bottom.add(msg); bottom.add(Ui.row(Ui.button(t("web.preview"), this::preview, "plain"), Ui.button(t("cal.save"), this::save, null), Ui.button(t("cal.close"), this::dispose, "plain")), BorderLayout.EAST);
            add(bottom, BorderLayout.SOUTH);
            setSize(900, 600); setLocationRelativeTo(parent);
            refreshPages(0); refreshProducts(0);
        }

        List<Object> pageList() { return Json.arr(d.get("pages")); }
        Map<String, Object> page() { return Json.obj(pageList().get(pi)); }
        List<Object> bl() { return Json.arr(page().get("blocks")); }
        void refreshPages(int sel) {
            pageModel.clear();
            for (Object p : pageList()) pageModel.addElement(Json.str(Json.obj(p).get("title")) + "   " + Json.str(Json.obj(p).get("path")));
            pi = Math.max(0, Math.min(sel, pageList().size() - 1));
            pages.setSelectedIndex(pi); refreshBlocks(0);
        }
        public void addPage() {
            Map<String, Object> p = new LinkedHashMap<>(); p.put("id", uid()); p.put("path", "/page" + (pageList().size() + 1)); p.put("title", t("web.newPage"));
            List<Object> b = new ArrayList<>(); b.add(newBlock("nav")); b.add(newBlock("footer")); p.put("blocks", b);
            pageList().add(p); refreshPages(pageList().size() - 1);
        }
        public void editPage() {
            Map<String, Object> p = page();
            List<Object> f = Json.arr(Json.parse("[{\"key\":\"title\",\"label\":\"web.pageTitle\",\"kind\":\"text\"},{\"key\":\"path\",\"label\":\"web.pagePath\",\"kind\":\"text\"}]"));
            PropsDialog dl = new PropsDialog(this, t("web.edit"), f, p); dl.setVisible(true);
            if (dl.accepted) { String path = Json.str(dl.values.get("path")).trim(); if (path.isEmpty()) path = "/"; p.put("title", dl.values.get("title")); p.put("path", path.startsWith("/") ? path : "/" + path); refreshPages(pi); }
        }
        public void delPage() { if (pageList().size() > 1) { pageList().remove(pi); refreshPages(0); } }

        void refreshBlocks(int sel) {
            blockModel.clear();
            for (Object bv : bl()) {
                Map<String, Object> b = Json.obj(bv), p = Json.obj(b.get("props")); String first = "";
                for (String k : new String[]{"title", "heading", "brand", "text", "button"}) if (!SiteRender.js(p.get(k)).isEmpty() && !Boolean.FALSE.equals(p.get(k))) { first = SiteRender.js(p.get(k)); break; }
                Map<String, Object> def = blockDef(Json.str(b.get("type")));
                blockModel.addElement((def.isEmpty() ? Json.str(b.get("type")) : t(Json.str(def.get("label")))) + "   " + (first.length() > 50 ? first.substring(0, 50) : first));
            }
            if (!bl().isEmpty()) blocks.setSelectedIndex(Math.max(0, Math.min(sel, bl().size() - 1)));
        }
        public void addBlock() {
            List<Object> l = bl(); Map<String, Object> b = newBlock(kinds.get(Math.max(0, kind.getSelectedIndex())));
            int pos = !l.isEmpty() && "footer".equals(Json.str(Json.obj(l.get(l.size() - 1)).get("type"))) ? l.size() - 1 : l.size();
            l.add(pos, b); refreshBlocks(pos);
        }
        public void editBlock() {
            int i = blocks.getSelectedIndex(); List<Object> l = bl(); if (i < 0 || i >= l.size()) return;
            Map<String, Object> b = Json.obj(l.get(i)), def = blockDef(Json.str(b.get("type")));
            PropsDialog dl = new PropsDialog(this, t(Json.str(def.get("label"))), Json.arr(def.get("fields")), Json.obj(b.get("props"))); dl.setVisible(true);
            if (dl.accepted) { b.put("props", dl.values); refreshBlocks(i); }
        }
        public void dupBlock() { int i = blocks.getSelectedIndex(); List<Object> l = bl(); if (i < 0 || i >= l.size()) return; Map<String, Object> c = copy(Json.obj(l.get(i))); c.put("id", uid()); l.add(i + 1, c); refreshBlocks(i + 1); }
        public void moveBlock(int n) { int i = blocks.getSelectedIndex(); List<Object> l = bl(); if (i < 0 || i + n < 0 || i + n >= l.size()) return; Collections.swap(l, i, i + n); refreshBlocks(i + n); }
        public void delBlock() { int i = blocks.getSelectedIndex(); List<Object> l = bl(); if (i >= 0 && i < l.size()) { l.remove(i); refreshBlocks(i); } }

        List<Object> products() { return Json.arr(Json.obj(d.get("shop")).get("products")); }
        void refreshProducts(int sel) {
            List<Object> ps = products(), pf = productFields(); List<String[]> rows = new ArrayList<>(); List<Object> pay = new ArrayList<>();
            for (int n = 0; n < ps.size(); n++) { String[] r = new String[pf.size()]; for (int i = 0; i < r.length; i++) r[i] = SiteRender.js(Json.obj(ps.get(n)).get(Json.str(Json.obj(pf.get(i)).get("key")))); rows.add(r); pay.add(n); }
            prod.fill(rows, pay);
            if (!ps.isEmpty()) prod.setRowSelectionInterval(Math.min(sel, ps.size() - 1), Math.min(sel, ps.size() - 1));
        }
        public void addProd() {
            Map<String, Object> p = new LinkedHashMap<>(); p.put("sku", "SKU" + (products().size() + 1)); p.put("name", ""); p.put("price", 0L); p.put("category", ""); p.put("description", ""); p.put("image", "");
            products().add(p); refreshProducts(products().size() - 1); editProd();
        }
        public void editProd() {
            int i = prod.getSelectedRow(); List<Object> ps = products(); if (i < 0 || i >= ps.size()) return;
            PropsDialog dl = new PropsDialog(this, t("web.edit"), productFields(), Json.obj(ps.get(i))); dl.setVisible(true);
            if (dl.accepted) { ps.set(i, dl.values); refreshProducts(i); }
        }
        public void delProd() { int i = prod.getSelectedRow(); if (i >= 0 && i < products().size()) { products().remove(i); refreshProducts(i); } }
        public void sync() {
            Ui.async(() -> Json.arr(Api.I.ops("GET", "/pos/records/product", null)), lst -> {
                Map<String, Object> old = new HashMap<>(); for (Object p : products()) old.put(Json.str(Json.obj(p).get("sku")), p);
                List<Object> out = new ArrayList<>();
                for (Object rv : lst) {
                    Map<String, Object> r = Json.obj(rv), dd = Json.obj(r.get("data")); String code = Json.str(r.get("code"));
                    if (code.isEmpty() || "inactive".equals(Json.str(r.get("status")))) continue;
                    Map<String, Object> o = Json.obj(old.get(code)), p = new LinkedHashMap<>();
                    p.put("sku", code); p.put("name", dd.get("name") == null || Json.str(dd.get("name")).isEmpty() ? code : Json.str(dd.get("name"))); p.put("price", SiteRender.num(dd.get("price"), 0));
                    p.put("category", Json.str(dd.get("category"))); p.put("description", Json.str(o.get("description")));
                    p.put("image", !Json.str(o.get("image")).isEmpty() ? Json.str(o.get("image")) : (dd.get("image") instanceof String ? dd.get("image") : "")); out.add(p);
                }
                Json.obj(d.get("shop")).put("products", out); shopOn.setSelected(true); refreshProducts(0); msg.setText(String.valueOf(out.size()));
            }, e -> msg.setText(t("web.syncFail")));
        }

        public Map<String, Object> collect() {
            Map<String, Object> th = Json.obj(d.get("theme")), st = Json.obj(d.get("settings")), shop = Json.obj(d.get("shop"));
            if (!prim.getText().trim().isEmpty()) th.put("primary", prim.getText().trim());
            if (!bg.getText().trim().isEmpty()) th.put("bg", bg.getText().trim());
            if (!tx.getText().trim().isEmpty()) th.put("text", tx.getText().trim());
            th.put("font", font.getSelectedItem()); th.put("dark", dark.isSelected());
            try { th.put("radius", (long) Double.parseDouble(radius.getText().trim())); } catch (Exception e) { /* keep */ }
            st.put("title", title.getText().trim().isEmpty() ? Json.str(row.get("name")) : title.getText().trim());
            st.put("lang", lang.getText().trim().isEmpty() ? "en" : lang.getText().trim()); st.put("dir", dir.getSelectedItem());
            if (!desc.getText().trim().isEmpty()) st.put("description", desc.getText().trim()); else st.remove("description");
            shop.put("enabled", shopOn.isSelected()); shop.put("currency", cur.getText().trim().isEmpty() ? Json.str(shop.get("currency")) : cur.getText().trim());
            return d;
        }
        public void save() {
            Map<String, Object> design = collect(); Map<String, Object> body = new LinkedHashMap<>(); body.put("name", row.get("name")); body.put("design", design);
            Ui.async(() -> Api.I.ops("PUT", "/website/sites/" + Json.str(row.get("id")), body), r -> { msg.setText(t("web.saved")); onSaved.run(); }, e -> msg.setText(e));
        }
        public void preview() { Site.preview(SiteRender.render(collect()), Json.str(row.get("slug"))); }
    }

    // ------------------------------------------------------------------ the page
    public static final class SitePanel extends JPanel implements Reloadable {
        public final JComboBox<String> pick = new JComboBox<>();
        final List<String> modes = new ArrayList<>();
        public final Map<String, JButton> btns = new LinkedHashMap<>();
        public Ui.DataTable table = new Ui.DataTable();
        final JScrollPane scroll = new JScrollPane(table);
        public final JLabel msg = new JLabel();
        public String pending = "";
        List<Object> sites = new ArrayList<>();

        public SitePanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            pick.addItem(t("web.sites")); modes.add("sites");
            if (Api.I.can("web.orders.manage")) { pick.addItem(t("web.orders")); modes.add("subs"); }
            pick.addActionListener(e -> reload());
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0)); bar.add(pick);
            Object[][] bs = {{"new", t("web.newSite"), (Runnable) this::newSite, null}, {"design", t("web.design"), (Runnable) this::design, null}, {"preview", t("web.preview"), (Runnable) this::previewSel, "plain"}, {"save", t("web.download"), (Runnable) this::saveHtml, "plain"},
                {"pub", t("web.publish"), (Runnable) this::publish, null}, {"unpub", t("web.unpublish"), (Runnable) this::unpublish, "plain"}, {"del", "✕", (Runnable) this::delete, "danger"},
                {"s_new", t("web.st.new"), (Runnable) () -> status("new"), "plain"}, {"s_conf", t("web.st.confirmed"), (Runnable) () -> status("confirmed"), "plain"}, {"s_ship", t("web.st.shipped"), (Runnable) () -> status("shipped"), "plain"},
                {"s_done", t("web.st.done"), (Runnable) () -> status("done"), "plain"}, {"s_can", t("web.st.cancelled"), (Runnable) () -> status("cancelled"), "plain"}};
            for (Object[] b : bs) { JButton x = Ui.button((String) b[1], (Runnable) b[2], (String) b[3]); btns.put((String) b[0], x); bar.add(x); }
            JPanel head = new JPanel(new BorderLayout()); head.add(Ui.label(t("tab.web"), "title"), BorderLayout.NORTH); head.add(bar);
            add(head, BorderLayout.NORTH); add(scroll); add(msg, BorderLayout.SOUTH);
        }

        public String mode() { return modes.get(Math.max(0, pick.getSelectedIndex())); }
        @Override public void reload() {
            boolean subs = mode().equals("subs");
            for (Map.Entry<String, JButton> e : btns.entrySet()) {
                String k = e.getKey(); JButton b = e.getValue();
                if (k.startsWith("s_")) b.setVisible(subs);
                else if (k.equals("new") || k.equals("design")) b.setVisible(!subs && Api.I.can("web.edit"));
                else if (k.equals("pub") || k.equals("unpub") || k.equals("del")) b.setVisible(!subs && Api.I.can("web.publish"));
                else b.setVisible(!subs);
            }
            String keep = pending; pending = "";
            msg.setText(keep.isEmpty() ? "…" : keep);
            if (subs) {
                table = new Ui.DataTable("#", t("web.site"), "Type", t("web.customer"), "Total", "Status", "Date"); scroll.setViewportView(table);
                final Ui.DataTable mine = table;
                Ui.async(() -> new Object[]{Json.arr(Api.I.ops("GET", "/website/submissions", null)), Json.arr(Api.I.ops("GET", "/website/sites", null))}, res -> {
                    if (mine != table) return;
                    Map<String, String> names = new HashMap<>(); for (Object s : Json.arr(res[1])) names.put(Json.str(Json.obj(s).get("id")), Json.str(Json.obj(s).get("name")));
                    List<String[]> rows = new ArrayList<>();
                    for (Object sv : Json.arr(res[0])) {
                        Map<String, Object> s = Json.obj(sv); boolean order = "order".equals(Json.str(s.get("kind")));
                        String note = Json.str(s.get("note"));
                        rows.add(new String[]{Json.str(s.get("number")), names.getOrDefault(Json.str(s.get("siteId")), ""), Json.str(s.get("kind")), Json.str(s.get("name")) + (Json.str(s.get("email")).isEmpty() ? "" : " · " + Json.str(s.get("email"))),
                            order ? SiteRender.js(s.get("total")) + " " + Json.str(s.get("currency")) : (note.length() > 40 ? note.substring(0, 40) : note), Json.str(s.get("status")), Json.str(s.get("createdAt")).substring(0, Math.min(16, Json.str(s.get("createdAt")).length())).replace('T', ' ')});
                    }
                    table.fill(rows, Json.arr(res[0])); if (keep.isEmpty()) msg.setText(rows.isEmpty() ? t("web.none") : "");
                }, e -> msg.setText(e));
            } else {
                table = new Ui.DataTable(t("web.siteName"), "URL", "Status", "Currency", t("web.view")); scroll.setViewportView(table);
                final Ui.DataTable mine = table;
                Ui.async(() -> Json.arr(Api.I.ops("GET", "/website/sites", null)), rows -> {
                    if (mine != table) return;
                    sites = rows; List<String[]> out = new ArrayList<>();
                    for (Object rv : rows) {
                        Map<String, Object> r = Json.obj(rv); String up = Json.str(r.get("updatedAt"));
                        out.add(new String[]{Json.str(r.get("name")), "/s/" + Json.str(r.get("slug")), Boolean.TRUE.equals(r.get("published")) ? t("web.live") : t("web.draft"), Json.str(r.get("currency")), up.substring(0, Math.min(16, up.length())).replace('T', ' ')});
                    }
                    table.fill(out, rows); if (keep.isEmpty()) msg.setText(rows.isEmpty() ? t("web.none") : "");
                }, e -> msg.setText(e));
            }
        }

        Map<String, Object> sel() { return table.selected() == null ? null : Json.obj(table.selected()); }
        public void newSite() {
            JTextField name = new JTextField(20), c = new JTextField("SAR", 6); JComboBox<String> tpl = new JComboBox<>(); String[] ks = {"shop", "business", "blank"};
            for (String k : ks) tpl.addItem(t("web.t." + k));
            JPanel p = new JPanel(new GridLayout(0, 2, 6, 6)); p.add(new JLabel(t("web.siteName"))); p.add(name); p.add(new JLabel(t("web.template"))); p.add(tpl); p.add(new JLabel(t("web.currency"))); p.add(c);
            if (JOptionPane.showConfirmDialog(this, p, t("web.newSite"), JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION || name.getText().trim().isEmpty()) return;
            String cc = c.getText().trim().isEmpty() ? "SAR" : c.getText().trim();
            Map<String, Object> body = new LinkedHashMap<>(); body.put("name", name.getText().trim()); body.put("design", templateDesign(ks[Math.max(0, tpl.getSelectedIndex())], name.getText().trim(), cc)); body.put("currency", cc);
            Ui.async(() -> Json.obj(Api.I.ops("POST", "/website/sites", body)), r -> { reload(); openEditor(r); }, e -> Ui.warn(this, e));
        }
        public void openEditor(Map<String, Object> row) {
            Ui.async(() -> Json.obj(Api.I.ops("GET", "/website/sites/" + Json.str(row.get("id")), null)), full -> new Editor(win(this), full, Json.obj(full.get("design")), this::reload).setVisible(true), e -> Ui.warn(this, e));
        }
        public void design() { Map<String, Object> r = sel(); if (r != null) openEditor(r); }
        interface Then { void run(Map<String, Object> row, Map<String, Object> design); }
        void fetchDesign(Then then) {
            Map<String, Object> r = sel(); if (r == null) return;
            Ui.async(() -> Json.obj(Api.I.ops("GET", "/website/sites/" + Json.str(r.get("id")), null)), full -> then.run(r, Json.obj(full.get("design"))), e -> Ui.warn(this, e));
        }
        public String htmlFor(Map<String, Object> r, Map<String, Object> d, boolean publish) {
            if (!publish) return SiteRender.render(d);
            String[] u = publicUrls(Json.str(r.get("slug"))); return SiteRender.render(d, u[0], u[1], "publish");
        }
        public void previewSel() { fetchDesign((r, d) -> preview(htmlFor(r, d, false), Json.str(r.get("slug")))); }
        public void saveHtml() {
            fetchDesign((r, d) -> {
                JFileChooser fc = new JFileChooser(); fc.setSelectedFile(new File(Json.str(r.get("slug")) + ".html"));
                if (fc.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) { try { Files.writeString(fc.getSelectedFile().toPath(), htmlFor(r, d, false), StandardCharsets.UTF_8); msg.setText(fc.getSelectedFile().getPath()); } catch (Exception e) { Ui.warn(this, e.getMessage()); } }
            });
        }
        public void publish() {
            fetchDesign((r, d) -> {
                String html = htmlFor(r, d, true); List<Object> prods = new ArrayList<>();
                for (Object pv : Json.arr(Json.obj(d.get("shop")).get("products"))) { Map<String, Object> p = Json.obj(pv), o = new LinkedHashMap<>(); o.put("sku", p.get("sku")); o.put("name", p.get("name")); o.put("price", p.get("price")); prods.add(o); }
                Map<String, Object> body = new LinkedHashMap<>(); body.put("html", html); body.put("products", prods); body.put("currency", Json.obj(d.get("shop")).get("currency"));
                Ui.async(() -> Api.I.ops("POST", "/website/sites/" + Json.str(r.get("id")) + "/publish", body), x -> { pending = t("web.isLive"); reload(); }, e -> Ui.warn(this, e));
            });
        }
        public void unpublish() { Map<String, Object> r = sel(); if (r != null) Ui.async(() -> Api.I.ops("POST", "/website/sites/" + Json.str(r.get("id")) + "/unpublish", new LinkedHashMap<String, Object>()), x -> reload(), e -> Ui.warn(this, e)); }
        public void delete() {
            Map<String, Object> r = sel(); if (r == null || !Ui.ask(this, t("web.deleteAsk", "n", Json.str(r.get("name"))), t("cal.delete"), t("cal.close"))) return;
            Ui.async(() -> Api.I.ops("DELETE", "/website/sites/" + Json.str(r.get("id")), null), x -> reload(), e -> Ui.warn(this, e));
        }
        public void status(String s) {
            Map<String, Object> r = sel(); if (r == null) return;
            Map<String, Object> body = new LinkedHashMap<>(); body.put("status", s);
            Ui.async(() -> Api.I.ops("PUT", "/website/submissions/" + Json.str(r.get("id")), body), x -> reload(), e -> Ui.warn(this, e));
        }
    }
}
