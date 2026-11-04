package erp;

import java.awt.*;
import java.time.LocalDate;
import java.util.*;
import java.util.List;
import javax.swing.*;

import static erp.I18n.t;

/** Operations and finance actions: work orders, accounting periods and the monthly depreciation run. Same endpoints and rules as the portal. */
public final class Actions {
    private Actions() { }

    static double num(Object v) { return SiteRender.num(v, 0); }
    static double r2(double v) { return Math.round(v * 100) / 100.0; }
    static String s(Object o) { return o == null ? "" : o instanceof Double && (Double) o == Math.rint((Double) o) ? String.valueOf((long) (double) (Double) o) : o instanceof Number ? String.valueOf(o) : Json.str(o); }
    static Map<String, Object> data(Object rec) { return Json.obj(Json.obj(rec).get("data")); }
    /** A list the user may not read just stays empty. */
    static List<Object> fetch(String path) { try { return Json.arr(Api.I.ops("GET", path, null)); } catch (Exception e) { return new ArrayList<>(); } }

    static String nextMonth(String p) {
        int y = Integer.parseInt(p.substring(0, 4)), m = Integer.parseInt(p.substring(5, 7));
        return m == 12 ? (y + 1) + "-01" : String.format("%d-%02d", y, m + 1);
    }
    static List<String> periodsDue(Map<String, Object> d, String upTo) {
        String last = s(d.get("lastPeriod"));
        String start = !last.isEmpty() ? nextMonth(last) : s(d.get("inServiceDate")).length() >= 7 ? s(d.get("inServiceDate")).substring(0, 7) : "";
        List<String> out = new ArrayList<>();
        if (start.length() != 7 || start.compareTo(upTo) > 0) return out;
        for (String p = start; p.compareTo(upTo) <= 0 && out.size() < 600; p = nextMonth(p)) out.add(p);
        return out;
    }
    /** {amount, months, last} - depreciation for every month still due; stops at the salvage value. */
    static Object[] depreciationDue(Map<String, Object> d, String upTo) {
        double acc = num(d.get("accumulated")), cost = num(d.get("cost")), salvage = num(d.get("salvage")), total = 0; String last = ""; int n = 0;
        int life = (int) Math.max(1, Math.round(num(d.get("lifeMonths")) == 0 ? 60 : num(d.get("lifeMonths"))));
        for (String p : periodsDue(d, upTo)) {
            double nbv = cost - acc, m = "DB".equals(d.get("method")) ? nbv * (2.0 / life) : (cost - salvage) / life;
            m = Math.max(0, Math.min(m, nbv - salvage));
            if (m <= 0.004) break;
            acc += m; total += m; last = p; n++;
        }
        return new Object[]{r2(total), n, last};
    }

    static double invoiceTotal(Map<String, Object> d) { return num(d.get("total")) > 0 ? num(d.get("total")) : num(d.get("amount")) + num(d.get("taxAmount")); }
    static String matchInvoice(Map<String, Object> d, double tol) {
        if (s(d.get("poNo")).trim().isEmpty()) return "NoPO";
        double limit = Math.min(num(d.get("poAmount")), num(d.get("receivedAmount")));
        if (limit <= 0) return "Mismatch";
        return invoiceTotal(d) <= limit * (1 + tol / 100) ? "Matched" : "Mismatch";
    }
    static Map<String, Object> line(Object acc, double dr, double cr, Object memo, Map<String, Object> dims) {
        Map<String, Object> l = new LinkedHashMap<>(); l.put("account", acc); l.put("debit", dr); l.put("credit", cr); l.put("memo", memo);
        if (dims != null) { l.put("costCenter", s(dims.get("costCenter"))); l.put("project", s(dims.get("project"))); }
        return l;
    }
    /** Journal lines for an invoice (same rules as the portal's posting service); null when the default accounts are missing. */
    static List<Object> ledgerLines(String side, Map<String, Object> d, Map<String, Object> df) {
        double total = r2(invoiceTotal(d)), tax = r2(num(d.get("taxAmount"))), net = r2(total - tax);
        List<Object> out = new ArrayList<>();
        if (side.equals("ap")) {
            String exp = !s(d.get("account")).isEmpty() ? s(d.get("account")) : s(df.get("expenseAccount"));
            if (s(df.get("apAccount")).isEmpty() || exp.isEmpty()) return null;
            boolean vat = tax != 0 && !s(df.get("vatInput")).isEmpty();
            out.add(line(exp, vat ? net : total, 0.0, d.get("vendor"), d));
            if (vat) out.add(line(df.get("vatInput"), tax, 0.0, "VAT", null));
            out.add(line(df.get("apAccount"), 0.0, total, d.get("vendor"), null));
            return out;
        }
        String rev = !s(d.get("account")).isEmpty() ? s(d.get("account")) : s(df.get("revenueAccount"));
        if (s(df.get("arAccount")).isEmpty() || rev.isEmpty()) return null;
        boolean vat = tax != 0 && !s(df.get("vatOutput")).isEmpty();
        out.add(line(df.get("arAccount"), total, 0.0, d.get("customer"), null));
        out.add(line(rev, 0.0, vat ? net : total, d.get("customer"), d));
        if (vat) out.add(line(df.get("vatOutput"), 0.0, tax, "VAT", null));
        return out;
    }

    public static final class ActionsPanel extends JPanel implements Reloadable {
        public final JTabbedPane tabs = new JTabbedPane();
        public final JLabel msg = new JLabel();
        final List<Runnable> views = new ArrayList<>();
        // work orders
        public Ui.DataTable wo, per, dep;
        public JComboBox<String> bom = new JComboBox<>();
        public JSpinner qty = new JSpinner(new SpinnerNumberModel(1.0, 0.01, 1e9, 1.0)), year = new JSpinner(new SpinnerNumberModel(LocalDate.now().getYear(), 2000, 2100, 1));
        public JTextField due = new JTextField(LocalDate.now().plusDays(7).toString(), 10), month = new JTextField(LocalDate.now().toString().substring(0, 7), 8);
        public Ui.DataTable inv; public JComboBox<String> side = new JComboBox<>(new String[]{t("act.ar"), t("act.ap")}); public JButton bPost, bEinv; List<Object> invRows = new ArrayList<>(); Map<String, Object> invDefaults = new HashMap<>(); double tol = 2;
        public JButton bRel, bStart, bDone, bCancel, bClose, bOpen, bRun;
        public JLabel total = new JLabel();
        List<Object> boms = new ArrayList<>(), woRows = new ArrayList<>(), perRows = new ArrayList<>(), assets = new ArrayList<>();
        Map<String, Double> stock = new HashMap<>();
        Map<String, Object> defaults = new HashMap<>();
        List<Object[]> items = new ArrayList<>();

        public ActionsPanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            add(Ui.label(t("act.title"), "title"), BorderLayout.NORTH); add(tabs); add(msg, BorderLayout.SOUTH);
            if (Api.I.can("mfg.view")) { tabs.addTab(t("act.v.wo"), buildWo()); views.add(this::loadWo); }
            if (Api.I.can("finance.gl.view")) { tabs.addTab(t("act.v.per"), buildPer()); views.add(this::loadPer); }
            if (Api.I.can("finance.assets.view")) { tabs.addTab(t("act.v.depr"), buildDep()); views.add(this::loadDep); }
            if (Api.I.can("finance.ar.view")) { tabs.addTab(t("act.v.inv"), buildInv()); views.add(this::loadInv); }
            tabs.addChangeListener(e -> { int i = tabs.getSelectedIndex(); if (i >= 0 && i < views.size()) views.get(i).run(); });
        }
        @Override public void reload() { int i = tabs.getSelectedIndex(); if (i >= 0 && i < views.size()) views.get(i).run(); }
        void say(String m) { msg.setText(m); }

        // ------------------------------------------------ work orders
        JPanel buildWo() {
            wo = new Ui.DataTable(t("act.code"), t("act.sku"), t("act.qty"), t("act.due"), t("act.status"), t("mfg.wo.actual"), t("mfg.wo.variance"));
            JPanel p = new JPanel(new BorderLayout(0, 6)); p.add(new JScrollPane(wo));
            bRel = Ui.button(t("mfg.wo.release"), () -> step("release"), null); bStart = Ui.button(t("mfg.wo.start"), () -> step("start"), null);
            bDone = Ui.button(t("mfg.wo.complete"), this::complete, null); bCancel = Ui.button(t("mfg.wo.cancel"), () -> step("cancel"), "danger");
            JPanel bottom = new JPanel(new GridLayout(0, 1, 0, 4));
            bottom.add(Ui.row(bRel, bStart, bDone, bCancel, Ui.button(t("act.refresh"), this::loadWo, "plain")));
            JPanel f = Ui.row(new JLabel(t("act.bom")), bom, new JLabel(t("act.qty")), qty, new JLabel(t("act.due")), due, Ui.button(t("act.create"), this::createWo, null));
            f.setVisible(Api.I.can("mfg.orders.manage")); bottom.add(f);
            p.add(bottom, BorderLayout.SOUTH);
            wo.getSelectionModel().addListSelectionListener(e -> gateWo()); gateWo();
            return p;
        }
        void gateWo() {
            String st = s(Json.obj(wo.selected()).get("status"));
            boolean mg = Api.I.can("mfg.orders.manage"), ex = Api.I.can("mfg.orders.execute");
            bRel.setEnabled(st.equals("Planned") && mg); bStart.setEnabled(st.equals("Released") && ex); bDone.setEnabled(st.equals("InProgress") && ex); bCancel.setEnabled((st.equals("Planned") || st.equals("Released")) && mg);
        }
        void loadWo() {
            Ui.async(() -> new Object[]{fetch("/erp/mfg/records/workorder?take=5000"), fetch("/erp/mfg/records/bom?take=5000"), fetch("/erp/mfg/stock")}, r -> {
                woRows = (List<Object>) r[0]; boms = (List<Object>) r[1]; stock.clear();
                for (Object x : (List<Object>) r[2]) stock.put(s(Json.obj(x).get("sku")), num(Json.obj(x).get("qty")));
                List<String[]> rows = new ArrayList<>();
                for (Object o : woRows) { Map<String, Object> rec = Json.obj(o), d = data(o); rows.add(new String[]{s(rec.get("code")), s(d.get("sku")), s(d.get("qty")), s(d.get("due")), s(rec.get("status")), s(d.get("actualCost")), s(d.get("variance"))}); }
                wo.fill(rows, woRows);
                bom.removeAllItems();
                for (Object b : boms) if (!"Inactive".equals(Json.obj(b).get("status"))) bom.addItem(s(Json.obj(b).get("code")) + " · " + s(data(b).get("name")));
                gateWo();
            }, this::say);
        }
        void step(String a) {
            Object r = wo.selected(); if (r == null) return;
            Ui.async(() -> Api.I.ops("POST", "/mfg/workorders/" + Json.obj(r).get("id") + "/" + a, new LinkedHashMap<>()), x -> { say(t("act.done")); loadWo(); }, e -> Ui.warn(this, e));
        }
        void complete() {
            Object r = wo.selected(); if (r == null) return;
            Map<String, Object> d = data(r);
            double bq = num(d.get("bomQty")) > 0 ? num(d.get("bomQty")) : 1;
            JSpinner q = new JSpinner(new SpinnerNumberModel(num(d.get("qty")), 0.0, 1e9, 1.0)), sc = new JSpinner(new SpinnerNumberModel(0.0, 0.0, 1e9, 1.0)), hr = new JSpinner(new SpinnerNumberModel(r2(num(d.get("routingMinutes")) / 60 * (num(d.get("qty")) / bq)), 0.0, 1e9, 0.5));
            JTextField note = new JTextField(20);
            Ui.DataTable mat = new Ui.DataTable(t("act.sku"), t("mfg.wo.need"), t("mfg.wo.have"));
            Runnable paint = () -> {
                double f = (((Number) q.getValue()).doubleValue() + ((Number) sc.getValue()).doubleValue()) / bq; List<String[]> rows = new ArrayList<>(); List<Object> pay = new ArrayList<>();
                for (Object lo : Json.arr(d.get("lines"))) { Map<String, Object> l = Json.obj(lo); rows.add(new String[]{s(l.get("sku")), s(r2(num(l.get("qty")) * f * (1 + num(l.get("scrapPct")) / 100))), s(stock.getOrDefault(s(l.get("sku")), 0.0))}); pay.add(l); }
                mat.fill(rows, pay);
            };
            q.addChangeListener(e -> paint.run()); sc.addChangeListener(e -> paint.run()); paint.run();
            JPanel form = new JPanel(new GridLayout(0, 2, 6, 6));
            form.add(new JLabel(t("mfg.wo.good"))); form.add(q); form.add(new JLabel(t("mfg.wo.scrap"))); form.add(sc); form.add(new JLabel(t("mfg.wo.hours"))); form.add(hr); form.add(new JLabel(t("erp.f.notes"))); form.add(note);
            JPanel box = new JPanel(new BorderLayout(0, 6)); box.add(form, BorderLayout.NORTH); box.add(Ui.label(t("mfg.wo.materials"), "title"), BorderLayout.CENTER);
            JScrollPane sp = new JScrollPane(mat); sp.setPreferredSize(new Dimension(420, 120)); box.add(sp, BorderLayout.SOUTH);
            if (JOptionPane.showConfirmDialog(this, box, t("mfg.wo.complete") + " " + s(Json.obj(r).get("code")), JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) return;
            Map<String, Object> b = new LinkedHashMap<>(); b.put("qty", ((Number) q.getValue()).doubleValue()); b.put("scrap", ((Number) sc.getValue()).doubleValue()); b.put("hours", ((Number) hr.getValue()).doubleValue()); b.put("note", note.getText());
            Ui.async(() -> Api.I.ops("POST", "/mfg/workorders/" + Json.obj(r).get("id") + "/complete", b), x -> { say(t("act.done")); loadWo(); }, e -> Ui.warn(this, e));
        }
        void createWo() {
            int i = bom.getSelectedIndex(); if (i < 0) return;
            List<Object> usable = new ArrayList<>(); for (Object b : boms) if (!"Inactive".equals(Json.obj(b).get("status"))) usable.add(b);
            Object b = usable.get(i); Map<String, Object> bd = data(b), d = new LinkedHashMap<>();
            d.put("sku", Json.obj(b).get("code")); d.put("qty", ((Number) qty.getValue()).doubleValue()); d.put("due", due.getText()); d.put("priority", "Normal"); d.put("workCenter", bd.getOrDefault("workCenter", ""));
            d.put("lines", bd.getOrDefault("lines", new ArrayList<>())); d.put("bomQty", bd.getOrDefault("qty", 1.0)); d.put("routingMinutes", bd.getOrDefault("routingMinutes", 0.0));
            Map<String, Object> body = new LinkedHashMap<>(); body.put("status", "Planned"); body.put("data", d);
            Ui.async(() -> Json.obj(Api.I.ops("POST", "/erp/mfg/records/workorder", body)), r -> { say(t("act.created").replace("{n}", s(r.get("code")))); loadWo(); }, e -> Ui.warn(this, e));
        }

        // ------------------------------------------------ accounting periods
        JPanel buildPer() {
            per = new Ui.DataTable(t("fin.per.code"), t("act.status"));
            JPanel p = new JPanel(new BorderLayout(0, 6)); p.add(new JScrollPane(per));
            bClose = Ui.button(t("fin.per.close"), () -> setPer("Closed"), null); bOpen = Ui.button(t("fin.per.reopen"), () -> setPer("Open"), "plain");
            JButton g = Ui.button(t("fin.per.generate"), this::generate, null); g.setVisible(Api.I.can("finance.gl.approve"));
            p.add(Ui.row(bClose, bOpen, new JLabel(t("act.year")), year, g), BorderLayout.SOUTH);
            per.getSelectionModel().addListSelectionListener(e -> gatePer()); gatePer();
            return p;
        }
        void gatePer() {
            Object r = per.selected(); String st = s(Json.obj(r).get("status")); boolean ok = Api.I.can("finance.gl.approve");
            bClose.setEnabled(ok && r != null && !st.equals("Closed")); bOpen.setEnabled(ok && st.equals("Closed"));
        }
        void loadPer() {
            Ui.async(() -> { List<Object> l = fetch("/finance/records/period"); l.sort(Comparator.comparing(o -> s(Json.obj(o).get("code")))); return l; }, l -> {
                perRows = l; List<String[]> rows = new ArrayList<>();
                for (Object o : l) { String st = s(Json.obj(o).get("status")); rows.add(new String[]{s(Json.obj(o).get("code")), t("fin.st." + (st.isEmpty() ? "Open" : st))}); }
                per.fill(rows, l); gatePer();
            }, this::say);
        }
        void setPer(String status) {
            Object r = per.selected(); if (r == null) return;
            Map<String, Object> b = new LinkedHashMap<>(); b.put("status", status); b.put("data", Json.obj(r).get("data") == null ? new LinkedHashMap<>() : Json.obj(r).get("data"));
            Ui.async(() -> Api.I.ops("PUT", "/finance/records/period/" + Json.obj(r).get("id"), b), x -> loadPer(), e -> Ui.warn(this, e));
        }
        void generate() {
            Set<String> have = new HashSet<>(); for (Object o : perRows) have.add(s(Json.obj(o).get("code")));
            int y = ((Number) year.getValue()).intValue(); List<String> todo = new ArrayList<>();
            for (int m = 1; m <= 12; m++) { String c = String.format("%d-%02d", y, m); if (!have.contains(c)) todo.add(c); }
            Ui.async(() -> { for (String c : todo) { Map<String, Object> b = new LinkedHashMap<>(); b.put("code", c); b.put("status", "Open"); b.put("data", new LinkedHashMap<>()); Api.I.ops("POST", "/finance/records/period", b); } return todo.size(); },
                n -> { say(t("act.perCreated").replace("{n}", String.valueOf(n))); loadPer(); }, e -> { Ui.warn(this, e); loadPer(); });
        }

        // ------------------------------------------------ depreciation
        JPanel buildDep() {
            dep = new Ui.DataTable(t("act.asset"), t("act.months"), t("act.amount"));
            JPanel p = new JPanel(new BorderLayout(0, 6));
            p.add(Ui.row(new JLabel(t("fin.asset.upTo")), month), BorderLayout.NORTH); p.add(new JScrollPane(dep));
            month.addActionListener(e -> paintDep()); month.addFocusListener(new java.awt.event.FocusAdapter() { @Override public void focusLost(java.awt.event.FocusEvent e) { paintDep(); } });
            bRun = Ui.button(t("fin.asset.run"), this::runDep, null); bRun.setVisible(Api.I.can("finance.assets.manage") && Api.I.can("finance.gl.manage"));
            JPanel bot = new JPanel(new GridLayout(0, 1)); bot.add(total); bot.add(Ui.row(bRun)); p.add(bot, BorderLayout.SOUTH);
            return p;
        }
        void loadDep() {
            Ui.async(() -> new Object[]{fetch("/finance/records/asset"), fetch("/finance/records/setting")}, r -> {
                assets = (List<Object>) r[0]; defaults = new HashMap<>();
                for (Object o : (List<Object>) r[1]) if ("defaults".equals(Json.obj(o).get("code"))) defaults = data(o);
                paintDep();
            }, this::say);
        }
        void paintDep() {
            items.clear(); List<String[]> rows = new ArrayList<>(); List<Object> pay = new ArrayList<>(); double tot = 0;
            for (Object a : assets) {
                if (!"Active".equals(Json.obj(a).get("status"))) continue;
                Object[] d = depreciationDue(data(a), month.getText().trim());
                if ((Double) d[0] <= 0) continue;
                items.add(new Object[]{a, d}); tot += (Double) d[0]; pay.add(a);
                String nm = s(data(a).get("name")); rows.add(new String[]{nm.isEmpty() ? s(Json.obj(a).get("code")) : nm, s(d[1]), String.format(Locale.ENGLISH, "%.2f", (Double) d[0])});
            }
            dep.fill(rows, pay);
            total.setText(items.isEmpty() ? t("fin.asset.nothingDue") : t("act.total") + ": " + String.format(Locale.ENGLISH, "%.2f", r2(tot)));
            bRun.setEnabled(!items.isEmpty());
        }
        void runDep() {
            String m = month.getText().trim();
            if (s(defaults.get("deprExpense")).isEmpty() || s(defaults.get("deprAccum")).isEmpty()) { Ui.warn(this, t("fin.needDefaults")); return; }
            double tot = 0; for (Object[] it : items) tot += (Double) ((Object[]) it[1])[0]; double total2 = r2(tot);
            List<Object[]> its = new ArrayList<>(items);
            Map<String, Object> l1 = new LinkedHashMap<>(), l2 = new LinkedHashMap<>(), d = new LinkedHashMap<>(), body = new LinkedHashMap<>();
            l1.put("account", defaults.get("deprExpense")); l1.put("debit", total2); l1.put("credit", 0.0); l1.put("memo", m);
            l2.put("account", defaults.get("deprAccum")); l2.put("debit", 0.0); l2.put("credit", total2); l2.put("memo", m);
            d.put("date", m + "-" + String.format("%02d", java.time.YearMonth.of(Integer.parseInt(m.substring(0, 4)), Integer.parseInt(m.substring(5, 7))).lengthOfMonth()));
            d.put("memo", t("fin.asset.deprMemo") + " " + m); d.put("reference", "DEPR-" + m); d.put("rate", 1.0); d.put("lines", new ArrayList<>(List.of(l1, l2)));
            body.put("status", "Draft"); body.put("data", d);
            Ui.async(() -> {
                Map<String, Object> j = Json.obj(Api.I.ops("POST", "/finance/records/journal", body));
                for (Object[] it : its) {
                    Map<String, Object> nd = new LinkedHashMap<>(data(it[0])); Object[] dd = (Object[]) it[1];
                    nd.put("accumulated", r2(num(nd.get("accumulated")) + (Double) dd[0])); nd.put("lastPeriod", dd[2]);
                    Map<String, Object> ub = new LinkedHashMap<>(); ub.put("status", Json.obj(it[0]).get("status")); ub.put("data", nd);
                    Api.I.ops("PUT", "/finance/records/asset/" + Json.obj(it[0]).get("id"), ub);
                }
                return s(j.get("code"));
            }, code -> { say(t("fin.asset.runDone").replace("{n}", code)); loadDep(); }, e -> Ui.warn(this, e));
        }

        // ------------------------------------------------ invoices
        String sd() { return side.getSelectedIndex() == 1 ? "ap" : "ar"; }
        String invKind() { return sd().equals("ap") ? "apinvoice" : "arinvoice"; }
        JPanel buildInv() {
            inv = new Ui.DataTable(t("act.code"), t("act.party"), t("act.inv.total"), t("act.status"), t("fin.ap.match"), t("act.gl"));
            JPanel p = new JPanel(new BorderLayout(0, 6)); p.add(Ui.row(side), BorderLayout.NORTH); p.add(new JScrollPane(inv));
            side.addActionListener(e -> loadInv());
            bPost = Ui.button(t("act.post"), this::postInv, null); bEinv = Ui.button(t("act.einv"), this::einvoice, "plain");
            p.add(Ui.row(bPost, bEinv), BorderLayout.SOUTH);
            inv.getSelectionModel().addListSelectionListener(e -> gateInv()); gateInv();
            return p;
        }
        void gateInv() {
            Object r = inv.selected(); String st = s(Json.obj(r).get("status")); boolean ap = sd().equals("ap");
            boolean postable = r != null && s(data(r).get("glJournal")).isEmpty() && (ap ? (st.equals("Approved") || st.equals("Paid")) : (st.equals("Issued") || st.equals("Paid")));
            bPost.setEnabled(postable && Api.I.can("finance.gl.manage"));
            bEinv.setVisible(!ap && (Api.I.can("finance.ar.view") || Api.I.can("gov.zatca.manage"))); bEinv.setEnabled(st.equals("Issued") || st.equals("Paid"));
        }
        void loadInv() {
            String k = invKind();
            Ui.async(() -> new Object[]{fetch("/finance/records/" + k), fetch("/finance/records/setting")}, r -> {
                invRows = (List<Object>) r[0]; invDefaults = new HashMap<>(); tol = 2;
                for (Object o : (List<Object>) r[1]) { String c = s(Json.obj(o).get("code")); if (c.equals("defaults")) invDefaults = data(o); if (c.equals("controls") && data(o).get("matchTolerancePct") != null) tol = num(data(o).get("matchTolerancePct")); }
                boolean ap = sd().equals("ap"); List<String[]> rows = new ArrayList<>();
                for (Object o : invRows) {
                    Map<String, Object> rec = Json.obj(o), d = data(o); String st = s(rec.get("status")).isEmpty() ? "Draft" : s(rec.get("status"));
                    rows.add(new String[]{s(rec.get("code")), s(d.get(ap ? "vendor" : "customer")), String.format(Locale.ENGLISH, "%.2f", r2(invoiceTotal(d))), t("fin.st." + st), ap ? t("fin.match." + matchInvoice(d, tol)) : "", s(d.get("glJournal"))});
                }
                inv.fill(rows, invRows); gateInv();
            }, this::say);
        }
        void postInv() {
            Object r = inv.selected(); if (r == null) return;
            String side0 = sd(); Map<String, Object> d = data(r);
            List<Object> ls = ledgerLines(side0, d, invDefaults);
            if (ls == null) { Ui.warn(this, t("fin.needDefaults")); return; }
            List<Object> lines = new ArrayList<>(); for (Object l : ls) if (num(Json.obj(l).get("debit")) != 0 || num(Json.obj(l).get("credit")) != 0) lines.add(l);
            Map<String, Object> jd = new LinkedHashMap<>(), body = new LinkedHashMap<>();
            jd.put("date", s(d.get("date")).length() >= 10 ? s(d.get("date")).substring(0, 10) : s(d.get("date"))); jd.put("memo", s(d.get(side0.equals("ap") ? "vendor" : "customer")) + " · " + (side0.equals("ap") ? s(d.get("invoiceNo")) : s(Json.obj(r).get("code"))));
            jd.put("reference", Json.obj(r).get("code")); jd.put("currency", s(d.get("currency"))); jd.put("rate", num(d.get("rate")) > 0 ? num(d.get("rate")) : 1.0); jd.put("lines", lines);
            body.put("status", "Draft"); body.put("data", jd); String kind = invKind();
            Ui.async(() -> {
                Map<String, Object> j = Json.obj(Api.I.ops("POST", "/finance/records/journal", body));
                Map<String, Object> nd = new LinkedHashMap<>(d); nd.put("glJournal", j.get("code"));
                Map<String, Object> ub = new LinkedHashMap<>(); ub.put("status", Json.obj(r).get("status")); ub.put("data", nd);
                Api.I.ops("PUT", "/finance/records/" + kind + "/" + Json.obj(r).get("id"), ub);
                return s(j.get("code"));
            }, code -> { say(t("fin.inv.glDone").replace("{n}", code)); loadInv(); }, e -> Ui.warn(this, e));
        }
        void einvoice() {
            Object r = inv.selected(); if (r == null) return;
            String id = s(Json.obj(r).get("id")), code = s(Json.obj(r).get("code"));
            JTextArea info = new JTextArea(14, 52); info.setEditable(false); info.setLineWrap(true);
            Map<String, Object>[] z = new Map[]{new LinkedHashMap<String, Object>()};
            JButton bIssue = Ui.button(t("gov.zatca.issue"), () -> { }, null), bXml = Ui.button(t("act.xml"), () -> { }, "plain");
            Runnable paint = () -> {
                Map<String, Object> m = z[0];
                info.setText(!Boolean.TRUE.equals(m.get("issued")) ? t("gov.zatca.notIssued") + "\n\n" + t("gov.zatca.phaseNote")
                    : String.join("\n", t("gov.zatca.type") + ": " + s(m.get("type")), t("gov.zatca.icv") + ": " + s(m.get("icv")), "UUID: " + s(m.get("uuid")), t("gov.zatca.hash") + ": " + s(m.get("hash")), t("gov.zatca.pih") + ": " + s(m.get("pih")),
                        t("gov.zatca.issued") + ": " + s(m.get("issuedAt")) + " · " + s(m.get("issuedBy")), t(Boolean.TRUE.equals(m.get("signed")) ? "gov.zatca.signed" : "gov.zatca.unsigned"), "", t("act.qr") + ":\n" + s(m.get("qr"))));
                bIssue.setEnabled(!Boolean.TRUE.equals(m.get("issued"))); bXml.setEnabled(!s(m.get("xml")).isEmpty());
            };
            bIssue.addActionListener(e -> Ui.async(() -> Json.obj(Api.I.ops("POST", "/finance/zatca/issue/" + id, new LinkedHashMap<>())), m -> { z[0] = m; paint.run(); }, er -> Ui.warn(this, er)));
            bXml.addActionListener(e -> { JFileChooser fc = new JFileChooser(); fc.setSelectedFile(new java.io.File(code + ".xml")); if (fc.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) try { java.nio.file.Files.writeString(fc.getSelectedFile().toPath(), s(z[0].get("xml"))); } catch (Exception ex) { Ui.warn(this, ex.getMessage()); } });
            paint.run(); bIssue.setEnabled(false); bXml.setEnabled(false);
            Ui.async(() -> Json.obj(Api.I.ops("GET", "/finance/zatca/invoice/" + id, null)), m -> { z[0] = m; paint.run(); }, er -> info.setText(er));
            JPanel box = new JPanel(new BorderLayout(0, 6)); box.add(new JScrollPane(info)); box.add(Ui.row(bIssue, bXml), BorderLayout.SOUTH);
            JOptionPane.showMessageDialog(this, box, t("gov.zatca.title") + " · " + code, JOptionPane.PLAIN_MESSAGE);
        }
    }
}
