package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.DefaultComboBoxModel;
import javax.swing.DefaultListModel;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JDialog;
import javax.swing.JEditorPane;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.ListCellRenderer;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

/** Report designer: choose columns, title, header / footer, orientation, grouping and totals for the rows of a list, preview it and print it.
 *  Layouts can be saved per list (and shared with the workspace) through the same endpoint as the portal. */
public final class Report {
    private Report() { }

    public static final class Column { public final String key, label; public final boolean numeric; public Column(String k, String l, boolean n) { key = k; label = l; numeric = n; } }
    public static final class Layout {
        public String title = "", subtitle = "", header = "", footer = "", orientation = "portrait", groupBy = "";
        public List<String> columns = new ArrayList<>(), order = new ArrayList<>();
        public boolean totals = true, showDate = true, showUser = true, rowNumbers = false;
    }

    static String esc(String s) { return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;"); }
    static String pre(String s) { return esc(s).replace("\n", "<br>"); }
    static String nf(double n) { return new DecimalFormat("#,##0.##", DecimalFormatSymbols.getInstance(Locale.ENGLISH)).format(n); }
    static double raw(Map<String, String> r, String k) {
        String v = r.containsKey(k + "#") ? r.get(k + "#") : r.get(k);
        try { return v == null ? 0 : Double.parseDouble(v.replace(",", "")); } catch (NumberFormatException e) { return 0; }
    }

    /** The printable document (escaped values only). rows hold the shown text per column key; "key#" holds the raw number used for totals. */
    public static String html(Layout L, List<Column> columns, List<Map<String, String>> rows, String user) {
        List<Column> cols = new ArrayList<>();
        for (String k : L.order) if (L.columns.contains(k)) for (Column c : columns) if (c.key.equals(k)) cols.add(c);
        int ncol = cols.size() + (L.rowNumbers ? 1 : 0);
        StringBuilder head = new StringBuilder("<tr>");
        if (L.rowNumbers) head.append("<th bgcolor=\"#f1f3f5\">#</th>");
        for (Column c : cols) head.append("<th align=\"").append(c.numeric ? "right" : "left").append("\" bgcolor=\"#f1f3f5\">").append(esc(c.label)).append("</th>");
        head.append("</tr>");
        int[] idx = {0};
        java.util.function.Function<Map<String, String>, String> row = r -> {
            StringBuilder s = new StringBuilder("<tr>");
            if (L.rowNumbers) s.append("<td align=\"right\">").append(++idx[0]).append("</td>");
            for (Column c : cols) s.append("<td align=\"").append(c.numeric ? "right" : "left").append("\">").append(esc(r.get(c.key))).append("</td>");
            return s.append("</tr>").toString();
        };
        java.util.function.BiFunction<List<Map<String, String>>, String, String> total = (rs, label) -> {
            boolean any = false; for (Column c : cols) any |= c.numeric;
            if (!L.totals || !any) return "";
            StringBuilder s = new StringBuilder("<tr bgcolor=\"#fafafa\">");
            if (L.rowNumbers) s.append("<td></td>");
            for (int i = 0; i < cols.size(); i++) {
                if (cols.get(i).numeric) { double sum = 0; for (Map<String, String> r : rs) sum += raw(r, cols.get(i).key); s.append("<td align=\"right\"><b>").append(nf(sum)).append("</b></td>"); }
                else s.append("<td><b>").append(i == 0 ? esc(label) : "").append("</b></td>");
            }
            return s.append("</tr>").toString();
        };
        StringBuilder body = new StringBuilder();
        if (!L.groupBy.isEmpty() && !cols.isEmpty()) {
            Map<String, List<Map<String, String>>> groups = new LinkedHashMap<>();
            for (Map<String, String> r : rows) { String g = r.getOrDefault(L.groupBy, ""); if (g.isEmpty()) g = "—"; groups.computeIfAbsent(g, q -> new ArrayList<>()).add(r); }
            String glabel = ""; for (Column c : columns) if (c.key.equals(L.groupBy)) glabel = c.label;
            for (Map.Entry<String, List<Map<String, String>>> e : groups.entrySet()) {
                body.append("<tr bgcolor=\"#e8ecf1\"><td colspan=\"").append(ncol).append("\"><b>").append(esc(glabel)).append(": ").append(esc(e.getKey())).append(" (").append(e.getValue().size()).append(")</b></td></tr>");
                for (Map<String, String> r : e.getValue()) body.append(row.apply(r));
                body.append(total.apply(e.getValue(), t("collab.rep.subtotal")));
            }
            body.append(total.apply(rows, t("collab.rep.total")));
        } else {
            for (Map<String, String> r : rows) body.append(row.apply(r));
            body.append(total.apply(rows, t("collab.rep.total")));
        }
        List<String> meta = new ArrayList<>();
        if (L.showDate) meta.add(LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")));
        if (L.showUser && user != null && !user.isEmpty()) meta.add(user);
        meta.add(rows.size() + " " + t("collab.rep.rows"));
        return "<html><body style=\"font-family:Segoe UI,Tahoma,Arial; font-size:11pt; color:#111;\"><h2 style=\"margin:0\">" + esc(L.title) + "</h2>"
            + (L.subtitle.isEmpty() ? "" : "<p style=\"color:#555; margin:2px 0\">" + esc(L.subtitle) + "</p>")
            + (L.header.isEmpty() ? "" : "<p>" + pre(L.header) + "</p>")
            + "<p style=\"color:#666; font-size:9pt\">" + esc(String.join(" · ", meta)) + "</p><hr><table width=\"100%\" cellspacing=\"0\" cellpadding=\"4\">" + head + body + "</table>"
            + (L.footer.isEmpty() ? "" : "<hr><p style=\"color:#444\">" + pre(L.footer) + "</p>") + "</body></html>";
    }

    private static final class Entry { final Column col; boolean on = true; Entry(Column c) { col = c; } @Override public String toString() { return col.label; } }

    public static final class Dialog extends JDialog {
        private final String view, user;
        private final List<Column> cols;
        private final List<Map<String, String>> rows;
        private final JTextField eTitle = new JTextField(), eSub = new JTextField(), eName = new JTextField();
        private final JTextArea eHead = new JTextArea(2, 14), eFoot = new JTextArea(2, 14);
        private final JComboBox<String> orient = new JComboBox<>(new String[]{t("collab.rep.portrait"), t("collab.rep.landscape")});
        private final JComboBox<String> group = new JComboBox<>();
        private final JCheckBox kTot = new JCheckBox(t("collab.rep.totals"), true), kNum = new JCheckBox(t("collab.rep.rowNumbers")), kDate = new JCheckBox(t("collab.rep.showDate"), true),
            kUser = new JCheckBox(t("collab.rep.showUser"), true), kShare = new JCheckBox(t("collab.shareWorkspace"));
        private final DefaultListModel<Entry> model = new DefaultListModel<>();
        private final JList<Entry> lst = new JList<>(model);
        private final JEditorPane prev = new JEditorPane("text/html", "");
        private final JComboBox<Object> sel = new JComboBox<>();
        private final JLabel err = Ui.label("", "error");
        private final javax.swing.JButton bDel = Ui.button("🗑", this::deleteLayout, "plain");
        private List<Map<String, Object>> saved = new ArrayList<>();
        private boolean quiet;

        public Dialog(java.awt.Component parent, String view, String title, List<Column> cols, List<Map<String, String>> rows, String user) {
            super(javax.swing.SwingUtilities.getWindowAncestor(parent), t("collab.reportDesigner"), ModalityType.APPLICATION_MODAL);
            this.view = view; this.cols = cols; this.rows = rows; this.user = user;
            setSize(1100, 700); setLocationRelativeTo(parent);
            JPanel side = new JPanel(); side.setLayout(new BoxLayout(side, BoxLayout.Y_AXIS)); side.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
            side.setPreferredSize(new Dimension(320, 0));
            JPanel top = new JPanel(new BorderLayout(4, 0)); top.add(sel); top.add(bDel, BorderLayout.EAST);
            side.add(top);
            eTitle.setText(title); eHead.setLineWrap(true); eFoot.setLineWrap(true);
            group.addItem("—"); for (Column c : cols) group.addItem(c.label);
            if (cols.size() > 6) orient.setSelectedIndex(1);
            for (Object[] p : new Object[][]{{t("collab.rep.title"), eTitle}, {t("collab.rep.subtitle"), eSub}, {t("collab.rep.header"), new JScrollPane(eHead)}, {t("collab.rep.footer"), new JScrollPane(eFoot)},
                                              {t("collab.rep.orientation"), orient}, {t("collab.rep.groupBy"), group}}) {
                side.add(new JLabel((String) p[0])); side.add((java.awt.Component) p[1]);
            }
            for (JCheckBox k : new JCheckBox[]{kTot, kNum, kDate, kUser}) { side.add(k); k.addActionListener(e -> refresh()); }
            side.add(new JLabel(t("collab.rep.columns")));
            for (Column c : cols) model.addElement(new Entry(c));
            lst.setCellRenderer((ListCellRenderer<Entry>) (l, v, i, s, f) -> { JCheckBox cb = new JCheckBox(v.col.label, v.on); cb.setOpaque(true); cb.setBackground(s ? l.getSelectionBackground() : l.getBackground()); return cb; });
            lst.addMouseListener(new java.awt.event.MouseAdapter() {
                @Override public void mouseClicked(java.awt.event.MouseEvent e) {
                    int i = lst.locationToIndex(e.getPoint());
                    if (i >= 0 && e.getX() < 28) { model.get(i).on = !model.get(i).on; lst.repaint(); refresh(); }
                }
            });
            JScrollPane lp = new JScrollPane(lst); lp.setPreferredSize(new Dimension(280, 150)); side.add(lp);
            JPanel mv = new JPanel(new FlowLayout(FlowLayout.LEADING, 4, 2)); mv.add(Ui.button("▲", () -> move(-1), "plain")); mv.add(Ui.button("▼", () -> move(1), "plain")); side.add(mv);
            eName.putClientProperty("JTextField.placeholderText", t("collab.rep.layoutName"));
            side.add(new JLabel(t("collab.rep.layoutName"))); side.add(eName); side.add(kShare); side.add(Ui.button(t("collab.rep.saveLayout"), this::saveLayout, null)); side.add(err);
            for (java.awt.Component c : side.getComponents()) if (c instanceof javax.swing.JComponent) ((javax.swing.JComponent) c).setAlignmentX(0f);
            sel.addItem(t("collab.savedReports"));
            prev.setEditable(false); prev.setBackground(java.awt.Color.WHITE);
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.TRAILING));
            bar.add(Ui.button(t("common.cancel"), this::dispose, "plain")); bar.add(Ui.button("HTML", this::saveHtml, "plain")); bar.add(Ui.button("🖨 " + t("collab.rep.print"), this::printIt, null));
            JPanel right = new JPanel(new BorderLayout()); right.add(new JScrollPane(prev)); right.add(bar, BorderLayout.SOUTH);
            getContentPane().setLayout(new BorderLayout()); getContentPane().add(new JScrollPane(side, JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED, JScrollPane.HORIZONTAL_SCROLLBAR_NEVER), BorderLayout.WEST); getContentPane().add(right);
            DocumentListener dl = new DocumentListener() { public void insertUpdate(DocumentEvent e) { refresh(); } public void removeUpdate(DocumentEvent e) { refresh(); } public void changedUpdate(DocumentEvent e) { refresh(); } };
            eTitle.getDocument().addDocumentListener(dl); eSub.getDocument().addDocumentListener(dl); eHead.getDocument().addDocumentListener(dl); eFoot.getDocument().addDocumentListener(dl);
            orient.addActionListener(e -> refresh()); group.addActionListener(e -> refresh());
            sel.addActionListener(e -> { if (quiet) return; Object o = sel.getSelectedItem(); bDel.setEnabled(o instanceof Map && Boolean.TRUE.equals(((Map<?, ?>) o).get("mine"))); if (o instanceof Map) apply(Json.obj(((Map<?, ?>) o).get("data"))); });
            sel.setRenderer((l, v, i, s, f) -> { JLabel lb = new JLabel(v instanceof Map ? (Boolean.TRUE.equals(((Map<?, ?>) v).get("shared")) && !Boolean.TRUE.equals(((Map<?, ?>) v).get("mine")) ? "👥 " : "") + Json.str(((Map<?, ?>) v).get("name")) : v == null ? "" : String.valueOf(v)); lb.setOpaque(true); lb.setBackground(s ? l.getSelectionBackground() : l.getBackground()); return lb; });
            bDel.setEnabled(false);
            refresh(); loadSaved();
        }

        public Layout current() {
            Layout L = new Layout();
            for (int i = 0; i < model.size(); i++) { L.order.add(model.get(i).col.key); if (model.get(i).on) L.columns.add(model.get(i).col.key); }
            L.title = eTitle.getText(); L.subtitle = eSub.getText(); L.header = eHead.getText(); L.footer = eFoot.getText();
            L.orientation = orient.getSelectedIndex() == 1 ? "landscape" : "portrait";
            L.groupBy = group.getSelectedIndex() > 0 ? cols.get(group.getSelectedIndex() - 1).key : "";
            L.totals = kTot.isSelected(); L.showDate = kDate.isSelected(); L.showUser = kUser.isSelected(); L.rowNumbers = kNum.isSelected();
            return L;
        }
        public String html() { return Report.html(current(), cols, rows, user); }
        public void setGroupIndex(int i) { group.setSelectedIndex(i); }
        public String previewText() { return prev.getText(); }

        private void refresh() { if (!quiet) { prev.setText(html()); prev.setCaretPosition(0); } }

        public void apply(Map<String, Object> d) {
            quiet = true;
            List<String> on = new ArrayList<>();
            for (Object o : Json.arr(d.get("columns"))) for (Column c : cols) if (c.key.equals(Json.str(o))) on.add(c.key);
            if (on.isEmpty()) for (Column c : cols) on.add(c.key);
            List<String> order = new ArrayList<>(on); for (Column c : cols) if (!order.contains(c.key)) order.add(c.key);
            model.clear();
            for (String k : order) for (Column c : cols) if (c.key.equals(k)) { Entry e = new Entry(c); e.on = on.contains(k); model.addElement(e); }
            eTitle.setText(Json.str(d.get("title"))); eSub.setText(Json.str(d.get("subtitle"))); eHead.setText(Json.str(d.get("header"))); eFoot.setText(Json.str(d.get("footer")));
            orient.setSelectedIndex("landscape".equals(Json.str(d.get("orientation"))) ? 1 : 0);
            int gi = 0; for (int i = 0; i < cols.size(); i++) if (cols.get(i).key.equals(Json.str(d.get("groupBy")))) gi = i + 1; group.setSelectedIndex(gi);
            kTot.setSelected(!Boolean.FALSE.equals(d.get("totals"))); kDate.setSelected(!Boolean.FALSE.equals(d.get("showDate"))); kUser.setSelected(!Boolean.FALSE.equals(d.get("showUser"))); kNum.setSelected(Boolean.TRUE.equals(d.get("rowNumbers")));
            quiet = false; refresh();
        }

        private void move(int d) {
            int r = lst.getSelectedIndex(), j = r + d;
            if (r < 0 || j < 0 || j >= model.size()) return;
            Entry e = model.remove(r); model.add(j, e); lst.setSelectedIndex(j); refresh();
        }

        private void loadSaved() {
            Ui.async(() -> Api.I.configs("report", view), l -> {
                saved = l; quiet = true;
                DefaultComboBoxModel<Object> m = new DefaultComboBoxModel<>(); m.addElement(t("collab.savedReports")); for (Map<String, Object> c : l) m.addElement(c);
                sel.setModel(m); quiet = false;
            }, e -> { });
        }

        private void saveLayout() {
            String n = eName.getText().trim(); if (n.isEmpty()) return;
            Layout L = current();
            Map<String, Object> data = new LinkedHashMap<>();
            List<Object> on = new ArrayList<>(); for (String k : L.order) if (L.columns.contains(k)) on.add(k);
            data.put("title", L.title); data.put("subtitle", L.subtitle); data.put("header", L.header); data.put("footer", L.footer); data.put("orientation", L.orientation); data.put("columns", on);
            data.put("groupBy", L.groupBy); data.put("totals", L.totals); data.put("showDate", L.showDate); data.put("showUser", L.showUser); data.put("rowNumbers", L.rowNumbers);
            err.setText("");
            Ui.async(() -> { Api.I.saveConfig("report", view, n, kShare.isSelected(), data); return null; }, r -> { eName.setText(""); loadSaved(); }, e -> err.setText(e));
        }

        private void deleteLayout() {
            Object o = sel.getSelectedItem();
            if (!(o instanceof Map) || !Boolean.TRUE.equals(((Map<?, ?>) o).get("mine"))) return;
            String id = Json.str(((Map<?, ?>) o).get("id"));
            Ui.async(() -> { Api.I.deleteConfig("report", id); return null; }, r -> loadSaved(), e -> err.setText(e));
        }

        private void saveHtml() {
            JFileChooser fc = new JFileChooser(); fc.setSelectedFile(new java.io.File((current().title.isEmpty() ? "report" : current().title) + ".html"));
            if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
            try { Files.writeString(Path.of(fc.getSelectedFile().getPath()), html(), StandardCharsets.UTF_8); } catch (IOException e) { Ui.warn(this, e.getMessage()); }
        }

        /** Opens the system print dialog (choose "Microsoft Print to PDF" / "Save as PDF" there to get a PDF). */
        private void printIt() {
            try { prev.print(null, null, true, null, null, true); } catch (Exception e) { Ui.warn(this, String.valueOf(e.getMessage())); }
        }
    }
}
