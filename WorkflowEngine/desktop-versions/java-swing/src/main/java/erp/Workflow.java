package erp;

import static erp.I18n.t;

import java.awt.BasicStroke;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.GridLayout;
import java.awt.Point;
import java.awt.RenderingHints;
import java.awt.geom.CubicCurve2D;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.Point2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSpinner;
import javax.swing.JSplitPane;
import javax.swing.JTabbedPane;
import javax.swing.JTable;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.JToggleButton;
import javax.swing.SpinnerNumberModel;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.table.DefaultTableModel;

/** Workflow designer, flows list and instance monitor. Driven by workflow.json, the spec shared by every desktop client. */
public final class Workflow {
    private Workflow() { }

    @SuppressWarnings("unchecked")
    static final Map<String, Object> SPEC;
    static final Map<String, Map<String, Object>> TYPES = new LinkedHashMap<>();
    static final List<Map<String, Object>> NODES;
    static {
        try (InputStream in = Workflow.class.getResourceAsStream("/workflow.json")) {
            SPEC = Json.obj(Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8)));
        } catch (IOException e) { throw new IllegalStateException(e); }
        NODES = new ArrayList<>();
        for (Object o : Json.arr(SPEC.get("nodes"))) { Map<String, Object> m = Json.obj(o); NODES.add(m); TYPES.put(Json.str(m.get("type")), m); }
    }

    static String s(Object o) { return Json.str(o); }
    static String newId() { return UUID.randomUUID().toString(); }
    static String shapeOf(String type) { return s(TYPES.getOrDefault(type, new LinkedHashMap<>()).get("shape")).isEmpty() ? "rect" : s(TYPES.get(type).get("shape")); }
    static int[] sizeOf(String type) {
        List<Object> a = Json.arr(Json.obj(SPEC.get("nodeSize")).get(shapeOf(type)));
        return new int[]{((Number) a.get(0)).intValue(), ((Number) a.get(1)).intValue()};
    }
    static double num(Object o) { return o instanceof Number ? ((Number) o).doubleValue() : 0; }
    static Point2D center(Map<String, Object> n) { int[] z = sizeOf(s(n.get("type"))); return new Point2D.Double(num(n.get("x")) + z[0] / 2.0, num(n.get("y")) + z[1] / 2.0); }
    static Map<String, Object> node(Map<String, Object> def, String id) {
        for (Object o : Json.arr(def.get("nodes"))) if (id.equals(s(Json.obj(o).get("id")))) return Json.obj(o);
        return null;
    }

    static Map<String, Object> newNode(String type, int x, int y) {
        Map<String, Object> spec = TYPES.get(type), n = new LinkedHashMap<>();
        n.put("id", newId()); n.put("type", type); n.put("name", spec.get("label")); n.put("x", (long) x); n.put("y", (long) y);
        if (type.equals("FormTask") || type.equals("ApprovalTask")) {
            n.put("assignee", ""); n.put("priority", "Normal"); n.put("escalationMode", "Reassign");
            Map<String, Object> f = new LinkedHashMap<>(); f.put("id", newId()); f.put("title", spec.get("label")); f.put("fields", new ArrayList<>()); n.put("form", f);
        }
        if (type.equals("Timer")) n.put("durationSeconds", 60L);
        if (type.equals("WebhookCall")) n.put("webhookMethod", "POST");
        if (type.equals("FileOperations")) n.put("fileOperation", "Read");
        if (type.equals("InvokeSoapService")) n.put("soapEnvelope", "<?xml version=\"1.0\"?>\n<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\">\n  <soap:Body>\n\n  </soap:Body>\n</soap:Envelope>");
        return n;
    }

    // ------------------------------------------------------------------------------------ canvas
    static final class Canvas extends JPanel {
        Map<String, Object> def;
        final boolean editable;
        Consumer<String[]> onSelect;   // {nodeId, edgeId}
        Runnable onChange;
        String selNode, selEdge, linkFrom;
        boolean linkMode;
        double scale = 1;
        Map<String, String> states = new LinkedHashMap<>(), edgeStates = new LinkedHashMap<>();
        private String dragId; private double dx, dy;

        Canvas(Map<String, Object> def, boolean editable) {
            this.def = def; this.editable = editable;
            setBackground(new Color(0xF8, 0xFA, 0xFC));
            MouseAdapter m = new MouseAdapter() {
                @Override public void mousePressed(MouseEvent e) { press(e); }
                @Override public void mouseDragged(MouseEvent e) { drag(e); }
                @Override public void mouseReleased(MouseEvent e) { dragId = null; }
                @Override public void mouseWheelMoved(java.awt.event.MouseWheelEvent e) {
                    if (e.isControlDown()) { scale = Math.max(0.3, Math.min(2.5, scale * (e.getWheelRotation() < 0 ? 1.1 : 1 / 1.1))); revalidate(); repaint(); }
                    else if (getParent() != null) getParent().dispatchEvent(SwingUtilities.convertMouseEvent(Canvas.this, e, getParent()));
                }
            };
            addMouseListener(m); addMouseMotionListener(m); addMouseWheelListener(m);
        }

        @Override public Dimension getPreferredSize() {
            double w = 900, h = 600;
            for (Object o : Json.arr(def.get("nodes"))) { Map<String, Object> n = Json.obj(o); w = Math.max(w, num(n.get("x")) + 260); h = Math.max(h, num(n.get("y")) + 200); }
            return new Dimension((int) (w * scale), (int) (h * scale));
        }

        void changed() { revalidate(); repaint(); if (onChange != null) onChange.run(); }
        void select(String nid, String eid) { selNode = nid; selEdge = eid; repaint(); if (onSelect != null) onSelect.accept(new String[]{nid, eid}); }

        private Map<String, Object> nodeAt(double x, double y) {
            List<Object> ns = Json.arr(def.get("nodes"));
            for (int i = ns.size() - 1; i >= 0; i--) {
                Map<String, Object> n = Json.obj(ns.get(i)); int[] z = sizeOf(s(n.get("type")));
                double nx = num(n.get("x")), ny = num(n.get("y"));
                if (x >= nx && x <= nx + z[0] && y >= ny && y <= ny + z[1]) return n;
            }
            return null;
        }

        private CubicCurve2D curve(Map<String, Object> e) {
            Map<String, Object> a = node(def, s(e.get("sourceNodeId"))), b = node(def, s(e.get("targetNodeId")));
            if (a == null || b == null) return null;
            Point2D p = center(a), q = center(b); double d = (q.getX() - p.getX()) * 0.5;
            return new CubicCurve2D.Double(p.getX(), p.getY(), p.getX() + d, p.getY(), q.getX() - d, q.getY(), q.getX(), q.getY());
        }

        private Map<String, Object> edgeAt(double x, double y) {
            for (Object o : Json.arr(def.get("edges"))) {
                Map<String, Object> e = Json.obj(o); CubicCurve2D c = curve(e); if (c == null) continue;
                for (int i = 0; i <= 30; i++) {
                    double t = i / 30.0, mt = 1 - t;
                    double px = mt * mt * mt * c.getX1() + 3 * mt * mt * t * c.getCtrlX1() + 3 * mt * t * t * c.getCtrlX2() + t * t * t * c.getX2();
                    double py = mt * mt * mt * c.getY1() + 3 * mt * mt * t * c.getCtrlY1() + 3 * mt * t * t * c.getCtrlY2() + t * t * t * c.getY2();
                    if (Math.hypot(px - x, py - y) < 8) return e;
                }
            }
            return null;
        }

        private void press(MouseEvent e) {
            if (!editable) return;
            double x = e.getX() / scale, y = e.getY() / scale;
            Map<String, Object> n = nodeAt(x, y);
            if (linkMode) { if (n != null) link(s(n.get("id"))); return; }
            if (n != null) { dragId = s(n.get("id")); dx = x - num(n.get("x")); dy = y - num(n.get("y")); select(dragId, null); return; }
            Map<String, Object> ed = edgeAt(x, y);
            if (ed != null) select(null, s(ed.get("id"))); else select(null, null);
        }

        private void drag(MouseEvent e) {
            if (dragId == null) return;
            Map<String, Object> n = node(def, dragId); if (n == null) return;
            n.put("x", (long) Math.max(0, Math.round(e.getX() / scale - dx))); n.put("y", (long) Math.max(0, Math.round(e.getY() / scale - dy)));
            changed();
        }

        void link(String id) {
            if (linkFrom == null) { linkFrom = id; repaint(); return; }
            if (linkFrom.equals(id)) { linkFrom = null; repaint(); return; }
            Map<String, Object> src = node(def, linkFrom); List<Object> edges = Json.arr(def.get("edges"));
            String label = "Default";
            if (s(src.get("type")).equals("ApprovalTask")) label = hasEdge(edges, linkFrom, "Approve") ? "Reject" : "Approve";
            else if (s(src.get("type")).equals("Condition")) label = hasEdge(edges, linkFrom, "True") ? "False" : "True";
            Map<String, Object> ed = new LinkedHashMap<>(); ed.put("id", newId()); ed.put("sourceNodeId", linkFrom); ed.put("targetNodeId", id); ed.put("label", label);
            edges.add(ed); linkFrom = null; select(null, s(ed.get("id"))); changed();
        }
        private static boolean hasEdge(List<Object> edges, String src, String label) {
            for (Object o : edges) { Map<String, Object> e = Json.obj(o); if (src.equals(s(e.get("sourceNodeId"))) && label.equals(s(e.get("label")))) return true; }
            return false;
        }

        void addNode(String type) {
            int k = Json.arr(def.get("nodes")).size();
            Map<String, Object> n = newNode(type, 40 + (k % 5) * 180, 40 + (k / 5) * 120);
            Json.arr(def.get("nodes")).add(n); select(s(n.get("id")), null); changed();
        }

        void deleteSelected() {
            List<Object> nodes = Json.arr(def.get("nodes")), edges = Json.arr(def.get("edges"));
            if (selNode != null) { nodes.removeIf(o -> selNode.equals(s(Json.obj(o).get("id")))); edges.removeIf(o -> selNode.equals(s(Json.obj(o).get("sourceNodeId"))) || selNode.equals(s(Json.obj(o).get("targetNodeId")))); }
            else if (selEdge != null) edges.removeIf(o -> selEdge.equals(s(Json.obj(o).get("id"))));
            else return;
            select(null, null); changed();
        }

        @Override protected void paintComponent(Graphics g0) {
            super.paintComponent(g0);
            Graphics2D g = (Graphics2D) g0.create();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.scale(scale, scale);
            Font base = g.getFont();
            for (Object o : Json.arr(def.get("edges"))) {
                Map<String, Object> e = Json.obj(o); CubicCurve2D c = curve(e); if (c == null) continue;
                Color col = new Color(0x94, 0xA3, 0xB8); float w = 2;
                String st = edgeStates.get(s(e.get("id")));
                if ("ok".equals(st)) { col = new Color(0x16, 0xA3, 0x4A); w = 3; } else if ("rejected".equals(st)) { col = new Color(0xDC, 0x26, 0x26); w = 3; }
                if (s(e.get("id")).equals(selEdge)) { col = Ui.PRIMARY; w = 3; }
                g.setColor(col); g.setStroke(new BasicStroke(w)); g.draw(c);
                Map<String, Object> tgt = node(def, s(e.get("targetNodeId"))); int[] z = sizeOf(s(tgt.get("type")));
                double rad = Math.max(z[0], z[1]) / 2.0 + 4, t = 1; Point2D tip = c.getP2();
                while (t > 0.5) { Point2D p = pt(c, t); if (p.distance(center(tgt)) >= rad) { tip = p; break; } t -= 0.01; }
                Point2D prev = pt(c, Math.max(t - 0.03, 0)); double ang = Math.atan2(tip.getY() - prev.getY(), tip.getX() - prev.getX());
                Path2D.Double ah = new Path2D.Double(); ah.moveTo(tip.getX(), tip.getY());
                ah.lineTo(tip.getX() - 10 * Math.cos(ang - 0.4), tip.getY() - 10 * Math.sin(ang - 0.4)); ah.lineTo(tip.getX() - 10 * Math.cos(ang + 0.4), tip.getY() - 10 * Math.sin(ang + 0.4)); ah.closePath();
                g.fill(ah);
                Point2D mid = pt(c, 0.5); g.setFont(base.deriveFont(11f)); g.setColor(new Color(0x47, 0x55, 0x69));
                String lab = s(e.get("label")); g.drawString(lab, (float) (mid.getX() - g.getFontMetrics().stringWidth(lab) / 2.0), (float) (mid.getY() - 6));
            }
            for (Object o : Json.arr(def.get("nodes"))) paintNode(g, Json.obj(o), base);
            g.dispose();
        }

        private static Point2D pt(CubicCurve2D c, double t) {
            double mt = 1 - t;
            return new Point2D.Double(mt * mt * mt * c.getX1() + 3 * mt * mt * t * c.getCtrlX1() + 3 * mt * t * t * c.getCtrlX2() + t * t * t * c.getX2(),
                    mt * mt * mt * c.getY1() + 3 * mt * mt * t * c.getCtrlY1() + 3 * mt * t * t * c.getCtrlY2() + t * t * t * c.getY2());
        }

        private void paintNode(Graphics2D g, Map<String, Object> n, Font base) {
            String type = s(n.get("type")), id = s(n.get("id")); int[] z = sizeOf(type); String sh = shapeOf(type);
            double x = num(n.get("x")), y = num(n.get("y"));
            Color col = Color.decode(s(TYPES.get(type).get("color"))), fill = Color.WHITE, pen = col; float w = 2;
            String st = states.get(id);
            if ("active".equals(st)) { fill = new Color(0xDC, 0xFC, 0xE7); pen = new Color(0x16, 0xA3, 0x4A); w = 4; }
            else if ("visited".equals(st)) { fill = new Color(0xF0, 0xFD, 0xF4); pen = new Color(0x16, 0xA3, 0x4A); }
            else if ("rejected".equals(st)) { fill = new Color(0xFE, 0xE2, 0xE2); pen = new Color(0xDC, 0x26, 0x26); }
            if (id.equals(selNode) || id.equals(linkFrom)) { pen = Ui.PRIMARY; w = 4; }
            java.awt.Composite oc = g.getComposite();
            if ("pending".equals(st)) g.setComposite(java.awt.AlphaComposite.getInstance(java.awt.AlphaComposite.SRC_OVER, 0.5f));
            java.awt.Shape shape;
            if (sh.equals("circle")) shape = new Ellipse2D.Double(x, y, z[0], z[1]);
            else if (sh.equals("diamond")) { Path2D.Double p = new Path2D.Double(); p.moveTo(x + z[0] / 2.0, y); p.lineTo(x + z[0], y + z[1] / 2.0); p.lineTo(x + z[0] / 2.0, y + z[1]); p.lineTo(x, y + z[1] / 2.0); p.closePath(); shape = p; }
            else shape = new RoundRectangle2D.Double(x, y, z[0], z[1], 10, 10);
            g.setColor(fill); g.fill(shape);
            g.setColor(pen); g.setStroke(id.equals(linkFrom) ? new BasicStroke(w, BasicStroke.CAP_BUTT, BasicStroke.JOIN_MITER, 10, new float[]{6, 3}, 0) : new BasicStroke(w)); g.draw(shape);
            g.setColor(new Color(0x0F, 0x17, 0x2A));
            String icon = s(TYPES.get(type).get("icon"));
            g.setFont(base.deriveFont(15f)); FontMetrics fm = g.getFontMetrics();
            if (sh.equals("circle")) g.drawString(icon, (float) (x + (z[0] - fm.stringWidth(icon)) / 2.0), (float) (y + z[1] / 2.0 + 5));
            else {
                g.drawString(icon, (float) (x + (z[0] - fm.stringWidth(icon)) / 2.0), (float) (y + (sh.equals("rect") ? 22 : 30)));
                g.setFont(base.deriveFont(Font.BOLD, 11f)); fm = g.getFontMetrics();
                String nm = s(n.get("name")); if (nm.length() > 22) nm = nm.substring(0, 21) + "…";
                g.drawString(nm, (float) (x + (z[0] - fm.stringWidth(nm)) / 2.0), (float) (y + (sh.equals("rect") ? 44 : 54)));
            }
            g.setComposite(oc);
        }
    }

    // ------------------------------------------------------------------------------------ form builder
    static final class FormDialog extends JDialog {
        final Map<String, Object> form; final JTextField title; final DefaultTableModel model;
        boolean saved;
        FormDialog(Component parent, Map<String, Object> form) {
            super(SwingUtilities.getWindowAncestor(parent), t("wf.form"), ModalityType.APPLICATION_MODAL);
            this.form = form;
            title = new JTextField(s(form.get("title")));
            model = new DefaultTableModel(new String[]{"Key", "Label", "Type", "Required", "Read-only", "Options (label=value; …)"}, 0) {
                @Override public Class<?> getColumnClass(int c) { return c == 3 || c == 4 ? Boolean.class : String.class; }
            };
            for (Object o : Json.arr(form.get("fields"))) {
                Map<String, Object> f = Json.obj(o); StringBuilder opts = new StringBuilder();
                for (Object oo : Json.arr(f.get("options"))) { Map<String, Object> op = Json.obj(oo); if (opts.length() > 0) opts.append("; "); opts.append(s(op.get("label"))).append('=').append(s(op.get("value"))); }
                model.addRow(new Object[]{s(f.get("key")), s(f.get("label")), s(f.get("type")).isEmpty() ? "Text" : s(f.get("type")), Boolean.TRUE.equals(f.get("required")), Boolean.TRUE.equals(f.get("readOnly")), opts.toString()});
            }
            JTable tbl = new JTable(model); tbl.setRowHeight(26);
            JComboBox<String> types = new JComboBox<>(); for (Object o : Json.arr(SPEC.get("fieldTypes"))) types.addItem(s(o));
            tbl.getColumnModel().getColumn(2).setCellEditor(new javax.swing.DefaultCellEditor(types));
            JPanel top = new JPanel(new BorderLayout(6, 0)); top.add(new JLabel(t("wf.formTitle")), BorderLayout.WEST); top.add(title);
            JPanel bar = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.LEADING));
            bar.add(Ui.button("+ " + t("wf.addField"), () -> model.addRow(new Object[]{"", "", "Text", false, false, ""}), "plain"));
            bar.add(Ui.button(t("wf.removeField"), () -> { if (tbl.getSelectedRow() >= 0) { if (tbl.isEditing()) tbl.getCellEditor().stopCellEditing(); model.removeRow(tbl.getSelectedRow()); } }, "plain"));
            JPanel ok = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.TRAILING));
            ok.add(Ui.button("OK", () -> { if (tbl.isEditing()) tbl.getCellEditor().stopCellEditing(); commit(); saved = true; dispose(); }, null));
            ok.add(Ui.button("✕", this::dispose, "plain"));
            JPanel south = new JPanel(new BorderLayout()); south.add(bar, BorderLayout.WEST); south.add(ok, BorderLayout.EAST);
            JPanel c = new JPanel(new BorderLayout(0, 8)); c.setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));
            c.add(top, BorderLayout.NORTH); c.add(new JScrollPane(tbl)); c.add(south, BorderLayout.SOUTH);
            setContentPane(c); setSize(860, 460); setLocationRelativeTo(parent);
        }
        private void commit() {
            List<Object> old = Json.arr(form.get("fields")), fields = new ArrayList<>();
            for (int r = 0; r < model.getRowCount(); r++) {
                Map<String, Object> f = new LinkedHashMap<>();
                f.put("id", r < old.size() && !s(Json.obj(old.get(r)).get("id")).isEmpty() ? s(Json.obj(old.get(r)).get("id")) : newId());
                f.put("key", s(model.getValueAt(r, 0)).trim()); f.put("label", s(model.getValueAt(r, 1)).trim()); f.put("type", s(model.getValueAt(r, 2)));
                f.put("required", Boolean.TRUE.equals(model.getValueAt(r, 3))); f.put("readOnly", Boolean.TRUE.equals(model.getValueAt(r, 4)));
                List<Object> opts = new ArrayList<>();
                for (String part : s(model.getValueAt(r, 5)).split(";")) {
                    part = part.trim(); if (part.isEmpty()) continue;
                    int i = part.indexOf('='); Map<String, Object> o = new LinkedHashMap<>();
                    o.put("label", (i < 0 ? part : part.substring(0, i)).trim()); o.put("value", (i < 0 ? part : part.substring(i + 1)).trim()); opts.add(o);
                }
                f.put("options", opts); fields.add(f);
            }
            form.put("title", title.getText().trim()); form.put("fields", fields);
        }
    }

    // ------------------------------------------------------------------------------------ designer
    record Item(String label, String value) { @Override public String toString() { return label; } }

    static final class Designer extends JDialog {
        Map<String, Object> def = new LinkedHashMap<>();
        final Canvas canvas;
        final JTextField name = new JTextField(), desc = new JTextField();
        final JLabel badge = new JLabel(), status = Ui.label(t("wf.hint"), "dim");
        final JPanel panel = new JPanel();
        final JToggleButton linkBtn = new JToggleButton(t("wf.link"));
        JButton save, pub, run, del;
        List<Map<String, Object>> users = new ArrayList<>(), published = new ArrayList<>();
        List<String> roles = new ArrayList<>();
        final boolean canDesign = Api.I.can(s(Json.obj(SPEC.get("permissions")).get("design")));

        Designer(Component parent, String defId) {
            super(SwingUtilities.getWindowAncestor(parent), t("wf.designer"), ModalityType.APPLICATION_MODAL);
            def.put("id", ""); def.put("name", "Untitled flow"); def.put("description", ""); def.put("isPublished", false); def.put("version", 1L); def.put("nodes", new ArrayList<>()); def.put("edges", new ArrayList<>());
            canvas = new Canvas(def, true);
            canvas.onSelect = a -> onSelect(a[0], a[1]);
            canvas.onChange = () -> { };
            name.getDocument().addDocumentListener(doc(() -> def.put("name", name.getText())));
            desc.getDocument().addDocumentListener(doc(() -> def.put("description", desc.getText())));
            save = Ui.button(t("wf.save"), () -> save(null), null); pub = Ui.button(t("wf.publish"), this::publish, "plain");
            run = Ui.button(t("wf.run"), this::run, "plain"); del = Ui.button(t("wf.delete"), () -> canvas.deleteSelected(), "plain");
            linkBtn.addActionListener(e -> { canvas.linkMode = linkBtn.isSelected(); canvas.linkFrom = null; status.setText(Json.str(canvas.linkMode ? t("wf.linkHint") : t("wf.hint"))); });
            JPanel bar = new JPanel(new java.awt.GridBagLayout());
            java.awt.GridBagConstraints gc = new java.awt.GridBagConstraints(); gc.fill = java.awt.GridBagConstraints.HORIZONTAL; gc.insets = new java.awt.Insets(0, 3, 0, 3);
            gc.weightx = 2; bar.add(name, gc); gc.weightx = 3; bar.add(desc, gc); gc.weightx = 0; bar.add(badge, gc);
            for (Component c : new Component[]{linkBtn, del, save, pub, run}) bar.add(c, gc);
            // palette
            JTabbedPane pal = new JTabbedPane(JTabbedPane.LEFT);
            for (Object cat : Json.arr(SPEC.get("categories"))) {
                DefaultListModel<Item> lm = new DefaultListModel<>();
                for (Map<String, Object> n : NODES) if (s(n.get("category")).equals(s(cat))) lm.addElement(new Item(s(n.get("icon")) + "  " + s(n.get("label")), s(n.get("type"))));
                JList<Item> l = new JList<>(lm); l.setToolTipText(null);
                l.addMouseListener(new MouseAdapter() { @Override public void mouseClicked(MouseEvent e) { if (e.getClickCount() == 2 && l.getSelectedValue() != null && canDesign) canvas.addNode(l.getSelectedValue().value()); } });
                l.addMouseMotionListener(new MouseAdapter() { @Override public void mouseMoved(MouseEvent e) { int i = l.locationToIndex(e.getPoint()); if (i >= 0) l.setToolTipText(s(TYPES.get(lm.get(i).value()).get("note"))); } });
                JScrollPane sp = new JScrollPane(l); sp.setPreferredSize(new Dimension(190, 100));
                pal.addTab(s(cat).replace(" Activities", "").replace(" Elements", ""), sp);
            }
            pal.setPreferredSize(new Dimension(280, 0));
            panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS)); panel.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
            JScrollPane ps = new JScrollPane(panel); ps.setPreferredSize(new Dimension(360, 0)); ps.getVerticalScrollBar().setUnitIncrement(16);
            JPanel mid = new JPanel(new BorderLayout()); mid.add(pal, BorderLayout.WEST); mid.add(new JScrollPane(canvas), BorderLayout.CENTER); mid.add(ps, BorderLayout.EAST);
            JPanel c = new JPanel(new BorderLayout(0, 6)); c.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));
            c.add(bar, BorderLayout.NORTH); c.add(mid); c.add(status, BorderLayout.SOUTH);
            setContentPane(c); setSize(1300, 800); setLocationRelativeTo(parent);
            for (Component x : new Component[]{linkBtn, del, save, name, desc}) x.setEnabled(canDesign);
            pub.setEnabled(false); run.setEnabled(false);
            showEmpty(); apply();
            Ui.async(() -> new Object[]{Api.I.users(), Api.I.definitions()}, r -> {
                @SuppressWarnings("unchecked") List<Map<String, Object>> us = (List<Map<String, Object>>) r[0], ds = (List<Map<String, Object>>) r[1];
                users = us; Set<String> rs = new java.util.TreeSet<>(); for (Map<String, Object> u : us) if (!s(u.get("role")).isEmpty()) rs.add(s(u.get("role")));
                roles = new ArrayList<>(rs); published = new ArrayList<>();
                for (Map<String, Object> d : ds) if (Boolean.TRUE.equals(d.get("isPublished")) && !s(d.get("id")).equals(s(def.get("id")))) published.add(d);
            }, m -> { });
            if (defId != null) Ui.async(() -> Api.I.definition(defId), d -> { def = d; if (!(d.get("nodes") instanceof List)) d.put("nodes", new ArrayList<>()); if (!(d.get("edges") instanceof List)) d.put("edges", new ArrayList<>()); canvas.def = d; canvas.revalidate(); canvas.repaint(); apply(); }, m -> Ui.warn(this, m));
        }

        static DocumentListener doc(Runnable r) {
            return new DocumentListener() {
                public void insertUpdate(DocumentEvent e) { r.run(); } public void removeUpdate(DocumentEvent e) { r.run(); } public void changedUpdate(DocumentEvent e) { r.run(); }
            };
        }

        void apply() {
            name.setText(s(def.get("name"))); desc.setText(s(def.get("description")));
            boolean p = Boolean.TRUE.equals(def.get("isPublished"));
            badge.setText(p ? "● " + t("wf.published") + " v" + s(def.get("version")) : "○ " + t("wf.draft"));
            badge.setForeground(p ? new Color(0x16, 0xA3, 0x4A) : new Color(0xD9, 0x77, 0x06));
            pub.setEnabled(!s(def.get("id")).isEmpty() && !p && Api.I.can(s(Json.obj(SPEC.get("permissions")).get("publish"))));
            run.setEnabled(p);
        }

        // ---- property panel
        void showEmpty() { panel.removeAll(); panel.add(Ui.label(t("wf.selectHint"), "dim")); panel.revalidate(); panel.repaint(); }
        void onSelect(String nid, String eid) {
            if (nid != null) buildNode(node(def, nid));
            else if (eid != null) { for (Object o : Json.arr(def.get("edges"))) if (s(Json.obj(o).get("id")).equals(eid)) buildEdge(Json.obj(o)); }
            else showEmpty();
        }
        private void add(JPanel p, String lab, Component c) {
            JLabel l = new JLabel(lab); l.setAlignmentX(0f); c.setMaximumSize(new Dimension(Integer.MAX_VALUE, c instanceof JScrollPane || c instanceof JPanel ? 400 : 28));
            if (c instanceof javax.swing.JComponent jc) jc.setAlignmentX(0f);
            p.add(Box.createVerticalStrut(6)); p.add(l); p.add(c);
        }
        private void hint(String text) { JLabel l = Ui.label(text, "dim"); l.setFont(l.getFont().deriveFont(11f)); l.setAlignmentX(0f); panel.add(l); }
        void buildEdge(Map<String, Object> e) {
            panel.removeAll(); panel.add(Ui.label(t("wf.edge"), "title"));
            Map<String, Object> src = node(def, s(e.get("sourceNodeId")));
            if (src != null && s(src.get("type")).equals("Condition")) {
                JComboBox<String> cb = new JComboBox<>(new String[]{"True", "False"}); cb.setSelectedItem(s(e.get("label"))); cb.setEnabled(canDesign);
                cb.addActionListener(a -> { e.put("label", cb.getSelectedItem()); canvas.repaint(); }); add(panel, t("wf.edgeLabel"), cb);
            } else {
                JTextField tf = new JTextField(s(e.get("label"))); tf.setEnabled(canDesign);
                tf.getDocument().addDocumentListener(doc(() -> { e.put("label", tf.getText()); canvas.repaint(); })); add(panel, t("wf.edgeLabel"), tf);
            }
            if (src != null && s(src.get("type")).equals("ApprovalTask")) hint(t("wf.edgeApprovalHint"));
            panel.revalidate(); panel.repaint();
        }

        private void set(Map<String, Object> n, String key, Object v, boolean rebuild) {
            if (v == null || (v instanceof String str && str.isEmpty() && !key.equals("name"))) n.remove(key); else n.put(key, v);
            canvas.repaint();
            if (rebuild) SwingUtilities.invokeLater(() -> buildNode(n));
        }

        void buildNode(Map<String, Object> n) {
            panel.removeAll();
            Map<String, Object> spec = TYPES.get(s(n.get("type")));
            panel.add(Ui.label(s(spec.get("icon")) + " " + s(spec.get("label")), "title")); hint(s(spec.get("note")));
            Set<String> referenced = new LinkedHashSet<>();
            for (Map<String, Object> nn : NODES) for (Object p : Json.arr(nn.get("props"))) { Object si = Json.obj(p).get("showIf"); if (si != null) referenced.add(s(Json.obj(si).get("key"))); }
            List<Object> props = new ArrayList<>(Json.arr(SPEC.get("common"))); props.addAll(Json.arr(spec.get("props")));
            for (Object po : props) {
                Map<String, Object> p = Json.obj(po); Object si = p.get("showIf");
                if (si != null) {
                    Map<String, Object> c = Json.obj(si); String cur = s(n.get(s(c.get("key"))));
                    if ((c.containsKey("eq") && !cur.equals(s(c.get("eq")))) || (c.containsKey("ne") && cur.equals(s(c.get("ne"))))) continue;
                }
                Component w = editor(n, p, referenced.contains(s(p.get("key"))));
                if (w == null) continue;
                w.setEnabled(canDesign || s(p.get("kind")).equals("form"));
                add(panel, s(p.get("label")), w);
                if (!s(p.get("hint")).isEmpty() && !s(p.get("kind")).equals("form")) hint(s(p.get("hint")));
            }
            panel.add(Box.createVerticalGlue()); panel.revalidate(); panel.repaint();
        }

        private Component editor(Map<String, Object> n, Map<String, Object> p, boolean rebuild) {
            String k = s(p.get("key")), kind = s(p.get("kind"));
            switch (kind) {
                case "text": {
                    JTextField tf = new JTextField(s(n.get(k)));
                    tf.getDocument().addDocumentListener(doc(() -> set(n, k, tf.getText(), false)));
                    if (s(p.get("test")).equals("condition")) {
                        JPanel box = new JPanel(); box.setLayout(new BoxLayout(box, BoxLayout.Y_AXIS)); box.setOpaque(false);
                        JTextArea data = new JTextArea("{\n  \"days\": 6\n}", 4, 20); JLabel out = new JLabel(" ");
                        tf.setAlignmentX(0f); tf.setMaximumSize(new Dimension(Integer.MAX_VALUE, 28)); box.add(tf);
                        JLabel sl = new JLabel(t("wf.sampleData")); sl.setAlignmentX(0f); box.add(sl);
                        JScrollPane dsp = new JScrollPane(data); dsp.setAlignmentX(0f); box.add(dsp);
                        JButton tb = Ui.button("▶ " + t("wf.test"), () -> {
                            Map<String, Object> d;
                            try { d = Json.obj(Json.parse(data.getText())); } catch (Exception ex) { out.setText(t("wf.badJson")); return; }
                            Ui.async(() -> Api.I.testCondition(s(n.get("conditionExpression")), d), r -> {
                                StringBuilder sb = new StringBuilder("<html><b style='color:" + (Boolean.TRUE.equals(r.get("result")) ? "#16a34a" : "#dc2626") + "'>" + t("wf.result") + ": " + (Boolean.TRUE.equals(r.get("result")) ? "True" : "False") + "</b>");
                                for (Object c : Json.arr(r.get("clauses"))) { Map<String, Object> cm = Json.obj(c); sb.append("<br>").append(Boolean.TRUE.equals(cm.get("result")) ? "✓ " : "✕ ").append(s(cm.get("clause")).replace("<", "&lt;")); }
                                out.setText(sb.toString());
                            }, m -> out.setText(m));
                        }, "plain");
                        tb.setAlignmentX(0f); out.setAlignmentX(0f); box.add(tb); box.add(out);
                        box.setMaximumSize(new Dimension(Integer.MAX_VALUE, 400));
                        return box;
                    }
                    return tf;
                }
                case "textarea": {
                    JTextArea ta = new JTextArea(s(n.get(k)), 4, 20); ta.setLineWrap(true);
                    ta.getDocument().addDocumentListener(doc(() -> set(n, k, ta.getText(), false)));
                    return new JScrollPane(ta);
                }
                case "number": {
                    JSpinner sp = new JSpinner(new SpinnerNumberModel((int) num(n.get(k)), 0, 10_000_000, 1));
                    sp.addChangeListener(e -> { int v = (Integer) sp.getValue(); set(n, k, v == 0 ? null : (Object) (long) v, false); });
                    return sp;
                }
                case "bool": {
                    JCheckBox cb = new JCheckBox(); cb.setSelected(Boolean.TRUE.equals(n.get(k)));
                    cb.addActionListener(e -> set(n, k, cb.isSelected(), rebuild)); return cb;
                }
                case "select": {
                    List<Object> opts = Json.arr(p.get("options")); JComboBox<Item> cb = new JComboBox<>();
                    for (Object o : opts) cb.addItem(new Item(s(o).isEmpty() ? "— none (stub) —" : s(o), s(o)));
                    String cur = s(n.get(k)); for (int i = 0; i < cb.getItemCount(); i++) if (cb.getItemAt(i).value().equals(cur)) cb.setSelectedIndex(i);
                    cb.addActionListener(e -> set(n, k, ((Item) cb.getSelectedItem()).value(), rebuild)); return cb;
                }
                case "assignees": {
                    DefaultListModel<Item> lm = new DefaultListModel<>(); for (String r : roles) lm.addElement(new Item("role: " + r, r));
                    for (Map<String, Object> u : users) lm.addElement(new Item(s(u.get("displayName")) + " (" + s(u.get("username")) + ")", s(u.get("username"))));
                    JList<Item> l = new JList<>(lm); Set<String> chosen = new LinkedHashSet<>(); for (String a : s(n.get(k)).split(",")) if (!a.trim().isEmpty()) chosen.add(a.trim());
                    List<Integer> idx = new ArrayList<>(); for (int i = 0; i < lm.size(); i++) if (chosen.contains(lm.get(i).value())) idx.add(i);
                    l.setSelectedIndices(idx.stream().mapToInt(Integer::intValue).toArray());
                    l.addListSelectionListener(e -> { if (e.getValueIsAdjusting()) return; StringBuilder sb = new StringBuilder(); for (Item it : l.getSelectedValuesList()) { if (sb.length() > 0) sb.append(','); sb.append(it.value()); } set(n, k, sb.toString(), false); });
                    JScrollPane sp = new JScrollPane(l); sp.setPreferredSize(new Dimension(200, 120)); return sp;
                }
                case "assignee1": {
                    JComboBox<Item> cb = new JComboBox<>(); cb.setEditable(false); cb.addItem(new Item("", ""));
                    for (String r : roles) cb.addItem(new Item("role: " + r, r));
                    for (Map<String, Object> u : users) cb.addItem(new Item(s(u.get("displayName")) + " (" + s(u.get("username")) + ")", s(u.get("username"))));
                    String cur = s(n.get(k)); for (int i = 0; i < cb.getItemCount(); i++) if (cb.getItemAt(i).value().equals(cur)) cb.setSelectedIndex(i);
                    cb.addActionListener(e -> set(n, k, ((Item) cb.getSelectedItem()).value(), false)); return cb;
                }
                case "workflow": {
                    JComboBox<Item> cb = new JComboBox<>(); cb.addItem(new Item("", ""));
                    for (Map<String, Object> d : published) cb.addItem(new Item(s(d.get("name")), s(d.get("id"))));
                    String cur = s(n.get(k)); for (int i = 0; i < cb.getItemCount(); i++) if (cb.getItemAt(i).value().equals(cur)) cb.setSelectedIndex(i);
                    cb.addActionListener(e -> { Item it = (Item) cb.getSelectedItem(); set(n, k, it.value(), false); set(n, "subWorkflowDefinitionName", it.value().isEmpty() ? null : it.label(), false); }); return cb;
                }
                case "form": {
                    if (!(n.get("form") instanceof Map)) { Map<String, Object> f = new LinkedHashMap<>(); f.put("id", newId()); f.put("title", s(n.get("name"))); f.put("fields", new ArrayList<>()); n.put("form", f); }
                    Map<String, Object> form = Json.obj(n.get("form"));
                    JButton b = new JButton(t("wf.editForm", "n", String.valueOf(Json.arr(form.get("fields")).size())));
                    b.addActionListener(e -> { FormDialog d = new FormDialog(this, form); d.setVisible(true); b.setText(t("wf.editForm", "n", String.valueOf(Json.arr(form.get("fields")).size()))); });
                    return b;
                }
                default: return null;
            }
        }

        // ---- server
        Map<String, Object> body() {
            Map<String, Object> b = new LinkedHashMap<>(); b.put("name", def.get("name")); b.put("description", s(def.get("description"))); b.put("nodes", def.get("nodes")); b.put("edges", def.get("edges")); return b;
        }
        void save(Runnable then) {
            Ui.async(() -> Api.I.saveDefinition(s(def.get("id")), body()), d -> {
                def = d; if (!(d.get("nodes") instanceof List)) d.put("nodes", new ArrayList<>()); if (!(d.get("edges") instanceof List)) d.put("edges", new ArrayList<>());
                canvas.def = d; canvas.revalidate(); canvas.repaint(); apply(); status.setText(t("wf.saved")); if (then != null) then.run();
            }, m -> Ui.warn(this, m));
        }
        void publish() {
            int starts = 0; boolean end = false;
            for (Object o : Json.arr(def.get("nodes"))) { String tp = s(Json.obj(o).get("type")); if (tp.equals("Start")) starts++; if (tp.equals("End")) end = true; }
            if (starts != 1) { Ui.warn(this, t("wf.needStart")); return; }
            if (!end) { Ui.warn(this, t("wf.needEnd")); return; }
            save(() -> Ui.async(() -> Api.I.publishDefinition(s(def.get("id"))), d -> { def.putAll(d); apply(); status.setText(t("wf.publishedMsg")); }, m -> Ui.warn(this, m)));
        }
        void run() {
            Ui.async(() -> Api.I.startRun(s(def.get("id"))), i -> { status.setText(t("wf.started", "id", s(i.get("id")))); new InstanceDialog(this, s(i.get("id"))).setVisible(true); }, m -> Ui.warn(this, m));
        }
    }

    // ------------------------------------------------------------------------------------ instance monitor
    static final class InstanceDialog extends JDialog {
        final String id; Map<String, Object> inst, def; Canvas canvas;
        final JLabel head = Ui.label("…", "title"), meta = Ui.label(" ", "dim");
        final JButton cancel; final DefaultListModel<String> timeline = new DefaultListModel<>(), log = new DefaultListModel<>();
        final Ui.DataTable data = new Ui.DataTable(t("wf.key"), t("wf.value"));
        final JPanel mapHolder = new JPanel(new BorderLayout()); final Timer timer;

        InstanceDialog(Component parent, String id) {
            super(SwingUtilities.getWindowAncestor(parent), t("wf.instance"), ModalityType.APPLICATION_MODAL);
            this.id = id;
            cancel = Ui.button(t("wf.cancelReq"), this::cancelRun, "danger"); cancel.setEnabled(false);
            JPanel top = new JPanel(new BorderLayout()); top.add(head, BorderLayout.CENTER); top.add(cancel, BorderLayout.EAST);
            JLabel legend = new JLabel("<html><span style='color:#16a34a'>●</span> " + t("wf.legActive") + " &nbsp; <span style='color:#86efac'>●</span> " + t("wf.legDone") + " &nbsp; <span style='color:#dc2626'>●</span> " + t("wf.legRejected") + " &nbsp; <span style='color:#94a3b8'>●</span> " + t("wf.legPending") + "</html>");
            JPanel north = new JPanel(); north.setLayout(new BoxLayout(north, BoxLayout.Y_AXIS)); north.add(top); north.add(meta); north.add(legend);
            JTabbedPane tabs = new JTabbedPane(); tabs.addTab(t("wf.timeline"), new JScrollPane(new JList<>(timeline))); tabs.addTab(t("wf.data"), new JScrollPane(data)); tabs.addTab(t("wf.activityLog"), new JScrollPane(new JList<>(log)));
            tabs.setPreferredSize(new Dimension(0, 220));
            JPanel c = new JPanel(new BorderLayout(0, 6)); c.setBorder(BorderFactory.createEmptyBorder(10, 12, 10, 12));
            c.add(north, BorderLayout.NORTH); c.add(mapHolder); c.add(tabs, BorderLayout.SOUTH);
            setContentPane(c); setSize(1100, 740); setLocationRelativeTo(parent);
            timer = new Timer(3000, e -> refresh()); timer.start();
            addWindowListener(new java.awt.event.WindowAdapter() { @Override public void windowClosed(java.awt.event.WindowEvent e) { timer.stop(); } });
            refresh();
        }

        void refresh() {
            Ui.async(() -> Api.I.instance(id), i -> {
                inst = i;
                if (def == null && !s(i.get("definitionId")).isEmpty()) Ui.async(() -> Api.I.definition(s(i.get("definitionId"))), d -> { def = d; paint(); }, m -> { });
                paint(); if (!s(i.get("status")).equals("Running")) timer.stop();
            }, m -> { });
        }

        void paint() {
            if (inst == null) return;
            head.setText(s(inst.get("definitionName")) + " — " + s(inst.get("status")));
            meta.setText(t("wf.startedBy") + " " + s(inst.get("startedBy")) + " · " + s(inst.get("startedAt")));
            cancel.setEnabled(s(inst.get("status")).equals("Running") && (Api.I.username.equals(s(inst.get("startedBy"))) || "admin".equals(Api.I.role)));
            List<Object> hist = Json.arr(inst.get("history")); timeline.clear();
            Set<String> visited = new LinkedHashSet<>(), rejected = new LinkedHashSet<>();
            for (Object o : hist) {
                Map<String, Object> h = Json.obj(o);
                timeline.addElement(s(h.get("timestamp")).replace("T", " ").substring(0, Math.min(16, s(h.get("timestamp")).length())) + "   " + s(h.get("nodeName")) + " — " + s(h.get("action")) + (s(h.get("actor")).isEmpty() ? "" : "  · " + s(h.get("actor"))) + (s(h.get("comment")).isEmpty() ? "" : "   “" + s(h.get("comment")) + "”"));
                if (!s(h.get("nodeId")).isEmpty()) { visited.add(s(h.get("nodeId"))); String a = s(h.get("action")); if (a.equals("Rejected") || a.equals("Canceled") || a.equals("Escalated")) rejected.add(s(h.get("nodeId"))); }
            }
            List<String[]> rows = new ArrayList<>(); List<String> keys = new ArrayList<>();
            for (Map.Entry<String, Object> en : Json.obj(inst.get("data")).entrySet()) { rows.add(new String[]{en.getKey(), s(en.getValue())}); keys.add(en.getKey()); }
            data.fill(rows, keys);
            Ui.async(() -> Api.I.activityLog(id), ls -> { log.clear(); for (Map<String, Object> l : ls) log.addElement(s(l.get("timestamp")).replace("T", " ") + "   " + s(l.get("nodeName")) + " — " + s(l.get("action")) + "   " + (s(l.get("actor")).isEmpty() ? "system" : s(l.get("actor")))); }, m -> { });
            if (def != null) {
                Set<String> active = new LinkedHashSet<>(); if (s(inst.get("status")).equals("Running")) for (Object o : Json.arr(inst.get("currentNodeIds"))) active.add(s(o));
                if (canvas == null) { canvas = new Canvas(def, false); mapHolder.add(new JScrollPane(canvas)); mapHolder.revalidate(); }
                canvas.states.clear(); canvas.edgeStates.clear();
                for (Object o : Json.arr(def.get("nodes"))) { String nid = s(Json.obj(o).get("id")); canvas.states.put(nid, rejected.contains(nid) ? "rejected" : active.contains(nid) ? "active" : visited.contains(nid) ? "visited" : "pending"); }
                for (Object o : Json.arr(def.get("edges"))) {
                    Map<String, Object> e = Json.obj(o); String sId = s(e.get("sourceNodeId")), tId = s(e.get("targetNodeId"));
                    if (visited.contains(sId) && (visited.contains(tId) || active.contains(tId))) canvas.edgeStates.put(s(e.get("id")), rejected.contains(tId) ? "rejected" : "ok");
                }
                canvas.repaint();
            }
        }

        void cancelRun() {
            if (Ui.ask(this, t("wf.cancelConfirm"), t("wf.yes"), t("wf.no"))) Ui.async(() -> Api.I.cancelRun(id), r -> refresh(), m -> Ui.warn(this, m));
        }
    }

    // ------------------------------------------------------------------------------------ page
    public static final class WorkflowPanel extends JPanel implements Reloadable {
        final Ui.DataTable defs = new Ui.DataTable(t("wf.name"), t("wf.version"), t("wf.steps"), t("wf.status"), t("wf.description"));
        final Map<String, Ui.DataTable> inst = new LinkedHashMap<>();
        final JTabbedPane tabs = new JTabbedPane();

        public WorkflowPanel() {
            super(new BorderLayout());
            boolean canDesign = Api.I.can(s(Json.obj(SPEC.get("permissions")).get("design")));
            JButton nw = Ui.button("+ " + t("wf.new"), () -> { new Designer(this, null).setVisible(true); reload(); }, null); nw.setEnabled(canDesign);
            JButton open = Ui.button(t("wf.open"), this::open, "plain");
            JButton start = Ui.button(t("wf.run"), this::start, "plain");
            JButton del = Ui.button(t("wf.delete"), this::remove, "plain"); del.setEnabled(canDesign);
            defs.onOpen(this::open);
            JPanel flows = new JPanel(new BorderLayout()); flows.add(Ui.row(nw, open, start, del), BorderLayout.NORTH); flows.add(new JScrollPane(defs));
            tabs.addTab(t("wf.flows"), flows);
            for (String[] k : new String[][]{{"Running", "wf.running"}, {"Completed", "wf.completed"}, {"Terminated", "wf.canceled"}}) {
                Ui.DataTable tb = new Ui.DataTable(t("wf.name"), t("wf.status"), t("wf.startedBy"), t("wf.startedAt"));
                tb.onOpen(() -> { Object p = tb.selected(); if (p != null) { new InstanceDialog(this, s(Json.obj(p).get("id"))).setVisible(true); reload(); } });
                inst.put(k[0], tb); tabs.addTab(t(k[1]), new JScrollPane(tb));
            }
            add(Ui.page(t("tab.workflow"), null, tabs, null));
        }

        @Override public void reload() {
            if (Api.I.can(s(Json.obj(SPEC.get("permissions")).get("view")))) Ui.async(Api.I::definitions, rows -> {
                List<String[]> out = new ArrayList<>();
                for (Map<String, Object> d : rows) out.add(new String[]{s(d.get("name")), "v" + (d.get("version") == null ? 1 : s(d.get("version"))), String.valueOf(Json.arr(d.get("nodes")).size()), Boolean.TRUE.equals(d.get("isPublished")) ? t("wf.published") : t("wf.draft"), s(d.get("description"))});
                defs.fill(out, rows);
            }, m -> Ui.warn(this, m));
            Ui.async(Api.I::instances, rows -> {
                int tab = 1;
                for (Map.Entry<String, Ui.DataTable> en : inst.entrySet()) {
                    List<String[]> out = new ArrayList<>(); List<Object> pay = new ArrayList<>();
                    for (Map<String, Object> r : rows) if (en.getKey().equals(s(r.get("status")))) { out.add(new String[]{s(r.get("definitionName")), s(r.get("status")), s(r.get("startedBy")), s(r.get("startedAt")).replace("T", " ")}); pay.add(r); }
                    en.getValue().fill(out, pay);
                    String lab = t(en.getKey().equals("Running") ? "wf.running" : en.getKey().equals("Completed") ? "wf.completed" : "wf.canceled");
                    tabs.setTitleAt(tab++, lab + " (" + out.size() + ")");
                }
            }, m -> { });
        }

        void open() { Object p = defs.selected(); if (p != null) { new Designer(this, s(Json.obj(p).get("id"))).setVisible(true); reload(); } }
        void start() {
            Object p = defs.selected(); if (p == null) return; Map<String, Object> d = Json.obj(p);
            if (!Boolean.TRUE.equals(d.get("isPublished"))) { Ui.warn(this, t("wf.notPublished")); return; }
            Ui.async(() -> Api.I.startRun(s(d.get("id"))), i -> { new InstanceDialog(this, s(i.get("id"))).setVisible(true); reload(); }, m -> Ui.warn(this, m));
        }
        void remove() {
            Object p = defs.selected(); if (p == null) return; Map<String, Object> d = Json.obj(p);
            if (Ui.ask(this, t("wf.deleteConfirm", "name", s(d.get("name"))), t("wf.yes"), t("wf.no"))) Ui.async(() -> { Api.I.deleteDefinition(s(d.get("id"))); return 1; }, r -> reload(), m -> Ui.warn(this, m));
        }
    }
}
