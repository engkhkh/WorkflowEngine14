package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.GridLayout;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.DefaultComboBoxModel;
import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JDialog;
import javax.swing.JEditorPane;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSpinner;
import javax.swing.JTabbedPane;
import javax.swing.JTextField;
import javax.swing.SpinnerNumberModel;

/** Point of sale: the till, shifts and sales history with receipts (port of the portal's /pos/terminal, /pos/shifts, /pos/sales). */
public final class Pos {
    private Pos() { }

    // ------------------------------------------------------------------ helpers
    static double num(Object o) {
        if (o instanceof Number) return ((Number) o).doubleValue();
        try { return o == null || o.toString().isEmpty() ? 0 : Double.parseDouble(o.toString()); } catch (NumberFormatException e) { return 0; }
    }
    static String s(Object o) { return o == null ? "" : o instanceof Double && ((Double) o) == Math.rint((Double) o) ? String.valueOf(((Double) o).longValue()) : String.valueOf(o); }
    static double r2(double n) { return Math.round((n + 1e-9) * 100.0) / 100.0; }
    static String money(double v) { return String.format(Locale.ENGLISH, "%,.2f", v); }
    static String esc(String x) { return x.replace("&", "&amp;").replace("<", "&lt;"); }
    static Map<String, Object> data(Map<String, Object> r) { return Json.obj(r.get("data")); }

    static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    static boolean looksOffline(String m) {
        String l = m == null ? "" : m.toLowerCase();
        for (String k : new String[]{"refused", "unreachable", "timed out", "connect", "network", "unresolved", "nodename"}) if (l.contains(k)) return true;
        return false;
    }

    // ------------------------------------------------------------------ pricing (same rules the server applies at checkout)
    static final class Priced {
        final List<Map<String, Object>> lines = new ArrayList<>();
        double subtotal, discount, tax, total;
    }

    static Map<String, Object> defaults() { return map("taxRate", 15L, "pricesIncludeTax", Boolean.TRUE, "pointsPerCurrency", 1L, "pointValue", 0.05, "requireShift", Boolean.TRUE, "allowNegativeStock", Boolean.FALSE, "maxDiscountPct", 20L, "receiptHeader", "", "receiptFooter", ""); }

    static double[] bestPromo(List<Map<String, Object>> promos, String sku, String category, double qty, double price, String[] codeOut) {
        double best = 0;
        String today = LocalDate.now().toString();
        for (Map<String, Object> pr : promos) {
            String st = s(pr.get("status"));
            if (!st.isEmpty() && !st.equals("Active")) continue;
            Map<String, Object> p = data(pr);
            if (!s(p.get("from")).isEmpty() && today.compareTo(s(p.get("from")).substring(0, Math.min(10, s(p.get("from")).length()))) < 0) continue;
            if (!s(p.get("to")).isEmpty() && today.compareTo(s(p.get("to")).substring(0, Math.min(10, s(p.get("to")).length()))) > 0) continue;
            String scope = s(p.get("scope")).isEmpty() ? "all" : s(p.get("scope")), target = s(p.get("target")).toLowerCase();
            if (scope.equals("sku") && !target.equals(sku.toLowerCase())) continue;
            if (scope.equals("category") && !target.equals(category.toLowerCase())) continue;
            double gross = price * qty, v = num(p.get("value")), d = 0;
            String ty = s(p.get("type"));
            if (ty.equals("pct")) d = gross * v / 100;
            else if (ty.equals("amount")) d = Math.min(gross, v * qty);
            else if (ty.equals("qty") && qty >= Math.max(1, num(p.get("minQty")))) d = gross * v / 100;
            if (d > best) { best = d; codeOut[0] = s(pr.get("code")); }
        }
        return new double[]{r2(best)};
    }

    static Priced priceCart(List<Map<String, Object>> items, List<Map<String, Object>> products, List<Map<String, Object>> promos, Map<String, Object> customer, double orderPct, Map<String, Object> cfgIn) {
        Map<String, Object> cfg = defaults();
        if (cfgIn != null) cfg.putAll(cfgIn);
        double custPct = customer == null ? 0 : num(data(customer).get("discountPct"));
        Priced out = new Priced();
        for (Map<String, Object> it : items) {
            String sku = s(it.get("sku"));
            Map<String, Object> p = null;
            for (Map<String, Object> x : products) if (s(x.get("code")).equalsIgnoreCase(sku)) { p = x; break; }
            if (p == null) continue;
            Map<String, Object> d = data(p);
            double qty = num(it.get("qty")), price = num(d.get("price")), gross = r2(price * qty);
            String[] code = {""};
            double pd = bestPromo(promos, s(p.get("code")), s(d.get("category")), qty, price, code)[0];
            double rest = gross - pd;
            double manual = r2(rest * num(it.get("discountPct")) / 100); rest -= manual;
            double cust = r2(rest * custPct / 100); rest -= cust;
            double ord = r2(rest * orderPct / 100); rest -= ord;
            double net = r2(rest), tax;
            Object tr = d.get("taxRate");
            double rate = tr == null || s(tr).isEmpty() ? num(cfg.get("taxRate")) : num(tr);
            if (Boolean.TRUE.equals(cfg.get("pricesIncludeTax"))) tax = r2(net - net / (1 + rate / 100));
            else { tax = r2(net * rate / 100); net = r2(net + tax); }
            out.lines.add(map("sku", p.get("code"), "name", s(d.get("name")).isEmpty() ? s(p.get("code")) : s(d.get("name")), "qty", qty, "price", price, "gross", gross, "promo", pd, "promoCode", code[0],
                    "discount", r2(pd + manual + cust + ord), "tax", tax, "total", net, "discountPct", num(it.get("discountPct"))));
        }
        for (Map<String, Object> l : out.lines) { out.subtotal += num(l.get("gross")); out.discount += num(l.get("discount")); out.tax += num(l.get("tax")); out.total += num(l.get("total")); }
        out.subtotal = r2(out.subtotal); out.discount = r2(out.discount); out.tax = r2(out.tax); out.total = r2(out.total);
        return out;
    }

    // ------------------------------------------------------------------ shared state
    static final class State {
        List<Map<String, Object>> products = new ArrayList<>(), categories = new ArrayList<>(), customers = new ArrayList<>(), promos = new ArrayList<>(), registers = new ArrayList<>();
        Map<String, Object> settings = defaults();
        Map<String, Object> shift;
        Map<String, Double> stock = new LinkedHashMap<>();
        boolean loaded;

        State load() {
            products = Api.I.posRecords("product", "");
            categories = safe("category"); customers = safe("customer"); promos = safe("promotion"); registers = safe("register");
            Map<String, Object> cfg = defaults();
            for (Map<String, Object> x : safe("setting")) if ("pos".equals(s(x.get("code")))) cfg.putAll(data(x));
            settings = cfg;
            shift = Api.I.posShift();
            stock = new LinkedHashMap<>();
            for (Map<String, Object> x : safe("stock")) stock.put(s(data(x).get("sku")), num(data(x).get("qty")));
            loaded = true;
            return this;
        }

        private static List<Map<String, Object>> safe(String kind) {
            try { return Api.I.posRecords(kind, ""); } catch (Api.ApiException e) { if (e.offline) throw e; return new ArrayList<>(); }
        }
    }

    // ------------------------------------------------------------------ receipt
    static String receiptHtml(Map<String, Object> sale, State st) {
        Map<String, Object> d = data(sale);
        StringBuilder rows = new StringBuilder();
        for (Object o : Json.arr(d.get("lines"))) {
            Map<String, Object> l = Json.obj(o);
            rows.append("<tr><td>").append(esc(s(l.get("name")))).append("<br><small>").append(s(l.get("qty"))).append(" × ").append(money(num(l.get("price"))))
                .append(num(l.get("discount")) != 0 ? " · −" + money(num(l.get("discount"))) : "").append("</small></td><td align='right'>").append(money(num(l.get("total")))).append("</td></tr>");
        }
        StringBuilder pays = new StringBuilder();
        for (Object o : Json.arr(d.get("payments"))) pays.append("<tr><td>").append(t("pos.pay." + s(Json.obj(o).get("method")))).append("</td><td align='right'>").append(money(num(Json.obj(o).get("amount")))).append("</td></tr>");
        String title = "Return".equals(s(d.get("type"))) ? t("pos.rc.return") : t("pos.rc.receipt");
        StringBuilder h = new StringBuilder("<html><body style='font-family:monospace;font-size:11px'><div align='center'><b>" + esc(Api.I.tenant) + "</b><br>" + esc(s(st.settings.get("receiptHeader"))) + "</div><hr>");
        h.append("<table width='100%'><tr><td>").append(title).append("</td><td align='right'>").append(esc(s(sale.get("code")))).append("</td></tr>");
        if (!s(sale.get("parent")).isEmpty()) h.append("<tr><td>").append(t("pos.rc.original")).append("</td><td align='right'>").append(esc(s(sale.get("parent")))).append("</td></tr>");
        String at = s(sale.get("createdAt"));
        h.append("<tr><td>").append(esc(at.substring(0, Math.min(16, at.length())).replace('T', ' '))).append("</td><td align='right'>").append(esc(s(d.get("cashier")))).append("</td></tr>");
        if (!s(d.get("customerName")).isEmpty()) h.append("<tr><td>").append(t("pos.customer")).append("</td><td align='right'>").append(esc(s(d.get("customerName")))).append("</td></tr>");
        h.append("</table><hr><table width='100%'>").append(rows).append("</table><hr><table width='100%'>");
        if (num(d.get("subtotal")) != 0) h.append("<tr><td>").append(t("pos.subtotal")).append("</td><td align='right'>").append(money(num(d.get("subtotal")))).append("</td></tr>");
        if (num(d.get("discount")) != 0) h.append("<tr><td>").append(t("pos.discount")).append("</td><td align='right'>−").append(money(num(d.get("discount")))).append("</td></tr>");
        h.append("<tr><td>").append(t("pos.tax")).append("</td><td align='right'>").append(money(num(d.get("tax")))).append("</td></tr><tr><td><b>").append(t("pos.total")).append("</b></td><td align='right'><b>")
            .append(money(num(d.get("total")))).append("</b></td></tr>").append(pays);
        if (num(d.get("change")) != 0) h.append("<tr><td>").append(t("pos.change")).append("</td><td align='right'>").append(money(num(d.get("change")))).append("</td></tr>");
        if (num(d.get("earned")) != 0) h.append("<tr><td>").append(t("pos.pointsEarned")).append("</td><td align='right'>").append(s(d.get("earned"))).append("</td></tr>");
        h.append("</table><hr><div align='center'>").append(esc(s(st.settings.get("receiptFooter")))).append("<br><small>").append(t("pos.rc.thanks")).append("</small></div></body></html>");
        return h.toString();
    }

    static void showReceipt(Component parent, Map<String, Object> sale, State st, String title) {
        JDialog d = new JDialog(javax.swing.SwingUtilities.getWindowAncestor(parent), title, java.awt.Dialog.ModalityType.APPLICATION_MODAL);
        JEditorPane view = new JEditorPane("text/html", receiptHtml(sale, st));
        view.setEditable(false);
        d.add(new JScrollPane(view), BorderLayout.CENTER);
        JPanel row = Ui.row(Ui.button(t("pos.print"), () -> { try { view.print(); } catch (Exception ex) { Ui.warn(d, String.valueOf(ex.getMessage())); } }, "plain"), Ui.button(t("common.ok"), d::dispose, null));
        d.add(row, BorderLayout.SOUTH);
        d.setSize(380, 560);
        d.setLocationRelativeTo(parent);
        d.setVisible(true);
    }

    static JSpinner numSpin(double v, double max) { return new JSpinner(new SpinnerNumberModel(v, 0.0, max, 1.0)); }
    static double val(JSpinner s) { return ((Number) s.getValue()).doubleValue(); }

    static JComboBox<Item> combo() { return new JComboBox<>(); }

    /** A combo-box entry: text + value. */
    static final class Item {
        final String text; final String value;
        Item(String text, String value) { this.text = text; this.value = value; }
        @Override public String toString() { return text; }
    }
    static String sel(JComboBox<Item> c) { Item i = (Item) c.getSelectedItem(); return i == null ? "" : i.value; }
    static void setSel(JComboBox<Item> c, String v) { for (int i = 0; i < c.getItemCount(); i++) if (c.getItemAt(i).value.equals(v)) { c.setSelectedIndex(i); return; } if (c.getItemCount() > 0) c.setSelectedIndex(0); }

    // ------------------------------------------------------------------ offline queue / held baskets (small files in the user's home)
    static final Path QUEUE = Path.of(System.getProperty("user.home"), ".workflow_erp_swing_posqueue.json");
    static Path heldFile() { return Path.of(System.getProperty("user.home"), ".workflow_erp_swing_poshold_" + Api.I.username.replaceAll("[^A-Za-z0-9]", "_") + ".json"); }
    static List<Object> readList(Path p) { try { return Json.arr(Json.parse(Files.readString(p, StandardCharsets.UTF_8))); } catch (Exception e) { return new ArrayList<>(); } }
    static void writeList(Path p, List<Object> l) { try { Files.writeString(p, Json.write(l), StandardCharsets.UTF_8); } catch (Exception ignored) { /* optional */ } }

    // ------------------------------------------------------------------ the till
    public static final class TillPanel extends JPanel {
        final State st;
        final Runnable onShift;
        final List<Map<String, Object>> cart = new ArrayList<>();
        String customerCode = "";
        double orderPct;
        boolean busy;
        final JLabel banner = Ui.label("", "error"), queueLbl = Ui.label("", "dim"), shiftLbl = Ui.label("", "dim"), custInfo = Ui.label("", "dim"), tot = new JLabel();
        final JButton queueBtn, holdB, recallB, clearB, payB;
        final JPanel gate = new JPanel(), till = new JPanel(new BorderLayout(10, 0));
        final JComboBox<Item> reg = combo(), cat = combo(), cust = combo();
        final JSpinner floatBox = numSpin(0, 1e9), lineDisc = new JSpinner(new SpinnerNumberModel(0, 0, 100, 1)), order = new JSpinner(new SpinnerNumberModel(0, 0, 100, 1));
        final JTextField q = new JTextField();
        final DefaultListModel<Item> gridModel = new DefaultListModel<>();
        final JList<Item> grid = new JList<>(gridModel);
        final Ui.DataTable lines = new Ui.DataTable(t("pos.product"), "#", t("pos.total"));
        String lastReceipt = "";
        boolean updating;

        public TillPanel(State st, Runnable onShift) {
            super(new BorderLayout(0, 8));
            this.st = st; this.onShift = onShift;
            setOpaque(false);
            queueBtn = Ui.button(t("pos.syncNow"), this::flush, "plain");
            holdB = Ui.button(t("pos.hold"), this::hold, "plain");
            recallB = Ui.button(t("pos.recall"), this::recall, "plain");
            clearB = Ui.button(t("pos.clear"), this::clear, "plain");
            payB = Ui.button(t("pos.pay"), () -> pay(false), null);

            JPanel top = new JPanel(new BorderLayout()); top.setOpaque(false);
            top.add(banner, BorderLayout.NORTH);
            JPanel qrow = new JPanel(new BorderLayout()); qrow.setOpaque(false); qrow.add(queueLbl); qrow.add(queueBtn, BorderLayout.EAST);
            top.add(qrow, BorderLayout.SOUTH);
            add(top, BorderLayout.NORTH);

            gate.setLayout(new BoxLayout(gate, BoxLayout.Y_AXIS));
            gate.setBackground(Color.WHITE);
            gate.setBorder(BorderFactory.createEmptyBorder(16, 16, 16, 16));
            JPanel gf = new JPanel(new GridLayout(0, 2, 8, 6)); gf.setOpaque(false); gf.setMaximumSize(new Dimension(420, 70));
            gf.add(new JLabel(t("pos.register"))); gf.add(reg); gf.add(new JLabel(t("pos.shift.opening"))); gf.add(floatBox);
            for (Component c : new Component[]{Ui.label(t("pos.shift.none"), "title"), Ui.label(t("pos.shift.noneHint"), "dim"), gf, Ui.button(t("pos.shift.open"), () -> openShift(val(floatBox)), null)}) {
                ((javax.swing.JComponent) c).setAlignmentX(Component.LEFT_ALIGNMENT);
                gate.add(c); gate.add(Box.createVerticalStrut(6));
            }

            q.putClientProperty("JTextField.placeholderText", t("pos.scan"));
            q.setToolTipText(t("pos.scan"));
            q.getDocument().addDocumentListener(new javax.swing.event.DocumentListener() {
                public void insertUpdate(javax.swing.event.DocumentEvent e) { fillProducts(); }
                public void removeUpdate(javax.swing.event.DocumentEvent e) { fillProducts(); }
                public void changedUpdate(javax.swing.event.DocumentEvent e) { fillProducts(); }
            });
            q.addActionListener(e -> scan());
            cat.addActionListener(e -> { if (!updating) fillProducts(); });
            JPanel bar = new JPanel(new BorderLayout(8, 0)); bar.setOpaque(false);
            bar.add(q); JPanel br = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0)); br.setOpaque(false); br.add(cat); br.add(shiftLbl); bar.add(br, BorderLayout.EAST);
            grid.setLayoutOrientation(JList.HORIZONTAL_WRAP);
            grid.setVisibleRowCount(-1);
            grid.setFixedCellWidth(176); grid.setFixedCellHeight(86);
            grid.setCellRenderer((list, v, i, sel, foc) -> {
                JLabel l = new JLabel("<html><b>" + esc(v.text.split("\n")[0]) + "</b><br>" + esc(v.text.split("\n")[1]) + "<br><small>" + esc(v.text.split("\n")[2]) + "</small></html>");
                l.setOpaque(true); l.setBackground(sel ? new Color(0xDB, 0xEA, 0xFE) : Color.WHITE);
                l.setEnabled(!v.value.startsWith("!"));
                l.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createEmptyBorder(3, 3, 3, 3), BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(0xE2, 0xE8, 0xF0)), BorderFactory.createEmptyBorder(6, 8, 6, 8))));
                return l;
            });
            grid.addMouseListener(new java.awt.event.MouseAdapter() {
                @Override public void mouseClicked(java.awt.event.MouseEvent e) {
                    int i = grid.locationToIndex(e.getPoint());
                    if (i >= 0 && grid.getCellBounds(i, i).contains(e.getPoint())) { String v = gridModel.get(i).value; if (!v.startsWith("!")) add(v); }
                }
            });
            JPanel left = new JPanel(new BorderLayout(0, 6)); left.setOpaque(false);
            left.add(bar, BorderLayout.NORTH); left.add(new JScrollPane(grid));

            cust.addActionListener(e -> { if (!updating) { customerCode = sel(cust); repaintCart(); } });
            lines.getSelectionModel().addListSelectionListener(e -> { if (!e.getValueIsAdjusting() && !updating) syncLineDisc(); });
            lineDisc.addChangeListener(e -> { if (!updating) setLineDisc(lines.getSelectedRow(), ((Number) lineDisc.getValue()).intValue()); });
            order.addChangeListener(e -> { if (!updating) { orderPct = Math.min(((Number) order.getValue()).intValue(), (int) num(st.settings.get("maxDiscountPct"))); repaintCart(); } });
            JPanel right = new JPanel(new BorderLayout(0, 6));
            right.setBackground(Color.WHITE);
            right.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(0xE2, 0xE8, 0xF0)), BorderFactory.createEmptyBorder(8, 8, 8, 8)));
            JPanel rt = new JPanel(); rt.setLayout(new BoxLayout(rt, BoxLayout.Y_AXIS)); rt.setOpaque(false);
            cust.setAlignmentX(0); custInfo.setAlignmentX(0); rt.add(cust); rt.add(custInfo);
            right.add(rt, BorderLayout.NORTH);
            right.add(new JScrollPane(lines));
            JPanel rb = new JPanel(); rb.setLayout(new BoxLayout(rb, BoxLayout.Y_AXIS)); rb.setOpaque(false);
            JPanel qb = Ui.row(Ui.button("−", () -> bump(-1), "plain"), Ui.button("+", () -> bump(1), "plain"), Ui.button("✕", this::removeLine, "plain"), new JLabel(t("pos.lineDisc")), lineDisc);
            JPanel ob = Ui.row(new JLabel(t("pos.orderDisc")), order);
            tot.setAlignmentX(0); qb.setAlignmentX(0); ob.setAlignmentX(0);
            tot.setPreferredSize(new Dimension(350, 88)); tot.setMinimumSize(new Dimension(350, 88)); tot.setMaximumSize(new Dimension(Integer.MAX_VALUE, 88)); tot.setVerticalAlignment(javax.swing.SwingConstants.TOP);
            custInfo.setPreferredSize(new Dimension(350, 20)); custInfo.setMinimumSize(new Dimension(350, 20)); custInfo.setMaximumSize(new Dimension(Integer.MAX_VALUE, 20));
            JPanel bb = Ui.row(holdB, recallB, clearB); bb.setAlignmentX(0);
            payB.setAlignmentX(0); payB.setMaximumSize(new Dimension(Integer.MAX_VALUE, 38));
            rb.add(qb); rb.add(ob); rb.add(tot); rb.add(bb); rb.add(payB);
            right.add(rb, BorderLayout.SOUTH);
            right.setPreferredSize(new Dimension(390, 0));
            till.setOpaque(false);
            till.add(left); till.add(right, BorderLayout.LINE_END);

            JPanel center = new JPanel(new BorderLayout()); center.setOpaque(false);
            center.add(gate, BorderLayout.NORTH); center.add(till);
            add(center);
        }

        // -- data
        void refresh() {
            updating = true;
            reg.setModel(new DefaultComboBoxModel<>()); reg.addItem(new Item("—", ""));
            for (Map<String, Object> x : st.registers) reg.addItem(new Item(s(x.get("code")) + " · " + s(data(x).get("name")), s(x.get("code"))));
            boolean g = (st.shift == null) && !Boolean.FALSE.equals(st.settings.get("requireShift"));
            gate.setVisible(g); till.setVisible(!g);
            shiftLbl.setText(st.shift == null ? "" : s(st.shift.get("code")));
            cat.setModel(new DefaultComboBoxModel<>()); cat.addItem(new Item(t("pos.all"), ""));
            java.util.TreeSet<String> cats = new java.util.TreeSet<>();
            for (Map<String, Object> p : st.products) { String c = s(data(p).get("category")); if (!c.isEmpty()) cats.add(c); }
            for (String c : cats) {
                String nm = c;
                for (Map<String, Object> cr : st.categories) if (s(cr.get("code")).equals(c)) { Map<String, Object> d = data(cr); nm = I18n.rtl() && !s(d.get("nameAr")).isEmpty() ? s(d.get("nameAr")) : s(d.get("name")).isEmpty() ? c : s(d.get("name")); }
                cat.addItem(new Item(nm, c));
            }
            cust.setModel(new DefaultComboBoxModel<>()); cust.addItem(new Item(t("pos.walkin"), ""));
            for (Map<String, Object> c : st.customers) cust.addItem(new Item(s(data(c).get("name")) + " · " + s(c.get("code")), s(c.get("code"))));
            setSel(cust, customerCode);
            updating = false;
            fillProducts(); repaintCart(); updateQueue();
        }

        void updateQueue() {
            int n = readList(QUEUE).size();
            queueLbl.setText(n > 0 ? t("pos.queued").replace("{n}", String.valueOf(n)) : " ");
            queueBtn.setVisible(n > 0);
        }

        double stockOf(Map<String, Object> p) { return st.stock.getOrDefault(s(p.get("code")), 0.0); }
        boolean tracked(Map<String, Object> p) { return Boolean.TRUE.equals(data(p).get("trackStock")); }

        void fillProducts() {
            String qq = q.getText().toLowerCase().trim(), c = sel(cat);
            gridModel.clear();
            int n = 0;
            for (Map<String, Object> p : st.products) {
                Map<String, Object> d = data(p);
                if ("Inactive".equals(s(p.get("status"))) || (!c.isEmpty() && !s(d.get("category")).equals(c))) continue;
                if (!qq.isEmpty() && !s(d.get("name")).toLowerCase().contains(qq) && !s(p.get("code")).toLowerCase().contains(qq) && !s(d.get("barcode")).toLowerCase().contains(qq)) continue;
                boolean promo = false;
                for (Map<String, Object> pr : st.promos) { Map<String, Object> pd = data(pr); if ("Active".equals(s(pr.get("status"))) && ("all".equals(s(pd.get("scope"))) || s(pd.get("target")).equalsIgnoreCase(s(p.get("code"))))) promo = true; }
                boolean out = tracked(p) && stockOf(p) <= 0 && !Boolean.TRUE.equals(st.settings.get("allowNegativeStock"));
                String line3 = s(p.get("code")) + (tracked(p) ? " · " + t("pos.left").replace("{n}", String.valueOf((long) stockOf(p))) : "");
                gridModel.addElement(new Item(s(d.get("name")) + "\n" + money(num(d.get("price"))) + (promo ? " %" : "") + "\n" + line3, (out ? "!" : "") + s(p.get("code"))));
                if (++n >= 80) break;
            }
        }

        Map<String, Object> customer() { for (Map<String, Object> c : st.customers) if (s(c.get("code")).equals(customerCode)) return c; return null; }
        Priced priced() { return priceCart(cart, st.products, st.promos, customer(), orderPct, st.settings); }

        // -- cart
        void scan() {
            String x = q.getText().trim().toLowerCase();
            if (x.isEmpty()) return;
            for (Map<String, Object> p : st.products) if (s(p.get("code")).toLowerCase().equals(x) || s(data(p).get("barcode")).toLowerCase().equals(x)) { add(s(p.get("code"))); q.setText(""); return; }
            if (gridModel.size() == 1) { add(gridModel.get(0).value.replace("!", "")); q.setText(""); }
            else banner.setText(t("pos.notFound"));
        }

        void add(String sku) {
            banner.setText("");
            boolean found = false;
            for (Map<String, Object> l : cart) if (s(l.get("sku")).equals(sku)) { l.put("qty", num(l.get("qty")) + 1); found = true; break; }
            if (!found) cart.add(map("sku", sku, "qty", 1.0, "discountPct", 0.0));
            repaintCart();
            lines.getSelectionModel().setSelectionInterval(cart.size() - 1, cart.size() - 1);
        }

        void bump(int d) {
            int i = lines.getSelectedRow();
            if (i < 0 || i >= cart.size()) return;
            double q2 = num(cart.get(i).get("qty")) + d;
            if (q2 <= 0) cart.remove(i); else cart.get(i).put("qty", q2);
            repaintCart();
            if (!cart.isEmpty()) lines.getSelectionModel().setSelectionInterval(Math.min(i, cart.size() - 1), Math.min(i, cart.size() - 1));
        }

        void removeLine() { int i = lines.getSelectedRow(); if (i >= 0 && i < cart.size()) { cart.remove(i); repaintCart(); } }

        void setLineDisc(int row, int pct) {
            if (row < 0 || row >= cart.size()) return;
            pct = Math.min(pct, (int) num(st.settings.get("maxDiscountPct")));
            if ((int) num(cart.get(row).get("discountPct")) == pct) return;
            cart.get(row).put("discountPct", (double) pct);
            repaintCart();
            lines.getSelectionModel().setSelectionInterval(row, row);
        }

        void syncLineDisc() { int i = lines.getSelectedRow(); updating = true; lineDisc.setValue(i >= 0 && i < cart.size() ? (int) num(cart.get(i).get("discountPct")) : 0); updating = false; }

        void setCustomer(String code) { customerCode = code; updating = true; setSel(cust, code); updating = false; repaintCart(); }

        void repaintCart() {
            int keep = lines.getSelectedRow();
            Priced p = priced();
            List<String[]> rows = new ArrayList<>();
            for (Map<String, Object> l : p.lines) rows.add(new String[]{s(l.get("name")) + (s(l.get("promoCode")).isEmpty() ? "" : "  [" + s(l.get("promoCode")) + "]"), s(l.get("qty")), money(num(l.get("total")))});
            updating = true;
            lines.fill(rows, p.lines);
            if (keep >= 0 && keep < rows.size()) lines.getSelectionModel().setSelectionInterval(keep, keep);
            int i = lines.getSelectedRow();
            lineDisc.setValue(i >= 0 && i < cart.size() ? (int) num(cart.get(i).get("discountPct")) : 0);
            order.setValue((int) orderPct);
            updating = false;
            Map<String, Object> cu = customer();
            custInfo.setText(cu == null ? " " : t("pos.points") + ": " + (long) num(data(cu).get("points")) + (num(data(cu).get("discountPct")) != 0 ? " · " + s(data(cu).get("discountPct")) + "%" : ""));
            custInfo.setForeground(Ui.DIM);
            String h = "<html>" + t("pos.subtotal") + ": " + money(p.subtotal) + "<br>" + (p.discount != 0 ? t("pos.discount") + ": −" + money(p.discount) + "<br>" : "") + t("pos.tax") + ": " + money(p.tax)
                    + "<br><span style='font-size:16px'><b>" + t("pos.total") + ": " + money(p.total) + "</b></span></html>";
            tot.setText(h);
            boolean has = !cart.isEmpty();
            payB.setEnabled(has); holdB.setEnabled(has); clearB.setEnabled(has);
            recallB.setVisible(!readList(heldFile()).isEmpty());
            recallB.setText(t("pos.recall") + " (" + readList(heldFile()).size() + ")");
        }

        void clear() { cart.clear(); orderPct = 0; setCustomer(""); }

        // -- held baskets
        @SuppressWarnings("unchecked")
        void hold() {
            List<Object> h = readList(heldFile());
            List<Object> copy = new ArrayList<>();
            for (Map<String, Object> l : cart) copy.add(new LinkedHashMap<>(l));
            h.add(map("id", UUID.randomUUID().toString(), "at", LocalTime.now().withNano(0).toString().substring(0, 5), "cart", copy, "customer", customerCode));
            writeList(heldFile(), h);
            clear();
        }

        void recall() {
            List<Object> h = readList(heldFile());
            if (h.isEmpty()) return;
            DefaultListModel<String> m = new DefaultListModel<>();
            for (Object o : h) m.addElement(s(Json.obj(o).get("at")) + " · " + Json.arr(Json.obj(o).get("cart")).size() + " " + t("pos.items"));
            JList<String> lst = new JList<>(m); lst.setSelectedIndex(0);
            String[] opts = {t("pos.recallOne"), "🗑", t("common.cancel")};
            int r = javax.swing.JOptionPane.showOptionDialog(this, new JScrollPane(lst), t("pos.recall"), javax.swing.JOptionPane.DEFAULT_OPTION, javax.swing.JOptionPane.PLAIN_MESSAGE, null, opts, opts[0]);
            int i = lst.getSelectedIndex();
            if ((r != 0 && r != 1) || i < 0) return;
            Map<String, Object> got = Json.obj(h.remove(i));
            writeList(heldFile(), h);
            if (r == 0) {
                cart.clear();
                for (Object o : Json.arr(got.get("cart"))) cart.add(new LinkedHashMap<>(Json.obj(o)));
                setCustomer(s(got.get("customer")));
            }
            repaintCart();
        }

        // -- shift
        public void openShift(double opening) {
            Map<String, Object> b = map("openingCash", opening);
            if (!sel(reg).isEmpty()) b.put("register", sel(reg));
            Ui.async(() -> Api.I.posOpen(b), s -> { st.shift = s; onShift.run(); }, banner::setText);
        }

        // -- checkout
        void pay(boolean autoExact) {
            if (busy || cart.isEmpty()) return;
            Priced p = priced();
            List<Object> payments = new ArrayList<>();
            int redeem = 0;
            double remaining = 0;
            if (autoExact) payments.add(map("method", "cash", "amount", p.total));
            else {
                PayDialog dlg = new PayDialog(this, p.total, customer(), st.settings);
                if (!dlg.ok) return;
                payments = dlg.payments(); redeem = dlg.redeemPoints(); remaining = dlg.remaining();
            }
            Map<String, Object> body = map("lines", new ArrayList<Object>(cart), "payments", payments, "discountPct", orderPct, "redeemPoints", (double) redeem, "localId", UUID.randomUUID().toString());
            if (!customerCode.isEmpty()) body.put("customer", customerCode);
            if (st.shift != null && st.shift.get("ref") != null) body.put("register", st.shift.get("ref"));
            checkout(body, p, remaining, autoExact);
        }

        void checkout(Map<String, Object> body, Priced pp, double remaining, boolean quiet) {
            busy = true;
            Ui.async(() -> Api.I.posCheckout(body), sale -> {
                busy = false; clear(); updateQueue();
                lastReceipt = receiptHtml(sale, st);
                if (!quiet) showReceipt(this, sale, st, t("pos.saleDone"));
                onShift.run();
            }, m -> {
                busy = false;
                if (!looksOffline(m)) { banner.setText(m); return; }
                // the network is down: keep the sale, show a provisional receipt, send it later
                List<Object> qd = readList(QUEUE); qd.add(body); writeList(QUEUE, qd);
                Map<String, Object> sale = map("code", t("pos.offlineCode"), "status", "Queued", "createdAt", java.time.LocalDateTime.now().withNano(0).toString(),
                        "data", map("type", "Sale", "lines", new ArrayList<Object>(pp.lines), "subtotal", pp.subtotal, "discount", pp.discount, "tax", pp.tax, "total", pp.total, "payments", body.get("payments"),
                                "change", Math.max(0, -remaining), "cashier", Api.I.username));
                clear(); updateQueue(); lastReceipt = receiptHtml(sale, st);
                if (!quiet) showReceipt(this, sale, st, t("pos.saleDone"));
            });
        }

        void flush() {
            List<Object> qd = readList(QUEUE);
            if (qd.isEmpty()) return;
            Ui.async(() -> {
                List<Object> left = new ArrayList<>();
                for (int i = 0; i < qd.size(); i++) {
                    try { Api.I.posCheckout(Json.obj(qd.get(i))); }
                    catch (Api.ApiException e) { if (looksOffline(e.getMessage())) { left = new ArrayList<>(qd.subList(i, qd.size())); break; } /* refused by the server: dropped */ }
                }
                return left;
            }, left -> { writeList(QUEUE, left); updateQueue(); onShift.run(); }, banner::setText);
        }
    }

    // ------------------------------------------------------------------ dialogs
    static final class PayDialog {
        boolean ok;
        final JSpinner cash = numSpin(0, 1e9), card = numSpin(0, 1e9), other = numSpin(0, 1e9), redeem;
        final JLabel sum = new JLabel();
        final double total, pointValue;
        final JDialog d;
        final JButton go;

        PayDialog(Component parent, double total, Map<String, Object> customer, Map<String, Object> settings) {
            this.total = total;
            pointValue = num(settings.get("pointValue")) == 0 ? 0.05 : num(settings.get("pointValue"));
            int pts = customer == null ? 0 : (int) num(data(customer).get("points"));
            redeem = new JSpinner(new SpinnerNumberModel(0, 0, Math.max(0, pts), 1));
            d = new JDialog(javax.swing.SwingUtilities.getWindowAncestor(parent), t("pos.pay") + " · " + money(total), java.awt.Dialog.ModalityType.APPLICATION_MODAL);
            JPanel form = new JPanel(new GridLayout(0, 2, 8, 6));
            form.add(new JLabel(t("pos.pay.cash"))); form.add(cash); form.add(new JLabel(t("pos.pay.card"))); form.add(card); form.add(new JLabel(t("pos.pay.other"))); form.add(other);
            if (pts > 0) { form.add(new JLabel(t("pos.redeem") + " (" + pts + ")")); form.add(redeem); }
            for (JSpinner sp : new JSpinner[]{cash, card, other, redeem}) sp.addChangeListener(e -> recalc());
            JPanel quick = new JPanel(new FlowLayout(FlowLayout.LEADING, 4, 4));
            quick.add(Ui.button(t("pos.exactCash"), () -> exact(cash), "plain")); quick.add(Ui.button(t("pos.exactCard"), () -> exact(card), "plain"));
            for (int n : new int[]{50, 100, 200, 500}) quick.add(Ui.button(String.valueOf(n), () -> { card.setValue(0.0); other.setValue(0.0); cash.setValue((double) n); }, "plain"));
            go = Ui.button(t("pos.complete"), () -> { ok = true; d.dispose(); }, null);
            JPanel south = Ui.row(Ui.button(t("common.cancel"), d::dispose, "plain"), go);
            JPanel mid = new JPanel(new BorderLayout()); mid.add(quick, BorderLayout.NORTH); mid.add(sum);
            d.setLayout(new BorderLayout(0, 6));
            ((JPanel) d.getContentPane()).setBorder(BorderFactory.createEmptyBorder(12, 14, 12, 14));
            d.add(form, BorderLayout.NORTH); d.add(mid); d.add(south, BorderLayout.SOUTH);
            recalc();
            d.setSize(440, 330); d.setLocationRelativeTo(parent);
            d.setVisible(true);
        }

        double redeemValue() { return r2(((Number) redeem.getValue()).intValue() * pointValue); }
        double due() { return r2(Math.max(0, total - Math.min(redeemValue(), total))); }
        double tendered() { return r2(val(cash) + val(card) + val(other)); }
        double remaining() { return r2(due() - tendered()); }
        int redeemPoints() { return ((Number) redeem.getValue()).intValue(); }
        void exact(JSpinner w) { cash.setValue(0.0); card.setValue(0.0); other.setValue(0.0); w.setValue(due()); }
        void recalc() {
            double rem = remaining();
            sum.setText("<html>" + t("pos.due") + ": <b>" + money(due()) + "</b><br>" + t("pos.tendered") + ": <b>" + money(tendered()) + "</b><br><span style='color:" + (rem > 0 ? "#dc2626" : "#16a34a") + "'>"
                    + (rem > 0 ? t("pos.remaining") : t("pos.change")) + ": <b>" + money(Math.abs(rem)) + "</b></span></html>");
            go.setEnabled(rem <= 0.004);
        }
        List<Object> payments() {
            List<Object> out = new ArrayList<>();
            if (val(cash) > 0) out.add(map("method", "cash", "amount", val(cash)));
            if (val(card) > 0) out.add(map("method", "card", "amount", val(card)));
            if (val(other) > 0) out.add(map("method", "other", "amount", val(other)));
            return out;
        }
    }

    /** amount + note dialog; returns null when cancelled, else {amount, note}. */
    static Object[] amountDialog(Component parent, String title, String amountLabel, String noteLabel, String hint) {
        JSpinner amount = numSpin(0, 1e9);
        JTextField note = new JTextField();
        JPanel form = new JPanel(new GridLayout(0, 2, 8, 6));
        form.add(new JLabel(amountLabel)); form.add(amount); form.add(new JLabel(noteLabel)); form.add(note);
        JPanel p = new JPanel(new BorderLayout(0, 6)); p.add(form);
        if (hint != null) p.add(Ui.label(hint, "dim"), BorderLayout.SOUTH);
        int r = javax.swing.JOptionPane.showConfirmDialog(parent, p, title, javax.swing.JOptionPane.OK_CANCEL_OPTION, javax.swing.JOptionPane.PLAIN_MESSAGE);
        return r == javax.swing.JOptionPane.OK_OPTION ? new Object[]{val(amount), note.getText()} : null;
    }

    // ------------------------------------------------------------------ shifts
    public static final class ShiftsPanel extends JPanel {
        final State st;
        final Runnable onChange;
        final JLabel msg = Ui.label(" ", "dim"), head = Ui.label("", "title"), kv = new JLabel();
        final JButton bIn, bOut, bClose, bOpen;
        final JComboBox<Item> reg = combo();
        final JSpinner floatBox = numSpin(0, 1e9);
        final Ui.DataTable table = new Ui.DataTable(t("pos.code"), t("pos.cashier"), t("pos.opened"), t("pos.status"), t("pos.shift.sales"), t("pos.shift.expected"), t("pos.shift.counted"), t("pos.shift.variance"), t("pos.shift.journal"));

        public ShiftsPanel(State st, Runnable onChange) {
            super(new BorderLayout(0, 8));
            this.st = st; this.onChange = onChange;
            setOpaque(false);
            bIn = Ui.button(t("pos.shift.cashIn"), () -> { Object[] r = amountDialog(this, t("pos.shift.cashIn"), t("pos.amount"), t("pos.reason"), null); if (r != null) { if ((double) r[0] > 0) cashMove("in", (double) r[0], (String) r[1]); else Ui.warn(this, t("pos.required")); } }, "plain");
            bOut = Ui.button(t("pos.shift.cashOut"), () -> { Object[] r = amountDialog(this, t("pos.shift.cashOut"), t("pos.amount"), t("pos.reason"), null); if (r != null) { if ((double) r[0] > 0) cashMove("out", (double) r[0], (String) r[1]); else Ui.warn(this, t("pos.required")); } }, "plain");
            bClose = Ui.button(t("pos.shift.close"), () -> { Object[] r = amountDialog(this, t("pos.shift.close"), t("pos.shift.countedCash"), t("pos.note"), t("pos.shift.closeHint")); if (r != null) closeShift((double) r[0], (String) r[1]); }, null);
            bOpen = Ui.button(t("pos.shift.open"), () -> {
                Map<String, Object> b = map("openingCash", val(floatBox));
                if (!sel(reg).isEmpty()) b.put("register", sel(reg));
                Ui.async(() -> Api.I.posOpen(b), s -> { st.shift = s; msg.setText(t("pos.shift.opened")); onChange.run(); }, m -> Ui.warn(this, m));
            }, null);
            JPanel card = new JPanel(new BorderLayout(0, 6));
            card.setBackground(Color.WHITE);
            card.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new Color(0xE2, 0xE8, 0xF0)), BorderFactory.createEmptyBorder(10, 12, 10, 12)));
            card.add(head, BorderLayout.NORTH); card.add(kv);
            card.add(Ui.row(reg, floatBox, bOpen, bIn, bOut, bClose), BorderLayout.SOUTH);
            JPanel top = new JPanel(new BorderLayout(0, 4)); top.setOpaque(false); top.add(msg, BorderLayout.NORTH); top.add(card);
            JPanel hist = new JPanel(new BorderLayout(0, 4)); hist.setOpaque(false); hist.add(Ui.label(t("pos.shift.history"), "title"), BorderLayout.NORTH); hist.add(new JScrollPane(table));
            add(top, BorderLayout.NORTH); add(hist);
        }

        void refresh() {
            reg.setModel(new DefaultComboBoxModel<>()); reg.addItem(new Item("—", ""));
            for (Map<String, Object> x : st.registers) reg.addItem(new Item(s(x.get("code")) + " · " + s(data(x).get("name")), s(x.get("code"))));
            boolean open = st.shift != null;
            reg.setVisible(!open); floatBox.setVisible(!open); bOpen.setVisible(!open);
            bIn.setVisible(open); bOut.setVisible(open); bClose.setVisible(open);
            if (open) {
                Map<String, Object> d = data(st.shift);
                head.setText("<html>" + t("pos.shift.current") + " · " + esc(s(st.shift.get("code"))) + "</html>");
                kv.setText("<html>" + t("pos.shift.opening") + ": <b>" + money(num(d.get("opening"))) + "</b> &nbsp;&nbsp; " + t("pos.shift.cashSales") + ": <b>" + money(num(d.get("cashSales"))) + "</b> &nbsp;&nbsp; "
                        + t("pos.shift.cardSales") + ": <b>" + money(num(d.get("cardSales")) + num(d.get("otherSales"))) + "</b> &nbsp;&nbsp; " + t("pos.shift.refunds") + ": <b>" + money(num(d.get("returnsTotal"))) + "</b> &nbsp;&nbsp; "
                        + t("pos.shift.cashIn") + " / " + t("pos.shift.cashOut") + ": <b>" + money(num(d.get("cashIn"))) + " / " + money(num(d.get("cashOut"))) + "</b> &nbsp;&nbsp; " + t("pos.shift.sales") + ": <b>" + (long) num(d.get("salesCount")) + "</b></html>");
            } else { head.setText("<html>" + t("pos.shift.none") + "</html>"); kv.setText(" "); }
            Ui.async(() -> Api.I.posRecords("shift", ""), this::fill, m -> msg.setText(m));
        }

        void fill(List<Map<String, Object>> rows) {
            List<Map<String, Object>> rs = new ArrayList<>(rows);
            rs.sort((a, b) -> s(b.get("createdAt")).compareTo(s(a.get("createdAt"))));
            List<String[]> out = new ArrayList<>();
            for (Map<String, Object> r : rs) {
                Map<String, Object> d = data(r);
                String at = s(r.get("createdAt"));
                out.add(new String[]{s(r.get("code")), s(r.get("createdBy")), at.substring(0, Math.min(16, at.length())).replace('T', ' '), t("pos.st." + (s(r.get("status")).isEmpty() ? "Open" : s(r.get("status")))), money(num(d.get("salesTotal"))),
                        d.containsKey("expected") ? money(num(d.get("expected"))) : "", d.containsKey("counted") ? money(num(d.get("counted"))) : "", "Closed".equals(s(r.get("status"))) ? money(num(d.get("variance"))) : "", s(d.get("journal"))});
            }
            table.fill(out, rs);
        }

        public void cashMove(String type, double amount, String reason) {
            Ui.async(() -> Api.I.posCash(s(st.shift.get("id")), type, amount, reason), r -> { st.shift = r; msg.setText(t("pos.saved")); onChange.run(); }, m -> Ui.warn(this, m));
        }

        public void closeShift(double counted, String note) {
            Ui.async(() -> Api.I.posClose(s(st.shift.get("id")), counted, note), r -> {
                st.shift = null;
                Map<String, Object> d = data(r);
                msg.setText(t("pos.shift.closed") + " · " + s(r.get("code")) + " — " + t("pos.shift.expected") + " " + money(num(d.get("expected"))) + ", " + t("pos.shift.counted") + " " + money(num(d.get("counted"))) + ", " + t("pos.shift.variance") + " " + money(num(d.get("variance"))));
                onChange.run();
            }, m -> Ui.warn(this, m));
        }
    }

    // ------------------------------------------------------------------ sales history
    public static final class SalesPanel extends JPanel {
        final State st;
        List<Map<String, Object>> rows = new ArrayList<>();
        final JTextField q = new JTextField(18);
        final JComboBox<Item> type = combo(), days = combo();
        final JLabel total = Ui.label(" ", "dim"), msg = Ui.label(" ", "dim");
        final Ui.DataTable table = new Ui.DataTable(t("pos.code"), t("pos.date"), t("pos.cashier"), t("pos.customer"), t("pos.status"), t("pos.total"));
        final JButton bRet, bVoid;

        public SalesPanel(State st) {
            super(new BorderLayout(0, 8));
            this.st = st;
            setOpaque(false);
            q.setToolTipText(t("pos.findReceipt"));
            q.putClientProperty("JTextField.placeholderText", t("pos.findReceipt"));
            q.getDocument().addDocumentListener(new javax.swing.event.DocumentListener() {
                public void insertUpdate(javax.swing.event.DocumentEvent e) { paint(); }
                public void removeUpdate(javax.swing.event.DocumentEvent e) { paint(); }
                public void changedUpdate(javax.swing.event.DocumentEvent e) { paint(); }
            });
            type.addItem(new Item(t("pos.all"), "")); type.addItem(new Item(t("pos.rc.receipt"), "Sale")); type.addItem(new Item(t("pos.rc.return"), "Return"));
            type.addActionListener(e -> paint());
            for (int n : new int[]{1, 7, 30, 365}) days.addItem(new Item(n + " d", String.valueOf(n)));
            days.setSelectedIndex(1);
            days.addActionListener(e -> load());
            JPanel bar = new JPanel(new BorderLayout()); bar.setOpaque(false);
            bar.add(Ui.row(q, type, days)); bar.add(total, BorderLayout.EAST);
            JPanel top = new JPanel(new BorderLayout()); top.setOpaque(false); top.add(bar, BorderLayout.NORTH); top.add(msg, BorderLayout.SOUTH);
            table.getSelectionModel().addListSelectionListener(e -> buttons());
            table.onOpen(this::view);
            bRet = Ui.button(t("pos.rc.return"), this::askReturn, "plain");
            bVoid = Ui.button(t("pos.void"), () -> {
                @SuppressWarnings("unchecked") Map<String, Object> sl = (Map<String, Object>) table.selected();
                if (sl != null && Ui.ask(this, t("pos.voidConfirm").replace("{name}", s(sl.get("code"))), t("pos.void"), t("common.cancel"))) doVoid(sl);
            }, "danger");
            JPanel bottom = Ui.row(Ui.button(t("pos.print"), this::view, "plain"), bRet, bVoid);
            add(top, BorderLayout.NORTH); add(new JScrollPane(table)); add(bottom, BorderLayout.SOUTH);
        }

        public void load() {
            String since = LocalDate.now().minusDays(Integer.parseInt(sel(days).isEmpty() ? "7" : sel(days))).toString();
            Ui.async(() -> Api.I.posRecords("sale", "from=" + since), r -> {
                rows = new ArrayList<>(r);
                rows.sort((a, b) -> s(b.get("createdAt")).compareTo(s(a.get("createdAt"))));
                paint();
            }, m -> msg.setText(m));
        }

        List<Map<String, Object>> shown() {
            String qq = q.getText().toLowerCase().trim(), ty = sel(type);
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> s : rows) {
                Map<String, Object> d = data(s);
                if (!ty.isEmpty() && !ty.equals(Pos.s(d.get("type")))) continue;
                if (!qq.isEmpty() && !Pos.s(s.get("code")).toLowerCase().contains(qq) && !Pos.s(s.get("parent")).toLowerCase().contains(qq) && !Pos.s(d.get("customerName")).toLowerCase().contains(qq) && !Pos.s(s.get("createdBy")).toLowerCase().contains(qq)) continue;
                out.add(s);
            }
            return out;
        }

        public int rowCount() { return table.getRowCount(); }
        public Map<String, Object> first() { return table.payloads.isEmpty() ? null : Json.obj(table.payloads.get(0)); }

        void paint() {
            List<Map<String, Object>> sh = shown();
            List<String[]> out = new ArrayList<>();
            double sum = 0;
            for (Map<String, Object> s : sh) {
                Map<String, Object> d = data(s);
                String at = Pos.s(s.get("createdAt"));
                out.add(new String[]{Pos.s(s.get("code")) + (Pos.s(s.get("parent")).isEmpty() ? "" : " ← " + Pos.s(s.get("parent"))), at.substring(0, Math.min(16, at.length())).replace('T', ' '), Pos.s(s.get("createdBy")),
                        Pos.s(d.get("customerName")).isEmpty() ? "—" : Pos.s(d.get("customerName")), t("pos.st." + (Pos.s(s.get("status")).isEmpty() ? "Completed" : Pos.s(s.get("status")))), money(num(d.get("total")))});
                if (!"Voided".equals(Pos.s(s.get("status")))) sum += num(d.get("total"));
            }
            table.fill(out, sh);
            total.setText(sh.size() + " · " + money(sum));
            buttons();
        }

        public boolean canReturn(Map<String, Object> s) { return Api.I.can("pos.refund") && "Sale".equals(Pos.s(data(s).get("type"))) && !"Voided".equals(Pos.s(s.get("status"))) && !"Returned".equals(Pos.s(s.get("status"))); }
        public boolean canVoid(Map<String, Object> s) { return Api.I.can("pos.void") && "Sale".equals(Pos.s(data(s).get("type"))) && "Completed".equals(Pos.s(s.get("status"))); }

        void buttons() {
            Object o = table.selected();
            Map<String, Object> sl = o == null ? null : Json.obj(o);
            bRet.setEnabled(sl != null && canReturn(sl)); bVoid.setEnabled(sl != null && canVoid(sl));
        }

        void view() { Object o = table.selected(); if (o != null) showReceipt(this, Json.obj(o), st, Pos.s(Json.obj(o).get("code"))); }

        void askReturn() {
            Object o = table.selected();
            if (o == null) return;
            Map<String, Object> sale = Json.obj(o);
            JPanel form = new JPanel(new GridLayout(0, 2, 8, 6));
            List<String> skus = new ArrayList<>();
            List<JSpinner> spins = new ArrayList<>();
            for (Object lo : Json.arr(data(sale).get("lines"))) {
                Map<String, Object> l = Json.obj(lo);
                int left = (int) Math.max(0, num(l.get("qty")) - num(l.get("returned")));
                JSpinner sp = new JSpinner(new SpinnerNumberModel(0, 0, left, 1));
                skus.add(Pos.s(l.get("sku"))); spins.add(sp);
                form.add(new JLabel(Pos.s(l.get("name")) + "  (" + t("pos.sold") + " " + Pos.s(l.get("qty")) + " / " + t("pos.alreadyReturned") + " " + Pos.s(l.get("returned")) + ")")); form.add(sp);
            }
            JComboBox<Item> method = combo(); method.addItem(new Item(t("pos.pay.cash"), "cash")); method.addItem(new Item(t("pos.pay.card"), "card"));
            JTextField reason = new JTextField();
            form.add(new JLabel(t("pos.refundMethod"))); form.add(method); form.add(new JLabel(t("pos.reason"))); form.add(reason);
            if (javax.swing.JOptionPane.showConfirmDialog(this, form, t("pos.rc.return") + " · " + Pos.s(sale.get("code")), javax.swing.JOptionPane.OK_CANCEL_OPTION, javax.swing.JOptionPane.PLAIN_MESSAGE) != javax.swing.JOptionPane.OK_OPTION) return;
            List<Object> lines = new ArrayList<>();
            for (int i = 0; i < skus.size(); i++) { int n = ((Number) spins.get(i).getValue()).intValue(); if (n > 0) lines.add(map("sku", skus.get(i), "qty", (double) n)); }
            if (lines.isEmpty()) { Ui.warn(this, t("pos.pickReturn")); return; }
            doReturn(sale, lines, sel(method), reason.getText(), true);
        }

        public void doReturn(Map<String, Object> sale, List<Object> lines, String method, String reason, boolean showSlip) {
            Ui.async(() -> Api.I.posReturn(Pos.s(sale.get("id")), lines, method, reason), r -> { msg.setText(t("pos.returned")); load(); if (showSlip) showReceipt(this, r, st, t("pos.returned")); }, m -> Ui.warn(this, m));
        }

        public void doVoid(Map<String, Object> sale) { Ui.async(() -> Api.I.posVoid(Pos.s(sale.get("id"))), r -> load(), m -> Ui.warn(this, m)); }
    }

    // ------------------------------------------------------------------ the page
    public static final class PosPanel extends JPanel implements Reloadable {
        public final State state = new State();
        public final TillPanel till;
        public final ShiftsPanel shifts;
        public final SalesPanel sales;
        public final JTabbedPane tabs = new JTabbedPane();
        final JLabel err = Ui.label(" ", "error");

        public PosPanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            till = new TillPanel(state, this::reload);
            shifts = new ShiftsPanel(state, this::reload);
            sales = new SalesPanel(state);
            tabs.addTab(t("pos.nav.terminal"), till); tabs.addTab(t("pos.nav.shifts"), shifts); tabs.addTab(t("pos.nav.sales"), sales);
            tabs.addChangeListener(e -> paint());
            JPanel head = new JPanel(new BorderLayout()); head.setOpaque(false);
            head.add(Ui.label(t("tab.pos"), "title"), BorderLayout.NORTH); head.add(err);
            add(head, BorderLayout.NORTH); add(tabs);
        }

        @Override public void reload() {
            err.setText(" ");
            Ui.async(state::load, s -> paint(), m -> err.setText(m));
        }

        void paint() {
            if (!state.loaded) return;
            switch (tabs.getSelectedIndex()) { case 0: till.refresh(); break; case 1: shifts.refresh(); break; default: sales.load(); }
        }
    }
}
