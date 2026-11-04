package erp;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.FlowLayout;
import java.awt.Font;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.Supplier;
import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.SwingUtilities;
import javax.swing.SwingWorker;
import javax.swing.table.DefaultTableModel;

/** Small UI helpers shared by the screens. */
public final class Ui {
    public static final Color PRIMARY = new Color(0x25, 0x63, 0xEB);
    public static final Color DANGER = new Color(0xDC, 0x26, 0x26);
    public static final Color DIM = new Color(0x64, 0x74, 0x8B);
    public static final Color BG = new Color(0xF4, 0xF6, 0xFA);

    private Ui() { }

    /** Runs work off the UI thread; ok / err run on the UI thread. */
    public static <T> void async(Supplier<T> work, Consumer<T> ok, Consumer<String> err) {
        new SwingWorker<T, Void>() {
            @Override protected T doInBackground() { return work.get(); }
            @Override protected void done() {
                try { T r = get(); if (ok != null) ok.accept(r); }
                catch (Exception e) {
                    Throwable c = e.getCause() != null ? e.getCause() : e;
                    if (err != null) err.accept(c.getMessage() == null ? c.toString() : c.getMessage());
                }
            }
        }.execute();
    }

    public static JButton button(String text, Runnable action, String kind) {
        JButton b = new JButton(text);
        b.setFocusPainted(false);
        if ("plain".equals(kind)) { }
        else if ("danger".equals(kind)) { b.setBackground(DANGER); b.setForeground(Color.WHITE); b.setOpaque(true); b.setBorderPainted(false); }
        else if (kind == null) { b.setBackground(PRIMARY); b.setForeground(Color.WHITE); b.setOpaque(true); b.setBorderPainted(false); }
        b.addActionListener(e -> action.run());
        return b;
    }

    public static JLabel label(String text, String role) {
        JLabel l = new JLabel("<html>" + text.replace("&", "&amp;").replace("<", "&lt;") + "</html>");
        if ("title".equals(role)) l.setFont(l.getFont().deriveFont(Font.BOLD, 20f));
        if ("dim".equals(role)) l.setForeground(DIM);
        if ("error".equals(role)) l.setForeground(DANGER);
        return l;
    }

    public static JPanel row(Component... parts) {
        JPanel p = new JPanel(new FlowLayout(FlowLayout.LEADING, 8, 4));
        p.setOpaque(false);
        for (Component c : parts) p.add(c);
        return p;
    }

    public static void warn(Component parent, String text) { JOptionPane.showMessageDialog(parent, text, "", JOptionPane.WARNING_MESSAGE); }

    public static boolean ask(Component parent, String text, String yes, String no) {
        return JOptionPane.showOptionDialog(parent, text, "", JOptionPane.YES_NO_OPTION, JOptionPane.QUESTION_MESSAGE, null, new Object[]{yes, no}, no) == 0;
    }

    /** A read-only table that remembers one payload object per row. */
    public static class DataTable extends JTable {
        public final List<Object> payloads = new ArrayList<>();
        private final DefaultTableModel model;

        public DataTable(String... headers) {
            super(new DefaultTableModel(headers, 0) { @Override public boolean isCellEditable(int r, int c) { return false; } });
            model = (DefaultTableModel) getModel();
            setRowHeight(26);
            setAutoCreateRowSorter(false);
            getTableHeader().setReorderingAllowed(false);
            setSelectionMode(javax.swing.ListSelectionModel.SINGLE_SELECTION);
        }

        public void fill(List<String[]> rows, List<?> pay) {
            model.setRowCount(0);
            payloads.clear();
            for (int i = 0; i < rows.size(); i++) { model.addRow(rows.get(i)); payloads.add(pay.get(i)); }
        }

        public Object selected() { int r = getSelectedRow(); return r >= 0 && r < payloads.size() ? payloads.get(r) : null; }

        public void onOpen(Runnable r) {
            addMouseListener(new java.awt.event.MouseAdapter() {
                @Override public void mouseClicked(java.awt.event.MouseEvent e) { if (e.getClickCount() == 2) r.run(); }
            });
        }
    }

    public static JScrollPane scroll(JComponent c) { return new JScrollPane(c); }

    public static JPanel page(String title, JComponent top, JComponent center, JComponent bottom) {
        JPanel p = new JPanel(new BorderLayout(0, 8));
        p.setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
        JPanel head = new JPanel(new BorderLayout());
        head.setOpaque(false);
        head.add(label(title, "title"), BorderLayout.NORTH);
        if (top != null) head.add(top, BorderLayout.CENTER);
        p.add(head, BorderLayout.NORTH);
        if (center != null) p.add(center, BorderLayout.CENTER);
        if (bottom != null) p.add(bottom, BorderLayout.SOUTH);
        return p;
    }

    public static void later(Runnable r) { SwingUtilities.invokeLater(r); }
}
