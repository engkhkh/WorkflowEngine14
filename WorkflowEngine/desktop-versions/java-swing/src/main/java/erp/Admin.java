package erp;

import java.awt.*;
import java.awt.datatransfer.StringSelection;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.List;
import javax.swing.*;

import static erp.I18n.t;

/** Administration: workspace plan and usage, the first-run setup wizard, invitations, billing and the module switches. */
public final class Admin {
    private Admin() { }

    static Map<String, Object> SPEC;
    static synchronized Map<String, Object> spec() {
        if (SPEC == null) {
            try (InputStream in = Admin.class.getResourceAsStream("/admin.json")) { SPEC = Json.obj(Json.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8))); } catch (Exception e) { throw new RuntimeException(e); }
        }
        return SPEC;
    }
    static String webOrigin() {
        String s = Api.I.server.trim().replaceAll("/+$", "");
        return s.toLowerCase().endsWith("/api") ? s.substring(0, s.length() - 4) : s;
    }
    static String inviteLink(String token) { return webOrigin() + "/accept-invite?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8).replace("+", "%20"); }
    static String money(Object v) { return "$" + String.format(Locale.ENGLISH, "%,.2f", SiteRender.num(v, 0)); }
    static String s(Object o) { return o == null ? "" : SiteRender.js(o); }
    static String rep(String text, String k, String v) { return text.replace("{" + k + "}", v); }
    static void copy(String text) { try { Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new StringSelection(text), null); } catch (Exception e) { /* headless */ } }
    static void openFile(Path p) { try { if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) Desktop.getDesktop().browse(p.toUri()); } catch (Exception e) { /* no browser */ } }
    static void openUrl(String u) { try { if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) Desktop.getDesktop().browse(java.net.URI.create(u)); } catch (Exception e) { /* no browser */ } }
    static String esc(Object o) { return SiteRender.esc(o); }

    static String invoiceHtml(Map<String, Object> i) {
        StringBuilder rows = new StringBuilder();
        for (Object lv : Json.arr(i.get("lines"))) {
            Map<String, Object> l = Json.obj(lv);
            rows.append("<tr><td>").append(esc(l.get("branchName"))).append("</td><td>").append(s(l.get("users"))).append("</td><td>$").append(String.format(Locale.ENGLISH, "%.2f", SiteRender.num(i.get("unitPrice"), 0)))
                .append("</td><td>$").append(String.format(Locale.ENGLISH, "%.2f", SiteRender.num(l.get("amount"), 0))).append("</td></tr>");
        }
        String issued = s(i.get("issuedAt"));
        return "<!doctype html><meta charset=\"utf-8\"><title>" + esc(i.get("number")) + "</title><style>body{font:14px system-ui;margin:40px;color:#111}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}.r{text-align:end}</style>"
            + "<h1>" + esc(i.get("number")) + "</h1><p>" + esc(i.get("companyName")) + (s(i.get("taxNo")).isEmpty() ? "" : " · " + esc(i.get("taxNo"))) + "<br>" + esc(i.get("period")) + " · " + esc(issued.substring(0, Math.min(10, issued.length())))
            + "</p><table><tr><th>Branch</th><th>Users</th><th>Price</th><th>Amount</th></tr>" + rows + "<tr><th colspan=\"3\" class=\"r\">Total (USD)</th><th>$" + String.format(Locale.ENGLISH, "%.2f", SiteRender.num(i.get("total"), 0)) + "</th></tr></table><p>≈ "
            + String.format(Locale.ENGLISH, "%.2f", SiteRender.num(i.get("totalSar"), 0)) + " SAR (rate " + s(i.get("sarPerUsd")) + ") · " + esc(s(i.get("status")).toUpperCase()) + (s(i.get("method")).isEmpty() ? "" : " · " + esc(i.get("method"))) + "</p>";
    }

    // ------------------------------------------------------------------ modules
    public static final class ModulesBox extends JPanel {
        public final Map<String, JCheckBox> boxes = new LinkedHashMap<>();
        final JPanel grid = new JPanel(new GridLayout(0, 3, 6, 4));
        public final JLabel msg = new JLabel();
        public ModulesBox() {
            super(new BorderLayout(0, 8));
            add(Ui.label(t("mods.hint"), "dim"), BorderLayout.NORTH);
            add(new JScrollPane(grid));
            JPanel bot = new JPanel(new BorderLayout());
            bot.add(Ui.row(Ui.button(t("mods.all"), () -> setAll(true), "plain"), Ui.button(t("mods.none"), () -> setAll(false), "plain"), Ui.button(t("adm.save"), this::save, null)), BorderLayout.WEST);
            bot.add(msg, BorderLayout.SOUTH);
            add(bot, BorderLayout.SOUTH);
        }
        public void reload() { Ui.async(() -> Json.obj(Api.I.ops("GET", "/org/modules", null)), this::show, e -> msg.setText(e)); }
        void show(Map<String, Object> r) {
            grid.removeAll(); boxes.clear();
            Set<String> on = new HashSet<>(); for (Object v : Json.arr(r.get("enabled"))) on.add(Json.str(v));
            for (Object mv : Json.arr(r.get("all"))) {
                String m = Json.str(mv), name = t("module." + m);
                JCheckBox cb = new JCheckBox(name.equals("module." + m) ? m : name, on.contains(m)); boxes.put(m, cb); grid.add(cb);
            }
            grid.revalidate(); grid.repaint();
        }
        public void setAll(boolean v) { for (JCheckBox c : boxes.values()) c.setSelected(v); }
        public List<String> selected() { List<String> o = new ArrayList<>(); for (Map.Entry<String, JCheckBox> e : boxes.entrySet()) if (e.getValue().isSelected()) o.add(e.getKey()); return o; }
        public void save() {
            Map<String, Object> body = new LinkedHashMap<>(); body.put("enabled", new ArrayList<Object>(selected()));
            Ui.async(() -> Json.obj(Api.I.ops("PUT", "/org/modules", body)), r -> { show(r); msg.setText(t("adm.saved")); }, e -> msg.setText(e));
        }
    }

    // ------------------------------------------------------------------ invite form
    public static final class InviteForm extends JPanel {
        public final JTextField name = new JTextField(22), email = new JTextField(22), user = new JTextField(22);
        public final JComboBox<String> role = new JComboBox<>();
        final DefaultListModel<String> bm = new DefaultListModel<>(); final JList<String> branches = new JList<>(bm); final List<String> codes = new ArrayList<>(); final Set<Integer> picked = new HashSet<>();
        public final JLabel err = Ui.label("", "error");
        final java.util.function.Consumer<Map<String, Object>> onDone;
        public InviteForm(java.util.function.Consumer<Map<String, Object>> onDone) {
            super(new GridBagLayout());
            this.onDone = onDone;
            branches.setSelectionMode(ListSelectionModel.MULTIPLE_INTERVAL_SELECTION); branches.setVisibleRowCount(3);
            GridBagConstraints g = new GridBagConstraints(); g.insets = new Insets(3, 3, 3, 3); g.anchor = GridBagConstraints.WEST; g.fill = GridBagConstraints.HORIZONTAL; int r = 0;
            Object[][] rows = {{t("admin.displayName"), name}, {t("admin.email"), email}, {t("admin.username"), user}, {t("admin.role"), role}, {t("invite.branchAccess"), new JScrollPane(branches)}};
            for (Object[] x : rows) { g.gridx = 0; g.gridy = r; g.weightx = 0; add(new JLabel((String) x[0]), g); g.gridx = 1; g.weightx = 1; add((Component) x[1], g); r++; }
            g.gridx = 1; g.gridy = r++; add(Ui.button(t("setup.invite"), this::invite, null), g); g.gridy = r; add(err, g);
        }
        public void load(List<String> roles, List<Object> brs) {
            role.removeAllItems(); for (String r : roles) if (!r.equals("admin")) role.addItem(r);
            bm.clear(); codes.clear();
            for (Object bv : brs) { Map<String, Object> b = Json.obj(bv); bm.addElement(Json.str(b.get("name"))); codes.add(Json.str(b.get("code"))); }
        }
        public void invite() {
            if (name.getText().trim().isEmpty() || user.getText().trim().isEmpty()) { err.setText(t("signup.fill")); return; }
            List<Object> br = new ArrayList<>(); for (int i : branches.getSelectedIndices()) br.add(codes.get(i));
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("username", user.getText().trim()); body.put("displayName", name.getText().trim()); body.put("email", email.getText().trim()); body.put("role", role.getSelectedItem() == null ? "employee" : role.getSelectedItem());
            body.put("isActive", true); body.put("permissions", null); body.put("branches", br.isEmpty() ? null : br); body.put("invite", true); body.put("appUrl", webOrigin());
            Ui.async(() -> Json.obj(Api.I.ops("POST", "/users/admin", body)), u -> { err.setText(""); name.setText(""); email.setText(""); user.setText(""); onDone.accept(u); }, e -> err.setText(e));
        }
    }

    // ------------------------------------------------------------------ wizard
    public static final class Wizard extends JPanel {
        final Runnable onFinished;
        public Map<String, Object> company = new LinkedHashMap<>();
        public List<Object> branches = new ArrayList<>(), users = new ArrayList<>();
        public List<String> roles = new ArrayList<>(List.of("employee"));
        public int step = 0;
        public final JLabel head = new JLabel(), msg = new JLabel();
        final CardLayout cards = new CardLayout(); final JPanel stack = new JPanel(cards);
        public final JTextField name = new JTextField(26), ar = new JTextField(26), country = new JTextField(16), tax = new JTextField(16), brn = new JTextField(14), brc = new JTextField(10);
        public final JComboBox<String> cur = new JComboBox<>();
        public final Ui.DataTable brt = new Ui.DataTable(t("org.branches"), "Code", t("org.city")), invited = new Ui.DataTable(t("admin.displayName"), t("admin.role"), t("adm.link"));
        public final InviteForm form; public final ModulesBox mods = new ModulesBox();
        final JButton bBack, bSkip, bNext;
        public Wizard(Runnable onFinished) {
            super(new BorderLayout(0, 8));
            this.onFinished = onFinished;
            for (Object c : Json.arr(spec().get("currencies"))) cur.addItem(Json.str(c));
            JPanel p1 = new JPanel(new GridBagLayout()); GridBagConstraints g = new GridBagConstraints(); g.insets = new Insets(4, 4, 4, 4); g.anchor = GridBagConstraints.WEST; int r = 0;
            Object[][] rows = {{t("signup.company"), name}, {t("org.nameAr"), ar}, {t("signup.currency"), cur}, {t("setup.country"), country}, {t("setup.taxNo"), tax}};
            for (Object[] x : rows) { g.gridx = 0; g.gridy = r; p1.add(new JLabel((String) x[0]), g); g.gridx = 1; p1.add((Component) x[1], g); r++; }
            g.gridx = 1; g.gridy = r; p1.add(Ui.label(t("setup.oneCompany"), "dim"), g);
            JPanel o1 = new JPanel(new BorderLayout()); o1.add(p1, BorderLayout.NORTH); stack.add(o1, "0");
            JPanel p2 = new JPanel(new BorderLayout(0, 6)); p2.add(new JScrollPane(brt));
            p2.add(Ui.row(brn, brc, Ui.button(t("org.addBranch"), this::addBranch, null), Ui.button(t("adm.delete"), this::delBranch, "plain")), BorderLayout.SOUTH); stack.add(p2, "1");
            form = new InviteForm(this::invitedOne);
            JPanel p3 = new JPanel(new BorderLayout(0, 6)); JPanel top = new JPanel(new BorderLayout());
            top.add(Ui.label(t("setup.teamHint"), "dim"), BorderLayout.NORTH); JScrollPane sp = new JScrollPane(invited); sp.setPreferredSize(new Dimension(300, 110)); top.add(sp); top.add(Ui.row(Ui.button(t("invite.copy"), this::copySel, "plain")), BorderLayout.SOUTH);
            p3.add(top, BorderLayout.NORTH); p3.add(form); stack.add(p3, "2");
            JPanel p4 = new JPanel(new BorderLayout(0, 6)); JPanel h4 = new JPanel(new BorderLayout()); h4.add(Ui.label(t("setup.ready"), "title"), BorderLayout.NORTH); h4.add(Ui.label(t("setup.readyHint"), "dim"));
            p4.add(h4, BorderLayout.NORTH); p4.add(mods); stack.add(p4, "3");
            bBack = Ui.button(t("setup.back"), this::back, "plain"); bSkip = Ui.button(t("setup.skip"), () -> go(3), "plain"); bNext = Ui.button(t("setup.next"), this::next, null);
            JPanel nav = new JPanel(new BorderLayout()); nav.add(Ui.row(bBack), BorderLayout.WEST); nav.add(Ui.row(bSkip, bNext), BorderLayout.EAST); nav.add(msg, BorderLayout.SOUTH);
            add(head, BorderLayout.NORTH); add(stack); add(nav, BorderLayout.SOUTH);
            go(0);
        }
        public void reload() {
            Ui.async(() -> new Object[]{Json.obj(Api.I.ops("GET", "/org", null)), Json.obj(Api.I.ops("GET", "/users/permissions", null))}, res -> {
                Map<String, Object> org = Json.obj(res[0]), cat = Json.obj(res[1]);
                List<Object> cs = Json.arr(org.get("companies")); company = cs.isEmpty() ? new LinkedHashMap<>() : Json.obj(cs.get(0)); branches = Json.arr(org.get("branches"));
                if (!company.isEmpty()) {
                    name.setText(s(company.get("name"))); ar.setText(s(company.get("nameAr"))); cur.setSelectedItem(s(company.get("currency"))); country.setText(s(company.get("country"))); tax.setText(s(company.get("taxNo")));
                }
                roles = new ArrayList<>(); for (Object x : Json.arr(cat.get("roles"))) roles.add(Json.str(x)); if (roles.isEmpty()) roles.add("employee");
                showBranches(); form.load(roles, branches); mods.reload();
            }, e -> msg.setText(e));
        }
        public void go(int n) {
            step = n; cards.show(stack, String.valueOf(n));
            head.setText("<html><b>" + rep(rep(t("adm.step"), "n", String.valueOf(n + 1)), "t", "4") + "</b> &nbsp; " + t("setup.s" + (n + 1)) + "</html>");
            bBack.setVisible(n > 0); bSkip.setVisible(n == 2); bNext.setText(n == 3 ? t("setup.finish") : t("setup.next")); msg.setText("");
        }
        public void back() { go(step - 1); }
        public void next() {
            if (step == 0) {
                if (name.getText().trim().isEmpty()) { msg.setText(t("adm.mustName")); return; }
                if (company.isEmpty()) { go(1); return; }
                Map<String, Object> c = new LinkedHashMap<>(company);
                c.put("name", name.getText().trim()); c.put("nameAr", ar.getText().trim()); c.put("currency", cur.getSelectedItem()); c.put("country", country.getText().trim()); c.put("taxNo", tax.getText().trim());
                Ui.async(() -> Json.obj(Api.I.ops("PUT", "/org/companies/" + s(company.get("code")), c)), r -> { company = r; go(1); }, e -> msg.setText(e));
            } else if (step < 3) go(step + 1);
            else Ui.async(() -> Api.I.ops("POST", "/org/setup/complete", new LinkedHashMap<String, Object>()), r -> { msg.setText(t("adm.setupDone")); onFinished.run(); }, e -> msg.setText(e));
        }
        void showBranches() {
            List<String[]> rows = new ArrayList<>(); for (Object bv : branches) { Map<String, Object> b = Json.obj(bv); rows.add(new String[]{s(b.get("name")), s(b.get("code")), s(b.get("city"))}); }
            brt.fill(rows, branches);
        }
        public void addBranch() {
            if (brn.getText().trim().isEmpty() || company.isEmpty()) return;
            String chars = "abcdefghijklmnopqrstuvwxyz0123456789"; StringBuilder rnd = new StringBuilder(); Random rd = new Random(); for (int i = 0; i < 3; i++) rnd.append(chars.charAt(rd.nextInt(chars.length())));
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("code", String.format("BR%02d-%s", branches.size() + 1, rnd).toUpperCase()); body.put("company", company.get("code")); body.put("name", brn.getText().trim()); body.put("nameAr", ""); body.put("warehouse", ""); body.put("city", brc.getText().trim());
            Ui.async(() -> Json.obj(Api.I.ops("POST", "/org/branches", body)), b -> { branches.add(b); brn.setText(""); brc.setText(""); showBranches(); form.load(roles, branches); }, e -> msg.setText(e));
        }
        public void delBranch() {
            Object sel = brt.selected(); if (sel == null || branches.size() < 2) return;
            String code = s(Json.obj(sel).get("code"));
            Ui.async(() -> Api.I.ops("DELETE", "/org/branches/" + code, null), r -> { branches.removeIf(x -> s(Json.obj(x).get("code")).equals(code)); showBranches(); }, e -> msg.setText(e));
        }
        void invitedOne(Map<String, Object> u) {
            users.add(u);
            List<String[]> rows = new ArrayList<>(); for (Object xv : users) { Map<String, Object> x = Json.obj(xv); rows.add(new String[]{s(x.get("displayName")), s(x.get("role")), s(x.get("inviteToken")).isEmpty() ? "" : inviteLink(s(x.get("inviteToken")))}); }
            invited.fill(rows, users);
        }
        public void copySel() { Object o = invited.selected(); if (o != null && !s(Json.obj(o).get("inviteToken")).isEmpty()) { copy(inviteLink(s(Json.obj(o).get("inviteToken")))); msg.setText(t("invite.copied")); } }
    }

    // ------------------------------------------------------------------ the page
    public static final class AdminPanel extends JPanel implements Reloadable {
        public final JTabbedPane tabs = new JTabbedPane();
        public final JLabel msg = new JLabel(), wsHead = new JLabel(), kpi = new JLabel();
        public Ui.DataTable ws = new Ui.DataTable(t("adm.v.ws"), t("bill.users"), "Max"), inv, lines, invs;
        public Wizard wiz; public InviteForm form; public ModulesBox mods;
        final List<Runnable> views = new ArrayList<>();
        public AdminPanel() {
            super(new BorderLayout(0, 8));
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            add(Ui.label(t("adm.title"), "title"), BorderLayout.NORTH); add(tabs); add(msg, BorderLayout.SOUTH);
            JPanel w = new JPanel(new BorderLayout(0, 6)); w.add(wsHead, BorderLayout.NORTH); w.add(new JScrollPane(ws)); w.add(Ui.label(t("ws.note"), "dim"), BorderLayout.SOUTH);
            tabs.addTab(t("adm.v.ws"), w); views.add(this::loadWs);
            if (Api.I.can("org.manage")) { wiz = new Wizard(this::reload); tabs.addTab(t("adm.v.setup"), wiz); views.add(wiz::reload); }
            if (Api.I.can("admin.users")) {
                inv = new Ui.DataTable(t("admin.displayName"), t("admin.username"), t("admin.role"), t("adm.status"), t("adm.link"));
                JPanel p = new JPanel(new BorderLayout(0, 6)); p.add(new JScrollPane(inv)); form = new InviteForm(u -> loadInvites());
                JPanel bot = new JPanel(new BorderLayout()); bot.add(Ui.row(Ui.button(t("invite.resend"), this::resend, null), Ui.button(t("invite.copy"), this::copyLink, "plain")), BorderLayout.NORTH);
                bot.add(Ui.label(t("adm.newInvite"), "title"), BorderLayout.CENTER); bot.add(form, BorderLayout.SOUTH);
                p.add(bot, BorderLayout.SOUTH); tabs.addTab(t("adm.v.invites"), p); views.add(this::loadInvites);
            }
            if (Api.I.can("org.manage")) {
                lines = new Ui.DataTable(t("bill.byBranch"), t("bill.usersShort"), t("bill.total")); invs = new Ui.DataTable(t("bill.number"), t("bill.period"), t("bill.usersShort"), t("bill.total"), t("bill.due"), t("adm.status"));
                JPanel p = new JPanel(new BorderLayout(0, 6)); JPanel top = new JPanel(new BorderLayout()); top.add(kpi, BorderLayout.NORTH); JScrollPane ls = new JScrollPane(lines); ls.setPreferredSize(new Dimension(300, 90)); top.add(ls);
                p.add(top, BorderLayout.NORTH); p.add(new JScrollPane(invs));
                p.add(Ui.row(Ui.button(t("bill.pay"), this::pay, null), Ui.button(t("bill.check"), this::check, "plain"), Ui.button(t("bill.print"), this::printInv, "plain"), Ui.button(t("adm.sandbox"), this::sandbox, "plain")), BorderLayout.SOUTH);
                tabs.addTab(t("bill.tab"), p); views.add(this::loadBilling);
                mods = new ModulesBox(); tabs.addTab(t("mods.tab"), mods); views.add(mods::reload);
            }
            tabs.addChangeListener(e -> { int i = tabs.getSelectedIndex(); if (i >= 0 && i < views.size()) views.get(i).run(); });
        }
        @Override public void reload() { int i = tabs.getSelectedIndex(); if (i >= 0 && i < views.size()) views.get(i).run(); }
        void say(String m) { msg.setText(m); }

        void loadWs() {
            Ui.async(() -> Json.obj(Api.I.ops("GET", "/org", null)), o -> {
                Map<String, Object> tn = Json.obj(o.get("tenant"));
                String plan = s(tn.get("plan")).isEmpty() ? "starter" : s(tn.get("plan"));
                wsHead.setText("<html><b>" + esc(tn.get("name")) + "</b> &nbsp; " + t("ws.id") + ": " + s(tn.get("id")) + " &nbsp; " + t("ws.plan") + ": " + t("ws.plan." + plan) + "</html>");
                java.util.function.Function<String, String> lim = k -> { double mx = SiteRender.num(tn.get("max" + k), 0); return mx != 0 ? SiteRender.js(mx) : t("ws.unlimited"); };
                List<String[]> rows = List.of(new String[]{t("ws.users"), s(tn.get("users")), lim.apply("Users")}, new String[]{t("org.companies"), s(tn.get("companies")), lim.apply("Companies")}, new String[]{t("org.branches"), s(tn.get("branches")), lim.apply("Branches")});
                ws.fill(rows, rows); say(Boolean.FALSE.equals(tn.get("setupDone")) ? t("setup.banner") : "");
            }, this::say);
        }
        void loadInvites() {
            Ui.async(() -> new Object[]{Json.arr(Api.I.ops("GET", "/users/admin", null)), Json.obj(Api.I.ops("GET", "/org", null)), Json.obj(Api.I.ops("GET", "/users/permissions", null))}, res -> {
                List<Object> users = Json.arr(res[0]); List<String[]> rows = new ArrayList<>();
                for (Object uv : users) { Map<String, Object> u = Json.obj(uv); rows.add(new String[]{s(u.get("displayName")), s(u.get("username")), s(u.get("role")), Boolean.TRUE.equals(u.get("invitePending")) ? t("invite.pending") : (Boolean.TRUE.equals(u.get("isActive")) ? "✓" : "-"), s(u.get("inviteToken")).isEmpty() ? "" : inviteLink(s(u.get("inviteToken")))}); }
                inv.fill(rows, users); say(users.isEmpty() ? t("adm.noInvites") : "");
                List<String> roles = new ArrayList<>(); for (Object r : Json.arr(Json.obj(res[2]).get("roles"))) roles.add(Json.str(r)); if (roles.isEmpty()) roles.add("employee");
                form.load(roles, Json.arr(Json.obj(res[1]).get("branches")));
            }, this::say);
        }
        public void resend() {
            Object o = inv.selected(); if (o == null) return;
            Map<String, Object> body = new LinkedHashMap<>(); body.put("appUrl", webOrigin());
            Ui.async(() -> Api.I.ops("POST", "/users/admin/" + s(Json.obj(o).get("id")) + "/invite", body), r -> { say(t("adm.accept")); loadInvites(); }, this::say);
        }
        public void copyLink() {
            Object o = inv.selected(); if (o == null) return;
            if (!s(Json.obj(o).get("inviteToken")).isEmpty()) { copy(inviteLink(s(Json.obj(o).get("inviteToken")))); say(t("invite.copied")); } else say(t("invite.resend"));
        }
        void loadBilling() {
            Ui.async(() -> new Object[]{Json.obj(Api.I.ops("GET", "/billing/summary", null)), Json.arr(Api.I.ops("GET", "/billing/invoices", null))}, res -> {
                Map<String, Object> sm = Json.obj(res[0]);
                kpi.setText("<html>" + t("bill.users") + ": <b>" + s(sm.get("users")) + "</b> &nbsp; " + t("bill.rate") + ": <b>" + money(sm.get("unitPrice")) + "</b> (" + t("bill.perUserMonth") + ") &nbsp; " + t("bill.estimate") + ": <b>" + money(sm.get("estimate"))
                    + "</b> &nbsp; " + t("bill.balance") + ": <b>" + money(sm.get("balance")) + "</b> (" + s(sm.get("openInvoices")) + " " + t("bill.open") + ")<br><span style=\"color:#64748b\">"
                    + rep(rep(rep(t("bill.pricing"), "p", s(sm.get("pricePerUser"))), "v", s(sm.get("volumePrice"))), "n", s(sm.get("volumeFrom"))) + "</span></html>");
                List<Object> ls = Json.arr(sm.get("lines")); List<String[]> lr = new ArrayList<>();
                for (Object lv : ls) { Map<String, Object> l = Json.obj(lv); lr.add(new String[]{s(l.get("branchName")), s(l.get("users")), money(l.get("amount"))}); }
                lines.fill(lr, ls);
                List<Object> is = Json.arr(res[1]); List<String[]> rows = new ArrayList<>();
                for (Object iv : is) {
                    Map<String, Object> i = Json.obj(iv); String due = s(i.get("dueAt"));
                    rows.add(new String[]{s(i.get("number")), s(i.get("period")), s(i.get("users")) + " x " + money(i.get("unitPrice")), money(i.get("total")) + " (~" + String.format(Locale.ENGLISH, "%.2f", SiteRender.num(i.get("totalSar"), 0)) + " SAR)", due.substring(0, Math.min(10, due.length())),
                        "paid".equals(s(i.get("status"))) ? t("bill.paid") : (Boolean.TRUE.equals(i.get("overdue")) ? t("bill.overdue") : t("bill.unpaid"))});
                }
                invs.fill(rows, is); say("");
            }, this::say);
        }
        Map<String, Object> sel() { Object o = invs.selected(); return o == null ? null : Json.obj(o); }
        public void pay() {
            Map<String, Object> i = sel(); if (i == null || !"open".equals(s(i.get("status")))) return;
            Map<String, Object> body = new LinkedHashMap<>(); body.put("returnUrl", webOrigin() + "/admin?tab=billing");
            Ui.async(() -> Json.obj(Api.I.ops("POST", "/billing/invoices/" + s(i.get("id")) + "/pay", body)), r -> {
                String url = s(r.get("url")); if (!url.isEmpty()) { openUrl(url); say(t("adm.payOpened")); } else say(t("bill.testMode") + ": " + t("bill.testHint"));
            }, this::say);
        }
        public void check() {
            Map<String, Object> i = sel(); if (i == null) return;
            Ui.async(() -> Json.obj(Api.I.ops("POST", "/billing/invoices/" + s(i.get("id")) + "/confirm", new LinkedHashMap<String, Object>())), r -> { say("paid".equals(s(r.get("status"))) ? t("bill.thanks") : t("bill.notPaid")); loadBilling(); }, this::say);
        }
        public void sandbox() {
            Map<String, Object> i = sel(); if (i == null || !"open".equals(s(i.get("status")))) return;
            Ui.async(() -> Api.I.ops("POST", "/billing/invoices/" + s(i.get("id")) + "/sandbox-pay", new LinkedHashMap<String, Object>()), r -> { say(t("bill.thanks")); loadBilling(); }, this::say);
        }
        public void printInv() {
            Map<String, Object> i = sel(); if (i == null) return;
            try { Path p = Path.of(System.getProperty("java.io.tmpdir"), s(i.get("number")) + ".html"); Files.writeString(p, invoiceHtml(i), StandardCharsets.UTF_8); openFile(p); say(p.toString()); } catch (Exception e) { say(e.getMessage()); }
        }
    }
}
