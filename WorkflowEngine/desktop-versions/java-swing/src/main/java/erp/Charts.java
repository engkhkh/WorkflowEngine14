package erp;

import java.awt.BasicStroke;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Cursor;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.geom.RoundRectangle2D;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import javax.swing.BorderFactory;
import javax.swing.JLabel;
import javax.swing.JPanel;

/** Small painter-drawn charts for the dashboard and reports (Java2D, no extra libraries). */
public final class Charts {
    private Charts() { }
    static final Color DIM = new Color(0x64, 0x74, 0x8B), LINE = new Color(0xE2, 0xE8, 0xF0);

    public static String compact(double v) {
        double a = Math.abs(v);
        if (a >= 1e6) return String.format(java.util.Locale.ENGLISH, "%.1fM", v / 1e6);
        if (a >= 1e3) return String.format(java.util.Locale.ENGLISH, "%.1fk", v / 1e3);
        return String.valueOf(Math.round(v));
    }

    static Graphics2D g2(Graphics g) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        return g2;
    }

    static void centered(Graphics2D g, String s, double x, double y, double w, double h) {
        FontMetrics fm = g.getFontMetrics();
        g.drawString(s, (float) (x + (w - fm.stringWidth(s)) / 2), (float) (y + (h - fm.getHeight()) / 2 + fm.getAscent()));
    }

    /** A KPI tile with a coloured edge. */
    public static final class KpiCard extends JPanel {
        private final JLabel val = new JLabel("–"), hint = new JLabel(" ");
        private final Color color;
        public KpiCard(String label, Color color, Runnable click) {
            super(new BorderLayout(0, 2));
            this.color = color;
            setBackground(Color.WHITE);
            setBorder(BorderFactory.createEmptyBorder(8, 14, 8, 10));
            JLabel l = new JLabel(label); l.setForeground(DIM); l.setFont(l.getFont().deriveFont(12f));
            val.setFont(val.getFont().deriveFont(Font.BOLD, 22f)); val.setForeground(color);
            hint.setForeground(new Color(0x94, 0xA3, 0xB8)); hint.setFont(hint.getFont().deriveFont(11f));
            add(l, BorderLayout.NORTH); add(val, BorderLayout.CENTER); add(hint, BorderLayout.SOUTH);
            if (click != null) { setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)); addMouseListener(new MouseAdapter() { @Override public void mouseClicked(MouseEvent e) { click.run(); } }); }
        }
        public void set(String value, String h) { val.setText(value); hint.setText(h == null || h.isEmpty() ? " " : h); }
        public String value() { return val.getText(); }
        @Override protected void paintComponent(Graphics g) {
            Graphics2D d = g2(g);
            d.setColor(Color.WHITE); d.fill(new RoundRectangle2D.Double(0, 0, getWidth() - 1, getHeight() - 1, 10, 10));
            d.setColor(LINE); d.draw(new RoundRectangle2D.Double(0, 0, getWidth() - 1, getHeight() - 1, 10, 10));
            d.setColor(color); d.fill(new RoundRectangle2D.Double(0, 6, 4, getHeight() - 12, 4, 4));
            d.dispose();
        }
    }

    public static final class FlowItem { public final String key, label, value; public final int count; public FlowItem(String k, String l, String v, int c) { key = k; label = l; value = v; count = c; } }

    /** Request > Approval > Purchase > Inventory > Accounting > Reporting with the open documents per stage; click a stage to pick it. */
    public static final class FlowStrip extends JPanel {
        private List<FlowItem> data = new ArrayList<>();
        private String active = "";
        private final Consumer<String> picked;
        public FlowStrip(Consumer<String> picked) {
            this.picked = picked;
            setPreferredSize(new Dimension(300, 100)); setMinimumSize(new Dimension(100, 100)); setOpaque(false);
            setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
            addMouseListener(new MouseAdapter() { @Override public void mouseClicked(MouseEvent e) { click(e.getX()); } });
        }
        public void set(List<FlowItem> d) { data = d; repaint(); }
        public void click(int px) {
            if (data.isEmpty()) return;
            double w = (double) getWidth() / data.size();
            int i = (int) ((I18n.rtl() ? getWidth() - px : px) / w);
            if (i < 0 || i >= data.size()) return;
            active = active.equals(data.get(i).key) ? "" : data.get(i).key;
            picked.accept(active); repaint();
        }
        @Override protected void paintComponent(Graphics g) {
            Graphics2D d = g2(g);
            int n = data.size(); if (n == 0) { d.dispose(); return; }
            double w = (double) getWidth() / n;
            for (int i = 0; i < n; i++) {
                FlowItem it = data.get(i);
                double x = I18n.rtl() ? getWidth() - (i + 1) * w : i * w;
                RoundRectangle2D r = new RoundRectangle2D.Double(x + 4, 4, w - 8, getHeight() - 8, 10, 10);
                boolean on = it.key.equals(active);
                d.setColor(on ? new Color(0xEF, 0xF6, 0xFF) : Color.WHITE); d.fill(r);
                d.setColor(on ? new Color(0x25, 0x63, 0xEB) : LINE); d.setStroke(new BasicStroke(1.5f)); d.draw(r);
                Font base = getFont();
                d.setFont(base.deriveFont(Font.BOLD, 20f)); d.setColor(new Color(0x0F, 0x17, 0x2A));
                centered(d, String.valueOf(it.count), x + 4, 8, w - 8, 28);
                d.setFont(base.deriveFont(Font.PLAIN, 12f)); d.setColor(DIM);
                centered(d, it.label, x + 4, 38, w - 8, 18);
                centered(d, it.value, x + 4, 58, w - 8, 18);
            }
            d.dispose();
        }
    }

    /** Grouped bars: sales vs purchases per month. */
    public static final class TrendChart extends JPanel {
        private List<Bi.Month> pts = new ArrayList<>();
        private final String a, b;
        private static final String[] EN = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
        private static final String[] AR = {"يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"};
        public TrendChart(String a, String b) { this.a = a; this.b = b; setPreferredSize(new Dimension(400, 200)); setOpaque(false); }
        public void set(List<Bi.Month> p) { pts = p; repaint(); }
        @Override protected void paintComponent(Graphics g) {
            Graphics2D d = g2(g);
            int W = getWidth(), H = getHeight(), L = 46, R = 8, T = 22, B = 26;
            double mx = 1; for (Bi.Month q : pts) mx = Math.max(mx, Math.max(q.sales, q.purchases));
            d.setFont(getFont().deriveFont(11f));
            for (int k = 0; k < 5; k++) {
                double y = T + (H - T - B) * (1 - k / 4.0);
                d.setColor(LINE); d.setStroke(new BasicStroke(1f)); d.drawLine(L, (int) y, W - R, (int) y);
                d.setColor(DIM); String s = compact(mx * k / 4); d.drawString(s, L - 6 - d.getFontMetrics().stringWidth(s), (float) y + 4);
            }
            int n = Math.max(pts.size(), 1); double slot = (double) (W - L - R) / n;
            for (int i = 0; i < pts.size(); i++) {
                Bi.Month q = pts.get(i);
                int j = I18n.rtl() ? n - 1 - i : i;
                double x0 = L + j * slot, bw = slot * 0.32;
                double[] v = {q.sales, q.purchases}; Color[] c = {new Color(0x0E, 0xA5, 0xE9), new Color(0x8B, 0x5C, 0xF6)};
                for (int k = 0; k < 2; k++) {
                    double h = (H - T - B) * v[k] / mx;
                    d.setColor(c[k]); d.fill(new RoundRectangle2D.Double(x0 + slot * 0.15 + k * (bw + 2), H - B - h, bw, Math.max(h, 0), 3, 3));
                }
                d.setColor(DIM); centered(d, (I18n.rtl() ? AR : EN)[q.month - 1], x0, H - B + 4, slot, 16);
            }
            double x = I18n.rtl() ? L + 4 : W - R - 250;
            String[] labs = {a, b}; Color[] c = {new Color(0x0E, 0xA5, 0xE9), new Color(0x8B, 0x5C, 0xF6)};
            for (int k = 0; k < 2; k++) {
                d.setColor(c[k]); d.fill(new RoundRectangle2D.Double(x, 5, 10, 10, 2, 2));
                d.setColor(DIM); d.drawString(labs[k], (float) x + 14, 14); x += 125;
            }
            d.dispose();
        }
    }

    public static final class BarRow { public final String label, color, text; public final double value; public BarRow(String l, double v, String c, String t) { label = l; value = v; color = c; text = t; } }

    /** Horizontal bars with a label at the start and a value at the end. */
    public static final class HBars extends JPanel {
        private List<BarRow> rows = new ArrayList<>();
        public HBars() { setOpaque(false); setPreferredSize(new Dimension(300, 40)); }
        public void set(List<BarRow> r) { rows = r; setPreferredSize(new Dimension(300, Math.max(40, 26 * r.size() + 8))); revalidate(); repaint(); }
        @Override protected void paintComponent(Graphics g) {
            Graphics2D d = g2(g);
            if (rows.isEmpty()) { d.setColor(DIM); centered(d, I18n.t("common.noData"), 0, 0, getWidth(), getHeight()); d.dispose(); return; }
            double mx = 0; for (BarRow r : rows) mx = Math.max(mx, r.value); if (mx <= 0) mx = 1;
            double lw = Math.min(150, getWidth() * 0.34); boolean rtl = I18n.rtl();
            FontMetrics fm = d.getFontMetrics();
            for (int i = 0; i < rows.size(); i++) {
                BarRow r = rows.get(i); double y = 4 + i * 26;
                String lab = r.label;
                while (fm.stringWidth(lab) > lw - 10 && lab.length() > 2) lab = lab.substring(0, lab.length() - 2) + "…";
                d.setColor(new Color(0x0F, 0x17, 0x2A));
                float tx = rtl ? (float) (getWidth() - lw + 2) : (float) (lw - 8 - fm.stringWidth(lab));
                d.drawString(lab, tx, (float) y + 15);
                double span = getWidth() - lw - 70, bw = Math.max(3, span * r.value / mx), x = rtl ? getWidth() - lw - bw : lw;
                d.setColor(Color.decode(r.color)); d.fill(new RoundRectangle2D.Double(x, y + 3, bw, 14, 4, 4));
                d.setColor(DIM);
                if (rtl) d.drawString(r.text, (float) (x - 6 - fm.stringWidth(r.text)), (float) y + 15); else d.drawString(r.text, (float) (x + bw + 6), (float) y + 15);
            }
            d.dispose();
        }
    }
}
