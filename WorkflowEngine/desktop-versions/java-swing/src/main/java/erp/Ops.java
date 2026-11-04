package erp;

import java.awt.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDate;
import java.util.*;
import java.util.List;
import javax.swing.*;

/**
 * Operations: material requirements planning, standard cost and work order variance, project billing, the VAT return and the ZATCA seller profile.
 * The reports are described by ops.json (shared by every desktop app).
 */
public final class Ops {
    private Ops() { }

    static Map<String, Object> SPEC;
    static synchronized Map<String, Object> spec() {
        if (SPEC == null) {
            try (InputStream in = Ops.class.getResourceAsStream("/ops.json")) {
                SPEC = Json.obj(Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8)));
            } catch (Exception e) { throw new RuntimeException(e); }
        }
        return SPEC;
    }
    static int ix() { return "ar".equals(I18n.lang) ? 1 : 0; }
    static String L(String key, Object... a) {
        String s = Json.str(Json.arr(Json.obj(spec().get("labels")).get(key)).get(ix()));
        for (int i = 0; i < a.length; i++) s = s.replace("{" + i + "}", String.valueOf(a[i]));
        return s;
    }
    static String tx(Object o) { return Json.str(Json.obj(o).get("ar".equals(I18n.lang) ? "ar" : "en")); }
    static double num(Object v) {
        double n;
        if (v instanceof Number) n = ((Number) v).doubleValue();
        else { try { n = Double.parseDouble(String.valueOf(v)); } catch (Exception e) { n = 0; } }
        return Double.isNaN(n) || Double.isInfinite(n) ? 0 : n;
    }
    static double r2(double v) { return Math.round((v + 1e-9) * 100) / 100.0; }
    static String money(double v) { return String.format(Locale.ENGLISH, "%,.2f", v); }
    static Map<String, Object> data(Object rec) { return Json.obj(Json.obj(rec).get("data")); }

    // ------------------------------------------------------------ calculations (port of erp.calc.ts)
    static double[] bomCost(Object bom, Map<String, Object> items, double rate, double overheadPct) {
        Map<String, Object> d = data(bom);
        double out = Math.max(0.0001, num(d.get("qty")) != 0 ? num(d.get("qty")) : 1);
        double mat = 0;
        for (Object lv : Json.arr(d.get("lines"))) {
            Map<String, Object> l = Json.obj(lv);
            mat += num(l.get("qty")) * (1 + num(l.get("scrapPct")) / 100) * num(Json.obj(items.get(Json.str(l.get("sku")))).get("cost"));
        }
        double material = r2(mat), labor = r2(num(d.get("routingMinutes")) / 60 * rate), overhead = r2(labor * overheadPct / 100), total = r2(material + labor + overhead);
        return new double[]{material, labor, overhead, total, r2(total / out)};
    }

    static final class MrpRow { String sku, name, action = "ok", due = ""; double gross, onHand, scheduled, net; int level; }

    static List<MrpRow> mrp(List<Map<String, Object>> demands, List<Object> boms, Map<String, Double> onHand, Map<String, Double> scheduled, Map<String, Object> items) {
        Map<String, Map<String, Object>> bomBy = new HashMap<>();
        for (Object b : boms) if (!"Inactive".equals(Json.str(Json.obj(b).get("status")))) bomBy.put(Json.str(Json.obj(b).get("code")), Json.obj(b));
        Map<String, Double> free = new HashMap<>(onHand), sched = new HashMap<>(scheduled);
        Map<String, MrpRow> rows = new LinkedHashMap<>();
        class Need {
            void go(String sku, double qty, int level, String due) {
                if (qty <= 0 || level > 12) return;
                MrpRow row = rows.get(sku);
                if (row == null) {
                    row = new MrpRow(); row.sku = sku; row.name = Json.str(Json.obj(items.get(sku)).get("name")); row.onHand = Math.max(0, onHand.getOrDefault(sku, 0.0)); row.scheduled = Math.max(0, scheduled.getOrDefault(sku, 0.0)); row.level = level; row.due = due;
                    rows.put(sku, row);
                }
                row.gross = r2(row.gross + qty);
                row.level = Math.max(row.level, level);
                double fromStock = Math.min(Math.max(0, free.getOrDefault(sku, 0.0)), qty);
                free.put(sku, free.getOrDefault(sku, 0.0) - fromStock);
                double left = qty - fromStock;
                double fromOrders = Math.min(Math.max(0, sched.getOrDefault(sku, 0.0)), left);
                sched.put(sku, sched.getOrDefault(sku, 0.0) - fromOrders);
                left = r2(left - fromOrders);
                if (left <= 0) return;
                row.net = r2(row.net + left);
                Map<String, Object> bom = bomBy.get(sku);
                row.action = bom != null ? "make" : "buy";
                if (bom != null) {
                    Map<String, Object> d = data(bom);
                    double out = Math.max(0.0001, num(d.get("qty")) != 0 ? num(d.get("qty")) : 1);
                    for (Object lv : Json.arr(d.get("lines"))) {
                        Map<String, Object> l = Json.obj(lv);
                        go(Json.str(l.get("sku")), r2(left / out * num(l.get("qty")) * (1 + num(l.get("scrapPct")) / 100)), level + 1, due);
                    }
                }
            }
        }
        Need n = new Need();
        for (Map<String, Object> d : demands) n.go(Json.str(d.get("sku")), num(d.get("qty")), 0, Json.str(d.get("due")));
        List<MrpRow> out = new ArrayList<>(rows.values());
        out.sort((a, b) -> a.level != b.level ? Integer.compare(a.level, b.level) : a.sku.compareTo(b.sku));
        return out;
    }

    /** [ready, billed] */
    static double[] projectReady(Object p, List<Object> ts, List<Object> cs, List<Object> ms) {
        String code = Json.str(Json.obj(p).get("code"));
        Map<String, Object> d = data(p);
        double ready = 0;
        if ("tm".equals(Json.str(d.get("billingModel")))) {
            for (Object v : ts) { Map<String, Object> t = Json.obj(v), x = data(t); if (code.equals(Json.str(t.get("ref"))) && "Approved".equals(Json.str(t.get("status"))) && Boolean.TRUE.equals(x.get("billable"))) ready += num(x.get("hours")) * num(x.get("rate")); }
            for (Object v : cs) { Map<String, Object> c = Json.obj(v), x = data(c); if (code.equals(Json.str(c.get("ref"))) && "Open".equals(Json.str(c.get("status"))) && Boolean.TRUE.equals(x.get("billable"))) ready += num(x.get("amount")) * (1 + num(x.get("markupPct")) / 100); }
        } else {
            for (Object v : ms) { Map<String, Object> m = Json.obj(v); if (code.equals(Json.str(m.get("ref"))) && "Achieved".equals(Json.str(m.get("status")))) ready += num(data(m).get("amount")); }
        }
        return new double[]{r2(ready), r2(num(d.get("billed")))};
    }

    // ------------------------------------------------------------ loading
    static boolean allowed(Object rep) {
        for (Object p : Json.arr(Json.obj(rep).get("view"))) if (Api.I.can(Json.str(p))) return true;
        return false;
    }
    static List<Object> records(String module, String kind) {
        try { return Json.arr(Api.I.ops("GET", "/erp/" + module + "/records/" + kind + "?take=5000", null)); } catch (Exception e) { return new ArrayList<>(); }
    }
    static Map<String, Object> fetch(String id, String from, String to) {
        Map<String, Object> d = new HashMap<>();
        if (id.equals("mrp") || id.equals("cost") || id.equals("variance")) {
            d.put("bom", records("mfg", "bom"));
            Map<String, Object> items = new HashMap<>();
            for (Object i : Json.arr(Api.I.ops("GET", "/erp/mfg/items", null))) items.put(Json.str(Json.obj(i).get("sku")), i);
            d.put("items", items);
        }
        if (id.equals("mrp")) {
            d.put("orders", records("mfg", "workorder"));
            Map<String, Double> stock = new HashMap<>();
            try { for (Object s : Json.arr(Api.I.ops("GET", "/erp/mfg/stock", null))) stock.put(Json.str(Json.obj(s).get("sku")), num(Json.obj(s).get("qty"))); } catch (Exception e) { /* optional */ }
            d.put("stock", stock);
        }
        if (id.equals("cost")) { d.put("wc", records("mfg", "workcenter")); d.put("setting", records("mfg", "setting")); }
        if (id.equals("variance")) d.put("orders", records("mfg", "workorder"));
        if (id.equals("projbill")) { d.put("p", records("prj", "project")); d.put("t", records("prj", "timesheet")); d.put("c", records("prj", "cost")); d.put("m", records("prj", "milestone")); }
        if (id.equals("vat")) d.put("vat", Api.I.ops("GET", "/finance/zatca/vat-return?from=" + from + "&to=" + to, null));
        if (id.equals("zatca")) d.put("profile", Api.I.ops("GET", "/finance/zatca/profile", null));
        return d;
    }
    static Map<String, Double> sched(List<Object> orders) {
        Map<String, Double> m = new HashMap<>();
        for (Object o : orders) {
            String s = Json.str(Json.obj(o).get("status"));
            if (s.equals("Planned") || s.equals("Released") || s.equals("InProgress")) m.merge(Json.str(data(o).get("sku")), num(data(o).get("qty")), Double::sum);
        }
        return m;
    }

    public static final class Built { public final List<String[]> rows = new ArrayList<>(); public final List<Object> payloads = new ArrayList<>(); public String foot = ""; }

    @SuppressWarnings("unchecked")
    static Built build(String id, Map<String, Object> d, List<Map<String, Object>> demand, boolean useStock) {
        Built b = new Built();
        switch (id) {
            case "mrp": {
                for (MrpRow r : mrp(demand, (List<Object>) d.get("bom"), useStock ? (Map<String, Double>) d.get("stock") : new HashMap<>(), useStock ? sched((List<Object>) d.get("orders")) : new HashMap<>(), (Map<String, Object>) d.get("items"))) {
                    b.rows.add(new String[]{"    ".repeat(r.level) + r.sku + (r.name.isEmpty() ? "" : "  " + r.name), money(r.gross), money(r.onHand), money(r.scheduled), money(r.net), L(r.action)});
                    b.payloads.add(r);
                }
                break;
            }
            case "cost": {
                Map<String, Double> rates = new HashMap<>();
                for (Object w : (List<Object>) d.get("wc")) rates.put(Json.str(Json.obj(w).get("code")), num(data(w).get("costPerHour")));
                double pct = num(spec().get("defaultOverheadPct"));
                for (Object s : (List<Object>) d.get("setting")) { Object v = data(s).get("overheadPct"); if ("defaults".equals(Json.str(Json.obj(s).get("code"))) && v != null && !Json.str(v).isEmpty()) pct = num(v); }
                for (Object bom : (List<Object>) d.get("bom")) {
                    double[] c = bomCost(bom, (Map<String, Object>) d.get("items"), rates.getOrDefault(Json.str(data(bom).get("workCenter")), 0.0), pct);
                    b.rows.add(new String[]{Json.str(Json.obj(bom).get("code")) + "  " + Json.str(data(bom).get("name")), money(c[0]), money(c[1]), money(c[2]), money(c[3]), money(c[4])});
                    b.payloads.add(bom);
                }
                b.foot = L("overheadPct") + ": " + (pct == Math.floor(pct) ? String.valueOf((long) pct) : String.valueOf(pct)) + "%";
                break;
            }
            case "variance":
                for (Object o : (List<Object>) d.get("orders")) {
                    if (!"Completed".equals(Json.str(Json.obj(o).get("status")))) continue;
                    Map<String, Object> x = data(o);
                    b.rows.add(new String[]{Json.str(Json.obj(o).get("code")), Json.str(x.get("sku")), money(num(x.get("goodQty"))), money(num(x.get("materialCost"))), money(num(x.get("laborCost"))), money(num(x.get("overheadCost"))), money(num(x.get("actualCost"))), money(num(x.get("standardCost"))), money(num(x.get("variance")))});
                    b.payloads.add(o);
                }
                break;
            case "projbill":
                for (Object p : (List<Object>) d.get("p")) {
                    double[] rb = projectReady(p, (List<Object>) d.get("t"), (List<Object>) d.get("c"), (List<Object>) d.get("m"));
                    Map<String, Object> x = data(p);
                    String model = Json.str(x.get("billingModel")).isEmpty() ? "tm" : Json.str(x.get("billingModel"));
                    b.rows.add(new String[]{Json.str(Json.obj(p).get("code")) + "  " + Json.str(x.get("name")), Json.str(x.get("customer")).isEmpty() ? "-" : Json.str(x.get("customer")), L("bm." + model), money(rb[0]), money(rb[1])});
                    b.payloads.add(new Object[]{p, rb[0]});
                }
                break;
            case "vat": {
                Map<String, Object> v = Json.obj(d.get("vat"));
                for (String side : new String[]{"sales", "purchases"}) for (Object bv : Json.arr(v.get(side))) { Map<String, Object> x = Json.obj(bv); b.rows.add(new String[]{L(side), Json.str(x.get("category")), String.valueOf((long) num(x.get("count"))), money(num(x.get("net"))), money(num(x.get("vat")))}); b.payloads.add(null); }
                String[][] codes = {{"sales", "salesByCode"}, {"purchases", "purchasesByCode"}};
                for (String[] c : codes) for (Object bv : Json.arr(v.get(c[1]))) { Map<String, Object> x = Json.obj(bv); b.rows.add(new String[]{L(c[0]) + " · " + L("byCode"), Json.str(x.get("code")), String.valueOf((long) num(x.get("count"))), money(num(x.get("net"))), money(num(x.get("vat")))}); b.payloads.add(null); }
                b.rows.add(new String[]{L("total") + " · " + L("sales"), "", String.valueOf((long) num(v.get("salesInvoices"))), money(num(v.get("salesNet"))), money(num(v.get("outputVat")))}); b.payloads.add(null);
                b.rows.add(new String[]{L("total") + " · " + L("purchases"), "", String.valueOf((long) num(v.get("purchaseInvoices"))), money(num(v.get("purchasesNet"))), money(num(v.get("inputVat")))}); b.payloads.add(null);
                double nd = num(v.get("netVatDue"));
                b.foot = L("out") + ": " + money(num(v.get("outputVat"))) + "   " + L("in") + ": " + money(num(v.get("inputVat"))) + "   " + (nd >= 0 ? L("netDue") : L("netRefund")) + ": " + money(Math.abs(nd)) + " / " + L("einv") + " " + (long) num(v.get("einvoiced")) + "/" + (long) num(v.get("salesInvoices"));
                if (num(v.get("notEinvoiced")) > 0) b.foot += " / " + L("notEinv", (long) num(v.get("notEinvoiced")));
                int miss = Json.arr(Json.obj(v.get("warnings")).get("missingTaxCode")).size();
                if (miss > 0) b.foot += " / " + L("missingCode", miss);
                break;
            }
            default:
        }
        return b;
    }

    // ------------------------------------------------------------ the page
    public static final class OpsPanel extends JPanel implements Reloadable {
        final List<Object> reports = new ArrayList<>();
        public final JComboBox<String> pick = new JComboBox<>(), mSku = new JComboBox<>();
        public final JTextField dFrom = new JTextField(LocalDate.now().withDayOfMonth(1).toString(), 9), dTo = new JTextField(LocalDate.now().toString(), 9), mQty = new JTextField("1", 5), mDue = new JTextField(LocalDate.now().toString(), 9);
        public final JCheckBox mStock = new JCheckBox(L("useStock"), true);
        public Ui.DataTable table = new Ui.DataTable();
        final JScrollPane scroll = new JScrollPane(table);
        public final JLabel foot = new JLabel(), msg = new JLabel(), mList = new JLabel();
        public final JButton bWo, bBuy, bBill, bCsv, bSave;
        final JPanel mrpBox = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0)), center = new JPanel(new CardLayout()), form = new JPanel(new GridBagLayout());
        final Map<String, JTextField> fields = new LinkedHashMap<>();
        final List<Map<String, Object>> demand = new ArrayList<>();
        public Map<String, Object> data = new HashMap<>();
        public String current = "", pending = "", lastInvoice = "";
        Map<String, Object> rep;
        List<MrpRow> plan = new ArrayList<>();

        public OpsPanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            for (Object r : Json.arr(spec().get("reports"))) if (allowed(r)) { reports.add(r); pick.addItem(tx(r)); }
            add(Ui.label(L("title"), "title"), BorderLayout.NORTH);
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0));
            bar.add(pick); bar.add(dFrom); bar.add(dTo); bar.add(Ui.button(L("refresh"), this::reload, null));
            bWo = Ui.button("", this::makeOrders, null); bBuy = Ui.button(L("exportBuy"), this::exportBuy, "ghost"); bBill = Ui.button(L("createInvoice"), this::bill, null); bCsv = Ui.button(L("csv"), this::exportVat, "ghost");
            bar.add(bWo); bar.add(bBuy); bar.add(bBill); bar.add(bCsv);
            mrpBox.add(mSku); mrpBox.add(mQty); mrpBox.add(mDue); mrpBox.add(Ui.button(L("add"), this::addDemand, null)); mrpBox.add(Ui.button(L("remove"), this::delDemand, "ghost")); mrpBox.add(mStock);
            mStock.addActionListener(e -> refreshMrp());
            JPanel top = new JPanel(new BorderLayout(0, 4)); top.add(bar, BorderLayout.NORTH);
            JPanel sub = new JPanel(new BorderLayout()); sub.add(mrpBox, BorderLayout.NORTH); sub.add(mList, BorderLayout.SOUTH); top.add(sub, BorderLayout.SOUTH);
            GridBagConstraints g = new GridBagConstraints(); g.insets = new Insets(3, 3, 3, 3); g.anchor = GridBagConstraints.WEST; int row = 0;
            for (Object zv : Json.arr(spec().get("zatca"))) {
                Map<String, Object> z = Json.obj(zv);
                JTextField e = new JTextField(28);
                fields.put(Json.str(z.get("key")), e);
                g.gridx = 0; g.gridy = row; form.add(new JLabel(tx(z)), g); g.gridx = 1; form.add(e, g); row++;
            }
            bSave = Ui.button(L("save"), this::saveProfile, null);
            g.gridx = 1; g.gridy = row; form.add(bSave, g);
            center.add(scroll, "t"); center.add(form, "f");
            JPanel bot = new JPanel(new BorderLayout()); bot.add(foot, BorderLayout.NORTH); bot.add(msg, BorderLayout.SOUTH);
            JPanel mid = new JPanel(new BorderLayout(0, 6)); mid.add(top, BorderLayout.NORTH); mid.add(center, BorderLayout.CENTER); mid.add(bot, BorderLayout.SOUTH);
            add(mid);
            pick.addActionListener(e -> reload());
        }

        @Override public void reload() {
            int i = pick.getSelectedIndex();
            if (i < 0) { msg.setText(L("noperm")); return; }
            rep = Json.obj(reports.get(i));
            final String id = Json.str(rep.get("id"));
            current = id;
            dFrom.setVisible(id.equals("vat")); dTo.setVisible(id.equals("vat"));
            mrpBox.setVisible(id.equals("mrp")); mList.setVisible(id.equals("mrp"));
            bWo.setVisible(false); bBuy.setVisible(false); bBill.setVisible(id.equals("projbill")); bCsv.setVisible(id.equals("vat"));
            ((CardLayout) center.getLayout()).show(center, id.equals("zatca") ? "f" : "t");
            List<String> heads = new ArrayList<>(); for (Object c : Json.arr(rep.get("cols"))) heads.add(tx(c));
            table = new Ui.DataTable(heads.toArray(new String[0]));
            scroll.setViewportView(table);
            msg.setText("…");
            final Map<String, Object> mine = rep;
            final String from = dFrom.getText().trim(), to = dTo.getText().trim();
            Ui.async(() -> fetch(id, from, to), d -> { if (id.equals(current)) show(mine, d); }, m -> msg.setText(m));
        }

        void show(Map<String, Object> r, Map<String, Object> d) {
            data = d;
            String id = Json.str(r.get("id"));
            msg.setText("");
            if (id.equals("zatca")) {
                Map<String, Object> p = Json.obj(d.get("profile"));
                for (Map.Entry<String, JTextField> e : fields.entrySet()) e.getValue().setText(Json.str(p.get(e.getKey())));
                bSave.setVisible(Api.I.can("gov.zatca.manage") || Api.I.can("finance.setup"));
                foot.setText(L("profileHint"));
                return;
            }
            if (id.equals("mrp")) {
                mSku.removeAllItems();
                skus.clear();
                for (Object b : (List<?>) d.get("bom")) { skus.add(Json.str(Json.obj(b).get("code"))); mSku.addItem(Json.str(Json.obj(b).get("code")) + " · " + Json.str(data(b).get("name"))); }
                refreshMrp();
                return;
            }
            paint();
        }
        final List<String> skus = new ArrayList<>();

        void paint() {
            Built b = build(current, data, demand, mStock.isSelected());
            table.fill(b.rows, b.payloads);
            javax.swing.table.DefaultTableCellRenderer right = new javax.swing.table.DefaultTableCellRenderer();
            right.setHorizontalAlignment(SwingConstants.RIGHT);
            List<Object> cols = Json.arr(rep.get("cols"));
            for (int c = 0; c < cols.size(); c++) if (Boolean.TRUE.equals(Json.obj(cols.get(c)).get("num"))) table.getColumnModel().getColumn(c).setCellRenderer(right);
            foot.setText(b.foot);
            msg.setText(!pending.isEmpty() ? pending : (b.rows.isEmpty() ? L("empty") : ""));
            pending = "";
        }

        public void addDemand() {
            int i = mSku.getSelectedIndex(); double q = num(mQty.getText());
            if (i < 0 || q <= 0) return;
            Map<String, Object> d = new LinkedHashMap<>(); d.put("sku", skus.get(i)); d.put("qty", q); d.put("due", mDue.getText().trim());
            demand.add(d);
            refreshMrp();
        }
        void delDemand() { if (!demand.isEmpty()) { demand.remove(demand.size() - 1); refreshMrp(); } }

        @SuppressWarnings("unchecked")
        void refreshMrp() {
            if (!current.equals("mrp") || !data.containsKey("bom")) return;
            List<String> parts = new ArrayList<>(); for (Map<String, Object> d : demand) parts.add(Json.str(d.get("sku")) + " × " + num(d.get("qty")) + " (" + Json.str(d.get("due")) + ")");
            mList.setText(parts.isEmpty() ? L("mrpHint") : String.join("  |  ", parts));
            paint();
            plan = mrp(demand, (List<Object>) data.get("bom"), mStock.isSelected() ? (Map<String, Double>) data.get("stock") : new HashMap<>(), mStock.isSelected() ? sched((List<Object>) data.get("orders")) : new HashMap<>(), (Map<String, Object>) data.get("items"));
            long make = plan.stream().filter(r -> r.action.equals("make")).count(), buy = plan.stream().filter(r -> r.action.equals("buy")).count();
            bWo.setVisible(make > 0 && Api.I.can("mfg.orders.manage")); bWo.setText(L("createWo", make)); bBuy.setVisible(buy > 0);
        }

        @SuppressWarnings("unchecked")
        public void makeOrders() {
            Map<String, Object> boms = new HashMap<>(); for (Object b : (List<Object>) data.get("bom")) boms.put(Json.str(Json.obj(b).get("code")), b);
            String due = LocalDate.now().toString(); for (Map<String, Object> d : demand) if (!Json.str(d.get("due")).isEmpty()) { due = Json.str(d.get("due")); break; }
            final String dueF = due;
            List<MrpRow> make = new ArrayList<>(); for (MrpRow r : plan) if (r.action.equals("make")) make.add(r);
            Ui.async(() -> {
                int n = 0;
                for (MrpRow r : make) {
                    Map<String, Object> bd = data(boms.get(r.sku)), wd = new LinkedHashMap<>();
                    wd.put("sku", r.sku); wd.put("qty", r.net); wd.put("due", r.due == null || r.due.isEmpty() ? dueF : r.due); wd.put("priority", "Normal"); wd.put("workCenter", Json.str(bd.get("workCenter"))); wd.put("lines", bd.get("lines")); wd.put("bomQty", bd.get("qty")); wd.put("routingMinutes", bd.get("routingMinutes")); wd.put("source", "MRP");
                    Map<String, Object> body = new LinkedHashMap<>(); body.put("status", "Planned"); body.put("data", wd);
                    Api.I.ops("POST", "/erp/mfg/records/workorder", body);
                    n++;
                }
                return n;
            }, n -> {
                data.put("orders", records("mfg", "workorder"));
                refreshMrp();
                msg.setText(L("created", n));
            }, m -> Ui.warn(this, m));
        }

        void exportBuy() {
            JFileChooser fc = new JFileChooser(); fc.setSelectedFile(new File("purchase-requirements.csv"));
            if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
            StringBuilder sb = new StringBuilder("﻿sku,name,quantity\n");
            for (MrpRow r : plan) if (r.action.equals("buy")) sb.append(r.sku).append(",\"").append(r.name.replace("\"", "\"\"")).append("\",").append(r.net).append('\n');
            try { Files.writeString(fc.getSelectedFile().toPath(), sb.toString(), StandardCharsets.UTF_8); msg.setText(fc.getSelectedFile().getPath()); } catch (IOException e) { Ui.warn(this, e.getMessage()); }
        }

        void bill() {
            Object sel = table.selected();
            if (!(sel instanceof Object[])) return;
            Object[] pr = (Object[]) sel;
            if ((double) pr[1] <= 0 || Json.str(data(pr[0]).get("customer")).isEmpty()) { msg.setText(L("noReady")); return; }
            JTextField dt = new JTextField(LocalDate.now().toString()), terms = new JTextField("30"), tax = new JTextField(String.valueOf((long) num(spec().get("defaultTax"))));
            JPanel p = new JPanel(new GridLayout(0, 2, 6, 6));
            p.add(new JLabel(L("date"))); p.add(dt); p.add(new JLabel(L("terms"))); p.add(terms); p.add(new JLabel(L("tax"))); p.add(tax);
            if (JOptionPane.showConfirmDialog(this, p, L("createInvoice") + " · " + Json.str(Json.obj(pr[0]).get("code")), JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) return;
            billNow(pr[0], dt.getText().trim(), (int) num(terms.getText()), num(tax.getText()));
        }

        public void billNow(Object proj, String date, int terms, double tax) {
            Map<String, Object> body = new LinkedHashMap<>(); body.put("taxPct", tax); body.put("date", date); body.put("termsDays", terms);
            Ui.async(() -> Api.I.ops("POST", "/erp/prj/projects/" + Json.str(Json.obj(proj).get("id")) + "/bill", body), r -> {
                lastInvoice = Json.str(Json.obj(r).get("invoice"));
                pending = L("billDone", lastInvoice, num(Json.obj(r).get("total")) == Math.floor(num(Json.obj(r).get("total"))) ? String.valueOf((long) num(Json.obj(r).get("total"))) : String.valueOf(num(Json.obj(r).get("total"))));
                reload();
            }, m -> Ui.warn(this, m));
        }

        void exportVat() {
            Map<String, Object> v = Json.obj(data.get("vat"));
            if (v.isEmpty()) return;
            JFileChooser fc = new JFileChooser(); fc.setSelectedFile(new File("vat-return-" + Json.str(v.get("from")) + "-" + Json.str(v.get("to")) + ".csv"));
            if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
            StringBuilder sb = new StringBuilder("﻿side,category,count,net,vat\n");
            for (String side : new String[]{"sales", "purchases"}) for (Object bv : Json.arr(v.get(side))) { Map<String, Object> x = Json.obj(bv); sb.append(side).append(',').append(Json.str(x.get("category"))).append(',').append((long) num(x.get("count"))).append(',').append(num(x.get("net"))).append(',').append(num(x.get("vat"))).append('\n'); }
            sb.append("sales,TOTAL,").append((long) num(v.get("salesInvoices"))).append(',').append(num(v.get("salesNet"))).append(',').append(num(v.get("outputVat"))).append('\n');
            sb.append("purchases,TOTAL,").append((long) num(v.get("purchaseInvoices"))).append(',').append(num(v.get("purchasesNet"))).append(',').append(num(v.get("inputVat"))).append('\n');
            sb.append("net vat due,,,,").append(num(v.get("netVatDue"))).append('\n');
            try { Files.writeString(fc.getSelectedFile().toPath(), sb.toString(), StandardCharsets.UTF_8); msg.setText(fc.getSelectedFile().getPath()); } catch (IOException e) { Ui.warn(this, e.getMessage()); }
        }

        public void saveProfile() {
            Map<String, Object> b = new LinkedHashMap<>();
            for (Map.Entry<String, JTextField> e : fields.entrySet()) b.put(e.getKey(), e.getValue().getText().trim());
            if (Json.str(b.get("sellerName")).isEmpty()) { msg.setText(L("sellerReq")); return; }
            if (!Json.str(b.get("vatNo")).isEmpty() && Json.str(b.get("vatNo")).length() != 15) { msg.setText(L("vatLen")); return; }
            Ui.async(() -> Api.I.ops("PUT", "/finance/zatca/profile", b), r -> msg.setText(L("saved")), m -> msg.setText(m));
        }
    }
}
