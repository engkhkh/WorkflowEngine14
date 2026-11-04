package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.FlowLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import javax.swing.BorderFactory;
import javax.swing.DefaultListModel;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;

/** Typed forms for workflow steps and the notes / files panel of a record. */
final class Forms {
    private Forms() { }

    private static final Pattern NEGATIVE = Pattern.compile("reject|cancel|deny|return|out of stock|write off", Pattern.CASE_INSENSITIVE);
    static boolean isNegative(String decision) { return NEGATIVE.matcher(decision == null ? "" : decision).find(); }

    /** One editor per field of a form definition {title, fields:[{key,label,type,required,readOnly,options,placeholder}]}. */
    static final class TypedForm extends JPanel {
        private final List<Map<String, Object>> fields = new ArrayList<>();
        private final Map<String, JComponent> w = new LinkedHashMap<>();
        private final Map<String, List<String>> optValues = new LinkedHashMap<>();

        TypedForm(Map<String, Object> form) {
            super(new GridBagLayout());
            GridBagConstraints g = new GridBagConstraints();
            g.insets = new Insets(3, 3, 3, 3); g.fill = GridBagConstraints.HORIZONTAL; g.gridy = 0;
            for (Object o : Json.arr(form == null ? null : form.get("fields"))) {
                Map<String, Object> f = Json.obj(o);
                fields.add(f);
                String key = Json.str(f.get("key")), ty = f.get("type") == null ? "Text" : Json.str(f.get("type"));
                boolean ro = Boolean.TRUE.equals(f.get("readOnly"));
                JComponent c;
                switch (ty) {
                    case "TextArea": { JTextArea a = new JTextArea(3, 24); a.setEditable(!ro); a.setLineWrap(true); c = new JScrollPane(a); w.put(key, a); break; }
                    case "Select": {
                        JComboBox<String> cb = new JComboBox<>();
                        List<String> vals = new ArrayList<>();
                        cb.addItem(t("common.select")); vals.add(null);
                        for (Object op : Json.arr(f.get("options"))) { Map<String, Object> m = Json.obj(op); cb.addItem(Json.str(m.get("label")).isEmpty() ? Json.str(m.get("value")) : Json.str(m.get("label"))); vals.add(Json.str(m.get("value"))); }
                        cb.setEnabled(!ro); optValues.put(key, vals); w.put(key, cb); c = cb; break;
                    }
                    case "Checkbox": { JCheckBox cb = new JCheckBox(f.get("placeholder") != null ? Json.str(f.get("placeholder")) : t("common.yes")); cb.setEnabled(!ro); w.put(key, cb); c = cb; break; }
                    case "Date": { JTextField tf = new JTextField(12); tf.setEditable(!ro); tf.setToolTipText("yyyy-MM-dd"); w.put(key, tf); c = tf; break; }
                    default: { JTextField tf = new JTextField(24); tf.setEditable(!ro); w.put(key, tf); c = tf; }
                }
                g.gridx = 0; g.weightx = 0;
                add(new JLabel(Json.str(f.get("label")).isEmpty() ? key : Json.str(f.get("label")) + (Boolean.TRUE.equals(f.get("required")) && !ro ? " *" : "")), g);
                g.gridx = 1; g.weightx = 1; add(c, g); g.gridy++;
            }
        }

        boolean isEmpty() { return fields.isEmpty(); }

        void setValues(Map<String, Object> data) {
            for (Map<String, Object> f : fields) {
                String key = Json.str(f.get("key")), ty = f.get("type") == null ? "Text" : Json.str(f.get("type"));
                Object v = data.get(key);
                if (v == null) continue;
                JComponent c = w.get(key);
                switch (ty) {
                    case "TextArea": ((JTextArea) c).setText(String.valueOf(v)); break;
                    case "Select": { int i = optValues.get(key).indexOf(String.valueOf(v)); ((JComboBox<?>) c).setSelectedIndex(Math.max(0, i)); break; }
                    case "Checkbox": ((JCheckBox) c).setSelected(Boolean.TRUE.equals(v) || List.of("true", "1", "yes").contains(String.valueOf(v).toLowerCase())); break;
                    default: ((JTextField) c).setText(v instanceof Number ? Json.write(v) : String.valueOf(v));
                }
            }
        }

        private Object value(Map<String, Object> f) {
            String key = Json.str(f.get("key")), ty = f.get("type") == null ? "Text" : Json.str(f.get("type"));
            JComponent c = w.get(key);
            switch (ty) {
                case "TextArea": return ((JTextArea) c).getText();
                case "Select": return optValues.get(key).get(((JComboBox<?>) c).getSelectedIndex());
                case "Checkbox": return ((JCheckBox) c).isSelected();
                default: {
                    String txt = ((JTextField) c).getText().trim();
                    if ("Number".equals(ty)) {
                        if (txt.isEmpty()) return null;
                        try { return Pattern.matches("-?\\d+", txt) ? (Object) Long.parseLong(txt) : (Object) Double.parseDouble(txt); } catch (NumberFormatException e) { return null; }
                    }
                    if ("Date".equals(ty) && txt.isEmpty()) return null;
                    return txt;
                }
            }
        }

        boolean missing() {
            for (Map<String, Object> f : fields) {
                if (!Boolean.TRUE.equals(f.get("required")) || Boolean.TRUE.equals(f.get("readOnly"))) continue;
                Object v = value(f);
                if (v == null || "".equals(v)) return true;
            }
            return false;
        }

        /** Only the fields this step owns (read-only echoes of earlier data are not sent back). */
        Map<String, Object> values() {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map<String, Object> f : fields) {
                if (Boolean.TRUE.equals(f.get("readOnly"))) continue;
                Object v = value(f);
                if (v != null) out.put(Json.str(f.get("key")), v);
            }
            return out;
        }
    }

    /** Notes and file attachments of one record; the server checks the caller's module privileges. */
    static final class Chatter extends JPanel {
        private static final long MAX = 4L * 1024 * 1024;
        private final String m, k, rid;
        private final DefaultListModel<Map<String, Object>> notes = new DefaultListModel<>(), files = new DefaultListModel<>();
        private final JList<Map<String, Object>> notesL = new JList<>(notes), filesL = new JList<>(files);
        private final JTextArea text = new JTextArea(3, 30);
        private final JLabel err = Ui.label("", "error");
        private final JTabbedPane tabs = new JTabbedPane();

        Chatter(String module, String kind, String rid) {
            super(new BorderLayout(0, 6));
            this.m = module; this.k = kind; this.rid = rid;
            notesL.setCellRenderer((l, n, i, sel, foc) -> {
                JLabel lb = new JLabel("<html><b>" + esc(Json.str(n.get("author"))) + "</b> · " + esc(Json.str(n.get("createdAt")).replace('T', ' ').substring(0, Math.min(16, Json.str(n.get("createdAt")).length()))) + "<br>"
                        + esc(Json.str(n.get("text"))).replace("\n", "<br>") + "</html>");
                lb.setOpaque(true); lb.setBorder(BorderFactory.createEmptyBorder(4, 6, 4, 6));
                lb.setBackground(sel ? l.getSelectionBackground() : l.getBackground());
                lb.setForeground(Boolean.TRUE.equals(n.get("system")) ? Color.GRAY : l.getForeground());
                return lb;
            });
            filesL.setCellRenderer((l, f, i, sel, foc) -> {
                long kb = Math.max(1, Math.round(((Number) (f.get("size") == null ? 0 : f.get("size"))).doubleValue() / 1024));
                JLabel lb = new JLabel(Json.str(f.get("name")) + "   —   " + kb + " KB · " + Json.str(f.get("author")));
                lb.setOpaque(true); lb.setBorder(BorderFactory.createEmptyBorder(4, 6, 4, 6));
                lb.setBackground(sel ? l.getSelectionBackground() : l.getBackground());
                return lb;
            });
            JPanel np = new JPanel(new BorderLayout(0, 6));
            np.add(new JScrollPane(notesL), BorderLayout.CENTER);
            JPanel nsouth = new JPanel(new BorderLayout(0, 4));
            text.setLineWrap(true);
            nsouth.add(new JScrollPane(text), BorderLayout.CENTER);
            JPanel nrow = new JPanel(new FlowLayout(FlowLayout.LEADING));
            nrow.add(Ui.button(t("collab.send"), this::send, null)); nrow.add(Ui.button(t("collab.delete"), this::delNote, "ghost"));
            nsouth.add(nrow, BorderLayout.SOUTH);
            np.add(nsouth, BorderLayout.SOUTH);
            JPanel fp = new JPanel(new BorderLayout(0, 6));
            fp.add(new JScrollPane(filesL), BorderLayout.CENTER);
            JPanel fs = new JPanel(new BorderLayout());
            fs.add(Ui.label(t("collab.maxSize"), "dim"), BorderLayout.NORTH);
            JPanel frow = new JPanel(new FlowLayout(FlowLayout.LEADING));
            frow.add(Ui.button(t("collab.choose"), this::pick, null)); frow.add(Ui.button(t("collab.download"), this::download, "ghost")); frow.add(Ui.button(t("collab.delete"), this::delFile, "ghost"));
            fs.add(frow, BorderLayout.SOUTH);
            fp.add(fs, BorderLayout.SOUTH);
            tabs.addTab(t("collab.notes"), np);
            tabs.addTab(t("collab.files"), fp);
            add(tabs); add(err, BorderLayout.SOUTH);
            load();
        }

        private static String esc(String s) { return s.replace("&", "&amp;").replace("<", "&lt;"); }

        void load() {
            Ui.async(() -> Api.I.notes(m, k, rid), l -> {
                notes.clear();
                List<Map<String, Object>> sorted = new ArrayList<>(l);
                sorted.sort((a, b) -> Json.str(b.get("createdAt")).compareTo(Json.str(a.get("createdAt"))));
                sorted.forEach(notes::addElement);
                tabs.setTitleAt(0, t("collab.notes") + " (" + sorted.size() + ")");
            }, e -> err.setText(e));
            Ui.async(() -> Api.I.files(m, k, rid), l -> { files.clear(); l.forEach(files::addElement); tabs.setTitleAt(1, t("collab.files") + " (" + l.size() + ")"); }, e -> { });
        }

        private void send() {
            String txt = text.getText().trim();
            if (txt.isEmpty()) return;
            err.setText("");
            Ui.async(() -> { Api.I.addNote(m, k, rid, txt); return Boolean.TRUE; }, r -> { text.setText(""); load(); }, e -> err.setText(e));
        }

        private void delNote() {
            Map<String, Object> n = notesL.getSelectedValue();
            if (n == null || Boolean.TRUE.equals(n.get("system"))) return;
            Ui.async(() -> { Api.I.deleteNote(Json.str(n.get("id"))); return Boolean.TRUE; }, r -> load(), e -> err.setText(e));
        }

        private void pick() {
            JFileChooser fc = new JFileChooser();
            fc.setMultiSelectionEnabled(true);
            if (fc.showOpenDialog(this) != JFileChooser.APPROVE_OPTION) return;
            for (File f : fc.getSelectedFiles()) {
                if (f.length() > MAX) { err.setText(t("collab.tooBig").replace("{name}", f.getName())); continue; }
                try {
                    String b64 = Base64.getEncoder().encodeToString(Files.readAllBytes(f.toPath()));
                    String ct = Files.probeContentType(f.toPath());
                    Ui.async(() -> { Api.I.addFile(m, k, rid, f.getName(), ct == null ? "application/octet-stream" : ct, b64); return Boolean.TRUE; }, r -> load(), e -> err.setText(e));
                } catch (Exception ex) { err.setText(String.valueOf(ex.getMessage())); }
            }
        }

        private void download() {
            Map<String, Object> f = filesL.getSelectedValue();
            if (f == null) return;
            JFileChooser fc = new JFileChooser();
            fc.setSelectedFile(new File(Json.str(f.get("name"))));
            if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
            File dest = fc.getSelectedFile();
            Ui.async(() -> { byte[] b = Api.I.fileBytes(Json.str(f.get("id"))); try { Files.write(dest.toPath(), b); } catch (java.io.IOException e) { throw new Api.ApiException(e.getMessage()); } return Boolean.TRUE; }, r -> { }, e -> err.setText(e));
        }

        private void delFile() {
            Map<String, Object> f = filesL.getSelectedValue();
            if (f == null) return;
            Ui.async(() -> { Api.I.deleteFile(Json.str(f.get("id"))); return Boolean.TRUE; }, r -> load(), e -> err.setText(e));
        }
    }
}
