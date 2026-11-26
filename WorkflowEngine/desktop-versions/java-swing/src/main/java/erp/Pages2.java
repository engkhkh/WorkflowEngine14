package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.Dialog;
import java.awt.FlowLayout;
import java.awt.GridLayout;
import java.awt.Window;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTable;
import javax.swing.JTextField;
import javax.swing.JTree;
import javax.swing.event.TreeSelectionEvent;
import javax.swing.table.DefaultTableModel;
import javax.swing.tree.DefaultMutableTreeNode;
import javax.swing.tree.DefaultTreeModel;
import javax.swing.tree.TreePath;

/** The ERP browser, record editor and settings. */
final class Pages2 {
    private Pages2() { }

    /** Tree node payload: module and (optionally) kind from the catalog. */
    private record Node(Map<String, Object> module, Map<String, Object> kind) {
        @Override public String toString() { return I18n.name(kind != null ? kind : module); }
    }

    // ----------------------------------------------------------------- ERP
    static final class ErpPanel extends JPanel implements Reloadable {
        private final DefaultMutableTreeNode root = new DefaultMutableTreeNode();
        private final JTree tree = new JTree(new DefaultTreeModel(root));
        private final JLabel head = Ui.label(t("erp.title"), "title");
        private final JTextField search = new JTextField();
        private final javax.swing.JComboBox<String> status = new javax.swing.JComboBox<>();
        private final List<String> statusValues = new ArrayList<>();
        private final javax.swing.JComboBox<String> saved = new javax.swing.JComboBox<>();
        private List<Map<String, Object>> filters = new ArrayList<>();
        private boolean quiet;
        private final javax.swing.JButton delFilter = Ui.button("🗑", this::deleteFilter, "plain");
        private final Ui.DataTable table = new Ui.DataTable(t("erp.code"), t("erp.name"), t("erp.status"), t("erp.company"));
        private final JLabel msg = Ui.label("", "dim");
        private final javax.swing.JButton btnNew = Ui.button("+ " + t("erp.new"), this::create, null);
        private final javax.swing.JButton btnAct = Ui.button(t("erp.actions"), this::actMenu, "ghost");
        private Map<String, Object> module, kind;
        private List<Map<String, Object>> rows = new ArrayList<>();

        ErpPanel() {
            super(new BorderLayout());
            for (Map<String, Object> m : I18n.visibleModules()) {
                DefaultMutableTreeNode top = new DefaultMutableTreeNode(new Node(m, null));
                for (Object k : Json.arr(m.get("kinds"))) {
                    Map<String, Object> kk = Json.obj(k);
                    if (Api.I.can(Json.str(kk.get("view")))) top.add(new DefaultMutableTreeNode(new Node(m, kk)));
                }
                root.add(top);
            }
            tree.setRootVisible(false);
            ((DefaultTreeModel) tree.getModel()).reload();
            tree.addTreeSelectionListener(this::picked);
            JPanel right = new JPanel(new BorderLayout(0, 8));
            right.setBorder(BorderFactory.createEmptyBorder(0, 10, 0, 0));
            JPanel top = new JPanel(new BorderLayout(8, 0));
            status.addItem(t("collab.allStatus")); statusValues.add("");
            status.addActionListener(e -> { if (!quiet) refill(); });
            saved.addItem(t("collab.savedFilters"));
            saved.addActionListener(e -> { if (!quiet) applySaved(); });
            delFilter.setEnabled(false);
            JPanel mid = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0));
            mid.add(status); mid.add(saved); mid.add(Ui.button("🔖", this::saveFilter, "plain")); mid.add(delFilter);
            JPanel searchRow = new JPanel(new BorderLayout(8, 0));
            searchRow.add(search, BorderLayout.CENTER);
            searchRow.add(mid, BorderLayout.EAST);
            top.add(searchRow, BorderLayout.CENTER);
            top.add(Ui.row(btnNew, btnAct, Ui.button("🖨", this::printReport, "ghost"), Ui.button(t("common.refresh"), this::load, "ghost")), BorderLayout.EAST);
            JPanel north = new JPanel(new BorderLayout(0, 6));
            north.add(head, BorderLayout.NORTH);
            north.add(top, BorderLayout.CENTER);
            right.add(north, BorderLayout.NORTH);
            right.add(Ui.scroll(table), BorderLayout.CENTER);
            right.add(msg, BorderLayout.SOUTH);
            search.getDocument().addDocumentListener(new javax.swing.event.DocumentListener() {
                public void insertUpdate(javax.swing.event.DocumentEvent e) { refill(); }
                public void removeUpdate(javax.swing.event.DocumentEvent e) { refill(); }
                public void changedUpdate(javax.swing.event.DocumentEvent e) { refill(); }
            });
            table.onOpen(this::edit);
            btnNew.setEnabled(false);
            btnAct.setVisible(false);
            if (I18n.visibleModules().isEmpty()) msg.setText(t("erp.noModules"));
            JSplitPane split = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, Ui.scroll(tree), right);
            split.setDividerLocation(230);
            JPanel wrap = new JPanel(new BorderLayout());
            wrap.setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            wrap.add(split);
            add(wrap);
        }

        void select(String moduleId, String kindId) {
            for (int i = 0; i < root.getChildCount(); i++) {
                DefaultMutableTreeNode top = (DefaultMutableTreeNode) root.getChildAt(i);
                if (!Json.str(((Node) top.getUserObject()).module.get("id")).equals(moduleId)) continue;
                DefaultMutableTreeNode target = top.getChildCount() > 0 ? (DefaultMutableTreeNode) top.getChildAt(0) : top;
                for (int j = 0; j < top.getChildCount() && kindId != null; j++) {
                    DefaultMutableTreeNode c = (DefaultMutableTreeNode) top.getChildAt(j);
                    if (Json.str(((Node) c.getUserObject()).kind.get("kind")).equals(kindId)) { target = c; break; }
                }
                tree.setSelectionPath(new TreePath(target.getPath()));
                return;
            }
        }

        private void picked(TreeSelectionEvent e) {
            if (tree.getLastSelectedPathComponent() == null) return;
            DefaultMutableTreeNode n = (DefaultMutableTreeNode) tree.getLastSelectedPathComponent();
            Node node = (Node) n.getUserObject();
            if (node.kind == null) {
                tree.expandPath(new TreePath(n.getPath()));
                if (n.getChildCount() > 0) tree.setSelectionPath(new TreePath(((DefaultMutableTreeNode) n.getChildAt(0)).getPath()));
                return;
            }
            module = node.module; kind = node.kind;
            head.setText("<html>" + I18n.name(module) + " › " + I18n.name(kind) + "</html>");
            btnNew.setEnabled(Api.I.can(Json.str(kind.get("manage"))) && !Boolean.TRUE.equals(kind.get("readOnly")));
            btnAct.setVisible(!Json.arr(kind.get("actions")).isEmpty());
            quiet = true; search.setText(""); status.setSelectedIndex(0); quiet = false;
            loadFilters();
            load();
        }

        // ---- saved filters (same store as the portal: search text + status, optionally shared with the workspace)
        private String viewKey() { return Json.str(module.get("id")) + ":" + Json.str(kind.get("kind")); }

        private void loadFilters() {
            Map<String, Object> m = module, k = kind;
            Ui.async(() -> Api.I.filters(viewKey()), list -> {
                if (m != module || k != kind) return;
                filters = list;
                quiet = true;
                saved.removeAllItems();
                saved.addItem(t("collab.savedFilters"));
                for (Map<String, Object> c : list) saved.addItem((Boolean.TRUE.equals(c.get("shared")) && !Boolean.TRUE.equals(c.get("mine")) ? "👥 " : "") + Json.str(c.get("name")));
                quiet = false;
                delFilter.setEnabled(false);
            }, e -> { });
        }

        private void applySaved() {
            int i = saved.getSelectedIndex();
            Map<String, Object> c = i > 0 && i <= filters.size() ? filters.get(i - 1) : null;
            Map<String, Object> d = c == null ? new LinkedHashMap<>() : Json.obj(c.get("data"));
            quiet = true;
            search.setText(Json.str(d.get("q")));
            int si = statusValues.indexOf(Json.str(d.get("status")));
            status.setSelectedIndex(Math.max(0, si));
            quiet = false;
            delFilter.setEnabled(c != null && Boolean.TRUE.equals(c.get("mine")));
            refill();
        }

        private void saveFilter() {
            if (kind == null) return;
            JTextField nm = new JTextField(20);
            javax.swing.JCheckBox share = new javax.swing.JCheckBox(t("collab.shareWorkspace"));
            JPanel p = new JPanel(new GridLayout(0, 1, 0, 6));
            p.add(new JLabel(t("collab.filterName"))); p.add(nm); p.add(share);
            if (javax.swing.JOptionPane.showConfirmDialog(this, p, t("collab.saveFilter"), javax.swing.JOptionPane.OK_CANCEL_OPTION) != javax.swing.JOptionPane.OK_OPTION || nm.getText().isBlank()) return;
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("q", search.getText().trim());
            data.put("status", statusValues.get(Math.max(0, status.getSelectedIndex())));
            String name = nm.getText().trim();
            boolean sh = share.isSelected();
            Ui.async(() -> { Api.I.saveFilter(viewKey(), name, sh, data); return Boolean.TRUE; }, r -> loadFilters(), e -> msg.setText(e));
        }

        private void deleteFilter() {
            int i = saved.getSelectedIndex();
            if (i <= 0 || i > filters.size()) return;
            String id = Json.str(filters.get(i - 1).get("id"));
            Ui.async(() -> { Api.I.deleteFilter(id); return Boolean.TRUE; }, r -> loadFilters(), e -> msg.setText(e));
        }

        private void load() {
            if (kind == null) return;
            Map<String, Object> m = module, k = kind;
            msg.setText(t("common.loading"));
            Ui.async(() -> Api.I.records(Json.str(m.get("id")), Json.str(k.get("kind"))), list -> {
                if (m != module || k != kind) return;
                rows = list;
                refill();
            }, err -> msg.setText(err));
        }

        private void refill() {
            String s = search.getText().trim().toLowerCase();
            // the status list follows the loaded rows
            java.util.TreeSet<String> have = new java.util.TreeSet<>();
            for (Map<String, Object> r : rows) if (!Json.str(r.get("status")).isEmpty()) have.add(Json.str(r.get("status")));
            List<String> want = new ArrayList<>(); want.add(""); want.addAll(have);
            String cur = statusValues.get(Math.max(0, Math.min(status.getSelectedIndex(), statusValues.size() - 1)));
            if (!want.equals(statusValues)) {
                quiet = true;
                statusValues.clear(); statusValues.addAll(want);
                status.removeAllItems();
                for (String v : want) status.addItem(v.isEmpty() ? t("collab.allStatus") : v);
                status.setSelectedIndex(Math.max(0, want.indexOf(cur)));
                quiet = false;
            }
            String stf = statusValues.get(Math.max(0, status.getSelectedIndex()));
            List<Map<String, Object>> shown = new ArrayList<>();
            List<String[]> out = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                if (!stf.isEmpty() && !stf.equals(Json.str(r.get("status")))) continue;
                String hay = (Json.str(r.get("code")) + " " + Json.str(r.get("status")) + " " + Json.str(r.get("ref")) + " " + Json.write(r.get("data"))).toLowerCase();
                if (!s.isEmpty() && !hay.contains(s)) continue;
                Map<String, Object> d = Json.obj(r.get("data"));
                String nm = !Json.str(d.get("name")).isEmpty() ? Json.str(d.get("name")) : !Json.str(d.get("title")).isEmpty() ? Json.str(d.get("title"))
                        : !Json.str(d.get("description")).isEmpty() ? Json.str(d.get("description")) : Json.str(r.get("ref"));
                shown.add(r);
                out.add(new String[]{Json.str(r.get("code")), nm, Json.str(r.get("status")), Json.str(r.get("company"))});
            }
            table.fill(out, shown);
            shownRows = out;
            msg.setText(out.isEmpty() ? t("erp.none") : "");
        }

        private List<String[]> shownRows = new ArrayList<>();

        private void printReport() {
            if (kind == null) return;
            String[] keys = {"code", "name", "status", "company"}, labs = {"erp.code", "erp.name", "erp.status", "erp.company"};
            List<Report.Column> cols = new ArrayList<>();
            for (int i = 0; i < keys.length; i++) cols.add(new Report.Column(keys[i], t(labs[i]), false));
            List<Map<String, String>> rws = new ArrayList<>();
            for (String[] r : shownRows) { Map<String, String> row = new java.util.LinkedHashMap<>(); for (int i = 0; i < keys.length; i++) row.put(keys[i], r[i]); rws.add(row); }
            new Report.Dialog(this, viewKey(), I18n.name(kind), cols, rws, Api.I.displayName).setVisible(true);
        }

        private void create() { if (kind != null && new RecordDialog(this, module, kind, null).showAndResult()) load(); }

        @SuppressWarnings("unchecked")
        private void edit() {
            Map<String, Object> r = (Map<String, Object>) table.selected();
            if (r != null && new RecordDialog(this, module, kind, r).showAndResult()) load();
        }


        // ---- workflow actions of the newer modules (sales orders, helpdesk, subscriptions, expenses, quality, fleet)
        @SuppressWarnings("unchecked")
        private void actMenu() {
            Map<String, Object> r = (Map<String, Object>) table.selected();
            if (r == null || kind == null) return;
            String st = Json.str(r.get("status"));
            javax.swing.JPopupMenu menu = new javax.swing.JPopupMenu();
            for (Object o : Json.arr(kind.get("actions"))) {
                Map<String, Object> a = Json.obj(o);
                if (!Json.arr(a.get("when")).contains(st) || !Api.I.can(Json.str(a.get("priv")))) continue;
                javax.swing.JMenuItem mi = new javax.swing.JMenuItem(I18n.name(a));
                mi.addActionListener(e -> runAct(r, a));
                menu.add(mi);
            }
            if (menu.getComponentCount() == 0) { Ui.warn(this, t("erp.noActions")); return; }
            menu.show(btnAct, 0, btnAct.getHeight());
        }

        private void runAct(Map<String, Object> r, Map<String, Object> a) {
            Map<String, Object> body = new LinkedHashMap<>();
            List<Object> fields = Json.arr(a.get("ask"));
            if (!fields.isEmpty()) {
                JPanel form = new JPanel(new GridLayout(0, 2, 6, 6));
                Map<String, JTextField> edits = new LinkedHashMap<>();
                for (Object f : fields) {
                    String k = Json.str(f);
                    String title = k.equals("note") ? Json.str(a.get(I18n.rtl() ? "noteAr" : "noteEn")) : "";
                    if (title.isEmpty()) title = t(k.equals("note") ? "erp.note" : k.equals("user") ? "erp.actUser" : k.equals("method") ? "erp.actMethod" : k.equals("amount") ? "erp.actHours" : "erp.actCost");
                    JTextField tf = new JTextField(k.equals("method") ? "Transfer" : (k.equals("amount") || k.equals("cost")) ? "0" : "");
                    edits.put(k, tf);
                    form.add(new JLabel(title)); form.add(tf);
                }
                if (javax.swing.JOptionPane.showConfirmDialog(this, form, I18n.name(a), javax.swing.JOptionPane.OK_CANCEL_OPTION) != javax.swing.JOptionPane.OK_OPTION) return;
                for (Map.Entry<String, JTextField> en : edits.entrySet()) {
                    String v = en.getValue().getText().trim();
                    if (en.getKey().equals("amount") || en.getKey().equals("cost")) { try { body.put(en.getKey(), Double.parseDouble(v.isEmpty() ? "0" : v)); } catch (NumberFormatException ex) { body.put(en.getKey(), 0.0); } }
                    else if (!v.isEmpty()) body.put(en.getKey(), v);
                }
            } else if (Boolean.TRUE.equals(a.get("danger")) && !Ui.ask(this, I18n.name(a) + "?", t("common.yes"), t("common.no"))) return;
            String m = Json.str(module.get("id")), k = Json.str(kind.get("kind")), id = Json.str(r.get("id")), op = Json.str(a.get("op"));
            Ui.async(() -> { Api.I.bizAction(m, k, id, op, body); return Boolean.TRUE; }, ok -> load(), err -> Ui.warn(this, err));
        }

        @Override public void reload() { if (kind != null) load(); }
    }

    // ----------------------------------------------------------------- record editor
    static final class RecordDialog extends JDialog {
        private final Map<String, Object> module, kind, rec;
        private final boolean editable;
        private final JTextField code, status, company, ref, newKey = new JTextField(12);
        private final DefaultTableModel model;
        private final JTable table;
        private final Map<String, String> types = new LinkedHashMap<>();
        private Map<String, Object> data;
        private final JLabel err = Ui.label("", "error");
        private boolean changed;

        RecordDialog(java.awt.Component parent, Map<String, Object> module, Map<String, Object> kind, Map<String, Object> rec) {
            super((Window) javax.swing.SwingUtilities.getWindowAncestor(parent), rec == null ? t("erp.new") : Json.str(rec.get("code")), Dialog.ModalityType.APPLICATION_MODAL);
            this.module = module; this.kind = kind; this.rec = rec;
            editable = Api.I.can(Json.str(kind.get("manage"))) && !Boolean.TRUE.equals(kind.get("readOnly"));
            data = rec == null ? new LinkedHashMap<>(Json.obj(kind.get("template"))) : new LinkedHashMap<>(Json.obj(rec.get("data")));
            code = new JTextField(rec == null ? "" : Json.str(rec.get("code")));
            code.setEnabled(editable && rec == null);
            status = new JTextField(rec == null ? "" : Json.str(rec.get("status"))); status.setEnabled(editable);
            company = new JTextField(rec == null ? "" : Json.str(rec.get("company"))); company.setEnabled(editable);
            ref = new JTextField(rec == null ? "" : Json.str(rec.get("ref"))); ref.setEnabled(editable);

            JPanel form = new JPanel(new GridLayout(0, 2, 8, 6));
            form.add(new JLabel(t("erp.code"))); form.add(code);
            form.add(new JLabel(t("erp.status"))); form.add(status);
            form.add(new JLabel(t("erp.company"))); form.add(company);
            form.add(new JLabel(t("erp.ref"))); form.add(ref);

            model = new DefaultTableModel(new String[]{t("erp.fieldName"), t("erp.fieldValue")}, 0) {
                @Override public boolean isCellEditable(int r, int c) {
                    return c == 1 && editable && !"raw".equals(types.get(String.valueOf(getValueAt(r, 0))));
                }
            };
            table = new JTable(model);
            table.setRowHeight(26);
            fill();

            JPanel top = new JPanel();
            top.setLayout(new BoxLayout(top, BoxLayout.Y_AXIS));
            if (!editable) top.add(Ui.label(t("erp.readOnly"), "dim"));
            top.add(form);
            top.add(Box.createVerticalStrut(8));
            top.add(Ui.label(t("erp.data"), "title"));

            JPanel addRow = new JPanel(new BorderLayout());
            if (editable) addRow.add(Ui.row(newKey, Ui.button(t("erp.addField"), this::addField, "ghost"), Ui.button(t("erp.removeField"), this::removeField, "ghost")));
            JPanel bottom = new JPanel();
            bottom.setLayout(new BoxLayout(bottom, BoxLayout.Y_AXIS));
            bottom.add(err);
            JPanel btns = new JPanel(new FlowLayout(FlowLayout.LEADING));
            if (editable) {
                btns.add(Ui.button(t("erp.save"), this::save, null));
                if (rec != null) btns.add(Ui.button(t("erp.delete"), this::delete, "danger"));
            }
            btns.add(Ui.button(t("common.close"), this::dispose, "ghost"));
            bottom.add(btns);

            JPanel dataTab = new JPanel(new BorderLayout(0, 8));
            dataTab.add(top, BorderLayout.NORTH);
            dataTab.add(new JScrollPane(table), BorderLayout.CENTER);
            dataTab.add(addRow, BorderLayout.SOUTH);
            javax.swing.JTabbedPane tabs = new javax.swing.JTabbedPane();
            tabs.addTab(t("collab.tab.data"), dataTab);
            if (rec != null && rec.get("id") != null) tabs.addTab(t("collab.notes") + " / " + t("collab.files"), new Forms.Chatter(Json.str(module.get("id")), Json.str(kind.get("kind")), Json.str(rec.get("id"))));
            else top.add(Ui.label(t("collab.save.first"), "dim"), 0);
            JPanel body = new JPanel(new BorderLayout(0, 8));
            body.setBorder(BorderFactory.createEmptyBorder(14, 16, 14, 16));
            body.add(tabs, BorderLayout.CENTER);
            body.add(bottom, BorderLayout.SOUTH);
            setContentPane(body);
            setSize(560, 600);
            setLocationRelativeTo(parent);
        }

        private static boolean simple(Object v) { return v == null || v instanceof String || v instanceof Number || v instanceof Boolean; }

        private void fill() {
            model.setRowCount(0);
            types.clear();
            for (Map.Entry<String, Object> e : data.entrySet()) {
                Object v = e.getValue();
                if (simple(v)) {
                    types.put(e.getKey(), v instanceof Boolean ? "bool" : v instanceof Number ? "num" : "str");
                    model.addRow(new Object[]{e.getKey(), v == null ? "" : String.valueOf(v instanceof Number ? Json.write(v) : v)});
                } else {
                    types.put(e.getKey(), "raw");
                    String s = Json.write(v);
                    model.addRow(new Object[]{e.getKey(), s.length() > 160 ? s.substring(0, 160) + "…" : s});
                }
            }
        }

        private Map<String, Object> collect() {
            if (table.isEditing()) table.getCellEditor().stopCellEditing();
            Map<String, Object> out = new LinkedHashMap<>(data);
            for (int i = 0; i < model.getRowCount(); i++) {
                String k = String.valueOf(model.getValueAt(i, 0));
                String txt = String.valueOf(model.getValueAt(i, 1));
                switch (types.getOrDefault(k, "str")) {
                    case "raw": break;
                    case "num":
                        try { out.put(k, Pattern.matches("-?\\d+", txt.trim()) ? (Object) Long.parseLong(txt.trim()) : (Object) Double.parseDouble(txt.trim())); }
                        catch (NumberFormatException e) { out.put(k, txt); }
                        break;
                    case "bool": out.put(k, List.of("true", "1", "yes").contains(txt.trim().toLowerCase())); break;
                    default: out.put(k, txt);
                }
            }
            return out;
        }

        private void addField() {
            String k = newKey.getText().trim();
            if (!Pattern.matches("[A-Za-z]\\w*", k) || data.containsKey(k)) return;
            data = collect();
            data.put(k, "");
            newKey.setText("");
            fill();
        }

        private void removeField() {
            int r = table.getSelectedRow();
            if (r < 0) return;
            String k = String.valueOf(model.getValueAt(r, 0));
            data = collect();
            data.remove(k);
            fill();
        }

        private static Object nz(JTextField f) { String s = f.getText().trim(); return s.isEmpty() ? null : s; }

        private void save() {
            err.setText("");
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("code", nz(code)); body.put("status", nz(status)); body.put("company", nz(company)); body.put("ref", nz(ref)); body.put("data", collect());
            String m = Json.str(module.get("id")), k = Json.str(kind.get("kind"));
            Ui.async(() -> {
                if (rec == null) Api.I.createRecord(m, k, body); else Api.I.updateRecord(m, k, Json.str(rec.get("id")), body);
                return Boolean.TRUE;
            }, r -> { changed = true; dispose(); }, e -> err.setText("<html>" + e + "</html>"));
        }

        private void delete() {
            if (!Ui.ask(this, t("erp.confirmDelete"), t("erp.delete"), t("common.cancel"))) return;
            Ui.async(() -> { Api.I.deleteRecord(Json.str(module.get("id")), Json.str(kind.get("kind")), Json.str(rec.get("id"))); return Boolean.TRUE; },
                    r -> { changed = true; dispose(); }, e -> err.setText("<html>" + e + "</html>"));
        }

        boolean showAndResult() { setVisible(true); return changed; }
    }

    // ----------------------------------------------------------------- settings
    static final class SettingsPanel extends JPanel implements Reloadable {
        SettingsPanel(java.util.function.Consumer<String> setLang, Runnable signOut) {
            super(new BorderLayout());
            JPanel body = new JPanel();
            body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
            Api a = Api.I;
            body.add(Ui.label(t("more.signedInAs"), "dim"));
            body.add(Ui.label(a.displayName + "  (" + a.username + " · " + a.role + ")", "title"));
            if (!a.tenant.isEmpty()) body.add(Ui.label(t("more.workspace") + ": " + a.tenant, null));
            body.add(Ui.label(t("more.server") + ": " + a.server, "dim"));
            body.add(Box.createVerticalStrut(14));
            body.add(Ui.label(t("more.language"), "dim"));
            body.add(Ui.row(Ui.button("English", () -> setLang.accept("en"), "en".equals(I18n.lang) ? null : "ghost"),
                    Ui.button("العربية", () -> setLang.accept("ar"), "ar".equals(I18n.lang) ? null : "ghost")));
            body.add(Box.createVerticalStrut(14));
            body.add(Ui.row(Ui.button(t("more.signout"), signOut, "danger")));
            JPanel wrap = new JPanel(new BorderLayout());
            wrap.setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            wrap.add(body, BorderLayout.NORTH);
            add(wrap);
        }

        @Override public void reload() { }
    }
}
