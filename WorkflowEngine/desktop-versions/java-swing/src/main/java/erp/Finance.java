package erp;

import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.io.InputStream;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import javax.swing.*;

/**
 * Finance reports: overview, trial balance, income statement, balance sheet, receivables / payables ageing, budgets, projects, fixed assets,
 * bank reconciliation and the audit trail. Described by finance.json (shared by every desktop app); the figures are calculated from the same
 * finance records as the portal (port of fin.calc.ts).
 */
public final class Finance {
    private Finance() { }

    static Map<String, Object> SPEC;
    static synchronized Map<String, Object> spec() {
        if (SPEC == null) {
            try (InputStream in = Finance.class.getResourceAsStream("/finance.json")) {
                SPEC = Json.obj(Json.parse(new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)));
            } catch (Exception e) { throw new RuntimeException(e); }
        }
        return SPEC;
    }

    static String L(String key, Object... args) {
        String s = Json.str(Json.arr(Json.obj(spec().get("labels")).get(key)).get("ar".equals(I18n.lang) ? 1 : 0));
        for (int i = 0; i < args.length; i++) s = s.replace("{" + i + "}", String.valueOf(args[i]));
        return s;
    }
    static String tx(Object o) { return Json.str(Json.obj(o).get("ar".equals(I18n.lang) ? "ar" : "en")); }
    static String money(double v) { return String.format(Locale.ENGLISH, "%,.2f", v); }
    static double num(Object v) {
        double n;
        if (v instanceof Number) n = ((Number) v).doubleValue();
        else { try { n = Double.parseDouble(String.valueOf(v)); } catch (Exception e) { n = 0; } }
        return Double.isFinite(n) ? n : 0;
    }
    static double r2(double v) { return Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) / 100.0; }

    static final class Line { String journal, date, account, cc, project; double debit, credit; }
    static final class Tb { String account, name, type; double debit, credit, balance; }
    public static final class Filters { public String from = "", to = "", company = ""; }
    public static final class Built { public final List<String[]> rows = new ArrayList<>(); public final List<Object> payloads = new ArrayList<>(); public String foot = ""; }

    static List<Line> postedLines(List<Object> journals, Filters f) {
        List<Line> out = new ArrayList<>();
        for (Object jo : journals) {
            Map<String, Object> j = Json.obj(jo), d = Json.obj(j.get("data"));
            if (!"Posted".equals(Json.str(j.get("status")))) continue;
            String dt = Json.str(d.get("date")); dt = dt.length() > 10 ? dt.substring(0, 10) : dt;
            if (dt.isEmpty() || (!f.from.isEmpty() && dt.compareTo(f.from) < 0) || (!f.to.isEmpty() && dt.compareTo(f.to) > 0)) continue;
            String co = Json.str(j.get("company"));
            if (!f.company.isEmpty() && !"ALL".equals(f.company) && !co.isEmpty() && !co.equals(f.company)) continue;
            double rate = num(d.get("rate")) > 0 ? num(d.get("rate")) : 1;
            for (Object lo : Json.arr(d.get("lines"))) {
                Map<String, Object> l = Json.obj(lo);
                Line x = new Line();
                x.journal = Json.str(j.get("code")); x.date = dt; x.account = Json.str(l.get("account")); x.cc = Json.str(l.get("costCenter")); x.project = Json.str(l.get("project"));
                x.debit = r2(num(l.get("debit")) * rate); x.credit = r2(num(l.get("credit")) * rate);
                out.add(x);
            }
        }
        return out;
    }

    static String accName(Map<String, Object> a) {
        Map<String, Object> d = Json.obj(a.get("data"));
        String n = "ar".equals(I18n.lang) && !Json.str(d.get("nameAr")).isEmpty() ? Json.str(d.get("nameAr")) : Json.str(d.get("name"));
        return n.isEmpty() ? Json.str(a.get("code")) : n;
    }

    static List<Tb> trialBalance(List<Line> lines, List<Object> accounts) {
        Map<String, double[]> sums = new LinkedHashMap<>();
        for (Line l : lines) { double[] s = sums.computeIfAbsent(l.account, k -> new double[2]); s[0] += l.debit; s[1] += l.credit; }
        List<Map<String, Object>> accs = new ArrayList<>();
        for (Object o : accounts) accs.add(Json.obj(o));
        accs.sort(Comparator.comparing(a -> Json.str(a.get("code"))));
        List<Tb> rows = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Map<String, Object> a : accs) {
            String code = Json.str(a.get("code"));
            seen.add(code);
            double[] s = sums.get(code);
            if (s == null) continue;
            String type = Json.str(Json.obj(a.get("data")).get("type"));
            boolean dn = type.equals("Asset") || type.equals("Expense");
            Tb r = new Tb(); r.account = code; r.name = accName(a); r.type = type; r.debit = r2(s[0]); r.credit = r2(s[1]); r.balance = r2(dn ? s[0] - s[1] : s[1] - s[0]);
            rows.add(r);
        }
        for (Map.Entry<String, double[]> e : sums.entrySet()) if (!seen.contains(e.getKey())) {
            Tb r = new Tb(); r.account = e.getKey(); r.name = e.getKey(); r.type = ""; r.debit = r2(e.getValue()[0]); r.credit = r2(e.getValue()[1]); r.balance = r2(e.getValue()[0] - e.getValue()[1]);
            rows.add(r);
        }
        return rows;
    }
    static double sumType(List<Tb> tb, String type) { double s = 0; for (Tb r : tb) if (r.type.equals(type)) s += r.balance; return r2(s); }
    static double invoiceTotal(Map<String, Object> d) { return num(d.get("total")) > 0 ? num(d.get("total")) : num(d.get("amount")) + num(d.get("taxAmount")); }
    static double outstanding(Map<String, Object> r) {
        Map<String, Object> d = Json.obj(r.get("data"));
        return r2((invoiceTotal(d) - num(d.get("paid"))) * (num(d.get("rate")) > 0 ? num(d.get("rate")) : 1));
    }
    static int bucketOf(long late) { return late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4; }

    /** data: record kind -> list of finance rows ("summary" -> the summary object, "audit" -> the audit rows) */
    public static Built build(String rid, Map<String, Object> data, Filters f, String today) {
        Built b = new Built();
        boolean ar = "ar".equals(I18n.lang);
        if (rid.equals("overview")) {
            Map<String, Object> s = Json.obj(data.get("summary"));
            for (Object mo : Json.arr(spec().get("measures"))) {
                List<Object> m = Json.arr(mo);
                String key = Json.str(m.get(0)), v;
                if (key.equals("currentPeriod")) v = (s.get(key) == null ? "-" : Json.str(s.get(key))) + (Json.str(s.get("currentPeriodStatus")).isEmpty() ? "" : " (" + Json.str(s.get("currentPeriodStatus")) + ")");
                else if (!s.containsKey(key)) v = "-";
                else if (key.equals("assetCount") || key.equals("activeProjects") || key.equals("journalsToApprove") || key.equals("invoicesToApprove")) v = String.valueOf((int) num(s.get(key)));
                else v = money(num(s.get(key)));
                b.rows.add(new String[]{Json.str(m.get(ar ? 2 : 1)), v}); b.payloads.add(null);
            }
            return b;
        }
        List<Object> accs = Json.arr(data.get("account"));
        Map<String, String> types = new HashMap<>();
        for (Object a : accs) types.put(Json.str(Json.obj(a).get("code")), Json.str(Json.obj(Json.obj(a).get("data")).get("type")));
        java.util.function.Function<String, String> typ = c -> types.getOrDefault(c, "");
        java.util.function.Consumer<String[]> add = r -> { b.rows.add(r); b.payloads.add(null); };
        if (Set.of("tb", "income", "balance", "budgets", "projects").contains(rid)) {
            List<Line> lines = postedLines(Json.arr(data.get("journal")), f);
            List<Tb> tb = trialBalance(lines, accs);
            switch (rid) {
                case "tb": {
                    double td = 0, tc = 0;
                    for (Tb r : tb) { add.accept(new String[]{r.account, r.name, r.type, money(r.debit), money(r.credit), money(r.balance)}); td += r.debit; tc += r.credit; }
                    add.accept(new String[]{L("totals"), "", "", money(r2(td)), money(r2(tc)), ""});
                    break;
                }
                case "income": {
                    double tr = sumType(tb, "Revenue"), te = sumType(tb, "Expense");
                    for (Tb r : tb) if (r.type.equals("Revenue")) add.accept(new String[]{L("revenue"), r.account, r.name, money(r.balance)});
                    add.accept(new String[]{L("totalrev"), "", "", money(tr)});
                    for (Tb r : tb) if (r.type.equals("Expense")) add.accept(new String[]{L("expense"), r.account, r.name, money(r.balance)});
                    add.accept(new String[]{L("totalexp"), "", "", money(te)});
                    add.accept(new String[]{L("net"), "", "", money(r2(tr - te))});
                    break;
                }
                case "balance": {
                    double ta = sumType(tb, "Asset"), tl = sumType(tb, "Liability"), ni = r2(sumType(tb, "Revenue") - sumType(tb, "Expense")), te = r2(sumType(tb, "Equity") + ni);
                    for (Tb r : tb) if (r.type.equals("Asset")) add.accept(new String[]{L("assets"), r.account, r.name, money(r.balance)});
                    add.accept(new String[]{L("totass"), "", "", money(ta)});
                    for (Tb r : tb) if (r.type.equals("Liability")) add.accept(new String[]{L("liab"), r.account, r.name, money(r.balance)});
                    add.accept(new String[]{L("totliab"), "", "", money(tl)});
                    for (Tb r : tb) if (r.type.equals("Equity")) add.accept(new String[]{L("equity"), r.account, r.name, money(r.balance)});
                    add.accept(new String[]{L("netincome"), "", "", money(ni)});
                    add.accept(new String[]{L("toteq"), "", "", money(te)});
                    add.accept(new String[]{L("check"), "", "", money(r2(ta - tl - te))});
                    break;
                }
                case "budgets":
                    for (Object bo : Json.arr(data.get("budget"))) {
                        Map<String, Object> d = Json.obj(Json.obj(bo).get("data"));
                        int year = (int) num(d.get("year"));
                        String cc = Json.str(d.get("costCenter")), acc = Json.str(d.get("account"));
                        double actual = 0;
                        for (Line l : lines)
                            if (l.date.startsWith(String.valueOf(year)) && typ.apply(l.account).equals("Expense") && (cc.isEmpty() || l.cc.equals(cc)) && (acc.isEmpty() || l.account.equals(acc))) actual += l.debit - l.credit;
                        actual = r2(actual);
                        double budget = num(d.get("amount"));
                        add.accept(new String[]{cc, acc, String.valueOf(year), money(budget), money(actual), money(r2(budget - actual)), String.valueOf(budget > 0 ? Math.round(actual / budget * 100) : 0)});
                    }
                    break;
                default:
                    for (Object po : Json.arr(data.get("project"))) {
                        String code = Json.str(Json.obj(po).get("code"));
                        double rev = 0, cost = 0;
                        for (Line l : lines) {
                            if (!l.project.equals(code)) continue;
                            if (typ.apply(l.account).equals("Revenue")) rev += l.credit - l.debit;
                            if (typ.apply(l.account).equals("Expense")) cost += l.debit - l.credit;
                        }
                        rev = r2(rev); cost = r2(cost);
                        add.accept(new String[]{code, money(rev), money(cost), money(r2(rev - cost)), String.valueOf(rev > 0 ? Math.round((rev - cost) / rev * 100) : 0)});
                    }
            }
            return b;
        }
        if (rid.equals("ar") || rid.equals("ap")) {
            boolean isAr = rid.equals("ar");
            List<String> open = isAr ? List.of("Issued") : List.of("Submitted", "Approved", "Held");
            String key = isAr ? "customer" : "vendor";
            Map<String, double[]> m = new LinkedHashMap<>();
            for (Object ro : Json.arr(data.get(isAr ? "arinvoice" : "apinvoice"))) {
                Map<String, Object> r = Json.obj(ro), d = Json.obj(r.get("data"));
                if (!open.contains(Json.str(r.get("status")))) continue;
                double amt = outstanding(r);
                if (amt <= 0) continue;
                String due = Json.str(d.get("dueDate")).isEmpty() ? Json.str(d.get("date")) : Json.str(d.get("dueDate"));
                due = due.isEmpty() ? today : (due.length() > 10 ? due.substring(0, 10) : due);
                long late = ChronoUnit.DAYS.between(LocalDate.parse(due), LocalDate.parse(today));
                String p = Json.str(d.get(key)); if (p.isEmpty()) p = "—";
                m.computeIfAbsent(p, k -> new double[5])[bucketOf(late)] += amt;
            }
            List<Map.Entry<String, double[]>> order = new ArrayList<>(m.entrySet());
            order.sort((x, y) -> Double.compare(Arrays.stream(y.getValue()).sum(), Arrays.stream(x.getValue()).sum()));
            double[] totals = new double[5]; double all = 0;
            for (Map.Entry<String, double[]> e : order) {
                String[] row = new String[7]; row[0] = e.getKey(); double t = 0;
                for (int i = 0; i < 5; i++) { double v = r2(e.getValue()[i]); row[i + 1] = money(v); totals[i] += v; t += e.getValue()[i]; }
                row[6] = money(r2(t)); all += r2(t);
                add.accept(row);
            }
            String[] tr = new String[7]; tr[0] = L("totals");
            for (int i = 0; i < 5; i++) tr[i + 1] = money(r2(totals[i]));
            tr[6] = money(r2(all));
            add.accept(tr);
            return b;
        }
        if (rid.equals("assets")) {
            for (Object ao : Json.arr(data.get("asset"))) {
                Map<String, Object> a = Json.obj(ao), d = Json.obj(a.get("data"));
                double cost = num(d.get("cost")), salvage = num(d.get("salvage")), acc = num(d.get("accumulated"));
                int life = Math.max(1, (int) Math.round(num(d.get("lifeMonths")) != 0 ? num(d.get("lifeMonths")) : 60));
                double nbv = r2(cost - acc);
                double monthly = "DB".equals(Json.str(d.get("method"))) ? nbv * (2.0 / life) : (cost - salvage) / life;
                monthly = Math.max(0, Math.min(monthly, nbv - salvage));
                long left = monthly > 0 ? (long) Math.ceil((nbv - salvage) / Math.max(monthly, 0.01)) : 0;
                add.accept(new String[]{Json.str(a.get("code")), Json.str(d.get("name")), money(cost), money(acc), money(nbv), money(r2(monthly)), String.valueOf(left)});
            }
            return b;
        }
        if (rid.equals("bank")) {
            double opening = 0, rec = 0; int un = 0;
            for (Object ao : Json.arr(data.get("bankaccount"))) {
                Map<String, Object> a = Json.obj(ao);
                if (f.company.isEmpty() || Json.str(a.get("code")).equals(f.company)) opening += num(Json.obj(a.get("data")).get("openingBalance"));
            }
            for (Object to : Json.arr(data.get("banktxn"))) {
                Map<String, Object> t = Json.obj(to), d = Json.obj(t.get("data"));
                if (!f.company.isEmpty() && !Json.str(d.get("account")).equals(f.company)) continue;
                boolean done = Boolean.TRUE.equals(d.get("reconciled"));
                String dt = Json.str(d.get("date")); dt = dt.length() > 10 ? dt.substring(0, 10) : dt;
                b.rows.add(new String[]{Json.str(d.get("account")), dt, Json.str(d.get("description")), money(num(d.get("amount"))), done ? L("yes") : ""}); b.payloads.add(t);
                if (done) rec += num(d.get("amount")); else un++;
            }
            b.foot = L("opening") + ": " + money(opening) + "   " + L("reconciledbal") + ": " + money(r2(opening + rec)) + "   " + L("unrec") + ": " + un;
            return b;
        }
        if (rid.equals("audit")) {
            for (Object ao : Json.arr(data.get("audit"))) {
                Map<String, Object> a = Json.obj(ao);
                String at = Json.str(a.get("at")); at = (at.length() > 19 ? at.substring(0, 19) : at).replace('T', ' ');
                add.accept(new String[]{at, Json.str(a.get("userName")), Json.str(a.get("action")), Json.str(a.get("kind")), Json.str(a.get("code")), Json.str(a.get("summary"))});
            }
        }
        return b;
    }

    static final Map<String, String> VIEW = new LinkedHashMap<>();
    static {
        VIEW.put("overview", "finance.reports.view"); VIEW.put("tb", "finance.gl.view"); VIEW.put("income", "finance.gl.view"); VIEW.put("balance", "finance.gl.view");
        VIEW.put("ar", "finance.ar.view"); VIEW.put("ap", "finance.ap.view"); VIEW.put("budgets", "finance.budget.view"); VIEW.put("projects", "finance.projects.view");
        VIEW.put("assets", "finance.assets.view"); VIEW.put("bank", "finance.bank.view"); VIEW.put("audit", "finance.audit.view");
    }
    static String[] kindsOf(String id) {
        switch (id) {
            case "tb": case "income": case "balance": return new String[]{"account", "journal"};
            case "ar": return new String[]{"arinvoice"};
            case "ap": return new String[]{"apinvoice"};
            case "budgets": return new String[]{"account", "journal", "budget"};
            case "projects": return new String[]{"account", "journal", "project"};
            case "assets": return new String[]{"asset"};
            case "bank": return new String[]{"bankaccount", "banktxn"};
            default: return new String[0];
        }
    }

    static Map<String, Object> fetch(String id, String co) {
        Map<String, Object> out = new HashMap<>();
        if (id.equals("overview")) { out.put("summary", Api.I.fin("GET", "summary" + (co.isEmpty() ? "" : "?company=" + co), null)); return out; }
        if (id.equals("audit")) { out.put("audit", Api.I.fin("GET", "audit", null)); return out; }
        for (String k : kindsOf(id)) {
            boolean scoped = !id.equals("bank") && (k.equals("journal") || k.equals("arinvoice") || k.equals("apinvoice") || k.equals("budget") || k.equals("asset"));
            try { out.put(k, Api.I.fin("GET", "records/" + k + "?take=2000" + (scoped && !co.isEmpty() ? "&company=" + co : ""), null)); }
            catch (Exception e) { out.put(k, new ArrayList<>()); }   // a list the user may not read stays empty
        }
        return out;
    }

    public static final class FinancePanel extends JPanel implements Reloadable {
        final List<Object> reports = new ArrayList<>();
        public final JComboBox<String> pick = new JComboBox<>();
        public final JTextField from = new JTextField(new java.text.SimpleDateFormat("yyyy-01-01").format(new Date()), 9), to = new JTextField(9), company = new JTextField(8);
        public Ui.DataTable table = new Ui.DataTable();
        final JScrollPane scroll = new JScrollPane(table);
        public final JLabel foot = new JLabel(), msg = new JLabel();
        final JButton bRec, bUnrec, bSeed;
        String current = "";
        boolean loading;

        public FinancePanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            for (Object r : Json.arr(spec().get("reports"))) if (Api.I.can(VIEW.get(Json.str(Json.obj(r).get("id"))))) { reports.add(r); pick.addItem(tx(r)); }
            add(Ui.label(L("title"), "title"), BorderLayout.NORTH);
            JPanel bar = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0));
            bar.add(pick); bar.add(new JLabel(L("from"))); bar.add(from); bar.add(new JLabel(L("to"))); bar.add(to); bar.add(new JLabel(L("company"))); bar.add(company);
            bar.add(Ui.button(L("refresh"), this::reload, null));
            bRec = Ui.button(L("reconcile"), () -> mark(true), null);
            bUnrec = Ui.button(L("unreconcile"), () -> mark(false), null);
            bSeed = Ui.button(L("seed"), this::seed, "ghost");
            bar.add(bRec); bar.add(bUnrec); bar.add(bSeed);
            JPanel mid = new JPanel(new BorderLayout(0, 6));
            mid.add(bar, BorderLayout.NORTH); mid.add(scroll, BorderLayout.CENTER);
            JPanel bot = new JPanel(new BorderLayout()); bot.add(foot, BorderLayout.NORTH); bot.add(msg, BorderLayout.SOUTH);
            mid.add(bot, BorderLayout.SOUTH);
            add(mid);
            pick.addActionListener(e -> { if (!loading) reload(); });
        }

        Map<String, Object> rep() { int i = pick.getSelectedIndex(); return i >= 0 ? Json.obj(reports.get(i)) : null; }

        @Override public void reload() {
            Map<String, Object> rep = rep();
            if (rep == null) { msg.setText(L("noperm")); return; }
            final String id = Json.str(rep.get("id"));
            current = id;
            boolean dates = Boolean.TRUE.equals(rep.get("dates"));
            from.setVisible(dates); to.setVisible(dates);
            boolean manage = id.equals("bank") && Api.I.can("finance.bank.manage");
            bRec.setVisible(manage); bUnrec.setVisible(manage); bSeed.setVisible(id.equals("tb") && Api.I.can("finance.setup"));
            List<String> heads = new ArrayList<>();
            for (Object c : Json.arr(rep.get("cols"))) heads.add(tx(c));
            table = new Ui.DataTable(heads.toArray(new String[0]));
            scroll.setViewportView(table);
            msg.setText("…");
            final Filters f = filters();
            Ui.async(() -> fetch(id, f.company), data -> { if (id.equals(current)) show(rep, data, f); }, m -> msg.setText(m));
        }

        Filters filters() { Filters f = new Filters(); f.from = from.getText().trim(); f.to = to.getText().trim(); f.company = company.getText().trim(); return f; }

        void show(Map<String, Object> rep, Map<String, Object> data, Filters f) {
            Built b = build(Json.str(rep.get("id")), data, f, LocalDate.now().toString());
            table.fill(b.rows, b.payloads);
            javax.swing.table.DefaultTableCellRenderer right = new javax.swing.table.DefaultTableCellRenderer();
            right.setHorizontalAlignment(SwingConstants.RIGHT);
            List<Object> cols = Json.arr(rep.get("cols"));
            for (int c = 0; c < cols.size(); c++) if (Boolean.TRUE.equals(Json.obj(cols.get(c)).get("num"))) table.getColumnModel().getColumn(c).setCellRenderer(right);
            foot.setText(b.foot);
            msg.setText(b.rows.isEmpty() ? L("empty") : "");
        }

        void mark(boolean v) {
            Object sel = table.selected();
            if (sel == null) return;
            Map<String, Object> rec = Json.obj(sel);
            Map<String, Object> d = new LinkedHashMap<>(Json.obj(rec.get("data")));
            d.put("reconciled", v);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("code", rec.get("code")); body.put("company", rec.get("company")); body.put("status", rec.get("status")); body.put("data", d);
            Ui.async(() -> Api.I.fin("PUT", "records/banktxn/" + Json.str(rec.get("id")), body), r -> reload(), m -> Ui.warn(this, m));
        }

        void seed() {
            Ui.async(() -> Api.I.fin("POST", "accounts/seed", new LinkedHashMap<>()), r -> { msg.setText(L("seeded", (int) num(Json.obj(r).get("created")))); reload(); }, m -> Ui.warn(this, m));
        }
    }
}
